import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { sqs } from '../lib/aws.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/observability.js';
import { ENTITY_TYPE, TaskStatus } from '../lib/tasks.js';

/**
 * Decides whether a DynamoDB stream record means "this task's expiry must be
 * cancelled". Returns the SQS message to send, or null.
 *
 *  - REMOVE of a Pending task         -> reason: DELETED
 *  - MODIFY Pending -> Completed      -> reason: COMPLETED
 *
 * The event source mapping already filters for these shapes; we re-check here
 * so the function is correct even without the filter.
 */
export function toCancellationMessage(record) {
  const oldImage = record.dynamodb?.OldImage ? unmarshall(record.dynamodb.OldImage) : undefined;
  const newImage = record.dynamodb?.NewImage ? unmarshall(record.dynamodb.NewImage) : undefined;
  const image = newImage ?? oldImage;
  if (!image || image.entityType !== ENTITY_TYPE) return null;

  let reason = null;
  if (record.eventName === 'REMOVE' && oldImage?.status === TaskStatus.PENDING) reason = 'DELETED';
  if (
    record.eventName === 'MODIFY' &&
    oldImage?.status === TaskStatus.PENDING &&
    newImage?.status === TaskStatus.COMPLETED
  ) {
    reason = 'COMPLETED';
  }
  if (!reason) return null;

  return {
    // Per-task ordering; different tasks are processed in parallel.
    MessageGroupId: image.taskId,
    // Stream eventID is stable across Lambda retries -> SQS drops duplicates within 5 minutes.
    MessageDeduplicationId: record.eventID,
    MessageBody: JSON.stringify({
      taskId: image.taskId,
      userId: image.userId,
      reason,
      scheduleName: image.scheduleName,
      occurredAt: new Date((record.dynamodb.ApproximateCreationDateTime ?? Date.now() / 1000) * 1000).toISOString(),
    }),
  };
}

/** DynamoDB Stream -> SQS FIFO (cancel-expiry queue). */
export const handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records ?? []) {
    try {
      const message = toCancellationMessage(record);
      if (!message) continue;
      await sqs.send(new SendMessageCommand({ QueueUrl: config.cancelQueueUrl, ...message }));
      logger.info('Queued expiry cancellation', { eventID: record.eventID, body: JSON.parse(message.MessageBody) });
    } catch (error) {
      logger.error('Failed to route stream record', { error, eventID: record.eventID });
      // Streams are ordered per shard: report this record so Lambda retries from here.
      batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
      break;
    }
  }

  return { batchItemFailures };
};

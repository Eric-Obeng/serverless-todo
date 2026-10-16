import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/aws.js';
import { config } from '../lib/config.js';
import { logger, metrics, MetricUnit } from '../lib/observability.js';
import { deleteExpirySchedule } from '../lib/scheduler.js';
import { keys, TaskStatus } from '../lib/tasks.js';

/**
 * Decides what to do with a cancellation, based on the task's CURRENT state
 * rather than the state in the (possibly stale) message.
 *
 * Cancellations are asynchronous, so a task can be completed and then reopened
 * (or rescheduled) before its cancellation is processed. The API has already
 * created a new `task-<id>` schedule by then; deleting it would mean the task
 * never expires. So:
 *   - task gone (deleted)           -> delete the schedule
 *   - task Completed / Expired      -> delete the schedule
 *   - task Pending again            -> skip: the schedule belongs to the live task
 */
export function shouldDeleteSchedule(currentTask) {
  return !currentTask || currentTask.status !== TaskStatus.PENDING;
}

async function processCancellation({ taskId, userId, reason }) {
  const { Item: current } = await ddb.send(
    new GetCommand({
      TableName: config.tableName,
      Key: { PK: keys.pk(userId), SK: keys.sk(taskId) },
      ProjectionExpression: '#status',
      ExpressionAttributeNames: { '#status': 'status' },
      ConsistentRead: true,
    }),
  );

  if (!shouldDeleteSchedule(current)) {
    logger.info('Task is Pending again (reopened/rescheduled) - keeping its schedule', { taskId, reason });
    metrics.addMetric('ExpiryCancellationSkipped', MetricUnit.Count, 1);
    return;
  }

  const result = await deleteExpirySchedule(taskId);
  logger.info('Expiry cancellation processed', {
    taskId,
    reason,
    currentStatus: current?.status ?? 'deleted',
    ...result,
  });
  if (result.deleted) metrics.addMetric('ExpiryCancelled', MetricUnit.Count, 1);
}

/**
 * SQS FIFO -> delete the task's EventBridge Scheduler schedule.
 *
 * Idempotent: deleting a schedule that no longer exists (already fired,
 * already cancelled, or a duplicate message) is treated as success, and the
 * current-state check above makes stale/out-of-order messages harmless.
 */
export const handler = async (event) => {
  const batchItemFailures = [];
  const failedGroups = new Set();

  for (const record of event.Records ?? []) {
    const groupId = record.attributes?.MessageGroupId;
    // FIFO semantics: once a message in a group fails, fail the rest of that group too.
    if (failedGroups.has(groupId)) {
      batchItemFailures.push({ itemIdentifier: record.messageId });
      continue;
    }

    try {
      await processCancellation(JSON.parse(record.body));
    } catch (error) {
      logger.error('Failed to cancel expiry schedule', { error, messageId: record.messageId });
      failedGroups.add(groupId);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  metrics.publishStoredMetrics();
  return { batchItemFailures };
};

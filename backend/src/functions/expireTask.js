import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PublishCommand } from '@aws-sdk/client-sns';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, sns } from '../lib/aws.js';
import { config } from '../lib/config.js';
import { logger, metrics, MetricUnit } from '../lib/observability.js';
import { keys, TaskStatus } from '../lib/tasks.js';

/**
 * Invoked by EventBridge Scheduler at a task's deadline with { taskId, userId }.
 *
 * 1. Reads the task and conditionally flips it Pending -> Expired (no-op if it was
 *    completed, deleted, or already expired - this makes retries/duplicates safe).
 * 2. Publishes an SNS message with a `userId` attribute; the owner's email
 *    subscription filter policy ensures only they receive it.
 */
export const handler = async (event) => {
  const { taskId, userId } = event ?? {};
  logger.appendKeys({ taskId, userId });
  if (!taskId || !userId) {
    logger.error('Invalid expiry event', { event });
    return { status: 'invalid-event' };
  }

  const Key = { PK: keys.pk(userId), SK: keys.sk(taskId) };
  const { Item: current } = await ddb.send(new GetCommand({ TableName: config.tableName, Key }));

  if (!current || current.status !== TaskStatus.PENDING) {
    logger.info('Task no longer pending (completed, deleted or already expired) - skipping', {
      status: current?.status ?? 'deleted',
    });
    return { status: 'skipped' };
  }
  // Guard against a stale schedule firing after the deadline was pushed back.
  if (new Date(current.deadline).getTime() > Date.now() + 60_000) {
    logger.warn('Deadline is in the future - stale schedule, skipping', { deadline: current.deadline });
    return { status: 'skipped-stale' };
  }

  const now = new Date().toISOString();
  let task;
  try {
    const { Attributes } = await ddb.send(
      new UpdateCommand({
        TableName: config.tableName,
        Key,
        UpdateExpression: 'SET #status = :expired, expiredAt = :now, updatedAt = :now, GSI1SK = :gsi1sk',
        // Condition makes concurrent "complete" vs "expire" safe: only one wins.
        ConditionExpression: '#status = :pending AND deadline = :deadline',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':expired': TaskStatus.EXPIRED,
          ':pending': TaskStatus.PENDING,
          ':deadline': current.deadline,
          ':now': now,
          ':gsi1sk': keys.gsi1sk(TaskStatus.EXPIRED, current.deadline),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    task = Attributes;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      logger.info('Task changed while expiring - skipping');
      return { status: 'skipped' };
    }
    throw error; // let Scheduler retry, then DLQ
  }

  logger.info('Task expired');
  metrics.addMetric('TaskExpired', MetricUnit.Count, 1);

  await sns.send(
    new PublishCommand({
      TopicArn: config.topicArn,
      Subject: truncate(`Task expired: ${task.title}`, 100),
      Message: [
        `Hi,`,
        ``,
        `Your task "${task.title}" passed its deadline without being completed and is now marked Expired.`,
        ``,
        `Description: ${task.description || '(none)'}`,
        `Deadline:    ${task.deadline}`,
        `Task ID:     ${task.taskId}`,
      ].join('\n'),
      MessageAttributes: {
        userId: { DataType: 'String', StringValue: userId },
        taskId: { DataType: 'String', StringValue: taskId },
      },
    }),
  );
  logger.info('Expiry notification published');
  metrics.publishStoredMetrics();

  return { status: 'expired' };
};

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

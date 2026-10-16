import { logger, metrics, MetricUnit } from '../lib/observability.js';
import { deleteExpirySchedule } from '../lib/scheduler.js';

/**
 * SQS FIFO -> delete the task's EventBridge Scheduler schedule.
 *
 * Idempotent: deleting a schedule that no longer exists (already fired,
 * already cancelled, or a duplicate message) is treated as success.
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
      const { taskId, reason } = JSON.parse(record.body);
      const result = await deleteExpirySchedule(taskId);
      logger.info('Expiry cancellation processed', { taskId, reason, ...result });
      if (result.deleted) metrics.addMetric('ExpiryCancelled', MetricUnit.Count, 1);
    } catch (error) {
      logger.error('Failed to cancel expiry schedule', { error, messageId: record.messageId });
      failedGroups.add(groupId);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  metrics.publishStoredMetrics();
  return { batchItemFailures };
};

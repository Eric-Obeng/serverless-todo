import {
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { scheduler } from './aws.js';
import { config } from './config.js';
import { scheduleNameFor } from './tasks.js';

// EventBridge Scheduler one-time expression: at(yyyy-mm-ddThh:mm:ss), evaluated in UTC.
const atExpression = (deadlineIso) => `at(${new Date(deadlineIso).toISOString().slice(0, 19)})`;

const scheduleInput = ({ taskId, userId, deadline }) => ({
  Name: scheduleNameFor(taskId),
  GroupName: config.scheduleGroupName,
  ScheduleExpression: atExpression(deadline),
  ScheduleExpressionTimezone: 'UTC',
  FlexibleTimeWindow: { Mode: 'OFF' },
  ActionAfterCompletion: 'DELETE', // one-shot schedules clean themselves up
  Description: `Expire task ${taskId}`,
  Target: {
    Arn: config.expiryFunctionArn,
    RoleArn: config.schedulerRoleArn,
    Input: JSON.stringify({ taskId, userId }),
    RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
    ...(config.schedulerDlqArn && { DeadLetterConfig: { Arn: config.schedulerDlqArn } }),
  },
});

/** Create the expiry schedule, or update it if it already exists (e.g. deadline changed). */
export async function upsertExpirySchedule(task) {
  const input = scheduleInput(task);
  try {
    await scheduler.send(new CreateScheduleCommand(input));
  } catch (err) {
    if (!(err instanceof ConflictException)) throw err;
    await scheduler.send(new UpdateScheduleCommand(input));
  }
  return input.Name;
}

/** Delete the expiry schedule. Idempotent: a missing schedule counts as success. */
export async function deleteExpirySchedule(taskId) {
  try {
    await scheduler.send(
      new DeleteScheduleCommand({ Name: scheduleNameFor(taskId), GroupName: config.scheduleGroupName }),
    );
    return { deleted: true };
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return { deleted: false, reason: 'not-found' };
    throw err;
  }
}

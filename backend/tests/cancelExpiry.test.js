import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceNotFoundException } from '@aws-sdk/client-scheduler';

process.env.TABLE_NAME ??= 'test-table';
process.env.SCHEDULE_GROUP_NAME ??= 'test-group';
process.env.AWS_REGION ??= 'eu-central-1';

const { ddb, scheduler } = await import('../src/lib/aws.js');
const { handler, shouldDeleteSchedule } = await import('../src/functions/cancelExpiry.js');

// In-memory stand-ins for DynamoDB and EventBridge Scheduler.
let tasks;
let deletedSchedules;
let schedulerError;

beforeEach(() => {
  tasks = new Map();
  deletedSchedules = [];
  schedulerError = undefined;
  ddb.send = async (cmd) => ({ Item: tasks.get(cmd.input.Key.SK) });
  scheduler.send = async (cmd) => {
    if (schedulerError) throw schedulerError;
    deletedSchedules.push(cmd.input.Name);
    return {};
  };
});

const message = (taskId, reason = 'COMPLETED', messageId = taskId) => ({
  messageId,
  body: JSON.stringify({ taskId, userId: 'user-1', reason }),
  attributes: { MessageGroupId: taskId },
});

test('shouldDeleteSchedule: only a Pending task keeps its schedule', () => {
  assert.equal(shouldDeleteSchedule(undefined), true);
  assert.equal(shouldDeleteSchedule({ status: 'Completed' }), true);
  assert.equal(shouldDeleteSchedule({ status: 'Expired' }), true);
  assert.equal(shouldDeleteSchedule({ status: 'Pending' }), false);
});

test('completed task -> schedule deleted', async () => {
  tasks.set('TASK#t1', { status: 'Completed' });
  const res = await handler({ Records: [message('t1')] });
  assert.deepEqual(deletedSchedules, ['task-t1']);
  assert.deepEqual(res.batchItemFailures, []);
});

test('deleted task -> schedule deleted', async () => {
  const res = await handler({ Records: [message('t2', 'DELETED')] });
  assert.deepEqual(deletedSchedules, ['task-t2']);
  assert.deepEqual(res.batchItemFailures, []);
});

test('race: task reopened before the cancellation ran -> new schedule is kept', async () => {
  tasks.set('TASK#t3', { status: 'Pending' }); // completed, then reopened
  const res = await handler({ Records: [message('t3')] });
  assert.deepEqual(deletedSchedules, []);
  assert.deepEqual(res.batchItemFailures, []);
});

test('schedule already gone (fired / duplicate message) -> success', async () => {
  tasks.set('TASK#t4', { status: 'Completed' });
  schedulerError = new ResourceNotFoundException({ message: 'not found', $metadata: {} });
  const res = await handler({ Records: [message('t4')] });
  assert.deepEqual(res.batchItemFailures, []);
});

test('failure -> message reported, rest of its FIFO group held back, other groups continue', async () => {
  tasks.set('TASK#a', { status: 'Completed' });
  tasks.set('TASK#b', { status: 'Completed' });
  ddb.send = async (cmd) => {
    if (cmd.input.Key.SK === 'TASK#a') throw new Error('throttled');
    return { Item: tasks.get(cmd.input.Key.SK) };
  };
  const res = await handler({
    Records: [message('a', 'COMPLETED', 'm1'), message('a', 'DELETED', 'm2'), message('b', 'COMPLETED', 'm3')],
  });
  assert.deepEqual(res.batchItemFailures.map((f) => f.itemIdentifier), ['m1', 'm2']);
  assert.deepEqual(deletedSchedules, ['task-b']);
});

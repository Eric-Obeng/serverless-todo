import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marshall } from '@aws-sdk/util-dynamodb';
import { toCancellationMessage } from '../src/functions/streamRouter.js';

const task = (status) => ({
  PK: 'USER#u1', SK: 'TASK#t1', entityType: 'TASK',
  taskId: 't1', userId: 'u1', status, scheduleName: 'task-t1',
});
const record = (eventName, oldImg, newImg) => ({
  eventID: 'evt-1',
  eventName,
  dynamodb: {
    SequenceNumber: '1',
    ApproximateCreationDateTime: 1_700_000_000,
    ...(oldImg && { OldImage: marshall(oldImg) }),
    ...(newImg && { NewImage: marshall(newImg) }),
  },
});

test('Pending -> Completed queues a COMPLETED cancellation', () => {
  const msg = toCancellationMessage(record('MODIFY', task('Pending'), task('Completed')));
  assert.equal(msg.MessageGroupId, 't1');
  assert.equal(msg.MessageDeduplicationId, 'evt-1');
  assert.equal(JSON.parse(msg.MessageBody).reason, 'COMPLETED');
});

test('deleting a Pending task queues a DELETED cancellation', () => {
  const msg = toCancellationMessage(record('REMOVE', task('Pending')));
  assert.equal(JSON.parse(msg.MessageBody).reason, 'DELETED');
});

test('Pending -> Expired is ignored', () => {
  assert.equal(toCancellationMessage(record('MODIFY', task('Pending'), task('Expired'))), null);
});

test('deleting an Expired task is ignored', () => {
  assert.equal(toCancellationMessage(record('REMOVE', task('Expired'))), null);
});

test('INSERT is ignored', () => {
  assert.equal(toCancellationMessage(record('INSERT', undefined, task('Pending'))), null);
});

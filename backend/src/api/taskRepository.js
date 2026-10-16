import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb } from '../lib/aws.js';
import { config } from '../lib/config.js';
import { ENTITY_TYPE, keys, toPublicTask } from '../lib/tasks.js';

export { ConditionalCheckFailedException };

async function queryAll(input) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function listTasks(userId, status) {
  const items = status
    ? await queryAll({
        TableName: config.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': keys.gsi1pk(userId), ':prefix': keys.gsi1StatusPrefix(status) },
      })
    : await queryAll({
        TableName: config.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': keys.pk(userId), ':prefix': 'TASK#' },
      });
  return items.map(toPublicTask);
}

export async function getTask(userId, taskId) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: config.tableName, Key: { PK: keys.pk(userId), SK: keys.sk(taskId) } }),
  );
  return toPublicTask(Item);
}

export async function putTask(task) {
  await ddb.send(
    new PutCommand({
      TableName: config.tableName,
      Item: {
        PK: keys.pk(task.userId),
        SK: keys.sk(task.taskId),
        GSI1PK: keys.gsi1pk(task.userId),
        GSI1SK: keys.gsi1sk(task.status, task.deadline),
        entityType: ENTITY_TYPE,
        ...task,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  return task;
}

/**
 * Applies `changes` to a task, guarded by its current status so we never race
 * the expiry Lambda (e.g. completing a task at the exact moment it expires).
 * `remove` lists attributes to delete.
 */
export async function updateTask(userId, taskId, expectedStatus, changes, remove = []) {
  const names = { '#status': 'status' };
  const values = { ':expected': expectedStatus };
  const sets = [];

  Object.entries(changes).forEach(([field, value], i) => {
    names[`#f${i}`] = field;
    values[`:v${i}`] = value;
    sets.push(`#f${i} = :v${i}`);
  });
  const removes = remove.map((field, i) => {
    names[`#r${i}`] = field;
    return `#r${i}`;
  });

  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: { PK: keys.pk(userId), SK: keys.sk(taskId) },
      UpdateExpression: [`SET ${sets.join(', ')}`, removes.length ? `REMOVE ${removes.join(', ')}` : '']
        .filter(Boolean)
        .join(' '),
      ConditionExpression: 'attribute_exists(PK) AND #status = :expected',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return toPublicTask(Attributes);
}

export async function deleteTask(userId, taskId) {
  await ddb.send(
    new DeleteCommand({
      TableName: config.tableName,
      Key: { PK: keys.pk(userId), SK: keys.sk(taskId) },
      ConditionExpression: 'attribute_exists(PK)',
    }),
  );
}

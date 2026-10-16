import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

// Clients are created once per execution environment and reused across invocations.
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
export const scheduler = new SchedulerClient({});
export const sns = new SNSClient({});
export const sqs = new SQSClient({});

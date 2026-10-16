import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TABLE_NAME ??= 'test-table';
process.env.AWS_REGION ??= 'eu-central-1';
const { handler } = await import('../src/api/handler.js');

// Shape of an API Gateway REST proxy event for the /tasks/{taskId} resource.
const apiEvent = ({ method, path, resource, pathParameters, body }) => ({
  resource,
  path,
  httpMethod: method,
  headers: { 'content-type': 'application/json' },
  multiValueHeaders: { 'content-type': ['application/json'] },
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters,
  stageVariables: null,
  requestContext: {
    resourcePath: resource,
    httpMethod: method,
    path: `/dev${path}`,
    stage: 'dev',
    identity: { sourceIp: '127.0.0.1' },
    authorizer: { claims: { sub: 'user-1', email: 'user@example.com' } },
  },
  body: body ? JSON.stringify(body) : null,
  isBase64Encoded: false,
});

test('PUT /tasks/{taskId} reaches the tasks router (validation runs before any AWS call)', async () => {
  const res = await handler(
    apiEvent({
      method: 'PUT',
      path: '/tasks/abc-123',
      resource: '/tasks/{taskId}',
      pathParameters: { taskId: 'abc-123' },
      body: { status: 'Expired' }, // clients may not set Expired -> 400
    }),
    {},
  );
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.body, /Validation failed/);
});

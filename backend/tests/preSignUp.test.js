import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/functions/preSignUp.js';

test('auto-confirms and verifies email', async () => {
  const out = await handler({ request: { userAttributes: { email: 'a@b.com' } }, response: {} });
  assert.equal(out.response.autoConfirmUser, true);
  assert.equal(out.response.autoVerifyEmail, true);
});

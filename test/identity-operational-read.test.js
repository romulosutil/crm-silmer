import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdentityApiRuntime } from '../apps/api/src/identity-runtime.js';

const encodedKey = Buffer.alloc(32, 17).toString('base64url');
const environment = Object.freeze({
  APP_ORIGIN: 'https://crm.example.test',
  AUTH_THROTTLE_HMAC_KEY: encodedKey,
  IDEMPOTENCY_ENVELOPE_KEY: encodedKey,
  IDENTITY_BOOTSTRAP_TOKEN: 'bootstrap-token-with-at-least-32-characters',
});
const reachedSession = new Error('reached the session check');

/** @returns {{database: any, calls: () => number}} */
function countingDatabase() {
  let calls = 0;
  return {
    calls: () => calls,
    database: {
      query: async () => ({ rows: [] }),
      transaction: async () => {
        calls += 1;
        throw reachedSession;
      },
    },
  };
}

test('PIM-02: printing an order is an operational read like order.read', async () => {
  for (const action of ['order.print', 'order.read', 'conversation.read']) {
    const { database, calls } = countingDatabase();
    const identity = createIdentityApiRuntime(database, environment);

    await assert.rejects(
      identity.authorizeOperationalRead({ action, sessionToken: 'session' }),
      reachedSession,
      `${action} must go on to the session check`,
    );
    assert.equal(calls(), 1, action);
  }
});

test('an action that changes data is never authorized as a read', async () => {
  for (const action of [
    'order.confirm',
    'order.edit',
    'order.intent',
    'store.order.record',
    'x.read',
  ]) {
    const { database, calls } = countingDatabase();
    const identity = createIdentityApiRuntime(database, environment);

    await assert.rejects(
      identity.authorizeOperationalRead({ action, sessionToken: 'session' }),
      { code: 'FORBIDDEN' },
      action,
    );
    assert.equal(calls(), 0, `${action} must stop before the session check`);
  }
});

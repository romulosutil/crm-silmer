import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdentityApiRuntime } from '../apps/api/src/identity-runtime.js';

const encodedKey = Buffer.alloc(32, 17).toString('base64url');
const environment = Object.freeze({
  APP_ORIGIN: 'https://crm.example.test,https://admin.example.test',
  AUTH_THROTTLE_HMAC_KEY: encodedKey,
  IDEMPOTENCY_ENVELOPE_KEY: encodedKey,
  IDENTITY_BOOTSTRAP_TOKEN: 'bootstrap-token-with-at-least-32-characters',
});
const database = {
  query: async () => ({ rows: [] }),
  transaction: async () => {
    throw new Error('not used by configuration test');
  },
};

test('identity runtime fails closed on missing, weak or non-HTTPS configuration', () => {
  const invalidConfiguration =
    /** @type {Array<[string, string|undefined]>} */ ([
      ['APP_ORIGIN', undefined],
      ['APP_ORIGIN', 'http://crm.example.test'],
      ['AUTH_THROTTLE_HMAC_KEY', 'short'],
      ['IDEMPOTENCY_ENVELOPE_KEY', 'not-base64url!'.repeat(3)],
      ['IDENTITY_BOOTSTRAP_TOKEN', 'short'],
    ]);
  for (const [field, value] of invalidConfiguration) {
    assert.throws(
      () =>
        createIdentityApiRuntime(database, {
          ...environment,
          [field]: value,
        }),
      new RegExp(String(field), 'u'),
    );
  }
});

test('identity runtime normalizes and freezes the exact origin allowlist', () => {
  const runtime = createIdentityApiRuntime(database, environment);

  assert.deepEqual(runtime.allowedOrigins, [
    'https://crm.example.test',
    'https://admin.example.test',
  ]);
  assert.equal(Object.isFrozen(runtime.allowedOrigins), true);
});

test('development accepts HTTP only for loopback origins', () => {
  const runtime = createIdentityApiRuntime(database, {
    ...environment,
    APP_ENV: 'development',
    APP_ORIGIN: 'http://127.0.0.1:4173,http://localhost:4173',
  });

  assert.deepEqual(runtime.allowedOrigins, [
    'http://127.0.0.1:4173',
    'http://localhost:4173',
  ]);
  assert.throws(
    () =>
      createIdentityApiRuntime(database, {
        ...environment,
        APP_ENV: 'development',
        APP_ORIGIN: 'http://crm.example.test',
      }),
    /HTTPS/u,
  );
});

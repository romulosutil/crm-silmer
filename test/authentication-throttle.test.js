import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostgresAuthenticationThrottle } from '../modules/identity-access/src/authentication-throttle.js';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const HMAC_KEY = Buffer.alloc(32, 13);

class RecordingDatabase {
  /** @type {Array<{sql: string, values: unknown[]}>} */
  queries = [];

  /** @param {string} sql @param {unknown[]} [values] @returns {Promise<{rows: Array<Record<string, unknown>>}>} */
  async query(sql, values = []) {
    this.queries.push({ sql, values });
    return { rows: [] };
  }
}

test('locks pseudonymous subjects before checking a login attempt', async () => {
  const database = new RecordingDatabase();
  const throttle = createPostgresAuthenticationThrottle(database, {
    clock: () => NOW,
    hmacKey: HMAC_KEY,
  });

  await throttle.lock({
    email: 'admin@example.test',
    network: '203.0.113.42',
  });

  assert.equal(database.queries.length, 2);
  for (const { sql, values } of database.queries) {
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended/iu);
    assert.match(String(values[0]), /^(?:account|network):[a-f0-9]{64}$/u);
    assert.doesNotMatch(
      JSON.stringify(values),
      /admin@example\.test|203\.0\.113\.42/iu,
    );
  }
});

test('persists only pseudonymous account and network throttle keys', async () => {
  const database = new RecordingDatabase();
  const throttle = createPostgresAuthenticationThrottle(database, {
    clock: () => NOW,
    hmacKey: HMAC_KEY,
  });

  await throttle.recordFailure({
    email: ' Admin@Example.Test ',
    network: '203.0.113.42',
  });

  assert.equal(database.queries.length, 2);
  assert.deepEqual(
    database.queries.map(({ values }) => values[0]),
    ['account', 'network'],
  );
  for (const { sql, values } of database.queries) {
    assert.match(sql, /ON CONFLICT/iu);
    assert.match(String(values[1]), /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(
      JSON.stringify(values),
      /admin@example\.test|203\.0\.113\.42/iu,
    );
  }
});

test('checks both scopes and returns the longest active block without identifiers', async () => {
  const database = new RecordingDatabase();
  database.query = async (sql, values = []) => {
    database.queries.push({ sql, values });
    return {
      rows: [
        { blocked_until: new Date('2026-09-01T12:01:00.000Z') },
        { blocked_until: new Date('2026-09-01T12:05:00.000Z') },
      ],
    };
  };
  const throttle = createPostgresAuthenticationThrottle(database, {
    clock: () => NOW,
    hmacKey: HMAC_KEY,
  });

  assert.deepEqual(
    await throttle.check({
      email: 'admin@example.test',
      network: '203.0.113.42',
    }),
    { allowed: false, retryAt: '2026-09-01T12:05:00.000Z' },
  );
  assert.doesNotMatch(
    JSON.stringify(database.queries),
    /admin@example\.test|203\.0\.113\.42/iu,
  );
});

test('resets only the successful account subject', async () => {
  const database = new RecordingDatabase();
  const throttle = createPostgresAuthenticationThrottle(database, {
    clock: () => NOW,
    hmacKey: HMAC_KEY,
  });

  await throttle.resetAccount('admin@example.test');

  assert.equal(database.queries.length, 1);
  assert.match(
    database.queries[0].sql,
    /DELETE FROM crm\.authentication_throttles/iu,
  );
  assert.deepEqual(database.queries[0].values[0], 'account');
  assert.match(String(database.queries[0].values[1]), /^[a-f0-9]{64}$/u);
});

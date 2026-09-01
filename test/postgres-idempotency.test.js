import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IdempotencyConflictError,
  PostgresIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';

const ENVELOPE_KEY = Buffer.alloc(32, 7);
const identity = Object.freeze({
  action: 'order-form.approve',
  actor: 'admin-1',
  correlationId: 'correlation-1',
  fingerprint: 'a'.repeat(64),
  key: 'request-1',
  reason: 'Pagamento conferido',
  scope: 'admin-1:order-form.approve',
  target: Object.freeze({ id: 'form-1', type: 'order-form' }),
  version: 3,
});

class FakeDatabase {
  constructor() {
    /** @type {unknown[]} */
    this.effects = [];
    this.records = new Map();
  }

  /**
   * @template T
   * @param {(client: FakeDatabase) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async transaction(work) {
    const snapshot = {
      effects: structuredClone(this.effects),
      records: structuredClone(this.records),
    };
    try {
      return await work(this);
    } catch (error) {
      this.effects = snapshot.effects;
      this.records = snapshot.records;
      throw error;
    }
  }

  /** @param {string} sql @param {unknown[]} [values] */
  async query(sql, values = []) {
    if (sql.includes('INSERT INTO crm.idempotency_records')) {
      const key = recordKey(String(values[0]), String(values[1]));
      if (this.records.has(key)) return { rows: [] };
      this.records.set(key, {
        action: values[4],
        actor_id: values[3],
        correlation_id: values[9],
        fingerprint: values[2],
        idempotency_key: values[1],
        reason: values[8],
        response: null,
        scope: values[0],
        status: 'pending',
        target_id: values[6],
        target_type: values[5],
        version: values[7],
      });
      return { rows: [{ inserted: true }] };
    }
    if (sql.includes("SET status = 'completed'")) {
      const row = this.records.get(recordKey(String(values[0]), String(values[1])));
      assert.ok(row);
      row.status = 'completed';
      row.response = JSON.parse(String(values[2]));
      return { rows: [{ completed: true }] };
    }
    if (sql.includes('FROM crm.idempotency_records')) {
      const row = this.records.get(recordKey(String(values[0]), String(values[1])));
      return { rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.includes('INSERT INTO test_effects')) {
      this.effects.push(values[0]);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL in fake database: ${sql}`);
  }
}

test('encrypts the persisted response and replays it without a second effect', async () => {
  const database = new FakeDatabase();
  const store = new PostgresIdempotencyRecordStore({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  let effects = 0;

  const first = await store.execute(identity, async (client) => {
    effects += 1;
    await client.query('INSERT INTO test_effects VALUES ($1)', ['effect-1']);
    return { body: { approved: true }, secret: 'response-canary' };
  });
  const persisted = database.records.get(recordKey(identity.scope, identity.key));
  assert.ok(persisted);
  assert.equal(persisted.status, 'completed');
  assert.equal(JSON.stringify(persisted.response).includes('response-canary'), false);
  assert.deepEqual(Object.keys(persisted.response).sort(), [
    'algorithm',
    'ciphertext',
    'iv',
    'tag',
    'version',
  ]);

  const replay = await store.execute(identity, async () => {
    effects += 1;
    throw new Error('replay must not execute');
  });
  assert.deepEqual(replay, first);
  assert.notEqual(replay, first);
  assert.equal(effects, 1);
  assert.deepEqual(database.effects, ['effect-1']);

  const record = await store.get({ key: identity.key, scope: identity.scope });
  assert.deepEqual(record?.response, first);
  assert.equal(record?.fingerprint, identity.fingerprint);
});

test('binds ciphertext to scope, key and fingerprint and reports divergent replay', async () => {
  const database = new FakeDatabase();
  const store = new PostgresIdempotencyRecordStore({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  await store.execute(identity, async () => ({ ok: true }));

  await assert.rejects(
    store.execute({ ...identity, fingerprint: 'b'.repeat(64) }, async () => ({ ok: false })),
    (error) => {
      assert.ok(error instanceof IdempotencyConflictError);
      assert.equal(error.statusCode, 409);
      return true;
    },
  );

  const row = database.records.get(recordKey(identity.scope, identity.key));
  assert.ok(row);
  row.fingerprint = 'c'.repeat(64);
  await assert.rejects(
    store.get({ key: identity.key, scope: identity.scope }),
    /authentic|decrypt|unable/iu,
  );
});

test('rolls back the pending record and callback effects together', async () => {
  const database = new FakeDatabase();
  const store = new PostgresIdempotencyRecordStore({
    database,
    envelopeKey: ENVELOPE_KEY,
  });

  await assert.rejects(
    store.execute(identity, async (client) => {
      await client.query('INSERT INTO test_effects VALUES ($1)', ['rolled-back']);
      throw new Error('synthetic callback failure');
    }),
    /synthetic callback failure/iu,
  );
  assert.equal(database.records.size, 0);
  assert.deepEqual(database.effects, []);

  const retry = await store.execute(identity, async (client) => {
    await client.query('INSERT INTO test_effects VALUES ($1)', ['committed']);
    return { ok: true };
  });
  assert.deepEqual(retry, { ok: true });
  assert.deepEqual(database.effects, ['committed']);
});

/** @param {string} scope @param {string} key */
function recordKey(scope, key) {
  return `${scope}\u0000${key}`;
}

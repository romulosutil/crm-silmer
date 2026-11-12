import assert from 'node:assert/strict';
import test from 'node:test';

import { createServerApi } from '../apps/api/src/server.js';
import {
  createHealthErrorsRuntime,
  validateIncidentChange,
  validateLegacyArchive,
} from '../apps/api/src/health-errors-runtime.js';
import { authorize } from '../modules/identity-access/src/authorization.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

const quiet = createSafeLogger({ service: 'crm-silmer-api', sink: () => {} });
const allowed = {
  id: 'console-admin',
  email: 'admin@crm-silmer.local',
  functionName: /** @type {const} */ ('Vendedor'),
  capabilities: [/** @type {const} */ ('COMMERCIAL_ADMIN')],
};

test('OPS-ERR-01: only the named human administrator passes the policy', () => {
  for (const action of ['health.errors.read', 'health.errors.update']) {
    assert.doesNotThrow(() => authorize(allowed, action));
    for (const actor of [
      { ...allowed, email: 'other-admin@example.test' },
      { ...allowed, email: undefined },
      { ...allowed, capabilities: [] },
      { ...allowed, functionName: /** @type {const} */ ('Financeiro') },
      { ...allowed, kind: /** @type {const} */ ('assistant') },
    ])
      assert.throws(() => authorize(actor, action), { code: 'FORBIDDEN' });
  }
});

test('OPS-ERR-03: triage accepts only a status and a positive numeric version', () => {
  assert.deepEqual(
    validateIncidentChange({ status: 'investigating', version: 2 }),
    { status: 'investigating', version: 2 },
  );
  for (const input of [
    null,
    [],
    { status: 'retry', version: 1 },
    { status: 'new', version: '1' },
    { status: 'resolved', version: 0 },
    { status: 'new', version: 1, message: 'private' },
  ])
    assert.throws(() => validateIncidentChange(input), {
      code: 'INVALID_REQUEST',
    });
});

test('OPS-INBOX-ACK-04: legacy archive accepts only a bounded count and exact manifest fingerprint', () => {
  const input = { count: 12, fingerprint: 'a'.repeat(64) };
  assert.deepEqual(validateLegacyArchive(input), input);
  for (const candidate of [
    null,
    [],
    {},
    { ...input, count: 0 },
    { ...input, count: 101 },
    { ...input, count: '12' },
    { ...input, count: 1.5 },
    { ...input, fingerprint: 'not-a-manifest' },
    { ...input, fingerprint: 'A'.repeat(64) },
    { ...input, reason: 'private details' },
    { ...input, commandIds: ['untrusted-command'] },
  ])
    assert.throws(() => validateLegacyArchive(candidate), {
      code: 'INVALID_REQUEST',
    });
});

test('OPS-ERR-01: foreign origins, Basic, missing/duplicate cookies and CSRF stop before querying data', async () => {
  let calls = 0;
  const runtime = createHealthErrorsRuntime({
    database: {
      transaction: async () => {
        calls += 1;
        throw new Error('not reached');
      },
    },
    identity: { allowedOrigins: ['https://crm.example.test'] },
    envelopeKey: Buffer.alloc(32, 3),
  });
  for (const input of [
    { cookie: 'crm_session=test', origin: 'https://elsewhere.example.test' },
    {
      cookie: 'crm_session=test',
      origin: 'https://crm.example.test',
      authorization: 'Basic synthetic',
    },
    { origin: 'https://crm.example.test' },
    {
      cookie: 'crm_session=a; crm_session=b',
      origin: 'https://crm.example.test',
    },
    { cookie: 'crm_session=test', secFetchSite: 'cross-site' },
  ])
    await assert.rejects(runtime.list(input), (error) =>
      [400, 403].includes(/** @type {any} */ (error).statusCode),
    );
  await assert.rejects(
    runtime.change({
      origin: 'https://crm.example.test',
      cookie: 'crm_session=test; crm_csrf=a',
      csrfToken: 'b',
    }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(
    runtime.archiveLegacy({
      origin: 'https://crm.example.test',
      cookie: 'crm_session=test; crm_csrf=a',
      csrfToken: 'b',
      body: { count: 12, fingerprint: 'a'.repeat(64) },
      idempotencyKey: 'archive',
    }),
    { code: 'FORBIDDEN' },
  );
  assert.equal(calls, 0);
});

test('OPS-ERR-01: a valid cookie still needs current identity authorization before any incident query', async () => {
  /** @type {string[]} */
  const queries = [];
  const client = {
    query: async (/** @type {string} */ sql) => {
      queries.push(sql);
      return { rows: [] };
    },
  };
  const runtime = createHealthErrorsRuntime({
    database: { transaction: (/** @type {Function} */ work) => work(client) },
    identity: {
      allowedOrigins: ['https://crm.example.test'],
      authorizeHealthErrors: async () => {
        throw Object.assign(new Error('FORBIDDEN'), {
          code: 'FORBIDDEN',
          statusCode: 403,
        });
      },
    },
    envelopeKey: Buffer.alloc(32, 3),
  });
  await assert.rejects(
    runtime.list({ cookie: 'crm_session=test', secFetchSite: 'same-origin' }),
    { code: 'FORBIDDEN' },
  );
  assert.deepEqual(queries, []);
  await assert.rejects(
    runtime.archiveLegacy({
      cookie: 'crm_session=test; crm_csrf=a',
      csrfToken: 'a',
      origin: 'https://crm.example.test',
      body: { count: 12, fingerprint: 'a'.repeat(64) },
      idempotencyKey: 'archive',
    }),
    { code: 'FORBIDDEN' },
  );
  assert.equal(
    queries.some((query) =>
      /crm\.(n8n_commands|n8n_command_operational_archives)/u.test(query),
    ),
    false,
  );
});

test('OPS-ERR-04: API collection persists no exception, body, URL, foreign code or invalid trace', async () => {
  /** @type {unknown[][]} */
  const values = [];
  const client = {
    query: async (
      /** @type {string} */ sql,
      /** @type {unknown[]} */ args = [],
    ) => {
      values.push(args);
      if (sql.includes('INSERT INTO crm.operational_incidents'))
        return { rows: [{ id: 'incident', status: 'new', version: 1 }] };
      if (sql.includes('INSERT INTO crm.operational_incident_receipts'))
        return { rows: [{ event_key: 'receipt' }] };
      return { rows: [] };
    },
  };
  const runtime = createHealthErrorsRuntime({
    database: { transaction: (/** @type {Function} */ work) => work(client) },
    identity: {},
    envelopeKey: Buffer.alloc(32),
  });
  await runtime.recordApiFailure(
    /** @type {any} */ ({
      statusCode: 500,
      requestId: 'private@example.test',
      correlationId: 'customer-phone',
      error: { message: 'secret exception' },
      url: '/customer/private',
      body: 'private message',
      code: 'PRIVATE_CODE',
    }),
  );
  const serialized = JSON.stringify(values);
  assert.match(serialized, /API_5XX/u);
  assert.doesNotMatch(serialized, /private|secret|customer|PRIVATE_CODE/iu);
});

test('OPS-ERR-04/05: nginx trace bits survive intake and authorized projection without accepting free text', async () => {
  const nginx = 'ABCDEF012345FEDC0123456789ABCDEF';
  const canonical = 'abcdef01-2345-fedc-0123-456789abcdef';
  const uuid = '742351d6-a4b4-42e9-b3f8-8d84a8e002a8';
  for (const [input, expected] of [
    [nginx, canonical],
    [canonical, canonical],
    [uuid, uuid],
    [uuid.toUpperCase(), uuid],
    ['synthetic@example.test', null],
    ['+5511000000000', null],
    ['5511000000000', null],
    ['a'.repeat(31), null],
    ['a'.repeat(33), null],
    [' abcdef012345fedc0123456789abcdef', null],
    ['abcdef012345fedc0123456789abcdef ', null],
    ['abcdef01-2345-fedc0123-456789abcdef', null],
    ['', null],
    [null, null],
    [undefined, null],
    [{ toString: () => nginx }, null],
  ]) {
    /** @type {any} */
    let stored;
    const at = new Date();
    const client = {
      query: async (
        /** @type {string} */ sql,
        /** @type {unknown[]} */ args = [],
      ) => {
        if (sql.includes('INSERT INTO crm.operational_incidents')) {
          stored = {
            id: args[0],
            source: args[1],
            code: args[2],
            first_seen_at: at,
            last_seen_at: at,
            updated_at: at,
            request_id: args[4],
            correlation_id: args[5],
            status: 'new',
            version: 1,
            occurrences: 1,
          };
          return { rows: [stored] };
        }
        if (sql.includes('INSERT INTO crm.operational_incident_receipts'))
          return { rows: [{ event_key: args[0] }] };
        if (sql.startsWith('SELECT i.*')) return { rows: [stored] };
        return { rows: [] };
      },
    };
    const runtime = createHealthErrorsRuntime({
      database: { transaction: (/** @type {Function} */ work) => work(client) },
      identity: {
        allowedOrigins: [],
        authorizeHealthErrors: async () => ({ actor: allowed }),
      },
      envelopeKey: Buffer.alloc(32),
    });
    await runtime.recordApiFailure(
      /** @type {any} */ ({
        statusCode: 500,
        requestId: input,
        correlationId: input,
      }),
    );
    assert.equal(stored.request_id, expected);
    assert.equal(stored.correlation_id, expected);
    const result = await runtime.list({
      cookie: 'crm_session=synthetic',
      secFetchSite: 'same-origin',
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].requestId, expected ?? undefined);
    assert.equal(result.items[0].correlationId, expected ?? undefined);
    if (expected)
      assert.equal(
        result.items[0].requestId.replaceAll('-', ''),
        String(input).replaceAll('-', '').toLowerCase(),
      );
  }
});

test('OPS-ERR-05: API collector does not delay response, does not recurse and drains before database close', async () => {
  /** @type {() => void} */
  let release = () => {};
  let stored = false;
  let closed = false;
  /** @type {any[]} */
  const captured = [];
  const pending = new Promise(
    (/** @type {(value?: void) => void} */ resolve) => {
      release = resolve;
    },
  );
  const api = createServerApi({
    database: {
      query: async () => ({ rows: [] }),
      transaction: async (work) => work({ query: async () => ({ rows: [] }) }),
      close: async () => {
        assert.equal(stored, true);
        closed = true;
      },
    },
    environment: {},
    logger: quiet,
    healthErrors: /** @type {any} */ ({
      cleanup: async () => {},
      list: async () => {
        throw new Error('secret');
      },
      change: async () => ({}),
      recordApiFailure: async (/** @type {any} */ input) => {
        captured.push(input);
        await pending;
        stored = true;
      },
    }),
  });
  api.get('/synthetic-failure', async (_request, reply) =>
    reply.code(500).send({ error: 'synthetic' }),
  );
  try {
    const response = await api.inject('/synthetic-failure');
    assert.equal(response.statusCode, 500);
    assert.equal(stored, false);
    assert.equal(captured.length, 1);
    assert.deepEqual(Object.keys(captured[0]).sort(), [
      'correlationId',
      'readiness',
      'requestId',
      'statusCode',
    ]);
    const consoleFailure = await api.inject('/api/v1/admin/health-errors');
    assert.equal(consoleFailure.statusCode, 503);
    assert.equal(consoleFailure.headers['cache-control'], 'private, no-store');
    assert.doesNotMatch(consoleFailure.body, /secret/u);
    assert.equal(captured.length, 1);
    const closing = api.close();
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.equal(closed, false);
    release();
    await closing;
    assert.equal(closed, true);
  } finally {
    release();
    await api.close();
  }
});

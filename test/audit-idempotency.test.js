import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuditEventValidationError,
  InMemoryAuditTrail,
} from '../modules/audit-privacy/src/index.js';
import {
  IdempotencyConflictError,
  InMemoryIdempotencyRecordStore,
  createIdempotentCommandExecutor,
  fingerprintCommand,
} from '../modules/integration-reliability/src/index.js';

const commandMetadata = Object.freeze({
  actor: 'user-admin-01',
  action: 'order-form.approve',
  target: Object.freeze({ type: 'order-form', id: 'form-01' }),
  version: 7,
  reason: 'Pagamento conferido',
  correlationId: 'corr-01',
});

function createAuditTrail() {
  let sequence = 0;
  return new InMemoryAuditTrail({
    clock: () => new Date('2026-08-30T12:00:00.000Z'),
    idFactory: () => `audit-${++sequence}`,
  });
}

test('audit trail persists only the append-only business envelope', async () => {
  const auditTrail = createAuditTrail();

  const event = await auditTrail.append({
    ...commandMetadata,
    content: 'mensagem que não pode ser copiada',
    payload: { comprovante: 'não persistir' },
    token: 'não persistir',
  });

  assert.deepEqual(event, {
    id: 'audit-1',
    actor: 'user-admin-01',
    action: 'order-form.approve',
    target: { type: 'order-form', id: 'form-01' },
    version: 7,
    reason: 'Pagamento conferido',
    correlationId: 'corr-01',
    occurredAt: '2026-08-30T12:00:00.000Z',
  });
  assert.equal('content' in event, false);
  assert.equal('payload' in event, false);
  assert.equal('token' in event, false);
  assert.equal('update' in auditTrail, false);
  assert.equal('delete' in auditTrail, false);

  assert.throws(() => {
    event.target.id = 'changed';
  }, TypeError);
  assert.equal((await auditTrail.list())[0].target.id, 'form-01');
});

test('audit trail rejects an incomplete envelope before persistence', async () => {
  const auditTrail = createAuditTrail();

  await assert.rejects(
    auditTrail.append({ ...commandMetadata, reason: '' }),
    AuditEventValidationError,
  );
  assert.deepEqual(await auditTrail.list(), []);
});

test('command fingerprint is canonical and sensitive to JSON value changes', () => {
  const left = fingerprintCommand({
    orderId: 'order-01',
    options: { notify: true, attempts: 1 },
  });
  const reordered = fingerprintCommand({
    options: { attempts: 1, notify: true },
    orderId: 'order-01',
  });
  const changed = fingerprintCommand({
    options: { attempts: 2, notify: true },
    orderId: 'order-01',
  });

  assert.equal(left, reordered);
  assert.notEqual(left, changed);
  assert.match(left, /^[a-f0-9]{64}$/u);
});

test('binds domain effect and audit append to the idempotency transaction', async () => {
  const transaction = Object.freeze({ query: async () => ({ rows: [] }) });
  /** @type {unknown[]} */
  const auditContexts = [];
  const execute = createIdempotentCommandExecutor({
    auditTrail: {
      append: async (_event, context) => {
        auditContexts.push(context);
      },
    },
    idempotencyStore: {
      execute: async (_identity, operation) => operation(transaction),
    },
  });
  /** @type {unknown[]} */
  const effectTransactions = [];

  const response = await execute(
    {
      ...commandMetadata,
      key: 'idem-shared-transaction',
      command: { orderId: 'order-01', approve: true },
    },
    async (effectTransaction) => {
      effectTransactions.push(effectTransaction);
      return { status: 200, body: { approved: true } };
    },
  );

  assert.deepEqual(response, { status: 200, body: { approved: true } });
  assert.deepEqual(effectTransactions, [transaction]);
  assert.deepEqual(auditContexts, [{ transaction }]);
});

test('replay returns the original response without repeating effect or audit', async () => {
  const auditTrail = createAuditTrail();
  const idempotencyStore = new InMemoryIdempotencyRecordStore();
  const execute = createIdempotentCommandExecutor({
    auditTrail,
    idempotencyStore,
  });
  let effects = 0;
  const request = {
    ...commandMetadata,
    key: 'idem-01',
    command: { orderId: 'order-01', approve: true },
  };

  const first = await execute(request, async () => {
    effects += 1;
    return {
      status: 201,
      headers: { location: '/api/v1/orders/order-01' },
      body: { state: 'approved', version: 8 },
    };
  });
  first.body.state = 'changed-by-caller';

  const replay = await execute(request, async () => {
    effects += 1;
    throw new Error('replay must not execute the effect');
  });

  assert.deepEqual(replay, {
    status: 201,
    headers: { location: '/api/v1/orders/order-01' },
    body: { state: 'approved', version: 8 },
  });
  assert.equal(effects, 1);
  assert.equal((await auditTrail.list()).length, 1);
});

test('same key with a divergent payload returns an explicit conflict', async () => {
  const auditTrail = createAuditTrail();
  const idempotencyStore = new InMemoryIdempotencyRecordStore();
  const execute = createIdempotentCommandExecutor({
    auditTrail,
    idempotencyStore,
  });

  await execute(
    {
      ...commandMetadata,
      key: 'idem-divergent',
      command: { orderId: 'order-01', approve: true },
    },
    async () => ({ status: 200, body: { approved: true } }),
  );

  await assert.rejects(
    execute(
      {
        ...commandMetadata,
        key: 'idem-divergent',
        command: { orderId: 'order-02', approve: true },
      },
      async () => ({ status: 200, body: { approved: true } }),
    ),
    (error) => {
      assert.ok(error instanceof IdempotencyConflictError);
      assert.equal(error.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
  assert.equal((await auditTrail.list()).length, 1);
});

test('concurrent identical commands produce one effect and one audit event', async () => {
  const auditTrail = createAuditTrail();
  const idempotencyStore = new InMemoryIdempotencyRecordStore();
  const execute = createIdempotentCommandExecutor({
    auditTrail,
    idempotencyStore,
  });
  let effects = 0;
  /** @type {(value: unknown) => void} */
  let releaseEffect = (_value) => {};
  const effectMayComplete = new Promise((resolve) => {
    releaseEffect = resolve;
  });
  const request = {
    ...commandMetadata,
    key: 'idem-concurrent',
    command: { orderId: 'order-01', approve: true },
  };
  const effect = async () => {
    effects += 1;
    await effectMayComplete;
    return { status: 200, body: { approved: true } };
  };

  const first = execute(request, effect);
  const second = execute(request, effect);
  await Promise.resolve();
  assert.equal(effects, 1);
  releaseEffect(undefined);

  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.deepEqual(secondResponse, firstResponse);
  assert.notEqual(secondResponse, firstResponse);
  assert.equal(effects, 1);
  assert.equal((await auditTrail.list()).length, 1);

  const record = await idempotencyStore.get({
    scope: 'user-admin-01:order-form.approve',
    key: 'idem-concurrent',
  });
  assert.equal(record?.status, 'completed');
  assert.equal(typeof record?.fingerprint, 'string');
  assert.match(record?.fingerprint ?? '', /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    {
      actor: record?.actor,
      action: record?.action,
      target: record?.target,
      version: record?.version,
      reason: record?.reason,
      correlationId: record?.correlationId,
    },
    commandMetadata,
  );
  assert.equal(record && 'command' in record, false);
});

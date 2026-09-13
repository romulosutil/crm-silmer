import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createOrderApiRuntime,
  createOrderRuntime,
} from '../apps/api/src/order-runtime.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';

const synthetic = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

const OWNER = Object.freeze({
  capabilities: [],
  functionName: 'Vendedor',
  id: 'seller-1',
  kind: 'human',
});
const OTHER = Object.freeze({ ...OWNER, id: 'seller-2' });
const ADMIN = Object.freeze({
  ...OWNER,
  capabilities: ['COMMERCIAL_ADMIN'],
  id: 'admin-1',
});

function harness() {
  /** @type {Record<string, string|null>} */
  const assignments = {
    'conversation-1': 'seller-1',
    'conversation-unassigned': null,
  };
  /** @type {string[]} */
  const assignmentReads = [];
  const access = {
    authorizeRead: async () => ({ actor: OTHER }),
    authorizeWrite: async () => ({ actor: OWNER }),
  };
  const runtime = createOrderRuntime({
    access,
    clock: () => new Date('2026-09-12T15:00:00.000Z'),
    conversations: {
      readAssignment: async (/** @type {string} */ conversationId) => {
        assignmentReads.push(conversationId);
        return conversationId in assignments
          ? { assignedUserId: assignments[conversationId] }
          : null;
      },
      readAssignments: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, assignments[id] ?? null])),
      readOrderContext: async (/** @type {string} */ conversationId) =>
        conversationId in assignments
          ? { briefing: null, customerName: 'Cliente Sintetico' }
          : null,
      readUserNames: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, `Nome ${id}`])),
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    repository: new InMemoryOrderRepository(),
  });
  return { access, assignmentReads, assignments, runtime };
}

/** @param {any} actor @param {Record<string, unknown>} extra @returns {any} */
function command(actor, extra) {
  return { actor, correlationId: 'correlation-command', ...extra };
}

test('the conversation owner creates, edits and confirms its order', async () => {
  const { runtime } = harness();
  const created = await runtime.createManual(
    command(OWNER, { conversationId: 'conversation-1' }),
  );
  assert.equal(created.created, true);
  const edited = await runtime.patchSection(
    command(OWNER, {
      expectedVersion: created.order.version,
      orderId: created.order.id,
      section: 'items',
      value: synthetic.pedido.itens,
    }),
  );
  const confirmed = await runtime.confirm(
    command(OWNER, {
      amountText: '4.820,00',
      expectedVersion: edited.version,
      orderId: edited.id,
      paymentCondition: 'pix',
    }),
  );
  assert.equal(confirmed.status, 'confirmado');
  assert.equal(confirmed.confirmedBy, 'seller-1');
});

test('another seller is refused with 403 on every order command', async () => {
  const { runtime } = harness();
  await assert.rejects(
    runtime.createManual(command(OTHER, { conversationId: 'conversation-1' })),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
  const { order } = await runtime.createManual(
    command(OWNER, { conversationId: 'conversation-1' }),
  );
  for (const attempt of [
    () =>
      runtime.patchSection(
        command(OTHER, {
          expectedVersion: order.version,
          orderId: order.id,
          section: 'observations',
          value: [],
        }),
      ),
    () =>
      runtime.confirm(
        command(OTHER, {
          amountText: '10,00',
          expectedVersion: order.version,
          orderId: order.id,
          paymentCondition: 'pix',
        }),
      ),
    () =>
      runtime.reopen(
        command(OTHER, { expectedVersion: order.version, orderId: order.id }),
      ),
  ]) {
    await assert.rejects(attempt(), { code: 'FORBIDDEN', statusCode: 403 });
  }
  // Nobody owns an unassigned conversation, so only an admin may act on it.
  await assert.rejects(
    runtime.createManual(
      command(OWNER, { conversationId: 'conversation-unassigned' }),
    ),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
});

test('a commercial admin acts on any conversation', async () => {
  const { runtime } = harness();
  const { order } = await runtime.createManual(
    command(ADMIN, { conversationId: 'conversation-unassigned' }),
  );
  const saved = await runtime.patchSection(
    command(ADMIN, {
      expectedVersion: order.version,
      orderId: order.id,
      section: 'observations',
      value: ['Conferir arte'],
    }),
  );
  assert.deepEqual(saved.ficha.observations, ['Conferir arte']);
});

test('ownership is read from the conversation on each command', async () => {
  const { assignmentReads, assignments, runtime } = harness();
  const { order } = await runtime.createManual(
    command(OWNER, { conversationId: 'conversation-1' }),
  );
  // "Repassar atendimento": the new owner gains the order, the old one loses it.
  assignments['conversation-1'] = 'seller-2';
  await assert.rejects(
    runtime.patchSection(
      command(OWNER, {
        expectedVersion: order.version,
        orderId: order.id,
        section: 'observations',
        value: [],
      }),
    ),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
  const saved = await runtime.patchSection(
    command(OTHER, {
      expectedVersion: order.version,
      orderId: order.id,
      section: 'observations',
      value: ['Novo dono'],
    }),
  );
  assert.equal(saved.version, order.version + 1);
  assert.deepEqual(assignmentReads, [
    'conversation-1',
    'conversation-1',
    'conversation-1',
  ]);
});

test('an order command on a missing conversation is a 404', async () => {
  const { runtime } = harness();
  await assert.rejects(
    runtime.createManual(command(ADMIN, { conversationId: 'conversation-x' })),
    { code: 'CONVERSATION_NOT_FOUND', statusCode: 404 },
  );
});

test('reads need no ownership and the runtime forwards session guards', async () => {
  const { access, assignmentReads, runtime } = harness();
  const { order } = await runtime.createManual(
    command(OWNER, { conversationId: 'conversation-1' }),
  );
  assignmentReads.length = 0;
  assert.equal((await runtime.get(order.id)).order.id, order.id);
  assert.equal(
    (await runtime.currentForConversation('conversation-1')).order?.id,
    order.id,
  );
  assert.equal((await runtime.list({})).items.length, 1);
  assert.deepEqual(assignmentReads, []);
  assert.equal(runtime.authorizeRead, access.authorizeRead);
  assert.equal(runtime.authorizeWrite, access.authorizeWrite);
});

test('the automation intent reuses the pending order without ownership', async () => {
  const { assignmentReads, runtime } = harness();
  const first = await runtime.ensurePendingFromIntent({
    conversationId: 'conversation-unassigned',
    correlationId: 'correlation-intent',
  });
  const second = await runtime.ensurePendingFromIntent({
    conversationId: 'conversation-unassigned',
    correlationId: 'correlation-intent-2',
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.order.id, first.order.id);
  assert.deepEqual(assignmentReads, []);
});

test('the PostgreSQL wiring refuses incomplete configuration', () => {
  const database = {
    query: async () => ({ rows: [] }),
    transaction: async () => {},
  };
  const access = {
    authorizeRead: async () => ({ actor: OWNER }),
    authorizeWrite: async () => ({ actor: OWNER }),
  };
  const key = Buffer.alloc(32, 7).toString('base64url');
  const environment = {
    CONTACT_IDENTITY_ENVELOPE_KEY: key,
    FAB_CODE: '01',
    N8N_INTEGRATION_ENVELOPE_KEY: key,
  };
  assert.equal(
    typeof createOrderApiRuntime(database, { access, environment }).confirm,
    'function',
  );
  for (const [
    name,
    value,
    message,
  ] of /** @type {Array<[string, string|undefined, RegExp]>} */ ([
    ['FAB_CODE', undefined, /FAB_CODE is required/u],
    ['N8N_INTEGRATION_ENVELOPE_KEY', 'c2hvcnQ', /32 bytes/u],
    ['CONTACT_IDENTITY_ENVELOPE_KEY', undefined, /CONTACT_IDENTITY/u],
  ])) {
    assert.throws(
      () =>
        createOrderApiRuntime(database, {
          access,
          environment: { ...environment, [name]: value },
        }),
      message,
    );
  }
});

test('the server composes orders only when FAB_CODE is configured', async () => {
  const { createOrdersForServer } = await import('../apps/api/src/server.js');
  const database = {
    query: async () => ({ rows: [] }),
    transaction: async () => {},
  };
  const operations = {
    authorizeRead: async () => ({ actor: OWNER }),
    authorizeWrite: async () => ({ actor: OWNER }),
  };
  const key = Buffer.alloc(32, 7).toString('base64url');
  const environment = {
    CONTACT_IDENTITY_ENVELOPE_KEY: key,
    FAB_CODE: '01',
    N8N_INTEGRATION_ENVELOPE_KEY: key,
  };
  assert.equal(
    createOrdersForServer({ database, environment: {}, operations }),
    undefined,
  );
  assert.equal(
    createOrdersForServer({ database, environment, operations: undefined }),
    undefined,
  );
  const orders = createOrdersForServer({ database, environment, operations });
  assert.equal(orders?.authorizeWrite, operations.authorizeWrite);
});

test('fails fast without the ports it composes', () => {
  assert.throws(
    () =>
      createOrderRuntime(
        /** @type {any} */ ({
          access: {},
          conversations: {},
          fabCode: '01',
          repository: new InMemoryOrderRepository(),
        }),
      ),
    TypeError,
  );
});

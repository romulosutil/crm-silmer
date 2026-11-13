import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../apps/api/src/app.js';
import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
import { InMemoryOrderRepository } from '../modules/orders/src/index.js';
import { InMemoryIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
import { orderContextsFrom } from './fixtures/order-contexts.js';

/** @type {{id:string,kind:string,functionName:string,capabilities:string[]}} */
const OWNER = {
  id: 'receipt-seller',
  kind: 'human',
  functionName: 'Vendedor',
  capabilities: [],
};
const ADMIN = {
  ...OWNER,
  id: 'receipt-admin',
  capabilities: ['COMMERCIAL_ADMIN'],
};
const headers = {
  cookie: 'crm_session=synthetic-receipt',
  origin: 'https://crm.example.test',
};

async function harness() {
  const state = {
    actor: { ...OWNER },
    active: true,
    auditFailure: false,
    renderFailure: false,
    customer: 'Cliente Sintético',
    seller: 'Vendedor exemplo',
    /** @type {string|null} */ assignment: OWNER.id,
    /** @type {Record<string,any>} */ patch: {},
    /** @type {any[]} */ audits: [],
    /** @type {any[]} */ guards: [],
    /** @type {string[]} */ rendered: [],
    /** @type {()=>void|Promise<void>} */ duringRender: () => {},
  };
  const repository = new InMemoryOrderRepository();
  const find = repository.findById.bind(repository);
  repository.findById = async (id) => {
    const order = await find(id);
    return order ? { ...order, ...structuredClone(state.patch) } : null;
  };
  const runtime = createOrderRuntime({
    access: {
      authorizeRead: async (input) => {
        state.guards.push(input);
        if (!input.cookie)
          throw Object.assign(new Error('session'), {
            statusCode: 401,
            code: 'INVALID_CREDENTIALS',
          });
        if (
          !state.active ||
          state.actor.kind !== 'human' ||
          state.actor.functionName !== 'Vendedor'
        )
          throw Object.assign(new Error('access'), {
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        return { actor: structuredClone(state.actor) };
      },
      authorizeWrite: async () => ({ actor: OWNER }),
    },
    auditTrail: {
      append: async (/** @type {any} */ event) => {
        if (state.auditFailure) throw new Error('PRIVATE-audit-detail');
        state.audits.push(event);
      },
    },
    clock: () => new Date('2026-11-12T18:00:00Z'),
    conversations: {
      readAssignment: async () => ({
        assignedUserId: state.assignment,
        version: 1,
      }),
      readAssignments: async (ids) =>
        new Map(ids.map((id) => [id, state.assignment])),
      readLatestMessageStates: async () => new Map(),
      readOrderContexts: orderContextsFrom(() => ({
        briefing: null,
        customerName: state.customer,
      })),
      readContactNames: async (ids) =>
        new Map(ids.map((id) => [id, state.customer])),
      readUserNames: async (ids) =>
        new Map(ids.map((id) => [id, state.seller])),
      searchConversationIds: async () => [],
      searchContactIds: async () => [],
    },
    fabCode: '01',
    repository,
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
  });
  const order = await runtime.createForContact({
    actor: OWNER,
    contactId: 'synthetic-contact',
    correlationId: 'synthetic-receipt',
    idempotencyKey: 'synthetic-create',
  });
  state.audits.length = 0;
  const api = createApi(
    {},
    {
      orders: runtime,
      orderPdfRenderer: async (html) => {
        state.rendered.push(html);
        await state.duringRender();
        if (state.renderFailure) throw new Error('PRIVATE-render-detail');
        return Buffer.from('%PDF-1.4\nsynthetic receipt\n');
      },
    },
  );
  const base = `/api/v1/orders/${order.id}/receipt`;
  const preview = () => api.inject({ method: 'GET', url: base, headers });
  /** @param {any} proof @param {string} [method] */
  const download = (proof, method = 'GET') =>
    api.inject({
      method: /** @type {'GET'|'HEAD'} */ (method),
      url: `${base}/pdf?expectedVersion=${proof.receipt.version}&fingerprint=${proof.fingerprint}`,
      headers,
    });
  return { api, state, runtime, repository, order, base, preview, download };
}

test('RCP-06/10: owner previews a private allowlisted document and download audits without changing the order', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  const before = await h.repository.findById(h.order.id);
  const response = await h.preview();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  const proof = response.json();
  assert.equal(proof.receipt.schema, 'order-receipt-v1');
  assert.equal(proof.receipt.status, 'pendente');
  assert.equal(proof.receipt.customerName, 'Cliente Sintético');
  assert.match(proof.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(h.state.audits.length, 0);
  const pdf = await h.download(proof);
  assert.equal(pdf.statusCode, 200);
  assert.match(String(pdf.headers['content-type']), /application\/pdf/u);
  assert.equal(pdf.headers['cache-control'], 'private, no-store');
  assert.match(
    String(pdf.headers['content-disposition']),
    /recibo-01-CRM-provisorio\.pdf/u,
  );
  assert.match(pdf.body, /^%PDF/u);
  assert.match(h.state.rendered[0], /Recibo do pedido/u);
  assert.equal(h.state.audits.length, 1);
  assert.deepEqual(
    { ...h.state.audits[0], correlationId: 'context' },
    {
      action: 'order.receipt.download',
      actor: OWNER.id,
      correlationId: 'context',
      reason: 'order.receipt.download',
      target: { id: h.order.id, type: 'order' },
      version: h.order.version,
    },
  );
  assert.doesNotMatch(
    JSON.stringify(h.state.audits),
    /Cliente|Vendedor exemplo|PRIVATE-|subtotal|freight|payment/u,
  );
  assert.deepEqual(await h.repository.findById(h.order.id), before);
  assert.ok(h.state.guards.every((input) => input.action === 'order.read'));
});

test('RCP-08: direct preview/PDF refuse other sellers, Financeiro, automation, missing sessions and revoked sessions', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  const proof = (await h.preview()).json();
  for (const actor of [
    { ...OWNER, id: 'other', olistEnabled: true },
    { ...ADMIN, functionName: 'Financeiro' },
    { ...OWNER, kind: 'automation' },
  ]) {
    h.state.actor = actor;
    assert.equal((await h.preview()).statusCode, 403);
    assert.equal((await h.download(proof)).statusCode, 403);
  }
  h.state.actor = OWNER;
  for (const path of [
    h.base,
    `${h.base}/pdf?expectedVersion=${proof.receipt.version}&fingerprint=${proof.fingerprint}`,
  ]) {
    assert.equal(
      (await h.api.inject({ method: 'GET', url: path })).statusCode,
      401,
    );
  }
  h.state.active = false;
  assert.equal((await h.preview()).statusCode, 403);
  assert.equal((await h.download(proof)).statusCode, 403);
  assert.equal(h.state.rendered.length, 0);
  assert.equal(h.state.audits.length, 0);
});

test('RCP-08: receipt availability follows current owner/Admin; store and unowned orders require Admin', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  assert.equal(
    (await h.runtime.get(h.order.id, OWNER)).order.receiptAvailable,
    true,
  );
  assert.equal(
    (await h.runtime.get(h.order.id, { ...OWNER, id: 'other' })).order
      .receiptAvailable,
    false,
  );
  for (const patch of [
    { manualOwnerId: null },
    {
      origin: 'loja',
      manualOwnerId: null,
      status: 'confirmado',
      finalAmountCents: 10000,
    },
  ]) {
    h.state.patch = patch;
    h.state.actor = OWNER;
    assert.equal((await h.preview()).statusCode, 403);
    h.state.actor = ADMIN;
    const proof = (await h.preview()).json();
    assert.equal((await h.download(proof)).statusCode, 200);
    assert.equal(
      (await h.repository.findById(h.order.id))?.fichaFirstPrintedAt,
      null,
    );
  }
  assert.ok(
    h.state.audits.every((event) => event.action === 'order.receipt.download'),
  );
});

test('RCP-08: conversation transfer revokes the former seller and unassigned conversations require Admin', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  h.state.patch = {
    conversationId: 'synthetic-conversation',
    manualOwnerId: null,
  };
  const proof = (await h.preview()).json();
  assert.equal(proof.receipt.orderId, h.order.id);
  h.state.assignment = 'new-owner';
  assert.equal((await h.download(proof)).statusCode, 403);
  assert.equal((await h.preview()).statusCode, 403);
  h.state.actor = { ...OWNER, id: 'new-owner' };
  assert.equal((await h.preview()).statusCode, 200);
  h.state.assignment = null;
  assert.equal((await h.preview()).statusCode, 403);
  h.state.actor = ADMIN;
  assert.equal((await h.preview()).statusCode, 200);
  assert.equal(h.state.audits.length, 0);
});

test('RCP-07: a proof from another order cannot select or render the target document', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  const proof = (await h.preview()).json();
  const other = await h.runtime.createForContact({
    actor: OWNER,
    contactId: 'synthetic-contact',
    correlationId: 'synthetic-second',
    idempotencyKey: 'synthetic-second',
  });
  const response = await h.api.inject({
    method: 'GET',
    headers,
    url: `/api/v1/orders/${other.id}/receipt/pdf?expectedVersion=${other.version}&fingerprint=${proof.fingerprint}`,
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'RECEIPT_STALE');
  assert.equal(h.state.rendered.length, 0);
});

test('RCP-03/06: confirmed and cancelled PDFs have distinct filenames without confirming, printing or paying', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  for (const cancelled of [false, true]) {
    h.state.patch = {
      status: 'confirmado',
      cancelledAt: cancelled ? '2026-11-12T17:00:00Z' : null,
    };
    const proof = (await h.preview()).json();
    assert.equal(proof.receipt.status, cancelled ? 'cancelado' : 'confirmado');
    const pdf = await h.download(proof);
    assert.equal(pdf.statusCode, 200);
    assert.match(
      String(pdf.headers['content-disposition']),
      cancelled ? /recibo-01-CRM-cancelado.pdf/u : /recibo-01-CRM.pdf/u,
    );
  }
  const saved = await h.repository.findById(h.order.id);
  assert.equal(saved?.paidOn, null);
  assert.equal(saved?.fichaFirstPrintedAt, null);
  assert.equal(saved?.version, h.order.version);
});

test('RCP-07: version and non-versioned customer/seller changes invalidate the preview before rendering', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  for (const change of [
    () => {
      h.state.patch.version = 2;
    },
    () => {
      h.state.customer += ' alterado';
    },
    () => {
      h.state.seller += ' alterado';
    },
  ]) {
    const proof = (await h.preview()).json();
    change();
    const rejected = await h.download(proof);
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.json().error.code, 'RECEIPT_STALE');
    assert.equal(rejected.headers['content-disposition'], undefined);
  }
  assert.equal(h.state.rendered.length, 0);
  assert.equal(h.state.audits.length, 0);
});

test('RCP-07/08: content, ownership or session changes during rendering discard the prepared PDF', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  const cases = [
    {
      status: 409,
      change: () => {
        h.state.patch.version = 2;
      },
    },
    {
      status: 409,
      change: () => {
        h.state.seller += ' novo';
      },
    },
    {
      status: 403,
      change: () => {
        h.state.patch.manualOwnerId = 'other';
      },
    },
    {
      status: 403,
      change: () => {
        h.state.active = false;
      },
    },
  ];
  for (const scenario of cases) {
    h.state.patch = {};
    h.state.active = true;
    const proof = (await h.preview()).json();
    h.state.duringRender = scenario.change;
    const rejected = await h.download(proof);
    assert.equal(rejected.statusCode, scenario.status);
    assert.equal(rejected.headers['content-disposition'], undefined);
    assert.doesNotMatch(rejected.body, /%PDF|PRIVATE-|Cliente/u);
  }
  assert.equal(h.state.audits.length, 0);
});

test('RCP-09/10: renderer or audit failures return sanitized 503 and never send the prepared PDF', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  const proof = (await h.preview()).json();
  for (const where of ['renderFailure', 'auditFailure']) {
    h.state.renderFailure = where === 'renderFailure';
    h.state.auditFailure = where === 'auditFailure';
    const rejected = await h.download(proof);
    assert.equal(rejected.statusCode, 503);
    assert.deepEqual(rejected.json(), {
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    assert.equal(rejected.headers['content-disposition'], undefined);
  }
  assert.equal(h.state.audits.length, 0);
  h.state.auditFailure = false;
  assert.equal((await h.download(proof)).statusCode, 200);
});

test('RCP-06/10: HEAD validates proof but does not render or audit; malformed proof and missing orders fail closed', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  const proof = (await h.preview()).json();
  const head = await h.download(proof, 'HEAD');
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
  for (const path of [
    h.base + '?html=anything',
    h.base + '/pdf',
    h.base + '/pdf?expectedVersion=0&fingerprint=' + proof.fingerprint,
    h.base + '/pdf?expectedVersion=1&fingerprint=invalid',
    h.base +
      '/pdf?expectedVersion=1&fingerprint=' +
      proof.fingerprint +
      '&total=1',
  ]) {
    assert.equal(
      (await h.api.inject({ method: 'GET', url: path, headers })).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await h.api.inject({
        method: 'GET',
        url: '/api/v1/orders/missing/receipt',
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await h.download({ receipt: proof.receipt, fingerprint: '0'.repeat(64) }))
      .statusCode,
    409,
  );
  assert.equal(h.state.rendered.length, 0);
  assert.equal(h.state.audits.length, 0);
});

test('RCP-09: PDF generation is rate-limited independently of production ficha routes', async (t) => {
  const h = await harness();
  t.after(() => h.api.close());
  const proof = (await h.preview()).json();
  for (let i = 0; i < 10; i++)
    assert.equal((await h.download(proof)).statusCode, 200);
  const refused = await h.download(proof);
  assert.equal(refused.statusCode, 429);
  assert.equal(refused.headers['cache-control'], 'private, no-store');
  assert.equal(h.state.rendered.length, 10);
});

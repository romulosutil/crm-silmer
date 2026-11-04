import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLongitudinalCrmClient,
  sentinelItems,
  validateSyntheticManifest,
} from '../scripts/ux-longitudinal-crm.mjs';
import { validateItems } from '../modules/orders/src/domain/ficha.js';

/** @returns {Record<string, any>} */
function manifest() {
  return {
    run_id: 'synthetic-ux-001',
    contacts: [
      {
        id_cliente: 'synthetic-ux-001-client-001',
        wa_id: '5500000000001',
        contact_id: 'synthetic-contact-001',
        conversation_id: 'synthetic-conversation-001',
        orders: {},
      },
    ],
  };
}
const auth = { cookie: 'crm_session=synthetic-cookie', csrf: 'synthetic-csrf' };

/** @returns {Record<string, any>} */
function liveScope() {
  return {
    contact: { id: 'synthetic-contact-001', version: 1, phone: null },
    identities: [{ channel: 'whatsapp', externalId: '+5500000000001' }],
    conversations: [{ id: 'synthetic-conversation-001', version: 4 }],
  };
}

function harness() {
  const input = manifest();
  /** @type {Array<{url: URL, init: RequestInit, body: any}>} */
  const calls = [];
  /** @type {Map<string, any>} */
  const orders = new Map();
  /** @type {Array<Record<string, any>>} */
  const subjects = [];
  /** @type {string|null} */
  let phone = null;
  let checkpoints = 0;
  /** @type {typeof fetch} */
  const fakeFetch = async (target, init = {}) => {
    const url = new URL(String(target));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, init, body });
    const method = init.method ?? 'GET';
    let data;
    if (
      url.pathname === '/api/v1/contacts/synthetic-contact-001' &&
      method === 'GET'
    ) {
      data = liveScope();
      data.contact.phone = phone;
    } else if (url.pathname.endsWith('/details')) {
      phone = body.phone;
      data = { contact: { id: 'synthetic-contact-001', version: 2 } };
    } else if (url.pathname === '/api/v1/orders' && method === 'POST') {
      const id = `synthetic-order-${orders.size + 1}`;
      data = {
        order: {
          id,
          number: `${orders.size + 1}-CRM`,
          origin: 'atendimento',
          conversationId: null,
          status: 'pendente',
          version: 1,
          ficha: { items: [] },
          totalPieces: 0,
        },
      };
      orders.set(id, data.order);
    } else if (url.pathname.endsWith('/sections/items')) {
      const id = url.pathname.split('/')[4];
      const prior = orders.get(id);
      assert.equal(body.expectedVersion, prior.version);
      const order = {
        ...prior,
        version: prior.version + 1,
        ficha: { items: validateItems(body.value) },
        totalPieces: body.value
          .flatMap((/** @type {any} */ item) => item.grade)
          .reduce(
            (/** @type {number} */ sum, /** @type {any} */ line) =>
              sum + line.quantidade,
            0,
          ),
      };
      orders.set(id, order);
      data = { order };
    } else if (/\/api\/v1\/orders\/synthetic-order-[12]$/u.test(url.pathname)) {
      data = { order: orders.get(url.pathname.split('/').at(-1) ?? '') };
    } else if (url.pathname.endsWith('/subjects')) {
      if (method === 'GET')
        data = {
          subjects: structuredClone(subjects),
          orders: [...orders.values()].map((order) => ({
            id: order.id,
            number: order.number,
          })),
        };
      else {
        assert.equal(body.select, false);
        const subject = {
          id: `synthetic-subject-${subjects.length + 1}`,
          orderId: body.orderId,
        };
        subjects.push(subject);
        data = subject;
      }
    } else if (url.pathname.endsWith('/close')) {
      data = { accepted: true, version: body.expectedVersion + 1 };
    } else if (url.pathname.endsWith('/synthetic-conversation-001')) {
      data = { conversation: { id: 'synthetic-conversation-001', version: 4 } };
    } else throw new Error('UNEXPECTED_FAKE_HTTP');
    return new globalThis.Response(JSON.stringify(data), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createLongitudinalCrmClient({
    manifest: input,
    auth,
    origin: 'https://crm.example.test',
    fetchImpl: fakeFetch,
    checkpoint: async (value) => {
      assert.equal(value, input);
      assert.doesNotMatch(
        JSON.stringify(value),
        /synthetic-cookie|synthetic-csrf/u,
      );
      checkpoints += 1;
    },
  });
  return {
    client,
    input,
    calls,
    orders,
    subjects,
    checkpoints: () => checkpoints,
  };
}

test('CP-T04: human fixtures create two separate pending sentinel orders through REST', async () => {
  const h = harness();
  await h.client.ensureSyntheticContactPhone('synthetic-contact-001');
  for (const ref of /** @type {Array<'A'|'B'>} */ (['A', 'B'])) {
    await h.client.createManualOrder('synthetic-contact-001', ref);
    await h.client.fillSentinel('synthetic-contact-001', ref);
  }
  await h.client.linkOrdersToConversation('synthetic-contact-001', {
    select: false,
  });
  const snapshot = await h.client.snapshotOrders('synthetic-contact-001');
  assert.notEqual(snapshot.orders.A.id, snapshot.orders.B.id);
  assert.equal(snapshot.orders.A.totalPieces, 18);
  assert.equal(snapshot.orders.B.totalPieces, 7);
  assert.equal(snapshot.orders.A.ficha.items[0].cor, 'AZUL');
  assert.equal(snapshot.orders.B.ficha.items[0].cor, 'VERDE');
  assert.deepEqual(snapshot.orders.B.ficha.items[0].malhas, ['PIQUET']);
  assert.equal(h.subjects.length, 2);
  assert.equal(
    h.calls.filter(
      (call) => call.url.pathname === '/api/v1/contacts/synthetic-contact-001',
    ).length,
    1,
  );
  assert.ok(h.checkpoints() >= 5);
  for (const call of h.calls) {
    const headers = /** @type {Record<string, string>} */ (call.init.headers);
    assert.equal(headers.origin, 'https://crm.example.test');
    assert.equal(headers['sec-fetch-site'], 'same-origin');
    assert.equal(headers.cookie, auth.cookie);
    assert.equal(call.init.redirect, 'error');
    assert.equal(headers.authorization, undefined);
    if (call.init.method !== 'GET') {
      assert.equal(headers['x-csrf-token'], auth.csrf);
      assert.match(headers['idempotency-key'], /^ux-[a-f0-9]{64}$/u);
    }
  }
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /synthetic-cookie|synthetic-csrf/u,
  );
});

test('CP-T04: foreign contact and order IDs are refused before network access', async () => {
  const h = harness();
  await assert.rejects(
    h.client.createManualOrder('real-contact'),
    /CONTACT_OUTSIDE_SYNTHETIC_MANIFEST/u,
  );
  await assert.rejects(
    h.client.snapshotOrders('real-contact'),
    /CONTACT_OUTSIDE_SYNTHETIC_MANIFEST/u,
  );
  await assert.rejects(
    h.client.closeSyntheticConversation('real-contact', 1),
    /CONTACT_OUTSIDE_SYNTHETIC_MANIFEST/u,
  );
  h.input.contacts[0].orders.A = 'synthetic-order-1';
  await assert.rejects(
    h.client.linkOrdersToConversation('synthetic-contact-001', {
      A: 'unregistered-order',
    }),
    /ORDER_OUTSIDE_SYNTHETIC_MANIFEST/u,
  );
  assert.equal(h.calls.length, 0);
});

test('CP-T04: prepared fixtures are not reset after the agent changes their contents', async () => {
  const h = harness();
  await h.client.createManualOrder('synthetic-contact-001', 'A');
  await h.client.fillSentinel('synthetic-contact-001', 'A');
  const stored = h.orders.get('synthetic-order-1');
  stored.ficha.items[0].cor = 'VERMELHO';
  const patches = h.calls.filter((call) => call.init.method === 'PATCH').length;
  const result = await h.client.fillSentinel('synthetic-contact-001', 'A');
  assert.equal(result.ficha.items[0].cor, 'VERMELHO');
  assert.equal(
    h.calls.filter((call) => call.init.method === 'PATCH').length,
    patches,
  );
  await h.client.createManualOrder('synthetic-contact-001', 'A');
  assert.equal(h.orders.size, 1);
});

test('CP-T04: fixture setup refuses overwriting preexisting items or choosing an active subject', async () => {
  const h = harness();
  await h.client.createManualOrder('synthetic-contact-001', 'A');
  h.orders.get('synthetic-order-1').ficha.items = sentinelItems('B');
  await assert.rejects(
    h.client.fillSentinel('synthetic-contact-001', 'A'),
    /SENTINEL_ALREADY_HAS_ITEMS/u,
  );
  await assert.rejects(
    h.client.linkOrdersToConversation('synthetic-contact-001', {
      select: true,
    }),
    /AUTOMATIC_SELECTION_FORBIDDEN/u,
  );
  assert.equal(
    h.calls.some((call) => call.init.method === 'PATCH'),
    false,
  );
});

test('CP-T04: linking is replay-safe and close uses the explicit conversation version', async () => {
  const h = harness();
  await h.client.createManualOrder('synthetic-contact-001', 'A');
  await h.client.linkOrdersToConversation('synthetic-contact-001');
  await h.client.linkOrdersToConversation('synthetic-contact-001');
  assert.equal(h.subjects.length, 1);
  assert.equal(await h.client.conversationVersion('synthetic-contact-001'), 4);
  await h.client.closeSyntheticConversation('synthetic-contact-001', 4);
  const close = h.calls.at(-1);
  assert.deepEqual(close?.body, {
    expectedVersion: 4,
    outcome: 'concluido',
    acknowledgePending: true,
  });
  await assert.rejects(
    h.client.closeSyntheticConversation('synthetic-contact-001', 0),
    /CONVERSATION_VERSION_REQUIRED/u,
  );
});

test('CP-T04: shared production host requires an explicit environment override', () => {
  assert.throws(
    () => createLongitudinalCrmClient({ manifest: manifest(), auth }),
    /SHARED_ENVIRONMENT_REQUIRES_EXPLICIT_OVERRIDE/u,
  );
  assert.doesNotThrow(() =>
    createLongitudinalCrmClient({
      manifest: manifest(),
      auth,
      allowSharedEnvironment: true,
    }),
  );
});

test('CP-T04: invalid scopes and auth embedded in a manifest are refused', () => {
  for (const mutate of [
    (/** @type {Record<string, any>} */ value) => {
      value.cookie = 'secret';
    },
    (/** @type {Record<string, any>} */ value) => {
      value.contacts[0].orders.A = { id: 'id', token: 'secret' };
    },
    (/** @type {Record<string, any>} */ value) => {
      value.contacts[0].wa_id = '5511999999999';
    },
    (/** @type {Record<string, any>} */ value) => {
      value.contacts.push(structuredClone(value.contacts[0]));
    },
  ]) {
    const value = manifest();
    mutate(value);
    assert.throws(() => validateSyntheticManifest(value));
  }
  assert.throws(
    () =>
      createLongitudinalCrmClient({
        manifest: manifest(),
        auth: {},
        origin: 'https://crm.example.test',
      }),
    /HUMAN_SESSION_REQUIRED/u,
  );
  assert.throws(
    () =>
      createLongitudinalCrmClient({
        manifest: manifest(),
        auth,
        origin: 'https://user:password@crm.example.test',
      }),
    /INVALID_CRM_ORIGIN/u,
  );
  assert.throws(
    () =>
      createLongitudinalCrmClient({
        manifest: manifest(),
        auth,
        origin: 'http://crm.example.test',
      }),
    /INVALID_CRM_ORIGIN/u,
  );
  const duplicateOrder = manifest();
  duplicateOrder.contacts[0].orders = { A: 'same-order', B: 'same-order' };
  assert.throws(
    () => validateSyntheticManifest(duplicateOrder),
    /DUPLICATE_SYNTHETIC_ORDER/u,
  );
});

test('CP-T04: API failures do not expose body text, cookies or CSRF values', async () => {
  const client = createLongitudinalCrmClient({
    manifest: manifest(),
    auth,
    origin: 'https://crm.example.test',
    fetchImpl: async () =>
      new globalThis.Response(
        JSON.stringify({
          error: { message: 'synthetic-cookie synthetic-csrf' },
        }),
        { status: 403 },
      ),
  });
  await assert.rejects(
    client.createManualOrder('synthetic-contact-001'),
    (error) => {
      assert.equal(/** @type {Error} */ (error).message, 'CRM_REQUEST_FAILED');
      assert.doesNotMatch(
        JSON.stringify(error),
        /synthetic-cookie|synthetic-csrf/u,
      );
      return true;
    },
  );
});

test('CP-T04: mismatched order contact returned by the API cannot enter the manifest', async () => {
  const input = manifest();
  const client = createLongitudinalCrmClient({
    manifest: input,
    auth,
    origin: 'https://crm.example.test',
    fetchImpl: async (url) =>
      new globalThis.Response(
        JSON.stringify({
          ...(String(url).includes('/contacts/')
            ? liveScope()
            : {
                order: {
                  id: 'foreign-order',
                  contactId: 'other-contact',
                  status: 'pendente',
                },
              }),
        }),
        { status: 201 },
      ),
  });
  await assert.rejects(
    client.createManualOrder('synthetic-contact-001'),
    /ORDER_CONTACT_MISMATCH/u,
  );
  assert.deepEqual(input.contacts[0].orders, {});
});

test('CP-T04: a manifest referencing a live non-synthetic person fails identity proof before any write', async () => {
  const input = manifest();
  let writes = 0;
  const client = createLongitudinalCrmClient({
    manifest: input,
    auth,
    origin: 'https://crm.example.test',
    fetchImpl: async (_url, init = {}) => {
      if (init.method !== 'GET') writes += 1;
      const data = liveScope();
      data.identities[0].externalId = '+5511999999999';
      return new globalThis.Response(JSON.stringify(data), { status: 200 });
    },
  });
  for (const action of [
    () => client.createManualOrder('synthetic-contact-001'),
    () => client.ensureSyntheticContactPhone('synthetic-contact-001'),
    () => client.closeSyntheticConversation('synthetic-contact-001', 4),
    () => client.snapshotOrders('synthetic-contact-001'),
  ]) {
    await assert.rejects(action(), /SYNTHETIC_LIVE_IDENTITY_MISMATCH/u);
  }
  assert.equal(writes, 0);
});

test('CP-T04: an order DTO without contactId needs independent live membership proof', async () => {
  const input = manifest();
  input.contacts[0].orders.A = 'synthetic-order-1';
  const client = createLongitudinalCrmClient({
    manifest: input,
    auth,
    origin: 'https://crm.example.test',
    fetchImpl: async (target) => {
      const path = new URL(String(target)).pathname;
      const data = path.includes('/contacts/')
        ? liveScope()
        : path.endsWith('/subjects')
          ? { subjects: [], orders: [] }
          : {
              order: {
                id: 'synthetic-order-1',
                version: 1,
                status: 'pendente',
                ficha: { items: [] },
              },
            };
      return new globalThis.Response(JSON.stringify(data), { status: 200 });
    },
  });
  await assert.rejects(
    client.snapshotOrders('synthetic-contact-001'),
    /ORDER_MEMBERSHIP_UNPROVEN/u,
  );
});

test('CP-T04: a different conversation is not admitted by a cached proof for the old cycle', async () => {
  const h = harness();
  await h.client.createManualOrder('synthetic-contact-001');
  h.input.contacts[0].conversation_id = 'synthetic-conversation-foreign';
  const writes = h.calls.filter((call) => call.init.method !== 'GET').length;
  await assert.rejects(
    h.client.closeSyntheticConversation('synthetic-contact-001', 4),
    /SYNTHETIC_LIVE_CONVERSATION_MISMATCH/u,
  );
  assert.equal(
    h.calls.filter((call) => call.init.method !== 'GET').length,
    writes,
  );
});

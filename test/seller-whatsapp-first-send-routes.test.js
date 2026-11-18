import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApi } from '../apps/api/src/app.js';
import { createServerApi } from '../apps/api/src/server.js';
import {
  createSellerWhatsAppFirstSendRuntime,
  sellerWhatsAppFirstSendConfiguration,
} from '../apps/api/src/seller-whatsapp-first-send-runtime.js';
import { authorize } from '../modules/identity-access/src/authorization.js';
import { encryptContactDetails } from '../modules/contacts/src/index.js';
import { encryptJson } from '../modules/n8n-integration/src/index.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

// WAP-E10 / WAP-T04-03 (WAP-22/23/24/32): HTTP contract and fail-closed guard.
const logger = createSafeLogger({ service: 'crm-silmer-api', sink: () => {} });
const key = Buffer.alloc(32, 41);
const seller = 'wap-e10-seller';
const contactId = 'contact-wap-e10';
const preview = `/api/v1/contacts/${contactId}/whatsapp/first-message-preview`;
const send = `/api/v1/contacts/${contactId}/whatsapp/conversations`;
const headers = {
  cookie: 'crm_session=synthetic',
  origin: 'https://crm.test',
  'x-csrf-token': 'synthetic-csrf',
  'idempotency-key': randomUUID(),
};
const body = {
  text: '  Olá, sintético  ',
  expectedContactVersion: 1,
  expectedLinkVersion: 1,
  expectedLineVersion: 1,
  expectedGeneration: 1,
  expectedConversation: null,
};
const ids = JSON.stringify([seller]);
const environment = {
  SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true',
  SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: ids,
  SELLER_WHATSAPP_SEND_ENABLED: 'true',
  SELLER_WHATSAPP_SEND_SELLER_IDS: ids,
  SELLER_CLIENTS_ENABLED: 'true',
  SELLER_CLIENTS_SELLER_IDS: ids,
  SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
  SELLER_WHATSAPP_INBOUND_SELLER_IDS: ids,
  CONTACT_IDENTITY_ENVELOPE_KEY: key.toString('base64'),
  CONTACT_IDENTITY_LOOKUP_KEY: key.toString('base64'),
  INBOX_MESSAGE_ENVELOPE_KEY: key.toString('base64'),
  IDEMPOTENCY_ENVELOPE_KEY: key.toString('base64'),
};

/** @param {{actor?:any,calls?:string[]}} [options] */
function access({ actor = { id: seller, kind: 'human' }, calls = [] } = {}) {
  /** @param {any} input */
  const check = async (input) => {
    calls.push(input.action);
    if (input.cookie !== headers.cookie)
      throw Object.assign(new Error('FORBIDDEN'), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    if (
      input.action === 'contact.whatsapp.first_send' &&
      input.csrfToken !== headers['x-csrf-token']
    )
      throw Object.assign(new Error('FORBIDDEN'), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    return { actor };
  };
  return { authorizeRead: check, authorizeWrite: check };
}

/** A database that refuses any use: guard and body errors never reach it. */
const untouched = {
  query: () => assert.fail('No query before validation'),
  transaction: () => assert.fail('No transaction before validation'),
};
const outbox = { enqueueChannelMessage: () => assert.fail('No enqueue') };

/** @param {any} runtime */
async function api(runtime) {
  const app = createApi({}, { logger, sellerWhatsAppFirstSend: runtime });
  await app.ready();
  return app;
}

/** @param {any} response @param {number} status @param {string} code */
function problem(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  assert.match(String(response.headers['content-type']), /problem\+json/u);
  assert.match(String(response.headers['cache-control']), /private, no-store/u);
  assert.deepEqual(response.json(), {
    type: 'about:blank',
    title: code,
    status,
    code,
  });
}

test('WAP-E10 guard is default off, explicit and validated at startup', () => {
  assert.deepEqual([...sellerWhatsAppFirstSendConfiguration({}).sellers], []);
  assert.equal(sellerWhatsAppFirstSendConfiguration({}).enabled, false);
  for (const invalid of [
    { SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'yes' },
    { SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true' },
    {
      SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true',
      SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: '[]',
    },
    { SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: 'not-json' },
    { SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: '{"id":"a"}' },
    { SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: '["a","a"]' },
    { SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: '["a b"]' },
    {
      SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: JSON.stringify(['x'.repeat(129)]),
    },
  ])
    assert.throws(
      () => sellerWhatsAppFirstSendConfiguration(invalid),
      TypeError,
    );
  const disabled = sellerWhatsAppFirstSendConfiguration({
    SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'false',
    SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: ids,
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.sellers.size, 0);
  assert.throws(
    () =>
      createServerApi({
        logger,
        environment: { SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true' },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createServerApi({
        logger,
        environment: {
          SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true',
          SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: ids,
        },
      }),
    /requires database, operational access and n8n command outbox/u,
  );
  assert.throws(() =>
    createSellerWhatsAppFirstSendRuntime(untouched, {
      access: access(),
      outbox,
      environment: { ...environment, SELLER_WHATSAPP_SEND_SELLER_IDS: '1' },
    }),
  );
  for (const inbound of [
    { SELLER_WHATSAPP_INBOUND_ENABLED: 'yes' },
    { SELLER_WHATSAPP_INBOUND_SELLER_IDS: 'not-json' },
    { SELLER_WHATSAPP_INBOUND_SELLER_IDS: '[]' },
  ])
    assert.throws(() =>
      createSellerWhatsAppFirstSendRuntime(untouched, {
        access: access(),
        outbox,
        environment: { ...environment, ...inbound },
      }),
    );
  authorize(
    { id: seller, functionName: 'Vendedor', capabilities: [] },
    'contact.whatsapp.first_send',
  );
  assert.throws(() =>
    authorize(
      { id: seller, functionName: 'Financeiro', capabilities: [] },
      'contact.whatsapp.first_send',
    ),
  );
  assert.throws(() =>
    authorize(
      {
        id: seller,
        functionName: 'Vendedor',
        capabilities: [],
        disabledAt: new Date().toISOString(),
      },
      'contact.whatsapp.first_send',
    ),
  );
});

test('WAP-E10 flag, allowlists and roles fail closed before any database use', async (t) => {
  const absent = await api(undefined);
  t.after(() => absent.close());
  for (const [method, url] of [
    ['GET', preview],
    ['POST', send],
  ])
    problem(
      await absent.inject({
        method: /** @type {any} */ (method),
        url,
        headers,
        ...(method === 'POST' ? { payload: body } : {}),
      }),
      503,
      'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
    );

  const cases = [
    {
      env: { SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'false' },
      status: 503,
      code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
      session: false,
    },
    {
      env: { SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: '["someone-else"]' },
      status: 403,
      code: 'FORBIDDEN',
      session: true,
    },
    {
      env: { SELLER_CLIENTS_SELLER_IDS: '["someone-else"]' },
      status: 403,
      code: 'FORBIDDEN',
      session: true,
    },
    {
      env: { SELLER_CLIENTS_ENABLED: 'false' },
      status: 503,
      code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
      session: true,
    },
    {
      env: { SELLER_WHATSAPP_SEND_SELLER_IDS: '["someone-else"]' },
      status: 503,
      code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
      session: true,
    },
    {
      env: { SELLER_WHATSAPP_SEND_ENABLED: 'false' },
      status: 503,
      code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
      session: true,
    },
    // Without the personal inbound guard the reply would be refused.
    {
      env: { SELLER_WHATSAPP_INBOUND_ENABLED: 'false' },
      status: 503,
      code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
      session: true,
    },
    {
      env: { SELLER_WHATSAPP_INBOUND_SELLER_IDS: '["someone-else"]' },
      status: 503,
      code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
      session: true,
    },
  ];
  for (const item of cases) {
    /** @type {string[]} */
    const calls = [];
    const app = await api(
      createSellerWhatsAppFirstSendRuntime(untouched, {
        access: access({ calls }),
        outbox,
        environment: { ...environment, ...item.env },
      }),
    );
    for (const [method, url] of [
      ['GET', preview],
      ['POST', send],
    ])
      problem(
        await app.inject({
          method: /** @type {any} */ (method),
          url,
          headers,
          ...(method === 'POST' ? { payload: body } : {}),
        }),
        item.status,
        item.code,
      );
    assert.deepEqual(
      calls,
      item.session ? ['contact.read', 'contact.whatsapp.first_send'] : [],
    );
    await app.close();
  }

  const runtime = (/** @type {any} */ actor) =>
    createSellerWhatsAppFirstSendRuntime(untouched, {
      access: access({ actor }),
      outbox,
      environment,
    });
  const financeAccess = {
    authorizeRead: async () => {
      throw Object.assign(new Error('FORBIDDEN'), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    },
    authorizeWrite: async () => {
      throw Object.assign(new Error('FORBIDDEN'), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    },
  };
  for (const service of [
    runtime({ id: seller, kind: 'assistant' }),
    runtime({ id: 'admin-not-allowlisted', kind: 'human' }),
    createSellerWhatsAppFirstSendRuntime(untouched, {
      access: financeAccess,
      outbox,
      environment,
    }),
  ]) {
    const app = await api(service);
    problem(
      await app.inject({ method: 'POST', url: send, headers, payload: body }),
      403,
      'FORBIDDEN',
    );
    problem(await app.inject({ url: preview, headers }), 403, 'FORBIDDEN');
    await app.close();
  }
});

test('WAP-E10 strict body, headers and query refuse arbitrary destinations', async (t) => {
  const app = await api(
    createSellerWhatsAppFirstSendRuntime(untouched, {
      access: access(),
      outbox,
      environment,
    }),
  );
  t.after(() => app.close());
  for (const extra of [
    { to: '+5511999999999' },
    { userId: seller },
    { instanceName: 'wap_x' },
    { accountId: randomUUID() },
    { url: 'https://evil.test' },
    { mediaUrl: 'https://evil.test/x.png' },
    { expectedConversationVersion: 1 },
  ])
    problem(
      await app.inject({
        method: 'POST',
        url: send,
        headers,
        payload: { ...body, ...extra },
      }),
      400,
      'INVALID_REQUEST',
    );
  for (const changed of [
    { text: '   ' },
    { text: 'x'.repeat(2001) },
    { text: 42 },
    { text: 'a\u0000b' },
    { expectedContactVersion: 0 },
    { expectedLinkVersion: '1' },
    { expectedLineVersion: 1.5 },
    { expectedGeneration: -1 },
    { expectedConversation: undefined },
    { expectedConversation: 'conversation-1' },
    { expectedConversation: [] },
    { expectedConversation: {} },
    { expectedConversation: { id: 'conversation-1' } },
    { expectedConversation: { id: 'conversation-1', version: 0 } },
    { expectedConversation: { id: 'bad id', version: 1 } },
    { expectedConversation: { id: 'c', version: 1, to: '+5511999999999' } },
  ])
    problem(
      await app.inject({
        method: 'POST',
        url: send,
        headers,
        payload: { ...body, ...changed },
      }),
      400,
      'INVALID_REQUEST',
    );
  for (const omitted of Object.keys(body)) {
    const partial = /** @type {Record<string, unknown>} */ ({ ...body });
    delete partial[omitted];
    problem(
      await app.inject({
        method: 'POST',
        url: send,
        headers,
        payload: partial,
      }),
      400,
      'INVALID_REQUEST',
    );
  }
  problem(
    await app.inject({
      method: 'POST',
      url: send,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '[]',
    }),
    400,
    'INVALID_REQUEST',
  );
  const noKey = /** @type {Record<string, string>} */ ({ ...headers });
  delete noKey['idempotency-key'];
  for (const keyHeaders of [
    noKey,
    { ...headers, 'idempotency-key': 'short' },
    { ...headers, 'idempotency-key': 'a b c d e f g h' },
  ])
    problem(
      await app.inject({
        method: 'POST',
        url: send,
        headers: keyHeaders,
        payload: body,
      }),
      400,
      'IDEMPOTENCY_KEY',
    );
  problem(
    await app.inject({
      method: 'POST',
      url: `${send}?to=%2B5511999999999`,
      headers,
      payload: body,
    }),
    400,
    'INVALID_REQUEST',
  );
  problem(
    await app.inject({ url: `${preview}?phone=1`, headers }),
    400,
    'INVALID_REQUEST',
  );
  problem(
    await app.inject({
      method: 'POST',
      url: send,
      headers: { ...headers, authorization: 'Basic eDp5' },
      payload: body,
    }),
    403,
    'FORBIDDEN',
  );
  problem(
    await app.inject({
      method: 'POST',
      url: send,
      headers: { ...headers, 'x-csrf-token': 'wrong' },
      payload: body,
    }),
    403,
    'FORBIDDEN',
  );
  problem(
    await app.inject({
      method: 'POST',
      url: '/api/v1/contacts/bad%20id/whatsapp/conversations',
      headers,
      payload: body,
    }),
    400,
    'INVALID_REQUEST',
  );
});

test('WAP-E10 maps every domain refusal to its public code and 201/200', async (t) => {
  /** @type {any} */
  let outcome;
  /** @type {any[]} */
  const sent = [];
  const service = {
    authorize: async () => ({ id: seller, kind: 'human' }),
    preview: async () => {
      throw outcome;
    },
    send: async (/** @type {any} */ input) => {
      sent.push(input);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  const app = await api(service);
  t.after(() => app.close());
  const failure = (/** @type {string} */ code, /** @type {number} */ status) =>
    Object.assign(new Error(code), { code, statusCode: status });
  for (const [code, status, expected = code] of /** @type {const} */ ([
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONTACT_NOT_FOUND', 404, 'NOT_FOUND'],
    ['CONTACT_VERSION_CONFLICT', 409],
    ['WHATSAPP_GENERATION_STALE', 409],
    ['WHATSAPP_IDENTITY_CONFLICT', 409],
    ['CONVERSATION_UNAVAILABLE', 409],
    ['CONVERSATION_VERSION_CONFLICT', 409],
    ['WHATSAPP_OPERATION_UNCERTAIN', 409],
    ['IDEMPOTENCY_KEY_REUSED', 409, 'IDEMPOTENCY_CONFLICT'],
    ['IDEMPOTENCY_RECORD_PENDING', 500, 'IDEMPOTENCY_CONFLICT'],
    ['WHATSAPP_DESTINATION_INVALID', 422],
    ['RATE_LIMITED', 429],
    ['WHATSAPP_SEND_UNAVAILABLE', 503],
    ['SELLER_WHATSAPP_FIRST_SEND_DISABLED', 503],
    ['55P03', 500, 'SERVICE_UNAVAILABLE'],
    ['CLIENT_LINK_VERSION_CONFLICT', 409, 'SERVICE_UNAVAILABLE'],
  ])) {
    outcome = failure(code, status);
    const expectedStatus =
      expected === 'SERVICE_UNAVAILABLE'
        ? 503
        : expected === 'IDEMPOTENCY_CONFLICT'
          ? 409
          : status;
    problem(
      await app.inject({ method: 'POST', url: send, headers, payload: body }),
      expectedStatus,
      expected,
    );
    problem(
      await app.inject({ url: preview, headers }),
      expectedStatus,
      expected,
    );
  }
  outcome = new Error('internal +5511999999999 text');
  const leaked = await app.inject({
    method: 'POST',
    url: send,
    headers,
    payload: body,
  });
  problem(leaked, 503, 'SERVICE_UNAVAILABLE');
  assert.doesNotMatch(leaked.body, /5511|text/u);

  const result = {
    conversation: { id: 'c', version: 2, reused: false, cycleNumber: 1 },
    message: { id: 'm', status: 'queued' },
  };
  outcome = { created: true, body: result };
  const created = await app.inject({
    method: 'POST',
    url: send,
    headers,
    payload: body,
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json(), result);
  outcome = { created: false, body: result };
  const replay = await app.inject({
    method: 'POST',
    url: send,
    headers,
    payload: body,
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), result);
  const last = sent.at(-1);
  assert.equal(last.text, 'Olá, sintético');
  assert.equal(last.contactId, contactId);
  assert.equal(last.idempotencyKey, headers['idempotency-key']);
  assert.equal(typeof last.correlationId, 'string');
  assert.equal(last.to, undefined);
  assert.equal(last.expectedConversation, null);
  await app.inject({
    method: 'POST',
    url: send,
    headers,
    payload: { ...body, expectedConversation: { id: 'c', version: 3 } },
  });
  assert.deepEqual(sent.at(-1).expectedConversation, { id: 'c', version: 3 });
});

test('WAP-E10 preview is read-only and never reveals another Contact', async () => {
  const lineId = randomUUID();
  const accountId = randomUUID();
  /** @type {string[]} */
  const statements = [];
  /** @type {{identityContact: string|null, conversation: any, phone: string, pending: boolean}} */
  const world = {
    identityContact: null,
    conversation: null,
    phone: '(11) 90000-4321',
    pending: false,
  };
  /** @param {string} sql */
  const answer = (sql) => {
    if (/FROM crm\.users/u.test(sql))
      return [{ id: seller, disabled_at: null }];
    if (/FROM crm\.user_functions/u.test(sql))
      return [{ function_name: 'Vendedor' }];
    if (/FROM crm\.seller_whatsapp_lines/u.test(sql))
      return [
        {
          id: lineId,
          account_id: accountId,
          state: 'connected',
          version: '3',
          generation: '2',
          verified_at: new Date(),
          binding_id: randomUUID(),
          confirmed_number_envelope: encryptJson(
            { number: '5511000001234' },
            `seller-whatsapp-confirmed:${lineId}`,
            key,
          ),
        },
      ];
    if (/FROM crm\.contacts contact/u.test(sql))
      return [
        {
          id: contactId,
          display_name: 'Cliente sintético',
          version: '4',
          link_id: 'link-1',
          link_version: '5',
          contact_details_envelope: encryptContactDetails(
            { email: null, phone: world.phone },
            key,
          ),
        },
      ];
    if (/FROM crm\.contact_identities/u.test(sql))
      return world.identityContact
        ? [{ id: 'identity-1', current_contact_id: world.identityContact }]
        : [];
    if (/FROM crm\.messages/u.test(sql)) return world.pending ? [{}] : [];
    if (/FROM crm\.conversations/u.test(sql))
      return world.conversation ? [world.conversation] : [];
    return [];
  };
  const client = {
    query: async (/** @type {string} */ sql) => {
      statements.push(sql);
      return { rows: answer(sql) };
    },
  };
  const database = {
    query: client.query,
    transaction: async (/** @type {any} */ work) => work(client),
  };
  const app = await api(
    createSellerWhatsAppFirstSendRuntime(database, {
      access: access(),
      outbox,
      environment,
    }),
  );
  const read = async () => {
    const response = await app.inject({ url: preview, headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(String(response.headers['cache-control']), /no-store/u);
    return response.json().preview;
  };
  const fresh = await read();
  assert.deepEqual(fresh, {
    contact: { id: contactId, name: 'Cliente sintético', version: 4 },
    link: { id: 'link-1', version: 5 },
    line: {
      id: lineId,
      version: 3,
      generation: 2,
      state: 'connected',
      maskedNumber: '••••1234',
    },
    recipient: { maskedNumber: '••••4321' },
    conversation: null,
    available: true,
    restriction: null,
    pendingSend: false,
  });
  world.identityContact = 'contact-of-someone-else';
  const conflict = await read();
  assert.equal(conflict.restriction, 'identity_conflict');
  assert.equal(conflict.available, false);
  assert.doesNotMatch(JSON.stringify(conflict), /someone-else|identity-1/u);
  world.identityContact = contactId;
  world.conversation = {
    id: 'conversation-1',
    version: '7',
    contact_identity_id: 'identity-1',
    assigned_user_id: 'other-seller',
    automation_state: 'human',
  };
  const foreign = await read();
  assert.equal(foreign.restriction, 'conversation_unavailable');
  assert.equal(foreign.conversation, null);
  world.conversation.assigned_user_id = seller;
  const reusable = await read();
  assert.deepEqual(reusable.conversation, {
    id: 'conversation-1',
    version: 7,
  });
  assert.equal(reusable.pendingSend, false);
  // WAP-24: an unsettled send of the titular must be reconciled first.
  world.pending = true;
  assert.equal((await read()).pendingSend, true);
  // WAP-10/22/23: closing the cycle does not settle an uncertain send.
  world.conversation = null;
  const closed = await read();
  assert.equal(closed.conversation, null);
  assert.equal(closed.available, true);
  assert.equal(closed.pendingSend, true);
  world.pending = false;
  // The titular's own confirmed number is never a customer destination.
  world.phone = '11000001234';
  const own = await read();
  assert.equal(own.restriction, 'destination_invalid');
  assert.equal(own.available, false);
  assert.equal(own.conversation, null);
  assert.equal(
    statements.filter((s) => s === 'SET TRANSACTION READ ONLY').length,
    7,
  );
  for (const sql of statements) {
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|FOR UPDATE|FOR SHARE|advisory)\b/iu,
    );
  }
  await app.close();
});

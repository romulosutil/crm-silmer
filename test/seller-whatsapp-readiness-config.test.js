import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createN8nApiRuntime } from '../apps/api/src/n8n-runtime.js';
import { sellerClientsConfiguration } from '../apps/api/src/operation-runtime.js';
import {
  createSellerWhatsAppFirstSendRuntime,
  sellerWhatsAppFirstSendConfiguration,
  sellerWhatsAppInboundSellers,
} from '../apps/api/src/seller-whatsapp-first-send-runtime.js';
import { createSellerWhatsAppRuntime } from '../apps/api/src/seller-whatsapp-runtime.js';
import { createWhatsAppControlWorkerRuntime } from '../apps/worker/src/whatsapp-control-runtime.js';
import { PostgresSellerWhatsAppRepository } from '../modules/inbox-channels/src/adapters/postgres-seller-whatsapp.js';
import { sellerWhatsAppConfiguration } from '../modules/inbox-channels/src/seller-whatsapp-configuration.js';
import {
  personalSendAllowed,
  sellerWhatsAppSendConfiguration,
} from '../modules/n8n-integration/src/seller-whatsapp-send.js';

// WAP-T05-01 (WAP-12/WAP-16): one consolidated fail-closed matrix for the
// seller-WhatsApp guards delivered by E01-E10. Only synthetic IDs and keys.
const load = createRequire(import.meta.url);
const ingress = load('../ops/n8n/wap-ingress-runtime.cjs');
const control = load('../ops/evolution/wap-control-runtime.cjs');
const generation = load('../ops/evolution/wap-generation-runtime.cjs');
const privacy = load('../ops/evolution/privacy.cjs');

const A = 'synthetic-a';
const B = 'synthetic-b';
const key = Buffer.alloc(32, 53).toString('base64');
const KEYS = Object.freeze({
  CONTACT_IDENTITY_ENVELOPE_KEY: key,
  CONTACT_IDENTITY_LOOKUP_KEY: key,
  INBOX_MESSAGE_ENVELOPE_KEY: key,
  IDEMPOTENCY_ENVELOPE_KEY: key,
  N8N_INTEGRATION_ENVELOPE_KEY: key,
  SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: 'a'.repeat(64),
});
/** Anything that is not the literal lower-case `true`/`false`. */
const INVALID_FLAGS = ['TRUE', 'True', 'FALSE', '1', '0', 'yes', 'on', ''];
INVALID_FLAGS.push(' true', 'true ');
/** Malformed, empty, duplicate or non-ID allowlists. */
const INVALID_LISTS = [
  '',
  'not-json',
  'null',
  '"synthetic-a"',
  '{"id":"synthetic-a"}',
  '[1]',
  '[""]',
  '["synthetic a"]',
  '["synthetic-a","synthetic-a"]',
  JSON.stringify(['x'.repeat(129)]),
];
const list = (/** @type {string[]} */ ...ids) => JSON.stringify(ids);

/**
 * @typedef {{enabled:boolean, allows:(id:string)=>boolean}} Effective
 * @typedef {{name:string, flag:string, ids:string, flagError:RegExp, listError:RegExp, parse:(env:Record<string,string|undefined>)=>Effective}} Guard
 */
/** @type {Guard[]} */
const API_GUARDS = [
  {
    name: 'E02 control',
    flag: 'SELLER_WHATSAPP_CONTROL_ENABLED',
    ids: 'SELLER_WHATSAPP_SELLER_IDS',
    flagError: /: SELLER_WHATSAPP_CONTROL_ENABLED must be true or false$/u,
    listError:
      /: SELLER_WHATSAPP_SELLER_IDS (must be a JSON array|requires explicit seller IDs)$/u,
    parse(env) {
      const c = sellerWhatsAppConfiguration({ ...KEYS, ...env });
      return {
        enabled: c.enabled,
        allows: (id) => c.enabled && c.sellerAllowlist.includes(id),
      };
    },
  },
  {
    name: 'E03 portfolio',
    flag: 'SELLER_CLIENTS_ENABLED',
    ids: 'SELLER_CLIENTS_SELLER_IDS',
    flagError: /: SELLER_CLIENTS_ENABLED must be true or false$/u,
    listError:
      /: SELLER_CLIENTS_SELLER_IDS requires explicit seller IDs$|JSON/u,
    parse(env) {
      const c = sellerClientsConfiguration(env);
      return {
        enabled: c.enabled,
        allows: (id) => c.enabled && c.sellerIds.includes(id),
      };
    },
  },
  {
    name: 'E04 personal inbound',
    flag: 'SELLER_WHATSAPP_INBOUND_ENABLED',
    ids: 'SELLER_WHATSAPP_INBOUND_SELLER_IDS',
    flagError: /: Invalid SELLER_WHATSAPP_INBOUND_ENABLED$/u,
    listError:
      /: (Invalid SELLER_WHATSAPP_INBOUND_SELLER_IDS|Personal inbound requires explicit seller IDs)$/u,
    parse(env) {
      const sellers = sellerWhatsAppInboundSellers(env);
      return { enabled: sellers.size > 0, allows: (id) => sellers.has(id) };
    },
  },
  {
    name: 'E08 personal send',
    flag: 'SELLER_WHATSAPP_SEND_ENABLED',
    ids: 'SELLER_WHATSAPP_SEND_SELLER_IDS',
    flagError: /: Personal WhatsApp send requires explicit seller IDs$/u,
    listError: /: Personal WhatsApp send requires explicit seller IDs$|JSON/u,
    parse(env) {
      const sellers = sellerWhatsAppSendConfiguration(env);
      return { enabled: sellers.size > 0, allows: (id) => sellers.has(id) };
    },
  },
  {
    name: 'E10 first send',
    flag: 'SELLER_WHATSAPP_FIRST_SEND_ENABLED',
    ids: 'SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS',
    flagError: /: Seller WhatsApp first send requires explicit seller IDs$/u,
    listError: /: Seller WhatsApp first send requires explicit seller IDs$/u,
    parse(env) {
      const c = sellerWhatsAppFirstSendConfiguration(env);
      return { enabled: c.enabled, allows: (id) => c.sellers.has(id) };
    },
  },
];

/** A database that refuses any use. */
const untouched = {
  query: () => assert.fail('A guard must refuse before PostgreSQL'),
  transaction: () => assert.fail('A guard must refuse before a transaction'),
};

test('WAP-T05-01 every API/module guard is off when absent or literal false, even with an allowlist', () => {
  for (const guard of API_GUARDS) {
    for (const env of [
      {},
      { [guard.flag]: 'false' },
      { [guard.flag]: 'false', [guard.ids]: list(A) },
      { [guard.ids]: list(A) },
    ]) {
      const effective = guard.parse(env);
      assert.equal(effective.enabled, false, `${guard.name} default`);
      assert.equal(effective.allows(A), false, `${guard.name} default`);
    }
  }
});

test('WAP-T05-01 invalid flag values throw at startup instead of resolving to on', () => {
  for (const guard of API_GUARDS)
    for (const value of INVALID_FLAGS)
      assert.throws(
        () => guard.parse({ [guard.flag]: value, [guard.ids]: list(A) }),
        guard.flagError,
        `${guard.name} ${JSON.stringify(value)}`,
      );
});

test('WAP-T05-01 enabled guards reject absent, empty, malformed or duplicate allowlists', () => {
  for (const guard of API_GUARDS) {
    for (const ids of [undefined, '[]', ...INVALID_LISTS])
      assert.throws(
        () => guard.parse({ [guard.flag]: 'true', [guard.ids]: ids }),
        guard.listError,
        `${guard.name} enabled with ${JSON.stringify(ids)}`,
      );
    // A malformed allowlist is never silently ignored while the flag is off.
    for (const ids of INVALID_LISTS)
      assert.throws(
        () => guard.parse({ [guard.flag]: 'false', [guard.ids]: ids }),
        guard.listError,
        `${guard.name} off with ${JSON.stringify(ids)}`,
      );
  }
});

test('WAP-T05-01 an enabled guard admits only the exact allowlisted seller', () => {
  for (const guard of API_GUARDS) {
    const effective = guard.parse({
      [guard.flag]: 'true',
      [guard.ids]: list(A),
    });
    assert.equal(effective.enabled, true, guard.name);
    assert.equal(effective.allows(A), true, guard.name);
    for (const other of [B, 'SYNTHETIC-A', 'synthetic', `${A} `, ''])
      assert.equal(effective.allows(other), false, `${guard.name} ${other}`);
  }
});

test('WAP-T05-01 E02 control also requires 32-byte keys and the general line digest', () => {
  const on = {
    SELLER_WHATSAPP_CONTROL_ENABLED: 'true',
    SELLER_WHATSAPP_SELLER_IDS: list(A),
  };
  for (const missing of [
    { CONTACT_IDENTITY_ENVELOPE_KEY: undefined },
    { CONTACT_IDENTITY_LOOKUP_KEY: Buffer.alloc(16, 1).toString('base64') },
    { SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: undefined },
    { SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: 'A'.repeat(64) },
    { SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: 'a'.repeat(63) },
  ])
    assert.throws(
      () => sellerWhatsAppConfiguration({ ...KEYS, ...on, ...missing }),
      /requires encryption\/lookup keys and general line digest/u,
    );
  // Off, the keys are not required and nothing is enabled.
  assert.equal(sellerWhatsAppConfiguration({}).enabled, false);
});

test('WAP-T05-01 the n8n runtime enforces the same inbound and send rules at startup', () => {
  const inboundError = /SELLER_WHATSAPP_INBOUND|Personal inbound requires/u;
  for (const invalid of [
    ...INVALID_FLAGS.map((v) => ({ SELLER_WHATSAPP_INBOUND_ENABLED: v })),
    { SELLER_WHATSAPP_INBOUND_ENABLED: 'true' },
    ...['[]', ...INVALID_LISTS].map((v) => ({
      SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
      SELLER_WHATSAPP_INBOUND_SELLER_IDS: v,
    })),
  ]) {
    const environment = { ...KEYS, ...invalid };
    assert.throws(
      () => sellerWhatsAppInboundSellers(environment),
      inboundError,
    );
    assert.throws(
      () => createN8nApiRuntime(untouched, { environment }),
      inboundError,
      JSON.stringify(invalid),
    );
  }
  for (const invalid of [
    { SELLER_WHATSAPP_SEND_ENABLED: 'yes' },
    { SELLER_WHATSAPP_SEND_ENABLED: 'true' },
    {
      SELLER_WHATSAPP_SEND_ENABLED: 'true',
      SELLER_WHATSAPP_SEND_SELLER_IDS: '[]',
    },
    { SELLER_WHATSAPP_SEND_SELLER_IDS: list(A, A) },
  ])
    assert.throws(
      () =>
        createN8nApiRuntime(untouched, {
          environment: { ...KEYS, ...invalid },
        }),
      /Personal WhatsApp send requires explicit seller IDs/u,
    );
  // Positive control: valid send/inbound guards pass both parses and stop at
  // the next, unrelated required setting (private media volume).
  assert.throws(
    () =>
      createN8nApiRuntime(untouched, {
        environment: {
          ...KEYS,
          SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
          SELLER_WHATSAPP_INBOUND_SELLER_IDS: list(A),
          SELLER_WHATSAPP_SEND_ENABLED: 'true',
          SELLER_WHATSAPP_SEND_SELLER_IDS: list(A),
        },
      }),
    /: PRIVATE_MEDIA_MAX_BYTES must be a positive integer$/u,
  );
});

/** @param {Record<string, unknown>} [extra] */
function controlEnvironment(extra = {}) {
  return {
    ...KEYS,
    SELLER_WHATSAPP_CONTROL_ENABLED: 'true',
    SELLER_WHATSAPP_SELLER_IDS: list(A),
    SELLER_WHATSAPP_WEBHOOK_URL:
      'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events',
    N8N_WAP_CONTROL_URL:
      'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/control',
    N8N_WAP_CHALLENGE_URL:
      'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/challenge',
    N8N_COMMAND_CLIENT_ID: 'synthetic-client',
    N8N_COMMAND_CLIENT_SECRET: 's'.repeat(40),
    ...extra,
  };
}
const access = {
  authorizeRead: () => assert.fail('No authorization in a disabled guard'),
  authorizeWrite: () => assert.fail('No authorization in a disabled guard'),
};

test('WAP-T05-01 API and worker control runtimes stay closed off and refuse unsafe endpoints on', async () => {
  const off = createSellerWhatsAppRuntime(untouched, {
    access,
    environment: { ...KEYS },
  });
  assert.equal(off.enabled, false);
  const disabled = { code: 'WHATSAPP_CONTROL_DISABLED', statusCode: 503 };
  assert.throws(
    () =>
      off.authorizeTechnical({
        actor: { id: 'AUTOMATION_EXECUTOR' },
        workflowKey: 'seller-whatsapp-control',
        workflowVersion: '1.0',
      }),
    disabled,
  );
  await assert.rejects(off.challenge({ auth: {}, actorId: A }), disabled);
  await assert.rejects(off.verifyIngress({}), disabled);
  assert.equal(
    createWhatsAppControlWorkerRuntime({
      database: untouched,
      environment: {},
      WorkerRuntime: class {
        constructor() {
          assert.fail('A disabled worker must not start');
        }
      },
    }),
    undefined,
  );
  for (const value of INVALID_FLAGS)
    assert.throws(() =>
      createWhatsAppControlWorkerRuntime({
        database: untouched,
        environment: { SELLER_WHATSAPP_CONTROL_ENABLED: value },
        WorkerRuntime: class {},
      }),
    );

  // Positive control: the full private configuration composes.
  assert.equal(
    createSellerWhatsAppRuntime(untouched, {
      access,
      environment: controlEnvironment(),
    }).enabled,
    true,
  );
  for (const webhook of [
    undefined,
    '',
    'http://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events',
    'https://n8n.synthetic.invalid/webhook/other/events',
    'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events?x=1',
    'https://user:pass@n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events',
  ])
    assert.throws(
      () =>
        createSellerWhatsAppRuntime(untouched, {
          access,
          client: {},
          environment: controlEnvironment({
            SELLER_WHATSAPP_WEBHOOK_URL: webhook,
          }),
        }),
      Error,
      String(webhook),
    );
  assert.throws(
    () =>
      createSellerWhatsAppRuntime(untouched, {
        access: undefined,
        client: {},
        environment: controlEnvironment(),
      }),
    /requires operational access/u,
  );
  for (const endpoint of [
    undefined,
    'http://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/control',
    'https://n8n.synthetic.invalid/webhook/other/control',
    'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/control#x',
  ]) {
    const environment = controlEnvironment({ N8N_WAP_CONTROL_URL: endpoint });
    assert.throws(
      () => createSellerWhatsAppRuntime(untouched, { access, environment }),
      /WHATSAPP_CONTROL_CONFIGURATION_INVALID/u,
    );
    assert.throws(
      () =>
        createWhatsAppControlWorkerRuntime({
          database: untouched,
          environment,
          WorkerRuntime: class {},
        }),
      /WHATSAPP_CONTROL_CONFIGURATION_INVALID/u,
    );
  }
});

/** Fake PostgreSQL that only answers the owner lookups. @param {string[]} seen */
function ownerOnlyDatabase(seen) {
  const client = {
    /** @param {string} sql @param {any[]} values */
    async query(sql, values) {
      seen.push(sql);
      if (/FROM crm\.users WHERE id=\$1/u.test(sql))
        return { rows: [{ id: values[0], disabled_at: null }] };
      if (/FROM crm\.user_functions WHERE user_id=\$1/u.test(sql))
        return { rows: [{ function_name: 'Vendedor' }] };
      if (/FROM crm\.seller_whatsapp_lines WHERE seller_id=\$1/u.test(sql))
        return { rows: [] };
      return assert.fail(`Unexpected query after the guard: ${sql}`);
    },
  };
  return {
    query: client.query,
    /** @param {(client:any)=>Promise<any>} work */
    transaction: (work) => work(client),
  };
}

test('WAP-T05-01 a non-allowlisted seller gets no control effect and only a read-only status', async () => {
  for (const [enabled, sellerAllowlist, actorId] of /** @type {const} */ ([
    [true, [A], B],
    [false, [A], A],
    [false, [], A],
  ])) {
    /** @type {string[]} */
    const seen = [];
    const repository = new PostgresSellerWhatsAppRepository(
      ownerOnlyDatabase(seen),
      {
        envelopeKey: Buffer.from(key, 'base64'),
        lookupKey: Buffer.from(key, 'base64'),
        enabled,
        sellerAllowlist: [...sellerAllowlist],
        generalNumberDigest: 'a'.repeat(64),
      },
    );
    await assert.rejects(
      repository.submit({
        actorId,
        action: 'connect',
        expectedVersion: 0,
        expectedNumber: '+5511000000001',
        idempotencyKey: randomUUID(),
      }),
      { code: 'WHATSAPP_CONTROL_DISABLED', statusCode: 503 },
    );
    assert.equal(seen.length, 2, 'only the user and role lookups ran');
    const status = await repository.get({ actorId });
    assert.equal(status.available, false);
    assert.equal(status.line.state, 'not_configured');
  }
});

test('WAP-T05-01 personal send and first send refuse a non-allowlisted seller before any effect', async () => {
  const on = sellerWhatsAppSendConfiguration({
    SELLER_WHATSAPP_SEND_ENABLED: 'true',
    SELLER_WHATSAPP_SEND_SELLER_IDS: list(A),
  });
  const offWithList = sellerWhatsAppSendConfiguration({
    SELLER_WHATSAPP_SEND_ENABLED: 'false',
    SELLER_WHATSAPP_SEND_SELLER_IDS: list(A),
  });
  const own = (/** @type {string} */ sellerId) => ({ usable: true, sellerId });
  assert.equal(personalSendAllowed(own(A), A, on), true);
  assert.equal(personalSendAllowed(own(B), B, on), false);
  assert.equal(personalSendAllowed(own(A), B, on), false);
  assert.equal(personalSendAllowed(own(A), A, offWithList), false);
  assert.equal(personalSendAllowed({ ...own(A), usable: false }, A, on), false);

  const both = list(A, B);
  const all = {
    ...KEYS,
    SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true',
    SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: both,
    SELLER_WHATSAPP_SEND_ENABLED: 'true',
    SELLER_WHATSAPP_SEND_SELLER_IDS: both,
    SELLER_CLIENTS_ENABLED: 'true',
    SELLER_CLIENTS_SELLER_IDS: both,
    SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
    SELLER_WHATSAPP_INBOUND_SELLER_IDS: both,
  };
  const outbox = { enqueueChannelMessage: () => assert.fail('No enqueue') };
  /** @type {Array<[Record<string,string>, string, number, string]>} */
  const cases = [
    [
      { SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'false' },
      A,
      503,
      'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
    ],
    [{ SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: list(A) }, B, 403, 'FORBIDDEN'],
    [{ SELLER_CLIENTS_SELLER_IDS: list(A) }, B, 403, 'FORBIDDEN'],
    [
      { SELLER_CLIENTS_ENABLED: 'false' },
      A,
      503,
      'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
    ],
    [
      { SELLER_WHATSAPP_SEND_SELLER_IDS: list(A) },
      B,
      503,
      'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
    ],
    [
      { SELLER_WHATSAPP_SEND_ENABLED: 'false' },
      A,
      503,
      'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
    ],
    [
      { SELLER_WHATSAPP_INBOUND_SELLER_IDS: list(A) },
      B,
      503,
      'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
    ],
    [
      { SELLER_WHATSAPP_INBOUND_ENABLED: 'false' },
      A,
      503,
      'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
    ],
  ];
  for (const [change, actorId, statusCode, code] of cases) {
    const runtime = createSellerWhatsAppFirstSendRuntime(untouched, {
      access,
      outbox,
      environment: { ...all, ...change },
    });
    const actor = { id: actorId };
    await assert.rejects(runtime.preview({ actor, contactId: 'contact-x' }), {
      statusCode,
      code,
    });
    await assert.rejects(
      runtime.send({
        actor,
        contactId: 'contact-x',
        text: 'Sintetico',
        expectedContactVersion: 1,
        expectedLinkVersion: 1,
        expectedLineVersion: 1,
        expectedGeneration: 1,
        expectedConversation: null,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      }),
      { statusCode, code },
    );
  }
});

const settings = {
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
};
const eventsPath = 'silmer/seller-whatsapp/events';
const ingressEnv = Object.freeze({
  SILMER_WAP_INGRESS_ENABLED: 'true',
  SILMER_WAP_INGRESS_PATHS: JSON.stringify({ [eventsPath]: 'event' }),
  SILMER_WAP_INGRESS_INSTANCES: A,
  SILMER_WAP_INGRESS_VERIFY_URL:
    'https://crm.synthetic.invalid/api/v1/integrations/n8n/whatsapp-control/ingress/verify',
  SILMER_WAP_INGRESS_VERIFY_BASIC: 'Basic c3ludGhldGljOnZlcmlmaWVy',
});
const execution = () => ({
  workflowData: { name: 'Silmer seller WhatsApp synthetic', settings },
  executionMode: 'webhook',
  executionData: { resultData: { runData: {} } },
});

test('WAP-T05-01 n8n ingress is off unless literal true with an explicit reserved path map', () => {
  // Positive control, then every off/invalid configuration denies the writer.
  assert.equal(
    ingress.guardInitialExecution(execution(), undefined, ingressEnv),
    undefined,
  );
  for (const change of [
    { SILMER_WAP_INGRESS_ENABLED: undefined },
    { SILMER_WAP_INGRESS_ENABLED: 'false' },
    ...INVALID_FLAGS.map((v) => ({ SILMER_WAP_INGRESS_ENABLED: v })),
    { SILMER_WAP_INGRESS_PATHS: undefined },
    ...['', 'not-json', '[]', '{}', 'null'].map((v) => ({
      SILMER_WAP_INGRESS_PATHS: v,
    })),
    { SILMER_WAP_INGRESS_PATHS: JSON.stringify({ 'silmer/other': 'event' }) },
    { SILMER_WAP_INGRESS_PATHS: JSON.stringify({ [eventsPath]: 'other' }) },
    {
      SILMER_WAP_INGRESS_PATHS: JSON.stringify({
        'silmer/seller-whatsapp/ev ents': 'event',
      }),
    },
  ])
    assert.throws(
      () =>
        ingress.guardInitialExecution(execution(), undefined, {
          ...ingressEnv,
          ...change,
        }),
      /WAP_INGRESS_DENIED/u,
      JSON.stringify(change),
    );
  // Legacy, unscoped workflows are untouched by the personal guard.
  assert.equal(
    ingress.guardInitialExecution(
      { ...execution(), workflowData: { name: 'Legacy', nodes: [] } },
      undefined,
      {},
    ),
    undefined,
  );
});

/** @param {string} instance */
function ingressContext(instance) {
  const parameters = {
    path: eventsPath,
    authentication: 'headerAuth',
    responseMode: 'responseNode',
    options: {},
  };
  const req = {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'x-silmer-wap-generation-token': 's'.repeat(40) },
    params: {},
    query: {},
    body: {
      event: 'connection.update',
      instance,
      source: {
        bindingId: randomUUID(),
        lineId: randomUUID(),
        accountId: randomUUID(),
        generation: 1,
      },
      data: { state: 'open' },
    },
  };
  const response = {
    status: 0,
    text: '',
    writeHead(/** @type {number} */ status) {
      this.status = status;
    },
    end(/** @type {string} */ text) {
      this.text = text;
    },
  };
  return {
    response,
    workflow: { settings: { ...settings }, pinData: {} },
    getNodeParameter: (
      /** @type {string} */ name,
      /** @type {any} */ fallback,
    ) => /** @type {any} */ (parameters)[name] ?? fallback,
    getNode: () => ({ parameters }),
    getRequestObject: () => req,
    getResponseObject: () => response,
  };
}

test('WAP-T05-01 n8n ingress denies a non-allowlisted or unconfigured instance before the verifier', async () => {
  let calls = 0;
  const unavailable = async () => {
    calls++;
    return { status: 503 };
  };
  // Positive control: the allowlisted instance reaches the verifier (503 here).
  const allowed = ingressContext(A);
  assert.equal(
    await ingress.protectIngress(allowed, ingressEnv, unavailable),
    true,
  );
  assert.equal(allowed.response.status, 503);
  assert.equal(calls, 1);
  for (const [instance, instances] of [
    [B, A],
    [A, ''],
    [A, undefined],
    [A, `${A},synthetic b`],
  ]) {
    calls = 0;
    const ctx = ingressContext(/** @type {string} */ (instance));
    assert.equal(
      await ingress.protectIngress(
        ctx,
        { ...ingressEnv, SILMER_WAP_INGRESS_INSTANCES: instances },
        unavailable,
      ),
      true,
    );
    assert.equal(ctx.response.status, 403, `${instance} in ${instances}`);
    assert.equal(ctx.response.text, 'WAP_INGRESS_DENIED');
    assert.equal(calls, 0, 'denied before the CRM verifier');
  }
});

const evolutionControl = Object.freeze({
  SILMER_WAP_CONTROL_ENABLED: 'true',
  SILMER_WAP_GENERATION_ENABLED: 'true',
  SILMER_WAP_GENERATION_INSTANCES: A,
  SILMER_WAP_CONTROL_WEBHOOK_URL:
    'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events',
  AUTHENTICATION_API_KEY: 'k'.repeat(48),
});

test('WAP-T05-01 Evolution control is off by default and rejects invalid or incomplete opt-in', () => {
  assert.deepEqual(control.configuration({}), {
    enabled: false,
    instances: [],
  });
  assert.deepEqual(
    control.configuration({ SILMER_WAP_CONTROL_ENABLED: 'false' }),
    { enabled: false, instances: [] },
  );
  const on = control.configuration(evolutionControl);
  assert.equal(on.enabled, true);
  assert.deepEqual(on.instances, [A]);
  for (const change of [
    ...INVALID_FLAGS.map((v) => ({ SILMER_WAP_CONTROL_ENABLED: v })),
    { SILMER_WAP_GENERATION_ENABLED: undefined },
    { SILMER_WAP_GENERATION_ENABLED: 'false' },
    { SILMER_WAP_GENERATION_INSTANCES: undefined },
    { SILMER_WAP_GENERATION_INSTANCES: '' },
    { SILMER_WAP_GENERATION_INSTANCES: `${A},${A}` },
    { SILMER_WAP_GENERATION_INSTANCES: `${A},` },
    { SILMER_WAP_GENERATION_INSTANCES: 'synthetic a' },
    { SILMER_WAP_CONTROL_WEBHOOK_URL: undefined },
    {
      SILMER_WAP_CONTROL_WEBHOOK_URL:
        'http://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events',
    },
    {
      SILMER_WAP_CONTROL_WEBHOOK_URL:
        'https://n8n.synthetic.invalid/webhook/silmer/evolution-events',
    },
    { AUTHENTICATION_API_KEY: 'k'.repeat(31) },
    { SERVER_PORT: '0' },
  ])
    assert.throws(
      () => control.configuration({ ...evolutionControl, ...change }),
      /WAP_CONTROL_DENIED/u,
      JSON.stringify(change),
    );
  // An invalid flag also fails when the image wraps Express at boot.
  assert.throws(
    () =>
      control.protectExpress(() => ({ use() {} }), {
        env: { SILMER_WAP_CONTROL_ENABLED: 'yes' },
      })(),
    /WAP_CONTROL_DENIED/u,
  );
});

test('WAP-T05-01 Evolution socket generation is off by default and requires an exact instance allowlist', () => {
  const token = 's'.repeat(40);
  const source = {
    bindingId: randomUUID(),
    lineId: randomUUID(),
    accountId: randomUUID(),
    generation: 1,
  };
  assert.equal(generation.fromEnvironment({}).captureSocket(A, {}), null);
  for (const env of [
    ...INVALID_FLAGS.map((v) => ({ SILMER_WAP_GENERATION_ENABLED: v })),
    { SILMER_WAP_GENERATION_ENABLED: 'true' },
    {
      SILMER_WAP_GENERATION_ENABLED: 'true',
      SILMER_WAP_GENERATION_INSTANCES: '',
    },
    {
      SILMER_WAP_GENERATION_ENABLED: 'true',
      SILMER_WAP_GENERATION_INSTANCES: `${A},${A}`,
    },
    {
      SILMER_WAP_GENERATION_ENABLED: 'true',
      SILMER_WAP_GENERATION_INSTANCES: 'synthetic a',
    },
  ])
    assert.throws(
      () => generation.fromEnvironment(env),
      /WAP_GENERATION_CONFIG_INVALID/u,
      JSON.stringify(env),
    );
  const off = generation.fromEnvironment({
    SILMER_WAP_GENERATION_ENABLED: 'false',
    SILMER_WAP_GENERATION_INSTANCES: A,
  });
  assert.throws(
    () => off.bindNextSocket(A, source, token),
    /WAP_GENERATION_DISABLED/u,
  );
  const on = generation.fromEnvironment({
    SILMER_WAP_GENERATION_ENABLED: 'true',
    SILMER_WAP_GENERATION_INSTANCES: A,
  });
  assert.throws(
    () => on.bindNextSocket(B, source, token),
    /WAP_GENERATION_INSTANCE_DENIED/u,
  );
});

const evolutionBoot = Object.freeze({
  AUTHENTICATION_API_KEY: 'k'.repeat(48),
  SILMER_EVOLUTION_WEBHOOK_TOKEN: 't'.repeat(48),
  DATABASE_CONNECTION_URI:
    'postgresql://silmer_evolution:synthetic@db.synthetic.invalid:5432/silmer_evolution',
  SILMER_EVOLUTION_WEBHOOK_URL:
    'https://n8n.synthetic.invalid/webhook/silmer/evolution-events',
  SILMER_EVOLUTION_INSTANCE: 'synthetic-general',
  DATABASE_PROVIDER: 'postgresql',
  CACHE_REDIS_ENABLED: 'false',
  CACHE_REDIS_SAVE_INSTANCES: 'false',
  CACHE_LOCAL_ENABLED: 'true',
  TELEMETRY_ENABLED: 'false',
  AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: 'false',
  WEBHOOK_GLOBAL_ENABLED: 'false',
  PROMETHEUS_METRICS: 'false',
  WEBSOCKET_ENABLED: 'false',
  LOG_LEVEL: 'ERROR',
  LOG_BAILEYS: 'fatal',
  DOCKER_ENV: 'true',
  TZ: 'UTC',
  DATABASE_SAVE_DATA_NEW_MESSAGE: 'true',
});
const generationToken = 'synthetic-generation-token-000000000000';
/** @param {Record<string, any>} [patch] @param {Record<string, any>} [data] */
const personalDispatch = (patch = {}, data = {}) => ({
  url: evolutionControl.SILMER_WAP_CONTROL_WEBHOOK_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-Silmer-Wap-Generation-Token': generationToken,
  },
  data: {
    event: 'messages.upsert',
    instance: A,
    source: {
      bindingId: 'synthetic-binding',
      lineId: 'synthetic-line',
      accountId: 'synthetic-account',
      generation: 2,
    },
    sender: '5511000000001@s.whatsapp.net',
    date_time: '2026-11-18T12:00:00.000Z',
    apikey: 'synthetic-instance-secret-never-forwarded',
    data: { key: { id: 'synthetic-message', fromMe: true } },
    ...data,
  },
  ...patch,
});

test('WAP-E12 personal message events with source and generation proof reach only the personal URL', () => {
  const profile = privacy.validateEnvironment({
    ...evolutionBoot,
    ...evolutionControl,
  });
  for (const event of [
    'messages.upsert',
    'messages.update',
    'connection.update',
  ]) {
    const output = privacy.protectWebhookRequest(
      personalDispatch({}, { event }),
      profile,
    );
    assert.equal(output.url, profile.personalWebhookUrl);
    assert.equal(output.data.event, event);
    assert.equal(output.data.apikey, undefined);
    assert.equal(output.data.source.generation, 2);
    assert.equal(output.maxRedirects, 0);
    assert.equal(output.headers['X-Silmer-Evolution-Token'], 't'.repeat(48));
    assert.equal(
      output.headers['X-Silmer-Wap-Generation-Token'],
      generationToken,
    );
  }
});

test('WAP-E12 personal events without proof, on the wrong URL or outside the allowlist are refused', () => {
  const profile = privacy.validateEnvironment({
    ...evolutionBoot,
    ...evolutionControl,
  });
  const withoutGeneration = { 'Content-Type': 'application/json' };
  for (const request of [
    personalDispatch({}, { source: undefined }),
    personalDispatch({}, { source: null }),
    personalDispatch({ headers: withoutGeneration }),
    personalDispatch({ headers: undefined }),
    personalDispatch({}, { event: 'messages.update', source: undefined }),
    personalDispatch(
      { headers: withoutGeneration },
      { event: 'messages.update' },
    ),
    personalDispatch({ url: profile.webhookUrl }),
    personalDispatch({ url: profile.webhookUrl }, { event: 'messages.update' }),
    personalDispatch({}, { instance: 'synthetic-general' }),
    personalDispatch({}, { event: 'qrcode.updated' }),
    personalDispatch({}, { event: 'messages.set' }),
    personalDispatch({}, { event: 'send.message' }),
  ])
    assert.throws(
      () => privacy.protectWebhookRequest(request, profile),
      /EVOLUTION_WEBHOOK_DESTINATION_REJECTED/u,
    );
  // The general instance keeps its own URL; the personal clause does not apply.
  const general = privacy.protectWebhookRequest(
    personalDispatch(
      { url: profile.webhookUrl, headers: {} },
      { instance: 'synthetic-general', source: undefined },
    ),
    profile,
  );
  assert.equal(general.data.apikey, undefined);
  assert.equal(general.headers['X-Silmer-Evolution-Token'], 't'.repeat(48));
});

test('WAP-T05-01 Evolution boot profile adds personal routing only for a valid literal opt-in', () => {
  const profile = { ...evolutionBoot };
  const general = privacy.validateEnvironment(profile);
  assert.equal(general.personalWebhookUrl, undefined);
  assert.equal(general.personalInstances, undefined);
  const personal = privacy.validateEnvironment({
    ...profile,
    ...evolutionControl,
  });
  assert.deepEqual(personal.personalInstances, [A]);
  assert.throws(
    () =>
      privacy.validateEnvironment({
        ...profile,
        ...evolutionControl,
        SILMER_WAP_GENERATION_INSTANCES: '',
      }),
    /WAP_CONTROL_DENIED/u,
  );
  // A non-literal flag is treated as off here; protectExpress (above) refuses it.
  assert.equal(
    privacy.validateEnvironment({
      ...profile,
      SILMER_WAP_CONTROL_ENABLED: 'TRUE',
    }).personalInstances,
    undefined,
  );
});

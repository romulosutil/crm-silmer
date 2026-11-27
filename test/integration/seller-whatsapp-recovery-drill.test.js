import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import pg from 'pg';
import { createApi } from '../../apps/api/src/app.js';
import { createAutomationAuthRuntime } from '../../apps/api/src/automation-auth-runtime.js';
import { createOperationReadRuntime } from '../../apps/api/src/operation-runtime.js';
import { createOrderApiRuntime } from '../../apps/api/src/order-runtime.js';
import { createSellerWhatsAppFirstSendRuntime } from '../../apps/api/src/seller-whatsapp-first-send-runtime.js';
import { createSellerWhatsAppRuntime } from '../../apps/api/src/seller-whatsapp-runtime.js';
import { createWhatsAppControlJobHandler } from '../../apps/worker/src/whatsapp-control-runtime.js';
import { PostgresAuditTrail } from '../../modules/audit-privacy/src/index.js';
import {
  contactPhoneHash,
  encryptContactDetails,
  setSellerClientLink,
} from '../../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../../modules/database/src/index.js';
import {
  createInboxService,
  PostgresInboxReadRepository,
  PostgresInboxRepository,
  PostgresSellerWhatsAppRepository,
  sellerWhatsAppConfiguration,
} from '../../modules/inbox-channels/src/index.js';
import {
  createWhatsAppControlClient,
  PostgresJobQueue,
} from '../../modules/integration-reliability/src/index.js';
import {
  createN8nIntegrationService,
  encryptJson,
  PostgresN8nCommandOutbox,
  PostgresN8nCommandStore,
  PostgresN8nIntegrationRepository,
  sellerWhatsAppSendConfiguration,
} from '../../modules/n8n-integration/src/index.js';
import { encryptJson as encryptOrderJson } from '../../modules/orders/src/adapters/envelope.js';
import { createSafeLogger } from '../../modules/shared/src/index.js';
import { createWhatsAppControlWorkflows } from '../../ops/n8n/whatsapp-control-workflows.mjs';

const { Client, Pool } = pg;
const { createControlAdapter } = /** @type {any} */ (
  createRequire(import.meta.url)('../../ops/evolution/wap-control-runtime.cjs')
);
const { createGenerationRuntime } = /** @type {any} */ (
  createRequire(import.meta.url)(
    '../../ops/evolution/wap-generation-runtime.cjs',
  )
);

// WAP-T05-03 (WAP-10/11/12/16/29/33): isolated LOCAL recovery drill.
// Shutdown, phased redeploy and a point-in-time snapshot restore with line,
// generation, wallet links and uncertain effects, on synthetic PostgreSQL.
// The "restore" is CREATE DATABASE ... TEMPLATE: a physical copy of a local
// snapshot. It is NOT an EasyPanel/remote restore and proves no RPO/RTO.
// Synthetic data only; no external HTTP (provider/n8n are in-process stubs).
const now = new Date('2026-11-18T12:00:00.000Z');
const key = Buffer.alloc(32, 91);
const A = 'wap-t0503-seller-a';
const B = 'wap-t0503-seller-b';
const C = 'wap-t0503-seller-c';
const ADMIN = 'wap-t0503-admin';
const CANARY = 'WAPT0503RESTORECANARY';
const NUMBER_C = '5511000000530';
const GENERAL = '5511000000599';
const webhookUrl = 'https://n8n.test/webhook/silmer/seller-whatsapp/events';
const secret = 'synthetic-recovery-secret-'.repeat(2);

const baseEnvironment = {
  FAB_CODE: '01',
  CONTACT_IDENTITY_ENVELOPE_KEY: key.toString('base64url'),
  CONTACT_IDENTITY_LOOKUP_KEY: key.toString('base64url'),
  INBOX_MESSAGE_ENVELOPE_KEY: key.toString('base64url'),
  IDEMPOTENCY_ENVELOPE_KEY: key.toString('base64url'),
  N8N_INTEGRATION_ENVELOPE_KEY: key.toString('base64url'),
  HANDOFF_ENVELOPE_KEY: key.toString('base64url'),
  OPERATION_CURSOR_HMAC_KEY: key.toString('base64url'),
  SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: contactPhoneHash(GENERAL, key),
  SELLER_WHATSAPP_WEBHOOK_URL: webhookUrl,
};

/** Per-feature allowlists; an empty list means the flag is off.
 * @param {{control?:string[],send?:string[],firstSend?:string[],clients?:string[],inbound?:string[],order?:string[]}} [on] */
function flags(on = {}) {
  /** @param {string[]|undefined} ids */
  const flag = (ids) => (ids?.length ? 'true' : 'false');
  /** @param {string[]|undefined} ids */
  const list = (ids) => JSON.stringify(ids ?? []);
  return {
    ...baseEnvironment,
    SELLER_WHATSAPP_CONTROL_ENABLED: flag(on.control),
    SELLER_WHATSAPP_SELLER_IDS: list(on.control),
    SELLER_WHATSAPP_SEND_ENABLED: flag(on.send),
    SELLER_WHATSAPP_SEND_SELLER_IDS: list(on.send),
    SELLER_WHATSAPP_FIRST_SEND_ENABLED: flag(on.firstSend),
    SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: list(on.firstSend),
    SELLER_CLIENTS_ENABLED: flag(on.clients),
    SELLER_CLIENTS_SELLER_IDS: list(on.clients),
    SELLER_WHATSAPP_INBOUND_ENABLED: flag(on.inbound),
    SELLER_WHATSAPP_INBOUND_SELLER_IDS: list(on.inbound),
    ORDER_SUBJECT_CREATION_ENABLED: flag(on.order),
    ORDER_SUBJECT_READERS_READY: flag(on.order),
    ORDER_SUBJECT_SELLER_IDS: (on.order ?? []).join(','),
  };
}
const OFF = flags();
/** @param {string[]} ids */
const ALL = (ids) =>
  flags({
    control: ids,
    send: ids,
    firstSend: ids,
    clients: ids,
    inbound: ids,
    order: ids,
  });

/** Loopback and dedicated synthetic names only, before any reset.
 * @param {string|undefined} value */
function guardedUrl(value) {
  assert.ok(value, 'Set TEST_DATABASE_URL to a synthetic crm_silmer_test_x');
  const url = new URL(value);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'loopback only',
  );
  assert.match(url.pathname, /^\/crm_silmer_test(?:_[a-z0-9]+)?$/u);
  return url;
}

/** @param {any} client @param {string} id @param {string} [fn] */
async function seedUser(client, id, fn = 'Vendedor') {
  await client.query(
    `INSERT INTO crm.users(id,email,password_hash,name)
     VALUES ($1,$2,'$argon2id$synthetic','Pessoa sintética')`,
    [id, `${id}@example.test`],
  );
  await client.query(
    'INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,$2)',
    [id, fn],
  );
}

/** Connected synthetic line with a real binding token. @param {any} client @param {string} sellerId @param {string} number */
async function seedLine(client, sellerId, number) {
  await seedUser(client, sellerId);
  const source = {
    lineId: randomUUID(),
    accountId: randomUUID(),
    bindingId: randomUUID(),
    generation: 1,
  };
  const instance = `wap_${source.lineId.replaceAll('-', '')}`;
  const token = randomBytes(32).toString('base64url');
  const digest = contactPhoneHash(number, key);
  await client.query(
    `INSERT INTO crm.seller_whatsapp_lines(id,seller_id,account_id,instance_name,
     number_digest,number_envelope,confirmed_number_envelope,state,generation,version,verified_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'connected',1,1,$8,$8,$8)`,
    [
      source.lineId,
      sellerId,
      source.accountId,
      instance,
      digest,
      encryptJson({ number }, `seller-whatsapp-number:${source.lineId}`, key),
      encryptJson(
        { number },
        `seller-whatsapp-confirmed:${source.lineId}`,
        key,
      ),
      now,
    ],
  );
  await client.query(
    `INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at)
     VALUES($1,'personal',$2,$3)`,
    [digest, source.lineId, now],
  );
  await client.query(
    `INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
     VALUES($1,$2,$3,$4,1,$5,$6,$7)`,
    [
      source.bindingId,
      source.lineId,
      source.accountId,
      instance,
      createHash('sha256').update(token).digest('hex'),
      encryptJson(
        { token },
        `seller-whatsapp-binding:${source.bindingId}`,
        key,
      ),
      now,
    ],
  );
  return { source, instance, sellerId, token, number };
}

/** @param {any} client @param {string} phone @param {string} seller */
async function seedContact(client, phone, seller) {
  const id = `contact-${randomUUID()}`;
  await client.query(
    `INSERT INTO crm.contacts(id,provisional,version,created_at,updated_at,display_name,
       display_name_source,manual_create_key,manually_created_by,contact_phone_hash,
       contact_details_envelope,wallet_created)
     VALUES($1,false,1,$2,$2,'Cliente sintético','manual',$3,$4,$5,$6::jsonb,true)`,
    [
      id,
      now,
      randomUUID(),
      seller,
      contactPhoneHash(phone, key),
      JSON.stringify(encryptContactDetails({ email: null, phone }, key)),
    ],
  );
  await client.query(
    `INSERT INTO crm.seller_client_links(id,seller_id,contact_id,provenance,source_id,status,
       version,created_by,updated_by,created_at,updated_at)
     VALUES(gen_random_uuid(),$1,$2,'manual_create',NULL,'active',1,$1,$1,$3,$3)`,
    [seller, id, now],
  );
  return id;
}

/** @param {string} id @param {string} [executionId] */
function technical(id, executionId = 'device-ingress') {
  return {
    actor: 'AUTOMATION_EXECUTOR',
    correlationId: `correlation-${id}`,
    credentialVersion: 'current',
    executionId,
    idempotencyKey: id,
    requestId: `request-${id}`,
    workflowKey:
      executionId === 'device-ingress'
        ? 'seller-whatsapp-inbound'
        : 'evolution-panel',
    workflowVersion: '1.0',
  };
}

/** Hash-of-row-hashes per crm table: comparable, no PII printed. @param {any} pool */
async function digest(pool) {
  const tables = (
    await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='crm' AND table_type='BASE TABLE' ORDER BY table_name",
    )
  ).rows.map((/** @type {any} */ r) => r.table_name);
  /** @type {Record<string,{rows:number,hash:string}>} */
  const out = {};
  for (const table of tables) {
    const row = (
      await pool.query(
        `SELECT count(*)::int AS rows, md5(coalesce(string_agg(h, ',' ORDER BY h), '')) AS hash
         FROM (SELECT md5(row_to_json(t)::text) AS h FROM crm.${table} t) s`,
      )
    ).rows[0];
    out[table] = { rows: row.rows, hash: row.hash };
  }
  return out;
}

/** Tables whose content differs between two digests. @param {any} a @param {any} b */
const changed = (a, b) =>
  Object.keys({ ...a, ...b })
    .filter((t) => a[t]?.hash !== b[t]?.hash)
    .sort();

/** Count canary hits in every text-like column of crm/crm_meta, any encoding. @param {any} pool */
async function canaryHits(pool) {
  const needles = [
    CANARY,
    Buffer.from(CANARY).toString('base64'),
    Buffer.from(CANARY).toString('base64url'),
    Buffer.from(CANARY).toString('hex'),
  ];
  const columns = (
    await pool.query(
      `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema IN ('crm','crm_meta')
         AND data_type IN ('text','character varying','character','jsonb','json','bytea','ARRAY','USER-DEFINED')
       ORDER BY 1,2,3`,
    )
  ).rows;
  let scanned = 0;
  /** @type {string[]} */
  const hits = [];
  for (const c of columns) {
    const ref = `"${c.table_schema}"."${c.table_name}"`;
    const col = `"${c.column_name}"`;
    const expr =
      c.data_type === 'bytea'
        ? `encode(${col},'escape') || encode(${col},'hex')`
        : `${col}::text`;
    const n = (
      await pool.query(
        `SELECT count(*)::int AS n FROM ${ref} WHERE ${needles
          .map((_, i) => `position($${i + 1} in ${expr})>0`)
          .join(' OR ')}`,
        needles,
      )
    ).rows[0].n;
    scanned++;
    if (n) hits.push(`${c.table_name}.${c.column_name}`);
  }
  return { scanned, hits };
}

/** Build every runtime the drill touches for one database and flag set.
 * @param {any} pool @param {Record<string,string>} environment @param {any} transport */
function runtimes(pool, environment, transport) {
  const database = {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
  const personalSendSellers = sellerWhatsAppSendConfiguration(environment);
  const inboundIds = JSON.parse(environment.SELLER_WHATSAPP_INBOUND_SELLER_IDS);
  const outbox = new PostgresN8nCommandOutbox({
    envelopeKey: key,
    personalSendSellers,
  });
  const store = new PostgresN8nCommandStore({
    database,
    envelopeKey: key,
    personalSendSellers,
  });
  const repository = new PostgresN8nIntegrationRepository({
    database,
    envelopeKey: key,
    personalInboundEnabled: inboundIds.length > 0,
    personalInboundSellerIds: inboundIds,
    personalSendSellers,
  });
  const service = createN8nIntegrationService({
    repository,
    clock: () => now,
  });
  const control = new PostgresSellerWhatsAppRepository(
    database,
    sellerWhatsAppConfiguration(environment),
  );
  const firstSend = createSellerWhatsAppFirstSendRuntime(database, {
    access: {
      authorizeRead: async () => ({ actor: null }),
      authorizeWrite: async () => ({ actor: null }),
    },
    outbox,
    environment,
    clock: () => now,
  });
  const inbox = createInboxService({
    clock: () => now,
    auditPort: new PostgresAuditTrail(database),
    repository: new PostgresInboxRepository({
      database,
      envelopeKey: key,
      outboundMessageOutbox: outbox,
    }),
  });
  const reader = new PostgresInboxReadRepository({
    database,
    contactEnvelopeKey: key,
    messageEnvelopeKey: key,
  });
  const operations = createOperationReadRuntime(database, { environment });
  /** @param {string} actorId */
  const orders = (actorId) =>
    createOrderApiRuntime(database, {
      access: {
        authorizeRead: async () => ({ actor: human(actorId) }),
        authorizeWrite: async () => ({ actor: human(actorId) }),
      },
      environment,
    });

  /** Worker → n8n → provider chain with a local stub transport.
   * @param {string} commandId @param {any} line @param {'sent'|'outcome_unknown'} [outcome] */
  async function deliver(commandId, line, outcome = 'sent') {
    const delivery = await store.loadForDelivery(commandId, { now });
    if (!delivery) return { dispatched: false };
    const executionId = randomUUID();
    assert.equal(
      await store.markProcessing(commandId, {
        now,
        attemptId: executionId,
        payloadHash: delivery.payloadHash,
      }),
      true,
    );
    const eventId = `reserve:${commandId}`;
    const reserve = {
      schema_version: '1.0',
      event_type: 'message.send.requested',
      event_id: eventId,
      occurred_at: now.toISOString(),
      source: line.source,
      command_id: commandId,
      conversation_id: delivery.payload.conversation_id,
      message: delivery.payload.message,
      source_revision: delivery.payload.source_revision,
      automation_epoch: delivery.payload.automation_epoch,
      technical: technical(eventId, executionId),
    };
    assert.equal((await service.recordEvent(reserve)).send_authorized, true);
    const preflight = await repository.readReservedSend({
      commandId,
      technical: reserve.technical,
      now,
      dispatch: true,
    });
    assert.equal(preflight.valid, true);
    // Simulated n8n candidate: refuses lines outside its own allowlist.
    if (!transport.lineIds.has(line.source.lineId))
      throw new Error('WORKFLOW_LINE_NOT_ALLOWED');
    const externalId = `provider-${randomUUID()}`;
    transport.calls.push({ instance: preflight.instance, externalId });
    if (outcome === 'outcome_unknown') {
      assert.equal(
        await store.markOutcomeUnknown(commandId, {
          attemptId: executionId,
          now,
          errorCode: 'TIMEOUT',
        }),
        true,
      );
      return { dispatched: true, externalId };
    }
    const sent = { ...reserve };
    delete (/** @type {any} */ (sent).message);
    await service.recordEvent({
      ...sent,
      event_type: 'message.sent',
      event_id: `sent:${commandId}`,
      external_message_id: externalId,
      technical: technical(`sent:${commandId}`, executionId),
    });
    assert.equal(
      await store.markDelivered(commandId, { attemptId: executionId, now }),
      true,
    );
    return { dispatched: true, externalId };
  }

  return {
    database,
    store,
    repository,
    service,
    control,
    firstSend,
    inbox,
    reader,
    operations,
    orders,
    deliver,
  };
}

/** @param {string} id */
function human(id) {
  return {
    id,
    kind: /** @type {const} */ ('human'),
    functionName: 'Vendedor',
    capabilities: id === ADMIN ? ['COMMERCIAL_ADMIN'] : [],
  };
}

test(
  'WAP-T05-03 local drill: shutdown, phased redeploy and snapshot restore stay fail-closed',
  { timeout: 300_000 },
  async (t) => {
    const sourceUrl = guardedUrl(process.env.TEST_DATABASE_URL);
    // The restore target is dropped and recreated: it must be named explicitly.
    const restoreUrl = guardedUrl(process.env.TEST_RESTORE_DATABASE_URL);
    assert.equal(restoreUrl.host, sourceUrl.host, 'same local server');
    assert.notEqual(restoreUrl.pathname, sourceUrl.pathname);
    const sourceName = sourceUrl.pathname.slice(1);
    const restoreName = restoreUrl.pathname.slice(1);
    const adminUrl = new URL(sourceUrl.href);
    adminUrl.pathname = '/postgres';

    /** @type {any} */
    let pool = new Pool({ connectionString: sourceUrl.href, max: 10 });
    /** @type {any} */
    let restored = null;
    t.after(async () => {
      await pool?.end().catch(() => {});
      await restored?.end().catch(() => {});
    });
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    const migrations = await loadMigrations();
    await migrate(pool, { migrations });
    // 0081 is a contract phase: apply only it, as the orders runbook says.
    const subjectContract = migrations.filter(
      ({ version }) => version === '0081',
    );
    await migrate(pool, {
      migrations: subjectContract,
      phase: 'contract',
    });

    const transport = {
      lineIds: new Set(/** @type {string[]} */ ([])),
      calls: /** @type {any[]} */ ([]),
    };
    /** @param {Record<string,string>} environment @param {any} [target] */
    const at = (environment, target = pool) =>
      runtimes(target, environment, transport);

    // ---------- Seller C goes through the real control/challenge chain. ----------
    const allowedLines = new Set(/** @type {string[]} */ ([]));
    const providers = new Map(); // instance -> {exists,state}
    const providerCalls = /** @type {string[]} */ ([]);
    const logs = /** @type {any[]} */ ([]);
    /** @type {any} */ let currentActor = { id: C };
    const wiring = /** @type {any} */ ({ workflows: null });
    /** @type {any} */ let adapter;
    /** @type {any} */ let api;
    /** @type {any} */ let controlRepository;
    const authorization = `Basic ${Buffer.from(`synthetic-crm:${secret}`).toString('base64')}`;
    /** @param {any} envelope @param {string} keyId @param {string} executionId */
    const technicalHeaders = (envelope, keyId, executionId) => ({
      authorization,
      'idempotency-key': keyId,
      'x-correlation-id': envelope.operationId,
      'x-silmer-workflow-key': 'seller-whatsapp-control',
      'x-silmer-workflow-version': '1.0',
      'x-silmer-execution-id': executionId,
    });
    /** Generated n8n Code nodes; reserve/results through real HTTP routes.
     * @param {any} input @param {RequestInit} [init] */
    async function syntheticN8n(input, init) {
      const kind = new URL(input).pathname.endsWith('/challenge')
        ? 'challenge'
        : 'control';
      const envelope = JSON.parse(String(init?.body));
      const executionId = randomUUID();
      const keyId =
        kind === 'challenge' ? envelope.challengeId : envelope.operationId;
      const headers = technicalHeaders(envelope, keyId, executionId);
      const verified = await api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/whatsapp-control/verify',
        headers,
        payload: { kind, envelope },
      });
      assert.equal(verified.statusCode, 200, verified.body);
      const nodes = wiring.workflows[kind].nodes;
      /** @type {Record<string,any>} */ const outputs = {};
      /** @param {string} name @param {any} value */
      const code = (name, value) =>
        new Function(
          '$json',
          '$',
          nodes.find((/** @type {any} */ n) => n.name === name).parameters
            .jsCode,
        )(value, (/** @type {string} */ target) => ({
          first: () => ({ json: outputs[target] }),
        })).json;
      outputs.Guard = code('Guard', { body: envelope });
      const reserved = await api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/whatsapp-control/operations',
        headers,
        payload: { kind, envelope: outputs.Guard },
      });
      assert.equal(reserved.statusCode, 200, reserved.body);
      outputs.Reserve = reserved.json();
      const result = await adapter.execute(code('Plan', outputs.Reserve));
      if (kind === 'challenge') return globalThis.Response.json(result);
      const projected = code('Result', result);
      const callback = await api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/whatsapp-control/results',
        headers: technicalHeaders(envelope, projected.resultId, executionId),
        payload: projected,
      });
      assert.equal(callback.statusCode, 200, callback.body);
      return globalThis.Response.json({
        accepted: true,
        operationId: envelope.operationId,
        generation: envelope.generation,
      });
    }
    /** @param {any} target @param {Record<string,string>} environment */
    function controlApi(target, environment) {
      const db = {
        query: target.query.bind(target),
        transaction: (/** @type {any} */ work) => withTransaction(target, work),
      };
      controlRepository = new PostgresSellerWhatsAppRepository(
        db,
        sellerWhatsAppConfiguration(environment),
      );
      const client = createWhatsAppControlClient({
        enabled: true,
        allowlist: (/** @type {string} */ id) => allowedLines.has(id),
        controlEndpoint:
          'https://n8n.test/webhook/silmer/seller-whatsapp/control',
        challengeEndpoint:
          'https://n8n.test/webhook/silmer/seller-whatsapp/challenge',
        clientId: 'synthetic',
        clientSecret: secret,
        fetchImpl: syntheticN8n,
      });
      const runtime = createSellerWhatsAppRuntime(db, {
        environment,
        repository: controlRepository,
        client,
        access: {
          authorizeRead: async () => ({ actor: currentActor }),
          authorizeWrite: async () => ({ actor: currentActor }),
        },
      });
      api = createApi(
        {},
        {
          logger: createSafeLogger({
            service: 'crm-silmer-api',
            sink: (record) => logs.push(record),
          }),
          sellerWhatsApp: runtime,
          automationAuth: createAutomationAuthRuntime({
            environment: {
              CRM_AUTOMATION_CLIENT_ID: 'synthetic-crm',
              CRM_AUTOMATION_CLIENT_SECRET: secret,
            },
            auditPort: { append: async () => {} },
          }),
        },
      );
      return {
        api,
        repository: controlRepository,
        handler: createWhatsAppControlJobHandler({
          repository: controlRepository,
          client,
        }),
        queue: new PostgresJobQueue({ database: db }),
      };
    }
    const human_ = () => ({
      origin: 'https://crm.test',
      cookie: 'crm_session=synthetic',
      'x-csrf-token': 'synthetic',
      'idempotency-key': randomUUID(),
    });
    /** @param {any} instance */
    function provider(instance) {
      if (!providers.has(instance))
        providers.set(instance, { exists: false, state: 'close' });
      return providers.get(instance);
    }
    /** @param {string[]} instances */
    function buildAdapter(instances) {
      const socketRuntime = createGenerationRuntime({
        enabled: true,
        instances,
      });
      adapter = createControlAdapter({
        env: {
          SILMER_WAP_CONTROL_ENABLED: 'true',
          SILMER_WAP_GENERATION_ENABLED: 'true',
          SILMER_WAP_GENERATION_INSTANCES: instances.join(','),
          SILMER_WAP_CONTROL_WEBHOOK_URL: webhookUrl,
          AUTHENTICATION_API_KEY: secret,
        },
        generationRuntime: socketRuntime,
        fetchImpl: async (
          /** @type {any} */ input,
          /** @type {any} */ init,
        ) => {
          const path = new URL(input).pathname;
          providerCalls.push(path);
          const instance = instances.find((i) => path.includes(i));
          if (path === '/instance/fetchInstances')
            return globalThis.Response.json(
              instances
                .filter((i) => provider(i).exists)
                .map((i) => ({
                  name: i,
                  connectionStatus: provider(i).state,
                  ownerJid: `${NUMBER_C}@s.whatsapp.net`,
                })),
            );
          if (path === '/instance/create') {
            provider(instances[0]).exists = true;
            return globalThis.Response.json(
              { instance: { instanceName: instances[0] }, hash: 'private' },
              { status: 201 },
            );
          }
          // WAP-E12: settings are reapplied and verified on every connect.
          if (path.startsWith('/settings/set/'))
            return globalThis.Response.json(
              { settings: { settings: JSON.parse(init.body) } },
              { status: 201 },
            );
          if (path.startsWith('/settings/find/'))
            return globalThis.Response.json({
              rejectCall: false,
              msgCall: '',
              groupsIgnore: true,
              alwaysOnline: false,
              readMessages: false,
              readStatus: false,
              syncFullHistory: false,
              wavoipToken: '',
            });
          if (path.startsWith('/webhook/find/'))
            return globalThis.Response.json({
              enabled: true,
              url: webhookUrl,
              webhookByEvents: false,
              webhookBase64: false,
              events: [
                'CONNECTION_UPDATE',
                'MESSAGES_UPSERT',
                'MESSAGES_UPDATE',
              ],
            });
          if (path.startsWith('/instance/connectionState/'))
            return globalThis.Response.json({
              instance: {
                instanceName: instance,
                state: provider(instance).state,
              },
            });
          if (path.startsWith('/instance/connect/')) {
            socketRuntime.captureSocket(instance, {});
            provider(instance).state = 'connecting';
            // The pairing code only travels the synchronous response.
            return globalThis.Response.json({ pairingCode: CANARY });
          }
          if (path.startsWith('/instance/logout/')) {
            provider(instance).state = 'close';
            return globalThis.Response.json({ success: true });
          }
          assert.match(path, /^\/webhook\/set\//u);
          return globalThis.Response.json({ success: true });
        },
      });
    }

    // ================= (A) seed the point-in-time state =================
    const S = at(ALL([A, B]));
    const lineA = await S.database.transaction((/** @type {any} */ c) =>
      seedLine(c, A, '5511000000510'),
    );
    const lineB = await S.database.transaction((/** @type {any} */ c) =>
      seedLine(c, B, '5511000000520'),
    );
    await S.database.transaction(async (/** @type {any} */ c) => {
      await seedUser(c, C);
      await seedUser(c, ADMIN);
      await c.query(
        "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
        [ADMIN],
      );
    });
    transport.lineIds = new Set([lineA.source.lineId, lineB.source.lineId]);
    const phones = {
      a1: '5511900000531',
      a2: '5511900000532',
      a3: '5511900000533',
      b1: '5511900000541',
      b2: '5511900000542',
      b3: '5511900000543',
    };
    /** @type {Record<string,string>} */
    const contacts = {};
    for (const [name, phone] of Object.entries(phones))
      contacts[name] = await S.database.transaction((/** @type {any} */ c) =>
        seedContact(c, phone, name.startsWith('a') ? A : B),
      );

    /** First individual send through the real runtime. @param {any} R @param {any} line @param {string} contactId */
    async function firstMessage(R, line, contactId) {
      const contact = (
        await pool.query('SELECT version FROM crm.contacts WHERE id=$1', [
          contactId,
        ])
      ).rows[0];
      const link = (
        await pool.query(
          'SELECT version FROM crm.seller_client_links WHERE seller_id=$1 AND contact_id=$2',
          [line.sellerId, contactId],
        )
      ).rows[0];
      const current = (
        await pool.query(
          'SELECT version,generation FROM crm.seller_whatsapp_lines WHERE id=$1',
          [line.source.lineId],
        )
      ).rows[0];
      const { preview } = await R.firstSend.preview({
        actor: { id: line.sellerId },
        contactId,
      });
      const result = await R.firstSend.send({
        actor: { id: line.sellerId, kind: 'human' },
        contactId,
        text: 'Mensagem sintética do ensaio',
        expectedContactVersion: Number(contact.version),
        expectedLinkVersion: Number(link.version),
        expectedLineVersion: Number(current.version),
        expectedGeneration: Number(current.generation),
        expectedConversation: preview.conversation,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      });
      const command = (
        await pool.query('SELECT command_id FROM crm.messages WHERE id=$1', [
          result.body.message.id,
        ])
      ).rows[0].command_id;
      return {
        conversationId: result.body.conversation.id,
        messageId: result.body.message.id,
        commandId: command,
      };
    }
    /** @param {string} id */
    const commandState = async (id) =>
      (
        await pool.query(
          `SELECT c.status, c.whatsapp_dispatched_at IS NOT NULL AS dispatched, m.status AS message
           FROM crm.n8n_commands c JOIN crm.messages m ON m.id=c.message_id WHERE c.command_id=$1`,
          [id],
        )
      ).rows[0];

    const a1 = await firstMessage(S, lineA, contacts.a1);
    await S.deliver(a1.commandId, lineA);
    const a2 = await firstMessage(S, lineA, contacts.a2);
    await S.deliver(a2.commandId, lineA, 'outcome_unknown');
    const a3 = await firstMessage(S, lineA, contacts.a3); // stays queued
    const b1 = await firstMessage(S, lineB, contacts.b1);
    await S.deliver(b1.commandId, lineB);
    const b2 = await firstMessage(S, lineB, contacts.b2);
    await S.deliver(b2.commandId, lineB);
    assert.equal(transport.calls.length, 4);
    assert.deepEqual(await commandState(a2.commandId), {
      status: 'outcome_unknown',
      dispatched: true,
      message: 'outcome_unknown',
    });
    assert.deepEqual(await commandState(a3.commandId), {
      status: 'pending',
      dispatched: false,
      message: 'queued',
    });

    // Two order targets on one personal conversation (post-0081 model).
    /** @param {string} id @param {string} conv */
    async function subject(id, conv) {
      await pool.query(
        `INSERT INTO crm.conversation_subjects(id,conversation_id,contact_id,order_id,kind,position,is_current,created_by,created_by_kind,created_at,updated_at)
         SELECT $1,$2,identity.current_contact_id,NULL,'geral',
           (SELECT COALESCE(max(position),0)+1 FROM crm.conversation_subjects WHERE conversation_id=$2),false,$3,'human',$4,$4
         FROM crm.contact_identities identity JOIN crm.conversations c ON c.contact_identity_id=identity.id WHERE c.id=$2`,
        [id, conv, A, now],
      );
      await pool.query(
        `INSERT INTO crm.subject_briefings(subject_id,version,envelope,updated_at) VALUES($1,1,$2::jsonb,$3)`,
        [
          id,
          JSON.stringify(
            encryptOrderJson(
              { order_name: `Alvo ${id}` },
              `n8n-subject-briefing:${id}:1`,
              key,
            ),
          ),
          now,
        ],
      );
    }
    const targetA = `subject-${randomUUID()}`;
    const targetB = `subject-${randomUUID()}`;
    await subject(targetA, a1.conversationId);
    await subject(targetB, a1.conversationId);
    /** @param {any} R @param {string} actor @param {string} conv @param {string} target */
    async function orderFor(R, actor, conv, target) {
      const version = Number(
        (
          await pool.query(
            'SELECT version FROM crm.conversations WHERE id=$1',
            [conv],
          )
        ).rows[0].version,
      );
      const subjectVersion = Number(
        (
          await pool.query(
            'SELECT version FROM crm.conversation_subjects WHERE id=$1',
            [target],
          )
        ).rows[0].version,
      );
      return R.orders(actor).createManual({
        actor: human(actor),
        conversationId: conv,
        expectedVersion: version,
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        subjectId: target,
        expectedSubjectVersion: subjectVersion,
      });
    }
    const orderA = (await orderFor(S, A, a1.conversationId, targetA)).order;
    const orderB = (await orderFor(S, A, a1.conversationId, targetB)).order;
    assert.notEqual(orderA.id, orderB.id);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM crm.orders WHERE conversation_id=$1 AND status='pendente' AND origin_subject_id IS NOT NULL",
          [a1.conversationId],
        )
      ).rows[0].n,
      2,
    );

    // Seller C: real connect + pairing challenge whose code is the canary.
    let C_ = controlApi(pool, ALL([C]));
    currentActor = { id: C };
    const connected = await C_.api.inject({
      method: 'POST',
      url: '/api/v1/me/whatsapp/connect',
      headers: human_(),
      payload: { expectedNumber: NUMBER_C, expectedVersion: 0 },
    });
    assert.equal(connected.statusCode, 202, connected.body);
    const lineC = connected.json().line.id;
    allowedLines.add(lineC);
    const instanceC = (
      await pool.query(
        'SELECT instance_name FROM crm.seller_whatsapp_lines WHERE id=$1',
        [lineC],
      )
    ).rows[0].instance_name;
    wiring.workflows = createWhatsAppControlWorkflows({
      enabled: true,
      allowlist: [lineC],
      crmBaseUrl: 'https://crm.test',
      evolutionBaseUrl: 'https://evolution.test',
      webhookCredentialId: 'synthetic',
      crmCredentialId: 'synthetic',
      evolutionCredentialId: 'synthetic',
    });
    buildAdapter([instanceC]);
    const [prepareJob] = await C_.queue.claim({
      queue: 'whatsapp_control',
      workerId: 'synthetic',
      limit: 5,
    });
    assert.equal(
      (await C_.handler(prepareJob, { markEffectStarted: async () => true }))
        .outcome,
      'sent',
    );
    let currentC = await C_.repository.get({ actorId: C });
    assert.equal(currentC.line.state, 'awaiting_pairing');
    const challenged = await C_.api.inject({
      method: 'POST',
      url: '/api/v1/me/whatsapp/pairing-challenge',
      headers: human_(),
      payload: {
        operationId: currentC.operation.id,
        expectedVersion: currentC.line.version,
        generation: currentC.line.generation,
        mode: 'code',
      },
    });
    assert.equal(challenged.statusCode, 200, challenged.body);
    assert.equal(challenged.json().value, CANARY, 'only the titular sees it');
    await C_.api.close();
    // Pairing never confirmed: the challenge is still in flight at backup.
    assert.equal(
      (
        await pool.query(
          'SELECT state FROM crm.seller_whatsapp_challenges WHERE line_id=$1',
          [lineC],
        )
      ).rows[0].state,
      'delivered',
    );

    const before = await digest(pool);
    t.diagnostic(
      `before: ${JSON.stringify(
        Object.fromEntries(
          [
            'seller_whatsapp_lines',
            'seller_whatsapp_bindings',
            'seller_whatsapp_challenges',
            'seller_client_links',
            'conversations',
            'messages',
            'n8n_commands',
            'reconciliation_items',
            'orders',
          ].map((k) => [k, before[k].rows]),
        ),
      )}`,
    );
    assert.deepEqual((await canaryHits(pool)).hits, []);

    // ---- Backup point: local physical snapshot of the synthetic database. ----
    await pool.end();
    {
      const admin = new Client({ connectionString: adminUrl.href });
      await admin.connect();
      try {
        await admin.query(
          `DROP DATABASE IF EXISTS ${restoreName} WITH (FORCE)`,
        );
        await admin.query(
          `CREATE DATABASE ${restoreName} TEMPLATE ${sourceName}`,
        );
      } finally {
        await admin.end();
      }
    }
    pool = new Pool({ connectionString: sourceUrl.href, max: 10 });

    // ---- Post-backup history on the live database (lost by an old restore). ----
    const live = at(ALL([A, B, C]));
    const q1 = await live.deliver(a3.commandId, lineA); // provider got it
    assert.equal(q1.dispatched, true);
    const disconnectA = await live.control.submit({
      action: 'disconnect',
      actorId: A,
      expectedVersion: 1,
      expectedGeneration: 1,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    });
    assert.equal(disconnectA.line.state, 'disconnecting');
    assert.equal(disconnectA.line.generation, 2);
    /** @param {any} target @param {string} contactId @param {number} version */
    async function revokeLink(target, contactId, version) {
      return withTransaction(target, (/** @type {any} */ tx) =>
        setSellerClientLink(
          tx,
          {
            actor: { id: ADMIN, isAdmin: true },
            sellerId: B,
            contactId,
            provenance: 'manual_create',
            state: 'revoked',
            expectedVersion: version,
            correlationId: randomUUID(),
            now: now.toISOString(),
          },
          new PostgresAuditTrail({ query: target.query.bind(target) }),
        ),
      );
    }
    await revokeLink(pool, contacts.b2, 1);
    const conversationB1 = (
      await pool.query('SELECT version FROM crm.conversations WHERE id=$1', [
        b1.conversationId,
      ])
    ).rows[0];
    const q2 = await live.inbox.sendHumanMessage({
      actor: human(B),
      conversationId: b1.conversationId,
      expectedVersion: Number(conversationB1.version),
      messageType: 'text',
      content: { text: 'Resposta sintética pós-backup' },
      correlationId: `send-${randomUUID()}`,
      idempotencyKey: `send-q2-${randomUUID()}`,
      reason: 'synthetic',
    });
    const q2Command = (
      await pool.query('SELECT command_id FROM crm.messages WHERE id=$1', [
        q2.id,
      ])
    ).rows[0].command_id;
    const liveAfterHistory = await digest(pool);

    // ================= (B) shutdown: every flag off =================
    await t.test(
      'B. shutdown refuses connect, challenge, sends, first send and order creation fail-closed',
      async () => {
        const off = at(OFF);
        const callsBefore = transport.calls.length;
        const ledgerBefore = await digest(pool);
        C_ = controlApi(pool, OFF);
        for (const actor of [A, B, C]) {
          currentActor = { id: actor };
          const refused = await C_.api.inject({
            method: 'POST',
            url: '/api/v1/me/whatsapp/connect',
            headers: human_(),
            payload: { expectedNumber: NUMBER_C, expectedVersion: 0 },
          });
          assert.equal(refused.statusCode, 503);
          assert.equal(refused.json().code, 'WHATSAPP_CONTROL_DISABLED');
        }
        currentActor = { id: C };
        currentC = await C_.repository.get({ actorId: C });
        assert.equal(currentC.available, false);
        const challenge = await C_.api.inject({
          method: 'POST',
          url: '/api/v1/me/whatsapp/pairing-challenge',
          headers: human_(),
          payload: {
            operationId: currentC.operation.id,
            expectedVersion: currentC.line.version,
            generation: currentC.line.generation,
            mode: 'qr',
          },
        });
        assert.equal(challenge.statusCode, 503);
        assert.equal(challenge.body.includes(CANARY), false);
        await C_.api.close();
        assert.deepEqual(await off.control.scheduleReconciliations(), {
          scheduled: 0,
        });

        await assert.rejects(
          off.firstSend.preview({ actor: { id: B }, contactId: contacts.b3 }),
          { code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED' },
        );
        const conversation = (
          await pool.query(
            'SELECT version FROM crm.conversations WHERE id=$1',
            [b1.conversationId],
          )
        ).rows[0];
        await assert.rejects(
          off.inbox.sendHumanMessage({
            actor: human(B),
            conversationId: b1.conversationId,
            expectedVersion: Number(conversation.version),
            messageType: 'text',
            content: { text: 'Bloqueada' },
            correlationId: randomUUID(),
            idempotencyKey: `send-off-${randomUUID()}`,
            reason: 'synthetic',
          }),
          { code: 'WHATSAPP_SEND_UNAVAILABLE' },
        );
        await assert.rejects(orderFor(off, A, a1.conversationId, targetA), {
          code: 'ORDER_SUBJECT_UNAVAILABLE',
        });

        // Worker pass with send off: the queued command is never dispatched.
        assert.equal(await off.store.loadForDelivery(q2Command, { now }), null);
        assert.deepEqual(await commandState(q2Command), {
          status: 'failed',
          dispatched: false,
          message: 'failed',
        });
        // outcome_unknown is never retried and keeps its open reconciliation.
        assert.equal(
          await off.store.loadForDelivery(a2.commandId, { now }),
          null,
        );
        assert.equal(
          await off.store.markProcessing(a2.commandId, {
            now,
            attemptId: randomUUID(),
          }),
          false,
        );
        assert.equal(
          (await commandState(a2.commandId)).status,
          'outcome_unknown',
        );
        assert.equal(transport.calls.length, callsBefore);

        // Personal ACL survives the shutdown, including a disconnected titular.
        const history = await off.reader.get(a1.conversationId, {
          actorId: A,
        });
        assert.equal(history.id ?? history.conversation?.id, a1.conversationId);
        await off.reader.assertReadable(b1.conversationId, { actorId: B });
        await assert.rejects(
          off.reader.assertReadable(a1.conversationId, { actorId: B }),
        );
        await assert.rejects(
          off.reader.assertReadable(b2.conversationId, { actorId: B }),
        );
        const wallet = at(flags({ clients: [A, B] }));
        const mine = await wallet.operations.listMyClients(
          {},
          { actorId: A, capabilities: [] },
        );
        assert.deepEqual(
          mine.items.map((/** @type {any} */ i) => i.id).sort(),
          [contacts.a1, contacts.a2, contacts.a3].sort(),
        );
        await assert.rejects(
          off.operations.listMyClients({}, { actorId: A, capabilities: [] }),
          { code: 'SELLER_CLIENTS_DISABLED' },
        );
        // Only the failed-closed queued command and its delivery event moved.
        const after = await digest(pool);
        for (const table of [
          'seller_client_links',
          'seller_whatsapp_lines',
          'seller_whatsapp_bindings',
          'seller_whatsapp_challenges',
          'seller_whatsapp_operations',
          'seller_whatsapp_revocations',
          'seller_whatsapp_results',
          'orders',
          'conversation_subjects',
          'reconciliation_items',
          'idempotency_records',
          'contact_identities',
        ])
          assert.deepEqual(after[table], ledgerBefore[table], table);
        t.diagnostic(`B changed: ${changed(ledgerBefore, after).join(',')}`);
      },
    );

    // ============ (C) phased redeploy on the live database ============
    await t.test(
      'C. migrations and API first, then workflows, then flags per allowlist',
      async () => {
        const calls = () => transport.calls.length;
        const start = calls();
        // 1. Migrations are idempotent expand steps; runtimes start with flags off.
        await migrate(pool, { migrations });
        const versions = await pool.query(
          'SELECT version FROM crm_meta.schema_migrations ORDER BY version',
        );
        assert.deepEqual(
          versions.rows.map(
            (/** @type {{version:string}} */ row) => row.version,
          ),
          [
            ...migrations.filter(({ phase }) => phase === 'expand'),
            ...subjectContract,
          ]
            .map(({ version }) => version)
            .sort(),
        );
        let R = at(OFF);
        assert.equal(
          await R.store.loadForDelivery(a2.commandId, { now }),
          null,
        );
        // 2. Workflow candidates installed (simulated): no line allowed yet.
        transport.lineIds = new Set();
        const b3 = await (async () => {
          // API still off: first send refused before the workflow allows lines.
          await assert.rejects(
            R.firstSend.preview({ actor: { id: B }, contactId: contacts.b3 }),
            { code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED' },
          );
          transport.lineIds = new Set([lineB.source.lineId]);
          // Workflow now allows B, but API/worker flags are still off.
          await assert.rejects(
            R.firstSend.preview({ actor: { id: B }, contactId: contacts.b3 }),
            { code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED' },
          );
          assert.equal(calls(), start);
          // 3a. Send + inbound + clients for B only. First send/order still off.
          R = at(flags({ send: [B], inbound: [B], clients: [B] }));
          await assert.rejects(
            R.firstSend.preview({ actor: { id: B }, contactId: contacts.b3 }),
            { code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED' },
          );
          await assert.rejects(orderFor(R, A, a1.conversationId, targetA), {
            code: 'ORDER_SUBJECT_UNAVAILABLE',
          });
          const conversation = (
            await pool.query(
              'SELECT version FROM crm.conversations WHERE id=$1',
              [b1.conversationId],
            )
          ).rows[0];
          const reply = await R.inbox.sendHumanMessage({
            actor: human(B),
            conversationId: b1.conversationId,
            expectedVersion: Number(conversation.version),
            messageType: 'text',
            content: { text: 'Resposta após a fase 3' },
            correlationId: randomUUID(),
            idempotencyKey: `send-c3-${randomUUID()}`,
            reason: 'synthetic',
          });
          const replyCommand = (
            await pool.query(
              'SELECT command_id FROM crm.messages WHERE id=$1',
              [reply.id],
            )
          ).rows[0].command_id;
          assert.equal((await R.deliver(replyCommand, lineB)).dispatched, true);
          assert.equal(calls(), start + 1);
          // A is not allowlisted and its generation was revoked.
          const conversationA = (
            await pool.query(
              'SELECT version FROM crm.conversations WHERE id=$1',
              [a1.conversationId],
            )
          ).rows[0];
          await assert.rejects(
            R.inbox.sendHumanMessage({
              actor: human(A),
              conversationId: a1.conversationId,
              expectedVersion: Number(conversationA.version),
              messageType: 'text',
              content: { text: 'Bloqueada' },
              correlationId: randomUUID(),
              idempotencyKey: `send-c3a-${randomUUID()}`,
              reason: 'synthetic',
            }),
            { code: 'WHATSAPP_SEND_UNAVAILABLE' },
          );
          // 3b. First send for B.
          R = at(
            flags({ send: [B], inbound: [B], clients: [B], firstSend: [B] }),
          );
          const first = await firstMessage(R, lineB, contacts.b3);
          assert.equal(calls(), start + 1, 'queued, not yet dispatched');
          assert.equal(
            (await R.deliver(first.commandId, lineB)).dispatched,
            true,
          );
          assert.equal(calls(), start + 2);
          return first;
        })();
        assert.ok(b3.conversationId);
        // 3c. Orders by subject for A (online state is not a dependency).
        R = at(flags({ order: [A] }));
        const replay = await orderFor(R, A, a1.conversationId, targetA);
        assert.equal(replay.order.id, orderA.id, 'pending target is reused');
        // outcome_unknown was never retried along the whole sequence.
        assert.equal(
          (await commandState(a2.commandId)).status,
          'outcome_unknown',
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM crm.reconciliation_items r JOIN crm.outbox_jobs j ON j.id=r.job_id WHERE j.n8n_command_id=$1 AND r.status='open'",
              [a2.commandId],
            )
          ).rows[0].n,
          1,
        );
      },
    );

    // ================= (D) restore the snapshot =================
    // The live database never stored the pairing code either.
    assert.deepEqual((await canaryHits(pool)).hits, []);
    await pool.end();
    pool = null;
    restored = new Pool({ connectionString: restoreUrl.href, max: 10 });
    pool = restored; // helpers above read through `pool`
    transport.lineIds = new Set([lineA.source.lineId, lineB.source.lineId]);
    const restoreCalls = transport.calls.length;

    await t.test(
      'D1. restored snapshot equals the backup digest and holds no challenge bytes',
      async () => {
        const image = await digest(restored);
        assert.deepEqual(image, before, 'physical snapshot is exact');
        // Post-backup facts the restore lost (they existed only on the live DB).
        const lost = changed(before, liveAfterHistory);
        t.diagnostic(`lost by restore: ${lost.join(',')}`);
        for (const table of [
          'seller_whatsapp_lines',
          'seller_whatsapp_bindings',
          'seller_client_links',
          'n8n_commands',
        ])
          assert.ok(lost.includes(table), table);
        const scan = await canaryHits(restored);
        assert.ok(scan.scanned > 100, `scanned ${scan.scanned} columns`);
        assert.deepEqual(scan.hits, []);
        t.diagnostic(`canary scan: ${scan.scanned} columns, 0 hits`);
        assert.equal(JSON.stringify(logs).includes(CANARY), false);
      },
    );

    await t.test(
      'D2. with flags off the restored database dispatches nothing',
      async () => {
        const off = at(OFF, restored);
        await assert.rejects(
          off.firstSend.preview({ actor: { id: A }, contactId: contacts.a1 }),
          { code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED' },
        );
        await assert.rejects(orderFor(off, A, a1.conversationId, targetA), {
          code: 'ORDER_SUBJECT_UNAVAILABLE',
        });
        assert.deepEqual(await off.control.scheduleReconciliations(), {
          scheduled: 0,
        });
        assert.equal(
          await off.store.loadForDelivery(a2.commandId, { now }),
          null,
        );
        assert.equal(transport.calls.length, restoreCalls);
      },
    );

    await t.test(
      'D3. FINDING: before reconciliation the restored rows re-authorize revoked state',
      async () => {
        // Non-mutating probes with every flag on, as if re-enabled too early.
        const on = at(ALL([A, B, C]), restored);
        // The command the provider already delivered after the backup is
        // deliverable again (duplicate risk): nothing in the row says otherwise.
        assert.deepEqual(await commandState(a3.commandId), {
          status: 'pending',
          dispatched: false,
          message: 'queued',
        });
        assert.ok(await on.store.loadForDelivery(a3.commandId, { now }));
        // Generation 1 of A was revoked after the backup; the restored line
        // still says connected, so first send is available on it.
        const preview = (
          await on.firstSend.preview({
            actor: { id: A },
            contactId: contacts.a1,
          })
        ).preview;
        assert.equal(preview.restriction, null);
        // A late callback from the revoked generation is accepted again.
        const ingress = await on.control.verifyIngress({
          source: lineA.source,
          token: lineA.token,
          instance: lineA.instance,
        });
        assert.equal(ingress.source.generation, 1);
        // The revoked wallet link is active again: B reads b2 even with
        // every flag off, because read ACL is data, not configuration.
        await at(OFF, restored).reader.assertReadable(b2.conversationId, {
          actorId: B,
        });
        assert.equal(transport.calls.length, restoreCalls);
      },
    );

    await t.test(
      'D4. runbook reconciliation re-applies revocations through real paths, then re-enable stays fenced',
      async () => {
        // a) Line revocation re-issued by the titular command (local, immediate).
        const controlA = at(flags({ control: [A] }), restored);
        const redo = await controlA.control.submit({
          action: 'disconnect',
          actorId: A,
          expectedVersion: 1,
          expectedGeneration: 1,
          idempotencyKey: randomUUID(),
          correlationId: randomUUID(),
        });
        assert.equal(redo.line.state, 'disconnecting');
        assert.equal(redo.line.generation, 2);
        // b) Wallet revocation re-applied by the Admin.
        await revokeLink(restored, contacts.b2, 1);
        // c) Queued command reconciled fail-closed by a worker pass, send off.
        const off = at(OFF, restored);
        assert.equal(
          await off.store.loadForDelivery(a3.commandId, { now }),
          null,
        );
        assert.deepEqual(await commandState(a3.commandId), {
          status: 'failed',
          dispatched: false,
          message: 'failed',
        });
        // d) The in-flight challenge is never resumed or regenerated.
        C_ = controlApi(restored, flags({ control: [C] }));
        currentActor = { id: C };
        currentC = await C_.repository.get({ actorId: C });
        const again = await C_.api.inject({
          method: 'POST',
          url: '/api/v1/me/whatsapp/pairing-challenge',
          headers: human_(),
          payload: {
            operationId: currentC.operation.id,
            expectedVersion: currentC.line.version,
            generation: currentC.line.generation,
            mode: 'code',
          },
        });
        assert.equal(again.statusCode, 409);
        assert.equal(again.json().code, 'WHATSAPP_OPERATION_UNCERTAIN');
        assert.equal(again.body.includes(CANARY), false);
        // Boot sweep one minute later (repository clock), read-only.
        const sweeper = new PostgresSellerWhatsAppRepository(
          {
            query: restored.query.bind(restored),
            transaction: (/** @type {any} */ w) => withTransaction(restored, w),
          },
          {
            ...sellerWhatsAppConfiguration(flags({ control: [C] })),
            clock: () => new Date(Date.now() + 60_000),
          },
        );
        // A reconcile already queued at backup time is not duplicated.
        const scheduled = await sweeper.scheduleReconciliations({
          staleAfterMs: 1000,
        });
        assert.equal(scheduled.scheduled, 0);
        // Worker boot one hour later: the restored in-flight prepare is
        // classified, never re-run; only the read-only reconcile is claimable.
        const claimed = await new PostgresJobQueue({
          database: {
            query: restored.query.bind(restored),
            transaction: (/** @type {any} */ w) => withTransaction(restored, w),
          },
        }).claim({
          queue: 'whatsapp_control',
          workerId: 'drill-boot',
          limit: 10,
          now: new Date(Date.now() + 3_600_000),
        });
        assert.deepEqual(
          claimed
            .filter(
              (/** @type {any} */ j) =>
                j.whatsappOperationId === currentC.operation.id,
            )
            .map((/** @type {any} */ j) => j.jobType),
          ['whatsapp.control.reconcile'],
        );
        const prepare = (
          await restored.query(
            "SELECT status FROM crm.outbox_jobs WHERE whatsapp_operation_id=$1 AND job_type='whatsapp.control.deliver'",
            [currentC.operation.id],
          )
        ).rows.map((/** @type {any} */ r) => r.status);
        assert.equal(prepare.length, 1);
        assert.ok(
          !['pending', 'retry', 'processing'].includes(prepare[0]),
          prepare[0],
        );
        t.diagnostic(`restored in-flight prepare job -> ${prepare[0]}`);
        await C_.api.close();

        // Re-enable everything: the reconciled rows now fence every path.
        const on = at(ALL([A, B, C]), restored);
        const preview = (
          await on.firstSend.preview({
            actor: { id: A },
            contactId: contacts.a1,
          })
        ).preview;
        assert.equal(preview.restriction, 'line_unavailable');
        assert.equal(
          await on.store.loadForDelivery(a3.commandId, { now }),
          null,
        );
        assert.equal(
          await on.store.loadForDelivery(a2.commandId, { now }),
          null,
        );
        await assert.rejects(
          on.control.verifyIngress({
            source: lineA.source,
            token: lineA.token,
            instance: lineA.instance,
          }),
          { code: 'FORBIDDEN' },
        );
        await assert.rejects(
          on.reader.assertReadable(b2.conversationId, { actorId: B }),
        );
        await on.reader.assertReadable(b1.conversationId, { actorId: B });
        const history = await on.reader.get(a1.conversationId, { actorId: A });
        assert.equal(history.id ?? history.conversation?.id, a1.conversationId);
        assert.equal(transport.calls.length, restoreCalls);

        // Carteira, ledger, uncertain effects and order snapshots preserved.
        const after = await digest(restored);
        for (const table of [
          'orders',
          'conversation_subjects',
          'subject_briefings',
          'contact_identities',
          'contacts',
          'seller_whatsapp_results',
        ])
          assert.deepEqual(after[table], before[table], table);
        // The uncertain send keeps its open item; the boot classification of
        // the restored in-flight prepare adds one more, it never removes one.
        assert.equal(
          (
            await restored.query(
              "SELECT count(*)::int AS n FROM crm.reconciliation_items r JOIN crm.outbox_jobs j ON j.id=r.job_id WHERE j.n8n_command_id=$1 AND r.status='open'",
              [a2.commandId],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          after.reconciliation_items.rows,
          before.reconciliation_items.rows + 1,
        );
        for (const table of Object.keys(before))
          assert.ok(after[table].rows >= before[table].rows, `${table} kept`);
        const links = (
          await restored.query(
            'SELECT contact_id,status,version FROM crm.seller_client_links ORDER BY contact_id',
          )
        ).rows;
        assert.deepEqual(
          links
            .filter((/** @type {any} */ l) => l.status !== 'active')
            .map((/** @type {any} */ l) => [l.contact_id, Number(l.version)]),
          [[contacts.b2, 2]],
        );
        assert.equal(
          (await commandState(a2.commandId)).status,
          'outcome_unknown',
        );
        t.diagnostic(
          `D4 changed vs backup: ${changed(before, after).join(',')}`,
        );
      },
    );
  },
);

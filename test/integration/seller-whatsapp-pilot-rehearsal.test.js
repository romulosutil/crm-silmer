import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import pg from 'pg';
import { createChatMediaApiRuntime } from '../../apps/api/src/chat-media-runtime.js';
import { createIdentityApiRuntime } from '../../apps/api/src/identity-runtime.js';
import { createN8nApiRuntime } from '../../apps/api/src/n8n-runtime.js';
import { createOperationReadRuntime } from '../../apps/api/src/operation-runtime.js';
import { createSellerWhatsAppRuntime } from '../../apps/api/src/seller-whatsapp-runtime.js';
import { createServerApi } from '../../apps/api/src/server.js';
import { createWhatsAppControlJobHandler } from '../../apps/worker/src/whatsapp-control-runtime.js';
import { WorkerRuntime } from '../../apps/worker/src/worker.js';
import { contactPhoneHash } from '../../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../../modules/database/src/index.js';
import { hashPassword } from '../../modules/identity-access/src/index.js';
import {
  PostgresSellerWhatsAppRepository,
  sellerWhatsAppConfiguration,
} from '../../modules/inbox-channels/src/index.js';
import {
  ChatMediaValidator,
  createN8nCommandJobHandler,
  createWhatsAppControlClient,
  N8N_COMMAND_JOB_TYPE,
  N8N_COMMAND_QUEUE,
  PostgresChatMediaUploadRepository,
  PostgresJobQueue,
} from '../../modules/integration-reliability/src/index.js';
import {
  PostgresN8nCommandStore,
  sellerWhatsAppSendConfiguration,
} from '../../modules/n8n-integration/src/index.js';
import { encryptJson as encryptOrderJson } from '../../modules/orders/src/adapters/envelope.js';
import { createSafeLogger } from '../../modules/shared/src/index.js';
import { createWhatsAppControlWorkflows } from '../../ops/n8n/whatsapp-control-workflows.mjs';

const { Pool } = pg;
const { createControlAdapter } = /** @type {any} */ (
  createRequire(import.meta.url)('../../ops/evolution/wap-control-runtime.cjs')
);
const { createGenerationRuntime } = /** @type {any} */ (
  createRequire(import.meta.url)(
    '../../ops/evolution/wap-generation-runtime.cjs',
  )
);

// WAP-E12 / WAP-T05-05, WAP-T05-06, WAP-T05-07: LOCAL, SYNTHETIC rehearsal
// of the stage-1 pilot script (one ordered roteiro, one shared setup).
//
// Fully driven, end to end in-process:
// - every human step goes through createServerApi with real sessions
//   (POST /api/v1/sessions), Origin and CSRF, so ACL is the production ACL;
// - every n8n step goes through the technical HTTP routes with the Basic
//   AUTOMATION_EXECUTOR credential (inbound, events, preflight, media,
//   whatsapp-control verify/operations/results);
// - pairing (T05-06) runs API -> outbox job -> worker handler -> client ->
//   generated n8n Code nodes -> real Evolution control/generation adapters,
//   with QR and code modalities, TTL expiry, renewal, replay, disconnect and
//   reconnect (new generation). Only the Evolution HTTP endpoints are stubs.
// - the worker side of personal sends uses PostgresN8nCommandStore, the same
//   store the worker process uses; the provider is a recording stub transport.
//
// Seeded, and why:
// - users/passwords (no Admin bootstrap is needed for the script);
// - the two CONFIRMED Pedidos used for the ficha/PDF send (T05-07 billing)
//   and the 4c race probe: confirmation needs a complete commercial ficha
//   that the pilot script does not exercise. They are inserted on A's real
//   conversation like test/support/order-billing-chat-fixture.js (E08). All
//   pending Pedidos are created through the real HTTP route.
// - the phone shown on QR/code is never typed: the pairing is simulated by the
//   provider stub reporting `open` with the expected ownerJid.
//
// Contract notes this rehearsal makes explicit:
// - a Contact born on A's personal line is private to A (contactVisible): B
//   cannot link it and registering its phone conflicts without candidates.
//   The SAME Contact shared by A and B (T05-07) is therefore a common Clientes
//   Contact that both link explicitly, as ADR 090 and the E03 runbook allow.
// - B reading A's Pedido by direct ID follows the PO rule of 18/11/2026
//   (WAP-07/08): the order of A's private client is not found for B, by id,
//   in the list and by its number; conversation, Subject, receipt and edits
//   stay denied.
// - an Inbox reply after an outcome_unknown send is a NEW command (the
//   "1 unsettled send" limit is the first-send pendingSend); the uncertain
//   command is never re-dispatched.
// - subtests 4b, 4c and 5b are regressions for the E12 findings E12-1/2/3
//   (validation-piloto.md), kept outside the roteiro; 4c is a lock-order race
//   whose deterministic proof lives in chat-media-upload-postgres-live.
//
// It does NOT prove: a real Evolution/Baileys provider, a real phone, the
// code-on-the-same-phone flow, the real n8n runtime/persistence, the JID of a
// real reply, EasyPanel, remote RustFS/ClamAV, production capacity or RPO/RTO.
const key = Buffer.alloc(32, 91); // equals the E08 order fixture key
const secret = key.toString('base64url');
const automationSecret = 'synthetic n8n credential for WAP E12 rehearsal';
const controlSecret = 'synthetic-wap-e12-control-secret-'.repeat(2);
const origin = 'http://127.0.0.1:4372';
const A = 'wap-e12-seller-a';
const B = 'wap-e12-seller-b';
const C = 'wap-e12-seller-c';
const password = 'synthetic WAP E12 rehearsal password';
const NA = '5511000001201';
const NB = '5511000001202';
const NB2 = '5511000001203';
const GENERAL = '5511000001299';
const PX = '5511900001211'; // passive customer, A's line only
const P2 = '5511900001212'; // common Clientes customer shared by A and B
const CODE_CANARY = 'WAPE12CODECANARY';
const QR_CANARY = 'WAPE12QRCANARY';
const QR_VALUE = `data:image/png;base64,${Buffer.from(QR_CANARY).toString('base64')}`;
const webhookUrl = 'https://n8n.test/webhook/silmer/seller-whatsapp/events';

/** Per-feature allowlists; an empty list means the flag is off.
 * @param {string[]} [ids] @param {Record<string,string>} [extra] */
function flags(ids = [], extra = {}) {
  const on = ids.length ? 'true' : 'false';
  const list = JSON.stringify(ids);
  return {
    APP_ENV: 'development',
    APP_ORIGIN: origin,
    AUTH_THROTTLE_HMAC_KEY: secret,
    IDENTITY_BOOTSTRAP_TOKEN: 'synthetic unused WAP E12 bootstrap token',
    IDEMPOTENCY_ENVELOPE_KEY: secret,
    CONTACT_IDENTITY_ENVELOPE_KEY: secret,
    CONTACT_IDENTITY_LOOKUP_KEY: secret,
    DEAL_ENVELOPE_KEY: secret,
    HANDOFF_ENVELOPE_KEY: secret,
    INBOX_MESSAGE_ENVELOPE_KEY: secret,
    N8N_INTEGRATION_ENVELOPE_KEY: secret,
    OPERATION_CURSOR_HMAC_KEY: secret,
    FAB_CODE: '01',
    CRM_AUTOMATION_CLIENT_ID: 'wap-e12-synthetic-n8n',
    CRM_AUTOMATION_CLIENT_SECRET: automationSecret,
    N8N_INTEGRATION_ENABLED: 'true',
    PRIVATE_MEDIA_MAX_BYTES: String(16 * 1024 * 1024),
    PRIVATE_MEDIA_MAX_FILE_BYTES: String(4 * 1024 * 1024),
    SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: contactPhoneHash(GENERAL, key),
    SELLER_WHATSAPP_WEBHOOK_URL: webhookUrl,
    SELLER_WHATSAPP_CONTROL_ENABLED: on,
    SELLER_WHATSAPP_SELLER_IDS: list,
    SELLER_CLIENTS_ENABLED: on,
    SELLER_CLIENTS_SELLER_IDS: list,
    SELLER_WHATSAPP_INBOUND_ENABLED: on,
    SELLER_WHATSAPP_INBOUND_SELLER_IDS: list,
    SELLER_WHATSAPP_SEND_ENABLED: on,
    SELLER_WHATSAPP_SEND_SELLER_IDS: list,
    SELLER_WHATSAPP_FIRST_SEND_ENABLED: on,
    SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: list,
    ORDER_SUBJECT_CREATION_ENABLED: on,
    ORDER_SUBJECT_READERS_READY: on,
    ORDER_SUBJECT_SELLER_IDS: ids.join(','),
    ...extra,
  };
}

/** @param {any} response @param {number} status @param {unknown} [context] */
function body(response, status, context) {
  assert.equal(
    response.statusCode,
    status,
    `${response.body} ${context ? JSON.stringify(context) : ''}`,
  );
  return response.json();
}

/** @param {any} response */
function code(response) {
  const value = response.json();
  return value.code ?? value.error?.code;
}

test(
  'WAP-E12 local pilot rehearsal: pairing, passive order, device traffic and commercial actions',
  { timeout: 300_000 },
  async (t) => {
    assert.ok(
      process.env.TEST_DATABASE_URL,
      'Set TEST_DATABASE_URL to the synthetic crm_silmer_test_wap_e12',
    );
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.equal(url.hostname, '127.0.0.1', 'loopback only');
    assert.equal(url.pathname, '/crm_silmer_test_wap_e12');
    const pool = new Pool({ connectionString: url.href, max: 12 });
    t.after(() => pool.end());
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    const migrations = await loadMigrations();
    await migrate(pool, { migrations });
    await migrate(pool, {
      migrations: migrations.filter(({ version }) => version === '0081'),
      phase: 'contract',
    });
    const mediaRoot = await mkdtemp(join(tmpdir(), 'wap-e12-media-'));
    const spoolRoot = await mkdtemp(join(tmpdir(), 'wap-e12-spool-'));
    t.after(() => rm(mediaRoot, { recursive: true, force: true }));
    t.after(() => rm(spoolRoot, { recursive: true, force: true }));

    // ---------------- shared harness ----------------
    const logs = /** @type {any[]} */ ([]);
    /** Every outbound URL any stub or the process saw. */
    const urls = /** @type {string[]} */ ([]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      urls.push(
        String(input instanceof globalThis.Request ? input.url : input),
      );
      return realFetch(input, init);
    };
    t.after(() => {
      globalThis.fetch = realFetch;
    });
    /** Personal sends reaching the provider stub, one row per HTTP call. */
    const transport = /** @type {any[]} */ ([]);
    /** Generated n8n result callbacks, kept to replay a stale one. */
    const callbacks = /** @type {any[]} */ ([]);
    const providerCalls = /** @type {string[]} */ ([]);
    const n8nErrors = /** @type {string[]} */ ([]);
    const allowedLines = new Set(/** @type {string[]} */ ([]));
    /** instance -> {exists,state,number} */
    const providers = new Map();
    let skew = 0;
    const controlClock = () => new Date(Date.now() + skew);
    /** @type {null|(() => void)} */
    let onConnect = null;
    const wiring = /** @type {any} */ ({ workflows: null, adapter: null });
    /** @type {Map<string, {bytes:Buffer,sizeBytes:number,sha256:string,mimeType:string}>} */
    const objects = new Map();
    const scanner = {
      async scan() {
        return {
          clean: true,
          detectedMimeType: 'image/png',
          signatureUpdatedAt: new Date(),
        };
      },
    };
    const basic = (/** @type {string} */ user, /** @type {string} */ pass) =>
      `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    const n8nAuthorization = basic('wap-e12-synthetic-n8n', automationSecret);

    /** @type {any} */
    let S; // the currently booted server and its worker-side ports

    /** Generated n8n Code nodes; verify/reserve/results via real HTTP routes.
     * @param {any} input @param {RequestInit} [init] */
    async function syntheticN8n(input, init) {
      try {
        return await n8nExecution(input, init);
      } catch (error) {
        n8nErrors.push(String(/** @type {any} */ (error)?.message ?? error));
        throw error;
      }
    }
    /** @param {any} input @param {RequestInit} [init] */
    async function n8nExecution(input, init) {
      urls.push(String(input));
      const kind = new URL(input).pathname.endsWith('/challenge')
        ? 'challenge'
        : 'control';
      const envelope = JSON.parse(String(init?.body));
      const executionId = randomUUID();
      /** @param {string} keyId */
      const headers = (keyId) => ({
        authorization: n8nAuthorization,
        'idempotency-key': keyId,
        'x-correlation-id': envelope.operationId,
        'x-silmer-workflow-key': 'seller-whatsapp-control',
        'x-silmer-workflow-version': '1.0',
        'x-silmer-execution-id': executionId,
      });
      const keyId =
        kind === 'challenge' ? envelope.challengeId : envelope.operationId;
      const verified = await S.api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/whatsapp-control/verify',
        headers: headers(keyId),
        payload: { kind, envelope },
      });
      assert.equal(verified.statusCode, 200, verified.body);
      const nodes = wiring.workflows[kind].nodes;
      /** @type {Record<string,any>} */ const outputs = {};
      /** @param {string} name @param {any} value */
      const run = (name, value) =>
        new Function(
          '$json',
          '$',
          nodes.find((/** @type {any} */ n) => n.name === name).parameters
            .jsCode,
        )(value, (/** @type {string} */ target) => ({
          first: () => ({ json: outputs[target] }),
        })).json;
      outputs.Guard = run('Guard', { body: envelope });
      const reserved = await S.api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/whatsapp-control/operations',
        headers: headers(keyId),
        payload: { kind, envelope: outputs.Guard },
      });
      assert.equal(reserved.statusCode, 200, reserved.body);
      outputs.Reserve = reserved.json();
      const result = await wiring.adapter.execute(run('Plan', outputs.Reserve));
      if (kind === 'challenge') return globalThis.Response.json(result);
      const projected = run('Result', result);
      const request = {
        method: /** @type {const} */ ('POST'),
        url: '/api/v1/integrations/n8n/whatsapp-control/results',
        headers: headers(projected.resultId),
        payload: projected,
      };
      const callback = await S.api.inject(request);
      assert.equal(callback.statusCode, 200, callback.body);
      callbacks.push({ request, envelope });
      return globalThis.Response.json({
        accepted: true,
        operationId: envelope.operationId,
        generation: envelope.generation,
      });
    }

    /** @param {any} instance */
    const provider = (instance) => providers.get(instance);
    /** Real Evolution control + generation adapters over a provider stub.
     * @param {string[]} instances */
    function buildAdapter(instances) {
      const socketRuntime = createGenerationRuntime({
        enabled: true,
        instances,
        authorizeRecovery: async (
          /** @type {any} */ context,
          /** @type {string} */ token,
        ) => {
          const response = await S.api.inject({
            method: 'POST',
            url: '/api/v1/integrations/n8n/whatsapp-control/ingress/verify',
            headers: {
              authorization: n8nAuthorization,
              'x-silmer-wap-generation-token': token,
              'idempotency-key': context.source.bindingId,
              'x-correlation-id': context.source.bindingId,
              'x-silmer-workflow-key': 'seller-whatsapp-control',
              'x-silmer-workflow-version': '1.0',
              'x-silmer-execution-id': `ingress:${context.source.bindingId}`,
            },
            payload: {
              source: context.source,
              instance: context.instance,
              recovery: true,
            },
          });
          wiring.recoveryStatus = response.statusCode;
          return response.statusCode === 200;
        },
      });
      wiring.socketRuntime = socketRuntime;
      wiring.adapter = createControlAdapter({
        env: {
          SILMER_WAP_CONTROL_ENABLED: 'true',
          SILMER_WAP_GENERATION_ENABLED: 'true',
          SILMER_WAP_GENERATION_INSTANCES: instances.join(','),
          SILMER_WAP_CONTROL_WEBHOOK_URL: webhookUrl,
          AUTHENTICATION_API_KEY: controlSecret,
        },
        generationRuntime: socketRuntime,
        fetchImpl: async (
          /** @type {any} */ input,
          /** @type {any} */ init,
        ) => {
          urls.push(String(input));
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
                  ownerJid: `${provider(i).number}@s.whatsapp.net`,
                })),
            );
          if (path === '/instance/create') {
            const created = JSON.parse(init.body).instanceName;
            provider(created).exists = true;
            return globalThis.Response.json(
              { instance: { instanceName: created }, hash: 'private' },
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
            // A renewed challenge reuses the live socket; logout drops it.
            provider(instance).socket ??= {};
            socketRuntime.captureSocket(instance, provider(instance).socket);
            provider(instance).state = 'connecting';
            const hook = onConnect;
            onConnect = null;
            hook?.();
            // The challenge bytes only travel this synchronous response.
            return globalThis.Response.json(
              new URL(input).search.includes('number=')
                ? { pairingCode: CODE_CANARY }
                : { base64: QR_VALUE },
            );
          }
          if (path.startsWith('/instance/logout/')) {
            provider(instance).state = 'close';
            provider(instance).socket = null;
            return globalThis.Response.json({ success: true });
          }
          assert.match(path, /^\/webhook\/set\//u);
          return globalThis.Response.json({ success: true });
        },
      });
    }

    /** Boot API + worker-side ports for one flag set (env is read at boot).
     * @param {Record<string,string>} environment */
    function boot(environment) {
      const identity = createIdentityApiRuntime(database, environment);
      const operations = createOperationReadRuntime(database, {
        environment,
        identity,
      });
      const control = new PostgresSellerWhatsAppRepository(database, {
        ...sellerWhatsAppConfiguration(environment),
        clock: controlClock,
      });
      const client = createWhatsAppControlClient({
        enabled: true,
        allowlist: (/** @type {string} */ id) => allowedLines.has(id),
        controlEndpoint:
          'https://n8n.test/webhook/silmer/seller-whatsapp/control',
        challengeEndpoint:
          'https://n8n.test/webhook/silmer/seller-whatsapp/challenge',
        clientId: 'synthetic',
        clientSecret: controlSecret,
        fetchImpl: syntheticN8n,
      });
      const chatMedia = createChatMediaApiRuntime({
        repository: new PostgresChatMediaUploadRepository({ database }),
        access: operations,
        spoolRoot,
        envelopeKey: key,
        orderPdfValidator: new ChatMediaValidator({
          now: () => new Date(),
          scanner: {
            async scan(/** @type {string} */ path) {
              const bytes = await readFile(path);
              assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
              return {
                clean: true,
                detectedMimeType: 'application/pdf',
                signatureUpdatedAt: new Date(),
              };
            },
          },
        }),
        store: {
          async putValidated(
            /** @type {any} */ { key: id, stream, sizeBytes, sha256, mimeType },
          ) {
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const bytes = Buffer.concat(chunks);
            objects.set(id, { bytes, sizeBytes, sha256, mimeType });
          },
          async head(/** @type {string} */ id) {
            return objects.get(id);
          },
          async read(/** @type {string} */ id) {
            const object = objects.get(id);
            assert.ok(object);
            return {
              ...object,
              stream: Readable.from([object.bytes]),
              contentRange: null,
            };
          },
        },
      });
      const api = createServerApi({
        database,
        environment: { ...environment, PRIVATE_MEDIA_ROOT: mediaRoot },
        identity,
        operations,
        chatMedia,
        n8n: createN8nApiRuntime(database, {
          environment: { ...environment, PRIVATE_MEDIA_ROOT: mediaRoot },
          scanner,
        }),
        sellerWhatsApp: createSellerWhatsAppRuntime(database, {
          environment,
          repository: control,
          client,
          access: operations,
          clock: controlClock,
        }),
        logger: createSafeLogger({
          service: 'crm-silmer-api',
          sink: (record) => logs.push(record),
        }),
      });
      return {
        api,
        control,
        handler: createWhatsAppControlJobHandler({
          repository: control,
          client,
        }),
        queue: new PostgresJobQueue({ database }),
        store: new PostgresN8nCommandStore({
          database,
          envelopeKey: key,
          personalSendSellers: sellerWhatsAppSendConfiguration(environment),
        }),
      };
    }
    /** @param {Record<string,string>} environment */
    async function reboot(environment) {
      await S?.api.close();
      S = boot(environment);
      return S;
    }
    t.after(() => S?.api.close());

    // ---------------- people and sessions ----------------
    const passwordHash = await hashPassword(password);
    for (const seller of [A, B, C]) {
      await pool.query(
        'INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,$3,$4)',
        [seller, `${seller}@example.test`, passwordHash, 'Pessoa sintética'],
      );
      await pool.query(
        "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
        [seller],
      );
    }
    await reboot(flags());
    /** @type {Record<string,{id:string,cookie:string,csrf:string}>} */
    const people = {};
    for (const seller of [A, B, C]) {
      const login = await S.api.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { origin },
        payload: { email: `${seller}@example.test`, password },
      });
      assert.equal(login.statusCode, 200, login.body);
      const jar = new Map(
        [login.headers['set-cookie']]
          .flat()
          .map(
            (cookie) =>
              /** @type {[string, string]} */ (
                String(cookie).split(';')[0].split('=')
              ),
          ),
      );
      people[seller] = {
        id: seller,
        cookie: `crm_session=${jar.get('crm_session')}; crm_csrf=${jar.get('crm_csrf')}`,
        csrf: String(jar.get('crm_csrf')),
      };
    }

    /** Human request with the real session, Origin and CSRF.
     * @param {string} who @param {'GET'|'POST'|'PUT'|'PATCH'} method @param {string} path
     * @param {any} [payload] @param {Record<string,string>} [headers] */
    const as = (who, method, path, payload, headers = {}) =>
      S.api.inject({
        method,
        url: path,
        headers: {
          origin,
          cookie: people[who].cookie,
          ...(method === 'GET'
            ? {}
            : {
                'x-csrf-token': people[who].csrf,
                'idempotency-key': randomUUID(),
              }),
          ...headers,
        },
        ...(payload === undefined ? {} : { payload }),
      });
    /** Denied by direct ID without returning foreign identifiers or bytes.
     * @param {any} response @param {string[]} secrets */
    function denied(response, secrets) {
      assert.ok(
        [403, 404].includes(response.statusCode),
        `expected 403/404, got ${response.statusCode}: ${response.body}`,
      );
      for (const value of [...secrets, CODE_CANARY, QR_CANARY])
        assert.equal(response.body.includes(value), false, 'no leak');
    }
    /** @param {string} sql @param {unknown[]} [values] */
    const count = async (sql, values = []) =>
      (await pool.query(`SELECT count(*)::int AS n FROM ${sql}`, values))
        .rows[0].n;
    /** @param {string} id */
    const version = async (/** @type {string} */ table, id) =>
      Number(
        (await pool.query(`SELECT version FROM crm.${table} WHERE id=$1`, [id]))
          .rows[0].version,
      );
    /** Current line, binding and source of a seller. @param {string} seller */
    async function lineOf(seller) {
      const row = (
        await pool.query(
          `SELECT l.id,l.account_id,l.instance_name,l.state,l.version,l.generation,b.id AS binding_id
           FROM crm.seller_whatsapp_lines l
           LEFT JOIN crm.seller_whatsapp_bindings b ON b.line_id=l.id AND b.generation=l.generation AND b.revoked_at IS NULL
           WHERE l.seller_id=$1`,
          [seller],
        )
      ).rows[0];
      return {
        id: row.id,
        instance: row.instance_name,
        state: row.state,
        version: Number(row.version),
        generation: Number(row.generation),
        source: {
          lineId: row.id,
          accountId: row.account_id,
          bindingId: row.binding_id,
          generation: Number(row.generation),
        },
      };
    }

    const occurred = new Map();
    /** @param {string} id */
    const occurredAt = (id) => {
      if (!occurred.has(id)) occurred.set(id, new Date().toISOString());
      return occurred.get(id);
    };
    /** n8n inbound on a personal line. @param {any} source @param {string} id @param {string} phone @param {any} [message] */
    const inbound = (source, id, phone, message) =>
      S.api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/messages/inbound',
        headers: {
          authorization: n8nAuthorization,
          'idempotency-key': `${source.accountId}:${id}`,
          'x-correlation-id': randomUUID(),
          'x-silmer-execution-id': 'wap-e12-synthetic-inbound',
          'x-silmer-workflow-key': 'seller-whatsapp-inbound',
          'x-silmer-workflow-version': '1.0',
        },
        payload: {
          schema_version: '1.0',
          channel: 'whatsapp',
          provider: 'evolution',
          source,
          metadata: { provider_account_id: source.accountId },
          contact: { wa_id: phone },
          event_id: `${source.accountId}:${id}`,
          message: message ?? {
            external_id: id,
            type: 'text',
            text: 'Quero fazer uma compra sintética.',
          },
          // A replayed provider event carries its original timestamp.
          occurred_at: occurredAt(`${source.accountId}:${id}`),
        },
      });
    /** n8n event through the technical route.
     * @param {any} event @param {{executionId:string,workflowKey:string,key:string}} technical */
    const event = (event, technical) =>
      S.api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/events',
        headers: {
          authorization: n8nAuthorization,
          'idempotency-key': technical.key,
          'x-correlation-id': randomUUID(),
          'x-silmer-execution-id': technical.executionId,
          'x-silmer-workflow-key': technical.workflowKey,
          'x-silmer-workflow-version': '1.0',
        },
        payload: { schema_version: '1.0', ...event },
      });
    /** Device echo (fromMe) or receipt from the line. @param {any} line @param {any} payload */
    const device = (line, payload) =>
      event(
        {
          occurred_at: occurredAt(
            `${line.source.accountId}:${payload.event_id}`,
          ),
          source: line.source,
          ...payload,
          event_id: `${line.source.accountId}:${payload.event_id}`,
        },
        {
          executionId: 'device-ingress',
          workflowKey: 'seller-whatsapp-inbound',
          key: `${line.source.accountId}:${payload.event_id}`,
        },
      );
    /** @param {any} line @param {string} id @param {string} to @param {any} [message] */
    const echo = (line, id, to, message) =>
      device(line, {
        event_type: 'message.external.sent',
        event_id: id,
        external_message_id: id,
        from_me: true,
        origin: 'device',
        instance: line.instance,
        to: `+${to}`,
        message: message ?? { type: 'text', text: 'Envio sintético' },
      });
    /** @param {any} line @param {string} id @param {'delivered'|'read'} status */
    const receipt = (line, id, status) =>
      device(line, {
        event_type: `message.${status}`,
        event_id: `${id}:${status}`,
        external_message_id: id,
      });

    /** Worker + n8n + provider for one queued personal command.
     * @param {string} commandId @param {any} line
     * @param {{outcome?:'sent'|'outcome_unknown',externalId?:string,beforeSent?:()=>Promise<void>,afterDispatch?:()=>Promise<void>,media?:boolean}} [options]
     * @returns {Promise<any>} */
    async function deliver(commandId, line, options = {}) {
      const now = new Date();
      const delivery = await S.store.loadForDelivery(commandId, { now });
      if (!delivery) return { dispatched: false };
      const executionId = randomUUID();
      assert.equal(
        await S.store.markProcessing(commandId, {
          now,
          attemptId: executionId,
          payloadHash: delivery.payloadHash,
        }),
        true,
      );
      const technical = {
        executionId,
        workflowKey: 'evolution-panel',
        key: `reserve:${commandId}`,
      };
      const reserve = {
        event_type: 'message.send.requested',
        event_id: `reserve:${commandId}`,
        occurred_at: now.toISOString(),
        source: line.source,
        command_id: commandId,
        conversation_id: delivery.payload.conversation_id,
        message: delivery.payload.message,
        source_revision: delivery.payload.source_revision,
        automation_epoch: delivery.payload.automation_epoch,
      };
      const reserved = body(await event(reserve, technical), 200);
      assert.equal(reserved.send_authorized, true);
      const n8nHeaders = {
        authorization: n8nAuthorization,
        'x-correlation-id': randomUUID(),
        'x-silmer-execution-id': executionId,
        'x-silmer-workflow-key': 'evolution-panel',
        'x-silmer-workflow-version': '1.0',
      };
      let mediaSha = null;
      if (options.media) {
        const media = await S.api.inject({
          method: 'GET',
          url: `/api/v1/integrations/n8n/commands/${encodeURIComponent(commandId)}/media`,
          headers: n8nHeaders,
        });
        assert.equal(media.statusCode, 200, media.body);
        mediaSha = createHash('sha256').update(media.rawPayload).digest('hex');
        assert.equal(mediaSha, delivery.payload.message.sha256);
      }
      const preflight = body(
        await S.api.inject({
          method: 'POST',
          url: `/api/v1/integrations/n8n/commands/${encodeURIComponent(commandId)}/preflight`,
          headers: n8nHeaders,
        }),
        200,
      );
      assert.equal(preflight.valid, true);
      const externalId = options.externalId ?? `provider-${randomUUID()}`;
      transport.push({
        commandId,
        instance: preflight.instance,
        to: preflight.to,
        externalId,
      });
      if (options.outcome === 'outcome_unknown') {
        assert.equal(
          await S.store.markOutcomeUnknown(commandId, {
            attemptId: executionId,
            now: new Date(),
            errorCode: 'TIMEOUT',
          }),
          true,
        );
        return { dispatched: true, externalId, preflight, reserve, technical };
      }
      await options.afterDispatch?.();
      await options.beforeSent?.();
      const sent = { ...reserve, message: undefined };
      delete sent.message;
      const settled = body(
        await event(
          {
            ...sent,
            event_type: 'message.sent',
            event_id: `sent:${commandId}`,
            external_message_id: externalId,
          },
          { ...technical, key: `sent:${commandId}` },
        ),
        200,
      );
      assert.equal(settled.accepted, true);
      assert.equal(
        await S.store.markDelivered(commandId, {
          attemptId: executionId,
          now: new Date(),
        }),
        true,
      );
      return { dispatched: true, externalId, preflight, reserve, technical };
    }
    /** @param {string} messageId */
    const commandOf = async (messageId) =>
      (
        await pool.query('SELECT command_id FROM crm.messages WHERE id=$1', [
          messageId,
        ])
      ).rows[0].command_id;

    /** Deliver the pending whatsapp_control jobs (prepare/reconcile/disconnect). */
    async function drainControl() {
      let ran = 0;
      for (let round = 0; round < 6; round += 1) {
        const jobs = await S.queue.claim({
          queue: 'whatsapp_control',
          workerId: 'wap-e12-worker',
          limit: 10,
          // Jobs enqueued under the skewed control clock are claimable too.
          now: new Date(Date.now() + 300_000),
        });
        if (!jobs.length) break;
        for (const job of jobs) {
          const result = await S.handler(job, {
            markEffectStarted: async () => true,
          });
          assert.equal(result.outcome, 'sent', JSON.stringify(result));
          await S.queue.settle({
            jobId: job.id,
            attemptId: job.attemptId,
            workerId: 'wap-e12-worker',
            outcome: 'sent',
            now: new Date(Date.now() + 300_000),
          });
          ran += 1;
        }
      }
      return ran;
    }
    /** @param {string} who @param {any} payload @param {string} [idempotencyKey] */
    const challenge = (who, payload, idempotencyKey = randomUUID()) =>
      as(who, 'POST', '/api/v1/me/whatsapp/pairing-challenge', payload, {
        'idempotency-key': idempotencyKey,
      });
    /** @param {string} who */
    const me = async (who) =>
      body(await as(who, 'GET', '/api/v1/me/whatsapp'), 200);
    /** @param {string} who @param {string} instance @param {'qr'|'code'} mode */
    async function pairOpen(who, instance, mode) {
      let current = await me(who);
      assert.equal(current.line.state, 'awaiting_pairing');
      const shown = body(
        await challenge(who, {
          operationId: current.operation.id,
          expectedVersion: current.line.version,
          generation: current.line.generation,
          mode,
        }),
        200,
      );
      assert.equal(shown.value, mode === 'code' ? CODE_CANARY : QR_VALUE);
      // The phone scans/types; the provider then reports the expected owner.
      provider(instance).state = 'open';
      await drainControl();
      current = await me(who);
      assert.equal(current.line.state, 'connected');
      assert.equal(JSON.stringify(current).includes(QR_CANARY), false);
      assert.equal(JSON.stringify(current).includes(CODE_CANARY), false);
      return current;
    }

    /** Count canary hits in every text-like column of crm/crm_meta, any encoding. */
    async function canaryHits() {
      const needles = [CODE_CANARY, QR_CANARY].flatMap((value) => [
        value,
        Buffer.from(value).toString('base64'),
        Buffer.from(value).toString('base64url'),
        Buffer.from(value).toString('hex'),
      ]);
      const columns = (
        await pool.query(
          `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
           WHERE table_schema IN ('crm','crm_meta')
             AND data_type IN ('text','character varying','character','jsonb','json','bytea','ARRAY','USER-DEFINED')
           ORDER BY 1,2,3`,
        )
      ).rows;
      const hits = /** @type {string[]} */ ([]);
      for (const c of columns) {
        const col = `"${c.column_name}"`;
        const expr =
          c.data_type === 'bytea'
            ? `encode(${col},'escape') || encode(${col},'hex')`
            : `${col}::text`;
        const n = (
          await pool.query(
            `SELECT count(*)::int AS n FROM "${c.table_schema}"."${c.table_name}" WHERE ${needles
              .map((_, i) => `position($${i + 1} in ${expr})>0`)
              .join(' OR ')}`,
            needles,
          )
        ).rows[0].n;
        if (n) hits.push(`${c.table_name}.${c.column_name}`);
      }
      const logText = JSON.stringify(logs);
      const logHits = needles.filter((needle) => logText.includes(needle));
      return { scanned: columns.length, hits, logHits };
    }

    // Shared roteiro state.
    const R = /** @type {any} */ ({});

    // ============ 0. preflight ============
    await t.test(
      '0. expand migrations plus contract 0081; flags off fail closed; allowlist [A,B] denies C',
      async () => {
        const applied = (
          await pool.query(
            'SELECT version, phase FROM crm_meta.schema_migrations ORDER BY version',
          )
        ).rows;
        const expected = [
          ...migrations
            .filter(({ phase }) => phase === 'expand')
            .map(({ version: v }) => v),
          '0081',
        ].sort();
        assert.deepEqual(
          applied.map((/** @type {any} */ r) => r.version),
          [...new Set(expected)],
        );
        assert.equal(
          applied.find((/** @type {any} */ r) => r.version === '0081').phase,
          'contract',
        );

        // Flags off (env read at boot): every personal endpoint fails closed.
        for (const who of [A, B, C]) {
          const connect = await as(who, 'POST', '/api/v1/me/whatsapp/connect', {
            expectedNumber: NA,
            expectedVersion: 0,
          });
          assert.equal(connect.statusCode, 503);
          assert.equal(code(connect), 'WHATSAPP_CONTROL_DISABLED');
          const clients = await as(who, 'GET', '/api/v1/me/clients');
          // Fail closed; the public code is checked in 5b (E12-2).
          assert.equal(clients.statusCode, 503);
          const preview = await as(
            who,
            'GET',
            '/api/v1/contacts/contact-none/whatsapp/first-message-preview',
          );
          assert.equal(preview.statusCode, 503);
          assert.equal(code(preview), 'SELLER_WHATSAPP_FIRST_SEND_DISABLED');
        }
        assert.equal(await count('crm.seller_whatsapp_lines'), 0);
        assert.equal(await count('crm.outbox_jobs'), 0);

        await reboot(flags([A, B]));
        const deniedC = await as(C, 'POST', '/api/v1/me/whatsapp/connect', {
          expectedNumber: NB2,
          expectedVersion: 0,
        });
        assert.equal(deniedC.statusCode, 503);
        assert.equal(code(deniedC), 'WHATSAPP_CONTROL_DISABLED');
        assert.equal(
          code(await as(C, 'GET', '/api/v1/me/clients')),
          'FORBIDDEN',
        );
        const offC = await me(C);
        assert.equal(offC.available, false);
        assert.equal((await me(A)).available, true);
      },
    );

    // ============ 1. T05-06 pairing ============
    await t.test(
      '1. T05-06 pairing: one line each through the real control chain, QR and code, expiry, replay, refusals and zero canaries',
      async () => {
        const connectB = body(
          await as(B, 'POST', '/api/v1/me/whatsapp/connect', {
            expectedNumber: NB,
            expectedVersion: 0,
          }),
          202,
        );
        // A number already bound to the other seller is refused.
        const taken = await as(A, 'POST', '/api/v1/me/whatsapp/connect', {
          expectedNumber: NB,
          expectedVersion: 0,
        });
        assert.equal(taken.statusCode, 409);
        assert.equal(code(taken), 'WHATSAPP_LINE_CONFLICT');
        const connectA = body(
          await as(A, 'POST', '/api/v1/me/whatsapp/connect', {
            expectedNumber: NA,
            expectedVersion: 0,
          }),
          202,
        );
        R.lineA = connectA.line.id;
        R.lineB = connectB.line.id;
        allowedLines.add(R.lineA);
        allowedLines.add(R.lineB);
        const a = await lineOf(A);
        const b = await lineOf(B);
        for (const [instance, number] of [
          [a.instance, NA],
          [b.instance, NB],
        ])
          providers.set(instance, {
            exists: false,
            state: 'close',
            number,
            socket: null,
          });
        wiring.workflows = createWhatsAppControlWorkflows({
          enabled: true,
          allowlist: [R.lineA, R.lineB],
          crmBaseUrl: 'https://crm.test',
          evolutionBaseUrl: 'https://evolution.test',
          webhookCredentialId: 'synthetic',
          crmCredentialId: 'synthetic',
          evolutionCredentialId: 'synthetic',
        });
        buildAdapter([a.instance, b.instance]);
        // Worker prepares both instances (metadata only, no QR).
        assert.equal(await drainControl(), 2);
        assert.equal((await me(A)).line.state, 'awaiting_pairing');
        assert.equal((await me(B)).line.state, 'awaiting_pairing');
        assert.equal(
          providerCalls.filter((p) => p === '/instance/create').length,
          2,
        );

        // B: code modality; a replayed challenge key never regenerates bytes.
        let currentB = await me(B);
        const payloadB = {
          operationId: currentB.operation.id,
          expectedVersion: currentB.line.version,
          generation: currentB.line.generation,
          mode: 'code',
        };
        const keyB = randomUUID();
        const shownB = body(await challenge(B, payloadB, keyB), 200);
        assert.equal(shownB.value, CODE_CANARY, 'only the titular sees it');
        const replayB = await challenge(B, payloadB, keyB);
        assert.equal(replayB.statusCode, 409);
        assert.equal(code(replayB), 'WHATSAPP_CHALLENGE_REPLAY');
        assert.equal(replayB.body.includes(CODE_CANARY), false);
        // A cannot ask for B's challenge: the titular comes from the session.
        const foreign = await challenge(A, payloadB);
        assert.equal(foreign.statusCode, 404, foreign.body);
        assert.equal(code(foreign), 'WHATSAPP_OPERATION_NOT_FOUND');
        assert.equal(foreign.body.includes(CODE_CANARY), false);
        provider(b.instance).state = 'open';
        await drainControl();
        currentB = await me(B);
        assert.equal(currentB.line.state, 'connected');
        assert.equal(currentB.line.generation, 1);

        // A: QR modality whose provider answer arrives after the TTL.
        let currentA = await me(A);
        onConnect = () => {
          skew += 120_000; // the 60 s challenge TTL elapses mid-flight
        };
        const late = await challenge(A, {
          operationId: currentA.operation.id,
          expectedVersion: currentA.line.version,
          generation: currentA.line.generation,
          mode: 'qr',
        });
        skew = 0; // the gateway clock never moved; only the CRM saw the TTL pass
        assert.equal(late.statusCode, 409);
        assert.equal(code(late), 'WHATSAPP_OPERATION_UNCERTAIN');
        assert.equal(late.body.includes(QR_CANARY), false);
        assert.equal(late.body.includes('base64'), false);
        currentA = await me(A);
        assert.equal(currentA.line.state, 'unknown');
        const expired = (
          await pool.query(
            'SELECT id,state FROM crm.seller_whatsapp_challenges WHERE line_id=$1',
            [R.lineA],
          )
        ).rows;
        assert.deepEqual(
          expired.map((/** @type {any} */ r) => r.state),
          ['unknown'],
        );
        // Read-only reconciliation (no second create/connect), then renewal.
        const connectsBefore = providerCalls.filter((p) =>
          p.startsWith('/instance/connect/'),
        ).length;
        await drainControl();
        assert.equal(
          providerCalls.filter((p) => p.startsWith('/instance/connect/'))
            .length,
          connectsBefore,
        );
        currentA = await me(A);
        assert.equal(currentA.line.state, 'awaiting_pairing');
        const renewed = body(
          await challenge(A, {
            operationId: currentA.operation.id,
            expectedVersion: currentA.line.version,
            generation: currentA.line.generation,
            mode: 'qr',
            renewChallengeId: expired[0].id,
          }),
          200,
          n8nErrors,
        );
        assert.equal(renewed.value, QR_VALUE);
        provider(a.instance).state = 'open';
        await drainControl();
        currentA = await me(A);
        assert.equal(currentA.line.state, 'connected');
        assert.equal(currentA.line.generation, 1);
        R.connectedCallbackA = callbacks.at(-1);

        // One line per seller: a second line for B is refused.
        const stale = await as(B, 'POST', '/api/v1/me/whatsapp/connect', {
          expectedNumber: NB2,
          expectedVersion: 0,
        });
        assert.equal(stale.statusCode, 409);
        assert.equal(code(stale), 'VERSION_CONFLICT');
        const second = await as(B, 'POST', '/api/v1/me/whatsapp/connect', {
          expectedNumber: NB2,
          expectedVersion: currentB.line.version,
        });
        assert.equal(second.statusCode, 409);
        assert.equal(code(second), 'WHATSAPP_LINE_CONFLICT');
        assert.equal(await count('crm.seller_whatsapp_lines'), 2);
        assert.equal(
          await count("crm.whatsapp_number_reservations WHERE kind='personal'"),
          2,
        );
        // C is outside the allowlist the whole time.
        assert.equal(
          code(
            await as(C, 'POST', '/api/v1/me/whatsapp/connect', {
              expectedNumber: NB2,
              expectedVersion: 0,
            }),
          ),
          'WHATSAPP_CONTROL_DISABLED',
        );

        const scan = await canaryHits();
        assert.ok(scan.scanned > 100, `scanned ${scan.scanned} columns`);
        assert.deepEqual(scan.hits, []);
        assert.deepEqual(scan.logHits, []);
        t.diagnostic(`pairing canary scan: ${scan.scanned} columns, 0 hits`);
        assert.deepEqual(n8nErrors, [], 'every n8n execution succeeded');
      },
    );

    // ============ 2. T05-05 passive order ============
    await t.test(
      '2. T05-05 passive order: inbound to A, human holder, Pedido on target Subject, replay/idempotency, ACL and disconnect',
      async () => {
        const a = await lineOf(A);
        const first = body(await inbound(a.source, 'passive-1', PX), 200);
        assert.equal(first.mode, 'human_active');
        assert.equal(first.duplicate, false);
        R.convA = first.conversation_id;
        R.contactX = first.contact_id;
        const conversation = (
          await pool.query(
            'SELECT assigned_user_id,automation_state,provider_account_id FROM crm.conversations WHERE id=$1',
            [R.convA],
          )
        ).rows[0];
        assert.deepEqual(conversation, {
          assigned_user_id: A,
          automation_state: 'human',
          provider_account_id: a.source.accountId,
        });
        assert.equal(await count('crm.n8n_commands'), 0, 'no bot reply');

        const subject = body(
          await as(
            A,
            'POST',
            `/api/v1/inbox/conversations/${R.convA}/subjects`,
            {
              select: true,
            },
          ),
          201,
        ).subject;
        R.subjectA = subject.id;
        // A second Subject makes the target explicit, never inferred.
        body(
          await as(
            A,
            'POST',
            `/api/v1/inbox/conversations/${R.convA}/subjects`,
            {
              select: true,
            },
          ),
          201,
        );
        const orderBody = {
          expectedVersion: await version('conversations', R.convA),
          subjectId: R.subjectA,
          expectedSubjectVersion: await version(
            'conversation_subjects',
            R.subjectA,
          ),
        };
        const untargeted = await as(
          A,
          'POST',
          `/api/v1/conversations/${R.convA}/orders`,
          { expectedVersion: orderBody.expectedVersion },
        );
        assert.equal(untargeted.statusCode, 409);
        assert.equal(code(untargeted), 'ORDER_TARGET_REQUIRED');
        const orderKey = randomUUID();
        const [one, two] = await Promise.all(
          [0, 1].map(() =>
            as(
              A,
              'POST',
              `/api/v1/conversations/${R.convA}/orders`,
              orderBody,
              {
                'idempotency-key': orderKey,
              },
            ),
          ),
        );
        const created = [one, two].map((r) => {
          assert.ok([200, 201].includes(r.statusCode), r.body);
          return r.json().order;
        });
        assert.equal(created[0].id, created[1].id);
        assert.equal(created[0].number, created[1].number);
        R.orderA = created[0];
        R.orderBody = orderBody;
        R.orderKey = orderKey;
        const again = await as(
          A,
          'POST',
          `/api/v1/conversations/${R.convA}/orders`,
          orderBody,
          { 'idempotency-key': orderKey },
        );
        assert.ok([200, 201].includes(again.statusCode), again.body);
        assert.equal(again.json().order.number, R.orderA.number);
        const ficha = body(
          await as(A, 'GET', `/api/v1/orders/${R.orderA.id}`),
          200,
        ).order;
        assert.equal(ficha.status, 'pendente');
        assert.equal(ficha.originSubjectId, R.subjectA);
        assert.equal(ficha.conversationId, R.convA);
        assert.equal(ficha.contactId, R.contactX);
        assert.equal(ficha.seller.id, A);
        assert.ok(ficha.ficha);
        assert.equal(ficha.confirmedAt, null);

        // Replay of the same inbound event: nothing duplicates.
        const before = {
          messages: await count('crm.messages'),
          conversations: await count('crm.conversations'),
          orders: await count('crm.orders'),
          contacts: await count('crm.contacts'),
        };
        const replay = body(await inbound(a.source, 'passive-1', PX), 200);
        assert.equal(replay.duplicate, true);
        assert.equal(replay.conversation_id, R.convA);
        assert.deepEqual(
          {
            messages: await count('crm.messages'),
            conversations: await count('crm.conversations'),
            orders: await count('crm.orders'),
            contacts: await count('crm.contacts'),
          },
          before,
        );

        // B and C by direct ID: denied without leaking.
        const secrets = [R.contactX, R.subjectA];
        for (const who of [B, C]) {
          denied(
            await as(who, 'GET', `/api/v1/inbox/conversations/${R.convA}`),
            secrets,
          );
          denied(
            await as(
              who,
              'GET',
              `/api/v1/inbox/conversations/${R.convA}/subjects`,
            ),
            secrets,
          );
          denied(
            await as(
              who,
              'POST',
              `/api/v1/conversations/${R.convA}/orders`,
              orderBody,
              { 'idempotency-key': orderKey },
            ),
            secrets,
          );
          denied(await as(who, 'GET', `/api/v1/contacts/${R.contactX}`), [
            R.convA,
            R.subjectA,
          ]);
          // WAP-07/08 (PO, 18/11/2026): the order of A's private client is
          // not found for B or C, by id, in the list or by its number.
          const foreign = await as(who, 'GET', `/api/v1/orders/${R.orderA.id}`);
          assert.equal(foreign.statusCode, 404, foreign.body);
          assert.deepEqual(JSON.parse(foreign.body), {
            error: { code: 'ORDER_NOT_FOUND' },
          });
          denied(foreign, [...secrets, R.orderA.id]);
          const listed = body(
            await as(
              who,
              'GET',
              `/api/v1/orders?q=${encodeURIComponent(R.orderA.number)}`,
            ),
            200,
          );
          assert.deepEqual(listed.items, []);
          assert.equal(JSON.stringify(listed).includes(R.orderA.id), false);
          denied(
            await as(who, 'GET', `/api/v1/orders/${R.orderA.id}/receipt`),
            secrets,
          );
        }
        assert.equal(
          code(await as(C, 'GET', '/api/v1/me/clients')),
          'FORBIDDEN',
        );
        // SSE replay from cursor 0: B sees no identifier of A's thread.
        const replayed = await sse(B);
        // Positive control first: an empty or expired stream would pass the
        // absence check vacuously. B's replay must be open and carry B's own
        // events before the absence of A's identifiers means anything.
        assert.match(replayed, /^: connected$/mu, 'B stream opened');
        assert.equal(
          replayed.includes('event: session.expired'),
          false,
          'B stream was not expired',
        );
        assert.match(replayed, /^id: \d+$/mu, 'B receives its own events');
        for (const id of [R.convA, R.contactX, R.subjectA, R.orderA.id])
          assert.equal(replayed.includes(id), false, 'SSE leak');
        const own = await sse(A);
        assert.match(own, /^id: \d+/mu, 'A receives its own events');

        // Disconnect through the control path; history and creation stay.
        const current = await me(A);
        const disconnected = body(
          await as(A, 'POST', '/api/v1/me/whatsapp/disconnect', {
            expectedVersion: current.line.version,
            expectedGeneration: current.line.generation,
          }),
          202,
        );
        assert.equal(disconnected.line.generation, 2);
        await drainControl();
        assert.equal((await me(A)).line.state, 'disconnected');
        assert.equal(
          providerCalls.filter((p) => p.startsWith('/instance/logout/')).length,
          1,
        );
        assert.equal(
          body(await as(A, 'GET', `/api/v1/orders/${R.orderA.id}`), 200).order
            .id,
          R.orderA.id,
        );
        body(await as(A, 'GET', `/api/v1/inbox/conversations/${R.convA}`), 200);
        const offlineSubject = body(
          await as(
            A,
            'POST',
            `/api/v1/inbox/conversations/${R.convA}/subjects`,
            {
              select: true,
            },
          ),
          201,
        ).subject.id;
        const offline = body(
          await as(A, 'POST', `/api/v1/conversations/${R.convA}/orders`, {
            expectedVersion: await version('conversations', R.convA),
            subjectId: offlineSubject,
            expectedSubjectVersion: await version(
              'conversation_subjects',
              offlineSubject,
            ),
          }),
          201,
        ).order;
        assert.notEqual(offline.number, R.orderA.number);
        R.orderOffline = offline;
        // An inbound of the revoked generation is refused before any write.
        const messages = await count('crm.messages');
        const old = await inbound(a.source, 'passive-after-logout', PX);
        assert.equal(old.statusCode, 409, old.body);
        assert.equal(code(old), 'WHATSAPP_GENERATION_STALE');
        assert.equal(await count('crm.messages'), messages);
      },
    );

    /** Read an SSE stream for a short window, from cursor 0. @param {string} who */
    async function sse(who) {
      const address =
        R.address ?? (await S.api.listen({ host: '127.0.0.1', port: 0 }));
      R.address = address;
      const controller = new AbortController();
      const response = await realFetch(`${address}/api/v1/events`, {
        headers: {
          origin,
          cookie: people[who].cookie,
          'last-event-id': '0',
        },
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      const reader = /** @type {any} */ (response.body).getReader();
      let text = '';
      const deadline = Date.now() + 1500;
      try {
        while (Date.now() < deadline) {
          const chunk = await Promise.race([
            reader.read(),
            new Promise((resolve) =>
              setTimeout(() => resolve({ timeout: true }), 300),
            ),
          ]);
          if (/** @type {any} */ (chunk).done) break;
          if (/** @type {any} */ (chunk).value)
            text += Buffer.from(/** @type {any} */ (chunk).value).toString();
        }
      } finally {
        controller.abort();
      }
      return text;
    }

    // ============ 3. device traffic ============
    await t.test(
      '3. device traffic: reconnect (new generation), CRM send, echo before/after HTTP, receipts, media and outage without blind retry',
      async () => {
        // Reconnect with the same number: generation increments.
        let current = await me(A);
        body(
          await as(A, 'POST', '/api/v1/me/whatsapp/connect', {
            expectedNumber: NA,
            expectedVersion: current.line.version,
          }),
          202,
        );
        await drainControl();
        const aInstance = (await lineOf(A)).instance;
        current = await pairOpen(A, aInstance, 'code');
        assert.equal(current.line.generation, 3);
        const a = await lineOf(A);
        assert.equal(a.generation, 3);
        const originalCutover = (
          await pool.query(
            'SELECT verified_at FROM crm.seller_whatsapp_lines WHERE id=$1',
            [a.id],
          )
        ).rows[0].verified_at;
        // A stale callback of generation 1 is an idempotent no-op.
        const lineBefore = await lineOf(A);
        const stale = await S.api.inject(R.connectedCallbackA.request);
        assert.equal(stale.statusCode, 200, stale.body);
        assert.equal(stale.json().duplicate, true);
        assert.deepEqual(await lineOf(A), lineBefore);
        // An older generation source is refused on ingress.
        const oldSource = { ...a.source, generation: 1 };
        const refused = await inbound(oldSource, 'old-generation', PX);
        assert.equal(refused.statusCode, 409, refused.body);
        assert.equal(code(refused), 'WHATSAPP_GENERATION_STALE');
        const runtime = wiring.socketRuntime;
        const live = provider(aInstance);
        const initialSocket = live.socket;
        const sourceContext = runtime.captureSocket(aInstance, initialSocket);
        live.state = 'close';
        await runtime.wrap(sourceContext, async () => {
          assert.equal(
            runtime.observeConnection(aInstance, initialSocket, 'close'),
            true,
          );
          await runtime.continueAfterPairing(
            aInstance,
            initialSocket,
            408,
            async () => {
              assert.equal((await me(A)).line.state, 'validating');
              const rejected = await as(
                A,
                'POST',
                `/api/v1/conversations/${R.convA}/messages`,
                {
                  content: { text: 'envio bloqueado em recuperação' },
                  expectedVersion: await version('conversations', R.convA),
                  messageType: 'text',
                  reason: 'synthetic',
                },
              );
              assert.equal(rejected.statusCode, 503, rejected.body);
              assert.equal(code(rejected), 'WHATSAPP_SEND_UNAVAILABLE');
              await drainControl();
              assert.equal((await me(A)).line.state, 'validating');
              live.socket = {};
              assert.equal(
                runtime.captureSocket(aInstance, live.socket),
                sourceContext,
              );
              live.state = 'connecting';
            },
            true,
          );
        })();
        assert.equal(wiring.recoveryStatus, 200);
        assert.notEqual(live.socket, initialSocket);
        live.state = 'open';
        runtime.wrap(sourceContext, () =>
          runtime.observeConnection(aInstance, live.socket, 'open'),
        )();
        // Ingress can drain valid messages while the CRM rechecks the same binding.
        const next = body(await inbound(a.source, 'passive-2', PX), 200);
        assert.equal(next.conversation_id, R.convA);
        assert.equal(next.contact_id, R.contactX);
        const paused = await me(A);
        await pool.query(
          "UPDATE crm.seller_whatsapp_operations SET updated_at=updated_at-interval '31 seconds' WHERE id=$1",
          [paused.operation.id],
        );
        assert.equal((await S.control.scheduleReconciliations()).scheduled, 1);
        await drainControl();
        const recovered = await lineOf(A);
        assert.equal(recovered.state, 'connected');
        assert.deepEqual(recovered.source, a.source);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT verified_at FROM crm.seller_whatsapp_lines WHERE id=$1',
              [a.id],
            )
          ).rows[0].verified_at,
          originalCutover,
        );

        /** CRM send from A through the Inbox route. @param {string} text */
        async function send(text) {
          const accepted = body(
            await as(A, 'POST', `/api/v1/conversations/${R.convA}/messages`, {
              content: { text },
              expectedVersion: await version('conversations', R.convA),
              messageType: 'text',
              reason: 'synthetic',
            }),
            202,
          );
          const messageId =
            accepted.messageId ?? accepted.id ?? accepted.message?.id;
          assert.ok(messageId, JSON.stringify(accepted));
          return { messageId, commandId: await commandOf(messageId) };
        }
        /** @param {string} externalId */
        const rows = async (externalId) =>
          (
            await pool.query(
              'SELECT * FROM crm.messages WHERE provider_account_id=$1 AND external_message_id=$2',
              [a.source.accountId, externalId],
            )
          ).rows;

        // Echo from the phone arrives BEFORE the HTTP result.
        const echoFirst = await send('Resposta sintética 1');
        await deliver(echoFirst.commandId, a, {
          externalId: 'e12-echo-first',
          beforeSent: async () => {
            body(await echo(a, 'e12-echo-first', PX), 200);
          },
        });
        body(await receipt(a, 'e12-echo-first', 'delivered'), 200);
        body(await receipt(a, 'e12-echo-first', 'read'), 200);
        let found = await rows('e12-echo-first');
        assert.equal(found.length, 1);
        assert.equal(found[0].id, echoFirst.messageId);
        assert.equal(found[0].author_kind, 'human');
        assert.equal(found[0].author_id, A);
        assert.equal(found[0].delivery_status, 'read');

        // HTTP result first, then the echo twice.
        const httpFirst = await send('Resposta sintética 2');
        await deliver(httpFirst.commandId, a, { externalId: 'e12-http-first' });
        await Promise.all([
          echo(a, 'e12-http-first', PX),
          echo(a, 'e12-http-first', PX),
        ]);
        found = await rows('e12-http-first');
        assert.equal(found.length, 1);
        assert.equal(found[0].id, httpFirst.messageId);
        assert.equal(found[0].status, 'sent');

        // A media message sent from the phone, then its bytes attached.
        body(
          await echo(a, 'e12-image', PX, {
            type: 'image',
            text: 'Imagem sintética',
          }),
          200,
        );
        const png = await readFile(
          new URL('../fixtures/media-composer.png', import.meta.url),
        );
        const boundary = `----wap-e12-${randomUUID()}`;
        const part = (
          /** @type {string} */ name,
          /** @type {string} */ value,
        ) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
        const multipart = Buffer.concat([
          Buffer.from(
            part('schema_version', '1.0') +
              part('external_id', 'e12-image') +
              part('filename', 'sintetica.png') +
              part('mime_type', 'image/png') +
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sintetica.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          png,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        const attached = await S.api.inject({
          method: 'POST',
          url: `/api/v1/integrations/n8n/conversations/${R.convA}/attachments`,
          headers: {
            authorization: n8nAuthorization,
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'idempotency-key': `${a.source.accountId}:e12-image:attachment`,
            'x-correlation-id': randomUUID(),
            'x-silmer-execution-id': 'device-ingress',
            'x-silmer-workflow-key': 'seller-whatsapp-inbound',
            'x-silmer-workflow-version': '1.0',
            'x-silmer-content-sha256': createHash('sha256')
              .update(png)
              .digest('hex'),
            'x-silmer-whatsapp-binding': a.source.bindingId,
          },
          payload: multipart,
        });
        assert.ok([200, 201].includes(attached.statusCode), attached.body);
        const thread = body(
          await as(A, 'GET', `/api/v1/inbox/conversations/${R.convA}`),
          200,
        );
        const image = thread.messages.find(
          (/** @type {any} */ m) => m.type === 'image',
        );
        assert.ok(image, 'image message in the thread');
        assert.equal(image.origin, 'device');
        assert.equal(image.media.state, 'attached');
        R.mediaPath = `/api/v1/conversations/${R.convA}/media/${image.media.mediaId}/content`;
        const content = await as(A, 'GET', R.mediaPath);
        assert.equal(content.statusCode, 200);
        assert.equal(
          createHash('sha256').update(content.rawPayload).digest('hex'),
          createHash('sha256').update(png).digest('hex'),
        );
        denied(await as(B, 'GET', R.mediaPath), [R.contactX]);
        denied(await as(C, 'GET', R.mediaPath), [R.contactX]);

        // Outage: transport timeout -> outcome_unknown, never retried.
        const lost = await send('Resposta sintética 3');
        const calls = transport.length;
        await deliver(lost.commandId, a, { outcome: 'outcome_unknown' });
        assert.equal(transport.length, calls + 1);
        assert.equal(
          await S.store.loadForDelivery(lost.commandId, { now: new Date() }),
          null,
        );
        assert.equal(
          await S.store.markProcessing(lost.commandId, {
            now: new Date(),
            attemptId: randomUUID(),
          }),
          false,
        );
        const unknown = (
          await pool.query(
            `SELECT c.status, m.status AS message, c.whatsapp_dispatched_at IS NOT NULL AS dispatched
             FROM crm.n8n_commands c JOIN crm.messages m ON m.id=c.message_id WHERE c.command_id=$1`,
            [lost.commandId],
          )
        ).rows[0];
        assert.deepEqual(unknown, {
          status: 'outcome_unknown',
          message: 'outcome_unknown',
          dispatched: true,
        });
        assert.equal(
          await count(
            "crm.reconciliation_items r JOIN crm.outbox_jobs j ON j.id=r.job_id WHERE j.n8n_command_id=$1 AND r.status='open'",
            [lost.commandId],
          ),
          1,
        );
        // OBSERVATION: the per-conversation "1 unsettled send" limit of the
        // runbook is enforced on first send (pendingSend); an Inbox reply is
        // a NEW command, never a retry of the uncertain one.
        const after = await send('Nova resposta sintética após a queda');
        assert.notEqual(after.commandId, lost.commandId);
        await deliver(after.commandId, a, { externalId: 'e12-after-outage' });
        assert.equal(
          transport.filter((call) => call.commandId === lost.commandId).length,
          1,
          'no second transport call for the same command',
        );
        // deliver() drives the store directly, so the lost command's outbox
        // job is still claimable. Drain the real queue with the real worker
        // runtime and n8n handler: the uncertain command must never reach a
        // transport again and its job must end terminal, never claimable.
        assert.equal(
          await count(
            `crm.outbox_jobs j JOIN crm.n8n_commands c ON c.command_id=j.n8n_command_id
             WHERE j.queue=$1 AND j.status IN ('pending','retry','processing')
               AND (c.status IN ('pending','processing')
                 OR (c.status='failed' AND c.retryable AND c.retry_safe))`,
            [N8N_COMMAND_QUEUE],
          ),
          0,
          'the drain below only meets settled commands',
        );
        const lostJob = (
          await pool.query(
            'SELECT id,status FROM crm.outbox_jobs WHERE n8n_command_id=$1',
            [lost.commandId],
          )
        ).rows;
        assert.equal(lostJob.length, 1);
        /** @type {string[]} */
        const prepared = [];
        const transportBefore = transport.length;
        const worker = new WorkerRuntime({
          handlers: {
            [N8N_COMMAND_JOB_TYPE]: createN8nCommandJobHandler({
              client: {
                prepareDelivery(/** @type {any} */ command) {
                  prepared.push(command.commandId);
                  throw new Error('An uncertain command was prepared again');
                },
              },
              commandStore: S.store,
            }),
          },
          logger: createSafeLogger({
            service: 'crm-silmer-worker',
            sink: () => {},
          }),
          now: () => Date.now() + 300_000,
          queue: S.queue,
          queueName: N8N_COMMAND_QUEUE,
          workerId: 'wap-e12-n8n-worker',
        });
        let drained = 0;
        for (let round = 0; round < 20; round += 1) {
          const ran = await worker.runOnce();
          if (!ran) break;
          drained += ran;
        }
        assert.ok(drained >= 1, 'the lost job was claimed by the worker');
        assert.equal(await worker.runOnce(), 0, 'nothing is claimable again');
        assert.deepEqual(prepared, [], 'no delivery was prepared');
        assert.equal(transport.length, transportBefore);
        const lostAfter = (
          await pool.query(
            `SELECT j.status AS job, j.attempt_count AS attempts, c.status, c.retryable, c.retry_safe
             FROM crm.outbox_jobs j JOIN crm.n8n_commands c ON c.command_id=j.n8n_command_id
             WHERE j.id=$1`,
            [lostJob[0].id],
          )
        ).rows[0];
        // The store refuses the uncertain command (N8N_COMMAND_NOT_FOUND,
        // outcome known, not retryable), so the queue dead-letters the job.
        assert.equal(lostAfter.job, 'dead_letter', 'lost job is terminal');
        assert.equal(lostAfter.attempts, 1);
        assert.deepEqual(
          {
            status: lostAfter.status,
            retryable: lostAfter.retryable,
            retrySafe: lostAfter.retry_safe,
          },
          { status: 'outcome_unknown', retryable: false, retrySafe: false },
        );
        assert.equal(
          await S.store.loadForDelivery(lost.commandId, { now: new Date() }),
          null,
        );
        assert.equal(
          await count(
            "crm.reconciliation_items r JOIN crm.outbox_jobs j ON j.id=r.job_id WHERE j.n8n_command_id=$1 AND r.status='open'",
            [lost.commandId],
          ),
          1,
          'the reconciliation item stays open for the operator',
        );
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM crm.n8n_commands WHERE command_id=$1',
              [lost.commandId],
            )
          ).rows[0].status,
          'outcome_unknown',
        );
        assert.deepEqual(n8nErrors, []);
        R.lostCommand = lost.commandId;
      },
    );

    // ============ 4. T05-07 commercial ============
    await t.test(
      '4. T05-07 commercial: shared Contact, own conversations, per-field conflict, snapshots and first send by B',
      async () => {
        // A Contact born on A's personal line stays private to A.
        const xVersion = await version('contacts', R.contactX);
        denied(
          await as(B, 'POST', `/api/v1/me/clients/${R.contactX}/link`, {
            expectedVersion: xVersion,
          }),
          [R.convA],
        );
        const collision = await as(B, 'POST', '/api/v1/me/clients', {
          displayName: 'Cliente sintético',
          phone: `+${PX}`,
        });
        assert.equal(collision.statusCode, 409);
        assert.equal(code(collision), 'CONTACT_PHONE_MATCH');
        assert.equal(collision.body.includes(R.contactX), false);

        // The SAME common Contact, linked by A and by B (no copy).
        const contactsBefore = await count('crm.contacts');
        const shared = body(
          await as(A, 'POST', '/api/v1/contacts', {
            displayName: 'Cliente compartilhado sintético',
            phone: `+${P2}`,
            email: 'compartilhado@example.test',
          }),
          201,
        ).contact;
        R.contact2 = shared.id;
        for (const who of [A, B])
          body(
            await as(who, 'POST', `/api/v1/me/clients/${R.contact2}/link`, {
              expectedVersion: await version('contacts', R.contact2),
            }),
            200,
          );
        assert.equal(await count('crm.contacts'), contactsBefore + 1);
        assert.equal(
          await count(
            "crm.seller_client_links WHERE contact_id=$1 AND status='active'",
            [R.contact2],
          ),
          2,
        );
        for (const who of [A, B])
          assert.ok(
            body(await as(who, 'GET', '/api/v1/me/clients'), 200).items.some(
              (/** @type {any} */ item) => item.id === R.contact2,
            ),
          );

        /** First individual send through the real HTTP route. @param {string} who */
        async function firstSend(who) {
          const { preview } = body(
            await as(
              who,
              'GET',
              `/api/v1/contacts/${R.contact2}/whatsapp/first-message-preview`,
            ),
            200,
          );
          assert.equal(preview.available, true, JSON.stringify(preview));
          const link = (
            await pool.query(
              'SELECT version FROM crm.seller_client_links WHERE seller_id=$1 AND contact_id=$2',
              [who, R.contact2],
            )
          ).rows[0];
          const line = await lineOf(who);
          const created = body(
            await as(
              who,
              'POST',
              `/api/v1/contacts/${R.contact2}/whatsapp/conversations`,
              {
                text: 'Primeira mensagem sintética',
                expectedContactVersion: await version('contacts', R.contact2),
                expectedLinkVersion: Number(link.version),
                expectedLineVersion: line.version,
                expectedGeneration: line.generation,
                expectedConversation: preview.conversation,
              },
            ),
            201,
          );
          const commandId = await commandOf(created.message.id);
          const sent = await deliver(commandId, line);
          assert.equal(sent.preflight.instance, line.instance);
          assert.equal(sent.preflight.to, `+${P2}`);
          return { conversation: created.conversation.id, line };
        }
        const firstA = await firstSend(A);
        R.convA2 = firstA.conversation;
        // B: no prior inbound on B's line.
        assert.equal(
          await count(
            "crm.messages m JOIN crm.conversations c ON c.id=m.conversation_id WHERE c.provider_account_id=$1 AND m.direction='inbound'",
            [(await lineOf(B)).source.accountId],
          ),
          0,
        );
        const firstB = await firstSend(B);
        R.convB2 = firstB.conversation;
        assert.notEqual(R.convA2, R.convB2);
        // The customer's reply on B's line lands in B's conversation.
        const reply = body(
          await inbound(firstB.line.source, 'reply-to-b', P2),
          200,
        );
        assert.equal(reply.conversation_id, R.convB2);
        assert.equal(reply.contact_id, R.contact2);
        for (const [who, own, foreign] of [
          [A, R.convA2, R.convB2],
          [B, R.convB2, R.convA2],
        ]) {
          const detail = body(
            await as(who, 'GET', `/api/v1/contacts/${R.contact2}`),
            200,
          );
          assert.deepEqual(
            detail.conversations.map((/** @type {any} */ c) => c.id),
            [own],
          );
          denied(
            await as(who, 'GET', `/api/v1/inbox/conversations/${foreign}`),
            [],
          );
        }

        // Pedidos on A's shared-Contact conversation before any edit:
        // a pending one by the real route and the confirmed ficha (seeded).
        const target = body(
          await as(
            A,
            'POST',
            `/api/v1/inbox/conversations/${R.convA2}/subjects`,
            { select: true },
          ),
          201,
        ).subject.id;
        const pending = body(
          await as(A, 'POST', `/api/v1/conversations/${R.convA2}/orders`, {
            expectedVersion: await version('conversations', R.convA2),
            subjectId: target,
            expectedSubjectVersion: await version(
              'conversation_subjects',
              target,
            ),
          }),
          201,
        ).order;
        R.confirmed = await seedConfirmedOrder(R.convA2, A);
        R.confirmedRace = await seedConfirmedOrder(R.convA2, A);
        /** @param {string} id */
        const snapshot = async (id) =>
          (
            await pool.query(
              'SELECT version,status,ficha_envelope::text AS ficha,contact_id FROM crm.orders WHERE id=$1',
              [id],
            )
          ).rows[0];
        const snapshots = {
          pending: await snapshot(pending.id),
          confirmed: await snapshot(R.confirmed),
        };

        // Per-field edit: stale version refused, other field merges.
        const v1 = await version('contacts', R.contact2);
        const cityA = body(
          await as(A, 'PUT', `/api/v1/contacts/${R.contact2}/registration`, {
            expectedVersion: v1,
            registration: { city: 'Cidade sintética A' },
          }),
          200,
        ).contact;
        assert.equal(cityA.registration.city, 'Cidade sintética A');
        const staleEdit = await as(
          B,
          'PUT',
          `/api/v1/contacts/${R.contact2}/registration`,
          { expectedVersion: v1, registration: { street: 'Rua sintética B' } },
        );
        assert.equal(staleEdit.statusCode, 409, staleEdit.body);
        assert.equal(staleEdit.body.includes('Cidade sintética A'), false);
        const reread = body(
          await as(B, 'GET', `/api/v1/contacts/${R.contact2}`),
          200,
        ).contact;
        const merged = body(
          await as(B, 'PUT', `/api/v1/contacts/${R.contact2}/registration`, {
            expectedVersion: reread.version,
            registration: {
              ...Object.fromEntries(
                Object.entries(reread.registration ?? {}).filter(
                  ([, value]) => value !== null,
                ),
              ),
              street: 'Rua sintética B',
            },
          }),
          200,
        ).contact;
        assert.equal(merged.registration.city, 'Cidade sintética A');
        assert.equal(merged.registration.street, 'Rua sintética B');
        // Same shared phone + new email: the unchanged phone does not block.
        const emailed = body(
          await as(B, 'POST', `/api/v1/contacts/${R.contact2}/details`, {
            expectedVersion: merged.version,
            phone: `+${P2}`,
            email: 'novo-email@example.test',
          }),
          200,
        ).contact;
        assert.equal(emailed.email, 'novo-email@example.test');
        const phoneChange = await as(
          B,
          'POST',
          `/api/v1/contacts/${R.contact2}/details`,
          {
            expectedVersion: emailed.version,
            phone: '+5511900001219',
            email: 'novo-email@example.test',
          },
        );
        // Fail closed: refused and nothing changes (public code: see 4b).
        assert.equal(phoneChange.statusCode, 403, phoneChange.body);
        assert.equal(
          await version('contacts', R.contact2),
          Number(emailed.version),
        );
        R.restrictedEdit = {
          expectedVersion: emailed.version,
          phone: '+5511900001219',
          email: 'novo-email@example.test',
        };
        assert.deepEqual(
          {
            pending: await snapshot(pending.id),
            confirmed: await snapshot(R.confirmed),
          },
          snapshots,
          'Pedido snapshots are not touched by Contact edits',
        );
      },
    );

    // ============ 4b. E12-1 regression, outside the roteiro ============
    await t.test(
      '4b. E12-1: a restricted shared-field edit must reach the UI as CONTACT_FIELD_RESTRICTED',
      async () => {
        // Regression guard for E12-1. operation-runtime.js throws 403
        // CONTACT_FIELD_RESTRICTED and ClientRegistration.vue keeps the draft
        // only for that code (or CONTACT_REVIEW_REQUIRED). Before the fix,
        // operation-routes.js respond() masked both as 403 INVALID_REQUEST,
        // which the UI treats as lost access. The public code must survive.
        const refused = await as(
          B,
          'POST',
          `/api/v1/contacts/${R.contact2}/details`,
          R.restrictedEdit,
        );
        assert.equal(refused.statusCode, 403, refused.body);
        assert.equal(code(refused), 'CONTACT_FIELD_RESTRICTED');
      },
    );

    // ============ 4c. E12-3 regression, outside the roteiro ============
    await t.test(
      '4c. E12-3: two concurrent ficha POSTs with the same key both answer 202 with one command',
      async () => {
        // Regression guard for E12-3. Before the fix, writeGeneratedPdf
        // (postgres-chat-media-upload-repository.js) locked the quota row and
        // only then took the FK KEY SHARE on the conversation, while the
        // final order-whatsapp-pdf-runtime.js transaction locks the
        // conversation FOR UPDATE and then the same quota row: a double
        // click/second tab deadlocked (40P01) and answered 500. The writer
        // now takes the actor user and the conversation before the quota, so
        // both POSTs must answer 202 with a single command and no duplicate.
        const path = `/api/v1/orders/${R.confirmedRace}/pdf/whatsapp`;
        const prepared = body(
          await as(A, 'GET', `${path}?expectedVersion=1`),
          200,
        );
        const raceKey = randomUUID();
        const results = await Promise.all(
          [0, 1].map(() =>
            as(
              A,
              'POST',
              path,
              { expectedVersion: 1, preparation: prepared.preparation },
              { 'idempotency-key': raceKey },
            ),
          ),
        );
        const commandIds = (
          await pool.query(
            "SELECT command_id FROM crm.n8n_commands WHERE command_id LIKE 'order-pdf:%' AND message_id IN (SELECT id FROM crm.messages WHERE conversation_id=$1)",
            [R.convA2],
          )
        ).rows;
        R.raceCommands = commandIds.length;
        assert.equal(commandIds.length, 1, 'never two commands');
        for (const result of results)
          assert.equal(result.statusCode, 202, result.body);
        assert.deepEqual(results[0].json(), results[1].json());
      },
    );

    // ============ 4d. ficha PDF through A's line ============
    await t.test(
      '4d. T05-07 ficha PDF of the Pedido of A goes through the line of A only; offline after dispatch still settles; repeated result is a no-op',
      async () => {
        // Ficha PDF of A's confirmed Pedido through A's line only.
        const pdfPath = `/api/v1/orders/${R.confirmed}/pdf/whatsapp`;
        assert.equal(
          (await as(B, 'GET', `${pdfPath}?expectedVersion=1`)).statusCode,
          403,
        );
        const prepared = body(
          await as(A, 'GET', `${pdfPath}?expectedVersion=1`),
          200,
        );
        assert.equal(prepared.sender, `••••${NA.slice(-4)}`);
        assert.equal(prepared.recipient, `••••${P2.slice(-4)}`);
        const pdfKey = randomUUID();
        /** @returns {Promise<any>} */
        const post = () =>
          as(
            A,
            'POST',
            pdfPath,
            { expectedVersion: 1, preparation: prepared.preparation },
            { 'idempotency-key': pdfKey },
          );
        // A second POST with the same key (lost reply, second tab) replays.
        const q1 = body(await post(), 202);
        const q2 = body(await post(), 202);
        assert.deepEqual(q1, q2);
        assert.equal(
          await count('crm.n8n_commands WHERE message_id=$1', [q1.messageId]),
          1,
        );
        const pdfCommand = await commandOf(q1.messageId);
        const aLine = await lineOf(A);
        const bLine = await lineOf(B);
        const commandsBefore = await count('crm.n8n_commands');
        const pdfSend = await deliver(pdfCommand, aLine, {
          media: true,
          // The line drops right after the provider accepted the document.
          afterDispatch: async () => {
            const current = await me(A);
            body(
              await as(A, 'POST', '/api/v1/me/whatsapp/disconnect', {
                expectedVersion: current.line.version,
                expectedGeneration: current.line.generation,
              }),
              202,
            );
            await drainControl();
            assert.equal((await me(A)).line.state, 'disconnected');
          },
        });
        assert.equal(pdfSend.preflight.instance, aLine.instance);
        assert.notEqual(pdfSend.preflight.instance, bLine.instance);
        const document = (
          await pool.query('SELECT * FROM crm.messages WHERE id=$1', [
            q1.messageId,
          ])
        ).rows[0];
        assert.equal(document.message_type, 'document');
        assert.equal(document.status, 'sent');
        assert.equal(document.provider_account_id, aLine.source.accountId);
        assert.equal(document.author_id, A);
        // A repeated result callback never emits a second command.
        const repeated = body(
          await event(
            {
              ...pdfSend.reserve,
              message: undefined,
              event_type: 'message.sent',
              event_id: `sent:${pdfCommand}`,
              external_message_id: pdfSend.externalId,
            },
            { ...pdfSend.technical, key: `sent:${pdfCommand}` },
          ),
          200,
        );
        assert.equal(repeated.accepted, true);
        assert.equal(await count('crm.n8n_commands'), commandsBefore);
        assert.equal(
          await S.store.loadForDelivery(pdfCommand, { now: new Date() }),
          null,
        );
        assert.equal(
          transport.filter((call) => call.commandId === pdfCommand).length,
          1,
        );
      },
    );

    /** Confirmed ficha on a real conversation, as the E08 fixture does.
     * @param {string} conversationId @param {string} owner */
    async function seedConfirmedOrder(conversationId, owner) {
      const id = `order-e12-${randomUUID()}`;
      const contact = (
        await pool.query(
          `SELECT i.current_contact_id FROM crm.conversations c
           JOIN crm.contact_identities i ON i.id=c.contact_identity_id WHERE c.id=$1`,
          [conversationId],
        )
      ).rows[0].current_contact_id;
      const sequence = Number(
        (await pool.query("SELECT nextval('crm.order_number_seq') AS n"))
          .rows[0].n,
      );
      const at = new Date();
      await pool.query(
        `INSERT INTO crm.orders(id,number_sequence,number,conversation_id,contact_id,origin,status,fab_code,ficha_envelope,total_pieces,final_amount_cents,payment_condition,order_date,confirmed_at,confirmed_by,created_by_kind,created_by,created_at,updated_at,is_test)
         VALUES ($1,$2,$3,$4,$5,'atendimento','confirmado','01',$6::jsonb,2,10000,'pix',$7::date,$8,$9,'user',$9,$8,$8,false)`,
        [
          id,
          sequence,
          `${String(sequence).padStart(2, '0')}-CRM`,
          conversationId,
          contact,
          JSON.stringify(
            encryptOrderJson(
              {
                summary: { cliente: 'Cliente sintético' },
                items: [],
                artwork: {},
                serviceData: {},
              },
              `order-ficha:${id}`,
              key,
            ),
          ),
          at.toISOString().slice(0, 10),
          at,
          owner,
        ],
      );
      return id;
    }

    // ============ 5. final ledger and shutdown ============
    await t.test(
      '5. ledger, audit and canaries consistent; flags off block new effects while history and ACL remain',
      async () => {
        const commands = (
          await pool.query(
            'SELECT command_id,status,message_id FROM crm.n8n_commands ORDER BY created_at',
          )
        ).rows;
        // 4 Inbox sends + 2 first sends + 1 ficha PDF delivered once each,
        // plus the 4c probe command that is never dispatched.
        assert.equal(R.raceCommands, 1);
        assert.equal(commands.length, 8);
        assert.equal(new Set(commands.map((c) => c.message_id)).size, 8);
        const perCommand = new Map();
        for (const call of transport)
          perCommand.set(
            call.commandId,
            (perCommand.get(call.commandId) ?? 0) + 1,
          );
        assert.equal(perCommand.size, 7);
        assert.ok([...perCommand.values()].every((n) => n === 1));
        assert.deepEqual(
          commands.map((c) => c.status).sort(),
          [...Array(6).fill('sent'), 'outcome_unknown', 'pending'].sort(),
        );
        const duplicates = await count(
          `(SELECT provider_account_id,external_message_id FROM crm.messages
            WHERE external_message_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) d`,
        );
        assert.equal(duplicates, 0);
        const ledger = (
          await pool.query(
            `SELECT count(*)::int AS orders, count(DISTINCT number)::int AS numbers,
              (SELECT count(*)::int FROM crm.domain_events WHERE event_type='order.created') AS events
             FROM crm.orders WHERE origin_subject_id IS NOT NULL`,
          )
        ).rows[0];
        assert.deepEqual(ledger, { orders: 3, numbers: 3, events: 3 });
        for (const action of [
          'whatsapp.control',
          'conversation.first_message_queued',
          'order.ficha.whatsapp.queued',
        ])
          assert.ok(
            (await count('crm.audit_events WHERE action=$1', [action])) > 0,
            action,
          );
        assert.equal(
          await count(
            "crm.audit_events WHERE action='conversation.first_message_queued'",
          ),
          2,
        );
        const scan = await canaryHits();
        assert.deepEqual(scan.hits, []);
        assert.deepEqual(scan.logHits, []);
        // Stubs only: every URL any adapter or the process reached.
        const hosts = new Set(urls.map((value) => new URL(value).hostname));
        for (const host of hosts)
          assert.ok(
            host === '127.0.0.1' || host.endsWith('.test'),
            `unexpected host ${host}`,
          );
        t.diagnostic(`hosts reached: ${[...hosts].sort().join(',')}`);

        // Shutdown: every flag off again.
        await reboot(flags());
        const b = await lineOf(B);
        const effects = {
          messages: await count('crm.messages'),
          commands: await count('crm.n8n_commands'),
          orders: await count('crm.orders'),
          lines: await count('crm.seller_whatsapp_operations'),
        };
        assert.equal(
          code(
            await as(B, 'POST', '/api/v1/me/whatsapp/disconnect', {
              expectedVersion: b.version,
              expectedGeneration: b.generation,
            }),
          ),
          'WHATSAPP_CONTROL_DISABLED',
        );
        assert.equal(
          code(
            await as(
              B,
              'GET',
              `/api/v1/contacts/${R.contact2}/whatsapp/first-message-preview`,
            ),
          ),
          'SELLER_WHATSAPP_FIRST_SEND_DISABLED',
        );
        assert.equal(
          (await as(B, 'GET', '/api/v1/me/clients')).statusCode,
          503,
        );
        const sendOff = await as(
          B,
          'POST',
          `/api/v1/conversations/${R.convB2}/messages`,
          {
            content: { text: 'Bloqueada' },
            expectedVersion: await version('conversations', R.convB2),
            messageType: 'text',
            reason: 'synthetic',
          },
        );
        // Fail closed; the public code is checked in 5b (E12-2).
        assert.equal(sendOff.statusCode, 503, sendOff.body);
        R.sendOff = {
          content: { text: 'Bloqueada' },
          messageType: 'text',
          reason: 'synthetic',
        };
        const targetOff = body(
          await as(
            B,
            'POST',
            `/api/v1/inbox/conversations/${R.convB2}/subjects`,
            { select: true },
          ),
          201,
        ).subject.id;
        const orderOff = await as(
          B,
          'POST',
          `/api/v1/conversations/${R.convB2}/orders`,
          {
            expectedVersion: await version('conversations', R.convB2),
            subjectId: targetOff,
            expectedSubjectVersion: await version(
              'conversation_subjects',
              targetOff,
            ),
          },
        );
        assert.notEqual(orderOff.statusCode, 201);
        assert.equal(code(orderOff), 'ORDER_SUBJECT_UNAVAILABLE');
        const probe = (
          await pool.query(
            "SELECT command_id FROM crm.n8n_commands WHERE status='pending'",
          )
        ).rows[0].command_id;
        const calls = transport.length;
        assert.equal(
          await S.store.loadForDelivery(probe, { now: new Date() }),
          null,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT status,whatsapp_dispatched_at FROM crm.n8n_commands WHERE command_id=$1',
              [probe],
            )
          ).rows[0].whatsapp_dispatched_at,
          null,
        );
        assert.equal(transport.length, calls);
        effects.commands = await count('crm.n8n_commands');
        const inboundOff = await inbound(b.source, 'after-shutdown', P2);
        assert.equal(inboundOff.statusCode, 403, inboundOff.body);
        assert.equal(code(inboundOff), 'N8N_FORBIDDEN');
        assert.deepEqual(
          {
            messages: await count('crm.messages'),
            commands: await count('crm.n8n_commands'),
            orders: await count('crm.orders'),
            lines: await count('crm.seller_whatsapp_operations'),
          },
          effects,
        );
        // History and ACL remain with every flag off.
        body(await as(A, 'GET', `/api/v1/inbox/conversations/${R.convA}`), 200);
        body(
          await as(B, 'GET', `/api/v1/inbox/conversations/${R.convB2}`),
          200,
        );
        denied(await as(B, 'GET', `/api/v1/inbox/conversations/${R.convA}`), [
          R.contactX,
        ]);
        denied(await as(B, 'GET', R.mediaPath), [R.contactX]);
        assert.equal(
          body(await as(A, 'GET', `/api/v1/orders/${R.orderA.id}`), 200).order
            .number,
          R.orderA.number,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM crm.n8n_commands WHERE command_id=$1',
              [R.lostCommand],
            )
          ).rows[0].status,
          'outcome_unknown',
        );
      },
    );

    // ============ 5b. E12-2 regression, outside the roteiro ============
    await t.test(
      '5b. E12-2: flag-off public codes match the flags table (SELLER_CLIENTS_DISABLED, WHATSAPP_SEND_UNAVAILABLE)',
      async () => {
        // Regression guard for E12-2. Flags still off. The runtimes throw the
        // documented codes; before the fix, the HTTP boundaries published
        // every 5xx as SERVICE_UNAVAILABLE (operation-routes.js respond() for
        // /me/clients, conversation-routes.js respond() for the Inbox send).
        // InboxView.vue keeps the draft and explains the offline line only
        // for WHATSAPP_SEND_UNAVAILABLE, so the documented codes must reach
        // the seller instead of a generic failure.
        const clients = await as(B, 'GET', '/api/v1/me/clients');
        const send = await as(
          B,
          'POST',
          `/api/v1/conversations/${R.convB2}/messages`,
          {
            ...R.sendOff,
            expectedVersion: await version('conversations', R.convB2),
          },
        );
        assert.deepEqual(
          {
            clients: [clients.statusCode, code(clients)],
            send: [send.statusCode, code(send)],
          },
          {
            clients: [503, 'SELLER_CLIENTS_DISABLED'],
            send: [503, 'WHATSAPP_SEND_UNAVAILABLE'],
          },
        );
      },
    );
  },
);

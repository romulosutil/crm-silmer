import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { contactPhoneHash } from '../modules/contacts/src/index.js';
import { PostgresSellerWhatsAppRepository } from '../modules/inbox-channels/src/index.js';
import {
  createWhatsAppControlClient,
  PostgresJobQueue,
} from '../modules/integration-reliability/src/index.js';
import { createSafeLogger } from '../modules/shared/src/index.js';
import { createApi } from '../apps/api/src/app.js';
import { createAutomationAuthRuntime } from '../apps/api/src/automation-auth-runtime.js';
import { createSellerWhatsAppRuntime } from '../apps/api/src/seller-whatsapp-runtime.js';
import { createWhatsAppControlJobHandler } from '../apps/worker/src/whatsapp-control-runtime.js';
import { createWhatsAppControlWorkflows } from '../ops/n8n/whatsapp-control-workflows.mjs';

const { createControlAdapter } = /** @type {any} */ (
  createRequire(import.meta.url)('../ops/evolution/wap-control-runtime.cjs')
);
const { createGenerationRuntime } = /** @type {any} */ (
  createRequire(import.meta.url)('../ops/evolution/wap-generation-runtime.cjs')
);
const url = process.env.TEST_DATABASE_URL;

if (!url)
  test(
    'WAP control composition needs dedicated PostgreSQL',
    { skip: true },
    () => {},
  );
else {
  assert.equal(new URL(url).pathname, '/crm_silmer_test');
  test('WAP-E02 real PostgreSQL/API/worker and generated n8n DTOs compose with the real gateway adapter', async () => {
    const pool = new Pool({ connectionString: url, max: 6 });
    const db = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    const key = Buffer.alloc(32, 21),
      lookup = Buffer.alloc(32, 22);
    const actorId = 'wap-composition-seller';
    const expectedNumber = '5511990000042';
    const webhookUrl = 'https://n8n.test/webhook/silmer/seller-whatsapp/events';
    const environment = {
      SELLER_WHATSAPP_CONTROL_ENABLED: 'true',
      SELLER_WHATSAPP_SELLER_IDS: JSON.stringify([actorId]),
      CONTACT_IDENTITY_ENVELOPE_KEY: key.toString('base64'),
      CONTACT_IDENTITY_LOOKUP_KEY: lookup.toString('base64'),
      SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: contactPhoneHash(
        '5511990000099',
        lookup,
      ),
      SELLER_WHATSAPP_WEBHOOK_URL: webhookUrl,
    };
    const repository = new PostgresSellerWhatsAppRepository(db, {
      enabled: true,
      sellerAllowlist: [actorId],
      envelopeKey: key,
      lookupKey: lookup,
      generalNumberDigest: environment.SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST,
    });
    const actor = { id: actorId };
    /** @type {any} */ let adapter;
    /** @type {any} */ let workflows;
    let allowedLine = '';
    const secret = 'synthetic-technical-secret-'.repeat(2);
    const authorization = `Basic ${Buffer.from(`synthetic-crm:${secret}`).toString('base64')}`;
    const canary = 'WAPE02SYNTHETICCODE';
    const logs = /** @type {any[]} */ ([]);
    /** @type {string[]} */ const providerCalls = [];
    let releaseChallenge = () => {};
    let challengeEntered = () => {};
    let holdChallenge = false;
    let exists = false,
      providerState = 'close',
      instanceName = '';
    // Like Evolution, connect while already connecting reuses the socket.
    /** @type {object} */ let socket = {};
    const logger = createSafeLogger({
      service: 'crm-silmer-api',
      sink: (record) => logs.push(record),
    });
    /** @param {any} envelope @param {string} keyId @param {string} executionId */
    const technicalHeaders = (envelope, keyId, executionId) => ({
      authorization,
      'idempotency-key': keyId,
      'x-correlation-id': envelope.operationId,
      'x-silmer-workflow-key': 'seller-whatsapp-control',
      'x-silmer-workflow-version': '1.0',
      'x-silmer-execution-id': executionId,
    });
    /** Execute the generated Code nodes; reserve/results go through real HTTP routes + PostgreSQL.
     * The separate Docker rehearsal verifies n8n execution and persistence itself.
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
      assert.equal(
        verified.statusCode,
        200,
        'authoritative pre-persistence check',
      );
      const nodes = workflows[kind].nodes;
      /** @type {Record<string,any>} */ const outputs = {};
      /** @param {string} name @param {any} value */
      function code(name, value) {
        const node = nodes.find(
          (/** @type {any} */ entry) => entry.name === name,
        );
        return new Function('$json', '$', node.parameters.jsCode)(
          value,
          (/** @type {string} */ target) => ({
            first: () => ({ json: outputs[target] }),
          }),
        ).json;
      }
      outputs.Guard = code('Guard', { body: envelope });
      const reserved = await api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/whatsapp-control/operations',
        headers,
        payload: { kind, envelope: outputs.Guard },
      });
      assert.equal(reserved.statusCode, 200, 'effect reservation');
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
      assert.equal(callback.statusCode, 200, 'metadata result');
      return globalThis.Response.json({
        accepted: true,
        operationId: envelope.operationId,
        generation: envelope.generation,
      });
    }
    const client = createWhatsAppControlClient({
      enabled: true,
      allowlist: (id) => id === allowedLine,
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
      repository,
      client,
      access: {
        authorizeRead: async () => ({ actor }),
        authorizeWrite: async () => ({ actor }),
      },
    });
    const api = createApi(
      {},
      {
        logger,
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
    const humanHeaders = {
      origin: 'https://crm.test',
      cookie: 'crm_session=synthetic',
      'x-csrf-token': 'synthetic',
      'idempotency-key': randomUUID(),
    };
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      await pool.query(
        "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,'wap-composition@example.test','$argon2id$v=19$synthetic','Synthetic')",
        [actorId],
      );
      await pool.query(
        "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
        [actorId],
      );
      const connected = await api.inject({
        method: 'POST',
        url: '/api/v1/me/whatsapp/connect',
        headers: humanHeaders,
        payload: { expectedNumber, expectedVersion: 0 },
      });
      assert.equal(connected.statusCode, 202);
      allowedLine = connected.json().line.id;
      instanceName = (
        await pool.query(
          'SELECT instance_name FROM crm.seller_whatsapp_lines WHERE id=$1',
          [allowedLine],
        )
      ).rows[0].instance_name;
      workflows = createWhatsAppControlWorkflows({
        enabled: true,
        allowlist: [allowedLine],
        crmBaseUrl: 'https://crm.test',
        evolutionBaseUrl: 'https://evolution.test',
        webhookCredentialId: 'synthetic',
        crmCredentialId: 'synthetic',
        evolutionCredentialId: 'synthetic',
      });
      const socketRuntime = createGenerationRuntime({
        enabled: true,
        instances: [instanceName],
      });
      adapter = createControlAdapter({
        env: {
          SILMER_WAP_CONTROL_ENABLED: 'true',
          SILMER_WAP_GENERATION_ENABLED: 'true',
          SILMER_WAP_GENERATION_INSTANCES: instanceName,
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
          if (path === '/instance/fetchInstances')
            return globalThis.Response.json(
              exists
                ? [
                    {
                      name: instanceName,
                      connectionStatus: providerState,
                      ownerJid: `${expectedNumber}@s.whatsapp.net`,
                    },
                  ]
                : [],
            );
          if (path === '/instance/create') {
            exists = true;
            return globalThis.Response.json(
              { instance: { instanceName }, hash: 'private-create-response' },
              { status: 201 },
            );
          }
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
              instance: { state: providerState },
            });
          if (path.startsWith('/instance/connect/')) {
            if (providerState !== 'connecting') socket = {};
            socketRuntime.captureSocket(instanceName, socket);
            providerState = 'connecting';
            if (holdChallenge) {
              challengeEntered();
              await new Promise((resolve) => {
                releaseChallenge = () => resolve(undefined);
              });
            }
            return globalThis.Response.json({ pairingCode: canary });
          }
          if (path.startsWith('/instance/logout/')) {
            assert.equal(init.method, 'DELETE');
            providerState = 'close';
            return globalThis.Response.json({ success: true });
          }
          assert.match(path, /^\/webhook\/set\//u);
          return globalThis.Response.json({ success: true });
        },
      });
      const queue = new PostgresJobQueue({ database: db });
      const handler = createWhatsAppControlJobHandler({ repository, client });
      /** @param {any} job */
      async function deliver(job) {
        const result = await handler(job, {
          markEffectStarted: async () => true,
        });
        assert.equal(result.outcome, 'sent');
      }
      const jobs = await queue.claim({
        queue: 'whatsapp_control',
        workerId: 'synthetic',
        limit: 5,
      });
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].whatsappOperationId, connected.json().operation.id);
      await deliver(jobs[0]);
      let current = await repository.get({ actorId });
      assert.equal(
        current.line.state,
        'awaiting_pairing',
        'prepare verifies webhook and leaves challenge available',
      );
      const challengePayload = {
        operationId: current.operation.id,
        expectedVersion: current.line.version,
        generation: current.line.generation,
        mode: 'code',
      };
      const challenged = await api.inject({
        method: 'POST',
        url: '/api/v1/me/whatsapp/pairing-challenge',
        headers: humanHeaders,
        payload: challengePayload,
      });
      assert.equal(challenged.statusCode, 200);
      assert.equal(challenged.json().value, canary);
      const replay = await api.inject({
        method: 'POST',
        url: '/api/v1/me/whatsapp/pairing-challenge',
        headers: humanHeaders,
        payload: challengePayload,
      });
      assert.equal(replay.statusCode, 409);
      assert.equal(
        providerCalls.filter((path) => path.startsWith('/instance/connect/'))
          .length,
        1,
      );
      // A reload/new tab only has the GET: metadata, never the bytes.
      /** @returns {Promise<any>} */
      const read = async () => {
        const response = await api.inject({
          method: 'GET',
          url: '/api/v1/me/whatsapp',
          headers: humanHeaders,
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.includes(canary), false);
        return response.json();
      };
      let view = await read();
      assert.deepEqual(view.challenge, {
        id: challenged.json().challengeId,
        state: 'delivered',
        expiresAt: challenged.json().expiresAt,
      });
      /** @param {any} state */
      const renew = (state) =>
        api.inject({
          method: 'POST',
          url: '/api/v1/me/whatsapp/pairing-challenge',
          headers: { ...humanHeaders, 'idempotency-key': randomUUID() },
          payload: {
            operationId: state.operation.id,
            expectedVersion: state.line.version,
            generation: state.line.generation,
            mode: 'code',
            renewChallengeId: state.challenge.id,
          },
        });
      const early = await renew(view);
      assert.equal(early.statusCode, 409, 'not reconciled yet');
      assert.equal(early.body.includes(canary), false);
      await deliver({
        jobType: 'whatsapp.control.reconcile',
        whatsappOperationId: current.operation.id,
        whatsappAction: 'reconcile',
      });
      view = await read();
      assert.equal(view.line.state, 'awaiting_pairing');
      assert.equal(view.challenge.state, 'resolved');
      const renewed = await renew(view);
      assert.equal(renewed.statusCode, 200);
      assert.equal(renewed.json().value, canary);
      assert.equal((await read()).challenge.id, renewed.json().challengeId);
      assert.equal(
        providerCalls.filter((path) => path.startsWith('/instance/connect/'))
          .length,
        2,
      );
      providerState = 'open';
      await deliver({
        jobType: 'whatsapp.control.reconcile',
        whatsappOperationId: current.operation.id,
        whatsappAction: 'reconcile',
      });
      current = await repository.get({ actorId });
      assert.equal(
        current.line.state,
        'connected',
        'provider number and webhook proof activate only by read',
      );
      const disconnected = await api.inject({
        method: 'POST',
        url: '/api/v1/me/whatsapp/disconnect',
        headers: { ...humanHeaders, 'idempotency-key': randomUUID() },
        payload: {
          expectedVersion: current.line.version,
          expectedGeneration: current.line.generation,
        },
      });
      assert.equal(disconnected.statusCode, 202);
      await deliver({
        jobType: 'whatsapp.control.deliver',
        whatsappOperationId: disconnected.json().operation.id,
        whatsappAction: 'disconnect',
      });
      assert.equal(
        (await repository.get({ actorId })).line.state,
        'disconnected',
      );
      // Another tab can revoke while the synchronous provider challenge runs.
      // Read reconciliation must precede the first logout of that generation.
      current = await repository.get({ actorId });
      const reconnected = await api.inject({
        method: 'POST',
        url: '/api/v1/me/whatsapp/connect',
        headers: { ...humanHeaders, 'idempotency-key': randomUUID() },
        payload: { expectedNumber, expectedVersion: current.line.version },
      });
      assert.equal(reconnected.statusCode, 202);
      await deliver({
        jobType: 'whatsapp.control.deliver',
        whatsappOperationId: reconnected.json().operation.id,
        whatsappAction: 'connect',
      });
      current = await repository.get({ actorId });
      holdChallenge = true;
      const entered = new Promise((resolve) => {
        challengeEntered = () => resolve(undefined);
      });
      const inFlight = api.inject({
        method: 'POST',
        url: '/api/v1/me/whatsapp/pairing-challenge',
        headers: { ...humanHeaders, 'idempotency-key': randomUUID() },
        payload: {
          operationId: current.operation.id,
          expectedVersion: current.line.version,
          generation: current.line.generation,
          mode: 'code',
        },
      });
      await entered;
      current = await repository.get({ actorId });
      const cutoff = await api.inject({
        method: 'POST',
        url: '/api/v1/me/whatsapp/disconnect',
        headers: { ...humanHeaders, 'idempotency-key': randomUUID() },
        payload: {
          expectedVersion: current.line.version,
          expectedGeneration: current.line.generation,
        },
      });
      assert.equal(cutoff.statusCode, 202);
      assert.equal(cutoff.json().revocation.state, 'waiting_reconciliation');
      assert.equal(
        providerCalls.filter((path) => path.startsWith('/instance/logout/'))
          .length,
        1,
      );
      releaseChallenge();
      const late = await inFlight;
      assert.equal(late.statusCode, 409);
      assert.equal(late.body.includes(canary), false);
      await deliver({
        jobType: 'whatsapp.control.reconcile',
        whatsappOperationId: current.operation.id,
        whatsappAction: 'reconcile',
      });
      const cleanup = await repository.get({ actorId });
      assert.equal(cleanup.operation.action, 'disconnect');
      await deliver({
        jobType: 'whatsapp.control.deliver',
        whatsappOperationId: cleanup.operation.id,
        whatsappAction: 'disconnect',
      });
      assert.equal(
        (await repository.get({ actorId })).line.state,
        'disconnected',
      );
      assert.equal(
        providerCalls.filter((path) => path.startsWith('/instance/logout/'))
          .length,
        2,
      );
      for (const table of [
        'seller_whatsapp_operations',
        'seller_whatsapp_challenges',
        'seller_whatsapp_results',
        'outbox_jobs',
        'audit_events',
      ]) {
        const rows = (
          await pool.query(`SELECT row_to_json(t) AS value FROM crm.${table} t`)
        ).rows;
        assert.equal(
          JSON.stringify(rows).includes(canary),
          false,
          `${table} cannot contain challenge bytes`,
        );
      }
      assert.equal(JSON.stringify(logs).includes(canary), false);
    } finally {
      await api.close();
      await pool.end();
    }
  });
}

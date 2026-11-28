import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApi } from '../apps/api/src/app.js';
import { readHumanControl } from '../apps/api/src/seller-whatsapp-contract.js';
import { createSellerWhatsAppRuntime } from '../apps/api/src/seller-whatsapp-runtime.js';
import {
  createWhatsAppControlJobHandler,
  createWhatsAppControlWorkerRuntime,
} from '../apps/worker/src/whatsapp-control-runtime.js';
import { authorize } from '../modules/identity-access/src/authorization.js';
import { createAutomationCredentials } from '../modules/identity-access/src/automation-credentials.js';
import { sellerWhatsAppConfiguration } from '../modules/inbox-channels/src/seller-whatsapp-configuration.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

const operationId = randomUUID();
const lineId = randomUUID();
const reference = randomUUID();
const generation = 1;
const logger = createSafeLogger({ service: 'crm-silmer-api', sink: () => {} });
const actor = {
  id: 'synthetic-a',
  functionName: /** @type {const} */ ('Vendedor'),
  capabilities: [],
  kind: /** @type {const} */ ('human'),
};
const headers = {
  cookie: 'crm_session=synthetic',
  origin: 'https://crm.test',
  'x-csrf-token': 'synthetic-csrf',
  'idempotency-key': randomUUID(),
};
const environment = {
  SELLER_WHATSAPP_CONTROL_ENABLED: 'true',
  SELLER_WHATSAPP_SELLER_IDS: '["synthetic-a"]',
  CONTACT_IDENTITY_ENVELOPE_KEY: Buffer.alloc(32, 5).toString('base64'),
  CONTACT_IDENTITY_LOOKUP_KEY: Buffer.alloc(32, 6).toString('base64'),
  SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: 'a'.repeat(64),
  SELLER_WHATSAPP_WEBHOOK_URL:
    'https://n8n.test/webhook/silmer/seller-whatsapp/events',
};
/** @param {any} input */
async function access(input) {
  assert.ok(
    ['whatsapp.personal.manage', 'whatsapp.personal.read'].includes(
      input.action,
    ),
  );
  if (input.cookie !== headers.cookie)
    throw Object.assign(new Error('INVALID_SESSION'), {
      code: 'INVALID_SESSION',
      statusCode: 401,
    });
  if (
    input.origin !== headers.origin ||
    (input.action.endsWith('manage') &&
      input.csrfToken !== headers['x-csrf-token'])
  )
    throw Object.assign(new Error('FORBIDDEN'), {
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  return { actor };
}
/** @param {any} [options] */
function fixture(options = {}) {
  const calls = {
    get: 0,
    submit: 0,
    reserve: 0,
    verify: 0,
    ingress: 0,
    result: 0,
    begin: 0,
    finish: /** @type {any[]} */ ([]),
    challenge: 0,
    submitted: /** @type {any[]} */ ([]),
  };
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  const challengeId = randomUUID();
  const repository = {
    get: async () => {
      calls.get++;
      return {
        line: {
          id: lineId,
          state: 'awaiting_pairing',
          generation,
          version: 1,
          maskedNumber: '••••0000',
        },
        ...options.state,
      };
    },
    submit: async (/** @type {any} */ command) => {
      calls.submit++;
      calls.submitted.push(command);
      assert.equal(command.actorId, actor.id);
      assert.equal(command.instanceName, undefined);
      return {
        operation: {
          id: operationId,
          lineId,
          generation,
          action: command.action,
          state: 'pending',
          reference,
        },
      };
    },
    beginChallenge: async () => {
      calls.begin++;
      return {
        challengeId,
        operationId,
        lineId,
        generation,
        mode: 'qr',
        expiresAt,
        reference,
      };
    },
    finishChallenge: async (/** @type {any} */ input) => {
      calls.finish.push(input);
      return { deliverable: options.deliverable !== false, version: 2 };
    },
    reserveControl: async () => {
      calls.reserve++;
      return {
        operationId,
        lineId,
        generation,
        reference,
        instanceName: 'opaque-instance',
        source: { lineId },
        resultId: randomUUID(),
      };
    },
    reserveChallenge: async () => {
      calls.reserve++;
      return {
        operationId,
        lineId,
        generation,
        reference,
        instanceName: 'opaque-instance',
        expiresAt,
      };
    },
    verifyEnvelope: async (/** @type {any} */ input) => {
      calls.verify++;
      return input.envelope;
    },
    verifyIngress: async (/** @type {any} */ input) => {
      calls.ingress++;
      assert.equal(input.token, 'synthetic-ingress-token');
      return {
        source: input.source,
        instance: input.instance,
        ...(input.messageTimestamp === 1_795_872_000
          ? { ignored: 'before_cutover' }
          : {}),
      };
    },
    result: async () => {
      calls.result++;
      return { accepted: true };
    },
  };
  const service = createSellerWhatsAppRuntime(
    {},
    {
      repository,
      environment,
      access: {
        authorizeRead: options.access ?? access,
        authorizeWrite: options.access ?? access,
      },
      client: {
        challenge: async () => {
          calls.challenge++;
          if (options.fail) throw new Error('secret-provider-body');
          return {
            challengeId,
            operationId,
            generation,
            mode: 'qr',
            expiresAt,
            value: 'synthetic-ephemeral-challenge',
            ...options.challenge,
          };
        },
      },
    },
  );
  const api = createApi(
    {},
    {
      logger,
      sellerWhatsApp: service,
      automationAuth: {
        authorize: async (input) => {
          if (input.authorization !== 'Basic synthetic')
            throw Object.assign(new Error('FORBIDDEN'), {
              code: 'FORBIDDEN',
              statusCode: 403,
            });
          return {
            actor: { id: 'AUTOMATION_EXECUTOR' },
            credentialVersion: 'current',
          };
        },
      },
    },
  );
  return { api, calls, service, challengeId };
}
/** @param {string} id @param {any} [extra] */
function technicalHeaders(id, extra = {}) {
  return {
    authorization: 'Basic synthetic',
    'idempotency-key': id,
    'x-correlation-id': operationId,
    'x-silmer-workflow-key': 'seller-whatsapp-control',
    'x-silmer-workflow-version': '1.0',
    'x-silmer-execution-id': 'execution-synthetic',
    ...extra,
  };
}

test('WAP-T05: ingress admits a 243-event reconnect burst for one binding', async (t) => {
  const { api, calls } = fixture();
  t.after(() => api.close());
  const bindingId = randomUUID();
  const payload = {
    source: { bindingId, lineId, accountId: randomUUID(), generation },
    instance: 'opaque-instance',
  };
  const responses = await Promise.all(
    Array.from({ length: 243 }, () =>
      api.inject({
        method: 'POST',
        url: '/api/v1/integrations/n8n/whatsapp-control/ingress/verify',
        headers: technicalHeaders(bindingId, {
          'x-correlation-id': bindingId,
          'x-silmer-wap-generation-token': 'synthetic-ingress-token',
        }),
        payload,
      }),
    ),
  );
  for (const response of responses) {
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), payload);
  }
  assert.equal(calls.ingress, 243);
});

test('WAP-T05: ingress verifier accepts whole epoch seconds only for authenticated message events', async (t) => {
  const { api, calls } = fixture();
  t.after(() => api.close());
  const bindingId = randomUUID();
  const payload = {
    source: { bindingId, lineId, accountId: randomUUID(), generation },
    instance: 'opaque-instance',
    sender: '5511990000081@s.whatsapp.net',
    messageTimestamp: 1_795_872_000,
  };
  const request = (/** @type {any} */ body) =>
    api.inject({
      method: 'POST',
      url: '/api/v1/integrations/n8n/whatsapp-control/ingress/verify',
      headers: technicalHeaders(bindingId, {
        'x-correlation-id': bindingId,
        'x-silmer-wap-generation-token': 'synthetic-ingress-token',
      }),
      payload: body,
    });
  const accepted = await request(payload);
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), {
    source: payload.source,
    instance: payload.instance,
    ignored: 'before_cutover',
  });
  for (const invalid of [
    { ...payload, messageTimestamp: 1.5 },
    { ...payload, messageTimestamp: '1795872000' },
    { ...payload, sender: undefined },
    { ...payload, sender: undefined, recovery: true },
  ])
    assert.equal((await request(invalid)).statusCode, 400);
  assert.equal(calls.ingress, 1);
});

test('WAP control and configuration are default off, and new capabilities stay deny-by-default', async () => {
  assert.equal(sellerWhatsAppConfiguration({}).enabled, false);
  assert.throws(() =>
    sellerWhatsAppConfiguration({ SELLER_WHATSAPP_CONTROL_ENABLED: 'true' }),
  );
  const api = createApi({}, { logger });
  for (const method of ['GET', 'POST']) {
    const response = await api.inject({
      method: /** @type {any} */ (method),
      url: `/api/v1/me/whatsapp${method === 'POST' ? '/connect' : ''}`,
    });
    assert.equal(response.statusCode, 503);
    assert.match(String(response.headers['cache-control']), /no-store/u);
  }
  for (const action of ['whatsapp.personal.read', 'whatsapp.personal.manage']) {
    authorize(actor, action);
    assert.throws(() =>
      authorize({ ...actor, functionName: 'Financeiro' }, action),
    );
    assert.throws(() =>
      authorize({ ...actor, disabledAt: new Date().toISOString() }, action),
    );
  }
  const technical = createAutomationCredentials({
    clientId: 'synthetic',
    currentSecret: 'a'.repeat(32),
  }).authenticate('synthetic', 'a'.repeat(32));
  assert.ok(technical);
  await api.close();
});

test('human GET is read-only, server derives owner and rejects auth/CSRF/origin/extra destinations', async () => {
  const { api, calls } = fixture();
  const state = await api.inject({
    method: 'GET',
    url: '/api/v1/me/whatsapp',
    headers,
  });
  assert.equal(state.statusCode, 200);
  assert.equal(calls.submit, 0);
  assert.equal(calls.get, 1);
  for (const bad of [
    { ...headers, authorization: 'Basic synthetic' },
    { ...headers, cookie: '' },
    { ...headers, origin: 'https://evil.test' },
    { ...headers, 'x-csrf-token': '' },
  ]) {
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/me/whatsapp/connect',
      headers: bad,
      payload: { expectedNumber: '+5511999990000', expectedVersion: 0 },
    });
    assert.ok([401, 403].includes(response.statusCode));
  }
  for (const field of [
    'userId',
    'instanceName',
    'url',
    'destination',
    'code',
    'qr',
  ]) {
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/me/whatsapp/connect',
      headers,
      payload: {
        expectedNumber: '+5511999990000',
        expectedVersion: 0,
        [field]: 'synthetic-canary',
      },
    });
    assert.equal(response.statusCode, 400);
  }
  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/me/whatsapp/connect',
    headers,
    payload: { expectedNumber: '+5511999990000', expectedVersion: 0 },
  });
  assert.equal(response.statusCode, 202);
  assert.equal(calls.submit, 1);
  assert.doesNotMatch(response.body, /5511999990000|instance|token/u);
  await api.close();
});

test('WAP-E12: connect accepts a body without expectedNumber, so the stored number reconnects', async () => {
  assert.deepEqual(readHumanControl({ expectedVersion: 4 }, 'connect'), {
    expectedVersion: 4,
  });
  assert.deepEqual(
    readHumanControl(
      { expectedNumber: '+5511999990000', expectedVersion: 0 },
      'connect',
    ),
    { expectedNumber: '+5511999990000', expectedVersion: 0 },
  );
  for (const bad of [
    {},
    { expectedNumber: null, expectedVersion: 4 },
    { expectedNumber: '', expectedVersion: 4 },
    { expectedNumber: '123', expectedVersion: 4 },
    { expectedVersion: -1 },
    { expectedVersion: 4, instanceName: 'synthetic-canary' },
  ])
    assert.throws(() => readHumanControl(bad, 'connect'), {
      code: 'INVALID_REQUEST',
    });
  const { api, calls } = fixture();
  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/me/whatsapp/connect',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { expectedVersion: 4 },
  });
  assert.equal(response.statusCode, 202);
  assert.equal(calls.submitted.length, 1);
  assert.equal('expectedNumber' in calls.submitted[0], false);
  assert.equal(calls.submitted[0].expectedVersion, 4);
  assert.equal(calls.submitted[0].action, 'connect');
  await api.close();
});

test('human GET projects only challenge metadata for the holder, never the bytes', async () => {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  const { api } = fixture({
    state: {
      challenge: {
        id,
        state: 'resolved',
        expiresAt,
        value: 'synthetic-ephemeral-challenge',
        reference,
        mode: 'qr',
      },
    },
  });
  const response = await api.inject({
    method: 'GET',
    url: '/api/v1/me/whatsapp',
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['cache-control']), /no-store/u);
  assert.deepEqual(response.json().challenge, {
    id,
    state: 'resolved',
    expiresAt,
  });
  assert.doesNotMatch(
    response.body,
    new RegExp(`synthetic-ephemeral|${reference}`, 'u'),
  );
  await api.close();
  for (const challenge of [null, undefined]) {
    const empty = fixture({ state: { challenge } });
    const read = await empty.api.inject({
      method: 'GET',
      url: '/api/v1/me/whatsapp',
      headers,
    });
    assert.equal(read.json().challenge, null);
    await empty.api.close();
  }
  for (const challenge of [
    { id: 'not-a-uuid', state: 'resolved', expiresAt },
    { id, state: 'forged', expiresAt },
    { id, state: 'resolved', expiresAt: 'tomorrow' },
  ]) {
    const forged = fixture({ state: { challenge } });
    const read = await forged.api.inject({
      method: 'GET',
      url: '/api/v1/me/whatsapp',
      headers,
    });
    assert.equal(read.statusCode, 503);
    assert.doesNotMatch(read.body, /not-a-uuid|forged|tomorrow/u);
    await forged.api.close();
  }
});

test('technical control requires Basic, workflow/version, matching correlation/key and strict metadata', async () => {
  const { api, calls } = fixture();
  const payload = {
    kind: 'control',
    envelope: { operationId, lineId, generation, action: 'connect', reference },
  };
  for (const changed of [
    { authorization: '' },
    { 'x-silmer-workflow-key': 'another' },
    { 'x-silmer-workflow-version': '2.0' },
    { 'x-correlation-id': randomUUID() },
    { 'idempotency-key': randomUUID() },
    { 'x-silmer-execution-id': '' },
  ]) {
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/integrations/n8n/whatsapp-control/operations',
      headers: technicalHeaders(operationId, changed),
      payload,
    });
    assert.ok([400, 401, 403].includes(response.statusCode));
  }
  assert.equal(calls.reserve, 0);
  const verify = await api.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/whatsapp-control/verify',
    headers: technicalHeaders(operationId),
    payload,
  });
  assert.equal(verify.statusCode, 200);
  assert.deepEqual(verify.json(), payload);
  assert.equal(calls.reserve, 0);
  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/whatsapp-control/operations',
    headers: technicalHeaders(operationId),
    payload,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().instance, 'opaque-instance');
  const resultId = randomUUID();
  const result = {
    operationId,
    lineId,
    generation,
    resultId,
    effect: 'connect',
    outcome: 'succeeded',
    providerState: 'close',
    webhookVerified: true,
  };
  for (const field of ['qr', 'code', 'payload', 'token']) {
    const rejected = await api.inject({
      method: 'POST',
      url: '/api/v1/integrations/n8n/whatsapp-control/results',
      headers: technicalHeaders(resultId),
      payload: { ...result, [field]: 'canary' },
    });
    assert.equal(rejected.statusCode, 400);
  }
  const accepted = await api.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/whatsapp-control/results',
    headers: technicalHeaders(resultId),
    payload: result,
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(calls.result, 1);
  await api.close();
});

test('ephemeral challenge validates TTL/correlation and reauthorizes after n8n before delivery', async () => {
  for (const scenario of [
    {},
    { fail: true },
    { deliverable: false },
    { challenge: { generation: 99 } },
    { challenge: { expiresAt: '2020-01-01T00:00:00.000Z' } },
  ]) {
    const { api, calls } = fixture(scenario);
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/me/whatsapp/pairing-challenge',
      headers,
      payload: { operationId, generation, expectedVersion: 1, mode: 'qr' },
    });
    assert.equal(response.statusCode, Object.keys(scenario).length ? 409 : 200);
    assert.match(String(response.headers['cache-control']), /no-store/u);
    assert.equal(calls.challenge, 1);
    assert.ok(
      calls.finish.every(
        (item) =>
          !JSON.stringify(item).includes('synthetic-ephemeral-challenge'),
      ),
    );
    if (response.statusCode !== 200)
      assert.doesNotMatch(
        response.body,
        /secret-provider-body|synthetic-ephemeral/u,
      );
    await api.close();
  }
  let checks = 0;
  const { api, calls } = fixture({
    access: async (/** @type {any} */ input) => {
      checks++;
      if (checks > 1) throw new Error('revoked');
      return access(input);
    },
  });
  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/me/whatsapp/pairing-challenge',
    headers,
    payload: { operationId, generation, expectedVersion: 1, mode: 'qr' },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(calls.finish.at(-1).uncertain, true);
  assert.doesNotMatch(response.body, /synthetic-ephemeral/u);
  await api.close();
});

test('control routes enforce existing 60/min admission before ledger or provider', async () => {
  const { api } = fixture();
  for (let index = 0; index < 60; index++)
    assert.equal(
      (await api.inject({ method: 'GET', url: '/api/v1/me/whatsapp', headers }))
        .statusCode,
      200,
    );
  assert.equal(
    (await api.inject({ method: 'GET', url: '/api/v1/me/whatsapp', headers }))
      .statusCode,
    429,
  );
  await api.close();
});

test('worker checks lease before HTTP and never blindly retries an uncertain control effect', async () => {
  const calls = { http: 0, unknown: 0 };
  const repository = {
    loadDelivery: async () => ({
      operationId,
      lineId,
      generation,
      action: 'connect',
      reference,
    }),
    markUnknown: async () => {
      calls.unknown++;
    },
  };
  const handler = createWhatsAppControlJobHandler({
    repository,
    client: {
      control: async () => {
        calls.http++;
        throw new Error('private');
      },
    },
  });
  const job = {
    jobType: 'whatsapp.control.deliver',
    whatsappOperationId: operationId,
  };
  assert.equal(
    (await handler(job, { markEffectStarted: async () => false })).outcome,
    'failed',
  );
  assert.equal(calls.http, 0);
  const failure = await handler(job, { markEffectStarted: async () => true });
  assert.equal(failure.outcome, 'outcome_unknown');
  assert.equal(failure.retrySafe, false);
  assert.equal(failure.retryable, false);
  assert.equal(calls.unknown, 1);
  assert.equal(
    createWhatsAppControlWorkerRuntime({
      database: {},
      environment: {},
      WorkerRuntime: class {},
    }),
    undefined,
  );
});

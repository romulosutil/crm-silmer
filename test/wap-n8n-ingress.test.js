import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import {
  patchWebhookSource,
  patchExecutionsSource,
  patchControllerSource,
} from '../ops/n8n/wap-ingress-patch.mjs';

const {
  protectIngress,
  guardInitialExecution,
  guardManualRequest,
  guardWorkflowMutation,
} = createRequire(import.meta.url)('../ops/n8n/wap-ingress-runtime.cjs');
const token = 'synthetic-generation-token-000000000000';
const transportToken = 'synthetic-native-auth-00000000000000';
const basic = 'Basic c3ludGhldGljOnZlcmlmaWVy';
const source = {
  bindingId: 'binding-one',
  lineId: 'line-one',
  accountId: 'account-one',
  generation: 1,
};
const env = {
  SILMER_WAP_INGRESS_ENABLED: 'true',
  SILMER_WAP_INGRESS_PATHS: JSON.stringify({
    'wap-e01-privacy': 'challenge',
    'wap-e01-generation': 'event',
  }),
  SILMER_WAP_INGRESS_VERIFY_URL:
    'http://wap-provider-fixture:8080/ingress/verify',
  SILMER_WAP_INGRESS_VERIFY_BASIC: basic,
};
const settings = {
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
};
const CONTROLLER_FIXTURE = `class Controller {
  async create(req, _res, body) {
        const newWorkflow = (0, workflow_entity_mapper_1.createWorkflowEntityFromPayload)(body);
        return this.persist(newWorkflow);
  }
  async update(req, _res, workflowId, body) {
        const { tags, parentFolderId, aiBuilderAssisted, expectedChecksum, autosaved, ...rest } = body;
        return this.persist(rest);
  }
  async runManually(req) {
        const workflowId = req.params.workflowId;
        const dbWorkflow = await this.workflowRepository.get({ id: workflowId });
        const body = { triggerToStartFrom: { name: 'Trigger' } };
        const n8nAuthCookie = this.authService.getCookieToken(req);
        return this.workflowExecutionService.executeManually(dbWorkflow, body);
  }
} Controller;`;

/** @param {any} [options] */
function context(options = {}) {
  const parameters = {
    path: 'wap-e01-privacy',
    authentication: 'headerAuth',
    responseMode: 'responseNode',
    options: {},
    ...options.parameters,
  };
  const req = {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'x-wap-probe-token': transportToken,
      ['x-silmer-wap-generation-token']: token,
    },
    params: {},
    query: {},
    body: { actor: 'synthetic-a', generation: 1, mode: 'qr' },
    ...options.req,
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
    req,
    response,
    workflow: { settings: { ...settings }, pinData: {}, ...options.workflow },
    getNodeParameter: (
      /** @type {string} */ name,
      /** @type {any} */ fallback,
    ) => parameters[name] ?? fallback,
    getNode: () => ({ parameters }),
    getRequestObject: () => req,
    getResponseObject: () => response,
  };
}

/** @param {any} value @param {number} [status] */
function verificationResponse(value, status = 200) {
  return {
    status,
    body: (async function* () {
      yield Buffer.from(JSON.stringify(value));
    })(),
  };
}

test('WAP-E01: authenticated challenge output removes credentials and all cached request aliases before persistence', async () => {
  const ctx = context();
  const headerAlias = ctx.req.headers;
  const bodyAlias = ctx.req.body;
  const rawBody = Buffer.from('synthetic-original-raw-body-secret');
  ctx.req.rawBody = rawBody;
  assert.equal(await protectIngress(ctx, env), false);
  assert.deepEqual(headerAlias, {});
  assert.equal(ctx.req.body, bodyAlias);
  assert.deepEqual(ctx.req.body, {
    actor: 'synthetic-a',
    generation: 1,
    mode: 'qr',
  });
  assert.deepEqual(ctx.req.query, {});
  assert.deepEqual(ctx.req.params, {});
  assert.equal(ctx.req.rawBody, undefined);
  assert.deepEqual([...rawBody], Array(rawBody.length).fill(0));
  assert.equal(JSON.stringify(ctx.req).includes(token), false);
  assert.equal(JSON.stringify(ctx.req).includes(transportToken), false);
});

test('WAP-E01: challenge cannot persist a credential disguised as operation or challenge ID', async () => {
  const canary = 'a'.repeat(64);
  for (const key of ['operationId', 'challengeId']) {
    const ctx = context({
      req: {
        headers: { 'x-wap-probe-token': canary },
        body: {
          actor: 'synthetic-a',
          generation: 1,
          mode: 'qr',
          [key]: canary,
        },
      },
    });
    assert.equal(await protectIngress(ctx, env), true);
    assert.equal(ctx.response.status, 403);
    assert.equal(ctx.response.text, 'WAP_INGRESS_DENIED');
    assert.equal(ctx.response.text.includes(canary), false);
  }
  const numericCode = context({
    req: { body: { actor: 'synthetic-a', generation: 12345678, mode: 'qr' } },
  });
  assert.equal(await protectIngress(numericCode, env), true);
  assert.equal(numericCode.response.status, 403);
  assert.equal(numericCode.response.text, 'WAP_INGRESS_DENIED');
});

test('WAP-E01: real Express-style getter-only query is safely shadowed per request after validation', async () => {
  const ctx = context();
  const queryAlias = {};
  const expressPrototype = Object.create(Object.getPrototypeOf(ctx.req));
  Object.defineProperty(expressPrototype, 'query', {
    configurable: true,
    enumerable: true,
    get: () => queryAlias,
  });
  delete ctx.req.query;
  Object.setPrototypeOf(ctx.req, expressPrototype);
  assert.equal(
    Object.getOwnPropertyDescriptor(expressPrototype, 'query')?.set,
    undefined,
  );
  assert.equal(await protectIngress(ctx, env), false);
  assert.deepEqual(ctx.req.query, {});
  assert.deepEqual(queryAlias, {});
  assert.equal(Object.hasOwn(ctx.req, 'query'), true);
  assert.equal(
    Object.getOwnPropertyDescriptor(expressPrototype, 'query')?.set,
    undefined,
  );
  const forbidden = context();
  delete forbidden.req.query;
  Object.setPrototypeOf(
    forbidden.req,
    Object.create(Object.getPrototypeOf(forbidden.req), {
      query: { get: () => ({ credential: token }) },
    }),
  );
  assert.equal(await protectIngress(forbidden, env), true);
  assert.equal(forbidden.response.status, 403);
  assert.equal(Object.hasOwn(forbidden.req, 'query'), false);
});

test('WAP-E01: default off, path/config/schema/settings and native auth failures deny before output', async () => {
  const expressionPath = context();
  expressionPath.getNode = () => ({
    parameters: /** @type {any} */ ({ path: '={{ "wap-e01-privacy" }}' }),
  });
  /** @type {Array<[any, any]>} */
  const cases = [
    [context(), {}],
    [context(), { ...env, SILMER_WAP_INGRESS_ENABLED: 'false' }],
    [context(), { ...env, SILMER_WAP_INGRESS_PATHS: '{}' }],
    [context({ parameters: { authentication: 'none' } }), env],
    [expressionPath, env],
    [context({ parameters: { options: { rawBody: true } } }), env],
    [context({ req: { query: { token } } }), env],
    [context({ req: { params: { token } } }), env],
    [
      context({
        req: {
          body: { actor: 'synthetic-a', generation: 1, mode: 'qr', token },
        },
      }),
      env,
    ],
    [
      context({ req: { body: { actor: 'other', generation: 1, mode: 'qr' } } }),
      env,
    ],
    [
      context({
        workflow: { settings: { ...settings, saveManualExecutions: true } },
      }),
      env,
    ],
    [
      context({
        workflow: { pinData: { Trigger: [{ json: { secret: token } }] } },
      }),
      env,
    ],
    [
      context({
        workflow: { settings: { ...settings, errorWorkflow: 'other' } },
      }),
      env,
    ],
  ];
  for (const [ctx, config] of cases) {
    assert.equal(await protectIngress(ctx, config), true);
    assert.equal(ctx.response.status, 403);
    assert.equal(ctx.response.text, 'WAP_INGRESS_DENIED');
    assert.equal(ctx.response.text.includes(token), false);
  }
  const legacy = context({ parameters: { path: 'silmer/evolution-events' } });
  assert.equal(await protectIngress(legacy, {}), false);
  assert.equal(legacy.req.headers['x-wap-probe-token'], transportToken);
});

test('WAP-E01: per-generation verification is private, exact, canonical and does not relabel a stale source', async () => {
  const body = {
    event: 'connection.update',
    instance: 'wap-synthetic-qr',
    source: { ...source },
    data: { state: 'connecting' },
    destination: 'http://private-n8n/webhook/wap-e01-generation',
    date_time: '2026-11-16T00:00:00Z',
    server_url: 'http://private-provider',
    sender: 'synthetic-unpaired',
  };
  const ctx = context({
    parameters: { path: 'wap-e01-generation' },
    req: { body },
  });
  let calls = 0;
  const verify = async (
    /** @type {string} */ url,
    /** @type {any} */ options,
  ) => {
    calls++;
    assert.equal(url, env.SILMER_WAP_INGRESS_VERIFY_URL);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, basic);
    assert.equal(options.headers['x-silmer-wap-generation-token'], token);
    assert.deepEqual(JSON.parse(options.body), {
      source,
      instance: 'wap-synthetic-qr',
    });
    return verificationResponse({ source, instance: 'wap-synthetic-qr' });
  };
  assert.equal(await protectIngress(ctx, env, verify), false);
  assert.equal(calls, 1);
  assert.deepEqual(ctx.req.body, {
    event: 'connection.update',
    instance: 'wap-synthetic-qr',
    source,
    data: { state: 'connecting' },
  });
  assert.deepEqual(ctx.req.headers, {});
  const stale = context({
    parameters: { path: 'wap-e01-generation' },
    req: { body: { ...ctx.req.body, source: { ...source } } },
  });
  assert.equal(
    await protectIngress(stale, env, async () =>
      verificationResponse({
        source: { ...source, generation: 2 },
        instance: 'wap-synthetic-qr',
      }),
    ),
    true,
  );
  const revoked = context({
    parameters: { path: 'wap-e01-generation' },
    req: { body: { ...ctx.req.body, source: { ...source } } },
  });
  assert.equal(
    await protectIngress(revoked, env, async () =>
      verificationResponse({}, 403),
    ),
    true,
  );
  const wrongEndpoint = context({
    parameters: { path: 'wap-e01-generation' },
    req: { body: { ...ctx.req.body, source: { ...source } } },
  });
  assert.equal(
    await protectIngress(
      wrongEndpoint,
      { ...env, SILMER_WAP_INGRESS_VERIFY_URL: 'https://external.invalid/' },
      verify,
    ),
    true,
  );
  assert.equal(calls, 1);
  const wrongInstance = context({
    parameters: { path: 'wap-e01-generation' },
    req: {
      body: {
        ...ctx.req.body,
        instance: 'wap-synthetic-code',
        source: { ...source },
      },
    },
  });
  assert.equal(
    await protectIngress(wrongInstance, env, async () =>
      verificationResponse({ source, instance: 'wap-synthetic-qr' }),
    ),
    true,
  );
});

test('WAP-E01: unknown provider fields, malformed source, generation credential and verifier errors fail closed', async () => {
  const clean = {
    event: 'connection.update',
    instance: 'wap-synthetic-code',
    source: { ...source },
    data: { state: 'close' },
  };
  for (const extra of [
    { body: { ...clean, apikey: token } },
    { body: { ...clean, data: { state: 'close', secret: token } } },
    { body: { ...clean, source: { ...source, generation: '1' } } },
    {
      body: { ...clean, source: { ...source, accountId: 'different account' } },
    },
    { body: { ...clean, event: 'messages.upsert' } },
    { body: { ...clean }, headers: {} },
  ]) {
    const ctx = context({
      parameters: { path: 'wap-e01-generation' },
      req: extra,
    });
    assert.equal(
      await protectIngress(ctx, env, async () => {
        throw new Error(token);
      }),
      true,
    );
    assert.equal(ctx.response.text, 'WAP_INGRESS_DENIED');
  }
});

test('WAP-E01: verifier network/timeout/5xx failures are retryable 503 without leaking credentials', async () => {
  const input = () =>
    context({
      parameters: { path: 'wap-e01-generation' },
      req: {
        body: {
          event: 'connection.update',
          instance: 'wap-synthetic-qr',
          source: { ...source },
          data: { state: 'connecting' },
        },
      },
    });
  for (const verify of [
    async () => {
      throw new Error(token);
    },
    async () => {
      throw Object.assign(new Error(basic), { name: 'TimeoutError' });
    },
    async () => verificationResponse({ credential: token }, 503),
    async () => ({
      status: 200,
      body: (async function* () {
        throw new Error(token);
      })(),
    }),
  ]) {
    const ctx = input();
    assert.equal(await protectIngress(ctx, env, verify), true);
    assert.equal(ctx.response.status, 503);
    assert.equal(ctx.response.text, 'WAP_INGRESS_UNAVAILABLE');
    assert.equal(ctx.response.text.includes(token), false);
    assert.equal(ctx.response.text.includes(basic), false);
  }
  for (const verify of [
    async () => verificationResponse({ credential: token }, 403),
    async () =>
      verificationResponse({
        source: { ...source, generation: 2 },
        instance: 'wap-synthetic-qr',
      }),
  ]) {
    const ctx = input();
    assert.equal(await protectIngress(ctx, env, verify), true);
    assert.equal(ctx.response.status, 403);
    assert.equal(ctx.response.text, 'WAP_INGRESS_DENIED');
  }
});

test('WAP-E01: initial writer refuses unsafe manual, partial/retry, pinData and settings before first write', () => {
  const initial = () => ({
    executionMode: 'manual',
    workflowData: {
      name: 'WAP-E01 isolated manual privacy probe',
      settings: { ...settings },
      pinData: {},
    },
    executionData: {
      resultData: { runData: {} },
      executionData: {
        nodeExecutionStack: [
          {
            node: { type: 'n8n-nodes-base.manualTrigger' },
            data: { main: [[{ json: {} }]] },
          },
        ],
      },
    },
  });
  assert.doesNotThrow(() => guardInitialExecution(initial(), undefined, env));
  assert.throws(
    () => guardInitialExecution(initial(), undefined, {}),
    /WAP_INGRESS_DENIED/u,
  );
  assert.throws(
    () => guardInitialExecution(initial(), { executionId: 'old' }, env),
    /WAP_INGRESS_DENIED/u,
  );
  const partial = initial();
  partial.executionData.resultData.runData = { Trigger: [{ json: { token } }] };
  assert.throws(
    () => guardInitialExecution(partial, undefined, env),
    /WAP_INGRESS_DENIED/u,
  );
  const pinned = initial();
  pinned.workflowData.pinData = { Trigger: [{ json: { token } }] };
  assert.throws(
    () => guardInitialExecution(pinned, undefined, env),
    /WAP_INGRESS_DENIED/u,
  );
  const untrustedInput = initial();
  untrustedInput.executionData.executionData.nodeExecutionStack[0].data.main[0][0].json =
    { token };
  assert.throws(
    () => guardInitialExecution(untrustedInput, undefined, env),
    /WAP_INGRESS_DENIED/u,
  );
  assert.doesNotThrow(() =>
    guardInitialExecution({ workflowData: { name: 'legacy' } }, undefined, {}),
  );
});

test('WAP-E01: image patch is hash/anchor guarded and native authentication still runs before the real helper', async () => {
  const input = `class Webhook { async webhook(context) {
        let validationData;
        validationData = await this.validateAuth(context);
        const node = context.getNode();
        const rawOptions = node.parameters?.options;
        return { json: { headers: context.req.headers, body: context.req.body } };
  } } Webhook;`;
  assert.throws(() => patchWebhookSource(input), /WAP_N8N_SOURCE_MISMATCH/u);
  const patched = patchWebhookSource(
    input,
    createHash('sha256').update(input).digest('hex'),
  );
  let calls = 0;
  const Webhook = vm.runInNewContext(patched, {
    require: () => ({
      protectIngress: async (/** @type {any} */ ctx) => {
        calls++;
        return protectIngress(ctx, env);
      },
    }),
  });
  const node = new Webhook();
  node.validateAuth = async (/** @type {any} */ ctx) => {
    if (ctx.req.headers['x-wap-probe-token'] !== transportToken)
      throw new Error('NATIVE_AUTH_DENIED');
  };
  const valid = context();
  const result = await node.webhook(valid);
  assert.deepEqual(Object.keys(result.json.headers), []);
  assert.equal(calls, 1);
  await assert.rejects(
    node.webhook(context({ req: { headers: {} } })),
    /NATIVE_AUTH_DENIED/u,
  );
  assert.equal(calls, 1);
  assert.throws(
    () =>
      patchWebhookSource(
        patched,
        createHash('sha256').update(patched).digest('hex'),
      ),
    /WAP_N8N_SOURCE_MISMATCH/u,
  );
  const writer = `class ActiveExecutions { async add(executionData, existingExecution) {
        let executionStatus = existingExecution ? 'running' : 'new';
        return this.persist(executionData);
  }} ActiveExecutions;`;
  const Writer = vm.runInNewContext(
    patchExecutionsSource(
      writer,
      createHash('sha256').update(writer).digest('hex'),
    ),
    {
      require: () => ({
        guardInitialExecution: (
          /** @type {any} */ data,
          /** @type {any} */ existing,
        ) => guardInitialExecution(data, existing, env),
      }),
    },
  );
  const instance = new Writer();
  let writes = 0;
  instance.persist = () => {
    writes++;
  };
  await assert.rejects(
    instance.add({
      workflowData: { name: 'WAP-E01 isolated unsafe', settings: {} },
    }),
    /WAP_INGRESS_DENIED/u,
  );
  assert.equal(writes, 0);
});

test('WAP-E01: raw manual request rejects partial, destination, trigger data and unknown keys before execution upgrade', async () => {
  const workflow = {
    name: 'WAP-E01 isolated manual privacy probe',
    settings: { ...settings },
    pinData: {},
    nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' }],
  };
  const valid = { triggerToStartFrom: { name: 'Trigger' } };
  assert.doesNotThrow(() => guardManualRequest(workflow, valid, env));
  for (const body of [
    { ...valid, runData: { Challenge: [{ json: { secret: token } }] } },
    { destinationNode: { nodeName: 'Finish', mode: 'inclusive' }, runData: {} },
    { ...valid, destinationNode: { nodeName: 'Finish', mode: 'inclusive' } },
    { triggerToStartFrom: { name: 'Trigger', data: { secret: token } } },
    { ...valid, ignoredByDto: token },
    { triggerToStartFrom: { name: 'Challenge' } },
  ])
    assert.throws(
      () => guardManualRequest(workflow, body, env),
      /WAP_INGRESS_DENIED/u,
    );
  assert.throws(
    () =>
      guardManualRequest(
        {
          ...workflow,
          nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.webhook' }],
        },
        valid,
        env,
      ),
    /WAP_INGRESS_DENIED/u,
  );
  const original = CONTROLLER_FIXTURE;
  assert.throws(
    () => patchControllerSource(original),
    /WAP_N8N_SOURCE_MISMATCH/u,
  );
  const Controller = vm.runInNewContext(
    patchControllerSource(
      original,
      createHash('sha256').update(original).digest('hex'),
    ),
    {
      require: () => ({
        guardManualRequest: (
          /** @type {any} */ saved,
          /** @type {any} */ body,
        ) => guardManualRequest(saved, body, env),
      }),
      bad_request_error_1: { BadRequestError: Error },
    },
  );
  const controller = new Controller();
  let effects = 0;
  controller.workflowRepository = { get: async () => workflow };
  controller.authService = {
    getCookieToken: () => 'synthetic-session-not-persisted',
  };
  controller.workflowExecutionService = {
    executeManually: async () => {
      effects++;
    },
  };
  await assert.rejects(
    controller.runManually({
      params: { workflowId: 'synthetic' },
      body: { ...valid, runData: { Challenge: [{ json: { secret: token } }] } },
    }),
    /WAP_MANUAL_REQUEST_DENIED/u,
  );
  assert.equal(effects, 0);
  await controller.runManually({
    params: { workflowId: 'synthetic' },
    body: valid,
  });
  assert.equal(effects, 1);
});

test('WAP-E01: REST workflow writes reject pinData/settings before persistence and prevent scope escape', async () => {
  const workflow = {
    id: 'synthetic',
    name: 'WAP-E01 isolated manual privacy probe',
    settings: { ...settings },
    pinData: {},
    nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' }],
  };
  const Controller = vm.runInNewContext(
    patchControllerSource(
      CONTROLLER_FIXTURE,
      createHash('sha256').update(CONTROLLER_FIXTURE).digest('hex'),
    ),
    {
      require: () => ({
        guardWorkflowMutation: (
          /** @type {any} */ existing,
          /** @type {any} */ payload,
        ) => guardWorkflowMutation(existing, payload, env),
      }),
      bad_request_error_1: { BadRequestError: Error },
      workflow_entity_mapper_1: {
        createWorkflowEntityFromPayload: (/** @type {any} */ body) => body,
      },
    },
  );
  const controller = new Controller();
  controller.workflowRepository = { get: async () => workflow };
  let writes = 0;
  controller.persist = () => {
    writes++;
  };
  for (const payload of [
    { ...workflow, pinData: { Trigger: [{ json: { code: token } }] } },
    { ...workflow, settings: { ...settings, saveDataSuccessExecution: 'all' } },
    { ...workflow, settings: { ...settings, errorWorkflow: 'other' } },
  ])
    await assert.rejects(
      controller.create({}, {}, payload),
      /WAP_WORKFLOW_WRITE_DENIED/u,
    );
  assert.equal(writes, 0);
  for (const payload of [
    { pinData: { Trigger: [{ json: { code: token } }] } },
    { settings: { saveDataSuccessExecution: 'none' } },
    { name: 'legacy', nodes: [] },
    { id: 'different' },
  ])
    await assert.rejects(
      controller.update({}, {}, workflow.id, payload),
      /WAP_WORKFLOW_WRITE_DENIED/u,
    );
  assert.equal(writes, 0);
  await controller.create({}, {}, workflow);
  await controller.update({}, {}, workflow.id, {
    name: 'WAP-E01 isolated renamed',
  });
  assert.equal(writes, 2);
  controller.workflowRepository.get = async () => ({
    id: 'legacy',
    name: 'legacy',
  });
  await controller.update({}, {}, 'legacy', {
    name: 'legacy-renamed',
    settings: {},
  });
  assert.equal(writes, 3);
  assert.doesNotThrow(() =>
    guardWorkflowMutation(null, { name: 'legacy', nodes: [] }, {}),
  );
});

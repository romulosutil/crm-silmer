// Runs inside the patched provider image. Synthetic socket events, real patched
// methods and real Axios HTTP to the dedicated n8n. Never starts a WhatsApp socket.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  extractGenerationMethods,
  extractPrismaCredentialWriter,
} from './wap-generation-patch.mjs';

let stage = 'input';
async function main() {
  if (process.argv[2] !== '--isolated-synthetic')
    throw new Error('WAP_REHEARSAL_DISABLED');
  let bytes = '';
  for await (const chunk of process.stdin) bytes += chunk;
  const input = JSON.parse(bytes);
  const {
    bindings,
    retryReplacementBinding,
    transportToken,
    fixtureToken,
    fixtureUrl,
    n8nUrl,
  } = input;
  if (
    !Array.isArray(bindings) ||
    bindings.length !== 3 ||
    fixtureUrl !== 'http://wap-provider-fixture:8080' ||
    n8nUrl !== 'http://wap-n8n:5678/webhook/wap-e01-generation' ||
    typeof transportToken !== 'string' ||
    transportToken.length < 32 ||
    typeof fixtureToken !== 'string' ||
    fixtureToken.length < 32
  )
    throw new Error('WAP_REHEARSAL_INPUT_INVALID');
  const [a1, a2, b1] = bindings;
  const a3 = retryReplacementBinding;
  assert.equal(a1.instance, 'wap-synthetic-qr');
  assert.equal(b1.instance, 'wap-synthetic-code');
  assert.equal(a1.instance, a2.instance);
  assert.notEqual(a1.instance, b1.instance);
  assert.equal(a1.source.lineId, a2.source.lineId);
  assert.notEqual(a1.source.lineId, b1.source.lineId);
  assert.equal(a3?.instance, a2.instance);
  assert.equal(a3.source.lineId, a2.source.lineId);
  assert.equal(a3.source.accountId, a2.source.accountId);
  assert.ok(a3.source.generation > a2.source.generation);
  process.env.SILMER_WAP_GENERATION_ENABLED = 'true';
  process.env.SILMER_WAP_GENERATION_INSTANCES =
    'wap-synthetic-qr,wap-synthetic-code';
  const require = createRequire('/evolution/dist/main.js');
  stage = 'load-patched-methods';
  const runtime = require('/evolution/silmer-wap-generation.cjs');
  const axios = require('axios');
  const privacy = require('/evolution/silmer-privacy.cjs');
  privacy.protectAxios(axios, {
    webhookUrl: n8nUrl,
    webhookToken: transportToken,
  });
  const source = await readFile('/evolution/dist/main.js', 'utf8');
  const snippets = extractGenerationMethods(source);
  stage = 'credential-snapshot-before-serialization';
  const { BufferJSON } = require('baileys');
  const credentials = {
    pairingCode: 'WAP8CODE',
    advSecretKey: 'synthetic-approved-auth-material',
    noiseKey: {
      public: Buffer.from([1, 2, 3]),
      private: new Uint8Array([4, 5, 6]),
    },
    pairingEphemeralKeyPair: {
      public: Buffer.from([7, 8]),
      private: Buffer.from([9, 10]),
    },
    registered: false,
  };
  const untouchedCredentials = JSON.stringify(credentials, BufferJSON.replacer);
  const persistedCredentials = [];
  const credentialWriter = new Function(
    'require',
    'st',
    'E',
    's',
    'p',
    'vt',
    't',
    'cu',
    `return (${extractPrismaCredentialWriter(source)});`,
  )(
    require,
    { BufferJSON },
    { get: () => ({ REDIS: { ENABLED: false } }) },
    {},
    'synthetic-session',
    {
      default: {
        writeFile() {
          throw new Error('WAP_UNEXPECTED_FILE_WRITE');
        },
      },
    },
    (key) => key,
    async (_id, bytes) => persistedCredentials.push(bytes),
  );
  await credentialWriter(credentials, 'creds');
  const expectedCredentials = runtime.persistableCredentials(credentials);
  assert.equal(persistedCredentials.length, 1);
  assert.equal(
    persistedCredentials[0].includes(credentials.pairingCode),
    false,
  );
  assert.equal(
    persistedCredentials[0],
    JSON.stringify(expectedCredentials, BufferJSON.replacer),
  );
  assert.equal(
    JSON.stringify(credentials, BufferJSON.replacer),
    untouchedCredentials,
  );
  const observations = [];
  const requests = [];
  const rejectionCodes = [];
  let beforeRetry;
  const config = {
    WEBHOOK: {
      GLOBAL: { ENABLED: false, URL: '' },
      EVENTS: {},
      REQUEST: { TIMEOUT_MS: 10000 },
      RETRY: {
        MAX_ATTEMPTS: 2,
        INITIAL_DELAY_SECONDS: 0.01,
        USE_EXPONENTIAL_BACKOFF: false,
        JITTER_FACTOR: 0,
        NON_RETRYABLE_STATUS_CODES: [400, 401, 403, 404, 409, 422],
      },
    },
    LOG: { LEVEL: ['ERROR'] },
    DATABASE: { SAVE_DATA: {} },
    CHATWOOT: { ENABLED: false },
    SERVER: { URL: 'http://synthetic-provider.invalid' },
    AUTHENTICATION: { EXPOSE_IN_FETCH_INSTANCES: false },
  };
  const E = { get: (key) => config[key] };
  const logger = {
    log() {},
    info() {},
    warn(code) {
      rejectionCodes.push(code);
    },
    error() {},
  };
  const H = {
    emit(envelope) {
      const promise = emitter(envelope);
      requests.push(promise);
      return promise;
    },
  };
  const methods = {};
  for (const [name, snippet] of Object.entries(snippets)) {
    methods[name] = new Function(
      'require',
      'E',
      'ir',
      'H',
      'p',
      `return ({${snippet}})[${JSON.stringify(name)}];`,
    )(require, E, { default: axios }, H, { name: 'WapSyntheticChannel' });
  }
  const sender = {
    logger,
    async get() {
      return {
        enabled: true,
        events: ['CONNECTION_UPDATE'],
        headers: {},
        url: n8nUrl,
        webhookByEvents: false,
      };
    },
    async retryWebhookRequest(client, body, ...rest) {
      client.interceptors.response.use(
        (response) => {
          observations.push({ status: response.status, source: body.source });
          return response;
        },
        async (error) => {
          observations.push({
            status: error.response?.status ?? 0,
            source: body.source,
          });
          if (error.response?.status === 503 && beforeRetry) {
            const installReplacement = beforeRetry;
            beforeRetry = null;
            await installReplacement();
          }
          throw error;
        },
      );
      return methods.retryWebhookRequest.call(this, client, body, ...rest);
    },
  };
  const emitter = (envelope) => methods.emit.call(sender, envelope);
  const socket = () => ({
    ev: {
      process(callback) {
        this.callback = callback;
      },
    },
  });
  const channel = (instance) => ({
    instanceName: instance,
    instance: { name: instance },
    client: socket(),
    configService: E,
    logger,
    endSession: false,
    eventProcessingQueue: Promise.resolve(),
    async findSettings() {
      return { groupsIgnore: true };
    },
    sendDataWebhook: methods.sendDataWebhook,
    connectionUpdate: methods.connectionUpdate,
  });
  const flush = async (subject) => {
    await subject.eventProcessingQueue;
    // Native connectionUpdate/sendDataWebhook intentionally emit asynchronously.
    await Promise.all(requests.splice(0));
  };
  const advance = async (bindingId) => {
    const response = await globalThis.fetch(fixtureUrl + '/control/advance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wap-Probe-Token': fixtureToken,
      },
      body: JSON.stringify({ bindingId }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
  };
  const a = channel(a1.instance);
  stage = 'reject-unbound-lifecycle-events';
  for (const event of [
    'instance.create',
    'qrcode.updated',
    'connection.update',
  ]) {
    await emitter({
      instanceName: a1.instance,
      event,
      data: { state: 'connecting', code: a1.token },
      local: true,
    });
  }
  assert.deepEqual(
    rejectionCodes,
    Array(3).fill('WAP_GENERATION_EVENT_REJECTED'),
  );
  assert.equal(observations.length, 0);
  stage = 'queue-old-generation';
  let release;
  a.eventProcessingQueue = new Promise((resolve) => {
    release = resolve;
  });
  runtime.bindNextSocket(a1.instance, a1.source, a1.token);
  methods.eventHandler.call(a);
  const oldCallback = a.client.ev.callback;
  // This notification enters the native callback and is queued BEFORE reconnect.
  await oldCallback({ 'connection.update': { connection: 'connecting' } });
  a.client = socket();
  runtime.bindNextSocket(a2.instance, a2.source, a2.token);
  methods.eventHandler.call(a);
  const newCallback = a.client.ev.callback;
  await advance(a2.source.bindingId);
  stage = 'release-old-and-new-generations';
  await newCallback({ 'connection.update': { connection: 'connecting' } });
  release();
  await flush(a);
  assert.deepEqual(
    observations.slice(0, 2).map((item) => item.status),
    [403, 200],
  );
  assert.deepEqual(observations[0].source, a1.source);
  assert.deepEqual(observations[1].source, a2.source);
  const currentContext = runtime.captureSocket(a2.instance, a.client);
  await runtime.wrap(currentContext, async () => {
    await emitter({
      instanceName: a2.instance,
      event: 'connection.update',
      data: { state: 'refused', code: a2.token },
      local: true,
    });
  })();
  assert.equal(observations.length, 2);
  assert.deepEqual(
    rejectionCodes,
    Array(4).fill('WAP_GENERATION_EVENT_REJECTED'),
  );
  stage = 'replay-current-generation';
  await newCallback({ 'connection.update': { connection: 'connecting' } });
  await flush(a);
  assert.equal(observations.at(-1).status, 200);
  assert.deepEqual(observations.at(-1).source, a2.source);
  const b = channel(b1.instance);
  stage = 'other-line';
  runtime.bindNextSocket(b1.instance, b1.source, b1.token);
  methods.eventHandler.call(b);
  await b.client.ev.callback({
    'connection.update': { connection: 'connecting' },
  });
  await flush(b);
  assert.equal(observations.at(-1).status, 200);
  assert.deepEqual(observations.at(-1).source, b1.source);
  stage = 'cross-line-token';
  const crossLine = await axios
    .create({
      baseURL: n8nUrl,
      maxRedirects: 0,
      timeout: 10000,
      headers: { 'X-Silmer-Wap-Generation-Token': a2.token },
      validateStatus: () => true,
    })
    .post('', {
      event: 'connection.update',
      instance: b1.instance,
      source: b1.source,
      data: { state: 'connecting' },
    });
  assert.equal(crossLine.status, 403);
  observations.push({ status: crossLine.status, source: b1.source });
  stage = 'retry-after-revocation';
  const prepareRetry = await globalThis.fetch(
    fixtureUrl + '/control/fail-next-and-advance',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wap-Probe-Token': fixtureToken,
      },
      body: JSON.stringify({
        bindingId: a2.source.bindingId,
        replacementBindingId: a3.source.bindingId,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    },
  );
  assert.equal(prepareRetry.status, 200);
  let replacementCallback;
  beforeRetry = () => {
    a.client = socket();
    runtime.bindNextSocket(a3.instance, a3.source, a3.token);
    methods.eventHandler.call(a);
    replacementCallback = a.client.ev.callback;
  };
  await newCallback({ 'connection.update': { connection: 'connecting' } });
  await flush(a);
  assert.deepEqual(
    observations.slice(-2).map((item) => item.status),
    [503, 403],
  );
  for (const item of observations.slice(-2))
    assert.deepEqual(item.source, a2.source);
  assert.equal(typeof replacementCallback, 'function');
  stage = 'replacement-generation';
  await replacementCallback({
    'connection.update': { connection: 'connecting' },
  });
  await flush(a);
  assert.equal(observations.at(-1).status, 200);
  assert.deepEqual(observations.at(-1).source, a3.source);
  process.stdout.write(
    JSON.stringify({
      proof:
        'synthetic notification through real patched callback, queue and emitter; no WhatsApp socket',
      oldQueuedGenerationRejected: true,
      currentGenerationAccepted: true,
      replayPreservesSource: true,
      otherLineAccepted: true,
      crossLineTokenRejected: true,
      lifecycleEventsRejectedWithoutUnhandledRejection: true,
      retryAfterRevocationRejected: true,
      replacementGenerationAccepted: true,
      pairingCodeExcludedBeforeCredentialSerialization: true,
      observations,
    }) + '\n',
  );
}

main().catch(() => {
  process.stderr.write(`WAP_GENERATION_REHEARSAL_FAILED ${stage}\n`);
  process.exitCode = 1;
});

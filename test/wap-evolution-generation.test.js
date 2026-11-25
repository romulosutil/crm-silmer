import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  patchEvolutionGeneration,
  extractGenerationMethods,
  extractPrismaCredentialWriter,
  patchBaileysStatusReceiver,
  patchedPrismaCredentialWriter,
} from '../ops/evolution/wap-generation-patch.mjs';

const { createGenerationRuntime, fromEnvironment, persistableCredentials } =
  createRequire(import.meta.url)('../ops/evolution/wap-generation-runtime.cjs');
const a1 = {
  bindingId: 'synthetic-a-g1',
  lineId: 'synthetic-line-a',
  accountId: 'synthetic-account-a',
  generation: 1,
};
const a2 = { ...a1, bindingId: 'synthetic-a-g2', generation: 2 };
const token1 = 'synthetic-generation-one-token-32-characters';
const token2 = 'synthetic-generation-two-token-32-characters';

test('WAP-E12: boot leaves allowlisted personal instances idle until a binding is installed', () => {
  const config = { instances: ['synthetic-personal'] };
  const enabled = createGenerationRuntime({ ...config, enabled: true });
  const disabled = createGenerationRuntime({ ...config, enabled: false });
  for (const state of ['connecting', 'open']) {
    assert.equal(
      enabled.deferPairingStartup('synthetic-personal', state),
      true,
    );
    assert.equal(
      enabled.deferPairingStartup('synthetic-general', state),
      false,
    );
    assert.equal(
      disabled.deferPairingStartup('synthetic-personal', state),
      false,
    );
  }
  assert.equal(
    enabled.deferPairingStartup('synthetic-personal', 'close'),
    false,
  );
});

test('WAP-E01: real Prisma credential writer strips only the temporary pairing code before serialization', async () => {
  const original = {
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
  const untouched = JSON.stringify(original);
  const snapshot = persistableCredentials(original);
  assert.equal(original.pairingCode, 'WAP8CODE');
  assert.equal(snapshot.pairingCode, undefined);
  assert.equal(snapshot.noiseKey, original.noiseKey);
  assert.equal(
    snapshot.pairingEphemeralKeyPair,
    original.pairingEphemeralKeyPair,
  );
  assert.equal(snapshot.advSecretKey, original.advSecretKey);
  /** @type {string[]} */ const serialized = [];
  /** @type {string[]} */ const files = [];
  const method = extractPrismaCredentialWriter(patchedPrismaCredentialWriter());
  const writer = new Function(
    'require',
    'st',
    'E',
    's',
    'p',
    'vt',
    't',
    'cu',
    `return (${method});`,
  )(
    () => ({ persistableCredentials }),
    { BufferJSON: {} },
    { get: () => ({ REDIS: { ENABLED: false } }) },
    {},
    'synthetic-session',
    {
      default: {
        writeFile: async (
          /** @type {string} */ _path,
          /** @type {string} */ bytes,
        ) => files.push(bytes),
      },
    },
    (/** @type {string} */ key) => key,
    async (/** @type {string} */ _id, /** @type {string} */ bytes) =>
      serialized.push(bytes),
  );
  await writer(original, 'creds');
  assert.equal(serialized.length, 1);
  assert.equal(serialized[0].includes(original.pairingCode), false);
  assert.deepEqual(
    JSON.parse(serialized[0]),
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.equal(JSON.stringify(original), untouched);
  await writer(original.noiseKey, 'pre-key-1');
  assert.deepEqual(
    JSON.parse(files[0]),
    JSON.parse(JSON.stringify(original.noiseKey)),
  );
  assert.equal(serialized.length, 1);
  assert.throws(
    () => extractPrismaCredentialWriter(''),
    /WAP_EVOLUTION_CREDENTIAL_WRITER_MISMATCH/u,
  );
});

test('WAP-E12: top-level status ACK uses the pilot socket and preserves offline ordering after an ACK failure', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-personal'],
  });
  const disabled = createGenerationRuntime({
    enabled: false,
    instances: ['synthetic-personal'],
  });
  assert.equal(disabled.shouldAckTopLevelStatus('synthetic-personal'), false);

  const source = `
    const makeOfflineNodeProcessor = () => {
        const nodeProcessorMap = new Map();
        const nodes = [];
        return {
            enqueue(type, node) { nodes.push(() => nodeProcessorMap.get(type)(node)); },
            async drain() { for (const receive of nodes) await receive(); },
        };
    };
    const queue = makeOfflineNodeProcessor();
    const processNode = async (type, node, _label, handler) => {
        if (node.attrs.offline) queue.enqueue(type, node);
        else await handler(node);
    };
    ws.on('CB:ack,class:message', (node) => {});
    return queue;
  `;
  const createReceiver = new Function(
    'config',
    'ws',
    'sendMessageAck',
    'onUnexpectedError',
    patchBaileysStatusReceiver(source),
  );
  const listeners = new Map();
  const ws = {
    on: (/** @type {string} */ name, /** @type {any} */ fn) =>
      listeners.set(name, fn),
  };
  /** @type {string[]} */ const seen = [];
  const ack = async (/** @type {{attrs:{id:string}}} */ node) => {
    seen.push(node.attrs.id);
    if (node.attrs.id === 'failed') throw new Error('synthetic failure');
  };
  const report = (/** @type {Error} */ _error, /** @type {string} */ label) =>
    seen.push(label);
  createReceiver(
    {
      silmerAckTopLevelStatus:
        runtime.shouldAckTopLevelStatus('synthetic-general'),
    },
    ws,
    ack,
    report,
  );
  assert.equal(listeners.has('CB:status'), false);

  const queue = createReceiver(
    {
      silmerAckTopLevelStatus:
        runtime.shouldAckTopLevelStatus('synthetic-personal'),
    },
    ws,
    ack,
    report,
  );
  const receive = listeners.get('CB:status');
  await receive({ tag: 'status', attrs: { id: 'live' } });
  await receive({ tag: 'status', attrs: { id: 'failed', offline: '1' } });
  await receive({ tag: 'status', attrs: { id: 'next', offline: '1' } });
  assert.deepEqual(seen, ['live']);
  await queue.drain();
  assert.deepEqual(seen, ['live', 'failed', 'acking status stanza', 'next']);
  assert.throws(
    () => patchBaileysStatusReceiver(source + source),
    /WAP_BAILEYS_RECEIVER_ANCHOR_MISMATCH/u,
  );
});

test('WAP-E01: socket generation is default off, allowlisted and missing binding fails closed', () => {
  assert.equal(fromEnvironment({}).captureSocket('legacy', {}), null);
  assert.throws(
    () => fromEnvironment({ SILMER_WAP_GENERATION_ENABLED: 'yes' }),
    /WAP_GENERATION_CONFIG_INVALID/u,
  );
  const off = createGenerationRuntime({ instances: ['synthetic-a'] });
  assert.throws(
    () => off.bindNextSocket('synthetic-a', a1, token1),
    /WAP_GENERATION_DISABLED/u,
  );
  assert.throws(
    () => off.captureSocket('synthetic-a', {}),
    /WAP_GENERATION_DISABLED/u,
  );
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a'],
  });
  assert.throws(
    () => runtime.bindNextSocket('other', a1, token1),
    /WAP_GENERATION_INSTANCE_DENIED/u,
  );
  assert.throws(
    () => runtime.captureSocket('synthetic-a', {}),
    /WAP_GENERATION_BINDING_REQUIRED/u,
  );
  assert.throws(
    () => runtime.current('synthetic-a', 'connection.update'),
    /WAP_GENERATION_CONTEXT_INVALID/u,
  );
});

test('WAP-E12: the linked socket completes the native 515 handoff once under the same binding', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a'],
  });
  const before = {};
  const successor = {};
  runtime.bindNextSocket('synthetic-a', a1, token1);
  const binding = runtime.captureSocket('synthetic-a', before);
  let calls = 0;
  const replace = async (/** @type {boolean} */ saveBeforeReconnect) => {
    calls++;
    assert.equal(saveBeforeReconnect, true);
    await Promise.resolve();
    assert.equal(runtime.pairingHandoffPending('synthetic-a'), true);
    assert.equal(
      runtime.bindingMatchesSocket('synthetic-a', a1, token1),
      false,
    );
    assert.throws(
      () => runtime.ensureBinding('synthetic-a', a2, token2),
      /WAP_GENERATION_BINDING_PENDING/u,
    );
    assert.equal(runtime.captureSocket('synthetic-a', successor), binding);
    assert.throws(
      () => runtime.captureSocket('synthetic-a', {}),
      /WAP_GENERATION_BINDING_REQUIRED/u,
    );
  };
  await runtime.continueAfterPairing('synthetic-a', before, 515, replace);
  await runtime.wrap(binding, () =>
    runtime.continueAfterPairing('synthetic-a', before, 401, replace),
  )();
  assert.equal(calls, 0);
  await runtime.wrap(binding, () =>
    runtime.continueAfterPairing('synthetic-a', before, 515, replace),
  )();
  assert.equal(calls, 1);
  assert.equal(runtime.pairingHandoffPending('synthetic-a'), false);
  assert.equal(runtime.bindingMatchesSocket('synthetic-a', a1, token1), true);
  await runtime.wrap(binding, () =>
    runtime.continueAfterPairing('synthetic-a', successor, 515, replace),
  )();
  runtime.bindNextSocket('synthetic-a', a2, token2);
  await runtime.wrap(binding, () =>
    runtime.continueAfterPairing('synthetic-a', successor, 515, replace),
  )();
  assert.equal(calls, 1);
  assert.equal(runtime.captureSocket('synthetic-a', {}).source.generation, 2);
});

test('WAP-10/11: transient personal recovery keeps the generation and bounds flapping', async () => {
  const instance = 'synthetic-a';
  /** @type {number[]} */
  const delays = [];
  let approvals = 0;
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: [instance],
    authorizeRecovery: (
      /** @type {any} */ context,
      /** @type {string} */ token,
    ) => {
      approvals++;
      assert.deepEqual(context.source, a1);
      assert.equal(token, token1);
      return true;
    },
    sleep: async (/** @type {number} */ ms) => {
      delays.push(ms);
    },
  });
  runtime.bindNextSocket(instance, a1, token1);
  let socket = {};
  const binding = runtime.captureSocket(instance, socket);
  const lateClose = runtime.wrap(binding, () =>
    runtime.observeConnection(instance, socket, 'close'),
  );
  let connects = 0;
  for (const reason of [408, 428, 503, 408]) {
    const before = connects;
    await runtime.wrap(binding, async () => {
      assert.equal(runtime.observeConnection(instance, socket, 'close'), true);
      await runtime.continueAfterPairing(
        instance,
        socket,
        reason,
        async (/** @type {boolean} */ save) => {
          connects++;
          assert.equal(save, false);
          assert.equal(runtime.connectionRecoveryPending(instance), true);
          socket = {};
          assert.equal(runtime.captureSocket(instance, socket), binding);
        },
        true,
      );
    })();
    if (connects === 1) assert.equal(lateClose(), false);
    if (connects !== before)
      await runtime.wrap(binding, () =>
        runtime.observeConnection(instance, socket, 'open'),
      )();
    assert.equal(runtime.connectionRecoveryPending(instance), false);
    assert.equal(runtime.bindingMatchesSocket(instance, a1, token1), true);
  }
  assert.equal(approvals, 3);
  assert.equal(connects, 3);
  assert.deepEqual(delays, [1000, 3000]);
});

test('WAP-10/11: terminal, unregistered and revoked sockets cannot auto-reconnect', async () => {
  const instance = 'synthetic-a';
  let approvals = 0;
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: [instance],
    authorizeRecovery: (/** @type {any} */ context) => {
      approvals++;
      assert.deepEqual(context.source, a1);
      return false;
    },
  });
  runtime.bindNextSocket(instance, a1, token1);
  const socket = {};
  const binding = runtime.captureSocket(instance, socket);
  const unexpected = () =>
    assert.fail('revoked or unregistered socket started');
  await runtime.wrap(binding, async () => {
    for (const reason of [401, 403, 440, 500])
      await runtime.continueAfterPairing(
        instance,
        socket,
        reason,
        unexpected,
        true,
      );
    await runtime.continueAfterPairing(
      instance,
      socket,
      408,
      unexpected,
      false,
    );
    assert.equal(approvals, 0);
    await runtime.continueAfterPairing(instance, socket, 408, unexpected, true);
    assert.equal(approvals, 1);
    assert.equal(runtime.connectionRecoveryPending(instance), false);
  })();
  runtime.revokeSocket(instance);
  assert.equal(runtime.bindingMatchesSocket(instance, a1, token1), false);
  let general = 0;
  await runtime.continueAfterPairing('synthetic-general', {}, 408, () => {
    general++;
  });
  assert.equal(general, 1);
});

test('WAP-E01: delayed native queue callbacks retain their socket generation after reconnect and every await', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a'],
  });
  runtime.bindNextSocket('synthetic-a', a1, token1);
  const oldSocket = {};
  const old = runtime.captureSocket('synthetic-a', oldSocket);
  assert.equal(runtime.captureSocket('synthetic-a', oldSocket), old);
  assert.equal(JSON.stringify(old).includes(token1), false);
  /** @type {()=>void} */
  let release = () => {
    throw new Error('release missing');
  };
  const held = new Promise(
    /** @param {(value?: void)=>void} resolve */ (resolve) => {
      release = resolve;
    },
  );
  /** @type {any} */
  let outcome;
  const oldCallback = runtime.wrap(old, async () => {
    await held;
    await Promise.resolve();
    const captured = runtime.current('synthetic-a', 'connection.update');
    outcome = {
      body: runtime.envelope(captured, {
        instance: 'synthetic-a',
        event: 'connection.update',
        data: { state: 'connecting' },
        apikey: 'must-not-escape',
        source: a2,
      }),
      headers: runtime.headers(captured, {
        'x-silmer-wap-generation-token': token2,
      }),
    };
  });
  const pending = oldCallback();
  runtime.bindNextSocket('synthetic-a', a2, token2);
  const current = runtime.captureSocket('synthetic-a', {});
  await runtime.wrap(current, async () => {
    assert.deepEqual(
      runtime.envelope(runtime.current('synthetic-a', 'connection.update'), {
        instance: 'synthetic-a',
        event: 'connection.update',
        data: { state: 'connecting' },
      }).source,
      a2,
    );
  })();
  release();
  await pending;
  assert.deepEqual(outcome.body.source, a1);
  assert.equal(outcome.body.apikey, undefined);
  assert.equal(outcome.headers['X-Silmer-Wap-Generation-Token'], token1);
  assert.equal(outcome.headers['x-silmer-wap-generation-token'], undefined);
  await oldCallback();
  assert.deepEqual(outcome.body.source, a1);
});

test('WAP-E01: bindings cannot change line/account, reuse token or grant another instance/event', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a', 'synthetic-b'],
  });
  runtime.bindNextSocket('synthetic-a', a1, token1);
  assert.throws(
    () => runtime.bindNextSocket('synthetic-a', a2, token2),
    /WAP_GENERATION_BINDING_PENDING/u,
  );
  const context = runtime.captureSocket('synthetic-a', {});
  assert.throws(
    () => runtime.bindNextSocket('synthetic-a', a1, token2),
    /WAP_GENERATION_BINDING_STALE/u,
  );
  assert.throws(
    () =>
      runtime.bindNextSocket(
        'synthetic-a',
        { ...a2, lineId: 'synthetic-other' },
        token2,
      ),
    /WAP_GENERATION_BINDING_STALE/u,
  );
  assert.throws(
    () => runtime.bindNextSocket('synthetic-a', a2, token1),
    /WAP_GENERATION_BINDING_REUSED/u,
  );
  await runtime.wrap(context, async () => {
    assert.throws(
      () => runtime.current('synthetic-b', 'connection.update'),
      /WAP_GENERATION_INSTANCE_MISMATCH/u,
    );
    // WAP-E12: only connection.update and the two message events pass.
    for (const event of [
      'qrcode.updated',
      'messages.set',
      'send.message',
      'messages.delete',
      'contacts.upsert',
      'MESSAGES_UPSERT',
    ])
      assert.throws(
        () => runtime.current('synthetic-a', event),
        /WAP_GENERATION_EVENT_DENIED/u,
      );
    for (const event of ['messages.upsert', 'messages.update'])
      assert.equal(runtime.current('synthetic-a', event), context);
    assert.throws(
      () =>
        runtime.envelope(context, {
          instance: 'synthetic-b',
          event: 'connection.update',
          data: { state: 'connecting' },
        }),
      /WAP_GENERATION_ENVELOPE_DENIED/u,
    );
    assert.throws(
      () =>
        runtime.envelope(context, {
          instance: 'synthetic-a',
          event: 'connection.update',
          data: { state: 'unknown-unapproved' },
        }),
      /WAP_GENERATION_ENVELOPE_DENIED/u,
    );
  })();
});

test('WAP-E01: source schema rejects arbitrary generation and patched bundle refuses drift or a second patch', () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a'],
  });
  for (const source of [
    { ...a1, generation: 0 },
    { ...a1, generation: '1' },
    { ...a1, token: token1 },
    { ...a1, bindingId: '' },
    { ...a1, bindingId: 123 },
    { ...a1, bindingId: undefined },
    { ...a1, lineId: null },
    { ...a1, accountId: 'x'.repeat(65) },
  ])
    assert.throws(
      () => runtime.bindNextSocket('synthetic-a', source, token1),
      /WAP_GENERATION_SOURCE_INVALID/u,
    );
  for (const token of [
    '',
    'a'.repeat(129),
    'é'.repeat(32),
    'a'.repeat(32) + '\n',
  ])
    assert.throws(
      () => runtime.bindNextSocket('synthetic-a', a1, token),
      /WAP_GENERATION_TOKEN_INVALID/u,
    );
  assert.throws(
    () => patchEvolutionGeneration(''),
    /WAP_EVOLUTION_BUNDLE_MISMATCH/u,
  );
  assert.throws(
    () =>
      patchEvolutionGeneration(
        'eventHandler(){this.client.ev.process(async e=>{',
      ),
    /WAP_EVOLUTION_BUNDLE_MISMATCH/u,
  );
  assert.throws(
    () => extractGenerationMethods(''),
    /WAP_EVOLUTION_EXTRACTION_MISMATCH/u,
  );
});

const personalUrl =
  'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events';
/** @param {any} [patch] @returns {any} */
const upsert = (patch = {}) => ({
  event: 'messages.upsert',
  instance: 'synthetic-a',
  data: {
    key: {
      id: 'SYNTHETIC_UPSERT_1',
      remoteJid: '5511000000009@s.whatsapp.net',
      fromMe: false,
    },
    messageTimestamp: 1795000000,
    message: { conversation: 'synthetic' },
    pushName: 'Synthetic',
  },
  destination: personalUrl,
  date_time: '2026-11-18T12:00:00.000Z',
  sender: '5511000000001@s.whatsapp.net',
  server_url: 'http://127.0.0.1:8080',
  apikey: 'must-not-escape',
  ...patch,
});
/** @param {any} [patch] @param {any} [data] @returns {any} */
const update = (patch = {}, data = {}) => ({
  ...upsert(),
  event: 'messages.update',
  data: {
    keyId: 'SYNTHETIC_UPSERT_1',
    remoteJid: '5511000000009@s.whatsapp.net',
    fromMe: true,
    participant: null,
    status: 'DELIVERY_ACK',
    instanceId: 'synthetic-instance-id',
    ...data,
  },
  ...patch,
});
/** @param {any} key */
const upsertKey = (key) =>
  upsert({
    data: { ...upsert().data, key: { ...upsert().data.key, ...key } },
  });
const ENVELOPE_KEYS = [
  'data',
  'date_time',
  'destination',
  'event',
  'instance',
  'sender',
  'server_url',
  'source',
];

test('WAP-E12: message events queued under A1 and released after the A2 bind keep A1 source and token', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a'],
  });
  runtime.bindNextSocket('synthetic-a', a1, token1);
  const old = runtime.captureSocket('synthetic-a', {});
  /** @type {()=>void} */
  let release = () => {
    throw new Error('release missing');
  };
  const held = new Promise(
    /** @param {(value?: void)=>void} resolve */ (resolve) => {
      release = resolve;
    },
  );
  /** @type {any[]} */
  const outcomes = [];
  const oldCallback = runtime.wrap(old, async () => {
    await held;
    await Promise.resolve();
    for (const original of [
      upsert({ source: a2, extra: 'drop-me' }),
      upsertKey({ fromMe: true }),
      update({ source: a2 }),
    ]) {
      const captured = runtime.current('synthetic-a', original.event);
      outcomes.push({
        body: runtime.envelope(captured, original),
        headers: runtime.headers(captured, {
          'x-silmer-wap-generation-token': token2,
        }),
      });
    }
  });
  const pending = oldCallback();
  runtime.bindNextSocket('synthetic-a', a2, token2);
  const current = runtime.captureSocket('synthetic-a', {});
  await runtime.wrap(current, async () => {
    const captured = runtime.current('synthetic-a', 'messages.upsert');
    assert.deepEqual(runtime.envelope(captured, upsert()).source, a2);
    assert.equal(
      runtime.headers(captured, {})['X-Silmer-Wap-Generation-Token'],
      token2,
    );
  })();
  release();
  await pending;
  assert.equal(outcomes.length, 3);
  for (const { body, headers } of outcomes) {
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.deepEqual(body.source, a1);
    assert.equal(body.instance, 'synthetic-a');
    assert.equal(body.apikey, undefined);
    assert.equal(body.extra, undefined);
    assert.equal(body.destination, personalUrl);
    assert.equal(body.date_time, '2026-11-18T12:00:00.000Z');
    assert.equal(body.sender, '5511000000001@s.whatsapp.net');
    assert.equal(body.server_url, 'http://127.0.0.1:8080');
    assert.equal(headers['X-Silmer-Wap-Generation-Token'], token1);
    assert.equal(headers['x-silmer-wap-generation-token'], undefined);
    assert.equal(JSON.stringify(body).includes(token1), false);
  }
  assert.deepEqual(outcomes[0].body.data, upsert().data);
  assert.equal(outcomes[1].body.data.key.fromMe, true);
  assert.deepEqual(outcomes[2].body.data, update().data);
  // connection.update keeps its narrower historical shape.
  await runtime.wrap(current, async () => {
    assert.deepEqual(
      runtime.envelope(runtime.current('synthetic-a', 'connection.update'), {
        ...upsert(),
        event: 'connection.update',
        data: { state: 'open', wuid: 'synthetic' },
      }),
      {
        event: 'connection.update',
        instance: 'synthetic-a',
        source: a2,
        data: { state: 'open' },
      },
    );
  })();
});

test('WAP-E12: message envelopes the CRM never uses are refused at the source', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a', 'synthetic-b'],
  });
  runtime.bindNextSocket('synthetic-a', a1, token1);
  const context = runtime.captureSocket('synthetic-a', {});
  const rejected = [
    upsertKey({ remoteJid: '120363000000000001@g.us' }),
    upsertKey({ remoteJid: 'status@broadcast' }),
    upsertKey({ remoteJid: '5511000000009@broadcast' }),
    upsertKey({ remoteJid: '120363000000000002@newsletter' }),
    upsertKey({ participant: '5511000000008@s.whatsapp.net' }),
    upsertKey({ participantAlt: '5511000000008@s.whatsapp.net' }),
    upsert({ data: { ...upsert().data, key: null } }),
    upsert({ data: { ...upsert().data, key: [] } }),
    update({}, { remoteJid: '120363000000000001@g.us' }),
    update({}, { remoteJid: 'status@broadcast' }),
    update({}, { remoteJid: '120363000000000002@newsletter' }),
    update({}, { participant: '5511000000008@s.whatsapp.net' }),
    update({}, { fromMe: false }),
    update({}, { fromMe: undefined }),
    update({}, { status: 'SERVER_ACK' }),
    update({}, { status: 'PENDING' }),
    update({}, { status: undefined }),
    upsert({ instance: 'synthetic-b' }),
    update({ instance: 'synthetic-b' }),
    upsert({ event: 'connection.update' }),
    upsert({ data: null }),
    upsert({ data: [] }),
    upsert({ data: 'synthetic' }),
    update({ data: null }),
    update({ data: [] }),
    upsert({ date_time: 1795000000 }),
    upsert({ date_time: undefined }),
    upsert({ sender: undefined }),
    update({ sender: { id: 'synthetic' } }),
    upsert({ destination: { url: personalUrl } }),
    upsert({ server_url: 8080 }),
  ];
  await runtime.wrap(context, async () => {
    for (const original of rejected)
      assert.throws(
        () => runtime.envelope(context, original),
        /WAP_GENERATION_ENVELOPE_DENIED/u,
        JSON.stringify(original.data),
      );
    // participant null/absent is a 1:1 chat; @lid is a 1:1 identity.
    assert.equal(
      runtime.envelope(context, update({}, { participant: undefined })).event,
      'messages.update',
    );
    for (const status of ['ERROR', 'DELIVERY_ACK', 'READ', 'PLAYED'])
      assert.equal(
        runtime.envelope(context, update({}, { status })).data.status,
        status,
      );
    assert.equal(
      runtime.envelope(context, upsertKey({ remoteJid: '123456789@lid' })).data
        .key.remoteJid,
      '123456789@lid',
    );
    assert.equal(
      runtime.envelope(context, upsertKey({ participant: null })).event,
      'messages.upsert',
    );
  })();
});

test('WAP-E12: a non-allowlisted instance passes through untouched for every event', () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-a'],
  });
  for (const event of [
    'messages.upsert',
    'messages.update',
    'qrcode.updated',
    'send.message',
  ])
    assert.equal(runtime.current('legacy', event), null);
  const original = upsert({ instance: 'legacy' });
  assert.equal(runtime.envelope(null, original), original);
  assert.equal(original.apikey, 'must-not-escape');
  const headers = { 'X-Other': 'synthetic' };
  assert.equal(runtime.headers(null, headers), headers);
});

test('WAP-E12: the EasyPanel inline Evolution Dockerfile matches the render of current sources', async () => {
  const { readFile } = await import('node:fs/promises');
  const { renderEvolutionDockerfile } =
    await import('../ops/evolution/render-dockerfile.mjs');
  const inline = await readFile(
    new URL('../ops/evolution/Dockerfile.inline', import.meta.url),
    'utf8',
  );
  assert.equal(inline, await renderEvolutionDockerfile());
  const runtime = await readFile(
    new URL('../ops/evolution/wap-generation-runtime.cjs', import.meta.url),
    'utf8',
  );
  assert.ok(inline.includes(runtime));
  assert.match(
    inline,
    /\nRUN node \/evolution\/silmer-wap-generation-patch\.mjs \/evolution\/dist\/main\.js \/evolution\/node_modules\/baileys\/lib\/Socket\/messages-recv\.js /u,
  );
});

const retention = createRequire(import.meta.url)(
  '../ops/evolution/retention.cjs',
);

test('WAP-E12: retention covers the general and every allowlisted personal instance, never an unsafe name', async () => {
  const general = { SILMER_EVOLUTION_INSTANCE: 'synthetic-general' };
  assert.deepEqual(retention.retentionInstances(general), [
    'synthetic-general',
  ]);
  for (const flag of [undefined, 'false', 'true']) {
    const env = {
      ...general,
      ...(flag === undefined ? {} : { SILMER_WAP_GENERATION_ENABLED: flag }),
    };
    // An empty personal list keeps the general-only purge (enabled + empty
    // is refused below, as the generation runtime refuses it).
    if (flag !== 'true')
      assert.deepEqual(
        retention.retentionInstances({
          ...env,
          SILMER_WAP_GENERATION_INSTANCES: '',
        }),
        ['synthetic-general'],
      );
    // Listed personal instances stay covered even after a rollback to off.
    assert.deepEqual(
      retention.retentionInstances({
        ...env,
        SILMER_WAP_GENERATION_INSTANCES: 'synthetic-a,synthetic-b',
      }),
      ['synthetic-general', 'synthetic-a', 'synthetic-b'],
    );
  }
  for (const change of [
    { SILMER_EVOLUTION_INSTANCE: undefined },
    { SILMER_EVOLUTION_INSTANCE: "silmer' OR '1'='1" },
    { SILMER_WAP_GENERATION_ENABLED: 'TRUE' },
    { SILMER_WAP_GENERATION_ENABLED: 'yes' },
    { SILMER_WAP_GENERATION_ENABLED: 'true' },
    {
      SILMER_WAP_GENERATION_ENABLED: 'true',
      SILMER_WAP_GENERATION_INSTANCES: '',
    },
    { SILMER_WAP_GENERATION_INSTANCES: 'synthetic-a,synthetic-a' },
    { SILMER_WAP_GENERATION_INSTANCES: 'synthetic-a,' },
    { SILMER_WAP_GENERATION_INSTANCES: 'synthetic a' },
    { SILMER_WAP_GENERATION_INSTANCES: 'a\');DELETE FROM "Instance";--' },
    { SILMER_WAP_GENERATION_INSTANCES: 'x'.repeat(65) },
    { SILMER_WAP_GENERATION_INSTANCES: 'synthetic-general' },
  ]) {
    const env = { ...general, ...change };
    assert.throws(
      () => retention.retentionInstances(env),
      /EVOLUTION_RETENTION_CONFIGURATION_INVALID/u,
      JSON.stringify(change),
    );
    // Whatever the generation runtime refuses, retention refuses too.
    if (
      'SILMER_WAP_GENERATION_INSTANCES' in change &&
      change.SILMER_WAP_GENERATION_INSTANCES !== 'synthetic-general'
    )
      assert.throws(
        () => fromEnvironment(env),
        /WAP_GENERATION_CONFIG_INVALID/u,
      );
  }

  const now = Date.parse('2026-11-19T12:00:00Z');
  const cutoff = Math.floor(now / 1000) - retention.RETENTION_SECONDS;
  const rows = [
    ['old-general', 'synthetic-general', cutoff - 1],
    ['old-a', 'synthetic-a', cutoff - 1],
    ['old-b', 'synthetic-b', cutoff - 60],
    ['boundary-a', 'synthetic-a', cutoff],
    ['recent-b', 'synthetic-b', cutoff + 1],
    ['old-other', 'other', cutoff - 1],
  ];
  /** @type {any[]} */ const filters = [];
  const refuse = () => assert.fail('retention must not run raw SQL');
  const prisma = {
    $executeRaw: refuse,
    $executeRawUnsafe: refuse,
    $queryRaw: refuse,
    $queryRawUnsafe: refuse,
    message: {
      async deleteMany(/** @type {any} */ { where }) {
        filters.push(where);
        const names = where.Instance.is.name.in;
        const ids = rows
          .filter(
            ([, instance, ts]) =>
              names.includes(instance) && ts < where.messageTimestamp.lt,
          )
          .map(([id]) => id);
        return { count: ids.length, ids };
      },
    },
    instance: { deleteMany: () => assert.fail('Instance is never deleted') },
    session: { deleteMany: () => assert.fail('Session is never deleted') },
  };
  const instances = retention.retentionInstances({
    ...general,
    SILMER_WAP_GENERATION_ENABLED: 'true',
    SILMER_WAP_GENERATION_INSTANCES: 'synthetic-a,synthetic-b',
  });
  assert.deepEqual(
    await retention.purgeExpiredMessages(prisma, { instances, now }),
    {
      count: 3,
      ids: ['old-general', 'old-a', 'old-b'],
    },
  );
  // One parameterised Prisma statement with the same seven-day cutoff.
  assert.deepEqual(filters, [
    {
      Instance: {
        is: {
          name: { in: ['synthetic-general', 'synthetic-a', 'synthetic-b'] },
        },
      },
      messageTimestamp: { lt: cutoff },
    },
  ]);
  for (const bad of [
    [],
    'synthetic-general',
    ['synthetic-general', 'synthetic-general'],
    ['synthetic-general', "x' OR 1=1 --"],
    ['synthetic-general', 7],
  ])
    await assert.rejects(
      () => retention.purgeExpiredMessages(prisma, { instances: bad, now }),
      /EVOLUTION_RETENTION_CONFIGURATION_INVALID/u,
      JSON.stringify(bad),
    );
  assert.equal(filters.length, 1);
  // The hourly job purges the same list.
  const job = retention.scheduleRetention(prisma, {
    instances,
    report() {},
    schedule: () => ({ unref() {} }),
  });
  await job.tick();
  assert.deepEqual(filters[1].Instance, filters[0].Instance);
});

test('WAP-E12: boot and hourly retention read the personal allowlist from the environment', async () => {
  const { readFile } = await import('node:fs/promises');
  const privacySource = await readFile(
    new URL('../ops/evolution/privacy.cjs', import.meta.url),
    'utf8',
  );
  const retentionSource = await readFile(
    new URL('../ops/evolution/retention.cjs', import.meta.url),
    'utf8',
  );
  assert.match(privacySource, /instances: retentionInstances\(env\)/u);
  assert.match(
    retentionSource,
    /instances: retentionInstances\(process\.env\)/u,
  );
  assert.doesNotMatch(
    privacySource + retentionSource,
    /\$(?:query|execute)Raw|instance: (?:env|process\.env)\.SILMER_EVOLUTION_INSTANCE/u,
  );
});

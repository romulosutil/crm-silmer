import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  patchEvolutionGeneration,
  extractGenerationMethods,
  extractPrismaCredentialWriter,
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
    assert.throws(
      () => runtime.current('synthetic-a', 'messages.upsert'),
      /WAP_GENERATION_EVENT_DENIED/u,
    );
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

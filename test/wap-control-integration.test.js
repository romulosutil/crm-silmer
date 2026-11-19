import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import vm from 'node:vm';
import { createWhatsAppControlClient } from '../modules/integration-reliability/src/whatsapp-control-client.js';
import { createWhatsAppControlWorkflows } from '../ops/n8n/whatsapp-control-workflows.mjs';

const loadRuntime = createRequire(import.meta.url);
const { createControlAdapter, createControlMiddleware, protectExpress } =
  loadRuntime('../ops/evolution/wap-control-runtime.cjs');
const { createGenerationRuntime } = loadRuntime(
  '../ops/evolution/wap-generation-runtime.cjs',
);
const operationId = randomUUID();
const lineId = randomUUID();
const reference = randomUUID();
const challengeId = randomUUID();
const now = new Date('2026-11-16T12:00:00.000Z');
const expiresAt = new Date(now.getTime() + 60000).toISOString();
const input = {
  operationId,
  lineId,
  generation: 1,
  action: 'connect',
  reference,
};
const challenge = {
  operationId,
  lineId,
  generation: 1,
  reference,
  challengeId,
  mode: 'code',
};
const token = 'synthetic-generation-token-000000000000';
const source = {
  bindingId: randomUUID(),
  lineId,
  accountId: randomUUID(),
  generation: 1,
};
const webhookUrl =
  'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events';
const env = {
  SILMER_WAP_CONTROL_ENABLED: 'true',
  SILMER_WAP_GENERATION_ENABLED: 'true',
  SILMER_WAP_GENERATION_INSTANCES: 'synthetic-one',
  SILMER_WAP_CONTROL_WEBHOOK_URL: webhookUrl,
  AUTHENTICATION_API_KEY: 's'.repeat(48),
};
const privateInput = {
  kind: 'control',
  instance: 'synthetic-one',
  action: 'connect',
  expectedNumber: '+5511000000001',
  webhookUrl,
  source,
  generationToken: token,
};
/** @param {any} value @param {number} [status] */
const response = (value, status = 200) =>
  new globalThis.Response(JSON.stringify(value), { status });
// WAP-E12: Evolution 2.3.7 SettingsDto applied on every connect.
const settingsBody = Object.freeze({
  rejectCall: false,
  msgCall: '',
  groupsIgnore: true,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
  wavoipToken: '',
});
// GET /settings/find/:name returns the stored row flat (channel.service.ts).
const settingsRow = Object.freeze({ ...settingsBody });
/** @param {any} [extra] */
const clientOptions = (extra = {}) => ({
  enabled: true,
  allowlist: [lineId],
  controlEndpoint:
    'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/control',
  challengeEndpoint:
    'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/challenge',
  clientId: 'synthetic-crm',
  clientSecret: 'synthetic-client-secret-00000000000000000',
  clock: () => now,
  ...extra,
});

test('WAP-E02: control client is default off and line allowlist denies before HTTP', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response({});
  };
  for (const patch of [
    { enabled: undefined },
    { enabled: false },
    { allowlist: [] },
    { allowlist: () => false },
  ]) {
    const client = createWhatsAppControlClient(
      clientOptions({ fetchImpl, ...patch }),
    );
    await assert.rejects(client.control(input), /WHATSAPP_CONTROL_DISABLED/u);
  }
  assert.equal(calls, 0);
});

test('WAP-E02: client binds Basic/correlation/idempotency and never redirects, caches or retries', async () => {
  /** @type {any[]} */ const calls = [];
  const client = createWhatsAppControlClient(
    clientOptions({
      fetchImpl: async (/** @type {any} */ url, /** @type {any} */ init) => {
        calls.push({ url, init });
        return response({ accepted: true, operationId, generation: 1 });
      },
    }),
  );
  assert.deepEqual(await client.control(input), {
    accepted: true,
    operationId,
    generation: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers['idempotency-key'], operationId);
  assert.equal(calls[0].init.headers['x-correlation-id'], operationId);
  assert.match(calls[0].init.headers.authorization, /^Basic /u);
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
});

test('WAP-E02: challenge round trip is bounded, correlated, expiring and has no command side effect', async () => {
  let calls = 0;
  const value = {
    challengeId,
    operationId,
    generation: 1,
    mode: 'code',
    expiresAt,
    value: '12345678',
  };
  const client = createWhatsAppControlClient(
    clientOptions({
      fetchImpl: async (/** @type {any} */ url, /** @type {any} */ init) => {
        calls++;
        assert.equal(new URL(url).pathname.endsWith('/challenge'), true);
        assert.equal(init.headers['idempotency-key'], challengeId);
        assert.deepEqual(JSON.parse(init.body), challenge);
        return response(value);
      },
    }),
  );
  assert.deepEqual(await client.challenge(challenge), value);
  assert.equal(calls, 1);
});

test('WAP-E02: rejected schemas, arbitrary URLs and forbidden credentials never dispatch', async () => {
  let calls = 0;
  const client = createWhatsAppControlClient(
    clientOptions({
      fetchImpl: async () => {
        calls++;
        return response({});
      },
    }),
  );
  for (const patch of [
    { instance: 'other' },
    { userId: 'other' },
    { url: 'https://other.invalid' },
    { generation: 0 },
    { operationId: token },
    { action: 'restart' },
  ])
    await assert.rejects(
      client.control({ ...input, ...patch }),
      /WHATSAPP_CONTROL_INVALID/u,
    );
  for (const patch of [
    { controlEndpoint: 'https://n8n.synthetic.invalid/arbitrary' },
    {
      challengeEndpoint:
        'http://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/challenge',
    },
    { clientId: 'a:b' },
    { clientSecret: 'short' },
    { timeoutMs: 0 },
  ])
    assert.throws(
      () => createWhatsAppControlClient(clientOptions(patch)),
      /WHATSAPP_CONTROL_CONFIGURATION_INVALID/u,
    );
  assert.equal(calls, 0);
});

test('WAP-E02: timeout, HTTP rejection, malformed or oversized remote data remain uncertain with no leaked payload or retry', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error(token);
    },
    async () => response({ secret: token }, 403),
    async () => new globalThis.Response(token),
    async () =>
      response({
        accepted: true,
        operationId,
        generation: 1,
        secret: 'x'.repeat(5000),
      }),
    async () =>
      response({ accepted: true, operationId: randomUUID(), generation: 1 }),
  ]) {
    let calls = 0;
    const client = createWhatsAppControlClient(
      clientOptions({
        fetchImpl: async () => {
          calls++;
          return fetchImpl();
        },
      }),
    );
    await assert.rejects(client.control(input), (/** @type {any} */ error) => {
      assert.equal(
        JSON.stringify({ ...error, message: error.message }).includes(token),
        false,
      );
      return /^WHATSAPP_CONTROL_/u.test(error.code);
    });
    assert.equal(calls, 1);
  }
  for (const patch of [
    { operationId: randomUUID() },
    { generation: 2 },
    { mode: 'qr' },
    { expiresAt: now.toISOString() },
    { expiresAt: new Date(now.getTime() + 121000).toISOString() },
    { value: '<script>' },
    { secret: token },
  ]) {
    const client = createWhatsAppControlClient(
      clientOptions({
        fetchImpl: async () =>
          response({
            challengeId,
            operationId,
            generation: 1,
            mode: 'code',
            expiresAt,
            value: '12345678',
            ...patch,
          }),
      }),
    );
    await assert.rejects(
      client.challenge(challenge),
      /^WhatsAppControlDeliveryError: WHATSAPP_CONTROL_/u,
    );
  }
});

test('WAP-E02: gateway adapter only prepares a single opaque account and discards raw create credentials', async () => {
  /** @type {any[]} */ const calls = [];
  const adapter = createControlAdapter({
    env,
    generationRuntime: createGenerationRuntime({
      enabled: true,
      instances: ['synthetic-one'],
    }),
    fetchImpl: async (/** @type {any} */ url, /** @type {any} */ init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/instance/fetchInstances') return response([]);
      if (path === '/instance/create')
        return response(
          { instance: { instanceName: 'synthetic-one' }, hash: token },
          201,
        );
      if (path.includes('/settings/find/')) return response(settingsRow);
      if (path.includes('/webhook/find/'))
        return response({
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
        });
      if (path.includes('/instance/connectionState/'))
        return response({ instance: { state: 'close' } });
      return response({ enabled: true }, 201);
    },
  });
  const result = await adapter.execute(privateInput);
  assert.deepEqual(result, {
    outcome: 'succeeded',
    providerState: 'close',
    webhookVerified: true,
    bindingVerified: false,
  });
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      '/instance/fetchInstances',
      '/instance/create',
      '/settings/set/synthetic-one',
      '/settings/find/synthetic-one',
      '/webhook/set/synthetic-one',
      '/webhook/find/synthetic-one',
      '/instance/connectionState/synthetic-one',
    ],
  );
  assert.equal(calls[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].init.body), settingsBody);
  assert.equal(JSON.parse(calls[1].init.body).qrcode, false);
  // WAP-E12: Evolution 2.3.7 instance settings applied at create time.
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    instanceName: 'synthetic-one',
    integration: 'WHATSAPP-BAILEYS',
    qrcode: false,
    groupsIgnore: true,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
    alwaysOnline: false,
    rejectCall: false,
  });
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: false,
      events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
    },
  });
  assert.equal(
    calls.some((call) => call.path.startsWith('/instance/connect/')),
    false,
  );
  assert.equal(
    calls.some((call) => call.init.method === 'DELETE'),
    false,
  );
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('WAP-E02: timeout after create does not delete the instance or retry the uncertain effect', async () => {
  /** @type {string[]} */ const calls = [];
  const adapter = createControlAdapter({
    env,
    fetchImpl: async (/** @type {any} */ url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === '/instance/fetchInstances') return response([]);
      throw new Error('synthetic-timeout');
    },
  });
  await assert.rejects(adapter.execute(privateInput));
  assert.deepEqual(calls, ['/instance/fetchInstances', '/instance/create']);
});

test('WAP-E02: challenge installs immutable socket source before one provider connect and renewal cannot replace it', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-one'],
  });
  /** @type {string[]} */ const paths = [];
  const adapter = createControlAdapter({
    env,
    clock: () => now,
    generationRuntime: runtime,
    fetchImpl: async (/** @type {any} */ url) => {
      paths.push(new URL(url).pathname);
      return response({
        pairingCode: '12345678',
        base64: `data:image/png;base64,${Buffer.from('synthetic-QR').toString('base64')}`,
      });
    },
  });
  const body = {
    kind: 'challenge',
    instance: privateInput.instance,
    expectedNumber: privateInput.expectedNumber,
    webhookUrl,
    source,
    generationToken: token,
    challenge: { challengeId, operationId, mode: 'code', expiresAt },
  };
  assert.equal((await adapter.execute(body)).value, '12345678');
  const socket = {};
  const captured = runtime.captureSocket('synthetic-one', socket);
  assert.deepEqual(captured.source, source);
  assert.deepEqual(runtime.ensureBinding('synthetic-one', source, token), {
    duplicate: true,
  });
  assert.equal(runtime.captureSocket('synthetic-one', socket), captured);
  assert.throws(
    () => runtime.ensureBinding('synthetic-one', source, `${token}changed`),
    /WAP_GENERATION_BINDING_REUSED/u,
  );
  assert.deepEqual(paths, ['/instance/connect/synthetic-one']);
});

test('WAP-E12: challenge waits for the asynchronously rendered QR while the instance is connecting', async () => {
  const qr = `data:image/png;base64,${Buffer.from('synthetic-QR').toString('base64')}`;
  /** @param {any} replies */
  const run = async (replies, mode = 'qr') => {
    const runtime = createGenerationRuntime({
      enabled: true,
      instances: ['synthetic-one'],
    });
    /** @type {string[]} */ const paths = [];
    let t = now.getTime();
    const adapter = createControlAdapter({
      env,
      clock: () => new Date(t),
      sleep: async (/** @type {number} */ ms) => {
        t += ms;
      },
      generationRuntime: runtime,
      fetchImpl: async (/** @type {any} */ url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path.startsWith('/instance/connectionState/'))
          return response({
            instance: { state: replies.state ?? 'connecting' },
          });
        return response(replies.connect.shift() ?? { count: 0 });
      },
    });
    const body = {
      kind: 'challenge',
      instance: privateInput.instance,
      expectedNumber: privateInput.expectedNumber,
      webhookUrl,
      source,
      generationToken: token,
      challenge: {
        challengeId,
        operationId,
        mode,
        expiresAt: new Date(t + 60000).toISOString(),
      },
    };
    return { paths, result: adapter.execute(body) };
  };
  // Evolution 2.3.7: the first connect returns { count: 0 } after its 2 s.
  const late = await run({
    connect: [{ count: 0 }, { count: 0 }, { base64: qr, count: 1 }],
  });
  assert.equal((await late.result).value, qr);
  assert.deepEqual(late.paths, [
    '/instance/connect/synthetic-one',
    '/instance/connectionState/synthetic-one',
    '/instance/connect/synthetic-one',
    '/instance/connectionState/synthetic-one',
    '/instance/connect/synthetic-one',
  ]);
  const code = await run(
    {
      connect: [{ count: 1, pairingCode: null }, { pairingCode: 'ABCD-1234' }],
    },
    'code',
  );
  assert.equal((await code.result).value, 'ABCD-1234');
  // Never rendered within the bound: uncertain, and polling stops.
  const never = await run({ connect: [] });
  await assert.rejects(never.result, /WAP_CONTROL_UNKNOWN/u);
  assert.equal(
    never.paths.filter((p) => p.startsWith('/instance/connect/')).length,
    17,
  );
  // A socket that left 'connecting' is not reopened by the poll.
  const closed = await run({ connect: [{ count: 0 }], state: 'close' });
  await assert.rejects(closed.result, /WAP_CONTROL_UNKNOWN/u);
  assert.deepEqual(closed.paths, [
    '/instance/connect/synthetic-one',
    '/instance/connectionState/synthetic-one',
  ]);
});

test('WAP-E02: reconciliation reads status, actual owner identity and exact webhook without connect/logout/delete', async () => {
  /** @type {any[]} */ const calls = [];
  const adapter = createControlAdapter({
    env,
    fetchImpl: async (/** @type {any} */ url, /** @type {any} */ init) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method });
      if (path.includes('connectionState'))
        return response({ instance: { state: 'open' } });
      if (path.includes('settings/find')) return response(settingsRow);
      if (path.includes('webhook/find'))
        return response({
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
        });
      return response([
        {
          name: 'synthetic-one',
          ownerJid: '5511000000001@s.whatsapp.net',
          number: '5511000000002',
          token,
        },
      ]);
    },
  });
  assert.deepEqual(
    await adapter.execute({
      ...privateInput,
      action: 'reconcile',
      source: null,
      generationToken: null,
    }),
    {
      outcome: 'reconciled',
      providerState: 'open',
      webhookVerified: true,
      bindingVerified: false,
      confirmedNumber: '+5511000000001',
    },
  );
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      '/instance/fetchInstances',
      '/instance/connectionState/synthetic-one',
      '/webhook/find/synthetic-one',
      '/settings/find/synthetic-one',
    ],
  );
  assert.equal(
    calls.every((call) => call.method === 'GET'),
    true,
  );
});

/** Every observed settings row that must not count as verified. */
const DRIFTED_SETTINGS = [
  null,
  {},
  [],
  // Booleans must be observed exactly; a missing one is not proof.
  ...Object.entries(settingsRow)
    .filter(([, value]) => typeof value === 'boolean')
    .flatMap(([field, value]) => [
      { ...settingsRow, [field]: undefined },
      { ...settingsRow, [field]: !value },
      { ...settingsRow, [field]: String(value) },
    ]),
  // An automatic call reply or a wavoip token is outbound traffic.
  { ...settingsRow, msgCall: 'synthetic-auto-reply' },
  { ...settingsRow, wavoipToken: 'synthetic-wavoip-token' },
];

test('WAP-E12: every connect, including reuse of a closed instance, reapplies and verifies the instance settings', async () => {
  /** @type {any[]} */ const calls = [];
  const adapter = createControlAdapter({
    env,
    generationRuntime: createGenerationRuntime({
      enabled: true,
      instances: ['synthetic-one'],
    }),
    fetchImpl: async (/** @type {any} */ url, /** @type {any} */ init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/instance/fetchInstances')
        return response([{ name: 'synthetic-one', connectionStatus: 'close' }]);
      if (path.includes('/settings/set/'))
        return response(
          {
            settings: { instanceName: 'synthetic-one', settings: settingsBody },
          },
          201,
        );
      if (path.includes('/settings/find/'))
        return response({ ...settingsRow, msgCall: null, wavoipToken: null });
      if (path.includes('/webhook/find/'))
        return response({
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
        });
      if (path.includes('/instance/connectionState/'))
        return response({ instance: { state: 'close' } });
      return response({ enabled: true }, 201);
    },
  });
  assert.equal((await adapter.execute(privateInput)).webhookVerified, true);
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      '/instance/fetchInstances',
      '/settings/set/synthetic-one',
      '/settings/find/synthetic-one',
      '/webhook/set/synthetic-one',
      '/webhook/find/synthetic-one',
      '/instance/connectionState/synthetic-one',
    ],
  );
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), settingsBody);
});

test('WAP-E12: drifted or unreadable settings fail connect closed before the webhook is enabled', async () => {
  for (const observed of DRIFTED_SETTINGS) {
    /** @type {string[]} */ const paths = [];
    const adapter = createControlAdapter({
      env,
      generationRuntime: createGenerationRuntime({
        enabled: true,
        instances: ['synthetic-one'],
      }),
      fetchImpl: async (/** @type {any} */ url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path === '/instance/fetchInstances') return response([]);
        if (path === '/instance/create')
          return response({ instance: { instanceName: 'synthetic-one' } }, 201);
        if (path.includes('/settings/find/')) return response(observed);
        if (path.includes('/webhook/find/'))
          return response({
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
          });
        if (path.includes('/instance/connectionState/'))
          return response({ instance: { state: 'close' } });
        return response({ ok: true }, 201);
      },
    });
    await assert.rejects(
      adapter.execute(privateInput),
      /WAP_CONTROL_UNKNOWN/u,
      JSON.stringify(observed),
    );
    assert.equal(
      paths.some((path) => path.startsWith('/webhook/')),
      false,
      JSON.stringify(observed),
    );
  }
  // A refused settings write (upstream 4xx/5xx or {error:true}) is also unknown.
  for (const refused of [
    response({ error: true }, 201),
    response({ status: 400 }, 400),
  ]) {
    const adapter = createControlAdapter({
      env,
      fetchImpl: async (/** @type {any} */ url) => {
        const path = new URL(url).pathname;
        if (path === '/instance/fetchInstances')
          return response([
            { name: 'synthetic-one', connectionStatus: 'close' },
          ]);
        if (path.includes('/settings/set/')) return refused;
        return assert.fail(`no call after a refused settings write: ${path}`);
      },
    });
    await assert.rejects(adapter.execute(privateInput), /WAP_CONTROL_UNKNOWN/u);
  }
});

test('WAP-E12: reconciliation re-reads settings and never verifies drifted ones', async () => {
  for (const observed of DRIFTED_SETTINGS) {
    const adapter = createControlAdapter({
      env,
      fetchImpl: async (/** @type {any} */ url, /** @type {any} */ init) => {
        assert.equal(init.method, 'GET');
        const path = new URL(url).pathname;
        if (path.includes('fetchInstances'))
          return response([
            { name: 'synthetic-one', ownerJid: '5511000000001@s.whatsapp.net' },
          ]);
        if (path.includes('connectionState'))
          return response({ instance: { state: 'open' } });
        if (path.includes('settings/find')) return response(observed);
        return response({
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
        });
      },
    });
    const result = await adapter.execute({
      ...privateInput,
      action: 'reconcile',
      source: null,
      generationToken: null,
    });
    assert.equal(result.webhookVerified, false, JSON.stringify(observed));
  }
});

test('WAP-E02: missing identity or webhook proof never claims a confirmed connection', async () => {
  const adapter = createControlAdapter({
    env,
    fetchImpl: async (/** @type {any} */ url) => {
      const path = new URL(url).pathname;
      if (path.includes('connectionState'))
        return response({ instance: { state: 'open' } });
      if (path.includes('webhook/find'))
        return response({
          enabled: true,
          url: 'https://other.invalid',
          events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
        });
      return response([{ name: 'synthetic-one', number: '5511000000001' }]);
    },
  });
  const result = await adapter.execute({
    ...privateInput,
    action: 'reconcile',
    source: null,
    generationToken: null,
  });
  assert.equal(result.webhookVerified, false);
  assert.equal(Object.hasOwn(result, 'confirmedNumber'), false);
});

test('WAP-E02: reconciliation proves an absent instance by read without recreating it after an uncertain create', async () => {
  /** @type {string[]} */ const methods = [];
  const adapter = createControlAdapter({
    env,
    fetchImpl: async (/** @type {any} */ url, /** @type {any} */ init) => {
      methods.push(init.method);
      assert.equal(new URL(url).pathname, '/instance/fetchInstances');
      return response([{ name: 'other-private-instance', token }]);
    },
  });
  assert.deepEqual(
    await adapter.execute({
      ...privateInput,
      action: 'reconcile',
      source: null,
      generationToken: null,
    }),
    {
      outcome: 'reconciled',
      providerState: 'absent',
      webhookVerified: false,
      bindingVerified: false,
    },
  );
  assert.deepEqual(methods, ['GET']);
});

test('WAP-E02: an old open socket cannot prove a pending new generation, including renewal and runtime restart', async () => {
  const generationRuntime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-one'],
  });
  generationRuntime.ensureBinding('synthetic-one', source, token);
  const oldSocket = {};
  generationRuntime.captureSocket('synthetic-one', oldSocket);
  const nextSource = { ...source, bindingId: randomUUID(), generation: 2 };
  const nextToken = `${token}next`;
  generationRuntime.ensureBinding('synthetic-one', nextSource, nextToken);
  const adapter = createControlAdapter({
    env,
    generationRuntime,
    fetchImpl: async (/** @type {any} */ url) => {
      const path = new URL(url).pathname;
      if (path.includes('fetchInstances'))
        return response([
          { name: 'synthetic-one', ownerJid: '5511000000001@s.whatsapp.net' },
        ]);
      if (path.includes('connectionState'))
        return response({ instance: { state: 'open' } });
      return response({
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
      });
    },
  });
  const read = {
    ...privateInput,
    action: 'reconcile',
    source: nextSource,
    generationToken: nextToken,
  };
  assert.equal((await adapter.execute(read)).bindingVerified, false);
  assert.deepEqual(
    generationRuntime.ensureBinding('synthetic-one', nextSource, nextToken),
    { duplicate: true },
  );
  assert.equal((await adapter.execute(read)).bindingVerified, false);
  generationRuntime.captureSocket('synthetic-one', {});
  assert.equal((await adapter.execute(read)).bindingVerified, true);
  generationRuntime.captureSocket('synthetic-one', oldSocket);
  assert.equal((await adapter.execute(read)).bindingVerified, true);
  assert.equal(
    generationRuntime.bindingMatchesSocket('synthetic-one', source, token),
    false,
  );
  assert.equal(
    generationRuntime.bindingMatchesSocket('synthetic-one', nextSource, token),
    false,
  );
  const restarted = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-one'],
  });
  assert.equal(
    restarted.bindingMatchesSocket('synthetic-one', nextSource, nextToken),
    false,
  );
  assert.throws(
    () => generationRuntime.captureSocket('synthetic-one', {}),
    /WAP_GENERATION_BINDING_REQUIRED/u,
  );
  assert.equal(
    generationRuntime.bindingMatchesSocket(
      'synthetic-one',
      nextSource,
      nextToken,
    ),
    false,
  );
  generationRuntime.captureSocket('synthetic-one', oldSocket);
  assert.equal(
    generationRuntime.bindingMatchesSocket('synthetic-one', source, token),
    false,
  );
  assert.equal(
    generationRuntime.bindingMatchesSocket(
      'synthetic-one',
      nextSource,
      nextToken,
    ),
    false,
  );
});

test('WAP-E02: n8n Plan projects the authoritative API DTO into the exact real gateway challenge contract', async () => {
  const workflows = createWhatsAppControlWorkflows({
    enabled: true,
    allowlist: [lineId],
    crmBaseUrl: 'https://crm.synthetic.invalid',
    evolutionBaseUrl: 'https://evolution.synthetic.invalid',
    webhookCredentialId: 'webhook-basic',
    crmCredentialId: 'crm-basic',
    evolutionCredentialId: 'evolution-key',
  });
  const plan = workflows.challenge.nodes.find((node) => node.name === 'Plan');
  const privatePlan = {
    allowed: true,
    ...challenge,
    instance: 'synthetic-one',
    expectedNumber: '5511000000001',
    webhookUrl,
    source,
    generationToken: token,
    challenge: {
      challengeId,
      operationId,
      mode: 'code',
      expiresAt,
      generation: 1,
    },
  };
  const projected = vm.runInNewContext(`(()=>{${plan.parameters.jsCode}})()`, {
    $json: privatePlan,
    $: () => ({ first: () => ({ json: challenge }) }),
  });
  const gatewayBody = JSON.parse(JSON.stringify(projected.json));
  assert.deepEqual(Object.keys(gatewayBody.challenge).sort(), [
    'challengeId',
    'expiresAt',
    'mode',
    'operationId',
  ]);
  const generationRuntime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-one'],
  });
  const adapter = createControlAdapter({
    env,
    generationRuntime,
    clock: () => now,
    fetchImpl: async () => {
      generationRuntime.captureSocket('synthetic-one', {});
      return response({ pairingCode: '12345678' });
    },
  });
  assert.deepEqual(await adapter.execute(gatewayBody), {
    challengeId,
    operationId,
    generation: 1,
    mode: 'code',
    expiresAt,
    value: '12345678',
  });
  assert.equal(
    generationRuntime.bindingMatchesSocket('synthetic-one', source, token),
    true,
  );
});

test('WAP-E02: gateway middleware defaults off, authenticates exact private path and suppresses raw failures', async () => {
  /** @param {any} middleware @param {any} headers @param {any} body */
  async function invoke(middleware, headers, body) {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), {
      url: '/silmer/whatsapp-control/execute',
      method: 'POST',
      headers,
    });
    const res = {
      statusCode: 0,
      headers: /** @type {Record<string,string>} */ ({}),
      text: '',
      setHeader(/** @type {string} */ key, /** @type {string} */ value) {
        this.headers[key] = value;
      },
      end(/** @type {string} */ value) {
        this.text = value;
      },
    };
    await middleware(req, res, () => assert.fail('private path escaped'));
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.text.includes(token), false);
    return res;
  }
  const headers = {
    apikey: env.AUTHENTICATION_API_KEY,
    'content-type': 'application/json',
  };
  assert.equal(
    (await invoke(createControlMiddleware(), headers, privateInput)).statusCode,
    403,
  );
  const middleware = createControlMiddleware({
    env,
    fetchImpl: async () => {
      throw new Error(token);
    },
  });
  assert.equal(
    (await invoke(middleware, { ...headers, apikey: 'wrong' }, privateInput))
      .statusCode,
    403,
  );
  assert.equal(
    (await invoke(middleware, headers, { ...privateInput, instance: 'other' }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await invoke(middleware, headers, {
        ...privateInput,
        webhookUrl: 'https://other.invalid',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await invoke(middleware, headers, privateInput)).statusCode,
    503,
  );
  let next = 0;
  await middleware(
    { url: '/instance/connectionState/general' },
    {},
    () => next++,
  );
  assert.equal(next, 1);
  const app = {
    handlers: /** @type {any[]} */ ([]),
    use(/** @type {any} */ handler) {
      this.handlers.push(handler);
    },
  };
  const original = Object.assign(() => app, { Router: 'synthetic-router' });
  const protectedFactory = protectExpress(original);
  assert.equal(protectedFactory.Router, original.Router);
  assert.equal(protectedFactory(), app);
  assert.equal(app.handlers.length, 1);
});

test('WAP-E02: generated workflows are inactive/default-off, shared, authenticated and have no persistence or automatic retries', () => {
  const workflows = createWhatsAppControlWorkflows({
    crmBaseUrl: 'https://crm.synthetic.invalid',
    evolutionBaseUrl: 'https://evolution.synthetic.invalid',
    webhookCredentialId: 'webhook-basic',
    crmCredentialId: 'crm-basic',
    evolutionCredentialId: 'evolution-key',
  });
  for (const workflow of Object.values(workflows)) {
    assert.equal(workflow.active, false);
    assert.deepEqual(workflow.pinData, {});
    assert.deepEqual(workflow.settings, {
      executionOrder: 'v1',
      saveDataSuccessExecution: 'none',
      saveDataErrorExecution: 'none',
      saveManualExecutions: false,
      saveExecutionProgress: false,
    });
    const trigger = workflow.nodes.find((node) => node.name === 'Trigger');
    assert.equal(trigger.parameters.authentication, 'basicAuth');
    assert.equal(trigger.parameters.responseMode, 'responseNode');
    const guard = workflow.nodes.find((node) => node.name === 'Guard');
    assert.throws(
      () =>
        vm.runInNewContext(`(()=>{${guard.parameters.jsCode}})()`, {
          $json: { body: input },
        }),
      /WAP_CONTROL_DENIED/u,
    );
    for (const node of workflow.nodes.filter(
      (item) => item.type === 'n8n-nodes-base.httpRequest',
    )) {
      assert.equal(node.retryOnFail, false);
      assert.equal(
        node.parameters.options.redirect.redirect.followRedirects,
        false,
      );
      assert.equal(node.parameters.options.timeout, 15000);
    }
    assert.equal(JSON.stringify(workflow).includes(token), false);
  }
});

test('WAP-E12: the Gateway reaches Evolution only over the fixed internal origin or https', () => {
  const base = {
    crmBaseUrl: 'https://crm.synthetic.invalid',
    webhookCredentialId: 'webhook-basic',
    crmCredentialId: 'crm-basic',
    evolutionCredentialId: 'evolution-key',
  };
  const gatewayUrl = (/** @type {any} */ options) => {
    const workflows = createWhatsAppControlWorkflows({ ...base, ...options });
    const urls = Object.values(workflows).map(
      (workflow) =>
        workflow.nodes.find((node) => node.name === 'Gateway').parameters.url,
    );
    assert.equal(new Set(urls).size, 1);
    return urls[0];
  };
  assert.equal(
    gatewayUrl({ evolutionBaseUrl: 'http://schedule_silmer-evolution:8080' }),
    'http://schedule_silmer-evolution:8080/silmer/whatsapp-control/execute',
  );
  assert.equal(
    gatewayUrl({ evolutionBaseUrl: 'http://schedule_silmer-evolution:8080/' }),
    'http://schedule_silmer-evolution:8080/silmer/whatsapp-control/execute',
  );
  assert.equal(
    gatewayUrl({ evolutionBaseUrl: 'https://evolution.synthetic.invalid' }),
    'https://evolution.synthetic.invalid/silmer/whatsapp-control/execute',
  );
  assert.equal(
    gatewayUrl({
      evolutionBaseUrl: 'http://wap-provider-fixture:8080',
      crmBaseUrl: 'http://wap-control-fixture:3000',
      allowSyntheticHttp: true,
    }),
    'http://wap-provider-fixture:8080/silmer/whatsapp-control/execute',
  );
  for (const evolutionBaseUrl of [
    'http://schedule_silmer-evolution',
    'http://schedule_silmer-evolution:80',
    'http://schedule_silmer-evolution:8081',
    'http://other-evolution:8080',
    'http://schedule_silmer-evolution.:8080',
    'http://user:pass@schedule_silmer-evolution:8080',
    'http://user@schedule_silmer-evolution:8080',
    'http://schedule_silmer-evolution:8080/x',
    'http://schedule_silmer-evolution:8080/?q=1',
    'http://schedule_silmer-evolution:8080/#h',
    'ftp://schedule_silmer-evolution:8080',
  ])
    assert.throws(
      () => createWhatsAppControlWorkflows({ ...base, evolutionBaseUrl }),
      /WAP_WORKFLOW_CONFIGURATION_INVALID/u,
      evolutionBaseUrl,
    );
  for (const options of [
    { allowSyntheticHttp: false },
    { allowSyntheticHttp: true },
  ])
    assert.throws(
      () =>
        createWhatsAppControlWorkflows({
          ...base,
          ...options,
          crmBaseUrl: 'http://schedule_silmer-evolution:8080',
          evolutionBaseUrl: 'http://schedule_silmer-evolution:8080',
        }),
      /WAP_WORKFLOW_CONFIGURATION_INVALID/u,
    );
});

test('WAP-E12: webhook proof requires exactly connection plus message events', async () => {
  const runtime = createGenerationRuntime({
    enabled: true,
    instances: ['synthetic-one'],
  });
  for (const [events, expected] of [
    [['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'], true],
    [['MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'], true],
    [['CONNECTION_UPDATE'], false],
    [['CONNECTION_UPDATE', 'MESSAGES_UPSERT'], false],
    [['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPSERT'], false],
    [
      [
        'CONNECTION_UPDATE',
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'QRCODE_UPDATED',
      ],
      false,
    ],
    [['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE'], false],
    ['CONNECTION_UPDATE,MESSAGES_UPSERT,MESSAGES_UPDATE', false],
  ]) {
    const adapter = createControlAdapter({
      env,
      generationRuntime: runtime,
      fetchImpl: async (/** @type {any} */ url) => {
        const path = new URL(url).pathname;
        if (path.includes('fetchInstances'))
          return response([{ name: 'synthetic-one' }]);
        if (path.includes('connectionState'))
          return response({ instance: { state: 'close' } });
        if (path.includes('settings/find')) return response(settingsRow);
        return response({
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events,
        });
      },
    });
    const result = await adapter.execute({
      ...privateInput,
      action: 'reconcile',
      source: null,
      generationToken: null,
    });
    assert.equal(result.webhookVerified, expected, JSON.stringify(events));
  }
});

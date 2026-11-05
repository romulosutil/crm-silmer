import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLARITY_HOST,
  CLARITY_PROJECT_ID,
  createSellerAnalytics,
  sanitizeClarityPayload,
  sellerPage,
} from '../apps/edge-web/src/lib/seller-analytics.js';

const ORIGIN = `https://${CLARITY_HOST}`;
const UUID = '11111111-2222-4333-8444-555555555555';
const SELLER = {
  id: 'seller-synthetic-a',
  functionName: 'Vendedor',
  capabilities: [],
};

/** A valid SDK envelope with one static event to distinguish upload generations.
 * @param {string} label
 */
function payload(label) {
  return JSON.stringify({
    e: ['0.8.76', 0, 0, 0, CLARITY_PROJECT_ID],
    a: [[0, 24, label]],
  });
}

/** @param {Record<string, any>} [overrides] */
function harness(overrides = {}) {
  const environment = { href: `${ORIGIN}/inbox`, referrer: '', privacy: false };
  /** @type {any[][]} */
  const calls = [];
  /** @type {any[]} */
  const configurations = [];
  /** @type {string[]} */
  const payloads = [];
  let loads = 0;
  const sdk = {
    start(/** @type {any} */ config) {
      configurations.push(config);
      calls.push(['start']);
    },
    stop() {
      calls.push(['stop']);
    },
    set(/** @type {string} */ key, /** @type {string | string[]} */ value) {
      calls.push(['set', key, value]);
    },
    event(/** @type {string} */ name, /** @type {string} */ value) {
      calls.push(['event', name, value]);
    },
    consentv2(/** @type {any} */ state) {
      calls.push(['consentv2', state]);
    },
  };
  const controller = createSellerAnalytics({
    enabled: true,
    href: () => environment.href,
    referrer: () => environment.referrer,
    privacySignal: () => environment.privacy,
    load: async () => {
      loads += 1;
      return sdk;
    },
    digest: async () => 'synthetic-pseudonymous-key',
    send: (payload) => payloads.push(payload),
    ...overrides,
  });
  return {
    controller,
    environment,
    sdk,
    calls,
    configurations,
    payloads,
    loads: () => loads,
  };
}

test('CLAR-01/02 only enabled, authenticated sellers on the production host load analytics', async () => {
  for (const user of [
    null,
    undefined,
    {},
    { ...SELLER, id: '' },
    { ...SELLER, id: 42 },
    { ...SELLER, functionName: 'Financeiro' },
    { ...SELLER, functionName: 'Administrador' },
    { ...SELLER, capabilities: ['COMMERCIAL_ADMIN'] },
  ]) {
    const h = harness();
    await h.controller.sync(/** @type {any} */ (user));
    assert.equal(h.loads(), 0);
    assert.equal(h.calls.length, 0);
  }
  for (const overrides of [{ enabled: false }, { enabled: undefined }]) {
    const h = harness(overrides);
    await h.controller.sync(SELLER);
    assert.equal(h.loads(), 0);
  }
  for (const href of [
    'http://127.0.0.1:4173/inbox',
    `http://${CLARITY_HOST}/inbox`,
    `https://${CLARITY_HOST}.example.test/inbox`,
    `https://${CLARITY_HOST}:444/inbox`,
    'not-a-url',
  ]) {
    const h = harness();
    h.environment.href = href;
    await h.controller.sync(SELLER);
    assert.equal(h.loads(), 0, href);
  }
});

test('CLAR-02 URL metadata accepts real Dashboard filters and UUID details with the exact return query', () => {
  const allowed = new Map([
    ['/dashboard', 'dashboard'],
    ['/inbox', 'inbox'],
    ['/inbox?fila=minhas', 'inbox'],
    ['/inbox?fila=sem-responsavel', 'inbox'],
    ['/inbox?situacao=atender', 'inbox'],
    ['/inbox?situacao=fechar', 'inbox'],
    ['/inbox?situacao=agente', 'inbox'],
    ['/inbox?situacao=aguardando', 'inbox'],
    ['/inbox?situacao=vendedor', 'inbox'],
    ['/inbox?fila=minhas&situacao=atender', 'inbox'],
    [`/inbox/${UUID}`, 'inbox'],
    [`/inbox/${UUID}?fila=minhas`, 'inbox'],
    ['/pedidos', 'orders'],
    ['/pedidos?status=pendente', 'orders'],
    ['/pedidos?status=confirmado', 'orders'],
    ['/pedidos?status=pendente&vendedor=eu', 'orders'],
    ['/pedidos?origem=loja', 'orders'],
    ['/pedidos?entrega=atrasada', 'orders'],
    ['/pedidos?entrega=proxima', 'orders'],
    [
      '/pedidos?status=confirmado&vendedor=eu&origem=loja&entrega=atrasada',
      'orders',
    ],
    [`/pedidos/${UUID}`, 'order'],
    [`/pedidos/${UUID}?conversa=${UUID}`, 'order'],
    ['/clientes', 'clients'],
    [`/clientes/${UUID}`, 'clients'],
  ]);
  for (const [path, page] of allowed)
    assert.equal(sellerPage(new URL(path, ORIGIN)), page, path);
  for (const path of [
    '/',
    '/conta',
    '/usuarios',
    '/financeiro',
    '/melhor-envio',
    '/dashboard/agente',
    '/saude-erros',
    '/pedidos/cliente-sintetico',
    `/inbox/${UUID}/extra`,
    '/inbox?email=canary%40example.test',
    '/inbox?fila=canary%40example.test',
    '/inbox?situacao=arbitraria',
    '/inbox?fila=minhas&fila=minhas',
    '/inbox?fila=minhas&situacao=atender&email=canary',
    '/inbox?status=pendente',
    '/dashboard?fila=minhas',
    '/clientes?fila=minhas',
    '/pedidos?status=canary%40example.test',
    '/pedidos?status=pendente&status=confirmado',
    '/pedidos?vendedor=nome-sintetico',
    '/pedidos?origem=whatsapp',
    '/pedidos?entrega=amanha',
    '/pedidos?situacao=atender',
    '/pedidos?q=canary',
    '/inbox#synthetic-canary',
    `/inbox/${UUID}?conversa=${UUID}`,
    `/pedidos?conversa=${UUID}`,
    `/pedidos/${UUID}?conversa=canary%40example.test`,
    `/pedidos/${UUID}?conversa=${UUID}&conversa=${UUID}`,
    `/pedidos/${UUID}?conversa=${UUID}&email=canary`,
    `/pedidos/${UUID}?conversa=${UUID}&status=pendente`,
  ])
    assert.equal(sellerPage(new URL(path, ORIGIN)), null, path);
  for (const address of [
    `https://canary@example.test@${CLARITY_HOST}/inbox`,
    `https://synthetic:secret@${CLARITY_HOST}/pedidos`,
  ])
    assert.equal(sellerPage(new URL(address)), null, address);
});

test('CLAR-02 unsafe referrers never load while finite Dashboard filters remain eligible', async () => {
  for (const previous of [
    'https://external.example.test/',
    `${ORIGIN}/conta`,
    `${ORIGIN}/melhor-envio?code=synthetic-secret`,
    `${ORIGIN}/inbox?email=canary%40example.test`,
    `${ORIGIN}/inbox#synthetic-canary`,
    `${ORIGIN}/pedidos?vendedor=nome-sintetico`,
    `${ORIGIN}/pedidos?status=pendente&status=confirmado`,
    `https://canary:secret@${CLARITY_HOST}/`,
    `https://canary:secret@${CLARITY_HOST}/inbox?fila=minhas`,
    'malformed-referrer',
  ]) {
    const h = harness();
    h.environment.referrer = previous;
    await h.controller.sync(SELLER);
    assert.equal(h.loads(), 0, previous);
  }
  for (const previous of [
    '',
    `${ORIGIN}/`,
    `${ORIGIN}/inbox/${UUID}`,
    `${ORIGIN}/inbox?fila=minhas`,
    `${ORIGIN}/inbox?situacao=aguardando`,
    `${ORIGIN}/pedidos?status=pendente&vendedor=eu`,
    `${ORIGIN}/pedidos/${UUID}?conversa=${UUID}`,
  ]) {
    const h = harness();
    h.environment.referrer = previous;
    await h.controller.sync(SELLER);
    assert.equal(h.loads(), 1, previous);
  }
});

test('CLAR-03/05 captured async actions stay in their seller and navigation generation', async () => {
  const h = harness();
  const beforeAuthentication = h.controller.capture();
  await h.controller.sync(SELLER);
  let count = h.calls.length;
  beforeAuthentication('seller_reply_accepted');
  assert.equal(h.calls.length, count);

  const sameGeneration = h.controller.capture();
  await h.controller.sync(SELLER);
  sameGeneration('seller_reply_accepted');
  assert.deepEqual(h.calls.at(-1), ['event', 'seller_reply_accepted', '']);

  const deferred = Promise.withResolvers();
  const actionStartedByA = deferred.promise.then(() =>
    sameGeneration('seller_order_confirmed'),
  );
  await h.controller.sync({ ...SELLER, id: 'seller-synthetic-b' });
  count = h.calls.length;
  deferred.resolve(undefined);
  await actionStartedByA;
  assert.equal(h.calls.length, count);
  h.controller.capture()('seller_order_confirmed');
  assert.deepEqual(h.calls.at(-1), ['event', 'seller_order_confirmed', '']);

  const beforeStop = h.controller.capture();
  h.controller.stop();
  await h.controller.sync({ ...SELLER, id: 'seller-synthetic-b' });
  count = h.calls.length;
  beforeStop('seller_order_section_saved');
  assert.equal(h.calls.length, count);
  const beforeNavigation = h.controller.capture();
  h.controller.stop();
  h.environment.href = `${ORIGIN}/pedidos?status=pendente&vendedor=eu`;
  await h.controller.sync({ ...SELLER, id: 'seller-synthetic-b' });
  count = h.calls.length;
  beforeNavigation('seller_order_pdf_generated');
  assert.equal(h.calls.length, count);
  h.controller.capture()('seller_order_pdf_generated');
  assert.deepEqual(h.calls.at(-1), ['event', 'seller_order_pdf_generated', '']);
});

test('CLAR-03 privacy signals prevent loading and block active events/uploads immediately', async () => {
  const h = harness();
  h.environment.privacy = true;
  await h.controller.sync(SELLER);
  assert.equal(h.loads(), 0);
  h.environment.privacy = false;
  await h.controller.sync(SELLER);
  const count = h.calls.length;
  h.environment.privacy = true;
  h.controller.track('seller_reply_accepted');
  h.configurations[0].upload(payload('synthetic-payload'));
  assert.equal(h.calls.length, count);
  assert.deepEqual(h.payloads, []);
});

test('CLAR-03 the default detector respects both GPC and Do Not Track', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
  });
  for (const navigator of [
    { globalPrivacyControl: true, doNotTrack: '0' },
    { globalPrivacyControl: false, doNotTrack: '1' },
  ]) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: navigator,
    });
    const h = harness({ privacySignal: undefined });
    await h.controller.sync(SELLER);
    assert.equal(h.loads(), 0);
  }
});

test('CLAR-03/04 starts masked and cookieless, emits static tags/events without seller PII and deduplicates sync', async () => {
  const h = harness();
  await h.controller.sync({
    ...SELLER,
    ...{ name: 'Nome sintético', email: 'canary@example.test' },
  });
  await h.controller.sync(SELLER);
  assert.equal(h.loads(), 1);
  const config = h.configurations[0];
  assert.equal(config.projectId, CLARITY_PROJECT_ID);
  assert.equal(config.track, false);
  assert.equal(config.content, false);
  assert.deepEqual(config.mask, ['body']);
  assert.deepEqual(config.unmask, []);
  assert.deepEqual(config.cookies, []);
  assert.deepEqual(config.drop, ['conversa']);
  assert.equal(typeof config.upload, 'function');
  assert.ok(
    h.calls.some(
      ([name, state]) =>
        name === 'consentv2' &&
        state.ad_Storage === 'denied' &&
        state.analytics_Storage === 'denied',
    ),
  );
  assert.ok(
    h.calls.some(
      ([name, key, value]) =>
        name === 'set' &&
        key === 'crm_seller_key' &&
        value === 'synthetic-pseudonymous-key',
    ),
  );
  assert.ok(
    h.calls.some(
      ([name, value]) => name === 'event' && value === 'seller_view_inbox',
    ),
  );
  const serialized = JSON.stringify(h.calls);
  for (const secret of [SELLER.id, 'Nome sintético', 'canary@example.test'])
    assert.equal(serialized.includes(secret), false, secret);
  h.controller.track('seller_reply_accepted');
  assert.deepEqual(h.calls.at(-1), ['event', 'seller_reply_accepted', '']);
  const count = h.calls.length;
  for (const event of [
    'arbitrary-event',
    'canary@example.test',
    'seller_reply_accepted:body',
    'seller_view_canary',
  ])
    h.controller.track(event);
  assert.equal(h.calls.length, count);
});

test('CLAR-03 the default digest is stable and never exposes the raw seller identifier', async () => {
  const h = harness({ digest: undefined });
  await h.controller.sync(SELLER);
  const key = h.calls.find(
    ([name, tag]) => name === 'set' && tag === 'crm_seller_key',
  )?.[2];
  assert.match(key, /^[0-9a-f]{64}$/u);
  h.controller.stop();
  await h.controller.sync(SELLER);
  assert.equal(
    h.calls
      .filter(([name, tag]) => name === 'set' && tag === 'crm_seller_key')
      .at(-1)?.[2],
    key,
  );
  assert.equal(JSON.stringify(h.calls).includes(SELLER.id), false);
});

test('CLAR-05 pending SDK/hash completion after stop cannot start or identify a seller', async () => {
  for (const pendingDependency of ['load', 'digest']) {
    const deferred = Promise.withResolvers();
    const h = harness({ [pendingDependency]: () => deferred.promise });
    const pending = h.controller.sync(SELLER);
    h.controller.stop();
    deferred.resolve(pendingDependency === 'load' ? h.sdk : 'stale-hash');
    await pending;
    assert.deepEqual(h.calls, []);
    assert.equal(h.configurations.length, 0);
  }
});

test('CLAR-05 pending old user cannot overwrite a newer seller context', async () => {
  const deferred = Promise.withResolvers();
  const h = harness({
    digest: (/** @type {string} */ id) =>
      id === SELLER.id ? deferred.promise : Promise.resolve('new-seller-hash'),
  });
  const oldPending = h.controller.sync(SELLER);
  await h.controller.sync({ ...SELLER, id: 'seller-synthetic-b' });
  deferred.resolve('old-seller-hash');
  await oldPending;
  assert.equal(h.configurations.length, 1);
  assert.ok(
    h.calls.some(
      ([name, key, value]) =>
        name === 'set' &&
        key === 'crm_seller_key' &&
        value === 'new-seller-hash',
    ),
  );
  assert.equal(JSON.stringify(h.calls).includes('old-seller-hash'), false);
});

test('CLAR-05 loading cannot start after the address or privacy preference changes', async () => {
  for (const change of [
    (/** @type {ReturnType<typeof harness>} */ h) => {
      h.environment.href = `${ORIGIN}/conta`;
    },
    (/** @type {ReturnType<typeof harness>} */ h) => {
      h.environment.href = `${ORIGIN}/pedidos`;
    },
    (/** @type {ReturnType<typeof harness>} */ h) => {
      h.environment.privacy = true;
    },
  ]) {
    const deferred = Promise.withResolvers();
    const h = harness({ load: () => deferred.promise });
    const pending = h.controller.sync(SELLER);
    change(h);
    deferred.resolve(h.sdk);
    await pending;
    assert.equal(h.configurations.length, 0);
  }
});

test('CLAR-05 a rejected obsolete load cannot stop a newer seller context', async () => {
  const deferred = Promise.withResolvers();
  const h = harness({
    digest: (/** @type {string} */ id) =>
      id === SELLER.id ? deferred.promise : Promise.resolve('new-seller-hash'),
  });
  const obsolete = h.controller.sync(SELLER);
  await h.controller.sync({ ...SELLER, id: 'seller-synthetic-b' });
  deferred.reject(new Error('synthetic obsolete dependency failure'));
  await obsolete;
  const count = h.calls.length;
  h.controller.track('seller_reply_accepted');
  assert.equal(h.calls.length, count + 1);
  assert.deepEqual(h.calls.at(-1), ['event', 'seller_reply_accepted', '']);
  h.configurations[0].upload(payload('new-context-still-authorized'));
  assert.deepEqual(h.payloads, [payload('new-context-still-authorized')]);
});

test('CLAR-05 stop flushes an authorized page once and rejects auto-restarts or stale generation callbacks', async () => {
  const h = harness();
  await h.controller.sync(SELLER);
  const oldUpload = h.configurations[0].upload;
  h.sdk.stop = () => oldUpload(payload('safe-final-flush'));
  h.controller.stop();
  assert.deepEqual(h.payloads, [payload('safe-final-flush')]);
  oldUpload(payload('auto-restart-after-stop'));
  assert.deepEqual(h.payloads, [payload('safe-final-flush')]);
  h.sdk.stop = () => {};
  await h.controller.sync({ ...SELLER, id: 'seller-synthetic-b' });
  oldUpload(payload('stale-user-payload'));
  h.configurations[1].upload(payload('current-user-payload'));
  assert.deepEqual(h.payloads, [
    payload('safe-final-flush'),
    payload('current-user-payload'),
  ]);
});

test('CLAR-05 changed addresses drop final flush and events before the shell calls stop', async () => {
  const h = harness();
  await h.controller.sync(SELLER);
  const upload = h.configurations[0].upload;
  h.sdk.stop = () => upload(payload('obsolete-address-flush'));
  h.environment.href = `${ORIGIN}/conta`;
  const events = h.calls.filter(([name]) => name === 'event').length;
  h.controller.track('seller_reply_accepted');
  h.controller.stop();
  upload(payload('auto-restart-excluded-page'));
  assert.deepEqual(h.payloads, []);
  assert.equal(h.calls.filter(([name]) => name === 'event').length, events);
});

test('CLAR-06 SDK/import/hash/transport failures never reject business operations', async () => {
  for (const dependency of ['load', 'digest']) {
    const h = harness({
      [dependency]: async () => {
        throw new Error('synthetic failure');
      },
    });
    await assert.doesNotReject(h.controller.sync(SELLER));
    assert.doesNotThrow(() => h.controller.track('seller_order_confirmed'));
  }
  const methods = /** @type {const} */ ([
    'start',
    'stop',
    'consentv2',
    'set',
    'event',
  ]);
  for (const method of methods) {
    const h = harness();
    h.sdk[method] = () => {
      throw new Error('synthetic SDK failure');
    };
    await assert.doesNotReject(h.controller.sync(SELLER));
    assert.doesNotThrow(() => h.controller.track('seller_order_confirmed'));
    assert.doesNotThrow(() => h.controller.stop());
  }
  const h = harness({
    send: () => {
      throw new Error('synthetic transport failure');
    },
  });
  await h.controller.sync(SELLER);
  assert.doesNotThrow(() =>
    h.configurations[0].upload(payload('synthetic-payload')),
  );
});

test('CLAR-03 legacy Clarity cookies block SDK loading and active uploads without inheriting consent', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = { cookie: '' };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  for (const cookie of [
    '_clck=synthetic-existing-consent',
    'crm_csrf=synthetic; _clsk=synthetic-session',
  ]) {
    document.cookie = cookie;
    const h = harness();
    await h.controller.sync(SELLER);
    assert.equal(h.loads(), 0);
  }
  document.cookie = 'crm_csrf=synthetic; unrelated_clck=value';
  const h = harness();
  await h.controller.sync(SELLER);
  assert.equal(h.loads(), 1);
  const count = h.calls.length;
  document.cookie = '_clck=synthetic-late-cookie';
  h.controller.track('seller_reply_accepted');
  h.configurations[0].upload(payload('blocked-legacy-cookie'));
  assert.equal(h.calls.length, count);
  assert.deepEqual(h.payloads, []);
});

test('CLAR-03 sanitizer removes raw click destinations and diagnostics while preserving coordinates and masked DOM', () => {
  const click = [
    10,
    9,
    7,
    44,
    55,
    0,
    1,
    0,
    0,
    '***',
    'button',
    'https://external.example.test/?email=canary@example.test',
  ];
  const contextMenu = [12, 48, 8, 45, 56, 0, 1, 0, 0, '***', 'a', '/conta'];
  const dom = [[0, 5, 1, 'BODY', 'data-clarity-mask=true', '***']];
  const input = {
    e: ['0.8.76', 0, 0, 0, CLARITY_PROJECT_ID],
    a: [
      click,
      [11, 31, 'synthetic-secret-script-error'],
      contextMenu,
      [13, 33, 'synthetic-secret-log-message'],
      [14, 24, 'seller_reply_accepted'],
    ],
    p: dom,
  };
  const sanitized = JSON.parse(sanitizeClarityPayload(JSON.stringify(input)));
  assert.deepEqual(sanitized.e, input.e);
  assert.deepEqual(sanitized.p, dom);
  assert.deepEqual(sanitized.a, [
    [...click.slice(0, 11), ''],
    [...contextMenu.slice(0, 11), ''],
    [14, 24, 'seller_reply_accepted'],
  ]);
  for (const secret of [
    'canary@example.test',
    '/conta',
    'synthetic-secret-script-error',
    'synthetic-secret-log-message',
  ])
    assert.equal(JSON.stringify(sanitized).includes(secret), false, secret);
});

test('CLAR-03 sanitizer rejects unknown SDK/project/envelope shapes and the transport drops malformed data', async () => {
  const valid = JSON.parse(payload('valid-event'));
  for (const invalid of [
    'not-json',
    'null',
    '[]',
    JSON.stringify({ ...valid, e: undefined }),
    JSON.stringify({ ...valid, e: ['0.8.77', 0, 0, 0, CLARITY_PROJECT_ID] }),
    JSON.stringify({ ...valid, e: ['0.8.76', 0, 0, 0, 'other-project'] }),
    JSON.stringify({ ...valid, a: undefined }),
    JSON.stringify({ ...valid, a: {} }),
    JSON.stringify({ ...valid, a: ['not-an-event-array'] }),
    JSON.stringify({ ...valid, a: [null] }),
  ])
    assert.throws(() => sanitizeClarityPayload(invalid), invalid);
  const h = harness();
  await h.controller.sync(SELLER);
  h.configurations[0].upload('not-json');
  assert.deepEqual(h.payloads, []);
  h.configurations[0].upload(payload('valid-event'));
  assert.deepEqual(h.payloads, [payload('valid-event')]);
});

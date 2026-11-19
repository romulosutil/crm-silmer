'use strict';

// WAP-E02: fixed private adapter in the existing Evolution process. No queue,
// disk, log, retry, instance deletion, inbound revision or generic proxy route.
const { timingSafeEqual } = require('node:crypto');
const PATH = '/silmer/whatsapp-control/execute';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function denied() {
  throw new Error('WAP_CONTROL_DENIED');
}
function exact(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...fields].sort().join(',')
  )
    denied();
}
function equal(left, right) {
  const a = Buffer.from(typeof left === 'string' ? left : '');
  const b = Buffer.from(typeof right === 'string' ? right : '');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
// WAP-E12: lifecycle plus inbound/echo (upsert) and receipts (update).
// Challenge budget: Evolution's own connect waits 2 s, then up to 8 s of
// polling at 500 ms; the CRM client aborts the whole n8n chain at 15 s.
const CHALLENGE_WAIT_MS = 8000;
const CHALLENGE_POLL_MS = 500;
const WEBHOOK_EVENTS = Object.freeze([
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
]);
function verifiedWebhook(webhook, expectedUrl) {
  return (
    webhook?.enabled === true &&
    webhook.url === expectedUrl &&
    webhook.webhookByEvents === false &&
    webhook.webhookBase64 === false &&
    Array.isArray(webhook.events) &&
    webhook.events.length === WEBHOOK_EVENTS.length &&
    new Set(webhook.events).size === WEBHOOK_EVENTS.length &&
    WEBHOOK_EVENTS.every((event) => webhook.events.includes(event))
  );
}
// WAP-E12: Evolution 2.3.7 SettingsDto (POST /settings/set/:name, schema
// requires the six booleans). Applied on every connect, not only at create:
// a reused instance keeps whatever it had. Empty msgCall/wavoipToken clear an
// automatic call reply and the wavoip socket, both outbound traffic.
const SETTINGS = Object.freeze({
  rejectCall: false,
  msgCall: '',
  groupsIgnore: true,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
  wavoipToken: '',
});
// GET /settings/find/:name returns the stored row flat, or null when absent.
function verifiedSettings(settings) {
  return (
    settings !== null &&
    typeof settings === 'object' &&
    !Array.isArray(settings) &&
    Object.entries(SETTINGS).every(([field, expected]) =>
      typeof expected === 'boolean'
        ? settings[field] === expected
        : (settings[field] ?? '') === '',
    )
  );
}
// Evolution can retain an unpaired row across a restart without loading its
// socket. Its state reply then contains only the instance name.
function unpairedWithoutSocket(row, observation) {
  const instance = observation?.instance;
  return (
    row &&
    !row.ownerJid &&
    ['close', 'connecting'].includes(row.connectionStatus) &&
    instance?.instanceName === row.name &&
    !('state' in instance)
  );
}

function configuration(env) {
  const enabled = env.SILMER_WAP_CONTROL_ENABLED === 'true';
  if (
    env.SILMER_WAP_CONTROL_ENABLED !== undefined &&
    !['true', 'false'].includes(env.SILMER_WAP_CONTROL_ENABLED)
  )
    denied();
  if (!enabled) return { enabled: false, instances: [] };
  const instances = (env.SILMER_WAP_GENERATION_INSTANCES || '').split(',');
  let webhook;
  try {
    webhook = new URL(env.SILMER_WAP_CONTROL_WEBHOOK_URL);
  } catch {
    denied();
  }
  if (
    env.SILMER_WAP_GENERATION_ENABLED !== 'true' ||
    !instances.length ||
    instances.some((v) => !ID.test(v)) ||
    new Set(instances).size !== instances.length ||
    !env.AUTHENTICATION_API_KEY ||
    env.AUTHENTICATION_API_KEY.length < 32 ||
    webhook.protocol !== 'https:' ||
    webhook.username ||
    webhook.password ||
    webhook.search ||
    webhook.hash ||
    !webhook.pathname.startsWith('/webhook/silmer/seller-whatsapp/')
  )
    denied();
  const port = Number(env.SERVER_PORT || '8080');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) denied();
  return {
    enabled: true,
    instances,
    webhook: webhook.href,
    origin: `http://127.0.0.1:${port}`,
    key: env.AUTHENTICATION_API_KEY,
  };
}

async function jsonBytes(response, limit = 1024 * 1024) {
  if (!response.body) throw new Error('WAP_CONTROL_UNKNOWN');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Error('WAP_CONTROL_UNKNOWN');
  } finally {
    reader.releaseLock();
  }
}

function createControlAdapter({
  env = process.env,
  generationRuntime,
  fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const config = configuration(env);
  // Serializes only in-process calls. The authoritative one-shot reservation is
  // the CRM ledger; this guard is not presented as durable idempotency.
  const inFlight = new Set();
  async function http(path, method = 'GET', body) {
    const response = await fetchImpl(new URL(path, config.origin), {
      method,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        apikey: config.key,
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (![200, 201].includes(response.status))
      throw new Error('WAP_CONTROL_UNKNOWN');
    const value = await jsonBytes(response);
    if (value?.error === true) throw new Error('WAP_CONTROL_UNKNOWN');
    return value;
  }
  return Object.freeze({
    enabled: config.enabled,
    async execute(body) {
      if (!config.enabled) denied();
      exact(body, [
        'kind',
        'instance',
        'expectedNumber',
        'webhookUrl',
        'source',
        'generationToken',
        ...(body?.kind === 'challenge' ? ['challenge'] : ['action']),
      ]);
      if (
        !['control', 'challenge'].includes(body.kind) ||
        !config.instances.includes(body.instance) ||
        !/^\+?[1-9][0-9]{7,14}$/.test(body.expectedNumber) ||
        body.webhookUrl !== config.webhook
      )
        denied();
      if (
        body.kind === 'challenge' ||
        body.action === 'connect' ||
        (body.action === 'reconcile' && body.source !== null)
      ) {
        if (
          typeof body.generationToken !== 'string' ||
          !/^[A-Za-z0-9_-]{32,128}$/.test(body.generationToken)
        )
          denied();
        exact(body.source, ['bindingId', 'lineId', 'accountId', 'generation']);
        if (
          !['bindingId', 'lineId', 'accountId'].every(
            (k) =>
              typeof body.source[k] === 'string' && ID.test(body.source[k]),
          ) ||
          !Number.isSafeInteger(body.source.generation) ||
          body.source.generation < 1
        )
          denied();
      } else if (body.source !== null || body.generationToken !== null)
        denied();
      if (
        body.kind === 'control' &&
        !['connect', 'disconnect', 'reconcile'].includes(body.action)
      )
        denied();
      if (body.kind === 'challenge') {
        exact(body.challenge, [
          'challengeId',
          'operationId',
          'mode',
          'expiresAt',
        ]);
        if (
          !UUID.test(body.challenge.challengeId) ||
          !UUID.test(body.challenge.operationId) ||
          !['qr', 'code'].includes(body.challenge.mode) ||
          !Number.isFinite(Date.parse(body.challenge.expiresAt)) ||
          Date.parse(body.challenge.expiresAt) <= clock().getTime() ||
          Date.parse(body.challenge.expiresAt) > clock().getTime() + 120000
        )
          denied();
      }
      if (
        body.action !== 'reconcile' &&
        generationRuntime?.pairingHandoffPending?.(body.instance)
      )
        throw new Error('WAP_CONTROL_UNKNOWN');
      if (inFlight.has(body.instance)) denied();
      inFlight.add(body.instance);
      const name = encodeURIComponent(body.instance);
      try {
        if (body.kind === 'challenge') {
          // Reusing the exact binding is a no-op; never reclassify the socket.
          generationRuntime.ensureBinding(
            body.instance,
            body.source,
            body.generationToken,
          );
          const suffix =
            body.challenge.mode === 'code'
              ? `?number=${encodeURIComponent(body.expectedNumber.replace(/^\+/, ''))}`
              : '';
          const read = (/** @type {any} */ result) =>
            body.challenge.mode === 'code'
              ? result?.pairingCode
              : result?.base64;
          // Evolution 2.3.7 starts the socket on a 'close' instance, waits a
          // fixed 2 s and returns whatever QR exists; the QR (and the pairing
          // code) is rendered asynchronously and may still be missing. While
          // the instance is 'connecting', connect only reads the current QR
          // (no second socket), so poll it within a bound the CRM can await.
          let value = read(await http(`/instance/connect/${name}${suffix}`));
          const deadline = clock().getTime() + CHALLENGE_WAIT_MS;
          while (typeof value !== 'string' && clock().getTime() < deadline) {
            await sleep(CHALLENGE_POLL_MS);
            const state = await http(`/instance/connectionState/${name}`);
            if (state?.instance?.state !== 'connecting') break;
            value = read(await http(`/instance/connect/${name}${suffix}`));
          }
          if (
            typeof value !== 'string' ||
            (body.challenge.mode === 'code'
              ? !/^[A-Za-z0-9-]{8,32}$/.test(value)
              : !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value))
          )
            throw new Error('WAP_CONTROL_UNKNOWN');
          return {
            ...body.challenge,
            generation: body.source.generation,
            value,
          };
        }
        if (body.action === 'connect') {
          // Read first: a reconnect preserves the opaque account/instance. It
          // never creates a second instance because a prior response was lost.
          const all = await http('/instance/fetchInstances');
          if (!Array.isArray(all)) throw new Error('WAP_CONTROL_UNKNOWN');
          const own = all.filter((v) => v.name === body.instance);
          if (own.length > 1) throw new Error('WAP_CONTROL_UNKNOWN');
          const existing = own[0];
          if (
            existing &&
            existing.connectionStatus !== 'close' &&
            (existing.connectionStatus !== 'connecting' || existing.ownerJid)
          )
            throw new Error('WAP_CONTROL_UNKNOWN');
          if (
            existing &&
            (await http(`/instance/connectionState/${name}`))?.instance
              ?.state !== 'close'
          )
            throw new Error('WAP_CONTROL_UNKNOWN');
          if (!existing) {
            const created = await http('/instance/create', 'POST', {
              instanceName: body.instance,
              integration: 'WHATSAPP-BAILEYS',
              qrcode: false,
              // Evolution 2.3.7 InstanceDto settings: no group traffic, no
              // read receipts sent on the seller's behalf, no history import.
              groupsIgnore: true,
              readMessages: false,
              readStatus: false,
              syncFullHistory: false,
              alwaysOnline: false,
              rejectCall: false,
            });
            if (created?.instance?.instanceName !== body.instance)
              throw new Error('WAP_CONTROL_UNKNOWN');
          }
          // Settings are proven before the webhook can carry any event.
          await http(`/settings/set/${name}`, 'POST', { ...SETTINGS });
          if (!verifiedSettings(await http(`/settings/find/${name}`)))
            throw new Error('WAP_CONTROL_UNKNOWN');
          await http(`/webhook/set/${name}`, 'POST', {
            webhook: {
              enabled: true,
              url: config.webhook,
              byEvents: false,
              base64: false,
              events: [...WEBHOOK_EVENTS],
            },
          });
          const observedWebhook = await http(`/webhook/find/${name}`);
          const observedState = await http(`/instance/connectionState/${name}`);
          if (
            !verifiedWebhook(observedWebhook, config.webhook) ||
            observedState?.instance?.state !== 'close'
          )
            throw new Error('WAP_CONTROL_UNKNOWN');
          return {
            outcome: 'succeeded',
            providerState: 'close',
            webhookVerified: true,
            bindingVerified: false,
          };
        }
        if (body.action === 'disconnect') {
          await http(`/instance/logout/${name}`, 'DELETE');
          return {
            outcome: 'succeeded',
            providerState: 'close',
            webhookVerified: false,
            bindingVerified: false,
          };
        }
        // Reconciliation consists only of reads; no connect, logout or delete.
        const observed = await http('/instance/fetchInstances');
        if (!Array.isArray(observed)) throw new Error('WAP_CONTROL_UNKNOWN');
        const own = observed.filter(
          (candidate) => candidate.name === body.instance,
        );
        if (!own.length)
          return {
            outcome: 'reconciled',
            providerState: 'absent',
            webhookVerified: false,
            bindingVerified: false,
          };
        if (own.length !== 1) throw new Error('WAP_CONTROL_UNKNOWN');
        const handoff = generationRuntime?.pairingHandoffPending?.(body.instance);
        const state = await http(`/instance/connectionState/${name}`);
        const webhook = await http(`/webhook/find/${name}`);
        const settings = await http(`/settings/find/${name}`);
        const observedState = unpairedWithoutSocket(own[0], state)
          ? 'close'
          : state?.instance?.state;
        const providerState = observedState === 'close' &&
          (handoff || generationRuntime?.pairingHandoffPending?.(body.instance))
          ? 'connecting'
          : observedState;
        if (!['open', 'close', 'connecting'].includes(providerState))
          throw new Error('WAP_CONTROL_UNKNOWN');
        // WAP-E12: the CRM contract has one routing proof; drifted settings
        // withhold it exactly like a drifted webhook (reconcile -> blocked).
        const webhookVerified =
          verifiedWebhook(webhook, config.webhook) &&
          verifiedSettings(settings);
        const jid = /^([1-9][0-9]{7,14})@s\.whatsapp\.net$/.exec(
          own[0].ownerJid || '',
        );
        return {
          outcome: 'reconciled',
          providerState,
          webhookVerified,
          bindingVerified:
            body.source !== null &&
            generationRuntime.bindingMatchesSocket(
              body.instance,
              body.source,
              body.generationToken,
            ),
          ...(providerState === 'open' && jid
            ? { confirmedNumber: `+${jid[1]}` }
            : {}),
        };
      } finally {
        inFlight.delete(body.instance);
      }
    },
  });
}

// The middleware runs before the upstream parsers and routes. Only this exact
// path is consumed. Native routes/authentication are otherwise untouched.
function createControlMiddleware(options = {}) {
  const env = options.env || process.env;
  const adapter = createControlAdapter(options);
  return async (req, res, next) => {
    if ((req.url || '').split('?')[0] !== PATH) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    try {
      if (
        !adapter.enabled ||
        req.url !== PATH ||
        req.method !== 'POST' ||
        !equal(req.headers?.apikey, env.AUTHENTICATION_API_KEY) ||
        req.headers?.['content-type']?.split(';')[0] !== 'application/json'
      )
        denied();
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 8192) denied();
        chunks.push(Buffer.from(chunk));
      }
      const result = await adapter.execute(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error?.message === 'WAP_CONTROL_DENIED' ? 403 : 503;
      res.end(
        res.statusCode === 403
          ? '{"code":"WAP_CONTROL_DENIED"}'
          : '{"code":"WAP_CONTROL_UNKNOWN"}',
      );
    }
  };
}

function protectExpress(express, options = {}) {
  if (typeof express !== 'function') denied();
  return new Proxy(express, {
    apply(target, receiver, args) {
      const app = Reflect.apply(target, receiver, args);
      app.use(createControlMiddleware(options));
      return app;
    },
  });
}

module.exports = {
  createControlAdapter,
  createControlMiddleware,
  protectExpress,
  configuration,
  PATH,
};

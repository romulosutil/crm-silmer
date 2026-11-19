'use strict';

// WAP-E01: source identity is attached once to the socket, before async queueing.
// No endpoint, disk store, workflow staticData or lookup of the current generation.
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');

const GENERATION_HEADER = 'X-Silmer-Wap-Generation-Token';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SOURCE_KEYS = ['accountId', 'bindingId', 'generation', 'lineId'];
const MESSAGE_EVENTS = new Set(['messages.upsert', 'messages.update']);
const EVENTS = new Set(['connection.update', ...MESSAGE_EVENTS]);
// Mirrors validateEvolutionEvent: SERVER_ACK is represented by the HTTP result.
const RECEIPTS = new Set(['ERROR', 'DELIVERY_ACK', 'READ', 'PLAYED']);
const UNUSED_CHAT = /@(?:g\.us|broadcast|newsletter)$/;

function reject(code) {
  throw new Error(code);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// WAP-E12: same top-level allowlist as the n8n ingress eventBody. The upstream
// apikey and any `extra` keys never leave the process. Chats the CRM never
// uses (groups, broadcast/status, newsletters) and receipts it ignores are
// refused here so their content does not transit n8n.
function messageEnvelope(context, original) {
  const data = original.data;
  const key = original.event === 'messages.update' ? data : data?.key;
  if (
    !plainObject(data) ||
    !plainObject(key) ||
    typeof original.date_time !== 'string' ||
    typeof original.sender !== 'string' ||
    !['destination', 'server_url'].every(
      (field) =>
        original[field] === undefined ||
        (typeof original[field] === 'string' && original[field].length <= 1024),
    ) ||
    key.participant ||
    key.participantAlt ||
    UNUSED_CHAT.test(String(key.remoteJid)) ||
    (original.event === 'messages.update' &&
      (key.fromMe !== true || !RECEIPTS.has(key.status)))
  )
    reject('WAP_GENERATION_ENVELOPE_DENIED');
  return {
    event: original.event,
    instance: context.instance,
    source: context.source,
    data,
    destination: original.destination,
    date_time: original.date_time,
    sender: original.sender,
    server_url: original.server_url,
  };
}

function immutableSource(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== SOURCE_KEYS.join(',') ||
    !['bindingId', 'lineId', 'accountId'].every(
      (key) => typeof value[key] === 'string' && ID.test(value[key]),
    ) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1
  )
    reject('WAP_GENERATION_SOURCE_INVALID');
  return Object.freeze({
    bindingId: value.bindingId,
    lineId: value.lineId,
    accountId: value.accountId,
    generation: value.generation,
  });
}

// Snapshot only: Baileys still needs the live code to finish the handshake.
// Session keys (including advSecretKey and Buffer/Uint8Array keys) are preserved.
function persistableCredentials(credentials) {
  if (
    !credentials ||
    typeof credentials !== 'object' ||
    Array.isArray(credentials)
  )
    reject('WAP_CREDENTIALS_SNAPSHOT_INVALID');
  const snapshot = { ...credentials };
  delete snapshot.pairingCode;
  return snapshot;
}

function createGenerationRuntime(options = {}) {
  const enabled = options.enabled ?? false;
  const instances = options.instances ?? [];
  if (
    typeof enabled !== 'boolean' ||
    !Array.isArray(instances) ||
    instances.some(
      (instance) => typeof instance !== 'string' || !ID.test(instance),
    ) ||
    new Set(instances).size !== instances.length ||
    (enabled && !instances.length)
  )
    reject('WAP_GENERATION_CONFIG_INVALID');
  const allowlist = new Set(instances);
  const local = new AsyncLocalStorage();
  const pending = new Map();
  const sockets = new WeakMap();
  const secrets = new WeakMap();
  const latest = new Map();
  const currentBindings = new Map();
  const capturedByInstance = new Map();
  const usedBindings = new Set();
  const usedTokenHashes = new Set();
  const selected = (instance) => allowlist.has(instance);
  const requireSelected = (instance) => {
    if (!enabled) reject('WAP_GENERATION_DISABLED');
    if (!selected(instance)) reject('WAP_GENERATION_INSTANCE_DENIED');
  };
  const requireContext = (context) => {
    if (!context || !secrets.has(context))
      reject('WAP_GENERATION_CONTEXT_INVALID');
  };

  return Object.freeze({
    // Load a retained unpaired instance as idle. Only the authorized challenge
    // can bind its next socket, and the binding does not survive a restart.
    deferUnpairedStartup(instance, state, owner) {
      return enabled && selected(instance) && state === 'connecting' && !owner;
    },
    // Trusted in-process control hook. E01 exercises it only from the rehearsal.
    // No HTTP route, mutation from provider payload, or implicit reconnect binding.
    bindNextSocket(instance, source, token) {
      requireSelected(instance);
      const snapshot = immutableSource(source);
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token))
        reject('WAP_GENERATION_TOKEN_INVALID');
      if (pending.has(instance)) reject('WAP_GENERATION_BINDING_PENDING');
      const previous = latest.get(instance);
      if (
        previous &&
        (snapshot.lineId !== previous.lineId ||
          snapshot.accountId !== previous.accountId ||
          snapshot.generation <= previous.generation)
      )
        reject('WAP_GENERATION_BINDING_STALE');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      if (
        usedBindings.has(snapshot.bindingId) ||
        usedTokenHashes.has(tokenHash)
      )
        reject('WAP_GENERATION_BINDING_REUSED');
      const context = Object.freeze({ instance, source: snapshot });
      secrets.set(context, token);
      pending.set(instance, context);
      latest.set(instance, snapshot);
      currentBindings.set(instance, context);
      usedBindings.add(snapshot.bindingId);
      usedTokenHashes.add(tokenHash);
    },
    // The control adapter may renew a challenge only after CRM reconciliation.
    // Reasserting the exact binding does not replace the captured socket source.
    ensureBinding(instance, source, token) {
      requireSelected(instance);
      const snapshot = immutableSource(source);
      const current = currentBindings.get(instance);
      if (
        current &&
        Object.keys(snapshot).every(
          (key) => current.source[key] === snapshot[key],
        )
      ) {
        if (
          typeof token !== 'string' ||
          createHash('sha256').update(token).digest('hex') !==
            createHash('sha256').update(secrets.get(current)).digest('hex')
        )
          reject('WAP_GENERATION_BINDING_REUSED');
        return Object.freeze({ duplicate: true });
      }
      this.bindNextSocket(instance, snapshot, token);
      return Object.freeze({ duplicate: false });
    },
    // Connection state alone cannot prove which socket generation is online.
    // A pending binding never passes; process restart intentionally loses proof.
    bindingMatchesSocket(instance, source, token) {
      requireSelected(instance);
      const snapshot = immutableSource(source);
      const captured = capturedByInstance.get(instance);
      return Boolean(
        captured &&
        typeof token === 'string' &&
        Object.keys(snapshot).every(
          (key) => captured.source[key] === snapshot[key],
        ) &&
        createHash('sha256').update(token).digest('hex') ===
          createHash('sha256').update(secrets.get(captured)).digest('hex'),
      );
    },
    captureSocket(instance, socket) {
      const existing =
        socket && typeof socket === 'object' ? sockets.get(socket) : null;
      if (existing && existing.instance !== instance)
        reject('WAP_GENERATION_SOCKET_MISMATCH');
      if (!selected(instance)) return null;
      requireSelected(instance);
      if (!socket || typeof socket !== 'object')
        reject('WAP_GENERATION_SOCKET_REQUIRED');
      if (existing) {
        return existing;
      }
      // A native reconnect has already allocated a different socket. Failure to
      // capture it must not leave the previous socket as proof of connection.
      // Existing callbacks still retain their immutable context in sockets/local.
      capturedByInstance.delete(instance);
      const context = pending.get(instance);
      if (!context) reject('WAP_GENERATION_BINDING_REQUIRED');
      pending.delete(instance);
      sockets.set(socket, context);
      capturedByInstance.set(instance, context);
      return context;
    },
    wrap(context, callback) {
      if (context === null) return callback;
      requireContext(context);
      if (typeof callback !== 'function')
        reject('WAP_GENERATION_CALLBACK_REQUIRED');
      return function sourceBoundCallback(...args) {
        return local.run(context, () => callback.apply(this, args));
      };
    },
    current(instance, event) {
      const context = local.getStore();
      if (!selected(instance)) {
        if (context) reject('WAP_GENERATION_INSTANCE_MISMATCH');
        return null;
      }
      requireSelected(instance);
      requireContext(context);
      if (context.instance !== instance)
        reject('WAP_GENERATION_INSTANCE_MISMATCH');
      // WAP-E12: lifecycle plus inbound/echo/receipt events. Default deny the rest.
      if (!EVENTS.has(event)) reject('WAP_GENERATION_EVENT_DENIED');
      return context;
    },
    headers(context, original) {
      if (context === null) return original;
      requireContext(context);
      const result = { ...original };
      for (const key of Object.keys(result))
        if (key.toLowerCase() === GENERATION_HEADER.toLowerCase())
          delete result[key];
      result[GENERATION_HEADER] = secrets.get(context);
      return result;
    },
    envelope(context, original) {
      if (context === null) return original;
      requireContext(context);
      if (
        original?.instance === context.instance &&
        MESSAGE_EVENTS.has(original?.event)
      )
        return messageEnvelope(context, original);
      if (
        original?.instance !== context.instance ||
        original?.event !== 'connection.update' ||
        !['connecting', 'close', 'open'].includes(original?.data?.state)
      )
        reject('WAP_GENERATION_ENVELOPE_DENIED');
      return {
        event: original.event,
        instance: context.instance,
        source: context.source,
        data: { state: original.data.state },
      };
    },
  });
}

function fromEnvironment(env) {
  if (
    env.SILMER_WAP_GENERATION_ENABLED !== undefined &&
    !['true', 'false'].includes(env.SILMER_WAP_GENERATION_ENABLED)
  )
    reject('WAP_GENERATION_CONFIG_INVALID');
  const raw = env.SILMER_WAP_GENERATION_INSTANCES ?? '';
  return createGenerationRuntime({
    enabled: env.SILMER_WAP_GENERATION_ENABLED === 'true',
    instances: raw === '' ? [] : raw.split(','),
  });
}

module.exports = {
  ...fromEnvironment(process.env),
  createGenerationRuntime,
  immutableSource,
  persistableCredentials,
  fromEnvironment,
  GENERATION_HEADER,
};

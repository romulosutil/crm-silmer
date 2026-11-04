// CP-T04 / CP-09, CP-11..18: human REST fixtures scoped to one synthetic run.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** @typedef {Record<string, any>} Json */

const FORBIDDEN_MANIFEST_KEY =
  /cookie|csrf|authorization|password|secret|token/i;

/** @param {unknown} value */
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/u.test(value))
    throw new Error('INVALID_SYNTHETIC_IDENTIFIER');
  return value;
}

/** @param {unknown} input */
function noCredentials(input) {
  if (!input || typeof input !== 'object') return;
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_MANIFEST_KEY.test(key))
      throw new Error('AUTH_FORBIDDEN_IN_MANIFEST');
    noCredentials(value);
  }
}

/** @param {Json} manifest */
export function validateSyntheticManifest(manifest) {
  noCredentials(manifest);
  const runId = identifier(manifest.run_id ?? manifest.runId);
  if (!Array.isArray(manifest.contacts) || manifest.contacts.length === 0)
    throw new Error('SYNTHETIC_CONTACTS_REQUIRED');
  const ids = new Set();
  const clientIds = new Set();
  const orderIds = new Set();
  const identities = new Set();
  const conversations = new Set();
  for (const contact of manifest.contacts) {
    identifier(contact.id_cliente);
    identifier(contact.contact_id);
    identifier(contact.conversation_id);
    if (
      typeof contact.wa_id !== 'string' ||
      !/^55000000[0-9]{5}$/u.test(contact.wa_id)
    )
      throw new Error('SYNTHETIC_IDENTITY_REQUIRED');
    if (
      ids.has(contact.contact_id) ||
      clientIds.has(contact.id_cliente) ||
      identities.has(contact.wa_id) ||
      conversations.has(contact.conversation_id)
    )
      throw new Error('DUPLICATE_SYNTHETIC_SCOPE');
    ids.add(contact.contact_id);
    clientIds.add(contact.id_cliente);
    identities.add(contact.wa_id);
    conversations.add(contact.conversation_id);
    if (!contact.orders || typeof contact.orders !== 'object')
      throw new Error('SYNTHETIC_ORDERS_REQUIRED');
    for (const [ref, order] of Object.entries(contact.orders)) {
      if (!['A', 'B'].includes(ref)) throw new Error('INVALID_ORDER_REFERENCE');
      const orderId = identifier(typeof order === 'string' ? order : order?.id);
      if (orderIds.has(orderId)) throw new Error('DUPLICATE_SYNTHETIC_ORDER');
      orderIds.add(orderId);
    }
  }
  return runId;
}

/** @param {'A'|'B'} ref */
export function sentinelItems(ref) {
  if (!['A', 'B'].includes(ref)) throw new Error('INVALID_ORDER_REFERENCE');
  return [
    {
      tipo: ref === 'A' ? 'CAMISETA' : 'POLO',
      cor: ref === 'A' ? 'AZUL' : 'VERDE',
      modelo: ref === 'A' ? 'TRADICIONAL' : 'POLO',
      gola: ref === 'A' ? 'REDONDA' : 'POLO',
      malhas: [ref === 'A' ? 'ALGODÃO' : 'PIQUET'],
      tipo_servico: 'SEM ESTAMPA',
      estampa: '',
      grade:
        ref === 'A'
          ? [
              { tamanho: 'M', quantidade: 9 },
              { tamanho: 'G', quantidade: 9 },
            ]
          : [{ tamanho: 'M', quantidade: 7 }],
    },
  ];
}

/** @param {Json} order */
function presentOrder(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    version: order.version,
    contactId: order.contactId,
    conversationId: order.conversationId,
    totalPieces: order.totalPieces,
    ficha: { items: order.ficha?.items ?? [] },
  };
}

/**
 * @param {{manifest: Json, auth: Json, origin?: string, allowSharedEnvironment?: boolean, fetchImpl?: typeof fetch, checkpoint?: (manifest: Json) => Promise<void>}} options
 */
export function createLongitudinalCrmClient({
  manifest,
  auth,
  origin = 'https://crm.silmer.com.br',
  allowSharedEnvironment = false,
  fetchImpl = globalThis.fetch,
  checkpoint = async () => {},
}) {
  const runId = validateSyntheticManifest(manifest);
  const base = new URL(origin);
  if (
    base.origin !== origin ||
    base.username ||
    base.password ||
    !['http:', 'https:'].includes(base.protocol) ||
    (base.protocol === 'http:' &&
      !['localhost', '127.0.0.1'].includes(base.hostname))
  )
    throw new Error('INVALID_CRM_ORIGIN');
  if (
    [
      'crm.silmer.com.br',
      'espectro-mvp-silmer-edge-web.jicnzg.easypanel.host',
    ].includes(base.hostname) &&
    !allowSharedEnvironment
  )
    throw new Error('SHARED_ENVIRONMENT_REQUIRES_EXPLICIT_OVERRIDE');
  const cookie = auth.cookie ?? auth.headers?.cookie ?? auth.headers?.Cookie;
  const csrf = auth.csrf ?? auth.csrfToken ?? auth.headers?.['x-csrf-token'];
  if (
    typeof cookie !== 'string' ||
    !cookie ||
    typeof csrf !== 'string' ||
    !csrf
  )
    throw new Error('HUMAN_SESSION_REQUIRED');

  /** @param {string} contactId */
  const scoped = (contactId) => {
    const contact = manifest.contacts.find(
      (/** @type {Json} */ item) => item.contact_id === contactId,
    );
    if (!contact) throw new Error('CONTACT_OUTSIDE_SYNTHETIC_MANIFEST');
    return contact;
  };
  /** @param {string} contactId @param {'A'|'B'} ref */
  const scopedOrder = (contactId, ref) => {
    if (!['A', 'B'].includes(ref)) throw new Error('INVALID_ORDER_REFERENCE');
    const contact = scoped(contactId);
    const entry = contact.orders[ref];
    if (!entry) throw new Error('ORDER_NOT_REGISTERED');
    return identifier(typeof entry === 'string' ? entry : entry.id);
  };
  /** @param {string} purpose */
  const key = (purpose) =>
    `ux-${createHash('sha256').update(`${runId}:${purpose}`).digest('hex')}`;
  /** @param {string} method @param {string} path @param {unknown} [body] @param {string} [purpose] @returns {Promise<Json>} */
  async function request(method, path, body, purpose = path) {
    const headers = {
      cookie,
      origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...(method === 'GET'
        ? {}
        : { 'x-csrf-token': csrf, 'idempotency-key': key(purpose) }),
    };
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error('CRM_REQUEST_UNAVAILABLE');
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('CRM_INVALID_RESPONSE');
    }
    if (!response.ok) {
      const code = payload?.error?.code ?? payload?.code;
      const safeCode =
        typeof code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(code)
          ? code
          : 'CRM_REQUEST_FAILED';
      throw Object.assign(new Error(safeCode), {
        code: safeCode,
        status: response.status,
      });
    }
    return payload;
  }

  /** @type {Map<string, Json>} */
  const verifiedScopes = new Map();
  /** The manifest is a candidate scope; live identity and cycle must prove it.
   * @param {string} contactId @returns {Promise<Json>}
   */
  async function verifyLiveScope(contactId) {
    const contact = scoped(contactId);
    const cacheKey = `${contactId}:${contact.conversation_id}:${contact.wa_id}`;
    const cached = verifiedScopes.get(cacheKey);
    if (cached) return cached;
    const data = await request('GET', `/api/v1/contacts/${contactId}`);
    if (data.contact?.id !== contactId)
      throw new Error('CONTACT_RESPONSE_MISMATCH');
    const identities = [
      ...(Array.isArray(data.identities) ? data.identities : []),
      ...(Array.isArray(data.contact.identities)
        ? data.contact.identities
        : []),
    ];
    if (
      !identities.some(
        (/** @type {Json} */ identity) =>
          identity.channel === 'whatsapp' &&
          typeof identity.externalId === 'string' &&
          identity.externalId.replace(/^\+/u, '') === contact.wa_id,
      )
    )
      throw new Error('SYNTHETIC_LIVE_IDENTITY_MISMATCH');
    if (
      !Array.isArray(data.conversations) ||
      !data.conversations.some(
        (/** @type {Json} */ conversation) =>
          conversation.id === contact.conversation_id,
      )
    )
      throw new Error('SYNTHETIC_LIVE_CONVERSATION_MISMATCH');
    verifiedScopes.set(cacheKey, data);
    return data;
  }

  /** Orders DTOs omit contactId. The subjects endpoint lists only eligible
   * orders for the live verified contact, and supplies the independent proof.
   * @param {string} contactId @param {string} orderId @param {Json} order
   */
  async function verifyOrderMembership(contactId, orderId, order) {
    const contact = scoped(contactId);
    await verifyLiveScope(contactId);
    if (!order || order.id !== orderId)
      throw new Error('ORDER_CONTACT_MISMATCH');
    if (Object.hasOwn(order, 'contactId')) {
      if (order.contactId !== contactId)
        throw new Error('ORDER_CONTACT_MISMATCH');
      return order;
    }
    const eligible = await request(
      'GET',
      `/api/v1/inbox/conversations/${contact.conversation_id}/subjects`,
    );
    const listed =
      (Array.isArray(eligible.orders) &&
        eligible.orders.some(
          (/** @type {Json} */ item) => item.id === orderId,
        )) ||
      (Array.isArray(eligible.subjects) &&
        eligible.subjects.some(
          (/** @type {Json} */ item) =>
            (item.orderId ?? item.order_id) === orderId,
        ));
    if (!listed) throw new Error('ORDER_MEMBERSHIP_UNPROVEN');
    // This field is derived from the membership proof, not trusted from input.
    return { ...order, contactId };
  }

  /** @param {string} contactId @param {'A'|'B'} ref */
  async function readOrder(contactId, ref) {
    const orderId = scopedOrder(contactId, ref);
    await verifyLiveScope(contactId);
    const { order } = await request('GET', `/api/v1/orders/${orderId}`);
    return verifyOrderMembership(contactId, orderId, order);
  }

  const client = {
    /** @param {string} contactId */
    async ensureSyntheticContactPhone(contactId) {
      const contact = scoped(contactId);
      const data = await verifyLiveScope(contactId);
      const expected = `55110000${contact.wa_id.slice(-5)}`;
      if (data.contact.phone) {
        if (data.contact.phone !== expected)
          throw new Error('UNEXPECTED_SYNTHETIC_PHONE');
        return { contact_id: contactId, updated: false };
      }
      if (!Number.isSafeInteger(data.contact.version))
        throw new Error('CONTACT_VERSION_REQUIRED');
      await request(
        'POST',
        `/api/v1/contacts/${contactId}/details`,
        { phone: expected, email: null, expectedVersion: data.contact.version },
        `contact-phone:${contactId}:${data.contact.version}`,
      );
      contact.synthetic_phone_ready = true;
      data.contact.phone = expected;
      await checkpoint(manifest);
      return { contact_id: contactId, updated: true };
    },
    /** @param {string} contactId @param {'A'|'B'} [ref] */
    async createManualOrder(contactId, ref = 'A') {
      const contact = scoped(contactId);
      if (!['A', 'B'].includes(ref)) throw new Error('INVALID_ORDER_REFERENCE');
      if (contact.orders[ref])
        return presentOrder(await readOrder(contactId, ref));
      await verifyLiveScope(contactId);
      const { order } = await request(
        'POST',
        '/api/v1/orders',
        { contactId },
        `create:${contactId}:${ref}`,
      );
      if (!order || order.status !== 'pendente' || order.origin === 'loja')
        throw new Error('INVALID_SYNTHETIC_ORDER_RESPONSE');
      identifier(order.id);
      const verified = await verifyOrderMembership(contactId, order.id, order);
      contact.orders[ref] = presentOrder(verified);
      await checkpoint(manifest);
      return presentOrder(verified);
    },
    /** Fill once. Never reset an order that the tested agent may have changed.
     * @param {string} contactId @param {'A'|'B'} ref
     */
    async fillSentinel(contactId, ref) {
      const contact = scoped(contactId);
      const current = await readOrder(contactId, ref);
      if (contact.orders[ref]?.fixture_prepared) return presentOrder(current);
      if (current.status !== 'pendente') throw new Error('ORDER_NOT_PENDING');
      if ((current.ficha?.items ?? []).length > 0)
        throw new Error('SENTINEL_ALREADY_HAS_ITEMS');
      const { order } = await request(
        'PATCH',
        `/api/v1/orders/${current.id}/sections/items`,
        { expectedVersion: current.version, value: sentinelItems(ref) },
        `fill:${contactId}:${ref}:${current.version}`,
      );
      const verified = await verifyOrderMembership(
        contactId,
        current.id,
        order,
      );
      contact.orders[ref] = {
        ...presentOrder(verified),
        fixture_prepared: true,
      };
      await checkpoint(manifest);
      return presentOrder(verified);
    },
    /** @param {string} contactId @param {{A?: string, B?: string, select?: boolean}} [options] */
    async linkOrdersToConversation(contactId, options = {}) {
      const contact = scoped(contactId);
      if (options.select === true)
        throw new Error('AUTOMATIC_SELECTION_FORBIDDEN');
      /** @type {Array<'A'|'B'>} */
      const refs = ['A', 'B'];
      for (const ref of refs) {
        if (options[ref] && options[ref] !== scopedOrder(contactId, ref))
          throw new Error('ORDER_OUTSIDE_SYNTHETIC_MANIFEST');
      }
      await verifyLiveScope(contactId);
      const registered = refs.filter((ref) => contact.orders[ref]);
      for (const ref of registered) await readOrder(contactId, ref);
      const list = await request(
        'GET',
        `/api/v1/inbox/conversations/${contact.conversation_id}/subjects`,
      );
      const linked = [];
      for (const ref of registered) {
        const orderId = scopedOrder(contactId, ref);
        if (
          (list.subjects ?? []).some(
            (/** @type {Json} */ item) =>
              (item.orderId ?? item.order_id) === orderId,
          )
        )
          continue;
        const subject = await request(
          'POST',
          `/api/v1/inbox/conversations/${contact.conversation_id}/subjects`,
          { orderId, select: false },
          `link:${contact.conversation_id}:${orderId}`,
        );
        linked.push({ ref, subject });
        await checkpoint(manifest);
      }
      return {
        contact_id: contactId,
        conversation_id: contact.conversation_id,
        linked,
      };
    },
    /** @param {string} contactId @param {number} expectedVersion */
    async closeSyntheticConversation(contactId, expectedVersion) {
      const contact = scoped(contactId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new Error('CONVERSATION_VERSION_REQUIRED');
      await verifyLiveScope(contactId);
      return request(
        'POST',
        `/api/v1/conversations/${contact.conversation_id}/close`,
        { expectedVersion, outcome: 'concluido', acknowledgePending: true },
        `close:${contact.conversation_id}:${expectedVersion}`,
      );
    },
    /** @param {string} contactId */
    async snapshotOrders(contactId) {
      const contact = scoped(contactId);
      await verifyLiveScope(contactId);
      /** @type {Json} */
      const orders = {};
      for (const ref of /** @type {Array<'A'|'B'>} */ (['A', 'B']))
        if (contact.orders[ref])
          orders[ref] = presentOrder(await readOrder(contactId, ref));
      const subjects = await request(
        'GET',
        `/api/v1/inbox/conversations/${contact.conversation_id}/subjects`,
      );
      return {
        contact_id: contactId,
        conversation_id: contact.conversation_id,
        orders,
        subjects,
      };
    },
    /** @param {string} contactId */
    async conversationVersion(contactId) {
      const contact = scoped(contactId);
      await verifyLiveScope(contactId);
      const data = await request(
        'GET',
        `/api/v1/inbox/conversations/${contact.conversation_id}`,
      );
      const conversation = data.conversation ?? data;
      if (
        conversation.id !== contact.conversation_id ||
        !Number.isSafeInteger(conversation.version)
      )
        throw new Error('CONVERSATION_RESPONSE_MISMATCH');
      return conversation.version;
    },
  };
  return client;
}

async function runCli() {
  const args = process.argv.slice(2);
  /** @type {Json} */
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--allow-shared-environment') {
      options.allowSharedEnvironment = true;
      index -= 1;
      continue;
    }
    if (!/^--[a-z]+$/u.test(args[index]) || args[index + 1] === undefined)
      throw new Error('INVALID_CLI_ARGUMENTS');
    options[args[index].slice(2)] = args[index + 1];
  }
  if (
    !options.manifest ||
    !options.auth ||
    !['prepare', 'snapshot', 'close', 'link'].includes(options.action)
  )
    throw new Error(
      'Usage: --manifest file --auth private-file --action prepare|snapshot|close|link [--origin URL] [--output file] [--clients ids] [--refs A,B]',
    );
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  const auth = JSON.parse(await readFile(options.auth, 'utf8'));
  const client = createLongitudinalCrmClient({
    manifest,
    auth,
    origin: options.origin,
    allowSharedEnvironment: options.allowSharedEnvironment === true,
    checkpoint: async (value) => {
      await writeFile(options.manifest, JSON.stringify(value, null, 2) + '\n');
    },
  });
  const requested = options.clients
    ? new Set(options.clients.split(','))
    : null;
  const contacts = manifest.contacts.filter(
    (/** @type {Json} */ value) =>
      !requested ||
      requested.has(value.contact_id) ||
      requested.has(value.id_cliente),
  );
  if (!contacts.length || (requested && contacts.length !== requested.size))
    throw new Error('REQUESTED_CONTACT_OUTSIDE_MANIFEST');
  const refs = String(options.refs ?? 'A,B').split(',');
  if (refs.some((ref) => !['A', 'B'].includes(ref)))
    throw new Error('INVALID_ORDER_REFERENCE');
  const results = [];
  for (const contact of contacts) {
    if (options.action === 'prepare') {
      await client.ensureSyntheticContactPhone(contact.contact_id);
      for (const ref of refs) {
        await client.createManualOrder(
          contact.contact_id,
          /** @type {'A'|'B'} */ (ref),
        );
        await client.fillSentinel(
          contact.contact_id,
          /** @type {'A'|'B'} */ (ref),
        );
      }
      await client.linkOrdersToConversation(contact.contact_id);
    } else if (options.action === 'link') {
      await client.linkOrdersToConversation(contact.contact_id);
    } else if (options.action === 'close') {
      await client.closeSyntheticConversation(
        contact.contact_id,
        await client.conversationVersion(contact.contact_id),
      );
    }
    results.push(await client.snapshotOrders(contact.contact_id));
  }
  if (options.output)
    await writeFile(
      options.output,
      JSON.stringify(
        {
          run_id: manifest.run_id ?? manifest.runId,
          action: options.action,
          contacts: results,
        },
        null,
        2,
      ) + '\n',
    );
  console.log(
    JSON.stringify({
      action: options.action,
      contacts: results.length,
      status: 'completed',
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  runCli().catch((error) => {
    const code =
      typeof error.message === 'string' &&
      /^[A-Z0-9_]{1,80}$/u.test(error.message)
        ? error.message
        : 'CRM_FIXTURE_FAILED';
    console.error(
      JSON.stringify({
        status: 'failed',
        code,
        http_status: error.status ?? null,
      }),
    );
    process.exitCode = 1;
  });
}

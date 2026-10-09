import {
  createStoreOrderService,
  PostgresOrderRepository,
  StoreOrderError,
} from '@crm-silmer/orders';

/** ADR 028: the one action of the n8n checkout workflow. */
export const STORE_ORDER_ACTION = 'store.order.record';

/**
 * @typedef {{
 *   actor: unknown, correlationId: string, idempotencyKey: string,
 * }} StoreTechnicalEnvelope
 * @typedef {{
 *   numero: string, numero_loja: string, pedido_id: string, criado: boolean,
 *   comprovante_registrado: boolean, pedido_url: string, ficha_url: string,
 * }} StoreOrderAnswer
 * @typedef {{
 *   phoneDigestsFor(query: string): string[],
 *   record(input: {body: unknown, technical: StoreTechnicalEnvelope}): Promise<{statusCode: 200|201, body: StoreOrderAnswer}>,
 * }} StoreOrderRuntime
 */

/**
 * ADR 028: the automation side of the site shop. The n8n checkout workflow
 * sends the paid order once InfinitePay confirms it; the answer names the
 * order and where the seller opens it and downloads its ficha. The URLs are
 * absolute under `APP_BASE_URL`, or relative without it.
 *
 * @param {{
 *   service: ReturnType<typeof createStoreOrderService>,
 *   appBaseUrl?: string,
 * }} options
 * @returns {StoreOrderRuntime}
 */
export function createStoreOrderRuntime({ appBaseUrl = '', service }) {
  return Object.freeze({
    phoneDigestsFor: service.phoneDigestsFor,

    /** LOJ-15..LOJ-20. */
    async record({ body, technical }) {
      const actorValue = /** @type {any} */ (technical.actor);
      const actor =
        typeof actorValue === 'string' ? actorValue : actorValue?.id;
      if (actor !== 'AUTOMATION_EXECUTOR') {
        throw new StoreOrderError(403, 'FORBIDDEN_AUTOMATION_ACTION');
      }
      const record = service.parse(body);
      // The retry key is the order itself: the same text as pedido_id.
      if (
        technical.idempotencyKey !==
        /** @type {{pedido_id: string}} */ (body).pedido_id
      ) {
        throw new StoreOrderError(400, 'INVALID_IDEMPOTENCY_KEY');
      }
      const { created, order } = await service.record({
        actor,
        correlationId: technical.correlationId,
        record,
      });
      const id = encodeURIComponent(order.id);
      return {
        body: {
          comprovante_registrado: Boolean(order.ficha.loja?.comprovanteUrl),
          criado: created,
          ficha_url: `${appBaseUrl}/api/v1/orders/${id}/print?download=1`,
          numero: order.number,
          numero_loja: /** @type {string} */ (order.storeNumber),
          pedido_id: order.id,
          pedido_url: `${appBaseUrl}/pedidos/${id}`,
        },
        statusCode: created ? 201 : 200,
      };
    },
  });
}

/**
 * PostgreSQL wiring. The route stays off (404) until `STORE_ORDERS_HMAC_KEY`
 * is set; with it, a missing FAB_CODE or a malformed value stops the API at
 * startup instead of opening the route half configured.
 *
 * @param {{database?: any, environment: Record<string, string|undefined>}} input
 * @returns {StoreOrderRuntime|undefined}
 */
export function createStoreOrdersForServer({ database, environment }) {
  if (!environment.STORE_ORDERS_HMAC_KEY) return undefined;
  if (!database) return undefined;
  const fabCode = environment.FAB_CODE?.trim();
  if (!fabCode) throw new Error('The site shop needs FAB_CODE');
  return createStoreOrderRuntime({
    appBaseUrl: readBaseUrl(environment.APP_BASE_URL),
    service: createStoreOrderService({
      acceptTest: readBoolean(
        environment.STORE_ORDERS_ACCEPT_TEST,
        'STORE_ORDERS_ACCEPT_TEST',
      ),
      fabCode,
      hmacKey: readKey(
        environment.STORE_ORDERS_HMAC_KEY,
        'STORE_ORDERS_HMAC_KEY',
      ),
      repository: new PostgresOrderRepository({
        database,
        envelopeKey: readKey(
          environment.N8N_INTEGRATION_ENVELOPE_KEY,
          'N8N_INTEGRATION_ENVELOPE_KEY',
        ),
      }),
    }),
  });
}

/**
 * `APP_BASE_URL` is where people open the CRM: https (http only on the
 * local machine), no credentials, query or fragment; a trailing slash is
 * dropped. Empty means relative URLs.
 *
 * @param {string|undefined} value
 */
export function readBaseUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return '';
  /** @type {URL} */
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('APP_BASE_URL must be an absolute https URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('APP_BASE_URL must be an absolute https URL');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, '');
}

/** @param {string|undefined} value @param {string} name */
function readBoolean(value, name) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false`);
}

/** @param {string|undefined} value @param {string} name */
function readKey(value, name) {
  const encoded = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(encoded)) {
    throw new Error(`${name} must use base64 or base64url`);
  }
  const key = Buffer.from(
    encoded,
    encoded.includes('-') || encoded.includes('_') ? 'base64url' : 'base64',
  );
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

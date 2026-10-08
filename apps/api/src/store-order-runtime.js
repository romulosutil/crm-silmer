import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import {
  createIdempotentCommandExecutor,
  fingerprintCommand,
  IdempotencyConflictError,
  PostgresIdempotencyRecordStore,
} from '@crm-silmer/integration-reliability';
import {
  createStoreOrderService,
  PostgresOrderRepository,
  STORE_ACTOR_ID,
  StoreOrderError,
} from '@crm-silmer/orders';

export const STORE_ORDER_ACTION = 'store.order.create';
export const DEFAULT_STORE_REQUESTS_PER_MINUTE = 30;

// An allowed origin is a scheme, a host and an optional port; one `*` stands
// for a run of letters, digits and hyphens inside the host, as in a Vercel
// preview (`https://silmer-*-romulodesigns.vercel.app`). The domain after the
// wildcard is fixed, so `https://*` alone is refused.
const ORIGIN_ENTRY = /^https?:\/\/[a-z0-9*.-]+(?::\d{1,5})?$/u;
const WILDCARD_RUN = /^[a-z0-9-]+$/u;

/**
 * @typedef {{
 *   allowsOrigin(origin: unknown): boolean,
 *   requestsPerMinute: number,
 *   phoneDigestsFor(query: string): string[],
 *   receive(input: {
 *     body: unknown, idempotencyKey: unknown, origin: string,
 *     clientIp: string, correlationId: string,
 *   }): Promise<{created: boolean, numero: string}>,
 * }} StoreOrderRuntime
 */

/**
 * ADR 027: compiles `STORE_ORDERS_ALLOWED_ORIGINS` (comma separated) into a
 * matcher. Every entry is checked at startup, so a typo stops the API
 * instead of opening or closing the route by surprise. Nothing from the
 * configuration becomes a regular expression: an entry matches the whole
 * origin, or its fixed prefix and suffix around the one wildcard.
 *
 * @param {string} list
 * @returns {(origin: unknown) => boolean}
 */
export function compileAllowedOrigins(list) {
  const entries = list
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error('STORE_ORDERS_ALLOWED_ORIGINS needs at least one origin');
  }
  /** @type {Array<(origin: string) => boolean>} */
  const matchers = entries.map((entry) => {
    if (!ORIGIN_ENTRY.test(entry)) {
      throw new Error('STORE_ORDERS_ALLOWED_ORIGINS has an invalid origin');
    }
    const star = entry.indexOf('*');
    if (star === -1) return (origin) => origin === entry;
    const prefix = entry.slice(0, star);
    const suffix = entry.slice(star + 1);
    if (
      !prefix.startsWith('https://') ||
      suffix.includes('*') ||
      !suffix.includes('.')
    ) {
      throw new Error(
        'a wildcard origin uses https, one wildcard and a fixed domain after it',
      );
    }
    return (origin) =>
      origin.length > prefix.length + suffix.length &&
      origin.startsWith(prefix) &&
      origin.endsWith(suffix) &&
      WILDCARD_RUN.test(origin.slice(prefix.length, -suffix.length));
  });
  return (origin) =>
    typeof origin === 'string' &&
    origin.length <= 255 &&
    matchers.some((matches) => matches(origin));
}

/**
 * The public side of the site shop: one notice in, one order number out.
 * The notice runs under its Idempotency-Key in the shared idempotency record
 * (scope `system:loja-do-site:store.order.create`); the order, its receipt
 * and the audit event commit in that record's transaction, so a retry with
 * the same body replays the number and another body is a conflict, before
 * any limit is counted.
 *
 * @param {{
 *   service: ReturnType<typeof createStoreOrderService>,
 *   auditTrail: any,
 *   idempotencyStore: {execute: (identity: any, operation: (transaction?: unknown) => Promise<unknown>) => Promise<unknown>},
 *   allowedOrigins: string,
 *   requestsPerMinute?: number,
 * }} options
 * @returns {StoreOrderRuntime}
 */
export function createStoreOrderRuntime(options) {
  const { service } = options;
  const allowsOrigin = compileAllowedOrigins(options.allowedOrigins);
  const requestsPerMinute =
    options.requestsPerMinute ?? DEFAULT_STORE_REQUESTS_PER_MINUTE;
  if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1) {
    throw new TypeError('requestsPerMinute must be a positive integer');
  }
  const execute = createIdempotentCommandExecutor({
    auditTrail: options.auditTrail,
    idempotencyStore: options.idempotencyStore,
  });

  return Object.freeze({
    allowsOrigin,
    phoneDigestsFor: service.phoneDigestsFor,
    requestsPerMinute,

    /**
     * LOJ-01..LOJ-05, LOJ-12, LOJ-13.
     *
     * @param {{body: unknown, idempotencyKey: unknown, origin: string, clientIp: string, correlationId: string}} input
     */
    async receive(input) {
      const request = service.parse(input.body);
      if (input.idempotencyKey !== request.requestId) {
        throw new StoreOrderError(400, 'chave_invalida');
      }
      let created = false;
      try {
        const response = /** @type {{numero: string}} */ (
          await execute(
            {
              action: STORE_ORDER_ACTION,
              actor: STORE_ACTOR_ID,
              command: input.body,
              correlationId: input.correlationId,
              key: request.requestId,
              reason: STORE_ORDER_ACTION,
              target: { id: request.requestId, type: 'store_order' },
              version: '1',
            },
            async (transaction) => {
              const order = await service.create({
                bodySha256: fingerprintCommand(input.body),
                clientIp: input.clientIp,
                correlationId: input.correlationId,
                origin: input.origin,
                request,
                transaction: transaction ?? null,
              });
              created = true;
              return { numero: order.number };
            },
          )
        );
        return { created, numero: response.numero };
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          throw new StoreOrderError(409, 'idempotency_conflict');
        }
        throw error;
      }
    },
  });
}

/**
 * PostgreSQL wiring. The route stays off until `STORE_ORDERS_HMAC_KEY` and
 * `STORE_ORDERS_ALLOWED_ORIGINS` are both set; one without the other, or a
 * malformed value, stops the API at startup.
 *
 * @param {{database?: any, environment: Record<string, string|undefined>}} input
 * @returns {StoreOrderRuntime|undefined}
 */
export function createStoreOrdersForServer({ database, environment }) {
  const names = ['STORE_ORDERS_HMAC_KEY', 'STORE_ORDERS_ALLOWED_ORIGINS'];
  if (names.every((name) => !environment[name])) return undefined;
  if (!names.every((name) => environment[name])) {
    throw new Error(
      'The site shop needs STORE_ORDERS_HMAC_KEY and STORE_ORDERS_ALLOWED_ORIGINS together',
    );
  }
  if (!database) return undefined;
  const fabCode = environment.FAB_CODE?.trim();
  if (!fabCode) throw new Error('The site shop needs FAB_CODE');
  return createStoreOrderRuntime({
    allowedOrigins: /** @type {string} */ (
      environment.STORE_ORDERS_ALLOWED_ORIGINS
    ),
    auditTrail: new PostgresAuditTrail(database),
    idempotencyStore: new PostgresIdempotencyRecordStore({
      database,
      envelopeKey: readKey(
        environment.IDEMPOTENCY_ENVELOPE_KEY,
        'IDEMPOTENCY_ENVELOPE_KEY',
      ),
    }),
    requestsPerMinute: readPositive(
      environment.STORE_ORDERS_MAX_REQUESTS_PER_MINUTE,
      DEFAULT_STORE_REQUESTS_PER_MINUTE,
      'STORE_ORDERS_MAX_REQUESTS_PER_MINUTE',
    ),
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
      limits: {
        perIpPerHour: readPositive(
          environment.STORE_ORDERS_MAX_PER_IP_HOUR,
          5,
          'STORE_ORDERS_MAX_PER_IP_HOUR',
        ),
        perPhonePerDay: readPositive(
          environment.STORE_ORDERS_MAX_PER_PHONE_DAY,
          5,
          'STORE_ORDERS_MAX_PER_PHONE_DAY',
        ),
      },
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

/** @param {string|undefined} value @param {string} name */
function readBoolean(value, name) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false`);
}

/** @param {string|undefined} value @param {number} fallback @param {string} name */
function readPositive(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d{0,5}$/u.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
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

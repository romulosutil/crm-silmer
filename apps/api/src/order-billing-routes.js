import { createHash } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { authorizeRequest } from './n8n-routes.js';

const PUBLIC_CODES = new Set([
  'FORBIDDEN',
  'CSRF_INVALID',
  'INVALID_CREDENTIALS',
  'INVALID_AUTOMATION_CREDENTIALS',
  'FORBIDDEN_AUTOMATION_ACTION',
  'AUTOMATION_AUTH_UNAVAILABLE',
  'INVALID_REQUEST',
  'INVALID_IDEMPOTENCY_KEY',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_CONFLICT',
  'VERSION_CONFLICT',
  'ORDER_NOT_FOUND',
  'ORDER_NOT_CONFIRMED',
  'ORDER_LOCKED',
  'ORDER_CANCELLED',
  'BILLING_DISABLED',
  'BILLING_NOT_FOUND',
  'BILLING_CONFLICT',
  'BILLING_INVALID_PERCENT',
  'BILLING_MINIMUM_AMOUNT',
  'BILLING_ALREADY_PAID',
  'BILLING_LEGACY_PAYMENT',
  'BILLING_CHARGE_ACTIVE',
  'BILLING_REVIEW_REQUIRED',
  'BILLING_INVALID_URL',
  'BILLING_INVALID_PAYMENT',
  'BILLING_TRANSACTION_CONFLICT',
  'BILLING_CHARGE_EXPIRED',
  'BILLING_EXECUTION_CONFLICT',
  'BILLING_REFUND_INVALID',
  'BILLING_PROVIDER_REVIEW_REQUIRED',
  'BILLING_INVALID_AMOUNT',
  'BILLING_ACTIVE_CHARGE',
  'BILLING_CHARGE_NOT_FOUND',
  'BILLING_CHECKOUT_CONFLICT',
  'BILLING_CONDITION_LOCKED',
  'BILLING_INVALID_REFUND',
  'BILLING_LINK_STILL_VALID',
  'BILLING_NOT_MANAGED',
  'BILLING_ORDER_NOT_CONFIRMED',
  'BILLING_OVERPAID',
  'BILLING_PAYMENT_MISMATCH',
  'BILLING_RECEIPT_CONFLICT',
  'BILLING_REVIEW_CONFIRMATION_REQUIRED',
  'BILLING_STORE_ORDER',
  'INVALID_EXPECTED_VERSION',
  'RATE_LIMITED',
  'REQUEST_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'BILLING_INVALID_EXTERNAL_RECEIPT',
  'BILLING_REVERSAL_REASON_REQUIRED',
  'BILLING_RECEIPT_NOT_FOUND',
  'BILLING_RECEIPT_REVERSED',
  'BILLING_PAYMENT_NOT_RECORDED',
  'BILLING_CHECK_DISABLED',
  'BILLING_LINK_NOT_OPEN',
  'BILLING_LINK_AMOUNT_INVALID',
  'BILLING_LINK_EXCEEDS_FREE',
  'BILLING_RECEIPT_EXCEEDS_FREE',
  'BILLING_LINK_IN_PAYMENT',
  'BILLING_LINK_UNKNOWN',
  'BILLING_USE_PAYMENT_LINK',
]);

/** @param {string} code @param {number} [statusCode] */
function invalid(code = 'INVALID_REQUEST', statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

/** @param {unknown} value */
function identifier(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 255 ||
    value.trim() !== value ||
    /[^\x21-\x7e]/u.test(value)
  )
    throw invalid();
  return value;
}

/** @param {unknown} value @param {readonly string[]} keys @param {readonly string[]} [optional] */
function body(value, keys, optional = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !keys.includes(key) && !optional.includes(key),
    ) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw invalid();
  return /** @type {Record<string, any>} */ (value);
}

// LPC-02: the public page reads only these fields; nothing else leaves.
const PUBLIC_LINK_FIELDS = [
  'state',
  'orderNumber',
  'kind',
  'amountCents',
  'checkoutUrl',
  'paidAt',
];
/** @param {any} value */
function publicLinkBody(value) {
  return Object.fromEntries(
    PUBLIC_LINK_FIELDS.filter(
      (key) => value?.[key] !== undefined && value?.[key] !== null,
    ).map((key) => [key, value[key]]),
  );
}

/** Fixed window per token digest; the token itself is never kept.
 * @param {number} max @param {number} windowMs */
export function paymentLinkTokenLimiter(max, windowMs) {
  /** @type {Map<string,{count:number,resetAt:number}>} */
  const windows = new Map();
  /** @param {unknown} token */
  return (token) => {
    const now = Date.now();
    if (windows.size > 10000)
      for (const [entryKey, entry] of windows)
        if (entry.resetAt <= now) windows.delete(entryKey);
    const digest = createHash('sha256')
      .update(String(token ?? '').toUpperCase())
      .digest('base64url');
    const entry = windows.get(digest);
    if (!entry || entry.resetAt <= now) {
      windows.set(digest, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

/** @param {any} reply @param {unknown} error */
function problem(reply, error) {
  const candidate = /** @type {any} */ (error);
  const supplied = candidate?.code;
  const code = PUBLIC_CODES.has(supplied)
    ? supplied
    : supplied?.startsWith('INVALID_X_') ||
        supplied === 'INVALID_CORRELATION_ID'
      ? 'INVALID_REQUEST'
      : Number(candidate?.statusCode) >= 400 &&
          Number(candidate?.statusCode) < 500
        ? 'INVALID_REQUEST'
        : 'SERVICE_UNAVAILABLE';
  const status =
    code === 'SERVICE_UNAVAILABLE'
      ? 503
      : Number(candidate?.statusCode) >= 400 &&
          Number(candidate?.statusCode) < 600
        ? Number(candidate.statusCode)
        : 400;
  // LPC-03/04: who won a cancel/click race; state and instant only.
  const details =
    ['BILLING_LINK_NOT_OPEN', 'BILLING_CONFLICT'].includes(code) &&
    candidate?.details
      ? {
          state: candidate.details.state ?? null,
          clickedAt: candidate.details.clickedAt ?? null,
        }
      : {};
  return reply
    .code(status)
    .type('application/problem+json')
    .send({ type: 'about:blank', title: code, status, code, ...details });
}

/** @param {any} reply @param {()=>Promise<unknown>} operation */
async function respond(reply, operation) {
  reply.header('cache-control', 'private, no-store');
  reply.header('vary', 'Cookie, Origin');
  reply.header('referrer-policy', 'no-referrer');
  try {
    return reply.send(await operation());
  } catch (error) {
    return problem(reply, error);
  }
}

/** @param {any} request @param {any} billing @param {boolean} write */
async function human(request, billing, write) {
  if (request.headers.authorization !== undefined)
    throw invalid('FORBIDDEN', 403);
  return (write ? billing.authorizeWrite : billing.authorizeRead)({
    action: write ? 'billing.manage' : 'billing.read',
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    csrfToken: request.headers['x-csrf-token'],
    secFetchSite: request.headers['sec-fetch-site'],
  });
}

/**
 * COB-01/04/13: human session and narrow technical capabilities are separate.
 * The runtime revalidates live ownership and versions inside its transaction.
 * @param {import('fastify').FastifyInstance} api
 * @param {any} billing
 * @param {(request:any)=>{correlationId:string,requestId:string}} contextFor
 */
export function registerOrderBillingRoutes(api, billing, contextFor) {
  api.register(async (scope) => {
    await scope.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => invalid('RATE_LIMITED', 429),
    });
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('referrer-policy', 'no-referrer');
    });
    scope.setErrorHandler((error, _request, reply) => {
      const status = Number(/** @type {any} */ (error).statusCode);
      return problem(
        reply,
        status === 413
          ? invalid('REQUEST_TOO_LARGE', 413)
          : status === 415
            ? invalid('UNSUPPORTED_MEDIA_TYPE', 415)
            : error,
      );
    });
    const options = {
      bodyLimit: 8192,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    };
    const prefix = '/api/v1/orders/:orderId/billing';
    scope.get(prefix, options, (request, reply) =>
      respond(reply, async () => {
        body(request.query ?? {}, []);
        const { actor } = await human(request, billing, false);
        return billing.get({
          actor,
          orderId: identifier(/** @type {any} */ (request.params).orderId),
        });
      }),
    );
    /** @type {Array<[string,string,string[],string[]]>} */
    const commands = [
      ['/plan', 'configure', ['percent'], []],
      ['/charges', 'issue', ['percent'], []],
      ['/charges/:chargeId/refund', 'refund', ['amountCents'], []],
      ['/reconcile', 'reconcile', ['decision', 'confirmedProviderReview'], []],
      [
        '/external-receipts',
        'recordExternal',
        ['amountCents', 'receivedOn', 'method', 'note'],
        ['cancelLinkIds'],
      ],
      [
        '/external-receipts/:receiptId/reverse',
        'reverseExternal',
        ['reason'],
        [],
      ],
      [
        '/charges/:chargeId/check-payment',
        'checkPayment',
        ['invoiceSlug', 'transactionNsu'],
        [],
      ],
      // LPC: CRM payment links (RFC 074 / ADR 098).
      ['/links', 'createLink', ['amountCents'], ['percent']],
      ['/links/:linkId/cancel', 'cancelLink', [], []],
      [
        '/links/:linkId/confirm-result',
        'confirmLinkResult',
        [],
        ['invoiceSlug', 'transactionNsu'],
      ],
    ];
    for (const [suffix, method, extra, optional] of commands) {
      scope.post(`${prefix}${suffix}`, options, (request, reply) =>
        respond(reply, async () => {
          const { actor } = await human(request, billing, true);
          const command = body(
            request.body,
            ['expectedVersion', 'expectedBillingVersion', ...extra],
            optional,
          );
          const params = /** @type {any} */ (request.params);
          const idempotencyKey = identifier(request.headers['idempotency-key']);
          // LPC-01 (ADR 098): a provider checkout is created only by the
          // client's click on a CRM link; no human route creates one.
          if (method === 'issue')
            throw invalid('BILLING_USE_PAYMENT_LINK', 409);
          if (method === 'checkPayment') reply.code(202);
          if (method === 'createLink') reply.code(201);
          return billing[method]({
            ...command,
            actor,
            orderId: identifier(params.orderId),
            ...(params.chargeId
              ? { chargeId: identifier(params.chargeId) }
              : {}),
            ...(params.receiptId
              ? { receiptId: identifier(params.receiptId) }
              : {}),
            ...(params.linkId ? { linkId: identifier(params.linkId) } : {}),
            idempotencyKey,
            correlationId: contextFor(request).correlationId,
          });
        }),
      );
    }
    const technicalPrefix =
      '/api/v1/integrations/n8n/billing/charges/:chargeId';
    for (const [suffix, operation, action, keys] of /** @type {const} */ ([
      ['', 'paymentCheckLookup', 'billing.checkout.read', []],
      ['/result', 'paymentCheckResult', 'billing.payment.record', ['status']],
    ])) {
      const path =
        '/api/v1/integrations/n8n/billing/payment-checks/:checkId' + suffix;
      const handler = (/** @type {any} */ request, /** @type {any} */ reply) =>
        respond(reply, async () => {
          const technical = await authorizeRequest(request, contextFor, action);
          if (technical.workflowKey !== 'silmer-order-billing')
            throw invalid('FORBIDDEN_AUTOMATION_ACTION', 403);
          const data = body(suffix ? request.body : (request.query ?? {}), [
            ...keys,
          ]);
          return billing[operation]({
            ...data,
            checkId: identifier(request.params.checkId),
            executionId: technical.executionId,
            correlationId: technical.correlationId,
          });
        });
      if (suffix) scope.post(path, options, handler);
      else scope.get(path, options, handler);
    }
    for (const [operation, action, keys] of /** @type {const} */ ([
      ['reserve', 'billing.checkout.reserve', []],
      ['created', 'billing.checkout.record', ['checkoutUrl']],
      [
        'payment',
        'billing.payment.record',
        [
          'transactionNsu',
          'invoiceSlug',
          'amountCents',
          'paidAmountCents',
          'method',
          'installments',
          'receiptUrl',
        ],
      ],
      ['lookup', 'billing.checkout.read', []],
    ])) {
      const handler = (/** @type {any} */ request, /** @type {any} */ reply) =>
        respond(reply, async () => {
          const technical = await authorizeRequest(request, contextFor, action);
          if (technical.workflowKey !== 'silmer-order-billing')
            throw invalid('FORBIDDEN_AUTOMATION_ACTION', 403);
          const data = body(
            operation === 'lookup' ? (request.query ?? {}) : request.body,
            [...keys],
          );
          return billing[operation]({
            ...data,
            chargeId: identifier(request.params.chargeId),
            executionId: technical.executionId,
            correlationId: technical.correlationId,
          });
        });
      if (operation === 'lookup')
        scope.get(`${technicalPrefix}/${operation}`, options, handler);
      else scope.post(`${technicalPrefix}/${operation}`, options, handler);
    }
  });
  if (typeof billing.publicLink === 'function') registerPublic(api, billing);
}

/** LPC-01/02: the client's page `/pagar/{token}`. No session, cookie or CSRF:
 * the token is the only capability. Uniform `unavailable`, no PII, no-store,
 * noindex, no-referrer, per-IP and per-token limits, Origin on the click.
 * The token stays out of logs: the API logger never records URLs or params.
 * @param {import('fastify').FastifyInstance} api @param {any} billing */
function registerPublic(api, billing) {
  api.register(async (scope) => {
    await scope.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => invalid('RATE_LIMITED', 429),
    });
    // The page polls every 2.5 s with backoff: reads and clicks are limited
    // apart, per token digest and per IP (CGNAT-tolerant reads).
    const readsPerToken = paymentLinkTokenLimiter(60, 60000);
    const clicksPerToken = paymentLinkTokenLimiter(10, 60000);
    const origins = new Set(billing.publicOrigins ?? []);
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      reply.header('referrer-policy', 'no-referrer');
      reply.header('x-robots-tag', 'noindex, nofollow');
      reply.header('x-content-type-options', 'nosniff');
    });
    scope.setErrorHandler((error, _request, reply) => {
      const status = Number(/** @type {any} */ (error).statusCode);
      return problem(
        reply,
        status === 413
          ? invalid('REQUEST_TOO_LARGE', 413)
          : status === 415
            ? invalid('UNSUPPORTED_MEDIA_TYPE', 415)
            : error,
      );
    });
    const path = '/api/v1/payment-links/:token';
    scope.get(
      path,
      {
        bodyLimit: 1024,
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      },
      async (request, reply) => {
        try {
          if (Object.keys(request.query ?? {}).length) throw invalid();
          const { token } = /** @type {any} */ (request.params);
          if (!readsPerToken(token)) throw invalid('RATE_LIMITED', 429);
          return reply.send(
            publicLinkBody(await billing.publicLink({ token })),
          );
        } catch (error) {
          return problem(reply, error);
        }
      },
    );
    scope.post(
      `${path}/checkout`,
      {
        bodyLimit: 1024,
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      },
      async (request, reply) => {
        try {
          const origin = request.headers.origin;
          if (typeof origin !== 'string' || !origins.has(origin))
            throw invalid('FORBIDDEN', 403);
          if (Object.keys(request.query ?? {}).length) throw invalid();
          if (request.body !== undefined && request.body !== null)
            body(request.body, []);
          const { token } = /** @type {any} */ (request.params);
          if (!clicksPerToken(token)) throw invalid('RATE_LIMITED', 429);
          const result = await billing.publicCheckout({ token });
          return reply
            .code(result.statusCode)
            .send(publicLinkBody(result.body));
        } catch (error) {
          return problem(reply, error);
        }
      },
    );
  });
}

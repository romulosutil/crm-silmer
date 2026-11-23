/**
 * RFC 074 (LPC-02/LPC-09): the customer's payment page `/pagar/:token`.
 *
 * Pure rules for the public page: which state the API returned, what the
 * customer reads in each one and which InfinitePay address the page may send
 * the customer to. The view owns the DOM, timers and navigation.
 */

/** @typedef {'ready'|'in_progress'|'paid'|'failed'|'unavailable'} PublicPaymentState */
/**
 * @typedef {object} PublicPaymentLink
 * @property {PublicPaymentState} state
 * @property {string} [orderNumber]
 * @property {string} [kind]
 * @property {number} [amountCents]
 * @property {string} [checkoutUrl] Only a validated InfinitePay https address.
 * @property {string} [paidAt]
 * @property {boolean} [timedOut] The page stopped waiting for the address.
 */

export const PUBLIC_PAYMENT_STATES = Object.freeze([
  'ready',
  'in_progress',
  'paid',
  'failed',
  'unavailable',
]);

/** Name of the charge line, as the seller and the customer read it. */
export const PUBLIC_PAYMENT_KINDS = Object.freeze({
  signal: 'Sinal',
  balance: 'Saldo',
  full: 'Pagamento integral',
  installment: 'Parcela',
});

// Waiting for the InfinitePay address (LPC-02): every 2.5 s, then every 5 s
// after 20 s, for about a minute. That is ~16 readings, well inside the API's
// per-token limit (GET 60/min); a 429 waits Retry-After (or 10 s) and resumes.
export const CHECKOUT_POLL_INTERVAL_MS = 2500;
export const CHECKOUT_POLL_SLOW_INTERVAL_MS = 5000;
export const CHECKOUT_POLL_SLOW_AFTER_MS = 20_000;
export const CHECKOUT_POLL_TIMEOUT_MS = 60_000;
export const RATE_LIMIT_WAIT_MS = 10_000;
const RETRY_AFTER_MAX_MS = 120_000;
export const OPENING_LABEL = 'Abrindo a InfinitePay…';

/** Hosts the page may redirect to: the provider's own domains, https only. */
const CHECKOUT_HOSTS = Object.freeze(['infinitepay.io', 'infinitepay.com.br']);

// The API issues 26 Crockford base32 characters; anything far from that is
// answered locally with the uniform "unavailable" state, without a request.
const TOKEN_PATTERN = /^[0-9A-Za-z]{16,64}$/u;

const MONEY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const PAID_AT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Sao_Paulo',
});

/** @param {unknown} token */
export function isPublicPaymentToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** @param {string} token */
export function paymentLinkPath(token) {
  return `/api/v1/payment-links/${encodeURIComponent(token)}`;
}

/** @param {string} token */
export function paymentCheckoutPath(token) {
  return `${paymentLinkPath(token)}/checkout`;
}

/**
 * The only addresses the page follows: https on an InfinitePay domain, with no
 * credentials or custom port. Anything else is refused, never followed.
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeCheckoutUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return null;
  const host = url.hostname.toLowerCase();
  const allowed = CHECKOUT_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  return allowed ? url.href : null;
}

/**
 * Normalize the public API body. `unavailable` carries nothing else, so a
 * missing and a cancelled link read the same. An InfinitePay address that is
 * not safe turns the link into `failed`: the page never follows it.
 * @param {unknown} body
 * @returns {PublicPaymentLink}
 */
export function normalizePaymentLink(body) {
  const value =
    body && typeof body === 'object'
      ? /** @type {Record<string, unknown>} */ (body)
      : {};
  const state = PUBLIC_PAYMENT_STATES.includes(String(value.state))
    ? /** @type {PublicPaymentState} */ (String(value.state))
    : 'failed';
  if (state === 'unavailable') return { state };
  /** @type {PublicPaymentLink} */
  const link = { state };
  if (typeof value.orderNumber === 'string' && value.orderNumber.trim())
    link.orderNumber = value.orderNumber.trim();
  if (typeof value.kind === 'string' && value.kind in PUBLIC_PAYMENT_KINDS)
    link.kind = value.kind;
  if (Number.isSafeInteger(value.amountCents) && Number(value.amountCents) > 0)
    link.amountCents = Number(value.amountCents);
  if (state === 'paid' && typeof value.paidAt === 'string')
    link.paidAt = value.paidAt;
  if (
    state === 'in_progress' &&
    value.checkoutUrl !== undefined &&
    value.checkoutUrl !== null
  ) {
    const checkoutUrl = safeCheckoutUrl(value.checkoutUrl);
    if (!checkoutUrl) return { ...link, state: 'failed' };
    link.checkoutUrl = checkoutUrl;
  }
  return link;
}

/**
 * The checkout answer may omit the order fields; keep what the page already
 * shows. `unavailable` always wins and clears everything.
 * @param {PublicPaymentLink|null} current
 * @param {PublicPaymentLink} next
 * @returns {PublicPaymentLink}
 */
export function mergePaymentLink(current, next) {
  if (next.state === 'unavailable' || !current) return next;
  return {
    ...(current.orderNumber ? { orderNumber: current.orderNumber } : {}),
    ...(current.kind ? { kind: current.kind } : {}),
    ...(current.amountCents ? { amountCents: current.amountCents } : {}),
    ...next,
  };
}

/** @param {number} cents */
export function formatPaymentAmount(cents) {
  return MONEY.format(cents / 100);
}

/** "23/11, 14:05" in Brasília time; empty when the instant is invalid.
 * @param {string|undefined} value */
export function formatPaidAt(value) {
  const instant = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(instant)) return '';
  const parts = Object.fromEntries(
    PAID_AT.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}, ${parts.hour}:${parts.minute}`;
}

/**
 * @param {PublicPaymentLink|null} link
 * @param {string} companyName
 */
export function paymentHeading(link, companyName) {
  return link?.orderNumber
    ? `${companyName} · Pedido ${link.orderNumber}`
    : companyName;
}

/**
 * What the customer reads in each state (prototype scenario 12).
 * `action.kind`: `pay` and `retry` ask for the checkout, `continue` goes back
 * to the same payment, `reload` reads the link again after a failed read.
 * @param {PublicPaymentLink} link
 * @param {{companyName: string, loadFailed?: boolean}} options
 */
export function paymentStateView(link, { companyName, loadFailed = false }) {
  const amount = link.amountCents ? formatPaymentAmount(link.amountCents) : '';
  switch (link.state) {
    case 'ready':
      return {
        label: 'Pronto para pagar',
        tone: 'info',
        icon: 'credit-card',
        strong: '',
        text: 'Pix ou cartão: você escolhe na próxima tela, na InfinitePay.',
        action: { kind: 'pay', label: amount ? `Pagar ${amount}` : 'Pagar' },
      };
    case 'in_progress':
      return {
        label: 'Pagamento em andamento',
        tone: 'info',
        icon: 'clock',
        strong: 'Você já abriu este pagamento.',
        text: 'Continue de onde parou: nenhum pagamento novo é criado.',
        action: { kind: 'continue', label: 'Continuar na InfinitePay' },
      };
    case 'paid': {
      const at = formatPaidAt(link.paidAt);
      return {
        label: 'Já pago',
        tone: 'success',
        icon: 'check',
        strong: at ? `Pagamento confirmado em ${at}.` : 'Pagamento confirmado.',
        text: 'Não é preciso pagar de novo.',
        action: null,
      };
    }
    case 'unavailable':
      return {
        label: 'Cancelado',
        tone: 'neutral',
        icon: 'close',
        strong: 'Este link foi cancelado.',
        text: `Fale com a ${companyName} pelo WhatsApp.`,
        action: null,
      };
    default:
      return {
        label: 'Falha ao abrir',
        tone: 'warning',
        icon: 'alert',
        strong: 'Não conseguimos abrir o pagamento agora.',
        text: 'Tentar de novo não cobra duas vezes.',
        action: {
          kind: loadFailed ? 'reload' : 'retry',
          label: 'Tentar de novo',
        },
      };
  }
}

/** Notes for the status line under the action. */
export const PAYMENT_NOTES = Object.freeze({
  timedOut:
    'A InfinitePay ainda não respondeu. Tente de novo em instantes: nenhum pagamento novo é criado.',
  stillFailed:
    'Ainda não foi possível abrir o pagamento. Tentar de novo não cobra duas vezes.',
  rateLimited: 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
  offline: 'Sem conexão no momento. Confira a internet e tente de novo.',
});

export class PublicPaymentError extends Error {
  /**
   * @param {'rate_limited'|'http'|'network'} code
   * @param {number|null} [retryAfterMs] From Retry-After, on a 429.
   */
  constructor(code, retryAfterMs = null) {
    super(code);
    this.name = 'PublicPaymentError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Retry-After as milliseconds: delta-seconds or an HTTP date. Null when the
 * header is missing or unreadable; capped so a bad value cannot stall the page.
 * @param {string|null|undefined} value
 * @param {number} [nowMs]
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let ms = NaN;
  if (/^\d+$/u.test(text)) ms = Number(text) * 1000;
  else {
    const at = Date.parse(text);
    if (Number.isFinite(at)) ms = Math.max(0, at - nowMs);
  }
  return Number.isFinite(ms) ? Math.min(ms, RETRY_AFTER_MAX_MS) : null;
}

/** Pause before the next reading, by time already spent waiting.
 * @param {number} elapsedMs */
export function checkoutPollDelay(elapsedMs) {
  return elapsedMs < CHECKOUT_POLL_SLOW_AFTER_MS
    ? CHECKOUT_POLL_INTERVAL_MS
    : CHECKOUT_POLL_SLOW_INTERVAL_MS;
}

/**
 * One call to the public API. The page sends no cookie (`credentials: omit`):
 * the customer's link needs no session and must not carry a seller's one.
 * 404/410 read as the uniform `unavailable`.
 * @param {string} token
 * @param {{checkout?: boolean, signal?: AbortSignal, fetchImpl?: typeof globalThis.fetch}} [options]
 * @returns {Promise<PublicPaymentLink>}
 */
export async function callPaymentLink(token, options = {}) {
  const checkout = options.checkout === true;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  /** @type {Response} */
  let response;
  try {
    response = await fetchImpl(
      checkout ? paymentCheckoutPath(token) : paymentLinkPath(token),
      {
        method: checkout ? 'POST' : 'GET',
        headers: checkout
          ? { Accept: 'application/json', 'Content-Type': 'application/json' }
          : { Accept: 'application/json' },
        body: checkout ? '{}' : undefined,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: options.signal,
      },
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new PublicPaymentError('network');
  }
  if (response.status === 404 || response.status === 410)
    return { state: 'unavailable' };
  if (response.status === 429)
    throw new PublicPaymentError(
      'rate_limited',
      parseRetryAfter(response.headers.get('retry-after')),
    );
  if (!response.ok) throw new PublicPaymentError('http');
  let body = null;
  try {
    body = await response.json();
  } catch {
    options.signal?.throwIfAborted();
    throw new PublicPaymentError('http');
  }
  return normalizePaymentLink(body);
}

/**
 * Abortable wait.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      globalThis.clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * After the click, read the link until the InfinitePay address arrives or the
 * state leaves `in_progress`. One reading at a time, every 2.5 s and every 5 s
 * after 20 s. A 429 waits Retry-After (or 10 s) and polling resumes; any other
 * failed reading is skipped. Bounded: when the next reading would pass
 * `timeoutMs`, it returns the last reading with `timedOut`, and the page
 * says so instead of spinning forever.
 * @param {(signal?: AbortSignal) => Promise<PublicPaymentLink>} read
 * @param {{signal?: AbortSignal, timeoutMs?: number, sleep?: typeof wait, now?: () => number}} [options]
 * @returns {Promise<PublicPaymentLink>}
 */
export async function waitForCheckout(read, options = {}) {
  const timeoutMs = options.timeoutMs ?? CHECKOUT_POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? wait;
  const now = options.now ?? Date.now;
  const signal = options.signal;
  const start = now();
  const deadline = start + timeoutMs;
  /** @type {PublicPaymentLink} */
  let last = { state: 'in_progress' };
  let delay = checkoutPollDelay(0);
  for (;;) {
    if (now() + delay > deadline) return { ...last, timedOut: true };
    await sleep(delay, signal);
    signal?.throwIfAborted();
    try {
      const link = await read(signal);
      if (link.state !== 'in_progress' || link.checkoutUrl) return link;
      last = link;
      delay = checkoutPollDelay(now() - start);
    } catch (error) {
      if (signal?.aborted) throw error;
      const failure =
        /** @type {{code?: string, retryAfterMs?: number|null}} */ (error);
      delay = Math.max(
        failure?.code === 'rate_limited'
          ? (failure.retryAfterMs ?? RATE_LIMIT_WAIT_MS)
          : 0,
        checkoutPollDelay(now() - start),
      );
    }
  }
}

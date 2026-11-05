// CLAR-01–06: optional, isolated behavioral analytics; never a business audit.
export const CLARITY_PROJECT_ID = 'z8yldgd1xr';
export const CLARITY_HOST = 'crm.silmer.com.br';
export const CLARITY_COLLECT_URL = 'https://www.clarity.ms/collect';

/** Privacy boundary for the pinned SDK wire format. DOM masking does not
 * sanitize click destinations or JavaScript diagnostic messages.
 * @param {string} payload
 * @returns {string}
 */
export function sanitizeClarityPayload(payload) {
  const data = JSON.parse(payload);
  if (
    !Array.isArray(data.e) ||
    data.e[0] !== '0.8.76' ||
    data.e[4] !== CLARITY_PROJECT_ID ||
    !Array.isArray(data.a)
  ) {
    throw new Error('Unsupported analytics envelope');
  }
  data.a = data.a
    .filter((/** @type {unknown} */ row) => {
      if (!Array.isArray(row)) throw new Error('Unsupported analytics event');
      // ScriptError and internal Log carry free text outside the DOM mask.
      return row[1] !== 31 && row[1] !== 33;
    })
    .map((/** @type {unknown[]} */ row) => {
      if (row[1] === 9 || row[1] === 48) {
        if (row.length < 12) throw new Error('Unsupported analytics click');
        row[11] = ''; // Click/ContextMenu destination, including signed URLs.
      }
      return row;
    });
  return JSON.stringify(data);
}

const EVENTS = new Set([
  'seller_handoff_claimed',
  'seller_conversation_taken_over',
  'seller_reply_accepted',
  'seller_media_reply_accepted',
  'seller_conversation_transferred',
  'seller_conversation_closed',
  'seller_conversation_archived',
  'seller_conversation_restored',
  'seller_order_create_started',
  'seller_order_created_manual',
  'seller_order_created_conversation',
  'seller_order_created_assisted',
  'seller_order_section_saved',
  'seller_order_milestones_saved',
  'seller_order_confirmed',
  'seller_order_reopened',
  'seller_order_pdf_generated',
  'seller_order_pdf_shared',
]);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DETAIL = new RegExp(`^/(inbox|pedidos|clientes)/${UUID}$`, 'iu');
const FILTERS = /** @type {Record<string, Record<string, string[]>>} */ ({
  inbox: {
    situacao: ['atender', 'fechar', 'agente', 'aguardando', 'vendedor'],
    fila: ['minhas', 'sem-responsavel'],
  },
  orders: {
    status: ['pendente', 'confirmado'],
    vendedor: ['eu'],
    origem: ['loja'],
    entrega: ['atrasada', 'proxima'],
  },
});

/** Only known pages and opaque internal identifiers may enter URL metadata.
 * @param {URL} url
 * @returns {string | null}
 */
export function sellerPage(url) {
  if (url.hash || url.username || url.password) return null;
  const pages = /** @type {Record<string, string>} */ ({
    '/dashboard': 'dashboard',
    '/inbox': 'inbox',
    '/pedidos': 'orders',
    '/clientes': 'clients',
  });
  const detail = DETAIL.exec(url.pathname);
  const page =
    pages[url.pathname] ??
    (detail
      ? { inbox: 'inbox', pedidos: 'order', clientes: 'clients' }[detail[1]]
      : null);
  if (!page) return null;
  // Preserve real Dashboard shortcuts without admitting search text, seller
  // names, duplicates or arbitrary query values into metadata.
  const entries = [...url.searchParams];
  const seen = new Set();
  for (const [key, value] of entries) {
    if (seen.has(key)) return null;
    seen.add(key);
    if (
      page === 'order' &&
      key === 'conversa' &&
      new RegExp(`^${UUID}$`, 'iu').test(value)
    )
      continue;
    if (!FILTERS[page]?.[key]?.includes(value)) return null;
  }
  return page;
}

/** @typedef {{id?: string, functionName?: string, capabilities?: string[]}} Seller */
/** @typedef {Pick<typeof import('clarity-js').clarity, 'start' | 'stop' | 'set' | 'event' | 'consentv2'>} Sdk */

/** Dependencies are injectable so races and upload privacy can be tested offline.
 * @param {{
 * enabled?: boolean,
 * host?: string,
 * href?: () => string,
 * referrer?: () => string,
 * privacySignal?: () => boolean,
 * load?: () => Promise<Sdk>,
 * digest?: (id: string) => Promise<string>,
 * send?: (payload: string) => void,
 * }} [options]
 */
export function createSellerAnalytics(options = {}) {
  const href = options.href ?? (() => globalThis.location.href);
  const referrer = options.referrer ?? (() => document.referrer);
  const privacySignal =
    options.privacySignal ??
    (() =>
      Boolean(
        /** @type {Navigator & {globalPrivacyControl?: boolean}} */ (
          globalThis.navigator
        ).globalPrivacyControl,
      ) || globalThis.navigator.doNotTrack === '1');
  const load =
    options.load ?? (async () => (await import('clarity-js')).clarity);
  const digest =
    options.digest ??
    (async (id) => {
      const bytes = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new globalThis.TextEncoder().encode(
          `crm-silmer:clarity:seller:v1:${id}`,
        ),
      );
      return Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
    });
  const send =
    options.send ??
    ((payload) => {
      // A callback transport avoids SDK credentialed requests, remote commands,
      // and, critically, blocks uploads from SDK auto-restarts on excluded pages.
      void globalThis
        .fetch(CLARITY_COLLECT_URL, {
          method: 'POST',
          body: payload,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          keepalive:
            new globalThis.TextEncoder().encode(payload).byteLength < 60_000,
        })
        .catch(() => {});
    });
  /** @type {Sdk | null} */
  let sdk = null;
  let revision = 0;
  let currentKey = '';
  let currentUrl = '';
  let active = false;

  function safeEnvironment() {
    if (!options.enabled || privacySignal()) return false;
    // An older Clarity cookie can override track:false inside SDK start().
    // Fail closed instead of importing a previous consent or browser identity.
    if (/(?:^|;\s*)_cl(?:ck|sk)=/u.test(globalThis.document?.cookie ?? ''))
      return false;
    const url = new URL(href());
    if (
      url.protocol !== 'https:' ||
      url.host !== (options.host ?? CLARITY_HOST) ||
      !sellerPage(url)
    )
      return false;
    const previous = referrer();
    if (!previous) return true;
    const from = new URL(previous);
    return (
      from.origin === url.origin &&
      ((from.pathname === '/' &&
        !from.search &&
        !from.hash &&
        !from.username &&
        !from.password) ||
        Boolean(sellerPage(from)))
    );
  }

  function stop() {
    // Flush only the existing safe page. Popstate may already have changed
    // the address: its final payload must then be discarded.
    try {
      sdk?.stop();
    } catch {
      /* Analytics cannot break navigation. */
    }
    revision += 1;
    active = false;
    currentKey = '';
    currentUrl = '';
  }

  /** @param {Seller | null | undefined} user */
  async function sync(user) {
    let ownRevision = revision;
    try {
      const eligible =
        user?.functionName === 'Vendedor' &&
        !user.capabilities?.includes('COMMERCIAL_ADMIN') &&
        typeof user.id === 'string' &&
        user.id.length > 0 &&
        safeEnvironment();
      const url = href();
      const key = eligible ? `${user.id}:${url}` : '';
      if (key && key === currentKey) return;
      stop();
      if (!eligible) return;
      ownRevision = revision;
      currentKey = key;
      currentUrl = url;
      const [loaded, sellerKey] = await Promise.all([
        load(),
        digest(user.id ?? ''),
      ]);
      if (revision !== ownRevision) return;
      if (href() !== url || !safeEnvironment()) {
        stop();
        return;
      }
      sdk = loaded;
      // Clear any dormant instance before beginning the authorized context.
      sdk.stop();
      active = true;
      sdk.start({
        projectId: CLARITY_PROJECT_ID,
        track: false,
        content: false,
        mask: ['body'],
        unmask: [],
        cookies: [],
        fraud: false,
        conversions: false,
        report: undefined,
        drop: ['conversa'],
        upload(payload) {
          try {
            if (
              active &&
              revision === ownRevision &&
              href() === currentUrl &&
              safeEnvironment()
            )
              send(sanitizeClarityPayload(payload));
          } catch {
            /* No payload logging, retries or effect on the CRM. */
          }
        },
      });
      sdk.consentv2({ ad_Storage: 'denied', analytics_Storage: 'denied' });
      sdk.set('crm_role', 'seller');
      sdk.set('crm_seller_key', sellerKey);
      const page = sellerPage(new URL(url));
      sdk.set('crm_page', page ?? 'unknown');
      sdk.event(`seller_view_${page}`, '');
    } catch {
      if (revision === ownRevision) stop();
    }
  }

  /** @param {string} event */
  function track(event) {
    try {
      if (
        active &&
        EVENTS.has(event) &&
        href() === currentUrl &&
        safeEnvironment()
      )
        sdk?.event(event, '');
    } catch {
      /* Optional analytics must not change a successful command. */
    }
  }
  function capture() {
    const ownRevision = revision;
    return (/** @type {string} */ event) => {
      if (revision === ownRevision) track(event);
    };
  }
  return { sync, stop, track, capture };
}

const analytics = createSellerAnalytics({
  enabled:
    import.meta.env?.PROD === true &&
    import.meta.env?.VITE_CLARITY_ENABLED !== 'false',
});
export const syncSellerAnalytics = analytics.sync;
export const stopSellerAnalytics = analytics.stop;
export const trackSellerEvent = analytics.track;
export const captureSellerEvents = analytics.capture;

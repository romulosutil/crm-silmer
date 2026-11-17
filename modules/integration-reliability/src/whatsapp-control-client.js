const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIONS = new Set(['connect', 'reconcile', 'disconnect']);

/** A bounded diagnostic: never attach an upstream response, cause or URL. */
export class WhatsAppControlDeliveryError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'WhatsAppControlDeliveryError';
    this.code = code;
  }
}

/** @param {unknown} value @param {string[]} fields */
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_INVALID');
  const record = /** @type {Record<string, any>} */ (value);
  if (Object.keys(record).sort().join(',') !== [...fields].sort().join(','))
    throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_INVALID');
  return record;
}

/** @param {unknown} input @param {'control'|'challenge'} kind */
export function validateWhatsAppControlEnvelope(input, kind) {
  const fields = ['operationId', 'lineId', 'generation', 'reference'];
  const body = exact(input, [
    ...fields,
    ...(kind === 'control' ? ['action'] : ['challengeId', 'mode']),
  ]);
  if (
    ![
      'operationId',
      'lineId',
      'reference',
      ...(kind === 'challenge' ? ['challengeId'] : []),
    ].every((key) => typeof body[key] === 'string' && UUID.test(body[key])) ||
    !Number.isSafeInteger(body.generation) ||
    body.generation < 1 ||
    (kind === 'control'
      ? !ACTIONS.has(body.action)
      : !['qr', 'code'].includes(body.mode))
  )
    throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_INVALID');
  return Object.freeze({ ...body });
}

/** @param {string} raw @param {boolean} local */
function endpoint(raw, local) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError('WHATSAPP_CONTROL_CONFIGURATION_INVALID');
  }
  if (
    (url.protocol !== 'https:' &&
      !(
        local &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/webhook/silmer/seller-whatsapp/')
  )
    throw new TypeError('WHATSAPP_CONTROL_CONFIGURATION_INVALID');
  return url;
}

/** Read bytes before parsing; response.json() alone has no memory bound.
 * @param {Response} response @param {number} limit */
async function readJson(response, limit) {
  if (!response.body)
    throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_UNCERTAIN');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_UNCERTAIN');
  } finally {
    reader.releaseLock();
  }
}

/** Synchronous challenges never enter worker jobs, idempotency responses or logs.
 * Every attempted call is single-shot: HTTP/parse/timeout failures are uncertain.
 * @param {{enabled?:boolean,allowlist?:string[]|((lineId:string)=>boolean),controlEndpoint:string,challengeEndpoint:string,clientId:string,clientSecret:string,allowInsecureLocal?:boolean,timeoutMs?:number,fetchImpl?:typeof fetch,clock?:()=>Date}} options */
export function createWhatsAppControlClient(options) {
  const enabled = options.enabled === true;
  const allowlist = options.allowlist ?? [];
  const controlUrl = endpoint(
    options.controlEndpoint,
    options.allowInsecureLocal === true,
  );
  const challengeUrl = endpoint(
    options.challengeEndpoint,
    options.allowInsecureLocal === true,
  );
  if (
    (typeof options.enabled !== 'undefined' &&
      typeof options.enabled !== 'boolean') ||
    (typeof allowlist !== 'function' &&
      (!Array.isArray(allowlist) ||
        allowlist.some((id) => !UUID.test(id)) ||
        new Set(allowlist).size !== allowlist.length)) ||
    typeof options.clientId !== 'string' ||
    !options.clientId.length ||
    options.clientId.length > 256 ||
    /[:\r\n]/u.test(options.clientId) ||
    typeof options.clientSecret !== 'string' ||
    options.clientSecret.length < 32 ||
    options.clientSecret.length > 1024 ||
    /[\r\n]/u.test(options.clientSecret)
  )
    throw new TypeError('WHATSAPP_CONTROL_CONFIGURATION_INVALID');
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new TypeError('WHATSAPP_CONTROL_CONFIGURATION_INVALID');
  const authorization = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const clock = options.clock ?? (() => new Date());
  /** @param {unknown} input @param {'control'|'challenge'} kind */
  async function call(input, kind) {
    const body = validateWhatsAppControlEnvelope(input, kind);
    if (
      !enabled ||
      !(typeof allowlist === 'function'
        ? allowlist(body.lineId) === true
        : allowlist.includes(body.lineId))
    )
      throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_DISABLED');
    let response;
    try {
      response = await fetchImpl(
        kind === 'control' ? controlUrl : challengeUrl,
        {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            authorization,
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'idempotency-key':
              kind === 'control' ? body.operationId : body.challengeId,
            'x-correlation-id': body.operationId,
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_UNCERTAIN');
    }
    if (response.status !== 200)
      throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_UNCERTAIN');
    const value = await readJson(
      response,
      kind === 'control' ? 4096 : 512 * 1024,
    );
    if (kind === 'control') {
      const ack = exact(value, ['accepted', 'operationId', 'generation']);
      if (
        ack.accepted !== true ||
        ack.operationId !== body.operationId ||
        ack.generation !== body.generation
      )
        throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_UNCERTAIN');
      return Object.freeze(ack);
    }
    const challenge = exact(value, [
      'challengeId',
      'operationId',
      'generation',
      'mode',
      'expiresAt',
      'value',
    ]);
    const expiresAt = Date.parse(challenge.expiresAt);
    if (
      challenge.challengeId !== body.challengeId ||
      challenge.operationId !== body.operationId ||
      challenge.generation !== body.generation ||
      challenge.mode !== body.mode ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= clock().getTime() ||
      expiresAt > clock().getTime() + 120000 ||
      typeof challenge.value !== 'string' ||
      (body.mode === 'code'
        ? !/^[A-Za-z0-9-]{8,32}$/u.test(challenge.value)
        : !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(challenge.value))
    )
      throw new WhatsAppControlDeliveryError('WHATSAPP_CONTROL_UNCERTAIN');
    return Object.freeze(challenge);
  }
  return Object.freeze({
    control: (/** @type {unknown} */ input) => call(input, 'control'),
    challenge: (/** @type {unknown} */ input) => call(input, 'challenge'),
  });
}

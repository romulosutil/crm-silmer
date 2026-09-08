export class ApiError extends Error {
  /** @param {number} status @param {Record<string, any>} problem */
  constructor(status, problem) {
    super(String(problem.detail ?? problem.message ?? 'Falha na solicitação'));
    this.name = 'ApiError';
    this.status = status;
    this.code = String(problem.code ?? problem.error ?? 'REQUEST_FAILED');
    this.problem = problem;
  }
}

/** @param {string} name */
function readCookie(name) {
  const prefix = `${name}=`;
  return (
    document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) ?? ''
  );
}

/**
 * @param {string} url
 * @param {{method?: string, body?: unknown, idempotencyKey?: string, headers?: Record<string,string>, signal?: AbortSignal}} [options]
 */
export async function request(url, options = {}) {
  const method = options.method ?? 'GET';
  const headers = new globalThis.Headers({
    Accept: 'application/json',
    ...options.headers,
  });
  if (options.body !== undefined)
    headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('crm_csrf');
    if (csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  if (options.idempotencyKey)
    headers.set('Idempotency-Key', options.idempotencyKey);
  const response = await globalThis.fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  if (response.status === 304) {
    return {
      data: null,
      etag: response.headers.get('etag'),
      notModified: true,
    };
  }
  if (response.status === 204)
    return { data: null, etag: response.headers.get('etag') };
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json() : {};
  if (!response.ok) {
    const problem = data && typeof data === 'object' ? data : {};
    const nested = problem.error;
    throw new ApiError(
      response.status,
      nested && typeof nested === 'object'
        ? { ...problem, ...nested }
        : problem,
    );
  }
  return { data, etag: response.headers.get('etag') };
}

export function commandKey() {
  return globalThis.crypto.randomUUID();
}

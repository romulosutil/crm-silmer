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
  options.signal?.throwIfAborted();
  const method = options.method ?? 'GET';
  const multipart = options.body instanceof globalThis.FormData;
  const headers = new globalThis.Headers({
    Accept: 'application/json',
    ...options.headers,
  });
  if (multipart) headers.delete('Content-Type');
  else if (options.body !== undefined)
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
    body: multipart
      ? /** @type {FormData} */ (options.body)
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
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

/**
 * ADR 023: a multipart upload with progress, which fetch cannot report. Same
 * session, CSRF and Idempotency-Key rules as `request`; a failure arrives as
 * the same ApiError, and a lost connection as status 0.
 *
 * @param {string} url
 * @param {FormData} form
 * @param {{idempotencyKey: string, onProgress?: (fraction: number) => void, signal?: AbortSignal}} options
 * @returns {Promise<{data: any}>}
 */
export function upload(url, form, options) {
  return new Promise((resolve, reject) => {
    const xhr = new globalThis.XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    const csrf = readCookie('crm_csrf');
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', decodeURIComponent(csrf));
    xhr.setRequestHeader('Idempotency-Key', options.idempotencyKey);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable)
        options.onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      /** @type {any} */
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ data });
        return;
      }
      const nested = data?.error;
      reject(
        new ApiError(
          xhr.status,
          nested && typeof nested === 'object' ? { ...data, ...nested } : data,
        ),
      );
    });
    xhr.addEventListener('error', () =>
      reject(new ApiError(0, { code: 'NETWORK_ERROR' })),
    );
    xhr.addEventListener('abort', () =>
      reject(new ApiError(0, { code: 'UPLOAD_CANCELLED' })),
    );
    options.signal?.addEventListener('abort', () => xhr.abort(), {
      once: true,
    });
    xhr.send(form);
  });
}

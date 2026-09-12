/**
 * Authorization shared by Inbox and handoff commands. It deliberately has no
 * dependency on commercial stages or permissions.
 */
/** @param {{automationAuth?: any, identity?: any}} [options] */
export function createOperationalAuthRuntime(options = {}) {
  const identity = options.identity;
  const automationAuth = options.automationAuth;
  return Object.freeze({
    async authorize(/** @type {any} */ input) {
      if (input.authorization !== undefined) {
        if (!automationAuth) throw httpError(503, 'AUTOMATION_AUTH_UNAVAILABLE');
        return automationAuth.authorize(input);
      }
      if (!identity) throw httpError(503, 'IDENTITY_UNAVAILABLE');
      if (typeof input.origin !== 'string' || !identity.allowedOrigins.includes(input.origin)) {
        throw httpError(403, 'FORBIDDEN');
      }
      const cookies = parseCookies(input.cookie);
      const sessionToken = cookies.get('crm_session');
      const csrfToken = cookies.get('crm_csrf');
      if (typeof sessionToken !== 'string' || csrfToken !== input.csrfToken) {
        throw httpError(403, 'FORBIDDEN');
      }
      return identity.authorizeOperational({
        action: input.action,
        csrfToken,
        sessionToken,
      });
    },
  });
}

/** @param {unknown} raw */
function parseCookies(raw) {
  if (raw === undefined) return new Map();
  if (typeof raw !== 'string') throw httpError(400, 'INVALID_REQUEST');
  const cookies = new Map();
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (cookies.has(name)) throw httpError(400, 'INVALID_REQUEST');
    cookies.set(name, value);
  }
  return cookies;
}

/** @param {number} statusCode @param {string} code */
function httpError(statusCode, code) {
  return Object.assign(new Error(code), { code, statusCode });
}

// LOJ-24 (ADR 028): a link to a CRM page opened without a session — the
// order link the seller receives — comes back to that page after the login.
// The page asked for travels as `?voltar=` on the login route, so a reload
// keeps it, and only an internal path of the app is ever followed: nothing
// with a scheme, a host (`//…`) or a backslash, so the login cannot be
// turned into an open redirect.

export const RETURN_QUERY = 'voltar';
const MAX_RETURN_PATH = 512;

/**
 * The internal path to go back to, or null.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > MAX_RETURN_PATH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/u.test(value)) return null;
  if (value === '/' || value.startsWith('/?') || value.startsWith('/#')) {
    return null;
  }
  return value;
}

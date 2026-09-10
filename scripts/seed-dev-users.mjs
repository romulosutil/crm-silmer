import { randomUUID } from 'node:crypto';

export const DEVELOPMENT_PASSWORD = 'Desenvolvimento!2026';
export const DEVELOPMENT_USERS = Object.freeze([
  Object.freeze({
    email: 'admin@crm-silmer.local',
    label: 'Admin comercial',
    name: 'Admin Comercial',
  }),
  Object.freeze({
    email: 'vendedor@crm-silmer.local',
    label: 'Vendedor',
    name: 'Vendedor Silmer',
  }),
  Object.freeze({
    email: 'vendedora@crm-silmer.local',
    label: 'Vendedora',
    name: 'Vendedora Silmer',
  }),
]);

/**
 * Seeds only local, synthetic identities through the public identity API. It is
 * safe to call on every `npm run dev`: existing accounts are preserved and only
 * missing ones are created.
 *
 * @param {{apiOrigin: string, bootstrapToken: string, origin: string}} options
 */
export async function seedDevelopmentUsers({
  apiOrigin,
  bootstrapToken,
  origin,
}) {
  const request = createClient(apiOrigin, origin);
  const admin = DEVELOPMENT_USERS[0];
  const bootstrap = await request.post(
    '/api/v1/bootstrap/identity',
    {
      email: admin.email,
      name: admin.name,
      password: DEVELOPMENT_PASSWORD,
      reason: 'Criação automática de conta local de desenvolvimento',
    },
    { 'x-bootstrap-token': bootstrapToken },
    [201, 409],
  );
  if (bootstrap.status === 201) console.log('Created local development users.');

  const adminSession = await request.login(admin.email, DEVELOPMENT_PASSWORD);
  if (!adminSession)
    throw new Error(`Could not sign in local user ${admin.email}`);

  for (const user of DEVELOPMENT_USERS.slice(1)) {
    const existing = await request.login(
      user.email,
      DEVELOPMENT_PASSWORD,
      false,
    );
    if (existing) continue;
    await request.post(
      '/api/v1/users',
      {
        email: user.email,
        name: user.name,
        password: DEVELOPMENT_PASSWORD,
        reason: 'Criação automática de conta local de desenvolvimento',
      },
      adminSession.headers(),
    );
    const session = await request.login(user.email, DEVELOPMENT_PASSWORD);
    if (!session) throw new Error(`Could not create local user ${user.email}`);
  }
}

/** @typedef {Record<string, string>} RequestHeaders */
/** @typedef {{headers: () => RequestHeaders, user: any}} Session */

/** @param {string} apiOrigin @param {string} origin */
function createClient(apiOrigin, origin) {
  /** @param {string} path @param {object} body @param {Record<string, string>} [headers] @param {number[]} [acceptedStatuses] */
  async function post(path, body, headers = {}, acceptedStatuses = [200, 201]) {
    const response = await globalThis.fetch(new URL(path, apiOrigin), {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        origin,
        ...headers,
      },
      method: 'POST',
    });
    if (!acceptedStatuses.includes(response.status)) {
      throw new Error(
        `Local development seed failed at ${path} (${response.status})`,
      );
    }
    return {
      body: await response.json(),
      headers: response.headers,
      status: response.status,
    };
  }

  /** @param {string} email @param {string} password @param {boolean} [required] */
  async function login(email, password, required = true) {
    const result = await post(
      '/api/v1/sessions',
      { email, password },
      {},
      [200, 401],
    );
    if (result.status === 401) {
      if (!required) return null;
      throw new Error(`Could not sign in local user ${email}`);
    }
    const cookies = result.headers.getSetCookie();
    const csrf = cookieValue(cookies, 'crm_csrf');
    const session = cookieValue(cookies, 'crm_session');
    if (!csrf || !session)
      throw new Error('Local development session cookies were not returned');
    return {
      headers: () => ({
        cookie: `crm_session=${session}; crm_csrf=${csrf}`,
        'idempotency-key': randomUUID(),
        'x-csrf-token': csrf,
      }),
      user: result.body.user,
    };
  }

  return { login, post };
}

/** @param {string[]} cookies @param {string} name */
function cookieValue(cookies, name) {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.slice(name.length + 1).split(';', 1)[0] ?? null;
}

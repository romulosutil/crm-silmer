import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { createIdentityApiRuntime } from '../apps/api/src/identity-runtime.js';
import { createServerApi } from '../apps/api/src/server.js';
import {
  createDatabase,
  loadMigrations,
  migrate,
} from '../modules/database/src/index.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const origin = 'https://crm.example.test';

if (connectionString) {
  test('identity API live: bootstrap, login, user management, ACL, replay and revocation', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const administration = new Pool({ connectionString, max: 4 });
    const environment = {
      APP_ORIGIN: origin,
      AUTH_THROTTLE_HMAC_KEY: Buffer.alloc(32, 24).toString('base64url'),
      IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 25).toString('base64url'),
      DEAL_ENVELOPE_KEY: Buffer.alloc(32, 26).toString('base64url'),
      IDENTITY_BOOTSTRAP_TOKEN:
        'issue12-bootstrap-token-at-least-32-characters',
    };
    const database = createDatabase({ connectionString, max: 8 });
    const api = createServerApi({
      database,
      identity: createIdentityApiRuntime(database, environment),
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
      readiness: () => true,
    });

    try {
      await administration.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await administration.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(administration, { migrations: await loadMigrations() });

      const bootstrap = await api.inject({
        headers: {
          origin,
          'x-bootstrap-token': environment.IDENTITY_BOOTSTRAP_TOKEN,
        },
        method: 'POST',
        payload: {
          email: 'admin@example.test',
          name: 'Administradora Silmer',
          password: 'admin correct horse battery staple',
          reason: 'Bootstrap autorizado',
        },
        url: '/api/v1/bootstrap/identity',
      });
      assert.equal(bootstrap.statusCode, 201);
      const bootstrapBody = bootstrap.json();
      const adminLogin = await api.inject({
        headers: { origin },
        method: 'POST',
        payload: {
          email: 'admin@example.test',
          password: 'admin correct horse battery staple',
        },
        url: '/api/v1/sessions',
      });
      assert.equal(adminLogin.statusCode, 200);
      assert.equal(adminLogin.body.includes('crm_session'), false);
      const adminCookies = cookies(adminLogin);

      const sellerPassword = 'seller correct horse battery staple';
      const createSellerRequest = {
        headers: commandHeaders(adminCookies, 'user-key-1'),
        method: /** @type {const} */ ('POST'),
        payload: {
          email: 'seller@example.test',
          name: 'Vendedora Silmer',
          password: sellerPassword,
          reason: 'Entrada no time comercial',
        },
        url: '/api/v1/users',
      };
      const created = await api.inject(createSellerRequest);
      assert.equal(created.statusCode, 201);
      const seller = created.json().user;
      assert.equal(seller.name, 'Vendedora Silmer');
      assert.equal(seller.functionName, 'Vendedor');
      assert.deepEqual(seller.capabilities, []);
      assert.equal(seller.disabledAt, null);
      assert.doesNotMatch(created.body, /password|argon2/iu);

      const replay = await api.inject(createSellerRequest);
      assert.equal(replay.statusCode, 201);
      assert.deepEqual(replay.json(), created.json());

      const duplicateEmail = await api.inject({
        ...createSellerRequest,
        headers: commandHeaders(adminCookies, 'user-key-2'),
        payload: {
          ...createSellerRequest.payload,
          email: 'SELLER@example.test',
          reason: 'E-mail repetido',
        },
      });
      assert.equal(duplicateEmail.statusCode, 409);
      assert.deepEqual(duplicateEmail.json(), {
        error: { code: 'EMAIL_ALREADY_REGISTERED' },
      });

      const sellerLogin = await api.inject({
        headers: { origin },
        method: 'POST',
        payload: { email: 'seller@example.test', password: sellerPassword },
        url: '/api/v1/sessions',
      });
      assert.equal(sellerLogin.statusCode, 200);
      let sellerCookies = cookies(sellerLogin);

      for (const request of [
        { method: /** @type {const} */ ('GET'), url: '/api/v1/users' },
        {
          method: /** @type {const} */ ('POST'),
          payload: {
            email: 'intruder@example.test',
            name: 'Intrusa',
            password: 'x',
            reason: 'Sem permissao',
          },
          url: '/api/v1/users',
        },
        {
          method: /** @type {const} */ ('PATCH'),
          payload: { name: 'Renomeada', reason: 'Sem permissao' },
          url: `/api/v1/users/${seller.id}`,
        },
      ]) {
        const denied = await api.inject({
          ...request,
          headers: commandHeaders(sellerCookies, `seller-${request.method}-1`),
        });
        assert.equal(
          denied.statusCode,
          403,
          `${request.method} ${request.url} must be forbidden for a non-admin`,
        );
        assert.deepEqual(denied.json(), { error: { code: 'FORBIDDEN' } });
      }

      const listed = await api.inject({
        headers: { cookie: adminCookies.cookie, origin },
        url: '/api/v1/users',
      });
      assert.equal(listed.statusCode, 200);
      assert.deepEqual(
        listed.json().users.map(
          /** @param {{email: string, name: string}} user */
          ({ email, name }) => ({ email, name }),
        ),
        [
          { email: 'admin@example.test', name: 'Administradora Silmer' },
          { email: 'seller@example.test', name: 'Vendedora Silmer' },
        ],
      );
      assert.doesNotMatch(listed.body, /password|argon2/iu);

      const rotatedPassword = 'seller rotated horse battery staple';
      const patched = await api.inject({
        headers: commandHeaders(adminCookies, 'user-key-3'),
        method: 'PATCH',
        payload: {
          name: 'Vendedora Renomeada',
          password: rotatedPassword,
          reason: 'Correcao de cadastro',
        },
        url: `/api/v1/users/${seller.id}`,
      });
      assert.equal(patched.statusCode, 200);
      assert.equal(patched.json().user.name, 'Vendedora Renomeada');
      assert.equal(patched.json().user.email, 'seller@example.test');
      assert.doesNotMatch(patched.body, /password|argon2/iu);

      const disabled = await api.inject({
        headers: commandHeaders(adminCookies, 'user-key-4'),
        method: 'POST',
        payload: { reason: 'Saida temporaria' },
        url: `/api/v1/users/${seller.id}/disable`,
      });
      assert.equal(disabled.statusCode, 200);
      assert.notEqual(disabled.json().user.disabledAt, null);
      const disabledLogin = await api.inject({
        headers: { origin },
        method: 'POST',
        payload: { email: 'seller@example.test', password: rotatedPassword },
        url: '/api/v1/sessions',
      });
      assert.equal(disabledLogin.statusCode, 401);

      const enabled = await api.inject({
        headers: commandHeaders(adminCookies, 'user-key-5'),
        method: 'POST',
        payload: { reason: 'Retorno ao time' },
        url: `/api/v1/users/${seller.id}/enable`,
      });
      assert.equal(enabled.statusCode, 200);
      assert.equal(enabled.json().user.disabledAt, null);

      const rotatedLogin = await api.inject({
        headers: { origin },
        method: 'POST',
        payload: { email: 'seller@example.test', password: rotatedPassword },
        url: '/api/v1/sessions',
      });
      assert.equal(rotatedLogin.statusCode, 200);
      sellerCookies = cookies(rotatedLogin);

      for (const url of ['/api/v1/invitations', '/api/v1/invitations/accept']) {
        const gone = await api.inject({
          headers: commandHeaders(adminCookies, 'invitation-key-1'),
          method: 'POST',
          payload: { email: 'seller@example.test' },
          url,
        });
        assert.equal(gone.statusCode, 404);
      }

      const missingTarget = await api.inject({
        headers: commandHeaders(adminCookies, 'missing-target-key-1'),
        method: 'POST',
        payload: {
          capability: 'COMMERCIAL_ADMIN',
          reason: 'Alvo inexistente',
          targetId: 'missing-user',
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(missingTarget.statusCode, 404);
      assert.deepEqual(missingTarget.json(), {
        error: { code: 'NOT_FOUND' },
      });

      const selfGrant = await api.inject({
        headers: commandHeaders(adminCookies, 'self-grant-key-1'),
        method: 'POST',
        payload: {
          capability: 'COMMERCIAL_ADMIN',
          reason: 'Autoatribuicao negada',
          targetId: bootstrapBody.user.id,
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(selfGrant.statusCode, 403);
      assert.deepEqual(selfGrant.json(), { error: { code: 'FORBIDDEN' } });

      const retiredCapability = await api.inject({
        headers: commandHeaders(adminCookies, 'retired-capability-key-1'),
        method: 'POST',
        payload: {
          capability: 'PRIVACY_OFFICER',
          reason: 'Capacidade removida do dominio',
          targetId: seller.id,
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(retiredCapability.statusCode, 400);
      assert.deepEqual(retiredCapability.json(), {
        error: { code: 'INVALID_REQUEST' },
      });

      const grant = await api.inject({
        headers: commandHeaders(adminCookies, 'grant-key-1'),
        method: 'POST',
        payload: {
          capability: 'COMMERCIAL_ADMIN',
          reason: 'Promocao aprovada',
          targetId: seller.id,
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(grant.statusCode, 200);
      const divergentGrant = await api.inject({
        headers: commandHeaders(adminCookies, 'grant-key-1'),
        method: 'POST',
        payload: {
          capability: 'COMMERCIAL_ADMIN',
          reason: 'Outro motivo para a mesma chave',
          targetId: seller.id,
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(divergentGrant.statusCode, 409);
      assert.deepEqual(divergentGrant.json(), {
        error: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });

      const revoke = await api.inject({
        headers: commandHeaders(adminCookies, 'revoke-key-1'),
        method: 'POST',
        payload: {
          capability: 'COMMERCIAL_ADMIN',
          reason: 'Acesso privilegiado encerrado',
          targetId: seller.id,
        },
        url: '/api/v1/capabilities/revoke',
      });
      assert.equal(revoke.statusCode, 200);
      assert.equal(
        (
          await api.inject({
            headers: { cookie: sellerCookies.cookie },
            url: '/api/v1/sessions/current',
          })
        ).statusCode,
        401,
      );

      for (const email of ['missing@example.test', 'admin@example.test']) {
        const statuses = await Promise.all(
          Array.from({ length: 4 }, async () => {
            return (
              await api.inject({
                headers: { origin },
                method: 'POST',
                payload: { email, password: 'wrong password value' },
                url: '/api/v1/sessions',
              })
            ).statusCode;
          }),
        );
        assert.deepEqual(statuses.sort(), [401, 401, 401, 429]);
      }

      const persisted = await administration.query(
        `SELECT
           (SELECT count(*)::integer FROM crm.audit_events) AS audits,
           (SELECT count(*)::integer FROM crm.idempotency_records
             WHERE status = 'completed') AS completed_records,
           (SELECT bool_and(subject_hash ~ '^[0-9a-f]{64}$')
             FROM crm.authentication_throttles) AS hashes_only,
           (SELECT bool_and(response::text NOT LIKE $1)
             FROM crm.idempotency_records WHERE response IS NOT NULL) AS encrypted,
           (SELECT bool_and(password_hash LIKE '$argon2id$%')
             FROM crm.users) AS hashed_passwords`,
        [`%${rotatedPassword}%`],
      );
      assert.ok(persisted.rows[0].audits >= 7);
      assert.ok(persisted.rows[0].completed_records >= 6);
      assert.equal(persisted.rows[0].hashes_only, true);
      assert.equal(persisted.rows[0].encrypted, true);
      assert.equal(persisted.rows[0].hashed_passwords, true);
    } finally {
      await api.close();
      await administration.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await administration.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await administration.end();
    }
  });
}

/** @param {{headers: Record<string, string|string[]|number|undefined>}} response */
function cookies(response) {
  const raw = response.headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : [String(raw)];
  const session = values.find((value) => value.startsWith('crm_session='));
  const csrf = values.find((value) => value.startsWith('crm_csrf='));
  assert.ok(session);
  assert.ok(csrf);
  return {
    cookie: `${session.split(';')[0]}; ${csrf.split(';')[0]}`,
    csrf: csrf.split(';')[0].slice('crm_csrf='.length),
  };
}

/** @param {{cookie: string, csrf: string}} values @param {string} key */
function commandHeaders(values, key) {
  return {
    cookie: values.cookie,
    'idempotency-key': key,
    origin,
    'x-csrf-token': values.csrf,
  };
}

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
  test('identity API live: bootstrap, login, invite, MFA, ACL, replay and revocation', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const administration = new Pool({ connectionString, max: 4 });
    const encodedKey = Buffer.alloc(32, 23).toString('base64url');
    const environment = {
      APP_ORIGIN: origin,
      AUTH_THROTTLE_HMAC_KEY: Buffer.alloc(32, 24).toString('base64url'),
      IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 25).toString('base64url'),
      IDENTITY_BOOTSTRAP_TOKEN:
        'issue12-bootstrap-token-at-least-32-characters',
      IDENTITY_ENVELOPE_KEY: encodedKey,
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
          functionName: 'Atendimento',
          password: 'admin correct horse battery staple',
          reason: 'Bootstrap autorizado',
        },
        url: '/api/v1/bootstrap/identity',
      });
      assert.equal(bootstrap.statusCode, 201);
      const bootstrapBody = bootstrap.json();
      assert.equal(bootstrapBody.mfa.recoveryCodes.length, 8);
      assert.match(bootstrapBody.mfa.secret, /^[A-Z2-7]+$/u);

      const adminLogin = await api.inject({
        headers: { origin },
        method: 'POST',
        payload: {
          email: 'admin@example.test',
          password: 'admin correct horse battery staple',
          totpCode: totp(bootstrapBody.mfa.secret),
        },
        url: '/api/v1/sessions',
      });
      assert.equal(adminLogin.statusCode, 200);
      assert.equal(adminLogin.body.includes('crm_session'), false);
      const adminCookies = cookies(adminLogin);

      const invitationRequest = {
        headers: commandHeaders(adminCookies, 'invite-key-1'),
        method: /** @type {const} */ ('POST'),
        payload: {
          email: 'seller@example.test',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          functionName: 'Vendedor',
          reason: 'Entrada no time comercial',
        },
        url: '/api/v1/invitations',
      };
      const invitation = await api.inject(invitationRequest);
      assert.equal(invitation.statusCode, 201);
      const invitationBody = invitation.json();
      const replay = await api.inject(invitationRequest);
      assert.deepEqual(replay.json(), invitationBody);

      const acceptPayload = {
        headers: { origin },
        method: /** @type {const} */ ('POST'),
        payload: {
          password: 'seller correct horse battery staple',
          token: invitationBody.token,
        },
        url: '/api/v1/invitations/accept',
      };
      const acceptResults = await Promise.all([
        api.inject(acceptPayload),
        api.inject(acceptPayload),
      ]);
      assert.deepEqual(
        acceptResults.map(({ statusCode }) => statusCode).sort(),
        [201, 400],
      );
      const seller = acceptResults
        .find(({ statusCode }) => statusCode === 201)
        ?.json();
      assert.ok(seller);

      const sellerLogin = await api.inject({
        headers: { origin },
        method: 'POST',
        payload: {
          email: 'seller@example.test',
          password: 'seller correct horse battery staple',
        },
        url: '/api/v1/sessions',
      });
      assert.equal(sellerLogin.statusCode, 200);
      const sellerCookies = cookies(sellerLogin);

      const enrollment = await api.inject({
        headers: commandHeaders(sellerCookies, 'seller-mfa-key-1'),
        method: 'POST',
        payload: { reason: 'Habilitar acesso privilegiado' },
        url: '/api/v1/mfa/enrollments',
      });
      assert.equal(enrollment.statusCode, 201);
      assert.equal(enrollment.json().recoveryCodes.length, 8);

      const missingTarget = await api.inject({
        headers: commandHeaders(adminCookies, 'missing-target-key-1'),
        method: 'POST',
        payload: {
          capability: 'PRIVACY_OFFICER',
          reason: 'Alvo inexistente',
          targetId: 'missing-user',
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(missingTarget.statusCode, 400);
      assert.deepEqual(missingTarget.json(), {
        error: { code: 'INVALID_REQUEST' },
      });

      const selfGrant = await api.inject({
        headers: commandHeaders(adminCookies, 'self-grant-key-1'),
        method: 'POST',
        payload: {
          capability: 'PRIVACY_OFFICER',
          reason: 'Autoatribuicao negada',
          targetId: bootstrapBody.user.id,
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(selfGrant.statusCode, 403);
      assert.deepEqual(selfGrant.json(), { error: { code: 'FORBIDDEN' } });

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
          capability: 'PRIVACY_OFFICER',
          reason: 'Promocao aprovada',
          targetId: seller.id,
        },
        url: '/api/v1/capabilities/grant',
      });
      assert.equal(divergentGrant.statusCode, 409);

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
             FROM crm.idempotency_records WHERE response IS NOT NULL) AS encrypted`,
        [`%${invitationBody.token}%`],
      );
      assert.ok(persisted.rows[0].audits >= 7);
      assert.ok(persisted.rows[0].completed_records >= 4);
      assert.equal(persisted.rows[0].hashes_only, true);
      assert.equal(persisted.rows[0].encrypted, true);
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

/** @param {string} encodedSecret */
function totp(encodedSecret) {
  const secret = decodeBase32(encodedSecret);
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/** @param {string} encoded */
function decodeBase32(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of encoded) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

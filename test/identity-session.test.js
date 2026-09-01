import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdentityAccessService,
  createInMemoryIdentityRepository,
  hashPassword,
  verifyPassword,
} from '../modules/identity-access/src/index.js';

const ENVELOPE_KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-08-30T12:00:00.000Z');

/**
 * @typedef {{
 *   actor: string,
 *   action: string,
 *   target: {type: string, id: string},
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 * }} AuditEvent
 */

function harness() {
  let tokenSequence = 0;
  let currentTime = NOW.getTime();
  /** @type {AuditEvent[]} */
  const auditEvents = [];
  const repository = createInMemoryIdentityRepository();
  const service = createIdentityAccessService({
    auditPort: {
      append: async (event) => {
        auditEvents.push(event);
      },
    },
    clock: () => new Date(currentTime),
    envelopeKey: ENVELOPE_KEY,
    idFactory: (prefix) => `${prefix}-${++tokenSequence}`,
    passwordParameters: { memory: 64, parallelism: 2, passes: 2 },
    repository,
    tokenFactory: () => `opaque-token-${++tokenSequence}-with-enough-entropy`,
  });
  return {
    advance: (/** @type {number} */ milliseconds) => {
      currentTime += milliseconds;
    },
    auditEvents,
    repository,
    service,
  };
}

/**
 * @param {ReturnType<typeof createInMemoryIdentityRepository>} repository
 * @returns {ReturnType<typeof createInMemoryIdentityRepository>}
 */
function asAsyncRepository(repository) {
  const entries = Object.entries(repository).map(([name, operation]) => {
    /** @param {...unknown} args */
    const invoke = async (...args) =>
      Reflect.apply(operation, repository, args);
    return [name, invoke];
  });
  return /** @type {ReturnType<typeof createInMemoryIdentityRepository>} */ (
    /** @type {unknown} */ (Object.freeze(Object.fromEntries(entries)))
  );
}

test('supports asynchronous repository ports used by PostgreSQL adapters', async () => {
  let sequence = 0;
  const repository = createInMemoryIdentityRepository();
  const service = createIdentityAccessService({
    auditPort: { append: async () => undefined },
    clock: () => NOW,
    envelopeKey: ENVELOPE_KEY,
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    passwordParameters: { memory: 64, parallelism: 2, passes: 2 },
    repository: asAsyncRepository(repository),
    tokenFactory: () => `opaque-token-${++sequence}-with-enough-entropy`,
  });

  const { user } = await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap-async',
    email: 'admin@example.test',
    functionName: 'Atendimento',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });
  await service.enrollTotp({ actorId: user.id, secret: Buffer.alloc(20, 3) });
  const login = await service.login({
    email: 'admin@example.test',
    password: 'correct horse battery staple',
    totpCode: service.currentTotpForTesting(Buffer.alloc(20, 3)),
  });

  assert.equal(
    (await service.authenticate(login.sessionToken)).userId,
    user.id,
  );
  await service.logout(login.sessionToken);
  await assert.rejects(service.authenticate(login.sessionToken), /session/iu);
});

test('delegates active-session validation and touch to atomic repository operations', async () => {
  let sequence = 0;
  const base = createInMemoryIdentityRepository();
  /** @type {string[]} */
  const calls = [];
  const repository = {
    ...base,
    /** @param {string} tokenHash @param {string} touchedAt @param {string} idleExpiresBefore */
    authenticateSession: async (tokenHash, touchedAt, idleExpiresBefore) => {
      calls.push('authenticate');
      return base.authenticateSession(tokenHash, touchedAt, idleExpiresBefore);
    },
    findSession: () => {
      throw new Error('non-atomic session lookup used');
    },
    touchSession: () => {
      throw new Error('non-atomic session touch used');
    },
    /** @param {string} tokenHash @param {string} csrfHash @param {string} touchedAt @param {string} idleExpiresBefore */
    validateCsrfSession: async (
      tokenHash,
      csrfHash,
      touchedAt,
      idleExpiresBefore,
    ) => {
      calls.push('csrf');
      return base.validateCsrfSession(
        tokenHash,
        csrfHash,
        touchedAt,
        idleExpiresBefore,
      );
    },
  };
  const service = createIdentityAccessService({
    auditPort: { append: async () => undefined },
    clock: () => NOW,
    envelopeKey: ENVELOPE_KEY,
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    passwordParameters: { memory: 64, parallelism: 2, passes: 2 },
    repository,
    tokenFactory: () => `opaque-token-${++sequence}-with-enough-entropy`,
  });
  const { user } = await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap-atomic',
    email: 'admin@example.test',
    functionName: 'Atendimento',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });
  await service.enrollTotp({ actorId: user.id, secret: Buffer.alloc(20, 3) });
  const login = await service.login({
    email: 'admin@example.test',
    password: 'correct horse battery staple',
    totpCode: service.currentTotpForTesting(Buffer.alloc(20, 3)),
  });

  await service.authenticate(login.sessionToken);
  await service.assertCsrf(login.sessionToken, login.csrfToken);
  assert.deepEqual(calls, ['authenticate', 'csrf']);
});

test('runs the same password verifier path for existing and missing accounts', async () => {
  let sequence = 0;
  const repository = createInMemoryIdentityRepository();
  /** @type {string[]} */
  const verifiedHashes = [];
  const unknownUserPasswordHash = '$argon2id$v=19$dummy-hash';
  const service = createIdentityAccessService({
    auditPort: { append: async () => undefined },
    clock: () => NOW,
    envelopeKey: ENVELOPE_KEY,
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    passwordParameters: { memory: 64, parallelism: 2, passes: 2 },
    passwordVerifier: async (_password, passwordHash) => {
      verifiedHashes.push(passwordHash);
      return false;
    },
    repository,
    tokenFactory: () => `opaque-token-${++sequence}-with-enough-entropy`,
    unknownUserPasswordHash,
  });
  await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap-enumeration',
    email: 'admin@example.test',
    functionName: 'Atendimento',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });

  await assert.rejects(
    service.login({
      email: 'missing@example.test',
      password: 'wrong password value',
    }),
    /invalid credentials/iu,
  );
  await assert.rejects(
    service.login({
      email: 'admin@example.test',
      password: 'wrong password value',
    }),
    /invalid credentials/iu,
  );

  assert.equal(verifiedHashes.length, 2);
  assert.equal(verifiedHashes[0], unknownUserPasswordHash);
  assert.equal(verifiedHashes[1], repository.inspect().users[0].passwordHash);
});

test('hashes passwords with Argon2id and verifies without storing plaintext', async () => {
  const encoded = await hashPassword('correct horse battery staple', {
    memory: 64,
    parallelism: 2,
    passes: 2,
  });

  assert.match(encoded, /^\$argon2id\$/u);
  assert.doesNotMatch(encoded, /correct horse/u);
  assert.equal(
    await verifyPassword('correct horse battery staple', encoded),
    true,
  );
  assert.equal(await verifyPassword('wrong password', encoded), false);
});

test('bootstraps exactly one audited Admin and consumes an expiring invite once', async () => {
  const { auditEvents, service } = harness();
  const bootstrapAttempts = await Promise.allSettled([
    service.bootstrapAdmin({
      correlationId: 'correlation-bootstrap',
      email: 'admin@example.test',
      functionName: 'Atendimento',
      password: 'correct horse battery staple',
      reason: 'Provisionamento inicial autorizado',
    }),
    service.bootstrapAdmin({
      correlationId: 'correlation-concurrent',
      email: 'other@example.test',
      functionName: 'Vendedor',
      password: 'another correct horse battery staple',
      reason: 'Tentativa concorrente',
    }),
  ]);
  const fulfilledBootstrap = bootstrapAttempts.find(
    (attempt) => attempt.status === 'fulfilled',
  );
  assert.ok(fulfilledBootstrap);
  const bootstrap = fulfilledBootstrap.value;

  assert.deepEqual(bootstrap.user.capabilities, ['COMMERCIAL_ADMIN']);
  assert.equal(
    bootstrapAttempts.filter((attempt) => attempt.status === 'fulfilled')
      .length,
    1,
  );
  assert.equal(auditEvents[0].action, 'identity.admin.bootstrapped');
  assert.equal(Object.hasOwn(auditEvents[0], 'email'), false);
  assert.equal(
    bootstrapAttempts.filter((attempt) => attempt.status === 'rejected').length,
    1,
  );

  const invitation = await service.createInvitation({
    actorId: bootstrap.user.id,
    correlationId: 'correlation-invite',
    email: 'seller@example.test',
    expiresAt: new Date(NOW.getTime() + 60_000),
    functionName: 'Vendedor',
    reason: 'Entrada no time comercial',
  });
  const acceptAttempts = await Promise.allSettled([
    service.acceptInvitation({
      password: 'seller correct horse battery staple',
      token: invitation.token,
    }),
    service.acceptInvitation({
      password: 'seller correct horse battery staple',
      token: invitation.token,
    }),
  ]);
  const fulfilledAcceptance = acceptAttempts.find(
    (attempt) => attempt.status === 'fulfilled',
  );
  assert.ok(fulfilledAcceptance);
  const accepted = fulfilledAcceptance.value;
  assert.equal(accepted.functionName, 'Vendedor');
  assert.equal(
    acceptAttempts.filter((attempt) => attempt.status === 'fulfilled').length,
    1,
  );
  assert.match(
    String(
      acceptAttempts.find((attempt) => attempt.status === 'rejected')?.reason,
    ),
    /invalid or expired/iu,
  );
});

test('creates only hashed opaque sessions and enforces CSRF, logout and expiry', async () => {
  const { advance, repository, service } = harness();
  const { user } = await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap',
    email: 'admin@example.test',
    functionName: 'Atendimento',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });
  await service.enrollTotp({ actorId: user.id, secret: Buffer.alloc(20, 3) });
  const code = service.currentTotpForTesting(Buffer.alloc(20, 3));
  const login = await service.login({
    email: 'admin@example.test',
    password: 'correct horse battery staple',
    totpCode: code,
  });

  assert.match(login.cookie, /HttpOnly/iu);
  assert.match(login.cookie, /Secure/iu);
  assert.match(login.cookie, /SameSite=Lax/iu);
  assert.equal(Object.hasOwn(login.body, 'token'), false);
  assert.match(repository.inspect().sessions[0].tokenHash, /^[a-f0-9]{64}$/u);
  assert.equal(
    repository.inspect().sessions[0].tokenHash.includes('opaque-token'),
    false,
  );
  assert.equal(
    (await service.authenticate(login.sessionToken)).userId,
    user.id,
  );
  const lastSeenBeforeInvalidCsrf = repository.inspect().sessions[0].lastSeenAt;
  advance(60_000);
  await assert.rejects(
    service.assertCsrf(login.sessionToken, 'invalid-csrf-token'),
    /CSRF/iu,
  );
  assert.equal(
    repository.inspect().sessions[0].lastSeenAt,
    lastSeenBeforeInvalidCsrf,
  );
  await service.assertCsrf(login.sessionToken, login.csrfToken);
  assert.notEqual(
    repository.inspect().sessions[0].lastSeenAt,
    lastSeenBeforeInvalidCsrf,
  );
  await service.logout(login.sessionToken);
  await assert.rejects(service.authenticate(login.sessionToken), /session/iu);
});

test('requires encrypted TOTP for privileged users and consumes recovery codes once', async () => {
  const { repository, service } = harness();
  const { user } = await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap',
    email: 'admin@example.test',
    functionName: 'Atendimento',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });
  await assert.rejects(
    service.login({
      email: 'admin@example.test',
      password: 'correct horse battery staple',
    }),
    /MFA enrollment required/iu,
  );

  const enrollment = await service.enrollTotp({
    actorId: user.id,
    secret: Buffer.alloc(20, 5),
  });
  assert.equal(enrollment.recoveryCodes.length, 8);
  assert.doesNotMatch(
    JSON.stringify(repository.inspect()),
    new RegExp(Buffer.alloc(20, 5).toString('hex'), 'u'),
  );

  const first = await service.login({
    email: 'admin@example.test',
    password: 'correct horse battery staple',
    recoveryCode: enrollment.recoveryCodes[0],
  });
  assert.equal(first.body.mfaVerified, true);
  await assert.rejects(
    service.login({
      email: 'admin@example.test',
      password: 'correct horse battery staple',
      recoveryCode: enrollment.recoveryCodes[0],
    }),
    /invalid MFA/iu,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdentityAccessService,
  createInMemoryIdentityRepository,
  hashPassword,
  verifyPassword,
} from '../modules/identity-access/src/index.js';

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
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    passwordParameters: { memory: 64, parallelism: 2, passes: 2 },
    repository: asAsyncRepository(repository),
    tokenFactory: () => `opaque-token-${++sequence}-with-enough-entropy`,
  });

  const { user } = await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap-async',
    email: 'admin@example.test',
    functionName: 'Vendedor',
    name: 'Admin Comercial',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });
  const login = await service.login({
    email: 'admin@example.test',
    password: 'correct horse battery staple',
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
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    passwordParameters: { memory: 64, parallelism: 2, passes: 2 },
    repository,
    tokenFactory: () => `opaque-token-${++sequence}-with-enough-entropy`,
  });
  const { user } = await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap-atomic',
    email: 'admin@example.test',
    functionName: 'Vendedor',
    name: 'Admin Comercial',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });
  const login = await service.login({
    email: 'admin@example.test',
    password: 'correct horse battery staple',
  });

  await service.authenticate(login.sessionToken);
  assert.deepEqual(
    await service.assertCsrf(login.sessionToken, login.csrfToken),
    { userId: user.id },
  );
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
    functionName: 'Vendedor',
    name: 'Admin Comercial',
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
  assert.equal(
    verifiedHashes[1],
    (await repository.inspect()).users[0].passwordHash,
  );
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

test('bootstraps exactly one audited Admin and creates the first seller account', async () => {
  const { auditEvents, service } = harness();
  const bootstrapAttempts = await Promise.allSettled([
    service.bootstrapAdmin({
      correlationId: 'correlation-bootstrap',
      email: 'admin@example.test',
      functionName: 'Vendedor',
      name: 'Admin Comercial',
      password: 'correct horse battery staple',
      reason: 'Provisionamento inicial autorizado',
    }),
    service.bootstrapAdmin({
      correlationId: 'correlation-concurrent',
      email: 'other@example.test',
      functionName: 'Vendedor',
      name: 'Admin Comercial',
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

  const created = await service.createOperationalUser({
    actorId: bootstrap.user.id,
    correlationId: 'correlation-create-seller',
    email: 'seller@example.test',
    name: 'Vendedora Silmer',
    password: 'x',
    reason: 'Entrada no time comercial',
  });
  assert.equal(created.user.functionName, 'Vendedor');
  assert.equal(created.user.name, 'Vendedora Silmer');
  assert.deepEqual(created.user.capabilities, []);
  assert.equal(auditEvents.at(-1)?.action, 'identity.user.created');

  // The e-mail is the only uniqueness rule, and it ignores case.
  await assert.rejects(
    service.createOperationalUser({
      actorId: bootstrap.user.id,
      correlationId: 'correlation-duplicate-seller',
      email: 'SELLER@example.test',
      name: 'Outra Pessoa',
      password: 'another password',
      reason: 'Tentativa duplicada',
    }),
    (/** @type {any} */ error) => error.code === 'EMAIL_ALREADY_REGISTERED',
  );

  // A seller cannot manage accounts.
  await assert.rejects(
    service.listUsers({ actorId: created.user.id }),
    (/** @type {any} */ error) => error.statusCode === 403,
  );
});

test('creates only hashed opaque sessions and enforces CSRF, logout and expiry', async () => {
  const { advance, repository, service } = harness();
  const { user } = await service.bootstrapAdmin({
    correlationId: 'correlation-bootstrap',
    email: 'admin@example.test',
    functionName: 'Vendedor',
    name: 'Admin Comercial',
    password: 'correct horse battery staple',
    reason: 'Provisionamento inicial autorizado',
  });
  const login = await service.login({
    email: 'admin@example.test',
    password: 'correct horse battery staple',
  });

  assert.match(login.cookie, /HttpOnly/iu);
  assert.match(login.cookie, /Secure/iu);
  assert.match(login.cookie, /SameSite=Lax/iu);
  assert.equal(Object.hasOwn(login.body, 'token'), false);
  assert.match(
    (await repository.inspect()).sessions[0].tokenHash,
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(
    (await repository.inspect()).sessions[0].tokenHash.includes('opaque-token'),
    false,
  );
  assert.equal(
    (await service.authenticate(login.sessionToken)).userId,
    user.id,
  );
  const lastSeenBeforeInvalidCsrf = (await repository.inspect()).sessions[0]
    .lastSeenAt;
  advance(60_000);
  await assert.rejects(
    service.assertCsrf(login.sessionToken, 'invalid-csrf-token'),
    /CSRF/iu,
  );
  assert.equal(
    (await repository.inspect()).sessions[0].lastSeenAt,
    lastSeenBeforeInvalidCsrf,
  );
  await service.assertCsrf(login.sessionToken, login.csrfToken);
  assert.notEqual(
    (await repository.inspect()).sessions[0].lastSeenAt,
    lastSeenBeforeInvalidCsrf,
  );
  await service.logout(login.sessionToken);
  await assert.rejects(service.authenticate(login.sessionToken), /session/iu);
});

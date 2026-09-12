import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccessControlError,
  authorize,
  CAPABILITIES,
  createAccessControlService,
} from '../modules/identity-access/src/authorization.js';

test('classifies expected ACL denials for the HTTP boundary', () => {
  const actor = {
    capabilities: [],
    functionName: /** @type {const} */ ('Vendedor'),
    id: 'seller-1',
  };

  assert.throws(
    () => authorize(actor, 'sale.approve'),
    (error) =>
      error instanceof AccessControlError &&
      error.statusCode === 403 &&
      error.code === 'FORBIDDEN',
  );
});

/**
 * @typedef {'COMMERCIAL_ADMIN'} Capability
 * @typedef {{
 *   capabilities: Capability[],
 *   functionName: 'Vendedor',
 *   id: string,
 *   kind?: 'human'|'assistant',
 * }} TestUser
 * @typedef {{
 *   actor: string,
 *   action: string,
 *   target: {type: string, id: string},
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 * }} AuditEvent
 */

test('keeps operational functions and orthogonal capabilities deny-by-default', () => {
  /** @type {TestUser} */
  const seller = {
    capabilities: [],
    functionName: 'Vendedor',
    id: 'seller-1',
    kind: 'human',
  };
  const admin = {
    ...seller,
    capabilities: [CAPABILITIES.COMMERCIAL_ADMIN],
  };
  assert.doesNotThrow(() => authorize(seller, 'deal.draft.edit'));
  assert.throws(() => authorize(seller, 'sale.approve'), /forbidden/iu);
  assert.throws(() => authorize(seller, 'user.manage'), /forbidden/iu);
  // The capability, not the operational function, is what opens the
  // administrative actions.
  assert.doesNotThrow(() => authorize(admin, 'sale.approve'));
  assert.doesNotThrow(() => authorize(admin, 'user.manage'));
  assert.doesNotThrow(() => authorize(admin, 'deal.draft.edit'));
  assert.throws(
    () =>
      authorize(
        {
          capabilities: [CAPABILITIES.COMMERCIAL_ADMIN],
          functionName: 'Vendedor',
          id: 'agent-1',
          kind: 'assistant',
        },
        'order-form.approve',
      ),
    /forbidden/iu,
  );
});

function harness() {
  /** @type {Map<string, TestUser>} */
  const users = new Map([
    [
      'admin-1',
      {
        capabilities: [CAPABILITIES.COMMERCIAL_ADMIN],
        functionName: 'Vendedor',
        id: 'admin-1',
      },
    ],
    [
      'seller-1',
      {
        capabilities: [],
        functionName: 'Vendedor',
        id: 'seller-1',
      },
    ],
  ]);
  /** @type {AuditEvent[]} */
  const auditEvents = [];
  /** @type {Array<{id: string, occurredAt: string}>} */
  const revocations = [];
  const service = createAccessControlService({
    auditPort: {
      append: async (event) => {
        auditEvents.push(event);
      },
    },
    clock: () => new Date('2026-08-30T12:00:00.000Z'),
    repository: {
      findUser: async (id) => users.get(id) ?? null,
      grant: async (id, capability) => {
        const user = requireUser(users, id);
        if (!user.capabilities.includes(capability))
          user.capabilities.push(capability);
      },
      revoke: async (id, capability) => {
        const user = requireUser(users, id);
        user.capabilities = user.capabilities.filter(
          (item) => item !== capability,
        );
      },
      revokePrivilegedSessions: async (id, occurredAt) => {
        revocations.push({ id, occurredAt });
      },
    },
  });
  return { auditEvents, revocations, service, users };
}

test('prevents self-assignment and permits privileged grants without MFA', async () => {
  const { service, users } = harness();
  await assert.rejects(
    service.grantCapability({
      actorId: 'admin-1',
      capability: CAPABILITIES.COMMERCIAL_ADMIN,
      correlationId: 'correlation-self',
      reason: 'Tentativa de autoatribuição',
      targetId: 'admin-1',
    }),
    /self-assign/iu,
  );
  await service.grantCapability({
    actorId: 'admin-1',
    capability: CAPABILITIES.COMMERCIAL_ADMIN,
    correlationId: 'correlation-grant',
    reason: 'Cobertura comercial autorizada',
    targetId: 'seller-1',
  });
  assert.deepEqual(requireUser(users, 'seller-1').capabilities, [
    CAPABILITIES.COMMERCIAL_ADMIN,
  ]);
  await assert.rejects(
    service.revokeCapability({
      actorId: 'admin-1',
      capability: CAPABILITIES.COMMERCIAL_ADMIN,
      correlationId: 'correlation-self-revoke',
      reason: 'Tentativa de revogação pelo próprio Admin',
      targetId: 'admin-1',
    }),
    /Another Admin/iu,
  );
});

test('classifies malformed targets separately from forbidden ACL changes', async () => {
  const { service } = harness();
  await assert.rejects(
    service.grantCapability({
      actorId: 'admin-1',
      capability: CAPABILITIES.COMMERCIAL_ADMIN,
      correlationId: 'correlation-missing-target',
      reason: 'Alvo ausente',
      targetId: 'missing-user',
    }),
    (error) =>
      error instanceof AccessControlError &&
      error.statusCode === 404 &&
      error.code === 'NOT_FOUND',
  );
  await assert.rejects(
    service.grantCapability({
      actorId: 'admin-1',
      capability: CAPABILITIES.COMMERCIAL_ADMIN,
      correlationId: 'correlation-self-grant',
      reason: 'Autoatribuicao negada',
      targetId: 'admin-1',
    }),
    (error) =>
      error instanceof AccessControlError &&
      error.statusCode === 403 &&
      error.code === 'FORBIDDEN',
  );
});

test('audits grants and revokes privileged sessions immediately', async () => {
  const { auditEvents, revocations, service, users } = harness();
  requireUser(users, 'seller-1').capabilities.push(
    CAPABILITIES.COMMERCIAL_ADMIN,
  );
  await service.revokeCapability({
    actorId: 'admin-1',
    capability: CAPABILITIES.COMMERCIAL_ADMIN,
    correlationId: 'correlation-revoke',
    reason: 'Fim da cobertura comercial',
    targetId: 'seller-1',
  });

  assert.deepEqual(requireUser(users, 'seller-1').capabilities, []);
  assert.equal(revocations.length, 1);
  assert.deepEqual(auditEvents[0], {
    action: 'identity.capability.revoked',
    actor: 'admin-1',
    correlationId: 'correlation-revoke',
    reason: 'Fim da cobertura comercial',
    target: { id: 'seller-1', type: 'user' },
    version: CAPABILITIES.COMMERCIAL_ADMIN,
  });
});

/** @param {Map<string, TestUser>} users @param {string} id @returns {TestUser} */
function requireUser(users, id) {
  const user = users.get(id);
  assert.ok(user);
  return user;
}

test('keeps a single operational allowlist for API guards and the policy', async () => {
  const { OPERATIONAL_ACTIONS } =
    await import('../modules/identity-access/src/index.js');
  // Regression guard: apps/api/src/identity-runtime.js used to keep its own
  // copy of this set. It drifted, lost every conversation write action, and
  // answered the whole Inbox with 403.
  for (const action of [
    'contact.rename',
    'conversation.archive',
    'conversation.message.send',
    'conversation.reactivate-agent',
    'conversation.read',
    'conversation.takeover',
    'conversation.transfer',
    'conversation.transition',
    'handoff.read',
    'handoff.claim',
  ]) {
    assert.ok(
      OPERATIONAL_ACTIONS.has(action),
      `${action} must stay in the shared operational allowlist`,
    );
  }
  const runtimeSource = await import('node:fs/promises').then((fs) =>
    fs.readFile('apps/api/src/identity-runtime.js', 'utf8'),
  );
  assert.ok(
    !/const OPERATIONAL_ACTIONS\s*=/u.test(runtimeSource),
    'identity-runtime must import the allowlist instead of redeclaring it',
  );
});

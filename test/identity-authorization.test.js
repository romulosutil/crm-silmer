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
    mfaEnrolled: false,
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
 * @typedef {'COMMERCIAL_ADMIN'|'PRIVACY_OFFICER'|'TECHNICAL_PRIVACY_EXECUTOR'} Capability
 * @typedef {{
 *   capabilities: Capability[],
 *   functionName: 'Atendimento'|'Vendedor',
 *   id: string,
 *   kind?: 'human'|'assistant',
 *   mfaEnrolled: boolean,
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
    mfaEnrolled: false,
  };
  assert.doesNotThrow(() => authorize(seller, 'deal.draft.edit'));
  assert.throws(() => authorize(seller, 'sale.approve'), /forbidden/iu);
  assert.throws(
    () =>
      authorize(
        { ...seller, capabilities: [CAPABILITIES.PRIVACY_OFFICER] },
        'sale.approve',
      ),
    /forbidden/iu,
  );
  assert.doesNotThrow(() =>
    authorize(
      { ...seller, capabilities: [CAPABILITIES.PRIVACY_OFFICER] },
      'privacy.legal-hold.authorize',
    ),
  );
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
        functionName: 'Atendimento',
        id: 'admin-1',
        mfaEnrolled: true,
      },
    ],
    [
      'seller-1',
      {
        capabilities: [],
        functionName: 'Vendedor',
        id: 'seller-1',
        mfaEnrolled: false,
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

test('prevents self-assignment and requires MFA before privileged grants', async () => {
  const { service, users } = harness();
  await assert.rejects(
    service.grantCapability({
      actorId: 'admin-1',
      capability: CAPABILITIES.PRIVACY_OFFICER,
      correlationId: 'correlation-self',
      reason: 'Tentativa de autoatribuição',
      targetId: 'admin-1',
    }),
    /self-assign/iu,
  );
  await assert.rejects(
    service.grantCapability({
      actorId: 'admin-1',
      capability: CAPABILITIES.COMMERCIAL_ADMIN,
      correlationId: 'correlation-no-mfa',
      reason: 'Promoção sem MFA',
      targetId: 'seller-1',
    }),
    /MFA/iu,
  );
  requireUser(users, 'seller-1').mfaEnrolled = true;
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
      capability: CAPABILITIES.PRIVACY_OFFICER,
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
      capability: CAPABILITIES.PRIVACY_OFFICER,
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

  requireUser(users, 'seller-1').capabilities.push(
    CAPABILITIES.PRIVACY_OFFICER,
  );
  await service.revokeCapability({
    actorId: 'admin-1',
    capability: CAPABILITIES.PRIVACY_OFFICER,
    correlationId: 'correlation-privacy-revoke',
    reason: 'Fim da responsabilidade de privacidade',
    targetId: 'seller-1',
  });
  assert.equal(revocations.length, 2);
});

/** @param {Map<string, TestUser>} users @param {string} id @returns {TestUser} */
function requireUser(users, id) {
  const user = users.get(id);
  assert.ok(user);
  return user;
}

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContactIdentityConflictError,
  ContactIdentityForbiddenError,
  InMemoryContactIdentityRepository,
  createContactIdentityService,
} from '../modules/contacts/src/index.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const ATTENDANT = Object.freeze({
  functionName: 'Atendimento',
  id: 'user-attendant-1',
  kind: 'human',
});
const SELLER = Object.freeze({
  functionName: 'Vendedor',
  id: 'user-seller-1',
  kind: 'human',
});

function createHarness() {
  /** @type {any[]} */
  const audits = [];
  let sequence = 0;
  const repository = new InMemoryContactIdentityRepository();
  const service = createContactIdentityService({
    auditPort: {
      async append(/** @type {any} */ event) {
        audits.push(structuredClone(event));
      },
    },
    clock: () => NOW,
    idFactory: (kind) => `${kind}-${++sequence}`,
    repository,
  });
  return { audits, repository, service };
}

function inboundIdentity(overrides = {}) {
  return {
    channel: 'instagram',
    correlationId: 'correlation-inbound-1',
    displayHandle: '@cliente_sintetico',
    externalIdentityId: 'external-identity-1',
    identityKind: 'handle',
    occurredAt: NOW.toISOString(),
    phoneStatus: 'pending',
    provider: 'meta',
    providerAccountId: 'account-a',
    ...overrides,
  };
}

test('anchors inbound identity to one provisional contact without automatic merge', async () => {
  const { service } = createHarness();

  const first = await service.resolveInboundIdentity(inboundIdentity());
  const replay = await service.resolveInboundIdentity(inboundIdentity());
  const otherAccount = await service.resolveInboundIdentity(
    inboundIdentity({
      correlationId: 'correlation-inbound-2',
      providerAccountId: 'account-b',
    }),
  );

  assert.deepEqual(replay, first);
  assert.equal(first.contact.provisional, true);
  assert.equal(first.identity.contactId, first.contact.id);
  assert.equal(first.identity.displayHandle, '@cliente_sintetico');
  assert.equal(first.identity.phoneStatus, 'pending');
  assert.equal(first.identity.automaticMergeAllowed, false);
  assert.notEqual(otherAccount.identity.id, first.identity.id);
  assert.notEqual(otherAccount.contact.id, first.contact.id);
});

test('merges and unmerges Identity to Contact reversibly with minimal audit envelopes', async () => {
  const { audits, service } = createHarness();
  const instagram = await service.resolveInboundIdentity(inboundIdentity());
  const whatsapp = await service.resolveInboundIdentity(
    inboundIdentity({
      channel: 'whatsapp',
      correlationId: 'correlation-whatsapp',
      displayHandle: null,
      externalIdentityId: '5511999999999',
      identityKind: 'phone',
      phoneStatus: 'confirmed',
    }),
  );

  const merged = await service.mergeIdentity({
    actor: ATTENDANT,
    correlationId: 'correlation-merge',
    expectedVersion: instagram.identity.version,
    idempotencyKey: 'merge-key-1',
    identityId: instagram.identity.id,
    reason: 'Cliente confirmou continuidade no WhatsApp',
    targetContactId: whatsapp.contact.id,
  });
  assert.equal(merged.identity.contactId, whatsapp.contact.id);
  assert.equal(merged.link.sourceContactId, instagram.contact.id);
  assert.equal(merged.link.targetContactId, whatsapp.contact.id);
  assert.equal(merged.link.status, 'active');

  const unmerged = await service.unmergeIdentity({
    actor: SELLER,
    correlationId: 'correlation-unmerge',
    expectedVersion: merged.identity.version,
    idempotencyKey: 'unmerge-key-1',
    linkId: merged.link.id,
    reason: 'Confirmação posterior mostrou titulares distintos',
  });
  assert.equal(unmerged.identity.contactId, instagram.contact.id);
  assert.equal(unmerged.link.status, 'reverted');
  assert.deepEqual(
    audits.map(({ action, actor, correlationId, target }) => ({
      action,
      actor,
      correlationId,
      target,
    })),
    [
      {
        action: 'contact.identity.merged',
        actor: ATTENDANT.id,
        correlationId: 'correlation-merge',
        target: { id: instagram.identity.id, type: 'contact_identity' },
      },
      {
        action: 'contact.identity.unmerged',
        actor: SELLER.id,
        correlationId: 'correlation-unmerge',
        target: { id: instagram.identity.id, type: 'contact_identity' },
      },
    ],
  );
  assert.doesNotMatch(JSON.stringify(audits), /@cliente|5511999999999/u);
});

test('allows only Atendimento or Vendedor humans to merge identities', async () => {
  const { service } = createHarness();
  const source = await service.resolveInboundIdentity(inboundIdentity());
  const target = await service.resolveInboundIdentity(
    inboundIdentity({ externalIdentityId: 'external-identity-2' }),
  );
  const command = {
    correlationId: 'correlation-forbidden',
    expectedVersion: source.identity.version,
    idempotencyKey: 'forbidden-key',
    identityId: source.identity.id,
    reason: 'Tentativa sintética',
    targetContactId: target.contact.id,
  };

  for (const actor of [
    { functionName: 'Atendimento', id: 'assistant-1', kind: 'assistant' },
    { functionName: 'Admin', id: 'user-admin-1', kind: 'human' },
  ]) {
    await assert.rejects(
      service.mergeIdentity({ ...command, actor }),
      ContactIdentityForbiddenError,
    );
  }
});

test('coalesces identical concurrent merge commands and rejects competing ownership', async () => {
  const { audits, service } = createHarness();
  const source = await service.resolveInboundIdentity(inboundIdentity());
  const left = await service.resolveInboundIdentity(
    inboundIdentity({ externalIdentityId: 'left' }),
  );
  const right = await service.resolveInboundIdentity(
    inboundIdentity({ externalIdentityId: 'right' }),
  );
  const command = {
    actor: ATTENDANT,
    correlationId: 'correlation-concurrent',
    expectedVersion: source.identity.version,
    idempotencyKey: 'merge-concurrent',
    identityId: source.identity.id,
    reason: 'Evidência humana sintética',
    targetContactId: left.contact.id,
  };

  const [first, replay] = await Promise.all([
    service.mergeIdentity(command),
    service.mergeIdentity(command),
  ]);
  assert.deepEqual(replay, first);
  assert.equal(
    audits.filter(({ action }) => action === 'contact.identity.merged').length,
    1,
  );
  await assert.rejects(
    service.mergeIdentity({
      ...command,
      expectedVersion: first.identity.version,
      idempotencyKey: 'merge-competing',
      targetContactId: right.contact.id,
    }),
    ContactIdentityConflictError,
  );
});

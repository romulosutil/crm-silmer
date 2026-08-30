import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConfigurationConflictError,
  ConfigurationForbiddenError,
  ConfigurationValidationError,
  createConfigurationService,
} from '../modules/configuration/src/index.js';

/** @typedef {Awaited<ReturnType<ReturnType<typeof createConfigurationService>['createVersion']>>} StoredConfigurationVersion */

const ADMIN_ACTOR = Object.freeze({
  capabilities: ['COMMERCIAL_ADMIN'],
  id: 'user-admin-1',
});

function validValues() {
  return {
    channels: {
      instagram: { enabled: false },
      whatsapp: { enabled: true },
    },
    fab: { code: '01', displayName: 'FAB 01' },
    featureFlags: {
      vendedor_silmer_autonomia_comercial: false,
    },
    pix: {
      keyReference: 'secret://payments/pix-primary',
      maskedKey: 'r***@s***.com',
    },
    recipient: {
      name: 'Rose',
      phone: '+5527999010303',
    },
    templates: {
      onboarding: { enabled: true, version: 'onboarding-v1' },
      pixInstructions: { enabled: true, version: 'pix-v1' },
    },
  };
}

function createHarness() {
  /** @type {StoredConfigurationVersion[]} */
  const versions = [];
  /** @type {Array<Record<string, unknown>>} */
  const auditEvents = [];
  let sequence = 0;

  const service = createConfigurationService({
    auditPort: {
      async append(event, context) {
        assert.deepEqual(context.transaction, { id: 'tx-1' });
        auditEvents.push(/** @type {Record<string, unknown>} */ (event));
      },
    },
    clock: () => new Date('2026-08-30T12:00:00.000Z'),
    idFactory: () => `configuration-${++sequence}`,
    repository: {
      async append(version, context) {
        assert.deepEqual(context.transaction, { id: 'tx-1' });
        versions.push(/** @type {StoredConfigurationVersion} */ (version));
      },
      async findCurrent(context) {
        assert.deepEqual(context.transaction, { id: 'tx-1' });
        return versions.at(-1) ?? null;
      },
    },
    transactionPort: {
      async run(work) {
        return work({ id: 'tx-1' });
      },
    },
  });

  return { auditEvents, service, versions };
}

test('creates immutable configuration versions and preserves history', async () => {
  const { auditEvents, service, versions } = createHarness();

  const first = await service.createVersion({
    actor: ADMIN_ACTOR,
    correlationId: 'correlation-1',
    expectedVersion: 0,
    reason: 'Configuração inicial aprovada para o piloto',
    values: validValues(),
  });
  const secondValues = validValues();
  secondValues.templates.onboarding.version = 'onboarding-v2';
  const second = await service.createVersion({
    actor: ADMIN_ACTOR,
    correlationId: 'correlation-2',
    expectedVersion: 1,
    reason: 'Publicar nova versão do onboarding',
    values: secondValues,
  });
  const firstValues = /** @type {ReturnType<typeof validValues>} */ (
    first.values
  );
  const secondStoredValues = /** @type {ReturnType<typeof validValues>} */ (
    second.values
  );

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(firstValues.templates.onboarding.version, 'onboarding-v1');
  assert.equal(
    secondStoredValues.templates.onboarding.version,
    'onboarding-v2',
  );
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.values));
  assert.ok(Object.isFrozen(firstValues.templates.onboarding));
  assert.equal(versions.length, 2);
  assert.equal(auditEvents.length, 2);
});

test('requires COMMERCIAL_ADMIN before reading or mutating configuration', async () => {
  const { auditEvents, service, versions } = createHarness();

  await assert.rejects(
    service.createVersion({
      actor: { capabilities: [], id: 'user-seller-1' },
      correlationId: 'correlation-denied',
      expectedVersion: 0,
      reason: 'Tentativa sem autorização',
      values: validValues(),
    }),
    ConfigurationForbiddenError,
  );

  assert.equal(versions.length, 0);
  assert.equal(auditEvents.length, 0);
});

test('audits privileged changes without copying settings or PIX material', async () => {
  const { auditEvents, service } = createHarness();
  const forbiddenSecret = 'pix-secret-must-never-leak';
  const values = validValues();
  values.pix.keyReference = `secret://payments/${forbiddenSecret}`;

  await service.createVersion({
    actor: ADMIN_ACTOR,
    correlationId: 'correlation-audit',
    expectedVersion: 0,
    reason: 'Configuração inicial',
    values,
  });

  assert.deepEqual(auditEvents[0], {
    action: 'configuration.version.created',
    actor: ADMIN_ACTOR.id,
    correlationId: 'correlation-audit',
    reason: 'Configuração inicial',
    target: { id: 'configuration-1', type: 'configuration' },
    version: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(auditEvents[0]),
    /pix-secret-must-never-leak/u,
  );
  assert.equal(Object.hasOwn(auditEvents[0], 'values'), false);
});

test('rejects raw PIX secrets and keeps the future autonomy flag disabled', async () => {
  const { service } = createHarness();
  const withRawSecret = validValues();
  Object.assign(withRawSecret.pix, {
    rawKey: 'pix-secret-must-never-enter-domain',
  });

  await assert.rejects(
    service.createVersion({
      actor: ADMIN_ACTOR,
      correlationId: 'correlation-secret',
      expectedVersion: 0,
      reason: 'Não pode persistir segredo',
      values: withRawSecret,
    }),
    ConfigurationValidationError,
  );

  const withAutonomy = validValues();
  withAutonomy.featureFlags.vendedor_silmer_autonomia_comercial = true;
  await assert.rejects(
    service.createVersion({
      actor: ADMIN_ACTOR,
      correlationId: 'correlation-autonomy',
      expectedVersion: 0,
      reason: 'Autonomia fora do escopo do MVP',
      values: withAutonomy,
    }),
    ConfigurationValidationError,
  );
});

test('enforces controlled FAB, canonical recipient and optimistic versioning', async () => {
  const { service } = createHarness();
  const invalidFab = validValues();
  invalidFab.fab = { code: 'texto livre', displayName: 'Qualquer fábrica' };

  await assert.rejects(
    service.createVersion({
      actor: ADMIN_ACTOR,
      correlationId: 'correlation-fab',
      expectedVersion: 0,
      reason: 'FAB inválido',
      values: invalidFab,
    }),
    ConfigurationValidationError,
  );

  const invalidRecipient = validValues();
  invalidRecipient.recipient.phone = '+5500000000000';
  await assert.rejects(
    service.createVersion({
      actor: ADMIN_ACTOR,
      correlationId: 'correlation-recipient',
      expectedVersion: 0,
      reason: 'Destinatário fora do contrato',
      values: invalidRecipient,
    }),
    ConfigurationValidationError,
  );

  await service.createVersion({
    actor: ADMIN_ACTOR,
    correlationId: 'correlation-current',
    expectedVersion: 0,
    reason: 'Versão inicial',
    values: validValues(),
  });
  await assert.rejects(
    service.createVersion({
      actor: ADMIN_ACTOR,
      correlationId: 'correlation-stale',
      expectedVersion: 0,
      reason: 'Versão concorrente obsoleta',
      values: validValues(),
    }),
    ConfigurationConflictError,
  );
});

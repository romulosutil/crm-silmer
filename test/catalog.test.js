import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogForbiddenError,
  CatalogValidationError,
  createCatalogService,
} from '../modules/catalog/src/index.js';

const ADMIN = Object.freeze({
  capabilities: ['COMMERCIAL_ADMIN'],
  id: 'admin-1',
});

function data(modelName = 'Camisa Essencial') {
  return {
    materials: [{ code: 'DRY', name: 'Dry fit' }],
    models: [{ code: 'CAM-01', name: modelName, productCode: 'CAM' }],
    products: [{ code: 'CAM', name: 'Camisa' }],
    techniques: [{ code: 'SUB', name: 'Sublimação' }],
  };
}

function harness() {
  /** @type {Array<Awaited<ReturnType<ReturnType<typeof createCatalogService>['publish']>>>} */
  const versions = [];
  /** @type {Record<string, unknown>[]} */
  const auditEvents = [];
  let sequence = 0;
  const service = createCatalogService({
    auditPort: {
      async append(event, context) {
        assert.deepEqual(context.transaction, { id: 'tx-1' });
        auditEvents.push(event);
      },
    },
    clock: () => new Date('2026-08-30T12:00:00.000Z'),
    idFactory: () => `catalog-${++sequence}`,
    repository: {
      async append(version, context) {
        assert.deepEqual(context.transaction, { id: 'tx-1' });
        assert.equal(context.expectedLatestNumber, versions.length);
        versions.push(version);
      },
      findById: async (id) =>
        versions.find((version) => version.id === id) ?? null,
      async list(context) {
        assert.deepEqual(context.transaction, { id: 'tx-1' });
        return versions;
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

test('imports and publishes an immutable authorized catalog version', async () => {
  const { auditEvents, service, versions } = harness();
  const importedValues = data();
  const published = await service.publish({
    actor: ADMIN,
    correlationId: 'correlation-1',
    reason: 'Catálogo inicial aprovado',
    values: importedValues,
  });
  importedValues.models[0].name = 'Mutação posterior indevida';

  assert.equal(published.number, 1);
  assert.equal(published.status, 'published');
  assert.ok(Object.isFrozen(published));
  assert.ok(Object.isFrozen(published.values.models));
  assert.ok(Object.isFrozen(published.values.models[0]));
  assert.equal(published.values.models[0].name, 'Camisa Essencial');
  assert.equal(versions.length, 1);
  assert.deepEqual(auditEvents[0], {
    action: 'catalog.version.published',
    actor: 'admin-1',
    correlationId: 'correlation-1',
    reason: 'Catálogo inicial aprovado',
    target: { id: 'catalog-1', type: 'catalog-version' },
    version: 1,
  });
  assert.equal(Object.hasOwn(auditEvents[0], 'values'), false);
});

test('rejects unauthorized, duplicate and cross-reference-invalid imports', async () => {
  const { service } = harness();
  await assert.rejects(
    service.publish({
      actor: { capabilities: [], id: 'seller-1' },
      correlationId: 'correlation-denied',
      reason: 'Sem permissão',
      values: data(),
    }),
    CatalogForbiddenError,
  );

  const duplicate = data();
  duplicate.products.push({ code: 'CAM', name: 'Duplicada' });
  await assert.rejects(
    service.publish({
      actor: ADMIN,
      correlationId: 'correlation-duplicate',
      reason: 'Importação inválida',
      values: duplicate,
    }),
    CatalogValidationError,
  );

  const withUnexpectedData = data();
  Object.assign(withUnexpectedData.materials[0], {
    notes: 'texto livre não autorizado',
  });
  await assert.rejects(
    service.publish({
      actor: ADMIN,
      correlationId: 'correlation-extra',
      reason: 'Campo fora do schema',
      values: withUnexpectedData,
    }),
    CatalogValidationError,
  );

  const orphan = data();
  orphan.models[0].productCode = 'UNKNOWN';
  await assert.rejects(
    service.publish({
      actor: ADMIN,
      correlationId: 'correlation-orphan',
      reason: 'Referência inválida',
      values: orphan,
    }),
    CatalogValidationError,
  );
});

test('binds selection and snapshot to its published version forever', async () => {
  const { service } = harness();
  const first = await service.publish({
    actor: ADMIN,
    correlationId: 'correlation-first',
    reason: 'Catálogo inicial',
    values: data('Camisa Essencial'),
  });
  const selection = await service.select({
    catalogVersionId: first.id,
    materialCode: 'DRY',
    modelCode: 'CAM-01',
    techniqueCode: 'SUB',
  });
  await service.publish({
    actor: ADMIN,
    correlationId: 'correlation-second',
    reason: 'Atualizar nome comercial',
    values: data('Camisa Essencial 2027'),
  });
  const historicalSelection = await service.select({
    catalogVersionId: first.id,
    materialCode: 'DRY',
    modelCode: 'CAM-01',
    techniqueCode: 'SUB',
  });

  assert.equal(selection.catalogVersionId, first.id);
  assert.equal(selection.catalogVersionNumber, 1);
  assert.equal(selection.snapshot.model.name, 'Camisa Essencial');
  assert.equal(historicalSelection.snapshot.model.name, 'Camisa Essencial');
  assert.ok(Object.isFrozen(selection.snapshot));
  assert.ok(Object.isFrozen(selection.snapshot.model));
});

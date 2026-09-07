import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryAuditTrail } from '../modules/audit-privacy/src/index.js';
import { InMemoryDealRepository } from '../modules/deals-pipeline/src/index.js';
import {
  InMemoryQualificationRepository,
  createQualificationCipher,
  createQualificationService,
} from '../modules/qualification/src/index.js';
import { compareFieldPaths } from '../modules/qualification/src/field-registry.js';
import {
  InMemoryDomainEventStore,
  InMemoryIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';

const NOW = new Date('2026-09-07T17:00:00.000Z');
const HUMAN = Object.freeze({
  functionName: 'Vendedor',
  id: 'seller-1',
  kind: 'human',
});

/** @returns {any} */
function completeFields() {
  return {
    artwork: {
      catalogVersionId: 'catalog-v1',
      colors: [{ locationId: 'frente', values: ['branco'] }],
      files: [
        {
          attachmentId: {
            messageId: 'message-1',
            transientMediaId: 'media-1',
          },
          itemId: 'item-1',
          locationId: 'frente',
        },
      ],
      locations: [{ id: 'frente', name: 'Frente' }],
      responsibility: 'cliente',
      status: 'ready',
      techniqueCode: 'silk',
    },
    items: [
      {
        catalogVersionId: 'catalog-v1',
        colors: {
          back: 'azul',
          collarTrim: 'azul',
          front: 'azul',
          leftSleeve: 'azul',
          rightSleeve: 'azul',
          sleeveTrim: 'azul',
        },
        estimatedQuantity: 10,
        fabrics: ['dry-fit'],
        grade: [
          { quantity: 4, size: 'P' },
          { quantity: 6, size: 'M' },
        ],
        id: 'item-1',
        modelCode: 'basica',
        productCode: 'camiseta',
      },
    ],
    logistics: {
      address: 'Rua Exemplo, 10',
      city: 'São Paulo',
      desiredDate: '2026-10-10',
      mode: 'delivery',
      purchaseProfile: 'uso_proprio',
      purpose: 'evento',
    },
    observations: ['Separar por equipe'],
    order: {
      commercialIntent: true,
      customer: 'Cliente Exemplo',
      name: 'Evento Exemplo',
    },
  };
}

/** @param {any} fields @param {any} overrides */
function command(fields, overrides = {}) {
  return {
    actor: HUMAN,
    correlationId: 'qualification-correlation-1',
    dealId: 'deal-1',
    expectedVersion: 1,
    fields,
    idempotencyKey: 'qualification-1',
    reasonCode: 'customer_update',
    ...overrides,
  };
}

/** @param {{stage?: string, version?: number, fence?: (input: any, context?: any) => Promise<any>, catalog?: any}} [options] */
function harness({
  stage = 'produto',
  version = 1,
  fence = async () => undefined,
  catalog,
} = {}) {
  const auditPort = new InMemoryAuditTrail({
    clock: () => NOW,
    idFactory: () => 'audit-qualification-1',
  });
  const dealRepository = new InMemoryDealRepository({
    deals: [
      {
        contactId: 'contact-1',
        createdAt: '2026-09-07T15:00:00.000Z',
        id: 'deal-1',
        sourceConversationId: 'conversation-1',
        stage,
        status: 'active',
        updatedAt: '2026-09-07T15:00:00.000Z',
        version,
      },
    ],
  });
  const eventPort = new InMemoryDomainEventStore({
    clock: () => NOW,
    idFactory: () => 'event-qualification-1',
  });
  const qualificationRepository = new InMemoryQualificationRepository({
    cipher: createQualificationCipher({ key: Buffer.alloc(32, 81) }),
  });
  const service = createQualificationService({
    auditPort,
    attachmentPort: { assertUsable: async () => undefined },
    automationFencePort: { assertCurrent: fence },
    catalogPort: catalog ?? {
      /** @param {any} input */
      async resolveReferences(/** @type {any} */ input) {
        return {
          catalogVersionId: input.catalogVersionId,
          catalogVersionNumber: 1,
          materials: /** @type {string[]} */ (input.materialCodes ?? []).map(
            (code) => ({ code, name: code }),
          ),
          model: input.modelCode
            ? {
                code: input.modelCode,
                name: input.modelCode,
                productCode: input.productCode,
              }
            : null,
          product: input.productCode
            ? { code: input.productCode, name: input.productCode }
            : null,
          technique: input.techniqueCode
            ? { code: input.techniqueCode, name: input.techniqueCode }
            : null,
        };
      },
    },
    clock: () => NOW,
    dealRepository,
    eventPort,
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    qualificationRepository,
  });
  return {
    auditPort,
    dealRepository,
    eventPort,
    qualificationRepository,
    service,
  };
}

test('persists a complete qualification with stable catalog snapshots and encrypted text', async () => {
  const { auditPort, eventPort, qualificationRepository, service } = harness();
  const result = await service.patchFields(command(completeFields()));

  assert.equal(result.deal.version, 2);
  assert.equal(result.deal.stage, 'produto');
  assert.deepEqual(result.readiness, {
    estampa: { blockers: [], complete: true },
    especificacao: { blockers: [], complete: true },
    logistica: { blockers: [], complete: true },
    produto: { blockers: [], complete: true },
  });
  const stored = qualificationRepository.getStored('deal-1');
  assert.equal(stored.items[0].catalogSnapshot.model.code, 'basica');
  assert.doesNotMatch(
    JSON.stringify(stored),
    /Cliente Exemplo|Rua Exemplo|Separar por equipe/iu,
  );
  assert.doesNotMatch(
    JSON.stringify(eventPort.list()),
    /Cliente Exemplo|Rua Exemplo/iu,
  );
  const audits = await auditPort.list();
  assert.doesNotMatch(JSON.stringify(audits), /Cliente Exemplo|Rua Exemplo/iu);
  assert.equal(audits[0].version, '1->2');
});

test('grade mismatch and missing conditional logistics remain explicit blockers', async () => {
  const mismatch = completeFields();
  mismatch.items[0].grade[1].quantity = 5;
  const { qualificationRepository, service } = harness();
  const result = await service.patchFields(command(mismatch));
  assert.deepEqual(result.readiness.especificacao.blockers, [
    'items.item-1.grade.total',
  ]);

  const pickup = completeFields();
  pickup.logistics = {
    desiredDate: '2026-10-10',
    mode: 'pickup',
    purchaseProfile: 'revenda',
    purpose: 'uniforme',
  };
  const second = harness();
  const pickupResult = await second.service.patchFields(command(pickup));
  assert.deepEqual(pickupResult.readiness.logistica.blockers, [
    'logistics.pickupLocation',
  ]);
  assert.equal(
    (
      await qualificationRepository.evaluateGate({
        dealId: 'deal-1',
        stage: 'especificacao',
      })
    ).blockers[0],
    'items.item-1.grade.total',
  );
});

test('requires a reason for not-applicable fields', async () => {
  const fields = completeFields();
  fields.assessments = [
    { field: 'items.item-1.colors.back', status: 'nao_aplicavel' },
  ];
  const { service } = harness();
  await assert.rejects(service.patchFields(command(fields)), /reason/iu);
});

test('returns directly to the first incomplete stage in the same root version', async () => {
  const { dealRepository, eventPort, service } = harness({
    stage: 'logistica',
    version: 7,
  });
  const result = await service.patchFields(
    command(
      {
        ...completeFields(),
        assessments: [
          {
            field: 'items.item-1.model',
            status: 'divergente',
          },
        ],
      },
      { expectedVersion: 7 },
    ),
  );
  assert.equal(result.deal.stage, 'produto');
  assert.equal(result.deal.version, 8);
  assert.equal(dealRepository.listHistory('deal-1')[0].kind, 'returned');
  assert.deepEqual(eventPort.list()[0].payload, {
    changedSections: [
      'artwork',
      'assessments',
      'items',
      'logistics',
      'observations',
      'order',
    ],
    returnedFrom: 'logistica',
    returnedTo: 'produto',
    version: 8,
  });
});

test('replays one patch and rejects one of two concurrent root versions', async () => {
  const replay = harness();
  const input = command(completeFields());
  assert.deepEqual(
    await replay.service.patchFields(input),
    await replay.service.patchFields(input),
  );
  assert.equal(replay.eventPort.list().length, 1);

  const concurrent = harness();
  const outcomes = await Promise.allSettled([
    concurrent.service.patchFields(
      command(completeFields(), { idempotencyKey: 'patch-a' }),
    ),
    concurrent.service.patchFields(
      command(completeFields(), { idempotencyKey: 'patch-b' }),
    ),
  ]);
  assert.equal(
    outcomes.filter(({ status }) => status === 'fulfilled').length,
    1,
  );
  assert.equal(
    outcomes.filter(({ status }) => status === 'rejected').length,
    1,
  );
});

test('normalizes fingerprint key order and enforces the automation fence before persistence', async () => {
  const replay = harness();
  const first = command({
    order: { commercialIntent: true, customer: 'Cliente', name: 'Pedido' },
  });
  const reordered = command({
    order: { name: 'Pedido', customer: 'Cliente', commercialIntent: true },
  });
  assert.deepEqual(
    await replay.service.patchFields(first),
    await replay.service.patchFields(reordered),
  );

  let fenceInput;
  const fenced = harness({
    fence: async (input) => {
      fenceInput = input;
      throw Object.assign(new Error('stale'), {
        code: 'DEAL_CONFLICT',
        statusCode: 409,
      });
    },
  });
  await assert.rejects(
    fenced.service.patchFields(
      command(
        { assessments: [{ field: 'order.name', status: 'pendente' }] },
        {
          actor: { id: 'AUTOMATION_EXECUTOR', kind: 'AUTOMATION_EXECUTOR' },
          automationEpoch: 3,
          conversationId: 'conversation-current',
        },
      ),
    ),
    (error) =>
      /** @type {{code?: unknown}} */ (error)?.code === 'DEAL_CONFLICT',
  );
  assert.deepEqual(fenceInput, {
    automationEpoch: 3,
    conversationId: 'conversation-current',
    dealId: 'deal-1',
  });
  assert.equal(fenced.eventPort.list().length, 0);
  assert.deepEqual(
    fenced.qualificationRepository.getStored('deal-1').items,
    [],
  );
});

test('supports multiple items, independent sleeve colors and duplicate grade reasons', async () => {
  const fields = completeFields();
  fields.items[0].grade = [
    { duplicateSizeReason: 'lotes distintos', quantity: 4, size: 'P' },
    { duplicateSizeReason: 'lotes distintos', quantity: 6, size: 'P' },
  ];
  fields.items.push({
    ...structuredClone(fields.items[0]),
    colors: {
      ...fields.items[0].colors,
      leftSleeve: 'branca',
      rightSleeve: 'preta',
    },
    id: 'item-2',
  });
  fields.artwork.files.push({
    attachmentId: {
      messageId: 'message-2',
      transientMediaId: 'media-2',
    },
    itemId: 'item-2',
    locationId: 'frente',
  });
  const { qualificationRepository, service } = harness();
  const result = await service.patchFields(command(fields));
  assert.equal(result.readiness.especificacao.complete, true);
  const stored = qualificationRepository.getStored('deal-1');
  assert.ok(
    /** @type {any[]} */ (stored.items[0].grade).every(
      (line) => line.duplicateSizeReasonEnvelope,
    ),
  );
  assert.notDeepEqual(
    stored.items[1].colors.leftSleeve,
    stored.items[1].colors.rightSleeve,
  );

  const invalid = completeFields();
  invalid.items[0].grade = [
    { quantity: 4, size: 'P' },
    { duplicateSizeReason: 'apenas uma linha', quantity: 6, size: 'P' },
  ];
  await assert.rejects(
    harness().service.patchFields(command(invalid)),
    /duplicateSizeReason/iu,
  );
});

test('requires explicit encrypted N/A reason and converts uncertain answers into pending', async () => {
  const fields = completeFields();
  fields.artwork = {
    catalogVersionId: 'catalog-v1',
    colors: [],
    files: [],
    locations: [],
    status: 'not_applicable',
    techniqueCode: 'SEM APLICAÇÃO',
  };
  fields.assessments = [
    { field: 'artwork', reason: 'pedido sem estampa', status: 'nao_aplicavel' },
  ];
  fields.logistics.purpose = 'a definir';
  const { qualificationRepository, service } = harness();
  const result = await service.patchFields(command(fields));
  assert.equal(result.readiness.estampa.complete, true);
  assert.deepEqual(result.readiness.logistica.blockers, ['logistics.purpose']);
  const stored = qualificationRepository.getStored('deal-1');
  assert.doesNotMatch(JSON.stringify(stored), /pedido sem estampa/iu);
  assert.equal(
    /** @type {any[]} */ (stored.assessments).find(
      (entry) => entry.field === 'logistics.purpose',
    ).status,
    'pendente',
  );
});

test('rejects explicit N/A bypasses outside the closed allowlist', async () => {
  const forbidden = [
    'order.customer',
    'order.name',
    'order.commercialIntent',
    'items',
    'items.item-1.product',
    'items.item-1.model',
    'items.item-1.estimatedQuantity',
    'items.item-1.fabrics',
    'items.item-1.grade.total',
    'artwork.files',
    'logistics.city',
    'logistics.address',
    'logistics.pickupLocation',
  ];
  for (const field of forbidden) {
    await assert.rejects(
      harness().service.patchFields(
        command({
          assessments: [{ field, reason: 'bypass', status: 'nao_aplicavel' }],
        }),
      ),
      (error) =>
        /** @type {{code?: unknown, statusCode?: unknown}} */ (error)?.code ===
          'DEAL_INVALID' &&
        /** @type {{statusCode?: unknown}} */ (error)?.statusCode === 422,
      field,
    );
  }
  await assert.rejects(
    harness().service.patchFields(
      command({
        assessments: [
          {
            field: `items.${'x'.repeat(65)}.product`,
            status: 'pendente',
          },
        ],
      }),
    ),
    /registered/iu,
  );

  const permitted = completeFields();
  delete permitted.items[0].colors.back;
  permitted.artwork.colors = [];
  permitted.assessments = [
    {
      field: 'items.item-1.colors.back',
      reason: 'parte sem cor própria',
      status: 'nao_aplicavel',
    },
    {
      field: 'artwork.colors',
      reason: 'aplicação monocromática sem separação adicional',
      status: 'nao_aplicavel',
    },
  ];
  const allowed = await harness().service.patchFields(command(permitted));
  assert.equal(allowed.readiness.especificacao.complete, true);
  assert.equal(allowed.readiness.estampa.complete, true);
});

test('progressive patches merge leaves and nested colors without regressing filled siblings', async () => {
  const { qualificationRepository, service } = harness();
  const first = await service.patchFields(command(completeFields()));
  assert.equal(first.totalQuantity, 10);
  const before = qualificationRepository.getStored('deal-1');

  const second = await service.patchFields(
    command(
      {
        items: [{ colors: { leftSleeve: 'verde' }, id: 'item-1' }],
        order: { name: 'Evento Corrigido' },
      },
      {
        correlationId: 'qualification-correlation-2',
        expectedVersion: 2,
        idempotencyKey: 'qualification-2',
        reasonCode: 'correction',
        reasonDetail: 'ajuste confirmado pelo cliente',
      },
    ),
  );
  assert.equal(second.totalQuantity, 10);
  assert.equal(second.readiness.produto.complete, true);
  assert.equal(second.readiness.especificacao.complete, true);
  const after = qualificationRepository.getStored('deal-1');
  assert.deepEqual(after.items[0].colors.front, before.items[0].colors.front);
  assert.notDeepEqual(
    after.items[0].colors.leftSleeve,
    before.items[0].colors.leftSleeve,
  );
  assert.ok(after.order.customerEnvelope);
  assert.ok(after.changes[1].reasonDetailEnvelope);
  assert.doesNotMatch(JSON.stringify(after), /ajuste confirmado/iu);
});

test('uses canonical item-first blocker order and ignores orphan historical assessments', async () => {
  const { qualificationRepository, service } = harness();
  const result = await service.patchFields(
    command({
      assessments: [{ field: 'observations.0', status: 'pendente' }],
      items: [
        { estimatedQuantity: 2, id: 'item-z' },
        { estimatedQuantity: 3, id: 'item-a' },
      ],
    }),
  );
  assert.equal(result.totalQuantity, 5);
  assert.deepEqual(result.readiness.produto.blockers.slice(3), [
    'items.item-z.product',
    'items.item-z.model',
    'items.item-a.product',
    'items.item-a.model',
  ]);
  assert.equal(result.readiness.produto.nextPendingField, 'order.customer');
  assert.equal(
    result.readiness.logistica.blockers.includes('observations.0'),
    false,
  );

  const removed = await service.patchFields(
    command(
      { items: [{ id: 'item-z', operation: 'remove' }] },
      {
        correlationId: 'qualification-correlation-2',
        expectedVersion: 2,
        idempotencyKey: 'qualification-2',
      },
    ),
  );
  assert.equal(removed.totalQuantity, 3);
  assert.equal(
    (
      await qualificationRepository.evaluateGate({
        dealId: 'deal-1',
        stage: 'produto',
      })
    ).blockers.includes('items.item-z.product'),
    false,
  );

  const specificationPaths = [
    'items.item-a.grade.total',
    'items.item-a.grade.1.duplicateSizeReason',
    'items.item-a.grade.0.quantity',
    'items.item-a.colors.front',
    'items.item-a.fabrics',
  ];
  specificationPaths.sort((left, right) =>
    compareFieldPaths(left, right, {
      items: [{ id: 'item-z' }, { id: 'item-a' }],
    }),
  );
  assert.deepEqual(specificationPaths, [
    'items.item-a.fabrics',
    'items.item-a.colors.front',
    'items.item-a.grade.0.quantity',
    'items.item-a.grade.1.duplicateSizeReason',
    'items.item-a.grade.total',
  ]);
});

test('validates calendar dates, idempotent reason detail and bounded paths', async () => {
  await assert.rejects(
    harness().service.patchFields(
      command({ logistics: { desiredDate: '2026-02-30' } }),
    ),
    /valid ISO calendar date/iu,
  );
  await assert.rejects(
    harness().service.patchFields(
      command(
        { order: { name: 'Pedido' } },
        { reasonDetail: 'x'.repeat(2049) },
      ),
    ),
    /too long/iu,
  );

  const replay = harness();
  await replay.service.patchFields(
    command({ order: { name: 'Pedido' } }, { reasonDetail: 'primeiro motivo' }),
  );
  await assert.rejects(
    replay.service.patchFields(
      command(
        { order: { name: 'Pedido' } },
        { reasonDetail: 'motivo alterado' },
      ),
    ),
    (error) =>
      /** @type {{code?: unknown}} */ (error)?.code ===
      'IDEMPOTENCY_KEY_REUSED',
  );
});

test('accepts only a coherent no-print package backed by the published catalog', async () => {
  const valid = completeFields();
  valid.artwork = {
    catalogVersionId: 'catalog-v1',
    status: 'not_applicable',
    techniqueCode: 'SEM APLICAÇÃO',
  };
  valid.assessments = [
    {
      field: 'artwork',
      reason: 'produto sem estampa',
      status: 'nao_aplicavel',
    },
  ];
  assert.equal(
    (await harness().service.patchFields(command(valid))).readiness.estampa
      .complete,
    true,
  );

  const wrongTechnique = structuredClone(valid);
  wrongTechnique.artwork.techniqueCode = 'silk';
  await assert.rejects(
    harness().service.patchFields(command(wrongTechnique)),
    /SEM APLICAÇÃO/iu,
  );

  const noModel = structuredClone(valid);
  delete noModel.items;
  await assert.rejects(
    harness().service.patchFields(command(noModel)),
    /available item model/iu,
  );

  const unavailable = harness({
    catalog: {
      /** @param {any} input */
      async resolveReferences(input) {
        if (input.techniqueCode) {
          throw Object.assign(new Error('unavailable'), {
            code: 'DEAL_INVALID',
          });
        }
        return {
          catalogVersionId: input.catalogVersionId,
          catalogVersionNumber: 1,
          materials: input.materialCodes.map((/** @type {string} */ code) => ({
            code,
            name: code,
          })),
          model: {
            code: input.modelCode,
            name: input.modelCode,
            productCode: input.productCode,
          },
          product: { code: input.productCode, name: input.productCode },
          technique: null,
        };
      },
    },
  });
  const pending = await unavailable.service.patchFields(command(valid));
  assert.equal(pending.readiness.estampa.complete, false);
  assert.equal(pending.readiness.estampa.nextPendingField, 'artwork');
});

test('rejects partial official-selection bundles with 422', async () => {
  const invalidFields = [
    { items: [{ catalogVersionId: 'catalog-v1', id: 'item-1' }] },
    { items: [{ id: 'item-1', productCode: 'camiseta' }] },
    {
      items: [
        {
          catalogVersionId: 'catalog-v1',
          id: 'item-1',
          modelCode: 'basica',
          productCode: 'camiseta',
        },
      ],
    },
    { artwork: { catalogVersionId: 'catalog-v1' } },
    { artwork: { techniqueCode: 'silk' } },
  ];
  for (const fields of invalidFields) {
    await assert.rejects(
      harness().service.patchFields(command(fields)),
      (error) =>
        /** @type {{code?: unknown, statusCode?: unknown}} */ (error)?.code ===
          'DEAL_INVALID' &&
        /** @type {{statusCode?: unknown}} */ (error)?.statusCode === 422,
    );
  }
});

test('a complete item-selection bundle replaces its stable snapshot atomically', async () => {
  const { qualificationRepository, service } = harness();
  await service.patchFields(command(completeFields()));

  const result = await service.patchFields(
    command(
      {
        items: [
          {
            catalogVersionId: 'catalog-v2',
            fabrics: ['algodao'],
            id: 'item-1',
            modelCode: 'premium',
            productCode: 'polo',
          },
        ],
      },
      {
        correlationId: 'qualification-correlation-2',
        expectedVersion: 2,
        idempotencyKey: 'qualification-2',
        reasonCode: 'correction',
      },
    ),
  );

  const stored = qualificationRepository.getStored('deal-1');
  assert.equal(stored.items[0].catalogSnapshot.catalogVersionId, 'catalog-v2');
  assert.equal(stored.items[0].catalogSnapshot.model.code, 'premium');
  assert.equal(stored.items[0].catalogSnapshot.product.code, 'polo');
  assert.deepEqual(
    stored.items[0].fabrics.map((/** @type {any} */ entry) => entry.code),
    ['algodao'],
  );
  assert.equal(result.totalQuantity, 10);
});

test('rejects qualification no-ops but preserves explicit collection clearing', async () => {
  const noOps = [
    { items: [] },
    { items: [{ id: 'item-1' }] },
    { items: [{ id: 'item-1', operation: 'upsert' }] },
    { artwork: {} },
    { logistics: {} },
    { items: [{ colors: {}, id: 'item-1' }] },
    { assessments: [] },
  ];
  for (const fields of noOps) {
    await assert.rejects(
      harness().service.patchFields(command(fields)),
      (error) =>
        /** @type {{code?: unknown, statusCode?: unknown}} */ (error)?.code ===
          'DEAL_INVALID' &&
        /** @type {{statusCode?: unknown}} */ (error)?.statusCode === 422,
    );
  }

  for (const itemPatch of [{ fabrics: [] }, { grade: [] }]) {
    const fields = completeFields();
    Object.assign(fields.items[0], itemPatch);
    const result = await harness().service.patchFields(command(fields));
    assert.equal(result.readiness.especificacao.complete, false);
  }
});

import {
  createIdempotentCommandExecutor,
  fingerprintCommand,
} from '@crm-silmer/integration-reliability';
import { resolveFieldDefinition } from './field-registry.js';

const STAGES = [
  'produto',
  'especificacao',
  'estampa',
  'logistica',
  'fechamento',
];

/** @param {any} dependencies */
export function createQualificationService(dependencies) {
  assertDependencies(dependencies);
  const execute = createIdempotentCommandExecutor({
    auditTrail: dependencies.auditPort,
    idempotencyStore: dependencies.idempotencyStore,
  });
  const clock = dependencies.clock ?? (() => new Date());
  return Object.freeze({
    /** @param {any} input */
    async patchFields(input) {
      try {
        validateCommand(input);
      } catch (error) {
        if (error instanceof TypeError) {
          throw Object.assign(error, {
            code: 'DEAL_INVALID',
            statusCode: 422,
          });
        }
        throw error;
      }
      const command = structuredClone(input);
      const digest = fingerprintCommand(command.fields);
      const reasonDetailDigest = command.reasonDetail
        ? fingerprintCommand(command.reasonDetail)
        : null;
      return execute(
        {
          action: 'deal.fields.patch',
          actor: command.actor.id,
          command: {
            ...(command.automationEpoch === undefined
              ? {}
              : { automationEpoch: command.automationEpoch }),
            ...(command.conversationId === undefined
              ? {}
              : { conversationId: command.conversationId }),
            fieldsDigest: digest,
            reasonCode: command.reasonCode,
            ...(reasonDetailDigest ? { reasonDetailDigest } : {}),
          },
          correlationId: command.correlationId,
          key: command.idempotencyKey,
          reason: command.reasonCode,
          target: { id: command.dealId, type: 'deal' },
          version: `${command.expectedVersion}->${command.expectedVersion + 1}`,
        },
        async (transaction) => {
          const context = { transaction };
          return dependencies.dealRepository.executeLocked(
            command,
            async (/** @type {any} */ deal) => {
              if (command.actor.kind === 'AUTOMATION_EXECUTOR') {
                await dependencies.automationFencePort.assertCurrent(
                  {
                    automationEpoch: command.automationEpoch,
                    conversationId: command.conversationId,
                    dealId: deal.id,
                  },
                  context,
                );
              }
              if (command.fields.artwork?.files) {
                await dependencies.attachmentPort.assertUsable(
                  {
                    contactId: deal.contactId,
                    files: command.fields.artwork.files,
                  },
                  context,
                );
              }
              command.fields = withDerivedAssessments(command.fields);
              const catalogs = await resolveCatalogs(
                dependencies.catalogPort,
                command.fields,
                context,
              );
              const occurredAt = clock().toISOString();
              await dependencies.qualificationRepository.applyPatch(
                {
                  actorId: command.actor.id,
                  catalogs,
                  correlationId: command.correlationId,
                  dealId: deal.id,
                  fields: command.fields,
                  fieldsFingerprint: digest,
                  occurredAt,
                  reasonCode: command.reasonCode,
                  reasonDetail: command.reasonDetail,
                  resultingVersion: deal.version + 1,
                  source:
                    command.actor.kind === 'human' ? 'human' : 'automation',
                },
                context,
              );
              const readiness =
                await dependencies.qualificationRepository.evaluateAll(
                  deal.id,
                  context,
                );
              const projection =
                await dependencies.qualificationRepository.getProjection(
                  deal.id,
                  context,
                );
              const returnedTo = firstIncomplete(readiness, deal.stage);
              const changedSections = Object.keys(command.fields).sort();
              const changed = await dependencies.dealRepository.applyFields(
                {
                  actorId: command.actor.id,
                  changedSections,
                  deal,
                  occurredAt,
                  returnedTo,
                },
                context,
              );
              await dependencies.eventPort.append(
                {
                  aggregateId: deal.id,
                  aggregateType: 'deal',
                  aggregateVersion: changed.version,
                  correlationId: command.correlationId,
                  occurredAt: new Date(occurredAt),
                  payload: {
                    changedSections,
                    ...(returnedTo
                      ? { returnedFrom: deal.stage, returnedTo }
                      : {}),
                    version: changed.version,
                  },
                  type: 'deal.fields.patched',
                },
                context,
              );
              return Object.freeze({
                deal: changed,
                readiness,
                totalQuantity: projection.totalQuantity,
              });
            },
            context,
          );
        },
      );
    },
  });
}

/** @param {any} port @param {QualificationFields} fields @param {any} context */
async function resolveCatalogs(port, fields, context) {
  const items = [];
  for (const item of fields.items ?? []) {
    if (item.operation === 'remove') {
      items.push(null);
      continue;
    }
    assertAtomicBundle(
      item,
      ['catalogVersionId', 'productCode', 'modelCode', 'fabrics'],
      'item official selection',
    );
    const selectionTouched = [
      'catalogVersionId',
      'productCode',
      'modelCode',
      'fabrics',
    ].some((field) => item[field] !== undefined);
    if (!selectionTouched) {
      items.push(null);
      continue;
    }
    const completeSelection =
      item.catalogVersionId &&
      item.productCode &&
      item.modelCode &&
      item.fabrics;
    if (!completeSelection) {
      items.push(null);
      markCatalogPending(fields, item.id);
      continue;
    }
    try {
      items.push(
        await port.resolveReferences(
          {
            catalogVersionId: item.catalogVersionId,
            materialCodes: item.fabrics,
            modelCode: item.modelCode,
            productCode: item.productCode,
          },
          context,
        ),
      );
    } catch (error) {
      if (/** @type {{code?: unknown}} */ (error)?.code !== 'DEAL_INVALID')
        throw error;
      items.push(null);
      markCatalogPending(fields, item.id);
    }
  }
  let artwork = null;
  fields.assessments ??= [];
  if (
    fields.artwork &&
    (fields.artwork.catalogVersionId || fields.artwork.techniqueCode)
  ) {
    if (fields.artwork.catalogVersionId && fields.artwork.techniqueCode) {
      try {
        artwork = await port.resolveReferences(
          {
            catalogVersionId: fields.artwork.catalogVersionId,
            techniqueCode: fields.artwork.techniqueCode,
          },
          context,
        );
      } catch (error) {
        if (/** @type {{code?: unknown}} */ (error)?.code !== 'DEAL_INVALID')
          throw error;
        fields.assessments.push({
          field:
            fields.artwork.status === 'not_applicable'
              ? 'artwork'
              : 'artwork.technique',
          status: 'pendente',
        });
      }
    } else {
      fields.assessments.push({
        field:
          fields.artwork.status === 'not_applicable'
            ? 'artwork'
            : 'artwork.technique',
        status: 'pendente',
      });
    }
  }
  if (fields.artwork?.status === 'not_applicable') {
    if (artwork?.technique && !isNoApplication(artwork.technique)) {
      throw Object.assign(
        new TypeError(
          'not_applicable artwork requires the published SEM APLICAÇÃO technique',
        ),
        { code: 'DEAL_INVALID', statusCode: 422 },
      );
    }
    if (
      !artwork?.technique &&
      !fields.assessments.some(
        (assessment) =>
          assessment.field === 'artwork' && assessment.status === 'pendente',
      )
    ) {
      fields.assessments.push({ field: 'artwork', status: 'pendente' });
    }
  }
  return { artwork, items };
}

/** @param {{code?: unknown, name?: unknown}} technique */
function isNoApplication(technique) {
  const normalized = (/** @type {unknown} */ value) =>
    typeof value === 'string'
      ? value
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .replace(/[-_]/gu, ' ')
          .trim()
          .toUpperCase()
      : '';
  return [technique.code, technique.name].some(
    (value) => normalized(value) === 'SEM APLICACAO',
  );
}

/** @param {QualificationFields} fields @param {string} itemId */
function markCatalogPending(fields, itemId) {
  fields.assessments ??= [];
  for (const suffix of ['product', 'model', 'fabrics']) {
    fields.assessments.push({
      field: `items.${itemId}.${suffix}`,
      status: 'pendente',
    });
  }
}

/** @param {Record<string, any>} readiness @param {string} currentStage */
function firstIncomplete(readiness, currentStage) {
  const currentIndex = STAGES.indexOf(currentStage);
  for (let index = 0; index < Math.min(currentIndex, 4); index += 1) {
    if (!readiness[STAGES[index]].complete) return STAGES[index];
  }
  return null;
}

/** @param {any} input */
function validateCommand(input) {
  if (!input || typeof input !== 'object')
    throw new TypeError('command is required');
  for (const field of [
    'dealId',
    'correlationId',
    'idempotencyKey',
    'reasonCode',
  ]) {
    requireString(input[field], field);
  }
  if (
    ![
      'customer_update',
      'correction',
      'qualification_review',
      'automation_extraction',
    ].includes(input.reasonCode)
  ) {
    throw new TypeError('reasonCode is invalid');
  }
  if (input.reasonDetail !== undefined) {
    requireString(input.reasonDetail, 'reasonDetail');
    if (input.reasonDetail.length > 2048)
      throw new TypeError('reasonDetail is too long');
  }
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    throw new TypeError('expectedVersion must be a positive integer');
  }
  const human =
    input.actor?.kind === 'human' && input.actor.functionName === 'Vendedor';
  const automation =
    input.actor?.kind === 'AUTOMATION_EXECUTOR' &&
    input.actor.id === 'AUTOMATION_EXECUTOR';
  if (!human && !automation)
    throw Object.assign(new Error('Forbidden'), {
      code: 'DEAL_FORBIDDEN',
      statusCode: 403,
    });
  if (automation) {
    requireString(input.conversationId, 'conversationId');
    if (
      !Number.isSafeInteger(input.automationEpoch) ||
      input.automationEpoch < 0
    ) {
      throw new TypeError('automationEpoch must be a non-negative integer');
    }
  }
  validateFields(input.fields);
}

/** @param {QualificationFields} fields */
function validateFields(fields) {
  requireObject(fields, 'fields');
  rejectUnknown(fields, [
    'order',
    'items',
    'artwork',
    'logistics',
    'observations',
    'assessments',
  ]);
  if (Object.keys(fields).length === 0)
    throw new TypeError('fields must not be empty');
  if (fields.order) {
    requireObject(fields.order, 'order');
    rejectUnknown(fields.order, ['customer', 'name', 'commercialIntent']);
    if (Object.keys(fields.order).length === 0)
      throw new TypeError('order must not be empty');
    for (const field of ['customer', 'name']) {
      if (fields.order[field] !== undefined)
        requireString(fields.order[field], `order.${field}`);
    }
    if (
      fields.order.commercialIntent !== undefined &&
      fields.order.commercialIntent !== true
    )
      throw new TypeError('order.commercialIntent must be true');
  }
  if (fields.items) validateItems(fields.items);
  if (fields.artwork) validateArtwork(fields.artwork);
  if (fields.logistics) validateLogistics(fields.logistics);
  if (fields.observations) {
    if (!Array.isArray(fields.observations))
      throw new TypeError('observations must be an array');
    fields.observations.forEach((value) => requireString(value, 'observation'));
  }
  if (fields.assessments) {
    validateAssessments(fields.assessments);
    if (
      fields.assessments.length === 0 &&
      Object.keys(fields).every((field) => field === 'assessments')
    ) {
      throw new TypeError('fields must contain an effective mutation');
    }
  }
}

/** @param {any[]} items */
function validateItems(items) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (items.length === 0) throw new TypeError('items must not be empty');
  for (const item of items) {
    requireObject(item, 'item');
    rejectUnknown(item, [
      'id',
      'catalogVersionId',
      'productCode',
      'modelCode',
      'estimatedQuantity',
      'fabrics',
      'colors',
      'grade',
      'operation',
    ]);
    requireBoundedId(item.id, 'item.id');
    if (
      item.operation !== undefined &&
      !['upsert', 'remove'].includes(item.operation)
    )
      throw new TypeError('item.operation is invalid');
    if (item.operation === 'remove') {
      if (Object.keys(item).some((key) => !['id', 'operation'].includes(key)))
        throw new TypeError('removed item contains fields');
      continue;
    }
    if (Object.keys(item).every((key) => ['id', 'operation'].includes(key))) {
      throw new TypeError('upserted item must contain a mutation');
    }
    assertAtomicBundle(
      item,
      ['catalogVersionId', 'productCode', 'modelCode', 'fabrics'],
      'item official selection',
    );
    for (const field of ['catalogVersionId', 'productCode', 'modelCode']) {
      if (item[field] !== undefined)
        requireString(item[field], `item.${field}`);
    }
    if (
      item.estimatedQuantity !== undefined &&
      (!Number.isSafeInteger(item.estimatedQuantity) ||
        item.estimatedQuantity < 1)
    )
      throw new TypeError('estimatedQuantity must be positive');
    if (item.fabrics !== undefined) {
      if (!Array.isArray(item.fabrics))
        throw new TypeError('fabrics must be an array');
      item.fabrics.forEach((/** @type {any} */ value) =>
        requireString(value, 'fabric'),
      );
    }
    if (item.colors !== undefined) {
      requireObject(item.colors, 'colors');
      if (Object.keys(item.colors).length === 0)
        throw new TypeError('colors must not be empty');
      rejectUnknown(item.colors, [
        'front',
        'back',
        'rightSleeve',
        'leftSleeve',
        'collarTrim',
        'sleeveTrim',
      ]);
      Object.values(item.colors).forEach((value) =>
        requireString(value, 'color'),
      );
    }
    if (item.grade === undefined) continue;
    if (!Array.isArray(item.grade))
      throw new TypeError('grade must be an array');
    const counts = new Map();
    for (const line of item.grade) {
      const key = String(line.size).trim().toLocaleLowerCase('pt-BR');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const line of item.grade) {
      requireObject(line, 'grade line');
      rejectUnknown(line, ['size', 'quantity', 'duplicateSizeReason']);
      requireString(line.size, 'grade.size');
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1)
        throw new TypeError('grade.quantity must be positive');
      const key = line.size.trim().toLocaleLowerCase('pt-BR');
      if (counts.get(key) > 1)
        requireString(line.duplicateSizeReason, 'duplicateSizeReason');
    }
  }
}

/** @param {Record<string, any>} artwork */
function validateArtwork(artwork) {
  requireObject(artwork, 'artwork');
  if (Object.keys(artwork).length === 0)
    throw new TypeError('artwork must not be empty');
  rejectUnknown(artwork, [
    'catalogVersionId',
    'status',
    'responsibility',
    'techniqueCode',
    'locations',
    'files',
    'colors',
  ]);
  assertAtomicBundle(
    artwork,
    ['catalogVersionId', 'techniqueCode'],
    'artwork technique selection',
  );
  if (
    artwork.status !== undefined &&
    ![
      'ready',
      'customer_will_send',
      'silmer_will_create',
      'not_applicable',
    ].includes(artwork.status)
  )
    throw new TypeError('artwork.status is invalid');
  for (const field of ['catalogVersionId', 'responsibility', 'techniqueCode']) {
    if (artwork[field] !== undefined)
      requireString(artwork[field], `artwork.${field}`);
  }
  for (const collection of ['locations', 'files', 'colors']) {
    if (
      artwork[collection] !== undefined &&
      !Array.isArray(artwork[collection])
    )
      throw new TypeError(`artwork.${collection} must be an array`);
  }
  for (const location of artwork.locations ?? []) {
    rejectUnknown(location, ['id', 'name']);
    requireBoundedId(location.id, 'location.id');
    requireString(location.name, 'location.name');
  }
  for (const file of artwork.files ?? []) {
    rejectUnknown(file, ['attachmentId', 'itemId', 'locationId']);
    requireBoundedId(file.itemId, 'file.itemId');
    requireBoundedId(file.locationId, 'file.locationId');
    requireObject(file.attachmentId, 'file.attachmentId');
    rejectUnknown(file.attachmentId, ['messageId', 'transientMediaId']);
    requireBoundedId(
      file.attachmentId.messageId,
      'file.attachmentId.messageId',
    );
    requireBoundedId(
      file.attachmentId.transientMediaId,
      'file.attachmentId.transientMediaId',
    );
  }
  for (const colors of artwork.colors ?? []) {
    rejectUnknown(colors, ['locationId', 'values']);
    requireString(colors.locationId, 'colors.locationId');
    if (!Array.isArray(colors.values) || colors.values.length === 0)
      throw new TypeError('artwork colors must not be empty');
    /** @type {any[]} */ (colors.values).forEach((value) =>
      requireString(value, 'artwork color'),
    );
  }
  const locationIds = artwork.locations
    ? new Set(artwork.locations.map((/** @type {any} */ { id }) => id))
    : null;
  for (const file of artwork.files ?? []) {
    if (locationIds && !locationIds.has(file.locationId))
      throw new TypeError('file.locationId is invalid');
  }
  for (const colors of artwork.colors ?? []) {
    if (locationIds && !locationIds.has(colors.locationId))
      throw new TypeError('colors.locationId is invalid');
  }
}

/** @param {Record<string, any>} logistics */
function validateLogistics(logistics) {
  requireObject(logistics, 'logistics');
  if (Object.keys(logistics).length === 0)
    throw new TypeError('logistics must not be empty');
  rejectUnknown(logistics, [
    'desiredDate',
    'purpose',
    'purchaseProfile',
    'mode',
    'city',
    'address',
    'pickupLocation',
  ]);
  for (const field of ['desiredDate', 'purpose', 'purchaseProfile', 'mode']) {
    if (logistics[field] !== undefined)
      requireString(logistics[field], `logistics.${field}`);
  }
  if (
    logistics.mode !== undefined &&
    !['delivery', 'pickup'].includes(logistics.mode)
  )
    throw new TypeError('logistics.mode is invalid');
  if (
    logistics.desiredDate !== undefined &&
    !isCalendarDate(logistics.desiredDate)
  )
    throw new TypeError(
      'logistics.desiredDate must be a valid ISO calendar date',
    );
  for (const optional of ['city', 'address', 'pickupLocation']) {
    if (logistics[optional] !== undefined)
      requireString(logistics[optional], `logistics.${optional}`);
  }
}

/** @param {QualificationFields} fields */
function withDerivedAssessments(fields) {
  /** @type {any[]} */
  const derived = [];
  /** @param {string} field @param {any} value */
  const add = (field, value) =>
    derived.push({
      field,
      status: isPending(value) ? 'pendente' : 'preenchido',
    });
  if (fields.order) {
    if (fields.order.customer !== undefined)
      add('order.customer', fields.order.customer);
    if (fields.order.name !== undefined) add('order.name', fields.order.name);
    if (fields.order.commercialIntent !== undefined)
      add('order.commercialIntent', fields.order.commercialIntent);
  }
  for (const item of fields.items ?? []) {
    if (item.operation === 'remove') continue;
    if (item.productCode !== undefined)
      add(`items.${item.id}.product`, item.productCode);
    if (item.modelCode !== undefined)
      add(`items.${item.id}.model`, item.modelCode);
    if (item.estimatedQuantity !== undefined)
      add(`items.${item.id}.estimatedQuantity`, item.estimatedQuantity);
    if (item.fabrics !== undefined)
      add(`items.${item.id}.fabrics`, item.fabrics);
    for (const key of [
      'front',
      'back',
      'rightSleeve',
      'leftSleeve',
      'collarTrim',
      'sleeveTrim',
    ]) {
      if (item.colors?.[key] !== undefined)
        add(`items.${item.id}.colors.${key}`, item.colors[key]);
    }
    if (item.grade !== undefined)
      add(`items.${item.id}.grade.total`, item.grade);
    /** @type {any[]} */ (item.grade ?? []).forEach((line, index) => {
      add(`items.${item.id}.grade.${index}.size`, line.size);
      add(`items.${item.id}.grade.${index}.quantity`, line.quantity);
      if (line.duplicateSizeReason)
        add(
          `items.${item.id}.grade.${index}.duplicateSizeReason`,
          line.duplicateSizeReason,
        );
    });
  }
  if (fields.artwork) {
    if (fields.artwork.status !== undefined)
      add('artwork.status', fields.artwork.status);
    if (fields.artwork.status !== 'not_applicable') {
      if (fields.artwork.responsibility !== undefined)
        add('artwork.responsibility', fields.artwork.responsibility);
      if (fields.artwork.techniqueCode !== undefined)
        add('artwork.technique', fields.artwork.techniqueCode);
      if (fields.artwork.locations !== undefined)
        add('artwork.locations', fields.artwork.locations);
      if (fields.artwork.files !== undefined)
        add('artwork.files', fields.artwork.files);
      if (fields.artwork.colors !== undefined)
        add('artwork.colors', fields.artwork.colors);
    }
  }
  if (fields.logistics) {
    for (const key of ['desiredDate', 'purpose', 'purchaseProfile', 'mode']) {
      if (fields.logistics[key] !== undefined)
        add(`logistics.${key}`, fields.logistics[key]);
    }
    if (fields.logistics.mode === 'delivery') {
      if (fields.logistics.city !== undefined)
        add('logistics.city', fields.logistics.city);
      if (fields.logistics.address !== undefined)
        add('logistics.address', fields.logistics.address);
    }
    if (fields.logistics.mode === 'pickup') {
      if (fields.logistics.pickupLocation !== undefined)
        add('logistics.pickupLocation', fields.logistics.pickupLocation);
    }
  }
  fields.observations?.forEach((value, index) =>
    add(`observations.${index}`, value),
  );
  const explicit = new Map(
    (fields.assessments ?? []).map((value) => [value.field, value]),
  );
  return {
    ...fields,
    assessments: [
      ...derived.filter(({ field }) => !explicit.has(field)),
      ...explicit.values(),
    ],
  };
}

/** @param {any} value */
function isPending(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value !== 'string') return false;
  return /^(?:não sei|nao sei|talvez|a definir)$/iu.test(value.trim());
}

/** @param {any[]} assessments */
function validateAssessments(assessments) {
  if (!Array.isArray(assessments))
    throw new TypeError('assessments must be an array');
  for (const assessment of assessments) {
    rejectUnknown(assessment, ['field', 'status', 'reason']);
    requireString(assessment.field, 'assessment.field');
    const definition = resolveFieldDefinition(assessment.field);
    if (!definition) throw new TypeError('assessment.field is not registered');
    if (
      !['preenchido', 'nao_aplicavel', 'pendente', 'divergente'].includes(
        assessment.status,
      )
    )
      throw new TypeError('assessment.status is invalid');
    if (assessment.status === 'nao_aplicavel' && !definition.allowsExplicitNA) {
      throw new TypeError('assessment.field does not allow not-applicable');
    }
    if (assessment.status === 'nao_aplicavel')
      requireString(assessment.reason, 'assessment.reason');
  }
}

/** @param {Record<string, any>} value @param {string[]} allowed */
function rejectUnknown(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new TypeError('Unknown field');
}

/** @param {Record<string, any>} value @param {string[]} fields @param {string} name */
function assertAtomicBundle(value, fields, name) {
  const present = fields.filter((field) => value[field] !== undefined);
  if (present.length > 0 && present.length !== fields.length) {
    throw new TypeError(`${name} must include ${fields.join(', ')}`);
  }
}

/** @param {any} value @param {string} field */
function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
}

/** @param {any} value @param {string} field */
function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '')
    throw new TypeError(`${field} must be a non-empty string`);
}

/** @param {any} value @param {string} field */
function requireBoundedId(value, field) {
  requireString(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
}

/** @param {string} value */
function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** @param {any} dependencies */
function assertDependencies(dependencies) {
  for (const [port, method, name] of [
    [dependencies?.attachmentPort, 'assertUsable', 'attachmentPort'],
    [dependencies?.auditPort, 'append', 'auditPort'],
    [dependencies?.automationFencePort, 'assertCurrent', 'automationFencePort'],
    [dependencies?.catalogPort, 'resolveReferences', 'catalogPort'],
    [dependencies?.dealRepository, 'executeLocked', 'dealRepository'],
    [dependencies?.dealRepository, 'applyFields', 'dealRepository'],
    [dependencies?.eventPort, 'append', 'eventPort'],
    [dependencies?.idempotencyStore, 'execute', 'idempotencyStore'],
    [
      dependencies?.qualificationRepository,
      'applyPatch',
      'qualificationRepository',
    ],
    [
      dependencies?.qualificationRepository,
      'evaluateAll',
      'qualificationRepository',
    ],
    [
      dependencies?.qualificationRepository,
      'getProjection',
      'qualificationRepository',
    ],
  ]) {
    if (!port || typeof port[method] !== 'function')
      throw new TypeError(`${name} must implement ${method}`);
  }
}

/** @typedef {{order?: Record<string, any>, items?: any[], artwork?: Record<string, any>, logistics?: Record<string, any>, observations?: string[], assessments?: any[]}} QualificationFields */

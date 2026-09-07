import {
  compareFieldPaths,
  isAssessmentApplicable,
  resolveFieldDefinition,
} from './field-registry.js';

const PIECE_COLORS = Object.freeze([
  'front',
  'back',
  'rightSleeve',
  'leftSleeve',
  'collarTrim',
  'sleeveTrim',
]);

export class InMemoryQualificationRepository {
  #cipher;
  #states = new Map();

  /** @param {{cipher: any}} input */
  constructor({ cipher }) {
    this.#cipher = cipher;
  }

  /** @param {{dealId: string, fields: QualificationFields, catalogs: {items: any[], artwork: any}, occurredAt: string, actorId: string, correlationId: string, resultingVersion: number, source: string, fieldsFingerprint: string, reasonCode: string, reasonDetail?: string}} input */
  async applyPatch(input) {
    const current = this.#states.get(input.dealId) ?? emptyQualificationState();
    const next = structuredClone(current);
    const fields = input.fields;
    if (fields.order) {
      next.order ??= {};
      if (fields.order.commercialIntent !== undefined)
        next.order.commercialIntent = fields.order.commercialIntent;
      if (fields.order.customer !== undefined)
        next.order.customerEnvelope = this.#encrypt(
          fields.order.customer,
          input.dealId,
          'order.customer',
        );
      if (fields.order.name !== undefined)
        next.order.nameEnvelope = this.#encrypt(
          fields.order.name,
          input.dealId,
          'order.name',
        );
    }
    if (fields.items) {
      for (const [index, item] of fields.items.entries()) {
        const storedIndex = next.items.findIndex(
          (/** @type {any} */ value) => value.id === item.id,
        );
        if (item.operation === 'remove') {
          if (
            next.artwork?.files.some(
              (/** @type {any} */ file) => file.itemId === item.id,
            )
          ) {
            throw invalid('Referenced items cannot be removed');
          }
          if (storedIndex >= 0) next.items.splice(storedIndex, 1);
          continue;
        }
        assertAtomicBundle(
          item,
          ['catalogVersionId', 'productCode', 'modelCode', 'fabrics'],
          'item official selection',
        );
        const stored =
          storedIndex >= 0
            ? next.items[storedIndex]
            : { colors: {}, fabrics: [], grade: [], id: item.id };
        const snapshot = input.catalogs.items[index];
        if (snapshot) stored.catalogSnapshot = structuredClone(snapshot);
        if (item.estimatedQuantity !== undefined)
          stored.estimatedQuantity = item.estimatedQuantity;
        if (snapshot) {
          stored.modelCode = item.modelCode;
          stored.productCode = item.productCode;
        }
        if (item.colors) {
          for (const key of PIECE_COLORS) {
            if (item.colors[key] !== undefined) {
              stored.colors[key] = this.#encrypt(
                item.colors[key],
                input.dealId,
                `items.${item.id}.colors.${key}`,
              );
            }
          }
        }
        if (item.fabrics && snapshot) {
          stored.fabrics = item.fabrics.map((/** @type {string} */ code) => ({
            code,
            snapshot: structuredClone(
              snapshot?.materials.find(
                (/** @type {any} */ value) => value.code === code,
              ),
            ),
          }));
        }
        if (item.grade) {
          stored.grade = item.grade.map(
            (/** @type {any} */ line, /** @type {number} */ lineIndex) => ({
              duplicateSizeReasonEnvelope: line.duplicateSizeReason
                ? this.#encrypt(
                    line.duplicateSizeReason,
                    input.dealId,
                    `items.${item.id}.grade.${lineIndex}.duplicateSizeReason`,
                  )
                : null,
              quantity: line.quantity,
              sizeEnvelope: this.#encrypt(
                line.size,
                input.dealId,
                `items.${item.id}.grade.${lineIndex}.size`,
              ),
              sizeLookup: line.size.trim().toLocaleLowerCase('pt-BR'),
            }),
          );
        }
        if (storedIndex < 0) next.items.push(stored);
      }
    }
    if (fields.artwork) {
      const artwork = fields.artwork;
      assertAtomicBundle(
        artwork,
        ['catalogVersionId', 'techniqueCode'],
        'artwork technique selection',
      );
      next.artwork ??= { colors: [], files: [], locations: [] };
      if (artwork.status === 'not_applicable') {
        next.artwork = {
          catalogSnapshot: input.catalogs.artwork,
          colors: [],
          files: [],
          locations: [],
          status: artwork.status,
          techniqueCode: artwork.techniqueCode,
        };
        if (
          (input.catalogs.artwork?.technique &&
            !isNoApplication(input.catalogs.artwork.technique)) ||
          !next.items.some(
            (/** @type {any} */ item) => item.catalogSnapshot?.model,
          )
        ) {
          throw invalid(
            'No-print qualification requires SEM APLICAÇÃO and an available item model',
          );
        }
      } else {
        if (input.catalogs.artwork)
          next.artwork.catalogSnapshot = structuredClone(
            input.catalogs.artwork,
          );
        if (artwork.status !== undefined) next.artwork.status = artwork.status;
        if (artwork.colors)
          next.artwork.colors = artwork.colors.map(
            (/** @type {any} */ group, /** @type {number} */ index) => ({
              locationId: group.locationId,
              valuesEnvelope: this.#encrypt(
                JSON.stringify(group.values),
                input.dealId,
                `artwork.colors.${index}`,
              ),
            }),
          );
        if (artwork.files) next.artwork.files = structuredClone(artwork.files);
        if (artwork.locations)
          next.artwork.locations = artwork.locations.map(
            (/** @type {any} */ location) => ({
              id: location.id,
              nameEnvelope: this.#encrypt(
                location.name,
                input.dealId,
                `artwork.locations.${location.id}`,
              ),
            }),
          );
        if (artwork.responsibility !== undefined)
          next.artwork.responsibilityEnvelope = this.#encrypt(
            artwork.responsibility,
            input.dealId,
            'artwork.responsibility',
          );
        if (artwork.techniqueCode !== undefined && input.catalogs.artwork)
          next.artwork.techniqueCode = artwork.techniqueCode;
      }
    }
    if (fields.logistics) {
      const logistics = fields.logistics;
      next.logistics ??= {};
      if (logistics.desiredDate !== undefined)
        next.logistics.desiredDate = logistics.desiredDate;
      if (logistics.mode !== undefined) {
        next.logistics.mode = logistics.mode;
        if (logistics.mode === 'delivery')
          delete next.logistics.pickupLocationEnvelope;
        if (logistics.mode === 'pickup') {
          delete next.logistics.cityEnvelope;
          delete next.logistics.addressEnvelope;
        }
      }
      for (const key of [
        'address',
        'city',
        'pickupLocation',
        'purchaseProfile',
        'purpose',
      ]) {
        if (logistics[key] !== undefined)
          next.logistics[`${key}Envelope`] = this.#encrypt(
            logistics[key],
            input.dealId,
            `logistics.${key}`,
          );
      }
    }
    if (fields.observations) {
      next.observations = fields.observations.map((value, index) =>
        this.#encrypt(value, input.dealId, `observations.${index}`),
      );
    }
    if (fields.assessments) {
      for (const assessment of fields.assessments) {
        const definition = resolveFieldDefinition(assessment.field);
        if (!definition || !isAssessmentApplicable(definition, next)) {
          throw invalid(
            'Assessment target is not applicable to the resulting state',
          );
        }
        next.assessments.push({
          field: assessment.field,
          actorId: input.actorId,
          correlationId: input.correlationId,
          occurredAt: input.occurredAt,
          reasonEnvelope: assessment.reason
            ? this.#encrypt(
                assessment.reason,
                input.dealId,
                `assessments.${next.assessments.length}.reason`,
              )
            : null,
          status: assessment.status,
          resultingVersion: input.resultingVersion,
          source: input.source,
        });
      }
    }
    next.changes.push({
      actorId: input.actorId,
      correlationId: input.correlationId,
      fieldsFingerprint: input.fieldsFingerprint,
      occurredAt: input.occurredAt,
      reasonCode: input.reasonCode,
      reasonDetailEnvelope: input.reasonDetail
        ? this.#encrypt(
            input.reasonDetail,
            input.dealId,
            `changes.${input.resultingVersion}.reasonDetail`,
          )
        : null,
      resultingVersion: input.resultingVersion,
    });
    if (
      /** @type {any[]} */ (next.artwork?.files ?? []).some(
        (file) =>
          !(
            /** @type {any[]} */ (next.items).some(
              (item) => item.id === file.itemId,
            )
          ),
      )
    ) {
      throw Object.assign(
        new Error('Artwork file references an invalid Deal item'),
        {
          code: 'DEAL_INVALID',
          statusCode: 422,
        },
      );
    }
    this.#states.set(input.dealId, next);
    return structuredClone(next);
  }

  /** @param {{dealId: string, stage: string}} input */
  async evaluateGate({ dealId, stage }) {
    return evaluateQualificationState(
      this.#states.get(dealId) ?? emptyQualificationState(),
      stage,
    );
  }

  /** @param {string} dealId */
  async evaluateAll(dealId) {
    const state = this.#states.get(dealId) ?? emptyQualificationState();
    return Object.fromEntries(
      ['produto', 'especificacao', 'estampa', 'logistica'].map((stage) => [
        stage,
        evaluateQualificationState(state, stage),
      ]),
    );
  }

  /** @param {string} dealId */
  async getProjection(dealId) {
    const state = this.#states.get(dealId) ?? emptyQualificationState();
    return {
      totalQuantity: state.items.reduce(
        (/** @type {number} */ total, /** @type {any} */ item) =>
          total + (Number(item.estimatedQuantity) || 0),
        0,
      ),
    };
  }

  /** @param {string} dealId */
  getStored(dealId) {
    return structuredClone(
      this.#states.get(dealId) ?? emptyQualificationState(),
    );
  }

  /** @param {string} value @param {string} dealId @param {string} field */
  #encrypt(value, dealId, field) {
    return this.#cipher.encrypt(value, `${dealId}:${field}`);
  }
}

/** @param {string} message */
function invalid(message) {
  return Object.assign(new Error(message), {
    code: 'DEAL_INVALID',
    statusCode: 422,
  });
}

/** @param {Record<string, any>} value @param {string[]} fields @param {string} name */
function assertAtomicBundle(value, fields, name) {
  const present = fields.filter((field) => value[field] !== undefined);
  if (present.length > 0 && present.length !== fields.length) {
    throw invalid(`${name} must include ${fields.join(', ')}`);
  }
}

/** @param {{code?: unknown, name?: unknown}} technique */
function isNoApplication(technique) {
  return [technique.code, technique.name].some((value) => {
    if (typeof value !== 'string') return false;
    return (
      value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[-_]/gu, ' ')
        .trim()
        .toUpperCase() === 'SEM APLICACAO'
    );
  });
}

/** @returns {any} */
export function emptyQualificationState() {
  return {
    assessments: [],
    artwork: null,
    changes: [],
    items: [],
    logistics: null,
    observations: [],
    order: null,
  };
}

/** @param {any} state @param {string} stage */
export function evaluateQualificationState(state, stage) {
  const blockers = gateBlockers(state, stage).filter(
    (field) => latestAssessment(state, field) !== 'nao_aplicavel',
  );
  for (const assessment of latestAssessments(state.assessments)) {
    const definition = resolveFieldDefinition(assessment.field);
    if (
      definition &&
      isAssessmentApplicable(definition, state) &&
      definition.requiredForGate &&
      ['pendente', 'divergente'].includes(assessment.status) &&
      belongsToStage(assessment.field, stage) &&
      !blockers.includes(assessment.field)
    ) {
      blockers.push(assessment.field);
    }
  }
  blockers.sort((left, right) => compareFieldPaths(left, right, state));
  return {
    blockers,
    complete: blockers.length === 0,
    ...(blockers.length > 0 ? { nextPendingField: blockers[0] } : {}),
  };
}

/** @param {any} state @param {string} stage */
function gateBlockers(state, stage) {
  if (stage === 'produto') {
    const blockers = [];
    if (!state.order?.customerEnvelope) blockers.push('order.customer');
    if (!state.order?.nameEnvelope) blockers.push('order.name');
    if (state.order?.commercialIntent !== true)
      blockers.push('order.commercialIntent');
    if (state.items.length === 0) blockers.push('items');
    for (const item of state.items) {
      if (!item.productCode) blockers.push(`items.${item.id}.product`);
      if (!item.modelCode) blockers.push(`items.${item.id}.model`);
      if (
        !Number.isSafeInteger(item.estimatedQuantity) ||
        item.estimatedQuantity < 1
      ) {
        blockers.push(`items.${item.id}.estimatedQuantity`);
      }
    }
    return blockers;
  }
  if (stage === 'especificacao') {
    const blockers = [];
    for (const item of state.items) {
      if (item.fabrics.length === 0) blockers.push(`items.${item.id}.fabrics`);
      for (const key of PIECE_COLORS) {
        if (!item.colors[key]) blockers.push(`items.${item.id}.colors.${key}`);
      }
      if (
        item.grade.length === 0 ||
        /** @type {any[]} */ (item.grade).some(
          (line) => !Number.isSafeInteger(line.quantity) || line.quantity < 1,
        ) ||
        /** @type {any[]} */ (item.grade).reduce(
          (total, line) => total + line.quantity,
          0,
        ) !== item.estimatedQuantity
      ) {
        blockers.push(`items.${item.id}.grade.total`);
      }
    }
    return blockers;
  }
  if (stage === 'estampa') {
    const artwork = state.artwork;
    if (!artwork) return ['artwork.status'];
    if (artwork.status === 'not_applicable') {
      return latestAssessment(state, 'artwork') === 'nao_aplicavel'
        ? []
        : ['artwork'];
    }
    const blockers = [];
    if (!artwork.responsibilityEnvelope)
      blockers.push('artwork.responsibility');
    if (!artwork.techniqueCode) blockers.push('artwork.technique');
    if (artwork.locations.length === 0) blockers.push('artwork.locations');
    if (artwork.colors.length === 0) blockers.push('artwork.colors');
    if (artwork.status === 'ready' && artwork.files.length === 0)
      blockers.push('artwork.files');
    return blockers;
  }
  const logistics = state.logistics;
  if (!logistics) return ['logistics.desiredDate'];
  const blockers = [];
  if (!logistics.desiredDate) blockers.push('logistics.desiredDate');
  if (!logistics.purposeEnvelope) blockers.push('logistics.purpose');
  if (!logistics.purchaseProfileEnvelope)
    blockers.push('logistics.purchaseProfile');
  if (!['delivery', 'pickup'].includes(logistics.mode))
    blockers.push('logistics.mode');
  if (logistics.mode === 'delivery') {
    if (!logistics.cityEnvelope) blockers.push('logistics.city');
    if (!logistics.addressEnvelope) blockers.push('logistics.address');
  }
  if (logistics.mode === 'pickup' && !logistics.pickupLocationEnvelope) {
    blockers.push('logistics.pickupLocation');
  }
  return blockers;
}

/** @param {any[]} assessments */
function latestAssessments(assessments) {
  const latest = new Map();
  for (const assessment of assessments)
    latest.set(assessment.field, assessment);
  return [...latest.values()];
}

/** @param {any} state @param {string} field */
function latestAssessment(state, field) {
  const definition = resolveFieldDefinition(field);
  if (!definition || !isAssessmentApplicable(definition, state))
    return undefined;
  return latestAssessments(state.assessments).find(
    (value) => value.field === field,
  )?.status;
}

/** @param {string} field @param {string} stage */
function belongsToStage(field, stage) {
  if (stage === 'produto')
    return (
      field.startsWith('order.') ||
      /^items\.[^.]+\.(product|model|estimatedQuantity)$/u.test(field)
    );
  if (stage === 'especificacao') return field.startsWith('items.');
  if (stage === 'estampa') return field.startsWith('artwork');
  return field.startsWith('logistics.');
}

/** @typedef {{order?: Record<string, any>, items?: any[], artwork?: Record<string, any>, logistics?: Record<string, any>, observations?: string[], assessments?: any[]}} QualificationFields */

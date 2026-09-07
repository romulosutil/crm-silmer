import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { DEAL_STAGES } from './domain/deal.js';

const STAGE_LABELS = Object.freeze({
  produto: 'Produto',
  especificacao: 'Especificação',
  estampa: 'Estampa',
  logistica: 'Logística',
  fechamento: 'Fechamento',
});

export class DealReadError extends Error {
  /** @param {number} statusCode @param {string} code @param {string} [message] */
  constructor(statusCode, code, message = code) {
    super(message);
    this.name = 'DealReadError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** @param {{repository: any, cursorKey: Buffer}} dependencies */
export function createDealReadService({ repository, cursorKey }) {
  if (!repository || typeof repository !== 'object')
    throw new TypeError('repository is required');
  if (!Buffer.isBuffer(cursorKey) || cursorKey.length < 32)
    throw new TypeError('cursorKey must contain at least 32 bytes');

  /** @param {any} input @param {string} stage */
  async function loadColumn(input, stage) {
    const filters = validateFilters(input);
    const fingerprint = filterFingerprint(filters);
    const cursor =
      input.cursor === undefined
        ? null
        : decodeDealCursor(input.cursor, { cursorKey, fingerprint, stage });
    const result = await repository.getBoard({ ...filters, cursor, stage });
    const rows = result.rows ?? [];
    return Object.freeze({
      cards: rows.map(freeze),
      count: Number(result.count ?? rows.length),
      label: STAGE_LABELS[/** @type {keyof typeof STAGE_LABELS} */ (stage)],
      nextCursor:
        result.hasMore && rows.length > 0
          ? encodeDealCursor(rows.at(-1), { cursorKey, fingerprint, stage })
          : null,
      stage,
    });
  }

  return Object.freeze({
    /** @param {any} input */
    async getBoard(input = {}) {
      if (input.cursor !== undefined || input.stage !== undefined)
        throw new DealReadError(
          400,
          'INVALID_FILTER',
          'Board cursors are per stage',
        );
      return Object.freeze({
        columns: await Promise.all(
          DEAL_STAGES.map((stage) => loadColumn(input, stage)),
        ),
      });
    },
    /** @param {any} input */
    async getColumn(input = {}) {
      if (!DEAL_STAGES.includes(input.stage))
        throw new DealReadError(400, 'INVALID_STAGE');
      return loadColumn(input, input.stage);
    },
    /** @param {{dealId: string, ifNoneMatch?: string}} input */
    async getDetail(input) {
      const dealId = boundedId(input?.dealId, 'dealId');
      if (input.ifNoneMatch !== undefined) {
        const version = await repository.getVersion(dealId);
        if (version === null || version === undefined)
          throw new DealReadError(404, 'DEAL_NOT_FOUND');
        const etag = dealEtag(dealId, version);
        if (input.ifNoneMatch === etag)
          return Object.freeze({ etag, notModified: true });
      }
      const detail = await repository.getDetail(dealId);
      if (!detail) throw new DealReadError(404, 'DEAL_NOT_FOUND');
      const representationVersion = detail.representationVersion;
      if (
        typeof representationVersion !== 'string' ||
        representationVersion.length === 0
      )
        throw new TypeError(
          'repository detail must include representationVersion',
        );
      const publicDetail = { ...detail };
      delete publicDetail.representationVersion;
      return Object.freeze({
        detail: freeze(publicDetail),
        etag: dealEtag(dealId, representationVersion),
        notModified: false,
      });
    },
    /** @param {{after?: unknown, limit?: number, topic?: unknown}} input */
    async readEvents(input = {}) {
      const topic = input.topic ?? 'kanban';
      const limit = input.limit === undefined ? 100 : Number(input.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
        throw new DealReadError(400, 'INVALID_LIMIT');
      const after =
        input.after === undefined || input.after === ''
          ? 0
          : Number(input.after);
      if (!Number.isSafeInteger(after) || after < 0 || topic !== 'kanban') {
        const snapshot = await repository.readEvents({
          after: 0,
          limit: 1,
          topic: 'kanban',
        });
        return Object.freeze({
          cursor: snapshot.latestCursor,
          events: [],
          reset: {
            reason: topic !== 'kanban' ? 'invalid_topic' : 'invalid_cursor',
          },
        });
      }
      const result = await repository.readEvents({ after, limit, topic });
      if (after > 0 && result.minimumCursor > after + 1)
        return Object.freeze({
          cursor: result.latestCursor,
          events: [],
          reset: { reason: 'retention_gap' },
        });
      if (after > result.latestCursor)
        return Object.freeze({
          cursor: result.latestCursor,
          events: [],
          reset: { reason: 'cursor_ahead' },
        });
      if (result.hasMore)
        return Object.freeze({
          cursor: result.latestCursor,
          events: [],
          reset: { reason: 'replay_limit' },
        });
      const events = (result.rows ?? []).map(freeze);
      return Object.freeze({
        cursor: events.at(-1)?.cursor ?? after,
        events,
        reset: null,
      });
    },
  });
}

/** @param {any} value @param {{cursorKey: Buffer, fingerprint: string, stage: string}} context */
export function encodeDealCursor(value, context) {
  const payload = Buffer.from(
    JSON.stringify({
      fingerprint: context.fingerprint,
      id: value.id,
      stage: context.stage,
      updatedAt: value.updatedAt,
    }),
    'utf8',
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', context.cursorKey).update(payload).digest('base64url')}`;
}

/** @param {unknown} value @param {{cursorKey: Buffer, fingerprint: string, stage: string}} context */
export function decodeDealCursor(value, context) {
  try {
    if (typeof value !== 'string' || value.length > 1024) throw new Error();
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac('sha256', context.cursorKey)
      .update(payload)
      .digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error();
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    if (
      !parsed ||
      Object.keys(parsed).sort().join(',') !==
        'fingerprint,id,stage,updatedAt' ||
      parsed.stage !== context.stage ||
      parsed.fingerprint !== context.fingerprint ||
      boundedId(parsed.id, 'cursor.id') !== parsed.id ||
      new Date(parsed.updatedAt).toISOString() !== parsed.updatedAt
    )
      throw new Error();
    return Object.freeze({ id: parsed.id, updatedAt: parsed.updatedAt });
  } catch {
    throw new DealReadError(400, 'INVALID_CURSOR', 'cursor is invalid');
  }
}

/** @param {any} input */
function validateFilters(input) {
  const allowed = new Set([
    'assignedUserId',
    'cursor',
    'hasOverdueTask',
    'limit',
    'stage',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new DealReadError(400, 'INVALID_FILTER');
  const limit = input.limit === undefined ? 20 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new DealReadError(
      400,
      'INVALID_LIMIT',
      'limit must be between 1 and 100',
    );
  if (
    input.hasOverdueTask !== undefined &&
    typeof input.hasOverdueTask !== 'boolean'
  )
    throw new DealReadError(400, 'INVALID_FILTER');
  if (input.assignedUserId !== undefined)
    boundedId(input.assignedUserId, 'assignedUserId');
  return Object.freeze({
    assignedUserId: input.assignedUserId,
    hasOverdueTask: input.hasOverdueTask,
    limit,
    order: 'updated_at_desc,id_desc',
  });
}

/** @param {any} filters */
function filterFingerprint(filters) {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}
/** @param {string} dealId @param {unknown} version */
function dealEtag(dealId, version) {
  return `"deal-${createHash('sha256')
    .update(`${dealId}:${String(version)}`)
    .digest('base64url')}"`;
}
/** @param {unknown} value @param {string} field */
function boundedId(value, field) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value)
  )
    throw new DealReadError(400, 'INVALID_ID', `${field} is invalid`);
  return value;
}
/** @param {any} value @returns {any} */
function freeze(value) {
  return deepFreeze(structuredClone(value));
}
/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

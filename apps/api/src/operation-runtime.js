import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import { PostgresContactReadRepository } from '@crm-silmer/contacts';
import { PostgresInboxReadRepository } from '@crm-silmer/inbox-channels';
import { PostgresHandoffReadRepository } from '@crm-silmer/work-management';

const DISPLAY_NAME_MAX_LENGTH = 120;

const CONVERSATION_STATES = new Set([
  'nova',
  'em_analise',
  'em_atendimento',
  'requer_atencao',
  'convertida_em_lead',
  'sem_lead',
]);
const CHANNELS = new Set(['instagram', 'whatsapp']);
const AUTOMATION_STATES = new Set(['assistant', 'human']);

export class OperationReadError extends Error {
  /** @param {number} statusCode @param {string} code */
  constructor(statusCode, code) {
    super(code);
    this.name = 'OperationReadError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** @param {{contactRepository: any, cursorKey: Buffer, handoffRepository: any, inboxRepository: any}} dependencies */
export function createOperationReadService({
  contactRepository,
  cursorKey,
  handoffRepository,
  inboxRepository,
}) {
  if (!contactRepository || typeof contactRepository !== 'object') {
    throw new TypeError('contactRepository is required');
  }
  if (!inboxRepository || typeof inboxRepository !== 'object') {
    throw new TypeError('inboxRepository is required');
  }
  if (!handoffRepository || typeof handoffRepository !== 'object') {
    throw new TypeError('handoffRepository is required');
  }
  if (!Buffer.isBuffer(cursorKey) || cursorKey.length < 32) {
    throw new TypeError('cursorKey must contain at least 32 bytes');
  }

  return Object.freeze({
    /** @param {any} input */
    async getContact(input) {
      return contactRepository.get(requireId(input?.contactId, 'CONTACT_ID'));
    },
    /** @param {any} input */
    async getConversation(input) {
      return inboxRepository.get(
        requireId(input?.conversationId, 'CONVERSATION_ID'),
      );
    },
    /** @param {any} input */
    async listContacts(input = {}) {
      rejectUnknownKeys(input, ['cursor', 'limit']);
      const limit = readLimit(input.limit);
      const after = readCursor(input.cursor, {
        cursorKey,
        fingerprint: filterFingerprint({}),
        scope: 'contacts',
      });
      const result = await contactRepository.list({ after, limit });
      return pageResponse(result, {
        cursorKey,
        fingerprint: filterFingerprint({}),
        scope: 'contacts',
      });
    },
    /** @param {any} input */
    async listInbox(input = {}) {
      rejectUnknownKeys(input, [
        'assignedUserId',
        'automationState',
        'channel',
        'cursor',
        'limit',
        'state',
      ]);
      const filters = {};
      if (input.assignedUserId !== undefined) {
        filters.assignedUserId = requireId(
          input.assignedUserId,
          'ASSIGNED_USER_ID',
        );
      }
      if (input.automationState !== undefined) {
        filters.automationState = requireChoice(
          input.automationState,
          AUTOMATION_STATES,
        );
      }
      if (input.channel !== undefined) {
        filters.channel = requireChoice(input.channel, CHANNELS);
      }
      if (input.state !== undefined) {
        filters.state = requireChoice(input.state, CONVERSATION_STATES);
      }
      const fingerprint = filterFingerprint(filters);
      const limit = readLimit(input.limit);
      const after = readCursor(input.cursor, {
        cursorKey,
        fingerprint,
        scope: 'inbox',
      });
      const result = await inboxRepository.list({ after, ...filters, limit });
      return pageResponse(result, {
        cursorKey,
        fingerprint,
        scope: 'inbox',
      });
    },
    /** @param {any} input */
    async listOpenHandoffs(input = {}) {
      rejectUnknownKeys(input, ['cursor', 'limit']);
      const limit = readLimit(input.limit);
      const after = readCursor(input.cursor, {
        cursorKey,
        fingerprint: filterFingerprint({ status: 'pending' }),
        scope: 'handoffs',
      });
      const result = await handoffRepository.listOpen({ after, limit });
      return pageResponse(result, {
        cursorKey,
        fingerprint: filterFingerprint({ status: 'pending' }),
        scope: 'handoffs',
      });
    },
  });
}

/**
 * @param {any} database
 * @param {{identity?: any, environment?: Record<string, string|undefined>}} [options]
 */
export function createOperationReadRuntime(database, options = {}) {
  const environment = options.environment ?? process.env;
  const service = createOperationReadService({
    contactRepository: new PostgresContactReadRepository({
      database,
      envelopeKey: readKey(
        environment.CONTACT_IDENTITY_ENVELOPE_KEY,
        'CONTACT_IDENTITY_ENVELOPE_KEY',
      ),
    }),
    cursorKey: readKey(
      environment.KANBAN_CURSOR_HMAC_KEY,
      'KANBAN_CURSOR_HMAC_KEY',
    ),
    handoffRepository: new PostgresHandoffReadRepository({
      contactEnvelopeKey: readKey(
        environment.CONTACT_IDENTITY_ENVELOPE_KEY,
        'CONTACT_IDENTITY_ENVELOPE_KEY',
      ),
      database,
      handoffEnvelopeKey: readKey(
        environment.HANDOFF_ENVELOPE_KEY,
        'HANDOFF_ENVELOPE_KEY',
      ),
    }),
    inboxRepository: new PostgresInboxReadRepository({
      contactEnvelopeKey: readKey(
        environment.CONTACT_IDENTITY_ENVELOPE_KEY,
        'CONTACT_IDENTITY_ENVELOPE_KEY',
      ),
      database,
      messageEnvelopeKey: readKey(
        environment.INBOX_MESSAGE_ENVELOPE_KEY,
        'INBOX_MESSAGE_ENVELOPE_KEY',
      ),
    }),
  });

  const auditPort = new PostgresAuditTrail(database);

  return Object.freeze({
    ...service,

    /**
     * Renames a contact. The channel handle in contact_identities keeps
     * mirroring the provider; only crm.contacts.display_name is operator-owned,
     * so a rename never desynchronises the identity envelope.
     * @param {{actor: {id: string}, contactId: unknown, correlationId: string, displayName: unknown, expectedVersion: unknown, reason: string}} input
     */
    async renameContact(input) {
      const contactId = requireId(input.contactId, 'CONTACT_ID');
      const displayName = readDisplayName(input.displayName);
      const expectedVersion = Number(input.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
        throw new OperationReadError(400, 'INVALID_REQUEST');
      }
      return database.transaction(async (/** @type {any} */ transaction) => {
        const current = await transaction.query(
          'SELECT id, version FROM crm.contacts WHERE id = $1 FOR UPDATE',
          [contactId],
        );
        if (!current.rows[0]) {
          throw new OperationReadError(404, 'CONTACT_NOT_FOUND');
        }
        if (Number(current.rows[0].version) !== expectedVersion) {
          throw new OperationReadError(409, 'CONTACT_CONFLICT');
        }
        const occurredAt = new Date().toISOString();
        const updated = await transaction.query(
          `UPDATE crm.contacts
           SET display_name = $2, version = version + 1, updated_at = $3
           WHERE id = $1 RETURNING id, display_name, version`,
          [contactId, displayName, occurredAt],
        );
        const row = updated.rows[0];
        await auditPort.append(
          {
            action: 'contact.renamed',
            actor: input.actor.id,
            correlationId: input.correlationId,
            occurredAt,
            reason: input.reason,
            target: { id: contactId, type: 'contact' },
            version: Number(row.version),
          },
          { transaction },
        );
        await transaction.query(
          `INSERT INTO crm.domain_events
             (id, aggregate_type, aggregate_id, aggregate_version, event_type,
              payload, correlation_id, occurred_at)
           VALUES ($1, 'contact', $2, $3, 'contact.renamed', $4::jsonb, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            `event-${randomUUID()}`,
            contactId,
            Number(row.version),
            JSON.stringify({ contactId }),
            input.correlationId,
            occurredAt,
          ],
        );
        return Object.freeze({
          displayName: row.display_name,
          id: row.id,
          version: Number(row.version),
        });
      });
    },

    /**
     * Write counterpart of authorizeRead: mutations additionally require the
     * CSRF token, so they go through authorizeOperational.
     * @param {any} input
     */
    async authorizeWrite(input) {
      if (input.authorization !== undefined) {
        throw new OperationReadError(403, 'FORBIDDEN');
      }
      if (!options.identity) {
        throw new OperationReadError(503, 'IDENTITY_UNAVAILABLE');
      }
      if (
        typeof input.origin !== 'string' ||
        !options.identity.allowedOrigins.includes(input.origin)
      ) {
        throw new OperationReadError(403, 'FORBIDDEN');
      }
      const sessionToken = parseCookies(input.cookie).get('crm_session');
      if (typeof sessionToken !== 'string') {
        throw new OperationReadError(403, 'FORBIDDEN');
      }
      return options.identity.authorizeOperational({
        action: input.action,
        csrfToken: input.csrfToken,
        sessionToken,
      });
    },

    /** @param {any} input */
    async authorizeRead(input) {
      if (input.authorization !== undefined) {
        throw new OperationReadError(403, 'FORBIDDEN');
      }
      if (!options.identity) {
        throw new OperationReadError(503, 'IDENTITY_UNAVAILABLE');
      }
      if (
        (input.origin !== undefined &&
          (typeof input.origin !== 'string' ||
            !options.identity.allowedOrigins.includes(input.origin))) ||
        (input.origin === undefined &&
          !['same-origin', 'none'].includes(input.secFetchSite))
      ) {
        throw new OperationReadError(403, 'FORBIDDEN');
      }
      const sessionToken = parseCookies(input.cookie).get('crm_session');
      if (typeof sessionToken !== 'string') {
        throw new OperationReadError(403, 'FORBIDDEN');
      }
      return options.identity.authorizeOperationalRead({
        action: input.action,
        sessionToken,
      });
    },
  });
}

/** @param {any} result @param {{cursorKey: Buffer, fingerprint: string, scope: string}} context */
function pageResponse(result, context) {
  const items = result.items ?? [];
  return Object.freeze({
    items,
    nextCursor:
      result.hasMore && items.length > 0
        ? encodeCursor(items.at(-1), context)
        : null,
    totalCount: Number(result.totalCount ?? items.length),
  });
}

/** @param {any} value @param {{cursorKey: Buffer, fingerprint: string, scope: string}} context */
function encodeCursor(value, context) {
  const payload = Buffer.from(
    JSON.stringify({
      fingerprint: context.fingerprint,
      id: value.id,
      scope: context.scope,
      updatedAt: value.updatedAt,
    }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', context.cursorKey)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/** @param {unknown} value @param {{cursorKey: Buffer, fingerprint: string, scope: string}} context */
function readCursor(value, context) {
  if (value === undefined) return null;
  try {
    if (typeof value !== 'string' || value.length > 1024) throw new Error();
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac('sha256', context.cursorKey)
      .update(payload)
      .digest();
    const actual = Buffer.from(signature, 'base64url');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new Error();
    }
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    if (
      !parsed ||
      Object.keys(parsed).sort().join(',') !==
        'fingerprint,id,scope,updatedAt' ||
      parsed.fingerprint !== context.fingerprint ||
      parsed.scope !== context.scope ||
      requireId(parsed.id, 'CURSOR_ID') !== parsed.id ||
      new Date(parsed.updatedAt).toISOString() !== parsed.updatedAt
    ) {
      throw new Error();
    }
    return Object.freeze({ id: parsed.id, updatedAt: parsed.updatedAt });
  } catch {
    throw new OperationReadError(400, 'INVALID_CURSOR');
  }
}

/** @param {unknown} value */
function readLimit(value) {
  const limit = value === undefined ? 50 : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new OperationReadError(400, 'INVALID_LIMIT');
  }
  return limit;
}

/**
 * An empty string clears the operator-chosen name and lets readers fall back to
 * the channel handle.
 * @param {unknown} value
 */
function readDisplayName(value) {
  if (typeof value !== 'string') {
    throw new OperationReadError(400, 'INVALID_DISPLAY_NAME');
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const hasControlCharacter = [...trimmed].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH || hasControlCharacter) {
    throw new OperationReadError(400, 'INVALID_DISPLAY_NAME');
  }
  return trimmed;
}

/** @param {unknown} value @param {Set<string>} accepted */
function requireChoice(value, accepted) {
  if (typeof value !== 'string' || !accepted.has(value)) {
    throw new OperationReadError(400, 'INVALID_FILTER');
  }
  return value;
}

/** @param {unknown} value @param {string} code */
function requireId(value, code) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value)
  ) {
    throw new OperationReadError(400, `INVALID_${code}`);
  }
  return value;
}

/** @param {Record<string, unknown>} value @param {string[]} allowed */
function rejectUnknownKeys(value, allowed) {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new OperationReadError(400, 'INVALID_FILTER');
  }
}

/** @param {Record<string, unknown>} filters */
function filterFingerprint(filters) {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}

/** @param {unknown} raw */
function parseCookies(raw) {
  if (typeof raw !== 'string') return new Map();
  const cookies = new Map();
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (cookies.has(name)) throw new OperationReadError(400, 'INVALID_REQUEST');
    cookies.set(name, value);
  }
  return cookies;
}

/** @param {string|undefined} value @param {string} name */
function readKey(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`${name} must use base64url`);
  }
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

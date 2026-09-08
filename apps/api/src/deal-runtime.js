import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import { PostgresContactConversionPort } from '@crm-silmer/contacts';
import {
  PostgresDealAutomationFencePort,
  PostgresDealReadRepository,
  PostgresDealRepository,
  PostgresDealWorkPort,
  createDealCommandService,
  createDealConversionService,
  createDealLossReasonCipher,
  createDealReadService,
} from '@crm-silmer/deals-pipeline';
import {
  PostgresConversationConversionPort,
  PostgresHandoffConversationPort,
} from '@crm-silmer/inbox-channels';
import { PostgresOperationalUserPort } from '@crm-silmer/identity-access';
import {
  PostgresDomainEventStore,
  PostgresIdempotencyRecordStore,
} from '@crm-silmer/integration-reliability';
import {
  PostgresQualificationAttachmentPort,
  PostgresQualificationCatalog,
  PostgresQualificationRepository,
  createQualificationCipher,
  createQualificationService,
} from '@crm-silmer/qualification';
import {
  PostgresWorkManagementRepository,
  createHandoffCipher,
  createWorkManagementService,
} from '@crm-silmer/work-management';

/**
 * @param {any} database
 * @param {{automationAuth?: any, environment?: Record<string, string|undefined>, identity?: any}} [options]
 */
export function createDealApiRuntime(database, options = {}) {
  if (
    !database ||
    typeof database.query !== 'function' ||
    typeof database.transaction !== 'function'
  ) {
    throw new TypeError('A transactional PostgreSQL database is required');
  }
  const environment = options.environment ?? process.env;
  const auditPort = new PostgresAuditTrail(database);
  const dealRepository = new PostgresDealRepository();
  const eventPort = new PostgresDomainEventStore();
  const idempotencyStore = new PostgresIdempotencyRecordStore({
    database,
    envelopeKey: readEnvelopeKey(
      environment.IDEMPOTENCY_ENVELOPE_KEY,
      'IDEMPOTENCY_ENVELOPE_KEY',
    ),
  });
  const conversion = createDealConversionService({
    auditPort,
    contactPort: new PostgresContactConversionPort(),
    dealRepository,
    eventPort,
    idempotencyStore,
    inboxPort: new PostgresConversationConversionPort(),
  });
  const qualificationRepository = new PostgresQualificationRepository({
    cipher: createQualificationCipher({
      key: readEnvelopeKey(
        environment.QUALIFICATION_ENVELOPE_KEY,
        'QUALIFICATION_ENVELOPE_KEY',
      ),
    }),
  });
  const commands = createDealCommandService({
    auditPort,
    automationFencePort: new PostgresDealAutomationFencePort(),
    dealRepository,
    eventPort,
    idempotencyStore,
    lossReasonCipher: createDealLossReasonCipher({
      key: readEnvelopeKey(environment.DEAL_ENVELOPE_KEY, 'DEAL_ENVELOPE_KEY'),
    }),
    qualificationPort: qualificationRepository,
  });
  const qualification = createQualificationService({
    auditPort,
    attachmentPort: new PostgresQualificationAttachmentPort(),
    automationFencePort: new PostgresDealAutomationFencePort(),
    catalogPort: new PostgresQualificationCatalog(),
    dealRepository,
    eventPort,
    idempotencyStore,
    qualificationRepository,
  });
  const workManagement = createWorkManagementService({
    auditPort,
    cipher: createHandoffCipher({
      key: readEnvelopeKey(
        environment.HANDOFF_ENVELOPE_KEY,
        'HANDOFF_ENVELOPE_KEY',
      ),
    }),
    eventPort,
    idempotencyStore,
    repository: new PostgresWorkManagementRepository({
      conversationPort: new PostgresHandoffConversationPort(),
      dealPort: new PostgresDealWorkPort(),
      userPort: new PostgresOperationalUserPort(),
    }),
    slaMinutes: readSlaMinutes(environment.HANDOFF_SLA_MINUTES),
    slaPolicyVersion:
      environment.HANDOFF_SLA_POLICY_VERSION ?? 'technical-default-v1',
  });
  const readModel = createDealReadService({
    cursorKey: readEnvelopeKey(
      environment.KANBAN_CURSOR_HMAC_KEY,
      'KANBAN_CURSOR_HMAC_KEY',
    ),
    repository: new PostgresDealReadRepository(database),
  });

  return Object.freeze({
    /** @param {any} input */
    async authorize(input) {
      if (input.authorization !== undefined) {
        if (!options.automationAuth) {
          throw httpError(503, 'AUTOMATION_AUTH_UNAVAILABLE');
        }
        return options.automationAuth.authorize(input);
      }
      if (!options.identity) throw httpError(503, 'IDENTITY_UNAVAILABLE');
      if (
        typeof input.origin !== 'string' ||
        !options.identity.allowedOrigins.includes(input.origin)
      ) {
        throw httpError(403, 'FORBIDDEN');
      }
      const cookies = parseCookies(input.cookie);
      const sessionToken = cookies.get('crm_session');
      const csrfCookie = cookies.get('crm_csrf');
      if (
        typeof sessionToken !== 'string' ||
        typeof csrfCookie !== 'string' ||
        typeof input.csrfToken !== 'string' ||
        csrfCookie !== input.csrfToken
      ) {
        throw httpError(403, 'FORBIDDEN');
      }
      return options.identity.authorizeOperational({
        action: input.action,
        csrfToken: csrfCookie,
        sessionToken,
      });
    },
    /** @param {any} input */
    async authorizeRead(input) {
      if (input.authorization !== undefined) throw httpError(403, 'FORBIDDEN');
      if (!options.identity) throw httpError(503, 'IDENTITY_UNAVAILABLE');
      if (
        (input.origin !== undefined &&
          (typeof input.origin !== 'string' ||
            !options.identity.allowedOrigins.includes(input.origin))) ||
        (input.origin === undefined &&
          !['same-origin', 'none'].includes(input.secFetchSite))
      )
        throw httpError(403, 'FORBIDDEN');
      const sessionToken = parseCookies(input.cookie).get('crm_session');
      if (typeof sessionToken !== 'string') throw httpError(403, 'FORBIDDEN');
      return options.identity.authorizeOperationalRead({
        action: input.action,
        sessionToken,
      });
    },
    convertConversation: conversion.convertConversation,
    acceptHandoff: workManagement.acceptHandoff,
    assignDeal: workManagement.assignDeal,
    cancelTask: workManagement.cancelTask,
    claimHandoff: workManagement.claimHandoff,
    completeTask: workManagement.completeTask,
    createHandoff: workManagement.createHandoff,
    createTask: workManagement.createTask,
    getDealDetail: readModel.getDetail,
    getKanbanBoard: readModel.getBoard,
    getKanbanColumn: readModel.getColumn,
    loseDeal: commands.loseDeal,
    patchFields: qualification.patchFields,
    readDealEvents: readModel.readEvents,
    resolveHandoff: workManagement.resolveHandoff,
    startTask: workManagement.startTask,
    transitionDeal: commands.transitionDeal,
    transferHandoff: workManagement.transferHandoff,
  });
}

/** @param {unknown} raw */
function parseCookies(raw) {
  if (raw === undefined) return new Map();
  if (typeof raw !== 'string') throw httpError(400, 'INVALID_REQUEST');
  const cookies = new Map();
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (cookies.has(name)) throw httpError(400, 'INVALID_REQUEST');
    cookies.set(name, value);
  }
  return cookies;
}

/** @param {string|undefined} value @param {string} name */
function readEnvelopeKey(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`${name} must use base64url`);
  }
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) {
    throw new Error(`${name} must decode to 32 bytes`);
  }
  return key;
}

/** @param {string|undefined} value */
function readSlaMinutes(value) {
  if (value === undefined || value === '') return 240;
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(
      'HANDOFF_SLA_MINUTES must be an integer between 5 and 10080',
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 5 || parsed > 10_080) {
    throw new Error(
      'HANDOFF_SLA_MINUTES must be an integer between 5 and 10080',
    );
  }
  return parsed;
}

/** @param {number} statusCode @param {string} code */
function httpError(statusCode, code) {
  return Object.assign(new Error(code), { code, statusCode });
}

import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import { PostgresContactConversionPort } from '@crm-silmer/contacts';
import {
  PostgresDealAutomationFencePort,
  PostgresDealRepository,
  createDealCommandService,
  createDealConversionService,
  createDealLossReasonCipher,
} from '@crm-silmer/deals-pipeline';
import { PostgresConversationConversionPort } from '@crm-silmer/inbox-channels';
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
    convertConversation: conversion.convertConversation,
    loseDeal: commands.loseDeal,
    patchFields: qualification.patchFields,
    transitionDeal: commands.transitionDeal,
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

/** @param {number} statusCode @param {string} code */
function httpError(statusCode, code) {
  return Object.assign(new Error(code), { code, statusCode });
}

import { CAPABILITIES } from '@crm-silmer/identity-access';
import {
  createOrderService,
  OrderForbiddenError,
  OrderNotFoundError,
  PostgresOrderConversationPort,
  PostgresOrderRepository,
} from '@crm-silmer/orders';

/**
 * @typedef {{
 *   authorizeRead(input: Record<string, unknown>): Promise<{actor: any}>,
 *   authorizeWrite(input: Record<string, unknown>): Promise<{actor: any}>,
 * }} OrderAccess
 * @typedef {{
 *   readAssignment(conversationId: string): Promise<{assignedUserId: string|null}|null>,
 *   readOrderContext(conversationId: string): Promise<any>,
 *   searchConversationIds(query: string): Promise<string[]>,
 * }} OrderConversationPort
 */

/**
 * Composes the order service with the ownership rule of ADR 006: only the
 * conversation owner or a COMMERCIAL_ADMIN changes an order. The owner is read
 * from the conversation on every command, so "Repassar atendimento" moves the
 * order with the conversation and there is no separate order ownership.
 *
 * @param {{
 *   access: OrderAccess,
 *   conversations: OrderConversationPort,
 *   fabCode: string,
 *   repository: any,
 *   clock?: () => Date,
 *   idFactory?: () => string,
 * }} options
 */
export function createOrderRuntime(options) {
  const { access, conversations } = options;
  if (
    typeof access?.authorizeRead !== 'function' ||
    typeof access.authorizeWrite !== 'function'
  ) {
    throw new TypeError('order access guards are required');
  }
  if (typeof conversations?.readAssignment !== 'function') {
    throw new TypeError('a conversation assignment reader is required');
  }

  const service = createOrderService({
    /** @param {{actor: {id: string, capabilities?: readonly string[]}, conversationId: string}} input */
    async authorizeOwnership({ actor, conversationId }) {
      const assignment = await conversations.readAssignment(conversationId);
      if (!assignment) {
        throw new OrderNotFoundError(
          'Conversation was not found',
          'CONVERSATION_NOT_FOUND',
        );
      }
      if ((actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN)) {
        return;
      }
      if (assignment.assignedUserId !== actor.id) {
        throw new OrderForbiddenError();
      }
    },
    clock: options.clock,
    conversations,
    fabCode: options.fabCode,
    idFactory: options.idFactory,
    repository: options.repository,
  });

  return Object.freeze({
    authorizeRead: access.authorizeRead,
    authorizeWrite: access.authorizeWrite,
    confirm: service.confirm,
    createManual: service.createManual,
    currentForConversation: service.currentForConversation,
    ensurePendingFromIntent: service.ensurePendingFromIntent,
    get: service.get,
    list: service.list,
    patchSection: service.patchSection,
    reopen: service.reopen,
  });
}

/**
 * PostgreSQL wiring. The session guards come from the operation runtime so
 * order routes share the Inbox read (session) and write (session + CSRF) rules.
 *
 * @param {any} database
 * @param {{access: OrderAccess, environment?: Record<string, string|undefined>}} options
 */
export function createOrderApiRuntime(database, options) {
  const environment = options.environment ?? process.env;
  const envelopeKey = readEnvelopeKey(
    environment.N8N_INTEGRATION_ENVELOPE_KEY,
    'N8N_INTEGRATION_ENVELOPE_KEY',
  );
  return createOrderRuntime({
    access: options.access,
    conversations: new PostgresOrderConversationPort({
      contactEnvelopeKey: readEnvelopeKey(
        environment.CONTACT_IDENTITY_ENVELOPE_KEY,
        'CONTACT_IDENTITY_ENVELOPE_KEY',
      ),
      database,
      envelopeKey,
    }),
    fabCode: required(environment.FAB_CODE, 'FAB_CODE'),
    repository: new PostgresOrderRepository({ database, envelopeKey }),
  });
}

/** @param {string|undefined} value @param {string} name */
function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required for the orders runtime`);
  }
  return value.trim();
}

/** @param {string|undefined} value @param {string} name */
function readEnvelopeKey(value, name) {
  const encoded = required(value, name);
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(encoded)) {
    throw new Error(`${name} must use base64 or base64url`);
  }
  const key = Buffer.from(
    encoded,
    encoded.includes('-') || encoded.includes('_') ? 'base64url' : 'base64',
  );
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

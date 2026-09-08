import { N8nCommandDeliveryError } from './n8n-outbound-client.js';

export const N8N_COMMAND_JOB_TYPE = 'n8n.command.deliver';
export const N8N_COMMAND_QUEUE = 'external_effects';

/**
 * @typedef {{
 *   loadForDelivery: (commandId: string, context: Record<string, unknown>) => Promise<unknown>,
 *   markProcessing: (commandId: string, context: Record<string, unknown>) => Promise<unknown>,
 *   markDelivered: (commandId: string, context: Record<string, unknown>) => Promise<unknown>,
 *   markFailed: (commandId: string, context: Record<string, unknown>) => Promise<unknown>,
 *   markOutcomeUnknown: (commandId: string, context: Record<string, unknown>) => Promise<unknown>,
 * }} N8nCommandStore
 */

/**
 * Domain-facing store port:
 * - loadForDelivery(commandId, context)
 * - markProcessing(commandId, context)
 * - markDelivered(commandId, context)
 * - markFailed(commandId, context)
 * - markOutcomeUnknown(commandId, context)
 *
 * @param {{
 *   client: {prepareDelivery: Function},
 *   commandStore: N8nCommandStore,
 * }} dependencies
 */
export function createN8nCommandJobHandler({ client, commandStore }) {
  assertClient(client);
  assertCommandStore(commandStore);

  /**
   * @param {Readonly<Record<string, any>>} job
   * @param {{markEffectStarted: (input: {provider: string}) => Promise<boolean>}} workerContext
   */
  return async function handleN8nCommand(job, workerContext) {
    const commandId = jobCommandId(job);
    const attemptContext = Object.freeze({
      attemptId: technicalIdentifier(job.attemptId, 'attemptId'),
      jobId: technicalIdentifier(job.id, 'jobId'),
    });
    let effectStarted = false;

    try {
      const stored = await commandStore.loadForDelivery(
        commandId,
        attemptContext,
      );
      const command = immutableCommand(stored, commandId);
      const delivery = client.prepareDelivery(command);
      const processing = await commandStore.markProcessing(commandId, {
        ...attemptContext,
        payloadHash: delivery.payloadHash,
      });
      if (processing === false) {
        throw new N8nCommandDeliveryError('N8N_COMMAND_STALE', {
          outcomeKnown: true,
        });
      }
      await workerContext.markEffectStarted({ provider: 'n8n' });
      effectStarted = true;
      const acknowledgement = await delivery.execute();
      await commandStore.markDelivered(commandId, {
        ...attemptContext,
        duplicate: acknowledgement.duplicate === true,
        providerExternalId: acknowledgement.providerExternalId,
        statusCode: acknowledgement.statusCode,
      });
      return /** @type {const} */ ({
        outcome: 'sent',
        providerExternalId: acknowledgement.providerExternalId,
      });
    } catch (error) {
      const failure = classifyN8nCommandDeliveryFailure(error, {
        effectStarted,
      });
      if (failure.outcome === 'outcome_unknown') {
        await commandStore.markOutcomeUnknown(commandId, {
          ...attemptContext,
          errorCode: failure.errorCode,
        });
      } else {
        await commandStore.markFailed(commandId, {
          ...attemptContext,
          errorCode: failure.errorCode,
          retryable: failure.retryable,
          retrySafe: failure.retrySafe,
        });
      }
      return failure;
    }
  };
}

/**
 * Resolves a manually investigated uncertain result without performing another
 * remote call. A retry remains a separate, explicitly queued command action.
 *
 * @param {{commandStore: N8nCommandStore, commandId: string, outcome: 'sent'|'failed', providerExternalId?: string, errorCode?: string, reconciledBy: string}} input
 */
export async function reconcileN8nCommandOutcome(input) {
  assertCommandStore(input.commandStore);
  const commandId = technicalIdentifier(input.commandId, 'commandId');
  const context = Object.freeze({
    errorCode:
      input.outcome === 'failed'
        ? safeErrorCode(input.errorCode ?? 'N8N_COMMAND_RECONCILED_FAILED')
        : undefined,
    providerExternalId:
      input.outcome === 'sent'
        ? technicalIdentifier(
            input.providerExternalId ?? commandId,
            'providerExternalId',
            512,
          )
        : undefined,
    reconciledBy: technicalIdentifier(input.reconciledBy, 'reconciledBy'),
    source: 'manual_reconciliation',
  });
  if (input.outcome === 'sent') {
    await input.commandStore.markDelivered(commandId, context);
  } else if (input.outcome === 'failed') {
    await input.commandStore.markFailed(commandId, {
      ...context,
      retryable: false,
      retrySafe: false,
    });
  } else {
    throw new TypeError('outcome must be sent or failed');
  }
}

/**
 * @param {unknown} error
 * @param {{effectStarted: boolean}} context
 */
export function classifyN8nCommandDeliveryFailure(error, context) {
  const known = error instanceof N8nCommandDeliveryError;
  const errorCode = safeErrorCode(
    known ? error.code : readTechnicalErrorCode(error),
  );
  const retryable = known ? error.retryable : true;
  const retrySafe = context.effectStarted
    ? known
      ? error.retrySafe
      : false
    : retryable;
  const outcomeKnown = known ? error.outcomeKnown : false;
  if (context.effectStarted && !outcomeKnown && !retrySafe) {
    return Object.freeze({
      errorCode,
      outcome: 'outcome_unknown',
      retryable: false,
      retrySafe: false,
    });
  }
  return Object.freeze({
    errorCode,
    outcome: 'failed',
    retryable,
    retrySafe,
  });
}

/** @param {unknown} stored @param {string} commandId */
function immutableCommand(stored, commandId) {
  if (!stored || typeof stored !== 'object') {
    throw new N8nCommandDeliveryError('N8N_COMMAND_NOT_FOUND', {
      outcomeKnown: true,
    });
  }
  const record = /** @type {Record<string, any>} */ (stored);
  const storedId = record.commandId ?? record.id;
  if (storedId !== commandId) {
    throw new N8nCommandDeliveryError('N8N_COMMAND_ID_MISMATCH', {
      outcomeKnown: true,
    });
  }
  return Object.freeze({
    commandId,
    payload: record.payload,
    payloadHash: record.payloadHash,
  });
}

/** @param {Readonly<Record<string, any>>} job */
function jobCommandId(job) {
  return technicalIdentifier(job.commandId ?? job.idempotencyKey, 'commandId');
}

/** @param {unknown} client */
function assertClient(client) {
  const record = /** @type {Record<string, unknown>|null} */ (client);
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.prepareDelivery !== 'function'
  ) {
    throw new TypeError('An n8n command delivery client is required');
  }
}

/** @param {unknown} commandStore @returns {N8nCommandStore} */
export function assertN8nCommandStore(commandStore) {
  assertCommandStore(commandStore);
  return /** @type {N8nCommandStore} */ (commandStore);
}

/** @param {unknown} commandStore @returns {asserts commandStore is N8nCommandStore} */
function assertCommandStore(commandStore) {
  const methods = [
    'loadForDelivery',
    'markProcessing',
    'markDelivered',
    'markFailed',
    'markOutcomeUnknown',
  ];
  const record = /** @type {Record<string, unknown>|null} */ (commandStore);
  if (
    !record ||
    methods.some((method) => typeof record[method] !== 'function')
  ) {
    throw new TypeError(
      `n8n command store must implement ${methods.join(', ')}`,
    );
  }
}

/** @param {unknown} error */
function readTechnicalErrorCode(error) {
  return error && typeof error === 'object' && 'code' in error
    ? error.code
    : 'N8N_COMMAND_DELIVERY_FAILED';
}

/** @param {unknown} value */
function safeErrorCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/u.test(value)
    ? value
    : 'N8N_COMMAND_DELIVERY_FAILED';
}

/** @param {unknown} value @param {string} field @param {number} [maximum] */
function technicalIdentifier(value, field, maximum = 128) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    /[\r\n]/u.test(value)
  ) {
    throw new TypeError(`${field} must be a bounded technical identifier`);
  }
  return value;
}

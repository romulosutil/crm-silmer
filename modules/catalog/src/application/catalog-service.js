import {
  createCatalogSelection,
  createPublishedCatalogVersion,
  immutableCatalogClone,
} from '../domain/catalog-version.js';
import {
  CatalogForbiddenError,
  CatalogValidationError,
} from '../domain/errors.js';
import { assertCatalogPorts } from '../ports/contracts.js';

/**
 * @typedef {{ id: string, capabilities: readonly string[] }} CatalogActor
 * @typedef {ReturnType<typeof createPublishedCatalogVersion>} PublishedCatalogVersion
 * @typedef {{ lockLatest?: boolean, transaction?: any }} PortContext
 * @typedef {{
 *   append(version: PublishedCatalogVersion, context: PortContext & {expectedLatestNumber: number}): Promise<unknown>,
 *   findById(id: string): Promise<unknown|null>,
 *   list(context: PortContext): Promise<Array<{number: number}>>,
 * }} CatalogRepository
 * @typedef {{ append(event: {
 *   actor: string,
 *   action: string,
 *   target: {type: string, id: string},
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 * }, context: PortContext): Promise<unknown> }} AuditPort
 * @typedef {{ run<T>(work: (transaction: any) => Promise<T>): Promise<T> }} TransactionPort
 * @typedef {{
 *   actor: CatalogActor,
 *   correlationId: string,
 *   reason: string,
 *   values: unknown,
 * }} PublishCatalogCommand
 */

/**
 * @param {{
 *   auditPort: AuditPort,
 *   clock?: () => Date,
 *   idFactory: () => string,
 *   repository: CatalogRepository,
 *   transactionPort: TransactionPort,
 * }} options
 */
export function createCatalogService(options) {
  const normalizedOptions = { clock: () => new Date(), ...options };
  assertCatalogPorts(normalizedOptions);
  const { auditPort, clock, idFactory, repository, transactionPort } =
    normalizedOptions;

  /**
   * @param {PublishCatalogCommand} input
   * @returns {Promise<PublishedCatalogVersion>}
   */
  async function publish(input) {
    assertPrivilegedActor(input?.actor);
    assertCommandMetadata(input);

    return transactionPort.run(async (transaction) => {
      const context = { transaction };
      const existing = await repository.list({
        lockLatest: true,
        transaction,
      });
      const latestNumber = existing.reduce(
        (latest, version) => Math.max(latest, version.number),
        0,
      );
      const published = createPublishedCatalogVersion({
        id: idFactory(),
        number: latestNumber + 1,
        publishedAt: clock().toISOString(),
        publishedBy: input.actor.id,
        reason: input.reason,
        values: input.values,
      });
      const auditEvent = immutableCatalogClone({
        action: 'catalog.version.published',
        actor: input.actor.id,
        correlationId: input.correlationId,
        reason: input.reason.trim(),
        target: { id: published.id, type: 'catalog-version' },
        version: published.number,
      });

      await repository.append(published, {
        ...context,
        expectedLatestNumber: latestNumber,
      });
      await auditPort.append(auditEvent, context);
      return published;
    });
  }

  /**
   * @param {{catalogVersionId: string, materialCode: string, modelCode: string, techniqueCode: string}} input
   */
  async function select(input) {
    if (
      !input ||
      typeof input.catalogVersionId !== 'string' ||
      input.catalogVersionId.trim().length === 0
    ) {
      throw new CatalogValidationError('catalogVersionId is required');
    }
    const keys = Object.keys(input).sort();
    const expectedKeys = [
      'catalogVersionId',
      'materialCode',
      'modelCode',
      'techniqueCode',
    ];
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new CatalogValidationError(
        `selection must contain only: ${expectedKeys.join(', ')}`,
      );
    }
    const version = await repository.findById(input.catalogVersionId);
    if (!version) {
      throw new CatalogValidationError('Catalog version is unavailable');
    }
    return createCatalogSelection(version, input);
  }

  return Object.freeze({ publish, select });
}

/** @param {CatalogActor|undefined} actor */
function assertPrivilegedActor(actor) {
  if (
    !actor ||
    typeof actor.id !== 'string' ||
    !Array.isArray(actor.capabilities) ||
    !actor.capabilities.includes('COMMERCIAL_ADMIN')
  ) {
    throw new CatalogForbiddenError();
  }
}

/** @param {{correlationId?: unknown, reason?: unknown}} command */
function assertCommandMetadata(command) {
  if (
    typeof command.correlationId !== 'string' ||
    command.correlationId.trim().length === 0
  ) {
    throw new CatalogValidationError(
      'correlationId must be a non-empty string',
    );
  }
  if (
    typeof command.reason !== 'string' ||
    command.reason.trim().length === 0
  ) {
    throw new CatalogValidationError('reason must be a non-empty string');
  }
}

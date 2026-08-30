import {
  createConfigurationVersion,
  freezeConfigurationRecord,
} from '../domain/configuration-version.js';
import {
  ConfigurationConflictError,
  ConfigurationForbiddenError,
  ConfigurationValidationError,
} from '../domain/errors.js';
import { assertConfigurationPorts } from '../ports/contracts.js';

/**
 * @typedef {{ capabilities: readonly string[], id: string }} ConfigurationActor
 * @typedef {{ transaction: unknown }} PortContext
 * @typedef {{
 *   append(version: unknown, context: PortContext): Promise<void>,
 *   findCurrent(context: PortContext): Promise<{version: number}|null>,
 * }} ConfigurationRepository
 * @typedef {{ append(event: {
 *   actor: string,
 *   action: string,
 *   target: {type: string, id: string},
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 * }, context: PortContext): Promise<unknown> }} AuditPort
 * @typedef {{ run<T>(work: (transaction: unknown) => Promise<T>): Promise<T> }} TransactionPort
 * @typedef {ReturnType<typeof createConfigurationVersion>} ConfigurationVersion
 * @typedef {{
 *   actor: ConfigurationActor,
 *   correlationId: string,
 *   expectedVersion: number,
 *   reason: string,
 *   values: unknown,
 * }} CreateConfigurationCommand
 */

/**
 * @param {{
 *   auditPort: AuditPort,
 *   clock: () => Date,
 *   idFactory: () => string,
 *   repository: ConfigurationRepository,
 *   transactionPort: TransactionPort,
 * }} dependencies
 * @returns {Readonly<{
 *   createVersion(command: CreateConfigurationCommand): Promise<ConfigurationVersion>
 * }>}
 */
export function createConfigurationService(dependencies) {
  assertConfigurationPorts(dependencies);
  const { auditPort, clock, idFactory, repository, transactionPort } =
    dependencies;

  return Object.freeze({
    /**
     * @param {CreateConfigurationCommand} command
     * @returns {Promise<ConfigurationVersion>}
     */
    async createVersion(command) {
      assertPrivilegedActor(command?.actor);
      assertCommandMetadata(command);

      return transactionPort.run(async (transaction) => {
        const context = { transaction };
        const current = await repository.findCurrent(context);
        const currentVersion = current?.version ?? 0;
        if (command.expectedVersion !== currentVersion) {
          throw new ConfigurationConflictError(
            command.expectedVersion,
            currentVersion,
          );
        }

        const occurredAt = clock().toISOString();
        const version = createConfigurationVersion({
          actorId: command.actor.id,
          createdAt: occurredAt,
          id: idFactory(),
          reason: command.reason,
          values: command.values,
          version: currentVersion + 1,
        });
        const auditEvent = freezeConfigurationRecord({
          action: 'configuration.version.created',
          actor: command.actor.id,
          correlationId: command.correlationId,
          reason: command.reason.trim(),
          target: { id: version.id, type: 'configuration' },
          version: version.version,
        });

        await repository.append(version, context);
        await auditPort.append(auditEvent, context);
        return version;
      });
    },
  });
}

/** @param {ConfigurationActor|undefined} actor */
function assertPrivilegedActor(actor) {
  if (
    !actor ||
    typeof actor.id !== 'string' ||
    !Array.isArray(actor.capabilities) ||
    !actor.capabilities.includes('COMMERCIAL_ADMIN')
  ) {
    throw new ConfigurationForbiddenError();
  }
}

/**
 * @param {{correlationId?: unknown, expectedVersion?: unknown, reason?: unknown}} command
 */
function assertCommandMetadata(command) {
  if (
    !Number.isSafeInteger(command.expectedVersion) ||
    /** @type {number} */ (command.expectedVersion) < 0
  ) {
    throw new ConfigurationValidationError(
      'expectedVersion must be a non-negative integer',
    );
  }
  if (
    typeof command.correlationId !== 'string' ||
    command.correlationId.trim().length === 0
  ) {
    throw new ConfigurationValidationError(
      'correlationId must be a non-empty string',
    );
  }
  if (
    typeof command.reason !== 'string' ||
    command.reason.trim().length === 0
  ) {
    throw new ConfigurationValidationError('reason must be a non-empty string');
  }
}

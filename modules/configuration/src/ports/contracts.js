import { ConfigurationValidationError } from '../domain/errors.js';

/**
 * Persistence and audit adapters receive the same transaction context. The
 * transaction adapter must roll back both writes if either port rejects.
 *
 * @param {unknown} dependencies
 */
export function assertConfigurationPorts(dependencies) {
  if (dependencies === null || typeof dependencies !== 'object') {
    throw new ConfigurationValidationError('dependencies are required');
  }

  const candidate = /** @type {Record<string, unknown>} */ (dependencies);
  const repository = /** @type {Record<string, unknown>} */ (
    candidate.repository
  );
  const auditPort = /** @type {Record<string, unknown>} */ (
    candidate.auditPort
  );
  const transactionPort = /** @type {Record<string, unknown>} */ (
    candidate.transactionPort
  );

  if (
    repository === null ||
    typeof repository !== 'object' ||
    typeof repository.findCurrent !== 'function' ||
    typeof repository.append !== 'function'
  ) {
    throw new ConfigurationValidationError(
      'repository must implement findCurrent and append',
    );
  }
  if (
    auditPort === null ||
    typeof auditPort !== 'object' ||
    typeof auditPort.append !== 'function'
  ) {
    throw new ConfigurationValidationError('auditPort must implement append');
  }
  if (
    transactionPort === null ||
    typeof transactionPort !== 'object' ||
    typeof transactionPort.run !== 'function'
  ) {
    throw new ConfigurationValidationError(
      'transactionPort must implement run',
    );
  }
  if (typeof candidate.clock !== 'function') {
    throw new ConfigurationValidationError('clock must be a function');
  }
  if (typeof candidate.idFactory !== 'function') {
    throw new ConfigurationValidationError('idFactory must be a function');
  }
}

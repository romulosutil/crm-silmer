import { CatalogValidationError } from '../domain/errors.js';

/** @param {unknown} dependencies */
export function assertCatalogPorts(dependencies) {
  if (dependencies === null || typeof dependencies !== 'object') {
    throw new CatalogValidationError('dependencies are required');
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
    typeof repository.append !== 'function' ||
    typeof repository.findById !== 'function' ||
    typeof repository.list !== 'function'
  ) {
    throw new CatalogValidationError(
      'repository must implement append, findById and list',
    );
  }
  if (
    auditPort === null ||
    typeof auditPort !== 'object' ||
    typeof auditPort.append !== 'function'
  ) {
    throw new CatalogValidationError('auditPort must implement append');
  }
  if (
    transactionPort === null ||
    typeof transactionPort !== 'object' ||
    typeof transactionPort.run !== 'function'
  ) {
    throw new CatalogValidationError('transactionPort must implement run');
  }
  if (typeof candidate.clock !== 'function') {
    throw new CatalogValidationError('clock must be a function');
  }
  if (typeof candidate.idFactory !== 'function') {
    throw new CatalogValidationError('idFactory must be a function');
  }
}

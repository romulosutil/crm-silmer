import { randomUUID } from 'node:crypto';

import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import {
  createCatalogService,
  createPostgresCatalogRepository,
} from '@crm-silmer/catalog';
import {
  createConfigurationService,
  createPostgresConfigurationRepository,
} from '@crm-silmer/configuration';

/**
 * @typedef {{
 *   query: (sql: string, values?: unknown[]) => Promise<{rows: Array<Record<string, unknown>>}>,
 *   transaction: <T>(work: (client: any) => Promise<T>) => Promise<T>
 * }} TransactionalDatabase
 */

/**
 * Composes T01.5/T01.6 with transaction-bound PostgreSQL repositories and the
 * shared business-audit adapter. Channel consumers only receive the safe
 * projection exposed by configuration.readChannelConfiguration().
 *
 * @param {TransactionalDatabase} database
 * @param {{clock?: () => Date, idFactory?: () => string}} [options]
 */
export function createCommercialRuntime(database, options = {}) {
  if (
    !database ||
    typeof database.query !== 'function' ||
    typeof database.transaction !== 'function'
  ) {
    throw new TypeError('A transactional PostgreSQL database is required');
  }
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const auditPort = new PostgresAuditTrail(database, { clock, idFactory });
  const transactionPort = Object.freeze({
    /** @template T @param {(client: any) => Promise<T>} work */
    run: (work) => database.transaction(work),
  });

  return Object.freeze({
    catalog: createCatalogService({
      auditPort,
      clock,
      idFactory,
      repository: createPostgresCatalogRepository(database),
      transactionPort,
    }),
    configuration: createConfigurationService({
      auditPort,
      clock,
      idFactory,
      repository: createPostgresConfigurationRepository(database),
      transactionPort,
    }),
  });
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  CatalogConflictError,
  createCatalogService,
  createPostgresCatalogRepository,
  createPublishedCatalogVersion,
} from '../modules/catalog/src/index.js';
import {
  ConfigurationConflictError,
  createConfigurationService,
  createPostgresConfigurationRepository,
} from '../modules/configuration/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { createCommercialRuntime } from '../apps/api/src/commercial-runtime.js';

const connectionString = process.env.TEST_DATABASE_URL;
const ADMIN = Object.freeze({
  capabilities: ['COMMERCIAL_ADMIN'],
  id: 'commercial-admin',
});

function configurationValues(onboardingVersion = 'onboarding-v1') {
  return {
    channels: {
      instagram: { enabled: false },
      whatsapp: { enabled: true },
    },
    fab: { code: '01', displayName: 'FAB 01' },
    featureFlags: { vendedor_silmer_autonomia_comercial: false },
    pix: {
      keyReference: 'secret://payments/pix-primary',
      maskedKey: 'r***@s***.com',
    },
    recipient: {
      name: 'Rose',
      phoneReference: 'secret://crm/order-recipient-phone',
    },
    templates: {
      onboarding: { enabled: true, version: onboardingVersion },
    },
  };
}

function catalogValues(modelName = 'Camisa Essencial') {
  return {
    materials: [{ code: 'DRY', name: 'Dry fit' }],
    models: [{ code: 'CAM-01', name: modelName, productCode: 'CAM' }],
    products: [{ code: 'CAM', name: 'Camisa' }],
    techniques: [{ code: 'SUB', name: 'Sublimação' }],
  };
}

if (connectionString) {
  test('configuration and catalog PostgreSQL adapters preserve atomic versioned history', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live commercial test only resets the dedicated crm_silmer_test database',
    );
    const pool = new Pool({ connectionString, max: 8 });
    const database = /** @type {any} */ ({
      query: pool.query.bind(pool),
      /** @param {(client: any) => Promise<any>} work */
      transaction: (work) => withTransaction(pool, work),
    });

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      await pool.query(
        `INSERT INTO crm.users (id, email, password_hash)
         VALUES ($1, 'commercial-admin@example.test', '$argon2id$v=19$fixture')`,
        [ADMIN.id],
      );

      const runtime = createCommercialRuntime(database);
      await runtime.configuration.createVersion({
        actor: ADMIN,
        correlationId: 'configuration-initial',
        expectedVersion: 0,
        reason: 'Configuração inicial do piloto',
        values: configurationValues(),
      });
      const channelConfiguration =
        await runtime.configuration.readChannelConfiguration();
      assert.deepEqual(channelConfiguration, {
        channels: {
          instagram: { enabled: false },
          whatsapp: { enabled: true },
        },
        featureFlags: { vendedor_silmer_autonomia_comercial: false },
        version: 1,
      });
      assert.doesNotMatch(
        JSON.stringify(channelConfiguration),
        /pix|recipient|secret/iu,
      );

      const configurationRace = await Promise.allSettled([
        runtime.configuration.createVersion({
          actor: ADMIN,
          correlationId: 'configuration-race-a',
          expectedVersion: 1,
          reason: 'Atualizar onboarding A',
          values: configurationValues('onboarding-v2-a'),
        }),
        runtime.configuration.createVersion({
          actor: ADMIN,
          correlationId: 'configuration-race-b',
          expectedVersion: 1,
          reason: 'Atualizar onboarding B',
          values: configurationValues('onboarding-v2-b'),
        }),
      ]);
      assert.equal(
        configurationRace.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      const rejectedConfiguration = configurationRace.find(
        ({ status }) => status === 'rejected',
      );
      assert.ok(
        rejectedConfiguration?.status === 'rejected' &&
          rejectedConfiguration.reason instanceof ConfigurationConflictError,
      );

      const failingAudit = /** @type {any} */ ({
        async append(/** @type {any} */ event, /** @type {any} */ context) {
          await new PostgresAuditTrail(pool).append(event, context);
          throw new Error('forced configuration audit failure');
        },
      });
      const transactionPort = {
        /** @param {(client: any) => Promise<any>} work */
        run: (work) => withTransaction(pool, work),
      };
      const rollbackConfiguration = createConfigurationService({
        auditPort: failingAudit,
        clock: () => new Date('2026-09-01T12:00:00.000Z'),
        idFactory: () => 'configuration-rollback',
        repository: createPostgresConfigurationRepository(pool),
        transactionPort,
      });
      await assert.rejects(
        rollbackConfiguration.createVersion({
          actor: ADMIN,
          correlationId: 'configuration-rollback',
          expectedVersion: 2,
          reason: 'Deve reverter sem auditoria',
          values: configurationValues('onboarding-rollback'),
        }),
        /forced configuration audit failure/u,
      );
      const configurationCounts = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM crm.configuration_versions) AS versions,
           (SELECT count(*)::int FROM crm.audit_events
             WHERE action = 'configuration.version.created') AS audits`,
      );
      assert.deepEqual(configurationCounts.rows[0], {
        audits: 2,
        versions: 2,
      });

      const firstCatalog = await runtime.catalog.publish({
        actor: ADMIN,
        correlationId: 'catalog-initial',
        reason: 'Catálogo inicial aprovado',
        values: catalogValues(),
      });
      const firstSelection = await runtime.catalog.select({
        catalogVersionId: firstCatalog.id,
        materialCode: 'DRY',
        modelCode: 'CAM-01',
        techniqueCode: 'SUB',
      });
      const catalogRace = await Promise.all([
        runtime.catalog.publish({
          actor: ADMIN,
          correlationId: 'catalog-race-a',
          reason: 'Publicação concorrente A',
          values: catalogValues('Camisa 2027 A'),
        }),
        runtime.catalog.publish({
          actor: ADMIN,
          correlationId: 'catalog-race-b',
          reason: 'Publicação concorrente B',
          values: catalogValues('Camisa 2027 B'),
        }),
      ]);
      assert.deepEqual(catalogRace.map(({ number }) => number).sort(), [2, 3]);

      const catalogRepository = createPostgresCatalogRepository(pool);
      await assert.rejects(
        withTransaction(pool, (transaction) =>
          catalogRepository.append(
            createPublishedCatalogVersion({
              id: 'catalog-stale',
              number: 2,
              publishedAt: '2026-09-01T12:00:00.000Z',
              publishedBy: ADMIN.id,
              reason: 'Expected latest obsoleto',
              values: catalogValues('Catálogo obsoleto'),
            }),
            {
              expectedLatestNumber: 1,
              transaction: /** @type {any} */ (transaction),
            },
          ),
        ),
        CatalogConflictError,
      );

      const rollbackCatalog = createCatalogService({
        auditPort: /** @type {any} */ ({
          async append(/** @type {any} */ event, /** @type {any} */ context) {
            await new PostgresAuditTrail(pool).append(event, context);
            throw new Error('forced catalog audit failure');
          },
        }),
        clock: () => new Date('2026-09-01T13:00:00.000Z'),
        idFactory: () => 'catalog-rollback',
        repository: catalogRepository,
        transactionPort,
      });
      await assert.rejects(
        rollbackCatalog.publish({
          actor: ADMIN,
          correlationId: 'catalog-rollback',
          reason: 'Deve reverter catálogo e auditoria',
          values: catalogValues('Catálogo revertido'),
        }),
        /forced catalog audit failure/u,
      );

      const historicalSelection = await runtime.catalog.select({
        catalogVersionId: firstCatalog.id,
        materialCode: 'DRY',
        modelCode: 'CAM-01',
        techniqueCode: 'SUB',
      });
      assert.deepEqual(historicalSelection, firstSelection);
      assert.equal(historicalSelection.snapshot.model.name, 'Camisa Essencial');
      await assert.rejects(
        pool.query(
          `UPDATE crm.catalog_models SET name = 'Mutação histórica'
           WHERE catalog_version_id = $1 AND code = 'CAM-01'`,
          [firstCatalog.id],
        ),
        /published catalog is immutable/iu,
      );

      await pool.query(
        `INSERT INTO crm.catalog_versions
           (id, number, status, created_by, reason)
         VALUES ('catalog-draft-probe', 99, 'draft', $1, 'draft invisível')`,
        [ADMIN.id],
      );
      assert.equal(
        await catalogRepository.findById('catalog-draft-probe'),
        null,
      );
      await pool.query(
        `DELETE FROM crm.catalog_versions WHERE id = 'catalog-draft-probe'`,
      );

      const catalogCounts = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM crm.catalog_versions) AS versions,
           (SELECT count(*)::int FROM crm.audit_events
             WHERE action = 'catalog.version.published') AS audits`,
      );
      assert.deepEqual(catalogCounts.rows[0], { audits: 3, versions: 3 });
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}

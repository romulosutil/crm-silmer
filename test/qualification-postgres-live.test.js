import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  PostgresDealAutomationFencePort,
  PostgresDealRepository,
} from '../modules/deals-pipeline/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresDomainEventStore,
  PostgresIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';
import {
  PostgresQualificationCatalog,
  PostgresQualificationAttachmentPort,
  PostgresQualificationRepository,
  createQualificationCipher,
  createQualificationService,
} from '../modules/qualification/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-07T18:00:00.000Z');

if (connectionString) {
  test('PostgreSQL persists qualification, assessments, root version and event atomically', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      /** @param {(client: any) => Promise<any>} work */
      transaction: (work) => withTransaction(pool, work),
    };
    const runId = randomUUID().replaceAll('-', '');
    const dealId = `deal-q-${runId}`;
    const repository = new PostgresDealRepository();
    let auditSequence = 0;
    const qualificationRepository = new PostgresQualificationRepository({
      cipher: createQualificationCipher({ key: Buffer.alloc(32, 91) }),
    });
    const dependencies = {
      auditPort: new PostgresAuditTrail(database, {
        clock: () => NOW,
        idFactory: () => `audit-q-${runId}-${++auditSequence}`,
      }),
      attachmentPort: new PostgresQualificationAttachmentPort(),
      automationFencePort: new PostgresDealAutomationFencePort(),
      catalogPort: new PostgresQualificationCatalog(),
      clock: () => NOW,
      dealRepository: repository,
      eventPort: new PostgresDomainEventStore(),
      idempotencyStore: new PostgresIdempotencyRecordStore({
        database,
        envelopeKey: Buffer.alloc(32, 92),
      }),
      qualificationRepository,
    };
    const service = createQualificationService(dependencies);
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      await seed(pool, runId);
      await withTransaction(pool, (transaction) =>
        repository.createFromConversation(
          {
            contactId: `contact-${runId}`,
            createdAt: NOW.toISOString(),
            id: dealId,
            sourceConversationId: `conversation-${runId}`,
          },
          { transaction },
        ),
      );
      const command = {
        actor: { functionName: 'Vendedor', id: `user-${runId}`, kind: 'human' },
        correlationId: `correlation-${runId}`,
        dealId,
        expectedVersion: 1,
        fields: {
          items: [
            {
              catalogVersionId: `catalog-${runId}`,
              colors: {
                back: 'azul',
                collarTrim: 'azul',
                front: 'azul',
                leftSleeve: 'azul',
                rightSleeve: 'azul',
                sleeveTrim: 'azul',
              },
              estimatedQuantity: 10,
              fabrics: ['DRY'],
              grade: [{ quantity: 10, size: 'M' }],
              id: `item-${runId}`,
              modelCode: 'BASICA',
              productCode: 'CAMISETA',
            },
          ],
          order: {
            commercialIntent: true,
            customer: 'Cliente secreto',
            name: 'Pedido secreto',
          },
        },
        idempotencyKey: `qualification-${runId}`,
        reasonCode: 'customer_update',
      };
      const rollbackService = createQualificationService({
        ...dependencies,
        eventPort: {
          async append() {
            throw new Error('forced event failure');
          },
        },
      });
      await assert.rejects(
        rollbackService.patchFields({
          ...command,
          idempotencyKey: `qualification-rollback-${runId}`,
        }),
        /forced event failure/u,
      );
      const rolledBack = await pool.query(
        `SELECT d.version,
          EXISTS(SELECT 1 FROM crm.deal_qualification WHERE deal_id = $1) qualification,
          EXISTS(SELECT 1 FROM crm.audit_events WHERE target_id = $1 AND action = 'deal.fields.patch') audit
         FROM crm.deals d WHERE d.id = $1`,
        [dealId],
      );
      assert.deepEqual(rolledBack.rows[0], {
        audit: false,
        qualification: false,
        version: '1',
      });
      const result = await service.patchFields(command);
      assert.equal(result.deal.version, 2);
      const stored = await pool.query(
        `SELECT d.version, q.customer_envelope,
          (SELECT count(*)::integer FROM crm.field_assessments WHERE deal_id = $1) assessments,
          (SELECT count(*)::integer FROM crm.domain_events WHERE aggregate_id = $1 AND event_type = 'deal.fields.patched') events
         FROM crm.deals d JOIN crm.deal_qualification q ON q.deal_id = d.id
         WHERE d.id = $1`,
        [dealId],
      );
      assert.equal(Number(stored.rows[0].version), 2);
      assert.ok(stored.rows[0].assessments > 0);
      assert.equal(stored.rows[0].events, 1);
      assert.doesNotMatch(
        JSON.stringify(stored.rows[0]),
        /Cliente secreto|Pedido secreto/u,
      );

      const attachmentId = {
        messageId: `message-${runId}`,
        transientMediaId: `media-${runId}`,
      };
      const artwork = await service.patchFields({
        ...command,
        expectedVersion: 2,
        fields: {
          artwork: {
            catalogVersionId: `catalog-${runId}`,
            colors: [{ locationId: `location-${runId}`, values: ['azul'] }],
            files: [
              {
                attachmentId,
                itemId: `item-${runId}`,
                locationId: `location-${runId}`,
              },
            ],
            locations: [{ id: `location-${runId}`, name: 'Frente' }],
            responsibility: 'Cliente',
            status: 'ready',
            techniqueCode: 'SILK',
          },
        },
        idempotencyKey: `qualification-artwork-${runId}`,
      });
      assert.equal(artwork.deal.version, 3);

      const partial = await service.patchFields({
        ...command,
        expectedVersion: 3,
        fields: {
          items: [
            {
              colors: { front: 'verde' },
              estimatedQuantity: 12,
              id: `item-${runId}`,
            },
          ],
        },
        idempotencyKey: `qualification-partial-${runId}`,
      });
      assert.equal(partial.deal.version, 4);
      const preserved = await pool.query(
        `SELECT item.catalog_version_id, item.product_snapshot, item.model_snapshot,
           item.estimated_quantity,
           (SELECT count(*)::integer FROM crm.item_fabrics WHERE item_id = item.id) fabrics,
           (SELECT count(*)::integer FROM crm.grade_lines WHERE item_id = item.id) grade,
           (SELECT count(*)::integer FROM crm.artwork_files WHERE deal_id = item.deal_id) files,
           (SELECT count(*)::integer FROM crm.artwork_colors WHERE deal_id = item.deal_id) artwork_colors
         FROM crm.deal_items item WHERE item.id = $1`,
        [`item-${runId}`],
      );
      assert.equal(preserved.rows[0].catalog_version_id, `catalog-${runId}`);
      assert.equal(preserved.rows[0].product_snapshot.code, 'CAMISETA');
      assert.equal(preserved.rows[0].model_snapshot.code, 'BASICA');
      assert.deepEqual(
        {
          artworkColors: preserved.rows[0].artwork_colors,
          estimatedQuantity: preserved.rows[0].estimated_quantity,
          fabrics: preserved.rows[0].fabrics,
          files: preserved.rows[0].files,
          grade: preserved.rows[0].grade,
        },
        {
          artworkColors: 1,
          estimatedQuantity: 12,
          fabrics: 1,
          files: 1,
          grade: 1,
        },
      );

      await service.patchFields({
        ...command,
        expectedVersion: 4,
        fields: {
          artwork: {
            locations: [{ id: `location-${runId}`, name: 'Frente superior' }],
          },
        },
        idempotencyKey: `qualification-location-${runId}`,
      });
      const retainedChildren = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM crm.artwork_files WHERE deal_id = $1) files,
           (SELECT count(*)::integer FROM crm.artwork_colors WHERE deal_id = $1) colors`,
        [dealId],
      );
      assert.deepEqual(retainedChildren.rows[0], { colors: 1, files: 1 });

      await assert.rejects(
        service.patchFields({
          ...command,
          expectedVersion: 5,
          fields: {
            items: [{ id: `item-${runId}`, operation: 'remove' }],
          },
          idempotencyKey: `qualification-remove-referenced-${runId}`,
        }),
        /Referenced items cannot be removed/u,
      );
      assert.equal(await dealVersion(pool, dealId), 5);

      const pending = await service.patchFields({
        ...command,
        expectedVersion: 5,
        fields: {
          items: [
            {
              catalogVersionId: `catalog-draft-${runId}`,
              estimatedQuantity: 3,
              fabrics: ['DRY'],
              id: `item-draft-${runId}`,
              modelCode: 'BASICA',
              productCode: 'CAMISETA',
            },
          ],
        },
        idempotencyKey: `qualification-draft-${runId}`,
      });
      assert.equal(pending.deal.version, 6);
      const unresolved = await pool.query(
        `SELECT catalog_version_id, catalog_version_number, product_code,
                product_snapshot, model_code, model_snapshot,
                (SELECT count(*)::integer FROM crm.item_fabrics WHERE item_id = $1) fabrics
         FROM crm.deal_items WHERE id = $1`,
        [`item-draft-${runId}`],
      );
      assert.deepEqual(unresolved.rows[0], {
        catalog_version_id: null,
        catalog_version_number: null,
        fabrics: 0,
        model_code: null,
        model_snapshot: null,
        product_code: null,
        product_snapshot: null,
      });
      await assert.rejects(
        pool.query(
          'UPDATE crm.deal_items SET product_code = $2 WHERE id = $1',
          [`item-draft-${runId}`, 'CAMISETA'],
        ),
      );

      await pool.query(
        `UPDATE crm.transient_media
         SET availability_status = 'unavailable', unavailable_reason = 'fixture'
         WHERE id = $1`,
        [attachmentId.transientMediaId],
      );
      await assert.rejects(
        withTransaction(pool, (transaction) =>
          dependencies.attachmentPort.assertUsable(
            {
              contactId: `contact-${runId}`,
              files: [{ attachmentId }],
            },
            { transaction },
          ),
        ),
        /Attachment is not available/u,
      );
      await pool.query(
        `UPDATE crm.transient_media
         SET availability_status = 'available', unavailable_reason = NULL
         WHERE id = $1`,
        [attachmentId.transientMediaId],
      );
      await pool.query(
        `UPDATE crm.contact_identities SET current_contact_id = $2 WHERE id = $1`,
        [`identity-${runId}`, `other-contact-${runId}`],
      );
      await assert.rejects(
        withTransaction(pool, (transaction) =>
          dependencies.attachmentPort.assertUsable(
            {
              contactId: `contact-${runId}`,
              files: [{ attachmentId }],
            },
            { transaction },
          ),
        ),
        /Attachment is not available/u,
      );
      await pool.query(
        `UPDATE crm.contact_identities SET current_contact_id = $2 WHERE id = $1`,
        [`identity-${runId}`, `contact-${runId}`],
      );

      const automation = (/** @type {string} */ suffix) => ({
        actor: { id: 'AUTOMATION_EXECUTOR', kind: 'AUTOMATION_EXECUTOR' },
        automationEpoch: 1,
        conversationId: `conversation-${runId}`,
        correlationId: `correlation-auto-${suffix}-${runId}`,
        dealId,
        expectedVersion: 6,
        fields: { order: { name: `Automation ${suffix}` } },
        idempotencyKey: `qualification-auto-${suffix}-${runId}`,
        reasonCode: 'automation_extraction',
      });
      const raced = await Promise.allSettled([
        service.patchFields(automation('a')),
        service.patchFields(automation('b')),
      ]);
      assert.equal(
        raced.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      assert.equal(
        raced.filter(({ status }) => status === 'rejected').length,
        1,
      );
      assert.equal(await dealVersion(pool, dealId), 7);
      await assert.rejects(
        service.patchFields({
          ...automation('stale'),
          automationEpoch: 0,
          expectedVersion: 7,
        }),
        /Automation fence is stale/u,
      );
      assert.equal(await dealVersion(pool, dealId), 7);

      const assessmentsBefore = await fieldAssessmentCount(pool, dealId);
      await assert.rejects(
        service.patchFields({
          ...command,
          expectedVersion: 7,
          fields: {
            assessments: [
              {
                field: `items.item-future-${runId}.colors.front`,
                reason: 'Pré-carga inválida',
                status: 'nao_aplicavel',
              },
            ],
          },
          idempotencyKey: `qualification-assessment-preseed-${runId}`,
        }),
        /Assessment target is not applicable/u,
      );
      assert.equal(await dealVersion(pool, dealId), 7);
      assert.equal(await fieldAssessmentCount(pool, dealId), assessmentsBefore);

      const reusedId = `item-future-${runId}`;
      const reused = await service.patchFields({
        ...command,
        expectedVersion: 7,
        fields: {
          items: [
            {
              catalogVersionId: `catalog-${runId}`,
              colors: {
                back: 'azul',
                collarTrim: 'azul',
                leftSleeve: 'azul',
                rightSleeve: 'azul',
                sleeveTrim: 'azul',
              },
              estimatedQuantity: 3,
              fabrics: ['DRY'],
              grade: [{ quantity: 3, size: 'M' }],
              id: reusedId,
              modelCode: 'BASICA',
              productCode: 'CAMISETA',
            },
          ],
        },
        idempotencyKey: `qualification-assessment-reuse-${runId}`,
      });
      assert.equal(reused.deal.version, 8);
      assert.ok(
        reused.readiness.especificacao.blockers.includes(
          `items.${reusedId}.colors.front`,
        ),
      );

      const auditRollbackService = createQualificationService({
        ...dependencies,
        auditPort: {
          async append() {
            throw new Error('forced audit failure');
          },
        },
      });
      const changesBefore = await qualificationChangeCount(pool, dealId);
      await assert.rejects(
        auditRollbackService.patchFields({
          ...command,
          expectedVersion: 8,
          fields: { order: { name: 'Must roll back' } },
          idempotencyKey: `qualification-audit-rollback-${runId}`,
        }),
        /forced audit failure/u,
      );
      assert.equal(await dealVersion(pool, dealId), 8);
      assert.equal(await qualificationChangeCount(pool, dealId), changesBefore);
    } finally {
      await pool.end();
    }
  });
} else {
  test(
    'PostgreSQL qualification live test requires TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
}

/** @param {Pool} pool @param {string} runId */
async function seed(pool, runId) {
  await pool.query(
    `INSERT INTO crm.users (id, email, name, password_hash, created_at)
     VALUES ($1, $2, 'Vendedora Fixture', '$argon2id$fixture', $3)`,
    [`user-${runId}`, `${runId}@example.test`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.catalog_versions
       (id, number, status, created_by, reason, created_at)
     VALUES ($1, 1, 'draft', $2, 'Fixture', $3)`,
    [`catalog-${runId}`, `user-${runId}`, NOW],
  );
  await pool.query(
    "INSERT INTO crm.catalog_products VALUES ($1, 'CAMISETA', 'Camiseta')",
    [`catalog-${runId}`],
  );
  await pool.query(
    "INSERT INTO crm.catalog_models VALUES ($1, 'BASICA', 'Básica', 'CAMISETA')",
    [`catalog-${runId}`],
  );
  await pool.query(
    "INSERT INTO crm.catalog_materials VALUES ($1, 'DRY', 'Dry fit')",
    [`catalog-${runId}`],
  );
  await pool.query(
    "INSERT INTO crm.catalog_techniques VALUES ($1, 'SILK', 'Silk')",
    [`catalog-${runId}`],
  );
  await pool.query(
    `UPDATE crm.catalog_versions
     SET status = 'published', published_by = $2, published_at = $3
     WHERE id = $1`,
    [`catalog-${runId}`, `user-${runId}`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.catalog_versions
       (id, number, status, created_by, reason, created_at)
     VALUES ($1, 2, 'draft', $2, 'Fixture draft', $3)`,
    [`catalog-draft-${runId}`, `user-${runId}`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.contacts (id, provisional, version, created_at, updated_at)
     VALUES ($1, false, 1, $2, $2)`,
    [`contact-${runId}`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.contacts (id, provisional, version, created_at, updated_at)
     VALUES ($1, false, 1, $2, $2)`,
    [`other-contact-${runId}`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.contact_identities
       (id, current_contact_id, provider, provider_account_id, channel,
        external_identity_lookup_hash, identity_kind, phone_status,
        identity_envelope, key_version, version, created_at, updated_at)
     VALUES ($1, $2, 'meta', $3, 'instagram', $4, 'handle', 'pending',
             $5::jsonb, 1, 1, $6, $6)`,
    [
      `identity-${runId}`,
      `contact-${runId}`,
      `account-${runId}`,
      'b'.repeat(64),
      JSON.stringify({ algorithm: 'AES-256-GCM', keyVersion: 1, version: 1 }),
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.conversations
       (id, contact_identity_id, provider, provider_account_id,
        external_conversation_id, cycle_number, state, automation_state,
        automation_epoch, version, opened_at, last_message_at)
     VALUES ($1, $2, 'meta', $3, $4, 1, 'em_analise', 'assistant', 1, 1, $5, $5)`,
    [
      `conversation-${runId}`,
      `identity-${runId}`,
      `account-${runId}`,
      `external-${runId}`,
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.transient_media
       (id, provider, provider_account_id, external_media_id, media_type,
        declared_mime_type, metadata_fingerprint, first_received_at, expires_at,
        availability_status, storage_key, size_bytes, content_sha256,
        detected_mime_type, validation_status, stored_at)
     VALUES ($1, 'meta', $2, $3, 'image', 'image/png', $4, $5, $6,
             'available', $7, 10, $8, 'image/png', 'clean', $5)`,
    [
      `media-${runId}`,
      `account-${runId}`,
      `external-media-${runId}`,
      'c'.repeat(64),
      NOW,
      new Date(NOW.getTime() + 6 * 24 * 60 * 60 * 1000),
      randomUUID(),
      'd'.repeat(64),
    ],
  );
  await pool.query(
    `INSERT INTO crm.messages
       (id, conversation_id, provider, provider_account_id, external_message_id,
        direction, author_kind, author_id, message_type, content_envelope,
        key_version, status, occurred_at, created_at)
     VALUES ($1, $2, 'meta', $3, $4, 'inbound', 'contact', $5, 'image',
             $6::jsonb, 1, 'received', $7, $7)`,
    [
      `message-${runId}`,
      `conversation-${runId}`,
      `account-${runId}`,
      `external-message-${runId}`,
      `identity-${runId}`,
      JSON.stringify({ algorithm: 'AES-256-GCM', keyVersion: 1, version: 1 }),
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.attachments (message_id, transient_media_id)
     VALUES ($1, $2)`,
    [`message-${runId}`, `media-${runId}`],
  );
}

/** @param {Pool} pool @param {string} dealId */
async function dealVersion(pool, dealId) {
  const result = await pool.query(
    'SELECT version FROM crm.deals WHERE id = $1',
    [dealId],
  );
  return Number(result.rows[0].version);
}

/** @param {Pool} pool @param {string} dealId */
async function qualificationChangeCount(pool, dealId) {
  const result = await pool.query(
    'SELECT count(*)::integer AS count FROM crm.qualification_changes WHERE deal_id = $1',
    [dealId],
  );
  return result.rows[0].count;
}

/** @param {Pool} pool @param {string} dealId */
async function fieldAssessmentCount(pool, dealId) {
  const result = await pool.query(
    'SELECT count(*)::integer AS count FROM crm.field_assessments WHERE deal_id = $1',
    [dealId],
  );
  return result.rows[0].count;
}

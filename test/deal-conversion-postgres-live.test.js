import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  PostgresContactConversionPort,
  PostgresContactIdentityRepository,
  createContactIdentityService,
} from '../modules/contacts/src/index.js';
import {
  PostgresDealRepository,
  createDealConversionService,
} from '../modules/deals-pipeline/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresConversationConversionPort,
  PostgresInboxRepository,
  createInboxService,
} from '../modules/inbox-channels/src/index.js';
import {
  PostgresDomainEventStore,
  PostgresIdempotencyRecordStore,
  PostgresOutboundMessageOutbox,
} from '../modules/integration-reliability/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-07T15:00:00.000Z');

/** @param {Pool} pool */
function databaseFor(pool) {
  return {
    query: pool.query.bind(pool),
    /** @param {(client: any) => Promise<any>} work */
    transaction: (work) => withTransaction(pool, work),
  };
}

if (connectionString) {
  test('PostgreSQL converts one conversation atomically under replay and concurrency', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 24 });
    const database = databaseFor(pool);
    const runId = randomUUID().replaceAll('-', '');
    let auditSequence = 0;
    const auditPort = new PostgresAuditTrail(database, {
      clock: () => NOW,
      idFactory: () => `audit-${runId}-${++auditSequence}`,
    });
    const contacts = createContactIdentityService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresContactIdentityRepository({
        database,
        envelopeKey: Buffer.alloc(32, 42),
        lookupKey: Buffer.alloc(32, 43),
      }),
    });
    const inbox = createInboxService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresInboxRepository({
        database,
        envelopeKey: Buffer.alloc(32, 41),
        outboundMessageOutbox: new PostgresOutboundMessageOutbox(),
      }),
    });
    const conversion = createDealConversionService({
      auditPort,
      clock: () => NOW,
      contactPort: new PostgresContactConversionPort(),
      dealRepository: new PostgresDealRepository(),
      eventPort: new PostgresDomainEventStore(),
      idFactory: () => `deal-${runId}`,
      idempotencyStore: new PostgresIdempotencyRecordStore({
        database,
        envelopeKey: Buffer.alloc(32, 44),
      }),
      inboxPort: new PostgresConversationConversionPort(),
    });

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const identity = await contacts.resolveInboundIdentity({
        channel: 'instagram',
        correlationId: `identity-correlation-${runId}`,
        displayHandle: `@synthetic_${runId.slice(0, 8)}`,
        externalIdentityId: `identity-${runId}`,
        identityKind: 'handle',
        occurredAt: NOW.toISOString(),
        phoneStatus: 'pending',
        provider: 'meta',
        providerAccountId: `account-${runId}`,
      });
      const received = await inbox.receiveInbound({
        contactId: identity.contact.id,
        correlationId: `inbound-correlation-${runId}`,
        externalConversationId: `conversation-${runId}`,
        externalMessageId: `message-${runId}`,
        identityId: identity.identity.id,
        message: {
          content: { text: 'Quero fazer um orçamento' },
          type: 'text',
        },
        occurredAt: NOW.toISOString(),
        provider: 'meta',
        providerAccountId: `account-${runId}`,
      });
      const humanActor = {
        functionName: 'Atendimento',
        id: `attendant-${runId}`,
        kind: 'human',
      };
      const takeover = await inbox.takeover({
        actor: humanActor,
        conversationId: received.conversation.id,
        correlationId: `takeover-correlation-${runId}`,
        expectedVersion: received.conversation.version,
        idempotencyKey: `takeover-${runId}`,
        reason: 'Cliente pediu atendimento humano',
      });
      await assert.rejects(
        conversion.convertConversation({
          actor: {
            id: 'AUTOMATION_EXECUTOR',
            kind: 'AUTOMATION_EXECUTOR',
          },
          automationEpoch: 0,
          conversationId: takeover.id,
          correlationId: `stale-conversion-correlation-${runId}`,
          expectedVersion: takeover.version,
          idempotencyKey: `stale-conversion-${runId}`,
          reason: 'Comando iniciado antes do takeover',
        }),
        (error) =>
          /** @type {{code?: unknown}} */ (error)?.code === 'DEAL_CONFLICT',
      );
      const reactivated = await inbox.reactivateAgent({
        actor: humanActor,
        conversationId: takeover.id,
        correlationId: `reactivate-correlation-${runId}`,
        expectedVersion: takeover.version,
        idempotencyKey: `reactivate-${runId}`,
        reason: 'Retomar automação explicitamente',
      });
      const command = {
        actor: {
          id: 'AUTOMATION_EXECUTOR',
          kind: 'AUTOMATION_EXECUTOR',
        },
        automationEpoch: reactivated.automationEpoch,
        conversationId: reactivated.id,
        correlationId: `conversion-correlation-${runId}`,
        expectedVersion: reactivated.version,
        idempotencyKey: `conversion-${runId}`,
        reason: 'Intenção comercial confirmada pelo fluxo sintético',
      };

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          conversion.convertConversation(command),
        ),
      );
      assert.equal(new Set(results.map(({ deal }) => deal.id)).size, 1);
      assert.equal(results[0].deal.stage, 'produto');
      assert.equal(results[0].contact.provisional, false);
      assert.equal(results[0].conversation.state, 'convertida_em_lead');

      const counts = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM crm.contacts) AS contacts,
           (SELECT count(*)::integer FROM crm.deals) AS deals,
           (SELECT count(*)::integer FROM crm.idempotency_records
              WHERE action = 'conversation.convert') AS commands,
           (SELECT count(*)::integer FROM crm.audit_events
              WHERE action = 'conversation.convert') AS audits,
           (SELECT provisional FROM crm.contacts LIMIT 1) AS provisional,
           (SELECT state FROM crm.conversations LIMIT 1) AS conversation_state`,
      );
      assert.deepEqual(counts.rows[0], {
        audits: 1,
        commands: 1,
        contacts: 1,
        conversation_state: 'convertida_em_lead',
        deals: 1,
        provisional: false,
      });

      await assert.rejects(
        conversion.convertConversation({
          ...command,
          idempotencyKey: `conversion-other-${runId}`,
        }),
        (error) =>
          /** @type {{code?: unknown}} */ (error)?.code === 'DEAL_CONFLICT',
      );
      const afterConflict = await pool.query(
        'SELECT count(*)::integer AS deals FROM crm.deals',
      );
      assert.equal(afterConflict.rows[0].deals, 1);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresContactIdentityRepository,
  createContactIdentityService,
} from '../modules/contacts/src/index.js';
import {
  PostgresInboxRepository,
  createChannelEventHandler,
  createChannelEventJobHandler,
  createInboxService,
} from '../modules/inbox-channels/src/index.js';
import { PostgresWebhookInbox } from '../modules/integration-reliability/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-02T12:00:00.000Z');
const ATTENDANT = Object.freeze({
  functionName: 'Atendimento',
  id: 'user-attendant-live',
  kind: 'human',
});

/** @param {Pool} pool */
function databaseFor(pool) {
  return {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
}

/** @param {Pool} pool */
function servicesFor(pool) {
  const database = databaseFor(pool);
  const auditPort = {
    async append(/** @type {any} */ event, context = /** @type {any} */ ({})) {
      const queryable = context.transaction ?? database;
      await queryable.query(
        `INSERT INTO crm.audit_events
          (id, actor_id, action, target_type, target_id, version, reason,
           correlation_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          event.actor,
          event.action,
          event.target.type,
          event.target.id,
          String(event.version),
          event.reason,
          event.correlationId,
          NOW,
        ],
      );
    },
  };
  return {
    contacts: createContactIdentityService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresContactIdentityRepository({
        database,
        envelopeKey: Buffer.alloc(32, 42),
        lookupKey: Buffer.alloc(32, 43),
      }),
    }),
    inbox: createInboxService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresInboxRepository({
        database,
        envelopeKey: Buffer.alloc(32, 41),
      }),
    }),
  };
}

/** @param {string} runId @param {string} [providerAccountId] */
function identityInput(runId, providerAccountId = `account-${runId}`) {
  return {
    channel: 'instagram',
    correlationId: `correlation-identity-${runId}`,
    displayHandle: `@synthetic_${runId.slice(0, 8)}`,
    externalIdentityId: `identity-${runId}`,
    identityKind: 'handle',
    occurredAt: NOW.toISOString(),
    phoneStatus: 'pending',
    provider: 'meta',
    providerAccountId,
  };
}

/** @param {string} runId @param {any} resolved @param {Record<string, any>} [overrides] */
function inboundInput(runId, resolved, overrides = {}) {
  return {
    contactId: resolved.contact.id,
    correlationId: `correlation-message-${runId}`,
    externalConversationId: `conversation-${runId}`,
    externalMessageId: `message-${runId}`,
    identityId: resolved.identity.id,
    message: {
      content: { text: `PII-canary-${runId}` },
      type: 'text',
    },
    occurredAt: NOW.toISOString(),
    provider: 'meta',
    providerAccountId: `account-${runId}`,
    ...overrides,
  };
}

/** @param {string} runId */
function canonicalWebhookEvent(runId) {
  const scope = (/** @type {string} */ externalId) => ({
    externalId,
    key: JSON.stringify(['meta', `account-${runId}`, externalId]),
    provider: 'meta',
    providerAccountId: `account-${runId}`,
  });
  return {
    channel: 'whatsapp',
    direction: 'inbound',
    externalConversationId: scope(`conversation-${runId}`),
    externalEventId: scope(`event-${runId}`),
    externalMessageId: scope(`message-${runId}`),
    identity: {
      automaticMergeAllowed: false,
      displayHandle: null,
      externalId: scope(`identity-${runId}`),
      kind: 'phone',
      mergePolicy: 'verified-evidence-only',
      phoneStatus: 'confirmed',
    },
    message: { content: { text: `PII-chain-${runId}` }, type: 'text' },
    occurredAt: NOW.toISOString(),
    origin: 'channel',
    provider: 'meta',
    providerAccountId: `account-${runId}`,
    schemaVersion: 1,
    visibility: 'inbox',
  };
}

if (connectionString) {
  test('PostgreSQL coalesces concurrent inbound into one anchored identity, contact, cycle and message', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 24 });
    const runId = randomUUID().replaceAll('-', '');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const { contacts, inbox } = servicesFor(pool);
      const identities = await Promise.all(
        Array.from({ length: 20 }, () =>
          contacts.resolveInboundIdentity(identityInput(runId)),
        ),
      );
      assert.equal(
        new Set(identities.map(({ contact }) => contact.id)).size,
        1,
      );
      assert.equal(
        new Set(identities.map(({ identity }) => identity.id)).size,
        1,
      );
      const received = await Promise.all(
        Array.from({ length: 20 }, () =>
          inbox.receiveInbound(inboundInput(runId, identities[0])),
        ),
      );
      assert.equal(
        new Set(received.map(({ conversation }) => conversation.id)).size,
        1,
      );
      assert.equal(new Set(received.map(({ message }) => message.id)).size, 1);
      const laterInput = inboundInput(runId, identities[0], {
        externalMessageId: `message-later-${runId}`,
        occurredAt: '2026-09-02T12:01:00.000Z',
      });
      const later = await inbox.receiveInbound(laterInput);
      const laterReplay = await inbox.receiveInbound(laterInput);
      assert.equal(
        later.conversation.version,
        received[0].conversation.version + 1,
      );
      assert.equal(later.conversation.updatedAt, laterInput.occurredAt);
      assert.deepEqual(laterReplay, later);

      const counts = await pool.query(
        `SELECT
          (SELECT count(*)::integer FROM crm.contacts) AS contacts,
          (SELECT count(*)::integer FROM crm.contact_identities) AS identities,
          (SELECT count(*)::integer FROM crm.conversations) AS conversations,
          (SELECT count(*)::integer FROM crm.messages) AS messages`,
      );
      assert.deepEqual(counts.rows[0], {
        contacts: 1,
        conversations: 1,
        identities: 1,
        messages: 2,
      });
      const raw = await pool.query(
        `SELECT row_to_json(m)::text AS stored FROM crm.messages m LIMIT 1`,
      );
      assert.doesNotMatch(
        raw.rows[0].stored,
        new RegExp(`PII-canary-${runId}`),
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL isolates provider accounts and creates one cycle after terminal state under concurrency', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 16 });
    const runId = randomUUID().replaceAll('-', '');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const { contacts, inbox } = servicesFor(pool);
      const left = await contacts.resolveInboundIdentity(identityInput(runId));
      const right = await contacts.resolveInboundIdentity(
        identityInput(runId, `account-other-${runId}`),
      );
      assert.notEqual(left.identity.id, right.identity.id);
      assert.notEqual(left.contact.id, right.contact.id);

      const first = await inbox.receiveInbound(inboundInput(runId, left));
      const terminal = await inbox.transitionConversation({
        actor: ATTENDANT,
        conversationId: first.conversation.id,
        correlationId: `correlation-terminal-${runId}`,
        expectedVersion: first.conversation.version,
        idempotencyKey: `terminal-${runId}`,
        reason: 'Sem oportunidade comercial sintética',
        state: 'sem_lead',
      });
      assert.equal(terminal.state, 'sem_lead');

      const [second, third] = await Promise.all([
        inbox.receiveInbound(
          inboundInput(runId, left, {
            externalMessageId: `message-second-${runId}`,
          }),
        ),
        inbox.receiveInbound(
          inboundInput(runId, left, {
            externalMessageId: `message-third-${runId}`,
          }),
        ),
      ]);
      assert.equal(second.conversation.id, third.conversation.id);
      assert.notEqual(second.conversation.id, first.conversation.id);
      assert.equal(second.conversation.cycleNumber, 2);

      const cycles = await pool.query(
        `SELECT cycle_number, state
         FROM crm.conversations
         WHERE provider = 'meta' AND provider_account_id = $1
         ORDER BY cycle_number`,
        [`account-${runId}`],
      );
      assert.deepEqual(cycles.rows, [
        { cycle_number: 1, state: 'sem_lead' },
        { cycle_number: 2, state: 'nova' },
      ]);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL atomically takes over, queues one human message and replays the persisted command', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 16 });
    const runId = randomUUID().replaceAll('-', '');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const { contacts, inbox } = servicesFor(pool);
      const identity = await contacts.resolveInboundIdentity(
        identityInput(runId),
      );
      const received = await inbox.receiveInbound(
        inboundInput(runId, identity),
      );
      const command = {
        actor: ATTENDANT,
        content: { text: `PII-human-${runId}` },
        conversationId: received.conversation.id,
        correlationId: `correlation-send-${runId}`,
        expectedVersion: received.conversation.version,
        idempotencyKey: `send-${runId}`,
        messageType: 'text',
        reason: 'Resposta humana sintética',
      };

      const [sent, replay] = await Promise.all([
        inbox.sendHumanMessage(command),
        inbox.sendHumanMessage(command),
      ]);
      assert.deepEqual(replay, sent);
      assert.equal(sent.status, 'queued');

      const state = await pool.query(
        `SELECT c.automation_state, c.automation_epoch, c.assigned_user_id,
                c.state, count(DISTINCT m.id)::integer AS messages,
                count(DISTINCT j.id)::integer AS jobs,
                min(j.effect_policy) AS effect_policy,
                count(DISTINCT a.id)::integer AS audits,
                string_agg(m.content_envelope::text, ' ') AS stored_content
         FROM crm.conversations c
         JOIN crm.messages m ON m.conversation_id = c.id
         LEFT JOIN crm.outbox_jobs j ON j.message_id = m.id
         LEFT JOIN crm.audit_events a
           ON a.target_id = c.id
          AND a.action = 'conversation.human_message_queued'
         WHERE c.id = $1
         GROUP BY c.id`,
        [received.conversation.id],
      );
      assert.deepEqual(
        {
          assigned_user_id: state.rows[0].assigned_user_id,
          audits: state.rows[0].audits,
          automation_epoch: Number(state.rows[0].automation_epoch),
          automation_state: state.rows[0].automation_state,
          effect_policy: state.rows[0].effect_policy,
          jobs: state.rows[0].jobs,
          messages: state.rows[0].messages,
          state: state.rows[0].state,
        },
        {
          assigned_user_id: ATTENDANT.id,
          audits: 1,
          automation_epoch: 1,
          automation_state: 'human',
          effect_policy: 'manual',
          jobs: 1,
          messages: 2,
          state: 'em_atendimento',
        },
      );
      assert.doesNotMatch(state.rows[0].stored_content, /PII-human/u);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL persists reversible identity links and one audit per idempotent command', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 16 });
    const runId = randomUUID().replaceAll('-', '');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const { contacts } = servicesFor(pool);
      const source = await contacts.resolveInboundIdentity(
        identityInput(runId),
      );
      const target = await contacts.resolveInboundIdentity(
        identityInput(`target${runId}`, `target-account-${runId}`),
      );
      const mergeCommand = {
        actor: ATTENDANT,
        correlationId: `correlation-merge-${runId}`,
        expectedVersion: source.identity.version,
        idempotencyKey: `merge-${runId}`,
        identityId: source.identity.id,
        reason: 'Vínculo sintético confirmado por operador',
        targetContactId: target.contact.id,
      };
      const [merged, mergeReplay] = await Promise.all([
        contacts.mergeIdentity(mergeCommand),
        contacts.mergeIdentity(mergeCommand),
      ]);
      assert.deepEqual(mergeReplay, merged);
      assert.equal(merged.identity.contactId, target.contact.id);

      const unmergeCommand = {
        actor: ATTENDANT,
        correlationId: `correlation-unmerge-${runId}`,
        expectedVersion: merged.identity.version,
        idempotencyKey: `unmerge-${runId}`,
        linkId: merged.link.id,
        reason: 'Vínculo sintético revertido por operador',
      };
      const [unmerged, unmergeReplay] = await Promise.all([
        contacts.unmergeIdentity(unmergeCommand),
        contacts.unmergeIdentity(unmergeCommand),
      ]);
      assert.deepEqual(unmergeReplay, unmerged);
      assert.equal(unmerged.identity.contactId, source.contact.id);
      assert.equal(unmerged.link.status, 'reverted');

      const evidence = await pool.query(
        `SELECT l.status, l.source_contact_id, l.target_contact_id,
                count(DISTINCT a.id)::integer AS audits
         FROM crm.identity_links l
         LEFT JOIN crm.audit_events a ON a.target_id = l.contact_identity_id
         WHERE l.id = $1
         GROUP BY l.id`,
        [merged.link.id],
      );
      assert.deepEqual(evidence.rows[0], {
        audits: 2,
        source_contact_id: source.contact.id,
        status: 'reverted',
        target_contact_id: target.contact.id,
      });
      await assert.rejects(
        pool.query(
          `UPDATE crm.identity_links
           SET merge_reason = 'tentativa de alteração histórica'
           WHERE id = $1`,
          [merged.link.id],
        ),
        /immutable/u,
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL links the durable webhook job to the resulting inbox message', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 16 });
    const runId = randomUUID().replaceAll('-', '');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const database = databaseFor(pool);
      const eventStore = new PostgresWebhookInbox({
        database,
        envelopeKey: Buffer.alloc(32, 31),
      });
      const event = canonicalWebhookEvent(runId);
      await eventStore.persistBatch({
        correlationId: `correlation-chain-${runId}`,
        events: [{ disposition: 'process', event, media: [] }],
        rawBody: Buffer.from(`{"synthetic":"${runId}"}`),
        receivedAt: NOW.toISOString(),
      });
      const selectedJob = await pool.query(
        `SELECT channel_event_id FROM crm.outbox_jobs
         WHERE job_type = 'channel_event.process'`,
      );
      const { contacts, inbox } = servicesFor(pool);
      const processEvent = createChannelEventJobHandler({
        channelEventHandler: createChannelEventHandler({
          contactIdentityService: contacts,
          inboxService: inbox,
        }),
        eventStore,
      });

      assert.deepEqual(
        await processEvent({
          channelEventId: selectedJob.rows[0].channel_event_id,
        }),
        { outcome: 'sent' },
      );
      const state = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM crm.contacts) AS contacts,
           (SELECT count(*)::integer FROM crm.conversations) AS conversations,
           (SELECT count(*)::integer FROM crm.messages) AS messages,
           (SELECT channel_event_id FROM crm.messages LIMIT 1) AS linked_event,
           (SELECT content_envelope::text FROM crm.messages LIMIT 1) AS stored_content`,
      );
      assert.deepEqual(
        {
          contacts: state.rows[0].contacts,
          conversations: state.rows[0].conversations,
          linked_event: state.rows[0].linked_event,
          messages: state.rows[0].messages,
        },
        {
          contacts: 1,
          conversations: 1,
          linked_event: selectedJob.rows[0].channel_event_id,
          messages: 1,
        },
      );
      assert.doesNotMatch(state.rows[0].stored_content, /PII-chain/u);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}

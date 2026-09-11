import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { createOperationReadService } from '../apps/api/src/operation-runtime.js';
import {
  PostgresContactIdentityRepository,
  PostgresContactReadRepository,
  createContactIdentityService,
} from '../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresInboxReadRepository,
  PostgresInboxRepository,
  createInboxService,
} from '../modules/inbox-channels/src/index.js';
import { PostgresHandoffReadRepository } from '../modules/work-management/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-08T12:00:00.000Z');
const CONTACT_KEY = Buffer.alloc(32, 42);
const MESSAGE_KEY = Buffer.alloc(32, 41);

if (connectionString) {
  test('PostgreSQL projects paginated Inbox and Contact data without exposing envelopes', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    const auditPort = { append: async () => undefined };
    const contacts = createContactIdentityService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresContactIdentityRepository({
        database,
        envelopeKey: CONTACT_KEY,
        lookupKey: Buffer.alloc(32, 43),
      }),
    });
    const inbox = createInboxService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresInboxRepository({
        database,
        envelopeKey: MESSAGE_KEY,
        outboundMessageOutbox: {
          enqueueChannelMessage: async () => undefined,
        },
      }),
    });
    const reads = createOperationReadService({
      contactRepository: new PostgresContactReadRepository({
        database,
        envelopeKey: CONTACT_KEY,
      }),
      cursorKey: Buffer.alloc(32, 44),
      handoffRepository: new PostgresHandoffReadRepository({
        contactEnvelopeKey: CONTACT_KEY,
        database,
        handoffEnvelopeKey: Buffer.alloc(32, 45),
      }),
      inboxRepository: new PostgresInboxReadRepository({
        contactEnvelopeKey: CONTACT_KEY,
        database,
        messageEnvelopeKey: MESSAGE_KEY,
      }),
    });
    const runId = randomUUID().replaceAll('-', '');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const resolved = await contacts.resolveInboundIdentity(
        identityInput(runId, 'primary'),
      );
      await contacts.resolveInboundIdentity(identityInput(runId, 'secondary'));
      const received = await inbox.receiveInbound({
        contactId: resolved.contact.id,
        correlationId: `correlation-message-${runId}`,
        externalConversationId: `conversation-${runId}`,
        externalMessageId: `message-${runId}`,
        identityId: resolved.identity.id,
        message: { content: { text: `PII-canary-${runId}` }, type: 'text' },
        occurredAt: NOW.toISOString(),
        provider: 'meta',
        providerAccountId: `account-primary-${runId}`,
      });

      const inboxPage = await reads.listInbox({
        channel: 'instagram',
        state: 'nova',
      });
      assert.equal(inboxPage.totalCount, 1);
      assert.equal(
        inboxPage.items[0].contact.label,
        `@primary_${runId.slice(0, 8)}`,
      );
      assert.equal(
        inboxPage.items[0].lastMessage.preview,
        `PII-canary-${runId}`,
      );
      const conversation = await reads.getConversation({
        conversationId: received.conversation.id,
      });
      assert.equal(conversation.messages[0].preview, `PII-canary-${runId}`);

      const firstContacts = await reads.listContacts({ limit: 1 });
      assert.equal(firstContacts.totalCount, 2);
      assert.ok(firstContacts.nextCursor);
      const secondContacts = await reads.listContacts({
        cursor: firstContacts.nextCursor,
        limit: 1,
      });
      assert.equal(secondContacts.items.length, 1);
      assert.notEqual(secondContacts.items[0].id, firstContacts.items[0].id);
      const contact = await reads.getContact({
        contactId: resolved.contact.id,
      });
      assert.equal(contact.conversations[0].id, received.conversation.id);
      assert.equal(
        contact.identities[0].externalId,
        `identity-primary-${runId}`,
      );

      const stored = await pool.query(
        `SELECT identity_envelope::text envelope FROM crm.contact_identities
         UNION ALL
         SELECT content_envelope::text envelope FROM crm.messages`,
      );
      assert.equal(stored.rows.length, 3);
      assert.ok(
        stored.rows.every(
          (row) => !row.envelope.includes(`PII-canary-${runId}`),
        ),
      );
      assert.ok(
        stored.rows.every(
          (row) => !row.envelope.includes(`identity-primary-${runId}`),
        ),
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
} else {
  test('PostgreSQL operation read test requires TEST_DATABASE_URL', {
    skip: true,
  });
}

/** @param {string} runId @param {string} suffix */
function identityInput(runId, suffix) {
  return {
    channel: 'instagram',
    correlationId: `correlation-${suffix}-${runId}`,
    displayHandle: `@${suffix}_${runId.slice(0, 8)}`,
    externalIdentityId: `identity-${suffix}-${runId}`,
    identityKind: 'handle',
    occurredAt: NOW.toISOString(),
    phoneStatus: 'pending',
    provider: 'meta',
    providerAccountId: `account-${suffix}-${runId}`,
  };
}

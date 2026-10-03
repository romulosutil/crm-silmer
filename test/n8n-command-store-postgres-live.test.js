import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresN8nCommandStore } from '../modules/n8n-integration/src/postgres-command-store.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-03T12:00:00.000Z');
const ENVELOPE = JSON.stringify({
  algorithm: 'AES-256-GCM',
  keyVersion: 1,
  version: 1,
});

if (connectionString) {
  test('PostgreSQL publishes a single live event with a failed human send', async () => {
    assert.match(
      new URL(connectionString).pathname.slice(1),
      /^crm_silmer_test(?:_[a-z0-9_]+)?$/u,
    );
    const pool = new Pool({ connectionString, max: 4 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });

      await pool.query(
        `INSERT INTO crm.contacts
           (id, provisional, version, created_at, updated_at)
         VALUES ('contact-live', false, 1, $1, $1)`,
        [NOW],
      );
      await pool.query(
        `INSERT INTO crm.contact_identities
           (id, current_contact_id, provider, provider_account_id, channel,
            external_identity_lookup_hash, identity_kind, phone_status,
            identity_envelope, key_version, version, created_at, updated_at)
         VALUES ('identity-live', 'contact-live', 'meta', 'account-live',
                 'instagram', $1, 'handle', 'pending', $2::jsonb,
                 1, 1, $3, $3)`,
        ['1'.repeat(64), ENVELOPE, NOW],
      );
      await pool.query(
        `INSERT INTO crm.conversations
           (id, contact_identity_id, provider, provider_account_id,
            external_conversation_id, cycle_number, state, automation_state,
            automation_epoch, version, opened_at, last_message_at)
         VALUES ('conversation-live', 'identity-live', 'meta', 'account-live',
                 'external-live', 1, 'nova', 'human', 0, 1, $1, $1)`,
        [NOW],
      );
      await pool.query(
        `INSERT INTO crm.messages
           (id, conversation_id, provider, provider_account_id, command_id,
            direction, author_kind, author_id, message_type,
            content_envelope, key_version, status, occurred_at, created_at)
         VALUES ('message-live', 'conversation-live', 'meta', 'account-live',
                 'command-live', 'outbound', 'human', 'seller-live', 'text',
                 $1::jsonb, 1, 'sending', $2, $2)`,
        [ENVELOPE, NOW],
      );
      await pool.query(
        `INSERT INTO crm.n8n_commands
           (command_id, conversation_id, message_id, action, actor_id,
            actor_kind, automation_epoch, fingerprint, payload_envelope,
            status, locked_by, locked_until, created_at, updated_at)
         VALUES ('command-live', 'conversation-live', 'message-live',
                 'send_message', 'seller-live', 'human', 0, $1, $2::jsonb,
                 'processing', 'attempt-live', $3, $4, $4)`,
        ['0'.repeat(64), ENVELOPE, new Date(NOW.getTime() + 60_000), NOW],
      );

      const store = new PostgresN8nCommandStore({
        database: {
          query: pool.query.bind(pool),
          transaction: (/** @type {(client: any) => Promise<any>} */ work) =>
            withTransaction(pool, work),
        },
        envelopeKey: Buffer.alloc(32),
      });
      const context = { attemptId: 'attempt-live', now: NOW };
      assert.equal(await store.markFailed('command-live', context), true);
      assert.equal(await store.markFailed('command-live', context), true);

      const message = await pool.query(
        `SELECT status, delivery_status FROM crm.messages
         WHERE id = 'message-live'`,
      );
      assert.deepEqual(message.rows[0], {
        status: 'failed',
        delivery_status: 'failed',
      });
      const events = await pool.query(
        `SELECT aggregate_type, aggregate_id, event_type, payload
         FROM crm.domain_events
         WHERE aggregate_id = 'conversation-live'
           AND event_type = 'conversation.message_delivery_changed'`,
      );
      assert.deepEqual(events.rows, [
        {
          aggregate_type: 'conversation',
          aggregate_id: 'conversation-live',
          event_type: 'conversation.message_delivery_changed',
          payload: { conversationId: 'conversation-live' },
        },
      ]);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}

import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresTransientMediaRepository } from '../modules/integration-reliability/src/postgres-transient-media.js';

const connectionString = process.env.TEST_DATABASE_URL;
const cipherIv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 7), cipherIv);
cipher.setAAD(Buffer.from('synthetic-envelope-schema-fixture'));
const ciphertext = Buffer.concat([
  cipher.update(JSON.stringify({ filename: 'synthetic.jpg' })),
  cipher.final(),
]);
const envelope = JSON.stringify({
  algorithm: 'AES-256-GCM',
  keyVersion: 1,
  version: 1,
  ciphertext: ciphertext.toString('base64url'),
  iv: cipherIv.toString('base64url'),
  tag: cipher.getAuthTag().toString('base64url'),
});

if (connectionString) {
  const pool = new Pool({ connectionString, max: 4 });
  before(async () => {
    assert.equal(
      new URL(connectionString).pathname,
      '/crm_silmer_test',
      'Only dedicated synthetic database may be reset',
    );
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    await pool.query(
      `INSERT INTO crm.users (id,email,password_hash,name) VALUES ('media-seller','media-seller@example.test','$argon2id$synthetic','Synthetic Media Seller')`,
    );
    await pool.query(
      `INSERT INTO crm.contacts (id,created_at,updated_at) VALUES ('media-contact',now(),now())`,
    );
    await pool.query(
      `INSERT INTO crm.contact_identities (id,current_contact_id,provider,provider_account_id,channel,external_identity_lookup_hash,identity_kind,phone_status,identity_envelope,created_at,updated_at) VALUES ('media-identity','media-contact','meta','synthetic-local','whatsapp',$1,'phone','confirmed',$2,now(),now())`,
      ['a'.repeat(64), envelope],
    );
    for (const id of ['media-conversation-a', 'media-conversation-b']) {
      await pool.query(
        `INSERT INTO crm.conversations (id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,opened_at,last_message_at) VALUES ($1,'media-identity','meta','synthetic-local',$1,1,now()-interval '9 days',now())`,
        [id],
      );
      await pool.query(
        `INSERT INTO crm.messages (id,conversation_id,provider,provider_account_id,command_id,direction,author_kind,author_id,message_type,content_envelope,status,occurred_at,created_at) VALUES ($1,$2,'meta','synthetic-local',$1,'outbound','human','media-seller','image',$3,'queued',now()-interval '9 days',now()-interval '9 days')`,
        [`${id}-message`, id, envelope],
      );
    }
  });
  after(async () => {
    await pool.end();
  });

  /** @param {Record<string, unknown>} [overrides] */
  async function media(overrides = {}) {
    const values = {
      id: randomUUID(),
      conversation_id: 'media-conversation-a',
      uploaded_by: 'media-seller',
      upload_command_id: randomUUID(),
      request_fingerprint: 'b'.repeat(64),
      kind: 'image',
      origin: 'attachment',
      filename_envelope: envelope,
      storage_bucket_alias: 'chat-dev',
      input_size_bytes: 100,
      reservation_bytes: 100,
      created_at: new Date(Date.now() - 9 * 86400000),
      ...overrides,
    };
    const columns = Object.keys(values);
    const inserted = await pool.query(
      `INSERT INTO crm.chat_media (${columns.join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`,
      Object.values(values),
    );
    return inserted.rows[0];
  }

  const ready = {
    state: 'ready',
    validation_status: 'clean',
    content_sha256: 'c'.repeat(64),
    original_sha256: 'd'.repeat(64),
    size_bytes: 100,
    detected_mime_type: 'image/jpeg',
    processed_at: '2026-10-01T12:00:00Z',
  };

  test('T2 expand migration runs twice without duplicate schema', async () => {
    assert.deepEqual(
      await migrate(pool, { migrations: await loadMigrations() }),
      { applied: [], phase: 'expand' },
    );
    const result = await pool.query(
      `SELECT count(*)::integer AS count FROM crm_meta.schema_migrations WHERE version='0027'`,
    );
    assert.equal(result.rows[0].count, 1);
  });

  test('T2 one attached media per message and same conversation enforced by FK', async () => {
    const first = await media({
      ...ready,
      state: 'attached',
      message_id: 'media-conversation-a-message',
      attached_at: '2026-10-01T12:00:00Z',
    });
    assert.equal(first.message_id, 'media-conversation-a-message');
    await assert.rejects(
      media({
        ...ready,
        state: 'attached',
        message_id: 'media-conversation-a-message',
        attached_at: '2026-10-01T12:00:00Z',
      }),
      /chat_media_message_id_key/u,
    );
    await assert.rejects(
      media({
        ...ready,
        state: 'attached',
        message_id: 'media-conversation-b-message',
        attached_at: '2026-10-01T12:00:00Z',
      }),
      /chat_media_message_conversation_fk/u,
    );
  });

  test('T2 upload replay identity is unique by actor and conversation', async () => {
    const first = await media();
    await assert.rejects(
      media({ upload_command_id: first.upload_command_id }),
      /chat_media_upload_scope_key/u,
    );
    const other = await media({
      upload_command_id: first.upload_command_id,
      conversation_id: 'media-conversation-b',
    });
    assert.equal(other.upload_command_id, first.upload_command_id);
  });

  test('T2 sent media survives eight days, terminal conversation and transient sweepers', async () => {
    await pool.query(
      `UPDATE crm.conversations SET state='sem_lead', terminal_at=now() WHERE id='media-conversation-a'`,
    );
    const repository = new PostgresTransientMediaRepository({
      database: {
        query: pool.query.bind(pool),
        transaction: (work) => withTransaction(pool, /** @type {any} */ (work)),
      },
    });
    assert.equal(await repository.scheduleExpiredDeletions(), 0);
    assert.equal(await repository.scheduleTerminalJourneyDeletions(), 0);
    const attached = await pool.query(
      `SELECT state, message_id FROM crm.chat_media WHERE message_id='media-conversation-a-message'`,
    );
    assert.deepEqual(attached.rows, [
      { state: 'attached', message_id: 'media-conversation-a-message' },
    ]);
    const oldMedia = await pool.query(
      `SELECT created_at < now()-interval '8 days' AS older_than_eight_days FROM crm.chat_media WHERE message_id='media-conversation-a-message'`,
    );
    assert.equal(oldMedia.rows[0].older_than_eight_days, true);
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='crm' AND table_name='chat_media' AND column_name='expires_at'`,
    );
    assert.equal(columns.rowCount, 0);
    const jobs = await pool.query(
      `SELECT count(*)::integer AS count FROM crm.outbox_jobs WHERE job_type='media.delete'`,
    );
    assert.equal(jobs.rows[0].count, 0);
  });

  test('T2 quota tracks stored bytes and pending reservations independently', async () => {
    await pool.query(
      `INSERT INTO crm.chat_media_quotas (bucket_alias,limit_bytes,used_bytes,reserved_bytes) VALUES ('chat-dev',1000,600,300)`,
    );
    await assert.rejects(
      pool.query(
        `UPDATE crm.chat_media_quotas SET reserved_bytes=401 WHERE bucket_alias='chat-dev'`,
      ),
      /chat_media_quotas_capacity_check/u,
    );
    await assert.rejects(
      pool.query(
        `UPDATE crm.chat_media_quotas SET used_bytes=-1 WHERE bucket_alias='chat-dev'`,
      ),
      /chat_media_quotas_nonnegative_check/u,
    );
    const row = await pool.query(
      `SELECT used_bytes,reserved_bytes FROM crm.chat_media_quotas WHERE bucket_alias='chat-dev'`,
    );
    assert.deepEqual(row.rows, [{ used_bytes: '600', reserved_bytes: '300' }]);
  });

  test('T2 ready requires clean metadata and linked media requires attached state', async () => {
    await assert.rejects(
      media({ state: 'ready' }),
      /chat_media_ready_metadata_check/u,
    );
    await assert.rejects(
      media({ ...ready, validation_status: 'infected' }),
      /chat_media_ready_metadata_check/u,
    );
    await assert.rejects(
      media({ ...ready, message_id: 'media-conversation-b-message' }),
      /chat_media_binding_check/u,
    );
    await assert.rejects(
      media({ reservation_bytes: -1 }),
      /chat_media_size_check/u,
    );
    const draft = await media();
    assert.equal(draft.message_id, null);
    assert.equal(draft.retention_class, 'chat_retained');
    assert.equal(draft.state, 'uploaded');
    assert.match(draft.object_key, /^[a-f0-9-]{36}$/u);
  });

  test('T2 filename envelope rejects absent encryption metadata and malformed ciphertext', async () => {
    for (const invalid of [
      {},
      { algorithm: 'AES-256-GCM', version: 1, keyVersion: 1 },
      { ...JSON.parse(envelope), ciphertext: 'plaintext filename.jpg' },
    ]) {
      await assert.rejects(
        media({ filename_envelope: JSON.stringify(invalid) }),
        /chat_media_filename_envelope_check/u,
      );
    }
    const valid = await media();
    assert.equal(
      valid.filename_envelope.ciphertext,
      JSON.parse(envelope).ciphertext,
    );
    assert.equal(
      JSON.stringify(valid.filename_envelope).includes('synthetic.jpg'),
      false,
    );
  });

  test('T2 processing job points only to persistent media and is unique', async () => {
    const draft = await media();
    const insert = (/** @type {Record<string, unknown>} */ overrides = {}) => {
      const values = {
        id: randomUUID(),
        job_type: 'chat_media.process',
        idempotency_key: randomUUID(),
        chat_media_id: draft.id,
        status: 'pending',
        queue: 'chat-media',
        available_at: new Date(),
        created_at: new Date(),
        ...overrides,
      };
      const columns = Object.keys(values);
      return pool.query(
        `INSERT INTO crm.outbox_jobs (${columns.join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')}) RETURNING job_type,chat_media_id`,
        Object.values(values),
      );
    };
    const job = await insert();
    assert.deepEqual(job.rows, [
      { job_type: 'chat_media.process', chat_media_id: draft.id },
    ]);
    await assert.rejects(insert(), /outbox_jobs_chat_media_process_key/u);
    await assert.rejects(
      insert({ chat_media_id: null }),
      /outbox_jobs_target_check/u,
    );
    await assert.rejects(
      insert({ chat_media_id: randomUUID() }),
      /outbox_jobs_chat_media_id_fkey/u,
    );
  });
}

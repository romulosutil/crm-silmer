import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, after, test } from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  createInboxService,
  PostgresInboxRepository,
} from '../modules/inbox-channels/src/index.js';
import { PostgresChatMediaUploadRepository } from '../modules/integration-reliability/src/postgres-chat-media-upload-repository.js';
import { PostgresN8nCommandOutbox } from '../modules/n8n-integration/src/postgres-command-outbox.js';
import { encryptJson } from '../modules/n8n-integration/src/crypto.js';

const connectionString = process.env.TEST_DATABASE_URL;
const KEY = Buffer.alloc(32, 8);
const actor = {
  id: 'bind-seller',
  kind: 'human',
  functionName: 'Vendedor',
  capabilities: [],
};
if (connectionString) {
  const pool = new Pool({ connectionString, max: 8 });
  const database = {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
  const upload = new PostgresChatMediaUploadRepository({ database });
  beforeEach(async () => {
    assert.equal(new URL(connectionString).pathname, '/crm_silmer_test');
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    for (const id of ['bind-seller', 'bind-other'])
      await pool.query(
        `INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Synthetic')`,
        [id, `${id}@example.test`],
      );
    await pool.query(
      `INSERT INTO crm.contacts(id,created_at,updated_at) VALUES('bind-contact',now(),now())`,
    );
    await pool.query(
      `INSERT INTO crm.contact_identities(id,current_contact_id,provider,provider_account_id,channel,external_identity_lookup_hash,identity_kind,phone_status,identity_envelope,created_at,updated_at) VALUES('bind-identity','bind-contact','meta','synthetic','whatsapp',$1,'phone','confirmed',$2,now(),now())`,
      [
        'a'.repeat(64),
        encryptJson(
          { externalIdentityId: '5511999999999' },
          JSON.stringify(['crm.contact_identities', 1, 'a'.repeat(64)]),
          KEY,
        ),
      ],
    );
    for (const id of ['bind-conversation', 'bind-other-conversation'])
      await pool.query(
        `INSERT INTO crm.conversations(id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,opened_at,last_message_at) VALUES($1,'bind-identity','meta','synthetic',$1,1,now(),now())`,
        [id],
      );
  });
  after(() => pool.end());
  /** @param {any} [options] */
  function service(options = {}) {
    const outbox = new PostgresN8nCommandOutbox({ envelopeKey: KEY });
    return createInboxService({
      repository: new PostgresInboxRepository({
        database,
        envelopeKey: KEY,
        outboundMessageOutbox: options.outboxFailure
          ? {
              async enqueueChannelMessage() {
                throw new Error('synthetic-outbox');
              },
            }
          : outbox,
      }),
      auditPort: {
        async append(/** @type {any} */ event, /** @type {any} */ context) {
          if (options.auditFailure) throw new Error('synthetic-audit');
          await context.transaction.query(
            `INSERT INTO crm.audit_events(id,actor_id,action,target_type,target_id,version,reason,correlation_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())`,
            [
              randomUUID(),
              event.actor,
              event.action,
              event.target.type,
              event.target.id,
              String(event.version),
              event.reason,
              event.correlationId,
            ],
          );
        },
      },
    });
  }
  /** @param {any} [overrides] */
  async function ready(overrides = {}) {
    const id = randomUUID();
    const admission = {
      id,
      actor,
      conversationId: 'bind-conversation',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      sessionHash: randomUUID(),
      reservationBytes: 10000,
    };
    await upload.admit(admission);
    await upload.complete({
      ...admission,
      kind: 'image',
      origin: 'attachment',
      declaredMimeType: 'image/png',
      sizeBytes: 100,
      reservationBytes: 200,
      sha256: 'b'.repeat(64),
      fingerprint: 'c'.repeat(64),
      filenameEnvelope: encryptJson(
        { filename: 'synthetic.png' },
        `chat-media-filename:${id}`,
        KEY,
      ),
    });
    await pool.query(
      `UPDATE crm.chat_media SET state='ready',validation_status='clean',content_sha256=$2,size_bytes=100,detected_mime_type='image/png',processed_at=now(),reservation_bytes=100 WHERE id=$1`,
      [id, 'b'.repeat(64)],
    );
    await pool.query(
      `UPDATE crm.chat_media_quotas SET reserved_bytes=100 WHERE bucket_alias='chat-dev'`,
    );
    if (overrides.actorId)
      await pool.query('UPDATE crm.chat_media SET uploaded_by=$2 WHERE id=$1', [
        id,
        overrides.actorId,
      ]);
    if (overrides.conversationId)
      await pool.query(
        'UPDATE crm.chat_media SET conversation_id=$2 WHERE id=$1',
        [id, overrides.conversationId],
      );
    if (overrides.state)
      await pool.query(
        `UPDATE crm.chat_media SET state=$2,sanitized_reason='invalid_format' WHERE id=$1`,
        [id, overrides.state],
      );
    return id;
  }
  /** @param {string} mediaId @param {any} [overrides] */
  function command(mediaId, overrides = {}) {
    return {
      actor,
      conversationId: 'bind-conversation',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      reason: 'Synthetic media send',
      messageType: 'image',
      content: { mediaId, caption: 'Synthetic caption' },
      ...overrides,
    };
  }
  async function snapshot() {
    return (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM crm.messages) AS messages,(SELECT count(*)::int FROM crm.n8n_commands) AS commands,(SELECT count(*)::int FROM crm.audit_events) AS audits,(SELECT reserved_bytes FROM crm.chat_media_quotas WHERE bucket_alias='chat-dev') AS reserved,(SELECT used_bytes FROM crm.chat_media_quotas WHERE bucket_alias='chat-dev') AS used,(SELECT automation_state FROM crm.conversations WHERE id='bind-conversation') AS automation`,
      )
    ).rows[0];
  }
  test('T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once', async () => {
    const id = await ready();
    const input = command(id);
    const inbox = service();
    assert.equal((await snapshot()).automation, 'assistant');
    const message = await inbox.sendHumanMessage(input);
    const row = (
      await pool.query('SELECT * FROM crm.chat_media WHERE id=$1', [id])
    ).rows[0];
    assert.equal(row.state, 'attached');
    assert.equal(row.message_id, message.id);
    assert.equal(Number(row.reservation_bytes), 0);
    assert.deepEqual(await snapshot(), {
      messages: 1,
      commands: 1,
      audits: 1,
      reserved: '0',
      used: '100',
      automation: 'human',
    });
    assert.equal((await inbox.sendHumanMessage(input)).id, message.id);
    assert.deepEqual(await snapshot(), {
      messages: 1,
      commands: 1,
      audits: 1,
      reserved: '0',
      used: '100',
      automation: 'human',
    });
    assert.equal(
      Number(
        (await pool.query(`SELECT count(*) AS count FROM crm.domain_events`))
          .rows[0].count,
      ),
      1,
    );
  });
  test('T10/MED-05: concurrent sends of one media have one winner', async () => {
    const id = await ready();
    const inbox = service();
    const results = await Promise.allSettled([
      inbox.sendHumanMessage(command(id)),
      inbox.sendHumanMessage(command(id)),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await snapshot()).messages, 1);
    assert.equal((await snapshot()).used, '100');
  });
  for (const options of [
    { actorId: 'bind-other' },
    { conversationId: 'bind-other-conversation' },
    { state: 'uploaded' },
    { state: 'rejected' },
  ])
    test(`T10/MED-05/08: invalid bind ${JSON.stringify(options)} rolls back`, async () => {
      const id = await ready(options);
      const before = await snapshot();
      await assert.rejects(service().sendHumanMessage(command(id)), {
        statusCode: 409,
      });
      assert.deepEqual(await snapshot(), before);
    });
  test('T10/MED-08: admin read capability cannot bind another actor media', async () => {
    const id = await ready({ actorId: 'bind-other' });
    await assert.rejects(
      service().sendHumanMessage(
        command(id, {
          actor: { ...actor, capabilities: ['COMMERCIAL_ADMIN'] },
        }),
      ),
      { statusCode: 409 },
    );
    assert.equal((await snapshot()).automation, 'assistant');
  });
  test('T10/MED-05: second message cannot reuse attached media', async () => {
    const id = await ready();
    const inbox = service();
    await inbox.sendHumanMessage(command(id));
    await assert.rejects(
      inbox.sendHumanMessage(command(id, { expectedVersion: 2 })),
      { statusCode: 409 },
    );
    assert.equal((await snapshot()).messages, 1);
  });
  for (const failure of ['outboxFailure', 'auditFailure'])
    test(`T10/MED-05/28: ${failure} preserves ready reservation`, async () => {
      const id = await ready();
      const before = await snapshot();
      await assert.rejects(
        service({ [failure]: true }).sendHumanMessage(command(id)),
        /synthetic-/u,
      );
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        (await pool.query('SELECT state FROM crm.chat_media WHERE id=$1', [id]))
          .rows[0].state,
        'ready',
      );
    });
  for (const scenario of ['transfer', 'close'])
    test(`T10/MED-07: ${scenario} after upload prevents stale send`, async () => {
      const id = await ready();
      if (scenario === 'transfer')
        await pool.query(
          `UPDATE crm.conversations SET assigned_user_id='bind-other',version=2 WHERE id='bind-conversation'`,
        );
      else
        await pool.query(
          `UPDATE crm.conversations SET terminal_at=now(),state='sem_lead',version=2 WHERE id='bind-conversation'`,
        );
      await assert.rejects(service().sendHumanMessage(command(id)), {
        statusCode: 409,
      });
      assert.equal((await snapshot()).messages, 0);
      assert.equal((await snapshot()).reserved, '100');
    });
  test('T10/MED-05: message kind and validated MIME must agree', async () => {
    const id = await ready();
    await assert.rejects(
      service().sendHumanMessage(
        command(id, { messageType: 'audio', content: { mediaId: id } }),
      ),
      { statusCode: 409 },
    );
    assert.equal((await snapshot()).messages, 0);
  });
  for (const kind of ['audio', 'video'])
    test(`T10/MED-05: ready ${kind} binds validated kind`, async () => {
      const id = await ready();
      await pool.query(
        'UPDATE crm.chat_media SET kind=$2,detected_mime_type=$3 WHERE id=$1',
        [id, kind, kind === 'audio' ? 'audio/ogg' : 'video/mp4'],
      );
      const sent = await service().sendHumanMessage(
        command(id, { messageType: kind, content: { mediaId: id } }),
      );
      assert.equal(sent.type, kind);
      assert.equal((await snapshot()).used, '100');
    });
  for (const mime of ['image/webp', 'text/plain'])
    test(`T10/MED-05: MIME ${mime} outside approved formats cannot bind`, async () => {
      const id = await ready();
      await pool.query(
        'UPDATE crm.chat_media SET detected_mime_type=$2 WHERE id=$1',
        [id, mime],
      );
      await assert.rejects(service().sendHumanMessage(command(id)), {
        statusCode: 409,
      });
      assert.equal((await snapshot()).messages, 0);
    });
  test('T10/MED-05: image above five MiB cannot bind despite a ready row', async () => {
    const id = await ready();
    const size = 6 * 1024 * 1024;
    await pool.query(
      'UPDATE crm.chat_media SET size_bytes=$2,reservation_bytes=$2 WHERE id=$1',
      [id, size],
    );
    await pool.query(
      `UPDATE crm.chat_media_quotas SET reserved_bytes=$1 WHERE bucket_alias='chat-dev'`,
      [size],
    );
    await assert.rejects(service().sendHumanMessage(command(id)), {
      statusCode: 409,
    });
    assert.equal((await snapshot()).reserved, String(size));
  });
}

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
        statusCode: options.actorId ? 403 : 409,
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
      { statusCode: 403 },
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
  test('T11/MED-06: disabled admission replays accepted send and blocks new send without mutation', async () => {
    const id = await ready();
    const input = command(id);
    const message = await service().sendHumanMessage(input);
    const { createConversationApiRuntime } =
      await import('../apps/api/src/conversation-runtime.js');
    const disabled = createConversationApiRuntime(
      database,
      {},
      {},
      { commandOutbox: new PostgresN8nCommandOutbox({ envelopeKey: KEY }) },
      KEY,
      { mediaEnabled: false },
    );
    const before = await snapshot();
    assert.equal((await disabled.sendMessage(input)).id, message.id);
    await assert.rejects(
      disabled.sendMessage(command(id, { expectedVersion: 2 })),
      { statusCode: 403 },
    );
    assert.deepEqual(await snapshot(), before);
  });
  test('T11/MED-06: HTTP replay with fresh trace preserves semantic identity, changed caption or actor conflicts', async (t) => {
    const id = await ready();
    /** @type {string[]} */ const traces = [];
    const inbox = service();
    const { createApi } = await import('../apps/api/src/app.js');
    const api = createApi(
      {},
      {
        conversations: {
          async authorize(/** @type {any} */ input) {
            return {
              actor:
                input.cookie === 'crm_session=other'
                  ? { ...actor, id: 'bind-other' }
                  : actor,
            };
          },
          async sendMessage(/** @type {any} */ input) {
            traces.push(input.correlationId);
            return inbox.sendHumanMessage(input);
          },
        },
      },
    );
    t.after(() => api.close());
    const post = (
      caption = 'Synthetic',
      cookie = 'crm_session=seller',
      reverseKeys = false,
    ) =>
      api.inject({
        method: 'POST',
        url: '/api/v1/conversations/bind-conversation/messages',
        headers: {
          cookie,
          'idempotency-key': 'semantic-command',
          origin: 'https://crm.example.test',
          'x-csrf-token': 'synthetic',
        },
        payload: {
          messageType: 'image',
          content: reverseKeys
            ? { caption, mediaId: id }
            : { mediaId: id, caption },
          expectedVersion: 1,
          reason: 'Synthetic',
        },
      });
    const first = await post();
    assert.equal(first.statusCode, 202);
    const second = await post();
    assert.equal(second.statusCode, 202);
    assert.equal(second.json().id, first.json().id);
    assert.notEqual(traces[0], traces[1]);
    assert.equal(
      (await post('Synthetic', 'crm_session=seller', true)).statusCode,
      202,
    );
    assert.equal((await post('Different')).statusCode, 409);
    assert.equal(
      (await post('Synthetic', 'crm_session=other')).statusCode,
      409,
    );
    assert.equal((await snapshot()).messages, 1);
    assert.equal((await snapshot()).used, '100');
  });
  test('T11/MED-06: legacy fingerprint replays same original trace but cannot reconstruct a changed trace', async () => {
    const id = await ready();
    const input = command(id);
    const inbox = service();
    const message = await inbox.sendHumanMessage(input);
    const { createHash } = await import('node:crypto');
    const legacy = {
      actor: {
        capabilities: [],
        functionName: actor.functionName,
        id: actor.id,
        kind: 'human',
      },
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason.trim(),
      content: input.content,
      messageType: input.messageType,
    };
    await pool.query(
      `UPDATE crm.inbox_commands SET fingerprint=$2 WHERE operation='send' AND idempotency_key=$1`,
      [
        input.idempotencyKey,
        createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),
      ],
    );
    assert.equal((await inbox.sendHumanMessage(input)).id, message.id);
    await assert.rejects(
      inbox.sendHumanMessage({ ...input, correlationId: randomUUID() }),
      { statusCode: 409 },
    );
    assert.equal((await snapshot()).messages, 1);
  });
  async function mediaPanelCommand(type = 'image') {
    const id = await ready();
    if (['audio', 'video'].includes(type))
      await pool.query(
        'UPDATE crm.chat_media SET kind=$2,detected_mime_type=$3 WHERE id=$1',
        [id, type, type === 'audio' ? 'audio/ogg' : 'video/mp4'],
      );
    await pool.query(
      `UPDATE crm.conversations SET inbound_revision=1 WHERE id='bind-conversation'`,
    );
    const sent = await service().sendHumanMessage(
      command(
        id,
        type === 'text'
          ? { messageType: 'text', content: { text: 'Synthetic text' } }
          : type === 'audio'
            ? { messageType: type, content: { mediaId: id } }
            : { messageType: type },
      ),
    );
    const row = (
      await pool.query('SELECT * FROM crm.n8n_commands WHERE message_id=$1', [
        sent.id,
      ])
    ).rows[0];
    const { decryptJson } =
      await import('../modules/n8n-integration/src/crypto.js');
    const payload = decryptJson(
      row.payload_envelope,
      `n8n-command:${row.command_id}`,
      KEY,
    );
    await pool.query(
      `UPDATE crm.n8n_commands SET status='processing',locked_by='synthetic-delivery',locked_until=now()+interval '1 hour' WHERE command_id=$1`,
      [row.command_id],
    );
    const { PostgresN8nIntegrationRepository } =
      await import('../modules/n8n-integration/src/postgres-repository.js');
    const { createN8nIntegrationService } =
      await import('../modules/n8n-integration/src/service.js');
    const integration = createN8nIntegrationService({
      repository: new PostgresN8nIntegrationRepository({
        database,
        envelopeKey: KEY,
      }),
    });
    /** @param {string} eventId @param {any} [overrides] */
    const event = (eventId, overrides = {}) => ({
      schema_version: '1.0',
      event_id: eventId,
      event_type: 'message.send.requested',
      conversation_id: 'bind-conversation',
      command_id: row.command_id,
      automation_epoch: payload.automation_epoch,
      source_revision: payload.source_revision,
      message: structuredClone(payload.message),
      occurred_at: new Date().toISOString(),
      technical: {
        actor: 'AUTOMATION_EXECUTOR',
        correlationId: `correlation-${eventId}`,
        credentialVersion: 'current',
        executionId: 'synthetic-execution',
        idempotencyKey: eventId,
        requestId: `request-${eventId}`,
        workflowKey: 'whatsapp-mvp',
        workflowVersion: 'media-fixture-1',
      },
      ...overrides,
    });
    return { id, sent, row, payload, integration, event };
  }
  test('T12/MED-20/21: outbox identifies exact bound variant and replay never reauthorizes', async () => {
    const f = await mediaPanelCommand();
    assert.equal(f.payload.message.media_id, f.id);
    assert.equal(f.payload.message.sha256, 'b'.repeat(64));
    assert.equal(f.payload.message.mime_type, 'image/png');
    assert.equal(f.payload.message.size_bytes, 100);
    assert.equal(f.payload.message.caption, 'Synthetic caption');
    assert.equal(f.payload.message.type, 'image');
    assert.equal(JSON.stringify(f.payload).includes('object_key'), false);
    const event = f.event('media-reserve');
    assert.equal(
      (await f.integration.recordEvent(event)).send_authorized,
      true,
    );
    assert.equal(
      (await f.integration.recordEvent(event)).send_authorized,
      false,
    );
    await assert.rejects(
      f.integration.recordEvent(f.event('already-sending')),
      { statusCode: 409 },
    );
    assert.equal(
      (
        await pool.query('SELECT status FROM crm.messages WHERE id=$1', [
          f.sent.id,
        ])
      ).rows[0].status,
      'sending',
    );
    assert.equal((await snapshot()).used, '100');
  });
  for (const change of [
    { media_id: '20000000-0000-4000-8000-000000000002' },
    { sha256: 'd'.repeat(64) },
    { mime_type: 'image/jpeg' },
    { size_bytes: 101 },
    { caption: 'Other' },
    { attachment_id: 'different' },
    { attachmentId: 'different' },
  ])
    test(`T12/MED-21: variant or alias mismatch ${JSON.stringify(change)} never reserves`, async () => {
      const f = await mediaPanelCommand();
      await assert.rejects(
        f.integration.recordEvent(
          f.event('mismatch', { message: { ...f.payload.message, ...change } }),
        ),
        { statusCode: 409 },
      );
      assert.equal(
        (
          await pool.query('SELECT status FROM crm.messages WHERE id=$1', [
            f.sent.id,
          ])
        ).rows[0].status,
        'queued',
      );
      assert.equal((await snapshot()).used, '100');
    });
  for (const change of [{ automation_epoch: 99 }, { source_revision: 99 }])
    test(`T12/MED-21: epoch/source fence ${JSON.stringify(change)} never reserves`, async () => {
      const f = await mediaPanelCommand();
      await assert.rejects(
        f.integration.recordEvent(f.event('stale', change)),
        { statusCode: 409 },
      );
      assert.equal(
        (
          await pool.query('SELECT status FROM crm.messages WHERE id=$1', [
            f.sent.id,
          ])
        ).rows[0].status,
        'queued',
      );
    });
  test('T12/MED-21: drift of bound variant after outbox is refused', async () => {
    const f = await mediaPanelCommand();
    await pool.query(
      'UPDATE crm.chat_media SET content_sha256=$2 WHERE id=$1',
      [f.id, 'd'.repeat(64)],
    );
    await assert.rejects(f.integration.recordEvent(f.event('drift')), {
      statusCode: 409,
    });
    assert.equal(
      (
        await pool.query('SELECT status FROM crm.messages WHERE id=$1', [
          f.sent.id,
        ])
      ).rows[0].status,
      'queued',
    );
  });
  test('T12/MED-24: unknown Meta outcome has no blind retry and callbacks remain monotonic', async () => {
    const f = await mediaPanelCommand();
    const reservation = f.event('reserve-unknown');
    assert.equal(
      (await f.integration.recordEvent(reservation)).send_authorized,
      true,
    );
    const callback = (
      /** @type {string} */ eventId,
      /** @type {string} */ eventType,
      /** @type {any} */ extra = {},
    ) => {
      const input = /** @type {any} */ (
        f.event(eventId, { event_type: eventType, ...extra })
      );
      delete input.message;
      delete input.source_revision;
      return input;
    };
    await f.integration.recordEvent(
      callback('unknown', 'message.send.unknown'),
    );
    const unknown = (
      await pool.query(
        'SELECT status,retryable,retry_safe FROM crm.n8n_commands WHERE command_id=$1',
        [f.row.command_id],
      )
    ).rows[0];
    assert.deepEqual(unknown, {
      status: 'outcome_unknown',
      retryable: false,
      retry_safe: false,
    });
    await pool.query(
      "UPDATE crm.outbox_jobs SET status='outcome_unknown',completed_at=now(),updated_at=now(),last_error_code='OUTCOME_UNKNOWN' WHERE n8n_command_id=$1",
      [f.row.command_id],
    );
    await pool.query(
      "INSERT INTO crm.reconciliation_items(id,job_id,status,reason,created_at) SELECT gen_random_uuid()::text,id,'open','external_outcome_unknown',now() FROM crm.outbox_jobs WHERE n8n_command_id=$1",
      [f.row.command_id],
    );
    const history = async () =>
      (
        await pool.query(
          'SELECT to_jsonb(job) AS job,to_jsonb(item) AS item FROM crm.outbox_jobs job JOIN crm.reconciliation_items item ON item.job_id=job.id WHERE job.n8n_command_id=$1',
          [f.row.command_id],
        )
      ).rows;
    const unknownHistory = await history();
    assert.equal(
      (await f.integration.recordEvent(reservation)).send_authorized,
      false,
    );
    await assert.rejects(
      f.integration.recordEvent(f.event('new-reservation')),
      { statusCode: 409 },
    );
    await f.integration.recordEvent(
      callback('sent', 'message.sent', {
        external_message_id: 'wamid.synthetic-media',
      }),
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT status,retryable,retry_safe,last_error_code FROM crm.n8n_commands WHERE command_id=$1',
          [f.row.command_id],
        )
      ).rows[0],
      {
        status: 'sent',
        retryable: false,
        retry_safe: false,
        last_error_code: null,
      },
    );
    assert.deepEqual(await history(), unknownHistory);
    await f.integration.recordEvent(
      callback('read', 'message.read', {
        external_message_id: 'wamid.synthetic-media',
      }),
    );
    await f.integration.recordEvent(
      callback('delivered', 'message.delivered', {
        external_message_id: 'wamid.synthetic-media',
      }),
    );
    await f.integration.recordEvent(
      callback('failed', 'message.failed', {
        external_message_id: 'wamid.synthetic-media',
      }),
    );
    assert.equal(
      (
        await pool.query(
          'SELECT delivery_status FROM crm.messages WHERE id=$1',
          [f.sent.id],
        )
      ).rows[0].delivery_status,
      'read',
    );
    assert.equal((await snapshot()).used, '100');
  });
  test('T12/MED-06: text outbox wire shape and reservation stay compatible', async () => {
    const f = await mediaPanelCommand('text');
    assert.deepEqual(f.payload.message, {
      filename: null,
      media_url: null,
      text: 'Synthetic text',
      type: 'text',
    });
    assert.equal(
      (await f.integration.recordEvent(f.event('text-reserve')))
        .send_authorized,
      true,
    );
    assert.equal((await snapshot()).used, '0');
  });
  for (const eventType of ['message.sent', 'message.send.unknown'])
    test(`T12/MED-21/24: contradictory callback conversation ${eventType} has no effect`, async () => {
      const f = await mediaPanelCommand();
      await f.integration.recordEvent(f.event('reserve-cross-callback'));
      const effects = async () => {
        const result = [];
        for (const table of [
          'messages',
          'n8n_commands',
          'audit_events',
          'domain_events',
          'n8n_events',
        ]) {
          result.push(
            (
              await pool.query(
                `SELECT to_jsonb(t) AS row FROM crm.${table} t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          );
        }
        return result;
      };
      const before = await effects();
      const callback = f.event('cross-callback', {
        event_type: eventType,
        conversation_id: 'bind-other-conversation',
        external_message_id: 'wamid.synthetic-cross-callback',
      });
      delete callback.message;
      delete callback.source_revision;
      await assert.rejects(f.integration.recordEvent(callback), {
        statusCode: 409,
      });
      assert.deepEqual(await effects(), before);
      assert.equal((await snapshot()).used, '100');
    });
  async function effects() {
    const result = [];
    for (const table of [
      'messages',
      'n8n_commands',
      'audit_events',
      'domain_events',
      'n8n_events',
    ])
      result.push(
        (
          await pool.query(
            `SELECT to_jsonb(t) AS row FROM crm.${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
      );
    return result;
  }
  for (const mutation of [
    `UPDATE crm.conversations SET terminal_at=now(),state='sem_lead' WHERE id='bind-conversation'`,
    `UPDATE crm.conversations SET inbound_revision=inbound_revision+1 WHERE id='bind-conversation'`,
    `UPDATE crm.chat_media SET content_sha256=repeat('d',64)`,
    `UPDATE crm.chat_media SET state='unavailable',validation_status='infected',sanitized_reason='infected'`,
  ])
    test(`T13/MED-21/22: stale or inconsistent variant denies read ${mutation.split('SET ')[1]}`, async () => {
      const f = await mediaPanelCommand();
      const { PostgresN8nIntegrationRepository } =
        await import('../modules/n8n-integration/src/postgres-repository.js');
      const repo = new PostgresN8nIntegrationRepository({
        database,
        envelopeKey: KEY,
      });
      const event = f.event('stale-read');
      await f.integration.recordEvent(event);
      await pool.query(mutation);
      const before = await effects();
      await assert.rejects(
        repo.readReservedMedia({
          commandId: f.row.command_id,
          technical: event.technical,
        }),
        { statusCode: 409 },
      );
      assert.deepEqual(await effects(), before);
    });
  test('T13/MED-22: reserved media is read-only and bound to original execution', async () => {
    const f = await mediaPanelCommand();
    const { PostgresN8nIntegrationRepository } =
      await import('../modules/n8n-integration/src/postgres-repository.js');
    const repo = new PostgresN8nIntegrationRepository({
      database,
      envelopeKey: KEY,
    });
    const event = f.event('read-reserve');
    const input = { commandId: f.row.command_id, technical: event.technical };
    await assert.rejects(repo.readReservedMedia(input), { statusCode: 409 });
    await f.integration.recordEvent(event);
    const before = await effects();
    assert.equal((await repo.readReservedMedia(input)).id, f.id);
    assert.equal(
      (await f.integration.recordEvent(event)).send_authorized,
      false,
    );
    assert.equal(
      (await repo.readReservedMedia(input)).content_sha256,
      'b'.repeat(64),
    );
    assert.deepEqual(await effects(), before);
    for (const key of ['executionId', 'workflowKey', 'workflowVersion']) {
      await assert.rejects(
        repo.readReservedMedia({
          ...input,
          technical: { ...input.technical, [key]: 'other' },
        }),
        { statusCode: 409 },
      );
    }
    await pool.query(
      `UPDATE crm.conversations SET automation_epoch=automation_epoch+1 WHERE id='bind-conversation'`,
    );
    await assert.rejects(repo.readReservedMedia(input), { statusCode: 409 });
    const failure = f.event('before-send-failure', {
      event_type: 'workflow.failed',
      failure: {
        phase: 'before_message_send',
        code: 'MEDIA_PREFLIGHT_REJECTED',
      },
    });
    delete failure.message;
    await f.integration.recordEvent(failure);
    assert.deepEqual(
      (
        await pool.query(
          'SELECT status,retryable,retry_safe,locked_by,locked_until FROM crm.n8n_commands WHERE command_id=$1',
          [f.row.command_id],
        )
      ).rows[0],
      {
        status: 'failed',
        retryable: false,
        retry_safe: false,
        locked_by: null,
        locked_until: null,
      },
    );
    assert.equal(
      (
        await pool.query('SELECT status FROM crm.messages WHERE id=$1', [
          f.sent.id,
        ])
      ).rows[0].status,
      'failed',
    );
    const after = await effects();
    assert.equal((await f.integration.recordEvent(failure)).duplicate, true);
    assert.deepEqual(await effects(), after);
  });
  for (const terminal of ['outcome_unknown', 'sent'])
    test(`T13/MED-24: before-send failure cannot regress ${terminal} or another execution`, async () => {
      const f = await mediaPanelCommand();
      await f.integration.recordEvent(f.event('failure-reserve'));
      const failure = f.event('failure-abort', {
        event_type: 'workflow.failed',
        failure: {
          phase: 'before_message_send',
          code: 'MEDIA_DOWNLOAD_FAILED',
        },
      });
      delete failure.message;
      await assert.rejects(
        f.integration.recordEvent({
          ...failure,
          technical: { ...failure.technical, executionId: 'other' },
        }),
        { statusCode: 409 },
      );
      await pool.query('UPDATE crm.messages SET status=$2 WHERE id=$1', [
        f.sent.id,
        terminal,
      ]);
      await pool.query(
        'UPDATE crm.n8n_commands SET status=$2,completed_at=now(),locked_by=NULL,locked_until=NULL WHERE command_id=$1',
        [f.row.command_id, terminal],
      );
      const before = await effects();
      await assert.rejects(f.integration.recordEvent(failure), {
        statusCode: 409,
      });
      assert.deepEqual(await effects(), before);
    });
  for (const type of ['audio', 'video'])
    test(`T12/MED-20/21: exact ${type} variant reserves with appropriate caption`, async () => {
      const f = await mediaPanelCommand(type);
      assert.equal(f.payload.message.media_id, f.id);
      assert.equal(f.payload.message.type, type);
      assert.equal(
        f.payload.message.mime_type,
        type === 'audio' ? 'audio/ogg' : 'video/mp4',
      );
      assert.equal(
        f.payload.message.caption,
        type === 'audio' ? null : 'Synthetic caption',
      );
      assert.equal(
        (await f.integration.recordEvent(f.event(`${type}-reserve`)))
          .send_authorized,
        true,
      );
      assert.equal((await snapshot()).used, '100');
    });
}

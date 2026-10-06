import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresChatMediaUploadRepository } from '../modules/integration-reliability/src/postgres-chat-media-upload-repository.js';
import { createApi } from '../apps/api/src/app.js';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString) {
  const pool = new Pool({ connectionString, max: 4 });
  const database = {
    query: pool.query.bind(pool),
    connection: async (/** @type {Function} */ work) => {
      const client = await pool.connect();
      try {
        const value = await work(client);
        client.release();
        return value;
      } catch (error) {
        client.release(
          error instanceof Error ? error : new Error('Connection work failed'),
        );
        throw error;
      }
    },
    transaction: (/** @type {Function} */ work) =>
      withTransaction(pool, /** @type {any} */ (work)),
  };
  const repository = new PostgresChatMediaUploadRepository({
    database,
    limitBytes: 60 * 1024 * 1024,
  });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 7), iv);
  const ciphertext = Buffer.concat([
    cipher.update('synthetic.png'),
    cipher.final(),
  ]);
  const envelope = {
    algorithm: 'AES-256-GCM',
    keyVersion: 1,
    version: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
  before(async () => {
    assert.equal(new URL(connectionString).pathname, '/crm_silmer_test');
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    for (const id of ['upload-seller', 'upload-other'])
      await pool.query(
        `INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,$3,'Synthetic')`,
        [id, `${id}@example.test`, '$argon2id$synthetic'],
      );
    await pool.query(
      `INSERT INTO crm.contacts(id,created_at,updated_at) VALUES('upload-contact',now(),now())`,
    );
    await pool.query(
      `INSERT INTO crm.contact_identities(id,current_contact_id,provider,provider_account_id,channel,external_identity_lookup_hash,identity_kind,phone_status,identity_envelope,created_at,updated_at) VALUES('upload-identity','upload-contact','meta','synthetic','whatsapp',$1,'phone','confirmed',$2,now(),now())`,
      ['a'.repeat(64), envelope],
    );
    await pool.query(
      `INSERT INTO crm.conversations(id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,opened_at,last_message_at) VALUES('upload-conversation','upload-identity','meta','synthetic','synthetic',1,now(),now())`,
    );
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE crm.chat_media,crm.chat_media_quotas,crm.outbox_jobs CASCADE',
    );
    await pool.query(
      `UPDATE crm.conversations SET version=1,assigned_user_id=NULL,terminal_at=NULL,state='nova',automation_state='assistant',automation_epoch=1 WHERE id='upload-conversation'`,
    );
  });
  after(() => pool.end());
  /** @param {Record<string,any>} [overrides] */
  function input(overrides = {}) {
    return {
      id: randomUUID(),
      actor: { id: 'upload-seller', kind: 'human', capabilities: [] },
      conversationId: 'upload-conversation',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      sessionHash: 'synthetic-session',
      reservationBytes: 10 * 1024 * 1024,
      ...overrides,
    };
  }
  /** @param {any} admission */
  function completed(admission) {
    return {
      ...admission,
      kind: 'image',
      origin: 'attachment',
      sizeBytes: 100,
      reservationBytes: 200,
      sha256: 'b'.repeat(64),
      fingerprint: 'c'.repeat(64),
      declaredMimeType: 'image/png',
      filenameEnvelope: envelope,
    };
  }
  async function counts() {
    return (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM crm.chat_media) AS media,(SELECT count(*)::int FROM crm.outbox_jobs) AS jobs,(SELECT reserved_bytes FROM crm.chat_media_quotas WHERE bucket_alias='chat-dev') AS reserved`,
      )
    ).rows[0];
  }
  test('MED-28: durable admission reserves worst case before any media/job exists', async () => {
    const row = input();
    await repository.admit(row);
    assert.deepEqual(await counts(), {
      media: 0,
      jobs: 0,
      reserved: String(row.reservationBytes),
    });
    assert.equal(
      (await pool.query('SELECT state FROM crm.chat_media_admissions')).rows[0]
        .state,
      'receiving',
    );
    assert.equal(
      (
        await pool.query(
          'SELECT automation_state,automation_epoch,version FROM crm.conversations',
        )
      ).rows[0].automation_state,
      'assistant',
    );
  });
  test('MED-06/28: atomic completion moves reservation once and queues a complete upload', async () => {
    const row = input();
    await repository.admit(row);
    const result = await repository.complete(completed(row));
    assert.deepEqual(result, { mediaId: row.id, duplicate: false });
    assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '200' });
    const media = (await pool.query('SELECT * FROM crm.chat_media')).rows[0];
    assert.equal(media.input_size_bytes, '100');
    assert.equal(media.declared_mime_type, 'image/png');
    assert.equal(media.spool_key, row.id);
    assert.equal(media.state, 'uploaded');
    assert.deepEqual(
      (
        await pool.query(
          'SELECT state,reservation_bytes,media_id FROM crm.chat_media_admissions',
        )
      ).rows,
      [{ state: 'consumed', reservation_bytes: '0', media_id: row.id }],
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT queue,job_type,effect_policy,chat_media_id FROM crm.outbox_jobs',
        )
      ).rows,
      [
        {
          queue: 'chat_media',
          job_type: 'chat_media.process',
          effect_policy: 'internal',
          chat_media_id: row.id,
        },
      ],
    );
  });
  test('MED-06: accepted replay requires no reservation even when quota is full', async () => {
    const row = input();
    await repository.admit(row);
    await repository.complete(completed(row));
    await pool.query(
      `UPDATE crm.chat_media_quotas SET limit_bytes=reserved_bytes`,
    );
    const replay = await repository.admit({ ...row, id: randomUUID() });
    assert.deepEqual(replay, {
      replay: { id: row.id, request_fingerprint: 'c'.repeat(64) },
    });
    assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '200' });
  });
  test('MED-06: concurrent same scope has one durable admission and active replay 409', async () => {
    const row = input();
    const results = await Promise.allSettled([
      repository.admit(row),
      repository.admit({ ...row, id: randomUUID() }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      /** @type {any} */ (results.find((r) => r.status === 'rejected')).reason
        .statusCode,
      409,
    );
    assert.deepEqual(await counts(), {
      media: 0,
      jobs: 0,
      reserved: String(row.reservationBytes),
    });
  });
  test('MED-28: accepted replays and divergent hashes share 12/min throttle without extra quota', async () => {
    const row = input();
    await repository.admit(row);
    await repository.complete(completed(row));
    for (let n = 1; n < 12; n++) {
      const replay = await repository.admit({ ...row, id: randomUUID() });
      assert.equal(replay.replay.id, row.id);
    }
    await assert.rejects(repository.admit({ ...row, id: randomUUID() }), {
      statusCode: 429,
    });
    assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '200' });
  });
  test('MED-28: quota includes used plus reserved and rejects excess atomically', async () => {
    const row = input();
    await repository.admit(row);
    await pool.query(
      `UPDATE crm.chat_media_quotas SET used_bytes=limit_bytes-reserved_bytes`,
    );
    await assert.rejects(repository.admit(input()), { statusCode: 429 });
    assert.deepEqual(await counts(), {
      media: 0,
      jobs: 0,
      reserved: String(row.reservationBytes),
    });
  });
  test('MED-08: transfer or close during streaming prevents completion and preserves charged orphan', async () => {
    for (const mutate of [
      `assigned_user_id='upload-other'`,
      `terminal_at=now(),state='sem_lead'`,
    ]) {
      await pool.query(
        'TRUNCATE crm.chat_media,crm.chat_media_quotas,crm.outbox_jobs CASCADE',
      );
      await pool.query(
        `UPDATE crm.conversations SET assigned_user_id=NULL,terminal_at=NULL`,
      );
      const row = input();
      await repository.admit(row);
      await pool.query(`UPDATE crm.conversations SET ${mutate}`);
      await assert.rejects(repository.complete(completed(row)), {
        statusCode: mutate.startsWith('assigned') ? 403 : 409,
      });
      assert.deepEqual(await counts(), {
        media: 0,
        jobs: 0,
        reserved: String(row.reservationBytes),
      });
      await repository.release(row.id);
      assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });
    }
  });
  test('MED-28: one session allows 12 admissions per minute even after confirmed cleanup', async () => {
    for (let n = 0; n < 12; n++) {
      const row = input();
      await repository.admit(row);
      await repository.release(row.id);
    }
    await assert.rejects(repository.admit(input()), { statusCode: 429 });
    assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });
  });
  test('MED-28: cookie order and unrelated cookies cannot bypass the 12/min session limit', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'crm-media-throttle-'));
    const access = {
      async authorizeRead() {
        return {
          actor: { id: 'upload-seller', kind: 'human', capabilities: [] },
        };
      },
      async authorize() {
        return {
          actor: { id: 'upload-seller', kind: 'human', capabilities: [] },
        };
      },
    };
    const api = createApi(
      {},
      {
        chatMedia: createChatMediaApiRuntime({
          repository,
          access,
          spoolRoot: root,
          envelopeKey: Buffer.alloc(32, 7),
        }),
      },
    );
    t.after(async () => {
      await api.close();
      await rm(root, { recursive: true, force: true });
    });
    const payload = Buffer.from(
      '--b\r\nContent-Disposition: form-data; name="kind"\r\n\r\nimage\r\n--b\r\nContent-Disposition: form-data; name="origin"\r\n\r\nattachment\r\n--b\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n1\r\n--b\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n\r\n--b--\r\n',
    );
    for (let n = 0; n < 13; n++) {
      const response = await api.inject({
        method: 'POST',
        url: '/api/v1/conversations/upload-conversation/media',
        payload,
        headers: {
          'content-type': 'multipart/form-data; boundary=b',
          'idempotency-key': `throttle-${n}`,
          cookie:
            n % 2
              ? `unrelated=${n}; crm_session=same-synthetic-session; crm_csrf=csrf`
              : `crm_session=same-synthetic-session; crm_csrf=csrf; unrelated=${n}`,
          origin: 'https://crm.example.test',
          'x-csrf-token': 'csrf',
        },
      });
      assert.equal(response.statusCode, n < 12 ? 422 : 429);
    }
    assert.equal(
      (
        await pool.query(
          'SELECT count(DISTINCT session_hash)::int AS count FROM crm.chat_media_admissions',
        )
      ).rows[0].count,
      1,
    );
    assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });
  });
  test('MED-05/28: job insertion rollback leaves admission charged and no media published', async () => {
    const row = input();
    await repository.admit(row);
    await pool.query(
      `CREATE FUNCTION crm.synthetic_reject_media_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic job write failure'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER synthetic_reject_media_job BEFORE INSERT ON crm.outbox_jobs FOR EACH ROW EXECUTE FUNCTION crm.synthetic_reject_media_job()`,
    );
    try {
      await assert.rejects(
        repository.complete(completed(row)),
        /synthetic job write failure/u,
      );
      assert.deepEqual(await counts(), {
        media: 0,
        jobs: 0,
        reserved: String(row.reservationBytes),
      });
      assert.equal(
        (await pool.query('SELECT state FROM crm.chat_media_admissions'))
          .rows[0].state,
        'receiving',
      );
    } finally {
      await pool.query(
        'DROP TRIGGER synthetic_reject_media_job ON crm.outbox_jobs',
      );
      await pool.query('DROP FUNCTION crm.synthetic_reject_media_job()');
    }
  });
  for (const unavailable of [false, true])
    test(`MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable})`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'crm-media-ambiguous-'));
      const access = {
        async authorizeRead() {
          return {
            actor: { id: 'upload-seller', kind: 'human', capabilities: [] },
          };
        },
        async authorize() {
          return {
            actor: { id: 'upload-seller', kind: 'human', capabilities: [] },
          };
        },
      };
      const ambiguous = {
        admit: repository.admit.bind(repository),
        release: repository.release.bind(repository),
        async complete(/** @type {any} */ row) {
          await repository.complete(row);
          throw new Error('synthetic response lost');
        },
        async cleanupDisposition(/** @type {string} */ id) {
          if (unavailable) throw new Error('synthetic DB unavailable');
          return repository.cleanupDisposition(id);
        },
      };
      const api = createApi(
        {},
        {
          chatMedia: createChatMediaApiRuntime({
            repository: ambiguous,
            access,
            spoolRoot: root,
            envelopeKey: Buffer.alloc(32, 7),
          }),
        },
      );
      t.after(async () => {
        await api.close();
        await rm(root, { recursive: true, force: true });
      });
      const payload = Buffer.from(
        '--b\r\nContent-Disposition: form-data; name="kind"\r\n\r\nimage\r\n--b\r\nContent-Disposition: form-data; name="origin"\r\n\r\nattachment\r\n--b\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n1\r\n--b\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\nsynthetic-bytes\r\n--b--\r\n',
      );
      const request = {
        method: /** @type {'POST'} */ ('POST'),
        url: '/api/v1/conversations/upload-conversation/media',
        payload,
        headers: {
          'content-type': 'multipart/form-data; boundary=b',
          'idempotency-key': 'ambiguous-upload',
          cookie: 'crm_session=synthetic-session; crm_csrf=csrf',
          origin: 'https://crm.example.test',
          'x-csrf-token': 'csrf',
        },
      };
      assert.equal((await api.inject(request)).statusCode, 503);
      const media = (await pool.query('SELECT * FROM crm.chat_media')).rows[0];
      assert.equal(
        await (
          await import('node:fs/promises')
        ).readFile(join(root, media.spool_key), 'utf8'),
        'synthetic-bytes',
      );
      assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '30' });
      assert.equal(
        (await pool.query('SELECT state FROM crm.chat_media_admissions'))
          .rows[0].state,
        'consumed',
      );
      const replay = await api.inject(request);
      assert.equal(replay.statusCode, 202);
      assert.equal(replay.json().mediaId, media.id);
      assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '30' });
    });
  test('MED-27 support: orphan discovery preserves reservation until confirmed cleanup, consumed excluded', async () => {
    const orphan = input();
    await repository.admit(orphan);
    await pool.query(
      `UPDATE crm.chat_media_admissions SET created_at=now()-interval '25 hours' WHERE id=$1`,
      [orphan.id],
    );
    assert.deepEqual(await repository.listAbandonedAdmissions(), [
      {
        id: orphan.id,
        bucket_alias: 'chat-dev',
        reservation_bytes: String(orphan.reservationBytes),
      },
    ]);
    await repository.release(orphan.id);
    await repository.release(orphan.id);
    assert.deepEqual(await repository.listAbandonedAdmissions(), []);
    assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });
  });
  test('T8 MED-16: production identity/read/write composition distinguishes401/403/200/503', async (t) => {
    const { createIdentityApiRuntime } =
      await import('../apps/api/src/identity-runtime.js');
    const { createOperationalAuthRuntime } =
      await import('../apps/api/src/operational-auth-runtime.js');
    const { createOperationReadRuntime } =
      await import('../apps/api/src/operation-runtime.js');
    const { createHash } = await import('node:crypto');
    const key = Buffer.alloc(32, 7).toString('base64url');
    const environment = {
      APP_ORIGIN: 'https://crm.example.test',
      AUTH_THROTTLE_HMAC_KEY: key,
      IDEMPOTENCY_ENVELOPE_KEY: key,
      IDENTITY_BOOTSTRAP_TOKEN:
        'synthetic-bootstrap-token-with-at-least-32-characters',
      CONTACT_IDENTITY_ENVELOPE_KEY: key,
      INBOX_MESSAGE_ENVELOPE_KEY: key,
      HANDOFF_ENVELOPE_KEY: key,
      OPERATION_CURSOR_HMAC_KEY: key,
    };
    await pool.query(
      `INSERT INTO crm.user_functions(user_id,function_name) VALUES('upload-seller','Vendedor') ON CONFLICT DO NOTHING`,
    );
    const hash = (/** @type {string} */ value) =>
      createHash('sha256').update(value).digest('hex');
    await pool.query(
      `INSERT INTO crm.sessions(token_hash,user_id,csrf_hash,created_at,last_seen_at,absolute_expires_at) VALUES($1,'upload-seller',$2,now()-interval '1 second',now()-interval '1 second',now()+interval '1 hour') ON CONFLICT DO NOTHING`,
      [hash('valid-synthetic-session'), hash('valid-synthetic-csrf')],
    );
    const identity = createIdentityApiRuntime(database, environment);
    const operations = createOperationReadRuntime(database, {
      identity,
      environment,
    });
    const access = {
      ...createOperationalAuthRuntime({ identity }),
      authorizeRead: operations.authorizeRead,
    };
    const root = await mkdtemp(join(tmpdir(), 'crm-media-status-auth-'));
    const api = createApi(
      {},
      {
        chatMedia: createChatMediaApiRuntime({
          repository,
          access,
          spoolRoot: root,
          envelopeKey: Buffer.alloc(32, 7),
        }),
      },
    );
    t.after(async () => {
      await api.close();
      await rm(root, { recursive: true, force: true });
    });
    const row = input();
    await repository.admit(row);
    await repository.complete(completed(row));
    const get = (
      cookie = 'crm_session=valid-synthetic-session',
      origin = 'https://crm.example.test',
    ) =>
      api.inject({
        method: 'GET',
        url: `/api/v1/conversations/upload-conversation/media/${row.id}`,
        headers: { cookie, origin },
      });
    assert.equal((await get()).statusCode, 200);
    await pool.query(
      `INSERT INTO crm.sessions(token_hash,user_id,csrf_hash,created_at,last_seen_at,absolute_expires_at) VALUES($1,'upload-other',$2,now()-interval '1 second',now()-interval '1 second',now()+interval '1 hour') ON CONFLICT DO NOTHING`,
      [hash('other-synthetic-session'), hash('other-csrf')],
    );
    assert.equal(
      (await get('crm_session=other-synthetic-session')).statusCode,
      403,
    );
    await pool.query(
      `INSERT INTO crm.user_functions(user_id,function_name) VALUES('upload-other','Vendedor') ON CONFLICT DO NOTHING`,
    );
    assert.equal(
      (await get('crm_session=other-synthetic-session')).statusCode,
      403,
    );
    await pool.query(
      `INSERT INTO crm.user_capabilities(user_id,capability,granted_by) VALUES('upload-other','COMMERCIAL_ADMIN','upload-seller') ON CONFLICT DO NOTHING`,
    );
    assert.equal(
      (await get('crm_session=other-synthetic-session')).statusCode,
      200,
    );
    await pool.query(
      `DELETE FROM crm.user_capabilities WHERE user_id='upload-other'`,
    );
    await pool.query(
      `INSERT INTO crm.messages(id,conversation_id,provider,provider_account_id,command_id,direction,author_kind,author_id,message_type,content_envelope,status,occurred_at,created_at) VALUES('status-message','upload-conversation','meta','synthetic','status-message','outbound','human','upload-seller','image',$1,'queued',now(),now())`,
      [envelope],
    );
    await pool.query(
      `UPDATE crm.chat_media SET state='attached',message_id='status-message',attached_at=now(),processed_at=now(),validation_status='clean',detected_mime_type='image/png',size_bytes=100,content_sha256=$2 WHERE id=$1`,
      [row.id, 'b'.repeat(64)],
    );
    assert.equal(
      (await get('crm_session=other-synthetic-session')).statusCode,
      200,
    );
    assert.equal((await get('crm_session=bogus')).statusCode, 401);
    assert.equal(
      (await get(undefined, 'https://denied.example.test')).statusCode,
      403,
    );
    await pool.query(
      `UPDATE crm.sessions SET revoked_at=now() WHERE token_hash=$1`,
      [hash('valid-synthetic-session')],
    );
    assert.equal((await get()).statusCode, 401);
    await pool.query(
      `UPDATE crm.sessions SET revoked_at=NULL,created_at=now()-interval '1 hour',absolute_expires_at=now()-interval '1 second' WHERE token_hash=$1`,
      [hash('valid-synthetic-session')],
    );
    assert.equal((await get()).statusCode, 401);
    await pool.query(
      `UPDATE crm.sessions SET absolute_expires_at=now()+interval '1 hour' WHERE token_hash=$1`,
      [hash('valid-synthetic-session')],
    );
    const payload = Buffer.from(
      '--b\r\nContent-Disposition: form-data; name="kind"\r\n\r\nimage\r\n--b\r\nContent-Disposition: form-data; name="origin"\r\n\r\nattachment\r\n--b\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n1\r\n--b\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\nsynthetic-bytes\r\n--b--\r\n',
    );
    const post = (
      session = 'valid-synthetic-session',
      csrf = 'valid-synthetic-csrf',
    ) =>
      api.inject({
        method: 'POST',
        url: '/api/v1/conversations/upload-conversation/media',
        payload,
        headers: {
          'content-type': 'multipart/form-data; boundary=b',
          'idempotency-key': 'production-auth-upload',
          cookie: `crm_session=${session}; crm_csrf=valid-synthetic-csrf`,
          origin: 'https://crm.example.test',
          'x-csrf-token': csrf,
        },
      });
    assert.equal((await post('bogus')).statusCode, 401);
    assert.equal((await post(undefined, 'wrong')).statusCode, 403);
    assert.equal((await post()).statusCode, 202);
    const brokenDb = {
      query: database.query,
      transaction: async () => {
        throw new Error('synthetic DB unavailable');
      },
    };
    const unavailable = createIdentityApiRuntime(brokenDb, environment);
    const failedOperations = createOperationReadRuntime(database, {
      identity: unavailable,
      environment,
    });
    const failedApi = createApi(
      {},
      {
        chatMedia: createChatMediaApiRuntime({
          repository,
          access: {
            ...createOperationalAuthRuntime({ identity: unavailable }),
            authorizeRead: failedOperations.authorizeRead,
          },
          spoolRoot: root,
          envelopeKey: Buffer.alloc(32, 7),
        }),
      },
    );
    t.after(() => failedApi.close());
    assert.equal(
      (
        await failedApi.inject({
          method: 'GET',
          url: `/api/v1/conversations/upload-conversation/media/${row.id}`,
          headers: {
            cookie: 'crm_session=valid-synthetic-session',
            origin: 'https://crm.example.test',
          },
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (
        await failedApi.inject({
          method: 'POST',
          url: '/api/v1/conversations/upload-conversation/media',
          payload,
          headers: {
            'content-type': 'multipart/form-data; boundary=b',
            'idempotency-key': 'failed-production-auth-upload',
            cookie:
              'crm_session=valid-synthetic-session; crm_csrf=valid-synthetic-csrf',
            origin: 'https://crm.example.test',
            'x-csrf-token': 'valid-synthetic-csrf',
          },
        })
      ).statusCode,
      503,
    );
  });
  test('MED-19: missing object CAS marks lost while preserving quota and rejects stale versions', async () => {
    const admission = input();
    await repository.admit(admission);
    await repository.complete(completed(admission));
    await pool.query(
      `UPDATE crm.chat_media SET state='ready',validation_status='clean',original_sha256=$2,content_sha256=$2,detected_mime_type='image/png',size_bytes=100,processed_at=now() WHERE id=$1`,
      [admission.id, 'b'.repeat(64)],
    );
    const row = await repository.readForActor({
      mediaId: admission.id,
      conversationId: admission.conversationId,
      actor: admission.actor,
    });
    const quota = await counts();
    assert.equal(
      await repository.markLost({ ...row, version: Number(row.version) + 1 }),
      false,
    );
    assert.equal(await repository.markLost(row), true);
    assert.equal(await repository.markLost(row), false);
    assert.deepEqual(await counts(), quota);
    assert.equal(
      (
        await repository.readForActor({
          mediaId: admission.id,
          conversationId: admission.conversationId,
          actor: admission.actor,
        })
      ).state,
      'lost',
    );
    await assert.rejects(
      repository.readForActor({
        mediaId: admission.id,
        conversationId: 'different',
        actor: admission.actor,
      }),
      { statusCode: 404 },
    );
  });
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, after, test } from 'node:test';
import { Pool } from 'pg';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';
import { createDatabase } from '../modules/database/src/database.js';
import { PostgresJobQueue } from '../modules/integration-reliability/src/postgres-job-queue.js';
import { PostgresChatMediaRepository } from '../modules/integration-reliability/src/postgres-chat-media-repository.js';
import { createChatMediaProcessJobHandler } from '../modules/integration-reliability/src/chat-media-process-worker.js';
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

import { PostgresChatMediaDraftCleanup } from '../modules/integration-reliability/src/chat-media-draft-cleanup.js';
import { PostgresTransientMediaRepository } from '../modules/integration-reliability/src/postgres-transient-media.js';

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
    connection: async (/** @type {Function} */ work) => {
      const client = await pool.connect();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    },
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

  /** @type {Array<[string,string]>} */ const effects = [];
  function cleanup(overrides = {}) {
    return new PostgresChatMediaDraftCleanup({
      database,
      spoolRoot: '/synthetic-spool',
      bucketAlias: 'chat-dev',
      removeFile: async (/** @type {string} */ path) => {
        effects.push(['spool', path]);
      },
      store: {
        async deleteDraft(/** @type {string} */ key) {
          effects.push(['object', key]);
        },
      },
      ...overrides,
    });
  }
  beforeEach(() => {
    effects.length = 0;
  });
  /** @param {string} id @param {number} [hours] */
  async function age(id, hours = 25) {
    await pool.query(
      `UPDATE crm.chat_media SET created_at=now()-($2*interval '1 hour') WHERE id=$1`,
      [id, hours],
    );
  }
  /** @param {string} id */
  async function media(id) {
    return (await pool.query('SELECT * FROM crm.chat_media WHERE id=$1', [id]))
      .rows[0];
  }
  test('T22/MED-27: young ready draft keeps bytes and reservation', async () => {
    const id = await ready();
    await cleanup().runOnce();
    assert.equal((await media(id)).state, 'ready');
    assert.equal((await snapshot()).reserved, '100');
    assert.deepEqual(effects, []);
  });
  test('T22/MED-27: old draft deletes spool/object before freeing reservation, repeat is inert', async () => {
    const id = await ready();
    await age(id);
    const objectKey = (await media(id)).object_key;
    const worker = cleanup({
      store: {
        async deleteDraft(/** @type {string} */ key) {
          assert.equal((await snapshot()).reserved, '100');
          effects.push(['object', key]);
        },
      },
    });
    await worker.runOnce();
    assert.ok(
      effects.some(([kind, key]) => kind === 'object' && key === objectKey),
    );
    assert.equal((await snapshot()).reserved, '0');
    assert.equal((await media(id)).state, 'lost');
    assert.equal((await media(id)).spool_key, null);
    const count = effects.length;
    await worker.runOnce();
    assert.equal(effects.length, count);
    assert.equal((await snapshot()).reserved, '0');
  });
  test('T22/MED-15: attached bytes remain after eight days and legacy terminal/expiry sweepers', async () => {
    const id = await ready();
    const sent = await service().sendHumanMessage(command(id));
    await age(id, 8 * 24);
    await pool.query(
      `UPDATE crm.conversations SET terminal_at=now(),state='sem_lead' WHERE id='bind-conversation'`,
    );
    const legacy = new PostgresTransientMediaRepository({ database });
    await legacy.scheduleTerminalJourneyDeletions();
    await legacy.scheduleExpiredDeletions();
    await cleanup().runOnce();
    assert.equal((await media(id)).message_id, sent.id);
    assert.equal((await media(id)).state, 'attached');
    assert.equal((await snapshot()).used, '100');
    assert.deepEqual(effects, []);
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM crm.outbox_jobs WHERE job_type='media.delete'`,
        )
      ).rows[0].count,
      0,
    );
  });
  test('T22/MED-15: attachment winning media lock prevents every external DELETE', async () => {
    const id = await ready();
    await age(id);
    /** @type {() => void} */ let release = () => {};
    /** @type {() => void} */ let entered = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const locked = new Promise((resolve) => {
      entered = () => resolve(undefined);
    });
    const heldDatabase = {
      ...database,
      transaction: (/** @type {Function} */ work) =>
        database.transaction(async (/** @type {any} */ client) => {
          const query = client.query.bind(client);
          client.query = async (/** @type {any[]} */ ...args) => {
            const result = await query(...args);
            if (
              String(args[0]).includes('FROM crm.chat_media') &&
              String(args[0]).includes('FOR UPDATE')
            ) {
              entered();
              await gate;
            }
            return result;
          };
          try {
            return await work(client);
          } finally {
            client.query = query;
          }
        }),
    };
    const inbox = createInboxService({
      repository: new PostgresInboxRepository({
        database: heldDatabase,
        envelopeKey: KEY,
        outboundMessageOutbox: new PostgresN8nCommandOutbox({
          envelopeKey: KEY,
        }),
      }),
      auditPort: { async append() {} },
    });
    const attaching = inbox.sendHumanMessage(command(id));
    await locked;
    await cleanup().runOnce();
    assert.deepEqual(effects, []);
    release();
    const sent = await attaching;
    await cleanup().runOnce();
    assert.equal((await media(id)).message_id, sent.id);
    assert.deepEqual(effects, []);
  });
  test('T22/MED-27: object failure preserves quota; successful retry alone releases it', async () => {
    const id = await ready();
    await age(id);
    await cleanup({
      store: {
        async deleteDraft() {
          throw new Error('synthetic unavailable');
        },
      },
    }).runOnce();
    assert.equal((await snapshot()).reserved, '100');
    assert.equal((await media(id)).state, 'unavailable');
    await cleanup().runOnce();
    assert.equal((await snapshot()).reserved, '0');
    assert.equal((await media(id)).state, 'lost');
  });
  test('T22/MED-27: spool failure does not delete object or release quota', async () => {
    const id = await ready();
    await age(id);
    await cleanup({
      removeFile: async () => {
        throw new Error('synthetic busy file');
      },
    }).runOnce();
    assert.equal((await snapshot()).reserved, '100');
    assert.equal((await media(id)).state, 'unavailable');
    assert.deepEqual(effects, []);
  });
  test('T22/MED-27: active process job keeps old draft intact', async () => {
    const id = await ready();
    await age(id);
    await pool.query(
      `UPDATE crm.outbox_jobs SET status='processing',locked_by='synthetic-worker',locked_until=now()+interval '1 minute',heartbeat_at=now() WHERE chat_media_id=$1`,
      [id],
    );
    await cleanup().runOnce();
    assert.equal((await media(id)).state, 'ready');
    assert.equal((await snapshot()).reserved, '100');
    assert.deepEqual(effects, []);
  });
  test('T22/MED-27: real queue recovery fences expired exhausted process before cleanup', async () => {
    const id = await ready();
    await age(id);
    await pool.query(
      'UPDATE crm.outbox_jobs SET max_attempts=1 WHERE chat_media_id=$1',
      [id],
    );
    const queue = new PostgresJobQueue({ database });
    const now = Date.now() + 60_000;
    const first = await queue.claim({
      workerId: 'synthetic-dead-worker',
      queue: 'chat_media',
      now: new Date(now),
      leaseMs: 1000,
    });
    assert.equal(first.length, 1);
    await cleanup().runOnce();
    assert.deepEqual(effects, []);
    const recovered = await queue.claim({
      workerId: 'synthetic-recovery',
      queue: 'chat_media',
      now: new Date(now + 2000),
    });
    assert.equal(recovered.length, 0);
    assert.equal(
      (
        await pool.query(
          'SELECT status FROM crm.outbox_jobs WHERE chat_media_id=$1',
          [id],
        )
      ).rows[0].status,
      'dead_letter',
    );
    await cleanup().runOnce();
    assert.equal((await media(id)).state, 'lost');
    assert.equal((await snapshot()).reserved, '0');
  });
  test(
    'T22/MED-27: living decoder losing heartbeat keeps bytes charged through queue recovery',
    { timeout: 5000 },
    async (t) => {
      const id = await ready();
      await age(id);
      const reservation = 100 + 32 * 1024 * 1024;
      await pool.query(
        `UPDATE crm.chat_media SET state='uploaded',kind='audio',origin='recording',declared_mime_type='audio/webm',content_sha256=NULL,reservation_bytes=$2 WHERE id=$1`,
        [id, reservation],
      );
      await pool.query(
        `UPDATE crm.chat_media_quotas SET reserved_bytes=$1 WHERE bucket_alias='chat-dev'`,
        [reservation],
      );
      await pool.query(
        'UPDATE crm.outbox_jobs SET max_attempts=1 WHERE chat_media_id=$1',
        [id],
      );
      const root = await mkdtemp(join(tmpdir(), 'crm-living-decoder-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(join(root, id), Buffer.alloc(100));
      let entered = () => {};
      let release = () => {};
      const decoding = new Promise((resolve) => {
        entered = () => resolve(undefined);
      });
      const finish = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      let leaseLost = false;
      let markLeaseLost = () => {};
      const heartbeatLost = new Promise((resolve) => {
        markLeaseLost = () => resolve(undefined);
      });
      const draftCleanup = cleanup({
        spoolRoot: root,
        removeFile: async (/** @type {string} */ path) => {
          effects.push(['spool', path]);
          await rm(path, { force: true });
        },
      });
      const queue = new PostgresJobQueue({ database });
      const now = Date.now() + 60_000;
      let heartbeatNow = now;
      const [job] = await queue.claim({
        workerId: 'synthetic-live-decoder',
        queue: 'chat_media',
        now: new Date(now),
        leaseMs: 1000,
      });
      const handler = createChatMediaProcessJobHandler({
        repository: new PostgresChatMediaRepository({ database }),
        store: {
          async head() {
            assert.fail('lost heartbeat cannot reach S3');
          },
          async putValidated() {
            assert.fail('lost heartbeat cannot publish');
          },
        },
        spoolRoot: root,
        heartbeatIntervalMs: 5,
        normalizer: {
          async normalize() {
            entered();
            await finish;
            return {
              sizeBytes: 100,
              sha256: 'c'.repeat(64),
              originalSha256: 'b'.repeat(64),
              mimeType: 'audio/ogg',
              audioChannels: 1,
            };
          },
        },
      });
      const processing = handler(job, {
        heartbeat: async () => {
          if (leaseLost) return false;
          const renewed = await queue.heartbeat({
            jobId: job.id,
            attemptId: job.attemptId,
            workerId: 'synthetic-live-decoder',
            now: new Date(heartbeatNow),
            leaseMs: 1000,
          });
          if (!renewed) {
            leaseLost = true;
            markLeaseLost();
          }
          return renewed;
        },
      });
      await decoding;
      heartbeatNow = now + 2000;
      let result;
      try {
        await heartbeatLost;
        await queue.claim({
          workerId: 'synthetic-recovery',
          queue: 'chat_media',
          now: new Date(heartbeatNow),
        });
        assert.equal(
          (
            await pool.query('SELECT status FROM crm.outbox_jobs WHERE id=$1', [
              job.id,
            ])
          ).rows[0].status,
          'dead_letter',
        );
        await draftCleanup.runOnce();
        assert.deepEqual(effects, []);
        assert.equal((await snapshot()).reserved, String(reservation));
        await access(join(root, id));
      } finally {
        release();
        result = await processing;
      }
      assert.equal(result.outcome, 'failed');
      await draftCleanup.runOnce();
      assert.equal((await snapshot()).reserved, '0');
      assert.equal((await media(id)).state, 'lost');
      await assert.rejects(access(join(root, id)), { code: 'ENOENT' });
    },
  );
  test('T22/MED-15/27: rollback after external DELETE never restores bindable ready', async () => {
    const id = await ready();
    await age(id);
    const failing = {
      ...database,
      transaction: (/** @type {Function} */ work) =>
        database.transaction(async (/** @type {any} */ client) => {
          const query = client.query.bind(client);
          client.query = async (/** @type {any[]} */ ...args) => {
            if (
              String(args[0]).startsWith('UPDATE crm.chat_media_quotas') &&
              effects.some(([kind]) => kind === 'object')
            )
              throw new Error('synthetic SQL failure after DELETE');
            return query(...args);
          };
          try {
            return await work(client);
          } finally {
            client.query = query;
          }
        }),
    };
    await cleanup({ database: failing }).runOnce();
    assert.ok(effects.some(([kind]) => kind === 'object'));
    assert.equal((await media(id)).state, 'unavailable');
    assert.ok((await media(id)).cleanup_started_at);
    assert.equal((await snapshot()).reserved, '100');
    await assert.rejects(
      service().sendHumanMessage(command(id)),
      (/** @type {any} */ error) =>
        error.statusCode === 409 || error.code === 'MEDIA_NOT_READY',
    );
    assert.equal((await snapshot()).messages, 0);
    await cleanup().runOnce();
    assert.equal((await media(id)).state, 'lost');
    assert.equal((await snapshot()).reserved, '0');
  });
  test('T22/MED-27: old receiving admission keeps reservation until confirmed removal', async () => {
    const id = randomUUID();
    await upload.admit({
      id,
      actor,
      conversationId: 'bind-conversation',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      sessionHash: randomUUID(),
      reservationBytes: 1000,
    });
    await pool.query(
      `UPDATE crm.chat_media_admissions SET created_at=now()-interval '25 hours' WHERE id=$1`,
      [id],
    );
    await cleanup({
      removeFile: async () => {
        assert.equal((await snapshot()).reserved, '1000');
        throw new Error('synthetic file busy');
      },
    }).runOnce();
    assert.equal((await snapshot()).reserved, '1000');
    await cleanup().runOnce();
    assert.equal((await snapshot()).reserved, '0');
    assert.equal(
      (
        await pool.query(
          'SELECT state FROM crm.chat_media_admissions WHERE id=$1',
          [id],
        )
      ).rows[0].state,
      'cleaned',
    );
    assert.deepEqual(effects, [
      ['spool', join(resolve('/synthetic-spool'), id)],
    ]);
  });
  test('T22/MED-27: writer lease survives age manipulation and excludes orphan cleanup', async () => {
    const id = randomUUID();
    /** @type {() => void} */ let release = () => {};
    /** @type {() => void} */ let entered = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const locked = new Promise((resolve) => {
      entered = () => resolve(undefined);
    });
    await upload.admit({
      id,
      actor,
      conversationId: 'bind-conversation',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      sessionHash: randomUUID(),
      reservationBytes: 1000,
    });
    const writer = upload.withUploadLease(id, async () => {
      await pool.query(
        `UPDATE crm.chat_media_admissions SET created_at=now()-interval '25 hours' WHERE id=$1`,
        [id],
      );
      entered();
      await gate;
    });
    await locked;
    await cleanup().runOnce();
    assert.deepEqual(effects, []);
    assert.equal((await snapshot()).reserved, '1000');
    release();
    await writer;
    await cleanup().runOnce();
    assert.equal((await snapshot()).reserved, '0');
    assert.equal(effects.length, 1);
  });
  test('T22/MED-27: durable deadline protects old cleanup intent after session guard is gone', async () => {
    const id = await ready();
    await age(id);
    await pool.query(
      `UPDATE crm.chat_media SET cleanup_started_at=now(),state='unavailable',sanitized_reason='processing_failed',processing_guard_until=now()+interval '15 minutes' WHERE id=$1`,
      [id],
    );
    await pool.query(
      `UPDATE crm.outbox_jobs SET status='completed',completed_at=now() WHERE chat_media_id=$1`,
      [id],
    );
    await cleanup().runOnce();
    assert.deepEqual(effects, []);
    assert.equal((await snapshot()).reserved, '100');
    await pool.query(
      `UPDATE crm.chat_media SET processing_guard_until=now()-interval '1 second' WHERE id=$1`,
      [id],
    );
    await cleanup().runOnce();
    assert.equal((await snapshot()).reserved, '0');
    assert.equal((await media(id)).state, 'lost');
  });
  test('T22/MED-27: cleanup intent cannot be reclaimed or have its durable guard cleared', async () => {
    const id = await ready();
    const queue = new PostgresJobQueue({ database });
    const [job] = await queue.claim({
      workerId: 'synthetic-stale-process',
      queue: 'chat_media',
      now: new Date(Date.now() + 1000),
    });
    await pool.query(
      `UPDATE crm.chat_media SET cleanup_started_at=now(),state='unavailable',sanitized_reason='processing_failed',processing_guard_until=now()+interval '15 minutes' WHERE id=$1`,
      [id],
    );
    const before = (await media(id)).processing_guard_until.toISOString();
    const repository = new PostgresChatMediaRepository({ database });
    assert.equal(
      await repository.withProcessingLease(id, () => repository.acquire(job)),
      null,
    );
    const row = await media(id);
    assert.equal(row.state, 'unavailable');
    assert.equal(row.processing_guard_until.toISOString(), before);
    assert.equal(row.reservation_bytes, '100');
  });
  test('T22/MED-27: durable admission deadline prevents deletion after advisory connection disappeared', async () => {
    const id = randomUUID();
    await upload.admit({
      id,
      actor,
      conversationId: 'bind-conversation',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      sessionHash: randomUUID(),
      reservationBytes: 1000,
    });
    await pool.query(
      `UPDATE crm.chat_media_admissions SET created_at=now()-interval '25 hours',writer_guard_until=now()+interval '3 minutes' WHERE id=$1`,
      [id],
    );
    await cleanup().runOnce();
    assert.deepEqual(effects, []);
    assert.equal((await snapshot()).reserved, '1000');
    await pool.query(
      `UPDATE crm.chat_media_admissions SET writer_guard_until=now()-interval '1 second' WHERE id=$1`,
      [id],
    );
    await cleanup().runOnce();
    assert.equal((await snapshot()).reserved, '0');
    assert.equal(effects.length, 1);
  });
  for (const failing of [false, true])
    test(`T22/MED-27: crash intermediate ownership ${failing ? 'preserves charge on rm failure' : 'cleans only matching UUID'}`, async (t) => {
      const id = await ready();
      await age(id);
      const key = (await media(id)).object_key;
      await pool.query(
        `UPDATE crm.chat_media SET kind='audio',origin='recording',detected_mime_type='audio/ogg' WHERE id=$1`,
        [id],
      );
      const root = await mkdtemp(join(tmpdir(), 'crm-crash-intermediate-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const own = join(root, `.recording-${key}-ABC123`);
      const other = join(root, `.recording-${randomUUID()}-ABC123`);
      const unknown = join(root, '.recording-unattributed-ABC123');
      for (const directory of [own, other, unknown]) {
        await mkdir(directory);
        await writeFile(
          join(directory, 'variant.ogg'),
          Buffer.from('synthetic intermediate'),
        );
      }
      await writeFile(join(root, id), Buffer.alloc(100));
      await writeFile(join(root, key), Buffer.alloc(100));
      const worker = cleanup({
        spoolRoot: root,
        removeFile: (/** @type {string} */ path) => rm(path, { force: true }),
        ...(failing
          ? {
              removeDirectory: async () => {
                throw new Error('synthetic directory busy');
              },
            }
          : {}),
      });
      await worker.runOnce();
      if (failing) {
        assert.equal((await snapshot()).reserved, '100');
        assert.equal((await media(id)).state, 'unavailable');
        assert.equal(
          await readFile(join(own, 'variant.ogg'), 'utf8'),
          'synthetic intermediate',
        );
        assert.deepEqual(effects, []);
        await cleanup({
          spoolRoot: root,
          removeFile: (/** @type {string} */ path) => rm(path, { force: true }),
        }).runOnce();
      }
      await assert.rejects(access(own), { code: 'ENOENT' });
      assert.equal((await snapshot()).reserved, '0');
      assert.equal(
        await readFile(join(other, 'variant.ogg'), 'utf8'),
        'synthetic intermediate',
      );
      assert.equal(
        await readFile(join(unknown, 'variant.ogg'), 'utf8'),
        'synthetic intermediate',
      );
      assert.equal((await media(id)).state, 'lost');
    });
  test(
    'T22/MED-27: single-connection pool completes concurrent uploads without lease starvation',
    { timeout: 5000 },
    async (t) => {
      const single = createDatabase({ connectionString, max: 1 });
      const root = await mkdtemp(join(tmpdir(), 'crm-single-upload-'));
      t.after(async () => {
        await single.close();
        await rm(root, { recursive: true, force: true });
      });
      const runtime = createChatMediaApiRuntime({
        repository: new PostgresChatMediaUploadRepository({ database: single }),
        access: {},
        spoolRoot: root,
        envelopeKey: KEY,
      });
      const results = await Promise.all(
        [1, 2].map(() =>
          runtime.upload({
            stream: Readable.from(Buffer.from('synthetic bytes')),
            finishMultipart: async () => {},
            kind: 'image',
            origin: 'attachment',
            declaredMimeType: 'image/png',
            filename: 'synthetic.png',
            conversationId: 'bind-conversation',
            expectedVersion: 1,
            actor,
            sessionHash: randomUUID(),
            idempotencyKey: randomUUID(),
          }),
        ),
      );
      assert.equal(new Set(results.map((row) => row.mediaId)).size, 2);
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM crm.outbox_jobs'))
          .rows[0].count,
        2,
      );
      assert.equal(
        (await snapshot()).reserved,
        String(4 * Buffer.byteLength('synthetic bytes')),
      );
    },
  );
  test(
    'T22/MED-27: terminated writer session aborts the file and leaves no reusable locked client',
    { timeout: 5000 },
    async (t) => {
      const applicationName = `synthetic-media-lease-${randomUUID()}`;
      const single = createDatabase({
        connectionString,
        max: 1,
        applicationName,
      });
      const root = await mkdtemp(join(tmpdir(), 'crm-lost-writer-'));
      t.after(async () => {
        await single.close();
        await rm(root, { recursive: true, force: true });
      });
      const stream = new Readable({ read() {} });
      stream.push(Buffer.from('synthetic partial'));
      /** @type {() => void} */ let entered = () => {};
      const running = new Promise((resolve) => {
        entered = () => resolve(undefined);
      });
      const repository = new PostgresChatMediaUploadRepository({
        database: single,
      });
      const withLease = repository.withUploadLease.bind(repository);
      repository.withUploadLease = (id, work) =>
        withLease(id, (/** @type {AbortSignal} */ signal) => {
          entered();
          return work(signal);
        });
      const runtime = createChatMediaApiRuntime({
        repository,
        access: {},
        spoolRoot: root,
        envelopeKey: KEY,
        uploadTimeoutMs: 2000,
      });
      const uploadPromise = runtime.upload({
        stream,
        finishMultipart: () => new Promise(() => {}),
        kind: 'image',
        origin: 'attachment',
        declaredMimeType: 'image/png',
        filename: 'synthetic.png',
        conversationId: 'bind-conversation',
        expectedVersion: 1,
        actor,
        sessionHash: randomUUID(),
        idempotencyKey: randomUUID(),
      });
      const rejected = assert.rejects(
        uploadPromise,
        (/** @type {any} */ error) => error.statusCode === 503,
      );
      await running;
      await pool.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1',
        [applicationName],
      );
      await rejected;
      assert.equal(stream.destroyed, true);
      assert.equal((await snapshot()).reserved, '0');
      assert.equal(
        (await single.query('SELECT 1 AS healthy')).rows[0].healthy,
        1,
      );
    },
  );
}

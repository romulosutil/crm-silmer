import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresChatMediaRepository } from '../modules/integration-reliability/src/postgres-chat-media-repository.js';
import { PostgresJobQueue } from '../modules/integration-reliability/src/postgres-job-queue.js';
import { createChatMediaProcessJobHandler } from '../modules/integration-reliability/src/chat-media-process-worker.js';
import { ChatMediaValidationError } from '../modules/integration-reliability/src/chat-media-validation.js';
import {
  MediaObjectMissingError,
  RustfsMediaStore,
} from '../modules/integration-reliability/src/rustfs-media-store.js';
import { WorkerRuntime } from '../apps/worker/src/worker.js';

const execute = promisify(execFile);
const connectionString = process.env.TEST_DATABASE_URL;
const BYTES = Buffer.from('synthetic');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const METADATA = {
  sizeBytes: BYTES.length,
  sha256: SHA,
  originalSha256: SHA,
  mimeType: 'image/png',
  container: 'png_pipe',
  audioCodec: null,
  videoCodec: 'png',
  durationMs: null,
};
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 9), iv);
const encrypted = Buffer.concat([
  cipher.update('synthetic.png'),
  cipher.final(),
]);
const envelope = {
  algorithm: 'AES-256-GCM',
  keyVersion: 1,
  version: 1,
  iv: iv.toString('base64url'),
  tag: cipher.getAuthTag().toString('base64url'),
  ciphertext: encrypted.toString('base64url'),
};

if (connectionString) {
  const pool = new Pool({ connectionString, max: 4 });
  const database = {
    query: pool.query.bind(pool),
    /** @param {(client: import('pg').PoolClient) => Promise<any>} work */
    transaction: (work) => withTransaction(pool, work),
  };
  const repository = new PostgresChatMediaRepository({ database });
  const queue = new PostgresJobQueue({
    database,
    retryBaseMs: 1,
    random: () => 0.5,
  });
  before(async () => {
    assert.equal(
      new URL(connectionString).pathname,
      '/crm_silmer_test',
      'dedicated synthetic database only',
    );
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    await pool.query(
      `INSERT INTO crm.users(id,email,password_hash,name) VALUES('process-seller','process@example.test','$argon2id$synthetic','Synthetic')`,
    );
    await pool.query(
      `INSERT INTO crm.contacts(id,created_at,updated_at) VALUES('process-contact',now(),now())`,
    );
    await pool.query(
      `INSERT INTO crm.contact_identities(id,current_contact_id,provider,provider_account_id,channel,external_identity_lookup_hash,identity_kind,phone_status,identity_envelope,created_at,updated_at) VALUES('process-identity','process-contact','meta','synthetic','whatsapp',$1,'phone','confirmed',$2,now(),now())`,
      ['a'.repeat(64), envelope],
    );
    await pool.query(
      `INSERT INTO crm.conversations(id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,opened_at,last_message_at) VALUES('process-conversation','process-identity','meta','synthetic','synthetic',1,now(),now())`,
    );
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE crm.chat_media,crm.chat_media_quotas,crm.outbox_jobs,crm.processing_attempts CASCADE',
    );
    await pool.query(
      `INSERT INTO crm.chat_media_quotas(bucket_alias,limit_bytes) VALUES('chat-dev',1073741824)`,
    );
  });
  after(async () => {
    await pool.end();
  });

  /** @param {{kind?: string,origin?: string,size?: number,declaredMime?: string}} [options] */
  async function seed(options = {}) {
    const id = randomUUID();
    const object = randomUUID();
    const source = randomUUID();
    const size = options.size ?? BYTES.length;
    const reservation =
      options.origin === 'recording' ? size + 2 * 16 * 1024 * 1024 : 2 * size;
    await pool.query(
      `INSERT INTO crm.chat_media(id,conversation_id,uploaded_by,upload_command_id,request_fingerprint,kind,origin,filename_envelope,storage_bucket_alias,input_size_bytes,reservation_bytes,object_key,spool_key,declared_mime_type)
      VALUES($1,'process-conversation','process-seller',$2,$3,$4,$5,$6,'chat-dev',$7,$8,$9,$10,$11)`,
      [
        id,
        randomUUID(),
        'b'.repeat(64),
        options.kind ?? 'image',
        options.origin ?? 'attachment',
        envelope,
        size,
        reservation,
        object,
        source,
        options.declaredMime ?? 'image/png',
      ],
    );
    await pool.query(
      `UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes+$1 WHERE bucket_alias='chat-dev'`,
      [reservation],
    );
    const job = randomUUID();
    await pool.query(
      `INSERT INTO crm.outbox_jobs(id,job_type,idempotency_key,chat_media_id,queue,effect_policy,status,available_at,created_at,updated_at)
      VALUES($1,'chat_media.process',$2,$3,'chat_media','internal','pending',now(),now(),now())`,
      [job, randomUUID(), id],
    );
    return { id, object, source, job, reservation };
  }
  async function claim() {
    return (
      await queue.claim({
        workerId: 'synthetic-process',
        queue: 'chat_media',
        leaseMs: 30000,
      })
    )[0];
  }
  /** @param {string} id */
  async function media(id) {
    return (await pool.query('SELECT * FROM crm.chat_media WHERE id=$1', [id]))
      .rows[0];
  }
  async function quota() {
    return (
      await pool.query(
        `SELECT * FROM crm.chat_media_quotas WHERE bucket_alias='chat-dev'`,
      )
    ).rows[0];
  }
  /** @param {{cleanupFailure?: boolean,mismatch?: Record<string,any>,validationReason?: string}} [options] */
  async function fixture(options = {}) {
    await mkdir(resolve('var/tooling'), { recursive: true });
    const root = await mkdtemp(resolve('var/tooling/crm-process-live-'));
    const seeded = await seed();
    await writeFile(join(root, seeded.source), BYTES);
    /** @type {Map<string,any>} */ const objects = new Map();
    const calls = { puts: 0, validations: 0 };
    const store = {
      /** @param {string} key */ async head(key) {
        if (options.mismatch) return { ...METADATA, ...options.mismatch };
        if (!objects.has(key)) throw new MediaObjectMissingError();
        return objects.get(key);
      },
      /** @param {{key: string,stream: AsyncIterable<Uint8Array>}} input */ async putValidated(
        input,
      ) {
        const chunks = [];
        for await (const chunk of input.stream) chunks.push(Buffer.from(chunk));
        assert.deepEqual(Buffer.concat(chunks), BYTES);
        calls.puts++;
        objects.set(input.key, METADATA);
      },
    };
    const handler = createChatMediaProcessJobHandler({
      repository,
      store,
      spoolRoot: root,
      validator: {
        async validate() {
          calls.validations++;
          if (options.validationReason)
            throw new ChatMediaValidationError(options.validationReason);
          return { ...METADATA };
        },
      },
      removeFile: options.cleanupFailure
        ? async () => {
            throw new Error('synthetic cleanup failure');
          }
        : undefined,
    });
    const runtime = new WorkerRuntime({
      queue,
      queueName: 'chat_media',
      workerId: 'synthetic-process',
      handlers: { 'chat_media.process': handler },
    });
    return {
      root,
      seeded,
      objects,
      calls,
      store,
      handler,
      runtime,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  }

  test('T6 migration preserves declaration separately and is replay safe', async () => {
    assert.deepEqual(
      await migrate(pool, { migrations: await loadMigrations() }),
      { applied: [], phase: 'expand' },
    );
    const seeded = await seed();
    const row = await media(seeded.id);
    assert.equal(row.declared_mime_type, 'image/png');
    assert.equal(row.detected_mime_type, null);
    await assert.rejects(
      pool.query(
        'UPDATE crm.chat_media SET declared_mime_type=$2 WHERE id=$1',
        [seeded.id, 'x'.repeat(256)],
      ),
      (error) => /** @type {any} */ (error).code === '23514',
    );
  });
  test('T6 queue claim loads chat media ID and internal effect policy', async () => {
    const seeded = await seed();
    const job = await claim();
    assert.equal(job.chatMediaId, seeded.id);
    assert.equal(job.effectPolicy, 'internal');
    assert.equal(job.jobType, 'chat_media.process');
    await assert.rejects(
      pool.query('UPDATE crm.outbox_jobs SET queue=$2 WHERE id=$1', [
        seeded.job,
        'default',
      ]),
      (error) =>
        /** @type {any} */ (error).constraint ===
        'outbox_jobs_chat_media_policy_check',
    );
    await assert.rejects(
      pool.query('UPDATE crm.outbox_jobs SET effect_policy=$2 WHERE id=$1', [
        seeded.job,
        'manual',
      ]),
      (error) =>
        /** @type {any} */ (error).constraint ===
        'outbox_jobs_chat_media_policy_check',
    );
  });
  test('T6 concurrent acquire fences same attempt and CAS rejects stale metadata', async () => {
    const seeded = await seed();
    const job = await claim();
    const results = await Promise.all([
      repository.acquire(job),
      repository.acquire(job),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const row = results.find(Boolean);
    assert.equal(
      await repository.prepare(
        job,
        { ...row, version: Number(row.version) - 1 },
        METADATA,
      ),
      null,
    );
    assert.equal((await media(seeded.id)).content_sha256, null);
  });
  test('T6 ready keeps final bytes reserved, used unchanged, job completes without sending effect', async () => {
    const f = await fixture();
    try {
      assert.equal(await f.runtime.runOnce(), 1);
      const row = await media(f.seeded.id);
      const counter = await quota();
      assert.equal(row.state, 'ready');
      assert.equal(Number(row.reservation_bytes), BYTES.length);
      assert.equal(Number(counter.reserved_bytes), BYTES.length);
      assert.equal(Number(counter.used_bytes), 0);
      assert.equal(f.calls.puts, 1);
      assert.deepEqual(await readdir(f.root), []);
      const attempt = (
        await pool.query(
          'SELECT state,effect_started_at FROM crm.processing_attempts',
        )
      ).rows[0];
      assert.equal(attempt.state, 'sent');
      assert.equal(attempt.effect_started_at, null);
    } finally {
      await f.cleanup();
    }
  });
  test('T6 crash ready transaction after PUT rolls back counters, new attempt reconciles without spool or second PUT', async () => {
    const f = await fixture();
    try {
      await pool.query(
        `CREATE FUNCTION crm.synthetic_fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='ready' THEN RAISE EXCEPTION 'synthetic ready failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        'CREATE TRIGGER synthetic_fail_ready BEFORE UPDATE ON crm.chat_media FOR EACH ROW EXECUTE FUNCTION crm.synthetic_fail_ready()',
      );
      await f.runtime.runOnce();
      assert.equal(
        Number((await quota()).reserved_bytes),
        f.seeded.reservation,
      );
      assert.equal((await media(f.seeded.id)).content_sha256, SHA);
      assert.deepEqual(await readdir(f.root), []);
      assert.equal(f.calls.puts, 1);
      await pool.query('DROP TRIGGER synthetic_fail_ready ON crm.chat_media');
      await new Promise((done) => setTimeout(done, 5));
      const validationCalls = f.calls.validations;
      await f.runtime.runOnce();
      assert.equal((await media(f.seeded.id)).state, 'ready');
      assert.equal(f.calls.puts, 1);
      assert.equal(f.calls.validations, validationCalls);
      assert.equal(Number((await quota()).reserved_bytes), BYTES.length);
      assert.equal(Number((await quota()).used_bytes), 0);
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::integer AS count FROM crm.processing_attempts',
          )
        ).rows[0].count,
        2,
      );
    } finally {
      await pool.query(
        'DROP TRIGGER IF EXISTS synthetic_fail_ready ON crm.chat_media',
      );
      await pool.query('DROP FUNCTION IF EXISTS crm.synthetic_fail_ready()');
      await f.cleanup();
    }
  });
  test('T6 cleanup failure holds full reservation and successful retry reuses object', async () => {
    const f = await fixture({ cleanupFailure: true });
    try {
      await f.runtime.runOnce();
      assert.equal((await media(f.seeded.id)).state, 'unavailable');
      assert.equal(
        Number((await quota()).reserved_bytes),
        f.seeded.reservation,
      );
      assert.equal(f.calls.puts, 1);
      const handler = createChatMediaProcessJobHandler({
        repository,
        store: f.store,
        spoolRoot: f.root,
      });
      const runtime = new WorkerRuntime({
        queue,
        queueName: 'chat_media',
        workerId: 'synthetic-process',
        handlers: { 'chat_media.process': handler },
      });
      await new Promise((done) => setTimeout(done, 5));
      await runtime.runOnce();
      assert.equal((await media(f.seeded.id)).state, 'ready');
      assert.equal(f.calls.puts, 1);
      assert.deepEqual(await readdir(f.root), []);
      assert.equal(Number((await quota()).reserved_bytes), BYTES.length);
    } finally {
      await f.cleanup();
    }
  });
  for (const mismatch of [
    { sha256: 'f'.repeat(64) },
    { mimeType: 'image/jpeg' },
    { sizeBytes: BYTES.length + 1 },
  ]) {
    test(`T6 divergent HEAD ${Object.keys(mismatch)[0]} never overwrites or releases reservation`, async () => {
      const f = await fixture({ mismatch });
      try {
        await f.runtime.runOnce();
        assert.equal((await media(f.seeded.id)).state, 'unavailable');
        assert.equal(f.calls.puts, 0);
        assert.equal(
          Number((await quota()).reserved_bytes),
          f.seeded.reservation,
        );
      } finally {
        await f.cleanup();
      }
    });
  }
  test('T6 infected upload is terminal rejected with reservation held until cleanup task', async () => {
    const f = await fixture({ validationReason: 'infected' });
    try {
      await f.runtime.runOnce();
      const row = await media(f.seeded.id);
      assert.equal(row.state, 'rejected');
      assert.equal(row.validation_status, 'infected');
      assert.equal(f.calls.puts, 0);
      assert.equal(
        Number((await quota()).reserved_bytes),
        f.seeded.reservation,
      );
    } finally {
      await f.cleanup();
    }
  });
  for (const failMode of ['throw', 'cas']) {
    test(`T6 rejection persistence ${failMode} retries same record to rejected without early ACK`, async () => {
      const f = await fixture({ validationReason: 'invalid_format' });
      let failed = false;
      const rejectionRepository = {
        acquire: repository.acquire.bind(repository),
        prepare: repository.prepare.bind(repository),
        ready: repository.ready.bind(repository),
        /** @param {Record<string,any>} job @param {Record<string,any>} row @param {string} reason */
        async fail(job, row, reason) {
          if (!failed) {
            failed = true;
            if (failMode === 'throw')
              throw new Error('synthetic DB unavailable');
            return false;
          }
          return repository.fail(job, row, reason);
        },
      };
      const handler = createChatMediaProcessJobHandler({
        repository: rejectionRepository,
        store: f.store,
        spoolRoot: f.root,
        validator: {
          async validate() {
            throw new ChatMediaValidationError('invalid_format');
          },
        },
      });
      const runtime = new WorkerRuntime({
        queue,
        queueName: 'chat_media',
        workerId: 'synthetic-process',
        handlers: { 'chat_media.process': handler },
      });
      try {
        await runtime.runOnce();
        assert.equal((await media(f.seeded.id)).state, 'processing');
        assert.equal(
          (
            await pool.query('SELECT status FROM crm.outbox_jobs WHERE id=$1', [
              f.seeded.job,
            ])
          ).rows[0].status,
          'retry',
        );
        assert.equal(
          Number((await quota()).reserved_bytes),
          f.seeded.reservation,
        );
        await new Promise((done) => setTimeout(done, 5));
        await runtime.runOnce();
        assert.equal((await media(f.seeded.id)).state, 'rejected');
        assert.equal(
          (await media(f.seeded.id)).sanitized_reason,
          'invalid_format',
        );
        assert.equal(
          (
            await pool.query('SELECT status FROM crm.outbox_jobs WHERE id=$1', [
              f.seeded.job,
            ])
          ).rows[0].status,
          'completed',
        );
        assert.equal(f.calls.puts, 0);
        assert.equal(
          Number((await quota()).reserved_bytes),
          f.seeded.reservation,
        );
      } finally {
        await f.cleanup();
      }
    });
  }

  test('T6 expired attempt is fenced while recovered internal attempt can reuse prepared metadata', async () => {
    const seeded = await seed();
    const first = await claim();
    const row = await repository.acquire(first);
    const prepared = await repository.prepare(first, row, METADATA);
    await pool.query(
      `UPDATE crm.outbox_jobs SET locked_until=now()-interval '1 second' WHERE id=$1`,
      [seeded.job],
    );
    assert.equal(await repository.ready(first, prepared), null);
    const second = await claim();
    assert.notEqual(second.attemptId, first.attemptId);
    assert.equal(await repository.acquire(first), null);
    const recovered = await repository.acquire(second);
    assert.equal(recovered.content_sha256, SHA);
    assert.equal(
      (
        await pool.query(
          'SELECT state FROM crm.processing_attempts WHERE id=$1',
          [first.attemptId],
        )
      ).rows[0].state,
      'failed',
    );
  });

  if (process.env.RUN_RUSTFS_LIVE_SMOKE === 'yes') {
    test('T6 actual SQL + ClamAV/FFmpeg + SDK RustFS process PNG and Chromium recording to ready', async () => {
      assert.equal(process.env.MEDIA_S3_BUCKET, 'crm-silmer-chat-media-dev');
      const container =
        process.env.CHAT_MEDIA_RUNTIME_CONTAINER ??
        'crm-silmer-media-test-tooling';
      assert.match(container, /^crm-silmer-media-test-[a-z0-9-]+$/u);
      const store = new RustfsMediaStore({
        bucket: process.env.MEDIA_S3_BUCKET,
        endpoint: process.env.MEDIA_S3_ENDPOINT,
        region: process.env.MEDIA_S3_REGION,
        accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
      });
      await mkdir(resolve('var/tooling'), { recursive: true });
      const root = await mkdtemp(resolve('var/tooling/crm-process-runtime-'));
      /** @param {string} path */ const inside = (path) =>
        '/workspace/' + relative(resolve('.'), path).replaceAll('\\', '/');
      /** @param {'validate'|'normalize'} mode @param {Record<string,any>} input */
      const runtimeOperation = async (mode, input) =>
        JSON.parse(
          String(
            (
              await execute(
                'docker',
                [
                  'exec',
                  '-e',
                  'CHAT_MEDIA_USE_BUILT_RUNTIME=' +
                    (process.env.CHAT_MEDIA_USE_BUILT_RUNTIME ?? 'no'),
                  container,
                  'node',
                  '/workspace/test/helpers/chat-media-runtime.mjs',
                  mode,
                  JSON.stringify({
                    ...input,
                    path: inside(input.path),
                    ...(input.outputPath
                      ? { outputPath: inside(input.outputPath) }
                      : {}),
                  }),
                ],
                { timeout: 360000, maxBuffer: 65536 },
              )
            ).stdout,
          ),
        );
      try {
        for (const recording of [false, true]) {
          await pool.query(
            'TRUNCATE crm.chat_media,crm.chat_media_quotas,crm.outbox_jobs,crm.processing_attempts CASCADE',
          );
          await pool.query(
            `INSERT INTO crm.chat_media_quotas(bucket_alias,limit_bytes) VALUES('chat-dev',1073741824)`,
          );
          const input = join(root, 'synthetic-input');
          if (recording)
            await writeFile(
              input,
              await readFile(
                resolve('var/tooling/chromium-media-recorder.webm'),
              ),
            );
          else
            await execute(
              'docker',
              [
                'exec',
                container,
                'ffmpeg',
                '-v',
                'error',
                '-y',
                '-f',
                'lavfi',
                '-i',
                'color=c=white:s=16x16',
                '-frames:v',
                '1',
                '-threads',
                '1',
                '-f',
                'image2',
                '-c:v',
                'png',
                inside(input),
              ],
              { timeout: 30000, maxBuffer: 65536 },
            );
          const bytes = await readFile(input);
          const seeded = await seed({
            kind: recording ? 'audio' : 'image',
            origin: recording ? 'recording' : 'attachment',
            size: bytes.length,
            declaredMime: recording ? 'audio/webm;codecs=opus' : 'image/png',
          });
          await writeFile(join(root, seeded.source), bytes);
          await rm(input);
          const handler = createChatMediaProcessJobHandler({
            repository,
            store,
            spoolRoot: root,
            validator: {
              validate: (/** @type {Record<string,any>} */ input) =>
                runtimeOperation('validate', input),
            },
            normalizer: {
              normalize: (/** @type {Record<string,any>} */ input) =>
                runtimeOperation('normalize', input),
            },
          });
          const runtime = new WorkerRuntime({
            queue,
            queueName: 'chat_media',
            workerId: 'synthetic-process',
            handlers: { 'chat_media.process': handler },
          });
          try {
            assert.equal(await runtime.runOnce(), 1);
            const row = await media(seeded.id);
            assert.equal(row.state, 'ready');
            assert.equal(
              row.original_sha256,
              createHash('sha256').update(bytes).digest('hex'),
            );
            const stored = await store.head(seeded.object);
            assert.equal(stored.sha256, row.content_sha256);
            assert.equal(stored.sizeBytes, Number(row.size_bytes));
            assert.equal(
              Number((await quota()).reserved_bytes),
              stored.sizeBytes,
            );
            assert.equal(Number((await quota()).used_bytes), 0);
            assert.equal(
              row.detected_mime_type,
              recording ? 'audio/ogg' : 'image/png',
            );
            assert.deepEqual(await readdir(root), []);
          } finally {
            await store.deleteDraft(seeded.object);
          }
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
  test('T6/MED-19: admitted hash mismatch rejects equal-size spool without PUT or ready', async () => {
    const f = await fixture();
    try {
      const admittedSha = createHash('sha256')
        .update(Buffer.from('different'))
        .digest('hex');
      assert.equal(Buffer.byteLength('different'), BYTES.length);
      await pool.query(
        'UPDATE crm.chat_media SET original_sha256=$2 WHERE id=$1',
        [f.seeded.id, admittedSha],
      );
      const reserved = Number((await quota()).reserved_bytes);
      assert.equal(await f.runtime.runOnce(), 1);
      const row = await media(f.seeded.id);
      assert.equal(row.original_sha256, admittedSha);
      assert.equal(row.content_sha256, null);
      assert.equal(row.state, 'rejected');
      assert.equal(row.sanitized_reason, 'invalid_format');
      assert.equal(f.calls.puts, 0);
      assert.equal(Number((await quota()).reserved_bytes), reserved);
      assert.equal(Number((await quota()).used_bytes), 0);
    } finally {
      await f.cleanup();
    }
  });
  test('T6/MED-19: prepare cannot replace admitted original SHA or immutable prepared variant', async () => {
    const seeded = await seed();
    await pool.query(
      'UPDATE crm.chat_media SET original_sha256=$2 WHERE id=$1',
      [seeded.id, SHA],
    );
    const job = await claim();
    const row = await repository.acquire(job);
    assert.equal(
      await repository.prepare(job, row, {
        ...METADATA,
        originalSha256: 'd'.repeat(64),
      }),
      null,
    );
    assert.equal((await media(seeded.id)).original_sha256, SHA);
    assert.equal((await media(seeded.id)).content_sha256, null);
    const prepared = await repository.prepare(job, row, METADATA);
    assert.equal(prepared.original_sha256, SHA);
    assert.equal(prepared.content_sha256, SHA);
    assert.equal(
      await repository.prepare(job, prepared, {
        ...METADATA,
        sha256: 'd'.repeat(64),
      }),
      null,
    );
    assert.equal((await media(seeded.id)).content_sha256, SHA);
  });
}

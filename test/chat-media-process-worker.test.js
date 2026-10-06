import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createChatMediaProcessJobHandler } from '../modules/integration-reliability/src/chat-media-process-worker.js';
import { ChatMediaValidationError } from '../modules/integration-reliability/src/chat-media-validation.js';
import {
  MediaObjectMissingError,
  MediaStorageUnavailableError,
} from '../modules/integration-reliability/src/rustfs-media-store.js';

const BYTES = Buffer.from('synthetic');
const SHA = createHash('sha256').update(BYTES).digest('hex');
/** @param {{recording?: boolean,validationReason?: string,putFailure?: boolean,dbFailure?: boolean,headExisting?: boolean,leaseLost?: boolean,cleanupFailure?: boolean,delayed?: boolean,reservation?: number,bucketAlias?: string,failFailure?: boolean,failCas?: boolean}} [options] */
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'crm-process-'));
  const source = randomUUID();
  const key = randomUUID();
  await writeFile(join(root, source), BYTES);
  const metadata = {
    sizeBytes: BYTES.length,
    sha256: SHA,
    mimeType: options.recording ? 'audio/ogg' : 'image/png',
    container: 'synthetic',
    audioCodec: options.recording ? 'opus' : null,
    audioChannels: options.recording ? 1 : null,
    videoCodec: options.recording ? null : 'png',
    durationMs: options.recording ? 1000 : null,
  };
  let row = {
    id: randomUUID(),
    object_key: key,
    spool_key: source,
    storage_bucket_alias: options.bucketAlias ?? 'chat-dev',
    declared_mime_type: options.recording ? 'audio/webm' : 'image/png',
    kind: options.recording ? 'audio' : 'image',
    origin: options.recording ? 'recording' : 'attachment',
    input_size_bytes: BYTES.length,
    reservation_bytes:
      options.reservation ??
      (options.recording
        ? 2 * 16 * 1024 * 1024 + BYTES.length
        : 2 * BYTES.length),
    state: 'uploaded',
    version: 1,
    content_sha256: options.headExisting ? SHA : null,
    size_bytes: options.headExisting ? BYTES.length : null,
    detected_mime_type: options.headExisting ? metadata.mimeType : null,
    original_sha256: options.headExisting ? SHA : null,
  };
  const calls = {
    puts: 0,
    prepared: 0,
    normalized: 0,
    ready: 0,
    heartbeats: 0,
    failures: /** @type {string[]} */ ([]),
  };
  const repository = {
    async acquire() {
      if (row.state === 'ready') return row;
      row = { ...row, state: 'processing', version: row.version + 1 };
      return row;
    },
    /** @param {any} _job @param {any} _row @param {any} input */
    async prepare(_job, _row, input) {
      calls.prepared++;
      row = {
        ...row,
        content_sha256: input.sha256,
        size_bytes: input.sizeBytes,
        detected_mime_type: input.mimeType,
        original_sha256: input.originalSha256,
        version: row.version + 1,
      };
      return row;
    },
    async ready() {
      calls.ready++;
      assert.deepEqual(await readdir(root), []);
      if (options.dbFailure) throw new Error('private database detail');
      row = { ...row, state: 'ready', reservation_bytes: BYTES.length };
      return true;
    },
    /** @param {any} _job @param {any} _row @param {string} reason */
    async fail(_job, _row, reason) {
      calls.failures.push(reason);
      if (options.failFailure) throw new Error('private database detail');
      return !options.failCas;
    },
  };
  const store = {
    async head() {
      if (!options.headExisting && calls.puts === 0)
        throw new MediaObjectMissingError();
      return {
        sizeBytes: BYTES.length,
        sha256: SHA,
        mimeType: metadata.mimeType,
      };
    },
    /** @param {{stream: AsyncIterable<Uint8Array>}} input */
    async putValidated({ stream }) {
      assert.ok(row.content_sha256, 'prepared metadata must precede PUT');
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.deepEqual(Buffer.concat(chunks), BYTES);
      calls.puts++;
      if (options.putFailure) throw new MediaStorageUnavailableError();
    },
  };
  const handler = createChatMediaProcessJobHandler({
    repository,
    store,
    spoolRoot: root,
    heartbeatIntervalMs: 5,
    validator: {
      async validate() {
        if (options.validationReason)
          throw new ChatMediaValidationError(options.validationReason);
        if (options.delayed)
          await new Promise((resolve) => setTimeout(resolve, 30));
        return metadata;
      },
    },
    normalizer: {
      /** @param {{outputPath: string}} input */
      async normalize({ outputPath }) {
        calls.normalized++;
        await writeFile(outputPath, BYTES);
        return { ...metadata, path: outputPath, originalSha256: SHA };
      },
    },
    removeFile: options.cleanupFailure
      ? async () => {
          throw new Error('private spool detail');
        }
      : undefined,
  });
  const job = {
    id: randomUUID(),
    attemptId: randomUUID(),
    chatMediaId: row.id,
  };
  const context = {
    async heartbeat() {
      calls.heartbeats++;
      return !options.leaseLost;
    },
    async markEffectStarted() {
      assert.fail('internal idempotent PUT never changes Meta effect policy');
    },
  };
  return {
    handler,
    job,
    context,
    calls,
    root,
    row: () => row,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('T6 validates, prepares before PUT, confirms HEAD, cleans spool and publishes ready once', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.equal(f.calls.puts, 1);
    assert.equal(f.calls.ready, 1);
    assert.equal(f.row().reservation_bytes, BYTES.length);
  } finally {
    await f.cleanup();
  }
});
test('T6 recording produces one persisted variant before upload', async () => {
  const f = await fixture({ recording: true });
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.equal(f.calls.normalized, 1);
    assert.equal(f.calls.prepared, 1);
  } finally {
    await f.cleanup();
  }
});
test('T6 persisted metadata and existing object reconcile without normalization or PUT', async () => {
  const f = await fixture({ recording: true, headExisting: true });
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.equal(f.calls.puts, 0);
    assert.equal(f.calls.normalized, 0);
  } finally {
    await f.cleanup();
  }
});
for (const reason of [
  'infected',
  'stale_signatures',
  'scanner_unavailable',
  'invalid_format',
]) {
  test(`T6 ${reason} never becomes ready or reaches storage`, async () => {
    const f = await fixture({ validationReason: reason });
    try {
      await f.handler(f.job, f.context);
      assert.equal(f.calls.puts, 0);
      assert.equal(f.calls.ready, 0);
      assert.deepEqual(f.calls.failures, [reason]);
    } finally {
      await f.cleanup();
    }
  });
}
for (const [
  name,
  options,
  reason,
] of /** @type {Array<[string,any,string]>} */ ([
  ['PUT unknown', { putFailure: true }, 'storage_unavailable'],
  ['DB crash after PUT', { dbFailure: true }, 'processing_failed'],
  ['cleanup failure', { cleanupFailure: true }, 'processing_failed'],
])) {
  test(`T6 ${name} preserves reservation and retries safely`, async () => {
    const f = await fixture(options);
    try {
      const before = f.row().reservation_bytes;
      const result = await f.handler(f.job, f.context);
      assert.equal(result.outcome, 'failed');
      assert.equal(result.retrySafe, true);
      assert.equal(f.row().reservation_bytes, before);
      assert.deepEqual(f.calls.failures, [reason]);
    } finally {
      await f.cleanup();
    }
  });
}
test('T6 lost lease performs no storage effect or ready transition', async () => {
  const f = await fixture({ leaseLost: true });
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'failed');
    assert.equal(f.calls.puts, 0);
    assert.equal(f.calls.ready, 0);
  } finally {
    await f.cleanup();
  }
});
test('T6 heartbeat renews while validator waits beyond its interval', async () => {
  const f = await fixture({ delayed: true });
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.ok(f.calls.heartbeats >= 4);
  } finally {
    await f.cleanup();
  }
});

test('T6 insufficient reservation refuses conversion and keeps all bytes charged', async () => {
  const f = await fixture({ recording: true, reservation: BYTES.length });
  try {
    await f.handler(f.job, f.context);
    assert.equal(f.calls.normalized, 0);
    assert.equal(f.calls.puts, 0);
    assert.equal(f.calls.ready, 0);
    assert.equal(f.row().reservation_bytes, BYTES.length);
    assert.deepEqual(f.calls.failures, ['quota_exceeded']);
  } finally {
    await f.cleanup();
  }
});
test('T6 bucket alias mismatch never writes to the configured storage', async () => {
  const f = await fixture({ bucketAlias: 'chat-operational' });
  try {
    await f.handler(f.job, f.context);
    assert.equal(f.calls.puts, 0);
    assert.equal(f.calls.ready, 0);
    assert.deepEqual(f.calls.failures, ['storage_unavailable']);
  } finally {
    await f.cleanup();
  }
});

for (const options of [{ failFailure: true }, { failCas: true }]) {
  test(`T6 rejection ${options.failFailure ? 'DB failure' : 'CAS conflict'} does not acknowledge an unpersisted terminal state`, async () => {
    const f = await fixture({ ...options, validationReason: 'invalid_format' });
    try {
      const result = await f.handler(f.job, f.context);
      assert.equal(result.outcome, 'failed');
      assert.equal(result.retrySafe, true);
      assert.equal(result.retryable, true);
      assert.equal(f.calls.ready, 0);
      assert.equal(f.calls.puts, 0);
    } finally {
      await f.cleanup();
    }
  });
}

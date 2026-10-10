import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createChatMediaProcessJobHandler } from '../modules/integration-reliability/src/chat-media-process-worker.js';
import { ChatMediaValidationError } from '../modules/integration-reliability/src/chat-media-validation.js';
import { RecordedAudioNormalizer } from '../modules/integration-reliability/src/recorded-audio-normalizer.js';
import {
  MediaObjectMissingError,
  MediaStorageUnavailableError,
  RustfsMediaStore,
} from '../modules/integration-reliability/src/rustfs-media-store.js';

const BYTES = Buffer.from('synthetic');
const SHA = createHash('sha256').update(BYTES).digest('hex');
/** @param {{recording?: boolean,validationReason?: string,outputValidationReason?: string,putFailure?: boolean,dbFailure?: boolean,headExisting?: boolean,prepared?: boolean,existingVariant?: boolean,afterPrepare?: Function,leaseLost?: boolean,cleanupFailure?: boolean,delayed?: boolean,reservation?: number,bucketAlias?: string,failFailure?: boolean,failCas?: boolean}} [options] */
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'crm-process-'));
  const source = randomUUID();
  const key = randomUUID();
  await writeFile(join(root, source), BYTES);
  if (options.existingVariant) await writeFile(join(root, key), BYTES);
  const prepared = options.headExisting || options.prepared;
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
    content_sha256: prepared ? SHA : null,
    size_bytes: prepared ? BYTES.length : null,
    detected_mime_type: prepared ? metadata.mimeType : null,
    original_sha256: prepared ? SHA : null,
  };
  const calls = {
    puts: 0,
    prepared: 0,
    normalized: 0,
    validations: 0,
    uploadedBytes: /** @type {Buffer|undefined} */ (undefined),
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
      await options.afterPrepare?.({ row, root, source, key });
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
  const verifiedStore = new RustfsMediaStore({
    bucket: 'crm-silmer-chat-media-dev',
    client: {
      async send(command) {
        assert.equal(command.input.ContentLength, metadata.sizeBytes);
        assert.equal(command.input.ContentType, metadata.mimeType);
        assert.deepEqual(command.input.Metadata, { sha256: SHA });
        assert.equal(command.input.IfNoneMatch, '*');
        assert.equal(
          command.input.ChecksumSHA256,
          Buffer.from(SHA, 'hex').toString('base64'),
        );
        const chunks = [];
        for await (const chunk of command.input.Body)
          chunks.push(Buffer.from(chunk));
        calls.uploadedBytes = Buffer.concat(chunks);
        calls.puts++;
        if (options.putFailure) throw new MediaStorageUnavailableError();
        return {};
      },
    },
  });
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
    /** @param {any} input */
    async putValidated(input) {
      assert.ok(row.content_sha256, 'prepared metadata must precede PUT');
      await verifiedStore.putValidated(input);
    },
  };
  const validator = {
    /** @param {{path:string}} input */
    async validate({ path }) {
      calls.validations++;
      if (options.validationReason)
        throw new ChatMediaValidationError(options.validationReason);
      if (options.outputValidationReason && path !== join(root, source))
        throw new ChatMediaValidationError(options.outputValidationReason);
      if (options.delayed)
        await new Promise((resolve) => setTimeout(resolve, 30));
      return options.recording && path === join(root, source)
        ? { ...metadata, mimeType: 'audio/webm' }
        : metadata;
    },
  };
  const normalizer = new RecordedAudioNormalizer({
    validator,
    /** @param {string} _command @param {string[]} args */
    async execFileImpl(_command, args) {
      await writeFile(/** @type {string} */ (args.at(-1)), BYTES);
    },
  });
  const handler = createChatMediaProcessJobHandler({
    repository,
    store,
    spoolRoot: root,
    heartbeatIntervalMs: 5,
    validator,
    normalizer: {
      /** @param {any} input */
      async normalize(input) {
        calls.normalized++;
        return normalizer.normalize(input);
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
    assert.deepEqual(f.calls.uploadedBytes, BYTES);
    assert.equal(f.calls.validations, 1);
    assert.equal(f.calls.ready, 1);
    assert.equal(f.row().content_sha256, SHA);
    assert.equal(f.row().size_bytes, BYTES.length);
    assert.equal(f.row().detected_mime_type, 'image/png');
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
    assert.equal(f.calls.validations, 2);
    assert.equal(f.calls.puts, 1);
    assert.equal(f.calls.ready, 1);
    assert.equal(f.row().detected_mime_type, 'audio/ogg');
    assert.deepEqual(f.calls.uploadedBytes, BYTES);
  } finally {
    await f.cleanup();
  }
});
test('T28/MED-06 prepared retry validates again before uploading missing object', async () => {
  const f = await fixture({ prepared: true });
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.equal(f.calls.validations, 1);
    assert.equal(f.calls.prepared, 0);
    assert.equal(f.calls.puts, 1);
    assert.equal(f.calls.ready, 1);
    assert.equal(f.row().content_sha256, SHA);
  } finally {
    await f.cleanup();
  }
});
test('T28/MED-06 recording crash variant validates source and output exactly once', async () => {
  const f = await fixture({ recording: true, existingVariant: true });
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.equal(f.calls.validations, 2);
    assert.equal(f.calls.normalized, 0);
    assert.equal(f.calls.puts, 1);
    assert.equal(f.calls.ready, 1);
    assert.equal(f.row().content_sha256, SHA);
    assert.equal(f.row().original_sha256, SHA);
    assert.equal(f.row().detected_mime_type, 'audio/ogg');
  } finally {
    await f.cleanup();
  }
});
test('T28/MED-06 infected normalized output is not prepared, uploaded or published', async () => {
  const f = await fixture({
    recording: true,
    outputValidationReason: 'infected',
  });
  try {
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.equal(f.calls.validations, 2);
    assert.equal(f.calls.normalized, 1);
    assert.equal(f.calls.prepared, 0);
    assert.equal(f.calls.puts, 0);
    assert.equal(f.calls.ready, 0);
    assert.deepEqual(f.calls.failures, ['infected']);
  } finally {
    await f.cleanup();
  }
});
for (const [
  name,
  mutate,
  reason,
] of /** @type {Array<[string,(input:{root:string,source:string,row:any})=>Promise<any>,string]>} */ ([
  [
    'same-size bytes',
    async ({ root, source }) =>
      writeFile(join(root, source), Buffer.from('different')),
    'storage_unavailable',
  ],
  [
    'size',
    async ({ root, source }) =>
      writeFile(join(root, source), Buffer.from('short')),
    'invalid_format',
  ],
  [
    'non-file',
    async ({ root, source }) => {
      await rm(join(root, source));
      await mkdir(join(root, source));
    },
    'invalid_format',
  ],
  [
    'symlink',
    async ({ root, source }) => {
      await rm(join(root, source));
      const target = join(root, 'link-target');
      await mkdir(target);
      // Junctions are directory symlinks available without Windows elevation.
      await symlink(target, join(root, source), 'junction');
    },
    'invalid_format',
  ],
  [
    'prepared SHA metadata',
    async ({ row }) => {
      row.content_sha256 = '0'.repeat(64);
    },
    'storage_unavailable',
  ],
  [
    'prepared size metadata',
    async ({ row }) => {
      row.size_bytes++;
    },
    'storage_unavailable',
  ],
  [
    'prepared MIME metadata',
    async ({ row }) => {
      row.detected_mime_type = 'image/jpeg';
    },
    'storage_unavailable',
  ],
])) {
  test(`T28/MED-26 ${name} change after validation never publishes ready`, async () => {
    const f = await fixture({ afterPrepare: mutate });
    try {
      const reserved = f.row().reservation_bytes;
      const result = await f.handler(f.job, f.context);
      assert.equal(
        result.outcome,
        reason === 'invalid_format' ? 'sent' : 'failed',
      );
      assert.equal(f.calls.validations, 1);
      assert.equal(f.calls.puts, 0);
      assert.equal(f.calls.ready, 0);
      assert.equal(f.row().reservation_bytes, reserved);
      assert.deepEqual(f.calls.failures, [reason]);
    } finally {
      await f.cleanup();
    }
  });
}
for (const reason of ['infected', 'stale_signatures', 'scanner_unavailable']) {
  test(`T28/MED-06 prepared retry ${reason} remains blocked despite persisted SHA`, async () => {
    const f = await fixture({ prepared: true, validationReason: reason });
    try {
      await f.handler(f.job, f.context);
      assert.equal(f.calls.validations, 1);
      assert.equal(f.calls.puts, 0);
      assert.equal(f.calls.ready, 0);
      assert.deepEqual(f.calls.failures, [reason]);
    } finally {
      await f.cleanup();
    }
  });
}
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
test('T6/MED-19: same-size spool replacement preserves admitted SHA and prevents prepare/PUT/ready', async () => {
  const f = await fixture();
  try {
    const admittedSha = createHash('sha256')
      .update(Buffer.from('different'))
      .digest('hex');
    assert.equal(Buffer.byteLength('different'), BYTES.length);
    f.row().original_sha256 = admittedSha;
    assert.equal((await f.handler(f.job, f.context)).outcome, 'sent');
    assert.deepEqual(f.calls.failures, ['invalid_format']);
    assert.equal(f.calls.prepared, 0);
    assert.equal(f.calls.puts, 0);
    assert.equal(f.calls.ready, 0);
    assert.equal(f.row().original_sha256, admittedSha);
  } finally {
    await f.cleanup();
  }
});

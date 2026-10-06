import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';
import { PostgresChatMediaUploadRepository } from '../modules/integration-reliability/src/postgres-chat-media-upload-repository.js';
import { requireMediaSpoolRoot } from '../apps/api/src/server.js';
import { createIdentityApiRuntime } from '../apps/api/src/identity-runtime.js';

const id = '20000000-0000-4000-8000-000000000001';
/** @param {Record<string,any>} [overrides] */
function harness(overrides = {}) {
  const row = {
    id,
    conversation_id: 'conversation',
    uploaded_by: 'author',
    kind: 'image',
    origin: 'attachment',
    state: 'ready',
    validation_status: 'clean',
    detected_mime_type: 'image/png',
    size_bytes: '100',
    duration_ms: null,
    message_id: null,
    sanitized_reason: null,
    object_key: 'secret-key',
    filename_envelope: { ciphertext: 'secret-filename' },
    ...overrides,
  };
  const repository = new PostgresChatMediaUploadRepository({
    database: {
      async query(/** @type {string} */ sql, /** @type {any[]} */ values) {
        assert.ok(sql.includes('conversation_id=$2'));
        assert.deepEqual(values, [id, 'conversation']);
        return { rows: [row] };
      },
    },
  });
  const runtime = createChatMediaApiRuntime({
    repository,
    access: {},
    spoolRoot: 'var/synthetic-unused',
    envelopeKey: Buffer.alloc(32, 7),
  });
  return (
    actor = { id: 'author', capabilities: /** @type {string[]} */ ([]) },
  ) => runtime.status({ mediaId: id, conversationId: 'conversation', actor });
}
test('MED-08/20: author sees draft DTO with only safe metadata', async () => {
  assert.deepEqual(await harness()(), {
    mediaId: id,
    kind: 'image',
    origin: 'attachment',
    state: 'ready',
    validationStatus: 'clean',
    mimeType: 'image/png',
    sizeBytes: 100,
    durationMs: null,
  });
});
test('MED-08: administrator can inspect draft but another seller cannot', async () => {
  const get = harness();
  await assert.rejects(get({ id: 'other', capabilities: [] }), {
    statusCode: 403,
  });
  assert.equal(
    (await get({ id: 'admin', capabilities: ['COMMERCIAL_ADMIN'] })).mediaId,
    id,
  );
});
test('MED-16: attached and lost attached use authorized conversation read ACL', async () => {
  for (const state of ['attached', 'lost']) {
    const dto = await harness({
      message_id: 'message',
      state,
      sanitized_reason: state === 'lost' ? 'object_missing' : null,
    })({ id: 'other', capabilities: [] });
    assert.equal(dto.state, state);
    assert.equal(dto.mediaId, id);
    assert.equal(JSON.stringify(dto).includes('secret-key'), false);
  }
});
test('MED-29: rejected real format remains 200 DTO state/reason, no key or name', async () => {
  const dto = await harness({
    state: 'rejected',
    validation_status: 'invalid_format',
    sanitized_reason: 'invalid_format',
    size_bytes: null,
    detected_mime_type: null,
  })();
  assert.equal(dto.state, 'rejected');
  assert.equal(dto.reason, 'invalid_format');
  assert.equal(dto.sizeBytes, null);
  assert.equal(JSON.stringify(dto).includes('secret-filename'), false);
});
test('MED-20 support: configured spool cannot resolve to the legacy media root', () => {
  assert.throws(
    () =>
      requireMediaSpoolRoot({
        CHAT_MEDIA_SPOOL_ROOT: 'var/private/../private',
        PRIVATE_MEDIA_ROOT: 'var/private',
      }),
    /distinct CHAT_MEDIA_SPOOL_ROOT/u,
  );
  if (process.platform === 'win32')
    assert.throws(
      () =>
        requireMediaSpoolRoot({
          CHAT_MEDIA_SPOOL_ROOT: 'VAR\\PRIVATE',
          PRIVATE_MEDIA_ROOT: 'var/private',
        }),
      /distinct CHAT_MEDIA_SPOOL_ROOT/u,
    );
  assert.ok(
    requireMediaSpoolRoot({
      CHAT_MEDIA_SPOOL_ROOT: 'var/chat-spool',
      PRIVATE_MEDIA_ROOT: 'var/private',
    }).endsWith('chat-spool'),
  );
});
test('MED-16: opted-in read distinguishes invalid session401, capability403 and DB failure', async () => {
  const environment = {
    APP_ORIGIN: 'https://crm.example.test',
    AUTH_THROTTLE_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'),
    IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 7).toString('base64url'),
    IDENTITY_BOOTSTRAP_TOKEN:
      'synthetic-bootstrap-token-with-at-least-32-characters',
  };
  const identity = createIdentityApiRuntime(
    {
      query: async () => ({ rows: [] }),
      transaction: async (work) => work({ query: async () => ({ rows: [] }) }),
    },
    environment,
  );
  await assert.rejects(
    identity.authorizeOperationalRead({
      action: 'conversation.read',
      sessionToken: 'invalid',
      authenticationFailureStatus: 401,
    }),
    { statusCode: 401, code: 'INVALID_CREDENTIALS' },
  );
  await assert.rejects(
    identity.authorizeOperationalRead({
      action: 'conversation.read',
      sessionToken: 'invalid',
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    identity.authorizeOperationalRead({
      action: 'forbidden.action',
      sessionToken: 'invalid',
      authenticationFailureStatus: 401,
    }),
    { statusCode: 403 },
  );
  const failure = new Error('synthetic DB unavailable');
  const unavailable = createIdentityApiRuntime(
    {
      query: async () => ({ rows: [] }),
      transaction: async (work) =>
        work({
          query: async () => {
            throw failure;
          },
        }),
    },
    environment,
  );
  await assert.rejects(
    unavailable.authorizeOperationalRead({
      action: 'conversation.read',
      sessionToken: 'invalid',
      authenticationFailureStatus: 401,
    }),
    (error) => error === failure,
  );
});

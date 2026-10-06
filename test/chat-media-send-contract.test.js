import assert from 'node:assert/strict';
import test from 'node:test';
import { createInboxService } from '../modules/inbox-channels/src/application/inbox-service.js';
import { createApi } from '../apps/api/src/app.js';
import { createConversationApiRuntime } from '../apps/api/src/conversation-runtime.js';

const id = '20000000-0000-4000-8000-000000000001';
const actor = { id: 'seller', kind: 'human', functionName: 'Vendedor' };
/** @param {any} [options] */
function harness(options = {}) {
  /** @type {any[]} */ const calls = [];
  const service = createInboxService({
    mediaEnabled: options.mediaEnabled ?? true,
    repository: {
      async receiveInbound() {},
      async recordSuggestion() {},
      async mutateConversation(
        /** @type {string} */ operation,
        /** @type {any} */ input,
        /** @type {any} */ runtime,
      ) {
        if (runtime.mediaEnabled === false && input.messageType !== 'text')
          throw Object.assign(new Error('Disabled admission'), {
            statusCode: 403,
          });
        calls.push({ operation, input });
        return {
          id: 'message',
          content: input.content,
          type: input.messageType,
        };
      },
    },
  });
  const send = (
    /** @type {string} */ messageType,
    /** @type {any} */ content,
  ) =>
    service.sendHumanMessage({
      actor,
      conversationId: 'conversation',
      correlationId: 'synthetic',
      idempotencyKey: 'command',
      expectedVersion: 1,
      reason: 'Synthetic',
      messageType,
      content,
    });
  return { service, send, calls };
}
for (const kind of ['image', 'audio', 'video'])
  test(`T11/MED-04: canonical ${kind} reference accepted`, async () => {
    const h = harness();
    const result = await h.send(kind, { mediaId: id });
    assert.deepEqual(result.content, { mediaId: id });
    assert.equal(result.type, kind);
    assert.equal(h.calls.length, 1);
  });
for (const kind of ['image', 'video'])
  test(`T11/MED-04: ${kind} caption counts Unicode codepoints`, async () => {
    const h = harness();
    const caption = '😀'.repeat(1024);
    assert.equal(
      (await h.send(kind, { mediaId: id, caption })).content.caption,
      caption,
    );
    await assert.rejects(
      h.send(kind, { mediaId: id, caption: caption + '😀' }),
      { code: 'INBOX_INVALID', statusCode: 400 },
    );
  });
for (const content of [
  { mediaId: id, caption: '' },
  { mediaId: id, caption: 'caption' },
])
  test(`T11/MED-04: audio caption is forbidden ${JSON.stringify(content)}`, async () => {
    const h = harness();
    await assert.rejects(h.send('audio', content), {
      code: 'INBOX_INVALID',
      statusCode: 400,
    });
    assert.equal(h.calls.length, 0);
  });
for (const content of [
  { mediaId: id, url: 'https://example.test/private' },
  { mediaId: id, object_key: id },
  { mediaId: id, attachmentId: id },
  { mediaId: id, filename: 'original.png' },
  { mediaId: 'not-uuid' },
  { mediaId: id, caption: 12 },
])
  test(`T11/MED-04/16: reject arbitrary reference/payload ${JSON.stringify(content)}`, async () => {
    const h = harness();
    await assert.rejects(h.send('image', content), {
      code: 'INBOX_INVALID',
      statusCode: 400,
    });
    assert.equal(h.calls.length, 0);
  });
test('T11/MED-04: unsupported document type is rejected', async () => {
  await assert.rejects(harness().send('document', { mediaId: id }), {
    code: 'INBOX_INVALID',
    statusCode: 400,
  });
});
test('T11/MED-04: text content retains existing behavior with media admission disabled', async () => {
  const h = harness({ mediaEnabled: false });
  const text = { text: 'Synthetic', legacyField: 'retained' };
  assert.deepEqual((await h.send('text', text)).content, text);
  await assert.rejects(h.send('image', { mediaId: id }), { statusCode: 403 });
  assert.equal(h.calls.length, 1);
});
test('T11/MED-08: non-human and non-Vendedor remain forbidden', async () => {
  for (const invalid of [
    { ...actor, kind: 'technical' },
    { ...actor, functionName: 'Financeiro' },
  ])
    await assert.rejects(
      harness().service.sendHumanMessage({ actor: invalid }),
      { statusCode: 403 },
    );
});
test('T11/MED-04/08: HTTP boundary forwards canonical media, reports predictable payload and ACL errors', async (t) => {
  const h = harness();
  const api = createApi(
    {},
    {
      conversations: {
        sendMessage: h.service.sendHumanMessage,
        async authorize(/** @type {any} */ input) {
          assert.equal(input.action, 'conversation.message.send');
          if (input.cookie === 'crm_session=forbidden')
            throw Object.assign(new Error('private-canary'), {
              statusCode: 403,
              code: 'INBOX_FORBIDDEN',
            });
          return { actor };
        },
      },
    },
  );
  t.after(() => api.close());
  const post = (/** @type {any} */ content, cookie = 'crm_session=synthetic') =>
    api.inject({
      method: 'POST',
      url: '/api/v1/conversations/conversation/messages',
      headers: {
        cookie,
        'idempotency-key': 'command',
        origin: 'https://crm.example.test',
        'x-csrf-token': 'synthetic',
      },
      payload: {
        content,
        expectedVersion: 1,
        messageType: 'image',
        reason: 'Synthetic',
      },
    });
  assert.equal(
    (await post({ mediaId: id, caption: 'Caption' })).statusCode,
    202,
  );
  assert.equal(
    (await post({ mediaId: id, url: 'https://example.test' })).statusCode,
    400,
  );
  assert.equal(
    (await post({ mediaId: id, url: 'https://example.test' })).json().error
      .code,
    'INBOX_INVALID',
  );
  assert.equal(
    (await post({ mediaId: id }, 'crm_session=forbidden')).statusCode,
    403,
  );
  assert.equal(h.calls.length, 1);
});
test('T11/MED-04: production runtime checks replay then blocks new media before domain mutation while preserving text', async () => {
  let queries = 0;
  /** @type {string[]} */ const statements = [];
  const database = {
    async query() {
      return { rows: [] };
    },
    async transaction(/** @type {any} */ work) {
      return work({
        async query(/** @type {string} */ sql) {
          queries++;
          statements.push(sql);
          return { rows: [] };
        },
      });
    },
  };
  const runtime = createConversationApiRuntime(
    database,
    {},
    {},
    { commandOutbox: { async enqueueChannelMessage() {} } },
    Buffer.alloc(32),
    { mediaEnabled: false },
  );
  const command = {
    actor,
    conversationId: 'conversation',
    correlationId: 'synthetic',
    idempotencyKey: 'command',
    expectedVersion: 1,
    reason: 'Synthetic',
  };
  await assert.rejects(
    runtime.sendMessage({
      ...command,
      messageType: 'image',
      content: { mediaId: id },
    }),
    { statusCode: 403 },
  );
  assert.equal(queries, 2);
  assert.equal(
    statements.some((sql) => /crm.conversations|UPDATE|INSERT/u.test(sql)),
    false,
  );
  await assert.rejects(
    runtime.sendMessage({
      ...command,
      messageType: 'text',
      content: { text: 'Synthetic' },
    }),
    { statusCode: 409 },
  );
  assert.ok(queries > 0);
});

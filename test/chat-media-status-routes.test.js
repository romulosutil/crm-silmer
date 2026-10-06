import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../apps/api/src/app.js';
import { registerChatMediaStatusRoutes } from '../apps/api/src/chat-media-status-routes.js';

const id = '20000000-0000-4000-8000-000000000001';
/** @param {any} t @param {Record<string,any>} [options] */
function harness(t, options = {}) {
  const api = createApi();
  const media = {
    async authorizeRead(/** @type {any} */ input) {
      if (options.authStatus)
        throw Object.assign(new Error('private-canary'), {
          statusCode: options.authStatus,
        });
      assert.equal(input.action, 'conversation.read');
      return {
        actor: {
          id: options.actorId ?? 'seller',
          capabilities: options.admin ? ['COMMERCIAL_ADMIN'] : [],
        },
      };
    },
    async status(/** @type {any} */ input) {
      if (options.forbidden)
        throw Object.assign(new Error('private-canary'), { statusCode: 403 });
      assert.equal(input.conversationId, 'conversation');
      assert.equal(input.mediaId, id);
      return {
        mediaId: id,
        kind: 'image',
        origin: 'attachment',
        state: options.state ?? 'ready',
        validationStatus: options.validation ?? 'clean',
        mimeType: 'image/png',
        sizeBytes: 100,
        durationMs: null,
        ...(options.reason ? { reason: options.reason } : {}),
      };
    },
  };
  registerChatMediaStatusRoutes(api, media, () => ({ requestId: 'synthetic' }));
  t.after(() => api.close());
  return (extra = {}) =>
    api.inject({
      method: 'GET',
      url: `/api/v1/conversations/conversation/media/${id}`,
      headers: {
        cookie: 'crm_session=synthetic',
        'sec-fetch-site': 'same-origin',
        ...extra,
      },
    });
}
for (const state of [
  'uploaded',
  'processing',
  'ready',
  'attached',
  'unavailable',
  'lost',
])
  test(`MED-08/19: authorized status ${state} has safe metadata`, async (t) => {
    const get = harness(t, { state });
    const response = await get();
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, state);
    assert.equal(response.json().mediaId, id);
    assert.equal(response.body.includes('object_key'), false);
    assert.equal(response.body.includes('private-canary'), false);
    assert.equal(response.headers['cache-control'], 'private, no-store');
  });
test('MED-29: invalid_format is HTTP200 rejected status', async (t) => {
  const response = await harness(t, {
    state: 'rejected',
    validation: 'invalid_format',
    reason: 'invalid_format',
  })();
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().state, 'rejected');
  assert.equal(response.json().reason, 'invalid_format');
});
for (const status of [401, 403, 503])
  test(`MED-16: status auth failure ${status} exposes no metadata`, async (t) => {
    const response = await harness(t, { authStatus: status })();
    assert.equal(response.statusCode, status);
    assert.equal(response.body.includes('image/png'), false);
  });
test('MED-16: status requires session and refuses technical authorization', async (t) => {
  const get = harness(t);
  assert.equal((await get({ cookie: '' })).statusCode, 401);
  assert.equal(
    (await get({ authorization: 'Basic synthetic' })).statusCode,
    403,
  );
});
test('MED-08: draft of other actor is forbidden', async (t) => {
  const response = await harness(t, { forbidden: true })();
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.includes('private-canary'), false);
});

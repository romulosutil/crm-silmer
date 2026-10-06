import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { registerN8nCommandMediaRoutes } from '../apps/api/src/n8n-command-media-routes.js';

const headers = {
  authorization: 'Basic synthetic',
  'x-correlation-id': 'trace',
  'x-silmer-workflow-key': 'workflow',
  'x-silmer-workflow-version': 'version',
  'x-silmer-execution-id': 'execution',
};
/** @param {import('node:test').TestContext} t @param {number} failure */
async function harness(t, failure = 0) {
  const api = Fastify();
  /** @type {any[]} */
  const calls = [];
  api.decorate('automationAuth', {
    async authorize(/** @type {any} */ input) {
      assert.equal(input.action, 'integration.n8n.command.media.read');
      if (!input.authorization)
        throw Object.assign(new Error(), { statusCode: 401 });
      return { actor: 'AUTOMATION_EXECUTOR' };
    },
  });
  registerN8nCommandMediaRoutes(
    api,
    {
      async readReservedMedia(/** @type {any} */ input) {
        calls.push(input);
        if (failure)
          throw Object.assign(new Error('private-key-canary'), {
            statusCode: failure,
          });
        return {
          id: 'media',
          kind: 'image',
          content_sha256: 'a'.repeat(64),
          detected_mime_type: 'image/png',
          size_bytes: 3,
        };
      },
    },
    {
      async reservedContent(/** @type {any} */ row) {
        calls.push(row);
        return {
          statusCode: 200,
          stream: Readable.from(Buffer.from('PNG')),
          headers: { 'Content-Type': 'image/png', 'Content-Length': '3' },
        };
      },
    },
    () => ({ correlationId: 'trace', requestId: 'request' }),
  );
  t.after(() => api.close());
  return { api, calls };
}
test('T13/MED-22: bytes use reserved command and exact workflow identity', async (t) => {
  const { api, calls } = await harness(t);
  const response = await api.inject({
    url: '/api/v1/integrations/n8n/commands/command/media',
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'PNG');
  assert.equal(calls[0].commandId, 'command');
  assert.deepEqual(calls[0].technical, {
    workflowKey: 'workflow',
    workflowVersion: 'version',
    executionId: 'execution',
  });
  assert.equal(response.headers['cache-control'], 'private, no-store');
});
test('T13/MED-21: preflight has safe metadata and zero content reads', async (t) => {
  const { api, calls } = await harness(t);
  const response = await api.inject({
    url: '/api/v1/integrations/n8n/commands/command/media?preflight=true',
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    valid: true,
    media_id: 'media',
    type: 'image',
    sha256: 'a'.repeat(64),
    mime_type: 'image/png',
    size_bytes: 3,
  });
  assert.equal(calls.length, 1);
});
for (const status of [403, 404, 409, 410, 503])
  test(`T13/MED-16/22: denied ${status} exposes no bytes or private data`, async (t) => {
    const { api } = await harness(t, status);
    const response = await api.inject({
      url: '/api/v1/integrations/n8n/commands/command/media',
      headers,
    });
    assert.equal(response.statusCode, status);
    assert.equal(response.body.includes('private-key-canary'), false);
    assert.equal(response.headers['cache-control'], 'private, no-store');
  });
test('T13/MED-16: missing Basic or execution identity cannot read; HEAD and foreign selectors refused', async (t) => {
  const { api, calls } = await harness(t);
  const missingAuth = { ...headers };
  Reflect.deleteProperty(missingAuth, 'authorization');
  const missingExecution = { ...headers };
  Reflect.deleteProperty(missingExecution, 'x-silmer-execution-id');
  assert.equal(
    (
      await api.inject({
        url: '/api/v1/integrations/n8n/commands/command/media',
        headers: missingAuth,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await api.inject({
        url: '/api/v1/integrations/n8n/commands/command/media',
        headers: missingExecution,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await api.inject({
        method: 'HEAD',
        url: '/api/v1/integrations/n8n/commands/command/media',
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await api.inject({
        url: '/api/v1/integrations/n8n/commands/command/media?conversation_id=other',
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(calls.length, 0);
});

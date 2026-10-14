import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

import { registerSiteChatRoutes } from '../apps/api/src/site-chat-routes.js';
import {
  encryptJson,
  identityLookupHash,
} from '../modules/n8n-integration/src/crypto.js';
import { PostgresN8nIntegrationRepository } from '../modules/n8n-integration/src/postgres-repository.js';

const session = '11111111-1111-4111-8111-111111111111';
const otherSession = '22222222-2222-4222-8222-222222222222';
const key = Buffer.alloc(32, 7);
const origin = 'https://silmer.com.br';

test('site polling uses the session identity, returns sent text, and exposes no phone or earlier contact', async () => {
  const siteId = `999${BigInt(`0x${session.replaceAll('-', '')}`)
    .toString(10)
    .padStart(39, '0')}`;
  const siteHash = identityLookupHash(
    {
      channel: 'site_chat',
      externalIdentityId: siteId,
      provider: 'site',
      providerAccountId: 'silmer-site',
    },
    key,
  );
  /** @type {unknown[]} */
  const readHashes = [];
  const repository = new PostgresN8nIntegrationRepository({
    contactLookupKey: key,
    database: {
      async query(_sql, values = []) {
        readHashes.push(values[0]);
        return {
          rows:
            values[0] === siteHash
              ? [
                  {
                    id: 'site-reply-1',
                    direction: 'outbound',
                    author_kind: 'human',
                    message_type: 'text',
                    content_envelope: encryptJson(
                      { text: 'Resposta do vendedor' },
                      'message:site-reply-1',
                      key,
                    ),
                    occurred_at: new Date('2026-10-14T12:00:00Z'),
                  },
                ]
              : [],
        };
      },
      async transaction(work) {
        return work(this);
      },
    },
    envelopeKey: key,
    messageEnvelopeKey: key,
  });
  const own = await repository.readSiteMessages({ sessionId: session });
  assert.deepEqual(own.messages, [
    {
      id: 'site-reply-1',
      direction: 'outbound',
      sender: 'human',
      text: 'Resposta do vendedor',
      occurred_at: '2026-10-14T12:00:00.000Z',
    },
  ]);
  assert.deepEqual(
    (await repository.readSiteMessages({ sessionId: otherSession })).messages,
    [],
  );
  assert.notEqual(readHashes[0], readHashes[1]);
  assert.doesNotMatch(JSON.stringify(own), /phone|contact_id|order_id/u);
  await assert.rejects(
    repository.readSiteMessages({ sessionId: 'not-a-session' }),
    /Invalid site session/u,
  );
});

test('site polling requires an allowed origin and a UUID in the POST body', async () => {
  const api = Fastify();
  let reads = 0;
  registerSiteChatRoutes(api, {
    async readSiteMessages() {
      reads++;
      return { messages: [] };
    },
  });
  const preflight = await api.inject({
    method: 'OPTIONS',
    url: '/api/v1/site-chat/messages',
    headers: { origin },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);

  const allowed = await api.inject({
    method: 'POST',
    url: '/api/v1/site-chat/messages',
    headers: { origin },
    payload: { session_id: session },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['cache-control'], 'no-store');
  assert.equal(reads, 1);

  for (const { headers, payload, status } of [
    {
      headers: { origin: 'https://other.example' },
      payload: { session_id: session },
      status: 403,
    },
    { headers: { origin }, payload: { session_id: 'invalid' }, status: 400 },
    {
      headers: { origin },
      payload: { session_id: session, phone: '5527999991234' },
      status: 400,
    },
  ]) {
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/site-chat/messages',
      headers,
      payload,
    });
    assert.equal(response.statusCode, status);
  }
  assert.equal(reads, 1);
  await api.close();
});

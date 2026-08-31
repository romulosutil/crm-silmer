import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createMetaWebhookRuntime } from '../apps/api/src/server.js';
import {
  InMemoryMetaEventStore,
  MetaWebhookAuthenticationError,
  createMetaMessagesClient,
  processMetaWebhook,
  runMetaSendAttempt,
} from '../modules/integration-reliability/src/index.js';
import { runMetaSandboxSmoke } from '../scripts/meta-sandbox-smoke.mjs';

/* global Response */

const APP_SECRET = 'synthetic-app-secret';

/** @param {Buffer|string} rawBody */
function signature(rawBody) {
  return `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
}

function messagePayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'synthetic-account',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'synthetic-phone' },
              messages: [
                {
                  from: '5500000000000',
                  id: 'wamid.synthetic-inbound-001',
                  timestamp: '1788105600',
                  type: 'text',
                  text: { body: 'fixture sem dado real' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** @param {Array<{id: string, status: string, timestamp: string, recipient_id: string}>} statuses */
function statusPayload(statuses) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'synthetic-account',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'synthetic-phone' },
              statuses,
            },
          },
        ],
      },
    ],
  };
}

test('rejects an invalid signature before parsing or applying effects', async () => {
  const store = new InMemoryMetaEventStore();
  let effects = 0;

  await assert.rejects(
    processMetaWebhook({
      appSecret: APP_SECRET,
      eventStore: store,
      onEvent: async () => {
        effects += 1;
      },
      rawBody: Buffer.from('{not-json'),
      signature: 'sha256=invalid',
    }),
    MetaWebhookAuthenticationError,
  );

  assert.equal(effects, 0);
  assert.deepEqual(await store.list(), []);
});

test('accepts a signed event once and never copies content or contact data', async () => {
  const store = new InMemoryMetaEventStore();
  /** @type {Array<Record<string, string>>} */
  const observed = [];
  const rawBody = Buffer.from(JSON.stringify(messagePayload()));
  const input = {
    appSecret: APP_SECRET,
    eventStore: store,
    onEvent: async (/** @type {Readonly<Record<string, string>>} */ event) => {
      observed.push(event);
    },
    rawBody,
    signature: signature(rawBody),
  };

  const first = await processMetaWebhook(input);
  const replay = await processMetaWebhook(input);

  assert.deepEqual(first, { accepted: 1, duplicates: 0, received: 1 });
  assert.deepEqual(replay, { accepted: 0, duplicates: 1, received: 1 });
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], {
    accountId: 'synthetic-account',
    eventId: 'wamid.synthetic-inbound-001',
    eventType: 'message',
    messageType: 'text',
    occurredAt: '1788105600',
    phoneNumberId: 'synthetic-phone',
  });
  assert.doesNotMatch(JSON.stringify(observed), /fixture sem dado real|5500/u);
});

test('preserves only observed delivery states without inventing missing events', async () => {
  const store = new InMemoryMetaEventStore();
  /** @type {Array<Record<string, string>>} */
  const observed = [];
  const statuses = ['sent', 'delivered', 'read', 'failed'].map(
    (status, index) => ({
      id: 'wamid.synthetic-outbound-001',
      status,
      timestamp: String(1788105601 + index),
      recipient_id: '5500000000000',
    }),
  );
  const rawBody = Buffer.from(JSON.stringify(statusPayload(statuses)));

  const result = await processMetaWebhook({
    appSecret: APP_SECRET,
    eventStore: store,
    onEvent: async (event) => {
      observed.push(event);
    },
    rawBody,
    signature: signature(rawBody),
  });

  assert.equal(result.accepted, 4);
  assert.deepEqual(
    observed.map(({ status }) => status),
    ['sent', 'delivered', 'read', 'failed'],
  );
  assert.equal(
    observed.some(({ status }) => status === 'deleted'),
    false,
  );
  assert.doesNotMatch(JSON.stringify(observed), /recipient_id|5500/u);
});

test('exposes the Meta challenge and raw-body webhook boundary', async () => {
  const store = new InMemoryMetaEventStore();
  const handler = {
    verifyToken: 'synthetic-verify-token',
    /** @param {{rawBody: Buffer, signature: unknown}} input */
    process: (input) =>
      processMetaWebhook({
        appSecret: APP_SECRET,
        eventStore: store,
        onEvent: async () => undefined,
        ...input,
      }),
  };
  const api = createApi({}, { metaWebhook: handler });

  const challenge = await api.inject({
    method: 'GET',
    url: '/api/v1/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=challenge-123',
  });
  const denied = await api.inject({
    method: 'GET',
    url: '/api/v1/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123',
  });
  const rawBody = Buffer.from(JSON.stringify(messagePayload()));
  const accepted = await api.inject({
    method: 'POST',
    url: '/api/v1/webhooks/meta/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature(rawBody),
    },
    payload: rawBody,
  });
  const invalid = await api.inject({
    method: 'POST',
    url: '/api/v1/webhooks/meta/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': 'sha256=invalid',
    },
    payload: rawBody,
  });

  assert.equal(challenge.statusCode, 200);
  assert.equal(challenge.body, 'challenge-123');
  assert.equal(denied.statusCode, 403);
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), {
    accepted: 1,
    duplicates: 0,
    received: 1,
  });
  assert.equal(invalid.statusCode, 401);
  await api.close();
});

test('sends text, template, document and image through the versioned endpoint', async () => {
  /** @type {Array<Record<string, any>>} */
  const requests = [];
  const client = createMetaMessagesClient({
    accessToken: 'synthetic-access-token',
    fetch: async (url, init) => {
      assert.ok(init);
      requests.push({
        body: JSON.parse(String(init.body)),
        headers: init.headers,
        method: init.method,
        url,
      });
      return new Response(
        JSON.stringify({
          messages: [{ id: `wamid.synthetic-${requests.length}` }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
    graphApiVersion: 'v25.0',
    phoneNumberId: 'synthetic-phone',
  });
  const messages = [
    { text: { body: 'sandbox text' }, type: 'text' },
    {
      template: { language: { code: 'en_US' }, name: 'hello_world' },
      type: 'template',
    },
    {
      document: {
        filename: 'sandbox.pdf',
        link: 'https://example.test/sandbox.pdf',
      },
      type: 'document',
    },
    { image: { link: 'https://example.test/sandbox.png' }, type: 'image' },
  ];

  const results = await Promise.all(
    messages.map((message) => client.send({ ...message, to: '5500000000000' })),
  );

  assert.deepEqual(
    results.map(({ providerMessageId }) => providerMessageId),
    [
      'wamid.synthetic-1',
      'wamid.synthetic-2',
      'wamid.synthetic-3',
      'wamid.synthetic-4',
    ],
  );
  assert.equal(
    requests.every(
      ({ method, url }) =>
        method === 'POST' &&
        url === 'https://graph.facebook.com/v25.0/synthetic-phone/messages',
    ),
    true,
  );
  assert.deepEqual(
    requests.map(({ body }) => body.type),
    ['text', 'template', 'document', 'image'],
  );
  assert.equal(
    requests.every(
      ({ body }) => body.messaging_product === 'whatsapp' && body.to,
    ),
    true,
  );
});

test('marks uncertainty after dispatch without blind retry', async () => {
  let dispatches = 0;
  const dispatch = async () => {
    dispatches += 1;
    return { providerMessageId: 'wamid.synthetic-accepted' };
  };

  const before = await runMetaSendAttempt({
    dispatch,
    fault: 'before-dispatch',
  });
  const after = await runMetaSendAttempt({
    dispatch,
    fault: 'after-acceptance',
  });
  const timeout = await runMetaSendAttempt({
    dispatch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const sent = await runMetaSendAttempt({ dispatch });

  assert.deepEqual(before, {
    automaticRetry: false,
    dispatchProvenAbsent: true,
    status: 'failed',
  });
  assert.deepEqual(after, {
    automaticRetry: false,
    dispatchProvenAbsent: false,
    status: 'outcome_unknown',
  });
  assert.deepEqual(timeout, {
    automaticRetry: false,
    dispatchProvenAbsent: false,
    status: 'outcome_unknown',
  });
  assert.deepEqual(sent, {
    automaticRetry: false,
    dispatchProvenAbsent: false,
    providerMessageId: 'wamid.synthetic-accepted',
    status: 'sent',
  });
  assert.equal(dispatches, 2);
});

test('treats only deterministic client rejection as proven absent', async () => {
  /** @param {number} status */
  const responseFor = (status) =>
    createMetaMessagesClient({
      accessToken: 'synthetic-access-token',
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: status } }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      graphApiVersion: 'v25.0',
      phoneNumberId: 'synthetic-phone',
    }).send({
      text: { body: 'synthetic' },
      to: '5500000000000',
      type: 'text',
    });

  const rejected = await runMetaSendAttempt({
    dispatch: () => responseFor(400),
  });
  const serverFailure = await runMetaSendAttempt({
    dispatch: () => responseFor(500),
  });
  const acceptedWithoutWamid = await runMetaSendAttempt({
    dispatch: () =>
      createMetaMessagesClient({
        accessToken: 'synthetic-access-token',
        fetch: async () =>
          new Response(JSON.stringify({ messages: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        graphApiVersion: 'v25.0',
        phoneNumberId: 'synthetic-phone',
      }).send({
        text: { body: 'synthetic' },
        to: '5500000000000',
        type: 'text',
      }),
  });

  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.dispatchProvenAbsent, true);
  assert.equal(serverFailure.status, 'outcome_unknown');
  assert.equal(serverFailure.dispatchProvenAbsent, false);
  assert.equal(acceptedWithoutWamid.status, 'outcome_unknown');
  assert.equal(acceptedWithoutWamid.dispatchProvenAbsent, false);
});

test('wires the production webhook only when both secrets exist', async () => {
  assert.equal(createMetaWebhookRuntime({}), undefined);
  assert.equal(
    createMetaWebhookRuntime({
      META_APP_SECRET: APP_SECRET,
    }),
    undefined,
  );

  const runtime = createMetaWebhookRuntime({
    META_APP_SECRET: APP_SECRET,
    META_VERIFY_TOKEN: 'synthetic-verify-token',
  });
  assert.ok(runtime);
  assert.equal(runtime.verifyToken, 'synthetic-verify-token');
  const rawBody = Buffer.from(JSON.stringify(messagePayload()));
  assert.deepEqual(
    await runtime.process({
      rawBody,
      signature: signature(rawBody),
    }),
    { accepted: 1, duplicates: 0, received: 1 },
  );
});

test('runs the four-message smoke and writes local evidence without secrets or phone', async () => {
  /** @type {Array<Record<string, any>>} */
  const requests = [];
  /** @type {Record<string, any>|undefined} */
  let writtenEvidence;
  const result = await runMetaSandboxSmoke({
    env: {
      META_ACCESS_TOKEN: 'synthetic-access-token-never-copy',
      META_GRAPH_API_VERSION: 'v25.0',
      META_TEMPLATE_LANGUAGE: 'en_US',
      META_TEMPLATE_NAME: 'hello_world',
      META_TEST_DOCUMENT_URL: 'https://example.test/sandbox.pdf',
      META_TEST_IMAGE_URL: 'https://example.test/sandbox.png',
      META_TEST_RECIPIENT_E164: '5500000000000',
      META_WHATSAPP_PHONE_NUMBER_ID: 'synthetic-phone',
    },
    fetch: async (_url, init) => {
      assert.ok(init);
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          messages: [{ id: `wamid.synthetic-${requests.length}` }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
    writeEvidence: async (evidence) => {
      writtenEvidence = evidence;
    },
  });

  assert.deepEqual(
    requests.map(({ type }) => type),
    ['text', 'template', 'document', 'image'],
  );
  assert.equal(result.accepted, 4);
  assert.ok(writtenEvidence);
  assert.equal(writtenEvidence.messages.length, 4);
  assert.deepEqual(writtenEvidence.failureScenarios, {
    afterAcceptance: 'outcome_unknown',
    beforeDispatch: 'failed',
    blindAutomaticRetry: false,
  });
  assert.doesNotMatch(
    JSON.stringify(writtenEvidence),
    /synthetic-access-token-never-copy|5500000000000|sandbox text/u,
  );
});

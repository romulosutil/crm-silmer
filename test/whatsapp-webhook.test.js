import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createApi,
  WEBHOOK_MAX_IN_FLIGHT,
  WEBHOOK_REQUESTS_PER_SECOND,
} from '../apps/api/src/app.js';
import {
  createWhatsAppWebhookRuntime,
  WEBHOOK_BODY_LIMIT_BYTES,
} from '../apps/api/src/whatsapp-webhook-runtime.js';
import {
  MetaWebhookAuthenticationError,
  MetaWebhookPayloadError,
  WebhookEventConflictError,
} from '../modules/integration-reliability/src/index.js';
import { createMetaWhatsAppNormalizer } from '../modules/inbox-channels/src/index.js';

const APP_SECRET = 'synthetic-whatsapp-app-secret';
const RECEIVED_AT = new Date('2026-09-02T12:00:00.000Z');

/** @param {Buffer} rawBody */
function signature(rawBody) {
  return `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
}

test('rejects type and size before invoking the webhook runtime', async () => {
  let calls = 0;
  const api = createApi(
    {},
    {
      metaWebhook: {
        verifyToken: 'synthetic-verify-token',
        async process() {
          calls += 1;
          return { accepted: 0, duplicates: 0, received: 0 };
        },
      },
    },
  );

  const wrongType = await api.inject({
    method: 'POST',
    url: '/api/v1/webhooks/meta/whatsapp',
    headers: { 'content-type': 'text/plain' },
    payload: '{}',
  });
  const oversized = await api.inject({
    method: 'POST',
    url: '/api/v1/webhooks/meta/whatsapp',
    headers: { 'content-type': 'application/json' },
    payload: Buffer.alloc(WEBHOOK_BODY_LIMIT_BYTES + 1, 0x20),
  });

  assert.equal(wrongType.statusCode, 415);
  assert.equal(oversized.statusCode, 413);
  assert.equal(calls, 0);
  await api.close();
});

test('bounds webhook request rate and concurrent persistence', async () => {
  /** @type {() => void} */
  let release = () => {};
  const blocked = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let started = 0;
  /** @type {() => void} */
  let allStarted = () => {};
  const ready = new Promise((resolve) => {
    allStarted = () => resolve(undefined);
  });
  const api = createApi(
    {},
    {
      metaWebhook: {
        verifyToken: 'synthetic-verify-token',
        async process() {
          started += 1;
          if (started === WEBHOOK_MAX_IN_FLIGHT) allStarted();
          await blocked;
          return { accepted: 1 };
        },
      },
    },
  );
  const request = {
    method: /** @type {const} */ ('POST'),
    url: '/api/v1/webhooks/meta/whatsapp',
    headers: { 'content-type': 'application/json' },
    payload: Buffer.from('{}'),
  };
  const inFlight = Array.from({ length: WEBHOOK_MAX_IN_FLIGHT }, () =>
    api.inject(request),
  );
  await ready;
  const rejected = await api.inject(request);
  assert.equal(rejected.statusCode, 429);
  assert.equal(rejected.headers['retry-after'], '1');
  release();
  assert.deepEqual(
    (await Promise.all(inFlight)).map(({ statusCode }) => statusCode),
    Array(WEBHOOK_MAX_IN_FLIGHT).fill(200),
  );
  await api.close();

  const rateApi = createApi(
    {},
    {
      metaWebhook: {
        verifyToken: 'synthetic-verify-token',
        async process() {
          return { accepted: 1 };
        },
      },
    },
  );
  for (let index = 0; index < WEBHOOK_REQUESTS_PER_SECOND; index += 1) {
    assert.equal((await rateApi.inject(request)).statusCode, 200);
  }
  assert.equal((await rateApi.inject(request)).statusCode, 429);
  await rateApi.close();
});

test('passes sanitized request correlation to the durable runtime', async () => {
  /** @type {Record<string, unknown> | undefined} */
  let observed;
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
  const api = createApi(
    {},
    {
      metaWebhook: {
        verifyToken: 'synthetic-verify-token',
        async process(input) {
          observed = input;
          return { accepted: 0, duplicates: 0, received: 0 };
        },
      },
    },
  );

  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/webhooks/meta/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': '49bc43a9-65a3-4181-8d33-f42603982e35',
      'x-hub-signature-256': signature(rawBody),
    },
    payload: rawBody,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(observed?.correlationId, '49bc43a9-65a3-4181-8d33-f42603982e35');
  assert.deepEqual(observed?.rawBody, rawBody);
  assert.equal(observed?.signature, signature(rawBody));
  await api.close();
});

test('returns a bodyless conflict when an external identity is reused', async () => {
  const api = createApi(
    {},
    {
      metaWebhook: {
        verifyToken: 'synthetic-verify-token',
        async process() {
          throw new WebhookEventConflictError();
        },
      },
    },
  );
  const rawBody = Buffer.from('{}');

  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/webhooks/meta/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature(rawBody),
    },
    payload: rawBody,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body, '');
  await api.close();
});

test('returns a bodyless retryable response for a bounded database timeout', async () => {
  const timeoutCodes = ['57014', 'DATABASE_CONNECTION_TIMEOUT'];
  const api = createApi(
    {},
    {
      metaWebhook: {
        verifyToken: 'synthetic-verify-token',
        async process() {
          const error = new Error('private PostgreSQL timeout detail');
          Object.assign(error, { code: timeoutCodes.shift() });
          throw error;
        },
      },
    },
  );
  for (let index = 0; index < 2; index += 1) {
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta/whatsapp',
      headers: { 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.body, '');
  }
  await api.close();
});

test('authenticates exact bytes before decoding or parsing', async () => {
  let normalized = 0;
  let persisted = 0;
  const runtime = createWhatsAppWebhookRuntime({
    appSecret: APP_SECRET,
    clock: () => RECEIVED_AT,
    inbox: {
      async persistBatch() {
        persisted += 1;
        return { accepted: 0, duplicates: 0, reconciliation: 0 };
      },
    },
    normalize() {
      normalized += 1;
      return { events: [], media: [] };
    },
    verifyToken: 'synthetic-verify-token',
  });
  const invalidJson = Buffer.from('{invalid-json');

  await assert.rejects(
    runtime.process({
      correlationId: 'webhook-correlation-2',
      rawBody: invalidJson,
      signature: 'sha256=invalid',
    }),
    MetaWebhookAuthenticationError,
  );
  assert.equal(normalized, 0);
  assert.equal(persisted, 0);
});

test('rejects invalid UTF-8 and JSON without persistence', async () => {
  let persisted = 0;
  const runtime = createWhatsAppWebhookRuntime({
    appSecret: APP_SECRET,
    clock: () => RECEIVED_AT,
    inbox: {
      async persistBatch() {
        persisted += 1;
        return { accepted: 0, duplicates: 0, reconciliation: 0 };
      },
    },
    normalize() {
      throw new Error('normalize must not run');
    },
    verifyToken: 'synthetic-verify-token',
  });
  const invalidUtf8 = Buffer.from([0xc3, 0x28]);
  const invalidJson = Buffer.from('{invalid-json');

  await assert.rejects(
    runtime.process({
      correlationId: 'webhook-correlation-3',
      rawBody: invalidUtf8,
      signature: signature(invalidUtf8),
    }),
    MetaWebhookPayloadError,
  );
  await assert.rejects(
    runtime.process({
      correlationId: 'webhook-correlation-4',
      rawBody: invalidJson,
      signature: signature(invalidJson),
    }),
    MetaWebhookPayloadError,
  );
  assert.equal(persisted, 0);
});

test('sanitizes adapter schema failures before the HTTP boundary', async () => {
  let persisted = 0;
  const rawBody = Buffer.from('{"private_canary":"must-not-escape"}');
  const runtime = createWhatsAppWebhookRuntime({
    appSecret: APP_SECRET,
    clock: () => RECEIVED_AT,
    inbox: {
      async persistBatch() {
        persisted += 1;
        return { accepted: 0, duplicates: 0, reconciliation: 0 };
      },
    },
    normalize() {
      throw new Error('private_canary must-not-escape');
    },
    verifyToken: 'synthetic-verify-token',
  });

  await assert.rejects(
    runtime.process({
      correlationId: 'webhook-correlation-schema',
      rawBody,
      signature: signature(rawBody),
    }),
    (error) => {
      assert.ok(error instanceof MetaWebhookPayloadError);
      assert.doesNotMatch(error.message, /private_canary|must-not-escape/u);
      return true;
    },
  );
  assert.equal(persisted, 0);
});

test('rejects media metadata that is not linked to a canonical event', async () => {
  let persisted = 0;
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
  const runtime = createWhatsAppWebhookRuntime({
    appSecret: APP_SECRET,
    clock: () => RECEIVED_AT,
    inbox: {
      async persistBatch() {
        persisted += 1;
        return { accepted: 0, duplicates: 0, reconciliation: 0 };
      },
    },
    normalize() {
      return {
        events: [
          {
            disposition: 'process',
            envelope: { externalEventId: { key: 'event-a' } },
          },
        ],
        media: [
          {
            externalEventId: { key: 'event-b' },
            externalMediaId: { externalId: 'media-b' },
            mediaType: 'image',
            mimeType: 'image/png',
            providerSha256: null,
          },
        ],
      };
    },
    verifyToken: 'synthetic-verify-token',
  });

  await assert.rejects(
    runtime.process({
      correlationId: 'webhook-correlation-media',
      rawBody,
      signature: signature(rawBody),
    }),
    MetaWebhookPayloadError,
  );
  assert.equal(persisted, 0);
});

test('persists the validated batch before returning a bounded receipt', async () => {
  const rawBody = Buffer.from(
    JSON.stringify({ object: 'whatsapp_business_account' }),
  );
  const normalizedEvents = [
    Object.freeze({
      disposition: 'process',
      envelope: Object.freeze({
        externalEventId: Object.freeze({ key: 'synthetic-event-key' }),
      }),
    }),
  ];
  /** @type {Record<string, unknown> | undefined} */
  let observed;
  const runtime = createWhatsAppWebhookRuntime({
    appSecret: APP_SECRET,
    clock: () => RECEIVED_AT,
    inbox: {
      async persistBatch(input) {
        observed = input;
        return { accepted: 1, duplicates: 0, reconciliation: 0 };
      },
    },
    normalize(input) {
      assert.deepEqual(input.callback, {
        object: 'whatsapp_business_account',
      });
      assert.equal(input.receivedAt, RECEIVED_AT.toISOString());
      return {
        events: normalizedEvents,
        media: [],
      };
    },
    verifyToken: 'synthetic-verify-token',
  });

  const result = await runtime.process({
    correlationId: 'webhook-correlation-5',
    rawBody,
    signature: signature(rawBody),
  });

  assert.equal(observed?.correlationId, 'webhook-correlation-5');
  assert.equal(observed?.receivedAt, RECEIVED_AT.toISOString());
  assert.deepEqual(observed?.events, [
    {
      disposition: 'process',
      event: { externalEventId: { key: 'synthetic-event-key' } },
      media: [],
    },
  ]);
  assert.deepEqual(observed?.rawBody, rawBody);
  assert.deepEqual(result, {
    accepted: 1,
    duplicates: 0,
    received: 1,
    reconciliation: 0,
  });
});

test('composes canonical adapter events and media for the durable inbox', async () => {
  const rawBody = await readFile(
    new URL(
      '../schemas/fixtures/external/meta-whatsapp-webhook-batch.json',
      import.meta.url,
    ),
  );
  /** @type {Record<string, any> | undefined} */
  let observed;
  const runtime = createWhatsAppWebhookRuntime({
    appSecret: APP_SECRET,
    clock: () => new Date('2026-09-02T00:00:02.000Z'),
    inbox: {
      async persistBatch(input) {
        observed = input;
        return { accepted: 2, duplicates: 0, reconciliation: 0 };
      },
    },
    normalize: createMetaWhatsAppNormalizer({
      businessAccountId: 'synthetic-whatsapp-account',
      phoneNumberId: 'synthetic-phone-number',
    }),
    verifyToken: 'synthetic-verify-token',
  });

  const result = await runtime.process({
    correlationId: 'webhook-correlation-adapter',
    rawBody,
    signature: signature(rawBody),
  });

  assert.equal(observed?.events.length, 2);
  assert.equal(observed?.events[0].event.message.type, 'text');
  assert.deepEqual(observed?.events[0].media, []);
  assert.equal(observed?.events[1].event.message.type, 'image');
  assert.deepEqual(observed?.events[1].media, [
    {
      declaredMimeType: 'image/png',
      externalMediaId: 'synthetic-media-001',
      mediaType: 'image',
      providerSha256: 'synthetic-provider-sha256',
    },
  ]);
  assert.deepEqual(result, {
    accepted: 2,
    duplicates: 0,
    received: 2,
    reconciliation: 0,
  });
});

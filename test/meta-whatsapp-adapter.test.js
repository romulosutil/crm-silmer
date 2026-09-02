import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeMetaWhatsAppWebhook } from '../modules/inbox-channels/src/adapters/meta-whatsapp.js';

const rootUrl = new URL('../', import.meta.url);
const receivedAt = '2026-09-02T00:00:02.000Z';
const accountScope = {
  businessAccountId: 'synthetic-whatsapp-account',
  phoneNumberId: 'synthetic-phone-number',
};

/** @param {{callback: unknown, receivedAt: string}} input */
function normalize(input) {
  return normalizeMetaWhatsAppWebhook({ ...input, ...accountScope });
}

async function fixture() {
  return JSON.parse(
    await readFile(
      new URL(
        'schemas/fixtures/external/meta-whatsapp-webhook-batch.json',
        rootUrl,
      ),
      'utf8',
    ),
  );
}

test('normalizes a fully valid Meta batch to immutable T02.1 envelopes', async () => {
  const result = normalize({
    callback: await fixture(),
    receivedAt,
  });

  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].disposition, 'process');
  assert.equal(result.events[0].envelope.schemaVersion, 1);
  assert.equal(result.events[0].envelope.provider, 'meta');
  assert.equal(
    result.events[0].envelope.providerAccountId,
    'synthetic-whatsapp-account',
  );
  assert.equal(result.events[0].envelope.channel, 'whatsapp');
  assert.equal(result.events[0].envelope.visibility, 'inbox');
  assert.deepEqual(result.events[0].envelope.message, {
    content: { text: 'mensagem sintetica sem dado real' },
    type: 'text',
  });
  assert.deepEqual(JSON.parse(result.events[0].envelope.externalEventId.key), [
    'meta',
    'synthetic-whatsapp-account',
    'wamid.synthetic-text-001',
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.events), true);
  assert.equal(Object.isFrozen(result.events[0]), true);
});

test('returns metadata-only media with the approved seven-day receipt TTL', async () => {
  const result = normalize({
    callback: await fixture(),
    receivedAt,
  });

  assert.equal(result.media.length, 1);
  assert.deepEqual(result.media[0], {
    caption: 'imagem sintetica',
    expiresAt: '2026-09-09T00:00:02.000Z',
    externalEventId: result.events[1].envelope.externalEventId,
    externalMediaId: {
      externalId: 'synthetic-media-001',
      key: JSON.stringify([
        'meta',
        'synthetic-whatsapp-account',
        'synthetic-media-001',
      ]),
      provider: 'meta',
      providerAccountId: 'synthetic-whatsapp-account',
    },
    mediaType: 'image',
    mimeType: 'image/png',
    providerPhoneNumberId: 'synthetic-phone-number',
    providerSha256: 'synthetic-provider-sha256',
    receivedAt,
    state: 'metadata_only',
  });
  assert.equal('bytes' in result.media[0], false);
  assert.equal('url' in result.media[0], false);
});

test('rejects the whole batch before returning when any nested message is invalid', async () => {
  const callback = await fixture();
  callback.entry[0].changes[0].value.messages.push({
    from: '5500000000001',
    timestamp: '1788307202',
    type: 'text',
    text: { body: 'sem id externo' },
  });
  let output;

  assert.throws(() => {
    output = normalize({ callback, receivedAt });
  }, /invalid Meta WhatsApp webhook/u);
  assert.equal(output, undefined);
});

test('rejects missing account and phone metadata instead of creating unknown fallbacks', async () => {
  const missingAccount = await fixture();
  delete missingAccount.entry[0].id;
  const missingPhone = await fixture();
  delete missingPhone.entry[0].changes[0].value.metadata.phone_number_id;

  assert.throws(
    () => normalize({ callback: missingAccount, receivedAt }),
    /invalid Meta WhatsApp webhook/u,
  );
  assert.throws(
    () => normalize({ callback: missingPhone, receivedAt }),
    /invalid Meta WhatsApp webhook/u,
  );
});

test('reconciles events strictly older than 24 hours without changing their identity', async () => {
  const callback = await fixture();
  callback.entry[0].changes[0].value.messages = [
    callback.entry[0].changes[0].value.messages[0],
  ];

  const exactly24Hours = normalize({
    callback,
    receivedAt: '2026-09-03T00:00:00.000Z',
  });
  const stale = normalize({
    callback,
    receivedAt: '2026-09-03T00:00:00.001Z',
  });

  assert.equal(exactly24Hours.events[0].disposition, 'process');
  assert.equal(exactly24Hours.events[0].envelope.visibility, 'inbox');
  assert.equal(stale.events[0].disposition, 'reconcile');
  assert.equal(stale.events[0].envelope.visibility, 'reconciliation');
  assert.equal(
    stale.events[0].envelope.externalEventId.key,
    exactly24Hours.events[0].envelope.externalEventId.key,
  );
});

test('keeps an unknown but structurally valid message type visible for reconciliation', async () => {
  const callback = await fixture();
  callback.entry[0].changes[0].value.messages = [
    {
      from: '5500000000001',
      id: 'wamid.synthetic-sticker-001',
      sticker: { id: 'synthetic-sticker-media' },
      timestamp: '1788307200',
      type: 'sticker',
    },
  ];

  const result = normalize({ callback, receivedAt });

  assert.equal(result.events[0].disposition, 'reconcile');
  assert.equal(result.events[0].envelope.visibility, 'reconciliation');
  assert.deepEqual(result.events[0].envelope.message, {
    content: { reasonCode: 'unsupported-message-type' },
    type: 'unsupported',
  });
  assert.deepEqual(result.media, []);
});

test('rejects callbacks outside the configured account and phone scope', async () => {
  const callback = await fixture();
  const wrongAccount = structuredClone(callback);
  wrongAccount.entry[0].id = 'unexpected-waba';
  const wrongPhone = structuredClone(callback);
  wrongPhone.entry[0].changes[0].value.metadata.phone_number_id =
    'unexpected-phone';

  assert.throws(
    () => normalize({ callback: wrongAccount, receivedAt }),
    /invalid Meta WhatsApp webhook/u,
  );
  assert.throws(
    () => normalize({ callback: wrongPhone, receivedAt }),
    /invalid Meta WhatsApp webhook/u,
  );
});

test('rejects persistence-incompatible identifiers and oversized batches', async () => {
  const callback = await fixture();
  const longAccount = structuredClone(callback);
  longAccount.entry[0].id = 'a'.repeat(513);
  assert.throws(
    () => normalize({ callback: longAccount, receivedAt }),
    /invalid Meta WhatsApp webhook/u,
  );

  const longStatusIdentity = structuredClone(callback);
  longStatusIdentity.entry[0].changes[0].value.messages = [];
  longStatusIdentity.entry[0].changes[0].value.statuses = [
    {
      id: 's'.repeat(500),
      recipient_id: 'synthetic-recipient',
      status: 'delivered',
      timestamp: '1788307200',
    },
  ];
  assert.throws(
    () => normalize({ callback: longStatusIdentity, receivedAt }),
    /invalid Meta WhatsApp webhook/u,
  );

  const oversized = structuredClone(callback);
  const message = oversized.entry[0].changes[0].value.messages[0];
  oversized.entry[0].changes[0].value.messages = Array.from(
    { length: 101 },
    (_, index) => ({ ...message, id: `wamid.synthetic-${index}` }),
  );
  oversized.entry[0].changes[0].value.statuses = [];
  assert.throws(
    () => normalize({ callback: oversized, receivedAt }),
    /invalid Meta WhatsApp webhook/u,
  );
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ChannelContractError,
  assertChannelAdapterContract,
  createCanonicalInboundEnvelope,
  createCanonicalOutboundEnvelope,
  createScopedExternalId,
} from '../modules/inbox-channels/src/index.js';

const rootUrl = new URL('../', import.meta.url);

/** @param {string} path */
async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
}

test('normalizes WhatsApp and Instagram fixtures to the same canonical shape', async () => {
  const whatsapp = createCanonicalInboundEnvelope(
    await json(
      'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
    ),
  );
  const instagram = createCanonicalInboundEnvelope(
    await json(
      'schemas/fixtures/external/meta-instagram-canonical-inbound.json',
    ),
  );

  assert.deepEqual(Object.keys(whatsapp), Object.keys(instagram));
  assert.deepEqual(
    Object.keys(whatsapp.identity),
    Object.keys(instagram.identity),
  );
  assert.deepEqual(
    Object.keys(whatsapp.message),
    Object.keys(instagram.message),
  );
  assert.equal(whatsapp.schemaVersion, 1);
  assert.equal(whatsapp.direction, 'inbound');
  assert.equal(whatsapp.channel, 'whatsapp');
  assert.equal(instagram.channel, 'instagram');
  assert.equal(whatsapp.provider, 'meta');
  assert.equal(instagram.provider, 'meta');
  assert.equal(whatsapp.visibility, 'inbox');
  assert.equal(instagram.visibility, 'inbox');
});

test('scopes every external id by provider and provider account', () => {
  const first = createScopedExternalId({
    externalId: 'same-id',
    provider: 'meta',
    providerAccountId: 'account-a',
  });
  const second = createScopedExternalId({
    externalId: 'same-id',
    provider: 'meta',
    providerAccountId: 'account-b',
  });
  const third = createScopedExternalId({
    externalId: 'same-id',
    provider: 'another-provider',
    providerAccountId: 'account-a',
  });

  assert.notEqual(first.key, second.key);
  assert.notEqual(first.key, third.key);
  assert.deepEqual(JSON.parse(first.key), ['meta', 'account-a', 'same-id']);
  assert.equal(Object.isFrozen(first), true);
});

test('keeps site as WhatsApp origin instead of inventing another channel', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
  );
  fixture.origin = 'site';
  const envelope = createCanonicalInboundEnvelope(fixture);

  assert.equal(envelope.origin, 'site');
  assert.equal(envelope.channel, 'whatsapp');
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        channel: 'instagram',
      }),
    /site.*WhatsApp|WhatsApp.*site/iu,
  );
});

test('keeps Instagram handle pending and forbids automatic identity merge', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-instagram-canonical-inbound.json',
  );
  const envelope = createCanonicalInboundEnvelope(fixture);

  assert.deepEqual(envelope.identity, {
    automaticMergeAllowed: false,
    displayHandle: '@cliente_sintetico',
    externalId: createScopedExternalId({
      externalId: 'synthetic-instagram-identity-001',
      provider: 'meta',
      providerAccountId: 'synthetic-instagram-account',
    }),
    kind: 'handle',
    mergePolicy: 'verified-evidence-only',
    phoneStatus: 'pending',
  });

  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        identity: {
          ...fixture.identity,
          automaticMergeAllowed: true,
        },
      }),
    /automatic.*merge/iu,
  );
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        identity: {
          ...fixture.identity,
          displayHandle: 'Cliente por nome',
        },
      }),
    /Instagram.*handle|handle.*Instagram/iu,
  );
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        identity: {
          ...fixture.identity,
          displayHandle: 'Cliente por nome',
          kind: 'phone',
          phoneStatus: 'confirmed',
        },
      }),
    /pending @handle/u,
  );
});

test('preserves channel and scoped identifiers for inbox or reconciliation', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
  );
  const reconciliation = createCanonicalInboundEnvelope({
    ...fixture,
    visibility: 'reconciliation',
  });

  assert.equal(reconciliation.visibility, 'reconciliation');
  assert.equal(reconciliation.channel, 'whatsapp');
  assert.deepEqual(JSON.parse(reconciliation.externalEventId.key), [
    'meta',
    'synthetic-whatsapp-account',
    'synthetic-whatsapp-event-001',
  ]);
  assert.deepEqual(JSON.parse(reconciliation.externalMessageId.key), [
    'meta',
    'synthetic-whatsapp-account',
    'synthetic-whatsapp-message-001',
  ]);
  assert.throws(
    () => createCanonicalInboundEnvelope({ ...fixture, visibility: 'drop' }),
    ChannelContractError,
  );
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        message: {
          content: { reasonCode: 'unsupported-provider-message' },
          type: 'unsupported',
        },
      }),
    /reconciliation/u,
  );
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        message: {
          content: { reasonCode: 'cliente@example.com' },
          type: 'unsupported',
        },
        visibility: 'reconciliation',
      }),
    /canonical code/u,
  );
});

test('defines a provider-neutral immutable outbound envelope', () => {
  const envelope = createCanonicalOutboundEnvelope({
    channel: 'whatsapp',
    commandId: 'synthetic-command-001',
    externalConversationId: 'synthetic-conversation-001',
    message: {
      content: { text: 'mensagem sintetica' },
      type: 'text',
    },
    provider: 'meta',
    providerAccountId: 'synthetic-account',
    recipientExternalId: 'synthetic-recipient-001',
  });

  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.direction, 'outbound');
  assert.equal(envelope.channel, 'whatsapp');
  assert.equal('messaging_product' in envelope, false);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.message.content), true);
  assert.throws(() => {
    const mutableContent = /** @type {any} */ (envelope.message.content);
    mutableContent.text = 'alterada';
  }, TypeError);
});

test('rejects provider-specific and ambiguous fields at the canonical boundary', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
  );

  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        messaging_product: 'whatsapp',
      }),
    /inbound envelope has unknown fields/u,
  );
  assert.throws(
    () =>
      createCanonicalOutboundEnvelope({
        channel: 'site',
        commandId: 'synthetic-command-001',
        externalConversationId: 'synthetic-conversation-001',
        message: { content: { text: 'synthetic' }, type: 'text' },
        provider: 'meta',
        providerAccountId: 'synthetic-account',
        recipientExternalId: 'synthetic-recipient-001',
      }),
    /channel/iu,
  );
  for (const direction of ['inbound', 'outbound']) {
    const create =
      direction === 'inbound'
        ? () =>
            createCanonicalInboundEnvelope({
              ...fixture,
              message: {
                content: {
                  messaging_product: 'whatsapp',
                  raw: { recipient: 'cliente@example.com' },
                  text: 'synthetic',
                },
                type: 'text',
              },
            })
        : () =>
            createCanonicalOutboundEnvelope({
              channel: 'whatsapp',
              commandId: 'synthetic-command-001',
              externalConversationId: 'synthetic-conversation-001',
              message: {
                content: {
                  messaging_product: 'whatsapp',
                  raw: { recipient: 'cliente@example.com' },
                  text: 'synthetic',
                },
                type: 'text',
              },
              provider: 'meta',
              providerAccountId: 'synthetic-account',
              recipientExternalId: 'synthetic-recipient-001',
            });
    assert.throws(create, /message\.content has unknown fields/u);
  }
});

test('defines the port required from concrete channel adapters', () => {
  assert.doesNotThrow(() =>
    assertChannelAdapterContract({
      channel: 'whatsapp',
      normalizeInbound() {},
      prepareOutbound() {},
      provider: 'meta',
    }),
  );
  assert.throws(
    () =>
      assertChannelAdapterContract({
        channel: 'whatsapp',
        normalizeInbound() {},
        provider: 'meta',
      }),
    /prepareOutbound/u,
  );
  assert.throws(
    () =>
      assertChannelAdapterContract({
        channel: {
          toString() {
            throw new Error('channel coercion must not run');
          },
        },
        normalizeInbound() {},
        prepareOutbound() {},
        provider: 'meta',
      }),
    /channel/u,
  );
});

test('rejects missing scope and non-canonical timestamps', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
  );
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        providerAccountId: '',
      }),
    /providerAccountId/u,
  );
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        occurredAt: '2026-09-02 12:00:00',
      }),
    /canonical ISO/u,
  );
});

test('never reflects untrusted field names in contract errors', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
  );
  const canary = 'cliente@example.com';
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        [canary]: 'synthetic',
      }),
    (error) => {
      assert.ok(error instanceof ChannelContractError);
      assert.doesNotMatch(error.message, new RegExp(canary, 'u'));
      return true;
    },
  );
  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        identity: { ...fixture.identity, [canary]: 'synthetic' },
      }),
    (error) => {
      assert.ok(error instanceof ChannelContractError);
      assert.doesNotMatch(error.message, new RegExp(canary, 'u'));
      return true;
    },
  );
});

test('rejects non-JSON message content that cannot be made immutable', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
  );

  assert.throws(
    () =>
      createCanonicalInboundEnvelope({
        ...fixture,
        message: {
          content: new Map([['text', 'synthetic']]),
          type: 'text',
        },
      }),
    ChannelContractError,
  );
});

test('clones and freezes inbound content independently from its input', async () => {
  const fixture = await json(
    'schemas/fixtures/external/meta-whatsapp-canonical-inbound.json',
  );
  const envelope = createCanonicalInboundEnvelope(fixture);
  fixture.message.content.text = 'mutated after normalization';

  assert.equal(
    envelope.message.content.text,
    'mensagem sintetica sem dado real',
  );
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.identity.externalId), true);
  assert.equal(Object.isFrozen(envelope.message.content), true);
});

test('supports Instagram outbound without leaking a Meta wire shape', () => {
  const envelope = createCanonicalOutboundEnvelope({
    channel: 'instagram',
    commandId: 'synthetic-instagram-command-001',
    externalConversationId: 'synthetic-instagram-conversation-001',
    message: { content: { text: 'synthetic' }, type: 'text' },
    provider: 'meta',
    providerAccountId: 'synthetic-instagram-account',
    recipientExternalId: 'synthetic-instagram-recipient-001',
  });

  assert.equal(envelope.channel, 'instagram');
  assert.deepEqual(envelope.message, {
    content: { text: 'synthetic' },
    type: 'text',
  });
  assert.equal('messaging_product' in envelope.message.content, false);
});

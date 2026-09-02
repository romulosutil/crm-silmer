import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createChannelEventHandler,
  createChannelEventJobHandler,
} from '../modules/inbox-channels/src/index.js';

function canonicalEvent(overrides = {}) {
  return {
    channel: 'instagram',
    direction: 'inbound',
    externalConversationId: { externalId: 'conversation-1' },
    externalEventId: { externalId: 'event-1' },
    externalMessageId: { externalId: 'message-1' },
    identity: {
      automaticMergeAllowed: false,
      displayHandle: '@cliente_sintetico',
      externalId: { externalId: 'identity-1' },
      kind: 'handle',
      mergePolicy: 'verified-evidence-only',
      phoneStatus: 'pending',
    },
    message: {
      content: { text: 'PII-canary-mensagem-cliente' },
      type: 'text',
    },
    occurredAt: '2026-09-02T12:00:00.000Z',
    origin: 'channel',
    provider: 'meta',
    providerAccountId: 'account-a',
    schemaVersion: 1,
    visibility: 'inbox',
    ...overrides,
  };
}

test('turns one canonical event into an anchored provisional contact and inbox message', async () => {
  /** @type {{identities: any[], messages: any[]}} */
  const observed = { identities: [], messages: [] };
  const handler = createChannelEventHandler({
    contactIdentityService: {
      async resolveInboundIdentity(/** @type {any} */ input) {
        observed.identities.push(structuredClone(input));
        return {
          contact: { id: 'contact-1', provisional: true },
          identity: { id: 'identity-1' },
        };
      },
    },
    inboxService: {
      async receiveInbound(/** @type {any} */ input) {
        observed.messages.push(structuredClone(input));
        return {
          conversation: { id: 'conversation-internal-1', state: 'nova' },
          message: { id: 'message-internal-1' },
        };
      },
    },
  });

  const result = await handler.process({
    channelEventId: 'channel-event-1',
    correlationId: 'correlation-1',
    event: canonicalEvent(),
  });
  assert.equal(result.conversation.state, 'nova');
  assert.equal(observed.identities.length, 1);
  assert.deepEqual(observed.identities[0], {
    channel: 'instagram',
    correlationId: 'correlation-1',
    displayHandle: '@cliente_sintetico',
    externalIdentityId: 'identity-1',
    identityKind: 'handle',
    occurredAt: '2026-09-02T12:00:00.000Z',
    phoneStatus: 'pending',
    provider: 'meta',
    providerAccountId: 'account-a',
  });
  assert.equal(observed.messages[0].contactId, 'contact-1');
  assert.equal(observed.messages[0].channelEventId, 'channel-event-1');
  assert.equal(observed.messages[0].identityId, 'identity-1');
  assert.equal(
    observed.messages[0].message.content.text,
    'PII-canary-mensagem-cliente',
  );
});

test('never forwards plaintext PII to audit or technical logger dimensions', async () => {
  /** @type {any[]} */
  const audits = [];
  /** @type {any[]} */
  const logs = [];
  const handler = createChannelEventHandler({
    auditPort: {
      append: async (/** @type {any} */ event) => audits.push(event),
    },
    contactIdentityService: {
      resolveInboundIdentity: async () => ({
        contact: { id: 'contact-1', provisional: true },
        identity: { id: 'identity-1' },
      }),
    },
    inboxService: {
      receiveInbound: async () => {
        throw Object.assign(new Error('PII-canary-mensagem-cliente'), {
          code: 'INBOX_WRITE_FAILED',
        });
      },
    },
    logger: {
      error: (/** @type {any} */ event, /** @type {any} */ context) =>
        logs.push({ event, ...context }),
    },
  });

  await assert.rejects(
    handler.process({
      correlationId: 'correlation-1',
      event: canonicalEvent(),
    }),
    /PII-canary/u,
  );
  assert.doesNotMatch(
    JSON.stringify({ audits, logs }),
    /PII-canary|@cliente_sintetico/u,
  );
  assert.equal(logs[0].error_code, 'INBOX_WRITE_FAILED');
});

test('preserves provider-account isolation and does not request automatic identity merge', async () => {
  /** @type {any[]} */
  const identities = [];
  const handler = createChannelEventHandler({
    contactIdentityService: {
      async resolveInboundIdentity(/** @type {any} */ input) {
        identities.push(input);
        return {
          contact: { id: `contact-${input.providerAccountId}` },
          identity: { id: `identity-${input.providerAccountId}` },
        };
      },
    },
    inboxService: {
      receiveInbound: async (/** @type {any} */ input) => ({
        conversation: { id: `conversation-${input.providerAccountId}` },
        message: { id: `message-${input.providerAccountId}` },
      }),
    },
  });

  const [left, right] = await Promise.all([
    handler.process({ correlationId: 'left', event: canonicalEvent() }),
    handler.process({
      correlationId: 'right',
      event: canonicalEvent({ providerAccountId: 'account-b' }),
    }),
  ]);
  assert.notEqual(left.conversation.id, right.conversation.id);
  assert.deepEqual(
    identities.map(({ providerAccountId }) => providerAccountId).sort(),
    ['account-a', 'account-b'],
  );
  assert.equal(
    identities.some((identity) => identity.automaticMergeAllowed === true),
    false,
  );
});

test('loads the durable event identified by the worker job and settles only after processing', async () => {
  /** @type {any[]} */
  const calls = [];
  const jobHandler = createChannelEventJobHandler({
    channelEventHandler: {
      async process(/** @type {any} */ record) {
        calls.push(['process', structuredClone(record)]);
      },
    },
    eventStore: {
      async readCanonicalEventRecord(/** @type {string} */ id) {
        calls.push(['read', id]);
        return {
          correlationId: 'correlation-job-1',
          event: canonicalEvent(),
        };
      },
    },
  });

  assert.deepEqual(await jobHandler({ channelEventId: 'channel-event-1' }), {
    outcome: 'sent',
  });
  assert.deepEqual(calls, [
    ['read', 'channel-event-1'],
    [
      'process',
      {
        channelEventId: 'channel-event-1',
        correlationId: 'correlation-job-1',
        event: canonicalEvent(),
      },
    ],
  ]);
});

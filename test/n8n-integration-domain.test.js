import assert from 'node:assert/strict';
import test from 'node:test';

import {
  N8nForbiddenError,
  N8nValidationError,
  createN8nIntegrationService,
} from '../modules/n8n-integration/src/index.js';

const NOW = new Date('2026-09-07T15:00:00.000Z');
const TECHNICAL = Object.freeze({
  actor: 'AUTOMATION_EXECUTOR',
  correlationId: 'correlation-1',
  credentialVersion: 'current',
  executionId: 'execution-1',
  idempotencyKey: 'idempotency-1',
  requestId: 'request-1',
  workflowKey: 'seller-v1',
  workflowVersion: '1.0.0',
});

function harness() {
  /** @type {{input: any, method: string, runtime: any}[]} */
  const calls = [];
  const repository = /** @type {any} */ (
    Object.fromEntries(
      ['receiveInbound', 'storeAttachment', 'recordEvent'].map((method) => [
        method,
        async (/** @type {any} */ input, /** @type {any} */ runtime) => {
          calls.push({ input, method, runtime });
          return { accepted: true, method };
        },
      ]),
    )
  );
  return {
    calls,
    service: createN8nIntegrationService({
      clock: () => NOW,
      idFactory: (kind) => `${kind}-1`,
      repository,
    }),
  };
}

test('normalizes WhatsApp buttons inside canonical text content', async () => {
  const { calls, service } = harness();
  await service.receiveInbound({
    channel: 'whatsapp',
    contact: { name: 'Cliente', wa_id: '5511000000000' },
    event_id: 'wa-event-1',
    message: {
      button: { id: 'quote', title: 'Quero orçamento' },
      external_id: 'wa-message-1',
      text: 'Quero orçamento',
      type: 'button',
    },
    metadata: { phone_number_id: 'wa-account-1' },
    occurred_at: NOW.toISOString(),
    schema_version: '1.0',
    technical: TECHNICAL,
  });

  const normalized = calls[0].input;
  assert.equal(normalized.channel, 'whatsapp');
  assert.equal(normalized.identityKind, 'phone');
  assert.equal(normalized.message.type, 'text');
  assert.deepEqual(normalized.message.content, {
    interaction: {
      payload: { id: 'quote', title: 'Quero orçamento' },
      type: 'button',
    },
    text: 'Quero orçamento',
  });
  assert.equal(normalized.technical.actor, 'AUTOMATION_EXECUTOR');
});

test('passes source revision, epoch and briefing patch to the event repository', async () => {
  const { calls, service } = harness();
  for (const eventType of ['message.send.requested', 'message.send.unknown']) {
    await service.recordEvent({
      automation_epoch: 3,
      ...(eventType === 'message.send.requested'
        ? { briefing_patch: { segment: 'uniform' } }
        : {}),
      command_id: 'command-1',
      conversation_id: 'conversation-1',
      event_id: `${eventType}-1`,
      event_type: eventType,
      message: { text: 'Mensagem segura', type: 'text' },
      occurred_at: NOW.toISOString(),
      source_revision: 7,
      schema_version: '1.0',
      technical: {
        ...TECHNICAL,
        idempotencyKey: `${eventType}-1`,
      },
    });
  }
  assert.deepEqual(
    calls.map(({ input }) => input.eventType),
    ['message.send.requested', 'message.send.unknown'],
  );
  assert.deepEqual(
    calls.map(({ input }) => [
      input.automationEpoch,
      input.sourceRevision,
      input.briefingPatch,
    ]),
    [
      [3, 7, { segment: 'uniform' }],
      [3, 7, null],
    ],
  );
});

test('rejects Instagram until the channel-specific phase is delivered', async () => {
  const { service } = harness();
  await assert.rejects(
    service.receiveInbound({
      channel: 'instagram',
      occurred_at: NOW.toISOString(),
      schema_version: '1.0',
      technical: TECHNICAL,
    }),
    (error) =>
      error instanceof N8nValidationError &&
      error.message === 'channel is unsupported',
  );
});

test('rejects a non-technical actor and malformed contract with typed HTTP errors', async () => {
  const { service } = harness();
  await assert.rejects(
    service.receiveInbound({ technical: { ...TECHNICAL, actor: 'user-1' } }),
    (error) => error instanceof N8nForbiddenError && error.statusCode === 403,
  );
  await assert.rejects(
    service.recordEvent({
      event_type: 'unsupported.event',
      schema_version: '1.0',
      technical: TECHNICAL,
    }),
    (error) => error instanceof N8nValidationError && error.statusCode === 400,
  );
  await assert.rejects(
    service.recordEvent({
      automation_epoch: 0,
      command_id: 'command-without-source-revision',
      conversation_id: 'conversation-1',
      event_id: 'send-without-source-revision',
      event_type: 'message.send.requested',
      message: { text: 'Mensagem sem fence completo', type: 'text' },
      occurred_at: NOW.toISOString(),
      schema_version: '1.0',
      technical: TECHNICAL,
    }),
    (error) =>
      error instanceof N8nValidationError &&
      /source_revision/u.test(error.message),
  );
});

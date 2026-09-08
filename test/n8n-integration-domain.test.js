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
      ['receiveInbound', 'storeAttachment', 'claimAiTurn', 'recordEvent'].map(
        (method) => [
          method,
          async (/** @type {any} */ input, /** @type {any} */ runtime) => {
            calls.push({ input, method, runtime });
            return { accepted: true, method };
          },
        ],
      ),
    )
  );
  return {
    calls,
    service: createN8nIntegrationService({
      claimLeaseMs: 45_000,
      clock: () => NOW,
      idFactory: (kind) => `${kind}-1`,
      repository,
      tokenFactory: () => 'claim-token-1',
    }),
  };
}

test('normalizes both channels and keeps button payload inside canonical text content', async () => {
  const { calls, service } = harness();
  await service.receiveInbound({
    channel: 'instagram',
    contact: { external_id: 'ig-user-1', handle: '@cliente' },
    event_id: 'ig-event-1',
    external_conversation_id: 'ig-thread-1',
    message: {
      button: { id: 'quote', title: 'Quero orçamento' },
      external_id: 'ig-message-1',
      text: 'Quero orçamento',
      type: 'button',
    },
    metadata: { provider_account_id: 'ig-account-1' },
    occurred_at: NOW.toISOString(),
    schema_version: '1.0',
    technical: TECHNICAL,
  });

  const normalized = calls[0].input;
  assert.equal(normalized.channel, 'instagram');
  assert.equal(normalized.identityKind, 'handle');
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

test('passes claim epoch, token runtime and every v1 event to the repository', async () => {
  const { calls, service } = harness();
  await service.claimAiTurn({
    automation_epoch: 3,
    conversation_id: 'conversation-1',
    last_event_id: 'event-7',
    revision: 7,
    schema_version: '1.0',
    technical: TECHNICAL,
    worker_id: 'worker-1',
  });
  assert.equal(calls[0].input.automationEpoch, 3);
  assert.equal(calls[0].runtime.claimLeaseMs, 45_000);
  assert.equal(calls[0].runtime.tokenFactory(), 'claim-token-1');

  for (const eventType of ['message.send.requested', 'message.send.unknown']) {
    await service.recordEvent({
      automation_epoch: 3,
      claim_id: 'claim-1',
      claim_token: 'claim-token-1',
      command_id: 'command-1',
      conversation_id: 'conversation-1',
      event_id: `${eventType}-1`,
      event_type: eventType,
      message: { text: 'Mensagem segura', type: 'text' },
      occurred_at: NOW.toISOString(),
      expected_version: 4,
      revision: 7,
      schema_version: '1.0',
      technical: {
        ...TECHNICAL,
        idempotencyKey: `${eventType}-1`,
      },
    });
  }
  assert.deepEqual(
    calls.slice(1).map(({ input }) => input.eventType),
    ['message.send.requested', 'message.send.unknown'],
  );
  assert.deepEqual(
    calls
      .slice(1)
      .map(({ input }) => [
        input.claimId,
        input.revision,
        input.expectedVersion,
      ]),
    [
      ['claim-1', 7, 4],
      ['claim-1', 7, 4],
    ],
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
});

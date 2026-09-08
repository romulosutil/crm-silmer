import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ContractValidationError,
  validateBriefingPatch,
  validateClaimRequest,
  validateEvent,
} from '../schemas/fixtures/external/n8n/contract-validator.mjs';

const fixtureRoot = new URL(
  '../schemas/fixtures/external/n8n/',
  import.meta.url,
);
const workflowSnapshot = new URL(
  '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-0c41ee97-954b-4319-b822-fbb91f239b6e.sanitized.json',
  import.meta.url,
);
const claimLeaseMs = 30_000;

/** @param {string} name @returns {Promise<any>} */
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}

class ConversationFenceHarness {
  constructor() {
    this.automationEpoch = 3;
    /** @type {any} */
    this.claim = null;
    this.mode = 'assistant';
    this.revision = 7;
    this.version = 11;
    this.reservedAttempts = new Map();
  }

  /** @param {any} request @param {number} now @returns {any} */
  claimTurn(request, now) {
    validateClaimRequest(request);
    if (this.mode !== 'assistant') return denied('MODE_NOT_AI_ACTIVE');
    if (request.automation_epoch !== this.automationEpoch) {
      return denied('STALE_AUTOMATION_EPOCH');
    }
    if (request.revision !== this.revision) return denied('STALE_REVISION');
    if (this.claim && this.claim.expiresAt > now) {
      if (this.claim.claimId === request.claim_id) return this.claim.result;
      return denied('ALREADY_CLAIMED');
    }
    const expiresAt = now + claimLeaseMs;
    const result = Object.freeze({
      automation_epoch: this.automationEpoch,
      claim_id: request.claim_id,
      claim_token: `claim:${request.claim_id}:${this.automationEpoch}`,
      claimed: true,
      conversation_id: request.conversation_id,
      conversation_version: this.version,
      lease_expires_at: new Date(expiresAt).toISOString(),
      revision: this.revision,
    });
    this.claim = {
      claimId: request.claim_id,
      expiresAt,
      result,
    };
    return result;
  }

  takeover() {
    this.automationEpoch += 1;
    this.mode = 'human';
    this.version += 1;
  }

  returnToAssistant() {
    this.automationEpoch += 1;
    this.mode = 'assistant';
    this.version += 1;
  }

  /** @param {any} event @param {any} contract @param {number} now */
  requestSend(event, contract, now) {
    validateEvent(event, contract);
    const existing = this.reservedAttempts.get(event.attempt_id);
    const fingerprint = JSON.stringify(event);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ContractValidationError('IDEMPOTENCY_KEY_REUSED');
      }
      return existing.reservation;
    }
    if (
      this.mode !== 'assistant' ||
      event.automation_epoch !== this.automationEpoch ||
      event.revision !== this.revision ||
      event.expected_version !== this.version ||
      !this.claim ||
      event.claim_id !== this.claim.result.claim_id ||
      event.claim_token !== this.claim.result.claim_token ||
      this.claim.expiresAt <= now ||
      this.claim.used === true
    ) {
      throw new ContractValidationError('STALE_SEND_FENCE');
    }
    const reservation = Object.freeze({
      attempt_id: event.attempt_id,
      authorized: true,
      automation_epoch: this.automationEpoch,
    });
    this.claim.used = true;
    this.reservedAttempts.set(event.attempt_id, { fingerprint, reservation });
    return reservation;
  }
}

/** @param {string} reason */
function denied(reason) {
  return Object.freeze({ claimed: false, reason });
}

/**
 * @param {string|null} current
 * @param {string} incoming
 * @param {string[]} order
 */
function applyDeliveryStatus(current, incoming, order) {
  if (incoming === 'failed') return current;
  const currentRank = current === null ? -1 : order.indexOf(current);
  const incomingRank = order.indexOf(incoming);
  if (incomingRank < 0) throw new ContractValidationError('INVALID_STATUS');
  return incomingRank > currentRank ? incoming : current;
}

/** @param {Record<string, unknown>} current @param {any} patch @param {any} contract */
function applyBriefingPatch(current, patch, contract) {
  validateBriefingPatch(patch, contract);
  return Object.fromEntries([
    ...Object.entries(current),
    ...Object.entries(patch).filter(([, value]) => value !== null),
  ]);
}

test('grants exactly one live claim per conversation revision', async () => {
  const request = await fixture('ai-turn-claim-request.json');
  const fence = new ConversationFenceHarness();
  const competitor = {
    ...request,
    claim_id: 'claim-synthetic-competitor',
    worker_id: 'worker-n8n-synthetic-competitor',
  };

  const [first, second] = await Promise.all([
    Promise.resolve().then(() => fence.claimTurn(request, 1_000)),
    Promise.resolve().then(() => fence.claimTurn(competitor, 1_000)),
  ]);

  assert.equal([first, second].filter(({ claimed }) => claimed).length, 1);
  assert.equal(
    [first, second].filter(({ reason }) => reason === 'ALREADY_CLAIMED').length,
    1,
  );
  assert.deepEqual(fence.claimTurn(request, 1_001), first);
});

test('allows lease recovery but rejects the expired claim token at send time', async () => {
  const contract = await fixture('contract-v1.json');
  const request = await fixture('ai-turn-claim-request.json');
  const event = await fixture('message-send-requested.json');
  const fence = new ConversationFenceHarness();
  const first = fence.claimTurn(request, 1_000);
  const successor = {
    ...request,
    claim_id: 'claim-synthetic-successor',
    worker_id: 'worker-n8n-synthetic-successor',
  };
  const reclaimed = fence.claimTurn(successor, 31_001);
  const staleEvent = { ...event, claim_token: first.claim_token };

  assert.equal(first.claimed, true);
  assert.equal(reclaimed.claimed, true);
  assert.notEqual(reclaimed.claim_token, first.claim_token);
  assert.throws(
    () => fence.requestSend(staleEvent, contract, 31_002),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === 'STALE_SEND_FENCE',
  );
});

test('takeover invalidates a claimed execution before message.send.requested', async () => {
  const contract = await fixture('contract-v1.json');
  const request = await fixture('ai-turn-claim-request.json');
  const event = await fixture('message-send-requested.json');
  const fence = new ConversationFenceHarness();
  const claim = fence.claimTurn(request, 1_000);
  const claimedEvent = { ...event, claim_token: claim.claim_token };
  assert.equal(claim.claimed, true);

  fence.takeover();
  assert.throws(
    () => fence.requestSend(claimedEvent, contract, 1_001),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === 'STALE_SEND_FENCE',
  );

  fence.returnToAssistant();
  assert.throws(
    () => fence.requestSend(claimedEvent, contract, 1_002),
    /STALE_SEND_FENCE/u,
  );
});

test('reserves one send attempt only after the current epoch and claim pass', async () => {
  const contract = await fixture('contract-v1.json');
  const request = await fixture('ai-turn-claim-request.json');
  const event = await fixture('message-send-requested.json');
  const fence = new ConversationFenceHarness();
  const claim = fence.claimTurn(request, 1_000);
  const claimedEvent = { ...event, claim_token: claim.claim_token };

  const [first, replay] = await Promise.all([
    Promise.resolve().then(() =>
      fence.requestSend(claimedEvent, contract, 1_001),
    ),
    Promise.resolve().then(() =>
      fence.requestSend(claimedEvent, contract, 1_001),
    ),
  ]);
  assert.deepEqual(replay, first);
  assert.equal(fence.reservedAttempts.size, 1);
  assert.throws(
    () =>
      fence.requestSend(
        {
          ...claimedEvent,
          attempt_id: 'attempt-send-synthetic-002',
        },
        contract,
        1_001,
      ),
    /STALE_SEND_FENCE/u,
  );
  assert.throws(
    () =>
      fence.requestSend(
        {
          ...claimedEvent,
          message: { type: 'text', text: 'divergent synthetic content' },
        },
        contract,
        1_001,
      ),
    /IDEMPOTENCY_KEY_REUSED/u,
  );
});

test('accepts only briefing fields from lead_patch', async () => {
  const contract = await fixture('contract-v1.json');
  const event = await fixture('message-send-requested.json');
  assert.equal(validateBriefingPatch(event.lead_patch, contract), true);

  for (const forbidden of [
    { payment_confirmed: true },
    { price: 100 },
    { stage: 'Fechado' },
  ]) {
    assert.throws(() => validateBriefingPatch(forbidden, contract));
  }
  assert.deepEqual(
    applyBriefingPatch(
      { quantity: 10, segment: 'uniform' },
      { quantity: 30, segment: null },
      contract,
    ),
    { quantity: 30, segment: 'uniform' },
  );
});

test('never regresses delivery status when callbacks arrive out of order', async () => {
  const contract = await fixture('contract-v1.json');
  let status = null;
  for (const incoming of ['sent', 'delivered', 'read', 'delivered', 'sent']) {
    status = applyDeliveryStatus(
      status,
      incoming,
      contract.deliveryStatusOrder,
    );
  }
  assert.equal(status, 'read');
  assert.equal(
    applyDeliveryStatus('delivered', 'failed', contract.deliveryStatusOrder),
    'delivered',
    'failed belongs to its attempt and must not regress an observed delivery',
  );
});

test('versions the inactive workflow with end-to-end AI claim fences', async () => {
  const workflow = JSON.parse(await readFile(workflowSnapshot, 'utf8'));
  assert.equal(
    workflow.source.versionId,
    '0c41ee97-954b-4319-b822-fbb91f239b6e',
  );
  assert.equal(workflow.source.active, false);
  assert.equal(workflow.source.activeVersionId, null);
  assert.equal(workflow.nodes.length, 87);

  const byName = new Map(
    workflow.nodes.map((/** @type {any} */ node) => [node.name, node]),
  );
  for (const name of [
    'Preparar reserva de envio da IA',
    'Preparar reserva do fallback',
    'Preparar evento de saída',
    'Preparar evento de fallback da IA',
    'Preparar envio desconhecido da IA',
    'Preparar envio desconhecido do fallback',
  ]) {
    const code = byName.get(name)?.parameters?.jsCode ?? '';
    for (const fence of [
      'claim_id',
      'claim_token',
      'revision',
      'expected_version',
      'automation_epoch',
    ]) {
      assert.match(
        code,
        new RegExp(`\\b${fence}\\b`, 'u'),
        `${name}: ${fence}`,
      );
    }
  }
  assert.doesNotMatch(
    byName.get('Preparar evento de mensagem humana').parameters.jsCode,
    /\bactor\b/u,
  );
  const uploadHeaders = byName
    .get('Painel - Armazenar anexo')
    .parameters.headerParameters.parameters.map(
      (/** @type {{name: string}} */ { name }) => name,
    );
  assert.equal(uploadHeaders.includes('Content-Type'), false);
  assert.equal(uploadHeaders.includes('X-Silmer-Content-SHA256'), true);
  const sends = workflow.nodes.filter(
    (/** @type {any} */ node) =>
      node.type === 'n8n-nodes-base.whatsApp' &&
      node.parameters?.operation === 'send',
  );
  assert.equal(sends.length, 7);
  const predecessors = new Map();
  for (const [source, connectionTypes] of Object.entries(
    workflow.connections,
  )) {
    for (const outputs of Object.values(/** @type {any} */ (connectionTypes))) {
      for (const branch of /** @type {any[]} */ (outputs)) {
        for (const edge of branch ?? []) {
          const incoming = predecessors.get(edge.node) ?? [];
          incoming.push(source);
          predecessors.set(edge.node, incoming);
        }
      }
    }
  }
  for (const send of sends) {
    const pending = [send.name];
    const ancestors = new Set();
    while (pending.length > 0) {
      const current = pending.shift();
      for (const predecessor of predecessors.get(current) ?? []) {
        if (ancestors.has(predecessor)) continue;
        ancestors.add(predecessor);
        pending.push(predecessor);
      }
    }
    assert.equal(
      [...ancestors].some((name) => name.startsWith('Painel - Reservar envio')),
      true,
      `${send.name} precisa passar pela reserva do CRM`,
    );
  }
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /silmer_failures|windowBufferMemory/u);
  assert.doesNotMatch(serialized, /credentials|webhookId|pinData/u);
});

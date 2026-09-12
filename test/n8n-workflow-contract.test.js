import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ContractValidationError,
  validateBriefingPatch,
  validateEvent,
} from '../schemas/fixtures/external/n8n/contract-validator.mjs';

const fixtureRoot = new URL(
  '../schemas/fixtures/external/n8n/',
  import.meta.url,
);
const workflowSnapshot = new URL(
  '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
  import.meta.url,
);

/** @param {string} name @returns {Promise<any>} */
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}

class ConversationFenceHarness {
  constructor() {
    this.automationEpoch = 3;
    this.claimedRevision = 6;
    this.mode = 'assistant';
    this.revision = 7;
    this.reservations = new Map();
  }

  takeover() {
    this.automationEpoch += 1;
    this.mode = 'human';
  }

  /** @param {any} event @param {any} contract */
  reserve(event, contract) {
    validateEvent(event, contract);
    const fingerprint = JSON.stringify(event);
    const existing = this.reservations.get(event.command_id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ContractValidationError('IDEMPOTENCY_KEY_REUSED');
      }
      return { send_authorized: false };
    }
    if (
      this.mode !== 'assistant' ||
      event.automation_epoch !== this.automationEpoch ||
      event.source_revision !== this.revision ||
      this.claimedRevision >= event.source_revision
    ) {
      throw new ContractValidationError('STALE_AUTOMATION_FENCE');
    }
    this.claimedRevision = event.source_revision;
    this.reservations.set(event.command_id, { fingerprint });
    return { send_authorized: true };
  }
}

/** @param {string|null} current @param {string} incoming @param {string[]} order */
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

test('folds claim into one reservation per current inbound revision', async () => {
  const contract = await fixture('contract-v1.json');
  const event = await fixture('message-send-requested.json');
  const fence = new ConversationFenceHarness();

  assert.equal(fence.reserve(event, contract).send_authorized, true);
  assert.equal(fence.reserve(event, contract).send_authorized, false);
  assert.throws(
    () =>
      fence.reserve(
        { ...event, command_id: 'command-second', event_id: 'event-second' },
        contract,
      ),
    /STALE_AUTOMATION_FENCE/u,
  );
});

test('takeover and a newer inbound revision invalidate an old AI decision', async () => {
  const contract = await fixture('contract-v1.json');
  const event = await fixture('message-send-requested.json');

  const takeoverFence = new ConversationFenceHarness();
  takeoverFence.takeover();
  assert.throws(
    () => takeoverFence.reserve(event, contract),
    /STALE_AUTOMATION_FENCE/u,
  );

  const revisionFence = new ConversationFenceHarness();
  revisionFence.revision += 1;
  assert.throws(
    () => revisionFence.reserve(event, contract),
    /STALE_AUTOMATION_FENCE/u,
  );
});

test('merges only approved, non-null briefing fields', async () => {
  const contract = await fixture('contract-v1.json');
  assert.deepEqual(
    applyBriefingPatch(
      { quantity: 10, segment: 'uniform' },
      { quantity: 30, segment: null },
      contract,
    ),
    { quantity: 30, segment: 'uniform' },
  );
  for (const forbidden of [{ payment_confirmed: true }, { price: 100 }]) {
    assert.throws(() => validateBriefingPatch(forbidden, contract));
  }
  assert.equal(
    validateBriefingPatch(
      {
        customer_name: 'Grupo Aurora',
        fabrics: ['dry fit'],
        next_required_field: 'sizes',
        order_name: 'Evento Aurora',
        product_type: 'camiseta',
      },
      contract,
    ),
    true,
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
});

test('keeps the simplified workflow inactive and free of removed runtime concepts', async () => {
  const workflow = JSON.parse(await readFile(workflowSnapshot, 'utf8'));
  assert.equal(workflow.source.active, false);
  assert.equal(workflow.source.activeVersionId, null);
  assert.ok(workflow.nodes.length < 50);
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /claim_token|claim_id|ai-turns\/claim/u);
  assert.doesNotMatch(serialized, /silmer_failures|windowBufferMemory/u);
  assert.doesNotMatch(serialized, /credentials|webhookId|pinData/u);

  const reserveNodes = workflow.nodes.filter((/** @type {any} */ node) =>
    /Reservar envio/u.test(node.name),
  );
  const sendNodes = workflow.nodes.filter(
    (/** @type {any} */ node) =>
      node.type === 'n8n-nodes-base.whatsApp' &&
      node.parameters?.operation === 'send',
  );
  assert.ok(reserveNodes.length >= 1);
  assert.ok(sendNodes.length >= 1);
  assert.match(serialized, /pré-ficha de atendimento/u);
  assert.match(serialized, /ready_for_handoff/u);
  assert.match(serialized, /next_required_field/u);
});

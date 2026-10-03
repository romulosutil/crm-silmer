import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ContractValidationError,
  assertChannelActive,
  validateAttachmentMetadata,
  validateContract,
  validateEvent,
  validateHeaders,
  validateInbound,
  validateOrderOpening,
  validateProblem,
} from '../schemas/fixtures/external/n8n/contract-validator.mjs';

const fixtureRoot = new URL(
  '../schemas/fixtures/external/n8n/',
  import.meta.url,
);

/** @param {string} name @returns {Promise<any>} */
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}

/** @param {{method: string, path: string}} endpoint */
function routeKey(endpoint) {
  return `${endpoint.method} ${endpoint.path}`;
}

function basicHeaders() {
  const credential = Buffer.from(
    'synthetic-client:synthetic-secret-material-for-contract-tests',
  ).toString('base64');
  return {
    authorization: `Basic ${credential}`,
    'idempotency-key': 'idempotency-n8n-contract-001',
    'x-correlation-id': 'corr-n8n-contract-001',
    'x-silmer-execution-id': 'exec-n8n-contract-001',
    'x-silmer-workflow-key': 'silmer-sales-agent',
    'x-silmer-workflow-version': '1.0.0',
  };
}

test('declares exactly three POST endpoints with Basic-only service identity', async () => {
  const contract = await fixture('contract-v1.json');
  assert.equal(validateContract(contract), true);
  assert.deepEqual(contract.endpoints.map(routeKey), [
    'POST /api/v1/integrations/n8n/messages/inbound',
    'POST /api/v1/integrations/n8n/conversations/{conversation_id}/attachments',
    'POST /api/v1/integrations/n8n/events',
  ]);
  assert.equal(contract.authentication.scheme, 'Basic');
  assert.equal(contract.authentication.serviceActor, 'AUTOMATION_EXECUTOR');
  assert.equal(contract.errorMediaType, 'application/problem+json');
});

test('validates every endpoint fixture and correlates required headers', async () => {
  const contract = await fixture('contract-v1.json');
  const inbound = await fixture('messages-inbound-whatsapp.json');
  const attachment = await fixture('attachment-metadata.json');
  const event = await fixture('message-send-requested.json');

  assert.equal(validateHeaders(basicHeaders(), contract), true);
  assert.equal(validateInbound(inbound, contract), true);
  assert.equal(validateAttachmentMetadata(attachment), true);
  assert.equal(validateEvent(event, contract), true);
});

test('scopes the executable MVP contract to WhatsApp', async () => {
  const contract = await fixture('contract-v1.json');
  const whatsapp = await fixture('messages-inbound-whatsapp.json');
  const instagram = await fixture('messages-inbound-instagram.json');

  assert.equal(validateInbound(whatsapp, contract), true);
  assert.equal(assertChannelActive(whatsapp, contract), true);
  assert.throws(
    () => validateInbound(instagram, contract),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === 'UNSUPPORTED_CHANNEL',
  );
});

test('requires Basic credentials and all trace/workflow headers', async () => {
  const contract = await fixture('contract-v1.json');
  const valid = basicHeaders();

  for (const headers of [
    { ...valid, authorization: 'Bearer rejected-token' },
    { ...valid, authorization: '' },
    { ...valid, 'idempotency-key': '' },
    { ...valid, 'x-correlation-id': '' },
    { ...valid, 'x-silmer-workflow-version': '' },
  ]) {
    assert.throws(() => validateHeaders(headers, contract));
  }
});

test('rejects unknown command fields and preserves a closed problem+json shape', async () => {
  const contract = await fixture('contract-v1.json');
  const inbound = await fixture('messages-inbound-whatsapp.json');
  const problem = await fixture('problem.json');

  assert.throws(
    () =>
      validateInbound({ ...inbound, administrative_override: true }, contract),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === 'UNKNOWN_FIELD:administrative_override',
  );
  assert.equal(validateProblem(problem), true);
  assert.deepEqual(Object.keys(problem).sort(), [
    'accepted',
    'detail',
    'error',
    'instance',
    'request_id',
    'status',
    'title',
    'type',
  ]);
});

test('open_order travels only on the reservation and the handoff (ADR 014)', async () => {
  const contract = await fixture('contract-v1.json');
  const schema = await fixture('contract-v1.schema.json');
  const reservation = await fixture('message-send-requested.json');
  const handoff = await fixture('handoff-requested.json');

  assert.deepEqual(contract.openOrderEvents, [
    'message.send.requested',
    'handoff.requested',
  ]);
  assert.deepEqual(schema.$defs.openOrder.type, 'boolean');
  assert.ok(schema.required.includes('openOrderEvents'));
  assert.equal(reservation.open_order, true);
  assert.equal(validateEvent(reservation, contract), true);
  assert.equal(validateEvent(handoff, contract), true);
  assert.equal(
    validateEvent({ ...reservation, open_order: false }, contract),
    true,
  );
  const withoutFlag = { ...reservation };
  delete withoutFlag.open_order;
  assert.equal(validateEvent(withoutFlag, contract), true);

  for (const [payload, code] of [
    [{ ...reservation, open_order: 'true' }, 'INVALID_OPEN_ORDER'],
    [{ ...reservation, open_order: null }, 'INVALID_OPEN_ORDER'],
    [
      {
        command_id: 'conversation-synthetic-001:7:ai-response',
        conversation_id: 'conversation-synthetic-001',
        event_id: 'sent-001',
        event_type: 'message.sent',
        external_message_id: 'wamid.synthetic.1',
        occurred_at: '2026-09-07T12:00:11.000Z',
        open_order: true,
        schema_version: '1.0',
      },
      'INVALID_OPEN_ORDER_EVENT',
    ],
  ]) {
    assert.throws(
      () => validateEvent(payload, contract),
      (error) =>
        error instanceof ContractValidationError && error.code === code,
    );
  }
  assert.throws(
    () =>
      validateContract({
        ...contract,
        openOrderEvents: ['message.sent'],
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === 'INVALID_OPEN_ORDER_EVENTS',
  );
});

test('the order opening answer is either the order or a typed failure (ADR 014)', () => {
  assert.equal(
    validateOrderOpening({ created: true, id: 'order-1', opened: true }),
    true,
  );
  assert.equal(
    validateOrderOpening({ error: 'ORDER_OPEN_FAILED', opened: false }),
    true,
  );
  for (const invalid of [
    { opened: true, id: 'order-1' },
    { opened: true, created: false },
    { opened: false },
    { opened: false, error: 'falha ao abrir' },
    { opened: false, error: 'ORDER_OPEN_FAILED', id: 'order-1' },
    { error: 'ORDER_OPEN_FAILED' },
  ]) {
    assert.throws(
      () => validateOrderOpening(invalid),
      ContractValidationError,
      JSON.stringify(invalid),
    );
  }
});

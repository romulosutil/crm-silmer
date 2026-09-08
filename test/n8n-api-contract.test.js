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

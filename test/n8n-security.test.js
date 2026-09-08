import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ContractValidationError,
  validateAttachmentMetadata,
  validateBriefingPatch,
  validateEvent,
  validateHeaders,
  validateProblem,
} from '../schemas/fixtures/external/n8n/contract-validator.mjs';

const fixtureRoot = new URL(
  '../schemas/fixtures/external/n8n/',
  import.meta.url,
);

const piiOrSecretPatterns = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\+?[1-9]\d{9,14}/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/u,
]);

/** @param {string} name @returns {Promise<any>} */
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}

class IdempotencyHarness {
  constructor() {
    /** @type {Map<string, {completion: Promise<any>, fingerprint: string}>} */
    this.records = new Map();
  }

  /**
   * @param {string} scope
   * @param {string} key
   * @param {unknown} payload
   * @param {() => Promise<any>|any} effect
   */
  async execute(scope, key, payload, effect) {
    const recordKey = `${scope}:${key}`;
    const fingerprint = createHash('sha256')
      .update(canonicalJson(payload))
      .digest('hex');
    const existing = this.records.get(recordKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ContractValidationError('IDEMPOTENCY_KEY_REUSED');
      }
      return existing.completion;
    }
    const completion = Promise.resolve().then(effect);
    this.records.set(recordKey, { completion, fingerprint });
    try {
      return await completion;
    } catch (error) {
      this.records.delete(recordKey);
      throw error;
    }
  }
}

/** @param {unknown} value @returns {string} */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** @param {unknown} error @param {string} correlationId */
function safeProblem(error, correlationId) {
  void error;
  return {
    type: 'https://crm.silmer.invalid/problems/integration-request-rejected',
    title: 'Integration request rejected',
    status: 400,
    detail: 'The integration request was rejected',
    instance: '/api/v1/integrations/n8n/events',
    accepted: false,
    error: { code: 'INTEGRATION_REQUEST_REJECTED' },
    request_id: 'request-synthetic-security',
    correlation_id: correlationId,
  };
}

test('keeps committed n8n fixtures free from recognizable PII and secrets', async () => {
  const names = (await readdir(fixtureRoot))
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.ok(names.length >= 9);

  for (const name of names) {
    const content = await readFile(new URL(name, fixtureRoot), 'utf8');
    for (const pattern of piiOrSecretPatterns) {
      assert.doesNotMatch(
        content,
        pattern,
        `${name} contains a sensitive value`,
      );
    }
  }
});

test('never reflects credentials, message content or raw errors in problem responses', () => {
  const canaries = [
    'authorization-canary',
    'message-content-canary',
    'runtime-secret-canary',
  ];
  const rawError = new Error(canaries.join(':'));
  const problem = safeProblem(rawError, 'corr-n8n-security-001');

  assert.equal(validateProblem(problem), true);
  const serialized = JSON.stringify(problem);
  for (const canary of canaries)
    assert.doesNotMatch(serialized, new RegExp(canary));
  assert.equal('stack' in problem, false);
  assert.equal(problem.detail, 'The integration request was rejected');
});

test('coalesces concurrent idempotent effects and rejects divergent replay', async () => {
  const store = new IdempotencyHarness();
  const payload = await fixture('message-send-requested.json');
  let effects = 0;
  const effect = async () => {
    effects += 1;
    return { accepted: true, attempt_id: payload.attempt_id };
  };

  const [first, replay] = await Promise.all([
    store.execute('n8n.events', payload.event_id, payload, effect),
    store.execute(
      'n8n.events',
      payload.event_id,
      structuredClone(payload),
      effect,
    ),
  ]);
  assert.deepEqual(replay, first);
  assert.equal(effects, 1);

  await assert.rejects(
    store.execute(
      'n8n.events',
      payload.event_id,
      { ...payload, automation_epoch: payload.automation_epoch + 1 },
      effect,
    ),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === 'IDEMPOTENCY_KEY_REUSED',
  );
  assert.equal(effects, 1);
});

test('rejects unsafe attachment metadata before persistence', async () => {
  const attachment = await fixture('attachment-metadata.json');
  assert.equal(validateAttachmentMetadata(attachment), true);

  for (const unsafe of [
    { ...attachment, content_sha256: 'not-a-sha256' },
    { ...attachment, filename: '../synthetic.bin' },
    { ...attachment, filename: 'folder\\synthetic.bin' },
    { ...attachment, size_bytes: -1 },
  ]) {
    assert.throws(() => validateAttachmentMetadata(unsafe));
  }
});

test('rejects privilege fields and unfenced automatic events', async () => {
  const contract = await fixture('contract-v1.json');
  const event = await fixture('message-send-requested.json');

  for (const forbidden of ['discount', 'payment_confirmed', 'price', 'stage']) {
    assert.throws(() =>
      validateBriefingPatch({ [forbidden]: 'synthetic-value' }, contract),
    );
  }
  for (const field of [
    'automation_epoch',
    'claim_id',
    'claim_token',
    'command_id',
    'expected_version',
    'revision',
  ]) {
    const invalid = structuredClone(event);
    delete invalid[field];
    assert.throws(() => validateEvent(invalid, contract));
  }
});

test('allows only Basic auth with required correlation and workflow metadata', async () => {
  const contract = await fixture('contract-v1.json');
  const payload = await fixture('message-send-requested.json');
  const credential = Buffer.from(
    'synthetic-client:synthetic-runtime-secret-material',
  ).toString('base64');
  const headers = {
    authorization: `Basic ${credential}`,
    'idempotency-key': payload.event_id,
    'x-correlation-id': 'corr-n8n-security-001',
    'x-silmer-execution-id': 'exec-n8n-security-001',
    'x-silmer-workflow-key': 'silmer-sales-agent',
    'x-silmer-workflow-version': '1.0.0',
  };
  assert.equal(validateHeaders(headers, contract), true);

  assert.throws(() =>
    validateHeaders(
      { ...headers, authorization: 'Bearer synthetic-token' },
      contract,
    ),
  );
  assert.throws(() =>
    validateHeaders({ ...headers, 'x-correlation-id': '' }, contract),
  );
});

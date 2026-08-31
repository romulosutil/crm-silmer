import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  validateExternalEffects,
  validateFixtures,
  validateLoadEnvelope,
} from '../scripts/validate-external-spikes.mjs';

const rootUrl = new URL('../', import.meta.url);

/** @param {string} path */
async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
}

/** @param {string} path */
async function text(path) {
  return readFile(new URL(path, rootUrl), 'utf8');
}

test('validates the versioned external-effect matrix and load envelope', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const envelope = await json('docs/phase0/load-envelope.json');

  assert.doesNotThrow(() => validateExternalEffects(effects));
  assert.doesNotThrow(() => validateLoadEnvelope(envelope));
  assert.equal(effects.task, 'T00.4');
  assert.equal(envelope.approval.status, 'pending-human-approval');
});

test('keeps uncertain Meta sends out of blind retry', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );
  const send = effectList.find(({ id }) => id === 'meta.send-message');

  assert.ok(send);
  assert.equal(send.idempotency.support, 'not-proven');
  assert.equal(send.resultQuery.support, 'not-proven-by-wamid');
  assert.equal(send.outcomeUnknown.automaticRetry, false);
  assert.match(send.outcomeUnknown.strategy, /reconcil/iu);
});

test('rejects a matrix that enables blind retry for an uncertain Meta send', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const unsafe = structuredClone(effects);
  const effectList = /** @type {Array<Record<string, any>>} */ (unsafe.effects);
  const send = effectList.find(({ id }) => id === 'meta.send-message');
  assert.ok(send);
  send.outcomeUnknown.automaticRetry = true;

  assert.throws(
    () => validateExternalEffects(unsafe),
    /Meta.*retry|retry.*Meta/iu,
  );
});

test('verifies synthetic Meta signature and representative local fixtures', async () => {
  const fixtures = await json('schemas/fixtures/external/manifest.json');
  assert.doesNotThrow(() => validateFixtures(fixtures));

  const vector = fixtures.meta.signature;
  const actual = `sha256=${createHmac('sha256', vector.appSecret).update(vector.rawBody).digest('hex')}`;
  assert.equal(actual, vector.expectedHeader);
  assert.equal(vector.synthetic, true);
});

test('requires Gemini minimization controls and private R2 posture', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );
  const ai = effectList.find(({ id }) => id === 'gemini.structured-response');
  const storage = effectList.find(({ id }) => id === 'r2.put-object');
  assert.ok(ai);
  assert.ok(storage);

  assert.deepEqual(ai.requestControls, {
    operation: 'models.generateContent',
    serverManagedConversationState: false,
    authKeyServerSideOnly: true,
    structuredOutput: 'strict-json-schema',
    grounding: false,
    fileApi: false,
    explicitCaching: false,
    developerLogging: false,
  });
  assert.equal(ai.model, 'gemini-2.5-flash-lite');
  assert.equal(ai.retention.paidServiceRequired, true);
  assert.equal(ai.retention.providerAbuseMonitoringDaysWithoutZdr, 55);
  assert.equal(ai.retention.providerZdrApproval, 'pending-live');
  assert.equal(ai.retention.productionWithPiiAllowed, false);
  assert.equal(storage.security.publicAccess, false);
  assert.equal(storage.security.bucketLockRequired, true);
  assert.equal(storage.security.dataLocationApproval, 'pending-privacy');
});

test('does not convert local evidence into external approval claims', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const envelope = await json('docs/phase0/load-envelope.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );

  assert.equal(effects.externalApprovalGranted, false);
  assert.equal(envelope.approval.approved, false);
  assert.ok(effectList.some(({ status }) => status === 'pending-live'));
  assert.ok(effectList.some(({ status }) => status === 'pending-human'));
});

test('documents a secret-free, non-production Meta sandbox procedure', async () => {
  const guide = await text('docs/phase0/META-SANDBOX.md');
  const packageJson = await json('package.json');
  const environment = await text('docs/phase0/meta-sandbox.env.example');

  assert.match(guide, /T00\.4/u);
  assert.match(guide, /\/api\/v1\/webhooks\/meta\/whatsapp/u);
  assert.match(guide, /npm run smoke:meta:sandbox/u);
  assert.match(guide, /PostgreSQL inbox|T02\.2/u);
  assert.match(guide, /não.*produção|non-production/iu);
  assert.doesNotMatch(guide, /\+55\s?\d{10,11}/u);
  assert.equal(
    packageJson.scripts['smoke:meta:sandbox'],
    'node scripts/meta-sandbox-smoke.mjs',
  );
  for (const name of [
    'META_GRAPH_API_VERSION',
    'META_TEST_RECIPIENT_E164',
    'META_TEST_DOCUMENT_URL',
    'META_TEST_IMAGE_URL',
  ]) {
    assert.match(environment, new RegExp(`^${name}=$`, 'mu'));
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validatePhase0Decisions } from '../scripts/validate-phase0-decisions.mjs';

const rootUrl = new URL('../', import.meta.url);

async function decisions() {
  return JSON.parse(
    await readFile(
      new URL('docs/phase0/domain-decisions.json', rootUrl),
      'utf8',
    ),
  );
}

test('records every T00.6 default without claiming human approval', async () => {
  const document = await decisions();

  assert.doesNotThrow(() => validatePhase0Decisions(document));
  assert.equal(document.approvalGranted, false);
  assert.equal(document.gate.status, 'pending-human-approval');
  assert.deepEqual(document.gate.blockedPhases, ['T02', 'T03', 'T05']);
  assert.equal(document.decisions.length, 7);
});

test('requires versioned reviewer, evidence and date fields to remain pending', async () => {
  const document = await decisions();

  for (const decision of document.decisions) {
    assert.ok(decision.approval.reviewers.length > 0);
    assert.equal(decision.approval.status, 'pending');
    assert.equal(decision.approval.approved, false);
    assert.equal(decision.approval.reviewedAt, null);
    assert.equal(decision.approval.evidence, null);
  }
});

test('rejects a local edit that invents human approval', async () => {
  const document = await decisions();
  const unsafe = structuredClone(document);
  unsafe.decisions[0].approval = {
    ...unsafe.decisions[0].approval,
    status: 'approved',
    approved: true,
    reviewedAt: '2026-08-30T00:00:00Z',
    evidence: 'not-a-real-review',
  };

  assert.throws(
    () => validatePhase0Decisions(unsafe),
    /D00\.6-01.*pending|cannot claim approval/iu,
  );
});

test('keeps Vendedor, commercial Admin and Technical Admin separate', async () => {
  const document = await decisions();
  const roles = /** @type {Array<Record<string, any>>} */ (
    document.roleDesignations
  );
  const technicalAdmin = roles.find(({ id }) => id === 'ROLE-TECHNICAL-ADMIN');

  assert.ok(technicalAdmin);
  assert.equal(technicalAdmin.status, 'pending');
  assert.deepEqual(technicalAdmin.assignees, []);
  assert.ok(technicalAdmin.mustBeDistinctFrom.includes('PRIVACY_OFFICER'));
  assert.equal(
    document.separationOfDuties.commercialAdminIsTechnicalAdmin,
    false,
  );
  assert.equal(
    document.separationOfDuties
      .privacyAuthorizationAndDeletionExecutionMustBeDistinct,
    true,
  );
});

test('rejects unsafe changes to authorization and the load envelope', async () => {
  const document = await decisions();
  const unsafeAuthority = structuredClone(document);
  unsafeAuthority.decisions[0].default.requiredCapability = 'Vendedor';
  assert.throws(
    () => validatePhase0Decisions(unsafeAuthority),
    /commercial Admin/iu,
  );

  const unsafeEnvelope = structuredClone(document);
  unsafeEnvelope.decisions[6].default.blindRetryOutcomeUnknown = true;
  assert.throws(
    () => validatePhase0Decisions(unsafeEnvelope),
    /Load envelope/iu,
  );
});

test('product persona does not grant approval merely by being Vendedor', async () => {
  const specification = await readFile(
    new URL('CRM-MVP-ESPECIFICACAO.md', rootUrl),
    'utf8',
  );
  const persona = specification.match(
    /### Vendedor\s+([\s\S]*?)\s+### Vendedor Silmer/iu,
  )?.[1];

  assert.ok(persona);
  assert.doesNotMatch(persona, /aprovar condições, registrar o valor final/iu);
  assert.match(persona, /função Vendedor,[\s\S]*não\s+aprova/iu);
  assert.match(persona, /role adicional `Admin`/u);
});

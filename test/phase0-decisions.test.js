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

const approvedAt = '2026-08-30T12:00:00.000Z';
const revision = `git:${'a'.repeat(40)}`;

/** @param {string} reference */
function evidence(reference) {
  return { reference, revision };
}

/** @param {Record<string, any>} baseline */
function fullyApprove(baseline) {
  const approved = structuredClone(baseline);
  approved.approvalGranted = true;
  approved.gate.status = 'approved';
  approved.gate.blockedPhases = [];
  for (const review of approved.gate.requiredReviews) {
    review.status = 'approved';
    review.approved = true;
    review.reviewedAt = approvedAt;
    review.evidence = evidence(`approvals/${review.reviewer.toLowerCase()}.md`);
  }
  for (const decision of approved.decisions) {
    decision.approval.status = 'approved';
    decision.approval.approved = true;
    decision.approval.reviewedAt = approvedAt;
    decision.approval.evidence = evidence(`approvals/${decision.id}.md`);
  }
  for (const role of approved.roleDesignations) {
    role.status = 'designated';
    role.assignees = [`silmer:${role.id.toLowerCase().replaceAll('_', '-')}`];
    role.reviewedAt = approvedAt;
    role.evidence = evidence(`approvals/${role.id}.md`);
  }
  return approved;
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

test('accepts only a complete transition to the approved state', async () => {
  const approved = fullyApprove(await decisions());

  assert.doesNotThrow(() => validatePhase0Decisions(approved));
  assert.equal(approved.approvalGranted, true);
  assert.equal(approved.gate.status, 'approved');
  assert.deepEqual(approved.gate.blockedPhases, []);
  const approvedDecisions = /** @type {Array<Record<string, any>>} */ (
    approved.decisions
  );
  const approvedRoles = /** @type {Array<Record<string, any>>} */ (
    approved.roleDesignations
  );
  assert.ok(
    approvedDecisions.every(
      ({ approval }) =>
        approval.status === 'approved' && approval.approved === true,
    ),
  );
  assert.ok(
    approvedRoles.every(
      ({ status, assignees }) =>
        status === 'designated' && assignees.length > 0,
    ),
  );
});

test('rejects mixed gate, review, decision and designation states', async () => {
  const baseline = await decisions();

  const gateOnly = structuredClone(baseline);
  gateOnly.approvalGranted = true;
  gateOnly.gate.status = 'approved';
  gateOnly.gate.blockedPhases = [];
  assert.throws(
    () => validatePhase0Decisions(gateOnly),
    /review is incomplete|must be approved/iu,
  );

  const missingReview = fullyApprove(baseline);
  missingReview.gate.requiredReviews[0].approved = false;
  assert.throws(
    () => validatePhase0Decisions(missingReview),
    /review is incomplete/iu,
  );

  const missingDecision = fullyApprove(baseline);
  missingDecision.decisions[0].approval.status = 'pending';
  assert.throws(
    () => validatePhase0Decisions(missingDecision),
    /D00\.6-01 must be approved/iu,
  );

  const missingRole = fullyApprove(baseline);
  missingRole.roleDesignations[0].status = 'pending';
  assert.throws(
    () => validatePhase0Decisions(missingRole),
    /ROLE-TECH-LEAD must be designated/iu,
  );
});

test('rejects forged approval evidence, dates and assignee identities', async () => {
  const baseline = await decisions();

  const badEvidence = fullyApprove(baseline);
  badEvidence.decisions[0].approval.evidence.revision = 'main';
  assert.throws(
    () => validatePhase0Decisions(badEvidence),
    /versioned evidence/iu,
  );

  const badDate = fullyApprove(baseline);
  badDate.gate.requiredReviews[0].reviewedAt = 'yesterday';
  assert.throws(() => validatePhase0Decisions(badDate), /ISO review date/iu);

  const badAssignee = fullyApprove(baseline);
  badAssignee.roleDesignations[0].assignees = ['Person Name'];
  assert.throws(
    () => validatePhase0Decisions(badAssignee),
    /valid corporate IDs/iu,
  );
});

test('preserves separation of duties after complete approval', async () => {
  const approved = fullyApprove(await decisions());
  approved.separationOfDuties.commercialAdminIsTechnicalAdmin = true;

  assert.throws(
    () => validatePhase0Decisions(approved),
    /cannot be conflated/iu,
  );
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validatePhase0Decisions } from '../scripts/validate-phase0-decisions.mjs';

const rootUrl = new URL('../', import.meta.url);
const soloAssignee = 'silmer:romulo.sutil';

async function decisions() {
  return JSON.parse(
    await readFile(
      new URL('docs/phase0/domain-decisions.json', rootUrl),
      'utf8',
    ),
  );
}

/** @param {Record<string, any>} approved */
function pendingState(approved) {
  const pending = structuredClone(approved);
  pending.approvalGranted = false;
  pending.gate.status = 'pending-human-approval';
  pending.gate.blockedPhases = ['T02', 'T03', 'T05'];
  for (const review of pending.gate.requiredReviews) {
    review.status = 'pending';
    review.approved = false;
    review.reviewedAt = null;
    review.evidence = null;
  }
  for (const decision of pending.decisions) {
    decision.approval.status = 'pending';
    decision.approval.approved = false;
    decision.approval.reviewedAt = null;
    decision.approval.evidence = null;
  }
  for (const role of pending.roleDesignations) {
    role.status = 'pending';
    role.assignees = [];
    role.reviewedAt = null;
    role.evidence = null;
  }
  const pendingRoles = /** @type {Array<Record<string, any>>} */ (
    pending.roleDesignations
  );
  const technicalAdmin = pendingRoles.find(
    ({ id }) => id === 'ROLE-TECHNICAL-ADMIN',
  );
  assert.ok(technicalAdmin);
  technicalAdmin.mfaConfirmed = false;
  const solo = pending.separationOfDuties.soloOperationException;
  solo.status = 'pending';
  solo.approved = false;
  solo.riskAccepted = false;
  solo.reviewedAt = null;
  solo.evidence = null;
  return pending;
}

test('records the complete human-approved T00.6 gate', async () => {
  const document = await decisions();

  assert.doesNotThrow(() => validatePhase0Decisions(document));
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.approvalGranted, true);
  assert.equal(document.gate.status, 'approved');
  assert.deepEqual(document.gate.blockedPhases, []);
  assert.equal(document.decisions.length, 7);
  const approvedDecisions = /** @type {Array<Record<string, any>>} */ (
    document.decisions
  );
  assert.ok(
    approvedDecisions.every(
      ({ approval }) =>
        approval.status === 'approved' && approval.approved === true,
    ),
  );
  const approvedRoles = /** @type {Array<Record<string, any>>} */ (
    document.roleDesignations
  );
  assert.ok(
    approvedRoles.every(
      ({ status, assignees }) =>
        status === 'designated' &&
        assignees.length === 1 &&
        assignees[0] === soloAssignee,
    ),
  );
});

test('retains a coherent fail-closed pending state', async () => {
  const pending = pendingState(await decisions());

  assert.doesNotThrow(() => validatePhase0Decisions(pending));
  assert.equal(pending.approvalGranted, false);
  assert.equal(pending.gate.status, 'pending-human-approval');
  assert.deepEqual(pending.gate.blockedPhases, ['T02', 'T03', 'T05']);
});

test('rejects mixed gate, review, decision and designation states', async () => {
  const approved = await decisions();

  const missingReview = structuredClone(approved);
  missingReview.gate.requiredReviews[0].approved = false;
  assert.throws(
    () => validatePhase0Decisions(missingReview),
    /review is incomplete/iu,
  );

  const missingDecision = structuredClone(approved);
  missingDecision.decisions[0].approval.status = 'pending';
  assert.throws(
    () => validatePhase0Decisions(missingDecision),
    /D00\.6-01 must be approved/iu,
  );

  const missingRole = structuredClone(approved);
  missingRole.roleDesignations[0].status = 'pending';
  assert.throws(
    () => validatePhase0Decisions(missingRole),
    /ROLE-TECH-LEAD must be designated/iu,
  );
});

test('rejects forged approval evidence, dates and assignee identities', async () => {
  const approved = await decisions();

  const badEvidence = structuredClone(approved);
  badEvidence.decisions[0].approval.evidence.revision = 'main';
  assert.throws(
    () => validatePhase0Decisions(badEvidence),
    /versioned evidence/iu,
  );

  const badDate = structuredClone(approved);
  badDate.gate.requiredReviews[0].reviewedAt = 'yesterday';
  assert.throws(() => validatePhase0Decisions(badDate), /ISO review date/iu);

  const badAssignee = structuredClone(approved);
  badAssignee.roleDesignations[0].assignees = ['Person Name'];
  assert.throws(
    () => validatePhase0Decisions(badAssignee),
    /valid corporate IDs/iu,
  );
});

test('requires MFA for the solo Technical Admin', async () => {
  const approved = await decisions();
  const approvedRoles = /** @type {Array<Record<string, any>>} */ (
    approved.roleDesignations
  );
  const technicalAdmin = approvedRoles.find(
    ({ id }) => id === 'ROLE-TECHNICAL-ADMIN',
  );

  assert.ok(technicalAdmin);
  assert.equal(technicalAdmin.mfaRequired, true);
  assert.equal(technicalAdmin.mfaConfirmed, true);

  const unsafe = structuredClone(approved);
  const unsafeRoles = /** @type {Array<Record<string, any>>} */ (
    unsafe.roleDesignations
  );
  const unsafeTechnicalAdmin = unsafeRoles.find(
    ({ id }) => id === 'ROLE-TECHNICAL-ADMIN',
  );
  assert.ok(unsafeTechnicalAdmin);
  unsafeTechnicalAdmin.mfaConfirmed = false;
  assert.throws(() => validatePhase0Decisions(unsafe), /MFA/iu);
});

test('requires every compensating control for solo operation', async () => {
  const approved = await decisions();
  const cases = /** @type {Array<[string, boolean, RegExp]>} */ ([
    ['riskAccepted', false, /risk/iu],
    ['capabilitiesRemainOrthogonal', false, /orthogonal/iu],
    [
      'separateAuthorizationAndExecutionEvents',
      false,
      /authorization and execution/iu,
    ],
    ['automaticChainingAllowed', true, /automatic chaining/iu],
    ['auditEvidenceRequired', false, /audit evidence/iu],
  ]);

  for (const [field, value, expected] of cases) {
    const unsafe = structuredClone(approved);
    unsafe.separationOfDuties.soloOperationException[field] = value;
    assert.throws(() => validatePhase0Decisions(unsafe), expected);
  }
});

test('rejects identity overlap without the approved solo exception', async () => {
  const approved = await decisions();
  const unsafe = structuredClone(approved);
  unsafe.separationOfDuties.soloOperationException.approved = false;

  assert.throws(
    () => validatePhase0Decisions(unsafe),
    /solo operation exception/iu,
  );
});

test('binds every designated role to the approved solo assignee', async () => {
  const approved = await decisions();
  const changedAssignee = structuredClone(approved);
  changedAssignee.roleDesignations[0].assignees = ['silmer:other.operator'];

  assert.throws(
    () => validatePhase0Decisions(changedAssignee),
    /approved solo assignee/iu,
  );

  const changedException = structuredClone(approved);
  const roles = /** @type {Array<Record<string, any>>} */ (
    changedException.roleDesignations
  );
  const technicalAdmin = roles.find(({ id }) => id === 'ROLE-TECHNICAL-ADMIN');
  assert.ok(technicalAdmin);
  technicalAdmin.soloOperationExceptionId = 'SOLO-OPS-PILOT-99';

  assert.throws(
    () => validatePhase0Decisions(changedException),
    /solo exception reference/iu,
  );
});

test('keeps capabilities separate despite the shared identity', async () => {
  const document = await decisions();
  const separation = document.separationOfDuties;

  assert.equal(separation.privacyOfficerAssignee, soloAssignee);
  assert.equal(
    separation.commercialAndTechnicalCapabilitiesRemainDistinct,
    true,
  );
  assert.deepEqual(separation.orthogonalCapabilities, [
    'COMMERCIAL_ADMIN',
    'PRIVACY_OFFICER',
    'TECHNICAL_PRIVACY_EXECUTOR',
  ]);
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

test('reconciles canonical sources with the approved operational gate', async () => {
  const [specification, approvalGate, tasks, document] = await Promise.all([
    readFile(new URL('.specs/features/crm-mvp/spec.md', rootUrl), 'utf8'),
    readFile(new URL('docs/phase0/PHASE-0-APPROVAL-GATE.md', rootUrl), 'utf8'),
    readFile(new URL('.specs/features/crm-mvp/tasks.md', rootUrl), 'utf8'),
    decisions(),
  ]);
  const reconciledStatus =
    'Em 02/09/2026, a T00.6 foi aprovada na issue `#10` e deixou de bloquear ' +
    'T02, T03 e T05.';

  for (const source of [specification, approvalGate, tasks]) {
    assert.ok(source.includes(reconciledStatus));
    assert.match(source, /T00\.6-APPROVAL-EVIDENCE\.md/u);
    assert.match(source, /silmer:romulo\.sutil/u);
  }
  assert.match(specification, /GO de produto/iu);
  assert.equal(document.approvalGranted, true);
  assert.equal(document.gate.status, 'approved');
  assert.deepEqual(document.gate.blockedPhases, []);
});

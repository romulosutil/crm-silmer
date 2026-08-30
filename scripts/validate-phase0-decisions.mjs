import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const expectedDecisionSubjects = new Map([
  ['D00.6-01', 'payment-confirmation-authority'],
  ['D00.6-02', 'deal-order-cardinality'],
  ['D00.6-03', 'terminal-conversation-reentry'],
  ['D00.6-04', 'canonical-order-form-artifact'],
  ['D00.6-05', 'currency-and-timezone'],
  ['D00.6-06', 'manual-payment-exception'],
  ['D00.6-07', 'load-envelope'],
]);

const expectedRoles = new Set([
  'ROLE-TECH-LEAD',
  'ROLE-DELIVERY-TEAM',
  'ROLE-TECHNICAL-ADMIN',
]);

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {Record<string, any>} approval @param {string} owner */
function validatePendingApproval(approval, owner) {
  invariant(approval?.status === 'pending', `${owner} must remain pending`);
  invariant(approval?.approved === false, `${owner} cannot claim approval`);
  invariant(
    Array.isArray(approval?.reviewers) && approval.reviewers.length > 0,
    `${owner} needs reviewers`,
  );
  invariant(approval.reviewedAt === null, `${owner} cannot claim review date`);
  invariant(approval.evidence === null, `${owner} cannot claim evidence`);
}

/** @param {any} document */
export function validatePhase0Decisions(document) {
  invariant(document?.task === 'T00.6', 'Gate must trace to T00.6');
  invariant(
    document.approvalGranted === false,
    'Local gate cannot claim human approval',
  );
  invariant(
    document.gate?.status === 'pending-human-approval',
    'Gate must remain pending human approval',
  );
  invariant(
    JSON.stringify(document.gate.blockedPhases) ===
      JSON.stringify(['T02', 'T03', 'T05']),
    'T02, T03 and T05 must remain blocked',
  );

  const reviews = /** @type {Array<Record<string, any>>} */ (
    document.gate.requiredReviews
  );
  invariant(Array.isArray(reviews), 'Gate needs required reviews');
  invariant(
    new Set(reviews.map(({ reviewer }) => reviewer)).size === 3 &&
      ['Produto', 'Operacao', 'Privacidade'].every((reviewer) =>
        reviews.some((review) => review.reviewer === reviewer),
      ),
    'Gate needs Produto, Operacao and Privacidade reviews',
  );
  for (const review of reviews) {
    invariant(review.status === 'pending', `${review.reviewer} review drifted`);
    invariant(review.reviewedAt === null, `${review.reviewer} has fake date`);
    invariant(review.evidence === null, `${review.reviewer} has fake evidence`);
  }

  const decisions = /** @type {Array<Record<string, any>>} */ (
    document.decisions
  );
  invariant(
    Array.isArray(decisions) &&
      decisions.length === expectedDecisionSubjects.size,
    'All seven domain defaults are required',
  );
  invariant(
    new Set(decisions.map(({ id }) => id)).size === decisions.length,
    'Decision IDs must be unique',
  );
  for (const [id, subject] of expectedDecisionSubjects) {
    const decision = decisions.find((candidate) => candidate.id === id);
    if (!decision) throw new Error(`${id} is missing`);
    invariant(decision.subject === subject, `${id} is drifted`);
    invariant(
      Array.isArray(decision.basis) && decision.basis.length > 0,
      `${id} needs a versioned basis`,
    );
    invariant(
      Array.isArray(decision.requirements) && decision.requirements.length > 0,
      `${id} needs requirement traceability`,
    );
    validatePendingApproval(decision.approval, id);
  }

  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  invariant(
    byId.get('D00.6-01')?.default?.requiredCapability === 'COMMERCIAL_ADMIN' &&
      byId.get('D00.6-01')?.default?.humanConfirmationRequired === true,
    'Payment confirmation must require a human commercial Admin',
  );
  invariant(
    byId.get('D00.6-02')?.default?.dealMinimumOrders === 0 &&
      byId.get('D00.6-02')?.default?.dealMaximumOrders === 1,
    'Deal/Order cardinality must remain 1:0..1',
  );
  invariant(
    byId.get('D00.6-03')?.default?.behavior === 'create-new-cycle' &&
      byId.get('D00.6-03')?.default?.linkToExistingContact === true &&
      byId.get('D00.6-03')?.default?.preservePreviousRetentionTrigger === true,
    'Terminal conversation must create a linked new cycle',
  );
  invariant(
    byId.get('D00.6-04')?.default?.format === 'PDF' &&
      byId.get('D00.6-04')?.default?.editableXlsxInMvp === false,
    'PDF must remain the canonical non-editable artifact',
  );
  const locale = byId.get('D00.6-05')?.default;
  invariant(
    locale?.currency === 'BRL' &&
      locale.moneyStorage === 'integer-cents' &&
      locale.operationalTimezone === 'America/Sao_Paulo' &&
      locale.timestampStorage === 'UTC',
    'Currency/timezone defaults drifted',
  );
  const exception = byId.get('D00.6-06')?.default;
  invariant(
    exception?.automaticOrderFormRelease === false &&
      exception.requiredCapability === 'COMMERCIAL_ADMIN' &&
      exception.humanDecisionRequired === true &&
      exception.auditRequired === true,
    'Payment exception must remain manual, privileged and audited',
  );
  const envelope = byId.get('D00.6-07')?.default;
  invariant(
    envelope?.operators?.authenticatedSessions === 20 &&
      envelope.operators.concurrentSseConnections === 30 &&
      envelope.webhooks.sustainedEventsPerSecond === 5 &&
      envelope.webhooks.burstEventsPerSecond === 20 &&
      envelope.workerRecoveryBacklogJobs === 1000 &&
      envelope.blindRetryOutcomeUnknown === false &&
      envelope.concurrentUploads === 4 &&
      envelope.queuedPdfs === 20 &&
      envelope.chromiumConcurrency === 1,
    'Load envelope drifted from the provisional TDD baseline',
  );

  const roles = /** @type {Array<Record<string, any>>} */ (
    document.roleDesignations
  );
  invariant(
    Array.isArray(roles) && roles.length === expectedRoles.size,
    'All role designations are required',
  );
  for (const roleId of expectedRoles) {
    const role = roles.find(({ id }) => id === roleId);
    if (!role) throw new Error(`${roleId} is missing`);
    invariant(role.status === 'pending', `${roleId} must remain pending`);
    invariant(
      Array.isArray(role.assignees) && role.assignees.length === 0,
      `${roleId} cannot claim an assignee`,
    );
    invariant(role.reviewedAt === null, `${roleId} cannot claim review date`);
    invariant(role.evidence === null, `${roleId} cannot claim evidence`);
  }
  const technicalAdmin = roles.find(({ id }) => id === 'ROLE-TECHNICAL-ADMIN');
  if (!technicalAdmin) throw new Error('ROLE-TECHNICAL-ADMIN is missing');
  invariant(
    technicalAdmin.capability === 'TECHNICAL_PRIVACY_EXECUTOR' &&
      technicalAdmin.mustBeDistinctFrom?.includes('PRIVACY_OFFICER'),
    'Technical Admin must be a segregated privacy executor',
  );

  const separation = document.separationOfDuties;
  invariant(
    separation?.commercialAdminIsTechnicalAdmin === false,
    'Commercial Admin cannot be conflated with Technical Admin',
  );
  invariant(
    separation?.privacyAuthorizationAndDeletionExecutionMustBeDistinct === true,
    'Privacy authorization and deletion execution must be segregated',
  );
  invariant(
    ['COMMERCIAL_ADMIN', 'PRIVACY_OFFICER', 'TECHNICAL_PRIVACY_EXECUTOR'].every(
      (capability) => separation.orthogonalCapabilities?.includes(capability),
    ),
    'Orthogonal capabilities are incomplete',
  );
  return document;
}

async function main() {
  const document = JSON.parse(
    await readFile(
      new URL('../docs/phase0/domain-decisions.json', import.meta.url),
      'utf8',
    ),
  );
  validatePhase0Decisions(document);
  console.log(
    'Phase 0 decisions valid: defaults recorded; human approvals and role designations remain pending.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Phase 0 decision gate invalid: ${error.message}`);
    process.exitCode = 1;
  });
}

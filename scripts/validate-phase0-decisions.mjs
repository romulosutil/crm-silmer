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

/** @param {unknown} value */
function isIsoDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** @param {unknown} value */
function isVersionedEvidence(value) {
  if (!value || typeof value !== 'object') return false;
  const evidence = /** @type {Record<string, any>} */ (value);
  return (
    typeof evidence.reference === 'string' &&
    evidence.reference.trim().length > 0 &&
    typeof evidence.revision === 'string' &&
    /^git:[0-9a-f]{40}$/u.test(evidence.revision)
  );
}

/** @param {unknown} value */
function isCorporateId(value) {
  return (
    typeof value === 'string' &&
    /^silmer:[a-z0-9][a-z0-9._-]{2,63}$/u.test(value)
  );
}

/**
 * @param {Record<string, any>} approval
 * @param {string} owner
 * @param {'pending' | 'approved'} mode
 */
function validateApproval(approval, owner, mode) {
  invariant(
    Array.isArray(approval?.reviewers) && approval.reviewers.length > 0,
    `${owner} needs reviewers`,
  );
  if (mode === 'pending') {
    invariant(approval.status === 'pending', `${owner} must remain pending`);
    invariant(approval.approved === false, `${owner} cannot claim approval`);
    invariant(
      approval.reviewedAt === null,
      `${owner} cannot claim review date`,
    );
    invariant(approval.evidence === null, `${owner} cannot claim evidence`);
    return;
  }
  invariant(approval.status === 'approved', `${owner} must be approved`);
  invariant(approval.approved === true, `${owner} approval is incomplete`);
  invariant(
    isIsoDate(approval.reviewedAt),
    `${owner} needs an ISO review date`,
  );
  invariant(
    isVersionedEvidence(approval.evidence),
    `${owner} needs versioned evidence`,
  );
}

/** @param {any} document */
export function validatePhase0Decisions(document) {
  invariant(document?.task === 'T00.6', 'Gate must trace to T00.6');
  const pendingGate =
    document.approvalGranted === false &&
    document.gate?.status === 'pending-human-approval' &&
    JSON.stringify(document.gate?.blockedPhases) ===
      JSON.stringify(['T02', 'T03', 'T05']);
  const approvedGate =
    document.approvalGranted === true &&
    document.gate?.status === 'approved' &&
    Array.isArray(document.gate?.blockedPhases) &&
    document.gate.blockedPhases.length === 0;
  invariant(
    pendingGate !== approvedGate && (pendingGate || approvedGate),
    'Gate must be coherently pending or fully approved',
  );
  const mode = /** @type {'pending' | 'approved'} */ (
    approvedGate ? 'approved' : 'pending'
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
    if (mode === 'pending') {
      invariant(
        review.status === 'pending',
        `${review.reviewer} review drifted`,
      );
      invariant(
        review.approved === false,
        `${review.reviewer} review is forged`,
      );
      invariant(review.reviewedAt === null, `${review.reviewer} has fake date`);
      invariant(
        review.evidence === null,
        `${review.reviewer} has fake evidence`,
      );
    } else {
      invariant(
        review.status === 'approved',
        `${review.reviewer} review is incomplete`,
      );
      invariant(
        review.approved === true,
        `${review.reviewer} review is incomplete`,
      );
      invariant(
        isIsoDate(review.reviewedAt),
        `${review.reviewer} needs an ISO review date`,
      );
      invariant(
        isVersionedEvidence(review.evidence),
        `${review.reviewer} needs versioned evidence`,
      );
    }
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
    validateApproval(decision.approval, id, mode);
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
    invariant(
      Array.isArray(role.reviewers) && role.reviewers.length > 0,
      `${roleId} needs reviewers`,
    );
    if (mode === 'pending') {
      invariant(role.status === 'pending', `${roleId} must remain pending`);
      invariant(
        Array.isArray(role.assignees) && role.assignees.length === 0,
        `${roleId} cannot claim an assignee`,
      );
      invariant(role.reviewedAt === null, `${roleId} cannot claim review date`);
      invariant(role.evidence === null, `${roleId} cannot claim evidence`);
    } else {
      invariant(role.status === 'designated', `${roleId} must be designated`);
      invariant(
        Array.isArray(role.assignees) &&
          role.assignees.length > 0 &&
          role.assignees.every(isCorporateId),
        `${roleId} needs valid corporate IDs`,
      );
      invariant(
        isIsoDate(role.reviewedAt),
        `${roleId} needs an ISO review date`,
      );
      invariant(
        isVersionedEvidence(role.evidence),
        `${roleId} needs versioned evidence`,
      );
    }
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
  console.log(`Phase 0 decision gate valid: ${document.gate.status}.`);
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

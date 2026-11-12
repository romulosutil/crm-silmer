import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AUDIENCES } from '../modules/orders/src/domain/audiences.js';
import { renderFichaHtmlV9 } from '../modules/orders/src/print/ficha-canonical-v9.js';
import {
  TEMPLATE_V8,
  TEMPLATE_V9,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const rootUrl = new URL('../', import.meta.url);
const sampleUrl = new URL('docs/phase0/ficha-pdf-synthetic-v9.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval-v9.json', rootUrl);
export const ARTIFACT_PATH_V9 = 'output/pdf/ficha-canonica-sintetica-v9.pdf';
export const REVIEW_PATH_V9 = 'docs/phase0/FICHA-PDF-REVIEW-V9.md';
export const REQUIREMENTS_V9 = Object.freeze([
  'FPI-03',
  'FPI-04',
  'FPI-05',
  'FPI-06',
  'FPI-07',
  'FPI-08',
  'FPI-09',
  'FPI-10',
  'FPI-11',
  'FPI-12',
  'FPI-13',
]);
const PROVISIONAL_STATUSES = Object.freeze(['pending-po-review', 'approved']);
export const CRITERIA_V9 = Object.freeze([
  'legibility',
  'content',
  'order',
  'grade',
  'totals',
  'printing',
]);

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {Buffer | string} value */
export function sha256V9(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} value */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** @param {any} sample */
export function validateFichaSnapshotV9(sample) {
  invariant(
    sample?.schemaVersion === 1 &&
      sample.task === 'FPI-T05' &&
      sample.adr === '087',
    'v9 sample must trace FPI-T05 and ADR 087',
  );
  invariant(
    sample.syntheticOnly === true &&
      sample.snapshotVersion === 'synthetic-order-v9' &&
      sample.templateVersion === TEMPLATE_V9,
    'v9 sample must be the synthetic v9 version',
  );
  invariant(
    Number.isFinite(Date.parse(sample.generatedAt)),
    'v9 sample needs a date',
  );
  const order = sample.order;
  invariant(
    /^\d{2,}-CRM$/u.test(order?.number) &&
      order.status === 'confirmado' &&
      nonEmpty(order.confirmedBy?.name) &&
      Number.isSafeInteger(order.version),
    'v9 sample needs a confirmed synthetic order with a version',
  );
  const items = order.ficha?.items;
  invariant(
    Array.isArray(items) &&
      JSON.stringify(
        items.map((/** @type {any} */ item) => item.publico).sort(),
      ) === JSON.stringify([...AUDIENCES].sort()),
    'v9 sample needs one item per audience',
  );
  let total = 0;
  for (const [index, item] of items.entries()) {
    for (const field of ['tipo', 'cor', 'estampa', 'tipo_servico', 'gola']) {
      invariant(nonEmpty(item[field]), `v9 item ${index + 1} needs ${field}`);
    }
    invariant(
      Array.isArray(item.grade) && item.grade.length > 0,
      `v9 item ${index + 1} needs a size grade`,
    );
    const sum = item.grade.reduce(
      (/** @type {number} */ acc, /** @type {any} */ line) =>
        acc + line.quantidade,
      0,
    );
    total += sum;
  }
  invariant(total === order.totalPieces, 'v9 sample total must match grades');
  invariant(
    items.some((/** @type {any} */ item) => item.grade.length >= 16),
    'v9 sample needs an item with sixteen sizes',
  );
  invariant(
    items.filter((/** @type {any} */ item) => item.artPreview).length === 2 &&
      items.every(
        (/** @type {any} */ item) =>
          !item.artPreview ||
          /^data:image\/(png|jpeg|webp);base64,/u.test(item.artPreview),
      ),
    'v9 sample needs two items with an art preview and two without',
  );
  invariant(
    items.some((/** @type {any} */ item) => nonEmpty(item.modelo)),
    'v9 sample must print a model detail',
  );
  invariant(
    Array.isArray(order.ficha.observations) &&
      order.ficha.observations.length > 0 &&
      Object.keys(order.ficha.serviceData ?? {}).length > 0,
    'v9 sample needs observations and complementary service data',
  );
  invariant(
    !/R\$|pre[cç]o|subtotal|valor|payment|pagamento_/iu.test(
      JSON.stringify(order.ficha, (key, field) =>
        key === 'artPreview' ? undefined : field,
      ),
    ),
    'v9 sample must not carry money',
  );
  invariant(
    !/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(JSON.stringify(sample)),
    'v9 sample must not contain an email address',
  );
  return sample;
}

/** @param {any} sample */
export function buildFichaHtmlV9(sample) {
  validateFichaSnapshotV9(sample);
  return renderFichaHtmlV9(printSnapshot(sample.order, TEMPLATE_V9), {
    synthetic: true,
  });
}

/** @param {any} gate */
export function fichaV9ApprovalStages(gate) {
  return {
    provisional:
      gate?.provisionalApproval?.status === 'approved' &&
      gate.provisionalApproval.approved === true,
    final:
      gate?.approval?.status === 'approved' && gate.approval.approved === true,
  };
}

/** @param {any} gate */
export function fichaV9Approved(gate) {
  const stages = fichaV9ApprovalStages(gate);
  const provisional = gate?.provisionalApproval;
  return (
    stages.provisional &&
    nonEmpty(provisional?.reviewedBy?.name) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(provisional?.reviewedAt ?? '') &&
    provisional.snapshotSha256 === gate.snapshotSha256 &&
    provisional.renderedHtmlSha256 === gate.renderedHtmlSha256 &&
    provisional.artifactSha256 === gate.artifact?.sha256
  );
}

/** @param {{artifactBytes: Buffer, gate: any, renderedHtml: string, snapshotBytes: Buffer}} input */
export function validateFichaApprovalGateV9({
  artifactBytes,
  gate,
  renderedHtml,
  snapshotBytes,
}) {
  invariant(
    gate?.schemaVersion === 1 &&
      gate.task === 'FPI-T05' &&
      gate.adr === '087' &&
      gate.syntheticOnly === true &&
      JSON.stringify(gate.requirements) === JSON.stringify(REQUIREMENTS_V9),
    'v9 gate must trace FPI-T05, ADR 087 and FPI-03..13',
  );
  invariant(
    gate.snapshotVersion === 'synthetic-order-v9' &&
      gate.templateVersion === TEMPLATE_V9,
    'v9 gate must match the synthetic v9 package',
  );
  invariant(
    gate.snapshotSha256 === sha256V9(snapshotBytes) &&
      gate.renderedHtmlSha256 === sha256V9(renderedHtml),
    'v9 sample or rendered HTML changed after review',
  );
  invariant(
    artifactBytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      artifactBytes.length > 10_000 &&
      gate.artifact?.path === ARTIFACT_PATH_V9 &&
      gate.artifact.sha256 === sha256V9(artifactBytes),
    'v9 review PDF changed after review',
  );
  const actualPages = (
    artifactBytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []
  ).length;
  const plannedPages = (renderedHtml.match(/<article class="sheet/gu) ?? [])
    .length;
  // FPI-12: a front and a back per item, so the back sheets are half of the
  // sheets of the items, and the long observations of the sample continue on
  // an extra sheet.
  const backSheets = (renderedHtml.match(/<article class="sheet verso/gu) ?? [])
    .length;
  invariant(
    backSheets >= 1 &&
      plannedPages >= 2 * backSheets &&
      renderedHtml.includes('Observações (continuação)'),
    'v9 sample must print a front and a back per item and an observations continuation',
  );
  invariant(
    Number.isInteger(gate.artifact.pageCount) &&
      gate.artifact.pageCount >= 2 &&
      actualPages === gate.artifact.pageCount &&
      plannedPages === gate.artifact.pageCount,
    'v9 synthetic PDF must have one A4 page per planned sheet',
  );
  const provisional = gate.provisionalApproval;
  const reviewed = provisional?.status === 'approved';
  invariant(
    PROVISIONAL_STATUSES.includes(provisional?.status) &&
      provisional.approved === reviewed &&
      provisional.scope === 'development/cloud-dev' &&
      provisional.reviewedBy?.role === 'PO' &&
      (reviewed
        ? nonEmpty(provisional.reviewedBy.name) &&
          /^\d{4}-\d{2}-\d{2}$/u.test(provisional.reviewedAt)
        : provisional.reviewedBy.name === null &&
          provisional.reviewedAt === null) &&
      provisional.snapshotSha256 === gate.snapshotSha256 &&
      provisional.renderedHtmlSha256 === gate.renderedHtmlSha256 &&
      provisional.artifactSha256 === gate.artifact.sha256 &&
      provisional.decisionRef === REVIEW_PATH_V9,
    'v9 provisional review by the PO must lock the sample, HTML and PDF',
  );
  const approval = gate.approval;
  invariant(
    approval?.status === 'pending-human-approval' &&
      approval.approved === false &&
      approval.requiredBefore === 'production' &&
      approval.signature === 'physical' &&
      approval.reviewedBy?.rose === null &&
      approval.reviewedBy?.operation === null &&
      approval.reviewedAt === null &&
      approval.signedPaperKeptAt === null &&
      approval.evidenceRef === null &&
      JSON.stringify(Object.keys(approval.criteria ?? {})) ===
        JSON.stringify(CRITERIA_V9) &&
      Object.values(approval.criteria).every((value) => value === null),
    'v9 physical signature by Rose and Operação must remain pending',
  );
  invariant(
    gate.versioning?.overwriteApprovedVersion === false &&
      gate.versioning?.correctionsRequireNewTemplateVersion === true &&
      gate.versioning?.supersedesTemplateVersion === TEMPLATE_V8,
    'v9 must preserve earlier approved versions',
  );
  return gate;
}

export async function validateFichaReviewV9() {
  const snapshotBytes = await readFile(sampleUrl);
  const sample = JSON.parse(snapshotBytes.toString('utf8'));
  const gate = JSON.parse(await readFile(gateUrl, 'utf8'));
  const artifactBytes = await readFile(new URL(ARTIFACT_PATH_V9, rootUrl));
  validateFichaApprovalGateV9({
    artifactBytes,
    gate,
    renderedHtml: buildFichaHtmlV9(sample),
    snapshotBytes,
  });
  return gate;
}

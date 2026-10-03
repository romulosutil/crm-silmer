import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { renderFichaHtmlV5 } from '../modules/orders/src/print/ficha-canonical-v5.js';
import {
  TEMPLATE_V4,
  TEMPLATE_V5,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const rootUrl = new URL('../', import.meta.url);
const sampleUrl = new URL('docs/phase0/ficha-pdf-synthetic-v5.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval-v5.json', rootUrl);
const ARTIFACT_PATH = 'output/pdf/ficha-canonica-sintetica-v5.pdf';
const REVIEW_PATH = 'docs/phase0/FICHA-PDF-REVIEW-V5.md';
const REQUIREMENTS = Object.freeze(['TEC-07', 'PIM-10']);
// ADR 020: the PO reviews the v5 sample before orders print on it; until
// then the package is locked by hash and the review is pending.
const PROVISIONAL_STATUSES = Object.freeze(['pending-po-review', 'approved']);
const CRITERIA = Object.freeze([
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
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} value */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** @param {any} sample */
export function validateFichaSnapshotV5(sample) {
  invariant(
    sample?.schemaVersion === 1 &&
      sample.task === 'T86' &&
      sample.adr === '020',
    'v5 sample must trace T86 and ADR 020',
  );
  invariant(
    sample.syntheticOnly === true &&
      sample.snapshotVersion === 'synthetic-order-v5' &&
      sample.templateVersion === TEMPLATE_V5,
    'v5 sample must be the synthetic v5 version',
  );
  invariant(
    Number.isFinite(Date.parse(sample.generatedAt)),
    'v5 sample needs a date',
  );
  const order = sample.order;
  invariant(
    /^\d{2,}-CRM$/u.test(order?.number) &&
      order.status === 'confirmado' &&
      nonEmpty(order.confirmedBy?.name),
    'v5 sample needs a confirmed synthetic order',
  );
  invariant(
    /^\d{4}-\d{2}-\d{2}$/u.test(order.orderDate) &&
      Number.isFinite(Date.parse(order.firstContactAt)) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(order.paidOn) &&
      order.deliveredOn === null &&
      /^\d{4}-\d{2}-\d{2}$/u.test(
        order.ficha?.summary?.data_entrega_confirmada,
      ),
    'v5 sample must distinguish the two summary dates from the three trail dates',
  );
  invariant(
    order.ficha.summary.aplicacao === null,
    'v5 sample must not carry an order-wide technique',
  );
  invariant(
    Array.isArray(order.ficha?.items) && order.ficha.items.length >= 2,
    'v5 sample needs at least two items',
  );
  const artwork = order.ficha.artwork;
  invariant(
    artwork?.feito_pelo_cliente === true &&
      artwork?.feito_pela_silmer === true &&
      artwork?.sem_estampa === false &&
      Array.isArray(artwork.files) &&
      artwork.files.length === 0,
    'v5 sample needs both art origins and no stored files',
  );
  let total = 0;
  const techniques = new Set();
  for (const [index, item] of order.ficha.items.entries()) {
    for (const field of ['tipo', 'cor', 'estampa', 'tipo_servico']) {
      invariant(nonEmpty(item[field]), `v5 item ${index + 1} needs ${field}`);
    }
    invariant(
      Array.isArray(item.malhas) &&
        item.malhas.length > 0 &&
        item.malhas.every(nonEmpty) &&
        nonEmpty(item.gola || item.vies_gola),
      `v5 item ${index + 1} needs fabric and collar`,
    );
    invariant(
      Array.isArray(item.grade) && item.grade.length > 0,
      `v5 item ${index + 1} needs a size grade`,
    );
    const sizes = new Set();
    for (const grade of item.grade) {
      invariant(
        nonEmpty(grade.tamanho) &&
          !sizes.has(grade.tamanho) &&
          Number.isInteger(grade.quantidade) &&
          grade.quantidade > 0,
        `v5 item ${index + 1} has an invalid grade`,
      );
      sizes.add(grade.tamanho);
      total += grade.quantidade;
    }
    techniques.add(item.tipo_servico);
  }
  invariant(
    techniques.size >= 2,
    'v5 sample must exercise a technique per item',
  );
  invariant(total === order.totalPieces, 'v5 sample total must match grades');
  invariant(
    !/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(JSON.stringify(sample)),
    'v5 sample must not contain an email address',
  );
  return sample;
}

/** @param {any} sample */
export function buildFichaHtmlV5(sample) {
  validateFichaSnapshotV5(sample);
  return renderFichaHtmlV5(printSnapshot(sample.order, TEMPLATE_V5), {
    synthetic: true,
  });
}

/** @param {any} gate */
export function fichaV5ApprovalStages(gate) {
  return {
    provisional:
      gate?.provisionalApproval?.status === 'approved' &&
      gate.provisionalApproval.approved === true,
    final:
      gate?.approval?.status === 'approved' && gate.approval.approved === true,
  };
}

/** @param {{artifactBytes: Buffer, gate: any, renderedHtml: string, snapshotBytes: Buffer}} input */
export function validateFichaApprovalGateV5({
  artifactBytes,
  gate,
  renderedHtml,
  snapshotBytes,
}) {
  invariant(
    gate?.schemaVersion === 1 &&
      gate.task === 'T86' &&
      gate.adr === '020' &&
      gate.syntheticOnly === true &&
      JSON.stringify(gate.requirements) === JSON.stringify(REQUIREMENTS),
    'v5 gate must trace T86, ADR 020 and TEC-07/PIM-10',
  );
  invariant(
    gate.snapshotVersion === 'synthetic-order-v5' &&
      gate.templateVersion === TEMPLATE_V5,
    'v5 gate must match the synthetic v5 package',
  );
  invariant(
    gate.snapshotSha256 === sha256(snapshotBytes) &&
      gate.renderedHtmlSha256 === sha256(renderedHtml),
    'v5 sample or rendered HTML changed after review',
  );
  invariant(
    artifactBytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      artifactBytes.length > 10_000 &&
      gate.artifact?.path === ARTIFACT_PATH &&
      gate.artifact.sha256 === sha256(artifactBytes),
    'v5 review PDF changed after review',
  );
  const actualPages = (
    artifactBytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []
  ).length;
  const plannedPages =
    (renderedHtml.match(/<section class="page-break/gu) ?? []).length + 1;
  invariant(
    gate.artifact.pageCount === 2 && actualPages === 2 && plannedPages === 2,
    'v5 synthetic PDF must be two planned and actual A4 pages',
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
      provisional.decisionRef === REVIEW_PATH,
    'v5 provisional review by the PO must lock the sample, HTML and PDF',
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
        JSON.stringify(CRITERIA) &&
      Object.values(approval.criteria).every((value) => value === null),
    'v5 physical signature by Rose and Operação must remain pending',
  );
  invariant(
    gate.versioning?.overwriteApprovedVersion === false &&
      gate.versioning?.correctionsRequireNewTemplateVersion === true &&
      gate.versioning?.supersedesTemplateVersion === TEMPLATE_V4,
    'v5 must preserve earlier approved versions',
  );
  return gate;
}

export async function validateFichaReviewV5() {
  const snapshotBytes = await readFile(sampleUrl);
  const sample = JSON.parse(snapshotBytes.toString('utf8'));
  const gate = JSON.parse(await readFile(gateUrl, 'utf8'));
  const artifactBytes = await readFile(new URL(ARTIFACT_PATH, rootUrl));
  validateFichaApprovalGateV5({
    artifactBytes,
    gate,
    renderedHtml: buildFichaHtmlV5(sample),
    snapshotBytes,
  });
  return gate;
}

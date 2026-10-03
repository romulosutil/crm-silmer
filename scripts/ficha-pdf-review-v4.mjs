import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { renderFichaHtmlV4 } from '../modules/orders/src/print/ficha-canonical-v4.js';
import {
  TEMPLATE_V3,
  TEMPLATE_V4,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const rootUrl = new URL('../', import.meta.url);
const sampleUrl = new URL('docs/phase0/ficha-pdf-synthetic-v4.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval-v4.json', rootUrl);
const ARTIFACT_PATH = 'output/pdf/ficha-canonica-sintetica-v4.pdf';
const REVIEW_PATH = 'docs/phase0/FICHA-PDF-REVIEW-V4.md';
const REQUIREMENTS = Object.freeze([
  'REV-01',
  'REV-02',
  'REV-03',
  'REV-04',
  'REV-05',
  'PIM-10',
]);
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
export function validateFichaSnapshotV4(sample) {
  invariant(
    sample?.schemaVersion === 1 &&
      sample.task === 'T78' &&
      sample.adr === '019',
    'v4 sample must trace T78 and ADR 019',
  );
  invariant(
    sample.syntheticOnly === true &&
      sample.snapshotVersion === 'synthetic-order-v4' &&
      sample.templateVersion === TEMPLATE_V4,
    'v4 sample must be the synthetic v4 version',
  );
  invariant(
    Number.isFinite(Date.parse(sample.generatedAt)),
    'v4 sample needs a date',
  );
  const order = sample.order;
  invariant(
    /^\d{2,}-CRM$/u.test(order?.number) &&
      order.status === 'confirmado' &&
      nonEmpty(order.confirmedBy?.name),
    'v4 sample needs a confirmed synthetic order',
  );
  invariant(
    /^\d{4}-\d{2}-\d{2}$/u.test(order.orderDate) &&
      Number.isFinite(Date.parse(order.firstContactAt)) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(order.paidOn) &&
      order.deliveredOn === null &&
      /^\d{4}-\d{2}-\d{2}$/u.test(
        order.ficha?.summary?.data_entrega_confirmada,
      ),
    'v4 sample must distinguish the two summary dates from the three trail dates',
  );
  invariant(
    Array.isArray(order.ficha?.items) && order.ficha.items.length >= 2,
    'v4 sample needs at least two items',
  );
  invariant(
    order.ficha.artwork?.feito_pelo_cliente === true &&
      order.ficha.artwork?.feito_pela_silmer === true &&
      Array.isArray(order.ficha.artwork.files) &&
      order.ficha.artwork.files.length === 0,
    'v4 sample needs both art origins and no stored files',
  );
  let total = 0;
  const services = new Set();
  for (const [index, item] of order.ficha.items.entries()) {
    for (const field of ['tipo', 'cor', 'estampa', 'tipo_servico']) {
      invariant(nonEmpty(item[field]), `v4 item ${index + 1} needs ${field}`);
    }
    invariant(
      Array.isArray(item.malhas) &&
        item.malhas.length > 0 &&
        item.malhas.every(nonEmpty) &&
        nonEmpty(item.gola || item.vies_gola),
      `v4 item ${index + 1} needs fabric and collar definition`,
    );
    invariant(
      Array.isArray(item.grade) && item.grade.length > 0,
      `v4 item ${index + 1} needs a size grade`,
    );
    const sizes = new Set();
    for (const grade of item.grade) {
      invariant(
        nonEmpty(grade.tamanho) &&
          !sizes.has(grade.tamanho) &&
          Number.isInteger(grade.quantidade) &&
          grade.quantidade > 0,
        `v4 item ${index + 1} has an invalid grade`,
      );
      sizes.add(grade.tamanho);
      total += grade.quantidade;
    }
    services.add(item.tipo_servico);
  }
  invariant(services.size >= 2, 'v4 sample must exercise per-item service');
  invariant(total === order.totalPieces, 'v4 sample total must match grades');
  invariant(
    !/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(JSON.stringify(sample)),
    'v4 sample must not contain an email address',
  );
  return sample;
}

/** @param {any} sample */
export function buildFichaHtmlV4(sample) {
  validateFichaSnapshotV4(sample);
  return renderFichaHtmlV4(printSnapshot(sample.order, TEMPLATE_V4), {
    synthetic: true,
  });
}

/** @param {any} gate */
export function fichaV4ApprovalStages(gate) {
  return {
    provisional:
      gate?.provisionalApproval?.status === 'approved' &&
      gate.provisionalApproval.approved === true,
    final:
      gate?.approval?.status === 'approved' && gate.approval.approved === true,
  };
}

/** @param {{artifactBytes: Buffer, gate: any, renderedHtml: string, snapshotBytes: Buffer}} input */
export function validateFichaApprovalGateV4({
  artifactBytes,
  gate,
  renderedHtml,
  snapshotBytes,
}) {
  invariant(
    gate?.schemaVersion === 1 &&
      gate.task === 'T78' &&
      gate.adr === '019' &&
      gate.syntheticOnly === true &&
      JSON.stringify(gate.requirements) === JSON.stringify(REQUIREMENTS),
    'v4 gate must trace T78, ADR 019 and REV-01..05/PIM-10',
  );
  invariant(
    gate.snapshotVersion === 'synthetic-order-v4' &&
      gate.templateVersion === TEMPLATE_V4,
    'v4 gate must match the synthetic v4 package',
  );
  invariant(
    gate.snapshotSha256 === sha256(snapshotBytes) &&
      gate.renderedHtmlSha256 === sha256(renderedHtml),
    'v4 sample or rendered HTML changed after approval',
  );
  invariant(
    artifactBytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      artifactBytes.length > 10_000 &&
      gate.artifact?.path === ARTIFACT_PATH &&
      gate.artifact.sha256 === sha256(artifactBytes),
    'v4 review PDF changed after approval',
  );
  const actualPages = (
    artifactBytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []
  ).length;
  const plannedPages =
    (renderedHtml.match(/<section class="page-break/gu) ?? []).length + 1;
  invariant(
    gate.artifact.pageCount === 2 && actualPages === 2 && plannedPages === 2,
    'v4 synthetic PDF must be two planned and actual A4 pages',
  );
  const provisional = gate.provisionalApproval;
  invariant(
    provisional?.status === 'approved' &&
      provisional.approved === true &&
      provisional.scope === 'development/cloud-dev' &&
      provisional.reviewedBy?.role === 'Tech Lead' &&
      nonEmpty(provisional.reviewedBy.name) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(provisional.reviewedAt) &&
      provisional.snapshotSha256 === gate.snapshotSha256 &&
      provisional.renderedHtmlSha256 === gate.renderedHtmlSha256 &&
      provisional.artifactSha256 === gate.artifact.sha256 &&
      provisional.decisionRef === REVIEW_PATH,
    'v4 provisional approval must lock the reviewed sample, HTML and PDF',
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
    'v4 physical signature by Rose and Operação must remain pending',
  );
  invariant(
    gate.versioning?.overwriteApprovedVersion === false &&
      gate.versioning?.correctionsRequireNewTemplateVersion === true &&
      gate.versioning?.supersedesTemplateVersion === TEMPLATE_V3,
    'v4 must preserve earlier approved versions',
  );
  return gate;
}

export async function validateFichaReviewV4() {
  const snapshotBytes = await readFile(sampleUrl);
  const sample = JSON.parse(snapshotBytes.toString('utf8'));
  const gate = JSON.parse(await readFile(gateUrl, 'utf8'));
  const artifactBytes = await readFile(new URL(ARTIFACT_PATH, rootUrl));
  validateFichaApprovalGateV4({
    artifactBytes,
    gate,
    renderedHtml: buildFichaHtmlV4(sample),
    snapshotBytes,
  });
  return gate;
}

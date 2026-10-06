import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AUDIENCES } from '../modules/orders/src/domain/audiences.js';
import { renderFichaHtmlV6 } from '../modules/orders/src/print/ficha-canonical-v6.js';
import {
  TEMPLATE_V5,
  TEMPLATE_V6,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const rootUrl = new URL('../', import.meta.url);
const sampleUrl = new URL('docs/phase0/ficha-pdf-synthetic-v6.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval-v6.json', rootUrl);
const ARTIFACT_PATH = 'output/pdf/ficha-canonica-sintetica-v6.pdf';
const REVIEW_PATH = 'docs/phase0/FICHA-PDF-REVIEW-V6.md';
const REQUIREMENTS = Object.freeze(['PUB-07', 'PIM-10']);
// ADR 025: the PO reviews the v6 sample before orders print on it; until
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
export function validateFichaSnapshotV6(sample) {
  invariant(
    sample?.schemaVersion === 1 &&
      sample.task === 'T100' &&
      sample.adr === '025',
    'v6 sample must trace T100 and ADR 025',
  );
  invariant(
    sample.syntheticOnly === true &&
      sample.snapshotVersion === 'synthetic-order-v6' &&
      sample.templateVersion === TEMPLATE_V6,
    'v6 sample must be the synthetic v6 version',
  );
  invariant(
    Number.isFinite(Date.parse(sample.generatedAt)),
    'v6 sample needs a date',
  );
  const order = sample.order;
  invariant(
    /^\d{2,}-CRM$/u.test(order?.number) &&
      order.status === 'confirmado' &&
      nonEmpty(order.confirmedBy?.name),
    'v6 sample needs a confirmed synthetic order',
  );
  invariant(
    /^\d{4}-\d{2}-\d{2}$/u.test(order.orderDate) &&
      Number.isFinite(Date.parse(order.firstContactAt)) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(order.paidOn) &&
      order.deliveredOn === null &&
      /^\d{4}-\d{2}-\d{2}$/u.test(
        order.ficha?.summary?.data_entrega_confirmada,
      ),
    'v6 sample must distinguish the two summary dates from the three trail dates',
  );
  invariant(
    order.ficha.summary.aplicacao === null,
    'v6 sample must not carry an order-wide technique',
  );
  const items = order.ficha?.items;
  invariant(
    Array.isArray(items) && items.length === AUDIENCES.length,
    'v6 sample needs one item per audience',
  );
  invariant(
    JSON.stringify(
      items.map((/** @type {any} */ item) => item.publico).sort(),
    ) === JSON.stringify([...AUDIENCES].sort()),
    'v6 sample must print every audience once',
  );
  const artwork = order.ficha.artwork;
  invariant(
    artwork?.feito_pelo_cliente === true &&
      artwork?.feito_pela_silmer === true &&
      artwork?.sem_estampa === false &&
      Array.isArray(artwork.files) &&
      artwork.files.length === 0,
    'v6 sample needs both art origins and no stored files',
  );
  let total = 0;
  let differs = false;
  for (const [index, item] of items.entries()) {
    for (const field of ['tipo', 'cor', 'estampa', 'tipo_servico']) {
      invariant(nonEmpty(item[field]), `v6 item ${index + 1} needs ${field}`);
    }
    invariant(
      Array.isArray(item.malhas) &&
        item.malhas.length > 0 &&
        item.malhas.every(nonEmpty) &&
        nonEmpty(item.gola || item.vies_gola),
      `v6 item ${index + 1} needs fabric model and collar`,
    );
    invariant(
      Array.isArray(item.grade) && item.grade.length > 0,
      `v6 item ${index + 1} needs a size grade`,
    );
    const sizes = new Set();
    let itemTotal = 0;
    for (const grade of item.grade) {
      invariant(
        nonEmpty(grade.tamanho) &&
          !sizes.has(grade.tamanho) &&
          Number.isInteger(grade.quantidade) &&
          grade.quantidade > 0,
        `v6 item ${index + 1} has an invalid grade`,
      );
      sizes.add(grade.tamanho);
      itemTotal += grade.quantidade;
    }
    invariant(
      item.quantidade_informada === null ||
        (Number.isInteger(item.quantidade_informada) &&
          item.quantidade_informada > 0),
      `v6 item ${index + 1} has an invalid quantity said`,
    );
    if (
      item.quantidade_informada !== null &&
      item.quantidade_informada !== itemTotal
    ) {
      differs = true;
    }
    total += itemTotal;
  }
  invariant(
    differs,
    'v6 sample must print a quantity said that differs from the sizes',
  );
  invariant(total === order.totalPieces, 'v6 sample total must match grades');
  invariant(
    !/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(JSON.stringify(sample)),
    'v6 sample must not contain an email address',
  );
  return sample;
}

/** @param {any} sample */
export function buildFichaHtmlV6(sample) {
  validateFichaSnapshotV6(sample);
  return renderFichaHtmlV6(printSnapshot(sample.order, TEMPLATE_V6), {
    synthetic: true,
  });
}

/** @param {any} gate */
export function fichaV6ApprovalStages(gate) {
  return {
    provisional:
      gate?.provisionalApproval?.status === 'approved' &&
      gate.provisionalApproval.approved === true,
    final:
      gate?.approval?.status === 'approved' && gate.approval.approved === true,
  };
}

/** @param {{artifactBytes: Buffer, gate: any, renderedHtml: string, snapshotBytes: Buffer}} input */
export function validateFichaApprovalGateV6({
  artifactBytes,
  gate,
  renderedHtml,
  snapshotBytes,
}) {
  invariant(
    gate?.schemaVersion === 1 &&
      gate.task === 'T100' &&
      gate.adr === '025' &&
      gate.syntheticOnly === true &&
      JSON.stringify(gate.requirements) === JSON.stringify(REQUIREMENTS),
    'v6 gate must trace T100, ADR 025 and PUB-07/PIM-10',
  );
  invariant(
    gate.snapshotVersion === 'synthetic-order-v6' &&
      gate.templateVersion === TEMPLATE_V6,
    'v6 gate must match the synthetic v6 package',
  );
  invariant(
    gate.snapshotSha256 === sha256(snapshotBytes) &&
      gate.renderedHtmlSha256 === sha256(renderedHtml),
    'v6 sample or rendered HTML changed after review',
  );
  invariant(
    artifactBytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      artifactBytes.length > 10_000 &&
      gate.artifact?.path === ARTIFACT_PATH &&
      gate.artifact.sha256 === sha256(artifactBytes),
    'v6 review PDF changed after review',
  );
  const actualPages = (
    artifactBytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []
  ).length;
  const plannedPages =
    (renderedHtml.match(/<section class="page-break/gu) ?? []).length + 1;
  invariant(
    Number.isInteger(gate.artifact.pageCount) &&
      gate.artifact.pageCount >= 2 &&
      actualPages === gate.artifact.pageCount &&
      plannedPages === gate.artifact.pageCount,
    'v6 synthetic PDF must have the planned number of A4 pages',
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
    'v6 provisional review by the PO must lock the sample, HTML and PDF',
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
    'v6 physical signature by Rose and Operação must remain pending',
  );
  invariant(
    gate.versioning?.overwriteApprovedVersion === false &&
      gate.versioning?.correctionsRequireNewTemplateVersion === true &&
      gate.versioning?.supersedesTemplateVersion === TEMPLATE_V5,
    'v6 must preserve earlier approved versions',
  );
  return gate;
}

export async function validateFichaReviewV6() {
  const snapshotBytes = await readFile(sampleUrl);
  const sample = JSON.parse(snapshotBytes.toString('utf8'));
  const gate = JSON.parse(await readFile(gateUrl, 'utf8'));
  const artifactBytes = await readFile(new URL(ARTIFACT_PATH, rootUrl));
  validateFichaApprovalGateV6({
    artifactBytes,
    gate,
    renderedHtml: buildFichaHtmlV6(sample),
    snapshotBytes,
  });
  return gate;
}

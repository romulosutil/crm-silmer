import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { renderFichaHtmlV7 } from '../modules/orders/src/print/ficha-canonical-v7.js';
import { renderOrderFicha } from '../modules/orders/src/print/index.js';
import {
  TEMPLATE_V7,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const root = new URL('../', import.meta.url);
export const SAMPLE_V7_PATH = 'docs/phase0/ficha-pdf-synthetic-v7.json';
export const GATE_V7_PATH = 'docs/phase0/ficha-pdf-approval-v7.json';
const REVIEW_PATH = 'docs/phase0/FICHA-PDF-REVIEW-V7.md';

/** @param {Buffer|string} value */
export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

/** @param {any} sample */
export function buildFichaContentSamples(sample) {
  assert.equal(sample.syntheticOnly, true);
  assert.equal(sample.task, 'FIP-T01');
  return {
    attendance: renderFichaHtmlV7(
      printSnapshot(sample.attendance, TEMPLATE_V7),
      { synthetic: true },
    ),
    store: renderOrderFicha(sample.store, TEMPLATE_V7),
  };
}

/** @param {any} gate */
export function fichaV7Approved(gate) {
  const approval = gate?.provisionalApproval;
  return (
    gate?.templateVersion === TEMPLATE_V7 &&
    approval?.status === 'approved' &&
    approval.approved === true &&
    approval.scope === 'development/cloud-dev' &&
    approval.reviewedBy?.role === 'PO' &&
    typeof approval.reviewedBy.name === 'string' &&
    approval.reviewedBy.name.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(approval.reviewedAt ?? '') &&
    approval.decisionRef === REVIEW_PATH &&
    approval.bundleSha256 ===
      sha256(
        JSON.stringify({
          sampleSha256: gate.sampleSha256,
          samples: gate.samples,
        }),
      )
  );
}

/** Fail closed for both HTML renderers and both PDFs, including pending packages. */
export async function validateFichaReviewV7() {
  const bytes = await readFile(new URL(SAMPLE_V7_PATH, root));
  const sample = JSON.parse(bytes.toString('utf8'));
  const gate = JSON.parse(await readFile(new URL(GATE_V7_PATH, root), 'utf8'));
  const html = buildFichaContentSamples(sample);
  assert.equal(gate.schemaVersion, 1);
  assert.equal(gate.task, 'FIP-T01');
  assert.equal(gate.templateVersion, TEMPLATE_V7);
  assert.equal(gate.sampleSha256, sha256(bytes));
  assert.deepEqual(Object.keys(gate.samples), ['attendance', 'store']);
  for (const key of /** @type {const} */ (['attendance', 'store'])) {
    const entry = gate.samples[key];
    assert.equal(
      entry.templateVersion,
      key === 'attendance' ? TEMPLATE_V7 : 'ficha-loja-v2',
    );
    assert.equal(entry.renderedHtmlSha256, sha256(html[key]));
    assert.equal(
      entry.path,
      `output/pdf/ficha-informacoes-2026-11-09/${key}.pdf`,
    );
    const artifact = await readFile(new URL(entry.path, root));
    assert.equal(sha256(artifact), entry.sha256);
    assert.equal(
      (artifact.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length,
      entry.pageCount,
    );
  }
  assert.equal(
    gate.provisionalApproval.bundleSha256,
    sha256(
      JSON.stringify({
        sampleSha256: gate.sampleSha256,
        samples: gate.samples,
      }),
    ),
  );
  if (!fichaV7Approved(gate)) {
    assert.equal(gate.provisionalApproval.status, 'pending-po-review');
    assert.equal(gate.provisionalApproval.approved, false);
    assert.equal(gate.provisionalApproval.reviewedBy.name, null);
    assert.equal(gate.provisionalApproval.reviewedAt, null);
  }
  assert.equal(gate.approval.status, 'pending-human-approval');
  assert.equal(gate.approval.approved, false);
  assert.equal(gate.approval.signature, 'physical');
  assert.equal(gate.approval.requiredBefore, 'production');
  assert.deepEqual(gate.approval.reviewedBy, { rose: null, operation: null });
  return gate;
}

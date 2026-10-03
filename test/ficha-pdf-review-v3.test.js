import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderFichaHtmlV3 } from '../modules/orders/src/print/ficha-canonical-v3.js';
import {
  TEMPLATE_V3,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';
import {
  buildFichaHtmlV3,
  refuseApprovedRegeneration,
  validateFichaApprovalEvidenceV3,
  validateFichaApprovalGateV3,
  validateFichaSnapshotV3,
} from '../scripts/ficha-pdf-review.mjs';

// ADR 017 / T63: the v3 review package mirrors the v2 gate. The approval
// stays pending until the people the PO names sign it.

const rootUrl = new URL('../', import.meta.url);

/** @param {Buffer | string} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture() {
  const snapshotBytes = await readFile(
    new URL('docs/phase0/ficha-pdf-synthetic-v3.json', rootUrl),
  );
  const gate = JSON.parse(
    await readFile(
      new URL('docs/phase0/ficha-pdf-approval-v3.json', rootUrl),
      'utf8',
    ),
  );
  const artifactBytes = await readFile(new URL(gate.artifact.path, rootUrl));
  const sample = JSON.parse(snapshotBytes.toString('utf8'));
  return {
    artifactBytes,
    gate,
    renderedHtml: buildFichaHtmlV3(sample),
    sample,
    snapshotBytes,
  };
}

/** A complete approval, in memory only: no one has signed the real gate. */
function approvedCopy(/** @type {any} */ gate) {
  const approved = structuredClone(gate);
  approved.approval = {
    status: 'approved',
    approved: true,
    reviewedBy: [{ name: 'Pessoa Sintetica', role: 'PO' }],
    reviewedAt: '2026-10-03T10:00:00-03:00',
    criteria: Object.fromEntries(
      Object.keys(gate.approval.criteria).map((key) => [key, true]),
    ),
    evidenceRef: 'docs/phase0/ficha-pdf-approved-evidence-v3.json',
  };
  const evidence = {
    schemaVersion: 1,
    task: 'T63',
    adr: '017',
    syntheticOnly: true,
    templateVersion: approved.templateVersion,
    snapshotVersion: approved.snapshotVersion,
    snapshotSha256: approved.snapshotSha256,
    renderedHtmlSha256: approved.renderedHtmlSha256,
    artifactSha256: approved.artifact.sha256,
    reviewedAt: approved.approval.reviewedAt,
    reviewedBy: approved.approval.reviewedBy,
    criteria: approved.approval.criteria,
    visualEvidence: [{ type: 'git', ref: 'git:abc1234', containsPii: false }],
  };
  return { approved, evidence };
}

test('the v3 sample covers every rule the PO judges on paper', async () => {
  const { sample } = await fixture();

  const { gradeTotal } = validateFichaSnapshotV3(sample);

  assert.equal(sample.syntheticOnly, true);
  assert.equal(sample.order.ficha.items.length, 2);
  assert.equal(gradeTotal, 52);
  assert.equal(sample.order.totalPieces, gradeTotal);
  const [polo, regata] = sample.order.ficha.items;
  assert.equal(polo.tipo, 'CAMISA POLO');
  assert.equal(regata.tipo, 'REGATA');
  assert.ok(regata.grade.length >= 6);
  assert.ok(regata.estampa.length >= 80);
  assert.equal(regata.cor_manga_direita, 'NAO APLICAVEL');
  assert.equal(sample.order.deliveredOn, null);
});

test('the v3 sample refuses gaps, wrong totals and contact data', async () => {
  const { sample } = await fixture();
  /** @param {(copy: any) => void} change @param {RegExp} message */
  const refuses = (change, message) => {
    const copy = structuredClone(sample);
    change(copy);
    assert.throws(() => validateFichaSnapshotV3(copy), message);
  };

  refuses((copy) => {
    copy.order.ficha.items[0].gola = '';
  }, /items\[0\]\.gola is required/u);
  refuses((copy) => {
    copy.order.totalPieces = 53;
  }, /sum of every grade/u);
  refuses((copy) => {
    copy.order.ficha.items[1].cor_manga_direita = '';
    copy.order.ficha.items[1].cor_manga_esquerda = '';
  }, /NAO APLICAVEL/u);
  refuses((copy) => {
    delete copy.order.ficha.items[0].vies_gola;
  }, /must be text, even when blank/u);
  refuses((copy) => {
    copy.order.ficha.observations = ['Contato +55 11 99999-1234'];
  }, /must not contain email addresses or phone numbers/u);
  refuses((copy) => {
    copy.syntheticOnly = false;
  }, /synthetic only/u);
});

test('the review HTML is the print path of the sample with the review marks on', async () => {
  const { renderedHtml, sample } = await fixture();

  assert.equal(
    renderedHtml,
    renderFichaHtmlV3(printSnapshot(sample.order, TEMPLATE_V3), {
      synthetic: true,
    }),
  );
  assert.match(renderedHtml, /Amostra sintética — não produzir/u);
  assert.match(renderedHtml, /NÃO APLICÁVEL/u);
  assert.match(renderedHtml, /Lastro do pedido/u);
  assert.match(renderedHtml, /Adicionais/u);
});

test('locks the sample, the rendered HTML and the PDF by hash, approval pending', async () => {
  const { artifactBytes, gate, renderedHtml, snapshotBytes } = await fixture();
  const input = { artifactBytes, renderedHtml, snapshotBytes };

  assert.doesNotThrow(() => validateFichaApprovalGateV3({ ...input, gate }));
  assert.equal(gate.templateVersion, 'ficha-canonical-v3');
  assert.equal(
    gate.artifact.path,
    'output/pdf/ficha-canonica-sintetica-v3.pdf',
  );
  assert.equal(gate.snapshotSha256, sha256(snapshotBytes));
  assert.equal(gate.renderedHtmlSha256, sha256(renderedHtml));
  assert.equal(gate.artifact.sha256, sha256(artifactBytes));
  assert.equal(gate.artifact.pageCount, 2);
  assert.deepEqual(gate.requirements, [
    'PIM-06',
    'PIM-07',
    'PIM-08',
    'PIM-09',
    'PIM-11',
    'PLA-08',
  ]);
  // Nobody signed v3: the human approval is left wholly pending.
  assert.equal(gate.approval.status, 'pending-human-approval');
  assert.equal(gate.approval.approved, false);
  assert.equal(gate.approval.reviewedBy, null);
  assert.equal(gate.approval.reviewedAt, null);
  assert.equal(gate.approval.evidenceRef, null);
  assert.ok(Object.values(gate.approval.criteria).every((v) => v === null));
  assert.equal(gate.versioning.supersedesTemplateVersion, 'ficha-canonical-v2');

  const wrongArtifact = Buffer.from(artifactBytes);
  wrongArtifact[wrongArtifact.length - 1] ^= 1;
  assert.throws(
    () =>
      validateFichaApprovalGateV3({
        ...input,
        artifactBytes: wrongArtifact,
        gate,
      }),
    /v3 artifact SHA-256/u,
  );
  assert.throws(
    () =>
      validateFichaApprovalGateV3({
        ...input,
        gate,
        renderedHtml: renderedHtml.replace('Gola', 'Golas'),
      }),
    /template changed after the PDF/u,
  );
  assert.throws(
    () =>
      validateFichaApprovalGateV3({
        ...input,
        gate,
        snapshotBytes: Buffer.concat([snapshotBytes, Buffer.from(' ')]),
      }),
    /v3 sample SHA-256/u,
  );
});

test('accepts only a whole approval with evidence, never a partial one', async () => {
  const { artifactBytes, gate, renderedHtml, snapshotBytes } = await fixture();
  const input = { artifactBytes, renderedHtml, snapshotBytes };
  const { approved, evidence } = approvedCopy(gate);

  assert.doesNotThrow(() =>
    validateFichaApprovalGateV3({ ...input, evidence, gate: approved }),
  );
  assert.throws(
    () =>
      validateFichaApprovalGateV3({ ...input, evidence: null, gate: approved }),
    /Approved evidence must be synthetic/u,
  );

  const partial = structuredClone(gate);
  partial.approval.reviewedBy = [{ name: 'Pessoa Sintetica', role: 'PO' }];
  assert.throws(
    () => validateFichaApprovalGateV3({ ...input, gate: partial }),
    /wholly pending or wholly approved/u,
  );
  const unnamed = structuredClone(approved);
  unnamed.approval.reviewedBy = [{ name: '', role: 'PO' }];
  assert.throws(
    () => validateFichaApprovalGateV3({ ...input, evidence, gate: unnamed }),
    /wholly pending or wholly approved/u,
  );
  const oneCriterion = structuredClone(approved);
  oneCriterion.approval.criteria.printing = false;
  assert.throws(
    () =>
      validateFichaApprovalGateV3({ ...input, evidence, gate: oneCriterion }),
    /wholly pending or wholly approved/u,
  );

  const leaked = /** @type {any} */ (structuredClone(evidence));
  leaked.notes = 'Contato +55 11 99999-1234';
  assert.throws(
    () => validateFichaApprovalEvidenceV3(leaked, approved),
    /must not contain email addresses or phone numbers/u,
  );
  const otherPdf = structuredClone(evidence);
  otherPdf.artifactSha256 = '0'.repeat(64);
  assert.throws(
    () => validateFichaApprovalEvidenceV3(otherPdf, approved),
    /exact snapshot, template, and artifact/u,
  );
});

test('refuses to regenerate an approved v3 PDF', async () => {
  const { gate } = await fixture();

  assert.doesNotThrow(() => refuseApprovedRegeneration(gate));
  assert.doesNotThrow(() => refuseApprovedRegeneration(null));
  assert.throws(
    () => refuseApprovedRegeneration(approvedCopy(gate).approved),
    /cannot be regenerated/u,
  );
});

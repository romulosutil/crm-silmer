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
  fichaV3ApprovalStages,
  plannedPages,
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

/**
 * A complete approval, in memory only: Rose and Operação have not signed the
 * printed sample, and the real record stays pending.
 */
function approvedCopy(/** @type {any} */ gate) {
  const approved = structuredClone(gate);
  approved.approval = {
    status: 'approved',
    approved: true,
    requiredBefore: 'production',
    signature: 'physical',
    reviewedBy: { rose: 'Rose', operation: 'Operacao Silmer' },
    reviewedAt: '2026-10-03T10:00:00-03:00',
    signedPaperKeptAt: 'Pasta de fichas aprovadas da Silmer',
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
    signature: 'physical',
    signedPaperKeptAt: approved.approval.signedPaperKeptAt,
    visualEvidence: [{ type: 'git', ref: 'git:abc1234', containsPii: false }],
  };
  return { approved, evidence };
}

test('the v3 sample covers every rule the PO judges on paper', async () => {
  const { sample } = await fixture();

  const { gradeTotal } = validateFichaSnapshotV3(sample);

  assert.equal(sample.syntheticOnly, true);
  assert.equal(sample.order.ficha.items.length, 3);
  assert.equal(gradeTotal, 70);
  assert.equal(sample.order.totalPieces, gradeTotal);
  const [polo, regata, babyLook] = sample.order.ficha.items;
  assert.equal(polo.tipo, 'CAMISA POLO');
  assert.equal(regata.tipo, 'REGATA');
  assert.equal(babyLook.tipo, 'BABY LOOK');
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
  refuses((copy) => {
    copy.order.deliveredOn = '2026-10-02';
  }, /delivery that happened not recorded yet/u);
  refuses((copy) => {
    copy.order.ficha.items.pop();
    copy.order.totalPieces = 52;
  }, /at least three items/u);
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

test('locks the sample, the rendered HTML and the PDF by hash, final approval pending', async () => {
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
  // Page 1, the continuation with the third item, the production control.
  assert.equal(gate.artifact.pageCount, 3);
  assert.equal(plannedPages(renderedHtml), 3);
  assert.deepEqual(gate.requirements, [
    'PIM-06',
    'PIM-07',
    'PIM-08',
    'PIM-09',
    'PIM-11',
    'PIM-12',
    'PLA-08',
  ]);
  // Stage 1 (ADR 017): the PO approved v3 for development and cloud-dev,
  // locking exactly this sample, HTML and PDF.
  assert.deepEqual(gate.provisionalApproval, {
    status: 'approved',
    approved: true,
    scope: 'development/cloud-dev',
    reviewedBy: { role: 'PO', name: 'Rômulo Sutil' },
    reviewedAt: '2026-10-03',
    snapshotSha256: gate.snapshotSha256,
    renderedHtmlSha256: gate.renderedHtmlSha256,
    artifactSha256: gate.artifact.sha256,
    decisionRef: 'docs/adr/017-ficha-impressa-com-os-sete-pontos.md',
  });
  // Stage 2: nobody signed the printed sample; the final approval, required
  // before production, is left wholly pending.
  assert.equal(gate.approval.requiredBefore, 'production');
  assert.equal(gate.approval.status, 'pending-human-approval');
  assert.equal(gate.approval.approved, false);
  assert.equal(gate.approval.signature, 'physical');
  assert.deepEqual(gate.approval.reviewedBy, { rose: null, operation: null });
  assert.equal(gate.approval.signedPaperKeptAt, null);
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
  partial.approval.reviewedBy.rose = 'Rose';
  assert.throws(
    () => validateFichaApprovalGateV3({ ...input, gate: partial }),
    /wholly pending or wholly approved/u,
  );
  const unnamed = structuredClone(approved);
  unnamed.approval.reviewedBy.operation = '';
  assert.throws(
    () => validateFichaApprovalGateV3({ ...input, evidence, gate: unnamed }),
    /wholly pending or wholly approved/u,
  );
  const paperNowhere = structuredClone(approved);
  paperNowhere.approval.signedPaperKeptAt = null;
  assert.throws(
    () =>
      validateFichaApprovalGateV3({ ...input, evidence, gate: paperNowhere }),
    /wholly pending or wholly approved/u,
  );
  // Only Rose and Operação sign, by hand on the printed sample.
  const otherSigners = structuredClone(approved);
  otherSigners.approval.reviewedBy = { po: 'Pessoa Sintetica' };
  assert.throws(
    () =>
      validateFichaApprovalGateV3({ ...input, evidence, gate: otherSigners }),
    /physical signature by Rose and Operação/u,
  );
  const digital = structuredClone(approved);
  digital.approval.signature = 'digital';
  assert.throws(
    () => validateFichaApprovalGateV3({ ...input, evidence, gate: digital }),
    /physical signature by Rose and Operação/u,
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

test('keeps the provisional approval whole and bound to what the PO approved', async () => {
  const { artifactBytes, gate, renderedHtml, snapshotBytes } = await fixture();
  const input = { artifactBytes, renderedHtml, snapshotBytes };
  /** @param {(copy: any) => void} change @param {RegExp} message */
  const refuses = (change, message) => {
    const copy = structuredClone(gate);
    change(copy);
    assert.throws(
      () => validateFichaApprovalGateV3({ ...input, gate: copy }),
      message,
    );
  };

  assert.deepEqual(fichaV3ApprovalStages(gate), {
    final: false,
    provisional: true,
  });
  refuses((copy) => {
    copy.provisionalApproval.artifactSha256 = '0'.repeat(64);
  }, /locks the sample, HTML and PDF the PO approved/u);
  refuses((copy) => {
    copy.provisionalApproval.reviewedBy.role = 'Vendedor';
  }, /wholly pending or wholly approved/u);
  refuses((copy) => {
    copy.provisionalApproval.reviewedAt = null;
  }, /wholly pending or wholly approved/u);
  refuses((copy) => {
    copy.provisionalApproval.scope = 'production';
  }, /development\/cloud-dev only/u);
  refuses((copy) => {
    delete copy.approval.requiredBefore;
  }, /required before production/u);
  // A fresh package starts with both stages pending.
  const fresh = structuredClone(gate);
  Object.assign(fresh.provisionalApproval, {
    approved: false,
    artifactSha256: null,
    renderedHtmlSha256: null,
    reviewedAt: null,
    reviewedBy: null,
    snapshotSha256: null,
    status: 'pending-human-approval',
  });
  assert.doesNotThrow(() =>
    validateFichaApprovalGateV3({ ...input, gate: fresh }),
  );
  assert.deepEqual(fichaV3ApprovalStages(fresh), {
    final: false,
    provisional: false,
  });
});

test('refuses to regenerate a v3 PDF approved at either stage', async () => {
  const { gate } = await fixture();
  const fresh = structuredClone(gate);
  fresh.provisionalApproval.status = 'pending-human-approval';
  fresh.provisionalApproval.approved = false;

  assert.doesNotThrow(() => refuseApprovedRegeneration(fresh));
  assert.doesNotThrow(() => refuseApprovedRegeneration(null));
  assert.throws(
    () => refuseApprovedRegeneration(gate),
    /cannot be regenerated/u,
  );
  assert.throws(
    () => refuseApprovedRegeneration(approvedCopy(fresh).approved),
    /cannot be regenerated/u,
  );
});

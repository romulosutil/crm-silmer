import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRODUCTION_FIELDS,
  buildFichaHtml,
  validateFichaApprovalEvidence,
  validateFichaApprovalGate,
  validateFichaSnapshot,
} from '../scripts/ficha-pdf-review.mjs';

const rootUrl = new URL('../', import.meta.url);

async function fixture() {
  const snapshotBytes = await readFile(
    new URL('docs/phase0/ficha-pdf-synthetic.json', rootUrl),
  );
  const artifactBytes = await readFile(
    new URL('output/pdf/ficha-canonica-sintetica-v1.pdf', rootUrl),
  );
  const gate = JSON.parse(
    await readFile(
      new URL('docs/phase0/ficha-pdf-approval.json', rootUrl),
      'utf8',
    ),
  );

  return {
    artifactBytes,
    gate,
    snapshot: JSON.parse(snapshotBytes.toString('utf8')),
    snapshotBytes,
  };
}

test('covers every commercial Ficha field and derives the grade total', async () => {
  const { snapshot } = await fixture();

  const result = validateFichaSnapshot(snapshot);

  assert.equal(snapshot.syntheticOnly, true);
  assert.equal(snapshot.pedido.numero, '01-CRM');
  assert.equal(snapshot.pedido.fab, '01');
  assert.equal(snapshot.pedido.itens.length, 2);
  assert.equal(result.gradeTotal, 32);
  assert.equal(snapshot.pedido.quantidade_total, result.gradeTotal);
  for (const item of snapshot.pedido.itens) {
    assert.ok(item.tipo);
    assert.ok(item.modelo);
    assert.ok(item.malhas.length > 0);
    assert.ok(item.cor_frente);
    assert.ok(item.cor_costas);
    assert.ok(item.cor_manga_direita);
    assert.ok(item.cor_manga_esquerda);
    assert.ok(item.vies_gola);
    assert.ok(item.vies_mangas);
    assert.ok(item.grade.length > 0);
  }
  assert.ok(snapshot.pedido.observacoes.length > 0);
});

test('keeps all production fields present and blank', async () => {
  const { snapshot } = await fixture();

  validateFichaSnapshot(snapshot);

  assert.deepEqual(Object.keys(snapshot.producao), PRODUCTION_FIELDS);
  for (const value of Object.values(snapshot.producao)) {
    assert.equal(value, '');
  }
});

test('renders a review document without hiding blank production fields', async () => {
  const { snapshot } = await fixture();

  const html = buildFichaHtml(snapshot);

  assert.match(html, /FICHA DE PEDIDO/u);
  assert.match(html, /01-CRM/u);
  assert.match(html, /TOTAL DE PECAS/u);
  assert.match(html, /32/u);
  assert.match(html, /Conferido para arrematar por:/u);
  assert.match(html, /Qtd total de cores do pedido:/u);
  assert.match(html, /campo-producao-vazio/u);
  assert.doesNotMatch(html, /secret:\/\//u);
});

test('validates hashes and preserves a fail-closed human approval', async () => {
  const { artifactBytes, gate, snapshotBytes } = await fixture();

  assert.doesNotThrow(() =>
    validateFichaApprovalGate({ artifactBytes, gate, snapshotBytes }),
  );
  assert.equal(gate.approval.status, 'pending-human-approval');
  assert.equal(gate.approval.approved, false);
  assert.equal(gate.approval.reviewedAt, null);
  assert.equal(gate.approval.evidenceRef, null);

  const partial = structuredClone(gate);
  partial.approval.approved = true;
  assert.throws(
    () =>
      validateFichaApprovalGate({
        artifactBytes,
        gate: partial,
        snapshotBytes,
      }),
    /wholly pending or wholly approved/iu,
  );
  const wrongCriteria = structuredClone(gate);
  wrongCriteria.approval.criteria = {
    ...wrongCriteria.approval.criteria,
    visualAppeal: null,
  };
  delete wrongCriteria.approval.criteria.printing;
  assert.throws(
    () =>
      validateFichaApprovalGate({
        artifactBytes,
        gate: wrongCriteria,
        snapshotBytes,
      }),
    /every canonical review criterion/iu,
  );

  const approved = structuredClone(gate);
  approved.approval = {
    ...approved.approval,
    approved: true,
    status: 'approved',
    reviewedAt: '2026-09-01T12:00:00-03:00',
    reviewedBy: { operation: 'Operacao Silmer', rose: 'Rose' },
    criteria: Object.fromEntries(
      Object.keys(approved.approval.criteria).map((criterion) => [
        criterion,
        true,
      ]),
    ),
    evidenceRef: 'docs/phase0/ficha-pdf-approved-evidence-v1.json',
  };
  const evidence = {
    schemaVersion: 1,
    task: 'T00.4',
    issue: 7,
    syntheticOnly: true,
    templateVersion: approved.templateVersion,
    snapshotVersion: approved.snapshotVersion,
    snapshotSha256: approved.snapshotSha256,
    artifactSha256: approved.artifact.sha256,
    reviewedAt: approved.approval.reviewedAt,
    reviewedBy: approved.approval.reviewedBy,
    criteria: approved.approval.criteria,
    visualEvidence: [{ containsPii: false, ref: 'git:abc123', type: 'git' }],
  };
  assert.doesNotThrow(() => validateFichaApprovalEvidence(evidence, approved));
  assert.doesNotThrow(() =>
    validateFichaApprovalGate({
      artifactBytes,
      evidence,
      gate: approved,
      snapshotBytes,
    }),
  );
  assert.throws(
    () =>
      validateFichaApprovalGate({
        artifactBytes,
        gate: approved,
        snapshotBytes,
      }),
    /Approved evidence must be synthetic/iu,
  );
  const evidenceWithPii = /** @type {any} */ (structuredClone(evidence));
  evidenceWithPii.notes = 'Contato +55 11 99999-1234';
  assert.throws(
    () => validateFichaApprovalEvidence(evidenceWithPii, approved),
    /must not contain email addresses or phone numbers/iu,
  );

  const wrongArtifact = Buffer.from(artifactBytes);
  wrongArtifact[wrongArtifact.length - 1] ^= 1;
  assert.throws(
    () =>
      validateFichaApprovalGate({
        artifactBytes: wrongArtifact,
        gate,
        snapshotBytes,
      }),
    /artifact SHA-256/iu,
  );
});

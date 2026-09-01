import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRODUCTION_FIELDS,
  buildLegacyFichaHtml,
  buildFichaHtml,
  buildReviewPageHtml,
  containsPersonalContact,
  validateFichaApprovalEvidence,
  validateFichaApprovalGate,
  validateFichaSnapshot,
} from '../scripts/ficha-pdf-review.mjs';

const rootUrl = new URL('../', import.meta.url);

async function fixture() {
  const snapshotBytes = await readFile(
    new URL('docs/phase0/ficha-pdf-synthetic.json', rootUrl),
  );
  const gate = JSON.parse(
    await readFile(
      new URL('docs/phase0/ficha-pdf-approval.json', rootUrl),
      'utf8',
    ),
  );
  const artifactBytes = await readFile(new URL(gate.artifact.path, rootUrl));
  const legacyArtifactBytes = await readFile(
    new URL(gate.legacyArtifact.path, rootUrl),
  );
  const reviewPageHtml = await readFile(
    new URL(gate.reviewPage.path, rootUrl),
    'utf8',
  );

  return {
    artifactBytes,
    gate,
    legacyArtifactBytes,
    reviewPageHtml,
    snapshot: JSON.parse(snapshotBytes.toString('utf8')),
    snapshotBytes,
  };
}

test('detects contact data without matching numeric fragments inside identifiers', () => {
  assert.equal(
    containsPersonalContact(
      'c25e947b9573afceb726f5ff089a7c0f2fcd2da2ac10432342511234567890',
    ),
    false,
  );
  assert.equal(containsPersonalContact('id-12345678901-suffix'), false);
  assert.equal(containsPersonalContact('(11) 99999-1234'), true);
  assert.equal(containsPersonalContact('Contato +55 11 99999-1234'), true);
});

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

test('renders the modular candidate without hiding blank production fields', async () => {
  const { snapshot } = await fixture();

  const html = buildFichaHtml(snapshot);

  assert.match(html, /FICHA DE PEDIDO/u);
  assert.match(html, /01-CRM/u);
  assert.match(html, /Resumo do pedido/u);
  assert.match(html, /Item 1/u);
  assert.match(html, /Grade/u);
  assert.match(html, /Total de pecas/u);
  assert.match(html, /32/u);
  assert.match(html, /Arremate/u);
  assert.match(html, /Conferencia e embalagem/u);
  assert.match(html, /Cores e arte/u);
  assert.match(html, /Conferido para arrematar por:/u);
  assert.match(html, /Qtd total de cores do pedido:/u);
  assert.match(html, /campo-producao-vazio/u);
  assert.doesNotMatch(html, /secret:\/\//u);
});

test('preserves the dense table as the legacy download', async () => {
  const { snapshot } = await fixture();

  const html = buildLegacyFichaHtml(snapshot);

  assert.match(html, /Itens, especificacoes e grade/u);
  assert.match(html, /Manga direita/u);
  assert.match(html, /TOTAL DE PECAS/u);
  assert.match(html, /32/u);
});

test('offers the new Ficha first and the legacy Ficha as a fallback', async () => {
  const { gate, reviewPageHtml } = await fixture();

  assert.equal(gate.artifact.downloadLabel, 'Baixar nova ficha');
  assert.equal(gate.legacyArtifact.downloadLabel, 'Download ficha legada');
  assert.match(reviewPageHtml, />Baixar nova ficha</u);
  assert.match(reviewPageHtml, />Download ficha legada</u);
  assert.match(reviewPageHtml, /class="button button-primary"/u);
  assert.match(reviewPageHtml, /class="button button-secondary"/u);
  assert.match(reviewPageHtml, /href="\.\/ficha-canonica-sintetica-v2\.pdf"/u);
  assert.match(reviewPageHtml, /href="\.\/ficha-canonica-sintetica-v1\.pdf"/u);
  assert.equal(reviewPageHtml, buildReviewPageHtml(gate));
});

test('validates hashes and preserves a fail-closed human approval', async () => {
  const {
    artifactBytes,
    gate,
    legacyArtifactBytes,
    reviewPageHtml,
    snapshotBytes,
  } = await fixture();

  const validationInput = {
    artifactBytes,
    legacyArtifactBytes,
    reviewPageHtml,
    snapshotBytes,
  };

  assert.doesNotThrow(() =>
    validateFichaApprovalGate({ ...validationInput, gate }),
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
        ...validationInput,
        gate: partial,
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
        ...validationInput,
        gate: wrongCriteria,
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
      ...validationInput,
      evidence,
      gate: approved,
    }),
  );
  assert.throws(
    () =>
      validateFichaApprovalGate({
        ...validationInput,
        gate: approved,
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
        ...validationInput,
        artifactBytes: wrongArtifact,
        gate,
      }),
    /artifact SHA-256/iu,
  );
});

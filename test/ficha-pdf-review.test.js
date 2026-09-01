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
  const evidence = gate.approval.evidenceRef
    ? JSON.parse(
        await readFile(new URL(gate.approval.evidenceRef, rootUrl), 'utf8'),
      )
    : null;

  return {
    artifactBytes,
    evidence,
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

test('validates hashes and preserves the complete human approval', async () => {
  const {
    artifactBytes,
    evidence,
    gate,
    legacyArtifactBytes,
    reviewPageHtml,
    snapshotBytes,
  } = await fixture();

  const validationInput = {
    artifactBytes,
    evidence,
    legacyArtifactBytes,
    reviewPageHtml,
    snapshotBytes,
  };

  assert.doesNotThrow(() =>
    validateFichaApprovalGate({ ...validationInput, gate }),
  );
  assert.equal(gate.approval.status, 'approved');
  assert.equal(gate.approval.approved, true);
  assert.equal(gate.approval.reviewedBy.rose, 'Rose');
  assert.equal(gate.approval.reviewedBy.operation, 'Operacao Silmer');
  assert.ok(Object.values(gate.approval.criteria).every(Boolean));
  assert.doesNotThrow(() => validateFichaApprovalEvidence(evidence, gate));

  const partial = structuredClone(gate);
  partial.approval.reviewedBy.operation = null;
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

  assert.throws(
    () =>
      validateFichaApprovalGate({
        ...validationInput,
        evidence: null,
        gate,
      }),
    /Approved evidence must be synthetic/iu,
  );
  const evidenceWithPii = /** @type {any} */ (structuredClone(evidence));
  evidenceWithPii.notes = 'Contato +55 11 99999-1234';
  assert.throws(
    () => validateFichaApprovalEvidence(evidenceWithPii, gate),
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

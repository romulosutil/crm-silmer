import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRINT_TEMPLATE,
  renderOrderFicha,
  TEMPLATE_V5,
  TEMPLATE_V6,
} from '../modules/orders/src/print/index.js';
import {
  buildFichaHtmlV6,
  fichaV6ApprovalStages,
  validateFichaApprovalGateV6,
  validateFichaReviewV6,
  validateFichaSnapshotV6,
} from '../scripts/ficha-pdf-review-v6.mjs';
import { validateFichaPrintSwitch } from '../scripts/ficha-pdf-review.mjs';

/** @param {string} path */
async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

const sampleBytes = await readFile(
  new URL('../docs/phase0/ficha-pdf-synthetic-v6.json', import.meta.url),
);
const reviewSample = JSON.parse(sampleBytes.toString('utf8'));
const gate = await json('../docs/phase0/ficha-pdf-approval-v6.json');
const pdfBytes = await readFile(
  new URL('../output/pdf/ficha-canonica-sintetica-v6.pdf', import.meta.url),
);
const v3Gate = await json('../docs/phase0/ficha-pdf-approval-v3.json');
const v4Gate = await json('../docs/phase0/ficha-pdf-approval-v4.json');
const v5Gate = await json('../docs/phase0/ficha-pdf-approval-v5.json');

test('v6 prints the audience by the item number and "Modelo de malha" (ADR 022, PUB-07)', () => {
  const html = renderOrderFicha(reviewSample.order, TEMPLATE_V6);
  for (const audience of ['MASCULINO', 'FEMININO', 'INFANTIL', 'UNISSEX']) {
    assert.match(
      html,
      new RegExp(
        `<strong>\\d</strong><em class="audience">${audience[0]}${audience.slice(1).toLowerCase()}</em>`,
        'u',
      ),
      audience,
    );
  }
  assert.match(html, /5<\/b> Modelo de malha<\/span>/u);
  assert.doesNotMatch(html, /5<\/b> Tecido<\/span>/u);
  // The sizes and the points stay as v5 prints them.
  assert.match(html, /4<\/b> Técnica<\/span><div class="point-value">SILK/u);
  assert.match(
    html,
    /7<\/b> Gola<\/span><div class="point-value">NÃO APLICÁVEL/u,
  );

  const v5 = renderOrderFicha(reviewSample.order, TEMPLATE_V5);
  assert.doesNotMatch(
    v5,
    /class="audience"|Modelo de malha/u,
    'v5 is untouched',
  );
});

test('v6 prints the quantity said only when it differs from the sizes (ADR 022, PUB-02)', () => {
  const html = renderOrderFicha(reviewSample.order, TEMPLATE_V6);
  const said = [
    ...html.matchAll(/Quantidade informada <strong>(\d+)<\/strong>/gu),
  ];
  assert.deepEqual(
    said.map((match) => match[1]),
    ['12'],
    'only the feminine item, said 12 and sized 10',
  );

  const order = structuredClone(reviewSample.order);
  for (const item of order.ficha.items) {
    item.publico = '';
    item.quantidade_informada = null;
  }
  const plain = renderOrderFicha(order, TEMPLATE_V6);
  assert.doesNotMatch(plain, /class="audience"|Quantidade informada/u);
  assert.doesNotMatch(plain, /null|undefined/u);
});

test('v6 reads an order stored before ADR 022 without an audience', () => {
  const order = structuredClone(reviewSample.order);
  for (const item of order.ficha.items) {
    delete item.publico;
    delete item.quantidade_informada;
  }
  const html = renderOrderFicha(order, TEMPLATE_V6);
  assert.doesNotMatch(html, /class="audience"|Quantidade informada|undefined/u);
});

test('the v6 sample prints every audience once and a quantity said that differs', () => {
  assert.doesNotThrow(() => validateFichaSnapshotV6(reviewSample));
  const twice = structuredClone(reviewSample);
  twice.order.ficha.items[3].publico = 'masculino';
  assert.throws(() => validateFichaSnapshotV6(twice), /every audience once/u);
  const agrees = structuredClone(reviewSample);
  agrees.order.ficha.items[1].quantidade_informada = 10;
  assert.throws(
    () => validateFichaSnapshotV6(agrees),
    /differs from the sizes/u,
  );
});

test('v6 package is locked by hash and waits for the PO review', async () => {
  assert.equal(gate.provisionalApproval.status, 'pending-po-review');
  assert.equal(gate.provisionalApproval.approved, false);
  assert.equal(gate.versioning.supersedesTemplateVersion, TEMPLATE_V5);
  assert.deepEqual(await validateFichaReviewV6(), gate);
  const input = {
    artifactBytes: pdfBytes,
    gate,
    renderedHtml: buildFichaHtmlV6(reviewSample),
    snapshotBytes: sampleBytes,
  };
  assert.doesNotThrow(() => validateFichaApprovalGateV6(input));
  assert.throws(
    () =>
      validateFichaApprovalGateV6({
        ...input,
        renderedHtml: `${input.renderedHtml} `,
      }),
    /HTML changed/u,
  );
  assert.throws(
    () =>
      validateFichaApprovalGateV6({
        ...input,
        artifactBytes: Buffer.concat([pdfBytes, Buffer.from('change')]),
      }),
    /PDF changed/u,
  );
  const reviewerWithoutApproval = structuredClone(gate);
  reviewerWithoutApproval.provisionalApproval.reviewedBy.name = 'Alguém';
  assert.throws(
    () =>
      validateFichaApprovalGateV6({ ...input, gate: reviewerWithoutApproval }),
    /review by the PO/u,
  );
  const falseSignature = structuredClone(gate);
  falseSignature.approval.approved = true;
  assert.throws(
    () => validateFichaApprovalGateV6({ ...input, gate: falseSignature }),
    /signature/u,
  );
});

test('orders keep printing on v5 until the PO approves v6 (PIM-10)', () => {
  assert.equal(PRINT_TEMPLATE, TEMPLATE_V5);
  assert.equal(fichaV6ApprovalStages(gate).provisional, false);
  const switchTo = (/** @type {any} */ gateV6) =>
    validateFichaPrintSwitch({
      gate: v3Gate,
      gateV4: v4Gate,
      gateV5: v5Gate,
      gateV6,
      printTemplate: TEMPLATE_V6,
    });
  assert.throws(() => switchTo(gate), /before its approval is recorded/u);
  assert.throws(() => switchTo(undefined), /before its approval is recorded/u);
  const approved = structuredClone(gate);
  approved.provisionalApproval.status = 'approved';
  approved.provisionalApproval.approved = true;
  assert.doesNotThrow(() => switchTo(approved));
});

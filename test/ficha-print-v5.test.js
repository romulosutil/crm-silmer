import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  renderOrderFicha,
  TEMPLATE_V4,
  TEMPLATE_V5,
} from '../modules/orders/src/print/index.js';
import {
  buildFichaHtmlV5,
  fichaV5ApprovalStages,
  validateFichaApprovalGateV5,
  validateFichaReviewV5,
} from '../scripts/ficha-pdf-review-v5.mjs';
import { validateFichaPrintSwitch } from '../scripts/ficha-pdf-review.mjs';

const sampleBytes = await readFile(
  new URL('../docs/phase0/ficha-pdf-synthetic-v5.json', import.meta.url),
);
const reviewSample = JSON.parse(sampleBytes.toString('utf8'));
const gate = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-approval-v5.json', import.meta.url),
    'utf8',
  ),
);
const pdfBytes = await readFile(
  new URL('../output/pdf/ficha-canonica-sintetica-v5.pdf', import.meta.url),
);
const v3Gate = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-approval-v3.json', import.meta.url),
    'utf8',
  ),
);
const v4Gate = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-approval-v4.json', import.meta.url),
    'utf8',
  ),
);

const sample = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic-v3.json', import.meta.url),
    'utf8',
  ),
).order;

/** An order shaped by ADR 020: a technique per item and the art marked. */
function revisionOrder() {
  const order = structuredClone(sample);
  order.ficha.summary.aplicacao = 'TÉCNICA LEGADA';
  order.ficha.items[0].tipo_servico = 'SILK 2 CORES';
  order.ficha.items[0].estampa = 'LOGO NO PEITO';
  order.ficha.items[0].cor_frente = 'AZUL NO PEITO';
  order.ficha.items[0].cor_costas = 'LARANJA NAS COSTAS';
  order.ficha.items[1].tipo_servico = 'SUBLIMAÇÃO TOTAL';
  order.ficha.items[2].tipo_servico = 'BORDADO';
  order.ficha.items[1].gola = '';
  order.ficha.artwork = {
    feito_pelo_cliente: true,
    feito_pela_silmer: false,
    files: [],
    sem_estampa: false,
  };
  return order;
}

test('v5 names each concept once and leaves v4 as it was approved (TEC-07)', () => {
  const order = revisionOrder();
  const v4 = renderOrderFicha(order, TEMPLATE_V4);
  const v5 = renderOrderFicha(order, TEMPLATE_V5);
  assert.match(v4, /Serviços dos itens/u);
  assert.match(v4, /7<\/b> Definição da gola/u);

  assert.match(
    v5,
    /4<\/b> Técnica<\/span><div class="point-value">SILK 2 CORES/u,
  );
  assert.match(v5, /7<\/b> Gola</u);
  assert.match(v5, /SUBLIMAÇÃO TOTAL/u);
  assert.match(v5, /BORDADO/u);
  for (const old of [
    'Serviços dos itens',
    'Tipo de serviço',
    'Técnica da arte',
    'TÉCNICA LEGADA',
    'Definição da gola',
    'Evento / Nome',
    'Origens da arte',
    'Feita pel',
    '>Pagamento<',
    '>Entrega realizada<',
    'Cor frente',
    'Cores Frente',
    'Cores e arte',
  ]) {
    assert.ok(!v5.includes(old), old);
  }
  assert.match(v5, />Nome do pedido</u);
  assert.match(v5, />Pago em</u);
  assert.match(v5, />Entregue em</u);
  assert.match(v5, /Estampa \(referência\) <strong>LOGO NO PEITO/u);
  assert.match(v5, /Cor do tecido — frente <strong>AZUL NO PEITO/u);
  assert.match(v5, /Cor do tecido — costas <strong>LARANJA NAS COSTAS/u);
  assert.match(v5, /VERDE BANDEIRA/u); // legacy vies_gola fallback
  assert.match(v5, /<h2>Cores da arte<\/h2>/u);
  assert.match(v5, /Nº de cores — frente:/u);
  assert.equal((v5.match(/class="campo-producao-vazio"/gu) ?? []).length, 14);
});

test('v5 prints who makes the art on every commercial page (TEC-03)', () => {
  const order = revisionOrder();
  order.ficha.items.push(
    ...Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(order.ficha.items[0]),
      tipo: `PEÇA EXTRA ${index + 1}`,
    })),
  );
  const html = renderOrderFicha(order, TEMPLATE_V5);
  assert.match(
    html,
    /Arte do pedido<\/span><strong>O cliente envia a arte<\/strong>/u,
  );
  assert.equal(
    (html.match(/Arte do pedido/gu) ?? []).length,
    1 + (html.match(/class="page-break continuation"/gu) ?? []).length,
  );
  assert.ok(
    html.indexOf('Arte do pedido') <
      html.indexOf('<article class="item-card">'),
  );
  assert.equal((html.match(/<article class="item-card">/gu) ?? []).length, 8);
  assert.match(html, /Página 2 · continuação dos itens/u);

  for (const [artwork, printed] of /** @type {const} */ ([
    [
      { feito_pela_silmer: true, feito_pelo_cliente: true },
      'O cliente envia a arte e A Silmer cria a arte',
    ],
    [{ sem_estampa: true }, 'Sem estampa'],
    [{}, '<span class="empty">—</span>'],
  ])) {
    const marked = revisionOrder();
    marked.ficha.artwork = {
      feito_pela_silmer: false,
      feito_pelo_cliente: false,
      files: [],
      sem_estampa: false,
      ...artwork,
    };
    assert.ok(
      renderOrderFicha(marked, TEMPLATE_V5).includes(
        `Arte do pedido</span><strong>${printed}</strong>`,
      ),
      printed,
    );
  }
});

test('v5 prints the extras row only when an extra is filled', () => {
  const order = revisionOrder();
  order.ficha.items = [order.ficha.items[2]];
  for (const key of [
    'estampa',
    'cor_frente',
    'cor_costas',
    'cor_manga_direita',
    'cor_manga_esquerda',
    'vies_mangas',
  ]) {
    order.ficha.items[0][key] = '';
  }
  assert.doesNotMatch(
    renderOrderFicha(order, TEMPLATE_V5),
    /class="item-additional"/u,
  );
});

test('v5 divides a large grade into numbered item parts', () => {
  const order = revisionOrder();
  const item = structuredClone(order.ficha.items[0]);
  item.grade = Array.from({ length: 100 }, (_, index) => ({
    tamanho: `T-${index + 1}`,
    quantidade: 1,
  }));
  order.ficha.items = [item];
  order.totalPieces = 100;
  const html = renderOrderFicha(order, TEMPLATE_V5);
  assert.equal((html.match(/<article class="item-card">/gu) ?? []).length, 15);
  assert.match(html, /parte 15\/15/u);
  assert.equal(
    (html.match(/100 <small>peças no item<\/small>/gu) ?? []).length,
    1,
  );
  for (let index = 1; index <= 100; index += 1) {
    assert.equal(
      (html.match(new RegExp(`<span>T-${index}<\\/span>`, 'gu')) ?? []).length,
      1,
    );
  }
});

test('v5 package is locked by hash while the PO reviews it', async () => {
  assert.deepEqual(await validateFichaReviewV5(), gate);
  const input = {
    artifactBytes: pdfBytes,
    gate,
    renderedHtml: buildFichaHtmlV5(reviewSample),
    snapshotBytes: sampleBytes,
  };
  assert.doesNotThrow(() => validateFichaApprovalGateV5(input));
  assert.throws(
    () =>
      validateFichaApprovalGateV5({
        ...input,
        renderedHtml: `${input.renderedHtml} `,
      }),
    /HTML changed/u,
  );
  assert.throws(
    () =>
      validateFichaApprovalGateV5({
        ...input,
        artifactBytes: Buffer.concat([pdfBytes, Buffer.from('change')]),
      }),
    /PDF changed/u,
  );
  const halfApproved = structuredClone(gate);
  halfApproved.provisionalApproval.status = 'approved';
  assert.throws(
    () => validateFichaApprovalGateV5({ ...input, gate: halfApproved }),
    /review by the PO/u,
  );
  const falseSignature = structuredClone(gate);
  falseSignature.approval.approved = true;
  assert.throws(
    () => validateFichaApprovalGateV5({ ...input, gate: falseSignature }),
    /signature/u,
  );
});

test('orders print on v5 only after the PO approves its sample (PIM-10)', () => {
  const stages = fichaV5ApprovalStages(gate);
  const switchTo = (/** @type {any} */ gateV5) =>
    validateFichaPrintSwitch({
      gate: v3Gate,
      gateV4: v4Gate,
      gateV5,
      printTemplate: TEMPLATE_V5,
    });
  if (!stages.provisional) {
    assert.throws(() => switchTo(gate), /before its approval is recorded/u);
  }
  const approved = structuredClone(gate);
  approved.provisionalApproval.status = 'approved';
  approved.provisionalApproval.approved = true;
  assert.doesNotThrow(() => switchTo(approved));
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  renderOrderFicha,
  TEMPLATE_V3,
  TEMPLATE_V4,
} from '../modules/orders/src/print/index.js';
import {
  buildFichaHtmlV4,
  validateFichaApprovalGateV4,
  validateFichaReviewV4,
} from '../scripts/ficha-pdf-review-v4.mjs';

const sampleBytes = await readFile(
  new URL('../docs/phase0/ficha-pdf-synthetic-v4.json', import.meta.url),
);
const reviewSample = JSON.parse(sampleBytes.toString('utf8'));
const approval = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-approval-v4.json', import.meta.url),
    'utf8',
  ),
);
const pdfBytes = await readFile(
  new URL('../output/pdf/ficha-canonica-sintetica-v4.pdf', import.meta.url),
);

const sample = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic-v3.json', import.meta.url),
    'utf8',
  ),
).order;

function revisionOrder() {
  const order = structuredClone(sample);
  order.ficha.summary.aplicacao = 'TÉCNICA LEGADA';
  order.ficha.items[0].tipo_servico = 'Produção completa';
  order.ficha.items[0].cor_frente = 'AZUL NO PEITO';
  order.ficha.items[0].cor_costas = 'LARANJA NAS COSTAS';
  order.ficha.items[1].tipo_servico = 'Só impressão';
  order.ficha.items[2].tipo_servico = 'Produção completa';
  order.ficha.items[1].gola = '';
  order.ficha.artwork = {
    feito_pelo_cliente: true,
    feito_pela_silmer: false,
    files: [],
  };
  return order;
}

test('v4 preserves v3 as a separate approved template', () => {
  const order = revisionOrder();
  const v3 = renderOrderFicha(order, TEMPLATE_V3);
  const v4 = renderOrderFicha(order, TEMPLATE_V4);
  assert.match(v3, />Modelo</u);
  assert.match(v3, />Viés gola</u);
  assert.doesNotMatch(v4, />Modelo</u);
  assert.doesNotMatch(v4, />Viés gola</u);
  assert.match(v4, /7<\/b> Definição da gola/u);
  assert.match(v4, /Produção completa/u);
  assert.match(v4, /Só impressão/u);
  assert.match(
    v4,
    /Origens da arte do pedido<\/span><strong>Feita pelo cliente/u,
  );
  assert.equal(
    (v4.match(/Origens da arte do pedido/gu) ?? []).length,
    1 + (v4.match(/class="page-break continuation"/gu) ?? []).length,
  );
  assert.ok(
    v4.indexOf('Origens da arte do pedido') <
      v4.indexOf('<article class="item-card">'),
  );
  assert.match(
    v4,
    /Técnica da arte \(referência\)<\/span><strong>TÉCNICA LEGADA/u,
  );
  assert.ok(
    v4.indexOf('TÉCNICA LEGADA') < v4.indexOf('<article class="item-card">'),
  );
  assert.match(v4, /Cor frente <strong>AZUL NO PEITO/u);
  assert.match(v4, /Cor costas <strong>LARANJA NAS COSTAS/u);
  assert.match(v4, /VERDE BANDEIRA/u); // legacy vies_gola fallback
  assert.equal((v4.match(/class="campo-producao-vazio"/gu) ?? []).length, 14);
});

test('v4 omits the global art reference when empty', () => {
  const order = revisionOrder();
  order.ficha.summary.aplicacao = '';
  const html = renderOrderFicha(order, TEMPLATE_V4);
  assert.doesNotMatch(html, /Técnica da arte \(referência\)/u);
  assert.match(html, /Serviços dos itens/u);
});

test('v4 keeps continuation headers and prints each item exactly once', () => {
  const order = revisionOrder();
  order.ficha.items.push(
    ...Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(order.ficha.items[0]),
      tipo: `PEÇA EXTRA ${index + 1}`,
    })),
  );
  const html = renderOrderFicha(order, TEMPLATE_V4);
  assert.equal((html.match(/<article class="item-card">/gu) ?? []).length, 8);
  assert.match(html, /Página 2 · continuação dos itens/u);
  assert.ok(
    html.indexOf('PEÇA EXTRA 5') < html.indexOf('CONTROLE DE PRODUÇÃO'),
  );
});

test('v4 divides a large grade into numbered item parts', () => {
  const order = revisionOrder();
  const item = structuredClone(order.ficha.items[0]);
  item.grade = Array.from({ length: 100 }, (_, index) => ({
    tamanho: `T-${index + 1}`,
    quantidade: 1,
  }));
  order.ficha.items = [item];
  order.totalPieces = 100;
  const html = renderOrderFicha(order, TEMPLATE_V4);
  assert.equal((html.match(/<article class="item-card">/gu) ?? []).length, 15);
  assert.match(html, /parte 15\/15/u);
  assert.match(html, /Página 2 · continuação dos itens/u);
  assert.equal(
    (html.match(/100 <small>peças no item<\/small>/gu) ?? []).length,
    1,
  );
  assert.equal((html.match(/Total do item na parte 1/gu) ?? []).length, 14);
  for (let index = 1; index <= 100; index += 1) {
    assert.equal(
      (html.match(new RegExp(`<span>T-${index}<\\/span>`, 'gu')) ?? []).length,
      1,
    );
  }
});

test('v4 summarizes long services without repeating their text in the header', () => {
  const order = revisionOrder();
  order.ficha.items = order.ficha.items.slice(0, 2);
  order.ficha.items[0].tipo_servico = 'Impressão '.repeat(18).trim();
  order.ficha.items[1].tipo_servico = 'Costura '.repeat(20).trim();
  const html = renderOrderFicha(order, TEMPLATE_V4);
  assert.match(html, /2 serviços · ver itens/u);
  assert.match(html, /Impressão Impressão/u);
  assert.match(html, /Costura Costura/u);
});

test('v4 approval locks the two-page synthetic package while physical signatures are pending', async () => {
  assert.deepEqual(await validateFichaReviewV4(), approval);
  const input = {
    artifactBytes: pdfBytes,
    gate: approval,
    renderedHtml: buildFichaHtmlV4(reviewSample),
    snapshotBytes: sampleBytes,
  };
  assert.doesNotThrow(() => validateFichaApprovalGateV4(input));
  assert.throws(
    () =>
      validateFichaApprovalGateV4({
        ...input,
        renderedHtml: `${input.renderedHtml} `,
      }),
    /HTML changed/u,
  );
  assert.throws(
    () =>
      validateFichaApprovalGateV4({
        ...input,
        artifactBytes: Buffer.concat([pdfBytes, Buffer.from('change')]),
      }),
    /PDF changed/u,
  );
  const falseSignature = structuredClone(approval);
  falseSignature.approval.approved = true;
  assert.throws(
    () => validateFichaApprovalGateV4({ ...input, gate: falseSignature }),
    /signature/u,
  );
});

test('the preview script refuses to overwrite the provisionally approved PDF', async () => {
  const before = createHash('sha256').update(pdfBytes).digest('hex');
  const script = new URL(
    '../scripts/ficha-pdf-preview-v4.mjs',
    import.meta.url,
  );
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be regenerated or overwritten/u);
  const after = createHash('sha256')
    .update(
      await readFile(
        new URL(
          '../output/pdf/ficha-canonica-sintetica-v4.pdf',
          import.meta.url,
        ),
      ),
    )
    .digest('hex');
  assert.equal(after, before);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  renderOrderFicha,
  TEMPLATE_V3,
  TEMPLATE_V4,
} from '../modules/orders/src/print/index.js';

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
  assert.match(v4, /Origem: Feita pelo cliente/u);
  assert.doesNotMatch(v4, /TÉCNICA LEGADA/u);
  assert.match(v4, /VERDE BANDEIRA/u); // legacy vies_gola fallback
  assert.equal((v4.match(/class="campo-producao-vazio"/gu) ?? []).length, 14);
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
  for (let index = 1; index <= 100; index += 1) {
    assert.equal(
      (html.match(new RegExp(`<span>T-${index}<\\/span>`, 'gu')) ?? []).length,
      1,
    );
  }
});

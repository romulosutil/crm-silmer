// test/orders-print-v3.test.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderFichaHtml } from '../modules/orders/src/print/ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from '../modules/orders/src/print/ficha-canonical-v3.js';
import {
  PRINT_TEMPLATE,
  renderOrderFicha,
} from '../modules/orders/src/print/index.js';
import {
  TEMPLATE_V2,
  TEMPLATE_V3,
  printSnapshot,
  printableItem,
} from '../modules/orders/src/print/print-snapshot.js';

const synthetic = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

const camiseta = {
  tipo: 'CAMISETA',
  modelo: 'TRADICIONAL',
  malhas: ['PP DRY'],
  cor_frente: 'BRANCO',
  cor_costas: 'BRANCO',
  cor_manga_direita: 'AZUL ROYAL',
  cor_manga_esquerda: 'AZUL ROYAL',
  vies_gola: 'RIBANA · AZUL ROYAL',
  vies_mangas: '',
  specs: {
    gola: 'CARECA',
    manga: 'RAGLAN CURTA',
    locais: ['COSTAS TOTAL', 'MANGA DIREITA'],
  },
  escala: 'adulto',
  outras: 'Recorte lateral',
  grade: [
    { tamanho: 'P', quantidade: 4 },
    { tamanho: 'M', quantidade: 6 },
  ],
};
const bermuda = {
  tipo: 'BERMUDA',
  modelo: 'ESPORTIVA',
  malhas: ['PP LISO'],
  cor_frente: 'PRETO',
  cor_costas: 'PRETO',
  cor_manga_direita: 'NAO APLICAVEL',
  cor_manga_esquerda: 'NAO APLICAVEL',
  vies_gola: 'NAO APLICAVEL',
  vies_mangas: 'BRANCO',
  specs: { cos: 'ELÁSTICO' },
  escala: 'infantil',
  outras: '',
  grade: [{ tamanho: 'P', quantidade: 3 }],
};

/** @param {any[]} items */
function order(items) {
  return {
    confirmedBy: { name: 'Vendedora Um' },
    fabCode: '01',
    ficha: {
      items,
      observations: ['Separar por tamanho.'],
      summary: {
        aplicacao: 'SUBLIMAÇÃO TOTAL',
        cliente: 'Cliente Sintetico',
        data_entrega_confirmada: '30/10/2026',
        nome: 'Equipe Sintetica',
      },
    },
    number: '01-CRM',
    orderDate: '2026-09-24',
    totalPieces: 13,
  };
}

test('prints the header as type plus modelagem, gola and manga (FIM-02)', () => {
  const printed = printableItem(camiseta);
  assert.equal(printed.tipo, 'CAMISETA');
  assert.equal(printed.subtitulo, 'TRADICIONAL · CARECA · RAGLAN CURTA');
  assert.equal(printed.total, 10);
});

test('prints only the fields the product has and someone filled (FIM-01, FIM-03)', () => {
  const printed = printableItem(bermuda);
  const labels = printed.especificacoes.map((spec) => spec.rotulo);

  assert.ok(labels.includes('Cós/cintura'));
  assert.ok(labels.includes('Viés barra/lateral'));
  assert.ok(!labels.some((label) => /manga direita|Viés gola/u.test(label)));
  assert.ok(
    !printed.especificacoes.some((spec) => spec.valor === 'NAO APLICAVEL'),
  );
});

test('prints the locations and the other specifications on their own lines (FIM-04)', () => {
  assert.deepEqual(printableItem(camiseta).linhas, [
    { rotulo: 'Locais da aplicação', valor: 'COSTAS TOTAL / MANGA DIREITA' },
    { rotulo: 'Outras especificações', valor: 'Recorte lateral' },
  ]);
});

test('names the scale above the grade when it is not the adult one (FIM-05)', () => {
  assert.equal(printableItem(camiseta).gradeTitulo, 'Grade');
  assert.equal(printableItem(bermuda).gradeTitulo, 'Grade · Infantil');
});

test('prints an item saved before the catalog without losing a field (FIM-07)', () => {
  const printed = printableItem(synthetic.pedido.itens[0]);
  const values = printed.especificacoes.map((spec) => spec.valor);

  assert.equal(printed.subtitulo, 'TRADICIONAL');
  assert.ok(values.includes('BRANCA'));
  assert.ok(values.includes('OLIMPICA - VERDE'));
});

test('keeps the production page identical to v2 (FIM-06)', () => {
  const v2 = renderFichaHtml(printSnapshot(order([camiseta]), TEMPLATE_V2), {
    synthetic: false,
  });
  const v3 = renderFichaHtmlV3(printSnapshot(order([camiseta]), TEMPLATE_V3), {
    synthetic: false,
  });
  /** @param {string} html */
  const production = (html) =>
    html.slice(html.indexOf('<section class="page-break">'));

  assert.equal(production(v3), production(v2));
});

test('renders the v3 item card with the product labels', () => {
  const html = renderFichaHtmlV3(
    printSnapshot(order([camiseta, bermuda]), TEMPLATE_V3),
    {
      synthetic: false,
    },
  );

  assert.match(html, /Viés barra\/lateral/u);
  assert.match(html, /Grade · Infantil/u);
  assert.match(html, /Locais da aplicação/u);
  assert.doesNotMatch(html, /NAO APLICAVEL|undefined|null/u);
});

test('prints on v2 until the v3 approval is recorded (FIM-08)', () => {
  assert.equal(PRINT_TEMPLATE, TEMPLATE_V2);
  assert.match(renderOrderFicha(order([camiseta])), /Vies gola \/ mangas/u);
});

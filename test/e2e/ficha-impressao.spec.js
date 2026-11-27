/* global document */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { renderOrderFicha } from '../../modules/orders/src/print/index.js';

const reference = JSON.parse(
  await readFile(
    new URL('../../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
).pedido;

const { order: modernSample } = JSON.parse(
  await readFile(
    new URL('../../docs/phase0/ficha-pdf-synthetic-v9.json', import.meta.url),
    'utf8',
  ),
);

function sampleOrder() {
  return {
    number: reference.numero,
    status: 'confirmado',
    orderDate: '2026-08-31',
    confirmedBy: { name: reference.vendedor },
    // The legacy v1 demo includes a disclaimer about billing. Use the
    // production instructions from that sheet with the current FPI-10 guard.
    ficha: {
      items: reference.itens.map((/** @type {any} */ item) => ({
        ...item,
        tipo_servico: reference.aplicacao,
      })),
      observations: [reference.observacoes[1]],
      summary: {
        cliente: reference.cliente,
        nome: reference.nome,
        data_entrega_confirmada: '2026-09-30',
      },
    },
    totalPieces: reference.quantidade_total,
  };
}

test.use({ javaScriptEnabled: false, viewport: { width: 1046, height: 720 } });

/** @param {import('@playwright/test').Page} page @param {any} order @param {string[]} [pages] */
async function open(page, order, pages) {
  await page.emulateMedia({ media: 'print' });
  await page.setContent(
    renderOrderFicha(order, undefined, {
      layout: 'impressao',
      artwork: { pages },
    }),
  );
}

/** @param {import('@playwright/test').Page} page */
async function printedPages(page) {
  const buffer = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length;
}

test('FPI-15: the reference order includes its grade and production control on one sheet', async ({
  page,
}) => {
  await open(page, sampleOrder());
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Ficha de pedido 01-CRM',
  );
  const sizes = page.getByRole('table', {
    name: 'Itens, especificações e grade',
  });
  await expect(sizes.locator('.grade-row')).toHaveCount(8);
  await expect(sizes.locator('.grade-row .quantity')).toHaveText([
    '4',
    '8',
    '6',
    '2',
    '3',
    '4',
    '3',
    '2',
  ]);
  await expect(
    sizes.locator('.grade-row [aria-label="Conferido à mão"]'),
  ).toHaveCount(8);
  await expect(sizes.locator('.item-start')).toHaveCount(2);
  await expect(sizes.locator('.item-index')).toHaveText(['1', '2']);
  await expect(sizes.locator('.item-index').first()).toHaveAttribute(
    'rowspan',
    '4',
  );
  await expect(sizes.locator('.total .quantity')).toHaveText('32');
  await expect(
    page.getByText(reference.observacoes[1], { exact: true }),
  ).toHaveCount(1);
  const production = page.getByRole('table', { name: 'Controle de produção' });
  await expect(production.locator('tbody tr')).toHaveCount(1);
  await expect(production.locator('.field')).toHaveCount(7);
  expect(await printedPages(page)).toBe(1);
});

test('FPI-15: a large grade can flow across multiple sheets with its table header', async ({
  page,
}) => {
  const order = sampleOrder();
  order.ficha.items[0].grade = Array.from({ length: 80 }, (_, i) => ({
    tamanho: `T${i + 1}`,
    quantidade: 2,
  }));
  await open(page, order);
  await expect(page.locator('.grade-row')).toHaveCount(84);
  await expect(page.locator('.grade-row .item-index')).toHaveText(['1', '2']);
  await expect(page.getByText('T80', { exact: true })).toBeVisible();
  await expect(page.locator('.total .quantity')).toHaveText('172');
  await expect(page.locator('thead').first()).toHaveCSS(
    'display',
    'table-header-group',
  );
  expect(await printedPages(page)).toBeGreaterThan(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1046);
});

test('FPI-15: an order without final art keeps the reference and factory guard', async ({
  page,
}) => {
  const order = structuredClone(modernSample);
  const requests = /** @type {string[]} */ ([]);
  page.on('request', (request) => requests.push(request.url()));
  order.ficha.observations.push('Conferir <rascunho> com a equipe.');
  await open(page, order);
  await expect(
    page.getByText(order.ficha.items[0].estampa, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Conferir <rascunho> com a equipe.', { exact: true }),
  ).toHaveCount(1);
  await expect(page.locator('img, [src]')).toHaveCount(0);
  await expect(
    page.getByText('Nenhuma arte final anexada ao pedido.'),
  ).toBeVisible();
  expect(requests).toEqual([]);
  order.ficha.observations = ['Pagamento pendente.'];
  expect(() =>
    renderOrderFicha(order, undefined, { layout: 'impressao' }),
  ).toThrow(
    'Revise o conteúdo financeiro nos textos da ficha antes de imprimir.',
  );
});

test('FPI-15: approved artwork follows the single production row on the same sheet', async ({
  page,
}) => {
  const order = structuredClone(modernSample);
  const [jersey, babyLook] = order.ficha.items;
  jersey.tipo = 'Camiseta manga curta';
  jersey.grade = jersey.grade.slice(0, 4);
  babyLook.grade = babyLook.grade.slice(1, 4);
  order.ficha.items = [jersey, babyLook];
  order.ficha.observations = order.ficha.observations.slice(0, 2);
  order.ficha.serviceData = {};
  const requests = /** @type {string[]} */ ([]);
  page.on('request', (request) => requests.push(request.url()));
  await open(page, order, [jersey.artPreview]);
  const artwork = page.locator('.production + .approved-art');
  await expect(artwork.getByRole('heading')).toHaveText(
    'Arte final aprovada pelo cliente',
  );
  const image = artwork.getByRole('img');
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (node) => /** @type {HTMLImageElement} */ (node).naturalWidth,
    ),
  ).toBeGreaterThan(100);
  expect(await printedPages(page)).toBe(1);
  expect(requests).toEqual([]);

  await open(page, order, [jersey.artPreview, jersey.artPreview]);
  await expect(
    page.locator('.art-continuation').getByRole('img'),
  ).toHaveAccessibleName('Página 2 da arte final do pedido');
  expect(await printedPages(page)).toBe(2);
});

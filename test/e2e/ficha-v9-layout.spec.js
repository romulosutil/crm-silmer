/* global document, getComputedStyle */
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  TEMPLATE_V9,
  renderOrderFicha,
} from '../../modules/orders/src/print/index.js';

// FPI-12/13: the paper as Chromium prints it, with no script: two A4 pages
// per item, the production control and the art on the back, the observations
// and ruled lines on the front, nothing overflowing or overlapping.
test.use({ javaScriptEnabled: false, viewport: { height: 1123, width: 794 } });

const { order: sample } = JSON.parse(
  await readFile(
    new URL('../../docs/phase0/ficha-pdf-synthetic-v9.json', import.meta.url),
    'utf8',
  ),
);

/** @param {string} text @param {number} [size] */
const ceiling = (text, size = 200) =>
  text.repeat(Math.ceil(size / text.length)).slice(0, size);

function commonOrder() {
  const order = structuredClone(sample);
  order.ficha.items = order.ficha.items.slice(0, 3);
  order.totalPieces = 80;
  order.ficha.observations = order.ficha.observations.slice(0, 3);
  delete order.ficha.serviceData;
  return order;
}

function noNotesOrder() {
  const order = commonOrder();
  order.ficha.observations = [];
  return order;
}

function worstOrder() {
  const order = structuredClone(sample);
  order.ficha.items = [order.ficha.items[3]];
  order.totalPieces = 92;
  order.ficha.observations = Array.from({ length: 5 }, (_, index) =>
    ceiling(`Observação ${index + 1} com instrução completa para a produção. `),
  );
  return order;
}

function limitOrder() {
  const order = structuredClone(sample);
  order.ficha.summary.cliente = ceiling(
    'RAZÃO SOCIAL MUITO EXTENSA DO CLIENTE ',
  );
  order.ficha.summary.nome = ceiling('Nome do pedido sem abreviação ');
  order.confirmedBy.name = ceiling('Nome composto da vendedora ');
  order.fabCode = ceiling('FAB 01 lote ');
  const long = ceiling('CAMPO NO LIMITE DO CONTRATO ');
  order.ficha.items = [
    {
      ...sample.ficha.items[0],
      tipo: long,
      cor: long,
      estampa: long,
      tipo_servico: long,
      malhas: [long],
      gola: long,
      vies_gola: long,
      vies_mangas: long,
      modelo: long,
      cor_frente: long,
      cor_costas: long,
      cor_manga_direita: long,
      cor_manga_esquerda: long,
      grade: [
        { quantidade: 4, tamanho: ceiling('TAMANHO COM RÓTULO LONGO ') },
        { quantidade: 6, tamanho: 'G' },
        { quantidade: 2, tamanho: 'GG' },
      ],
      quantidade_informada: 99,
    },
  ];
  order.totalPieces = 12;
  order.ficha.observations = Array.from({ length: 5 }, (_, index) =>
    ceiling(`Observação ${index + 1} no teto do campo. `),
  );
  order.ficha.serviceData = {
    customizations: ceiling('Personalização enorme ', 800),
    notes: ['Á'.repeat(1400), 'linha\n'.repeat(45)],
    numbers: ceiling('Numeração ', 400),
  };
  return order;
}

function manyItemsOrder() {
  const order = structuredClone(sample);
  order.ficha.items = Array.from(
    { length: 30 },
    (_, index) => sample.ficha.items[index % 4],
  );
  order.totalPieces = order.ficha.items
    .flatMap((/** @type {any} */ item) => item.grade)
    .reduce(
      (/** @type {number} */ sum, /** @type {any} */ line) =>
        sum + line.quantidade,
      0,
    );
  return order;
}

/** @param {import('@playwright/test').Page} page @param {any} order */
async function open(page, order) {
  await page.setContent(
    renderOrderFicha(order, TEMPLATE_V9, {
      printedAt: new Date('2026-11-09T17:20:00.000Z'),
    }),
    { waitUntil: 'load' },
  );
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
}

/** @param {import('@playwright/test').Page} page */
async function printedPages(page) {
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length;
}

/** @param {import('@playwright/test').Page} page */
function measure(page) {
  return page.evaluate(() => {
    const blocks =
      '.head,.aud,.panel,.row,.dt,.fld,.cap,.foot,.arte,.obs,.sec-head';
    return [...document.querySelectorAll('.sheet')].map((sheet) => {
      const box = sheet.getBoundingClientRect();
      let smallest = 999;
      let right = 0;
      for (const element of sheet.querySelectorAll('*')) {
        if (element.closest('svg') || element.closest('caption')) continue;
        const rect = element.getBoundingClientRect();
        right = Math.max(right, rect.right - box.left);
        const hasText = [...element.childNodes].some(
          (node) => node.nodeType === 3 && node.textContent?.trim(),
        );
        if (hasText) {
          smallest = Math.min(
            smallest,
            Number.parseFloat(getComputedStyle(element).fontSize),
          );
        }
      }
      // Panels, the footer and the header are stacked: none may overlap.
      const stacked = [...sheet.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return { top: rect.top - box.top, bottom: rect.bottom - box.top };
      });
      const overlaps = stacked.filter(
        (rect, index) =>
          index > 0 && rect.top < stacked[index - 1].bottom - 0.01,
      ).length;
      const offGrid = [...sheet.querySelectorAll(blocks)]
        .filter((element) => element.getBoundingClientRect().height > 0)
        .filter((element) => {
          const top = element.getBoundingClientRect().top - box.top;
          return Math.abs(top / 4 - Math.round(top / 4)) > 0.01;
        })
        .map((element) => element.className);
      return {
        family: getComputedStyle(sheet).fontFamily.split(',')[0],
        height: box.height,
        offGrid,
        overlaps,
        right,
        smallest,
        width: box.width,
      };
    });
  });
}

/** @param {any[]} grade */
function gradeOrder(grade) {
  const order = structuredClone(sample);
  order.ficha.items = [
    { ...sample.ficha.items[0], grade, quantidade_informada: null },
  ];
  order.ficha.observations = ['Conferir a contagem.'];
  delete order.ficha.serviceData;
  order.totalPieces = grade.reduce((sum, line) => sum + line.quantidade, 0);
  return order;
}

/** @param {number} size */
const longLabels = (size) =>
  gradeOrder(
    Array.from({ length: size }, (_, index) => ({
      quantidade: 3,
      tamanho: `Masculino adulto ${index + 1}`,
    })),
  );

const shortSizes = () =>
  gradeOrder(
    Array.from({ length: 96 }, (_, index) => ({
      quantidade: 2,
      tamanho: String(index + 1),
    })),
  );

function manySections() {
  const order = structuredClone(sample);
  const words = ceiling('palavra longa de produto repetida ');
  order.ficha.items = Array.from({ length: 6 }, () => ({
    ...sample.ficha.items[0],
    tipo: words,
    cor: words,
    estampa: words,
    tipo_servico: words,
    malhas: [words],
    gola: words,
    vies_gola: words,
    vies_mangas: words,
    modelo: words,
    cor_frente: words,
    cor_costas: words,
    cor_manga_direita: words,
    cor_manga_esquerda: words,
  }));
  order.ficha.summary.cliente = ceiling('Cliente com nome muito extenso ');
  order.ficha.summary.nome = ceiling('Nome do pedido muito extenso ');
  order.totalPieces = 240;
  return order;
}

function wideTokens() {
  const order = structuredClone(sample);
  const token = 'W'.repeat(200);
  order.ficha.items = [
    {
      ...sample.ficha.items[0],
      tipo: token,
      cor: '@'.repeat(200),
      estampa: '—'.repeat(200),
      tipo_servico: '%'.repeat(200),
      malhas: ['😀'.repeat(100)],
      gola: 'M'.repeat(200),
      modelo: '漢'.repeat(200),
    },
  ];
  order.ficha.summary.cliente = token;
  order.ficha.observations = ['&'.repeat(600), '_'.repeat(600)];
  order.totalPieces = 40;
  return order;
}

for (const [name, build, onGrid] of /** @type {const} */ ([
  ['common order', commonOrder, true],
  ['common order without observations', noNotesOrder, true],
  ['the four-item sample', () => structuredClone(sample), true],
  ['longest realistic order', worstOrder, true],
  ['every field at its limit', limitOrder, false],
  ['thirty items', manyItemsOrder, true],
  ['fifteen long size labels', () => longLabels(15), false],
  ['sixty long size labels', () => longLabels(60), false],
  ['ninety-six short sizes', shortSizes, false],
  ['many continuation sections', manySections, false],
  ['wide tokens without spaces', wideTokens, false],
])) {
  test(`FPI-12: ${name} prints one A4 page per sheet`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, build());
    const sheets = await page.locator('.sheet').count();
    expect(sheets).toBeGreaterThan(0);
    const heights = (await measure(page)).map((s) => Math.round(s.height));
    expect(await printedPages(page), `sheet heights: ${heights}`).toBe(sheets);
    const loaded = await page.evaluate(() =>
      document.fonts.check('600 14px Poppins'),
    );
    expect(loaded).toBe(true);
    for (const sheet of await measure(page)) {
      expect(sheet.height).toBeLessThanOrEqual(1122.6);
      expect(sheet.right).toBeLessThanOrEqual(sheet.width);
      expect(sheet.family.replaceAll('"', '')).toBe('Poppins');
      expect(sheet.smallest).toBeGreaterThanOrEqual(13);
      expect(sheet.overlaps).toBe(0);
      if (onGrid) expect(sheet.offGrid).toEqual([]);
    }
  });
}

test('FPI-12: the front panel takes the rest of the sheet, with three ruled lines at least', async ({
  page,
}) => {
  for (const order of [commonOrder(), noNotesOrder(), worstOrder()]) {
    await open(page, order);
    const fronts = await page.locator('.sheet:not(.verso):not(.extra)').count();
    expect(fronts).toBeGreaterThan(0);
    const panels = await page.evaluate(() =>
      [...document.querySelectorAll('.sheet:not(.verso):not(.extra)')].map(
        (sheet) => {
          const foot = sheet.querySelector('.foot')?.getBoundingClientRect();
          const obs = sheet.querySelector('.obs')?.getBoundingClientRect();
          const ruled = sheet.querySelector('.ruled')?.getBoundingClientRect();
          const item = sheet.querySelector('.item')?.getBoundingClientRect();
          return {
            gapToFoot: foot && obs ? foot.top - obs.bottom : -1,
            gapToItem: item && obs ? obs.top - item.bottom : -1,
            ruled: ruled?.height ?? 0,
            titles: [...sheet.querySelectorAll('h2.sec')].map(
              (h) => h.textContent,
            ),
          };
        },
      ),
    );
    for (const panel of panels) {
      // The observations panel is where the control was: right under the item,
      // and it stretches down to the footer.
      expect(panel.gapToItem).toBe(20);
      expect(panel.gapToFoot).toBeLessThanOrEqual(8);
      expect(panel.ruled).toBeGreaterThanOrEqual(72);
      expect(panel.titles).toEqual([
        'Dados do pedido',
        'Dados do item',
        'Observações e anotações do pedido',
      ]);
    }
  }
});

test('FPI-12: with no observations the whole panel is ruled lines', async ({
  page,
}) => {
  await open(page, noNotesOrder());
  const front = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    const obs = sheet?.querySelector('.obs')?.getBoundingClientRect();
    const ruled = sheet?.querySelector('.ruled')?.getBoundingClientRect();
    return { obs: obs?.height ?? 0, ruled: ruled?.height ?? 0 };
  });
  // Padding, the 32px title and the lines.
  expect(front.ruled).toBeGreaterThan(250);
  expect(front.obs - front.ruled).toBeCloseTo(40 + 32, 0);
});

test('FPI-12: the back has 48px fields on the twelve columns and an art box that takes the rest', async ({
  page,
}) => {
  await open(page, structuredClone(sample));
  const backs = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet.verso')].map((sheet) => {
      const panel = (/** @type {string} */ selector) =>
        sheet.querySelector(selector)?.getBoundingClientRect();
      const arte = panel('.arte');
      const box = panel('.art-box');
      const foot = panel('.foot');
      const fields = [...sheet.querySelectorAll('.fld')].map((field) => {
        const rect = field.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      });
      const labels = [...sheet.querySelectorAll('.lb')].map(
        (label) =>
          label.getBoundingClientRect().height -
          Number.parseFloat(getComputedStyle(label).paddingTop),
      );
      return {
        arteBottom: arte?.bottom ?? 0,
        boxHeight: box?.height ?? 0,
        boxWidth: box?.width ?? 0,
        fields,
        footTop: foot?.top ?? 0,
        ruled: sheet.querySelectorAll('.ruled').length,
        notes: sheet.querySelectorAll('li').length,
        labels,
      };
    }),
  );
  expect(backs).toHaveLength(4);
  for (const back of backs) {
    expect(back.fields).toHaveLength(7);
    const heights = back.fields.map((field) => field.height).sort();
    expect(heights).toEqual([48, 48, 48, 48, 48, 48, 80]);
    // Labels fit on one line (a 20px line), with no needless break.
    for (const height of back.labels) expect(height).toBeLessThanOrEqual(20);
    // The art is the full width of the panel and large: far past the half-width
    // 340px by about 100px of the v8.
    expect(back.boxWidth).toBeGreaterThan(680);
    expect(back.boxHeight).toBeGreaterThanOrEqual(240);
    expect(back.footTop - back.arteBottom).toBeLessThanOrEqual(8);
    expect(back.ruled).toBe(0);
    expect(back.notes).toBe(0);
  }
});

test('FPI-11: the art image is contained in its box and does not cover the caption', async ({
  page,
}) => {
  await open(page, structuredClone(sample));
  const fit = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet.verso');
    const box = sheet?.querySelector('.art-box')?.getBoundingClientRect();
    const img = sheet?.querySelector('.art-box img');
    const cap = sheet?.querySelector('.art-cap')?.getBoundingClientRect();
    const rect = img?.getBoundingClientRect();
    return {
      caption: cap?.top ?? 0,
      boxBottom: box?.bottom ?? 0,
      contain: img ? getComputedStyle(img).objectFit : '',
      inside:
        !!rect &&
        !!box &&
        rect.left >= box.left - 0.5 &&
        rect.right <= box.right + 0.5 &&
        rect.top >= box.top - 0.5 &&
        rect.bottom <= box.bottom + 0.5,
    };
  });
  expect(fit.contain).toBe('contain');
  expect(fit.inside).toBe(true);
  expect(fit.caption).toBeGreaterThanOrEqual(fit.boxBottom);
});

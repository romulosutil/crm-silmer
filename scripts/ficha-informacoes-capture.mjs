// Run from an isolated copy on Mel; no service, database or print switch changes.
/* global document, innerWidth */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import {
  buildFichaContentSamples,
  SAMPLE_V7_PATH,
} from './ficha-pdf-review-v7.mjs';

const sample = JSON.parse(await readFile(SAMPLE_V7_PATH, 'utf8'));
const html = buildFichaContentSamples(sample);
const directory = 'output/pdf/ficha-informacoes-2026-11-09';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const results = [];
  for (const key of /** @type {const} */ (['attendance', 'store'])) {
    const page = await browser.newPage({
      viewport: { width: key === 'attendance' ? 1054 : 688, height: 714 },
    });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html[key], { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await writeFile(`${directory}/${key}.html`, html[key]);
    await page.pdf({
      path: `${directory}/${key}.pdf`,
      preferCSSPageSize: true,
      printBackground: true,
    });
    results.push({
      sample: key,
      plannedPages: (await page.locator('.page-break').count()) + 1,
      itemFragments: await page.locator('.item-card').count(),
      grades: await page.locator('.grade-cell').count(),
      observations: await page
        .locator('.observations li, .instructions p')
        .count(),
      productionFields: await page.locator('.campo-producao-vazio').count(),
      horizontalOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    });
    await page.close();
  }
  await writeFile(
    `${directory}/browser-measurements.json`,
    JSON.stringify(
      { host: 'mel', generatedAt: new Date().toISOString(), results },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}

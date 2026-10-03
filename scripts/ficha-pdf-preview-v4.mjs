// Synthetic review artifact for the proposed v4. This script does not touch
// the immutable v2/v3 approval packages or change the live print switch.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { chromium } from '@playwright/test';

import { renderFichaHtmlV4 } from '../modules/orders/src/print/ficha-canonical-v4.js';
import {
  TEMPLATE_V4,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const snapshotUrl = new URL(
  '../docs/phase0/ficha-pdf-synthetic-v4.json',
  import.meta.url,
);
const artifactUrl = new URL(
  '../output/pdf/ficha-canonica-sintetica-v4.pdf',
  import.meta.url,
);
const sample = JSON.parse(await readFile(snapshotUrl, 'utf8'));
if (sample.syntheticOnly !== true || sample.templateVersion !== TEMPLATE_V4) {
  throw new Error('Only the synthetic v4 sample may be rendered here');
}
const html = renderFichaHtmlV4(printSnapshot(sample.order, TEMPLATE_V4), {
  synthetic: true,
});
await mkdir(dirname(fileURLToPath(artifactUrl)), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    displayHeaderFooter: true,
    footerTemplate:
      '<div style="box-sizing:border-box;color:#657086;display:flex;font-family:Arial,sans-serif;font-size:7px;justify-content:space-between;padding:0 9mm;width:100%"><span>Amostra sintética v4 · não produzir</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
    format: 'A4',
    headerTemplate: '<div></div>',
    landscape: true,
    path: fileURLToPath(artifactUrl),
    printBackground: true,
    preferCSSPageSize: true,
  });
} finally {
  await browser.close();
}

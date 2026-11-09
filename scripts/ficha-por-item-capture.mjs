// Run on Mel against a self-contained synthetic HTML file, not an API or provider.
/* global document, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const input = resolve(
  process.argv[2] ??
    'output/pdf/ficha-por-item-proposta-2026-11-09/previa.html',
);
const out = resolve(process.argv[3] ?? dirname(input));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
/** @type {Array<{orientation:string,sheets:object[]}>} */
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  await page.route('**/*', (route) =>
    route.request().url().startsWith('file:')
      ? route.continue()
      : route.abort(),
  );
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(input).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  for (const orientation of ['portrait', 'landscape']) {
    await page.selectOption('#orientation', orientation);
    await page.emulateMedia({ media: 'print' });
    const sheets = await page.locator('.sheet').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const footer = /** @type {HTMLElement} */ (
          node.querySelector('.sheet-footer')
        ).getBoundingClientRect();
        const elements = [...node.querySelectorAll('*')].filter(
          (el) =>
            el.textContent.trim() && el.getBoundingClientRect().height > 0,
        );
        return {
          item: node.dataset.item,
          width: rect.width,
          height: rect.height,
          scrollHeight: node.scrollHeight,
          footerBottom: footer.bottom - rect.top,
          productionFields: node.querySelectorAll('[data-production-field]')
            .length,
          minFontPx: Math.min(
            ...elements.map((el) =>
              Number.parseFloat(getComputedStyle(el).fontSize),
            ),
          ),
          nameWritingWidthMm:
            ((node
              .querySelector(
                '[data-production-field="conferido_arremate_por"] .write-line',
              )
              ?.getBoundingClientRect().width ?? 0) /
              96) *
            25.4,
          nameWritingHeightMm:
            ((node
              .querySelector(
                '[data-production-field="conferido_arremate_por"] .write-line',
              )
              ?.getBoundingClientRect().height ?? 0) /
              96) *
            25.4,
          extraValues: [...node.querySelectorAll('.extras dd')].map((el) => {
            const box = el.getBoundingClientRect();
            return {
              text: el.textContent ?? '',
              x: box.x - rect.x,
              y: box.y - rect.y,
              width: box.width,
              height: box.height,
            };
          }),
          overflow:
            node.scrollHeight > node.clientHeight + 1 ||
            footer.bottom > rect.bottom + 1,
          label: node.querySelector('.sheet-id')?.textContent ?? '',
        };
      }),
    );
    results.push({ orientation, sheets });
    await writeFile(
      resolve(out, 'layout-metrics.json'),
      JSON.stringify({ results, errors }, null, 2),
    );
    const overflowing = sheets.filter((s) => s.overflow);
    if (overflowing.length) {
      console.log(
        await page
          .locator('.sheet')
          .first()
          .evaluate((node) =>
            [
              ...node.querySelectorAll(
                '.sheet-header,.customer,.item-heading,.specs,.grade,.extras,.artwork,.instructions,.order-notes,.service-notes,.production,.sheet-footer',
              ),
            ].map((el) => ({
              block: el.className,
              height: el.getBoundingClientRect().height,
              top:
                el.getBoundingClientRect().top -
                node.getBoundingClientRect().top,
            })),
          ),
      );
      await page.emulateMedia({ media: 'screen' });
      await page.selectOption('#item-selector', '1');
      await page.screenshot({
        path: resolve(out, `overflow-${orientation}.png`),
        fullPage: true,
      });
      throw new Error(
        `CONTENT_EXCEEDS_ONE_SHEET ${orientation}: ${JSON.stringify(overflowing)}`,
      );
    }
    assert.equal(sheets.length, 8);
    assert.ok(
      sheets.every((s) => s.productionFields === 14 && s.minFontPx >= 13),
    );
    await page.pdf({
      path: resolve(
        out,
        `ficha-por-item-${orientation === 'portrait' ? 'retrato' : 'paisagem'}.pdf`,
      ),
      format: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
    });
    await page.emulateMedia({ media: 'screen' });
    await page.selectOption('#item-selector', '1');
    await page.screenshot({
      path: resolve(out, `preview-${orientation}.png`),
      fullPage: true,
    });
    // Selecting one preview must never drop the other seven production sheets.
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.sheet:visible').count(), 8);
    await page.emulateMedia({ media: 'screen' });
    await page.selectOption('#item-selector', 'all');
  }
  await page.selectOption('#orientation', 'portrait');
  await page.emulateMedia({ media: 'print' });
  const overflowGuard = await page
    .locator('.sheet')
    .first()
    .evaluate((node) => {
      for (const note of node.querySelectorAll('.order-notes li'))
        note.textContent =
          'Conferir o acabamento e a identificacao de todas as pecas antes de embalar. '
            .repeat(4)
            .slice(0, 200);
      return {
        scenario: 'five observations with 200 characters each',
        height: node.clientHeight,
        contentHeight: node.scrollHeight,
        detected: node.scrollHeight > node.clientHeight + 1,
      };
    });
  assert.ok(
    overflowGuard.detected,
    'Overlong legal observations must be detected instead of silently clipped',
  );
  await writeFile(
    resolve(out, 'layout-metrics.json'),
    JSON.stringify({ results, errors, overflowGuard }, null, 2),
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

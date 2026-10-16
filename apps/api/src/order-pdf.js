import { chromium } from 'playwright';

const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;

/**
 * Render the same approved ficha HTML that the print route serves. No page
 * request may leave the process: the document contains private order data and
 * must not fetch a receipt URL or any other remote resource while rendering.
 *
 * @param {string} html
 * @returns {Promise<Buffer>}
 */
export async function renderOrderPdf(html) {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    const error = new Error('PDF_RENDER_BUSY');
    /** @type {any} */ (error).statusCode = 503;
    throw error;
  }
  activeRenders += 1;
  /** @type {import('playwright').Browser|undefined} */
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CRM_PDF_CHROMIUM_PATH || undefined,
      headless: true,
      timeout: 15_000,
    });
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
    });
  } finally {
    await browser?.close();
    activeRenders -= 1;
  }
}

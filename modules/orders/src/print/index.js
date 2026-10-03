import { renderFichaHtml } from './ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from './ficha-canonical-v3.js';
import { TEMPLATE_V2, TEMPLATE_V3, printSnapshot } from './print-snapshot.js';

export { TEMPLATE_V2, TEMPLATE_V3 };

/**
 * PIM-10 (ADR 017): the single switch point for the printed ficha. Every
 * printed order uses this template; the print route never chooses one.
 *
 * It stays on `ficha-canonical-v2` until the PO approves the v3 review PDF.
 * After the approval is recorded in `docs/phase0/ficha-pdf-approval-v3.json`,
 * the Tech Lead flips it to `TEMPLATE_V3` in a commit of its own.
 * `npm run validate:ficha-pdf-review` and `test/ficha-print-switch.test.js`
 * refuse v3 here while that approval is pending.
 *
 * @type {string}
 */
export const PRINT_TEMPLATE = TEMPLATE_V2;

/**
 * The printed document of an order in the public Order contract. The
 * template is a parameter only so tests can render both; production code
 * calls it with the order alone.
 *
 * @param {any} order
 * @param {string} [template]
 * @returns {string}
 */
export function renderOrderFicha(order, template = PRINT_TEMPLATE) {
  const snapshot = printSnapshot(order, template);
  return template === TEMPLATE_V3
    ? renderFichaHtmlV3(snapshot, { synthetic: false })
    : renderFichaHtml(snapshot, { synthetic: false });
}

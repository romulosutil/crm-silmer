import { renderFichaHtml } from './ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from './ficha-canonical-v3.js';
import { TEMPLATE_V2, TEMPLATE_V3, printSnapshot } from './print-snapshot.js';

export { TEMPLATE_V2, TEMPLATE_V3 };

/**
 * PIM-10 (ADR 017): the single switch point for the printed ficha. Every
 * printed order uses this template; the print route never chooses one.
 *
 * It names `ficha-canonical-v3` since the PO's provisional approval of
 * 03/10/2026 (development and cloud-dev, T74). The final approval, the
 * physical signature by Rose and Operação in
 * `docs/phase0/ficha-pdf-approval-v3.json`, is a production go-live gate.
 * `npm run validate:ficha-pdf-review` and `test/ficha-print-switch.test.js`
 * refuse v3 here without a recorded approval; flipping back to
 * `TEMPLATE_V2` prints the locked v2 again.
 *
 * @type {string}
 */
export const PRINT_TEMPLATE = TEMPLATE_V3;

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

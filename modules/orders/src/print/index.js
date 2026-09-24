// modules/orders/src/print/index.js
import { renderFichaHtml } from './ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from './ficha-canonical-v3.js';
import { TEMPLATE_V2, TEMPLATE_V3, printSnapshot } from './print-snapshot.js';

/**
 * FIM-08: the template every printed order uses. It moves to v3 in its own
 * commit (T15), only after Rose and Operação approve the v3 review PDF;
 * `npm run validate:ficha-v3-review` refuses v3 here without that approval.
 *
 * @type {string}
 */
export const PRINT_TEMPLATE = TEMPLATE_V2;

/** @param {any} order @returns {string} */
export function renderOrderFicha(order) {
  const snapshot = printSnapshot(order, PRINT_TEMPLATE);
  return PRINT_TEMPLATE === TEMPLATE_V3
    ? renderFichaHtmlV3(snapshot, { synthetic: false })
    : renderFichaHtml(snapshot, { synthetic: false });
}

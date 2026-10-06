import { renderFichaHtml } from './ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from './ficha-canonical-v3.js';
import { renderFichaHtmlV4 } from './ficha-canonical-v4.js';
import { renderFichaHtmlV5 } from './ficha-canonical-v5.js';
import { renderFichaHtmlV6 } from './ficha-canonical-v6.js';
import {
  TEMPLATE_V2,
  TEMPLATE_V3,
  TEMPLATE_V4,
  TEMPLATE_V5,
  TEMPLATE_V6,
  printSnapshot,
} from './print-snapshot.js';

export { TEMPLATE_V2, TEMPLATE_V3, TEMPLATE_V4, TEMPLATE_V5, TEMPLATE_V6 };

/**
 * PIM-10 (ADR 017): the single switch point for the printed ficha. Every
 * printed order uses this template; the print route never chooses one.
 *
 * It names `ficha-canonical-v6` (ADR 025) since the PO approved its
 * synthetic sample on 06/10/2026 for development and cloud-dev (T100). The
 * physical signature by Rose and Operação in
 * `docs/phase0/ficha-pdf-approval-v6.json` remains a production go-live
 * gate. The validator refuses an unapproved switch; v2–v5 stay addressable
 * and their approved artifacts remain unchanged.
 *
 * @type {string}
 */
export const PRINT_TEMPLATE = TEMPLATE_V6;

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
  if (template === TEMPLATE_V6) {
    return renderFichaHtmlV6(snapshot, { synthetic: false });
  }
  if (template === TEMPLATE_V5) {
    return renderFichaHtmlV5(snapshot, { synthetic: false });
  }
  if (template === TEMPLATE_V4) {
    return renderFichaHtmlV4(snapshot, { synthetic: false });
  }
  return template === TEMPLATE_V3
    ? renderFichaHtmlV3(snapshot, { synthetic: false })
    : renderFichaHtml(snapshot, { synthetic: false });
}

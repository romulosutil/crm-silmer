import { renderFichaHtml } from './ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from './ficha-canonical-v3.js';
import { renderFichaHtmlV4 } from './ficha-canonical-v4.js';
import { renderFichaHtmlV5 } from './ficha-canonical-v5.js';
import { renderFichaHtmlV6 } from './ficha-canonical-v6.js';
import { renderFichaHtmlV7 } from './ficha-canonical-v7.js';
import { renderFichaHtmlV8 } from './ficha-canonical-v8.js';
import { renderStoreFichaHtml, TEMPLATE_STORE_V1 } from './ficha-loja-v1.js';
import {
  TEMPLATE_V2,
  TEMPLATE_V3,
  TEMPLATE_V4,
  TEMPLATE_V5,
  TEMPLATE_V6,
  TEMPLATE_V7,
  TEMPLATE_V8,
  printSnapshot,
} from './print-snapshot.js';

export {
  TEMPLATE_STORE_V1,
  TEMPLATE_V2,
  TEMPLATE_V3,
  TEMPLATE_V4,
  TEMPLATE_V5,
  TEMPLATE_V6,
  TEMPLATE_V7,
  TEMPLATE_V8,
};

/**
 * PIM-10 (ADR 017): the single switch point for the printed ficha. Every
 * printed order uses this template; the print route never chooses one.
 *
 * It names `ficha-canonical-v8` (ADR 078, FPI-T02), one A4 sheet per item,
 * since the PO approved its synthetic sample on 12/11/2026 for development
 * and cloud-dev. The physical signature by Rose and Operação in
 * `docs/phase0/ficha-pdf-approval-v8.json` (FPI-T03) remains a production
 * go-live gate. The validator refuses an unapproved switch; v2–v7 stay
 * addressable and their approved artifacts remain unchanged.
 *
 * OLIST-50 (RFC 050): `ficha-canonical-v7` (Aplicação, Previsão de entrega) is
 * addressable and testable but NOT selected: v8 supersedes it, and the
 * validator refuses `PRINT_TEMPLATE = v7` until its own approval is recorded.
 *
 * @type {string}
 */
export const PRINT_TEMPLATE = TEMPLATE_V8;

/**
 * The printed document of an order in the public Order contract. The
 * template is a parameter only so tests can render both; production code
 * calls it with the order alone. ADR 027: a site shop order always prints
 * its own simplified ficha, whatever the canonical template is.
 *
 * @param {any} order
 * @param {string} [template]
 * @param {{printedAt?: Date}} [options] when the paper was printed (v8 footer)
 * @returns {string}
 */
export function renderOrderFicha(
  order,
  template = PRINT_TEMPLATE,
  options = {},
) {
  if (order?.origin === 'loja') return renderStoreFichaHtml(order);
  const snapshot = printSnapshot(order, template);
  if (template === TEMPLATE_V8) {
    return renderFichaHtmlV8(snapshot, {
      printedAt: options.printedAt,
      synthetic: false,
    });
  }
  if (template === TEMPLATE_V7) {
    return renderFichaHtmlV7(snapshot, { synthetic: false });
  }
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

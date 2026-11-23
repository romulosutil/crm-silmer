import { commandKey } from './api-client.js';

/**
 * An uncertain response (lost connection, 5xx) may already have committed.
 * The WHOLE intent — path, body, versions and Idempotency-Key — is frozen and
 * every retry repeats it; only a definite answer (2xx or 4xx) releases it.
 *
 * @param {unknown} cause
 */
export function uncertainFailure(cause) {
  const status = Number(/** @type {any} */ (cause)?.status);
  return !status || status >= 500;
}

/**
 * @typedef {{path: string, body: Record<string, unknown>, key: string}} BillingRecord
 * @param {(record: BillingRecord) => Promise<any>} run
 */
export function billingIntent(run) {
  /** @type {BillingRecord|null} */
  let pending = null;
  return {
    get pending() {
      return pending;
    },
    /** @param {() => {path: string, body: Record<string, unknown>}} build */
    async send(build) {
      if (!pending) {
        const { path, body } = build();
        pending = Object.freeze({
          path,
          body: Object.freeze({ ...body }),
          key: commandKey(),
        });
      }
      const record = pending;
      try {
        const response = await run(record);
        pending = null;
        return response;
      } catch (cause) {
        if (!uncertainFailure(cause)) pending = null;
        throw cause;
      }
    },
    reset() {
      pending = null;
    },
  };
}

/** Copies text; falls back to a selected textarea where the API is missing. @param {string} text */
export async function copyText(text) {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    const doc = globalThis.document;
    if (!doc) return false;
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = doc.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * Moves the focus into an open journey dialog: a field, or its title (made
 * focusable) when no selector is given.
 *
 * @param {HTMLDialogElement|null|undefined} dialog
 * @param {string} [selector]
 */
export function focusInDialog(dialog, selector) {
  if (!dialog) return;
  /** @type {HTMLElement|null} */
  let target = selector ? dialog.querySelector(selector) : null;
  if (!target) {
    target = dialog.querySelector('h2');
    target?.setAttribute('tabindex', '-1');
  }
  target?.focus();
}

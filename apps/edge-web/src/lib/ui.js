/** @param {string} selector @param {ParentNode} [root] */
export function select(selector, root = document) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return /** @type {HTMLElement} */ (element);
}

/** @param {string} tag @param {Record<string, string|boolean|undefined>} [attributes] @param {...(Node|string|null|undefined)} children */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'hidden') node.hidden = Boolean(value);
    else node.setAttribute(name, String(value));
  }
  for (const child of children)
    if (child !== null && child !== undefined) node.append(child);
  return node;
}

/** @param {unknown} value @param {string} [fallback] */
export function text(value, fallback = 'Não informado') {
  return value === null || value === undefined || value === ''
    ? fallback
    : String(value);
}

/** @param {unknown} value */
export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, any>} */ (value)
    : {};
}

/** @param {unknown} value */
export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** @param {unknown} value */
export function formatDate(value) {
  if (!value) return 'Sem prazo';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? 'Sem prazo'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
}

/** @param {unknown} seconds @param {unknown} enteredAt */
export function formatDuration(seconds, enteredAt) {
  let total = Number(seconds);
  if (!Number.isFinite(total) && enteredAt)
    total = Math.max(
      0,
      (Date.now() - new Date(String(enteredAt)).getTime()) / 1000,
    );
  if (!Number.isFinite(total)) return 'Tempo não informado';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  return days ? `${days}d ${hours}h nesta etapa` : `${hours}h nesta etapa`;
}

/** @param {HTMLElement} button @param {() => Promise<any>} work */
export async function withBusy(button, work) {
  const wasDisabled =
    'disabled' in button && /** @type {HTMLButtonElement} */ (button).disabled;
  if ('disabled' in button)
    /** @type {HTMLButtonElement} */ (button).disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    button.removeAttribute('aria-busy');
    if ('disabled' in button)
      /** @type {HTMLButtonElement} */ (button).disabled = wasDisabled;
  }
}

/** @param {HTMLDialogElement} dialog @param {HTMLElement} trigger */
export function openDialog(dialog, trigger) {
  const close = () => {
    dialog.removeEventListener('close', close);
    if (trigger.isConnected) trigger.focus();
  };
  dialog.addEventListener('close', close);
  dialog.showModal();
  /** @type {HTMLElement|null} */ (
    dialog.querySelector('input, select, button')
  )?.focus();
}

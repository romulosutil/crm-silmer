import { request } from './api-client.js';

/** @param {AbortSignal} signal */
export async function fetchOrderItemOptions(signal) {
  const { data } = await request('/api/v1/orders/item-options', { signal });
  if (
    !data?.catalog ||
    !data?.aliases ||
    !['color', 'fabric', 'size'].every((kind) =>
      Array.isArray(data.catalog[kind]),
    )
  ) {
    throw new TypeError('Invalid order item catalog');
  }
  return data;
}

/** @param {string} orderId @param {string} kind @param {string} label @param {string} idempotencyKey */
export async function createOrderItemOption(
  orderId,
  kind,
  label,
  idempotencyKey,
) {
  const { data } = await request(
    '/api/v1/orders/' + encodeURIComponent(orderId) + '/item-options',
    {
      method: 'POST',
      body: { kind, label },
      idempotencyKey,
    },
  );
  if (data?.kind !== kind || typeof data.label !== 'string' || !data.label) {
    throw new TypeError('Invalid order item option');
  }
  return data.label;
}

/** @param {unknown} value */
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/[-\s]+/gu, ' ')
    .toLowerCase();
}

/**
 * @param {'color'|'fabric'|'size'} kind
 * @param {string} value
 * @param {string[]} choices
 * @param {Record<string, Record<string, string>>} aliases
 */
export function orderCatalogLabel(kind, value, choices, aliases) {
  const key = fold(value);
  const names = kind === 'size' ? undefined : aliases[kind];
  if (names && Object.hasOwn(names, key)) return names[key];
  return choices.find((label) => fold(label) === key) ?? value.trim();
}

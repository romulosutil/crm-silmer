/** OLIST-T12: decimal text enters exact integer cents, never a unit price.
 * @param {unknown} value @returns {number|null} */
export function parseSubtotal(value) {
  if (typeof value !== 'string' || value.length > 30) return null;
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/u.exec(
    value.trim(),
  );
  if (!match) return null;
  const cents =
    BigInt(match[1].replaceAll('.', '')) * 100n +
    BigInt((match[2] ?? '').padEnd(2, '0'));
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(cents)
    : null;
}

/** @param {number|null|undefined} cents */
export function subtotalLabel(cents) {
  if (!Number.isSafeInteger(cents) || Number(cents) <= 0) return 'A revisar';
  const value = BigInt(/** @type {number} */ (cents));
  return `R$ ${(value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.')},${(value % 100n).toString().padStart(2, '0')}`;
}

/** A partial sum never looks like the authoritative total.
 * @param {{lines: {subtotalCents: number|null, subtotalReviewed: boolean}[]}[]} groups
 * @returns {number|null} */
export function reviewedTotal(groups) {
  if (!groups.length || groups.some((group) => !group.lines.length))
    return null;
  let total = 0n;
  for (const group of groups)
    for (const line of group.lines) {
      if (
        !line.subtotalReviewed ||
        !Number.isSafeInteger(line.subtotalCents) ||
        Number(line.subtotalCents) <= 0
      )
        return null;
      total += BigInt(/** @type {number} */ (line.subtotalCents));
    }
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

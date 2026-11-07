import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSubtotal,
  reviewedTotal,
  subtotalLabel,
} from '../apps/edge-web/src/lib/order-money.js';

test('OLIST-T12: subtotal text preserves exact cents through the safe integer boundary', () => {
  assert.equal(parseSubtotal('1.234,56'), 123456);
  assert.equal(parseSubtotal('0,01'), 1);
  assert.equal(parseSubtotal('90.071.992.547.409,91'), Number.MAX_SAFE_INTEGER);
  assert.equal(
    subtotalLabel(Number.MAX_SAFE_INTEGER),
    'R$ 90.071.992.547.409,91',
  );
  for (const value of [
    '90.071.992.547.409,92',
    '0',
    '-10',
    '1,234',
    '1,234.00',
    '1e2',
    '',
    'Infinity',
  ]) {
    assert.equal(parseSubtotal(value), null, value);
  }
});

test('OLIST-T12: incomplete, unreviewed and overflowing compositions never show a partial total', () => {
  /** @param {number|null} subtotalCents */
  const group = (subtotalCents, subtotalReviewed = true) => ({
    lines: [{ subtotalCents, subtotalReviewed }],
  });
  assert.equal(reviewedTotal([group(101), group(202)]), 303);
  assert.equal(reviewedTotal([group(101), group(202, false)]), null);
  assert.equal(reviewedTotal([group(101), group(null)]), null);
  assert.equal(reviewedTotal([group(Number.MAX_SAFE_INTEGER), group(1)]), null);
  assert.equal(reviewedTotal([]), null);
  assert.equal(reviewedTotal([{ lines: [] }]), null);
  assert.equal(subtotalLabel(null), 'A revisar');
});

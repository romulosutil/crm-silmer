import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatBrlAmount,
  parseBrlAmount,
} from '../modules/orders/src/domain/money.js';

test('parses Brazilian real amounts into integer cents', () => {
  assert.equal(parseBrlAmount('4.820,00'), 482000);
  assert.equal(parseBrlAmount('4820'), 482000);
  assert.equal(parseBrlAmount('4820,5'), 482050);
  assert.equal(parseBrlAmount('0,01'), 1);
  assert.equal(parseBrlAmount('1.234.567,89'), 123456789);
  assert.equal(parseBrlAmount(' 150,00 '), 15000);
});

test('rejects malformed, zero and negative amounts as INVALID_AMOUNT', () => {
  for (const text of [
    '4,820.00',
    'abc',
    '0',
    '0,00',
    '-1',
    '',
    '4.82,00',
    '48.20',
    '4820,001',
    '1e3',
    'R$ 10,00',
  ]) {
    assert.throws(
      () => parseBrlAmount(text),
      (error) =>
        /** @type {any} */ (error).code === 'INVALID_AMOUNT' &&
        /** @type {any} */ (error).statusCode === 422,
      `expected ${JSON.stringify(text)} to be rejected`,
    );
  }
  assert.throws(() => parseBrlAmount(/** @type {any} */ (4820)), {
    code: 'INVALID_AMOUNT',
  });
});

test('formats integer cents back to the Brazilian real text form', () => {
  assert.equal(formatBrlAmount(482000), '4.820,00');
  assert.equal(formatBrlAmount(1), '0,01');
  assert.equal(formatBrlAmount(123456789), '1.234.567,89');
  assert.equal(parseBrlAmount(formatBrlAmount(98765)), 98765);
  assert.throws(() => formatBrlAmount(0), { code: 'INVALID_AMOUNT' });
  assert.throws(() => formatBrlAmount(1.5), { code: 'INVALID_AMOUNT' });
});

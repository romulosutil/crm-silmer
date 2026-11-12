import assert from 'node:assert/strict';
import test from 'node:test';

import {
  freightErrorMessage,
  freightFieldText,
  freightOriginLabel,
  parseFreightInput,
} from '../apps/edge-web/src/lib/order-freight.js';

test('parseFreightInput accepts whole reais, cents and zero', () => {
  assert.deepEqual(parseFreightInput('120,50'), { cents: 12050, ok: true });
  assert.deepEqual(parseFreightInput('R$ 1.200'), { cents: 120000, ok: true });
  assert.deepEqual(parseFreightInput(''), { cents: 0, ok: true });
  assert.deepEqual(parseFreightInput('0,00'), { cents: 0, ok: true });
  assert.deepEqual(parseFreightInput('0'), { cents: 0, ok: true });
});

test('parseFreightInput refuses negatives, fractions of cents and text', () => {
  for (const text of ['-5', '1,234', 'abc', '12,5,0', '1e3']) {
    assert.equal(parseFreightInput(text).ok, false, text);
  }
});

test('freightFieldText keeps an unset freight empty and a declared zero', () => {
  assert.equal(freightFieldText(0, null), '');
  assert.equal(freightFieldText(0, 'seller'), '0,00');
  assert.equal(freightFieldText(12050, 'quote'), '120,50');
});

test('freightOriginLabel names the seller or the quote service', () => {
  assert.equal(
    freightOriginLabel({ source: 'seller' }, null),
    'Informado pelo vendedor',
  );
  assert.equal(
    freightOriginLabel({ source: null }, null),
    'Sem frete informado',
  );
  const quote = {
    id: 'q1',
    services: [{ company: 'Correios', id: 2, name: 'PAC' }],
  };
  assert.equal(
    freightOriginLabel({ quoteId: 'q1', serviceId: 2, source: 'quote' }, quote),
    'Da cotação Correios · PAC',
  );
  assert.equal(
    freightOriginLabel(
      { quoteId: 'old', serviceId: 2, source: 'quote' },
      quote,
    ),
    'Da cotação',
  );
});

test('freightErrorMessage maps the contract codes', () => {
  assert.equal(freightErrorMessage({ code: 'VERSION_CONFLICT' }).reload, true);
  assert.match(
    freightErrorMessage({ code: 'SHIPPING_QUOTE_STALE' }).message,
    /desatualizada/u,
  );
  assert.match(freightErrorMessage({ status: 403 }).message, /responsável/u);
  assert.match(freightErrorMessage({ status: 0 }).message, /conexão/u);
  assert.match(freightErrorMessage({ code: 'X' }).message, /Não foi possível/u);
});

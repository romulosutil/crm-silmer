import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDER_CATALOG,
  resolveProduct,
} from '../modules/orders/src/catalog/index.js';
import { assertOrderCatalog } from '../modules/orders/src/catalog/validate.js';

test('the versioned catalog passes the structural check (CAT-06)', () => {
  assert.doesNotThrow(() => assertOrderCatalog(ORDER_CATALOG));
});

test('the approved products of the option sheet are in the catalog', () => {
  for (const name of ['Camiseta', 'Camisa polo', 'Regata', 'Bermuda', 'Boné']) {
    assert.ok(resolveProduct(name), name);
  }
});

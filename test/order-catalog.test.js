import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDER_CATALOG,
  colorSwatch,
} from '../apps/edge-web/src/lib/order-catalog.js';

/** @param {string} value */
function swatchOfOption(value) {
  return ORDER_CATALOG.lists.cores.find((option) => option.value === value)
    ?.swatch;
}

test('finds the swatch of a catalog colour typed in any case or accent (FIT-10)', () => {
  const navy = swatchOfOption('AZUL MARINHO');
  assert.ok(navy);
  assert.equal(colorSwatch('AZUL MARINHO'), navy);
  assert.equal(colorSwatch('azul-marinho'), navy);
  // The longest name wins: "rosa claro" is not read as plain "rosa".
  assert.equal(colorSwatch('ROSA CLARO'), swatchOfOption('ROSA CLARO'));
  assert.equal(
    colorSwatch('RIBANA · VERDE BANDEIRA'),
    swatchOfOption('VERDE BANDEIRA'),
  );
});

test('paints no chip for a finish or an unknown colour', () => {
  assert.equal(colorSwatch('NEON'), '');
  assert.equal(colorSwatch('COR DA ARTE'), '');
  assert.equal(colorSwatch(''), '');
});

test('offers only what the sheet approved: no fixed lists remain', async () => {
  const lib = await import('../apps/edge-web/src/lib/order-catalog.js');
  for (const name of [
    'PIECE_TYPES',
    'MODELINGS',
    'FABRICS',
    'COLORS',
    'FINISHES',
    'APPLICATIONS',
    'SIZES',
  ]) {
    assert.equal(name in lib, false, name);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATIONS,
  COLORS,
  colorSwatch,
  PIECE_TYPES,
  SIZES,
} from '../apps/edge-web/src/lib/order-catalog.js';

test('offers the catalog options of the Silmer validation sheet', () => {
  assert.ok(PIECE_TYPES.includes('Camiseta'));
  assert.ok(APPLICATIONS.includes('Sublimação total'));
  assert.deepEqual(SIZES.slice(0, 5), ['PP', 'P', 'M', 'G', 'GG']);
  assert.equal(new Set(COLORS.map((color) => color.name)).size, COLORS.length);
});

test('finds the swatch of a colour typed in any case or accent', () => {
  const navy = COLORS.find((color) => color.name === 'Azul-marinho')?.swatch;
  assert.equal(colorSwatch('AZUL MARINHO'), navy);
  assert.equal(colorSwatch('azul-marinho'), navy);
  // The longest name wins: "rosa claro" is not read as plain "rosa".
  assert.equal(
    colorSwatch('ROSA CLARO'),
    COLORS.find((color) => color.name === 'Rosa-claro')?.swatch,
  );
  assert.equal(
    colorSwatch('Olímpica · verde-bandeira'),
    COLORS.find((color) => color.name === 'Verde-bandeira')?.swatch,
  );
});

test('leaves a value without a catalog colour unmarked', () => {
  assert.equal(colorSwatch('NAO APLICAVEL'), '');
  assert.equal(colorSwatch(''), '');
  assert.equal(colorSwatch(undefined), '');
});

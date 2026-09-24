// test/order-catalog-resolver.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIELDS,
  ORDER_CATALOG,
  describeItem,
  fieldOptions,
  itemFields,
  productOptions,
  resolveProduct,
  scalesFor,
} from '../modules/orders/src/catalog/index.js';

/** @param {string} name */
function product(name) {
  const found = resolveProduct(name);
  assert.ok(found, name);
  return found;
}

test('finds a product by name or printed name, ignoring case and accents (FIT-02)', () => {
  assert.equal(resolveProduct('bone')?.id, product('BONÉ').id);
  assert.equal(resolveProduct('  camiseta ')?.id, product('Camiseta').id);
  assert.equal(resolveProduct('Camisa de time'), null);
  assert.equal(resolveProduct(''), null);
});

test('a product shows only its fields, in catalog order, with its labels (FIT-02)', () => {
  const fields = itemFields(product('Regata'));
  const ids = fields.map((field) => field.id);

  assert.ok(!ids.includes('manga'));
  assert.ok(!ids.includes('cor_manga_direita'));
  assert.equal(
    fields.find((field) => field.id === 'vies_mangas')?.label,
    'Viés cavas',
  );
  const order = FIELDS.map((field) => field.id).filter((id) =>
    ids.includes(id),
  );
  assert.deepEqual(ids, order);
});

test('a product outside the catalog shows every field as optional (FIT-03)', () => {
  const fields = itemFields(null);
  assert.equal(fields.length, FIELDS.length);
  assert.ok(fields.every((field) => field.rule === 'optional'));
});

test('offers the options that apply to the product, grouped (FIT-05)', () => {
  /** @param {string} list @param {string | null} productId */
  const values = (list, productId) =>
    fieldOptions(list, productId).flatMap((group) =>
      group.options.map((option) => option.value),
    );

  assert.ok(values('golas', product('Regata').id).includes('CARECA'));
  assert.ok(!values('golas', product('Regata').id).includes('GOLA POLO'));
  assert.ok(values('golas', product('Camisa polo').id).includes('GOLA POLO'));
  assert.ok(values('golas', null).includes('GOLA POLO'));
  const colours = fieldOptions('cores', product('Camiseta').id);
  assert.ok(colours.some((group) => group.label === 'Azuis'));
  assert.ok(
    productOptions()
      .flatMap((group) => group.options)
      .some((option) => option.value === 'CAMISETA'),
  );
});

test('offers the scales of the product (FGR-01)', () => {
  const ids = scalesFor(product('Camiseta')).map((scale) => scale.id);
  assert.ok(ids.includes('adulto'));
  assert.ok(ids.includes('infantil'));
  assert.equal(scalesFor(null).length, ORDER_CATALOG.scales.length);
});

test('describes an item saved before the catalog (FIM-07)', () => {
  const { cells } = describeItem({
    tipo: 'CAMISETA',
    modelo: 'TRADICIONAL',
    malhas: ['PP DRY'],
    cor_frente: 'BRANCO',
  });
  const cell = (/** @type {string} */ id) =>
    cells.find((entry) => entry.field.id === id);

  assert.equal(cell('gola')?.empty, true);
  assert.deepEqual(cell('malha')?.value, ['PP DRY']);
  assert.equal(cell('modelagem')?.value, 'TRADICIONAL');
});

test('reads "Não aplicável" as empty for a catalog product only (F14)', () => {
  const regata = describeItem({ tipo: 'REGATA', vies_gola: 'NAO APLICAVEL' });
  const outside = describeItem({ tipo: 'KIT', vies_gola: 'NAO APLICAVEL' });
  /** @param {ReturnType<typeof describeItem>} described */
  const viesGola = (described) =>
    described.cells.find((cell) => cell.field.id === 'vies_gola');

  assert.equal(viesGola(regata)?.empty, true);
  assert.equal(viesGola(outside)?.empty, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftItem,
  emptyItem,
  gradeForScale,
  itemPayload,
  joinComposite,
  splitComposite,
} from '../apps/edge-web/src/lib/order-items.js';

const bermuda = {
  ...emptyItem(),
  tipo: 'BERMUDA',
  modelo: 'ESPORTIVA',
  malhas: ['PP LISO', ' '],
  cor_manga_direita: 'BRANCO',
  specs: { gola: 'CARECA', cos: ' ELÁSTICO ', locais: ['', 'COSTAS TOTAL'] },
  grade: [
    { quantidade: '', tamanho: 'PP' },
    { quantidade: '3', tamanho: ' P ' },
  ],
};

test('sends empty the fields the product does not have (FIT-04)', () => {
  const payload = itemPayload(bermuda);

  assert.equal(payload.cor_manga_direita, '');
  assert.equal(payload.modelo, 'ESPORTIVA');
  assert.deepEqual(payload.specs, {
    cos: 'ELÁSTICO',
    locais: ['COSTAS TOTAL'],
  });
  assert.deepEqual(payload.malhas, ['PP LISO']);
});

test('drops the grade lines nobody counted (FGR-02)', () => {
  assert.deepEqual(itemPayload(bermuda).grade, [
    { quantidade: 3, tamanho: 'P' },
  ]);
});

test('keeps every field of a product outside the catalog (F07)', () => {
  const payload = itemPayload({ ...bermuda, tipo: 'KIT' });
  assert.equal(payload.cor_manga_direita, 'BRANCO');
  assert.equal(payload.specs.gola, 'CARECA');
});

test('writes the viés as finish and colour in one text (FIT-07)', () => {
  assert.equal(joinComposite('RIBANA', 'VERDE'), 'RIBANA · VERDE');
  assert.equal(joinComposite('', 'VERDE'), 'VERDE');
  assert.deepEqual(splitComposite('RIBANA · VERDE'), ['RIBANA', 'VERDE']);
  assert.deepEqual(splitComposite('OLÍMPICA - VERDE'), [
    'OLÍMPICA - VERDE',
    '',
  ]);
});

test('adds the missing sizes of a scale and replaces the blank line (FGR-02)', () => {
  assert.deepEqual(
    gradeForScale([{ quantidade: 1, tamanho: '' }], { sizes: ['P', 'M'] }),
    [
      { quantidade: '', tamanho: 'P' },
      { quantidade: '', tamanho: 'M' },
    ],
  );
  assert.deepEqual(
    gradeForScale([{ quantidade: 2, tamanho: 'p' }], { sizes: ['P', 'M'] }),
    [
      { quantidade: 2, tamanho: 'p' },
      { quantidade: '', tamanho: 'M' },
    ],
  );
});

test('a draft of an item saved before the catalog gets the new keys', () => {
  const draft = draftItem({ tipo: 'CAMISETA', malhas: [], grade: [] });
  assert.deepEqual(draft.specs, {});
  assert.equal(draft.escala, '');
  assert.equal(draft.outras, '');
  assert.deepEqual(draft.malhas, ['']);
});

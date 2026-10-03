import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSizes } from '../modules/orders/src/domain/sizes.js';

/** @param {...[string, number]} lines */
function grade(...lines) {
  return lines.map(([tamanho, quantidade]) => ({ quantidade, tamanho }));
}

test('reads the ways customers write sizes and counts (ADR 016)', () => {
  /** @type {Array<[unknown, ReturnType<typeof grade>]>} */
  const cases = [
    ['5 P, 10 M, 8 G, 2 GG', grade(['P', 5], ['M', 10], ['G', 8], ['GG', 2])],
    ['P5 M10 G10', grade(['P', 5], ['M', 10], ['G', 10])],
    ['10 P, 15 M e 15 G', grade(['P', 10], ['M', 15], ['G', 15])],
    ['25 M e 25G', grade(['M', 25], ['G', 25])],
    ['M10, G15 e GG5', grade(['M', 10], ['G', 15], ['GG', 5])],
    [
      'P 40, M 70, G 60 e GG 30',
      grade(['P', 40], ['M', 70], ['G', 60], ['GG', 30]),
    ],
    [{ G: 15, M: 15 }, grade(['G', 15], ['M', 15])],
    // The workflow flattens an object the model returns into this text.
    ['M: 15; G: 15', grade(['M', 15], ['G', 15])],
    ['p5\nm10', grade(['P', 5], ['M', 10])],
    ['5p/10m/3gg', grade(['P', 5], ['M', 10], ['GG', 3])],
    ['P-5, M-10.', grade(['P', 5], ['M', 10])],
    ['5 P 10 M', grade(['P', 5], ['M', 10])],
    ['  12 m  ', grade(['M', 12])],
    ['2 XGG / 3 EGG', grade(['XGG', 2], ['EGG', 3])],
    ['4 PP, 2 XG e 1 EG', grade(['PP', 4], ['XG', 2], ['EG', 1])],
    ['5 G1, 3 G5', grade(['G1', 5], ['G5', 3])],
    ['G1 5 G2 4', grade(['G1', 5], ['G2', 4])],
    ['JEGÃO 3, XX 2', grade(['JEGÃO', 3], ['XX', 2])],
    [{ g1: '3', ' m ': 2 }, grade(['G1', 3], ['M', 2])],
    [
      [
        { size: 'P', quantity: 4 },
        { quantidade: 16, tamanho: 'M' },
      ],
      grade(['P', 4], ['M', 16]),
    ],
    [[{ quantidade: 2, tamanho: '4 anos' }], grade(['4 anos', 2])],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(parseSizes(input), expected, JSON.stringify(input));
  }
});

test('a size glued to a count reads as the size and the whole count', () => {
  assert.deepEqual(parseSizes('G15'), grade(['G', 15]));
  assert.deepEqual(parseSizes('G10 GG2'), grade(['G', 10], ['GG', 2]));
  assert.deepEqual(parseSizes('15G1'), grade(['G1', 15]));
});

test('leaves anything ambiguous to the seller', () => {
  for (const input of [
    // Kids' numeric sizes and quantities "of each".
    '4 anos 3',
    '2: 5, 4: 3, 6: 2',
    '10 de cada',
    '10 de cada tamanho: P, M e G',
    // A total next to the split, or text around it.
    '20: 10 P 10 M',
    '30 peças: 10 P, 20 M',
    'tamanho P 10',
    '10 P, 20 M e o resto G',
    // A repeated size.
    '5 P, 3 P',
    'P5 p2',
    // Sizes without counts, counts without sizes, broken pairs.
    'P, M e G',
    'P e M',
    '30',
    '5 P 10',
    'P5:',
    '5, P 10, M',
    'P 5 10 M',
    'P5, 10M',
    'jegão 3, 2 xx',
    ': P5',
    'G1-G5 10',
    // Zero, signs and other symbols.
    '0 P',
    '5 P (10 M)',
    '5 P * 10 M',
    '1.000 P',
    // Unknown sizes and the cut of the garment.
    '10 baby look',
    '5 XGGG',
    '5 BL',
    // The seller's placeholder and empty values.
    'Definir com o vendedor',
    '',
    '   ',
  ]) {
    assert.equal(parseSizes(input), null, JSON.stringify(input));
  }
});

test('refuses objects and lists that do not say which count goes with which size', () => {
  for (const input of [
    {},
    { M: 0 },
    { M: 1.5 },
    { M: '10 peças' },
    { infantil: 4 },
    { M: 2, m: 3 },
    [],
    [{ quantidade: 0, tamanho: 'M' }],
    [{ quantidade: 2, tamanho: '' }],
    [{ quantidade: '2', tamanho: 'M' }],
    ['P', 'M'],
    [null],
    null,
    undefined,
    30,
    true,
    new Date(),
    Object.assign(Object.create(null), { M: 2 }),
  ]) {
    assert.equal(parseSizes(input), null, String(JSON.stringify(input)));
  }
});

test('refuses text longer than a briefing value', () => {
  assert.deepEqual(parseSizes(`5 P${' '.repeat(497)}`), grade(['P', 5]));
  assert.equal(parseSizes(`5 P${' '.repeat(498)}`), null);
});

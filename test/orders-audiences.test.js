import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIENCES,
  parseAudiences,
} from '../modules/orders/src/domain/audiences.js';

test('the audiences are a closed list, with kids not split by gender (ADR 022, D1–D2)', () => {
  assert.deepEqual(AUDIENCES, ['masculino', 'feminino', 'infantil', 'unissex']);
});

test('a split becomes audience parts only when it leaves no doubt (ADR 022)', () => {
  for (const [text, expected] of [
    [
      '4 masculinas, 3 femininas e 3 infantis',
      [
        { publico: 'masculino', quantidade: 4 },
        { publico: 'feminino', quantidade: 3 },
        { publico: 'infantil', quantidade: 3 },
      ],
    ],
    [
      'masculino 10, feminino 5',
      [
        { publico: 'masculino', quantidade: 10 },
        { publico: 'feminino', quantidade: 5 },
      ],
    ],
    [
      '10 homens e 8 mulheres',
      [
        { publico: 'masculino', quantidade: 10 },
        { publico: 'feminino', quantidade: 8 },
      ],
    ],
    [
      'Masculino: 12; Feminino: 8; Infantil: 5',
      [
        { publico: 'masculino', quantidade: 12 },
        { publico: 'feminino', quantidade: 8 },
        { publico: 'infantil', quantidade: 5 },
      ],
    ],
    [
      '20 camisetas unissex e 10 de criança',
      [
        { publico: 'unissex', quantidade: 20 },
        { publico: 'infantil', quantidade: 10 },
      ],
    ],
    ['20 femininas', [{ publico: 'feminino', quantidade: 20 }]],
  ]) {
    assert.deepEqual(parseAudiences(text), expected, String(text));
  }
  assert.deepEqual(parseAudiences({ masculino: 4, Feminino: '3' }), [
    { publico: 'masculino', quantidade: 4 },
    { publico: 'feminino', quantidade: 3 },
  ]);
});

test('anything doubtful stays with the seller (ADR 022)', () => {
  for (const text of [
    'metade masculina e metade feminina',
    '10 infantil masculino',
    '25, sendo 10 masculinas e 15 femininas',
    'masculinas e femininas',
    '10 masculinas e 5 masculinas',
    '10 masculinas e algumas femininas',
    '5 baby look e 5 masculinas',
    '0 masculinas',
    '10 meninos e 10 meninas',
    '',
    'a'.repeat(501),
  ]) {
    assert.equal(parseAudiences(text), null, text);
  }
  for (const value of [null, undefined, 10, [], {}, { masculino: 0 }]) {
    assert.equal(parseAudiences(value), null, JSON.stringify(value));
  }
});

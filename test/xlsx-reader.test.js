import assert from 'node:assert/strict';
import test from 'node:test';

import { readXlsx } from '../scripts/lib/xlsx-reader.mjs';
import { buildXlsx } from './helpers/xlsx-fixture.js';

test('reads every sheet in workbook order, with shared strings and gaps', () => {
  const bytes = buildXlsx([
    {
      name: '02 Produtos',
      rows: [['Título'], [], ['Manter', null, 'Camiseta']],
    },
    {
      name: '03 Matriz',
      rows: [
        ['Produto', 'Gola'],
        ['Camiseta', 'Sim', 3],
      ],
    },
  ]);

  const sheets = readXlsx(bytes);

  assert.deepEqual([...sheets.keys()], ['02 Produtos', '03 Matriz']);
  assert.deepEqual(sheets.get('02 Produtos'), [
    ['Título'],
    [],
    ['Manter', '', 'Camiseta'],
  ]);
  assert.deepEqual(sheets.get('03 Matriz')?.[1], ['Camiseta', 'Sim', '3']);
});

test('reads deflated entries, inline strings and XML entities', () => {
  const bytes = buildXlsx(
    [
      {
        name: 'Aba & cia',
        rows: [['Cós <cintura>', { inline: 'Viés "cavas"' }]],
      },
    ],
    { deflate: true },
  );

  assert.deepEqual(readXlsx(bytes).get('Aba & cia'), [
    ['Cós <cintura>', 'Viés "cavas"'],
  ]);
});

test('refuses a file that is not a zip', () => {
  assert.throws(() => readXlsx(Buffer.from('not a workbook')), /Not a zip/u);
});

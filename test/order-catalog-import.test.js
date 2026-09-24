import assert from 'node:assert/strict';
import test from 'node:test';

import { FIELDS } from '../modules/orders/src/catalog/fields.js';
import {
  buildOrderCatalog,
  renderCatalogModule,
} from '../scripts/import-order-catalog.mjs';
import { readXlsx } from '../scripts/lib/xlsx-reader.mjs';
import { buildXlsx } from './helpers/xlsx-fixture.js';

const SOURCE = { file: 'fixture.xlsx', sha256: '0'.repeat(64) };
const OPTION_HEADER = [
  'Decisão',
  'Origem',
  'Grupo',
  'Opção',
  'Impresso na ficha como',
  'Vale para (produtos)',
  'Observação',
];
/** @param {string} title */
const head = (title) => [[title], ['Nota da aba.']];
/** @param {Record<string, string>} rules */
const matrixRow = (rules) => FIELDS.map((field) => rules[field.id] ?? 'Não');

/** @param {{products?: string[][], golas?: string[][], matrixHeader?: string[], regataViesMangas?: string}} [override] */
function workbook(override = {}) {
  const matrixHeader = override.matrixHeader ?? [
    'Produto',
    ...FIELDS.map((field) => field.header),
    'Nomes diferentes / observação',
  ];
  return buildXlsx([
    {
      name: '02 Produtos',
      rows: [
        ...head('Produtos'),
        [
          'Decisão',
          'Origem',
          'Família',
          'Produto',
          'Impresso na ficha como',
          'Escalas de grade',
          'Observação',
        ],
        [
          'Manter',
          'Aprovado',
          'Vestuário superior',
          'Regata',
          '',
          'Adulto, Tamanho único',
          '',
        ],
        [
          'Manter',
          'Aprovado',
          'Acessório',
          'Boné',
          'BONÉ',
          'Tamanho único',
          '',
        ],
        ['', 'Sugestão', 'Profissional', 'Jaleco', 'JALECO', 'Adulto', ''],
        ...(override.products ?? []),
      ],
    },
    {
      name: '03 Produto x Campos',
      rows: [
        ...head('Matriz'),
        matrixHeader,
        [
          'Regata',
          ...matrixRow({
            modelagem: 'Sim',
            gola: 'Sim',
            malha: 'Sim',
            cor_frente: 'Sim',
            vies_mangas: override.regataViesMangas ?? 'Sim',
            locais: 'Opcional',
          }),
          'Sem manga. Acabamento mangas → "Viés cavas".',
        ],
        [
          'Boné',
          ...matrixRow({ malha: 'Sim', cor_frente: 'Sim', abertura: 'Sim' }),
          'Abertura → "Regulagem". Aba → Outras especificações.',
        ],
        ['Jaleco', ...matrixRow({ modelagem: 'Sim' }), ''],
      ],
    },
    {
      name: '05 Golas',
      rows: [
        ...head('Golas'),
        OPTION_HEADER,
        [
          'Manter',
          'Aprovado',
          'Gola/decote',
          'Careca/redonda',
          'CARECA',
          'Todos com gola',
          '',
        ],
        [
          '',
          'Sugestão',
          'Gola/decote',
          'Gola padre',
          'GOLA PADRE',
          'Jaleco',
          '',
        ],
        ['Manter', 'Aprovado', 'Gola/decote', 'Gola V', '', 'Regata', ''],
        ['Manter', 'Sugestão', 'Gola/decote', 'Gola esporte', '', 'Jaleco', ''],
        ['ADICIONAR OPÇÕES QUE ESTÃO FALTANDO'],
        ['Adicionar', 'Nova', 'Gola/decote', 'Gola alta', '', '', ''],
        ['Adicionar', 'Nova', '', '', '', '', ''],
        ...(override.golas ?? []),
      ],
    },
    {
      name: '06 Mangas',
      rows: [
        ...head('Mangas'),
        OPTION_HEADER,
        [
          'Manter',
          'Aprovado',
          'Manga',
          'Sem manga',
          '',
          'Nenhum (produtos sem manga não mostram o campo)',
          '',
        ],
        ['Manter', 'Aprovado', 'Manga', 'Curta', '', 'Todos com manga', ''],
      ],
    },
    {
      name: '08 Cores',
      rows: [
        ...head('Cores'),
        OPTION_HEADER,
        [
          'Manter',
          'Aprovado',
          'Azuis',
          'Azul-marinho',
          'AZUL MARINHO',
          'Todos',
          '',
        ],
        [
          'Manter',
          'Aprovado',
          'Especiais',
          'Neon',
          'NEON',
          'Todos',
          'Acompanha outra cor.',
        ],
      ],
    },
    {
      name: '13 Bandeira',
      rows: [
        ...head('Bandeira'),
        OPTION_HEADER,
        ['Manter', 'Aprovado', 'Faces', 'Dupla face', 'DUPLA FACE', 'Boné', ''],
      ],
    },
    {
      name: '14 Tamanhos e grades',
      rows: [
        ...head('Tamanhos'),
        OPTION_HEADER,
        [
          'Manter',
          'Aprovado',
          'Adulto alfabético',
          'P',
          '',
          'Ver escalas na aba 02',
          '',
        ],
        [
          'Manter',
          'Aprovado',
          'Adulto alfabético',
          'M',
          '',
          'Ver escalas na aba 02',
          '',
        ],
        ['Manter', 'Aprovado', 'Tamanho único', 'Único', 'ÚNICO', 'Boné', ''],
        ['', 'Sugestão', 'Medida', 'Largura × altura', '', 'Bandeira', ''],
      ],
    },
    {
      name: '15 Aplicação',
      rows: [
        ...head('Aplicação'),
        OPTION_HEADER,
        [
          'Manter',
          'Aprovado',
          'Impressão',
          'DTF — direto no filme',
          'DTF',
          'Todos',
          '',
        ],
      ],
    },
  ]);
}

/** @param {Parameters<typeof workbook>[0]} [override] */
function build(override) {
  return buildOrderCatalog(readXlsx(workbook(override)), SOURCE);
}

test('keeps only approved rows and the rules of kept products (CAT-01)', () => {
  const catalog = build();

  assert.deepEqual(
    catalog.products.map((product) => product.id),
    ['regata', 'bone'],
  );
  const [regata, bone] = catalog.products;
  assert.deepEqual(regata.fields, {
    modelagem: { rule: 'required' },
    gola: { rule: 'required' },
    malha: { rule: 'required' },
    cor_frente: { rule: 'required' },
    vies_mangas: { rule: 'required', label: 'Viés cavas' },
    locais: { rule: 'optional' },
  });
  assert.deepEqual(bone.fields.abertura, {
    rule: 'required',
    label: 'Regulagem',
  });
  assert.equal(regata.print, 'REGATA');
  assert.deepEqual(regata.scales, ['adulto', 'unico']);
  assert.deepEqual(
    catalog.lists.golas.map((option) => option.value),
    ['CARECA', 'GOLA V', 'GOLA ALTA'],
  );
});

test('reads who each option is for and what it prints (CAT-04, CAT-05)', () => {
  const catalog = build();

  const golas = Object.fromEntries(
    catalog.lists.golas.map((option) => [option.value, option.products]),
  );
  assert.deepEqual(golas, {
    CARECA: [],
    'GOLA V': ['regata'],
    'GOLA ALTA': [],
  });
  assert.deepEqual(
    catalog.lists.mangas.map((option) => option.value),
    ['CURTA'],
  );
  assert.deepEqual(catalog.lists.cores, [
    {
      value: 'AZUL MARINHO',
      label: 'Azul-marinho',
      group: 'Azuis',
      products: [],
      swatch: '#1f2a5a',
    },
    {
      value: 'NEON',
      label: 'Neon',
      group: 'Especiais',
      products: [],
      note: 'Acompanha outra cor.',
    },
  ]);
  assert.deepEqual(catalog.lists.faces, [
    {
      value: 'DUPLA FACE',
      label: 'Dupla face',
      group: 'Faces',
      products: ['bone'],
    },
  ]);
  assert.deepEqual(catalog.scales, [
    { id: 'adulto', label: 'Adulto', sizes: ['P', 'M'], freeText: false },
    { id: 'unico', label: 'Único', sizes: ['ÚNICO'], freeText: false },
  ]);
  assert.deepEqual(catalog.applications, [
    {
      value: 'DTF',
      label: 'DTF — direto no filme',
      group: 'Impressão',
      products: [],
    },
  ]);
  for (const field of FIELDS) {
    assert.ok(Array.isArray(catalog.lists[field.list]), field.list);
  }
});

test('refuses a rule outside Sim, Opcional and Não (CAT-02)', () => {
  assert.throws(
    () => build({ regataViesMangas: 'Talvez' }),
    /03 Produto x Campos, linha 4: regra "Talvez"/u,
  );
});

test('refuses an unknown product in "Vale para" (CAT-02)', () => {
  assert.throws(
    () =>
      build({
        golas: [
          [
            'Manter',
            'Aprovado',
            'Gola/decote',
            'Gola canoa',
            '',
            'Regatta',
            '',
          ],
        ],
      }),
    /05 Golas, linha \d+: produto "Regatta"/u,
  );
});

test('refuses a matrix header that names no field (CAT-02)', () => {
  const header = [
    'Produto',
    ...FIELDS.map((field) => field.header),
    'Nomes diferentes',
  ];
  header[header.indexOf('Bolso')] = 'Capuz';
  assert.throws(
    () => build({ matrixHeader: header }),
    /cabeçalho "Capuz" não corresponde a nenhum campo/u,
  );
});

test('refuses a kept product without a matrix row (CAT-02)', () => {
  assert.throws(
    () =>
      build({
        products: [
          [
            'Manter',
            'Aprovado',
            'Acessório',
            'Ecobag/sacola',
            'ECOBAG',
            'Tamanho único',
            '',
          ],
        ],
      }),
    /Ecobag\/sacola.*aba 03/u,
  );
});

test('builds the same module twice from the same file (CAT-03)', async () => {
  const bytes = workbook();
  const first = await renderCatalogModule(
    buildOrderCatalog(readXlsx(bytes), SOURCE),
  );
  const second = await renderCatalogModule(
    buildOrderCatalog(readXlsx(bytes), SOURCE),
  );

  assert.equal(first, second);
  assert.match(first, /^\/\/ GERADO por scripts\/import-order-catalog\.mjs/u);
  assert.match(first, /export default \{/u);
});

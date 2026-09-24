// scripts/import-order-catalog.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';

import { FIELDS } from '../modules/orders/src/catalog/fields.js';
import { foldText } from '../modules/orders/src/catalog/text.js';
import { assertOrderCatalog } from '../modules/orders/src/catalog/validate.js';
import { readXlsx } from './lib/xlsx-reader.mjs';

/**
 * @typedef {import('../modules/orders/src/catalog/types.js').OrderCatalog} OrderCatalog
 * @typedef {import('../modules/orders/src/catalog/types.js').CatalogOption} CatalogOption
 * @typedef {import('../modules/orders/src/catalog/types.js').CatalogProduct} CatalogProduct
 * @typedef {import('../modules/orders/src/catalog/fields.js').FieldDefinition} FieldDefinition
 * @typedef {{ line: number, decision: string, origin: string, group: string,
 *   option: string, printed: string, applies: string, note: string }} SheetRow
 * @typedef {{ id: string, label: string, sizes: string[], freeText: boolean, key: string }} ScaleDraft
 */

const DATA_URL = new URL(
  '../modules/orders/src/catalog/order-catalog.data.js',
  import.meta.url,
);
// CAT-01: what the reviewer kept, and what she wrote herself in the purple rows.
const APPROVED = new Set(['Manter', 'Adicionar']);
/** @type {Record<string, 'required'|'optional'|null>} */
const RULES = { Sim: 'required', Opcional: 'optional', Não: null };
/** @type {Record<string, string>} */
const LIST_TABS = {
  '04': 'modelagens',
  '05': 'golas',
  '06': 'mangas',
  '07': 'malhas',
  '08': 'cores',
  '09': 'acabamentos',
  10: 'aberturas',
  11: 'bolsos',
  12: 'cos',
  16: 'locais',
};
/** @type {Record<string, string>} */
const BANNER_GROUPS = { faces: 'faces', 'fixacao borda': 'fixacoes' };
/** @type {Record<string, string>} */
const SCALE_IDS = { 'adulto alfabetico': 'adulto', 'tamanho unico': 'unico' };
/** @type {Record<string, string>} */
const SCALE_LABELS = { adulto: 'Adulto', unico: 'Único' };
// The sheet names colours; the screen shows a chip. Approximations only, never printed.
/** @type {Record<string, string>} */
const SWATCHES = {
  branco: '#ffffff',
  'off white natural': '#f3eee1',
  preto: '#17151c',
  'cinza claro': '#c9c8cf',
  'cinza mescla': '#9a98a0',
  'grafite chumbo': '#4a4952',
  'azul marinho': '#1f2a5a',
  'azul royal': '#1d4fd8',
  'azul celeste': '#7cc4f0',
  'azul turquesa': '#1bb5b5',
  'azul petroleo': '#1d5566',
  'verde bandeira': '#0f7a3a',
  'verde militar musgo': '#4f5a2e',
  'verde limao': '#9fd11f',
  'verde menta': '#a6e3c8',
  amarelo: '#f5c400',
  'amarelo ouro': '#d9a400',
  laranja: '#ff6a13',
  coral: '#ff7f6a',
  vermelho: '#c8102e',
  'vinho bordo': '#6d1a2c',
  'rosa claro': '#f6c1d0',
  rosa: '#ec7fa9',
  'pink magenta': '#d6197a',
  roxo: '#5b2a8c',
  lilas: '#b79ad8',
  bege: '#d8c3a0',
  caqui: '#b0a178',
  caramelo: '#b06a2a',
  marrom: '#5c3a21',
};

/** @param {string} tab @param {number} line @param {string} message */
function importError(tab, line, message) {
  return new Error(`${tab}, linha ${line}: ${message}`);
}

/** @param {Map<string, string[][]>} sheets @param {string} prefix */
function findTab(sheets, prefix) {
  return [...sheets.keys()].find((name) => name.startsWith(`${prefix} `));
}

/** @param {Map<string, string[][]>} sheets @param {string} prefix */
function requireTab(sheets, prefix) {
  const name = findTab(sheets, prefix);
  if (!name) throw new Error(`Aba ${prefix} não encontrada na planilha`);
  return name;
}

/** @param {string[]} cells @param {number} index @returns {SheetRow} */
function rowOf(cells, index) {
  const [
    decision = '',
    origin = '',
    group = '',
    option = '',
    printed = '',
    applies = '',
    note = '',
  ] = cells.map((cell) => String(cell ?? '').trim());
  return {
    line: index + 1,
    decision,
    origin,
    group,
    option,
    printed,
    applies,
    note,
  };
}

/**
 * Rows below the header (row 3) that name an option.
 *
 * @param {Map<string, string[][]>} sheets @param {string} prefix
 * @param {{required?: boolean}} [options]
 */
function tabRows(sheets, prefix, options = {}) {
  const name = options.required
    ? requireTab(sheets, prefix)
    : findTab(sheets, prefix);
  if (!name) return { name: prefix, all: [], approved: [] };
  const all = (sheets.get(name) ?? [])
    .map(rowOf)
    .filter((row) => row.line > 3 && row.option !== '');
  return {
    name,
    all,
    approved: all.filter((row) => APPROVED.has(row.decision)),
  };
}

/** CAT-05 @param {SheetRow} row */
function printedValue(row) {
  return row.printed !== ''
    ? row.printed
    : row.option.toLocaleUpperCase('pt-BR');
}

/** @param {Map<string, string[][]>} sheets */
function readScales(sheets) {
  const { name, all, approved } = tabRows(sheets, '14', { required: true });
  // Every group the tab names, approved or not: a product may list a scale
  // still waiting for approval (ignored), but not one that does not exist.
  const known = new Set(
    all.map((row) => foldText(row.group)).filter((key) => key !== ''),
  );
  /** @type {Map<string, ScaleDraft>} */
  const scales = new Map();
  for (const row of approved) {
    const key = foldText(row.group);
    if (key === '')
      throw importError(name, row.line, 'tamanho sem grupo (escala)');
    let scale = scales.get(key);
    if (!scale) {
      const id = SCALE_IDS[key] ?? key.replaceAll(' ', '-');
      scale = {
        id,
        label: SCALE_LABELS[id] ?? row.group,
        sizes: [],
        freeText: id === 'medida',
        key,
      };
      scales.set(key, scale);
    }
    if (!scale.freeText) scale.sizes.push(printedValue(row));
  }
  return { known, scales };
}

/**
 * @param {string} tab @param {SheetRow} row
 * @param {{known: Set<string>, scales: Map<string, ScaleDraft>}} scaleInfo
 */
function productScales(tab, row, scaleInfo) {
  /** @type {string[]} */
  const ids = [];
  for (const part of row.applies.split(',')) {
    const wanted = foldText(part);
    if (wanted === '') continue;
    /** @param {string} key */
    const matches = (key) => key.startsWith(wanted) || wanted.startsWith(key);
    const known = [...scaleInfo.known].filter(matches);
    if (known.length !== 1) {
      throw importError(
        tab,
        row.line,
        `escala "${part.trim()}" não corresponde a um grupo da aba 14`,
      );
    }
    const scale = scaleInfo.scales.get(known[0]);
    if (scale) ids.push(scale.id); // a scale with no approved size is ignored
  }
  return ids;
}

/**
 * @param {Map<string, string[][]>} sheets
 * @param {{known: Set<string>, scales: Map<string, ScaleDraft>}} scaleInfo
 */
function readProducts(sheets, scaleInfo) {
  const { name, all, approved } = tabRows(sheets, '02', { required: true });
  /** @type {CatalogProduct[]} */
  const products = approved.map((row) => ({
    id: foldText(row.option).replaceAll(' ', '-'),
    label: row.option,
    print: printedValue(row),
    family: row.group,
    scales: productScales(name, row, scaleInfo),
    fields: {},
  }));
  return {
    products,
    allNames: new Set(all.map((row) => foldText(row.option))),
  };
}

/** @param {Map<string, string[][]>} sheets @param {CatalogProduct[]} products */
function readMatrix(sheets, products) {
  const tab = requireTab(sheets, '03');
  const rows = sheets.get(tab) ?? [];
  /** @type {Array<{column: number, field: FieldDefinition}>} */
  const columns = [];
  let labelsColumn = -1;
  (rows[2] ?? []).forEach((cell, column) => {
    const text = String(cell ?? '').trim();
    if (column === 0 || text === '') return;
    if (foldText(text).startsWith('nomes diferentes')) {
      labelsColumn = column;
      return;
    }
    const field = FIELDS.find(
      (candidate) => foldText(candidate.header) === foldText(text),
    );
    if (!field)
      throw importError(
        tab,
        3,
        `cabeçalho "${text}" não corresponde a nenhum campo`,
      );
    columns.push({ column, field });
  });
  const byName = new Map(
    products.map((product) => [foldText(product.label), product]),
  );
  /** @type {Set<string>} */
  const seen = new Set();
  rows.forEach((cells, index) => {
    if (index < 3) return;
    const product = byName.get(foldText(cells[0]));
    if (!product) return; // a product not kept in tab 02
    seen.add(product.id);
    for (const { column, field } of columns) {
      const value = String(cells[column] ?? '').trim();
      if (!Object.hasOwn(RULES, value)) {
        throw importError(
          tab,
          index + 1,
          `regra "${value}" em ${field.header}; use Sim, Opcional ou Não`,
        );
      }
      const rule = RULES[value];
      if (rule) product.fields[field.id] = { rule };
    }
    const labels = labelsColumn >= 0 ? String(cells[labelsColumn] ?? '') : '';
    for (const [, fieldName, label] of labels.matchAll(
      /([^.;"→]+?)\s*→\s*"([^"]+)"/gu,
    )) {
      const wanted = foldText(fieldName);
      const field = columns
        .map((entry) => entry.field)
        .find((candidate) => foldText(candidate.header).startsWith(wanted));
      if (!field)
        throw importError(
          tab,
          index + 1,
          `rótulo para campo desconhecido "${fieldName.trim()}"`,
        );
      const setting = product.fields[field.id];
      if (!setting)
        throw importError(
          tab,
          index + 1,
          `rótulo "${label}" para ${field.header}, que o produto não tem`,
        );
      setting.label = label;
    }
  });
  for (const product of products) {
    if (!seen.has(product.id)) {
      throw new Error(
        `${tab}: produto "${product.label}" mantido na aba 02 sem linha na aba 03`,
      );
    }
  }
}

/**
 * CAT-04: `[]` = every product with the field; `null` = offered to nobody.
 *
 * @param {string} tab @param {SheetRow} row
 * @param {Map<string, string>} productIds @param {Set<string>} allNames
 * @returns {string[] | null}
 */
function resolveApplies(tab, row, productIds, allNames) {
  const key = foldText(row.applies);
  if (key === '' || key.startsWith('todos') || key.startsWith('ver '))
    return [];
  if (key.startsWith('nenhum')) return null;
  /** @type {string[]} */
  const ids = [];
  for (const part of row.applies.split(',')) {
    const name = foldText(part);
    if (name === '') continue;
    const id = productIds.get(name);
    if (id) ids.push(id);
    else if (!allNames.has(name)) {
      throw importError(
        tab,
        row.line,
        `produto "${part.trim()}" em "Vale para" não existe na aba 02`,
      );
    }
  }
  return ids.length > 0 ? ids : null;
}

/**
 * @param {Map<string, string[][]>} sheets
 * @param {{file: string, sha256: string}} source
 * @returns {OrderCatalog}
 */
export function buildOrderCatalog(sheets, source) {
  const scaleInfo = readScales(sheets);
  const { products, allNames } = readProducts(sheets, scaleInfo);
  readMatrix(sheets, products);
  const productIds = new Map(
    products.map((product) => [foldText(product.label), product.id]),
  );
  /** @param {string} tab @param {SheetRow} row @param {boolean} withSwatch @returns {CatalogOption | null} */
  const toOption = (tab, row, withSwatch) => {
    const optionProducts = resolveApplies(tab, row, productIds, allNames);
    if (optionProducts === null) return null;
    /** @type {CatalogOption} */
    const option = {
      value: printedValue(row),
      label: row.option,
      group: row.group,
      products: optionProducts,
    };
    if (row.note !== '') option.note = row.note;
    const swatch = withSwatch ? SWATCHES[foldText(row.option)] : undefined;
    if (swatch) option.swatch = swatch;
    return option;
  };
  /** @type {Record<string, CatalogOption[]>} */
  const lists = Object.fromEntries(
    [
      ...new Set(
        FIELDS.flatMap((field) =>
          field.colorList ? [field.list, field.colorList] : [field.list],
        ),
      ),
    ].map((id) => [id, []]),
  );
  for (const [prefix, listId] of Object.entries(LIST_TABS)) {
    const { name, approved } = tabRows(sheets, prefix);
    for (const row of approved) {
      const option = toOption(name, row, listId === 'cores');
      if (option) lists[listId].push(option);
    }
  }
  const banner = tabRows(sheets, '13');
  for (const row of banner.approved) {
    const listId = BANNER_GROUPS[foldText(row.group)];
    if (!listId)
      throw importError(
        banner.name,
        row.line,
        `grupo "${row.group}" não é Faces nem Fixação/borda`,
      );
    const option = toOption(banner.name, row, false);
    if (option) lists[listId].push(option);
  }
  const applications = tabRows(sheets, '15', { required: true }).approved.map(
    (row) => ({
      value: printedValue(row),
      label: row.option,
      group: row.group,
      products: /** @type {string[]} */ ([]),
    }),
  );
  /** @type {OrderCatalog} */
  const catalog = {
    schemaVersion: 1,
    source,
    products,
    lists,
    scales: [...scaleInfo.scales.values()].map(
      ({ id, label, sizes, freeText }) => ({ id, label, sizes, freeText }),
    ),
    applications,
  };
  assertOrderCatalog(catalog);
  return catalog;
}

/** @param {OrderCatalog} catalog */
export async function renderCatalogModule(catalog) {
  const source = [
    `// GERADO por scripts/import-order-catalog.mjs a partir de ${catalog.source.file}.`,
    '// Não editar: mude a planilha e rode `npm run catalog:import -- --from <arquivo.xlsx>`.',
    '',
    "/** @type {import('./types.js').OrderCatalog} */",
    `export default ${JSON.stringify(catalog, null, 2)};`,
    '',
  ].join('\n');
  const config = await resolveConfig(fileURLToPath(DATA_URL));
  return format(source, { ...config, parser: 'babel' });
}

/** @param {string[]} argv */
async function main(argv) {
  const at = argv.indexOf('--from');
  const from = at >= 0 ? argv[at + 1] : undefined;
  if (!from)
    throw new Error(
      'Use: npm run catalog:import -- --from <arquivo.xlsx> [--check]',
    );
  const bytes = await readFile(from);
  const catalog = buildOrderCatalog(readXlsx(bytes), {
    file: basename(from),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const source = await renderCatalogModule(catalog);
  if (argv.includes('--check')) {
    const current = await readFile(DATA_URL, 'utf8').catch(() => '');
    if (current !== source)
      throw new Error('order-catalog.data.js está diferente da planilha');
    console.log('Catálogo em dia com a planilha.');
    return;
  }
  await writeFile(DATA_URL, source);
  const options = Object.values(catalog.lists).reduce(
    (total, list) => total + list.length,
    0,
  );
  console.log(
    `Catálogo gerado: ${catalog.products.length} produtos, ${options} opções, ${catalog.scales.length} escalas.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Importação do catálogo falhou: ${error.message}`);
    process.exitCode = 1;
  });
}

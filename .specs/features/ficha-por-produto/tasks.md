# Ficha por produto — Plano de implementação (tasks)

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar este plano task a
> task. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** o produto escolhido em cada item define os campos, os rótulos e as
sugestões da ficha, a partir do catálogo aprovado na planilha da Silmer, e a
ficha impressa v3 imprime só o que vale para cada peça.

**Arquitetura:** um script lê o `.xlsx` aprovado e gera
`modules/orders/src/catalog/order-catalog.data.js`. Um resolvedor puro na mesma
pasta é importado pelo domínio (validação, faltantes, impressão) e pelo
frontend (tela do pedido), então regra, rótulo e ordem são os mesmos em todo
lugar. A ficha continua no `ficha_envelope`; o item ganha `specs`, `escala` e
`outras`, todos opcionais.

**Stack:** Node 24 (ESM, `node:test`, `node:zlib`), Vue 3 + Vite, Playwright +
axe, Prettier. Nenhuma dependência nova.

**Spec:** [`spec.md`](spec.md) · **Decisões:** [`context.md`](context.md) ·
**Arquitetura:** [`design.md`](design.md)

> ⚠️ **Replanejar antes de executar (25/09/2026).** A spec ganhou o Tipo de
> serviço por item (P1-6, FTS-01…05, FIM-10; decisões F24–F27). Este plano
> ainda trata a aba 15 como `applications` do cabeçalho. Tasks afetadas:
> T01 (ADR), T03 (aba 15 → `lists.servicos`, campo `servicos` em `fields.js`,
> contagem de opções), T04 (`applicationOptions` sai; `itemFields` inclui
> `servicos`), T05 (`servicos` no item, `artwork_technique` no primeiro item),
> T06 (faltantes), T07 (linha larga e cabeçalho sem Aplicação), T08 (fixture),
> T09–T11 (Aplicação sai do Resumo, entra no card), T14 (rastreabilidade).

## Restrições globais

- Nenhuma dependência nova em `package.json` (política de supply chain). Só
  entram scripts npm.
- `apps/edge-web/package.json` continua sem `dependencies`. O frontend só
  importa de `modules/` dentro de `modules/orders/src/catalog/`.
- A pasta `modules/orders/src/catalog/` só importa arquivos dela mesma.
- `order-catalog.data.js` é **gerado**. Nunca editar à mão; rodar
  `npm run catalog:import -- --from <arquivo.xlsx>`.
- `modules/orders/src/print/ficha-canonical-v2.js` não muda nenhum byte (travado
  por hash em `docs/phase0/ficha-pdf-approval.json`).
- CSS só com tokens semânticos (`npm run check:design-tokens`); nenhuma cor
  literal em `.css`.
- Vue segue `eslint-plugin-vue` `flat/essential`: componente filho não muta
  prop; emite `update:modelValue`.
- JS com `checkJs` + `strict`: toda função nova tem JSDoc de parâmetros.
- Texto de interface em português; código, nomes e commits em inglês.
- Só linhas com Decisão = `Manter` (ou `Adicionar` com Opção preenchida) entram
  no catálogo.
- A01 continua valendo: nada novo bloqueia "Confirmar pedido".

---

## Convenções

- **Uma task = um commit**, Conventional Commits em inglês, terminando com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Testes vivem na mesma task** que cria o código. Não existe task só de teste.
- Marcar desvio da spec no código ou no relatório com `SPEC_DEVIATION: <motivo>`.
- O arquivo real do catálogo vem de
  `G:/Meu Drive/Silmer/005-lista-de-opcoes-para-aprovacao.xlsx` (Google Drive
  para desktop). Sem acesso a esse caminho, baixe o arquivo do Drive
  (`12o5yXtlgXZryQrIwOrFlGTb36zzDkGvF`) e use o caminho local.

### Matriz de testes

| Camada                                      | Tipo               | Onde                                                                                            | Paralelo seguro |
| ------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- | --------------- |
| Scripts (`scripts/`)                        | unit (`node:test`) | `test/xlsx-reader.test.js`, `test/order-catalog-import.test.js`, `test/ficha-v3-review.test.js` | Sim             |
| Catálogo (`modules/orders/src/catalog`)     | unit               | `test/order-catalog-contract.test.js`, `test/order-catalog-resolver.test.js`                    | Sim             |
| Domínio e impressão (`modules/orders/src`)  | unit               | `test/orders-ficha.test.js`, `test/orders-domain.test.js`, `test/orders-print-v3.test.js`       | Sim             |
| Rotas da API                                | unit               | `test/order-routes.test.js`                                                                     | Sim             |
| Lib pura do front (`apps/edge-web/src/lib`) | unit               | `test/order-items.test.js`, `test/order-format.test.js`, `test/order-catalog.test.js`           | Sim             |
| Componentes Vue                             | e2e (Playwright)   | `test/e2e/orders.spec.js`                                                                       | **Não**         |

### Gates

| Gate  | Comando                                                                        |
| ----- | ------------------------------------------------------------------------------ |
| docs  | `npx prettier --check <arquivos .md da task>`                                  |
| quick | `node --test <arquivos de teste da task> && npm run lint && npm run typecheck` |
| e2e   | `npm run test:e2e -- test/e2e/orders.spec.js`                                  |
| full  | `npm run validate`                                                             |

---

## Plano de execução

| Grupo                   | Tasks   | Depende de                    |
| ----------------------- | ------- | ----------------------------- |
| **A** Decisão           | T01     | —                             |
| **B** Catálogo          | T02–T04 | A                             |
| **C** Domínio           | T05–T06 | T04                           |
| **D** Impressão         | T07–T08 | T05                           |
| **E** Tela              | T09–T13 | T04 (T09); em ordem           |
| **F** Verificação       | T14     | todos                         |
| **G** Gate humano da v3 | T15     | T14 + aprovação Rose/Operação |

```
T01 ─► T02 ─► T03 ─► T04 ─┬─► T05 ─┬─► T06
                          │        └─► T07 ─► T08
                          └─► T09 ─► T10 ─► T11 ─► T12 ─► T13
                                                   todos ─► T14 ─► (aprovação) ─► T15
```

Depois de T04, os grupos C/D e E rodam em paralelo. **Nada vai para produção
antes da T15** (ver `design.md` → Riscos).

### Mapa de arquivos

| Arquivo                                                    | Task     | Responsabilidade                                 |
| ---------------------------------------------------------- | -------- | ------------------------------------------------ |
| `docs/adr/007-ficha-por-produto.md`                        | T01      | Decisão arquitetural                             |
| `scripts/lib/xlsx-reader.mjs`                              | T02      | Ler `.xlsx` sem dependência                      |
| `test/helpers/xlsx-fixture.js`                             | T02      | Montar `.xlsx` em memória para testes            |
| `modules/orders/src/catalog/text.js`                       | T03      | `foldText`                                       |
| `modules/orders/src/catalog/fields.js`                     | T03      | Campos do item (fixos no código)                 |
| `modules/orders/src/catalog/types.js`                      | T03      | Typedefs do catálogo                             |
| `modules/orders/src/catalog/validate.js`                   | T03      | `assertOrderCatalog`                             |
| `scripts/import-order-catalog.mjs`                         | T03      | Planilha → arquivo gerado                        |
| `modules/orders/src/catalog/order-catalog.data.js`         | T03      | **Gerado**                                       |
| `modules/orders/src/catalog/index.js`                      | T04      | Resolvedor puro                                  |
| `modules/orders/src/domain/ficha.js`                       | T05      | `specs`, `escala`, `outras`, FIT-04              |
| `modules/orders/src/domain/order.js`                       | T06      | Faltantes por produto                            |
| `modules/orders/src/print/print-snapshot.js`               | T07      | Snapshot v2/v3 (movido da rota)                  |
| `modules/orders/src/print/ficha-canonical-v3.js`           | T07      | Template v3                                      |
| `modules/orders/src/print/index.js`                        | T07      | `PRINT_TEMPLATE`, `renderOrderFicha`             |
| `scripts/ficha-v3-review.mjs`                              | T08      | PDF sintético v3 + gate                          |
| `docs/phase0/ficha-pdf-synthetic-v3.json`                  | T08      | Pedido sintético da revisão                      |
| `docs/phase0/ficha-pdf-approval-v3.json`                   | T08      | Registro de aprovação (gerado, pendente)         |
| `apps/edge-web/src/lib/order-catalog.js`                   | T09, T13 | Ponte do front para o resolvedor + `colorSwatch` |
| `apps/edge-web/src/lib/order-items.js`                     | T09      | Funções puras do rascunho do item                |
| `apps/edge-web/src/components/order/OrderCombobox.vue`     | T10      | Combobox ARIA com grupos                         |
| `apps/edge-web/src/components/order/OrderSpecField.vue`    | T11      | Um campo do item por `kind`                      |
| `apps/edge-web/src/components/order/OrderItemsSection.vue` | T11, T12 | Card do item por produto; grade por escala       |

---

## Tasks

### T01: ADR 007 — ficha por produto

- **What:** registrar a decisão: catálogo gerado da planilha, produto define a
  ficha, template v3 atrás de gate humano.
- **Where:** `docs/adr/007-ficha-por-produto.md`
- **Depends on:** —
- **Requirement:** F01–F23 (context)

**Files:**

- Create: `docs/adr/007-ficha-por-produto.md`

- [ ] **Step 1: Escrever o ADR**

```markdown
# ADR 007 — Ficha do pedido definida pelo produto

Status: aceito

Data: 24/09/2026

Decisores: PO, em sessão de design de 24/09/2026.

## Contexto

A ficha do pedido tinha os mesmos campos para qualquer peça: uma bermuda
imprimia "NÃO APLICÁVEL" em mangas e gola, e bonés e bandeiras não tinham onde
registrar regulagem, faces ou fixação. A Silmer aprovou um catálogo de opções
na planilha `005-lista-de-opcoes-para-aprovacao.xlsx` (linhas "Manter"), mas o
sistema usava listas copiadas à mão. O módulo `modules/catalog` pertence ao
runtime comercial de Negócio (ADR 004) e não guarda regra por campo.

## Decisão

- O produto do item define quais campos existem, com que rótulo e com quais
  sugestões. Regras por produto: Sim, Opcional, Não.
- O catálogo é gerado da planilha aprovada por
  `scripts/import-order-catalog.mjs` e versionado em git como
  `modules/orders/src/catalog/order-catalog.data.js`. O sistema não lê o
  Google Sheets em tempo de execução nem usa `modules/catalog`.
- Backend e frontend usam o mesmo resolvedor puro
  (`modules/orders/src/catalog/index.js`).
- Campos novos do item ficam em `specs`, `escala` e `outras` dentro do
  `ficha_envelope`, sem migration.
- "Sim" entra no banner de faltantes e não bloqueia a confirmação (A01).
- A ficha impressa ganha `ficha-canonical-v3`. A troca de template é um commit
  próprio, depois da aprovação de Rose e Operação registrada em
  `docs/phase0/ficha-pdf-approval-v3.json`.

## Consequências

- Supersede D10 e D15 da feature Pedidos MVP depois da aprovação da v3, e D11
  apenas para "locais da aplicação", que passam a ser campo do item e saem
  impressos.
- Mudar o catálogo é: editar a planilha, rodar o script, fazer commit e deploy.
- Um catálogo editável pela operação (tabelas no PostgreSQL) fica para uma
  decisão futura; o modelo relacional está em
  `.specs/features/ficha-por-produto/design.md`.

Decide o primeiro incremento da [RFC 005](../rfc/005-catalogo-de-opcoes-do-pedido.md)
(Opção A): produto filtra campos e opções, catálogo versionado, tamanhos por
produto. Códigos gravados, aliases, compatibilidades entre opções e preço
continuam propostos na RFC 005, para o ADR da estrutura final.

Links: [spec](../../.specs/features/ficha-por-produto/spec.md) ·
[design](../../.specs/features/ficha-por-produto/design.md) ·
[ADR 006](006-pedido-dois-status.md)
```

- [ ] **Step 2: Formatar e conferir**

Run: `npx prettier --write docs/adr/007-ficha-por-produto.md && npm run format:check`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 3: Commit**

```bash
git add docs/adr/007-ficha-por-produto.md
git commit -m "docs(adr): let the product define the order ficha" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] ADR 007 existe, formatado, com links para spec, design e RFC 005
- [ ] Gate docs passa

**Tests:** nenhum · **Gate:** docs · **Commit:** `docs(adr): let the product define the order ficha`

---

### T02: Leitor de `.xlsx` sem dependência

- **What:** ler abas e células de texto de um `.xlsx` com `node:zlib`.
- **Where:** `scripts/lib/xlsx-reader.mjs`, `test/helpers/xlsx-fixture.js`, `test/xlsx-reader.test.js`
- **Depends on:** T01
- **Requirement:** CAT-01 (habilita)

**Files:**

- Create: `scripts/lib/xlsx-reader.mjs`
- Create: `test/helpers/xlsx-fixture.js`
- Test: `test/xlsx-reader.test.js`

**Interfaces:**

- Produces: `readXlsx(bytes: Buffer): Map<string, string[][]>` — nome da aba →
  linhas (índice 0 = linha 1) → células como texto (`''` quando vazia), na
  ordem do workbook. `unzip(bytes: Buffer): Map<string, Buffer>`.
- Produces (testes): `buildXlsx(sheets, {deflate?})` e `zip(entries, {deflate?})`
  em `test/helpers/xlsx-fixture.js`. Célula `{ inline: 'texto' }` vira
  `inlineStr`.

- [ ] **Step 1: Escrever o helper de fixture**

```js
// test/helpers/xlsx-fixture.js
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal zip writer, enough to build the workbooks the reader tests read.
 *
 * @param {Array<[string, Buffer]>} entries
 * @param {{deflate?: boolean}} [options]
 */
export function zip(entries, options = {}) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = options.deflate ? deflateRawSync(raw) : raw;
    const method = options.deflate ? 8 : 0;
    const checksum = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** @param {unknown} text */
function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** @param {number} index zero-based column */
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * @typedef {string | number | null | {inline: string}} FixtureCell
 * @param {Array<{name: string, rows: FixtureCell[][]}>} sheets
 * @param {{deflate?: boolean}} [options]
 */
export function buildXlsx(sheets, options = {}) {
  /** @type {string[]} */
  const strings = [];
  /** @type {Map<string, number>} */
  const indexOf = new Map();
  /** @param {string} text */
  const shared = (text) => {
    if (!indexOf.has(text)) {
      indexOf.set(text, strings.length);
      strings.push(text);
    }
    return indexOf.get(text);
  };
  /** @param {FixtureCell} value @param {string} ref */
  const cell = (value, ref) => {
    if (value === null || value === '') return '';
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value === 'object') {
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value.inline)}</t></is></c>`;
    }
    return `<c r="${ref}" t="s"><v>${shared(value)}</v></c>`;
  };
  const sheetXml = sheets.map(
    ({ rows }) =>
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((value, c) => cell(value, `${columnName(c)}${r + 1}`))
              .join('')}</row>`,
        )
        .join('')}</sheetData></worksheet>`,
  );
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map(
      (sheet, i) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('')}</sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_sheet, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')}</Relationships>`;
  // Built after the sheets, so every string they use is registered.
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
    .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
    .join('')}</sst>`;
  return zip(
    [
      ['xl/workbook.xml', Buffer.from(workbook)],
      ['xl/_rels/workbook.xml.rels', Buffer.from(relationships)],
      ...sheetXml.map(
        (xml, i) =>
          /** @type {[string, Buffer]} */ ([
            `xl/worksheets/sheet${i + 1}.xml`,
            Buffer.from(xml),
          ]),
      ),
      ['xl/sharedStrings.xml', Buffer.from(sharedStrings)],
    ],
    options,
  );
}
```

- [ ] **Step 2: Escrever os testes que falham**

```js
// test/xlsx-reader.test.js
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/xlsx-reader.test.js`
Expected: FAIL com `Cannot find module '.../scripts/lib/xlsx-reader.mjs'`

- [ ] **Step 4: Implementar o leitor**

```js
// scripts/lib/xlsx-reader.mjs
import { inflateRawSync } from 'node:zlib';

// Just enough of the Office Open XML spreadsheet format to read the option
// sheet this repo imports: cell text only, no styles and no formula
// evaluation (a formula cell yields its cached value, or '' without one).

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
});

/**
 * @param {Buffer} bytes
 * @returns {Map<string, Buffer>}
 */
export function unzip(bytes) {
  let end = -1;
  const floor = Math.max(0, bytes.length - 65_557);
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (bytes.readUInt32LE(at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) {
    throw new Error('Not a zip file: end of central directory not found');
  }
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(at) !== DIRECTORY_ENTRY) {
      throw new Error('Corrupt zip: bad central directory entry');
    }
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    if (bytes.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error(`Corrupt zip: bad local header for ${name}`);
    }
    const dataStart =
      localOffset +
      30 +
      bytes.readUInt16LE(localOffset + 26) +
      bytes.readUInt16LE(localOffset + 28);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported zip compression ${method} in ${name}`);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** @param {string} text */
function decodeXml(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu,
    (_match, /** @type {string} */ code) => {
      if (code.startsWith('#x') || code.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#'))
        return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[
        /** @type {keyof typeof ENTITIES} */ (code.toLowerCase())
      ];
    },
  );
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`, 'u').exec(tag);
  return match ? decodeXml(match[1]) : null;
}

/** Every `<t>` run of a string item, joined (rich text keeps its words). @param {string} xml */
function texts(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)]
    .map((match) => decodeXml(match[1]))
    .join('');
}

/** @param {string} xml */
function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/gu)].map((match) =>
    texts(match[1] ?? ''),
  );
}

/** @param {string} xml */
function parseRelationships(xml) {
  return new Map(
    [...xml.matchAll(/<Relationship\b[^>]*>/gu)].map(([tag]) => [
      attribute(tag, 'Id') ?? '',
      attribute(tag, 'Target') ?? '',
    ]),
  );
}

/** @param {string} xml @param {Map<string, string>} relationships */
function parseWorkbook(xml, relationships) {
  return [...xml.matchAll(/<sheet\b[^>]*>/gu)].map(([tag]) => {
    const name = attribute(tag, 'name');
    const id = attribute(tag, 'r:id');
    const target = id ? relationships.get(id) : undefined;
    if (!name || !target) {
      throw new Error(`Workbook sheet without name or target: ${tag}`);
    }
    return {
      name,
      path: target.startsWith('/') ? target.slice(1) : `xl/${target}`,
    };
  });
}

/** @param {string} reference e.g. `AB12` */
function columnIndex(reference) {
  let index = 0;
  for (const char of /^[A-Z]+/u.exec(reference)?.[0] ?? '') {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** @param {string | null} type @param {string} content @param {string[]} shared */
function cellText(type, content, shared) {
  if (type === 'inlineStr') return texts(content);
  const value = /<v>([\s\S]*?)<\/v>/u.exec(content)?.[1];
  if (value === undefined) return '';
  if (type === 's') return shared[Number(value)] ?? '';
  return decodeXml(value);
}

/** @param {string} xml @param {string[]} shared @returns {string[][]} */
function parseSheet(xml, shared) {
  /** @type {string[][]} */
  const rows = [];
  for (const [, rowTag, body = ''] of xml.matchAll(
    /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu,
  )) {
    const rowIndex = Number(attribute(rowTag, 'r')) - 1;
    /** @type {string[]} */
    const cells = [];
    for (const [, cellTag, content = ''] of body.matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu,
    )) {
      const reference = attribute(cellTag, 'r');
      const column = reference ? columnIndex(reference) : cells.length;
      cells[column] = cellText(attribute(cellTag, 't'), content, shared);
    }
    rows[rowIndex] = Array.from(cells, (value) => value ?? '');
  }
  return Array.from(rows, (row) => row ?? []);
}

/**
 * @param {Buffer} bytes an .xlsx file
 * @returns {Map<string, string[][]>} sheet name → rows (index 0 is row 1) →
 *   cell text, in workbook order
 */
export function readXlsx(bytes) {
  const files = unzip(bytes);
  /** @param {string} path */
  const text = (path) => {
    const file = files.get(path);
    if (!file) throw new Error(`Missing ${path} in workbook`);
    return file.toString('utf8');
  };
  const shared = parseSharedStrings(
    files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '',
  );
  const relationships = parseRelationships(text('xl/_rels/workbook.xml.rels'));
  /** @type {Map<string, string[][]>} */
  const sheets = new Map();
  for (const { name, path } of parseWorkbook(
    text('xl/workbook.xml'),
    relationships,
  )) {
    sheets.set(name, parseSheet(text(path), shared));
  }
  return sheets;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/xlsx-reader.test.js`
Expected: PASS (3 testes)

- [ ] **Step 6: Conferir contra a planilha real**

Run:

```bash
node -e "import('./scripts/lib/xlsx-reader.mjs').then(async ({readXlsx}) => { const s = readXlsx(await (await import('node:fs/promises')).readFile(process.argv[1])); console.log([...s.keys()].join(' | ')); console.log(s.get('02 Produtos')[3]); })" "G:/Meu Drive/Silmer/005-lista-de-opcoes-para-aprovacao.xlsx"
```

Expected: nomes das 20 abas (`00 Instruções | Resumo | 01 Ficha de pedido | 02 Produtos | …`) e
`[ 'Manter', 'Aprovado', 'Vestuário superior', 'Camiseta', 'CAMISETA', 'Adulto, Infantil, Plus size, Bebê', '' ]`.

- [ ] **Step 7: Gate e commit**

Run: `node --test test/xlsx-reader.test.js && npm run lint && npm run typecheck`

```bash
git add scripts/lib/xlsx-reader.mjs test/helpers/xlsx-fixture.js test/xlsx-reader.test.js
git commit -m "feat(scripts): read xlsx sheets without dependencies" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Lê a planilha real e as fixtures (stored e deflate)
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(scripts): read xlsx sheets without dependencies`

---

### T03: Campos, checagem estrutural e importação do catálogo

- **What:** definir os campos do item, a checagem `assertOrderCatalog`, o script
  que transforma a planilha no arquivo gerado, e gerar o arquivo real.
- **Where:** `modules/orders/src/catalog/{text,fields,types,validate}.js`, `scripts/import-order-catalog.mjs`, `modules/orders/src/catalog/order-catalog.data.js`, `package.json`, `test/order-catalog-import.test.js`
- **Depends on:** T02
- **Requirement:** CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, CAT-06

**Files:**

- Create: `modules/orders/src/catalog/text.js`
- Create: `modules/orders/src/catalog/fields.js`
- Create: `modules/orders/src/catalog/types.js`
- Create: `modules/orders/src/catalog/validate.js`
- Create: `scripts/import-order-catalog.mjs`
- Create (gerado): `modules/orders/src/catalog/order-catalog.data.js`
- Modify: `package.json` (script `catalog:import`)
- Test: `test/order-catalog-import.test.js`

**Interfaces:**

- Consumes: `readXlsx` (T02).
- Produces: `foldText(value: unknown): string`; `FIELDS: readonly FieldDefinition[]`
  e `NOT_APPLICABLE = 'NAO APLICAVEL'` (`fields.js`); typedef `OrderCatalog`
  (`types.js`); `assertOrderCatalog(catalog: any): void`;
  `buildOrderCatalog(sheets: Map<string, string[][]>, source: {file: string, sha256: string}): OrderCatalog`;
  `renderCatalogModule(catalog: OrderCatalog): Promise<string>`.
- `FieldDefinition = { id, label, header, path, kind: 'text'|'multi'|'composite', list, colorList?, placement: 'header'|'grid'|'wide', addLabel? }`.
- Ids de lista: `modelagens, golas, mangas, malhas, cores, acabamentos, aberturas, bolsos, cos, faces, fixacoes, locais`.

- [ ] **Step 1: Escrever `text.js`, `fields.js` e `types.js`**

```js
// modules/orders/src/catalog/text.js
/**
 * Text as the catalog compares it: no accents, lower case, and every run of
 * punctuation or spaces as one space ("Azul-marinho" = "AZUL MARINHO").
 *
 * @param {unknown} value
 */
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
```

```js
// modules/orders/src/catalog/fields.js
// The item fields of the ficha (design → Campos do item). The option sheet
// decides which of them a product has and what they are called there; this
// file decides where each one lives in the stored item and on the paper.

// The value the ficha stores when a part does not exist on the garment (PFI-07).
export const NOT_APPLICABLE = 'NAO APLICAVEL';

/**
 * @typedef {{
 *   id: string, label: string, header: string, path: string,
 *   kind: 'text'|'multi'|'composite', list: string, colorList?: string,
 *   placement: 'header'|'grid'|'wide', addLabel?: string,
 * }} FieldDefinition
 */

/** @type {readonly FieldDefinition[]} */
export const FIELDS = Object.freeze(
  /** @type {FieldDefinition[]} */ ([
    {
      id: 'modelagem',
      label: 'Modelagem',
      header: 'Modelagem',
      path: 'modelo',
      kind: 'text',
      list: 'modelagens',
      placement: 'header',
    },
    {
      id: 'gola',
      label: 'Gola/decote',
      header: 'Gola/decote',
      path: 'specs.gola',
      kind: 'text',
      list: 'golas',
      placement: 'header',
    },
    {
      id: 'manga',
      label: 'Manga',
      header: 'Manga',
      path: 'specs.manga',
      kind: 'text',
      list: 'mangas',
      placement: 'header',
    },
    {
      id: 'malha',
      label: 'Malha',
      header: 'Malha/tecido',
      path: 'malhas',
      kind: 'multi',
      list: 'malhas',
      placement: 'grid',
      addLabel: 'Adicionar malha',
    },
    {
      id: 'cor_frente',
      label: 'Cor frente',
      header: 'Cor frente',
      path: 'cor_frente',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'cor_costas',
      label: 'Cor costas',
      header: 'Cor costas',
      path: 'cor_costas',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'cor_manga_direita',
      label: 'Cor manga direita',
      header: 'Cor manga direita',
      path: 'cor_manga_direita',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'cor_manga_esquerda',
      label: 'Cor manga esquerda',
      header: 'Cor manga esquerda',
      path: 'cor_manga_esquerda',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'vies_gola',
      label: 'Viés gola',
      header: 'Acabamento gola (viés)',
      path: 'vies_gola',
      kind: 'composite',
      list: 'acabamentos',
      colorList: 'cores',
      placement: 'grid',
    },
    {
      id: 'vies_mangas',
      label: 'Viés mangas',
      header: 'Acabamento mangas/cavas (viés)',
      path: 'vies_mangas',
      kind: 'composite',
      list: 'acabamentos',
      colorList: 'cores',
      placement: 'grid',
    },
    {
      id: 'abertura',
      label: 'Abertura/fechamento',
      header: 'Abertura/fechamento',
      path: 'specs.abertura',
      kind: 'text',
      list: 'aberturas',
      placement: 'grid',
    },
    {
      id: 'bolso',
      label: 'Bolso',
      header: 'Bolso',
      path: 'specs.bolso',
      kind: 'text',
      list: 'bolsos',
      placement: 'grid',
    },
    {
      id: 'cos',
      label: 'Cós/cintura',
      header: 'Cós/cintura',
      path: 'specs.cos',
      kind: 'text',
      list: 'cos',
      placement: 'grid',
    },
    {
      id: 'faces',
      label: 'Faces',
      header: 'Faces',
      path: 'specs.faces',
      kind: 'text',
      list: 'faces',
      placement: 'grid',
    },
    {
      id: 'fixacao',
      label: 'Fixação/borda',
      header: 'Fixação/borda',
      path: 'specs.fixacao',
      kind: 'text',
      list: 'fixacoes',
      placement: 'grid',
    },
    {
      id: 'locais',
      label: 'Locais da aplicação',
      header: 'Locais da aplicação',
      path: 'specs.locais',
      kind: 'multi',
      list: 'locais',
      placement: 'wide',
      addLabel: 'Adicionar local',
    },
  ]).map((field) => Object.freeze(field)),
);
```

```js
// modules/orders/src/catalog/types.js
/**
 * @typedef {'required'|'optional'} FieldRule
 * @typedef {{ rule: FieldRule, label?: string }} ProductField
 * @typedef {{
 *   id: string, label: string, print: string, family: string,
 *   scales: string[], fields: Record<string, ProductField>,
 * }} CatalogProduct
 * @typedef {{
 *   value: string, label: string, group: string, products: string[],
 *   note?: string, swatch?: string,
 * }} CatalogOption
 * @typedef {{ id: string, label: string, sizes: string[], freeText: boolean }} CatalogScale
 * @typedef {{
 *   schemaVersion: 1,
 *   source: { file: string, sha256: string },
 *   products: CatalogProduct[],
 *   lists: Record<string, CatalogOption[]>,
 *   scales: CatalogScale[],
 *   applications: CatalogOption[],
 * }} OrderCatalog
 */
export {};
```

- [ ] **Step 2: Escrever `validate.js`**

```js
// modules/orders/src/catalog/validate.js
import { FIELDS } from './fields.js';

// CAT-06: the shape every generated catalog must have. The import script runs
// it before writing, and the contract test runs it on the versioned file.

const RULES = new Set(['required', 'optional']);
const FIELD_IDS = new Set(FIELDS.map((field) => field.id));
const LIST_IDS = new Set(
  FIELDS.flatMap((field) =>
    field.colorList ? [field.list, field.colorList] : [field.list],
  ),
);

/** @param {boolean} condition @param {string} message @returns {asserts condition} */
function check(condition, message) {
  if (!condition) throw new Error(`Catálogo inválido: ${message}`);
}

/** @param {unknown} value @returns {value is string} */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** @param {any} options @param {string} where @param {Set<string>} productIds */
function checkOptions(options, where, productIds) {
  check(Array.isArray(options), `${where} deve ser lista`);
  for (const option of options) {
    check(
      isText(option?.value) &&
        isText(option.label) &&
        typeof option.group === 'string',
      `${where}: opção malformada ${JSON.stringify(option)}`,
    );
    check(
      Array.isArray(option.products) &&
        option.products.every((/** @type {string} */ id) => productIds.has(id)),
      `${where}: ${option.value} com produto desconhecido`,
    );
    check(
      option.swatch === undefined || /^#[0-9a-f]{6}$/u.test(option.swatch),
      `${where}: ${option.value} com swatch inválido`,
    );
  }
}

/** @param {any} catalog */
export function assertOrderCatalog(catalog) {
  check(catalog?.schemaVersion === 1, 'schemaVersion deve ser 1');
  check(
    isText(catalog.source?.file) &&
      /^[0-9a-f]{64}$/u.test(String(catalog.source?.sha256)),
    'source precisa de file e sha256',
  );
  check(Array.isArray(catalog.scales), 'scales deve ser lista');
  /** @type {Set<string>} */
  const scaleIds = new Set();
  for (const scale of catalog.scales) {
    check(
      isText(scale?.id) && !scaleIds.has(scale.id),
      `escala com id inválido ou repetido: ${scale?.id}`,
    );
    scaleIds.add(scale.id);
    check(
      isText(scale.label) &&
        typeof scale.freeText === 'boolean' &&
        Array.isArray(scale.sizes) &&
        scale.sizes.every(isText),
      `escala ${scale.id} malformada`,
    );
  }
  check(Array.isArray(catalog.products), 'products deve ser lista');
  /** @type {Set<string>} */
  const productIds = new Set();
  for (const product of catalog.products) {
    check(
      isText(product?.id) && !productIds.has(product.id),
      `produto com id inválido ou repetido: ${product?.id}`,
    );
    productIds.add(product.id);
    check(
      isText(product.label) &&
        isText(product.print) &&
        typeof product.family === 'string',
      `produto ${product.id} sem label, print ou family`,
    );
    check(
      Array.isArray(product.scales) &&
        product.scales.every((/** @type {string} */ id) => scaleIds.has(id)),
      `produto ${product.id} com escala desconhecida`,
    );
    for (const [fieldId, setting] of Object.entries(product.fields ?? {})) {
      check(
        FIELD_IDS.has(fieldId),
        `produto ${product.id} com campo ${fieldId}`,
      );
      check(
        RULES.has(/** @type {any} */ (setting).rule),
        `produto ${product.id}.${fieldId} com regra inválida`,
      );
      const label = /** @type {any} */ (setting).label;
      check(
        label === undefined || isText(label),
        `produto ${product.id}.${fieldId} com rótulo vazio`,
      );
    }
  }
  check(
    catalog.lists !== null && typeof catalog.lists === 'object',
    'lists deve ser objeto',
  );
  for (const listId of LIST_IDS) {
    check(Array.isArray(catalog.lists[listId]), `lista ${listId} ausente`);
  }
  for (const [listId, options] of Object.entries(catalog.lists)) {
    check(LIST_IDS.has(listId), `lista desconhecida ${listId}`);
    checkOptions(options, listId, productIds);
  }
  checkOptions(catalog.applications, 'applications', productIds);
}
```

- [ ] **Step 3: Escrever os testes que falham**

```js
// test/order-catalog-import.test.js
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
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `node --test test/order-catalog-import.test.js`
Expected: FAIL com `Cannot find module '.../scripts/import-order-catalog.mjs'`

- [ ] **Step 5: Implementar o script**

```js
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
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test test/order-catalog-import.test.js`
Expected: PASS (7 testes)

- [ ] **Step 7: Registrar o script npm e gerar o catálogo real**

Em `package.json`, dentro de `"scripts"`, logo depois de `"build"`:

```json
    "catalog:import": "node scripts/import-order-catalog.mjs",
```

Run: `npm run catalog:import -- --from "G:/Meu Drive/Silmer/005-lista-de-opcoes-para-aprovacao.xlsx"`
Expected: `Catálogo gerado: 14 produtos, 62 opções, 4 escalas.` com a planilha
v2 sem nenhuma sugestão aprovada (as 85 linhas "Manter" das abas 04–16 menos
15 tamanhos, que viram escalas, 7 aplicações, que ficam em `applications`, e
"Sem manga", que vale para nenhum produto). Se a Silmer já aprovou sugestões,
os números sobem.

Run: `npm run catalog:import -- --from "G:/Meu Drive/Silmer/005-lista-de-opcoes-para-aprovacao.xlsx" --check`
Expected: `Catálogo em dia com a planilha.`

- [ ] **Step 8: Gate e commit**

Run: `node --test test/order-catalog-import.test.js test/xlsx-reader.test.js && npm run lint && npm run typecheck && npm run format:check`

```bash
git add modules/orders/src/catalog/ scripts/import-order-catalog.mjs package.json test/order-catalog-import.test.js
git commit -m "feat(orders): import the order catalog from the approved sheet" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] `order-catalog.data.js` gerado da planilha real, com cabeçalho "GERADO"
- [ ] `--check` confirma o arquivo em dia
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): import the order catalog from the approved sheet`

---

### T04: Resolvedor do catálogo

- **What:** funções puras que respondem "quais campos, rótulos, sugestões e
  escalas este produto tem" e "como este item se descreve".
- **Where:** `modules/orders/src/catalog/index.js`, `test/order-catalog-contract.test.js`, `test/order-catalog-resolver.test.js`
- **Depends on:** T03
- **Requirement:** CAT-06, FIT-02, FIT-03, FIT-05, FGR-01

**Files:**

- Create: `modules/orders/src/catalog/index.js`
- Test: `test/order-catalog-contract.test.js`
- Test: `test/order-catalog-resolver.test.js`

**Interfaces:**

- Consumes: `FIELDS`, `NOT_APPLICABLE`, `foldText`, `order-catalog.data.js` (T03).
- Produces:
  - `ORDER_CATALOG: OrderCatalog` (congelado)
  - `resolveProduct(tipo: unknown): CatalogProduct | null`
  - `itemFields(product: CatalogProduct | null): ItemField[]` — `ItemField = FieldDefinition & { rule: 'required'|'optional' }`, `label` já com o rótulo do produto
  - `fieldOptions(listId: string, productId: string | null): OptionGroup[]` — `OptionGroup = { label: string, options: CatalogOption[] }`
  - `productOptions(): OptionGroup[]`, `applicationOptions(): OptionGroup[]`
  - `scalesFor(product: CatalogProduct | null): CatalogScale[]`, `scaleById(id: string): CatalogScale | null`
  - `readField(item, field): string | string[]`
  - `describeItem(item): { product: CatalogProduct | null, cells: ItemCell[] }` — `ItemCell = { field: ItemField, value: string | string[], empty: boolean }`
  - `SPEC_KEYS: readonly string[]` (`gola`, `manga`, `abertura`, `bolso`, `cos`, `faces`, `fixacao`, `locais`)
  - reexporta `FIELDS`, `NOT_APPLICABLE`, `foldText`

Os testes usam o catálogo real (planilha v2): Camiseta, Camisa polo, Regata,
Bermuda e Boné são "Manter"; Gola polo vale só para Camisa polo; Regata tem
"Viés cavas"; Camiseta oferece Adulto, Infantil, Plus size e Bebê.

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/order-catalog-contract.test.js
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
```

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/order-catalog-contract.test.js test/order-catalog-resolver.test.js`
Expected: FAIL com `Cannot find module '.../modules/orders/src/catalog/index.js'`

- [ ] **Step 3: Implementar o resolvedor**

```js
// modules/orders/src/catalog/index.js
// The order catalog as both the server and the screen read it. Pure, and it
// imports nothing outside this folder: the frontend imports it too
// (scripts/check-boundaries.mjs holds that line).
import catalog from './order-catalog.data.js';
import { FIELDS, NOT_APPLICABLE } from './fields.js';
import { foldText } from './text.js';

export { FIELDS, NOT_APPLICABLE } from './fields.js';
export { foldText } from './text.js';

/**
 * @typedef {import('./types.js').CatalogProduct} CatalogProduct
 * @typedef {import('./types.js').CatalogOption} CatalogOption
 * @typedef {import('./types.js').CatalogScale} CatalogScale
 * @typedef {import('./types.js').FieldRule} FieldRule
 * @typedef {import('./fields.js').FieldDefinition & { rule: FieldRule }} ItemField
 * @typedef {{ label: string, options: CatalogOption[] }} OptionGroup
 * @typedef {{ field: ItemField, value: string | string[], empty: boolean }} ItemCell
 */

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const ORDER_CATALOG = deepFreeze(catalog);

/** @type {Map<string, CatalogProduct>} */
const PRODUCT_BY_NAME = new Map();
for (const product of ORDER_CATALOG.products) {
  PRODUCT_BY_NAME.set(foldText(product.label), product);
  PRODUCT_BY_NAME.set(foldText(product.print), product);
}
const SCALE_BY_ID = new Map(
  ORDER_CATALOG.scales.map((scale) => [scale.id, scale]),
);

/** Path of every `specs.*` field, e.g. `gola`, `locais`. */
export const SPEC_KEYS = Object.freeze(
  FIELDS.filter((field) => field.path.startsWith('specs.')).map((field) =>
    field.path.slice('specs.'.length),
  ),
);

/** FIT-02 @param {unknown} tipo @returns {CatalogProduct | null} */
export function resolveProduct(tipo) {
  const key = foldText(tipo);
  return key === '' ? null : (PRODUCT_BY_NAME.get(key) ?? null);
}

/**
 * FIT-02/FIT-03: the fields of the item in catalog order, with the product's
 * rule and label; a product outside the catalog gets every field, optional.
 *
 * @param {CatalogProduct | null} product
 * @returns {ItemField[]}
 */
export function itemFields(product) {
  return FIELDS.flatMap((field) => {
    if (!product)
      return [{ ...field, rule: /** @type {FieldRule} */ ('optional') }];
    const setting = product.fields[field.id];
    return setting
      ? [{ ...field, label: setting.label ?? field.label, rule: setting.rule }]
      : [];
  });
}

/** @param {readonly CatalogOption[]} options @returns {OptionGroup[]} */
function grouped(options) {
  /** @type {Map<string, CatalogOption[]>} */
  const groups = new Map();
  for (const option of options) {
    const group = groups.get(option.group) ?? [];
    group.push(option);
    groups.set(option.group, group);
  }
  return [...groups].map(([label, entries]) => ({ label, options: entries }));
}

/** FIT-05 @param {string} listId @param {string | null} productId @returns {OptionGroup[]} */
export function fieldOptions(listId, productId) {
  const options = ORDER_CATALOG.lists[listId] ?? [];
  return grouped(
    options.filter(
      (option) =>
        productId === null ||
        option.products.length === 0 ||
        option.products.includes(productId),
    ),
  );
}

/** FIT-01: products by family, offered as their printed name. @returns {OptionGroup[]} */
export function productOptions() {
  return grouped(
    ORDER_CATALOG.products.map((product) => ({
      value: product.print,
      label: product.label,
      group: product.family,
      products: [],
    })),
  );
}

/** @returns {OptionGroup[]} */
export function applicationOptions() {
  return grouped(ORDER_CATALOG.applications);
}

/** FGR-01 @param {CatalogProduct | null} product @returns {CatalogScale[]} */
export function scalesFor(product) {
  if (!product) return [...ORDER_CATALOG.scales];
  return product.scales.flatMap((id) => {
    const scale = SCALE_BY_ID.get(id);
    return scale ? [scale] : [];
  });
}

/** @param {string} id @returns {CatalogScale | null} */
export function scaleById(id) {
  return SCALE_BY_ID.get(id) ?? null;
}

/**
 * The value of a field in a stored item; an item saved before the catalog
 * has no `specs`, which reads as empty (FIM-07).
 *
 * @param {Record<string, any>} item
 * @param {{path: string, kind: string}} field
 * @returns {string | string[]}
 */
export function readField(item, field) {
  const [head, key] = field.path.split('.');
  const value = key === undefined ? item[head] : item[head]?.[key];
  if (field.kind === 'multi')
    return Array.isArray(value) ? value.map(String) : [];
  return typeof value === 'string' ? value : '';
}

/**
 * The item as reading, the banner and the paper see it. "Não aplicável" is
 * empty for a catalog product (F14): the catalog already says what is missing.
 *
 * @param {Record<string, any>} item
 * @returns {{ product: CatalogProduct | null, cells: ItemCell[] }}
 */
export function describeItem(item) {
  const product = resolveProduct(item.tipo);
  const cells = itemFields(product).map((field) => {
    const raw = readField(item, field);
    const value = Array.isArray(raw)
      ? raw.map((entry) => entry.trim()).filter((entry) => entry !== '')
      : raw.trim();
    const empty = Array.isArray(value)
      ? value.length === 0
      : value === '' || (product !== null && value === NOT_APPLICABLE);
    return { field, value, empty };
  });
  return { product, cells };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/order-catalog-contract.test.js test/order-catalog-resolver.test.js`
Expected: PASS (9 testes)

- [ ] **Step 5: Gate e commit**

Run: `node --test test/order-catalog-contract.test.js test/order-catalog-resolver.test.js && npm run lint && npm run typecheck`

```bash
git add modules/orders/src/catalog/index.js test/order-catalog-contract.test.js test/order-catalog-resolver.test.js
git commit -m "feat(orders): resolve item fields and options from the catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Contrato e resolvedor passam sobre o catálogo real
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): resolve item fields and options from the catalog`

---

### T05: Item da ficha com `specs`, `escala` e `outras`

- **What:** aceitar e validar os campos novos do item; zerar os campos que o
  produto não tem (FIT-04); padrões para item antigo e para o briefing.
- **Where:** `modules/orders/src/domain/ficha.js`, `test/orders-ficha.test.js`
- **Depends on:** T04
- **Requirement:** FIT-04, FIT-09, FGR-05, F10, F15

**Files:**

- Modify: `modules/orders/src/domain/ficha.js`
- Test: `test/orders-ficha.test.js`

**Interfaces:**

- Consumes: `FIELDS`, `ORDER_CATALOG`, `SPEC_KEYS`, `itemFields`, `resolveProduct` (T04).
- Produces: `FichaItem` com `specs: Record<string, string | string[]>`,
  `escala: string`, `outras: string`; `validateItems` devolve sempre os três;
  `NOT_APPLICABLE` continua exportado de `ficha.js`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `test/orders-ficha.test.js`)

```js
test('an item keeps its catalog specs, scale and other specifications (F10)', () => {
  const [saved] = validateItems([
    item({
      tipo: 'CAMISETA',
      specs: {
        gola: ' CARECA ',
        manga: 'RAGLAN CURTA',
        locais: ['COSTAS TOTAL', ''],
      },
      escala: 'adulto',
      outras: ' Recorte lateral ',
    }),
  ]);

  assert.deepEqual(saved.specs, {
    gola: 'CARECA',
    manga: 'RAGLAN CURTA',
    locais: ['COSTAS TOTAL'],
  });
  assert.equal(saved.escala, 'adulto');
  assert.equal(saved.outras, 'Recorte lateral');
});

test('an item saved before the catalog reads with empty specs (F15)', () => {
  const [saved] = validateItems([item()]);
  assert.deepEqual(saved.specs, {});
  assert.equal(saved.escala, '');
  assert.equal(saved.outras, '');
});

test('refuses a spec, a scale or other specifications the ficha does not know', () => {
  /** @param {string} path */
  const refused = (path) => (/** @type {any} */ error) => {
    assert.equal(error.name, 'OrderInputError');
    assert.deepEqual(error.fields, [path]);
    return true;
  };
  assert.throws(
    () => validateItems([item({ specs: { capuz: 'SIM' } })]),
    refused('items[0].specs.capuz'),
  );
  assert.throws(
    () => validateItems([item({ specs: { locais: 'COSTAS' } })]),
    refused('items[0].specs.locais'),
  );
  assert.throws(
    () => validateItems([item({ escala: 'gigante' })]),
    refused('items[0].escala'),
  );
  assert.throws(
    () => validateItems([item({ outras: 'x'.repeat(501) })]),
    refused('items[0].outras'),
  );
});

test('stores empty the fields the product does not have (FIT-04)', () => {
  const [saved] = validateItems([
    item({
      tipo: 'BERMUDA',
      cor_manga_direita: 'BRANCA',
      vies_gola: 'VERDE',
      specs: { gola: 'CARECA', cos: 'ELÁSTICO' },
    }),
  ]);

  assert.equal(saved.cor_manga_direita, '');
  assert.equal(saved.vies_gola, '');
  assert.deepEqual(saved.specs, { cos: 'ELÁSTICO' });
  assert.deepEqual(saved.malhas, synthetic.pedido.itens[0].malhas);
});

test('keeps every field of a product outside the catalog (F07)', () => {
  const [saved] = validateItems([
    item({
      tipo: 'CAMISA DE TIME',
      cor_manga_direita: NOT_APPLICABLE,
      specs: { faces: '1 FACE' },
    }),
  ]);
  assert.equal(saved.cor_manga_direita, NOT_APPLICABLE);
  assert.deepEqual(saved.specs, { faces: '1 FACE' });
});

test('the agent briefing seeds the new item keys empty', () => {
  const ficha = briefingToFicha({ product_type: 'CAMISETA' });
  assert.deepEqual(ficha.items[0].specs, {});
  assert.equal(ficha.items[0].escala, '');
  assert.equal(ficha.items[0].outras, '');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/orders-ficha.test.js`
Expected: FAIL — `saved.specs` é `undefined` e `items[0].specs is not allowed`.

- [ ] **Step 3: Implementar**

Em `modules/orders/src/domain/ficha.js`:

1. Trocar a primeira linha e a constante `NOT_APPLICABLE`:

```js
import {
  FIELDS,
  ORDER_CATALOG,
  SPEC_KEYS,
  itemFields,
  resolveProduct,
} from '../catalog/index.js';
import { OrderInputError, OrderValidationError } from './errors.js';

// The ficha mirrors the approved printed blocks (D10): summary, items with
// their grade, and up to five observation lines. Anything the agent collected
// that has no place on the printed document stays as service data (D11). Which
// item fields exist, and what they are called, comes from the order catalog
// (ADR 007).

export { NOT_APPLICABLE } from '../catalog/fields.js';
export const MAX_OBSERVATIONS = 5;
const MAX_ITEMS = 50;
const MAX_TEXT = 200;
const MAX_OTHER_SPECS = 500;
```

(apague a linha antiga `export const NOT_APPLICABLE = 'NAO APLICAVEL';` e o
comentário de cabeçalho antigo que ela substitui)

2. Trocar `ITEM_KEYS` e acrescentar o conjunto das chaves múltiplas:

```js
const ITEM_KEYS = new Set([
  ...ITEM_TEXT_KEYS,
  'malhas',
  'grade',
  'specs',
  'escala',
  'outras',
]);
const MULTI_SPEC_KEYS = new Set(
  FIELDS.filter(
    (field) => field.kind === 'multi' && field.path.startsWith('specs.'),
  ).map((field) => field.path.slice('specs.'.length)),
);
```

3. No typedef, trocar o bloco `FichaItem` por:

```js
 * @typedef {Record<string, string | string[]>} FichaSpecs
 * @typedef {{
 *   tipo: string, modelo: string, malhas: string[],
 *   cor_frente: string, cor_costas: string,
 *   cor_manga_direita: string, cor_manga_esquerda: string,
 *   vies_gola: string, vies_mangas: string,
 *   specs: FichaSpecs, escala: string, outras: string,
 *   grade: GradeLine[],
 * }} FichaItem
```

4. No fim de `validateItem`, trocar `return /** @type {FichaItem} */ (item);` por:

```js
  item.specs = validateSpecs(raw.specs, prefix);
  item.escala = validateScale(raw.escala, prefix);
  item.outras = validateOtherSpecs(raw.outras, prefix);
  return clearMissingFields(/** @type {FichaItem} */ (item));
}

/** @param {unknown} value @param {string} prefix @returns {FichaSpecs} */
function validateSpecs(value, prefix) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new OrderInputError(`${prefix}.specs must be an object`, [
      `${prefix}.specs`,
    ]);
  }
  /** @type {FichaSpecs} */
  const specs = {};
  for (const [key, entry] of Object.entries(value)) {
    const path = `${prefix}.specs.${key}`;
    if (!SPEC_KEYS.includes(key)) {
      throw new OrderInputError(`${path} is not a catalog field`, [path]);
    }
    if (MULTI_SPEC_KEYS.has(key)) {
      if (!Array.isArray(entry)) {
        throw new OrderInputError(`${path} must be a list`, [path]);
      }
      const values = entry
        .map((text) => requireText(text, path))
        .filter((text) => text !== '');
      if (values.length > 0) specs[key] = values;
      continue;
    }
    const text = requireText(entry, path);
    if (text !== '') specs[key] = text;
  }
  return specs;
}

/** FGR-05 @param {unknown} value @param {string} prefix */
function validateScale(value, prefix) {
  if (value === undefined || value === '') return '';
  if (
    typeof value !== 'string' ||
    !ORDER_CATALOG.scales.some((scale) => scale.id === value)
  ) {
    throw new OrderInputError(`${prefix}.escala is not a catalog scale`, [
      `${prefix}.escala`,
    ]);
  }
  return value;
}

/** FIT-09 @param {unknown} value @param {string} prefix */
function validateOtherSpecs(value, prefix) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > MAX_OTHER_SPECS) {
    throw new OrderInputError(
      `${prefix}.outras must be text up to ${MAX_OTHER_SPECS} characters`,
      [`${prefix}.outras`],
    );
  }
  return value.trim();
}

/**
 * FIT-04: a field the product does not have is stored empty, so a value typed
 * before the seller changed the type never reaches the paper. Fabrics stay:
 * every item needs one, and no catalog product goes without.
 *
 * @param {FichaItem} item
 * @returns {FichaItem}
 */
function clearMissingFields(item) {
  const product = resolveProduct(item.tipo);
  if (!product) return item;
  const kept = new Set(itemFields(product).map((field) => field.id));
  for (const field of FIELDS) {
    if (kept.has(field.id) || field.id === 'malha') continue;
    const [head, key] = field.path.split('.');
    if (key === undefined) {
      /** @type {Record<string, unknown>} */ (item)[head] = '';
    } else {
      delete item.specs[key];
    }
  }
  return item;
}
```

(o `}` que fechava `validateItem` agora fecha logo depois do novo `return`;
confira que não sobrou chave a mais)

5. Em `briefingToFicha`, no objeto do item, acrescentar entre `cor_manga_esquerda` e `grade`:

```js
          escala: '',
```

e entre `modelo` e `tipo`:

```js
          outras: '',
          specs: {},
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/orders-ficha.test.js test/orders-service-commands.test.js test/orders-service-create.test.js`
Expected: PASS (inclui os testes antigos: o item sintético, `CAMISA`, está fora do catálogo e continua igual)

- [ ] **Step 5: Gate e commit**

Run: `node --test test/orders-*.test.js test/order-*.test.js && npm run lint && npm run typecheck`

```bash
git add modules/orders/src/domain/ficha.js test/orders-ficha.test.js
git commit -m "feat(orders): store catalog specs, scale and notes on ficha items" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Item novo guarda `specs`, `escala`, `outras`; item antigo lê com padrões
- [ ] Campo que o produto não tem é gravado vazio
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): store catalog specs, scale and notes on ficha items`

---

### T06: Faltantes por produto

- **What:** o banner lista só os campos "Sim" vazios de produto do catálogo;
  fora do catálogo, nada muda.
- **Where:** `modules/orders/src/domain/order.js`, `test/orders-domain.test.js`
- **Depends on:** T05
- **Requirement:** FMI-01, FMI-02, FMI-03

**Files:**

- Modify: `modules/orders/src/domain/order.js`
- Test: `test/orders-domain.test.js`

**Interfaces:**

- Consumes: `describeItem` (T04).
- Produces: entradas de faltantes no formato `items[<i>].<path>`, por exemplo
  `items[0].specs.cos`, `items[0].modelo`, `items[0].grade`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `test/orders-domain.test.js`)

```js
/** @param {Record<string, any>} overrides */
function bermudaOrder(overrides = {}) {
  const order = pendingOrder();
  order.ficha.items = [
    {
      ...order.ficha.items[0],
      tipo: 'BERMUDA',
      modelo: '',
      cor_manga_direita: '',
      vies_gola: '',
      specs: {},
      escala: '',
      outras: '',
      ...overrides,
    },
  ];
  return order;
}

test('lists only what the catalog product requires (FMI-01)', () => {
  const missing = missingForConfirmation(bermudaOrder());

  assert.ok(missing.includes('items[0].modelo'));
  assert.ok(missing.includes('items[0].specs.cos'));
  assert.ok(!missing.includes('items[0].cor_manga_direita'));
  assert.ok(!missing.includes('items[0].vies_gola'));
  assert.ok(!missing.includes('items[0].specs.bolso'));
});

test('keeps the full list for a product outside the catalog (FMI-02)', () => {
  const order = pendingOrder();
  order.ficha.items = [
    { ...order.ficha.items[0], tipo: 'KIT', cor_costas: '' },
  ];
  assert.ok(missingForConfirmation(order).includes('items[0].cor_costas'));
});

test('an empty required field never blocks confirming (FMI-03)', () => {
  const confirmed = confirmOrder(bermudaOrder(), {
    actorId: 'seller-1',
    amountCents: 10_000,
    now: CONFIRMED_AT,
    paymentCondition: 'pix',
  });
  assert.equal(confirmed.status, 'confirmado');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/orders-domain.test.js`
Expected: FAIL — a lista traz `items[0].cor_manga_direita` e não traz `items[0].specs.cos`.

- [ ] **Step 3: Implementar**

Em `modules/orders/src/domain/order.js`, acrescentar o import no topo:

```js
import { describeItem } from '../catalog/index.js';
```

e trocar o `items.forEach(...)` de `missingForConfirmation` por:

```js
items.forEach((item, index) => {
  const { cells, product } = describeItem(item);
  if (product) {
    // FMI-01: only what this product requires; optional fields never nag.
    for (const cell of cells) {
      if (cell.field.rule === 'required' && cell.empty) {
        missing.push(`items[${index}].${cell.field.path}`);
      }
    }
    if (item.grade.length === 0) missing.push(`items[${index}].grade`);
    return;
  }
  // FMI-02: a product outside the catalog keeps the full list.
  for (const key of ITEM_FIELD_ORDER) {
    const value = item[/** @type {keyof typeof item} */ (key)];
    if (value === '' || (Array.isArray(value) && value.length === 0)) {
      missing.push(`items[${index}].${key}`);
    }
  }
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/orders-domain.test.js test/orders-service-read.test.js`
Expected: PASS

- [ ] **Step 5: Gate e commit**

Run: `node --test test/orders-*.test.js test/order-*.test.js && npm run lint && npm run typecheck`

```bash
git add modules/orders/src/domain/order.js test/orders-domain.test.js
git commit -m "feat(orders): list missing fields by what the product requires" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Produto do catálogo: só "Sim" vazio no banner
- [ ] Fora do catálogo e confirmação sem mudança
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): list missing fields by what the product requires`

---

### T07: Snapshot e template de impressão v3

- **What:** mover o snapshot da rota para o módulo, criar a v3 e escolher o
  template por `PRINT_TEMPLATE` (ainda v2).
- **Where:** `modules/orders/src/print/{print-snapshot,ficha-canonical-v3,index}.js`, `modules/orders/src/index.js`, `apps/api/src/order-routes.js`, `test/orders-print-v3.test.js`
- **Depends on:** T05
- **Requirement:** FIM-01, FIM-02, FIM-03, FIM-04, FIM-05, FIM-06, FIM-07, FIM-08

**Files:**

- Create: `modules/orders/src/print/print-snapshot.js`
- Create: `modules/orders/src/print/ficha-canonical-v3.js`
- Create: `modules/orders/src/print/index.js`
- Modify: `modules/orders/src/index.js`
- Modify: `apps/api/src/order-routes.js`
- Test: `test/orders-print-v3.test.js`

**Interfaces:**

- Consumes: `describeItem`, `scaleById` (T04); `itemTotal` (`ficha.js`);
  `blankProduction`, `renderFichaHtml` (v2, sem mudança).
- Produces: `TEMPLATE_V2`, `TEMPLATE_V3`; `printSnapshot(order, templateVersion = TEMPLATE_V2)`;
  `printableItem(item)` → `{ tipo, subtitulo, especificacoes: {rotulo, valor}[], linhas: {rotulo, valor}[], gradeTitulo, grade, total }`;
  `renderFichaHtmlV3(snapshot, {synthetic?})`; `PRINT_TEMPLATE: string`;
  `renderOrderFicha(order): string`.

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/orders-print-v3.test.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderFichaHtml } from '../modules/orders/src/print/ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from '../modules/orders/src/print/ficha-canonical-v3.js';
import {
  PRINT_TEMPLATE,
  renderOrderFicha,
} from '../modules/orders/src/print/index.js';
import {
  TEMPLATE_V2,
  TEMPLATE_V3,
  printSnapshot,
  printableItem,
} from '../modules/orders/src/print/print-snapshot.js';

const synthetic = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

const camiseta = {
  tipo: 'CAMISETA',
  modelo: 'TRADICIONAL',
  malhas: ['PP DRY'],
  cor_frente: 'BRANCO',
  cor_costas: 'BRANCO',
  cor_manga_direita: 'AZUL ROYAL',
  cor_manga_esquerda: 'AZUL ROYAL',
  vies_gola: 'RIBANA · AZUL ROYAL',
  vies_mangas: '',
  specs: {
    gola: 'CARECA',
    manga: 'RAGLAN CURTA',
    locais: ['COSTAS TOTAL', 'MANGA DIREITA'],
  },
  escala: 'adulto',
  outras: 'Recorte lateral',
  grade: [
    { tamanho: 'P', quantidade: 4 },
    { tamanho: 'M', quantidade: 6 },
  ],
};
const bermuda = {
  tipo: 'BERMUDA',
  modelo: 'ESPORTIVA',
  malhas: ['PP LISO'],
  cor_frente: 'PRETO',
  cor_costas: 'PRETO',
  cor_manga_direita: 'NAO APLICAVEL',
  cor_manga_esquerda: 'NAO APLICAVEL',
  vies_gola: 'NAO APLICAVEL',
  vies_mangas: 'BRANCO',
  specs: { cos: 'ELÁSTICO' },
  escala: 'infantil',
  outras: '',
  grade: [{ tamanho: 'P', quantidade: 3 }],
};

/** @param {any[]} items */
function order(items) {
  return {
    confirmedBy: { name: 'Vendedora Um' },
    fabCode: '01',
    ficha: {
      items,
      observations: ['Separar por tamanho.'],
      summary: {
        aplicacao: 'SUBLIMAÇÃO TOTAL',
        cliente: 'Cliente Sintetico',
        data_entrega_confirmada: '30/10/2026',
        nome: 'Equipe Sintetica',
      },
    },
    number: '01-CRM',
    orderDate: '2026-09-24',
    totalPieces: 13,
  };
}

test('prints the header as type plus modelagem, gola and manga (FIM-02)', () => {
  const printed = printableItem(camiseta);
  assert.equal(printed.tipo, 'CAMISETA');
  assert.equal(printed.subtitulo, 'TRADICIONAL · CARECA · RAGLAN CURTA');
  assert.equal(printed.total, 10);
});

test('prints only the fields the product has and someone filled (FIM-01, FIM-03)', () => {
  const printed = printableItem(bermuda);
  const labels = printed.especificacoes.map((spec) => spec.rotulo);

  assert.ok(labels.includes('Cós/cintura'));
  assert.ok(labels.includes('Viés barra/lateral'));
  assert.ok(!labels.some((label) => /manga direita|Viés gola/u.test(label)));
  assert.ok(
    !printed.especificacoes.some((spec) => spec.valor === 'NAO APLICAVEL'),
  );
});

test('prints the locations and the other specifications on their own lines (FIM-04)', () => {
  assert.deepEqual(printableItem(camiseta).linhas, [
    { rotulo: 'Locais da aplicação', valor: 'COSTAS TOTAL / MANGA DIREITA' },
    { rotulo: 'Outras especificações', valor: 'Recorte lateral' },
  ]);
});

test('names the scale above the grade when it is not the adult one (FIM-05)', () => {
  assert.equal(printableItem(camiseta).gradeTitulo, 'Grade');
  assert.equal(printableItem(bermuda).gradeTitulo, 'Grade · Infantil');
});

test('prints an item saved before the catalog without losing a field (FIM-07)', () => {
  const printed = printableItem(synthetic.pedido.itens[0]);
  const values = printed.especificacoes.map((spec) => spec.valor);

  assert.equal(printed.subtitulo, 'TRADICIONAL');
  assert.ok(values.includes('BRANCA'));
  assert.ok(values.includes('OLIMPICA - VERDE'));
});

test('keeps the production page identical to v2 (FIM-06)', () => {
  const v2 = renderFichaHtml(printSnapshot(order([camiseta]), TEMPLATE_V2), {
    synthetic: false,
  });
  const v3 = renderFichaHtmlV3(printSnapshot(order([camiseta]), TEMPLATE_V3), {
    synthetic: false,
  });
  /** @param {string} html */
  const production = (html) =>
    html.slice(html.indexOf('<section class="page-break">'));

  assert.equal(production(v3), production(v2));
});

test('renders the v3 item card with the product labels', () => {
  const html = renderFichaHtmlV3(
    printSnapshot(order([camiseta, bermuda]), TEMPLATE_V3),
    {
      synthetic: false,
    },
  );

  assert.match(html, /Viés barra\/lateral/u);
  assert.match(html, /Grade · Infantil/u);
  assert.match(html, /Locais da aplicação/u);
  assert.doesNotMatch(html, /NAO APLICAVEL|undefined|null/u);
});

test('prints on v2 until the v3 approval is recorded (FIM-08)', () => {
  assert.equal(PRINT_TEMPLATE, TEMPLATE_V2);
  assert.match(renderOrderFicha(order([camiseta])), /Vies gola \/ mangas/u);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/orders-print-v3.test.js`
Expected: FAIL com `Cannot find module '.../print/ficha-canonical-v3.js'`

- [ ] **Step 3: Criar `print-snapshot.js`**

```js
// modules/orders/src/print/print-snapshot.js
import { describeItem, scaleById } from '../catalog/index.js';
import { itemTotal } from '../domain/ficha.js';
import { blankProduction } from './ficha-canonical-v2.js';

export const TEMPLATE_V2 = 'ficha-canonical-v2';
export const TEMPLATE_V3 = 'ficha-canonical-v3';

/** A field nobody filled prints blank, never "null". @param {unknown} value */
function printedText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * The order date is stored as an ISO day in Sao Paulo time; the approved
 * template shows it the way the shop floor reads it.
 *
 * @param {unknown} value
 */
function printedDate(value) {
  const text = printedText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  return match ? match[3] + '/' + match[2] + '/' + match[1] : text;
}

/** @param {string | string[]} value */
function joined(value) {
  return Array.isArray(value) ? value.join(' / ') : value;
}

/**
 * FIM-01..05: the item as the v3 sheet prints it — only the fields the product
 * has and someone filled, under the product's own labels.
 *
 * @param {Record<string, any>} item
 */
export function printableItem(item) {
  const filled = describeItem(item).cells.filter((cell) => !cell.empty);
  /** @param {'header'|'grid'|'wide'} placement */
  const placed = (placement) =>
    filled.filter((cell) => cell.field.placement === placement);
  const scale = scaleById(String(item.escala ?? ''));
  const outras = printedText(item.outras).trim();
  return {
    tipo: printedText(item.tipo),
    subtitulo: placed('header')
      .map((cell) => joined(cell.value))
      .join(' · '),
    especificacoes: placed('grid').map((cell) => ({
      rotulo: cell.field.label,
      valor: joined(cell.value),
    })),
    linhas: [
      ...placed('wide').map((cell) => ({
        rotulo: cell.field.label,
        valor: joined(cell.value),
      })),
      ...(outras ? [{ rotulo: 'Outras especificações', valor: outras }] : []),
    ],
    gradeTitulo:
      scale && scale.id !== 'adulto' ? `Grade · ${scale.label}` : 'Grade',
    grade: item.grade,
    total: itemTotal(/** @type {any} */ (item)),
  };
}

/**
 * The printed snapshot built from the order (D10). `vendedor` is whoever
 * confirmed it and `data` is the order date: both are frozen at confirmation,
 * so passing the conversation on afterwards never rewrites the paper. The
 * final amount and the payment condition stay out of the document (D12), and
 * the production block reaches the shop floor blank.
 *
 * @param {any} order
 * @param {string} [templateVersion]
 */
export function printSnapshot(order, templateVersion = TEMPLATE_V2) {
  const { items, observations, summary } = order.ficha;
  return {
    pedido: {
      aplicacao: printedText(summary.aplicacao),
      cliente: printedText(summary.cliente),
      data: printedDate(order.orderDate),
      data_entrega_confirmada: printedText(summary.data_entrega_confirmada),
      fab: printedText(order.fabCode),
      itens: templateVersion === TEMPLATE_V3 ? items.map(printableItem) : items,
      nome: printedText(summary.nome),
      numero: printedText(order.number),
      observacoes: observations,
      quantidade_total: order.totalPieces,
      vendedor: printedText(order.confirmedBy?.name),
    },
    producao: blankProduction(),
  };
}
```

- [ ] **Step 4: Criar `ficha-canonical-v3.js` a partir da v2**

Run: `cp modules/orders/src/print/ficha-canonical-v2.js modules/orders/src/print/ficha-canonical-v3.js`

No arquivo **novo** (`ficha-canonical-v3.js`), aplicar estas trocas:

1. Trocar o comentário do topo e todo o bloco de `PRODUCTION_FIELDS` e
   `blankProduction` (do `// The approved` até o fim de `blankProduction`) por:

```js
// `ficha-canonical-v3` (ADR 007): the v2 document with the item card driven by
// the order catalog — only the fields the product has, under its own labels,
// the location and other specifications on full-width lines, and the scale
// named above the grade. Page 2 is byte for byte the v2 production control.
```

2. Trocar `export function renderFichaHtml(snapshot, options = {}) {` por
   `export function renderFichaHtmlV3(snapshot, options = {}) {`.

3. Trocar o bloco inteiro `const itemCards = snapshot.pedido.itens … .join('');`
   (o primeiro `.join('')` depois de `</article>`) por:

```js
const itemCards = snapshot.pedido.itens
  .map((/** @type {any} */ item, /** @type {number} */ itemIndex) => {
    const lines = item.linhas
      .map(
        (/** @type {any} */ line) =>
          `<div class="spec-wide"><dt>${display(line.rotulo)}</dt><dd>${display(line.valor)}</dd></div>`,
      )
      .join('');
    return `<article class="item-card">
        <div class="item-heading">
          <div><span class="eyebrow">Item ${display(itemIndex + 1)}</span><h3>${display(item.tipo)} <span>${display(item.subtitulo)}</span></h3></div>
          <div class="item-total"><strong>${display(item.total)}</strong><span>pecas</span></div>
        </div>
        <div class="item-body">
          <dl class="spec-grid">${item.especificacoes
            .map(
              (/** @type {any} */ spec) =>
                `<div><dt>${display(spec.rotulo)}</dt><dd>${display(spec.valor)}</dd></div>`,
            )
            .join('')}${lines}</dl>
          <div class="grade-block"><span class="grade-title">${display(item.gradeTitulo)}</span><div class="grade-list">${item.grade
            .map(
              (/** @type {any} */ grade) =>
                `<div class="grade-cell"><span>${display(grade.tamanho)}</span><strong>${display(grade.quantidade)}</strong></div>`,
            )
            .join('')}</div></div>
        </div>
      </article>`;
  })
  .join('');
```

4. Logo depois da linha CSS `.spec-grid div { … }`, acrescentar:

```css
.spec-grid .spec-wide {
  grid-column: 1 / -1;
  min-height: 0;
}
```

- [ ] **Step 5: Criar `print/index.js` e exportar do módulo**

```js
// modules/orders/src/print/index.js
import { renderFichaHtml } from './ficha-canonical-v2.js';
import { renderFichaHtmlV3 } from './ficha-canonical-v3.js';
import { TEMPLATE_V2, TEMPLATE_V3, printSnapshot } from './print-snapshot.js';

/**
 * FIM-08: the template every printed order uses. It moves to v3 in its own
 * commit (T15), only after Rose and Operação approve the v3 review PDF;
 * `npm run validate:ficha-v3-review` refuses v3 here without that approval.
 *
 * @type {string}
 */
export const PRINT_TEMPLATE = TEMPLATE_V2;

/** @param {any} order @returns {string} */
export function renderOrderFicha(order) {
  const snapshot = printSnapshot(order, PRINT_TEMPLATE);
  return PRINT_TEMPLATE === TEMPLATE_V3
    ? renderFichaHtmlV3(snapshot, { synthetic: false })
    : renderFichaHtml(snapshot, { synthetic: false });
}
```

Em `modules/orders/src/index.js`, trocar o bloco de export da v2 por:

```js
export {
  PRODUCTION_FIELDS,
  blankProduction,
  renderFichaHtml,
} from './print/ficha-canonical-v2.js';
export { renderFichaHtmlV3 } from './print/ficha-canonical-v3.js';
export { PRINT_TEMPLATE, renderOrderFicha } from './print/index.js';
export {
  TEMPLATE_V2,
  TEMPLATE_V3,
  printSnapshot,
  printableItem,
} from './print/print-snapshot.js';
```

- [ ] **Step 6: A rota passa a usar o módulo**

Em `apps/api/src/order-routes.js`:

1. Trocar `import { blankProduction, renderFichaHtml } from '@crm-silmer/orders';`
   por `import { renderOrderFicha } from '@crm-silmer/orders';`.
2. Trocar `.send(renderFichaHtml(printSnapshot(order), { synthetic: false }));`
   por `.send(renderOrderFicha(order));`.
3. Apagar as funções `printSnapshot`, `printedText` e `printedDate` do fim do
   arquivo (o JSDoc de cada uma junto). Antes, confirme que não há outro uso:

Run: `grep -n "printedText\|printedDate\|printSnapshot\|blankProduction" apps/api/src/order-routes.js`
Expected: nenhuma linha depois da remoção.

- [ ] **Step 7: Rodar e ver passar**

Run: `node --test test/orders-print-v3.test.js test/order-routes.test.js test/ficha-pdf-review.test.js && npm run validate:ficha-pdf-review`
Expected: PASS; `Ficha PDF review gate valid` (a v2 não mudou)

- [ ] **Step 8: Gate e commit**

Run: `node --test test/orders-*.test.js test/order-*.test.js && npm run lint && npm run typecheck && git diff --exit-code modules/orders/src/print/ficha-canonical-v2.js`

```bash
git add modules/orders/src/print/ modules/orders/src/index.js apps/api/src/order-routes.js test/orders-print-v3.test.js
git commit -m "feat(orders): add the product-driven ficha-canonical-v3 template" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] v3 imprime só o que vale para a peça; página 2 idêntica à v2
- [ ] Rota continua na v2; `ficha-canonical-v2.js` intacto
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): add the product-driven ficha-canonical-v3 template`

---

### T08: Pacote de revisão da v3 e gate de aprovação

- **What:** gerar o PDF sintético v3, registrar a aprovação como pendente e
  impedir `PRINT_TEMPLATE = v3` sem aprovação.
- **Where:** `scripts/ficha-v3-review.mjs`, `docs/phase0/ficha-pdf-synthetic-v3.json`, `docs/phase0/ficha-pdf-approval-v3.json`, `output/pdf/ficha-canonica-sintetica-v3.pdf`, `package.json`, `test/ficha-v3-review.test.js`
- **Depends on:** T07
- **Requirement:** FIM-08, FIM-09

**Files:**

- Create: `scripts/ficha-v3-review.mjs`
- Create: `docs/phase0/ficha-pdf-synthetic-v3.json`
- Create (gerado): `docs/phase0/ficha-pdf-approval-v3.json`, `output/pdf/ficha-canonica-sintetica-v3.pdf`
- Modify: `package.json`
- Test: `test/ficha-v3-review.test.js`

**Interfaces:**

- Consumes: `PRINT_TEMPLATE`, `TEMPLATE_V3`, `printSnapshot`, `renderFichaHtmlV3` (T07).
- Produces: `validateFichaV3Gate({gate, fixtureBytes, artifactBytes, printTemplate})`;
  scripts `generate:ficha-v3-review` e `validate:ficha-v3-review` (este no `validate`).

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/ficha-v3-review.test.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { validateFichaV3Gate } from '../scripts/ficha-v3-review.mjs';

const fixtureBytes = Buffer.from('{"number":"02-CRM"}');
const artifactBytes = Buffer.from('%PDF-1.7\n/Type /Page\n/Type /Page\n');
/** @param {Buffer} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {Record<string, any>} [approval] */
function gate(
  approval = { status: 'pending-human-approval', approved: false },
) {
  return {
    schemaVersion: 1,
    templateVersion: 'ficha-canonical-v3',
    fixtureSha256: sha256(fixtureBytes),
    artifact: {
      path: 'output/pdf/ficha-canonica-sintetica-v3.pdf',
      sha256: sha256(artifactBytes),
      pageCount: 2,
    },
    approval,
  };
}
const approved = {
  status: 'approved',
  approved: true,
  reviewedBy: { rose: 'Rose', operation: 'Operacao Silmer' },
  reviewedAt: '2026-10-01T10:00:00-03:00',
};

test('a pending package is valid while orders still print on v2', () => {
  assert.doesNotThrow(() =>
    validateFichaV3Gate({
      gate: gate(),
      fixtureBytes,
      artifactBytes,
      printTemplate: 'ficha-canonical-v2',
    }),
  );
});

test('refuses printing on v3 without the recorded approval (FIM-08)', () => {
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate(),
        fixtureBytes,
        artifactBytes,
        printTemplate: 'ficha-canonical-v3',
      }),
    /sem aprovação registrada/u,
  );
  assert.doesNotThrow(() =>
    validateFichaV3Gate({
      gate: gate(approved),
      fixtureBytes,
      artifactBytes,
      printTemplate: 'ficha-canonical-v3',
    }),
  );
});

test('refuses an approval without Rose, Operação and a date', () => {
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate({ ...approved, reviewedBy: { rose: 'Rose' } }),
        fixtureBytes,
        artifactBytes,
        printTemplate: 'ficha-canonical-v2',
      }),
    /Aprovação da v3 incompleta/u,
  );
});

test('refuses a PDF or fixture that changed after generation (FIM-09)', () => {
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate(),
        fixtureBytes,
        artifactBytes: Buffer.from('%PDF-1.7\n/Type /Page\n'),
        printTemplate: 'ficha-canonical-v2',
      }),
    /PDF v3 não confere/u,
  );
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate(),
        fixtureBytes: Buffer.from('{}'),
        artifactBytes,
        printTemplate: 'ficha-canonical-v2',
      }),
    /Fixture v3 mudou/u,
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/ficha-v3-review.test.js`
Expected: FAIL com `Cannot find module '.../scripts/ficha-v3-review.mjs'`

- [ ] **Step 3: Implementar o script**

```js
// scripts/ficha-v3-review.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'prettier';

import { renderFichaHtmlV3 } from '../modules/orders/src/print/ficha-canonical-v3.js';
import { PRINT_TEMPLATE } from '../modules/orders/src/print/index.js';
import {
  TEMPLATE_V3,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const rootUrl = new URL('../', import.meta.url);
const fixtureUrl = new URL('docs/phase0/ficha-pdf-synthetic-v3.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval-v3.json', rootUrl);
const ARTIFACT_PATH = 'output/pdf/ficha-canonica-sintetica-v3.pdf';

/** @param {Buffer | string} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {Buffer} bytes */
function countPdfPages(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length;
}

/**
 * FIM-08/FIM-09: the v3 review package matches what was generated, and v3
 * prints orders only once Rose and Operação approved it.
 *
 * @param {{gate: any, fixtureBytes: Buffer, artifactBytes: Buffer, printTemplate: string}} input
 */
export function validateFichaV3Gate({
  gate,
  fixtureBytes,
  artifactBytes,
  printTemplate,
}) {
  if (gate?.schemaVersion !== 1 || gate.templateVersion !== TEMPLATE_V3) {
    throw new Error('Registro da v3 com versão inesperada');
  }
  if (gate.fixtureSha256 !== sha256(fixtureBytes)) {
    throw new Error(
      'Fixture v3 mudou depois da geração do PDF; rode npm run generate:ficha-v3-review',
    );
  }
  if (
    gate.artifact?.path !== ARTIFACT_PATH ||
    gate.artifact.sha256 !== sha256(artifactBytes)
  ) {
    throw new Error('PDF v3 não confere com o registro');
  }
  if (
    artifactBytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    gate.artifact.pageCount < 2 ||
    gate.artifact.pageCount !== countPdfPages(artifactBytes)
  ) {
    throw new Error('PDF v3 inválido');
  }
  const approval = gate.approval ?? {};
  const approved =
    approval.status === 'approved' &&
    approval.approved === true &&
    Boolean(approval.reviewedBy?.rose) &&
    Boolean(approval.reviewedBy?.operation) &&
    Boolean(approval.reviewedAt);
  if (approval.status !== 'pending-human-approval' && !approved) {
    throw new Error(
      'Aprovação da v3 incompleta: precisa de Rose, Operação e data',
    );
  }
  if (printTemplate === TEMPLATE_V3 && !approved) {
    throw new Error(
      'PRINT_TEMPLATE usa a v3 sem aprovação registrada de Rose e Operação',
    );
  }
}

async function generate() {
  const { chromium } = await import('@playwright/test');
  const current = JSON.parse(
    await readFile(gateUrl, 'utf8').catch(() => 'null'),
  );
  if (current?.approval?.approved === true) {
    throw new Error(
      'A v3 aprovada não pode ser regerada; crie uma nova versão do template',
    );
  }
  const fixtureBytes = await readFile(fixtureUrl);
  const order = JSON.parse(fixtureBytes.toString('utf8'));
  const artifactUrl = new URL(ARTIFACT_PATH, rootUrl);
  await mkdir(dirname(fileURLToPath(artifactUrl)), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      renderFichaHtmlV3(printSnapshot(order, TEMPLATE_V3), { synthetic: true }),
      {
        waitUntil: 'load',
      },
    );
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      displayHeaderFooter: true,
      footerTemplate: `<div style="box-sizing:border-box;color:#657086;display:flex;font-family:Arial,sans-serif;font-size:7px;justify-content:space-between;padding:0 9mm;width:100%"><span>Template ${TEMPLATE_V3} | Snapshot synthetic-order-v2 | Ficha por produto</span><span>Pagina <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
      format: 'A4',
      headerTemplate: '<div></div>',
      landscape: true,
      path: fileURLToPath(artifactUrl),
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
  const artifactBytes = await readFile(artifactUrl);
  const gate = {
    schemaVersion: 1,
    templateVersion: TEMPLATE_V3,
    snapshotVersion: 'synthetic-order-v2',
    requirements: [
      'FIM-01',
      'FIM-02',
      'FIM-03',
      'FIM-04',
      'FIM-05',
      'FIM-06',
      'FIM-07',
      'FIM-08',
      'FIM-09',
    ],
    fixtureSha256: sha256(fixtureBytes),
    artifact: {
      path: ARTIFACT_PATH,
      sha256: sha256(artifactBytes),
      pageCount: countPdfPages(artifactBytes),
    },
    approval: {
      status: 'pending-human-approval',
      approved: false,
      reviewedBy: null,
      reviewedAt: null,
    },
    versioning: {
      supersedesTemplateVersion: 'ficha-canonical-v2',
      overwriteApprovedVersion: false,
    },
  };
  validateFichaV3Gate({
    gate,
    fixtureBytes,
    artifactBytes,
    printTemplate: PRINT_TEMPLATE,
  });
  await writeFile(
    gateUrl,
    await format(JSON.stringify(gate), { parser: 'json' }),
  );
  console.log(`PDF v3 pronto para revisão: ${ARTIFACT_PATH}`);
}

async function validate() {
  const gate = JSON.parse(await readFile(gateUrl, 'utf8'));
  validateFichaV3Gate({
    gate,
    fixtureBytes: await readFile(fixtureUrl),
    artifactBytes: await readFile(new URL(gate.artifact.path, rootUrl)),
    printTemplate: PRINT_TEMPLATE,
  });
  console.log(`Pacote de revisão da v3 válido: ${gate.approval.status}.`);
}

async function main() {
  const command = process.argv[2];
  if (command === '--generate') return generate();
  if (command === '--validate') return validate();
  throw new Error('Use --generate or --validate');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Revisão da ficha v3 falhou: ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/ficha-v3-review.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Escrever o pedido sintético da revisão**

```json
{
  "number": "02-CRM",
  "fabCode": "01",
  "orderDate": "2026-09-24",
  "totalPieces": 64,
  "confirmedBy": { "name": "Vendedora Exemplo" },
  "ficha": {
    "summary": {
      "cliente": "Cliente Demonstracao",
      "data_entrega_confirmada": "30/10/2026",
      "aplicacao": "SUBLIMAÇÃO TOTAL",
      "nome": "Equipe Horizonte - Evento Sintetico"
    },
    "observations": [
      "Arte final sintetica aprovada para teste visual.",
      "Nao usar este documento para producao ou cobranca."
    ],
    "items": [
      {
        "tipo": "CAMISETA",
        "modelo": "TRADICIONAL",
        "malhas": ["PP DRY"],
        "cor_frente": "AZUL MARINHO",
        "cor_costas": "AZUL MARINHO",
        "cor_manga_direita": "BRANCO",
        "cor_manga_esquerda": "BRANCO",
        "vies_gola": "RIBANA · VERDE BANDEIRA",
        "vies_mangas": "RIBANA · VERDE BANDEIRA",
        "specs": {
          "gola": "CARECA",
          "manga": "RAGLAN CURTA",
          "locais": ["COSTAS TOTAL", "OMBRO DIREITO"]
        },
        "escala": "adulto",
        "outras": "",
        "grade": [
          { "tamanho": "P", "quantidade": 4 },
          { "tamanho": "M", "quantidade": 8 },
          { "tamanho": "G", "quantidade": 6 },
          { "tamanho": "GG", "quantidade": 2 }
        ]
      },
      {
        "tipo": "REGATA",
        "modelo": "ESPORTIVA",
        "malhas": ["PP LISO"],
        "cor_frente": "BRANCO",
        "cor_costas": "BRANCO",
        "cor_manga_direita": "",
        "cor_manga_esquerda": "",
        "vies_gola": "VIÉS PRÓPRIO TECIDO",
        "vies_mangas": "VIÉS PRÓPRIO TECIDO",
        "specs": { "gola": "GOLA V" },
        "escala": "adulto",
        "outras": "",
        "grade": [
          { "tamanho": "P", "quantidade": 5 },
          { "tamanho": "M", "quantidade": 5 }
        ]
      },
      {
        "tipo": "BERMUDA",
        "modelo": "ESPORTIVA",
        "malhas": ["PP LISO"],
        "cor_frente": "PRETO",
        "cor_costas": "PRETO",
        "cor_manga_direita": "",
        "cor_manga_esquerda": "",
        "vies_gola": "",
        "vies_mangas": "BRANCO",
        "specs": { "cos": "ELÁSTICO" },
        "escala": "infantil",
        "outras": "",
        "grade": [
          { "tamanho": "P", "quantidade": 3 },
          { "tamanho": "M", "quantidade": 4 },
          { "tamanho": "G", "quantidade": 3 },
          { "tamanho": "GG", "quantidade": 2 }
        ]
      },
      {
        "tipo": "BONÉ",
        "modelo": "",
        "malhas": ["BRIM"],
        "cor_frente": "PRETO",
        "cor_costas": "PRETO",
        "cor_manga_direita": "",
        "cor_manga_esquerda": "",
        "vies_gola": "",
        "vies_mangas": "",
        "specs": { "abertura": "SNAP", "locais": ["BONÉ FRENTE"] },
        "escala": "",
        "outras": "Aba curva preta",
        "grade": [{ "tamanho": "ÚNICO", "quantidade": 22 }]
      }
    ]
  }
}
```

Salvar em `docs/phase0/ficha-pdf-synthetic-v3.json` e formatar:
`npx prettier --write docs/phase0/ficha-pdf-synthetic-v3.json`

- [ ] **Step 6: Registrar os scripts npm, gerar o PDF e validar**

Em `package.json`, dentro de `"scripts"`:

```json
    "generate:ficha-v3-review": "node scripts/ficha-v3-review.mjs --generate",
    "validate:ficha-v3-review": "node scripts/ficha-v3-review.mjs --validate",
```

e, em `"validate"`, trocar `npm run validate:ficha-pdf-review &&` por
`npm run validate:ficha-pdf-review && npm run validate:ficha-v3-review &&`.

Run: `npm run generate:ficha-v3-review && npm run validate:ficha-v3-review`
Expected: `PDF v3 pronto para revisão: output/pdf/ficha-canonica-sintetica-v3.pdf` e
`Pacote de revisão da v3 válido: pending-human-approval.`

Abra o PDF e confira: Bermuda sem mangas nem gola, Regata com "Viés cavas",
Boné com "Painel frontal"/"Regulagem", "Grade · Infantil" na bermuda, página 2
igual à v2.

- [ ] **Step 7: Gate e commit**

Run: `node --test test/ficha-v3-review.test.js && npm run lint && npm run typecheck && npm run format:check`

```bash
git add scripts/ficha-v3-review.mjs docs/phase0/ficha-pdf-synthetic-v3.json docs/phase0/ficha-pdf-approval-v3.json output/pdf/ficha-canonica-sintetica-v3.pdf package.json test/ficha-v3-review.test.js
git commit -m "feat(orders): package the v3 ficha for human review" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] PDF v3 gerado, registro `pending-human-approval` com hashes
- [ ] `npm run validate` roda o gate da v3
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): package the v3 ficha for human review`

---

### T09: Ponte do frontend para o catálogo

- **What:** o front passa a importar o resolvedor; funções puras do rascunho do
  item; rótulos do banner para `specs.*`; fronteira no `check:boundaries`.
- **Where:** `apps/edge-web/src/lib/order-catalog.js`, `apps/edge-web/src/lib/order-items.js`, `apps/edge-web/src/lib/order-format.js`, `scripts/check-boundaries.mjs`, `test/order-items.test.js`, `test/order-format.test.js`
- **Depends on:** T04
- **Requirement:** FIT-04, FIT-07, FGR-02, FMI-01 (rótulos)

**Files:**

- Modify: `apps/edge-web/src/lib/order-catalog.js`
- Create: `apps/edge-web/src/lib/order-items.js`
- Modify: `apps/edge-web/src/lib/order-format.js`
- Modify: `scripts/check-boundaries.mjs`
- Test: `test/order-items.test.js`, `test/order-format.test.js`

**Interfaces:**

- Consumes: resolvedor (T04).
- Produces: `lib/order-catalog.js` reexporta `FIELDS, NOT_APPLICABLE, ORDER_CATALOG, applicationOptions, describeItem, fieldOptions, foldText, itemFields, productOptions, readField, resolveProduct, scaleById, scalesFor` (as listas antigas continuam até a T13);
  `lib/order-items.js`: `draftItem(item)`, `emptyItem()`, `itemPayload(item)`,
  `splitComposite(value): [string, string]`, `joinComposite(finish, color): string`,
  `gradeForScale(grade, scale)`.

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/order-items.test.js
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
```

Em `test/order-format.test.js`, acrescentar:

```js
test('names catalog fields of an item in the banner (FMI-01)', () => {
  assert.deepEqual(
    missingFieldLabels(['items[0].specs.cos', 'items[1].modelo']),
    ['item 1: cós/cintura', 'item 2: modelagem'],
  );
});
```

e, nos testes existentes do mesmo arquivo, trocar `'item 1: modelo'` por
`'item 1: modelagem'` e `'Falta item 1: modelo'` por `'Falta item 1: modelagem'`
(F11: o campo passa a se chamar Modelagem).

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/order-items.test.js test/order-format.test.js`
Expected: FAIL — módulo `order-items.js` inexistente e rótulo `specs.cos` cru.

- [ ] **Step 3: Implementar**

No topo de `apps/edge-web/src/lib/order-catalog.js`, logo depois do comentário
de abertura, acrescentar:

```js
// ADR 007: the screen reads the same catalog resolver as the server. The old
// fixed lists below stay only until the datalists go away (T13).
export {
  FIELDS,
  NOT_APPLICABLE,
  ORDER_CATALOG,
  applicationOptions,
  describeItem,
  fieldOptions,
  foldText,
  itemFields,
  productOptions,
  readField,
  resolveProduct,
  scaleById,
  scalesFor,
} from '../../../../modules/orders/src/catalog/index.js';
```

Criar `apps/edge-web/src/lib/order-items.js`:

```js
import {
  FIELDS,
  foldText,
  itemFields,
  resolveProduct,
} from './order-catalog.js';

// Pure helpers for the item draft of the order page (ficha por produto).

const COMPOSITE_SEPARATOR = ' · ';
const CORE_TEXT_FIELDS = FIELDS.filter(
  (field) => !field.path.startsWith('specs.') && field.kind !== 'multi',
);

/**
 * A copy the form can edit; an item saved before the catalog gets the new
 * keys, and at least one fabric input.
 *
 * @param {Record<string, any>} item
 */
export function draftItem(item) {
  return {
    ...item,
    escala: typeof item.escala === 'string' ? item.escala : '',
    outras: typeof item.outras === 'string' ? item.outras : '',
    malhas:
      Array.isArray(item.malhas) && item.malhas.length > 0
        ? [...item.malhas]
        : [''],
    specs: { ...(item.specs ?? {}) },
    grade: (item.grade ?? []).map(
      (/** @type {Record<string, any>} */ line) => ({ ...line }),
    ),
  };
}

export function emptyItem() {
  return draftItem({
    cor_costas: '',
    cor_frente: '',
    cor_manga_direita: '',
    cor_manga_esquerda: '',
    grade: [{ quantidade: 1, tamanho: '' }],
    malhas: [''],
    modelo: '',
    tipo: '',
    vies_gola: '',
    vies_mangas: '',
  });
}

/**
 * What "Salvar itens" sends: fields the product lacks go empty (FIT-04),
 * grade lines left without a quantity are dropped (FGR-02), text is trimmed.
 *
 * @param {Record<string, any>} item
 */
export function itemPayload(item) {
  const kept = new Set(
    itemFields(resolveProduct(item.tipo)).map((field) => field.id),
  );
  /** @type {Record<string, string | string[]>} */
  const specs = {};
  for (const field of FIELDS) {
    if (!field.path.startsWith('specs.') || !kept.has(field.id)) continue;
    const key = field.path.slice('specs.'.length);
    const value = item.specs?.[key];
    if (field.kind === 'multi') {
      const values = (Array.isArray(value) ? value : [])
        .map((entry) => String(entry).trim())
        .filter((entry) => entry !== '');
      if (values.length > 0) specs[key] = values;
    } else if (String(value ?? '').trim() !== '') {
      specs[key] = String(value).trim();
    }
  }
  /** @type {Record<string, string>} */
  const core = {};
  for (const field of CORE_TEXT_FIELDS) {
    core[field.path] = kept.has(field.id) ? String(item[field.path] ?? '') : '';
  }
  return {
    ...core,
    tipo: String(item.tipo ?? ''),
    malhas: (item.malhas ?? [])
      .map((/** @type {unknown} */ malha) => String(malha).trim())
      .filter((/** @type {string} */ malha) => malha !== ''),
    specs,
    escala: String(item.escala ?? ''),
    outras: String(item.outras ?? '').trim(),
    grade: (item.grade ?? [])
      .filter(
        (/** @type {Record<string, any>} */ line) =>
          String(line.quantidade ?? '').trim() !== '',
      )
      .map((/** @type {Record<string, any>} */ line) => ({
        quantidade: Number(line.quantidade),
        tamanho: String(line.tamanho).trim(),
      })),
  };
}

/**
 * F12: "RIBANA · VERDE" is a finish and a colour; an older free text stays
 * whole in the finish.
 *
 * @param {unknown} value
 * @returns {[string, string]}
 */
export function splitComposite(value) {
  const text = String(value ?? '');
  const at = text.indexOf(COMPOSITE_SEPARATOR);
  return at < 0
    ? [text, '']
    : [text.slice(0, at), text.slice(at + COMPOSITE_SEPARATOR.length)];
}

/** @param {string} finish @param {string} color */
export function joinComposite(finish, color) {
  return [finish.trim(), color.trim()]
    .filter((part) => part !== '')
    .join(COMPOSITE_SEPARATOR);
}

/**
 * FGR-02: picking a scale adds one line per size the grade does not have yet,
 * with no quantity; a line without a size is replaced.
 *
 * @param {Array<Record<string, any>>} grade
 * @param {{sizes: readonly string[]}} scale
 */
export function gradeForScale(grade, scale) {
  const kept = grade.filter((line) => String(line.tamanho ?? '').trim() !== '');
  const present = new Set(kept.map((line) => foldText(line.tamanho)));
  return [
    ...kept,
    ...scale.sizes
      .filter((size) => !present.has(foldText(size)))
      .map((size) => ({ quantidade: '', tamanho: size })),
  ];
}
```

Em `apps/edge-web/src/lib/order-format.js`:

1. Acrescentar ao topo: `import { FIELDS } from './order-catalog.js';`
2. Em `ITEM_LABELS`, trocar `modelo: 'modelo',` por `modelo: 'modelagem',`.
3. Em `missingFieldLabel`, trocar o bloco `const item = /^items…` por:

```js
const item = /^items\[(\d+)\]\.([\w.]+)$/u.exec(field);
if (item) {
  const known =
    ITEM_LABELS[/** @type {keyof typeof ITEM_LABELS} */ (item[2])] ??
    FIELDS.find((entry) => entry.path === item[2])?.label.toLocaleLowerCase(
      'pt-BR',
    );
  return `item ${Number(item[1]) + 1}: ${known ?? item[2]}`;
}
```

Em `scripts/check-boundaries.mjs`, antes da linha final `console.log(...)`:

```js
// ADR 007: the order catalog is the one module folder the frontend shares with
// the server — plain data and pure functions — and it imports nothing else.
const moduleImport = /from\s+['"]((?:\.\.\/)+modules\/[^'"]+)['"]/gu;
for (const path of await listFrontendSources(
  resolve(root, 'apps/edge-web/src'),
)) {
  const source = await readFile(path, 'utf8');
  for (const [, target] of source.matchAll(moduleImport)) {
    assert.match(
      target,
      /modules\/orders\/src\/catalog\/[\w.-]+\.js$/u,
      `${path} imports ${target}; only modules/orders/src/catalog/ is shared with the frontend`,
    );
  }
}
for (const path of await listFrontendSources(
  resolve(root, 'modules/orders/src/catalog'),
)) {
  const source = await readFile(path, 'utf8');
  for (const [, target] of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
    assert.match(
      target,
      /^\.\/[\w.-]+\.js$/u,
      `${path} must only import files of its own folder`,
    );
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/order-items.test.js test/order-format.test.js && npm run check:boundaries`
Expected: PASS; `Module and frontend boundaries are valid.`

- [ ] **Step 5: Gate e commit**

Run: `node --test test/order-items.test.js test/order-format.test.js test/order-catalog.test.js && npm run lint && npm run typecheck && npm run build`

```bash
git add apps/edge-web/src/lib/ scripts/check-boundaries.mjs test/order-items.test.js test/order-format.test.js
git commit -m "feat(edge-web): read the order catalog and shape item drafts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Front compila importando o resolvedor (`npm run build`)
- [ ] Fronteira verificada no `check:boundaries`
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(edge-web): read the order catalog and shape item drafts`

---

### T10: Combobox com grupos (e Aplicação)

- **What:** combobox ARIA editável com sugestões agrupadas e filtradas; primeiro
  uso no campo Aplicação do Resumo.
- **Where:** `apps/edge-web/src/components/order/OrderCombobox.vue`, `OrderSummarySection.vue`, `apps/edge-web/src/screen-styles.css`, `test/e2e/orders.spec.js`
- **Depends on:** T09
- **Requirement:** F08, F21, FIT-05, FIT-06

**Files:**

- Create: `apps/edge-web/src/components/order/OrderCombobox.vue`
- Modify: `apps/edge-web/src/components/order/OrderSummarySection.vue`
- Modify: `apps/edge-web/src/screen-styles.css`
- Test: `test/e2e/orders.spec.js`

**Interfaces:**

- Consumes: `applicationOptions`, `foldText` (T09).
- Produces: `<OrderCombobox id v-model groups aria-label? aria-describedby? invalid? disabled? />`
  — `groups: {label: string, options: {value: string, label: string, swatch?: string}[]}[]`;
  emite `update:modelValue` com o texto digitado ou com o `value` escolhido.

- [ ] **Step 1: Escrever os testes e2e que falham** (acrescentar em `test/e2e/orders.spec.js`)

```js
test('suggests catalog applications in groups and keeps what is typed (F08, F21)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  const field = summary.getByRole('combobox', { name: 'Aplicação' });
  await field.fill('dt');
  await expect(summary.getByRole('listbox')).toBeVisible();
  await expect(
    summary.getByRole('option', { name: /DTF/u }).first(),
  ).toBeVisible();
  await field.press('ArrowDown');
  await field.press('Enter');
  await expect(field).toHaveValue('DTF');
  await expect(field).toHaveAttribute('aria-expanded', 'false');

  const results = await new AxeBuilder({ page }).include('form').analyze();
  expect(results.violations).toEqual([]);

  await summary.getByRole('button', { name: 'Salvar' }).click();
  expect(writes[0].body.value.aplicacao).toBe('DTF');
});

test('keeps an application the catalog does not know (F08)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  const field = summary.getByRole('combobox', { name: 'Aplicação' });
  await field.fill('SILK 3 CORES');
  await field.press('Escape');
  await summary.getByRole('button', { name: 'Salvar' }).click();

  expect(writes[0].body.value.aplicacao).toBe('SILK 3 CORES');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:e2e -- test/e2e/orders.spec.js -g "applications|application the catalog"`
Expected: FAIL — não existe `combobox` com nome "Aplicação" (o campo é `input` com `datalist`).

- [ ] **Step 3: Criar o combobox**

```vue
<!-- apps/edge-web/src/components/order/OrderCombobox.vue -->
<script setup>
import { computed, ref } from 'vue';
import { foldText } from '../../lib/order-catalog.js';
import OrderIcon from './OrderIcon.vue';

// ARIA 1.2 editable combobox with list autocomplete (F21). The list only
// suggests: whatever is typed stays the value (F08). The list is named
// "Sugestões", not after the field, so a label finds the input alone.
const props = defineProps({
  id: { type: String, required: true },
  modelValue: { type: String, default: '' },
  groups: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: '' },
  ariaDescribedby: { type: String, default: '' },
  invalid: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const filter = ref('');
const active = ref(-1);

/** @typedef {{value: string, label: string, swatch?: string}} Option */

const shown = computed(() => {
  const wanted = foldText(filter.value);
  return /** @type {{label: string, options: Option[]}[]} */ (props.groups)
    .map((group) => ({
      label: group.label,
      options: group.options.filter(
        (option) =>
          wanted === '' ||
          foldText(option.value).includes(wanted) ||
          foldText(option.label).includes(wanted),
      ),
    }))
    .filter((group) => group.options.length > 0);
});
const flat = computed(() => shown.value.flatMap((group) => group.options));
const listId = computed(() => `${props.id}-list`);
const expanded = computed(() => open.value && flat.value.length > 0);
const activeId = computed(() =>
  expanded.value && active.value >= 0
    ? `${props.id}-option-${active.value}`
    : undefined,
);

/** @param {Option} option */
function indexOf(option) {
  return flat.value.indexOf(option);
}

function close() {
  open.value = false;
  active.value = -1;
}

/** @param {boolean} fromTyping */
function show(fromTyping) {
  if (!fromTyping) filter.value = '';
  open.value = true;
}

/** @param {Event} event */
function onInput(event) {
  const value = /** @type {HTMLInputElement} */ (event.target).value;
  emit('update:modelValue', value);
  filter.value = value;
  active.value = -1;
  open.value = true;
}

/** @param {Option} option */
function pick(option) {
  emit('update:modelValue', option.value);
  close();
}

/** @param {number} delta */
function move(delta) {
  if (!open.value) show(false);
  const count = flat.value.length;
  if (count === 0) return;
  if (active.value < 0) active.value = delta > 0 ? 0 : count - 1;
  else active.value = (active.value + delta + count) % count;
}

/** @param {KeyboardEvent} event */
function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter' && expanded.value && active.value >= 0) {
    // Enter picks the highlighted option instead of submitting the form.
    event.preventDefault();
    pick(flat.value[active.value]);
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    close();
  }
}

function toggle() {
  if (open.value) close();
  else show(false);
}
</script>

<template>
  <div class="op-combo">
    <input
      :id="id"
      type="text"
      role="combobox"
      autocomplete="off"
      autocapitalize="characters"
      aria-autocomplete="list"
      :aria-expanded="expanded ? 'true' : 'false'"
      :aria-controls="listId"
      :aria-activedescendant="activeId"
      :aria-label="ariaLabel || undefined"
      :aria-describedby="ariaDescribedby || undefined"
      :aria-invalid="invalid || undefined"
      :value="modelValue"
      :disabled="disabled"
      @input="onInput"
      @keydown="onKeydown"
      @blur="close"
    />
    <button
      type="button"
      class="op-combo-toggle"
      tabindex="-1"
      :disabled="disabled"
      @mousedown.prevent
      @click="toggle"
    >
      <OrderIcon name="chevron" />
      <span class="op-visually-hidden">Mostrar sugestões</span>
    </button>
    <div
      v-show="expanded"
      :id="listId"
      role="listbox"
      class="op-combo-list"
      aria-label="Sugestões"
    >
      <div
        v-for="(group, groupIndex) in shown"
        :key="group.label"
        role="group"
        :aria-labelledby="`${id}-group-${groupIndex}`"
      >
        <div
          :id="`${id}-group-${groupIndex}`"
          role="presentation"
          class="op-combo-group"
        >
          {{ group.label }}
        </div>
        <div
          v-for="option in group.options"
          :id="`${id}-option-${indexOf(option)}`"
          :key="option.value"
          role="option"
          class="op-combo-option"
          :aria-selected="indexOf(option) === active ? 'true' : 'false'"
          @mousedown.prevent="pick(option)"
        >
          <span
            v-if="option.swatch"
            class="op-swatch"
            :style="{ background: option.swatch }"
            aria-hidden="true"
          ></span>
          <span>{{ option.value }}</span>
          <small
            v-if="foldText(option.label) !== foldText(option.value)"
            class="op-combo-note"
            >{{ option.label }}</small
          >
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: CSS do combobox** (acrescentar em `apps/edge-web/src/screen-styles.css`, logo depois de `.op-combo:has(input:disabled) > .op-icon { … }`)

```css
.op-combo-toggle {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  display: grid;
  inline-size: 2.4rem;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.op-combo:focus-within > .op-combo-toggle {
  color: var(--color-focus);
}

.op-combo-toggle:disabled {
  display: none;
}

.op-combo-list {
  position: absolute;
  z-index: 20;
  inset-block-start: calc(100% + 0.25rem);
  inset-inline: 0;
  max-block-size: 16rem;
  overflow-y: auto;
  padding-block: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.op-combo-group {
  padding: 0.45rem 0.75rem 0.2rem;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.op-combo-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.75rem;
  font-size: var(--text-sm);
  cursor: pointer;
}

.op-combo-option[aria-selected='true'],
.op-combo-option:hover {
  background: var(--color-surface-active);
}

.op-combo-note {
  margin-inline-start: auto;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
```

- [ ] **Step 5: Usar no Resumo**

Em `OrderSummarySection.vue`:

1. Acrescentar aos imports:

```js
import { applicationOptions } from '../../lib/order-catalog.js';
import OrderCombobox from './OrderCombobox.vue';
```

e, logo depois de `const SECTION = 'summary';`:

```js
const APPLICATION_OPTIONS = applicationOptions();
```

2. Trocar o bloco do campo Aplicação (`<div class="op-combo">` … `</div>` que
   contém `id="summary-aplicacao"`) por:

```vue
<OrderCombobox
  id="summary-aplicacao"
  v-model="draft.aplicacao"
  :groups="APPLICATION_OPTIONS"
/>
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:e2e -- test/e2e/orders.spec.js`
Expected: PASS (todos, inclusive os dois novos)

- [ ] **Step 7: Gate e commit**

Run: `npm run lint && npm run typecheck && npm run check:design-tokens && npm run build`

```bash
git add apps/edge-web/src/components/order/OrderCombobox.vue apps/edge-web/src/components/order/OrderSummarySection.vue apps/edge-web/src/screen-styles.css test/e2e/orders.spec.js
git commit -m "feat(edge-web): suggest catalog options in a grouped combobox" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Aplicação sugere por grupo, filtra, aceita texto livre, passa axe
- [ ] Gates e2e e quick passam

**Tests:** e2e · **Gate:** e2e + quick · **Commit:** `feat(edge-web): suggest catalog options in a grouped combobox`

---

### T11: Card do item conforme o produto

- **What:** Tipo primeiro; campos do produto com rótulos e sugestões; viés em
  duas partes; locais múltiplos; outras especificações; leitura só do que foi
  preenchido.
- **Where:** `apps/edge-web/src/components/order/OrderSpecField.vue`, `OrderItemsSection.vue`, `screen-styles.css`, `test/e2e/orders.spec.js`
- **Depends on:** T10
- **Requirement:** FIT-01, FIT-02, FIT-03, FIT-04, FIT-05, FIT-06, FIT-07, FIT-08, FIT-09, FIT-10, FIT-11, F14

**Files:**

- Create: `apps/edge-web/src/components/order/OrderSpecField.vue`
- Modify: `apps/edge-web/src/components/order/OrderItemsSection.vue`
- Modify: `apps/edge-web/src/screen-styles.css`
- Test: `test/e2e/orders.spec.js`

**Interfaces:**

- Consumes: `OrderCombobox` (T10); `describeItem`, `fieldOptions`, `itemFields`,
  `productOptions`, `readField`, `resolveProduct`, `colorSwatch`, `NOT_APPLICABLE`;
  `draftItem`, `emptyItem`, `itemPayload`, `joinComposite`, `splitComposite` (T09).
- Produces: `<OrderSpecField :field :model-value :product-id :input-id :allow-not-applicable @update:model-value />`.
  Nomes acessíveis: campo `text` → `<label>` com o rótulo; `multi` → `"<rótulo> <n>"`
  e botão `field.addLabel`; `composite` → grupo com o rótulo e comboboxes
  `"<rótulo>: acabamento"` / `"<rótulo>: cor"`; checkbox `"<rótulo> não se aplica"`.

- [ ] **Step 1: Escrever os testes e2e que falham** (acrescentar em `test/e2e/orders.spec.js`)

```js
/** @param {import('@playwright/test').Locator} items @param {string} tipo */
async function chooseTipo(items, tipo) {
  const field = items.getByRole('combobox', { name: 'Tipo' });
  await field.fill(tipo);
  await field.press('Escape');
}

test('shows only the fields of the chosen product, with its labels (FIT-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await chooseTipo(items, 'BERMUDA');
  await expect(items.getByLabel('Cós/cintura')).toBeVisible();
  await expect(
    items.getByRole('group', { name: 'Viés barra/lateral' }),
  ).toBeVisible();
  await expect(items.getByLabel('Cor manga direita')).toHaveCount(0);
  await expect(items.getByLabel('Manga', { exact: true })).toHaveCount(0);

  await chooseTipo(items, 'CAMISETA');
  await expect(items.getByLabel('Cor manga direita')).toBeVisible();
  await expect(items.getByLabel('Manga', { exact: true })).toBeVisible();
});

test('warns about a product outside the catalog and shows every field (FIT-03)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await chooseTipo(items, 'CAMISA DE TIME');

  await expect(items).toContainText('Produto fora do catálogo');
  await expect(items.getByLabel('Cós/cintura')).toBeVisible();
  await expect(items.getByLabel('Faces')).toBeVisible();
});

test('sends empty the fields the new product does not have (FIT-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await chooseTipo(items, 'BERMUDA');
  await items.getByRole('button', { name: 'Salvar' }).click();

  const [saved] = writes[0].body.value;
  expect(saved.tipo).toBe('BERMUDA');
  expect(saved.cor_manga_direita).toBe('');
  expect(saved.vies_gola).toBe('');
});

test('writes the finish and the colour of the viés as one text (FIT-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Viés gola: acabamento').fill('RIBANA');
  await items.getByLabel('Viés gola: cor').fill('VERDE');
  await items.getByLabel('Viés gola: cor').press('Escape');
  await items.getByRole('button', { name: 'Salvar' }).click();

  expect(writes[0].body.value[0].vies_gola).toBe('RIBANA · VERDE');
});

test('keeps several application places and the other specifications (FIT-08, FIT-09)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Locais da aplicação 1').fill('COSTAS TOTAL');
  await items.getByLabel('Locais da aplicação 1').press('Escape');
  await items.getByRole('button', { name: 'Adicionar local' }).click();
  await items.getByLabel('Locais da aplicação 2').fill('MANGA DIREITA');
  await items.getByLabel('Locais da aplicação 2').press('Escape');
  await items.getByLabel('Outras especificações').fill('Recorte lateral');
  await items.getByRole('button', { name: 'Salvar' }).click();

  const [saved] = writes[0].body.value;
  expect(saved.specs.locais).toEqual(['COSTAS TOTAL', 'MANGA DIREITA']);
  expect(saved.outras).toBe('Recorte lateral');
});

test('reads an item with only the fields its product has (FIT-11)', async ({
  page,
}) => {
  const bermudaOrder = JSON.parse(JSON.stringify(pendingOrder));
  bermudaOrder.ficha.items = [
    {
      ...bermudaOrder.ficha.items[0],
      tipo: 'BERMUDA',
      cor_manga_direita: 'NAO APLICAVEL',
      cor_manga_esquerda: 'NAO APLICAVEL',
      vies_gola: 'NAO APLICAVEL',
      specs: { cos: 'ELÁSTICO' },
      escala: '',
      outras: '',
    },
  ];
  await mockOrders(page, { orders: [confirmedOrder, bermudaOrder] });
  await page.goto('/pedidos/order-pendente');

  const card = page
    .getByRole('region', { name: 'Itens e especificações' })
    .getByRole('group')
    .first();
  await expect(card).toContainText('Cós/cintura');
  await expect(card).toContainText('ELÁSTICO');
  await expect(card).not.toContainText('NÃO APLICÁVEL');
  await expect(card).not.toContainText('Cor manga direita');
});
```

Trocar o teste existente `accepts "Não aplicável" on sleeves and viés (PFI-07)` por:

```js
test('accepts "Não aplicável" only on a product outside the catalog (PFI-07, F14)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByLabel('Cor manga direita não se aplica')).toHaveCount(
    0,
  );
  await chooseTipo(items, 'CAMISA DE TIME');
  await items.getByLabel('Cor manga direita não se aplica').check();
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items).toContainText('NÃO APLICÁVEL');
  expect(writes[0].body.value[0].cor_manga_direita).toBe('NAO APLICAVEL');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:e2e -- test/e2e/orders.spec.js -g "FIT-|PFI-07"`
Expected: FAIL — não há combobox "Tipo" nem campos por produto.

- [ ] **Step 3: Criar `OrderSpecField.vue`**

```vue
<!-- apps/edge-web/src/components/order/OrderSpecField.vue -->
<script setup>
import { computed, ref } from 'vue';
import {
  NOT_APPLICABLE,
  colorSwatch,
  fieldOptions,
} from '../../lib/order-catalog.js';
import { joinComposite, splitComposite } from '../../lib/order-items.js';
import OrderCombobox from './OrderCombobox.vue';
import OrderIcon from './OrderIcon.vue';

// One field of an item card, drawn by its kind (design → Campos do item). It
// emits the new value; the items section owns the draft.
const NOT_APPLICABLE_LABEL = 'NÃO APLICÁVEL';

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { type: [String, Array], default: '' },
  productId: { type: String, default: null },
  inputId: { type: String, required: true },
  // PFI-07 survives only for a product outside the catalog (F14).
  allowNotApplicable: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const options = computed(() => fieldOptions(props.field.list, props.productId));
const colorOptions = computed(() =>
  props.field.colorList
    ? fieldOptions(props.field.colorList, props.productId)
    : [],
);
const isColor = computed(() => props.field.list === 'cores');
const text = computed(() =>
  Array.isArray(props.modelValue) ? '' : String(props.modelValue ?? ''),
);
const entries = computed(() => {
  const list = Array.isArray(props.modelValue) ? props.modelValue : [];
  return list.length > 0 ? list.map(String) : [''];
});
const parts = computed(() => splitComposite(text.value));
const notApplicable = computed(() => text.value === NOT_APPLICABLE);
const previous = ref('');

/** @param {number} index @param {string} value */
function setEntry(index, value) {
  const next = [...entries.value];
  next[index] = value;
  emit('update:modelValue', next);
}

function addEntry() {
  emit('update:modelValue', [...entries.value, '']);
}

/** @param {number} index */
function removeEntry(index) {
  emit(
    'update:modelValue',
    entries.value.filter((_entry, at) => at !== index),
  );
}

/**
 * Unchecking restores what was typed before, because an unchecked box means
 * "there is a colour here", not "erase it".
 *
 * @param {boolean} checked
 */
function toggleNotApplicable(checked) {
  if (checked) {
    previous.value = text.value;
    emit('update:modelValue', NOT_APPLICABLE);
    return;
  }
  emit('update:modelValue', previous.value);
}
</script>

<template>
  <div
    class="op-field"
    :class="{
      'op-field--wide': field.kind === 'multi' || field.placement === 'wide',
    }"
  >
    <template v-if="field.kind === 'multi'">
      <span class="op-label">{{ field.label }}</span>
      <div v-for="(entry, index) in entries" :key="index" class="op-input-row">
        <OrderCombobox
          :id="`${inputId}-${index}`"
          :model-value="entry"
          :groups="options"
          :aria-label="`${field.label} ${index + 1}`"
          @update:model-value="(value) => setEntry(index, value)"
        />
        <button
          v-if="entries.length > 1"
          type="button"
          class="op-icon-button"
          @click="removeEntry(index)"
        >
          <OrderIcon name="x" />
          <span class="op-visually-hidden">{{
            `Remover ${field.label.toLowerCase()} ${index + 1}`
          }}</span>
        </button>
      </div>
      <button type="button" class="op-add-inline" @click="addEntry">
        <OrderIcon name="plus" />{{ field.addLabel }}
      </button>
    </template>

    <template v-else-if="field.kind === 'composite'">
      <span :id="`${inputId}-label`" class="op-label">{{ field.label }}</span>
      <div
        class="op-input-pair"
        role="group"
        :aria-labelledby="`${inputId}-label`"
      >
        <OrderCombobox
          :id="inputId"
          :model-value="notApplicable ? NOT_APPLICABLE_LABEL : parts[0]"
          :groups="options"
          :aria-label="`${field.label}: acabamento`"
          :disabled="notApplicable"
          @update:model-value="
            (value) => emit('update:modelValue', joinComposite(value, parts[1]))
          "
        />
        <div class="op-input-swatch">
          <span
            v-if="!notApplicable && colorSwatch(parts[1])"
            class="op-swatch"
            :style="{ background: colorSwatch(parts[1]) }"
            aria-hidden="true"
          ></span>
          <OrderCombobox
            :id="`${inputId}-cor`"
            :model-value="notApplicable ? '' : parts[1]"
            :groups="colorOptions"
            :aria-label="`${field.label}: cor`"
            :disabled="notApplicable"
            @update:model-value="
              (value) =>
                emit('update:modelValue', joinComposite(parts[0], value))
            "
          />
        </div>
      </div>
    </template>

    <template v-else>
      <label :for="inputId">{{ field.label }}</label>
      <div :class="{ 'op-input-swatch': isColor }">
        <span
          v-if="isColor && !notApplicable && colorSwatch(text)"
          class="op-swatch"
          :style="{ background: colorSwatch(text) }"
          aria-hidden="true"
        ></span>
        <OrderCombobox
          :id="inputId"
          :model-value="notApplicable ? NOT_APPLICABLE_LABEL : text"
          :groups="options"
          :disabled="notApplicable"
          @update:model-value="(value) => emit('update:modelValue', value)"
        />
      </div>
    </template>

    <label v-if="allowNotApplicable && field.kind !== 'multi'" class="op-check">
      <input
        type="checkbox"
        :checked="notApplicable"
        :aria-label="`${field.label} não se aplica`"
        @change="toggleNotApplicable($event.target.checked)"
      />
      <span aria-hidden="true">Não aplicável</span>
    </label>
  </div>
</template>
```

- [ ] **Step 4: Reescrever o `<script setup>` de `OrderItemsSection.vue`**

Trocar o bloco `<script setup>` inteiro por:

```vue
<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import {
  NOT_APPLICABLE,
  colorSwatch,
  describeItem,
  itemFields,
  productOptions,
  readField,
  resolveProduct,
} from '../../lib/order-catalog.js';
import { draftItem, emptyItem, itemPayload } from '../../lib/order-items.js';
import OrderCombobox from './OrderCombobox.vue';
import OrderIcon from './OrderIcon.vue';
import OrderSpecField from './OrderSpecField.vue';

const SECTION = 'items';
const NOT_APPLICABLE_LABEL = 'NÃO APLICÁVEL';
const GRADE_MESSAGE = 'Use uma quantidade inteira maior que zero.';
// FIT-01: every Tipo suggests the catalog products, grouped by family.
const PRODUCT_OPTIONS = productOptions();
// PFI-07 only where the catalog cannot say the part is missing (F14).
const NOT_APPLICABLE_FIELDS = new Set([
  'cor_manga_direita',
  'cor_manga_esquerda',
  'vies_gola',
  'vies_mangas',
]);

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const form = ref(null);
const draft = ref([]);
const saving = ref(false);
const errorMessage = ref('');
/** @type {import('vue').Ref<Record<string, string>>} */
const lineErrors = ref({});

const isEditing = computed(() => editing.editingSection.value === SECTION);
const canEdit = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const otherSectionOpen = computed(
  () => editing.editingSection.value !== '' && !isEditing.value,
);
const items = computed(() =>
  isEditing.value ? draft.value : shownItems.value,
);
const shownItems = computed(() => props.order.ficha.items);
// PFI-04: every total is summed from the grade, in reading and while editing,
// so the seller sees the number the server will store before saving.
const draftTotal = computed(() =>
  items.value.reduce((total, item) => total + pieces(item), 0),
);
const headline = computed(() => {
  const count = items.value.length;
  return `${count} ${count === 1 ? 'item' : 'itens'} · ${draftTotal.value} peças`;
});

/** @param {Record<string, any>} item */
function pieces(item) {
  return item.grade.reduce(
    /** @param {number} total @param {Record<string, any>} line */
    (total, line) =>
      total + (Number.parseInt(String(line.quantidade), 10) || 0),
    0,
  );
}

/** @param {Record<string, any>} item */
function productOf(item) {
  return resolveProduct(item.tipo);
}

/** FIT-02/FIT-03 @param {Record<string, any>} item */
function fieldsOf(item) {
  return itemFields(productOf(item));
}

/**
 * @param {Record<string, any>} item
 * @param {{path: string}} field
 * @param {string | string[]} value
 */
function writeValue(item, field, value) {
  if (field.path.startsWith('specs.')) {
    item.specs[field.path.slice('specs.'.length)] = value;
    return;
  }
  item[field.path] = value;
}

/** @param {string | string[]} value */
function joined(value) {
  return Array.isArray(value) ? value.join(' / ') : value;
}

/** FIT-11: reading shows only what the product has and someone filled. @param {Record<string, any>} item */
function view(item) {
  const filled = describeItem(item).cells.filter((cell) => !cell.empty);
  return {
    header: filled
      .filter((cell) => cell.field.placement === 'header')
      .map((cell) => joined(cell.value))
      .join(' · '),
    grid: filled.filter((cell) => cell.field.placement === 'grid'),
    wide: filled.filter((cell) => cell.field.placement === 'wide'),
  };
}

/** @param {string | string[]} value */
function shownValue(value) {
  if (value === NOT_APPLICABLE) return NOT_APPLICABLE_LABEL;
  return joined(value) || '—';
}

/** FIT-10 @param {{field: {list: string, colorList?: string}, value: string | string[]}} cell */
function swatchOf(cell) {
  if (Array.isArray(cell.value) || cell.value === NOT_APPLICABLE) return '';
  if (cell.field.list !== 'cores' && cell.field.colorList !== 'cores') {
    return '';
  }
  return colorSwatch(cell.value);
}

/**
 * The stepper beside the quantity moves a whole piece at a time and stops at
 * one, since the grade rule refuses zero anyway.
 *
 * @param {Record<string, any>} line @param {number} delta
 */
function step(line, delta) {
  const current = Number.parseInt(String(line.quantidade), 10) || 0;
  line.quantidade = Math.max(1, current + delta);
}

async function startEditing() {
  // structuredClone refuses a reactive proxy (DataCloneError); the ficha is
  // plain JSON data, so a JSON round trip is the copy that works here.
  draft.value = JSON.parse(JSON.stringify(props.order.ficha.items)).map(
    draftItem,
  );
  lineErrors.value = {};
  errorMessage.value = '';
  editing.start(SECTION);
  await nextTick();
  // The first field lives inside a v-for; a ref on a repeated element would
  // be a list, so the form itself is asked for its first input.
  form.value?.querySelector('input')?.focus();
}

function cancel() {
  errorMessage.value = '';
  lineErrors.value = {};
  editing.stop();
}

function addItem() {
  draft.value.push(emptyItem());
}

/** @param {number} index */
function removeItem(index) {
  draft.value.splice(index, 1);
}

/** @param {Record<string, any>} item */
function addGradeLine(item) {
  item.grade.push({ quantidade: 1, tamanho: '' });
}

/** @param {Record<string, any>} item @param {number} index */
function removeGradeLine(item, index) {
  item.grade.splice(index, 1);
}

/**
 * The grade is checked here before the request so the error lands on the line
 * the seller is looking at; the server checks it again and answers 422
 * INVALID_GRADE with the same index.
 */
function validate() {
  /** @type {Record<string, string>} */
  const errors = {};
  draft.value.forEach((item, itemIndex) => {
    item.grade.forEach(
      /** @param {Record<string, any>} line @param {number} index */
      (line, index) => {
        // FGR-02: a line nobody counted is dropped on save, not refused.
        if (String(line.quantidade ?? '').trim() === '') return;
        const quantity = Number(line.quantidade);
        if (
          !Number.isSafeInteger(quantity) ||
          quantity <= 0 ||
          String(line.tamanho).trim() === ''
        ) {
          errors[`${itemIndex}:${index}`] = GRADE_MESSAGE;
        }
      },
    );
  });
  lineErrors.value = errors;
  return Object.keys(errors).length === 0;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  errorMessage.value = '';
  const result = await editing.save(SECTION, draft.value.map(itemPayload));
  saving.value = false;
  if (result.ok) {
    editing.stop();
    return;
  }
  if (result.code === 'INVALID_GRADE') {
    const target = String(result.fields?.[0] ?? '');
    const match = /^items\[(\d+)\]\.grade\[(\d+)\]$/u.exec(target);
    lineErrors.value = match
      ? { [`${match[1]}:${match[2]}`]: GRADE_MESSAGE }
      : { '0:0': GRADE_MESSAGE };
    return;
  }
  errorMessage.value = result.message;
}
</script>
```

- [ ] **Step 5: Trocar o topo do item em edição e os campos**

No template, dentro do `<fieldset … class="op-item op-item-edit">`, trocar tudo
entre `<legend class="op-visually-hidden">Item {{ itemIndex + 1 }}</legend>` e
`<div class="op-grade-editor">` (o cabeçalho do item e o bloco
`<div class="op-item-fields">` inteiro) por:

```vue
          <div class="op-item-head">
            <span class="op-item-index">Item {{ itemIndex + 1 }}</span>
            <div class="op-item-names">
              <div class="op-field">
                <label :for="`item-${itemIndex}-tipo`">Tipo</label>
                <OrderCombobox
                  :id="`item-${itemIndex}-tipo`"
                  v-model="item.tipo"
                  :groups="PRODUCT_OPTIONS"
                />
                <p
                  v-if="item.tipo.trim() !== '' && !productOf(item)"
                  class="op-hint"
                >
                  Produto fora do catálogo: todos os campos aparecem.
                </p>
              </div>
            </div>
            <button
              v-if="draft.length > 1"
              type="button"
              class="op-icon-button op-icon-button--danger"
              @click="removeItem(itemIndex)"
            >
              <OrderIcon name="trash" />
              <span class="op-visually-hidden">{{
                `Remover item ${itemIndex + 1}`
              }}</span>
            </button>
          </div>

          <div class="op-item-fields">
            <OrderSpecField
              v-for="field in fieldsOf(item)"
              :key="field.id"
              :field="field"
              :product-id="productOf(item)?.id ?? null"
              :input-id="`item-${itemIndex}-${field.id}`"
              :allow-not-applicable="
                !productOf(item) && NOT_APPLICABLE_FIELDS.has(field.id)
              "
              :model-value="readField(item, field)"
              @update:model-value="(value) => writeValue(item, field, value)"
            />
            <div class="op-field op-field--wide">
              <label :for="`item-${itemIndex}-outras`"
                >Outras especificações</label
              >
              <textarea
                :id="`item-${itemIndex}-outras`"
                v-model="item.outras"
                rows="2"
                maxlength="500"
              ></textarea>
            </div>
          </div>

```

- [ ] **Step 6: Trocar a leitura do item**

No bloco de leitura (`<div v-else class="op-sheet-body op-item-list">`), trocar
`<h3>{{ item.tipo || '—' }} <span>{{ item.modelo || '' }}</span></h3>` por:

```vue
<h3>
              {{ item.tipo || '—' }}
              <span>{{ view(item).header }}</span>
            </h3>
```

e trocar o `<dl class="op-specs"> … </dl>` inteiro por:

```vue
<dl class="op-specs">
            <div
              v-for="cell in view(item).grid"
              :key="cell.field.id"
              :class="{ 'op-specs-wide': cell.field.kind === 'multi' }"
            >
              <dt>{{ cell.field.label }}</dt>
              <dd :data-muted="cell.value === NOT_APPLICABLE || undefined">
                <span
                  v-if="swatchOf(cell)"
                  class="op-swatch"
                  :style="{ background: swatchOf(cell) }"
                  aria-hidden="true"
                ></span>
                {{ shownValue(cell.value) }}
              </dd>
            </div>
            <div
              v-for="cell in view(item).wide"
              :key="cell.field.id"
              class="op-specs-wide"
            >
              <dt>{{ cell.field.label }}</dt>
              <dd>{{ shownValue(cell.value) }}</dd>
            </div>
            <div v-if="item.outras" class="op-specs-wide">
              <dt>Outras especificações</dt>
              <dd>{{ item.outras }}</dd>
            </div>
          </dl>
```

- [ ] **Step 7: CSS** (acrescentar em `screen-styles.css`, depois de `.op-input-row { … }`)

```css
.op-input-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.op-input-swatch .op-swatch {
  z-index: 1;
  pointer-events: none;
}

.op-input-swatch .op-swatch + .op-combo > input {
  padding-inline-start: 2.35rem;
}

.op-item-fields textarea {
  inline-size: 100%;
  resize: vertical;
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npm run test:e2e -- test/e2e/orders.spec.js`
Expected: PASS (todos; os antigos de itens continuam: "Malha 2", "Adicionar malha",
"Tamanho da linha 3", "Quantidade do tamanho M")

- [ ] **Step 9: Conferir na tela**

Rode a aplicação (skill `run`) e abra `/pedidos/<id de um pedido pendente>`:
troque o Tipo entre CAMISETA, REGATA, BERMUDA e BONÉ e confira os campos e os
rótulos; confira que a lista de sugestões não fica atrás de outros campos.

- [ ] **Step 10: Gate e commit**

Run: `npm run lint && npm run typecheck && npm run check:design-tokens && npm run build`

```bash
git add apps/edge-web/src/components/order/OrderSpecField.vue apps/edge-web/src/components/order/OrderItemsSection.vue apps/edge-web/src/screen-styles.css test/e2e/orders.spec.js
git commit -m "feat(edge-web): draw each order item from its catalog product" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Campos, rótulos e sugestões mudam com o Tipo; fora do catálogo mostra tudo
- [ ] Viés, locais e outras especificações gravam no formato do domínio
- [ ] Gates e2e e quick passam

**Tests:** e2e · **Gate:** e2e + quick · **Commit:** `feat(edge-web): draw each order item from its catalog product`

---

### T12: Grade por escala

- **What:** seletor de escala que preenche os tamanhos; tamanho por combobox;
  título da grade com a escala na leitura.
- **Where:** `apps/edge-web/src/components/order/OrderItemsSection.vue`, `screen-styles.css`, `test/e2e/orders.spec.js`
- **Depends on:** T11
- **Requirement:** FGR-01, FGR-02, FGR-03, FGR-04, FGR-05

**Files:**

- Modify: `apps/edge-web/src/components/order/OrderItemsSection.vue`
- Modify: `apps/edge-web/src/screen-styles.css`
- Test: `test/e2e/orders.spec.js`

**Interfaces:**

- Consumes: `scaleById`, `scalesFor` (T09); `gradeForScale` (T09); `OrderCombobox` (T10).
- Produces: `<select>` com nome acessível `"Escala da grade do item <n>"`.

- [ ] **Step 1: Escrever os testes e2e que falham**

No topo de `test/e2e/orders.spec.js`, acrescentar:

```js
import {
  resolveProduct,
  scalesFor,
} from '../../modules/orders/src/catalog/index.js';
```

e acrescentar os testes:

```js
test('fills the grade with the sizes of the chosen scale (FGR-02, FGR-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items
    .getByRole('combobox', { name: 'Escala da grade do item 1' })
    .selectOption('infantil');
  await expect(items.getByLabel('Quantidade do tamanho PP')).toBeVisible();
  await items.getByLabel('Quantidade do tamanho PP').fill('5');
  await items.getByRole('button', { name: 'Salvar' }).click();

  const [saved] = writes[0].body.value;
  expect(saved.escala).toBe('infantil');
  expect(saved.grade).toEqual([
    { quantidade: 100, tamanho: 'M' },
    { quantidade: 50, tamanho: 'G' },
    { quantidade: 5, tamanho: 'PP' },
  ]);
});

test('offers only the scales of the product (FGR-01)', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  const scale = items.getByRole('combobox', {
    name: 'Escala da grade do item 1',
  });
  const camiseta = scalesFor(resolveProduct('CAMISETA')).length;
  await expect(scale.locator('option')).toHaveCount(camiseta + 1);

  await chooseTipo(items, 'CAMISA DE TIME');
  await expect(scale.locator('option')).toHaveCount(scalesFor(null).length + 1);
});

test('names the scale above the grade when it is not the adult one', async ({
  page,
}) => {
  const infantil = JSON.parse(JSON.stringify(pendingOrder));
  infantil.ficha.items[0].escala = 'infantil';
  await mockOrders(page, { orders: [confirmedOrder, infantil] });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByRole('region', { name: 'Itens e especificações' }),
  ).toContainText('Grade · Infantil');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:e2e -- test/e2e/orders.spec.js -g "scale"`
Expected: FAIL — não existe o seletor "Escala da grade do item 1".

- [ ] **Step 3: Implementar**

Em `OrderItemsSection.vue`, no `<script setup>`:

1. No import de `../../lib/order-catalog.js`, acrescentar `scaleById` e `scalesFor`.
2. No import de `../../lib/order-items.js`, acrescentar `gradeForScale`.
3. Acrescentar, depois de `fieldsOf`:

```js
/** FGR-01 @param {Record<string, any>} item */
function scaleOptions(item) {
  return scalesFor(productOf(item));
}

/**
 * FGR-02/FGR-05: the scale is stored on the item and its sizes join the grade.
 * One handler does both, so the grade never reads a stale scale.
 *
 * @param {Record<string, any>} item @param {string} id
 */
function setScale(item, id) {
  item.escala = id;
  const scale = scaleById(id);
  if (scale && !scale.freeText) item.grade = gradeForScale(item.grade, scale);
}

/**
 * The sizes the grade suggests: the chosen scale, or every scale the product
 * offers; a "Medida" scale is typed freely (FGR-03, FGR-04).
 *
 * @param {Record<string, any>} item
 */
function sizeGroups(item) {
  const chosen = scaleById(item.escala);
  const scales = chosen ? [chosen] : scaleOptions(item);
  return scales
    .filter((scale) => !scale.freeText)
    .map((scale) => ({
      label: scale.label,
      options: scale.sizes.map((size) => ({ value: size, label: size })),
    }));
}

/** @param {Record<string, any>} item */
function gradeTitle(item) {
  const scale = scaleById(String(item.escala ?? ''));
  return scale && scale.id !== 'adulto' ? `Grade · ${scale.label}` : 'Grade';
}
```

No template de edição, dentro de `<div class="op-grade-editor-head">`, logo
depois de `<span class="op-label">Grade</span>`, acrescentar:

```vue
<select
  :value="item.escala"
  class="op-grade-scale"
  :aria-label="`Escala da grade do item ${itemIndex + 1}`"
  @change="setScale(item, $event.target.value)"
>
                <option value="">Escala…</option>
                <option
                  v-for="scale in scaleOptions(item)"
                  :key="scale.id"
                  :value="scale.id"
                >
                  {{ scale.label }}
                </option>
              </select>
```

Trocar o `<input v-model="line.tamanho" class="op-grade-size" … />` (com
`list="catalog-sizes"`) por:

```vue
<OrderCombobox
  :id="`item-${itemIndex}-tamanho-${lineIndex}`"
  v-model="line.tamanho"
  class="op-grade-size"
  :groups="sizeGroups(item)"
  :aria-label="`Tamanho da linha ${lineIndex + 1}`"
  :invalid="
    Boolean(lineErrors[`${itemIndex}:${lineIndex}`]) &&
    String(line.tamanho).trim() === ''
  "
  :aria-describedby="
    lineErrors[`${itemIndex}:${lineIndex}`]
      ? `grade-error-${itemIndex}-${lineIndex}`
      : ''
  "
/>
```

Na leitura, trocar `<h4 class="op-label">Grade</h4>` por
`<h4 class="op-label">{{ gradeTitle(item) }}</h4>`.

Em `screen-styles.css`, acrescentar depois do bloco `.op-input-pair`:

```css
.op-grade-scale {
  margin-inline-start: auto;
  font-size: var(--text-sm);
}

.op-combo.op-grade-size {
  min-inline-size: 5rem;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:e2e -- test/e2e/orders.spec.js`
Expected: PASS (todos)

- [ ] **Step 5: Gate e commit**

Run: `npm run lint && npm run typecheck && npm run check:design-tokens && npm run build`

```bash
git add apps/edge-web/src/components/order/OrderItemsSection.vue apps/edge-web/src/screen-styles.css test/e2e/orders.spec.js
git commit -m "feat(edge-web): fill the grade from the product size scale" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Escala preenche tamanhos; linhas sem quantidade não vão ao servidor
- [ ] Leitura mostra `Grade · <escala>` quando não é Adulto
- [ ] Gates e2e e quick passam

**Tests:** e2e · **Gate:** e2e + quick · **Commit:** `feat(edge-web): fill the grade from the product size scale`

---

### T13: Fim das listas fixas e dos datalists

- **What:** apagar `OrderCatalogLists.vue` e as listas copiadas à mão;
  `colorSwatch` passa a usar as cores do catálogo.
- **Where:** `apps/edge-web/src/lib/order-catalog.js`, `apps/edge-web/src/views/OrderView.vue`, `apps/edge-web/src/components/order/OrderCatalogLists.vue`, `test/order-catalog.test.js`
- **Depends on:** T12
- **Requirement:** FIT-10, objetivo "toda sugestão vem de uma linha Manter"

**Files:**

- Delete: `apps/edge-web/src/components/order/OrderCatalogLists.vue`
- Modify: `apps/edge-web/src/views/OrderView.vue`
- Modify: `apps/edge-web/src/lib/order-catalog.js`
- Test: `test/order-catalog.test.js` (reescrito)

- [ ] **Step 1: Reescrever o teste**

```js
// test/order-catalog.test.js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/order-catalog.test.js`
Expected: FAIL — `PIECE_TYPES` ainda exportado.

- [ ] **Step 3: Implementar**

Substituir `apps/edge-web/src/lib/order-catalog.js` inteiro por:

```js
// ADR 007: the screen reads the same order catalog as the server, generated
// from the option sheet the Silmer approved. Every suggestion comes from it.
import {
  ORDER_CATALOG,
  foldText,
} from '../../../../modules/orders/src/catalog/index.js';

export {
  FIELDS,
  NOT_APPLICABLE,
  ORDER_CATALOG,
  applicationOptions,
  describeItem,
  fieldOptions,
  foldText,
  itemFields,
  productOptions,
  readField,
  resolveProduct,
  scaleById,
  scalesFor,
} from '../../../../modules/orders/src/catalog/index.js';

/**
 * `swatch` is an approximation for the screen only, so the seller sees at a
 * glance which colour the text names. It never reaches the printed ficha.
 */
const SWATCHES = ORDER_CATALOG.lists.cores
  .filter((option) => option.swatch)
  .flatMap((option) =>
    [option.value, option.label.split('/')[0]].map((name) => ({
      key: foldText(name),
      swatch: String(option.swatch),
    })),
  )
  // The longest name wins, so "azul marinho" is not read as a plain "azul".
  .sort((a, b) => b.key.length - a.key.length);

/**
 * The swatch of the first catalog colour named in a free-text value
 * ("AZUL MARINHO", "RIBANA · VERDE BANDEIRA"), or '' when none is.
 *
 * @param {unknown} value
 */
export function colorSwatch(value) {
  const text = foldText(value);
  if (text === '') return '';
  return SWATCHES.find((entry) => text.includes(entry.key))?.swatch ?? '';
}
```

Em `apps/edge-web/src/views/OrderView.vue`, apagar a linha
`import OrderCatalogLists from '../components/order/OrderCatalogLists.vue';` e
a linha `<OrderCatalogLists />`.

Run: `git rm apps/edge-web/src/components/order/OrderCatalogLists.vue`

- [ ] **Step 4: Conferir que não sobrou datalist**

Run: `grep -rn "catalog-\|OrderCatalogLists\|PIECE_TYPES\|FINISHES" apps/edge-web/src test`
Expected: nenhuma linha.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/order-catalog.test.js && npm run test:e2e -- test/e2e/orders.spec.js`
Expected: PASS

- [ ] **Step 6: Gate e commit**

Run: `npm run lint && npm run typecheck && npm run check:boundaries && npm run build`

```bash
git add -A apps/edge-web/src test/order-catalog.test.js
git commit -m "refactor(edge-web): drop hand-copied option lists for the catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Nenhuma lista fixa nem datalist no front
- [ ] Gates e2e e quick passam

**Tests:** unit + e2e · **Gate:** e2e + quick · **Commit:** `refactor(edge-web): drop hand-copied option lists for the catalog`

---

### T14: Verificação final e rastreabilidade

- **What:** rodar tudo, preencher a rastreabilidade da spec e deixar o PDF v3
  pronto para a revisão humana.
- **Where:** `.specs/features/ficha-por-produto/spec.md`
- **Depends on:** T01–T13
- **Requirement:** todos

- [ ] **Step 1: Gate completo**

Run: `npm run validate && npm run test:e2e`
Expected: tudo passa; `Pacote de revisão da v3 válido: pending-human-approval.`

- [ ] **Step 2: Catálogo em dia com a planilha**

Run: `npm run catalog:import -- --from "G:/Meu Drive/Silmer/005-lista-de-opcoes-para-aprovacao.xlsx" --check`
Expected: `Catálogo em dia com a planilha.` Se a Silmer aprovou mais sugestões
desde a T03, rode sem `--check`, rode os testes de novo e faça commit
`chore(orders): refresh the order catalog from the sheet`.

- [ ] **Step 3: Conferência na tela**

Rode a aplicação (skill `run`) e, num pedido pendente: crie itens CAMISETA,
REGATA, BERMUDA e BONÉ; confira campos, rótulos, sugestões filtradas por
produto, escala preenchendo a grade, banner listando só campos "Sim", e a
leitura de cada item. Tire um screenshot de cada card e anexe ao relatório.

- [ ] **Step 4: Rastreabilidade**

Na tabela "Rastreabilidade" de `spec.md`, trocar cada linha por uma por ID com
a evidência (arquivo:linha do teste), por exemplo:

```markdown
| CAT-01 | P1-1 | `test/order-catalog-import.test.js` (keeps only approved rows) |
| FIT-02 | P1-2 | `test/order-catalog-resolver.test.js`, `test/e2e/orders.spec.js` (shows only the fields) |
| FIM-06 | P1-5 | `test/orders-print-v3.test.js` (keeps the production page identical) |
```

e mudar `**Status:**` para `Implementado — aguardando aprovação da v3 (T15)`.

- [ ] **Step 5: Commit e pedido de revisão**

```bash
git add .specs/features/ficha-por-produto/spec.md
git commit -m "docs(specs): trace the product-driven ficha to its tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Enviar `output/pdf/ficha-canonica-sintetica-v3.pdf` para Rose e Operação com
os critérios da v2 (legibilidade, conteúdo, ordem, grade, totais, impressão).

**Done when:**

- [ ] `npm run validate` e e2e passam
- [ ] Rastreabilidade preenchida; PDF v3 enviado para revisão

**Tests:** todos · **Gate:** full · **Commit:** `docs(specs): trace the product-driven ficha to its tests`

---

### T15: [GATE HUMANO] Aprovar a v3 e trocar o template de impressão

> Só começa com a aprovação explícita de Rose **e** Operação sobre o PDF da
> T14. Sem ela, a feature não vai para produção.

- **What:** registrar a aprovação e imprimir os pedidos na v3.
- **Where:** `docs/phase0/ficha-pdf-approval-v3.json`, `modules/orders/src/print/index.js`, `test/orders-print-v3.test.js`, `test/order-routes.test.js`
- **Depends on:** T14 + aprovação humana
- **Requirement:** FIM-08, F20

- [ ] **Step 1: Registrar a aprovação**

Em `docs/phase0/ficha-pdf-approval-v3.json`, trocar o bloco `approval` por
(com os nomes e o horário reais da aprovação):

```json
  "approval": {
    "status": "approved",
    "approved": true,
    "reviewedBy": { "rose": "Rose", "operation": "Operacao Silmer" },
    "reviewedAt": "<data e hora da aprovação, ISO 8601 com fuso>",
    "criteria": {
      "legibility": true,
      "content": true,
      "order": true,
      "grade": true,
      "totals": true,
      "printing": true
    }
  },
```

Run: `npm run validate:ficha-v3-review`
Expected: `Pacote de revisão da v3 válido: approved.`

- [ ] **Step 2: Atualizar os testes para a v3 (falham)**

Em `test/orders-print-v3.test.js`, trocar o teste `prints on v2 until the v3 approval is recorded (FIM-08)` por:

```js
test('prints every order on v3 once the approval is recorded (FIM-08)', () => {
  assert.equal(PRINT_TEMPLATE, TEMPLATE_V3);
  const html = renderOrderFicha(order([bermuda]));
  assert.match(html, /Viés barra\/lateral/u);
  assert.doesNotMatch(html, /Vies gola \/ mangas/u);
});
```

Em `test/order-routes.test.js`, renomear o teste
`GET /orders/:orderId/print renders the confirmed order on the v2 template`
para `… on the v3 template` e acrescentar ao fim dele:

```js
assert.doesNotMatch(html, /Vies gola \/ mangas/u);
```

Run: `node --test test/orders-print-v3.test.js test/order-routes.test.js`
Expected: FAIL — `PRINT_TEMPLATE` ainda é v2.

- [ ] **Step 3: Trocar o template**

Em `modules/orders/src/print/index.js`, trocar
`export const PRINT_TEMPLATE = TEMPLATE_V2;` por
`export const PRINT_TEMPLATE = TEMPLATE_V3;` e remover `TEMPLATE_V2` do import
se não tiver outro uso no arquivo.

Run: `node --test test/orders-print-v3.test.js test/order-routes.test.js && npm run validate`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/phase0/ficha-pdf-approval-v3.json modules/orders/src/print/index.js test/orders-print-v3.test.js test/order-routes.test.js
git commit -m "feat(orders): print orders on the approved v3 ficha" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Done when:**

- [ ] Aprovação de Rose e Operação registrada
- [ ] Pedidos imprimem na v3; `npm run validate` passa
- [ ] Liberado para deploy

**Tests:** unit · **Gate:** full · **Commit:** `feat(orders): print orders on the approved v3 ficha`

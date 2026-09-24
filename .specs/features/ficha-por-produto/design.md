# Ficha por produto — Arquitetura

**Spec:** [`spec.md`](spec.md) · **Decisões:** [`context.md`](context.md) · **Tasks:** [`tasks.md`](tasks.md)
**Status:** Draft para aprovação

---

## Visão geral

```
Planilha aprovada (.xlsx, Drive)
        │  npm run catalog:import -- --from <xlsx>
        ▼
scripts/import-order-catalog.mjs ──► modules/orders/src/catalog/order-catalog.data.js  (gerado, em git)
                                            │
                     modules/orders/src/catalog/index.js  (resolvedor puro, sem dependências)
                      │                         │                          │
        domain/ficha.js + order.js     api: printSnapshot (v3)     edge-web: lib/order-catalog.js
        (validação, faltantes)          print/ficha-canonical-v3     OrderItemsSection + OrderCombobox
```

- Uma fonte só: o arquivo gerado. Backend e frontend leem o mesmo objeto pelo
  mesmo resolvedor, então regra, rótulo e ordem nunca divergem entre tela,
  banner e impressão.
- O arquivo é **gerado**, nunca editado à mão. Mudou a planilha → roda o
  script → commit.
- Nenhuma migration: a ficha continua no `ficha_envelope` cifrado (F15).

---

## Modelo de dados do catálogo

### Modelo relacional (conceitual)

É o modelo que a planilha representa e que um futuro catálogo no PostgreSQL
seguiria. Nesta feature ele é serializado em um arquivo, não em tabelas.

```
familia 1───* produto *───* escala 1───* tamanho
                 │  produto_escala
                 │
                 *  produto_campo (regra: sim|opcional|nao, rotulo?)
                 │
campo *───1 lista 1───* opcao *───* produto   (opcao_produto: "Vale para"; vazio = todos)
```

| Entidade         | Chave                 | Atributos                                                                           | Origem na planilha                 |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| `produto`        | `id` (slug)           | `label`, `print`, `family`                                                          | aba 02                             |
| `campo`          | `id`                  | `label`, `path` no item, `list`, `kind` (`text`, `multi`, `composite`), `placement` | fixo no código (ver tabela abaixo) |
| `produto_campo`  | (`produto`, `campo`)  | `rule` (`required`, `optional`), `label` (rótulo do produto, opcional)              | aba 03; ausência = regra Não       |
| `lista`          | `id`                  | —                                                                                   | uma por aba 04–16                  |
| `opcao`          | (`lista`, `value`)    | `label`, `group`, `products` (vazio = todos), `note`, `swatch` (cores)              | abas 04–16, só "Manter"            |
| `escala`         | `id`                  | `label`, `sizes[]`, `freeText`                                                      | aba 14 (grupo = escala)            |
| `produto_escala` | (`produto`, `escala`) | ordem                                                                               | aba 02, coluna "Escalas de grade"  |

### Campos do item

Os campos são fixos no código porque cada um tem um lugar no item gravado e
na impressão. A planilha decide **quais** valem para cada produto e **como**
se chamam; o código decide **onde** ficam.

| `id`                 | Rótulo padrão       | `path` no item       | `kind`      | Lista (aba)                 | Impressão   |
| -------------------- | ------------------- | -------------------- | ----------- | --------------------------- | ----------- |
| `modelagem`          | Modelagem           | `modelo`             | `text`      | 04 Modelagem                | cabeçalho   |
| `gola`               | Gola/decote         | `specs.gola`         | `text`      | 05 Golas                    | cabeçalho   |
| `manga`              | Manga               | `specs.manga`        | `text`      | 06 Mangas                   | cabeçalho   |
| `malha`              | Malha/tecido        | `malhas`             | `multi`     | 07 Malhas e tecidos         | grade       |
| `cor_frente`         | Cor frente          | `cor_frente`         | `text`      | 08 Cores                    | grade       |
| `cor_costas`         | Cor costas          | `cor_costas`         | `text`      | 08 Cores                    | grade       |
| `cor_manga_direita`  | Cor manga direita   | `cor_manga_direita`  | `text`      | 08 Cores                    | grade       |
| `cor_manga_esquerda` | Cor manga esquerda  | `cor_manga_esquerda` | `text`      | 08 Cores                    | grade       |
| `vies_gola`          | Viés gola           | `vies_gola`          | `composite` | 09 Acabamentos + 08 Cores   | grade       |
| `vies_mangas`        | Viés mangas         | `vies_mangas`        | `composite` | 09 Acabamentos + 08 Cores   | grade       |
| `abertura`           | Abertura/fechamento | `specs.abertura`     | `text`      | 10 Abertura e fechamento    | grade       |
| `bolso`              | Bolso               | `specs.bolso`        | `text`      | 11 Bolsos                   | grade       |
| `cos`                | Cós/cintura         | `specs.cos`          | `text`      | 12 Cós e cintura            | grade       |
| `faces`              | Faces               | `specs.faces`        | `text`      | 13 Bandeira (grupo Faces)   | grade       |
| `fixacao`            | Fixação/borda       | `specs.fixacao`      | `text`      | 13 Bandeira (grupo Fixação) | grade       |
| `locais`             | Locais da aplicação | `specs.locais`       | `multi`     | 16 Locais da aplicação      | linha larga |

`outras` (Outras especificações) e `escala` existem em todo item e não passam
pela matriz. A aplicação do cabeçalho do pedido usa a lista da aba 15.

### Arquivo gerado

`modules/orders/src/catalog/order-catalog.data.js` — ESM com um objeto
literal, formatado pelo Prettier do repo. ESM em vez de `.json` para que Node,
Vite e `tsc` importem o mesmo arquivo sem atributos de importação.

```js
// GERADO por scripts/import-order-catalog.mjs — não editar.
export default {
  schemaVersion: 1,
  source: { file: '005-lista-de-opcoes-para-aprovacao.xlsx', sha256: '…' },
  products: [
    {
      id: 'regata',
      label: 'Regata',
      print: 'REGATA',
      family: 'Vestuário superior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: { rule: 'required' },
        gola: { rule: 'required' },
        vies_mangas: { rule: 'required', label: 'Viés cavas' },
        locais: { rule: 'optional' },
        // campo ausente = regra Não
      },
    },
  ],
  lists: {
    golas: [
      {
        value: 'CARECA',
        label: 'Careca/redonda',
        group: 'Gola/decote',
        products: [],
      },
    ],
    cores: [
      {
        value: 'AZUL MARINHO',
        label: 'Azul-marinho',
        group: 'Azuis',
        products: [],
        swatch: '#1f2a5a',
      },
    ],
  },
  scales: [
    {
      id: 'adulto',
      label: 'Adulto',
      sizes: ['PP', 'P', 'M', 'G', 'GG', 'EG', 'XG'],
      freeText: false,
    },
    { id: 'medida', label: 'Medida', sizes: [], freeText: true },
  ],
  applications: [
    { value: 'DTF', label: 'DTF — direto no filme', group: 'Impressão' },
  ],
};
```

- A definição dos campos (tabela acima) fica em `catalog/fields.js`, não no
  arquivo gerado.
- `swatch` das cores vem de uma tabela fixa no script (a planilha não tem cor
  em hex); cor sem amostra conhecida sai sem `swatch`.
- Checagem estrutural: `catalog/validate.js` → `assertOrderCatalog(catalog)`,
  usada pelo script antes de gravar e pelo teste de contrato (CAT-06). O repo
  não tem validador de JSON Schema e esta feature não adiciona um.

### Resolvedor — `modules/orders/src/catalog/index.js`

Funções puras, sem I/O e sem dependências fora da pasta:

| Função                             | Retorna                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `foldText(text)`                   | texto sem acento, minúsculo, separadores normalizados                                          |
| `resolveProduct(tipo)`             | produto cujo `label` ou `print` casa com `foldText(tipo)`, ou `null`                           |
| `itemFields(product)`              | campos do item em ordem, com `rule` e `label` do produto; `null` → todos, `optional`           |
| `fieldOptions(fieldId, productId)` | opções da lista do campo que valem para o produto, agrupadas por `group`                       |
| `scalesFor(product)`               | escalas do produto; `null` → todas                                                             |
| `readField(item, field)`           | valor do campo no item pelo `path`, com padrão para item antigo (`specs` ausente)              |
| `describeItem(item)`               | `{ product, cells: [{ field, label, value, rule }] }` — base de faltantes, leitura e impressão |

---

## Script de importação

`scripts/import-order-catalog.mjs --from <arquivo.xlsx> [--check]`

1. Lê o `.xlsx` com um leitor mínimo sem dependências
   (`scripts/lib/xlsx-reader.mjs`: diretório central do zip +
   `zlib.inflateRawSync` + leitura de `sharedStrings.xml` e das planilhas).
   Nenhuma dependência nova entra no `package.json` (política de supply chain).
2. Localiza as abas pelo prefixo numérico (`02 `, `03 `, `04 `…), não pelo
   nome inteiro, para tolerar renomeação do título.
3. Filtra `Decisão = Manter` (ou `Adicionar` com Opção preenchida). Converte "Vale para" em ids de produto
   (lista separada por vírgula; vazio ou "Todos…" = todos; "Nenhum…" = opção
   fora do arquivo; aba 14 ignora a coluna). Produto que existe na aba 02 mas
   não foi mantido é ignorado; se a opção ficar sem produto, sai do arquivo.
   Produto desconhecido → erro (CAT-02).
4. Lê a aba 03: cabeçalho → `campo.id` pelo rótulo (tabela fixa no script);
   `Sim` → `required`, `Opcional` → `optional`, `Não` → ausente. A coluna
   "Nomes diferentes" é lida pelo padrão `<rótulo do campo> → "<novo rótulo>"`;
   o rótulo do campo casa pelo início (`Acabamento mangas` →
   `Acabamento mangas/cavas (viés)`). Texto fora do padrão é ignorado
   (observação livre).
5. Escalas: grupo da aba 14 → escala (`Adulto alfabético` → `adulto`,
   `Tamanho único` → `unico`, `Medida` → `medida`, `freeText: true`). A
   coluna "Escalas de grade" da aba 02 casa com a escala pelo início do nome
   sem acento (`Adulto` → `Adulto alfabético`, `Medida (L × A)` → `Medida`);
   nome sem escala correspondente → erro (CAT-02).
6. Ordena tudo de forma estável (ordem das linhas da planilha), grava com
   Prettier e o `sha256` do arquivo de origem (CAT-03).
7. `--check`: gera em memória e falha se diferir do arquivo em git.

Erros sempre citam aba, linha e valor. Nada é gravado se houver erro.

---

## Mudanças no domínio (`modules/orders`)

### Item da ficha

```js
/** @typedef {{
 *   tipo: string, modelo: string, malhas: string[],
 *   cor_frente: string, cor_costas: string,
 *   cor_manga_direita: string, cor_manga_esquerda: string,
 *   vies_gola: string, vies_mangas: string,
 *   specs: { gola?: string, manga?: string, abertura?: string, bolso?: string,
 *            cos?: string, faces?: string, fixacao?: string, locais?: string[] },
 *   escala: string,   // '' ou id de escala do catálogo
 *   outras: string,   // até 500 caracteres
 *   grade: GradeLine[],
 * }} FichaItem */
```

- **`domain/ficha.js`** — `validateItem` aceita `specs`, `escala` e `outras`
  opcionais (padrão `{}`, `''`, `''`). Chaves de `specs` são as dos campos
  `specs.*` do catálogo; chave desconhecida → `OrderInputError` com o caminho.
  `escala` precisa ser `''` ou id conhecido. Depois de validar, aplica FIT-04:
  para produto do catálogo, zera campos com regra Não. `briefingToFicha`
  passa a devolver os padrões novos.
- **`domain/order.js`** — `missingForConfirmation` usa `describeItem`: para
  produto do catálogo lista só `required` vazios (FMI-01); fora do catálogo
  mantém a lista atual (FMI-02). Chave no formato `items[0].specs.gola`.
  `confirmationBlockers` não muda (FMI-03).
- `NOT_APPLICABLE` continua aceito (F14); `describeItem` trata como vazio para
  produto do catálogo.

### Impressão

- **`print/ficha-canonical-v3.js`** — novo template. Recebe o snapshot já
  resolvido; não conhece o catálogo.
  - Cabeçalho do item: `tipo` + `modelagem · gola · manga` (FIM-02).
  - Grade de especificações em 3 colunas com as células `placement = grade`
    que têm valor, com rótulo do produto (FIM-01, FIM-03).
  - Linhas largas: Locais da aplicação, Outras especificações (FIM-04).
  - Título da grade `GRADE · <ESCALA>` quando escala ≠ `adulto` (FIM-05).
  - Página 2 reaproveita o bloco da v2 sem mudança (FIM-06).
- **`apps/api/src/order-routes.js`** — `printSnapshot` monta os itens com
  `describeItem` e escolhe o template pela constante `PRINT_TEMPLATE`
  (`modules/orders/src/print/index.js`).
- **Gate da v3 (FIM-08, FIM-09)** — `scripts/ficha-pdf-review.mjs` ganha a v3:
  fixture `docs/phase0/ficha-pdf-synthetic-v3.json` (camiseta, bermuda, boné,
  bandeira), PDF `output/pdf/ficha-canonica-sintetica-v3.pdf` e registro
  `docs/phase0/ficha-pdf-approval-v3.json` (`status: pending`). O
  `--validate` falha se `PRINT_TEMPLATE` for v3 e o registro não estiver
  `approved`. Trocar para v3 é um commit próprio, feito só depois da aprovação
  de Rose e Operação.

---

## Frontend (`apps/edge-web/src`)

| Arquivo                                    | Mudança                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/order-catalog.js`                     | Deixa de ter listas fixas. Reexporta o resolvedor de `modules/orders/src/catalog/` e mantém `colorSwatch` (agora pelos `swatch` do catálogo).                                                                                                                            |
| `components/order/OrderCombobox.vue`       | Novo. Padrão ARIA 1.2 combobox: `input role=combobox`, `listbox` com grupos, setas/Enter/Esc, texto livre, amostra de cor opcional.                                                                                                                                      |
| `components/order/OrderSpecField.vue`      | Novo. Um campo por `kind`: `text` → combobox; `multi` → lista de comboboxes com adicionar/remover; `composite` → acabamento + cor. Recebe `modelValue` e emite `update:modelValue` (a regra `vue/no-mutating-props` do lint proíbe mutar o item recebido).               |
| `components/order/OrderItemsSection.vue`   | Tipo primeiro; campos vindos de `itemFields(resolveProduct(tipo))`; aviso "Produto fora do catálogo"; Outras especificações; seletor de escala e tamanhos por combobox na grade (a grade continua neste componente, que é dono do rascunho); leitura por `describeItem`. |
| `components/order/OrderSummarySection.vue` | Aplicação usa `OrderCombobox` com `applications`.                                                                                                                                                                                                                        |
| `components/order/OrderCatalogLists.vue`   | Removido (datalists substituídos pelo combobox).                                                                                                                                                                                                                         |
| `lib/order-items.js`                       | Novo. Funções puras do rascunho: `draftItem`, `emptyItem`, `itemPayload` (FIT-04, FGR-02), `splitComposite`/`joinComposite` (F12), `gradeForScale` (FGR-02).                                                                                                             |
| `lib/order-format.js`                      | `missingFieldLabel` resolve `items[i].specs.*` pelo rótulo do campo no catálogo.                                                                                                                                                                                         |

- O frontend importa `modules/orders/src/catalog/` por caminho relativo. É a
  única exceção permitida: `scripts/check-boundaries.mjs` passa a verificar que
  `apps/edge-web/src` só importa de `modules/` dentro dessa pasta, e que a
  pasta não importa nada de fora dela.
- Trocar o Tipo não apaga o que já foi digitado na tela; o que ficar com
  regra Não some da tela e é zerado ao salvar (FIT-04).

---

## Tratamento de erros

| Situação                                          | Resposta                                                      |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Planilha com regra, produto ou cabeçalho inválido | Script falha com aba, linha e valor; arquivo gerado não muda. |
| Chave desconhecida em `specs`                     | `400` `OrderInputError` com `items[i].specs.<chave>`.         |
| `escala` desconhecida                             | `400` `OrderInputError` com `items[i].escala`.                |
| `outras` acima de 500 caracteres                  | `400` `OrderInputError` com `items[i].outras`.                |
| Item antigo sem `specs`/`escala`/`outras`         | Padrões aplicados na leitura; nenhum erro (FIM-07).           |
| `PRINT_TEMPLATE = v3` sem aprovação registrada    | `npm run validate` falha em `validate:ficha-pdf-review`.      |

## Testes

| Camada                  | Tipo                 | Onde                                                                                  |
| ----------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Leitor xlsx e script    | unit (`node:test`)   | `test/order-catalog-import.test.js` + fixture `test/fixtures/order-catalog-mini.xlsx` |
| Arquivo gerado × schema | unit                 | `test/order-catalog-contract.test.js`                                                 |
| Resolvedor              | unit                 | `test/order-catalog.test.js` (substitui o atual)                                      |
| Validação e faltantes   | unit                 | `test/orders-ficha.test.js`, `test/orders-domain.test.js`                             |
| Impressão v3 e snapshot | unit                 | `test/orders-print-v3.test.js`, `test/order-routes.test.js`                           |
| Pacote de revisão       | unit                 | `test/ficha-pdf-review.test.js`                                                       |
| Tela                    | e2e (Playwright+axe) | `test/e2e/orders.spec.js`                                                             |

A fixture xlsx é pequena (2 produtos, 3 campos, 1 escala), gerada uma vez e
versionada; o teste de contrato roda sobre o arquivo gerado real.

## Decisões técnicas

| Decisão                                       | Alternativa descartada                       | Motivo                                                                                   |
| --------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Arquivo gerado em git                         | Tabelas no PostgreSQL + tela admin           | Catálogo muda pouco; revisão por diff; zero migration. Modelo relacional já documentado. |
| ESM gerado                                    | `.json` com `import … with { type: 'json' }` | Um import igual em Node, Vite e `tsc`.                                                   |
| `specs` no item                               | Uma chave nova no nível do item por campo    | Campo novo de catálogo não muda o formato do item nem a validação.                       |
| Leitor xlsx próprio                           | `exceljs`/`xlsx` como devDependency          | Política de supply chain; formato de entrada controlado.                                 |
| Regra "Sim" só no banner                      | Bloquear confirmação                         | A01 (confirmação é julgamento humano).                                                   |
| Constante `PRINT_TEMPLATE` + gate no validate | Flag de ambiente                             | Troca auditável em commit; impossível publicar v3 sem aprovação registrada.              |

## Riscos

- **Entre o deploy da tela e a aprovação da v3**, campos novos não sairiam na
  v2. Mitigação: a feature só vai para produção junto com a troca para v3
  (última task, depois do gate humano).
- **Rótulos mudam com o catálogo**: uma reimpressão depois de nova importação
  usa os rótulos novos. Aceito: os valores gravados não mudam.
- **Planilha editada fora do padrão** (colunas movidas): o script falha alto.
  O padrão está descrito na aba 00 da planilha.
- **Nomes impressos longos** (Q03) podem quebrar linha na célula de 3 colunas.
  Revisar no PDF sintético v3.

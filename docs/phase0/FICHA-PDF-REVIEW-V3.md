# T63 - Revisão do PDF da ficha v3 (sete pontos)

Rastreabilidade: [ADR 017](../adr/017-ficha-impressa-com-os-sete-pontos.md);
`T63`; `PIM-06..09` e `PLA-08`. A troca de template é a `T64` (`PIM-10`).

## Estado do gate

**Pendente.** O PDF da v3 foi gerado com dados fictícios e espera a aprovação
do PO. Enquanto o registro estiver pendente, todo pedido impresso continua no
template `ficha-canonical-v2`, aprovado em 31/08/2026
([revisão da v2](FICHA-PDF-REVIEW.md)), e a validação recusa a v3 no ponto de
troca.

**Quem assina é decisão do PO.** Na v2 assinaram Rose e Operação. Para a v3, o
PO indica os papéis e as pessoas; o registro aceita essa lista como vier, desde
que tenha ao menos um nome por papel.

## Pacote versionado

- `ficha-pdf-synthetic-v3.json`: pedido fictício no contrato `Order`, sem PII.
  Passa pelo mesmo `printSnapshot` da rota de impressão.
- `ficha-pdf-approval-v3.json`: versões, hashes da amostra, do HTML renderizado
  e do PDF, critérios e estado humano.
- `output/pdf/ficha-canonica-sintetica-v3.pdf`: o documento para revisão, A4
  paisagem, duas páginas.
- `scripts/ficha-pdf-review.mjs`: geração (`--generate --v3`) e validação
  fail-closed das duas versões (`--validate`).
- `test/ficha-pdf-review-v3.test.js` e `test/ficha-print-v3.test.js`: amostra,
  hashes, transição de aprovação e regras do template.

A amostra tem dois itens: uma camisa polo com os sete pontos e sem adicionais,
e uma regata com adicionais, "NAO APLICAVEL" nas mangas, estampa com texto
longo e sete tamanhos. O total é 52 peças. O pagamento está registrado, como
em todo pedido gerado; a entrega realizada ainda não, para mostrar como o papel
marca um dia vazio.

## Geração e verificação técnica

```bash
npm ci
npm run validate:ficha-pdf-review
node --test test/ficha-pdf-review-v3.test.js test/ficha-print-v3.test.js
```

`npm run generate:ficha-pdf-review -- --v3` só roda enquanto a v3 estiver
pendente; aprovada, o script recusa sobrescrever o PDF. O PDF não se reproduz
byte a byte em outra máquina (fontes e data de criação); por isso o registro
também trava o hash do HTML renderizado, que se reproduz. O PDF desta revisão
foi gerado no Dell, com Liberation Sans no lugar de Arial (mesmas medidas).

## Roteiro de revisão

1. Abrir o PDF em 100% e revisar as duas páginas.
2. Imprimir em A4 paisagem, sem ajustar escala, e conferir se texto, bordas e
   rodapé ficam legíveis e sem cortes.
3. Conferir, nesta ordem:
   - **Resumo:** Cliente, Entrega prometida, Total de peças e Tipo de serviço;
     Evento / Nome, Vendedor, Data do pedido e FAB. Sem valor nem forma de
     pagamento.
   - **Lastro do pedido:** Primeiro contato, Pagamento e Entrega realizada
     ("—", ainda não registrada). A Data do pedido e a Entrega prometida
     aparecem uma vez só, no Resumo.
   - **Itens:** os sete pontos numerados, na ordem Tipo de roupa, Cor,
     Quantidade, Estampa, Tecido, Tamanhos e Gola; a quantidade de cada item é
     a soma dos tamanhos (20 e 32).
   - **Adicionais:** a polo não tem o bloco; a regata mostra só Modelo, Manga
     direita, Manga esquerda e Viés gola, que são os preenchidos.
   - **Observações e total** (52 peças).
   - **Página 2:** os 14 campos de produção vazios, como na v2.
4. Registrar individualmente os seis critérios do gate: `legibility`,
   `content`, `order`, `grade`, `totals` e `printing`.
5. Se qualquer critério falhar, manter o gate pendente e pedir a correção: o
   PDF é gerado de novo enquanto pendente. Depois de aprovado, correção só em
   nova versão de template.

## Registro do aceite

Depois da revisão, na PR de aprovação:

1. Criar `docs/phase0/ficha-pdf-approved-evidence-v3.json` com
   `schemaVersion`, `task` (`T63`), `adr` (`017`), `syntheticOnly`, versões e
   hashes copiados do registro (`snapshotSha256`, `renderedHtmlSha256`,
   `artifactSha256`), `reviewedAt`, `reviewedBy`, os seis critérios `true` e ao
   menos uma referência visual sem PII no formato `git:<sha>` ou `silmer:<id>`.
2. Em `ficha-pdf-approval-v3.json`, mudar o estado inteiro para `approved`:
   `approved: true`, `reviewedBy` com a lista que o PO definiu
   (`[{ "role": "...", "name": "..." }]`), data ISO 8601, seis critérios `true`
   e `evidenceRef` apontando para o arquivo de evidência. Estado parcial
   falha.
3. `npm run validate:ficha-pdf-review` valida a transição completa.
4. Num commit próprio, o Tech Lead troca `PRINT_TEMPLATE` para `TEMPLATE_V3`
   em `modules/orders/src/print/index.js` (T64). Com o gate pendente, essa
   troca falha em `npm run validate:ficha-pdf-review` e em
   `test/ficha-print-switch.test.js`. No mesmo commit, a asserção da v2 em
   `test/order-routes.test.js` que procura "Entrega confirmada" passa a
   procurar "Entrega prometida", e o teste da v2 byte a byte em
   `test/ficha-print-switch.test.js` passa a ser pulado sozinho.

Não registrar telefone, e-mail, pedido real, assinatura manuscrita ou qualquer
outro dado pessoal na evidência.

# T63 - Revisão do PDF da ficha v3 (sete pontos)

Rastreabilidade: [ADR 017](../adr/017-ficha-impressa-com-os-sete-pontos.md);
`T63` e a revisão do PO (`T65`, `T67`, `T68` e `T69`); `PIM-06..09`, `PIM-11`,
`PIM-12` e `PLA-08`. A troca de template é a `T64` (`PIM-10`).

## Estado do gate

**Pendente.** O PDF da v3 foi gerado com dados fictícios e espera a assinatura
de Rose e Operação. Enquanto o registro estiver pendente, todo pedido impresso
continua no template `ficha-canonical-v2`, aprovado em 31/08/2026
([revisão da v2](FICHA-PDF-REVIEW.md)), e a validação recusa a v3 no ponto de
troca.

**Quem assina e como** (PO, 03/10/2026). Assinam só Rose e Operação, como na
v2. A assinatura é física: as duas assinam à mão a amostra v3 impressa, nas
linhas "Assinatura de Rose", "Assinatura de Operação" e "Data" da última
página. O registro espelha o da v2 (`reviewedBy` com `rose` e `operation`) e
marca a assinatura como física (`signature: "physical"`). Ninguém preenche o
registro antes de o PO confirmar que o papel foi assinado.

## Pacote versionado

- `ficha-pdf-synthetic-v3.json`: pedido fictício no contrato `Order`, sem PII.
  Passa pelo mesmo `printSnapshot` da rota de impressão.
- `ficha-pdf-approval-v3.json`: versões, hashes da amostra, do HTML renderizado
  e do PDF, critérios e estado humano.
- `output/pdf/ficha-canonica-sintetica-v3.pdf`: o documento para revisão, A4
  paisagem, três páginas: a página 1, uma página de continuação dos itens e o
  controle de produção.
- `scripts/ficha-pdf-review.mjs`: geração (`--generate --v3`) e validação
  fail-closed das duas versões (`--validate`).
- `test/ficha-pdf-review-v3.test.js` e `test/ficha-print-v3.test.js`: amostra,
  hashes, páginas planejadas, transição de aprovação e regras do template.

A amostra tem três itens: uma camisa polo com os sete pontos e sem adicionais;
uma regata com adicionais, "NÃO APLICÁVEL" nas mangas, estampa com texto longo
e sete tamanhos; e uma baby look, que já não cabe na página 1 e vai para a
página 2, de continuação. O total é 70 peças. O pagamento está registrado (por
ora, gerar o pedido implica pagamento); a entrega realizada ainda não, para
mostrar como o papel marca um dia vazio.

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

1. Abrir o PDF em 100% e revisar as três páginas.
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
     a soma dos tamanhos (20, 32 e 18).
   - **Adicionais:** a polo não tem o bloco; a regata mostra só Modelo, Manga
     direita, Manga esquerda e Viés gola, e a baby look só Viés gola, que são
     os preenchidos.
   - **Página 2 (continuação):** o mesmo cabeçalho, com o número do pedido e
     "Página 2 · continuação dos itens"; o Item 3; observações e total (70
     peças).
   - **Página 3 (controle de produção):** os 14 campos de produção vazios,
     como na v2, com o próprio cabeçalho.
   - **Rodapé:** "Página X de 3" em todas as páginas.
   - **Acentos:** todo rótulo impresso com acento, em todas as páginas e na faixa
     de amostra; nas mangas da regata, o valor gravado "NAO APLICAVEL" sai
     como "NÃO APLICÁVEL". O texto digitado sai como foi digitado.
4. Rose e Operação registram os seis critérios do gate (`legibility`,
   `content`, `order`, `grade`, `totals` e `printing`) e, se todos passarem,
   assinam à mão a amostra impressa, com a data, na última página.
5. Se qualquer critério falhar, a amostra não é assinada e o gate fica
   pendente: o PDF é gerado de novo enquanto pendente. Depois de aprovado,
   correção só em nova versão de template.

## Registro do aceite

Só depois que o PO confirmar que Rose e Operação assinaram o papel, o Tech
Lead registra a aprovação, na PR de aprovação:

1. Criar `docs/phase0/ficha-pdf-approved-evidence-v3.json` com
   `schemaVersion`, `task` (`T63`), `adr` (`017`), `syntheticOnly`, versões e
   hashes copiados do registro (`snapshotSha256`, `renderedHtmlSha256`,
   `artifactSha256`, o hash do PDF que foi impresso e assinado), `reviewedAt`,
   `reviewedBy`, os seis critérios `true`, `signature: "physical"`,
   `signedPaperKeptAt` (onde o papel assinado fica guardado) e ao menos uma
   referência visual sem PII no formato `git:<sha>` ou `silmer:<id>`.
2. Em `ficha-pdf-approval-v3.json`, mudar o estado inteiro para `approved`:
   `approved: true`, `reviewedBy` com `rose` e `operation` preenchidos, a data
   da assinatura em ISO 8601, `signedPaperKeptAt`, seis critérios `true` e
   `evidenceRef` apontando para o arquivo de evidência. Estado parcial falha,
   e outros assinantes ou assinatura que não seja física também.
3. `npm run validate:ficha-pdf-review` valida a transição completa.
4. Num commit próprio, o Tech Lead troca `PRINT_TEMPLATE` para `TEMPLATE_V3`
   em `modules/orders/src/print/index.js` (T64). Com o gate pendente, essa
   troca falha em `npm run validate:ficha-pdf-review` e em
   `test/ficha-print-switch.test.js`. No mesmo commit, a asserção da v2 em
   `test/order-routes.test.js` que procura "Entrega confirmada" passa a
   procurar "Entrega prometida", e o teste da v2 byte a byte em
   `test/ficha-print-switch.test.js` passa a ser pulado sozinho.

Não registrar telefone, e-mail, pedido real, foto ou cópia da assinatura
manuscrita nem qualquer outro dado pessoal na evidência: o papel assinado fica
guardado fora do repositório, no lugar que o registro indica.

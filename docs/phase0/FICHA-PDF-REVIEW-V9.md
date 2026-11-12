# Revisão visual da ficha v9

Rastreabilidade: [ADR 087](../adr/087-ficha-por-item-controle-no-verso.md),
[RFC 065](../rfc/065-ficha-por-item-controle-no-verso.md), `FPI-12` e `FPI-13`,
`FPI-T05` e `FPI-T06`. Base: [ADR 078](../adr/078-ficha-impressa-por-item.md) e
[revisão da v8](FICHA-PDF-REVIEW-V8.md). O pacote usa só dados sintéticos.

## Estado

**Aguardando aprovação do PO.** A v9 (`ficha-canonical-v9`) ainda não tem
aprovação provisória: o registro
[`ficha-pdf-approval-v9.json`](ficha-pdf-approval-v9.json) trava os hashes da
amostra, do HTML e do PDF com `provisionalApproval.status` pendente e a
assinatura física pendente (`FPI-T03`). `PRINT_TEMPLATE` continua em
`ficha-canonical-v8`, aprovada em 12/11/2026; o validador só aceita a v9
selecionada depois da aprovação registrada (`FPI-13`). As versões v2 a v8, seus
PDFs, amostras, aprovações e hashes não foram alterados. A produção continua
condicionada à assinatura física de Rose e Operação.

## Pedido que originou a v9

Em 12/11/2026, o cliente pediu, por meio do PO, que o Controle de produção vá
para a página 2 do item, que "Observações e anotações de pedido" assuma o lugar
dele na página 1 e que a página 1 encolha as observações e a página 2 amplie o
Controle e a arte. Como a v8 já estava aprovada, o desenho virou um template
novo (ADR 087).

## O que muda da v8 para a v9

| Onde                   | v8                                                       | v9                                                                                                |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Folhas por item        | Uma folha A4 retrato                                     | Duas folhas A4 retrato consecutivas (frente e verso)                                              |
| Ordem das folhas       | Itens e, no fim, a folha de observações                  | Item 1 página 1, item 1 página 2, item 2 página 1, …; depois as folhas extras de continuação      |
| Página 1, fim da folha | Controle de produção com Anotações e arte em metades     | "Observações e anotações do pedido": lista numerada em tipo reduzido e linhas pautadas            |
| Página 2               | Não existe                                               | Cabeçalho, painel curto "Dados do pedido", Controle de produção expandido e painel "Arte"         |
| Controle de produção   | 7 campos no pé da folha do item                          | Os mesmos 7 campos na página 2, mais altos e com mais respiro                                     |
| Arte                   | Caixa em metade da largura, ao lado das Anotações        | Painel de largura total, que ocupa o espaço vertical restante                                     |
| Anotações              | Sete linhas pautadas ao lado da arte                     | Linhas pautadas dentro de Observações e anotações (página 1), no mínimo três; nenhuma na página 2 |
| Observações do pedido  | Só na folha final, com apontamento nas folhas de item    | Na página 1 do item; o que não couber continua na folha extra "Observações (continuação)"         |
| Apontamento            | "Observações do pedido na folha N" em cada folha de item | "Controle de produção e arte na folha N de M" em "Dados do pedido" da página 1                    |
| Identificação          | Cabeçalho e "Dados do pedido" completos                  | Cabeçalho repetido nas duas folhas; "Dados do pedido" curto na página 2                           |
| `PRINT_TEMPLATE`       | Selecionada (aprovação de 12/11/2026)                    | Não selecionada até a aprovação do PO                                                             |

Não mudam: Poppins embutida, tokens do `design.md`, grade de 4 px e de 12
colunas, piso de 13 px, "Dados do item", grade de tamanhos com a linha
"Conferido", rótulos (Modelo e Detalhe do modelo), conteúdo de fábrica,
bloqueio de texto financeiro (`422`, `PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED`) e
as regras de `artPreview`, exceto a divisão em metades. Nenhum valor em dinheiro
entra na ficha.

## Como a folha é montada

Em linhas gerais, como na v8: o documento não tem script, e o planejador de
folhas da v9 estima as alturas no servidor para decidir, por item, quantas
observações cabem na página 1, quantas linhas pautadas sobram (no mínimo três)
e quais linhas seguem para a folha de continuação. Uma estimativa errada
transborda para outra página, nunca corta conteúdo. A página 2 não depende de
estimativa de texto: o painel "Arte" recebe o espaço vertical que o Controle de
produção deixa. A folha de estilos é única e estática, com as fontes Poppins
embutidas; a CSP da rota de impressão admite o hash dela e `data:` em
`font-src`, somente nessa rota (`docker/nginx.conf`). O planejador é
`modules/orders/src/print/ficha-v9-pages.js` (`planFichaV9`); o hash da folha
de estilos na CSP é `sha256-DlcY4MjnLwgEQjLFGi06vRFGyvucbBM9PT3Nf2tUiiM=`.

## Pacote sintético

- [`ficha-pdf-synthetic-v9.json`](ficha-pdf-synthetic-v9.json): pedido sintético
  com um item por público, textos longos, instruções complementares do
  atendimento, prévia da arte em parte dos itens e uma observação longa o
  bastante para exercitar a continuação: quatro itens (um por público), 16
  tamanhos no item 4, prévia da arte nos itens 1 e 4 e 14 observações, que
  geram a folha de continuação.
- [`../../output/pdf/ficha-canonica-sintetica-v9.pdf`](../../output/pdf/ficha-canonica-sintetica-v9.pdf):
  folhas A4 retrato, duas por item, mais as folhas de continuação: nove folhas (oito de itens e uma de
  observações em continuação).
- [`ficha-pdf-approval-v9.json`](ficha-pdf-approval-v9.json): registro da
  aprovação, com os hashes da amostra, do HTML e do PDF. Hashes: snapshot
  `8b6ab8a1…22e18d`, HTML `3950bba0…af4f`, PDF `a08cd4f3…c3e8`.
- `scripts/ficha-pdf-preview-v9.mjs` gera o PDF e trava os hashes enquanto a
  revisão está pendente; recusa regenerar depois da aprovação.
- `scripts/ficha-pdf-review-v9.mjs` valida amostra, HTML, PDF, a revisão do PO
  e a assinatura física pendente.
- `test/ficha-print-v9.test.js` cobre conteúdo, ordem dos blocos, contagem de
  folhas, continuação das observações, rótulos, campos, XSS e o gate;
  `test/e2e/ficha-v9-layout.spec.js` imprime no Chromium os casos comum, pior
  caso (observação longa) e vários itens, e confere uma página A4 por folha, o
  piso de 13 px e a ausência de "Anotações" na página 2. Resultados: a
  preencher pelo orquestrador.

Cenários que a revisão do PO precisa ver: pedido de um item e de vários;
pedido sem observações (nenhuma folha extra, nenhum aviso); observação longa
(continuação com aviso); item com e sem arte anexada.

## Como a aprovação será registrada

O PO (Rômulo Sutil Corrêa) revisa a amostra e registra, em
`ficha-pdf-approval-v9.json`, `status` `approved`, `approved: true`, o nome e a
data em `provisionalApproval`, ligados aos hashes da amostra, do HTML e do PDF.
Um commit à parte troca `PRINT_TEMPLATE` para `ficha-canonical-v9`
(`FPI-T06`). Rose e Operação assinam a amostra impressa antes da produção
(`FPI-T03`). Qualquer correção do layout depois da aprovação exige uma nova
versão do template.

Rollback da troca: reverter só o commit que mudou `PRINT_TEMPLATE`. A v8, com a
aprovação provisória do PO, volta a imprimir; o registro da aprovação da v9 e as
amostras ficam como estão. Nenhum dado de pedido é alterado, porque a ficha é
gerada na hora da impressão.

```bash
node --test test/ficha-print-v9.test.js
npm run validate:ficha-pdf-review
```

# Revisão visual da ficha v8

Rastreabilidade: [ADR 078](../adr/078-ficha-impressa-por-item.md),
[RFC 061](../rfc/061-ficha-impressa-por-item.md), `FPI-01` a `FPI-11`,
`FPI-T01`. O pacote usa só dados sintéticos.

## Estado

**Preparada, não selecionada, com a revisão do PO pendente.** O registro
[`ficha-pdf-approval-v8.json`](ficha-pdf-approval-v8.json) trava os hashes da
amostra, do HTML e do PDF com `provisionalApproval.status`
`pending-po-review` e a assinatura física de Rose e Operação pendente.
`PRINT_TEMPLATE` continua `ficha-canonical-v6`: a v8 é endereçável e testável
(`renderOrderFicha(order, TEMPLATE_V8)`), mas nenhum pedido imprime nela. O
validador (`validateFichaPrintSwitch`) recusa `PRINT_TEMPLATE` igual à v8
enquanto a aprovação não estiver registrada. As versões v2 a v7, seus PDFs,
amostras, aprovações e hashes não foram alterados.

## O que muda da v7 para a v8

| Onde                  | v7                                | v8                                                                    |
| --------------------- | --------------------------------- | --------------------------------------------------------------------- |
| Formato               | A4 paisagem, itens agrupados      | A4 retrato, uma folha por item                                        |
| Ponto 1               | Tipo de roupa                     | Modelo                                                                |
| `item.modelo`         | Modelo, em Adicionais             | Detalhe do modelo                                                     |
| Controle de produção  | 14 campos em página própria       | 7 campos em cada folha, com Anotações                                 |
| Cores da arte         | 7 campos                          | Removidas                                                             |
| Grade                 | Tamanhos e quantidades            | Linha Conferido em branco para a contagem                             |
| Cabeçalho             | Pedido, previsão e item           | Faixa com o público; marca, pedido e datas                            |
| Campos                | Texto corrido                     | Rótulo pequeno sobre valor em negrito, na escala de 4 px do design.md |
| Quantidade divergente | Linha em Adicionais               | Não vai ao papel                                                      |
| Observações           | Última página comercial           | Só na folha final, com apontamento nas folhas                         |
| Arte                  | Não havia                         | Prévia em metade da largura, ao lado das Anotações                    |
| Instruções do bot     | Fora do papel                     | Impressas e identificadas como complementares                         |
| Visual                | Arial, cartões, 5,25 pt no mínimo | Design system do CRM, 13 px no mínimo                                 |
| Rodapé                | Sem versão                        | Folha, versão do pedido e hora da impressão                           |

Nenhum valor em dinheiro entra na ficha. Observação editável com indicação
financeira explícita bloqueia a geração para revisão no CRM (`422`,
`PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED`); dado do atendimento com valor sai
mascarado, com aviso para conferir no CRM. O título "Lastro do pedido" sai; os
campo Entregue em continua; Primeiro contato, FAB e "Arte do pedido" saem.

## Como a folha é montada

O documento não tem script. `modules/orders/src/print/ficha-v8-pages.js` estima
as alturas no servidor e decide, por item, quantas observações cabem, se a folha
usa o modo compacto e quais linhas seguem para a folha de continuação. Uma
estimativa errada transborda para outra página, nunca corta conteúdo. A folha de
estilos é única e estática, com as fontes Poppins embutidas; a CSP da rota de
impressão admite o hash dela e `data:` em `font-src`, somente nessa rota
(`docker/nginx.conf`).

## Pacote sintético

- [`ficha-pdf-synthetic-v8.json`](ficha-pdf-synthetic-v8.json): pedido sintético
  com um item por público, 16 tamanhos, detalhe do modelo, gola "NÃO APLICÁVEL",
  textos longos, instruções complementares do atendimento e prévia da arte nos
  itens 1 e 4 (itens 2 e 3 mostram "Sem arte anexada").
- [`../../output/pdf/ficha-canonica-sintetica-v8.pdf`](../../output/pdf/ficha-canonica-sintetica-v8.pdf):
  cinco folhas A4 retrato, quatro de itens e uma de observações.
- `scripts/ficha-pdf-preview-v8.mjs` gera o PDF e trava os hashes enquanto a
  revisão está pendente; recusa regenerar depois da aprovação.

Revisão do PO em 2026-11-11: o cabeçalho passou a destacar o público, a ficha
perdeu Primeiro contato, FAB, passos numerados, caixas, o título "Tamanhos" e
o aviso de divergência, as observações foram para a folha final e a prévia da
arte entrou ao lado das Anotações (FPI-11). A v8 continua sem aprovação
registrada, por isso os hashes mudaram no lugar.

- `scripts/ficha-pdf-review-v8.mjs` valida amostra, HTML, PDF, revisão do PO
  pendente e assinatura física pendente.
- `test/ficha-print-v8.test.js` cobre conteúdo, rótulos, campos, avisos, XSS e o
  gate; `test/e2e/ficha-v8-layout.spec.js` imprime no Chromium os casos comum,
  pior caso, limite dos campos e 50 itens, e confere uma página A4 por folha.

## Como aprovar (pendente)

Nada foi aprovado nem assinado. Quando o PO revisar a amostra, ele registra em
`ficha-pdf-approval-v8.json` o `status` `approved`, `approved: true`, o nome e a
data em `provisionalApproval`; só então um commit à parte pode trocar
`PRINT_TEMPLATE` para `ficha-canonical-v8` (`FPI-T02`). Rose e Operação assinam
a amostra impressa antes da produção (`FPI-T03`). Qualquer correção do layout
antes da aprovação regenera o pacote; depois, exige uma nova versão.

```bash
node --test test/ficha-print-v8.test.js
npm run validate:ficha-pdf-review
```

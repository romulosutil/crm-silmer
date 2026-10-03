# Revisão visual da ficha v5

Rastreabilidade: [ADR 020](../adr/020-tecnica-por-item-e-arte-do-pedido.md),
[RFC 008](../rfc/008-rotulos-da-ficha-tecnica-e-arte.md), `TEC-07`, T86.
O pacote usa só dados sintéticos.

## Estado

**Aguardando a revisão do PO.** O registro
[`ficha-pdf-approval-v5.json`](ficha-pdf-approval-v5.json) trava os hashes da
amostra, do HTML e do PDF com `provisionalApproval.status` igual a
`pending-po-review`. Enquanto isso, `PRINT_TEMPLATE` continua
`ficha-canonical-v4`; o validador recusa a troca para a v5 antes da aprovação
do PO. Rose e Operação ainda precisam revisar e assinar fisicamente a amostra
impressa antes de qualquer uso em produção. A v2, a v3, a v4, seus PDFs e seus
hashes não foram alterados.

## O que mudou da v4 para a v5

| Onde            | v4                                                             | v5                                                                                                        |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Resumo          | Cliente, Entrega prometida, Total de peças, Serviços dos itens | Cliente, Entrega prometida, Total de peças                                                                |
| Apoio           | Evento / Nome, …, Técnica da arte (referência)                 | Nome do pedido, Vendedor, Data do pedido, FAB                                                             |
| Lastro          | Primeiro contato, Pagamento, Entrega realizada                 | Primeiro contato, Pago em, Entregue em                                                                    |
| Arte            | “Origens da arte do pedido”, só quando marcada                 | “Arte do pedido” em toda página comercial: O cliente envia a arte, A Silmer cria a arte ou Sem estampa    |
| Ponto 4 do item | Estampa                                                        | Técnica                                                                                                   |
| Ponto 7 do item | Definição da gola                                              | Gola                                                                                                      |
| Rodapé do item  | Tipo de serviço e adicionais                                   | Só os adicionais preenchidos: Estampa (referência), Cor do tecido — frente/costas/mangas, Viés das mangas |
| Produção        | Cores e arte: Cores Frente, Costas…                            | Cores da arte: Nº de cores — frente, costas…                                                              |

## Pacote sintético

- [`ficha-pdf-synthetic-v5.json`](ficha-pdf-synthetic-v5.json): dois itens
  com técnicas diferentes (bordado e sublimação total), as duas origens da
  arte, estampa de referência, cores do tecido por parte e uma gola lida do
  `vies_gola` legado.
- [`../../output/pdf/ficha-canonica-sintetica-v5.pdf`](../../output/pdf/ficha-canonica-sintetica-v5.pdf):
  duas páginas A4 paisagem; a primeira com pedido e itens, a segunda com os 14
  campos de produção vazios e as linhas de assinatura da amostra.
- `scripts/ficha-pdf-preview-v5.mjs` gera a amostra enquanto a revisão está
  pendente e se recusa a sobrescrever o PDF depois da aprovação.
- `scripts/ficha-pdf-review-v5.mjs` valida amostra, HTML, PDF, revisão do PO
  e assinatura física pendente; `test/ficha-print-v5.test.js` cobre rótulos,
  arte em toda página, adicionais e grade grande.

A paginação usa a mesma estimativa da v3 para a linha de adicionais. Ensaios
sintéticos com seis itens e adicionais longos, textos de 200 caracteres e uma
grade de 40 tamanhos geraram exatamente as páginas planejadas, com cabeçalho
em toda continuação e nenhum item cortado.

## Para aprovar

O PO confere o PDF. Com a aprovação, o Tech Lead grava `status: approved`,
`approved: true`, nome e data em `provisionalApproval`, troca
`PRINT_TEMPLATE` para `ficha-canonical-v5` e roda:

```bash
node --test test/ficha-print-v5.test.js
npm run validate:ficha-pdf-review
```

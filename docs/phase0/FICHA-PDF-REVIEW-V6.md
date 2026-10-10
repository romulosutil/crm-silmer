# Revisão visual da ficha v6

Rastreabilidade: [ADR 025](../adr/025-itens-por-publico.md),
[RFC 013](../rfc/013-itens-por-publico.md), `PUB-07`, T100. O pacote usa só
dados sintéticos.

## Estado

**Aprovada provisoriamente pelo PO para desenvolvimento e cloud-dev em
06/10/2026.** O registro
[`ficha-pdf-approval-v6.json`](ficha-pdf-approval-v6.json) trava os hashes da
amostra, do HTML e do PDF e grava a aprovação do PO; `PRINT_TEMPLATE` passou a
`ficha-canonical-v6`. O validador recusaria a troca sem essa aprovação, e o
script de pré-visualização se recusa a sobrescrever o PDF aprovado. Rose e
Operação ainda precisam revisar e assinar fisicamente a amostra impressa antes
de qualquer uso em produção. A
v2, a v3, a v4, a v5, seus PDFs e seus hashes não foram alterados.

## O que mudou da v5 para a v6

| Onde             | v5                     | v6                                                                                                 |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| Número do item   | "Item" e o número      | "Item", o número e o público num selo (Masculino, Feminino, Infantil ou Unissex), quando informado |
| Ponto 5 do item  | Tecido                 | Modelo de malha                                                                                    |
| Rodapé do item   | Adicionais preenchidos | "Quantidade informada" antes dos adicionais, só quando difere da soma dos tamanhos                 |
| Coluna do número | 36 px                  | 48 px, para o selo do público                                                                      |

O resumo, o lastro, a arte do pedido, os sete pontos, a paginação e o controle
de produção são os da v5.

## Pacote sintético

- [`ficha-pdf-synthetic-v6.json`](ficha-pdf-synthetic-v6.json): um pedido
  dividido em quatro públicos — camiseta masculina, baby look feminina com
  quantidade informada (12) diferente da soma dos tamanhos (10), camiseta
  infantil com tamanhos numéricos e um boné trucker unissex com gola "NÃO
  APLICÁVEL" — e as duas origens da arte.
- [`../../output/pdf/ficha-canonica-sintetica-v6.pdf`](../../output/pdf/ficha-canonica-sintetica-v6.pdf):
  três páginas A4 paisagem; duas comerciais, com dois itens cada e o
  cabeçalho repetido na continuação, e o controle de produção com os 14 campos
  vazios e as linhas de assinatura da amostra.
- `scripts/ficha-pdf-preview-v6.mjs` gera a amostra enquanto a revisão está
  pendente e se recusa a sobrescrever o PDF depois da aprovação.
- `scripts/ficha-pdf-review-v6.mjs` valida amostra, HTML, PDF, revisão do PO
  e assinatura física pendente; `test/ficha-print-v6.test.js` cobre o público,
  o novo rótulo, a quantidade informada, fichas antigas e a trava da troca.

## Como aprovar

Para aprovar a v6 para desenvolvimento e cloud-dev, o PO registra em
`ficha-pdf-approval-v6.json` o `status` `approved`, `approved: true`, o nome e
a data em `provisionalApproval`; o mesmo commit troca `PRINT_TEMPLATE` para
`ficha-canonical-v6`. Qualquer correção do layout antes disso regenera o
pacote; depois, exige uma nova versão.

```bash
node --test test/ficha-print-v6.test.js
npm run validate:ficha-pdf-review
```

## Renumeração (06/10/2026)

Na integração com o `master`, que já usava a ADR 022 e a tarefa T95, a
decisão passou a ADR 025 e a tarefa a T100. Só os metadados `adr` e `task` da
amostra mudaram: o HTML renderizado e o PDF aprovados pelo PO têm os mesmos
hashes, e o registro trava o novo hash do JSON da amostra.

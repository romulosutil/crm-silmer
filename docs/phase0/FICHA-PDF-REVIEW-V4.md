# Revisão visual da ficha candidata v4

Rastreabilidade: [ADR 019](../adr/019-ficha-espelhada-e-sinais-operacionais.md),
`REV-01`–`REV-05`, T78. Base visual: os dois PDFs fornecidos pelo PO em
03/10/2026. O arquivo com pedido real `25-CRM-ficha-v3.pdf` fica fora do
repositório; o pacote abaixo usa só dados sintéticos.

## Estado

**Candidata para revisão.** `PRINT_TEMPLATE` continua
`ficha-canonical-v3`, com sua aprovação provisória e seu gate de assinatura
física próprios. A v4 não é impressa pela rota de pedidos enquanto o PO não
aprovar a amostra e enquanto Rose e Operação não cumprirem a revisão aplicável
para produção. A v2/v3, os PDFs e os hashes dessas versões não foram alterados.

## Pacote sintético

- [`ficha-pdf-synthetic-v4.json`](ficha-pdf-synthetic-v4.json): dois itens,
  serviços diferentes, as duas origens da estampa e um `vies_gola` legado.
- [`../../output/pdf/ficha-canonica-sintetica-v4.pdf`](../../output/pdf/ficha-canonica-sintetica-v4.pdf): duas páginas A4 paisagem. A primeira contém pedido e itens; a segunda, 14 campos de produção vazios e linhas de assinatura da amostra.
- `scripts/ficha-pdf-preview-v4.mjs`: reproduz a amostra sem tocar nos
  artefatos v2/v3. `test/ficha-print-v4.test.js` verifica separação de versões,
  rótulos, serviço por item, legado e páginas de continuação.

Para gerar em ambiente com Chromium do Playwright:

```bash
node scripts/ficha-pdf-preview-v4.mjs
node --test test/ficha-print-v4.test.js
npm run validate:ficha-pdf-review
```

## Conferência solicitada

1. Comparar a primeira página com a ficha sintética fornecida pelo PO:
   hierarquia, sete pontos, totais, serviços por item, origem da arte e
   definição da gola.
2. Conferir que “Modelo” e “Viés gola” não aparecem, mas o valor histórico de
   gola ainda é legível; as mangas não aplicáveis saem com acento.
3. Conferir lastro: data do pedido e entrega prometida no resumo; primeiro
   contato, pagamento e entrega realizada na faixa própria, inclusive vazio.
4. Conferir as 14 linhas da produção vazias e a legibilidade em A4 paisagem
   impresso a 100%.
5. Num pedido com mais itens, conferir cabeçalhos de continuação e controle de
   produção como última página. Um ensaio sintético com seis itens gerou
   quatro páginas: três comerciais e a última de produção.

O PO decide se esta revisão substitui a v3 ativa em desenvolvimento. Depois
da decisão, criar registro de aprovação versionado com hashes e gate próprio,
atualizar o seletor único da impressão e colher as assinaturas físicas antes
do uso em produção. O envio ao Dropbox e o aviso a Rose são fluxos separados.

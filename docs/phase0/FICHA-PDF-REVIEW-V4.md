# Revisão visual da ficha candidata v4

Rastreabilidade: [ADR 019](../adr/019-ficha-espelhada-e-sinais-operacionais.md),
`REV-01`–`REV-05`, T78. Base visual: os dois PDFs fornecidos pelo PO em
03/10/2026. O arquivo com pedido real `25-CRM-ficha-v3.pdf` fica fora do
repositório; o pacote abaixo usa só dados sintéticos.

## Estado

**Aprovada provisoriamente para desenvolvimento e cloud-dev em 03/10/2026.**
O PO autorizou a equipe a decidir o design da ficha como espelho da tela e,
depois de revisar visualmente as duas páginas sintéticas, a decisão delegada
ativou `PRINT_TEMPLATE = ficha-canonical-v4` em testes. O registro
[`ficha-pdf-approval-v4.json`](ficha-pdf-approval-v4.json) trava os hashes
da amostra, do HTML e do PDF. Rose e Operação ainda precisam revisar e assinar
fisicamente a amostra impressa antes de qualquer uso em produção. A v2/v3,
seus PDFs e seus hashes não foram alterados.

O PDF sintético v3 entregue pelo PO mostra cinco campos no lastro. O PDF do
pedido real, a ADR 017 e a ficha v3 versionada mostram três no lastro. O PO
delegou a decisão final de layout para esta etapa: **primeiro contato,
pagamento e entrega realizada ficam no lastro**; data do pedido e entrega
prometida ficam no resumo. A escolha preserva a ficha real aprovada e evita
duplicar datas no papel.

## Pacote sintético

- [`ficha-pdf-synthetic-v4.json`](ficha-pdf-synthetic-v4.json): dois itens,
  serviços diferentes, as duas origens da arte no nível do pedido, técnica da arte como
  referência, cores específicas de frente e costas e um `vies_gola` legado.
- [`../../output/pdf/ficha-canonica-sintetica-v4.pdf`](../../output/pdf/ficha-canonica-sintetica-v4.pdf): duas páginas A4 paisagem. A primeira contém pedido e itens; a segunda, 14 campos de produção vazios e linhas de assinatura da amostra.
- `scripts/ficha-pdf-preview-v4.mjs`: gerou a amostra antes da aprovação.
  O PDF agora fica travado por hash; qualquer correção exige uma nova versão.
- `scripts/ficha-pdf-review-v4.mjs`: valida amostra, HTML, PDF, aprovação
  provisória e gate físico ainda pendente. O comando de revisão valida também
  v2/v3. `test/ficha-print-v4.test.js` verifica separação de versões, rótulos,
  serviço por item, referências e páginas de continuação.

Para validar o pacote aprovado provisoriamente:

```bash
node --test test/ficha-print-v4.test.js
npm run validate:ficha-pdf-review
```

## Conferência solicitada

1. Comparar a primeira página com a ficha sintética fornecida pelo PO:
   hierarquia, sete pontos, totais, serviços por item, origens da arte do pedido e
   definição da gola.
2. Conferir que “Modelo” e “Viés gola” não aparecem, mas o valor histórico de
   gola ainda é legível; as cores de frente e costas permanecem visíveis nos
   adicionais mesmo quando há cor geral. As mangas não aplicáveis saem com acento.
   A técnica da arte aparece como referência global, sem substituir o serviço
   específico de cada item.
3. Conferir lastro: data do pedido e entrega prometida no resumo; primeiro
   contato, pagamento e entrega realizada na faixa própria, inclusive vazio.
4. Conferir as 14 linhas da produção vazias e a legibilidade em A4 paisagem
   impresso a 100%.
5. Num pedido com mais itens, conferir cabeçalhos de continuação e controle de
   produção como última página. Um ensaio sintético com seis itens gerou
   quatro páginas: três comerciais e a última de produção.

Após incluir a referência de técnica e as cores por parte, um ensaio sintético
com quatro itens, estampas longas e ambas as origens gerou quatro páginas:
três comerciais com cabeçalho e a última de produção, sem item cortado.
Uma grade sintética de 100 tamanhos foi dividida em 15 partes: o total do item
aparece só na primeira; as demais remetem a ela sem repetir a quantidade.
As continuações repetem a origem da arte do pedido para páginas que circulem
separadas, sem atribuí-la a cada item. O tipo de serviço usa texto maior e
paginação recalibrada para preservar a leitura dos serviços longos.
Dois serviços com quase 200 caracteres cada foram impressos em três páginas:
duas comerciais com cabeçalho e a última de produção; o resumo indica
“2 serviços · ver itens” e conserva os textos completos nos respectivos itens.

Antes de ativar a v4 para pedidos antigos, o vendedor deve revisar itens cujo
`modelo` histórico descrevia o corte e validar essa informação no campo
**Tipo de roupa**. A v4 não imprime nem migra `modelo` automaticamente.

A decisão provisória para testes está registrada. A revisão física por Rose e
Operação permanece pendente antes da produção. O envio dos arquivos da arte,
hoje guardados no RustFS
([ADR 021](../adr/021-arquivos-da-arte-no-rustfs.md)), e o aviso a Rose são
fluxos separados.

# ADR 087 — Ficha por item com o controle de produção no verso

Data: 12/11/2026. Status: aceita.
Decisores: proprietário do produto, em 12/11/2026, trouxe o pedido do cliente e
a ordem das folhas. Tech Lead definiu o template novo e a ordem de ativação.
Proposta: [RFC 065](../rfc/065-ficha-por-item-controle-no-verso.md).
Base: [ADR 078](078-ficha-impressa-por-item.md) e
[RFC 061](../rfc/061-ficha-impressa-por-item.md).
Requisitos [FPI-12 e FPI-13](../../.specs/features/ficha-por-item/spec.md);
tarefas [FPI-T05 e FPI-T06](../../.specs/features/ficha-por-item/tasks.md).
Pacote de revisão: [FICHA-PDF-REVIEW-V9](../phase0/FICHA-PDF-REVIEW-V9.md).
PR: [romulosutil/crm-silmer#368](https://github.com/romulosutil/crm-silmer/pull/368). Sem issue específica.
Não supersede a ADR 078 por inteiro: altera, só para o template v9, o layout da
folha do item e o FPI-02 (seção "O que muda na ADR 078").

## Contexto

A ADR 078 criou a ficha `ficha-canonical-v8`, uma folha A4 retrato por item com
o Controle de produção, as Anotações e a caixa da arte (em metade da largura) no
pé da folha, e as observações do pedido numa folha final (FPI-02). A v8 foi
aprovada pelo PO em 12/11/2026 e é o `PRINT_TEMPLATE` atual. O registro dessa
aprovação exige uma nova versão do template para qualquer correção de layout.

No mesmo dia, o cliente pediu que o Controle de produção vá para a página 2 do
item, que "Observações e anotações de pedido" assuma o lugar dele na página 1,
que essas observações diminuam para caber e que o Controle de produção e a arte
cresçam na página 2.

## Decisão

1. **Duas folhas por item.** O novo template `ficha-canonical-v9` imprime duas
   folhas A4 retrato consecutivas por item (frente e verso): item 1 página 1,
   item 1 página 2, item 2 página 1, e assim por diante, seguidas das folhas
   extras de continuação, se houver. "Folha N de M" conta todas. O cabeçalho
   (faixa do público com "Item N de M", marca, Pedido e datas) repete nas duas.
2. **Página 1.** Cabeçalho; "Dados do pedido", com o apontamento "Controle de
   produção e arte na folha N de M"; "Dados do item", idêntico à v8; e, onde a
   v8 tinha o Controle, o painel "Observações e anotações do pedido".
3. **Observações e anotações do pedido.** Lista numerada das observações do
   pedido, com as instruções complementares do atendimento como na v8, em tipo
   reduzido com piso de 13 px, seguida de linhas pautadas para anotação à mão
   que ocupam o espaço restante, com no mínimo três linhas. Observação nunca é
   cortada: o que não couber na página 1 continua numa folha extra final,
   "Observações (continuação)", com aviso no painel. Sem sobras, não há folha
   extra nem aviso.
4. **Página 2.** Cabeçalho; painel curto "Dados do pedido", para identificar a
   folha solta; "Controle de produção" expandido, com os mesmos sete campos à
   mão da v8, mais altos e com mais respiro; e painel "Arte" de largura total,
   que ocupa todo o espaço vertical restante (`object-fit: contain`, espaço
   tracejado "Sem arte anexada" sem imagem, legenda "Estampa (referência)" sob
   a caixa). As "Anotações" pautadas saem da página 2.
5. **O que se mantém da v8.** Poppins embutida, tokens do `design.md`, grade de
   4 px e de 12 colunas, piso de 13 px, FPI-03 a FPI-10 e as regras de
   `artPreview` (FPI-11), exceto a divisão da área em metades.
6. **Imutabilidade e ativação.** A v9 é um arquivo novo. As fichas v2 a v8 e
   seus hashes não mudam. `PRINT_TEMPLATE` passou à v9 depois da aprovação
   provisória do PO (12/11/2026) ligada ao hash das amostras v9 (mesmo gate de
   FPI-09); a troca aconteceu em commit próprio (FPI-T06). A assinatura física de Rose e Operação
   continua sendo gate de produção.

## O que muda na ADR 078

| Item da ADR 078 ou da spec                                               | Efeito da ADR 087                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 e 2 (uma folha por item, ordem dos blocos, observações na folha extra) | Na v9, cada item tem duas folhas, com Observações e anotações na página 1 e Controle de produção e arte na página 2. FPI-02 deixa de valer na v9. |
| 8, só a frase sobre as anotações pautadas ocupando o espaço restante     | Na v9, as linhas pautadas ficam no painel "Observações e anotações do pedido", na página 1, e não existem na página 2.                            |
| FPI-11, só a divisão do Controle em duas metades (Anotações e arte)      | Na v9, a arte ocupa a largura inteira da página 2; o contrato de `artPreview` não muda.                                                           |
| 3 a 7, 9 e 10                                                            | Continuam valendo: conferência à mão, rótulos, campos de produção, conteúdo de fábrica e o gate de ativação, agora também para a v9.              |

A ADR 078 e a RFC 061 continuam valendo para a v8; seus corpos não são editados. Com a v9
selecionada, a v8 passa a ser o template anterior, como v2 a v7, e segue
endereçável para rollback.

## Alternativas descartadas

- **Alterar a v8 no lugar:** a v8 está aprovada e travada por hash; o registro
  exige uma nova versão para qualquer correção de layout.
- **Manter uma folha por item, reduzindo tudo:** a folha já está no piso de
  13 px, e o pedido era ampliar o controle e a arte.
- **Folha única de controle por pedido:** volta ao controle do pedido todo,
  recusado na RFC 061, e separa a arte do item.
- **Manter as observações só na folha final (FPI-02):** o cliente pediu o bloco
  na página 1 do item.

## Consequências

- Um pedido com M itens imprime pelo menos 2M folhas lógicas, mais as folhas de
  continuação. Em duplex, cada item ocupa uma folha física; sem duplex, o
  consumo de papel dobra em relação à v8.
- As observações ficam junto do item. Observações muito longas continuam numa
  folha extra, com aviso no painel; a folha final deixa de ser regra.
- A folha de verso identifica o pedido e o item por conta própria e pode ser
  impressa à parte.
- Não há migração, mudança de API, de snapshot nem do bot.
- A folha de estilos da v9 exige o hash admitido na CSP da rota de impressão.
- Tela e papel não divergem em vocabulário, que é o mesmo na v8 e na v9.
- Reverter a troca é reverter só o commit que muda `PRINT_TEMPLATE`, sem
  migração; o registro de aprovação e as amostras da v9 permanecem.

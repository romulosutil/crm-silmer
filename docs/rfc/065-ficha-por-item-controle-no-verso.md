# RFC 065 — Ficha por item com o controle de produção no verso

Data: 12/11/2026. Status: decidida na [ADR 087](../adr/087-ficha-por-item-controle-no-verso.md);
template em revisão, aguardando a aprovação do PO das amostras.
Responsável pela proposta: Tech Lead. Aprovador: proprietário do produto.
Pedido do cliente trazido pelo proprietário em 12/11/2026.
Requisitos [FPI-12 e FPI-13](../../.specs/features/ficha-por-item/spec.md);
tarefas [FPI-T05 e FPI-T06](../../.specs/features/ficha-por-item/tasks.md).
Pacote de revisão: [FICHA-PDF-REVIEW-V9](../phase0/FICHA-PDF-REVIEW-V9.md).
PR: [romulosutil/crm-silmer#368](https://github.com/romulosutil/crm-silmer/pull/368). Sem issue específica.
Antecedentes: [RFC 061](061-ficha-impressa-por-item.md) e
[ADR 078](../adr/078-ficha-impressa-por-item.md).

## Contexto

A ficha v8 (`ficha-canonical-v8`, ADR 078) imprime uma folha A4 retrato por
item. No pé de cada folha fica o painel "Controle de produção", com os sete
campos à mão, as "Anotações" pautadas e a caixa da arte em metade da largura. As
observações do pedido ficam só numa folha final (FPI-02), apontadas por uma
linha em cada folha de item. A v8 foi aprovada pelo PO em 12/11/2026 e é o
`PRINT_TEMPLATE` atual; o registro de aprovação diz que qualquer correção do
layout depois dela exige uma nova versão do template.

Em 12/11/2026, o cliente pediu três mudanças:

1. O bloco "Controle de produção" vai para a página 2 do item.
2. O bloco "Observações e anotações de pedido" assume o lugar do Controle de
   produção na página 1.
3. Observações e anotações diminuem para caber na página 1, e o Controle de
   produção e a imagem da arte crescem na página 2.

Na v8, o Controle de produção, as anotações e a arte dividem o pé de uma folha
já cheia: a caixa da arte tem a metade da largura, e quem confere a estampa
enxerga uma prévia pequena. O cliente quer a arte grande e os campos de
produção com espaço para escrever, e as observações do pedido junto do item, e
não numa folha separada.

## Proposta

Criar o template `ficha-canonical-v9`, com duas folhas A4 retrato por item, uma
na frente e outra no verso. A v8 permanece intacta.

| Folha               | Blocos, nesta ordem                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Página 1 do item    | Cabeçalho (faixa do público, "Item N de M", marca, Pedido e datas); "Dados do pedido", com o apontamento "Controle de produção e arte na folha N de M"; "Dados do item", idêntico à v8; "Observações e anotações do pedido"                                           |
| Página 2 do item    | Cabeçalho repetido; painel curto "Dados do pedido", para identificar a folha solta; "Controle de produção" expandido, com os mesmos sete campos à mão; painel "Arte" de largura total, que ocupa o espaço vertical restante, com a "Estampa (referência)" sob a caixa |
| Continuação (final) | Folha extra "Observações (continuação)", só quando as observações não couberem na página 1 do item, com aviso no painel; sem sobras, nem folha nem aviso                                                                                                              |

A ordem das folhas é item 1 página 1, item 1 página 2, item 2 página 1, e assim
por diante, seguida das folhas extras de continuação. "Folha N de M" conta
todas elas. Frente e verso favorecem a impressão em duplex: cada item ocupa uma
folha física.

**Observações e anotações do pedido (página 1).** Lista numerada das
observações do pedido, incluindo as instruções complementares do atendimento
como na v8, em tipo reduzido que respeita o piso de 13 px, seguida de linhas
pautadas para anotação à mão que ocupam o espaço restante, com no mínimo três
linhas. Observação nunca é cortada: o que não couber na página 1 continua na
folha extra final, com aviso no painel. Isso substitui, na v9, o FPI-02 da v8
(observações só na última folha). As "Anotações" pautadas saem da página 2 e
passam a viver dentro desse painel.

**Controle de produção e arte (página 2).** Os mesmos sete campos da v8
(Conferido para arrematar e Data, Arrematado e Data, OBS arremate, Conferido /
Embalado e Data), agora mais altos e com mais respiro. O painel "Arte" tem a
largura inteira e ocupa todo o espaço vertical que sobra: `object-fit: contain`,
espaço tracejado "Sem arte anexada" quando não há imagem e a legenda "Estampa
(referência)" sob a caixa.

**O que não muda.** Poppins embutida, tokens do `design.md`, grade de 4 px e de
12 colunas, piso de 13 px, "Dados do item", conferência à mão na grade,
rótulos (Modelo e Detalhe do modelo), conteúdo de fábrica e bloqueio financeiro
(FPI-03 a FPI-10) e as regras de `artPreview` de FPI-11, exceto a divisão da
área em metades.

**Ativação.** `PRINT_TEMPLATE` continua em v8 até o PO aprovar a amostra v9,
com o mesmo gate de FPI-09: aprovação provisória ligada ao hash das amostras,
troca em commit próprio, assinatura física de Rose e Operação como gate de
produção.

## Premissas

- O cliente aceita dobrar o número de folhas lógicas em troca de uma folha de
  controle e arte com espaço de verdade. Em duplex, o consumo de papel físico
  fica próximo ao da v8 (uma folha por item).
- A impressora da fábrica é laser e a página 2 será preenchida à caneta; a
  legibilidade e a margem para arquivar são conferidas no teste físico de
  [FPI-T03](../../.specs/features/ficha-por-item/tasks.md).
- Não há domínio, API nem migração envolvidos: muda só o template, o
  planejador de folhas e os artefatos de revisão.

## Critérios de decisão

- O que o cliente pediu aparece na ordem pedida: observações na página 1,
  controle e arte na página 2, os dois últimos maiores.
- Nenhuma observação pode sumir sem aviso, mesmo com o painel reduzido.
- Fichas já aprovadas (v2 a v8) continuam imprimindo como foram aprovadas.
- A troca segue o gate de sempre: aprovação provisória por hash e assinatura
  física antes da produção.
- A folha solta continua identificável: o cabeçalho e o painel curto "Dados do
  pedido" repetem na página 2.

## Alternativas

1. **Alterar a v8 no lugar.** Rejeitada. A v8 está aprovada e travada por hash
   (`ficha-pdf-approval-v8.json`), e o registro exige nova versão do template
   para qualquer correção de layout depois da aprovação. Mexer nela invalidaria
   a aprovação e reabriria o gate sem rastro do que mudou.
2. **Manter uma folha por item, reduzindo tudo.** Rejeitada. A folha única da v8
   já está no piso de 13 px; encaixar observações pautadas, controle expandido e
   arte grande na mesma folha só seria possível reduzindo exatamente o que o
   cliente pediu para ampliar.
3. **Folha única de controle por pedido, no fim.** Rejeitada. Volta ao controle
   que vale para o pedido todo, recusado na RFC 061: a folha deixa de acompanhar
   um item sozinha, e a arte de cada item deixaria de estar junto do item.
4. **Manter as observações só na folha final (FPI-02).** Rejeitada. O cliente
   pediu o bloco na página 1 do item, no lugar do Controle; com as observações
   junto do item, quem separa a folha não perde a instrução.

## Impacto

| Área             | Efeito                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Ficha impressa   | Template novo. `PRINT_TEMPLATE` continua em v8 até a aprovação provisória das amostras v9.                                                    |
| Fichas v2 a v8   | Sem mudança, inclusive hashes, rótulos e o pacote de aprovação da v8.                                                                         |
| Papel e duplex   | Duas folhas lógicas por item, mais as folhas extras de continuação; em duplex, uma folha física por item. Sem duplex, o custo de papel dobra. |
| Observações      | Passam à página 1 do item; a folha final deixa de existir como regra e só aparece como continuação, quando o painel não comportar o texto.    |
| Content-Security | A folha de estilos nova precisa ter o hash admitido na CSP da rota de impressão (`docker/nginx.conf`), como ocorreu com a v8.                 |
| API, banco e bot | Sem mudança de contrato nem migração.                                                                                                         |
| ADRs anteriores  | A [ADR 078](../adr/078-ficha-impressa-por-item.md) não é reescrita; a ADR 087 diz o que a v9 altera nela (layout da folha e FPI-02).          |

Fora de escopo: a ficha da loja (`ficha-loja-v1`), envio e armazenamento da arte
e qualquer mudança no conteúdo de fábrica de FPI-10.

## Riscos

- **Observação longa.** O painel reduzido comporta menos linhas que a folha
  final da v8. Mitigação: a continuação em folha extra com aviso no painel;
  amostra de pior caso na revisão.
- **Estimativa de altura errada.** Como na v8, uma estimativa errada transborda
  para outra folha, nunca corta conteúdo; os testes de Chromium conferem uma
  página A4 por folha.
- **Duplex ausente.** A folha de verso identifica o pedido e o item por conta
  própria, então pode ser impressa à parte sem perder o contexto.

## Plano de verificação

Descrito como plano; os resultados entram em
[FICHA-PDF-REVIEW-V9](../phase0/FICHA-PDF-REVIEW-V9.md) quando o pacote existir.

- Planejador de folhas: duas folhas por item na ordem prevista, folha extra só
  quando necessária, contagem de "Folha N de M" e apontamento "Controle de
  produção e arte na folha N de M".
- Amostras sintéticas de 1 e de 4 itens, com e sem observações, com observação
  longa que force a continuação, com e sem prévia da arte.
- Render no Chromium: uma página A4 por folha, piso de 13 px, nenhum
  texto cortado, nenhuma requisição externa, painel "Arte" ocupando o espaço
  restante e nenhuma "Anotações" na página 2.
- Testes de hash: templates v2 a v8 e seus registros inalterados; validador
  recusa a v9 sem aprovação registrada.
- CSP: hash da nova folha de estilos admitido na rota de impressão.
- Gate final: checks do projeto e `git diff --check`, sem PII nas amostras.

## Ações e resultado

A decisão de desenho está registrada na
[ADR 087](../adr/087-ficha-por-item-controle-no-verso.md). A execução segue
[FPI-T05](../../.specs/features/ficha-por-item/tasks.md) (implementação e pacote
de revisão) e [FPI-T06](../../.specs/features/ficha-por-item/tasks.md)
(aprovação do PO e troca de `PRINT_TEMPLATE`). O resultado fica a preencher
pelo orquestrador quando as amostras forem aprovadas.

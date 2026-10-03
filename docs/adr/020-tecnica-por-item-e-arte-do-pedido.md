# ADR 020 — Técnica por item e arte do pedido

Status: aceita

Data: 03/10/2026

Decisores: PO (Rômulo Sutil Corrêa) decidiu os grupos A–F da
[RFC 008](../rfc/008-rotulos-da-ficha-tecnica-e-arte.md), o nome **Técnica**,
a origem da arte obrigatória e a saída de “Serviços dos itens”. Tech Lead
definiu a leitura do bot, a compatibilidade dos dados gravados e a nova versão
da impressão. Requisitos `TEC-01`–`TEC-08` da
[spec](../../.specs/features/pedidos-mvp/spec.md), tarefas T83–T87 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md).

## Contexto

A [ADR 019](019-ficha-espelhada-e-sinais-operacionais.md) pôs um serviço em
cada item, manteve a técnica geral da arte no resumo e reservou a origem da
estampa ao vendedor. A revisão das labels mostrou que serviço e técnica são o
mesmo dado, que a estampa do item recebia a origem da arte e que cores do
tecido e cores da arte usavam as mesmas palavras.

## Decisão

1. **Técnica é do item.** `items[].tipo_servico` mantém a chave e passa a se
   chamar **Técnica** na tela e no papel. É o ponto 4 do item e continua
   obrigatória para gerar. O bot preenche a técnica do primeiro item quando o
   cliente nomeia uma (silk, sublimação, DTF, DTG, bordado, transfer) ou diz
   que a peça é lisa (“Sem estampa”); outra descrição fica em Dados do
   atendimento como “Técnica informada”. O bot só preenche uma técnica vazia;
   o vendedor confirma e o bot nunca troca a escolha dele.
2. **A técnica geral sai do resumo.** `summary.aplicacao` deixa de ser escrita
   pelo bot, editada ou impressa. O valor antigo continua guardado; a API
   ainda aceita a chave de um cliente antigo e a ignora.
3. **A arte é do pedido.** `ficha.artwork` ganha `sem_estampa`. As opções são
   **O cliente envia a arte** (`feito_pelo_cliente`), **A Silmer cria a arte**
   (`feito_pela_silmer`) e **Sem estampa**; as duas primeiras podem coexistir,
   “Sem estampa” exclui as outras. Gerar exige ao menos uma marcação (chave
   `artwork` em `missingFields`). O bot projeta a origem a partir de
   `artwork_status` quando a resposta é inequívoca e o pedido ainda não tem
   marcação; o vendedor corrige e anexa os arquivos. Isto supersede o item 3 da ADR 019 (“o agente não
   projeta essa decisão”).
4. **Estampa do item é referência.** `items[].estampa` sai dos pontos
   principais, não bloqueia e aparece como **Estampa (referência)** nos
   adicionais: o que vai estampado e onde. O bot grava ali só os locais
   (`artwork_locations`).
5. **Rótulos.** Pontos do item: Tipo de roupa, Cor, Quantidade, Técnica,
   Tecido, Tamanhos, **Gola**. Adicionais: Estampa (referência), **Cor do
   tecido — frente/costas/manga direita/manga esquerda**, **Viés das mangas**.
   Datas: **Pago em** e **Entregue em**. Resumo: **Nome do pedido**. Produção:
   **Cores da arte** com **Nº de cores — …**. O aviso do `modelo` antigo sai
   da tela; o valor continua guardado.
6. **Nova impressão v5.** `ficha-canonical-v5` aplica os itens acima, tira
   “Serviços dos itens” e a técnica geral do resumo e mostra a arte do pedido
   em toda página comercial. V2, v3, v4, seus PDFs e hashes não mudam.
   `PRINT_TEMPLATE` passa a v5 depois que o PO aprova provisoriamente a
   amostra sintética para desenvolvimento; a assinatura física de Rose e
   Operação continua exigida antes da produção.

## Consequências

- O vendedor marca a origem da arte uma vez por pedido; com o bot, a marcação
  costuma chegar pronta.
- Pedidos pendentes gravados antes desta decisão passam a pedir técnica e
  origem da arte para gerar; a estampa antiga continua legível como
  referência.
- A coleta do bot e o indicador “Ficha: X de 8” não mudam; muda só onde o CRM
  grava cada resposta.

## Relação com decisões anteriores

Supersede parcialmente a [ADR 016](016-itens-com-os-sete-pontos-da-ficha.md)
(estampa como ponto principal do item) e a
[ADR 019](019-ficha-espelhada-e-sinais-operacionais.md) (itens 1–4: serviço
separado da técnica, técnica no resumo, origem só humana e rótulos da v4).
A [ADR 017](017-ficha-impressa-com-os-sete-pontos.md) e a
[ADR 018](018-cliente-do-pedido-acompanha-o-contato.md) continuam integrais.

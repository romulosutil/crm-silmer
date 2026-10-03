# ADR 010 — Intenção de pedido sem pergunta e tom do bot

Status: aceito; a lista de perguntas com opções do item 4 foi substituída pela
[ADR 012](012-ficha-de-sete-pontos-e-ritmo-fixo.md) em 01/10/2026. No item 1,
a intenção de compra lida pelo modelo (`order_intent_confirmed`) foi
substituída pela [ADR 014](014-pedido-abre-no-primeiro-ponto-da-ficha.md) em
02/10/2026: o pedido abre no primeiro ponto da ficha. O bot continua sem
perguntar se pode montar o pedido.

Data: 01/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 01/10/2026, ao revisar conversas do
DEV.

RFC: [RFC 006](../rfc/006-atendimento-guiado-do-bot-no-n8n.md), decisões
D17–D20. Requisitos: `AGT-01`, `AGT-05`, `PCL-01`. Substitui, na
[ADR 009](009-regras-de-transferencia-e-teto-do-bot.md), apenas o trecho do
item 7 sobre `order_intent`.

## Contexto

O bot perguntava "Posso montar um pedido de orçamento?" antes de seguir a
coleta e de novo com a pré-ficha completa. Só a resposta "sim" disparava
`order.intent_confirmed`, que cria o Pedido pendente. O PO avaliou que a
pergunta não acrescenta nada: quem descreve as peças já quer o orçamento. Com
um cliente que só fazia perguntas, a confirmação era repetida até o teto.

O bot também perguntava o nome do pedido, que o cliente quase nunca tem, e os
avisos fixos de transferência soavam informais demais ("Quem passa os valores
é…", "Já estou chamando alguém").

## Decisão

1. **Sem pergunta de orçamento.** O bot nunca pede permissão para montar o
   pedido ou o orçamento; segue perguntando o que falta. A intenção de compra é
   identificada pelo agente:
   - o modelo marca `order_intent_confirmed` quando o cliente diz que quer
     fazer, encomendar ou orçar peças;
   - a pré-ficha completa é intenção por si só.

   Dúvida ou pergunta genérica não é intenção. Com isso, `order_intent` sai de
   `asked_field`, e uma conversa que ficou nessa pergunta não tem campo
   pendente.

2. **Pré-ficha completa transfere direto** com `briefing_complete`.
3. **Nome do pedido não é perguntado.** `order_name` sai dos campos exigidos
   para a pré-ficha completa. O bot só o grava quando o cliente cita o
   evento, a empresa, o time ou a turma; senão o vendedor define.
4. **Perguntas com opções** (modelagem, malha, cor, técnica, local da estampa)
   citam as opções comuns, dizem que o cliente pode escolher mais de uma e
   terminam sempre com "ou outra".
5. **Tom dos avisos.** Os avisos de transferência são acolhedores, sem gíria e
   sem formalidade excessiva. Todos dizem que um vendedor continua o
   atendimento na mesma conversa.

## Consequências

- O Pedido pendente nasce mais cedo, assim que o cliente descreve o que quer.
  A criação continua idempotente (`PCL-02`). Inbound sozinho continua sem
  criar Pedido.
- O workflow passa a `mvp-simple-5` (DEV `dev-mvp-simple-6`). O contrato com o
  CRM não muda.
- O estado `quote_` em `briefing_status` continua marcando a intenção já vista,
  para o modelo não esquecê-la nas rodadas seguintes.

## Alternativas descartadas

- **Perguntar só uma vez e não repetir:** ainda gasta uma mensagem e não muda
  a decisão do cliente que já descreveu as peças.
- **Inferir intenção por regra fixa** (ex.: peça e quantidade preenchidas):
  um cliente que só pergunta "vocês fazem 50 camisetas em uma semana?" seria
  contado como pedido; o modelo distingue melhor, e a pré-ficha completa cobre
  o restante.

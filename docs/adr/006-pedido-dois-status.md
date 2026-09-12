# ADR 006 — Pedido com dois status e confirmação humana

Status: aceito

Data: 12/09/2026

Decisores: PO, em revisão de design de 09/09 a 12/09/2026.

## Contexto

A ADR 004 aposentou Kanban e Negócio e deixou Pedido para uma decisão
posterior, precedida de especificação própria. O preenchimento da ficha não é
linear: o cliente responde fora de ordem, o agente preenche o que consegue e o
vendedor completa o resto quando assume a conversa. A operação precisa
registrar o pedido, confirmar valor e forma de pagamento e só então imprimir a
ficha.

O contrato atual do n8n diz que nenhuma informação inferida vira Pedido
oficial. Esta ADR precisa conciliar essa regra com a criação do pedido pelo
agente.

## Decisão

### Ciclo de vida

- O Pedido tem dois status: `pendente` e `confirmado`. A única transição humana
  de ida é "Confirmar pedido"; a única volta é "Reabrir pedido".
- O agente cria o pedido pendente quando confirma a intenção de compra. Pendente
  é rascunho não oficial; oficial é Confirmado, e confirmar continua sendo
  humano. Isso muda a regra atual do contrato n8n "nenhuma informação inferida
  vira Pedido oficial".
- O vendedor dono da conversa ou um administrador também pode criar o pedido
  manualmente quando o agente não detectou a intenção.
- Uma conversa pode ter vários pedidos, com um pendente por vez. Nova intenção
  com pendente aberto reaproveita o pendente.
- Toda confirmação é humana. Nada muda o status sozinho: nem pagamento, nem
  produção, nem tempo, nem o agente, que só pode criar.
- Reabrir existe no MVP para o dono da conversa ou um administrador: volta a
  Pendente, preserva o número, bloqueia a impressão de novo e registra quem
  reabriu.

### Posse e permissões

- Confirmar: dono da conversa e administrador. Não reutiliza as ações
  admin-only `order-form.approve`, `quote.approve` e `sale.approve`.
- Editar pedido pendente segue o dono da conversa. Outro vendedor retoma usando
  "Repassar atendimento" ou assumindo conversa sem responsável. Não existe
  posse própria de pedido.
- Imprimir: qualquer usuário operacional, desde que o pedido esteja confirmado.

### Fora do escopo do MVP

Cobrança, comprovante e status de pagamento; produção; entrega; pedido perdido
ou cancelado; Mesa de Trabalho; marcos; anel de completude; histórico visível;
artboard mobile dedicado.

## Consequências

Esta decisão supersede o trecho "Pedido será uma decisão posterior" da ADR 004.
A proibição de usar as migrations e os módulos de Negócio em novas capacidades
continua valendo.

O contrato n8n ↔ CRM passa a descrever o evento de intenção de compra e a
projeção da pré-ficha no pedido pendente. Preço, pagamento e status continuam
fora do alcance do agente.

Proposta aprovada: [especificação Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md),
[decisões](../../.specs/features/pedidos-mvp/context.md) e
[arquitetura](../../.specs/features/pedidos-mvp/design.md).

Requisitos afetados: PCL-01, PCL-08, PAG-01, PAG-02 e PAG-03.

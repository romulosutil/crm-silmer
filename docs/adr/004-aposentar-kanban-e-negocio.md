# ADR 004 — Aposentar Kanban e Negócio

Status: aceito; parcialmente supersedido pela
[ADR 006](006-pedido-dois-status.md) no trecho "Pedido será uma decisão
posterior".

## Decisão

O MVP deixa de expor Kanban e Negócio. A operação ativa limita-se a Inbox,
contatos, conversas, mensagens, handoff e automação. Pedido será uma decisão
posterior, precedida de especificação própria.

As migrations históricas de Negócio permanecem imutáveis para compatibilidade
de bancos existentes, mas não devem ser usadas por novas capacidades.

## Consequências

Rotas, tela, navegação, SSE e testes de Kanban são removidos. Esta decisão
supersede o trecho de ADR 001 que previa a preservação da interface Kanban.

RFC relacionada: [003-aposentar-pipeline-comercial.md](../rfc/003-aposentar-pipeline-comercial.md).

Requisitos afetados: INB-01–04, ORC-01, ORC-09, AGT-07–08 e ORD-01–05.

# RFC 076 — Carteira de pedidos e Mapa de corte

Autorizada para implementação local em 27/11/2026 a partir do protótipo da
carteira. Decisão em [ADR 100](../adr/100-carteira-de-pedidos-e-mapa-de-corte.md).

A carteira reúne vendas do mês, filtros de produção, prazos e ações do pedido.
O Mapa de corte permite que um vendedor ou administrador confira e imprima uma
grade única para vários pedidos. A fábrica usa o público e as especificações
de corte para identificar os lotes.

A proposta mantém as etapas no agregado Pedido e usa o Chromium existente
para emitir um documento privado. Foram considerados a agregação pelo navegador
e um novo cadastro de lotes persistidos. A projeção no servidor usa a ficha
confirmada, revalida acesso e versão no download e dispensa cadastro adicional.
O teste com a Rose confirma se as especificações impressas distinguem todos os
lotes que precisam ser cortados separadamente.

[Requisitos e tarefas CAR](../../.specs/features/order-portfolio/spec.md)

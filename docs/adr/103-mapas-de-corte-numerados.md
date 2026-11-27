# ADR 103 — Mapas de corte numerados

Aceita para implementação. Atualiza a
[ADR 102](102-historico-do-mapa-de-corte.md) e resolve a
[RFC 079](../rfc/079-mapas-de-corte-numerados.md).

1. `crm.order_cut_maps` guarda o número e a data de emissão. A chave primária
   de `crm.order_cut_map_orders` garante um único vínculo por pedido e guarda
   a versão usada na grade. A carteira projeta o vínculo no escopo do pedido.
2. Uma sequência reserva o número antes de renderizar para que PDF e carteira
   compartilhem a referência. Uma reserva de uma tentativa malsucedida pode
   deixar um intervalo na sequência.
3. Após renderizar, acesso, versões e vínculos são revalidados sob os
   bloqueios dos pedidos. Mapa, vínculos e auditoria são gravados juntos.
4. A migração `0089` importa o primeiro vínculo conhecido para cada pedido
   presente em auditorias de versões anteriores. A numeração é atribuída ao
   agrupar esses vínculos pelo autor e pela correlação original.

[CAR-09](../../.specs/features/order-portfolio/spec.md)

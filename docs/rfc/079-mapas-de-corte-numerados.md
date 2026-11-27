# RFC 079 — Mapas de corte numerados

A carteira precisa mostrar em qual mapa o pedido entrou e evitar que a mesma
grade chegue duas vezes à produção. Cada mapa ganha um número visível no PDF
e na carteira. Pedidos associados ficam disponíveis para consulta e saem da
seleção.

O vínculo único no banco mantém a regra inclusive entre sessões simultâneas.
Uma seleção nova pode usar qualquer pedido elegível que ainda aguarda mapa.

[CAR-09](../../.specs/features/order-portfolio/spec.md) ·
[ADR 103](../adr/103-mapas-de-corte-numerados.md)

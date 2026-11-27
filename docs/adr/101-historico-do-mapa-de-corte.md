# ADR 101 — Histórico do Mapa de corte

Aceita para implementação. Complementa a
[ADR 100](100-carteira-de-pedidos-e-mapa-de-corte.md) e resolve a
[RFC 077](../rfc/077-historico-do-mapa-de-corte.md).

1. Eventos imutáveis `order.cut_map.download` são a fonte da última geração
   e do histórico por pedido. A consulta tem índice parcial e paginação.
   Cada geração guarda a correlação em comum e uma versão por pedido.
   O histórico visível contém data e versão do próprio pedido.
2. O PDF é gerado por POST autenticado com proteção CSRF. A prova assinada
   inclui o usuário, as versões e a quantidade de gerações anteriores.
   Qualquer pedido com histórico exige confirmação explícita.
3. Depois de renderizar, a transação ordena os bloqueios e relê os pedidos e
   o histórico. Só a primeira tentativa com a mesma prévia pode gravar a
   auditoria. Todos os eventos são gravados juntos antes da resposta com o PDF.
4. O agendamento, o status comercial e a etapa produtiva seguem seus próprios
   comandos. O registro representa a geração do mapa.

[CAR-08](../../.specs/features/order-portfolio/spec.md)

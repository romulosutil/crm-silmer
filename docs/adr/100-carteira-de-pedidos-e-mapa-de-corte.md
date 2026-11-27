# ADR 100 — Carteira de pedidos e Mapa de corte

Aceita para implementação em 27/11/2026. Origem na
[RFC 076](../rfc/076-carteira-de-pedidos-e-mapa-de-corte.md).

1. `production_stage` é uma coluna operacional anulável para pedidos de
   atendimento. A data de entrega segue como fonte de **Entregue**. Na primeira
   confirmação elegível, a etapa começa em **Na arte**. Pedidos antigos e
   reconfirmados exigem classificação humana antes de entrar no corte.
2. O mapa é uma projeção descartável dos pedidos confirmados e selecionados por
   pessoa autorizada. Modelo, cor, público e especificações de corte da ficha
   formam a chave de cada lote. A grade oficial fornece as quantidades.
3. Prévia e PDF usam a mesma projeção, que o servidor relê antes e depois de
   renderizar. Divergência, perda de acesso ou ficha incompleta interrompem o
   download. A auditoria usa identificadores e versões por pedido e correlação
   compartilhada. O PDF é privativo e o renderer reutiliza os recursos locais.
4. Vendedor opera a própria carteira e administrador pode consultar a equipe
   ou filtrar por responsável. Para os números do mês, o crédito usa a
   atribuição congelada na confirmação. A produção usa a responsabilidade atual.

[Requisitos CAR-01–07](../../.specs/features/order-portfolio/spec.md) ·
[Ficha e modelo FPI-05](../../.specs/features/ficha-por-item/spec.md)

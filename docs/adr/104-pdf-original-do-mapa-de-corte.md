# ADR 104 — PDF original do mapa de corte

Aceita para implementação. Complementa a
[ADR 103](103-mapas-de-corte-numerados.md) e resolve a
[RFC 080](../rfc/080-consulta-do-mapa-de-corte-emitido.md).

O PDF gerado, limitado a 5 MiB, é um artefato do próprio mapa. A migration
`0090` adiciona seu envelope cifrado, associado ao número do mapa, e indexa
os membros por mapa. A mesma transação registra arquivo, número, pedidos e
auditoria. O banco e seu backup já são a fonte de recuperação do mapa. O
arquivo inclui referências de pedidos e informações de corte.

A leitura exige acesso operacional atual a todos os pedidos vinculados. A
consulta projeta os números e a disponibilidade do arquivo. O download
decifra os bytes originais, sem renderizar nem escrever outro mapa. Os
vínculos anteriores à migração são consultáveis com indisponibilidade
explícita caso o arquivo original não tenha sido guardado.

[CAR-10](../../.specs/features/order-portfolio/spec.md)

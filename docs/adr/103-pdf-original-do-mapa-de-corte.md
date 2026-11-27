# ADR 103 — PDF original do mapa de corte

Aceita para implementação. Complementa a
[ADR 102](102-mapas-de-corte-numerados.md) e resolve a
[RFC 079](../rfc/079-consulta-do-mapa-de-corte-emitido.md).

O PDF gerado, limitado a 5 MiB, é um artefato do próprio mapa. A migration
`0089` adiciona seu envelope cifrado, associado ao número do mapa, e indexa
os membros por mapa. A mesma transação registra arquivo, número, pedidos e
auditoria. O banco e seu backup já são a fonte de recuperação do mapa. O
arquivo inclui referências de pedidos e informações de corte.

A leitura exige acesso operacional atual a todos os pedidos vinculados. A
consulta projeta os números e a disponibilidade do arquivo. O download
decifra os bytes originais, sem renderizar nem escrever outro mapa. Os
vínculos anteriores à migração são consultáveis com indisponibilidade
explícita caso o arquivo original não tenha sido guardado.

[CAR-10](../../.specs/features/order-portfolio/spec.md)

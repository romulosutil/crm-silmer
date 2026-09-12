# ADR 005 — Excluir contas sem histórico

Status: aceito

## Decisão

Uma conta humana pode ser excluída permanentemente somente se for vendedor e
não possuir histórico operacional. O banco continua sendo a última barreira:
suas referências restritivas impedem remoção caso surja um vínculo concorrente.

Contas com `COMMERCIAL_ADMIN` não podem ser excluídas. Contas com histórico
permanecem na lista e usam desativação, preservando conversas, handoffs e
auditoria.

## Consequências

A lista de usuários informa `canDelete`, a interface apresenta **Excluir**
somente quando esse valor é verdadeiro, e o endpoint usa sessão, CSRF e chave
de idempotência. A tentativa direta para uma conta protegida retorna conflito,
sem apagar dados relacionados.

RFC relacionada: [004-excluir-contas-sem-historico.md](../rfc/004-excluir-contas-sem-historico.md).

Requisitos afetados: USR-06, USR-08, USR-09, USR-11 e USR-12.

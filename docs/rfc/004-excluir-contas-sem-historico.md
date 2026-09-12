# RFC 004 — Excluir contas sem histórico

## Contexto

A desativação continua sendo o mecanismo para preservar a rastreabilidade de
atendimentos. Ainda assim, contas de vendedor criadas por engano ou para teste,
sem qualquer histórico operacional, precisam poder desaparecer por completo.

## Proposta

- Expor exclusão permanente apenas para vendedores sem referências operacionais.
- Preservar a recusa do banco para qualquer referência concorrente ou não
  prevista; a resposta pública é `409 USER_HAS_HISTORY`.
- Nunca permitir excluir uma conta com `COMMERCIAL_ADMIN`.
- Manter sessões, função e capacidades da conta excluída sob os `ON DELETE
CASCADE` já existentes; manter a trilha de auditoria append-only, sem senha
  ou hash.

## Fora de escopo

Anonimização de usuários com histórico, remoção de eventos de auditoria e
reatribuição automática de atendimentos.

## Decisão

Aceita por ADR 005.

## Rastreabilidade

Atende USR-12 e complementa USR-06, USR-08, USR-09 e USR-11.

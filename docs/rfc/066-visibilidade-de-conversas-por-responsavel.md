# RFC 066 — Visibilidade de conversas por responsável

- Status: aceita pelo proprietário em 12/11/2026; decisão na [ADR 088](../adr/088-leitura-de-conversas-por-responsavel.md).
- Requisitos: [CONV-ACL-01](../../.specs/features/conversation-visibility/spec.md).
- Tarefa: [CONV-ACL-T01](../../.specs/features/conversation-visibility/tasks.md).
- PR: [#369](https://github.com/romulosutil/crm-silmer/pull/369).

## Proposta e aceite

Administrador lê todas. Vendedor lê somente próprias e sem dono, inclusive com
IA. A condição é o responsável atual; IA não é uma exceção a outro dono.
Aplicar a regra no servidor em listagens, contagens, links diretos, mídia,
contexto, assuntos, handoffs, histórico e SSE, preservando o escopo comercial
dos Pedidos. Ao transferir, retirar da interface o conteúdo do antigo dono e
impedir recuperação por replay ou cursor de outro leitor/perfil.

O filtro visual isolado foi rejeitado porque não protege as demais rotas.
A alteração usa autorização e PostgreSQL existentes, sem migração ou serviço.
Cenários negativos e matriz estão na spec; rollback permissivo exige decisão.

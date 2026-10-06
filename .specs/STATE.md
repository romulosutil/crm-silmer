# STATE

## Decisions

### AD-001

- **Decision**: Usar RustFS existente para mídia enviada do chat e preservar anexos enviados sem expurgo automático por sete dias ou encerramento.
- **Reason**: Escolha explícita do usuário em 05/10/2026; storage já instalado e histórico deve manter arquivos.
- **Trade-off**: Ocupação crescente, operação/backup próprios e necessidade de separar mídia preservada dos jobs transitórios atuais.
- **Scope**: Inbox, API de mídia, worker, n8n e topologia; registro canônico em docs/adr/023-midia-do-chat-no-rustfs.md.
- **Date**: 2026-10-05
- **Status**: active

## Handoff

Planejamento em .specs/features/inbox-media-rustfs/. Implementação não iniciada.

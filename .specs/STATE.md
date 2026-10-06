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

Feature: inbox-media-rustfs. Implementação autorizada, 24 tarefas pendentes.
Branch: codex/inbox-media-rustfs-plan.
Concluído: BASE-01 atualizou source-map-js para 1.2.2; validate/audit aprovados,
E2E exclusivo 107 aprovados / 7 skips; 11 testes live locais aprovados.
Em andamento: T1 pelo worker media_storage_phase, smoke local alpha.99.
Checks: validate passou (647 aprovados / 3 skips); audit passou após atualizar
o lockfile para source-map-js 1.2.2. Runtime local diverge das versões fixadas.
Infraestrutura: usuário corrigiu orientação herdada; Docker local autorizado
e Server 29.3.1 verificado. Testes dedicados locais podem prosseguir.
Smoke RustFS real, digest e credencial CRM restrita continuam pendentes.
Próximo passo: concluir smoke T1 e implementar T2..T6 em ordem, sem tocar Hermes.

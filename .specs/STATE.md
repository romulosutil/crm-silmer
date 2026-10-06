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

Feature: inbox-media-rustfs. Implementação autorizada, T1 concluída / 23 tarefas pendentes.
Branch: codex/inbox-media-rustfs-plan.
Concluído: BASE-01 atualizou source-map-js para 1.2.2; validate/audit aprovados,
E2E exclusivo 107 aprovados / 7 skips; 11 testes live locais aprovados.
T1: commit/push 7e388c8; nove checks S3 reais na alpha.99 local aprovados,
digest sha256:103dd40b84d5aa3d5ab02f3a693797eb1d14cb842554b222dfbb589f364aa47f.
Em andamento: T2 pelo worker media_storage_phase; schema e testes SQL live.
Checks adicionais: validate no Node 24.20.0 / npm 11.19.0 passou (656 aprovados /
3 skips, incluindo T1); audit zero vulnerabilidades. Runtime portátil em
var/tooling/node-v24.20.0-win-x64; prefixar PATH nas execuções PowerShell.
Infraestrutura: usuário corrigiu orientação herdada; Docker local autorizado
e Server 29.3.1 verificado. Testes dedicados locais podem prosseguir.
Smoke RustFS remoto, digest remoto e credencial CRM operacional continuam
pendentes em T23. Banco local exclusivo na porta 15433 e RustFS sintético
na porta 21900; containers crm-silmer-media-test-db e crm-silmer-media-test-rustfs.
Próximo passo: implementar T2..T6 em ordem, sem tocar Hermes.

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

T7 concluída na entrega corrente: upload humano, ledger de admissão 0029,
reserva antes de streaming, replay byte-real, quota usada+reservada e throttle
12/minuto por token canônico (inclui replay). Decisão de implementação aceita
pelo integrador: ledger evita lock SQL durante IO e metadata fictícia; arquivo
vazio usa422. Design/ADR023 permanecem baseline. Método
listAbandonedAdmissions entrega discovery para T22, sem cleanup nesta fase.
CommitDB/resposta perdida e query de reconciliação indisponível preservam spool.
Gates T7: validate743/3 skips antigos, SQL conjunto24/24 (13novos), HTTP20novos,
E2E107/7 skips antigos, audit0, diff/spec/tasks verdes. Próximo passo: T8.
T1..T7 entregues,17tarefas pendentes; requisitos ainda In Progress.
O snapshot abaixo preserva a evidência da infraestrutura entregue na fase1.

Feature: inbox-media-rustfs. Implementação autorizada, fase 1 concluída:
T1 a T6 entregues / 18 tarefas pendentes. Requisitos ainda In Progress;
Verifier independente obrigatório no fechamento da feature.
Branch: codex/inbox-media-rustfs-plan.
Commits/push: T1 7e388c8, correção T1 cacb897, T2 b94e5f1, T3 0ef7af3,
T4 07c90cf, T5 ae76e6b; T6 é a entrega corrente que contém este handoff.
BASE-01 330abe1 preservou source-map-js 1.2.2, sem alterações posteriores do lock.
Gates finais: validate no Node 24.20.0/npm 11.19.0, 722 aprovados / três skips;
SQL conjunto 23/23, ciclo SQL + scanner/normalizador da imagem + SDK RustFS
14/14 (54,16 s), E2E exclusivo um worker 107 aprovados / sete skips antigos,
audit zero vulnerabilidades. Histórico e adequação em execution.md.
Runtime portátil em var/tooling/node-v24.20.0-win-x64; prefixar PATH.
RustFS alpha.99 local digest:
sha256:103dd40b84d5aa3d5ab02f3a693797eb1d14cb842554b222dfbb589f364aa47f.
Imagem runtime final T6, distinta da T5:
sha256:d372430897763a95b471898d349af004525ae234003fb350e7f5538fbaaf1655.
Infraestrutura: usuário corrigiu orientação herdada; Docker local autorizado
e Server 29.3.1 verificado. Testes dedicados locais podem prosseguir.
Smoke RustFS remoto, digest remoto e credencial CRM operacional continuam
pendentes em T23. Banco local exclusivo na porta 15433 e RustFS sintético
na porta 21900; containers crm-silmer-media-test-db e crm-silmer-media-test-rustfs.
Próximo passo: T7 pelo integrador. Queue chat_media / job chat_media.process /
effect internal, chat_media_id carregado pelo claim. Admissão reserva pior
caso antes de bytes: anexo duas vezes o limite do tipo, gravação três vezes
16 MiB; após tamanho real, duas vezes a entrada ou entrada mais 32 MiB.
Prepare persiste variante antes PUT; HEAD confirma integridade; cleanup
confirmado precede ready/reserva final, used só no vínculo T10. Rejeitados
mantêm reserva até cleanup T22. Contratos/configuração/reprodução no runbook.
Nenhuma credencial operacional ou dado Hermes foi lido ou alterado.

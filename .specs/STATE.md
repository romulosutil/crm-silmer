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

T13 concluída na fase3; MED-16/20/21/22/24: red inicial demonstrou metodo de leitura ausente e abort de outra execucao aceito. GET valida Basic/capacidade minima, comando processing/mensagem sending, identidade original do recibo n8n_events, variante bound e fence human/nonterminal/epoch/revision. Preflight JSON nao acessa S3 nem renova/reserva; HEAD e seletores estrangeiros negados. workflow.failed before_message_send conclui sob CAS original e allowlist, mesmo com epoch invalidado, sem retry nem regressao final. SQL60/60=45bind(38baseline+7T13)+7inbox+3migrations+1command-store+4n8n-integration, zero skips; comandos node --test --test-concurrency=1 com esses cinco arquivos, TEST_DATABASE_URL dedicada. Quick818pass/3skips antigos; transporte8/8; E2E107/7skips antigos com workers1; typecheck/lint/diff e spec/tasks strict verdes. Sem schema novo; proviniencia em events, nao commands. Prova dos ramos preMeta fica em T14/T15; Meta/recovery externos T23 e Verifier final pendentes. Proximo T14;11 tarefas restantes; nenhuma Verified.

T12 concluída; fase 2 entregue até T12, sem iniciar T13. Outbox plana usa
media_id, sha256, mime_type, size_bytes, type, caption e text da variante
attached/clean vinculada, filename/media_url null. Fence revalida referência,
variante, legenda, epoch/source, autor/conversa e uso único; replay não autoriza
novo envio. Texto conserva o wire anterior. Callbacks sent/unknown resolvem
conversa canônica pelo UNION existente e negam contradição antes de efeitos;
UPDATEs também restringem a conversa. Confirmação conhecida outcome_unknown
para sent limpa erro e mantém flags de retry false. Job/reconciliação históricos
permanecem intactos (item open para revisão operacional), sem reagendamento.
Provas red e adequação bidirecional em execution.md: 11 unit e 17 SQL T12;
conjunto SQL 50/50 sem skips, validate/build 810 pass e 3 skips antigos,
E2E exclusivo 107 pass e 7 skips antigos, audit zero, diff e spec/tasks strict
verdes. MED-16/17/18/21/24 permanecem Execute/In Progress, nenhuma Verified.
12 tarefas restantes. validate_state é gate de fechamento ainda pendente da
validation.md do Verifier e das próximas fases; autor não produz esse relatório.

T11 concluída: contrato humano text/image/audio/video; mídia só mediaId/caption,
caption1024 pontos Unicode image/video, audio sem caption. Entrada false nega
novo envio após lookup de replay, sem locks/mutação de domínio. Fingerprint novo
JSON canônico sem correlationId preserva mesma chave/payload com novo trace e
ordem de chaves; divergência real/ator bloqueada409. Hash legado exato aceita
identificação original, mas trace legado novo não é recuperável sem payload.
Gates: validate799/3 skips antigos; SQL28/28; E2E107/7 skips antigos; diff/skill
validators verdes. Próximo T12, 13 tarefas restantes; nenhuma Verified.

Fix estreito T10/MED-08: outro uploader/admin retorna403 de permissão,
estado/conversa/versão retornam409. Prova red mostrou409 indevido; live18/18
depois da correção, sem efeito/alteração de quota. T11 ainda em execução;
replay exato com flag false e fingerprint sem correlationId serão cobertos
antes do commit. Requisitos continuam In Progress.

T10 entregue: bind no envio humano existente com mídia/quota locked; valida
mesmo autor/conversa/ready/clean/hash/MIME/tipo/size, reserva→used só no commit.
Admin read não permite bind de outro ator. Replay anterior ao bind não cobra
duas vezes; concorrência e segundo uso têm um vencedor. Audit/outbox rollback
mantêm ready e reserva. Quick781/3 skips antigos, Live25/25 (18 novos+7 inbox).
Próximo T11; 14 tarefas restantes, nenhuma Verified.

Fix T6/MED-19 concluído antes de T10: SHA original da admissão preservado,
divergência de spool igual tamanho rejeitada antes de prepare/PUT; prepare SQL
exige SHA original null/idêntico e variante ainda null. Unit17/17, SQL15/15,
pipeline combinado16/16 com imagem construída e RustFS local, zero skips;
types/lint/format/diff verdes. Próxima tarefa T10; nenhum status Verified.

T9 concluída; T1 a T9 entregues, 15 tarefas pendentes, nenhuma Verified.
Conteúdo Range humano usa ACL de T8, HEAD/GET SHA/MIME/size e stream bounded.
503 transitório preserva ready/attached; MissingObject410 usa CAS e mantém quota.
CHAT_MEDIA_READ_ENABLED mantém histórico ao desligar admissão CHAT_MEDIA_ENABLED.
Erros401/410/416 também usam private,no-store/nosniff. Gates: validate779/3 skips
antigos, SQL26/26, conteúdo18/18, regressão32/32 e E2E107/7 skips antigos.
Próximo passo: fix estreito MED-19/T6 para impedir substituição de SHA original
entre admissão e worker; depois T10. Autor não é Verifier final.

T8 concluída na entrega corrente; próximo passo T9. T1 a T8 entregues,
16 tarefas pendentes, nenhuma Verified. Status usa conversation.read canônica,
draft autor/admin e attached ACL de Vendedor. Credencial inválida/expirada/
revogada usa INVALID_SESSION tipado com modo401 opt-in; DB503 preservado.
Upload faz preflight401 antes do guard CSRF403. Roots equivalentes do spool
são rejeitados após resolve/case Windows. Tests com identidade/sessões SQL
reais comprovaram200/401/403/503. Gates: validate761/3 skips antigos,
SQL conjunto25/25 e final14/14, E2E107/7 skips antigos, diff limpo.
T7 publicado em f97506a. Informações abaixo preservam evidências anteriores.

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

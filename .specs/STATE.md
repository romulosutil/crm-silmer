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

T27 concluída na branch codex/inbox-media-rustfs-plan: recuperação de validação
temporária sem repetir upload e mensagens seguras de falha de captura. Reprodução
pela tela em10/10 confirmou envio explícito de PNG, M4A e MP4 com histórico DEV.
ClamAV estava com assinatura antiga; refresh genuíno recuperou o mesmo rascunho.
Gravação retorna NotFoundError: Windows só detecta saída do monitor, sem microfone.
Não declarar captura física bem-sucedida. Demo4183 atualizada; dados preservados.
Verifier específico PASS em features/inbox-media-rustfs/validation-ux-recovery.md:
baseline independente80/80 na repetição, cinco faults mortos por assertions reais,
isolamento e cleanup comprovados. Timeout inicial e sensor não qualificável
registrados no relatório, sem alterações em assertions/timeouts para passar.
Iteração2 resolveu lacuna de legenda anterior à falha: novo teste1/1pass e M6
original morto pela assertion exata; isolamento e cleanup comprovados.
Gates root: 862unitpass/zero fail/três skips antigos, build e13prechecks verdes,
focal inicial80/80; final80pass/um crash Axe, rerun exato1/1pass; FullUI195pass/sete skips/três falhas existentes, rerun exato3/3pass.
Próximo passo: conectar/habilitar entrada de áudio e executar UAT física T24.
T24 continua In Progress; requisitos não Verified; PrivacyP1 n8n e gates de
operação/Meta/backup continuam abertos. Commit atômico T27 inclui este registro.

T25+T26: revisão independente final PASS específico, iteração 2/3, sobre
90de325. Relatório em features/inbox-media-rustfs/validation-ux.md: 69/69 E2E
focais, 862 unit pass/zero fail/três skips antigos, build e 13 prechecks verdes;
oito mutantes comportamentais mortos por assertions, com isolamento comprovado.
FullUI final: 187 pass/sete skips antigos/zero fail/zero retry. Lesson L-003
registrada pelo script como candidate, recurrence1. Commits T25 e T26 enviados.
Demo http://127.0.0.1:4183/inbox atualizada, bridge Hidden PID31248, API3013
e readiness200. Smoke real confirmou upload sem envio automático, envio
explícito202, callback sent/dev, leitura200/Range206 e bytes exatos no RustFS.
Próximo passo: reteste humano de anexos, gravação e reprodução pelo microfone
físico para T24. Este PASS cobre a correção UI; T24 permanece In Progress e a
feature não está Verified. PrivacyP1 n8n e gates operacionais continuam abertos.

Revisão independente de86ab0a1: baseline59/59, unit862/0/3 e cinco mutantes
comportamentais mortos com isolamento comprovado. Verdict T25 FAIL por MED-32:
recusas HTTP conhecidas de envio usavam mensagem genérica de resultado incerto.
T26 formaliza a correção e antecede T24. Só MediaComposer.vue e seu E2E mudam
no produto; retries potencialmente aceitos mantêm chave/payload imutáveis.
Após gates e commit T26, reexecutar o Verifier no novo HEAD. Não fechar feature
ou UAT física por esse relatório específico. PrivacyP1 operacional permanece.

UAT humana de06/10 reportou FAILED: Prepare/upload falha, filepicker nativo,
mic colado aEnviar, UX pouco familiar e envioanexo bloqueado. Demo4183 tinha
admissãofalse; correçãoT25 autorizada registraMED30..32 e antecede fechamentoT24.
Composerintegrado valida automaticamente drafts, mantém prévia/legenda e exige
envio explícito; runtime4183 está sendo ligado ao perfilAPI3013, Origin4183,
worker/RustFS/n8nDEV reais, preservando DB15434/snapshot anterior e volumes/chaves.
FontesUI/testes agente media_composer_ux_fix; runtimeignored media_phase4_resume;
root integra docs/gates/Browser. NenhumVerified; PrivacyP1 operacional permanece.

T25 implementação e gates concluídos: polling uploaded/processing corrigido,
862unitpass/3skips antigos; FullUI176pass/7skips antigos+1timeout axe inalterado,
rerun desse caso1pass sem alterar assertion/timeout. Smoke da nova UI4183
concluiu upload automático sem mensagem, envio explícito202, callback sent/dev,
GET200/Range206/bytes exatos no RustFS. Snapshot final atualizado e inspeção
claro/escuro confirmada. Próximo passo: revisão independente específica da
correção; depois reteste humano de microfone/anexos para fechar T24. Sem Verified
global e sem liberação operacional. Estados uploaded→processing→ready são normais.

T24 evidência automatizada concluída: API→builtworker/scanner/normalizer→RustFS
privado→n8n DEV→callback real, PNG/MP3/MP4/recording sent; replay/ACL/Range,
301s rejected, attached conservado após fixture8dias+close/scheduler65s.
Auto-stop real299970ms normaliza OGG/Opusmono48k; playback oito pares
ChromeWindows/FirefoxLinux, fault failed/unknown e export ativo restaurado.
Matriz29AC/runbook docs/runbooks/chat-media-uat.md distingue fixture e prova real.
P1 produção: execution_data inicial persiste recipient/caption/Basic mesmo savesnone;
operacional bloqueado até minimização/redação+expurgo/readiness comprovados.
T24 In Progress/Done desmarcado: microfone físico Flow1 ainda pendente na demo4183,
preservada; Flow2 perfil4193 após coordenação, sem colisão cookie127 entre portas.
Nenhum Verified/validationPASS; Verifier final/sensor após UAT física completa.

T23 implementada: dev:media opt-in, perfil Docker isolado/API-worker built,
volumes/chaves persistentes, namespace HTTPloopback, papéis mínimos e scanner
compartilhado UID1000/APIreadonly. Capacidade bucket2 com quota lock, replay
isento e receiving antigo libera slot após grace3min sem liberar bytes/quota.
Rollback real preserva attached200/Range206, upload404 e novo sendmedia403;
texto202 mesmo quando terceiro upload429. Live131/131, Quick862+3skips(total865),
UI166+7skips(total173), Privacy4/4, recovery14/14mocks com8blockers, audit0.
Perfil4193/API3013/PG15435/S321920 separado pronto; callbackDEV/normalizer300s
e wholepipeline permanecem T24. Demo4183/API3002/PG15434 intacta, flow1humano
pendente. Não logar4193 no browser humano: cookie127 compartilhado por portas.
Canon distingue mídia enviada preservada do legado; gates remotos/backup/Meta
e PIIinicialn8n explícitos. PróximoT24; nenhum Verified/validationPASS.

T22 implementada: cleanup de órfãos >24h com intenção durável anterior ao DELETE,
sem expurgar attached. Guardas de sessão sem BEGIN protegem upload/decoder/PUT
até fechamento físico, com prazos persistidos 3/15min e deadline upload120s.
Crash do encoder deixa diretório vinculado ao UUID; cleanup preserva outros e
desconhecidos, falha rm conserva quota. SIGKILL/close provados Linux2/2.
Validate855pass/3skips(total858); gates Live/Privacy finais registrados execution.
Demo4183/API3002/DB15434/assets continuam estáveis: UAT físico flow1 pendente,
não reiniciar nem resetar. Probe real de auto-stop Chrome151 mediu299970ms via
decode FFmpeg; built normalizer/pipeline ainda T24. Próxima T23; nenhum Verified.

T21 concluída: anexos/recorder/histórico integrados à Inbox, ownership e SSE
invalidam draft, troca encerra captura e respostas tardias não substituem conversa.
Seleção de imagem após revisão gravada preserva imagem e remove anúncio stale.
Dois reds discriminantes: detalhe antigo substituía conversa nova; gravação
revisada anunciava Descartar mesmo após trocar por imagem. Treze E2E novos,
UI166pass/7skips anteriores(total173), Quick/Build847pass/3skips(total850).
Demo persistente em 4183/API3002 usa DB/volumes próprios e snapshot de assets;
login vendedor200, Inbox200/human1 verificados, sem pedir microfone. Root conduz
UAT físico pendente; manter demo estável. Próxima T22. Nenhum Verified.

FixT20/MED-25 concluído: dois reds player focado→lost/503 receberam inactive;
green transfere apenas foco do player removido ao aviso, preserva foco externo.
Focal11/11, UI153pass/7skips existentes(total160), typecheck/lint verdes. T21WIP
restaurado após commitfix; snapshot histórico 6463815, antes da entrega T21.

T20 concluída: MediaMessage standalone aceita somente URL relativa CRM, imagem
privada real, players nativos sem autoplay, áudio AAC/vídeo H.264 com seek e
206/Content-Range exato. Lost e503 mostram estado acessível sem entrega inventada;
URL externa não solicitada. Tab/Espaço e axe com ambos players presentes passaram.
Focal9/9; UI151pass/7skips anteriores(total158), typecheck/lint verdes. PróximaT21
integraçãoInbox, geração/controller para resposta stale e estados do recorder.
Nenhum Verified; microfone físico/pipeline worker/remoto continuam pendentes.

T19 concluída; próxima T20. Recorder standalone acessível pede microfone apenas
por ação explícita, negocia MIME, para em 300s/16MiB e libera tracks em descarte,
troca, unmount e resposta de permissão tardia. Envio pendente impede nova captura
e descarte, inclusive Escape; red factual seguido de green. E2E completo142pass,
7skips anteriores(total149), incluindo18cenários T19. Quick/Build847pass/3skips.
Chromium e Firefox reais com dispositivo sintético reproduzem áudio; Firefox
Linux em Docker com PulseAudio privado passou3repetições e decodeFFmpeg.
Firefox Windows falha SideBySide mesmo após reinstalação oficial; não validado.
Microfone físico/UAT e pipeline worker completo continuam T24; nenhum Verified.
Autor anterior terminou com erro de quota; root assumiu fontes/index/gates.

Correção T18/MED-06/25 concluída: POSTmessages pendente cancelado pelo bloqueio
conserva tentativa imutável/ready. Reabilitar permite retry explícito com mesma
chave/body/conversa/version/caption, sem envio automático. Red retry disabled;
green focal1/1 Node24.20.0, Build847pass/3skips, audit0, Full124pass/7skips total131.
Primeiro Full123pass/7skips/1fail por strictmode de status Dashboard transitório
na restauração de sessão; rerun completo passou sem mudar assertions/timeouts.
Fontes somente MediaComposer+fixture/E2E, docs rastreáveis; próximo T19.

T18 concluída; MED-01/02/03/04/06/07/08/25: composer standalone com seleção única, revisão, upload explícito e envio apenas ready; áudio sem caption, aliases M4A e MIME vazio como hint, bytes validados no worker. Preview/identidades/version mantidos em retry, abort e generation impedem resposta antiga entre conversas. Legenda conta 1024 code points (emoji), não UTF16. Prazo polling600s inclui GET pendente e delay; refresh conserva mediaId sem reupload. Build/Quick847pass+3skips(total850), UI123pass+7skips(total130)workers1, novos16cenários E2E; validator real ClamAV/libmagic/codec1/1(113s) com fixture Chromium original, audit zero, diff e spec/tasks strict verdes. Nenhum cenário/assertion/skip/timeout publicado reduzido. Fase3 completa; próximoT19, nenhum Verified.

T17 concluída na fase3; MED-04/06/08: red FormData enviadoJSON e cancelamento proxy parcial/SSE ausente; green9 HTTP/socket reais (7client+2proxy), bytes/boundary nativos sem Content-Type manual, CSRF e key preservados, JSON304 intactos, AbortSignal upload/status/preabort e erros saneados. Proxyaborted/responsecloseincompleto encerraupstream, Range206normal preservado. Quick847pass/3skips(total850), FullUI107pass/7skips(total114)workers1, type-lint-diff e strictspec/tasks verdes. SemSQL ou migração; nenhum Verified; proximoT18standalone.

T16 concluída na fase3; MED-15/19/20: red novos casos retornaram media/deliveryMode undefined; green oito SQL live cobrem imagem/audio/video, lost, legado, DEVfailed/unknown e prefixo externo sem autoridade. Historico e resumo consultam binding persistido na mesma snapshot; get3SELECT/list2SELECT sem storage, sem nome/chave/hash/bytes. media.contentUrl so rota relativa CRM autorizada para attachedclean; lostnull. deliveryMode vem do unico recibo original message.send.requested n8n_events, nunca prefixo de mensagem; SSE IDs tecnicos preservados. Quick838pass/3skips(total841), Live65/65=bind54+operationRead1+inbox7+migrations3; type-lint-diff e validadores estritos verdes. Nenhuma Verified; proximoT17.

T15 concluída na fase3; MED-06/21/22/23/24: red settings all/all, ausencia default e botfilter403 Node; green n8n2.38.7 real PNG/OGG/MP4, success/failed/unknown/missing/replay/epoch/hash/size/16MiB, 15 execucoes. Pico1467297792 bytes(1.37GiB), default concorrencia1 limite2GiB/1CPU; somente Meta simulado, sem prova multipart Graph producao. Atualizacao publicada realmente executada e reimport idempotente preservam versao/users/credencial OpenAI sintetica/referencia/volume. Perfil parado15/15 soft-deleted, stack inicialONLY, zero binary/refs/runData/canarios raw-base64 DB-WAL-FS-stdout-stderr; categorias recipient/caption presentes: gate Privacy producao T23 NAO atendido. Seed ready manual/SHA RustFS; wholebuiltworker T24 pendente. Quick838pass/3skips(total841), T15unit11/11; UI107pass/7skips(total114)workers1, type-lint-diff-spec-tasks estritos verdes. Nenhuma Verified ou ADR reescrito; proximoT16.

T14 concluída na fase3; MED-06/21/22/24: red oito cenarios novos falharam por ausencia do caminho de midia; green preserva reserva, bytes nativos medidos antes Crypto v2 e referencia pareada restaurada, SHA/tamanho, URL command_id textual encodeURIComponent, multipart formBinaryData, Meta por ID, preflight real imediatamente antes messages, falha conhecida antes efeito versus unknown depois sem retry. Quick827pass/3skips publicados(total830), contrato especifico8/8 mais DEV8/8 e E2E107pass/7skips publicados(total114) workers1; typecheck/lint/diff verdes. Inventario aprovado canonic51para68 e DEV60para77, mantendo assertions funcionais e cenarios removidos proibidos. Suporte minimo generator necessario ao contrato T14 simula somente upload/messages Meta e impede HTTP externo receber Basic CRM; persistencia/importer/prova runtime n8n continuam T15. API/limites/voice Meta atuais nao demonstrados por endpoints oficiais inacessiveis; ativacao failclosed exige homologated+versao explicita+phone numerico e gate externo T23. Fonte n8n2.38.7 confirmado; nenhum schema ou ADR mudou; nenhuma Verified; proximo T15.

Fix T13/MED-22: comando text reservado agora negado409 por GET/preflight, sem
S3/mutação. Red SQLundefined e HTTP503 confirmado; SQLbind46/46, transporte8/8,
Quick818/3 antigos, typecheck/lint/diff verdes. Próxima T14 em execução;
nenhum requisito Verified e final Verifier permanece após T24.

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

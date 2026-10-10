# Mídia no chat — Design

Spec: [spec.md](spec.md). Contexto: [context.md](context.md).

T18: MediaComposer standalone recebe conversationId/expectedVersion/disabled
e emite sent após o 202. A correção T25 solicitada na UAT substitui a ação
Preparar: selecionar/parar gravação inicia upload e validação do rascunho,
com prévia e progresso; mensagem só é criada por envio explícito após ready.
Preview local usa objectURL revogado ao
remover/substituir/unmount; áudio não apresenta nem envia caption. Legendas
contam Unicode code points com Array.from, sem maxlength UTF-16.
MIME/ extensão do browser são somente hints de declaração; audio/m4a e
audio/x-m4a normalizam para audio/mp4, MIME vazio/extensão aprovada não
impedem bytes válidos. O worker decide formato/codecs e pode rejeitar arquivo
renomeado. Limites no cliente reproduzem 5 MiB imagem/16 MiB áudio e vídeo.

Contexto e File estáveis são capturados na seleção; upload retry mantém chave,
versão e filename. Primeiro envio captura chave e conteúdo; erro ambíguo
mantém preview e congela legenda, retry consulta/envia a mesma operação.
Troca de conversationId/expectedVersion, descarte e unmount abortam o trabalho
e invalidam callbacks pelo generation token; nada envia automaticamente.
Polling tem intervalo 1 s e prazo 600 s canceláveis, incluindo GET pendente:
comporta os 340 s das fases locais mais I/O. Timeout conserva preview/mediaId;
atualizar a validação consulta a mesma mídia sem repetir upload.
Integração Inbox/Recorder/MediaMessage continua fase 4. Harness está apenas
em test/fixtures; nenhum caminho de produto ou estado global foi acrescentado.

T17: request aceita FormData nativo sem JSON.stringify e remove qualquer
Content-Type fornecido para deixar o browser gerar o boundary. JSON, CSRF,
cookies same-origin e a chave capturada continuam iguais. AbortSignal é
propagado para upload/status e abort prévio não chama HTTP. No proxy local,
request.aborted e fechamento de resposta incompleta encerram o upstream;
close normal de IncomingMessage não cancela JSON/Range/SSE completos.

T16: histórico e último resumo projetam `media` somente pelo vínculo
persistido message/conversation/kind. DTO: mediaId, kind, state, mimeType,
sizeBytes, durationMs e contentUrl relativo à rota CRM autorizada; lost ou
unavailable não oferecem contentUrl. Legado mantém preview e media=null.
Não selecionam chave, nome original ou bytes nem fazem chamadas S3. A
classificação `deliveryMode=dev` vem da versão DEV do único recibo original
message.send.requested em n8n_events; failed/unknown mantêm a classificação,
sem inferir entrega real por prefixo do external_message_id. Sem recibo é
null. SSE permanece limitado aos identificadores técnicos existentes.

### T15: persistência efetiva do n8n 2.38.7

DEV/local usam `default` nativo e `none/none/false/false`, concorrência 1,
2 GiB e 1 CPU. Somente os efeitos Meta são simulados; download, tamanho,
SHA-256, reserva, preflight e callbacks passam pelo runtime real.
O trigger técnico do Painel aceita o User-Agent nativo do worker Node
(`ignoreBots=false`); Basic permanece obrigatório no canônico/deployed.

Essas configurações evitam salvar resultados binários, mas o n8n grava uma
execução inicial e faz soft-delete antes do pruning. A inspeção decodificada
encontrou categorias `recipient` e `caption` nesse registro inicial, sem
runData ou binary. Portanto, o gate de privacidade de produção T23 permanece
**não atendido**: minimizar/expurgar PII e comprovar retenção/pruning conforme
EASYPANEL-TOPOLOGY.md (limite de 30 dias). Zero canários de bytes em DB/WAL,
storage e logs sustenta MED-20 no ensaio sintético, sem provar ausência de PII.
Fontes fixadas: [lifecycle](https://github.com/n8n-io/n8n/blob/n8n%402.38.7/packages/cli/src/execution-lifecycle-hooks.ts)
e [persistence](https://github.com/n8n-io/n8n/blob/n8n%402.38.7/packages/cli/src/execution-persistence.ts).
Não desabilitar pruning nem apagar registros para produzir a evidência.
Admissão ready no smoke é seed manual de bytes/SHA em RustFS; execução do
worker construído, scanner e transporte completo seguem T24.
Status: Draft; storage, gravação e retenção decididos; contratos abaixo propostos.
Complexidade: Large, com API, persistência, UI, worker e integração externa.

## Architecture Overview

O CRM recebe uploads autenticados em streaming e usa área temporária privada
limitada. O worker existente verifica MIME/codec, executa ClamAV e normaliza
gravações. Só publica objeto validado no RustFS. PostgreSQL controla estado,
vínculo com conversa/ator, versão, idempotência e quota reservada.

O envio humano vincula uma mídia ready a uma mensagem e cria o comando n8n
na mesma transação. n8n reserva o efeito, busca os bytes pela API técnica
restrita ao comando e faz upload na Meta; envia a mensagem usando o media ID
retornado. A variante DEV baixa os mesmos bytes, mas simula Meta e callbacks.

```mermaid
flowchart LR
    V[Caixa de Entrada e microfone] --> U[Upload autenticado na API]
    U --> P[(PostgreSQL: upload e job)]
    P --> W[Worker: ClamAV e normalização]
    W --> R[(RustFS privado)]
    V --> S[Enviar mídia ready]
    S --> O[Mensagem e outbox transacionais]
    O --> N[n8n: reserva de uso único]
    N --> B[API: bytes por comando]
    B --> R
    N --> M[Meta ou simulador DEV]
    M --> C[Callbacks no CRM]
    V --> H[API: histórico e Range autorizado]
    H --> R
```

### Alternativas avaliadas

Recomendação: proxy de upload/leitura pela API. Mantém a autorização por
conversa em cada requisição e evita URLs portadoras em logs/browser. RustFS
com URLs assinadas reduziria banda da API, mas exigiria CORS, expiração e
controle pós-upload; fica para outra decisão. Volume local não atende à
escolha do usuário. Nenhum framework/store/Redis/microserviço é introduzido.

## Code Reuse Analysis

| Componente         | Localização                                                               | Reuso ou extensão                                                                          |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Envio humano       | modules/inbox-channels/src/application/inbox-service.js:107               | Validar tipo e mídia antes do comando existente                                            |
| Transação de envio | modules/inbox-channels/src/adapters/postgres-inbox-repository.js:343      | Lock, ownership, takeover, mensagem, auditoria e outbox                                    |
| Outbox CRM→n8n     | modules/n8n-integration/src/postgres-command-outbox.js:72                 | Acrescentar referência de mídia; preservar texto                                           |
| Reserva humana     | modules/n8n-integration/src/postgres-repository.js:1182                   | Conferir referência e hash imutáveis no fence                                              |
| Workflow humano    | ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js:1266                 | Atualmente aceita só text; adicionar rota por tipo                                         |
| DEV                | ops/n8n/workflows/create-dev-test-workflow.mjs:163                        | Manter entrada sintética; adaptar saída humana com bytes reais                             |
| Scanner            | modules/integration-reliability/src/clamav-media-scanner.js:18            | ClamAV + libmagic, assinatura até 36 horas                                                 |
| Validação local    | modules/integration-reliability/src/private-media-volume.js:155           | Reusar lógica de streaming/hash/limites, sem acoplar mídia persistida a volume transitório |
| Histórico          | modules/inbox-channels/src/adapters/postgres-inbox-read-repository.js:331 | Enriquecer DTO com mídia e status; hoje só preview                                         |
| Cliente HTTP       | apps/edge-web/src/lib/api-client.js:28                                    | Hoje JSON-only; incluir FormData sem Content-Type manual                                   |
| UI                 | apps/edge-web/src/views/InboxView.vue:501                                 | Composição Vue local; não criar estado em window                                           |
| Retenção legada    | modules/integration-reliability/src/postgres-transient-media.js:273       | Preservar contrato legado; nova tabela não participa do expurgo                            |

## Components

### Storage privado S3

Novo modules/integration-reliability/src/rustfs-media-store.js com
putValidated(stream, key, metadata), head(key), read(key, range) e
deleteDraft(key). Cliente @aws-sdk/client-s3 restrito às operações necessárias,
versão fixada e licença/audit verificados durante implementação. Não reutilizar
o smoke R2 como prova de RustFS. Backend faz GET assinado por credencial S3,
sem URL pública/assinada retornada ao browser.

Configuração proposta: MEDIA_S3_ENDPOINT, MEDIA_S3_REGION,
MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY e
MEDIA_S3_FORCE_PATH_STYLE=true. Valores entram no mecanismo de secrets do
ambiente; region e assinatura precisam de smoke no alpha. Não embutir credencial
no .env versionado, workflow exportado, console do browser ou documentação.

API/worker usam papéis distintos limitados ao bucket CRM do ambiente. n8n usa
Basic do CRM para ler bytes por comando; não recebe chave S3. DEV não consegue
ler bucket operacional. Sem ACL pública e sem dependência de lifecycle S3.

### Pipeline de processamento

Upload fica temporariamente em spool privado montado na API/worker, UUID opaco,
sem nome do cliente. API reserva quota transacional antes de consumir bytes.
Migration expand 0032 registra admissões em `chat_media_admissions` com UUID
do spool, hash somente do crm_session canônico e reserva. A API não mantém
transação SQL aberta durante streaming. Conclusão converte ledger em mídia
e job na mesma transação e ajusta reserva aos bytes reais. Arquivo vazio usa
422 antes do 202, sem input_size_bytes fictício. Replay aceito mede/hash bytes
sem novo spool/cobrança, inclusive com quota cheia; receiving ativo usa 409.
Commit incerto exige consultar estado do ledger sob lock: consumed preserva
spool; falha da reconciliação também preserva. Somente receiving confirmado
permite cleanup/release. Crash mantém reserva. Discovery
`listAbandonedAdmissions` fornece receiving >24h; T22 executa limpeza sob
lock/recheck, sem liberar reserva antes da remoção confirmada. Streaming tem
deadline de 120 s e lease advisory de sessão em conexão dedicada, sem BEGIN.
A conexão só é liberada após fechar o writer; complete/release usam SQL depois
disso, inclusive com pool de upload de uma conexão. Perda de conexão aborta
o stream; prazo persistido de três minutos protege uma admissão antiga até o
encerramento físico, mesmo se a sessão advisory desaparecer.

Cleanup de mídia sem vínculo e com mais de 24h primeiro confirma intenção
durável (`cleanup_started_at`, estado unavailable), sob locks de job/mídia e
writer. Só depois do commit remove spool, intermediários e objeto S3; uma
segunda transação confirma remoção e libera quota. Rollback após DELETE nunca
restaura ready vinculável. Attached e message_id não nulo são excluídos.
Normalização cria intermediários `.recording-<UUID da variante>-<sufixo>`;
cleanup remove somente diretórios daquele UUID. Diretórios antigos sem UUID
ou de outra mídia permanecem para reconciliação operacional.

Processamento usa a mesma lease de sessão durante decoder/PUT; heartbeat perdido
aborta subprocessos/streams e aguarda close antes de liberar a guarda. O prazo
persistido de 15 minutos é conservador para orçamento local de 340 s mais IO;
cleanup revalida esse prazo nas duas etapas. Job processing nunca autoriza
cleanup, mesmo com lease expirada: a fila real precisa recuperar/finalizar antes.
Intent de cleanup impede novo acquire. Conexão perdida conserva reserva até
prazo e recheck; erros de DELETE conservam intenção e quota para retry.
Pool do worker precisa de pelo menos duas conexões (padrão dez) para guarda
e consultas/heartbeat; upload suporta pool de uma. Comandos locais usam SIGKILL
em cancelamento/timeout, esperam close e removem listener, inclusive no Linux.
Admissão T7 reserva o pior caso antes do streaming: anexo, duas vezes o
limite do tipo; gravação, três vezes 16 MiB. Após medir os bytes reais,
pode ajustar para duas vezes a entrada do anexo, ou entrada mais duas vezes
16 MiB na gravação. Content-Length não autoriza escrita além da reserva.
Essa conta cobre spool, intermediário/variante e objeto conjuntamente.
Limite é aplicado durante streaming e confirmado pelo tamanho/hash real.

Worker usa jobs PostgreSQL; executa conversões sequencialmente (um decoder).
API admite no máximo dois pipelines por bucket, contando receiving recente
(três minutos) ou com guard futuro, e mídia
com job pending/retry/processing ou guarda física futura; quota lock serializa
sessões diferentes. Pipeline saturado devolve429 antes de nova reserva/bytes.
Ready/job terminal sem guarda libera capacidade; replay já aceito não consome
slot novo, mesmo com quota/capacidade cheia. O limite não afeta mensagens texto.
Receiving órfão com grace expirada libera slot, mas conserva reserva e bytes
até cleanup confirmado >24h; não bloqueia todas as admissões por24h após crash.
ClamAV falha fechado, libmagic verifica MIME, ffprobe verifica container,
codec e duração. FFmpeg/ffprobe entram na imagem runtime existente como
dependência justificada, sem serviço novo. Use execFile com argumentos fixos,
protocolos locais, sem shell e sem abrir recursos externos apontados pelo arquivo.
Timeout do encoder: 120 segundos; cada scan 60 s, probe 10 s e decodificação de
timeline 30 s; libmagic 10 s por arquivo. Gravação completa tem orçamento máximo de 340 s das fases locais,
além de IO/DB; handler renova lease durante todas as fases. Conversões são
sequenciais com threads=1 e memória, CPU e spool limitados. Escolha em T5 evita
declarar timeout de 120 s total que não mataria os subprocessos de outras fases.

Gravações são normalizadas para OGG/Opus mono; anexos válidos não são
transcodificados por padrão. Scan e validação alcançam a entrada e o arquivo
final; limite de 16 MiB se aplica aos dois. Saída limpa vai ao RustFS; ready só
é gravado após PUT, confirmação de integridade e remoção confirmada do spool.
SHA, tamanho e MIME da variante são persistidos antes do PUT; HEAD divergente
impede sobrescrita e publicação. Somente depois do cleanup, ready reduz a
reserva ao objeto final; used muda apenas no vínculo T10. Falha de cleanup
ou rollback mantém a reserva anterior. Crash PUT/DB reconcilia chave
determinística de upload/variante; não cria segundo arquivo visível.

O resultado completo da validação da saída pode ser reutilizado somente dentro
da mesma tentativa, evitando nova carga ClamAV para os mesmos bytes. Antes do PUT
o arquivo deve continuar regular e com tamanho confirmado; putValidated confere
SHA/tamanho durante streaming e checksum S3, e HEAD deve corresponder aos metadados.
Retry que encontra metadados preparados e objeto ausente valida novamente, sem
cache entre jobs ou entre arquivos. Scan/freshness e bloqueio de arquivo infectado
permanecem obrigatórios; gravação conserva validação da entrada e da saída.

Falha conhecida antes do envio admite retry de processamento com o mesmo
upload_id. Timeout após efeito Meta segue reconciliação, sem novo envio.

### UI

T25 integra os três componentes em um composer por slots internos: prévia
acima da barra, Responder sem mídia ou Legenda para imagem/vídeo, controles
temáticos de anexar/gravar e um envio contextual. Sem store global ou nova
biblioteca. Legenda permanece editável durante upload/validação e congela
quando o primeiro comando de envio captura o payload. Retry usa o mesmo
upload/mediaId e comando; recusa é explicada por status, sem expor conteúdo
ou detalhes internos. Controles têm alvo44px, gap, foco visível e layout estreito.
O runtime da UAT4183 aponta ao perfil completo com Origin/CSRF4183;
demo media-off anterior é preservada como snapshot histórico, sem impedir o teste.

MediaComposer.vue: uma mídia selecionada, prévia, estado de validação, remover,
legenda imagem/vídeo e envio explícito. AudioRecorder.vue: iniciar, duração,
parar, ouvir, descartar e enviar; captura nunca começa no mount. Negotiar MIME
via MediaRecorder.isTypeSupported. MediaMessage.vue: imagem, audio/video com
controles nativos, preload=metadata, sem autoplay, estado unavailable/lost.

Navegação por Tab/Enter/Espaço; Escape cancela prévia quando não há envio em
curso. Ao concluir/descartar, retornar foco ao acionador/composer. Região de
status anuncia mudanças sem narrar cada segundo. Parar tracks e revogar URLs
ao trocar conversa, sair da tela, cancelar ou encerrar captura. Texto continua
disponível em falha de upload ou ausência de microfone.

## Data Models

Não transformar crm.transient_media em arquivo persistente nem remover seu
expires_at globalmente: a tabela possui trigger de imutabilidade e jobs de
fim de jornada. Criar uma classe nova, isolada do sweeper legado.

### crm.chat_media

- id UUID; conversation_id FK; uploaded_by FK de usuário; upload_command_id
  único por ator/conversa; request_fingerprint para replay.
- message_id FK nullable e UNIQUE: um arquivo por mensagem, vínculo de uso único.
- kind image/audio/video; origin attachment/recording; filename_envelope cifrado.
- state uploaded/processing/ready/attached/rejected/unavailable/lost;
  validation_status; sanitized_reason; original_sha256 e content_sha256.
- object_key UUID opaco; storage_backend=rustfs; storage_bucket_alias;
  size_bytes, detected_mime_type, container, codecs e duration_ms.
- created_at, processed_at, attached_at; retention_class=chat_retained;
  sem expires_at para mídia enviada. Tempo limite de rascunho é derivado
  de created_at enquanto message_id é NULL, não aplicado a attached.
- reservation_bytes e versão/CAS para quota, processamento e cleanup concorrentes.

Identidade de comando humano T11 é fingerprint canônico do JSON normalizado,
sem correlationId; ator/conversa/versão/type/content/reason continuam cobertos.
Ordem de chaves e novo trace não mudam o comando. O gate de entrada false ocorre
após lookup idempotente e antes de locks/mutações de domínio. Replay exato já
aceito permanece legível e não repete mensagem/bind/cobrança. Fallback do hash
legado inteiro preserva a mesma identificação original; trace legado novo não
é reconstruível sem o payload/correlação que não foram persistidos, então409.

Mensagem mantém content_envelope cifrado com {mediaId, caption}; bytes não
ficam no PostgreSQL. A relação nova não usa crm.attachments, cujo FK aponta
para transient_media. Índice em conversation_id/message_id e varredura
parcial de rascunhos; nenhuma query de histórico faz GET S3 por linha.

Job chat_media.process identifica chat_media.id; ajustar constraints da
tabela de jobs por migration expand nova, sem editar migrations publicadas.
Uma função transacional liga mídia ready à mensagem e revalida dono,
conversa/versão/terminal, hash e quota. Envio humano conserva takeover existente;
upload e gravação sozinhos não assumem atendimento nem iniciam automação.

## API e contratos propostos

Prefixo /api/v1. Todos os endpoints humanos usam sessão/capacidade de
conversa; mutações usam CSRF, Idempotency-Key e controle de versão vigente.

| Endpoint                                         | Resultado                                                                        | Limites / permissão                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| POST /conversations/{id}/media                   | 202 com mediaId, state=processing e statusUrl; replay devolve resultado original | Multipart: um arquivo, origin, versão; permissão de envio sem takeover no upload                                       |
| GET /conversations/{id}/media/{mediaId}          | 200 DTO de status/metadados                                                      | Enquanto rascunho: ator do upload ou admin; depois: autorização de leitura da conversa                                 |
| GET /conversations/{id}/media/{mediaId}/content  | 200 ou 206 streaming                                                             | Ready de rascunho restrito ao ator/admin; attached por ACL da conversa; Cache-Control private,no-store; nosniff        |
| POST /conversations/{id}/messages, existente     | 202, messageType=image/audio/video e content={mediaId,caption?}                  | Mídia ready ligada ao mesmo ator/conversa; proibir URL/key arbitrária                                                  |
| GET /integrations/n8n/commands/{commandId}/media | 200 streaming                                                                    | Basic AUTOMATION_EXECUTOR e capacidade específica; comando reservado processing, message_id/mediaId/hash/epoch válidos |

Novo GET técnico é extensão explícita ao contrato anterior de três endpoints;
`?preflight=true` retorna JSON seguro somente leitura no mesmo endpoint, sem
S3, nova reserva ou renovação. HEAD não é exposto. Basic e capacidade
integration.n8n.command.media.read exigem workflow/version/execution da reserva
original em n8n_events; comando processing e mensagem sending da variante
attached/clean são conferidos. Preflight ocorre após Meta/media e antes de
Meta/messages. Falha conhecida anterior ao efeito usa workflow.failed com
phase=before_message_send e allowlist OpenAPI; conclui sob CAS da execução
original, sem exigir epoch atual, sem retry e sem regredir estados finais.
Falha genérica é diagnóstico; após invocar Meta/messages só unknown.
não esconder a alteração sob a ADR 003. n8n pede bytes apenas depois da reserva.
Replay da reserva continua send_authorized=false; GET de bytes não concede
segunda autorização de envio. Verificar fence novamente antes do efeito Meta.
Novo payload inclui media_id, sha256, mime_type, size_bytes e type; o hash de
autorização cobre referência, variante e legenda, não hostname arbitrário.
A message é plana: metadata de variante e caption estão na mesma message da
outbox; text acompanha a caption existente para compatibilidade do webhook.
Campos filename/media_url permanecem null e nenhum object_key é exposto.
Fonte única é chat_media attached+clean vinculada à mensagem/autor/conversa.
O fence reconsulta essa linha sob lock e compara também caption do envelope
atual da mensagem. Aliases de referência são proibidos na mídia retida;
contradição entre aliases legados nunca é selecionada silenciosamente.
Fences queued/processing/human/nonterminal/epoch/source revision permanecem;
uma mensagem sending não autoriza nova reserva e replay retorna false.
Unknown Meta preserva outcome_unknown sem retry automático; callbacks mantêm
a ordem read/delivered/sent. Leitura de execução reservada sending é T13.
Callbacks sent/unknown resolvem a conversa canônica pelo UNION de comandos
e mensagens, inclusive com conversation_id explícito; contradição retorna
409 antes de auditoria, SSE ou recibo. Updates também exigem essa conversa.
Confirmação conhecida move outcome_unknown para sent e limpa o erro do
comando, mantendo ambos flags de retry false. Histórico de job e reconciliação
preexistente é preservado para revisão operacional, sem reagendar efeito.

MED-04: no POST multipart /media, 413 para excesso de bytes e 422 para campos
multipart ou tipo declarado inválidos detectados antes de aceitar o upload.
No POST /messages, payload ou caption inválidos retornam 400 conforme T11;
caption pertence ao comando da mensagem, não aos campos multipart do upload.
MIME real, codec e
duração reprovados pelo worker não alteram o 202 já devolvido: o GET de status
retorna 200 com state=rejected e reason=invalid_format (MED-29). 401/403 para acesso,
409 para estado/replay divergente, 429 para quota/throttle, 503 para dependência,
410 para objeto perdido conhecido; formatos application/problem+json existentes.
Range único aberto/sufixo aceito; intervalos múltiplos ou inválidos retornam 416.
Evitar armazenar o arquivo inteiro na memória para servir áudio/vídeo.

Propostas iniciais: quota DEV 1 GiB e operacional 10 GiB, com reserva SQL;
ajustar pelo espaço real observado antes de ativar. Limite de 12 uploads/minuto
por sessão e um upload em progresso por composer. Alertas técnicos em 80%/90%;
atingir quota bloqueia mídia nova sem apagar anexos preservados nem bloquear texto.

Quota contabiliza bytes preservados mais reservas pendentes, nunca apenas
uploads em progresso. Ao passar ready → attached, converter a reserva em
ocupação persistida sem liberar espaço fictício. Originais/intermediários e
saída normalizada consomem a quota de spool enquanto existem; a ocupação
persistida soma todos os objetos finais mantidos. Só liberar ocupação após
remoção confirmada do rascunho ou exclusão explicitamente autorizada por
política futura. Testar uploads sucessivos já attached até 429 e corrida entre
processamento, envio e cleanup, sem dupla cobrança nem quota negativa.

## n8n e validação sem WhatsApp

Produção: CRM outbox → webhook de painel → reservar → buscar bytes restritos
→ POST Meta /media → POST Meta /messages com media ID → callback. Perda de
resposta de /messages gera unknown. Upload em /media não equivale a mensagem
enviada. Não passar URL autenticada do CRM à Meta nem abrir bucket para ela.

DEV mantém os nós de reserva/callback, lê bytes reais e compara hash/tamanho;
simula apenas efeito Meta. Cobrir success, failed-before-send, send_unknown,
duplicidade, mídia de outra conversa, epoch alterado e media_missing.
Estado simulado deve aparecer como simulado na UI/evidência; não como
comprovação de entrega WhatsApp. A janela do Chat Trigger segue como cliente
sintético e não recebe push humano assíncrono por presunção.

Entrada de mídia do cliente via chat n8n/IA não é exigida nesta fatia. O teste
inicia conversa por texto no Chat Trigger, faz handoff e envia pelo CRM.

## Retenção, transição e recovery

Anexos enviados ficam em chat_retained, sem lifecycle de expiração de objetos
no bucket e sem job de limpeza ao encerrar. Não configurar o bucket para
backup automático no bucket hermes-backups; cópia externa tem destino próprio.

Rascunhos sem message_id por 24 horas podem ser removidos após lock/recheck;
ready ligado por transação concorrente nunca é apagado. Rejeitados/partiais
e intermediários de conversão são removidos ao terminar o processamento.
Falha de remoção é pendência técnica com retry limitado à limpeza, nunca envio.

Transição de legado é controlada: inventariar somente cópias disponíveis;
copiar, validar hash e registrar nova referência persistente antes de cancelar
jobs de expurgo correspondentes. A operação exige lock para impedir corrida
com DELETE iniciado; objeto já indisponível fica lost e não promete restauração.
Não apagar o volume ou impor nova retenção a backups/Pedidos nesta tarefa.

Backup externo independente de VPS/RustFS inclui objetos vinculados e manifesto
de hashes para reconciliação com PostgreSQL; exercício de restore isolado
comprova vínculo/hash/playback. Herda RPO/RTO do projeto e sua evidência,
sem considerar quatro volumes no mesmo host como cópia independente.
Sem comprovação, registrar gate pendente e limitar uso a testes sintéticos.

## Error Handling Strategy

| Falha                         | Tratamento                                                    | Experiência                                                 |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Upload interrompido           | Rascunho recuperável pelo mesmo upload_id; cleanup de parcial | Prévia preservada, retry explícito                          |
| Scanner/encoder indisponível  | state=unavailable, nenhum envio permitido                     | Motivo seguro e possibilidade de anexar formato suportado   |
| RustFS timeout PUT            | Reconciliar key/head/hash; não publicar ready incerto         | Processando/pendente, sem mensagem duplicada                |
| PUT concluído e commit falhou | Job reconcilia mesmo ID ou limpa somente órfão                | Nenhum falso sucesso                                        |
| n8n/Meta timeout após efeito  | unknown, reconciliação existente                              | Pendência visível sem retry cego                            |
| Permissão/versão mudou        | Revalidar antes do vínculo e reserva; 403/409                 | Bloquear envio; preservar rascunho para decisão do operador |
| Objeto perdido                | lost; preservar metadados                                     | Arquivo indisponível no histórico                           |

## Risks & Concerns

| Concern                                               | Location (file:line)                                                      | Impact                                         | Mitigation                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| RustFS configurado alpha.99                           | context.md:24                                                             | Documentação atual pode divergir               | T1 smoke na versão instalada; digest e negativas por bucket; upgrade não automático |
| Sem backup de volume mostrado                         | context.md:29                                                             | Preservação não garante recuperação            | T23 backup externo/restore com gate explícito                                       |
| Outbox descarta referência                            | modules/n8n-integration/src/postgres-command-outbox.js:79                 | Média chega como null                          | T12 acrescenta referência estável e testes de fingerprint                           |
| Workflow aceita só text                               | ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js:1274                 | Mídia rejeitada mesmo com UI pronta            | T14/T15 rotas e simulador com bytes reais                                           |
| Histórico retorna só preview                          | modules/inbox-channels/src/adapters/postgres-inbox-read-repository.js:346 | Anexo não reproduz                             | T16 DTO sem N+1 S3 e T20 controles nativos                                          |
| Helpers HTTP serializam JSON                          | apps/edge-web/src/lib/api-client.js:42                                    | FormData quebrado                              | T17 preserva multipart e testes de CSRF                                             |
| Sweeper de encerramento                               | modules/integration-reliability/src/postgres-transient-media.js:273       | Apaga arquivo que deve permanecer              | T2 tabela isolada e T22 negativas contra jobs antigos                               |
| MediaRecorder varia por browser                       | Fonte MDN abaixo                                                          | WebM não deve ir direto ao canal por suposição | T5 normaliza; T19 negocia MIME; T24 UAT browser                                     |
| Acesso S3/compatibilidade não testados nesta inspeção | context.md:25                                                             | Falsear prontidão operacional                  | T1 é pré-condição para ativação, não check concluído                                |

## Tech Decisions

### Antivírus persistente — T29

Decisão explícita de 10/10/2026: usar `clamd` no worker existente
([ADR 030](../../../docs/adr/030-antivirus-persistente-no-worker.md),
[RFC 018](../../../docs/rfc/018-antivirus-persistente-no-worker.md)).
Socket Unix privado, sem TCP; cliente `clamdscan --fdpass`. Inicialização,
recuperação e parada são supervisionadas. O health exige resposta PONG.
Atualização encerra o motor anterior, aguarda o novo e só então publica
freshness. O scan captura a data antes da execução, preservando MED-26
mesmo se ocorrer atualização concorrente. Não alterar ACL, hash, quota,
normalização ou limites de recurso para obter redução de latência.

Auditoria da baseline em 05/10/2026 encontrou vulnerabilidade alta em
source-map-js (GHSA-68fv-2mgg-jv7q). Não foi introduzida pelo plano, que não
altera dependências. Corrigir em manutenção própria antes de satisfazer o
gate de dependências de Execute/release; não ignorar nem reduzir o audit-level.
O E2E da baseline também retornou 6 falhas (101 passaram, 7 skips), sem
alteração de aplicação/testes nesta entrega. A investigação e o fechamento
desses gates precedem o aceite da implementação; detalhes em planning-review.md.

| Decision             | Choice                          | Rationale                                                     |
| -------------------- | ------------------------------- | ------------------------------------------------------------- |
| Registro persistente | Tabela nova chat_media          | Isola bytes preservados dos contratos transitórios existentes |
| Transporte           | Proxy autenticado em streaming  | Controle de ACL em cada leitura; sem signed URL no browser    |
| Processamento        | Worker PostgreSQL existente     | Trabalho limitado; nenhuma infraestrutura adicional           |
| Formato de gravação  | OGG/Opus mono após normalização | Browser não determina sozinho formato entregue ao canal       |
| Status do plano      | Draft                           | Não alegar aprovação dos detalhes ainda não revisados         |

## Fontes e limites da pesquisa

- [RustFS: matriz S3](https://docs.rustfs.com/en/reference/s3-compatibility):
  documenta subconjunto testado; não prova suporte no alpha instalado.
- [MDN: MIME de gravação](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static):
  consultar suporte antes de gravar; gravação ainda pode falhar por recursos.
- [MDN: microfone](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia):
  requer contexto seguro e permissão; usar somente audio=true.
- Context7 não está disponível entre as ferramentas descobertas nesta sessão.
- Documentação Meta não pôde ser aberta na pesquisa. Revalidar allowlist,
  codecs, limites em bytes, voice flag e API version na fonte oficial antes
  do envio real. O DEV não satisfaz esse gate.

## Rollout e rollback

1. Smoke isolado RustFS, acesso mínimo e backup/restore; não alterar Hermes.
2. Migration expand compatível, API/worker com feature desativada.
3. Validar upload/scan/codec/retenção/concorrência e DEV sintético.
4. Publicar contrato n8n e UI após API compatível; ativar mídia no DEV.
5. Homologar WhatsApp separado e ativar operacional com evidência.
6. Rollback desativa novos uploads/envios de mídia; texto continua. Preservar
   chat_media, bytes e comandos unknown. Não reativar DELETE transitório para
   essa classe, não reverter por DROP e não restaurar banco como primeiro recurso.

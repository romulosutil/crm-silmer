# Validação T32: pipeline remoto para testes internos

**Veredito: PASS no escopo de upload, validação, armazenamento e leitura DEV
autorizado em T32.** Não representa envio de mensagem, callback n8n, entrega
WhatsApp, homologação completa T24 nem liberação de dados operacionais.

- Data: 10/10/2026.
- Verifier: `/root/production_edge_verifier`, independente do autor.
- Fonte do aceite: `.specs/features/inbox-media-rustfs/tasks.md:509` a `:520`.
- Baseline de código: `d9e3a70f9f1ca886f227548c6410043943971d99`.
- Foco: configuração remota DEV e documentação; nenhuma implementação ou
  configuração remota foi alterada pelo Verifier.
- Provas locais em `var/T32-*-proof.jpg` são capturas de serviços remotos,
  inspecionadas individualmente com `view_image`, não substitutos Docker locais.

## Aceite e evidência remota

| Critério T32 | Evidência e resultado observado | Resultado |
| --- | --- | --- |
| Worker faz PUT/GET/DELETE dos bytes sintéticos | `execution.md:27`; `docs/runbooks/rustfs-chat-media.md:105`; `var/T32-worker-put-get-marker-proof.jpg` mostra `put:true, get:true`, comparação Buffer com os bytes sintéticos; `var/T32-worker-cleanup-health-proof.jpg` mostra `deleted:true`, calculado exclusivamente por HEAD HTTP404 após DELETE | PASS |
| API usa leitura sem escrita e nega bucket alheio | `docs/runbooks/rustfs-chat-media.md:105` a `:107`; `var/T32-api-iam-proof.jpg`: `apiGet:true`, `apiPut.denied:true/status403`, `otherBucket.denied:true/status403` | PASS |
| Worker nega acesso ao bucket de arte | `var/T32-worker-foreign-bucket-proof.jpg`: GetObject com credencial worker em bucket distinto retorna `foreignBucketDenied:true,status403`; corpo não é consumido se ocorrer sucesso inesperado | PASS |
| Bucket privado recusa GET anônimo de canário existente | Probe independente `rtk proxy curl.exe -sS -o NUL -w "%{http_code}" <HTTPS S3 canário sintético fornecido>` retornou **403**, entre PUT e cleanup; existência corroborada na prova worker PUT/GET. Nenhum segredo usado ou byte guardado | PASS |
| API/worker compartilham spool privado com UID/GID1000/0700 | `execution.md:16` a `:25`; `docs/runbooks/rustfs-chat-media.md:84` a `:103`; `var/T32-api-schema-spool-proof.jpg` e `var/T32-worker-runtime-proof.jpg`: uid/owner/group1000, mode700 e enabledtrue; worker `markerCreated:true`, API `sharedMarker:true`, cleanup `markerRemoved:true` nas provas específicas | PASS estado observado |
| Schema e saúde prontos antes do pipeline | `execution.md:28` a `:30`; `var/T32-api-schema-spool-proof.jpg`: versions0030–0033 com matchedtrue, comparação de version/name/phase/checksum contra loadMigrations e readiness true; `var/T32-worker-runtime-proof.jpg`: clamdtrue/freshtrue; cleanup proof executa runtime-healthcheck e imprime `runtime-health-ok` somente após exit0 | PASS |
| API readiness HTTP remoto | Probe independente `rtk proxy curl.exe -sS --max-time 15 -w " STATUS:%{http_code}" https://crm.silmer.com.br/api/health/ready`: `{"service":"crm-silmer-api","status":"ready"} STATUS:200` | PASS |
| PNG, MP3, MP4 e gravação chegam a ready/clean | `execution.md:32` a `:36`; `var/T32-image-ready-proof.jpg`, `T32-audio-ready-proof.jpg`, `T32-video-ready-proof.jpg`, `T32-recording-ready-proof.jpg`: prévias e revisão, sem envio; `var/T32-api-spool-proof.jpg` mostra os quatro registros ready/clean, MIME image/png, audio/mpeg, video/mp4, audio/ogg | PASS |
| Leitura autorizada dos três tipos e recusa do ator alheio | `execution.md:38` a `:43`; `docs/runbooks/rustfs-chat-media.md:124` a `:130`; `var/T32-content-acl-proof.jpg`: áudio/imagem/vídeo com status200, sizeMatchestrue, hashMatchestrue e unrelatedActor403. Probe importa runtime readChatMediaContent, repository, store e DB reais no container API; mede stream/hash e compara ao banco | PASS runtime remoto |
| Configuração final e rollback sem segredos, sem mensagem a clientes | `docs/runbooks/rustfs-chat-media.md:48` a `:57` registra bucket DEV privado, flags e quota; `:132` a `:138` desliga admissão/consumo e preserva leitura, volume, bytes, chaves e vínculos. Provas usam canário/arquivos/conversa sintéticos e drafts; nenhum SEND foi executado | PASS escopo documentado |

`var/T32-api-spool-proof.jpg` é evidência de registros ready/clean no banco,
apesar do nome. A prova do diretório é `T32-api-schema-spool-proof.jpg`, e a
visibilidade compartilhada está em `T32-api-shared-marker-proof.jpg` junto às
provas worker de criação/remoção do marcador.

As imagens expõem nomes de variáveis, não seus valores secretos. O probe de
conteúdo imprime somente tipo, status e comparações booleanas, sem bytes,
credenciais, URLs assinadas ou conteúdo comercial.

## Adequação aos requisitos sem ampliar o aceite

MED-16 tem suporte remoto de ACL do draft e leitura real por ator, além do
registro de imagem HTTPS sem sessão401. O probe direto de runtime não exercita
autenticação HTTP por sessão e não equivale à matriz inteira de autorização.
`modules/integration-reliability/src/postgres-chat-media-upload-repository.js:205`
a `:220` limita a linha à conversa e exige uploader ou administrador para draft.

MED-19 tem suporte de acesso S3 real e limpeza confirmada. Não foi induzida
indisponibilidade remota nem perda de mídia vinculada. MED-26 tem scanner PONG,
freshness<=36h sem timestamp futuro e clean nos uploads; não houve infecção,
base stale ou parada de daemon remoto. Essas falhas são cobertas localmente,
sem degradar os controles do ambiente alvo.

MED-20 tem minimização das provas e configuração sem segredos versionados;
a persistência inicial n8n de header Basic permanece P1 conhecida. MED-23 não
foi homologado no n8n remoto: esta tarefa prepara o pipeline, sem SEND, callback
ou reserva. Bucket DEV por si só não seleciona workflow DEV. MED-28 registra
quota1GiB, mas não comprova 429 sob saturação remota. Nenhum desses requisitos
recebe status Verified global por este relatório.

## Gate local de regressão e sensor

`rtk proxy var/tooling/node-v24.20.0-win-x64/node.exe --test test/chat-media-content-routes.test.js`

**18 testes, 18 PASS, 0 FAIL, 0 SKIP.** Exemplos discriminantes:
`test/chat-media-content-routes.test.js:147` exige 401 sem sessão; `:152` exige
403 para ator proibido; `:156` exige 503 na falha transitória preservando state
attached em `:157`; `:163` exige 410 para objeto perdido e `:165` state lost;
`:166` impede exposição do detalhe secret-key; `:169` exige 503 para MIME de
HEAD divergente; teste de conteúdo inválido em `:183` a `:191` exige 409.

Sensor em cópias isoladas de API/teste, dentro de scratch exclusivo em var.
Baseline scratch passou18/18 antes das mutações. Nenhuma operação remota,
git stash ou alteração do código real foi usada.

| Mutação | Fonte e asserção que matou | Resultado |
| --- | --- | --- |
| Bypassar authorizeChatMediaRead e servir sem sessão | `apps/api/src/chat-media-content-routes.js:12`; `test/chat-media-content-routes.test.js:147`, status401 obrigatório | KILLED |
| Ignorar a validação de metadata HEAD do S3 | `apps/api/src/chat-media-content-runtime.js:65`; `test/chat-media-content-routes.test.js:169`, MIME divergente exige503 | KILLED |
| Aceitar conteúdo sem ready/attached e clean | `apps/api/src/chat-media-content-runtime.js:18` a `:22`; teste invalid_format exige409 | KILLED |

**3/3 mutações mortas**, zero sobreviventes. Scratch removido e
`git status --porcelain` idêntico ao baseline após cleanup. Evidência ignorada:
`var/T32-verifier-sensor.mjs`. Nenhum teste foi enfraquecido ou removido.

## Limites concretos e operação

- O painel reaplica0777 transitoriamente ao bind; wrappers restauram0700 e
  validam dono antes de iniciar os processos. O estado observado passou;
  exposição durante redeploy continua risco, documentado em
  `docs/runbooks/rustfs-chat-media.md:92` a `:103`, e bloqueia promoção operacional.
- O operador concedeu permissão e uma gravação real chegou à revisão pronta.
  Isso não fecha cancelamento, limites, ergonomia, áudio ouvido nem matriz T24.
- Imagem/vídeo pela rota HTTPS e imagem401 constam do registro do autor.
  Áudio navegado diretamente no navegador Codex retornou ERR_BLOCKED_BY_CLIENT;
  essa tentativa não prova playback HTTP. Conteúdo de áudio pelo runtime API
  real e preview da UI passaram, com distinção explícita entre as fronteiras.
- O deployment/digest está registrado em
  `docs/runbooks/rustfs-chat-media.md:112` a `:114`; as capturas de console
  corroboram resultados de API/worker reais, sem novo deploy do Verifier.
- Bucket operacional, entrega Meta, privacidade n8n, backup externo e restore,
  callback DEV e homologação completa T24 permanecem abertos.
- Cleanup removeu apenas canário e marcador temporários. Drafts sintéticos
  continuam sujeitos ao cleanup próprio após24h, sem apagar mídias vinculadas.

O PASS é de T32 no ambiente remoto de testes internos autorizado, com as
fronteiras acima. Nenhum envio a cliente ou uso operacional foi certificado.

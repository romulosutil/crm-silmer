# Execução INBOX-MEDIA-1

## T6: Worker de processamento persistente

Premissas, arquivos e sucesso enviados ao integrador antes do patch: preservar
fila existente e efeitos Meta, nova migration 0028 sem reescrever 0027,
CAS/attempt vigente, persistir variante antes do PUT e confirmar cleanup antes
de ready. Arquivos: handler, repository, job queue, exports, worker, updater,
allowlists de observabilidade, migration, testes unit/live e documentação.
Nenhuma dependência nova. O fixture T2 passou a usar queue canônica chat_media,
sem mudar suas oito assertions/cenários. Requisitos MED-14/19/26/28/29 seguem
In Progress até verificação independente e integração das próximas fases.

Quick/Topology/Build: validate PASS, 722 aprovados, três skips antigos,
725 total, Node 24.20.0/npm 11.19.0. Novos unitários: 16 handler e quatro
composição/lifecycle. Suite SQL conjunta: 23/23 PASS (13 T6, oito schema T2,
dois queue legados), zero skips. Ciclo combinado final: 14/14 PASS, 54,16 s,
incluindo os 13 SQL e PNG + gravação WebM Chromium reais contra RustFS alpha.99,
SDK e banco dedicados. Hash original/final, tamanho, MIME, ready, quota e
spool vazio confirmados. Objetos sintéticos removidos pelo teste.

Imagem final construída com T6:
`sha256:d372430897763a95b471898d349af004525ae234003fb350e7f5538fbaaf1655`,
400961795 bytes. Container isolado com USER node/UID 1000, read-only,
2 GiB/1 CPU e tmpfs privado. Scanner e normalizador reais vieram dos módulos
`/app/modules` dessa imagem; handler/repository/SDK rodaram no host contra
DB e RustFS locais. A imagem T5 7105b14c contém somente T5 e anteriores.
Não alegamos worker completo remoto ou ativação operacional, pendentes T23/T24.

Falhas de desenvolvimento: FK do attempt inicialmente UUID contra coluna
TEXT existente; corrigida para TEXT antes da entrega. Harness de recovery
descartava um claim recém-criado, corrigido preservando o claim. Primeiro
replay na imagem usou helper relativo ao WORKDIR /app, corrigido para caminho
absoluto /workspace. Todos os cenários reexecutados; nenhum teste enfraquecido.
QA encontrou ACK terminal antes da persistência da rejeição; corrigido com
retrySafe em DB throw/CAS false e convergência comprovada no mesmo registro.

Contratos: queue chat_media/job chat_media.process/effect internal; claim
carrega chatMediaId. Heartbeat de 5 s acompanha scanner/encoder. PUT é efeito
interno imutável e reconciliável, sem marcar efeito Meta. prepare persiste
SHA/tamanho/MIME antes de PUT; HEAD divergente não sobrescreve. Cleanup
confirmado precede transação ready; reserva cobre spool/intermediários/objeto
e só reduz ao tamanho final após cleanup, used muda somente em T10. Falha de
cleanup ou rollback conserva reserva; replay após cleanup e DB crash usa
HEAD no mesmo registro, sem segunda conversão/PUT. Rejeitados conservam
reserva até cleanup T22. Freshclam inicia em background; stop/concurrent
start não recriam timer depois de shutdown. Mídia continua fail-closed.

### Adequação: suficiência e discriminação

Aliases: unit = test/chat-media-process-worker.test.js;
sql = test/chat-media-process-postgres-live.test.js;
composition = test/chat-media-worker-composition.test.js.
Referências abaixo são linhas concretas das assertions.

| Critério                        | Assertion concreta                          | Esperado                                          |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Replay e variante única         | unit:173/174/184/185; sql:303               | Um PUT e um prepare/ready                         |
| Variante preparada antes do PUT | unit:107/110                                | SHA presente, bytes exatos                        |
| Quota ready                     | sql:300/301/302/304                         | Reserva final, used zero, spool vazio             |
| Rollback após PUT e cleanup     | sql:326/330/331/332/337/338/339/340/341/342 | Mesmo registro, HEAD, sem novo PUT/scan           |
| Cleanup falho                   | sql:362/363/367/381/382/383/384             | Reserva integral até remover spool                |
| HEAD divergente                 | sql:398/399/400                             | Não sobrescrever nem liberar reserva              |
| Scanner e formato negados       | unit:210/211/212; sql:414/415/416           | Sem PUT/ready, rejeição persistida                |
| Rejeição com DB/CAS falho       | sql:462/463/477/482/490/491                 | Retry no mesmo registro antes de ACK              |
| Fencing e concorrência          | sql:281/291/510/512/513/515                 | Um owner, stale attempt não publica               |
| Lease durante subprocesso       | unit:244/245/246/254/255                    | Sem efeito perdido, heartbeat repetido            |
| Queue e integração              | sql:252/253/254; composition:22/23          | ID e handler na fila canônica                     |
| Texto e lifecycle               | composition:66/67/90/91                     | CDN pendente não bloqueia texto/timer             |
| Privacidade observável          | composition:38/39/40/41                     | Dimensões técnicas, sem canários privados         |
| Ciclo real na imagem            | sql:647/653/654/659/660/664                 | Ready, hash/tamanho/MIME, used zero e spool vazio |

Near misses discriminados: ready sem cleanup falha sql:304; liberar reserva
no rollback falha sql:326/340/341; confiar só no HEAD sem comparar SHA/MIME/size
falha sql:398/399; reprocessar gravação após PUT incerto falha unit:195;
ACK antes de persistir rejected falha sql:462/463/477/482; marcar efeito Meta
falha unit:154 e sql:311; aguardar CDN antes de texto falha composition:66;
timer recriado após stop falha composition:91. Veredito: suficiente e
discriminante para a fronteira T6, condicionado aos gates finais registrados
no fechamento desta seção. Verifier independente da feature ainda obrigatório.

Fechamento T6: E2E exclusivo com um worker PASS, 107 aprovados e sete skips
antigos, 114 cenários preservados (1,1 min). npm audit: zero vulnerabilidades.
git diff --check: PASS. Quick/Topology/Live/Build e adequação: PASS. Fase 1
concluída; próxima tarefa T7 pelo integrador, sem implementação antecipada.

## T5: Normalização de gravações e assinaturas

Premissas, arquivos e sucesso foram enviados ao integrador antes do patch:
entrada validada em T4, OGG/Opus mono a 48 kHz e saída escaneada, temporário
privado e publicação exclusiva. Arquivos: módulo, testes, export, Docker,
atualizador de assinaturas, composição do worker, runbook, spec e tasks.
Sem nova dependência JavaScript ou serviço. FFmpeg/ffprobe, freshclam e CA
suportam gravações e verificação genuína; os copyrights dos pacotes Debian
permanecem na imagem. O digest da base Node foi preservado.

Gates Quick, Topology e Build: PASS, 701 aprovados, três skips antigos, 704 total.
10 unitários do normalizador, quatro do atualizador e um de header enganoso;
tipos e lint verdes. Runtime explícito: um teste aprovado em 103,23 s.
WebM do Chromium, OGG/Opus e MP4/AAC viram OGG/Opus mono confirmado por
channels=1; OGG de 300 s retorna durationMs=300000, WebM de 301 s é rejeitado
sem saída. Sem skips ou assinaturas falsas. CPU: 87,93 s user e 15,03 s system;
RSS máximo: 989248 KiB, zero swaps. Medição por GNU time inclui subprocessos;
fixture sintética não substitui o teste de carga em T23.

Imagem runtime construída e executada localmente:
digest `sha256:7105b14c4563b8daeeed2b1eee1aa20f3bf873e0b965cfb13a7fe67c140fb8fd`,
400957267 bytes. USER node, UID 1000; assinatura-base daily 28144, main 63 e
bytecode 339 baixada e testada oficialmente durante o build. Verificação
executável na própria imagem confirmou baseline, freshclam genuíno e marcador
publicado. Runtime remoto, limites, mount de definições e backup continuam
como gates em T23.

O timeout de 120 s é do encoder; por arquivo, scan 60 s, libmagic 10 s,
probe 10 s e decodificação 30 s: limite somado de 340 s nas fases locais,
além de IO, DB e PUT. Escolha explícita no design e runbook; o handler em T6
renova lease. Recomenda-se limite de 2 GiB por worker, pela medição próxima
de 1 GiB, com conversão e scan sequenciais. Freshclam tem timeout de 180 s
no startup e a cada 24 h, com falha técnica observável. Marcador só depois
de freshclam com exit 0, por arquivo temporário e rename atômico; falha
preserva conteúdo e mtime anteriores. Base instalada é exigida; marcador
inválido, futuro ou stale impede liberação. O scanner legado da API deverá
compartilhar definições privadas com o worker em T23.

### Adequação: suficiência

Nesta seção, unit = test/recorded-audio-normalizer.test.js,
runtime = test/recorded-audio-normalizer-runtime.test.js,
refresh = test/clamav-signature-refresh.test.js e
validator = test/chat-media-validation.test.js. Números indicam linhas das
assertions atuais; valores de timeout estão em milissegundos.

| Critério                          | Assertion concreta                                                                                                   | Esperado                                | Coberto |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| Conversão MED-14                  | unit:72 channels=1, :73 codec=opus, :75 scans=2; runtime:51/52/53                                                    | Mono, OGG/Opus, scan de entrada e saída | Sim     |
| Bytes e vazio MED-04              | unit:89 rejects entrada vazia ou 16 MiB + 1; :97 diretório somente com entrada                                       | Entrada inválida não converte           | Sim     |
| Duração MED-12                    | unit:116 razão invalid_format em 300001 ms; runtime:93 durationMs=300000; :126 rejects 301 s; :134 ausência de saída | Teto útil inclusivo de 300 s            | Sim     |
| Header enganoso                   | validator:210 rejects header 1 s e timeline 301 s                                                                    | Não confiar no header                   | Sim     |
| Timeout e recursos                | unit:44 timeout=120000, :45 buffer=65536, :47 cap=301, :48 protocol=file; :116 processing_failed                     | Subprocesso limitado e erro sanitizado  | Sim     |
| Saída infectada ou estéreo MED-26 | unit:116 infected e não mono rejeitados; :127 cleanup                                                                | Saída falha fechado                     | Sim     |
| Cleanup                           | unit:76 diretório com entrada e saída; :127 somente entrada                                                          | Sem intermediário órfão                 | Sim     |
| Variante imutável                 | unit:137 EEXIST; :145 bytes originais preservados                                                                    | Não substituir saída existente          | Sim     |
| Refresh e cadência                | refresh:27 intervalo de 24 h, :29 uma chamada no startup, :31 timeout=180000, :32 buffer, :33 timestamp válido       | Refresh limitado                        | Sim     |
| Marcador após falha               | refresh:112 conteúdo anterior, :113 mtime anterior; :77 inválido/futuro/stale rejeitados                             | Falha não forja freshness               | Sim     |
| Concorrência                      | refresh:132 calls=1                                                                                                  | Um updater em curso                     | Sim     |

### Adequação: discriminação

| Near miss                                  | Assertion que falha            | Distinção                         |
| ------------------------------------------ | ------------------------------ | --------------------------------- |
| Encoder com -ac 1 sem provar mono          | runtime:51/98                  | Saída estéreo não passa           |
| Scan somente da entrada                    | unit:75/116                    | Saída deve ser escaneada          |
| Aceitar header curto ou truncar 301 s      | validator:210; runtime:126/134 | Timeline útil excedente rejeitada |
| Usar metadata OGG com padding para o teto  | runtime:93                     | 300 s úteis aceitos               |
| Deixar temporário após erro                | unit:127                       | Cleanup obrigatório               |
| Sobrescrever variante                      | unit:137/145                   | Publicação exclusiva              |
| Atualizar marcador quando freshclam falha  | refresh:112/113                | Conteúdo e mtime preservados      |
| Aceitar marcador inválido, futuro ou stale | refresh:77                     | Falha fechado                     |

Veredito: suficiente e discriminante; Quick, Topology, Build e runtime PASS.
Requisitos ainda dependentes de API, UI ou worker permanecem In Progress.

## T4: Validação de mídia

Premissas antes do patch: somente allowlist aprovada, scanner existente e
ffprobe no backend; declarado não substitui MIME real. Arquivos: módulo
`chat-media-validation.js`, export, dois testes e spec/tasks/execution.
Gerador sintético Chromium versionado adicionado após finding deQA, para
preservar reprodução de gravações streaming sem duration.
Sucesso: pelo menos12 cenários, fixtures reais para seis formatos, MIME/codec,
malware/stale e fronteiras de tamanho/legenda; Quick, runtime real e Build.

Quick/Build final:685 pass, três skips preexistentes,688 total, Node24.20.0;
types/lint verdes.16 testes unitários específicos. E2E não repetido nesta
tarefa sem mudançaUI; baseline integral107+7skips de T2 permanece histórico,
novo gate integral ao concluir a fase. Requisitos seguem In Progress.

Runtime isolado usa Node24.20.0 bookworm, FFmpeg5.1.9, ClamAV1.4.3 e libmagic.
Freshclam oficial atualizou daily28144/main63/bytecode339, verificou cada
database e terminou0. Primeiro download falhou por faltaCA; instalação
explícita de ca-certificates resolveu, requisito da imagem emT5. Nenhuma
assinatura sintética/fake usada. Aviso NotifyClamd semdaemon não impediu
update; T5 desabilitará essa opção. Runtime remoto permanece gateT23.

O scanner rejeita infecção, indisponibilidade e assinatura>36h. ffprobe
tem timeout10s/maxBuffer64KiB/probesize8MiB/maxalloc64MiB/protocolfile e MOV
sem refs externas. MP3 admite uma capa JPEG/PNG apenas com attached_pic=1.
Gravação streaming sem duration é decodificada por FFmpeg com threads1,
timeout30s, teto301s e progresso limitado; timeline>300s é rejeitada.
Não se aceita duration ausente por suposição. Erros são sanitizados.

### Adequação: suficiência

| Critério           | Evidência assertion                                                                                                           | Esperado                        | Coberto |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------- |
| MED01..03 formatos | `test/chat-media-validation.test.js:106` MIME exato; :107 tamanho15; :108 SHA64; seis fixtures; runtime:72 MIME/:73 tamanho   | Allowlist e bytes/codec válidos | Sim     |
| MED04 limites      | `test/chat-media-validation.test.js:230` limite exato; :238 throws status413 para+1                                           | Fronteira5/16MiB                | Sim     |
| Legenda            | `test/chat-media-validation.test.js:254`1024; :2621025throws; :274 áudio throws                                               | Limites aprovados               | Sim     |
| MIME/codec MED29   | `test/chat-media-validation.test.js:295` razão invalid_format; :344 rejects HEVC/MP3video/Vorbis; runtime:151/:181 rejects    | Disfarce/codec não ficam ready  | Sim     |
| Scanner MED26      | `test/chat-media-validation.test.js:367` razões infected/stale/scanner_unavailable e mensagem fixa; runtime:198 EICARinfected | Fail closed, sem dado privado   | Sim     |
| MP3 capa           | `test/chat-media-validation.test.js:160`audioCodec mp3/:162 vídeo comum rejects; runtime:99 capa real aceita                  | Capa embutida válida            | Sim     |
| WebM streaming     | `test/chat-media-validation.test.js:189`1200ms/:191301s rejects; runtime:134durationundefined/:145 timeline real1..2s         | Duração medida e limitada       | Sim     |
| Declaração300s     | `test/chat-media-validation.test.js:422`300000ms/:424300.001s rejects                                                         | Teto inclusivo                  | Sim     |
| Probe/empty        | `test/chat-media-validation.test.js:391`rejects                                                                               | Falha nunca ready               | Sim     |

### Adequação: discriminação

| Near miss                           | Assertion que falha  | Resultado incorreto distinguido                  |
| ----------------------------------- | -------------------- | ------------------------------------------------ |
| Aceitar MIME declarado sem detector | unit:295/runtime:151 | PNG declaradoJPEG aceito                         |
| Aceitar qualquer codecMP4/OGG       | unit:344/runtime:181 | HEVC/mpeg4/Vorbis aceitos                        |
| Fail open no scanner                | unit:367/runtime:198 | EICAR ou scanner erro aceito                     |
| Rejeitar MP3 com capa               | unit:160/runtime:99  | Arquivo permitido rejeitado                      |
| Supor duraçãoWebM ausente           | unit:189/runtime:145 | Gravação Chromium rejeitada ou duração inventada |
| Truncar gravação longa e aceitar    | unit:191             | 301s aceitos                                     |

Runtime final PASS: um teste, zero skips,111s; seis formatos reais, MP3capa,
WebMChromium com duração ausente e timeline medida, MIMEdisfarçado/codec/EICAR.
Reprodução: executar `node scripts/generate-chat-media-recording-fixture.mjs`
com PlaywrightChromium instalado; executar teste no container com
`RUN_CHAT_MEDIA_RUNTIME_TESTS=yes` e `CHAT_MEDIA_CHROMIUM_FIXTURE` apontando
para `var/tooling/chromium-media-recorder.webm` no mount. Gerador usa apenas
oscilador, não microfone; bytes/hash variam por serial/timestamps da gravação.
Pico clamscan observado750MiB; orçamento operacional medido emT5.

Veredito: suficiente e discriminante; Quick/runtime/Build PASS. Nenhum
requisito completo Verified, pois API/UI/worker ainda estão pendentes.

## T3: Adapter privado RustFS

PASS: nove unitários e um ciclo real do SDK na alpha.99 local. Gate Quick
668 pass, três skips preexistentes, 671 total; tipo/lint/audit verdes.
T3 não declara requisitos inteiros verificados, pois API/worker seguem pendentes.

### Antes do patch

- Premissas: source validada fornece SHA-256, tamanho e MIME; key UUID opaco;
  bucket CRM isolado; nenhuma URL assinada retornada para browser.
- Arquivos: `rustfs-media-store.js`, export `index.js`, manifest do módulo e
  lockfile, testes `rustfs-media-store.test.js` e `rustfs-media-store-live.test.js`,
  spec/tasks/execution. Nenhuma dependência frontend adicionada.
- Sucesso: pelo menos oito unitários, operações streaming e falhas parciais,
  mais ciclo real SDK em alpha.99; Quick, smoke T1, tipos/lint e audit.
- Dependência: T2 `b94e5f1`; correção de negativas T1 `cacb897`.

### Dependência e contrato

`@aws-sdk/client-s3` fixado em 3.1146.0 no módulo backend, 26 pacotes novos.
Metadados npm: Apache-2.0 e Node >=20, compatível com runtime 24.20.0.
Justificativa: assinatura/autenticação, streaming e operações S3 necessárias,
evitando implementar protocolo próprio no runtime. Risco: superfície de
dependências e defaults de checksum; lockfile, audit high e ciclo real
contra imagem exata fazem parte do gate.

[AWS checksum docs](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html)
confirma CRC32 automático desde 3.729.0. O adapter usa SHA256 precomputado,
ContentLength e settings WHEN_REQUIRED, path-style e maxAttempts=1.
`IfNoneMatch='*'` foi comprovado na alpha.99: replay 412 só retorna sucesso
se HEAD reconcilia o mesmo SHA/tamanho/MIME. Variante divergente não sobrescreve.
Erro de PUT preserva código MEDIA_STORAGE_UNAVAILABLE; não vira invalid_format.

Métodos: `putValidated({key,stream,sizeBytes,sha256,mimeType})`, `head(key)`,
`read(key,range?)`, `deleteDraft(key)`. Read retorna stream Node, tamanho,
SHA, MIME e Content-Range; não retorna URL/key/bucket/ETag. Delete exige que
o chamador bloqueie e revalide `message_id IS NULL` antes, implementado em T22.
Byte count/hash são verificados durante PUT; erros de read parcial são
sanitizados. Falhas 404/416/externa têm códigos distintos. SDK não retry cego.

Ciclo real em `rtk proxy node --test test/rustfs-media-store-live.test.js`,
com credencial DEV limitada e opt-in explícito: PUT streaming, HEAD hash/size,
GET bytes exatos, Range bytes exatos, replay condicional, rejeição de variante
divergente, GET original preservado, DELETE e HEAD404. Um teste passou, zero
skips. Warnings SDK de request streaming não retryable em 412 são genéricos;
nenhum segredo/chave/provider body vai para log ou DTO.
Smoke T1 atual `var/rustfs-local-alpha99-object-denial-evidence.json` passou
com 11 checks reais na mesma imagem/digest, após instalar o SDK.

### Adequação: suficiência

| Critério / requisito                  | Evidência assertion                                                                                                                                                                                                             | Resultado esperado                                        | Coberto |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| PUT streaming/hash/size               | `test/rustfs-media-store.test.js:43`: `assert.deepEqual(await collect(command.input.Body), BYTES)`; linha46 `assert.deepEqual(result,{sizeBytes:BYTES.length,sha256:SHA})`; linha38 assert checksum base64                      | Bytes exatos, digest/tamanho da variante                  | Sim     |
| HEAD                                  | `test/rustfs-media-store.test.js:57`: `assert.deepEqual(result,{sizeBytes:BYTES.length,sha256:SHA,mimeType:'image/jpeg'})`                                                                                                      | Metadata privada exata, sem ETag                          | Sim     |
| Reconciliação sem overwrite MED-15/19 | `test/rustfs-media-store.test.js:80`: `assert.deepEqual(await adapter.putValidated(upload()),{sizeBytes:BYTES.length,sha256:SHA})`; linha85 `assert.rejects` variante com código MEDIA_STORAGE_UNAVAILABLE                      | 412 igual reconcilia; diferente falha                     | Sim     |
| Range MED-17                          | `test/rustfs-media-store.test.js:106`: `assert.equal(result.contentRange,...)`; linha108 `assert.deepEqual(await collect(result.stream),BYTES.subarray(0,3))`                                                                   | Range e bytes exatos                                      | Sim     |
| Falhas MED-19/20                      | `test/rustfs-media-store.test.js:117`: `assert.rejects(...error.code===code&&!JSON.stringify(error).includes('secret'))`                                                                                                        | 404 missing/416 range/503 unavailable sanitizados         | Sim     |
| Timeout                               | `test/rustfs-media-store.test.js:134`: `assert.rejects(...error.code==='MEDIA_STORAGE_UNAVAILABLE')`                                                                                                                            | Deadline aborta request, não declara sucesso              | Sim     |
| Limite/hash incorreto                 | `test/rustfs-media-store.test.js:154` e `:158`: `assert.rejects(adapter.putValidated(...),/Unable to store private media/u)`                                                                                                    | Fonte divergente não vira PUT válido                      | Sim     |
| Stream parcial MED-19/20              | `test/rustfs-media-store.test.js:175`: `assert.rejects(collect(result.stream),...error.message==='Private media storage is unavailable')`                                                                                       | Falha sem URL/secret raw                                  | Sim     |
| Delete/key/bucket isolados            | `test/rustfs-media-store.test.js:189`: `assert.deepEqual(target,{Bucket:'crm-silmer-chat-media-dev',Key:KEY})`; linha190 `assert.rejects` key arbitrária; linha194 `assert.throws` Hermes                                       | Somente bucket CRM/key UUID                               | Sim     |
| SDK real                              | `test/rustfs-media-store-live.test.js:52`: `assert.deepEqual(await bytes(read.stream),body)`; linha55 Range bytes; linha74 `assert.deepEqual(await bytes(preserved.stream),body)`; linha78 `assert.rejects` missing após delete | Defaults SDK compatíveis com alpha.99 e bytes preservados | Sim     |

### Adequação: necessidade

| Teste / assertion                                                      | Origem                                                       | Manter |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| `test/rustfs-media-store.test.js:35–47`, output bytes/digest e sem key | T3 streaming + MED-15/20                                     | Sim    |
| `test/rustfs-media-store.test.js:57`, HEAD metadata                    | T3 HEAD                                                      | Sim    |
| `test/rustfs-media-store.test.js:80–85`, 412 igual/diferente           | Design PUT/DB desconhecido + MED-19                          | Sim    |
| `test/rustfs-media-store.test.js:97–108`, Range                        | MED-17                                                       | Sim    |
| `test/rustfs-media-store.test.js:117`, códigos/privacidade             | MED-19/20                                                    | Sim    |
| `test/rustfs-media-store.test.js:134`, deadline                        | T3 timeout                                                   | Sim    |
| `test/rustfs-media-store.test.js:154–158`, hash/size                   | T3 fonte válida/streaming                                    | Sim    |
| `test/rustfs-media-store.test.js:175`, read parcial                    | T3 falha parcial + MED-20                                    | Sim    |
| `test/rustfs-media-store.test.js:189–194`, Delete/key/bucket           | T3 acesso privado                                            | Sim    |
| `test/rustfs-media-store-live.test.js:42–78`, ciclo real               | T3 compatibilidade real, sem presumir smoke manual prova SDK | Sim    |

Verdict: critérios e falhas da camada cobertos em outputs e bytes, inclusive
contra runtime real. Testes seguem CONTRIBUTING/node:test/JSDoc; nenhum teste
preexistente alterado, ignorado ou removido. Nenhum cenário fora da spec.

## Correção T1: negar leitura de objeto conhecido fora do bucket

PASS em 2026-10-06T03:00:29.057Z. Uma revisão intermediária detectou que
HEAD de bucket testa ListBucket e não prova GetObject negado. O smoke agora
exige HEAD e GET de um canário sintético conhecido no bucket negado com 403.
O operador havia comprovado PUT/HEAD 200 e tamanho 48 bytes desse canário;
o smoke limitado não o cria ou remove. Nenhuma operação em Hermes.

Arquivos da correção: script/harness T1, runbook, tasks e execution.
T3 foi preservada em WIP e não entra neste commit. Credenciais administrativas
ficam fora do smoke e do runtime. Chave do canário não vai ao evidence JSON.

Evidência local atual: `var/rustfs-local-alpha99-object-denial-evidence.json`,
mesmo digest alpha.99 observado anteriormente. São 11 checks reais, incluindo
os novos `crossObjectHeadDenied=true` e `crossObjectGetDenied=true`.
Harness: 10/10 passaram, zero falhas/skips. Quick: 666 pass, três skips
preexistentes, 669 total; essa contagem inclui oito testes T3 ainda em WIP,
não entregues neste commit. Nenhuma assertion foi enfraquecida; a comparação
exata dos checks foi fortalecida com os dois campos novos.

| Critério / necessidade                     | Evidência assertion                                                                                                                      | Resultado da spec/gate                                             | Manter                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| Bucket HEAD403 não prova objeto GET negado | `test/rustfs-live-smoke.test.js:255`: `await assert.rejects(h.run(), /cross-bucket object GET/u)`                                        | GET200 de objeto fora do bucket impede PASS mesmo se HEADbucket403 | Sim, isolamento T1/MED-16 suporte |
| Falha sem evidência e cleanup próprio      | `test/rustfs-live-smoke.test.js:256`: `assert.equal(h.evidence(), undefined)`; linha257 `assert.equal(h.removed(), true)`                | Não declarar PASS; limpar somente canário próprio                  | Sim, T1/MED-19 suporte            |
| Resultado evidencia cada negativa real     | `test/rustfs-live-smoke.test.js:118`: `assert.deepEqual(result.checks, {...crossObjectHeadDenied: true, crossObjectGetDenied: true...})` | Checks distintos de bucket e de objeto                             | Sim, T1 isolamento                |

Verdict de adequação: cenários positivos e bypass real cobertos; teste
necessário para a policy por bucket; bytes e estados continuam assertados.
Tabela de T1 abaixo atualizada para as linhas atuais. Gates tipo/lint/diff
também passam; isto não é validação final independente da feature.

## T1: Compatibilidade RustFS

Status: concluída. Harness e smoke real passaram na alpha.99 local isolada.
Ativação remota continua pendente em T23. T2 foi concluída abaixo.

### Antes do patch

- Premissas: versão configurada `rustfs/rustfs:1.0.0-alpha.99`; buckets CRM
  distintos, privados e sem expiração; credencial limitada própria para o
  smoke. Nenhuma operação em `hermes-backups`.
- Arquivos: `docs/runbooks/rustfs-chat-media.md`,
  `scripts/rustfs-live-smoke.mjs`, `test/rustfs-live-smoke.test.js`,
  `package.json` (script somente), `tasks.md` e este relatório.
- Sucesso: pelo menos seis casos locais do harness; operações e negativas
  reais na imagem alpha.99 com digest observado; Topology e recovery mocks.
- Dependência: nenhuma. Task IDs de MED-16, MED-19, MED-23.

### Escolhas de implementação

O smoke usa transporte SigV4 pequeno para canário e não altera dependências.
O adapter runtime continua previsto com SDK fixado em T3. O processo limita
buckets a nomes CRM conhecidos, exige opt-in e HTTPS. HTTP é permitido
somente em loopback para ambiente isolado. Cleanup remove só a chave criada
pelo processo, mesmo após resultado desconhecido de PUT. Falha nunca grava
evidência PASS.

O usuário autorizou Docker local depois do planejamento, que originalmente
dependia de `dell-worker`. T1 comprova compatibilidade real na mesma versão
configurada usando container local. Seu digest não comprova o deployment
remoto. T23 permanece responsável por ativação, acesso e recovery no alvo.
Essa distinção foi registrada no critério de T1 antes de sua execução real.

### Gates locais executados

- `rtk proxy node --test test/rustfs-live-smoke.test.js`: 9 passaram, zero
  falhas/skips. Testes foram escritos antes do harness.
- `rtk npm run typecheck`: PASS.
- `rtk proxy npx eslint scripts/rustfs-live-smoke.mjs test/rustfs-live-smoke.test.js`:
  PASS.
- `rtk npm run validate:topology`: PASS; readiness continua blocked, com oito
  bloqueios preexistentes. Não é aprovação de recovery.
- `rtk npm run test:recovery:mocks`: 14 passaram, zero falhas/skips.
- `rtk git diff --check`: PASS.

### Smoke real e digest

`rtk npm run smoke:rustfs:live`, executado com Node 24.20.0 e credencial
local limitada, passou em 2026-10-06T02:48:15.360Z. Evidência sanitizada
local: `var/rustfs-local-alpha99-evidence.json`. A execução retornou os nove
checks `true`, incluindo 403 anônimo/cross-bucket, Range 206 com bytes
exatos, Range inválido 416 e HEAD 404 após DELETE 204. O bucket negado era
`crm-silmer-smoke-denied-local`, vazio e restrito ao teste em loopback.

`docker inspect crm-silmer-media-test-rustfs` e
`docker image inspect rustfs/rustfs:1.0.0-alpha.99` confirmaram o mesmo
digest da imagem/container em execução:
`sha256:103dd40b84d5aa3d5ab02f3a693797eb1d14cb842554b222dfbb589f364aa47f`.
Scope do JSON: `local-version-compatibility`; não há prova do digest remoto.

Foi detectada uma diferença real de IAM: alpha.99 rejeita
`s3:GetLifecycleConfiguration` como action inválida. Seu enum oficial usa
`s3:GetBucketLifecycle`; a policy sintética limitada foi corrigida para essa
action de leitura e aplicada com 200. Nenhuma configuração de lifecycle
foi modificada. O GET do próprio bucket retornou
404 `NoSuchLifecycleConfiguration`.

### Adequação dos testes do harness

Arquivos seguem `CONTRIBUTING.md`, `node:test`, `test/*.test.js` e JSDoc
checkJs. As negativas fazem implementações plausíveis incorretas falharem;
um transporte fake não comprova compatibilidade RustFS.

| Critério T1 / requisito                         | Evidência exata                                                                                                                                                                                                                                                                                                                | Resultado esperado                                       | Coberto                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------ |
| PUT/HEAD/GET/Range/DELETE e negativas           | `test/rustfs-live-smoke.test.js:118`: `assert.deepEqual(result.checks, { put: true, headHashAndSize: true, getHashAndSize: true, range: true, invalidRange: true, anonymousDenied: true, crossBucketDenied: true, crossObjectHeadDenied: true, crossObjectGetDenied: true, noExpiryLifecycle: true, deleteAndMissing: true })` | Cada check real precisa passar antes de emitir evidência | Sim; smoke real comprovado acima     |
| Digest real e dados sintéticos                  | `test/rustfs-live-smoke.test.js:132`: `assert.equal(result.runningImageDigest, env.RUSTFS_RUNNING_IMAGE_DIGEST)`; linha 133: `assert.equal(result.syntheticOnly, true)`                                                                                                                                                        | Preservar digest fornecido, sem alegar versão do alvo    | Sim; docker inspect comprovado acima |
| Isolamento Hermes                               | `test/rustfs-live-smoke.test.js:148`: `assert.throws(() => validateRustfsSmokeEnvironment({ ...env, MEDIA_S3_BUCKET: 'hermes-backups' }), /CRM bucket/u)`                                                                                                                                                                      | Recusar bucket alheio antes da rede                      | Sim                                  |
| Sem segredo/chave no relatório (MED-20 suporte) | `test/rustfs-live-smoke.test.js:135`: `assert.equal(serialized.includes(env.MEDIA_S3_SECRET_ACCESS_KEY), false)`; linha 136: `assert.equal(serialized.includes(env.MEDIA_S3_ACCESS_KEY_ID), false)`                                                                                                                            | Segredo e access key ausentes                            | Sim                                  |
| Acesso privado (MED-16 suporte)                 | `test/rustfs-live-smoke.test.js:195`: `await assert.rejects(h.run(), /anonymous access/u)`; linha 227: `await assert.rejects(h.run(), /cross-bucket access/u)`                                                                                                                                                                 | 200 anônimo/cross-bucket impede PASS                     | Sim                                  |
| Bytes/Range reais (MED-23 suporte)              | `test/rustfs-live-smoke.test.js:235`: `await assert.rejects(h.run(), /Range\|GET/u)`                                                                                                                                                                                                                                           | Bytes alterados ou 200 ignorando Range impedem PASS      | Sim                                  |
| Falha externa e cleanup (MED-19 suporte)        | `test/rustfs-live-smoke.test.js:243`: `await assert.rejects(h.run(), (error) => error instanceof Error && error.message === 'RustFS smoke failed at PUT; no live PASS recorded')`                                                                                                                                              | Falha de PUT sanitizada, sem PASS                        | Sim                                  |
| Preservação sem expiração                       | `test/rustfs-live-smoke.test.js:262`: `await assert.rejects(h.run(), /lifecycle/u)`                                                                                                                                                                                                                                            | Lifecycle com expiração impede PUT e PASS                | Sim                                  |

| Teste / assertion                                                                                   | Origem                                             | Manter |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------ |
| linhas 113–134, checks/digest/synthetic/sem segredos/sem Hermes                                     | T1 Done when + MED-16/19/23                        | Sim    |
| linhas 141–155, `assert.throws` bucket Hermes/duplicado                                             | T1 isolamento por bucket                           | Sim    |
| linhas 160–182, `assert.throws` opt-in/HTTPS/digest tag                                             | T1 gate explícito e digest real                    | Sim    |
| linhas 188–190 e 220–222, `assert.rejects` acesso anônimo/cross-bucket; cleanup e relatório ausente | T1 negativas / MED-16                              | Sim    |
| linhas 228–230, `assert.rejects` Range/GET; cleanup e relatório ausente                             | T1 bytes reais / MED-23                            | Sim    |
| linhas 236–243, `assert.rejects` PUT sanitizado; cleanup e relatório ausente                        | T1 falha externa / MED-19                          | Sim    |
| linhas 248–253, `assert.rejects` lifecycle; nenhum PUT e relatório ausente                          | T1 preservação de mídia sem alterações silenciosas | Sim    |

| Critério adicional                  | Evidência exata                                                                                                                                                                                                                                                                                                                                                                                     | Resultado / origem                                                                                                                 | Manter |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ |
| HTTP apenas em homologação loopback | `test/rustfs-live-smoke.test.js:206`: `assert.equal(validateRustfsSmokeEnvironment(local).localLoopback, true)`; linha 207: `assert.throws(() => validateRustfsSmokeEnvironment({ ...local, MEDIA_S3_ENDPOINT: 'http://192.0.2.1:21900' }), /HTTPS/u)`; linha 215: `assert.throws(() => validateRustfsSmokeEnvironment({ ...local, MEDIA_S3_ENDPOINT: 'https://s3.example.test' }), /CRM bucket/u)` | DEV isolado permitido; endpoint externo inseguro/bucket canário local externo rejeitados. T1 isolamento + autorização Docker local | Sim    |

Verdict: critérios de T1 cobertos no harness e por smoke real, com digest
observado. Sem assertions rasas, testes desnecessários ou alterações de
testes existentes. Nenhum segredo ou dado real utilizado. T1 concluída;
T23 continua responsável por ativação e recovery no deployment remoto.

## T2: Schema persistente

Status: concluída, gates Live e Build passaram. Requisitos
MED-05/15/27/28 permanecem em progresso; schema não comprova envio ou UI.

### Antes do patch

- Premissas: último número real é 0026; IDs de conversas/usuários/mensagens
  permanecem text. A nova mídia usa UUID e não reutiliza transient_media.
- Arquivos: `modules/database/migrations/0027_chat_media.expand.sql`,
  `test/chat-media-schema-postgres-live.test.js`, `spec.md`, `tasks.md`,
  `execution.md`. Migrations publicadas ficam intactas.
- Sucesso: ao menos seis cenários live de replay, vínculo único, retenção
  independente e quota, com gates Live e Build. Banco exclusivo
  `crm_silmer_test`, sintético e sem dados reais.
- Dependência: T1 concluída em `7e388c8`.

### Implementação e gates

Criada `crm.chat_media` com vínculo único por mensagem, FK composta para a
mesma conversa, upload idempotente por ator/conversa, filename cifrado,
estados, metadados, reserva e CAS. Sem expires_at ou trigger de fim de
jornada. `crm.chat_media_quotas` separa bytes utilizados e reservados;
limites serão injetados e atualizados transacionalmente por API/worker.
Jobs ganham `chat_media_id` e `chat_media.process`, com unicidade e target
próprio. As quatro variantes legadas foram preservadas.

O teste live utiliza ciphertext AES-256-GCM sintético com iv/tag reais.
O CHECK do novo envelope é total (`IS TRUE`), negando campos ausentes,
metadata incompleta e plaintext. O CHECK valida estrutura; autenticação
criptográfica depende da aplicação, não da expressão SQL.

Nenhuma assertion existente foi alterada, removida ou ignorada. Uma falha
inicial no setup do teste (migrate exige options) foi corrigida; uma colisão
de nome de constraint na migration nova foi corrigida antes de aplicar.

- Live T2: 8/8 passaram, zero falhas/skips.
- Live do projeto + T2: 19/19 passaram, zero falhas/skips, com
  `node --test --test-concurrency=1 test/migrations-live.test.js test/inbox-postgres-live.test.js test/n8n-command-store-postgres-live.test.js test/chat-media-schema-postgres-live.test.js`.
- `npm run validate`: PASS com Node 24.20.0/npm 11.19.0, 657 pass,
  três skips preexistentes, 660 total. Inclui lint, tipos e build.
- `npm run test:e2e -- --workers=1`: 107 passaram, sete skips preexistentes,
  114 total. Assertions e contagem preservadas. A primeira execução com
  oito workers tinha 105 pass e duas falhas, incluindo Target crashed;
  o rerun completo com um worker confirmou a suíte sem alterar teste.
- `npm audit --audit-level=high`: zero vulnerabilidades.
- `git diff --check`, validate_spec e validate_tasks strict: PASS.

### Adequação

| Critério / requisito                           | `file:line` + assertion                                                                                                                                                                                                                                                                                                                                                                     | Resultado esperado                                                                  | Coberto |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| Migration aplica duas vezes                    | `test/chat-media-schema-postgres-live.test.js:102`: `assert.deepEqual(await migrate(pool, { migrations: await loadMigrations() }), { applied: [], phase: 'expand' })`; linha 109: `assert.equal(result.rows[0].count, 1)`                                                                                                                                                                   | Replay vazio, uma aplicação 0027                                                    | Sim     |
| Um arquivo por mensagem, mesma conversa MED-05 | `test/chat-media-schema-postgres-live.test.js:120` e 129: `await assert.rejects(media(...), /chat_media_message_id_key/u)` e `await assert.rejects(media(...), /chat_media_message_conversation_fk/u)`                                                                                                                                                                                      | Duplicate/FK rejeitam vínculo inválido                                              | Sim     |
| Upload idempotente por ator/conversa           | `test/chat-media-schema-postgres-live.test.js:142`: `await assert.rejects(media({ upload_command_id: first.upload_command_id }), /chat_media_upload_scope_key/u)`; linha 150: `assert.equal(other.upload_command_id, first.upload_command_id)`                                                                                                                                              | Mesmo scope duplicado rejeitado; outra conversa independente                        | Sim     |
| Preservação após oito dias/terminal MED-15     | `test/chat-media-schema-postgres-live.test.js:163`–164: `assert.equal(await repository.scheduleExpiredDeletions(), 0)` e `assert.equal(await repository.scheduleTerminalJourneyDeletions(), 0)`; linha 168: `assert.deepEqual(attached.rows, [{ state: 'attached', message_id: 'media-conversation-a-message' }])`; linha 174: `assert.equal(oldMedia.rows[0].older_than_eight_days, true)` | Media antiga permanece attached, nenhum job transitório                             | Sim     |
| Rascunho separado MED-27                       | `test/chat-media-schema-postgres-live.test.js:225`: `assert.equal(draft.message_id, null)`; linha 226: `assert.equal(draft.retention_class, 'chat_retained')`; linha 227: `assert.equal(draft.state, 'uploaded')`                                                                                                                                                                           | Rascunho sem vínculo, classe própria                                                | Sim     |
| Quota/reservas MED-28                          | `test/chat-media-schema-postgres-live.test.js:189`/195: `await assert.rejects(pool.query(...), /chat_media_quotas_capacity_check/u)` e `await assert.rejects(pool.query(...), /chat_media_quotas_nonnegative_check/u)`; linha 204: `assert.deepEqual(row.rows, [{ used_bytes: '600', reserved_bytes: '300' }])`                                                                             | Soma acima de limite e valores negativos rejeitados; counters separados preservados | Sim     |
| Ready requer metadata limpa                    | `test/chat-media-schema-postgres-live.test.js:208`–220: `await assert.rejects(media({ state: 'ready' }), /chat_media_ready_metadata_check/u)`; variante infected, linked sem attached e reserva negativa também rejeitadas                                                                                                                                                                  | Não publicar ready incompleta/infectada                                             | Sim     |
| Filename cifrado no schema                     | `test/chat-media-schema-postgres-live.test.js:237`: `await assert.rejects(media({ filename_envelope: JSON.stringify(invalid) }), /chat_media_filename_envelope_check/u)`; linha 243: `assert.equal(valid.filename_envelope.ciphertext, JSON.parse(envelope).ciphertext)`; linha 247: `assert.equal(JSON.stringify(valid.filename_envelope).includes('synthetic.jpg'), false)`               | Estrutura incompleta/plaintext rejeitados; ciphertext real preservado               | Sim     |
| Target/uniqueness job                          | `test/chat-media-schema-postgres-live.test.js:274`: `assert.deepEqual(job.rows, [{ job_type: 'chat_media.process', chat_media_id: draft.id }])`; linha 277: `await assert.rejects(insert(), /outbox_jobs_chat_media_process_key/u)`; linhas 278/282: `assert.rejects` target null/FK inexistente                                                                                            | Target persistente próprio, um job por mídia, FK válida                             | Sim     |

| Teste / assertion                                                                              | Origem                                         | Manter |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| `test/chat-media-schema-postgres-live.test.js:102`, replay e count                             | Done when T2 migration idempotente             | Sim    |
| `test/chat-media-schema-postgres-live.test.js:119–129`, vínculo positivo e negativas unique/FK | MED-05 + Done when T2 vínculo                  | Sim    |
| `test/chat-media-schema-postgres-live.test.js:142–150`, replay scope                           | Design `upload_command_id` + T2 constraints    | Sim    |
| `test/chat-media-schema-postgres-live.test.js:163–182`, sweeper/attached/date/sem expires/jobs | MED-15 + T2 sem sweeper transitório            | Sim    |
| `test/chat-media-schema-postgres-live.test.js:189–204`, capacidade e counters                  | MED-28 + T2 modelo de quota                    | Sim    |
| `test/chat-media-schema-postgres-live.test.js:208–228`, ready/binding/size/draft/object UUID   | MED-05/27 + modelo T2                          | Sim    |
| `test/chat-media-schema-postgres-live.test.js:237–247`, envelope inválido/ciphertext           | Design filename_envelope cifrado / privacidade | Sim    |
| `test/chat-media-schema-postgres-live.test.js:274–285`, jobtarget/unique/FK                    | T2 payload de job compatível                   | Sim    |

Verdict: suficiência por critério e necessidade por teste comprovadas em
SQL real. Assertions verificam valores persistidos e falhas de constraints,
sem substituir estado por call counts. Padrão `CONTRIBUTING.md`, node:test,
JSDoc/checkJs e banco dedicado. Sem alteração de migration publicada.

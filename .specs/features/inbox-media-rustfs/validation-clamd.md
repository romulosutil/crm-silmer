# Validação independente — T29: clamd persistente

Data: 10/10/2026. Verificador: agente independente `/root/clamd_verifier`, sem autoria do código ou dos testes.
Escopo: diff da T29 contra `d706540`, incluindo arquivos novos do daemon/configuração. Esta validação não conclui T24, captura física de microfone, produção ou a feature inteira.

**Veredito: PASS para a T29.** Gates integrados, proteção real, recuperação e envio DEV confirmados; 13/13 critérios abaixo têm evidência.

## Critérios derivados da especificação

| Critério / requisito | Resultado esperado | Evidência de resultado / asserção | Estado |
| --- | --- | --- | --- |
| MED-26: infectado | Resultado `clean=false`; upload não alcança ready/PUT | `test/clamav-media-scanner.test.js:127`: `assert.equal(result.clean, false)`; `test/chat-media-process-worker.test.js:401`: `assert.equal(f.calls.puts, 0)` e `:402` ready=0 | PASS unit |
| MED-26: scanner indisponível | Rejeição, sem fallback para scan que dispense daemon | `test/clamav-media-scanner.test.js:144`: `assert.rejects(... /scanner is unavailable/)`; `:148`: comandos exclusivamente `['clamdscan']` | PASS unit |
| MED-26: assinaturas antigas/futuras/inválidas | Rejeição com `stale_signatures` ou `scanner_unavailable` | `test/clamav-signature-refresh.test.js:77`: `assert.rejects`, predicado `error.reason === reason` para idade superior a 36h, data futura e inválida | PASS unit |
| MED-06: bytes preparados não dispensam inspeção em nova tentativa | Nova validação; erro não faz PUT ou ready | `test/chat-media-process-worker.test.js:372`: `assert.equal(f.calls.validations, 1)`; `:373-375`: puts=0, ready=0, failures=[reason] | PASS full unit |
| MED-14: gravação inspeciona entrada e saída | Duas validações e saída OGG/Opus mono | `test/recorded-audio-normalizer.test.js:116`: audioChannels=1; `:117`: audioCodec='opus'; `:119`: `assert.equal(f.calls(), 2)`; `test/recorded-audio-normalizer-runtime.test.js:51-55`: canais/MIME/codec/duração/SHA reais | PASS unit e runtime |
| T29: motor único persistente | Duas chamadas de start reutilizam um processo; reinício encerra antes de substituir | `test/clamav-daemon.test.js:72`: engines=1; `:76`: eventos `['start','SIGTERM','start']` | PASS unit |
| T29: prontidão/health falham fechados | PONG exato; ausência, resposta inválida e silêncio retornam false | `test/clamav-daemon.test.js:26`, `:30`, `:32`, `:34`: false/true/false/false; `scripts/runtime-healthcheck.mjs:8`: saída conforme `pingClamAv()`; prova recovery: healthRejected=true durante falha | PASS unit e runtime |
| T29: recuperação/parada | Recuperação substitui processo encerrado; stop encerra supervisão e escala sinal se necessário | `test/clamav-daemon.test.js:151`: dois processos históricos; `:154`: nenhum terceiro após stop; `:185`: sinais TERM/KILL | PASS unit |
| T29: atualização confirmada antes de marcador | Falha de novo motor conserva marcador anterior; sucesso publica novo | `test/clamav-signature-refresh.test.js:154`, `:158`, `:161`: refresh rejeita, marcador igual ao anterior, depois diferente; `:149`: marcador ainda antigo durante callback | PASS unit |
| T29: scan não toma emprestada data nova | Captura data anterior à execução mesmo com atualização concorrente | `test/clamav-media-scanner.test.js:163` e `:167`: data primeira/segunda = anterior/atualizada | PASS unit |
| T29: texto/CDN | Texto inicia antes do motor; CDN pendente não bloqueia texto | `test/chat-media-worker-composition.test.js:166`: sequência text/engine-ready/legacy/chat/refresh; `:66-67`: textStarted e refreshStarted=true | PASS unit |
| T29: privacidade/Unix | Sem TCP; socket 0600 em diretório 0700; cliente com fdpass; saída privada não logada | `docker/clamd.conf:3-4`; `test/clamav-media-scanner.test.js:30`: argumentos exatos; `:113`: sem '/private/' no resultado; `test/clamav-daemon.test.js:54`: stdio='ignore'; `:74`: diretório 0700 em Linux; built-image-proof: socketMode='600', directoryMode='700' | PASS inspeção/unit/Linux |
| MED-30/T29: menor espera, envio explícito | Mesmo arquivo liberado mais rápido e enviado no DEV após ready | Prova navegador: PNG 117 bytes ready em 1163/1140ms; áudio 1116ms; vídeo 1121ms. Prova de leitura SQL: quatro mensagens/comandos/deliveries sent, uploads attached, job completed, tentativa/reserva únicas, simulated=true | PASS DEV |

Nenhum endpoint, contrato SQL, regra de autorização, retenção ou UI foi alterado por esta tarefa. Os cenários existentes citados para MED-06/14 são regressão das fronteiras preservadas.

## Gates executados pelo verificador

`rtk proxy ... node-v24.20.0-win-x64/node.exe --test --test-concurrency=1 test/clamav-daemon.test.js test/clamav-media-scanner.test.js test/clamav-signature-refresh.test.js test/chat-media-worker-composition.test.js`: **26 testes, 26 PASS, 0 falhas, 0 skips**.

Inspeção de configuração, Dockerfile, composição worker, helper de runtime, healthcheck e ciclo de refresh. Nenhum teste antigo foi removido ou marcado skip. As duas expectativas antigas que nomeavam `clamscan` passaram a conferir `clamdscan`, com critérios de infecção/indisponibilidade preservados e ampliados.

## Gates e evidências integradas conferidas

- `var/media-T29-project-gates.log`: format, typecheck, lint, boundaries, tokens e oito validadores, todos exit 0; build exit 0. `git diff --check` executado pelo verificador: exit 0.
- `var/media-T29-unit.log`: **996 testes; 993 PASS; 0 falhas; 3 skips antigos**. Baseline 981; acréscimo de 15 testes. Skips são operation read, webhook coalescing e work-management PostgreSQL por `TEST_DATABASE_URL` ausente na execução unit. Esta tarefa não altera SQL; esses skips não são evidência de execução live.
- `var/media-T29-runtime-build.log`: imagem final construída; digest `sha256:54918dbf91d96f99225fbdf94e4229ead49f6c75dba2043b6ae4f40a632aa496`.
- `var/media-T29-runtime-proof.json`: somente worker atualizado; env/chaves/mounts/usuário 1000/rede preservados; demais containers mantiveram IDs; limites **1 CPU/2 GiB** conservados.
- `var/media-T29-built-image-proof.json`: paridade SHA256 das fontes do scanner/daemon/refresh/worker, readiness real, socket 0600, diretório 0700; freshness genuína em `2026-10-10T16:07:53.740Z` após processo substituto pronto.
- `var/media-T29-runtime-tests.log`: **2/2 PASS, 0 skips** na imagem. Seis formatos reais, MIME disfarçado, codec inválido e EICAR rejeitado com reason='infected'; WebM Chromium/OGG/MP4-AAC normalizados e inspecionados em OGG/Opus mono, com limites de duração e limpeza.
- `var/media-T29-recovery-proof.json`: daemon encerrado em teste sintético com fila ociosa; validação bloqueada, health exit 1; supervisão recuperou em **11271ms**, novo scan válido e health aprovado. Pico de memória **1209327616 bytes**, abaixo de 2 GiB.
- `var/media-T29-timing-proof.json`: PNG sintética de 117 bytes; antivírus **10ms/7ms** contra baseline isolada **9326ms**; validação completa **82ms/86ms**. Carregamento frio permanece na inicialização/recuperação.
- `var/media-T29-browser-proof.json` e `var/media-T29-send-proof.json`: seleção/ready/clique explícito/envio de duas imagens, áudio e vídeo pelo Inbox local; compositor resetado em todos. No SQL, todos `sent`, `attached`, `completed`, tentativa 1 e reserva 1; fluxo `dev-mvp-simple-15`, simulado. Tempos observados pela tela **1,116–1,163s**, contra ~10–11s da mesma UI antes.

As provas acima contêm somente dados sintéticos e permanecem ignoradas em `var/`; os resultados são registrados neste documento versionado. Não foram usados EasyPanel, RustFS remoto, WhatsApp real ou captura física como evidência.

A conferência de paridade detectou uma primeira imagem com import de timers ausente; o integrador restaurou a composição explícita e reconstruiu a imagem final, cuja paridade está confirmada. O harness sintético de recovery inicialmente esperava `processing_failed`; foi corrigido para o contrato existente `scanner_unavailable`, sem alterar a aplicação. As evidências finais acima correspondem aos resultados aprovados. Sensor repetido após o congelamento final das fontes: novamente 3/3 KILLED, porcelain e hashes intactos.

## Sensor de discriminação

Cópias isoladas em `var/clamd-verifier/sensor`; fontes e testes reais permaneceram intactos. Cada mutação executou o arquivo de teste correspondente, limite de 15s; nenhuma expirou.

| Mutação | Fronteira | Resultado |
| --- | --- | --- |
| Infecção retorna clean=true | `clamav-media-scanner.js`, branch do exit 1 | KILLED, exit 1 |
| Resposta inválida do daemon aceita como healthy | `clamav-daemon.js`, comparação PONG | KILLED, exit 1 |
| Publicar freshness sem aguardar novo motor | `clamav-signature-refresh.js`, retirada de onUpdated | KILLED, exit 1 |

**3/3 KILLED, 0 sobreviventes.** Porcelain Git antes/depois idêntico, hashes SHA256 das três fontes idênticos. Diretório de mutações removido por caminho absoluto conferido. Prova sintética ignorada: `var/clamd-verifier/sensor-proof.json`.

## Qualidade e limites

Patch concentrado nas fronteiras necessárias; sem serviço externo novo, scanner alternativo silencioso, porta TCP ou dependência de framework. Erros continuam sanitizados; abort/timeout permanecem limitados. Restart serial evita dois motores carregados; validade capturada antes do scan evita atribuir ao motor anterior a atualização posterior.

Achados P1/P2: nenhum. Não houve sobrevivente de mutação nem lacuna de precisão nova. O sinal da primeira imagem foi entregue ao integrador para destilar a lição de conferir paridade entre imagem e fontes antes de usar medições como evidência. A janela de indisponibilidade durante carga/recovery continua fail-closed e com retry existente. Este PASS é da otimização T29; T24 permanece pendente de captura física e UAT humana, assim como gates operacionais de produção.

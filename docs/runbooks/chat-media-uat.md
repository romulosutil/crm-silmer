# Homologação de mídia do chat — T24

## Resultado e fronteira

T29 em 10/10/2026 mantém `clamd` no worker, com socket Unix privado e sem
TCP. A PNG sintética de 117 bytes passou de 9.326 ms por scan para 7–10 ms
com o motor carregado. Validação completa isolada: 82/86 ms. Pela tela,
imagem1/imagem2/áudio/vídeo liberaram envio em 1.163/1.140/1.116/1.121 ms;
upload→ready no banco: 545/801/1.026/366 ms. Os quatro envios terminaram
sent/attached, uma reserva e uma tentativa, no DEV15. Comparação anterior
pela tela integrada: 10–11 segundos. São medições locais, sem SLA.

Worker T29: `sha256:54918dbf91d96f99225fbdf94e4229ead49f6c75dba2043b6ae4f40a632aa496`.
Imagem construída confere byte a byte com scanner, daemon, refresh e worker.
API, n8n, bancos, RustFS, ambiente, chaves e volumes foram preservados.
Motor usa diretório0700/socket0600; pico após recuperação: 1.209.327.616 bytes,
sob o limite2GiB/1CPU existente. Fullunit993pass/zero fail/três skips antigos;
13checks+build PASS; scanner/normalizador reais2/2 PASS, incluindo EICAR,
seis formatos, Chromium WebM, limite300s e recusa301s.

A inicialização e a atualização ainda carregam o motor. Freshclam só
publica o marcador após readiness do novo processo; não editar o marcador
manualmente. A parada do antivírus em ensaio sintético provocou bloqueio de
validação e health exit1; supervisão recuperou em11.271ms, seguida de novo
scan válido e health exit0. Não existe fallback que dispense o daemon.

Provas ignoradas: `var/media-T29-{runtime,timing,browser,send,recovery}-proof.json`,
`var/media-T29-built-image-proof.json`, `var/media-T29-runtime-tests.log` e
`var/media-T29-project-gates.log`. [Revisão T29](../../.specs/features/inbox-media-rustfs/validation-clamd.md).
Rollback local preserva storage: sob fila sem jobs ativos, usar a imagem
anterior `sha256:f8f79508626bf67242ac236e84b486092bd96039db395dcc3fc46905e644c38b`
somente no worker. O helper local `var/media-T29-runtime.mjs --rollback`
confere identidade dos demais containers, env, chaves, recursos e mounts.
Nenhuma migração de banco é necessária. Produção/EasyPanel não foram alterados.

Otimização T28 em10/10: reutiliza validação completa da mesma tentativa, com
conferência de arquivo/tamanho, SHA/checksum no PUT e HEAD; retries preparados
validam novamente. Gravação conserva entrada e saída validadas. Na mesma
PNG117bytes, upload→ready caiu de20,401s para15,481/13,509s (uma tentativa cada),
com liberação do botão pela tela em16,645/14,531s. Primeiro anexo enviado
explicitamente chegou aDEV/sent com uma reserva e um callback; segundo permaneceu
ready sem mensagem. A diferença observada não é SLA nem comprovação Meta.
Worker localT28: sha256:d12e8e175b023881c74f0bbba0485bf569b4078aafa26ac01f515e4e1de8d2f4.
API/n8n/DBs, env, chaves e volumes preservados; rollback para24f30677…0b8a pelo
helper ignorado var/media-T28-runtime.mjs --rollback, sob fila idle.
Provas: var/media-T28-browser-final-comparison-proof.json e runtime-proof.json;
[revisão independente T28](../../.specs/features/inbox-media-rustfs/validation-performance.md).
T24, captura física e gates operacionais continuam pendentes.

Reteste de 10/10/2026: a tela reproduziu `unavailable/stale_signatures` no
anexo e `NotFoundError` na captura. O Windows enumerou somente saída de áudio
do monitor, sem microfone. A atualização legítima `ClamAvSignatureRefresh.refresh()`
no worker local recuperou o anexo para `ready/clean` pelo retry natural, sem
criar mensagem. Não alterar o limite36h nem forjar `.freshclam-verified`.
T27 permite **Atualizar validação** para falhas temporárias, conservando a mesma
mídia e a legenda; arquivos lost/rejected continuam exigindo substituição.
As mensagens de captura identificam ausência, acesso, interrupção e encoder,
sem expor texto arbitrário de exceções. Para testar voz física, conectar ou
habilitar um dispositivo de entrada antes de **Gravar áudio**; a saída do
monitor não é microfone. Doze anexos enviados tiveram HEAD200, enquanto os
oito lost anteriores eram rascunhos com cleanupintent após24h. T24 continua
pendente de captura física, sem Verified global ou liberação operacional.

Na mesma tela, pelo filechooser real, PNG, M4A e MP4 passaram por validação e
envio explícito e apareceram no histórico como **DEV: envio simulado**. PNG e
MP4 conservaram legendas; áudio exibiu player. Evidências locais ignoradas:
`var/media-T27-browser-final-dom.txt` e `var/media-T27-browser-proof.jpg`.
A [revisão independente específica](../../.specs/features/inbox-media-rustfs/validation-ux-recovery.md)
é PASS para T27; não substitui captura física nem os gates de produção de T24.

Em 06/10/2026 o perfil Docker local dedicado comprovou upload pela API,
processamento pelo worker construído (ClamAV, validação e normalização), objeto
privado RustFS, binding, reserva, download pelo n8n DEV e callback real ao CRM.
PNG, MP3, MP4 e gravação WebM chegaram a `sent`, identificados como DEV.
Não houve envio Meta. T24 permanece **In Progress**, com Done desmarcado:
microfone físico e avaliação humana ainda aguardam resposta; Verifier independente
e sensor serão executados somente após esse fechamento. Nenhum requisito está
declarado Verified neste documento.

Snapshot de produto: `4fa0ec1`. API/worker usados nas provas:
`sha256:24f30677faab7d95739ab66f7cc0f8d9bb3dc177cf08a5ddf482a50942eb0b8a`.
Esse snapshot corresponde às provas T24. A correção T25 altera o composer e
seus testes, preservando os contratos de API, SQL e processamento.

## Reprodução local e isolamento

Use Node 24.20.0 e `rtk npm run dev:media`. O perfil
`crm-silmer-media-local` possui volumes/DB/chaves próprios e endpoints loopback:
UI4193, API3013, PostgreSQL15435, n8n5688, RustFS21920. Não remover volumes.
Secrets ficam em `var/media-local`, ignorado; nunca imprimir seus valores.
Confira as opções em `scripts/dev-media.mjs` antes de reiniciar um perfil existente.

As provas opt-in leem apenas a configuração desse perfil e usam dados sintéticos:

```powershell
$env:RUN_MEDIA_BUILT_LOCAL_SMOKE = 'yes'
rtk npm run smoke:media:built:local
rtk npm run smoke:media:built:fault:local
```

O primeiro requer as fixtures ignoradas `var/media-profile-synthetic.png`,
`var/media-T24-synthetic.mp3`, `var/media-T24-synthetic.mp4`,
`var/chat-media-chromium-autostop-300s.webm` e
`var/media-T24-overlimit.webm`; os caminhos estão no script. O segundo modifica
temporariamente somente o workflow DEV desse perfil e restaura em `finally`.
Ambos usam inbound real antes de atribuir a conversa sintética ao vendedor;
nenhuma mídia ready é semeada manualmente, nem handler do host substitui o worker.

A UAT humana da demo4183 foi **FAILED**: preparar falhava, seletor nativo,
controles sem espaçamento, composição pouco familiar e envio bloqueado.
A admissão de mídia estava desativada na API3002 dessa demo. T25 conecta a
mesma UI4183 ao perfil completo API3013/PG15435/RustFS21920/n8n5688, com
Origin4183 e admissão/leitura habilitadas. API3002, PG15434 e volumes antigos
foram preservados. O snapshot da UI foi atualizado mantendo assets anteriores.
O smoke da nova UI identificou polling que recusava o estado transitório
`uploaded`; T25 aguarda `uploaded` e `processing`, liberando envio após `ready`.

A revisão independente encontrou ainda MED-32 no envio: recusas HTTP conhecidas
eram mostradas como resultado incerto. T26 usa somente accepted=false e códigos
públicos conhecidos para orientar retry idempotente ou remoção/reseleção.
O anexo permanece visível; detalhes privados do servidor não são exibidos.
FullUI187pass/7skips antigos, sem falha ou retry efetivo, inclui dez novos casos
de recusa/PII/idempotência. A revisão de toda a feature aguarda o reteste humano.

Esta ponte4183 é configuração da sessão local, não o default de `dev:media`:
reiniciar esse comando regenera Origin4193. Antes de reutilizar4183, conferir
Origin e proxy; não desativar a validação CSRF para contornar divergências.
Cookies de127.0.0.1 compartilham portas; usar uma sessão sintética consistente
com API3013. Testes Playwright separados não compartilham a sessão humana.

## Matriz de 32 critérios

As referências Tn apontam para os testes e adequação registrados em
`.specs/features/inbox-media-rustfs/execution.md`; a coluna T24 distingue prova
nova de evidência preservada. Casos negativos não foram removidos ou relaxados.

| ID     | Evidência e fronteira atual                                                                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MED-01 | T4/T7/T18/T21 seleção/limite JPEG/PNG; T24 PNG99bytes API→built→DEV sent e GET exato.                                                                                                                 |
| MED-02 | T4/T7/T18 MP3/OGG/M4A; T24 MP3 real sent; playback quatro codecs descrito abaixo.                                                                                                                     |
| MED-03 | T4/T7/T18 MP4 H.264/AAC; T24 MP4 real sent e GET hash idêntico.                                                                                                                                       |
| MED-04 | T4/T5/T7 limites, multipart e MIME negativos preservados; T24 bytes/hashes finais comparados.                                                                                                         |
| MED-05 | T2/T10/T11 transação e CAS; T24 uma mensagem, comando, mídia e reserva por envio.                                                                                                                     |
| MED-06 | T7/T10/T14/T15 replay; T24 mesmo ID/conteúdo/status e contagens iguais após replay.                                                                                                                   |
| MED-07 | T7/T10/T11 mesma chave com payload divergente409, evidência Live preservada.                                                                                                                          |
| MED-08 | T7/T8/T10/T21 ator/conversa/versão, SSE/transferência; negativos Live/UI preservados.                                                                                                                 |
| MED-09 | T19/T21 MediaRecorder Chromium/Firefox com hardware simulado; microfone físico pendente.                                                                                                              |
| MED-10 | T19/T21 revisão/reprodução/descarte/preparo; revisão humana Flow1/2 pendente.                                                                                                                         |
| MED-11 | T19 permissão negada/recorder ausente e alternativa de anexar, E2E preservado.                                                                                                                        |
| MED-12 | T19 limites; T24 auto-stop do componente com relógio real300s, decode299970ms; 301008ms rejeitado pelo built worker.                                                                                  |
| MED-13 | T19/T21 stop tracks/blob ao descartar/trocar/sair e troca revisão→anexo; UI preservada.                                                                                                               |
| MED-14 | T5/T6 e T24 WebM→OGG/Opus mono48kHz, metadados/hash/tamanho correspondem ao GET final.                                                                                                                |
| MED-15 | T22 preserva attached; T24 timestamp sintético8dias, fechamento real e scheduler65s mantêm quatro GETs/hashes.                                                                                        |
| MED-16 | T8/T9/T13 ACL; T24 GET401 sem sessão e403 com usuário autenticado sem capability, restaurada em finally.                                                                                              |
| MED-17 | T3/T9/T20; T24 API206 bytes0–15 exatos/Content-Range, playback Range206 nos oito pares.                                                                                                               |
| MED-18 | T9 Range inválido; T24 múltiplos intervalos416.                                                                                                                                                       |
| MED-19 | T3/T6/T9/T20 unavailable/lost, sem URL inventada nem anúncio de envio concluído; UI/Live preservados.                                                                                                 |
| MED-20 | T3/T7/T12/T13/T16 SSE/logs sem categorias proibidas nos testes; inspeção T24 limitada a canárias sintéticas. Persistência inicial n8n contém recipient/caption/Basic: gate produção bloqueado abaixo. |
| MED-21 | T12/T13/T14/T15 reserva/preflight; T24 n8n efetivo, uma reserva e preflight recusado antes do efeito.                                                                                                 |
| MED-22 | T13/T14/T15 identidade técnica/command imutável; T24 downloads reais pelo workflow e hash/tamanho validados.                                                                                          |
| MED-23 | T24 quatro arquivos reais, callback DEV, restauração do export ativo; não comprova Meta.                                                                                                              |
| MED-24 | T12/T14/T15 e T24 outcome_unknown após início do efeito, retryable/retry_safe false e replay sem novo comando/reserva.                                                                                |
| MED-25 | T18/T19/T20/T21 teclado/axe/status; T20 perda de player transfere foco só quando necessário. Playback observacional T24 usa play programático, não substitui teclado E2E.                             |
| MED-26 | T6/T7 Live scanner infectado/indisponível/stale bloqueia leitura/envio; T24 positivos atravessam ClamAV real.                                                                                         |
| MED-27 | T22 Live órfão24h, attach concorrente, writer/decoder vivo, crash/intermediários e falha DELETE mantêm reserva; T24 scheduler real conserva attached.                                                 |
| MED-28 | T23 Live131/131 e HTTP dois202/terceiro429/quota intacta/texto202; capacidade2/decoder serial, receiving grace3min conserva bytes.                                                                    |
| MED-29 | T4/T5/T6 codecs/MIME negativos; T24301s invalid_format, send409 e nunca ready.                                                                                                                        |
| MED-30 | T25 valida automaticamente seleção/parada e estados uploaded/processing antes de ready, sem POSTmessage implícito; revisão física pendente.                                                           |
| MED-31 | T25 picker temático, toolbar única/envio contextual, draft texto preservado, botões44px, gap2D>=8px em1280/390px e axe sem violações; revisão humana pendente.                                        |
| MED-32 | T25 erros401/403/404/413/429/503 explicam recuperação; preview e chave original preservados, envio continua bloqueado até ready.                                                                      |

O403 acima usa usuário sem função operacional válida no DB sintético e restaura
a função. Vendedores ativos compartilham leitura do Inbox pela baseline;
não se introduziu isolamento de attached que o produto não prevê.
O teste de retenção usa idade por fixture SQL e espera real de65s pelo scheduler;
não afirma oito dias de espera em relógio real.

## Provas preservadas

Todos os arquivos em `var/` são ignorados, locais e preservados para revisão:

- `media-T24-full-built-final.log` e `media-T24-built-pipeline-proof.json`:
  script permanente principal executado exit0; PNG99bytes, MP316527bytes,
  MP422251bytes e OGG normalizado1543526bytes. O script exige duração não nula,
  positiva≤300000, origem recording, MIME audio/ogg, Opus e hash final igual ao GET.
- `chat-media-chromium-autostop-300s.webm`:4838047bytes,
  SHA256 `98efa5465f58fb3a51aba3fdfa0bb0ee76e00ab6c2d462f26ab683dc2c46536f`.
  Componente AudioRecorder real/Chromium151/relógio real/hardware simulado;
  elapsed318918ms inclui extração do blob e não mede duração.
  Decode original299970ms. OGG efetivamente baixado
  `media-T24-normalized-boundary.ogg`: FFprobe built Opusmono48000,
  duração299.976500s (padding), FFmpeg decode exit0; DB299970ms.
  Runtime FFmpeg5.1.9 Debian12. Limite301s não foi relaxado.
- `media-T24-fault-callbacks-final.log`, `media-T24-fault-callback-proof.json` e
  exports `media-T24-workflow-{before,active-fault,after}.json`: workflow ativo
  fault distinto, preflight recusado→failed/MEDIA_PREFLIGHT_UNAVAILABLE e efeito
  incerto→outcome_unknown. Flags de retry false e replay não duplica reserva.
  O código funcional ignorado executado exit0 foi promovido ao script permanente
  fault com guard/JSDoc/formatação; gates estruturais validam a fonte final.
- Digest canônico de origem
  `2a09bc5d9e5cc4600a5d6c3038d770c964acad7ef819d3fa0490051ac5e0600d`;
  digest runtime nodes/connections/settings antes=depois
  `5f4275e77151cc79dfb600ed7809acb53ee57bede0caf5839f7226ef1e45e395`.
  Workflow restaurado publicado/ativo. O primeiro ensaio foi restaurado pelo
  importer automático e recebeu sent: diagnóstico da fixture, não falha do produto.
- `media-T24-playback-codecs-final.log`/`media-T24-playback-codecs-proof.json`:
  oito pares Chrome151 Windows e Firefox153 Linux × MP3/OGG/M4A/MP4 passaram
  readyState4, sem erro/autoplay, controles, seek0.5→play avançando e GET206
  autenticado. Cada codec usa contexto novo. MP3/MP4 são os bytes do pipeline;
  OGG é GET efetivo normalizado; M4A é fixture AAC adicional. Servidor HTTP da
  prova de UI é fixture privada; ACL da API real foi provada separadamente.
  Não declarar Firefox nativo Windows, Edge de marca ou Safari homologados.

Pico worker cgroup1109327872bytes inclui startup e ensaios repetidos/300s;
n8n atual961609728bytes após restauração/restart. Ambos2GiB/1CPU e sem OOM.
Não é ensaio de dois decoders concorrentes nem capacidade do servidor remoto.

Hashes SHA256 preservados em `var/media-T24-proof-hashes.json`:

| Artefato                | SHA256                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| built-pipeline-proof    | `07be69fe4eedafe5c8f28c7288fd50bd8fa2d483dfcfbac3bdefd91f2fdad00f` |
| fault-callback-proof    | `ed7fb4786dce6b8b55cc78ef4fff68f6a258181633a030580b22ef3e2c368e4f` |
| playback-codecs-proof   | `762c108929a87b6c3e3d4056bb2c6caa834b1200d4edd1a577866895da653681` |
| privacy-inventory-proof | `cf62ade0f9c0346396dcd8669aa5a1d55567363bc2e5a5c210f09ba5ccc3a1b5` |
| normalized-boundary.ogg | `fd7c7a10e464b68454621c6ea72374ae5113822816ad1affb6af6943a4bb73bb` |

Gates finais desta entrega documental/harness: formatcheck, types, lint,
boundaries, tokens e build exit0 (`var/media-T24-structural.log`); diffcheck e
ConventionalCommit checker exit0. Live131/131 zero skips e UI166pass/7skips antigos
(total173) pertencem ao snapshot de produto4fa0ec1, não foram repetidos sem mudança
de comportamento. Pipeline, fault e browser são provas específicas novas descritas
acima. Primeiro lint dos novos scripts falhou por globals Node24 e variável ready
não usada; declaração globalThis/await preservado corrigiram sem mudar assertions.
Spec/tasks strict:0errors/0warnings. O warning inicial de Where T23 foi corrigido
pela fronteira única do entrypoint operacional e lista completa de suporte,
preservando o escopo e o commit histórico; commit ocorreu somente após exit0.

## P1: gate de privacidade para ativação operacional

`media-T24-privacy-final.log`/`media-T24-privacy-inventory-proof.json` examinaram
n8n PostgreSQL em memória, sem gravar/imprimir payloads ou valores de headers.
23 linhas execution_data, todas soft-deleted, snapshots iniciais status running:
recipient20, caption16 e **header Basic recebido21**. Categorias filename,
object key, canária forte de bytes e referência binary:0. Logs dos containers
API/worker/n8n não continham essas sete categorias nas canárias examinadas.
Essa inspeção limitada não comprova ausência global de PII ou segredo.

Save-none e binary-default não impedem a persistência inicial do Webhook.
Soft-delete/pruning não demonstram expurgo seguro, inclusive PostgreSQL/WAL.
**Bloquear ativação com dados e credenciais operacionais** até minimização/redação,
expurgo e readiness de privacidade comprovados com evidência real. Neste ensaio
foram usados somente dados e chaves do perfil local sintético. Não houve mutação
remota. Gates de backup/restore, IAM remoto, migração legada e Meta também
permanecem externos; catálogo verde ou mocks não equivalem a esses gates.

## UAT humana pendente

Retestar na UI4183, sessão sintética do perfil completo, conversa
“Conversa sintética para testar mídia”. O humano permite o microfone, grava
fala, para, ouve e descarta; confirmar som e liberação do dispositivo.
Em outra gravação, parar, ouvir e enviar explicitamente após a validação
automática. Não existe mais etapa manual “Preparar”. Confirmar DEV sent e
reprodução no histórico. Selecionar também imagem/áudio/vídeo, editar legenda
quando aplicável e operar controles por teclado, inclusive em tela estreita.

Não automatizar hardware físico ou sua permissão. A correção T25 tem revisão
independente própria; T24 e o Verifier de toda a feature aguardam essa nova
resposta humana. Manter gates operacionais pendentes honestos e não converter
silêncio em aprovação.

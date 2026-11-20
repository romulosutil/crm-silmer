# WhatsApp pessoal — viabilidade do provedor e privacidade

Entrega WAP-E01 / WAP-T01-01, 16/11/2026 (America/Sao_Paulo).
Requisitos WAP-02/03/04/10/12; [spec](../../.specs/features/seller-whatsapp/spec.md),
[SDD, seções 5–6](../../.specs/features/seller-whatsapp/design.md),
[ADR 090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md) e
[ADR 091](../adr/091-contratos-da-etapa1-whatsapp-pessoal.md).
Base inicial `f7a06389`, posterior à integração da PR 382 e do SDD; preserva
`d7537b3c`. Correção publicada sobre `c14df42c`, após a integração externa do
PR 391 durante a execução.

Continuação WAP-E02: o [runbook de controle pessoal](seller-whatsapp-control.md)
registra o backend, o verificador autoritativo e os workflows gerados inativos,
com suas provas sintéticas. A execução posterior usa o gate técnico corrigido
de E01, sem concluir os gates mobile/retenção operacional registrados abaixo.

## Correção técnica — RFC 069 / ADR 092

O proprietário autorizou a correção dos dois bloqueios centrais em 16/11/2026.
[RFC 069](../rfc/069-ingresso-efemero-e-geracao-autenticada-do-whatsapp.md) e
[ADR 092](../adr/092-sanitizacao-pre-persistencia-e-geracao-na-origem.md) registram
a decisão. A [nova evidência](../../ops/evolution/wap-provider-spike.fixed.evidence.json)
tem `technicalGate=passed`, `privacyFailures=[]` e todos os scans negativos,
incluindo os arquivos físicos PostgreSQL/WAL. SHA-256:
`e7fc2b30989d45e2b4df7bc89c834b069c99f51f44d7eb1437a0cedd4c5a39d6`.
O relatório negativo original abaixo permanece imutável e não é o resultado
da imagem corrigida. O comando de reprodução atual constrói as imagens corrigidas;
a baseline negativa corresponde ao commit `a1e8b761`.

**Habilitação operacional continua bloqueada.** Mobile no mesmo celular e
retenção operacional de múltiplas instâncias não são homologados por este
ensaio. WAP-E01/T01-01 permanecem abertos nesses critérios, sem avanço E02.

### Patches entregues

- n8n 2.43.7 (portado da 2.38.7, ver [porte](#porte-para-o-n8n-2437)):
  [Dockerfile](../../ops/n8n/wap-ingress-Dockerfile),
  [patcher](../../ops/n8n/wap-ingress-patch.mjs) e
  [guardas](../../ops/n8n/wap-ingress-runtime.cjs). Hashes de Webhook.node.js,
  active-executions.js e workflows.controller.js são verificados antes de
  modificar qualquer fonte. Auth nativa precede a projeção do input inicial.
  Headers/query/params são removidos, incluindo aliases; o getter query do
  Express é tratado no request, sem alterar o prototype. REST create/update
  recusam pinData/settings inseguros antes de SQL; manual parcial/retry/resume
  não contornam a primeira escrita. Perfil E01 admite somente enums sintéticos,
  generation=1 para desafios e nenhum ID de operação/desafio arbitrário.
- Evolution 2.3.7: [patcher](../../ops/evolution/wap-generation-patch.mjs) e
  [runtime](../../ops/evolution/wap-generation-runtime.cjs) capturam contexto
  imutável por socket antes da fila, propagado por AsyncLocalStorage. Source e
  token da geração não são reconstruídos no despacho. Eventos pessoais fora
  do esquema/sem contexto são recusados sem rejeição assíncrona solta e só com
  código fixo. O snapshot Prisma remove pairingCode **antes da serialização e
  SQL**, preservando o objeto vivo e as chaves de sessão, inclusive advSecretKey.
  Isso é necessário porque Baileys publica o código em creds.update; logout
  posterior não evita retenção física. Não se alteram Redis/file adapters nem
  dados existentes. A projeção de persistência vale também com geração off.

As imagens só foram construídas localmente no Mel e removidas depois:

- Evolution corrigida: `sha256:90664dde6f89be5009f4fd1d0ba2c5aaafd5ad5c875058ddc3072be8f8bf960a`.
- n8n corrigido: `sha256:1b10735a274cf87d3a74cb9a5a7743e7a5271b2c3a3c5168b5c14c5084d09717`.

### Porte para o n8n 2.43.7

Em 18/11/2026, o n8n de produção (`schedule/n8n`) já rodava `n8nio/n8n:2.43.7`.
A imagem fixada na 2.38.7 faria downgrade do n8n compartilhado, então o patch
foi portado sem mudar guardas nem âncoras:

- Base `n8nio/n8n:2.43.7@sha256:3db21366be1d3c77c1708963129c051948573019659e8873e0294be035ffc1b2`
  (índice OCI oficial; o mesmo método reproduz o digest antigo da 2.38.7).
- Hashes novos de `Webhook.node.js` (n8n-nodes-base 2.43.5),
  `active-executions.js` e `workflows.controller.js` (n8n 2.43.7). Os pacotes
  npm 2.38.x reproduzem os três hashes antigos, e o build da imagem oficial
  aceitou os novos (`WAP_N8N_INGRESS_PATCHED`).
- Todas as âncoras existem uma única vez e na mesma ordem. O controller passou
  a importar o erro como `errors_1.BadRequestError`. A 2.38 agora é recusada.
- O ensaio `wap-provider-spike` materializava só quatro dos cinco blocos
  embutidos do `Dockerfile.inline` e falhava no Docker legado depois do WAP-E02.
  Agora ele inclui `wap-control-runtime.cjs`.

A [evidência da 2.43.7](../../ops/evolution/wap-provider-spike.n8n-2.43.7.evidence.json)
(SHA-256 `aa914b0fd44a710231bf18a5edc6805e4756f8bc5669a47083603a194feb8e00`)
tem `technicalGate=passed`, `privacyFailures=[]` e todos os scans negativos.
Imagens locais no Mel, removidas ao final: Evolution
`sha256:7eb707106bd75166e23be884bffcdb3824859f80a85954506aebbf4419d5cfbd`,
n8n `sha256:d332460e5f2b71a6c83b8ea9013dfafa3254cab46f92c0f80eefcc815f5614a9`.
O EasyPanel recebe o [Dockerfile inline](../../ops/n8n/wap-ingress-Dockerfile.inline),
gerado por `node ops/n8n/render-wap-ingress-dockerfile.mjs` a partir do
Dockerfile, do runtime e do patcher. Ele está em produção desde 18/11/2026
(fonte Dockerfile do serviço `schedule/n8n`), e o teste do patch falha se o
inline divergir das fontes. Rollback: voltar a fonte para `n8nio/n8n:2.43.7`.

O gate continua `blocked` pelos mesmos motivos: código no mesmo celular e
retenção operacional de múltiplas instâncias.

### Resultado da prova corrigida

| Critério            | Evidência                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR/código via n8n   | Quatro round-trips 200/no-store: dois canários e as modalidades reais QR/código de duas instâncias sintéticas. Nenhuma conta pareada. Cada instância precisa devolver a modalidade solicitada, não ambas simultaneamente.                                |
| Não persistência    | Todos os scans negativos para credenciais distintas, owner password/cookie e desafios: sucesso, erro, manual real, progresso, pinData recusado, dump lógico, volume, logs stdout/stderr e arquivos físicos PostgreSQL/WAL após parada limpa.             |
| Pin/manual          | REST create/update com canário em pinData retorna 400 antes de qualquer escrita; export continua vazio. Manual parcial com token em runData retorna 400 antes de execução/efeito; manual completo legítimo confirmado pelo evento de sucesso do runtime. |
| Origem/reconnect    | Callback real enfileirado em A1 antes do reconnect foi emitido com source A1 e recusado 403; A2 e replay conservam source A2 e retornam 200; outra linha B1 isolada.                                                                                     |
| Retry em voo        | Verificador retorna 503 e revoga A2; o retry HTTP real conserva A2 e recebe 403, mesmo após instalar socket A3. Callback A3 recebe 200. Não é apenas replay de callback.                                                                                 |
| Negativos           | Token cruzado, conta/instância/geração divergentes e token ausente recusados antes de execução. Código numérico não pode entrar como generation. JSON malformado recebe 422 nativo antes do Webhook. Settings inseguros recusados antes de SQL.          |
| Default off         | Nova inicialização da imagem sem flags, usando o banco/credencial de teste, devolve 403 fixo para comando válido e não acrescenta execution_entity. Logs continuam sem segredo.                                                                          |
| Lifecycle e cleanup | Eventos sem contexto/fora do esquema não despacham nem geram rejeição solta. Todas as instâncias de containers, volumes, rede e tags da rodada foram removidas por ownership.                                                                            |

O ingresso autentica `{source, instance}` por token da geração e Basic técnico
distinto no verificador sintético. Somente a autorização atual é consultada
para revogar; nunca se atribui a geração atual ao evento antigo. Falha temporária
do verificador é 503 fixo; credencial/revogação/divergência é 403 fixo, sem logs
de payload. O contrato real do verificador permanece em E02/E04 pela API CRM,
sem acesso direto n8n→SQL e sem mudar Basic v1.

A prova de origem usa os métodos reais extraídos do bundle patchado, incluindo
callback, fila, connectionUpdate, sendDataWebhook, emit e retryWebhookRequest,
com Axios/n8n/verificador reais. A notificação e o socket são sintéticos; isso
não homologa um socket WhatsApp pareado. O escritor de creds também é exercitado
com BufferJSON real e sink em memória, além do scan físico do PostgreSQL real.
Nenhum dump/log/QR/código bruto foi publicado. Diagnósticos físicos expõem
somente arquivo e categoria se houver acerto, nunca os bytes encontrados.

### Configuração e próximos gates

Todos os novos guards são default off. A instalação do binding é um hook
interno, usado apenas no processo do rehearsal; a API Evolution do ensaio
continua com geração off até existir o controle E02. Não selecionar estas
imagens em ambiente real como consequência de aprovar o PR.

**Eventos pessoais (WAP-E12).** A instância pessoal emite somente
`connection.update`, `messages.upsert` e `messages.update`; qualquer outro
evento (`qrcode.updated`, `messages.set`, `send.message`, contatos, chats,
grupos) é negado na fonte com o código fixo `WAP_GENERATION_EVENT_REJECTED`.
Os três eventos carregam o `source` capturado no socket e o header
`X-Silmer-Wap-Generation-Token` da mesma geração, inclusive quando o callback
fica na fila e é liberado depois de um novo binding. O envelope de mensagem
sai com exatamente `event`, `instance`, `source`, `data`, `destination`,
`date_time`, `sender` e `server_url`; `apikey` e chaves extras do upstream não
saem do processo. Antes do envio também são recusados chats que o CRM nunca
usa: `remoteJid` terminado em `@g.us`, `@broadcast` (inclui `status@broadcast`)
ou `@newsletter`, e mensagens com `participant`/`participantAlt`. Em
`messages.update` só passa recibo de mensagem própria (`fromMe=true`) com
status `ERROR`, `DELIVERY_ACK`, `READ` ou `PLAYED`; `SERVER_ACK` já é
representado pelo resultado HTTP do envio. Os filtros espelham
`validateEvolutionEvent`, exceto que `messages.upsert` com `fromMe=true`
segue para o CRM: é o eco do que o vendedor digitou no aparelho (WAP-09).
Mensagem enviada pelo CRM não gera eco em `messages.upsert` (Evolution 2.3.7
usa `emitOwnEvents:false`); sua confirmação vem do resultado HTTP e dos
recibos `messages.update`. Evento de geração antiga é recusado com 403 fixo no
ingresso n8n; o 409 `WHATSAPP_GENERATION_STALE` do CRM é a segunda barreira.

**Recepção parada com socket aberto (WAP-09/WAP-E12).** A versão fixada do
Baileys pode continuar enviando enquanto o servidor retém as entradas na
ausência de ACK de um stanza `status` de nível superior. A imagem aplica a
correção de protocolo ao recebedor do Baileys, com hash e âncoras fixados. Só
os sockets das instâncias pessoais selecionadas enviam o ACK, pela mesma
fila de nós offline. O corpo do Status permanece fora do CRM e do webhook.
O build registra `WAP_BAILEYS_STATUS_ACK_PATCHED`. No piloto, verificar nova
mensagem numa conversa existente e o recibo de uma resposta. O corte temporal
e a geração continuam valendo para mensagens retidas antes da reconexão.
[Correção proposta no Baileys](https://github.com/WhiskeySockets/Baileys/pull/2883).

**Reconexão: eventos em voo da geração anterior são perdidos (WAP-E12).** Na
2.3.7 (`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`), o
`BaileysMessageProcessor` (rxjs `concatMap` com retry) é montado, mas a única
chamada `processMessage` está comentada em `eventHandler`; `messages.upsert`
é tratado diretamente em `client.ev.process`, encadeado na promise
`eventProcessingQueue` da instância, que sobrevive à troca de socket. Um evento
capturado na geração N que ainda esteja nessa fila, ou em retry HTTP, quando a
geração N+1 é instalada sai com o `source` N e recebe 403 no ingresso (409 no
CRM). Não há backfill nem reenvio: a mensagem fica só no aparelho do vendedor.
É perda aceita para o piloto; não reprocessar manualmente nem relaxar a
recusa por geração para recuperá-la.

**Retenção, ajustes e egress (WAP-E12).** Substituem o item 3 do resultado
inicial abaixo.

- Retenção: o expurgo de sete dias de `retention.cjs` (no boot, `--once`, e a
  cada hora) cobre `SILMER_EVOLUTION_INSTANCE` e toda instância listada em
  `SILMER_WAP_GENERATION_INSTANCES`, em um único `deleteMany` Prisma com
  `name IN (...)` parametrizado, sem SQL bruto. A lista continua coberta com a
  geração desligada, para que as linhas envelheçam após rollback; só remover um
  nome da lista sete dias depois do logout da instância. Nome fora de
  `[A-Za-z0-9_-]{1,64}`, duplicado ou igual à instância geral, flag não literal
  ou `true` com lista vazia falham com `EVOLUTION_RETENTION_CONFIGURATION_INVALID`
  e o boot para.
- Ajustes: em todo connect (criação ou reuso de instância `close`), o gateway
  envia `POST /settings/set/:name` com `rejectCall=false`, `msgCall=''`,
  `groupsIgnore=true`, `alwaysOnline=false`, `readMessages=false`,
  `readStatus=false`, `syncFullHistory=false`, `wavoipToken=''` e confere
  `GET /settings/find/:name` campo a campo **antes** de configurar o webhook.
  Divergência, `null` ou erro termina em `WAP_CONTROL_UNKNOWN`, sem webhook. A
  reconciliação relê os ajustes; divergência retira `webhookVerified` como um
  webhook divergente (resultado `blocked`). `msgCall` e `wavoipToken` vazios
  impedem resposta automática a chamadas e o socket wavoip. Fontes 2.3.7:
  `src/api/routes/settings.router.ts`, `src/api/services/settings.service.ts`,
  `src/api/services/channel.service.ts` (`setSettings`/`findSettings`) e
  `src/validate/settings.schema.ts`.
- Desafio (QR ou código): no Evolution 2.3.7, `GET /instance/connect/:name`
  numa instância `close` abre o socket, espera 2 s fixos e devolve o QR que
  existir; o QR e o código de pareamento nascem de forma assíncrona e podem
  ainda faltar (`{ count: 0 }`). Em `connecting`, o mesmo endpoint só lê o QR
  atual, sem abrir outro socket. O gateway relê o estado e o QR a cada 500 ms
  por até 8 s; se o estado sair de `connecting` ou o prazo acabar, o resultado
  é `WAP_CONTROL_UNKNOWN`. O orçamento cabe nos 15 s do cliente do CRM. Visto
  no piloto de 19/11: sem essa espera, o primeiro QR falhou, e a reconciliação
  levou a linha a `disconnected`. Fonte 2.3.7:
  `src/api/controllers/instance.controller.ts` (`connectToWhatsapp`) e
  `whatsapp.baileys.service.ts` (`connectionUpdate`, `get qrCode()`).
- Egress: `privacy.cjs` exige o literal `false` em `RABBITMQ_ENABLED`,
  `SQS_ENABLED`, `KAFKA_ENABLED`, `NATS_ENABLED`, `PUSHER_ENABLED`,
  `S3_ENABLED`, `CHATWOOT_ENABLED`, `TYPEBOT_ENABLED`, `OPENAI_ENABLED`,
  `DIFY_ENABLED`, `N8N_ENABLED`, `EVOAI_ENABLED`, `FLOWISE_ENABLED` e
  `PROVIDER_ENABLED` (nomes de `src/config/env.config.ts` na 2.3.7), e
  `SENTRY_DSN` ausente ou vazio. **Antes de rebuildar a imagem, o operador
  precisa acrescentar as 14 variáveis com `false` no ambiente Evolution do
  EasyPanel**: ausente ou outro valor faz o boot falhar com
  `EVOLUTION_PROFILE_INVALID`, e a linha geral também fica fora do ar. Os
  valores estão em [environment.env.example](../../ops/evolution/environment.env.example).

| Configuração                    | Default / uso na prova                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| SILMER_WAP_GENERATION_ENABLED   | ausente/false; true só no processo de rehearsal                                |
| SILMER_WAP_GENERATION_INSTANCES | vazio; duas instâncias sintéticas explicitamente permitidas no rehearsal       |
| SILMER_WAP_INGRESS_ENABLED      | ausente/false; true só no n8n descartável da prova                             |
| SILMER_WAP_INGRESS_PATHS        | allowlist explícita de paths reservados e modalidades; ausência recusa         |
| SILMER_WAP_INGRESS_VERIFY_URL   | limitado ao fixture privado do ensaio; sem URL CRM real implementada           |
| SILMER_WAP_INGRESS_VERIFY_BASIC | credencial técnica sintética distinta; nunca em workflow JSON, execução ou log |

Rollback mantém caminhos pessoais desligados e seleciona somente imagem
compatível com os guards; não remove campos/comércio nem reconstitui desafios.
O patch previne novas escritas de pairingCode, mas não limpa bancos/backups
históricos. A política vigente de sessão/retenção permanece; não apagar dados
existentes para conseguir um scan verde.

Verificações finais da correção: 52 testes focalizados aprovados, zero skips;
validate com 2.876 testes, 2.823 aprovados e 53 skips condicionais existentes,
zero falhas e build aprovado; audit sem vulnerabilidades. A integração externa
do PR 391 exigiu atualizar a base e repetir os gates completos no snapshot final
sobre `c14df42c`, além da repetição anterior motivada pela correção pré-SQL.
O [PR 393](https://github.com/romulosutil/crm-silmer/pull/393) sucede a baseline do PR 391.

**Falha E2E anterior e correção da fixture (MED-12/30).** A primeira rodada de E2E/axe com quatro workers
teve 1.060 aprovados, sete skips legados e uma falha, inclusive nos dois retries:
`audio-recorder.spec.js:426`, captura no limite exato de 16 MiB, não observou o
upload em cinco segundos (`uploads.length` permaneceu zero). O mesmo teste
passou depois isoladamente, com um worker e zero retries, sem qualquer mudança
de código, timeout ou assertion.

A investigação autorizada em seguida mediu o fetch de 16.777.216 bytes já
iniciado enquanto o callback de page.route só recebia o request de 2,1 a 3,3
segundos depois. A fonte instalada do Playwright ativa Fetch.enable para todos
os requests e decodifica/concatena o postDataEntries do CDP antes de construir
o Request interceptado. Isso acrescentava cópias do multipart ao caminho da
assertion de cinco segundos. A medição identifica a fragilidade da fixture;
não prova que toda a demora da rodada anterior veio exclusivamente desse trecho.

Somente o cenário no limite agora usa o servidor Vite sintético já existente,
em 127.0.0.1 e porta aleatória, sem page.route. O parser multipart nativo recebe
o corpo completo por HTTP e mede o File real. O teste mantém cinco segundos,
uma parada de tracks, upload único e nenhum envio automático; acrescenta
assertions de 16 MiB exatos, MIME com codec, nome/campos e botão habilitado após
202/ready. Nenhum código da aplicação, timeout, retry, tamanho ou assertion
original foi reduzido. Não há novo serviço operacional ou efeito em produção.

Ensaio focal corrigido: a suíte de áudio repetida quatro vezes com quatro
workers e zero retries passou nos 92 cenários, incluindo teclado/foco/axe e
captura/reprodução nativas Chromium/Firefox. Os quatro casos de 16 MiB duraram
0,37–0,72 segundo. A repetição completa dos gates está registrada a seguir.

Na primeira repetição completa após o patch, o áudio passou em 1,2 segundo;
a rodada encontrou outro bloqueio na fixture de Olist (`olist-phase2.spec.js:429`):
o seletor global da confirmação encontrava simultaneamente o status no painel
e o anunciador acessível global, ambos previstos em OlistView/App. O teste foi
delimitado à região nomeada “Conexão da empresa”, preservando texto exato,
visibilidade, conferência humana e geração desativada. Quatro repetições focais,
quatro workers e zero retries passaram. Nenhum comportamento de Olist mudou.

**Gate completo corrigido aprovado no SSH Mel.** O snapshot contém exatamente
os dois testes revisados, conferidos por SHA-256. Node 24.20.0/npm 11.19.0,
imagem Playwright fixada pelo digest acima e PulseAudio sintético:

- `npm run validate`: 2.876 testes, 2.823 aprovados, 53 skips condicionais
  existentes, zero falhas e build aprovado.
- `npm run test:e2e -- --workers=4 --retries=2`: 1.061 aprovados, sete skips
  legados, zero falhas/retries, 9,7 minutos. Áudio de 16 MiB passou em 0,78
  segundo; conferência Olist passou em 3,2 segundos nessa rodada completa.
- `npm audit --audit-level=high`: zero vulnerabilidades.
- Prettier/ESLint focais, referências e `git diff --check` aprovados.

Os ensaios focais usaram `npm run test:e2e -- test/e2e/audio-recorder.spec.js
--workers=4 --repeat-each=4 --retries=0` (92 aprovados) e
`npm run test:e2e -- test/e2e/olist-phase2.spec.js --grep 'recovery requires
explicit human attestation' --workers=4 --repeat-each=4 --retries=0` (quatro
aprovados). Nenhum container, diretório temporário ou porta publicada permanece
no Mel após o fechamento. Produção permanece desabilitada; os gates mobile e
retenção operacional de WAP-E01 continuam abertos. Não houve avanço E02.

O PR 393 foi integrado externamente durante esta investigação. A correção dos
testes segue em PR de continuação sobre `5ff57934`; a árvore dessa base é
idêntica à de `b9343395` usada nos gates (tree
`8adf9d206b8061b7c77d7856bf2b0e777988ac7c`). A troca do SHA pelo merge não
alterou código ou dependências e não exigiu repetir os gates já aprovados.

## Resultado inicial e bloqueios identificados antes dos patches

**Gate bloqueado.** O spike é uma investigação reproduzível, não um adapter
operacional nem homologação do provedor. WAP-E01 e WAP-T01-01 permanecem abertos.
Não iniciar WAP-E02 supondo que os gates abaixo tenham passado.

1. A geração não é autenticada na origem pela fonte/wrapper fixados. O upstream
   enfileira eventos antes de consultar a configuração de webhook atual; trocar
   URL/header na mesma instância pode atribuir credencial nova a evento antigo.
   O wrapper ainda aplica um único token global, inclusive a outra instância.
2. O n8n grava dados iniciais antes do primeiro nó de guarda. O ensaio encontrou
   o token técnico sintético em claro no dump, apesar de save-success/error=none,
   save-manual=false e save-progress=false. Remover dados depois não prova
   ausência em persistência, WAL ou backups anteriores.
3. Retenção atual seleciona somente `SILMER_EVOLUTION_INSTANCE`. Acrescentar
   instâncias não demonstra expurgo de todas as linhas. Não ampliar retenção.
4. A existência de `pairingCode` na resposta não homologa o mesmo celular.
   Nenhuma conta foi pareada; identidade conectada, mobile, capacidade e recovery
   permanecem gates próprios. Não apresentar duas telas como substituição aceita.

Nenhuma flag de ambiente real, rota CRM, migração ou workflow operacional muda.
Contact oficial, carteira, ACL comercial independente, snapshots, linha geral,
reservas e retenção permanecem nos serviços existentes. Vínculo cadastral não
concede conversa ou Pedido alheio. Não há infraestrutura permanente nova.

## Fonte fixada e contratos observados

Evolution API 2.3.7, commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`,
Baileys 7.0.0-rc.9; imagem upstream OCI
`sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339`.
O [perfil existente](../../ops/evolution/README.md) troca apenas Node por
24.22.1 e aplica `privacy.cjs`/`retention.cjs`. O ensaio usa essa mesma receita:
para Docker legado, materializa os dois COPY heredoc byte a byte, sem mudar os
demais comandos, bases ou o comportamento do wrapper.

| Contrato privado                                      | Efeito/limite verificado                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /instance/create`                               | 201; `integration=WHATSAPP-BAILEYS`, `qrcode=false`. Resposta inclui hash/credenciais upstream: não persistir o corpo bruto no CRM/n8n.                                          |
| `GET /instance/connectionState/:name`                 | Estado aninhado `instance.state`; `close`, `connecting`, `open` não comprovam sozinhos número/titular.                                                                           |
| `GET /instance/connect/:name`                         | Tem efeito, embora seja GET upstream. Em `close`, inicia socket; em `connecting`, devolve desafio atual, sem aplicar novo número. Nunca mapear para navegação/GET humano no CRM. |
| `GET /instance/connect/:name?number=...`              | Instância sintética separada retorna `pairingCode`, além do QR. Não comprova uso do código no aparelho.                                                                          |
| `DELETE /instance/logout/:name`                       | Logout 200 das tentativas não pareadas; em `close`, a fonte pode recusar. Desconectar não libera titularidade nem autoriza nova tentativa incerta.                               |
| `POST /webhook/set/:name` e `GET /webhook/find/:name` | Desabilitação e leitura explícitas antes de conectar: enabled=false, eventos vazios, byEvents/base64=false. Nenhum evento é dirigido ao n8n operacional.                         |
| Requisição sem chave API                              | 401 no gateway dedicado. Chaves técnicas ficam somente no servidor/credencial cifrada; nunca no browser ou resultado bruto.                                                      |

`connect`/`restart` podem responder HTTP 200 com `{error:true,...}`: validar o
corpo e registrar somente outcome/metadados autorizados. Timeout ou resposta
ambígua exige reconciliação; o spike despacha um único connect por instância e
não repete em caso de erro/timeout. Create e logout também não têm retry.

Eventos na fonte: `messages.upsert`, `messages.update`, `connection.update` e
`qrcode.updated`. `sender`/`wuid`/`ownerJid` são pistas de identidade a validar;
o número informado pelo humano não é prova. `fromMe=true` é fato outbound,
não autorização de reenvio. O adapter da linha geral descarta esses upserts e
permanece inalterado; na instância pessoal eles são o eco WAP-09 descrito em
"Eventos pessoais (WAP-E12)". QR/código só seguem pelo retorno síncrono do
ensaio, nunca webhook de eventos; o wrapper continua recusando QR/histórico e
limpando `apikey`. A instância pessoal é criada com `groupsIgnore=true` e
`readMessages`, `readStatus`, `syncFullHistory`, `alwaysOnline` e `rejectCall`
em `false` (campos do `InstanceDto` da 2.3.7), reaplicados e conferidos por
`/settings/set` e `/settings/find` em todo connect, e o webhook é configurado e
conferido com exatamente `CONNECTION_UPDATE`, `MESSAGES_UPSERT` e
`MESSAGES_UPDATE`, `byEvents=false` e `base64=false`.

Fontes primárias da revisão:

- [Rotas upstream](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/routes/instance.router.ts).
- [Controller de instância](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/controllers/instance.controller.ts).
- [Geração, identidade e fila de eventos](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts#L1719).
- [Emissão usa configuração atual](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/event/webhook/webhook.controller.ts#L69).
- [Envelope sem geração capturada](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/services/channel.service.ts#L406).

## Ensaio dedicado e reprodução

Executado no host de desenvolvimento Mel, autorizado por SSH. Não utiliza
Evolution/n8n/PostgreSQL já em execução no host. Prefixo aleatório `wap-e01-*`,
label de ownership por rodada, rede própria, sem porta publicada, bancos
sintéticos separados e volumes próprios. O n8n de teste é ativado somente no
ambiente descartável para exercitar seu webhook real; nada é importado no
n8n operacional. Nenhum número real, pareamento, mensagem ou efeito financeiro.

```sh
node --test test/n8n-evolution-workflow.test.js
node --test ops/evolution/profile.test.mjs
node ops/evolution/wap-provider-spike.mjs --isolated-synthetic > report.json
```

O último comando requer Docker de desenvolvimento no mesmo host dos arquivos.
Saída 1 significa assertion/ensaio reprovado; saída 2 significa ensaio executado
com gate de habilitação ainda bloqueado. Nenhuma dessas saídas autoriza produção.
Sem argumento explícito ele recusa executar. Não chamar o script em ambiente
de produção nem apontá-lo a containers, URLs, volumes ou bancos existentes.

A fixture [em memória](../../ops/evolution/wap-provider-fixture.mjs) gera canários
e encaminha um único connect de cada instância dedicada. O
[workflow de prova](../../ops/n8n/wap-pairing-privacy-probe.mjs) é inativo e default
off, exige credencial, configuração explícita e allowlist somente sintética
antes de HTTP. Sua geração fixa testa a guarda da fixture; **não é prova de
geração autenticada do provider**. Todos os nós HTTP bloqueiam redirects e retry.
Não é workflow de controle WAP-E02 nem novo ingresso de produção.

O runner inspeciona somente em memória: respostas, canários recursivos,
representações raw/JSON/base64, token técnico em claro, pg_dump, stdout **e**
stderr de n8n/provider e tar do volume n8n. Captura snapshots durante execução
e após parar n8n, além de varredura dos arquivos físicos do PostgreSQL/WAL.
O dump é backup lógico real. A varredura física não é drill de restore nem
prova de decodificação de todo formato comprimido. Nenhum dump, tar, log bruto,
cookie ou desafio é salvo como evidência. O relatório contém apenas estados,
contagens, nomes de tabelas, booleans e códigos fixos; assertions não imprimem
seus valores recebidos. Assertions de privacidade são agregadas para completar
a matriz, mas qualquer ocorrência mantém a execução reprovada.

O runner remove apenas nomes registrados na rodada, com verificação de label;
não executa prune ou limpeza global. Falha de limpeza é reportada. Recursos
anteriores, dados de aplicações e checkout remoto ficam intactos.

## Alternativas inicialmente revisáveis e próximos critérios

As alternativas abaixo foram registradas na prova inicial. A RFC 069/ADR 092
posterior selecionou e implementou os patches descritos acima somente para
prova isolada; a integração operacional real segue pendente:

1. **Origem:** capturar binding imutável linha/conta/geração no socket ou antes
   da fila e autenticá-lo até cada tentativa HTTP. O binding não pode ser
   reconstruído a partir da geração atual no despacho. Alternativa: instância
   privada imutável por geração, com conta CRM estável, invalidação/isolamento
   integral da anterior e retenção abrangente. Exige revisão de lifecycle,
   continuidade da sessão, capacidade e recuperação antes de adoção.
2. **Persistência n8n:** impedir que o dado secreto componha o payload inicial
   persistido, antes do primeiro nó do workflow, com autenticação preservada.
   Uma alteração suportada/revisada no ingresso ou runtime n8n precisa de nova
   prova com banco e backups reais. Um Code de limpeza posterior, expurgo,
   criptografia do backup ou flags save* isoladas não atendem ausência.
   n8n permanece obrigatório; browser direto ao gateway é recusado.
3. **Mobile:** somente homologação explicitamente autorizada com aparelho real
   prova uso no mesmo celular. Até lá, mostrar limitação e manter cadastro e
   operações comerciais locais disponíveis; não habilitar conexão pessoal.

Novo ensaio de ingresso deve reter evento antes do reconnect, revogar o token
antigo e liberá-lo depois: rejeitar ou registrar a geração antiga, sem ativar a
atual. Cobrir token ausente/arbitrário, conta/linha erradas, retry já em voo e
ator revogado. Não alterar a identidade de efeitos iniciados. O teste focal
registra a limitação atual do wrapper, sem apresentá-la como aceite de ingresso.

Rollback desta entrega: remover os utilitários de prova; nenhum schema/dado
comercial requer down. Manter controle/inbound/envio pessoal desligados.
Não apagar ledger/ACL/histórico, restaurar desafio ou repetir efeito incerto.

## Evidência da rodada inicial (a1e8b761)

O [relatório sanitizado](../../ops/evolution/wap-provider-spike.evidence.json)
registra a rodada completa. SHA-256 do arquivo formatado:
`d673fb2074110b65c6a5b52605d13fb8dcb9673571fcecad4eb382a67c48d1db`.
Imagem local resultante do wrapper:
`sha256:15a21472d57a54710874a8da6521546b8bd50896792ef2b707ea101eaa4c91f7`.
Essa imagem foi removida ao final; não foi publicada em registry.
n8n 2.38.7 foi fixado pelo digest registrado no JSON.

| Cenário                                        | Resultado observado                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duas instâncias sintéticas                     | Create 201, estado inicial close, connect 200, estado connecting, logout 200 em ambas. Uma retorna QR, outra QR+código; nenhuma chega a open ou tem identidade pareada.                                 |
| Autenticação/guardas                           | Sem chave no gateway 401; sem header no webhook n8n 403. Ator fora da allowlist e geração sintética obsoleta não chegam à fixture. Isso não comprova a geração do provider.                             |
| Entrega síncrona                               | QR e código reais do gateway passam por n8n, retornam sem cache. Dois canários adicionais exercitam o mesmo caminho sem depender de disponibilidade do WhatsApp.                                        |
| Sucesso, erro após obter desafio, em progresso | Nenhum QR/código/canário encontrado no dump, logs ou volume n8n. Token do header encontrado em execution_data e backup lógico em todos esses checkpoints. Gate reprovado.                               |
| Manual real                                    | Disparado pela API manual n8n e confirmado pelo evento n8n.workflow.success com isManual=true. Nenhum canário manual encontrado. O dump cumulativo ainda contém token dos ingressos webhook anteriores. |
| pinData/error workflow                         | pinData vazio nos dois workflows exportados; sem error workflow. Settings none/false conferidos na configuração efetivamente salva. Não se simulou pinagem deliberada de segredo.                       |
| Snapshots/backups                              | Volume n8n sem canário/token, durante execução e após parada. Dump lógico e arquivos físicos do PostgreSQL/WAL após parada limpa contêm token em claro. Não é prova de restore.                         |
| Logs                                           | stdout+stderr de n8n/provider sem desafio/token nos scans. No JSON, o campo histórico stdout agrega os dois streams do docker logs.                                                                     |
| Limpeza                                        | Todos os containers, volumes, rede e tag próprios removidos. Listagens por label retornaram vazias. Nenhum recurso anterior foi removido.                                                               |

Os scans são cumulativos e negativos para os desafios; presença do token em
um checkpoint posterior não atribui uma nova gravação à execução manual.
A causa foi também confirmada diretamente no código instalado da imagem n8n:
Webhook.node.js:262–267 inclui req.headers, webhook-helpers.js:276–289 o põe na
pilha inicial, active-executions.js:43–66 e execution-persistence.js:43–73
persistem antes dos nós. execution-data/db-store.js:25–28 grava execution_data.
execution-lifecycle-hooks.js:424–439 e execution-persistence.js:333–340 aplicam
soft delete posterior, mantendo o registro inicial. Status inicial running
nesse registro não significa execução ainda ativa; por isso o teste manual
exige o evento real de sucesso, sem habilitar persistência para facilitar o teste.

O script terminou com **exit 1 / WAP_PRIVACY_PERSISTENCE_DETECTED**, após
completar a matriz e limpar os recursos. Não se removeu token dos scans nem se
habilitou expurgo para obter resultado verde. Rodadas exploratórias também
observaram resposta connect 200/connecting ainda sem desafio no retorno após o
delay fixo upstream; não houve nova chamada connect para forçar disponibilidade.
Essa intermitência impede prometer que HTTP 200 já entrega desafio válido.

Verificação do patch:

- `node --test test/n8n-evolution-workflow.test.js`: 26 aprovados, zero skips.
- `node --test ops/evolution/profile.test.mjs`: 9 aprovados, zero skips.
- `npm run validate`: 2.836 testes, 2.783 aprovados, 53 skips condicionais
  existentes, zero falhas; formatação, tipos, lint, fronteiras e build passaram.
  Não há migração nem lógica transacional nova nesta entrega.
- `npm audit --audit-level=high`: zero vulnerabilidades.
- `npm run test:e2e -- --workers=2 --retries=2`: 1.057 aprovados, sete skips
  legados, zero falhas e nenhum retry consumido (13,7 minutos).

Gates integrais no Mel usaram snapshot isolado sem a alteração alheia de
index.html, Node 24.20.0/npm 11.19.0 e a imagem Playwright fixada no
[runbook de áudio Linux](playwright-audio-local.md), com PulseAudio sintético.
O checkout Windows e a correção Criar pedido não foram modificados pelos gates.
Revisão independente de Integrações/QA verificou origem/geração, scanner,
streams de log, cleanup e interpretação das flags n8n; seus achados foram
incorporados. A investigação não homologa produção ou privacidade operacional.

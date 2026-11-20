# Controle pessoal de WhatsApp — WAP-E02

WAP-T01-02/03/04; WAP-01/02/03/04/10/11/12; ADRs 090/091/092.
Esta entrega prepara backend, worker e geradores de workflows **inativos**.
Não homologa o provedor, código no mesmo celular, retenção operacional de várias
instâncias, capacidade ou produção. E01 mantém esses gates abertos.

## Contrato e configuração

Contrato HTTP em [OpenAPI](../api/openapi.v1.yaml) e
[schemas estritos](../../schemas/seller-whatsapp-control.v1.json).
Sessão humana, origem permitida, CSRF e capacidade são revalidados nos comandos;
Basic em rota humana é recusado. O titular vem da sessão, nunca do corpo.
As rotas usam o limite vigente de 60 requisições/minuto e corpo de até 8 KiB;
a exclusão transacional limita a uma operação mutante não resolvida por linha.
GET só lê, inclusive com controle desligado quando as chaves estão disponíveis.
Admin não recebe desafio de outro titular. Não há nova permissão comercial.

Todas as respostas usam `private, no-store` e `no-referrer`. QR/código só voltam
pela resposta síncrona ao titular atual. Nunca colocar resposta em armazenamento
do navegador, telemetria, log, job ou replay. Se a resposta se perder, consultar
o estado; repetir a chave não recupera nem regenera bytes. Renovar requer outro
comando com versão atual e `renewChallengeId`, depois da reconciliação por leitura.
Expirar o TTL não resolve uma operação incerta.

O GET do titular traz `challenge` (ou `null`): só id, estado e expiração do
último desafio da geração atual, sem bytes. Uma aba recarregada usa esse id como
`renewChallengeId` quando o estado é `resolved`; antes disso a renovação continua
409 e a tela mostra "Aguardando confirmação do desafio anterior" até a leitura
do worker ou do sweep resolver o desafio. `stream.reset` do SSE só provoca nova
leitura: o desafio na tela some apenas por mudança de linha, geração, operação
ou estado, TTL, aba oculta ou troca de identidade.

Em Conta → Meu WhatsApp (WAP-03/E12), alternar para outro aplicativo
oculta o desafio. Se o vendedor já pediu conexão ou desconexão, a tela
aguarda a resposta do comando, inclusive se uma consulta de estado ainda
mostrar a situação anterior. Ao retornar, acompanhe o estado na mesma tela.

Configuração de servidor, **sem valores reais neste documento**:

| Variável                                                        | Uso                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELLER_WHATSAPP_CONTROL_ENABLED`                               | `false` por omissão; somente `true`/`false`                                                                                                                      |
| `SELLER_WHATSAPP_SELLER_IDS`                                    | JSON com IDs privados explícitos de titulares autorizados                                                                                                        |
| `CONTACT_IDENTITY_ENVELOPE_KEY` / `CONTACT_IDENTITY_LOOKUP_KEY` | Chaves existentes de 32 bytes em Base64; envelopes e digest chaveado                                                                                             |
| `SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST`                         | Digest da linha geral pelo helper existente `contactPhoneHash`, número normalizado sem `+`; registro compartilha unicidade com linhas pessoais                   |
| `N8N_WAP_CONTROL_URL` / `N8N_WAP_CHALLENGE_URL`                 | Webhooks HTTPS privados `/webhook/silmer/seller-whatsapp/control` e `/challenge`                                                                                 |
| `N8N_WAP_CLIENT_ID` / `N8N_WAP_CLIENT_SECRET`                   | Basic próprio do controle WAP, API/worker → webhooks control/challenge; segredo de 32 a 1024 caracteres. Não reaproveita `N8N_COMMAND_CLIENT_*` do panel-command |
| `SELLER_WHATSAPP_WEBHOOK_URL`                                   | URL HTTPS privada do ingresso pessoal n8n, derivada no servidor                                                                                                  |

O perfil n8n exige o patch pré-persistência de E01, flags de não salvar sucesso,
erro, manual ou progresso e `pinData` vazio; sem error workflow. A allowlist de
paths inclui control/challenge/event e o verificador autoritativo CRM. O perfil
Evolution exige os patches fixados e seu hook de controle default off, allowlist
de instâncias opacas e webhook privado exato. Geradores compartilhados não
incluem número/segredo e não publicam workflows por vendedor. Configurar ambos
os perfis conforme seus módulos, sem alterar ambientes reais nesta entrega.

No n8n, configurar `SILMER_WAP_INGRESS_ENABLED`, `SILMER_WAP_INGRESS_PATHS`,
`SILMER_WAP_INGRESS_INSTANCES`, `SILMER_WAP_CONTROL_VERIFY_URL` (CRM `/verify`),
`SILMER_WAP_INGRESS_VERIFY_URL` (CRM `/ingress/verify`) e
`SILMER_WAP_INGRESS_VERIFY_BASIC`. Na Evolution, o hook privado exige
`SILMER_WAP_CONTROL_ENABLED`, `SILMER_WAP_GENERATION_ENABLED`,
`SILMER_WAP_GENERATION_INSTANCES` e `SILMER_WAP_CONTROL_WEBHOOK_URL`.
São opt-ins separados e inicialmente desligados. `SILMER_WAP_INGRESS_SYNTHETIC`
e o destino HTTP fixo da fixture pertencem apenas ao runner descartável.

O técnico usa `AUTOMATION_EXECUTOR` por Basic, `X-Correlation-Id`,
`Idempotency-Key`, `X-Silmer-Execution-Id` e identidade de workflow
`seller-whatsapp-control` / `1.0`. Correlação é o operationId; chave é operationId
para controle, challengeId para desafio e resultId para resultado. No verificador
de ingresso, correlação/chave derivam do bindingId. O verificador anterior ao
primeiro SQL só devolve metadados canônicos já comparados ao ledger; não reserva
efeito. Reserva técnica em `/operations` precede HTTP do gateway. O resultId é
emitido pelo servidor e vinculado ao despacho/execução. Callback com mesmo ID
e corpo diferente conflita.

## Lifecycle e recuperação

1. Migração expand `0077` cria linha/conta/instância estáveis, reservas de número,
   bindings imutáveis, ledger, desafios só com metadados e vínculos da outbox.
   Número cifrado com AAD e digest chaveado; desconectar não libera titularidade.
   Nenhum backfill de clientes, conversa, carteira, Pedido ou snapshot.
2. Connect persiste intenção e job de metadados; worker → n8n prepara instância
   sem QR e configura/confere webhook. Isso deixa `awaiting_pairing`, nunca ativo.
   A instância nasce com `groupsIgnore=true` e sem leitura automática, status,
   histórico completo, presença ou rejeição de chamadas. Todo connect, inclusive
   o reuso de instância `close`, reaplica esses ajustes por `/settings/set` e
   os confere por `/settings/find` antes do webhook; divergência termina em
   `WAP_CONTROL_UNKNOWN` sem habilitar o webhook. O webhook só é
   aceito com exatamente `CONNECTION_UPDATE`, `MESSAGES_UPSERT` e
   `MESSAGES_UPDATE` (`byEvents=false`, `base64=false`); lista antiga só com
   `CONNECTION_UPDATE`, lista maior ou repetida deixa `webhookVerified=false`.
   Filtros na fonte e eco/recibos: runbook do provider, "Eventos pessoais".
   Instância criada antes do WAP-E12 mantém a lista antiga e as configurações
   antigas até um novo connect (que reaplica webhook e configurações); até lá
   a reconciliação dela termina em `blocked`, porque ajustes divergentes também
   retiram `webhookVerified`. Os grupos continuam
   barrados na fonte pelo runtime de geração.
3. Desafio explícito reserva uso único, instala binding do socket e chama connect
   upstream uma vez. A resposta só sai após revalidar sessão, titular, geração e
   TTL. O binding captura source/token antes da fila; retry não reclassifica evento.
   A tela orienta o pareamento em Aparelhos conectados, indica que o desafio
   está sendo gerado e informa quando ele expira para o titular solicitar outro.
4. Só leitura posterior que comprova número esperado, estado `open`, webhook
   autorizado e binding realmente capturado no socket da geração atual pode
   marcar `connected`. Um socket antigo aberto ou binding apenas preparado não
   comprovam conexão. Número divergente ou prova incompleta
   bloqueia. Nenhum pedido/envio/IA é disparado ao conectar.
   Se o socket abrir antes de devolver QR ou código, a resposta do desafio
   fica incerta. A leitura posterior ainda pode concluir o desafio da mesma
   operação quando comprovar `open`, o número exato, o webhook e o binding.
   Após o vínculo no aparelho, o Baileys pede uma reinicialização `515`.
   O callback do socket atual pode continuar uma única vez na mesma geração,
   após salvar as credenciais, e o novo socket precisa capturar o binding.
   Durante essa troca, a leitura de `close` conserva `awaiting_pairing`
   até o resultado do novo socket. Um callback antigo não recebe a geração
   seguinte e qualquer reparação após reinício do processo exige comando
   explícito. [Sequência de vínculo no Baileys](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/socket.ts).
5. Timeout, resposta ambígua ou queda depois do fence mantêm incerteza. Worker e
   sweep recuperam por `reconcile`, que só lê estado/identidade/webhook/ajustes. Não
   reiniciar/apagar instância, repetir create/logout/connect ou consumir revisão
   inbound. Reconciliação antiga não supera observação mais recente.
   O sweep também verifica o socket das linhas conectadas da lista piloto a
   cada dois minutos, com prioridade para a recuperação de operações pendentes.
   Uma nova prova `open` mantém a versão da linha e o `verified_at`, que delimita
   o início da recepção. Um `close` confirmado desconecta a linha e revoga seu
   binding, permitindo ao titular iniciar outra geração.
   No boot do Evolution, uma instância allowlisted com status persistido
   `connecting` ou `open` é carregada em memória sem iniciar um socket. O
   binding da geração precisa ser instalado novamente pelo desafio autorizado.
   A reconexão exige `connectionState` explicitamente `close` antes de
   reaplicar e conferir os ajustes e o webhook. O desafio autorizado instala
   a prova de geração antes de criar o socket. Se a instância ainda não
   estiver carregada, a reconciliação pode devolver `close` para a leitura
   sem titular, mas o comando de conexão para antes das escritas. Leituras
   incompletas de instâncias com titular ou marcadas como `open` mantêm a
   operação incerta. [Carregamento no Evolution 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/services/monitor.service.ts#L250-L282).
6. Desconectar/inativar revoga geração/desafios e impede novo despacho. Efeito
   iniciado conserva seu recibo antigo; não reabre acesso. Logout que depende
   de efeito incerto aguarda reconciliação, com revogação local imediata.

E02 permanece desligado até a cadeia pessoal estar completa. O processamento
dos eventos de conexão/mensagens e a atualização após queda espontânea são E04;
reserva/despacho comercial são E08. A prova de controle isolada não autoriza
habilitar ingresso ou envio de produto.

## Verificação sintética e rollback

Executar testes de banco com `TEST_DATABASE_URL` dedicado a `crm_silmer_test`;
a suíte recusa outro nome antes de resetar schemas. Não exportar corpos de
requisição/resposta, dumps, WAL, screenshots de desafio ou segredos como evidência.
Registrar somente nomes de cenários, contagens, booleans e códigos fixos.

```sh
npm run test:database
node --test --test-concurrency=1 test/seller-whatsapp-postgres-live.test.js
node --test --test-concurrency=1 test/seller-whatsapp-control-postgres-live.test.js
node --test test/seller-whatsapp-routes.test.js test/wap-control-integration.test.js test/wap-n8n-ingress.test.js test/wap-evolution-generation.test.js
node --test test/n8n-evolution-workflow.test.js test/n8n-command-worker.test.js
node ops/n8n/whatsapp-control-rehearsal.mjs --isolated-synthetic
```

Antes do push, executar uma vez `npm run validate`, `npm run test:e2e` e
`npm audit --audit-level=high` no runtime de CONTRIBUTING; suites focalizadas
continuam durante o patch. Evidências finais são registradas abaixo e em tasks.

Rollback: desligar controle e ingresso pessoal antes de remover componentes de
runtime. Preservar migração expand, ACL, número reservado, bindings revogados,
ledger e resultado incerto. Nunca fazer down destrutivo, reativar geração antiga
ou restaurar desafio. Restore inicia com efeitos bloqueados e exige leitura do
provedor antes de novo comando. Linha geral e suas reservas continuam intactas.

## Evidência da entrega

Executado em 16/11/2026, a partir da master `7d032732`, em snapshot isolado no
host de desenvolvimento Mel. Node `24.20.0`, npm `11.19.0`; PostgreSQL 17
sintético em container/rede dedicados, sem portas publicadas. O checkout alheio,
serviços existentes e a correção Criar pedido de `d7537b3c` foram preservados.

- `npm run test:database`: 15 aprovados, zero skips.
- Duas suítes PostgreSQL novas: 22 aprovados, zero skips. Upgrade desde 0076,
  unicidade/duas transações, CAS, idempotência, callbacks fora de ordem,
  inativação/reativação, revogação e desafio incerto. A composição percorre
  API real → outbox/claim → worker/client → Code gerado do n8n → adapter real
  Evolution, com endpoints upstream sintéticos; inclui desconexão enquanto o
  desafio ainda está em voo e apenas um logout após reconciliação.
- Regressão PostgreSQL compartilhada de fila/identidade/Inbox/migrações:
  20 aprovados, zero skips; execução serial no mesmo banco sintético dedicado.
- Seis suítes focalizadas de rotas/worker/workflow/geração/ingresso: 74 aprovados,
  zero skips. No Windows sandbox, um teste legado de HTTP local classificou
  falha de rede antes do timeout; a execução no runtime Linux fixado passou,
  preservando a assertion de timeout e sem modificar esse teste.
- [Relatório do n8n real](../../ops/n8n/whatsapp-control.evidence.json):
  `technicalGate=passed`, `privacyFailures=[]`, recursos próprios removidos.
  Os campos de scan `false` significam **nenhum canário encontrado**. Incluem
  banco/dump, stdout/stderr, estado/snapshot, arquivos físicos PostgreSQL/WAL
  após parada limpa; sucesso, erro após obter bytes, progresso e manual real.
  Replay/IDs forjados/auth ausente são recusados antes de persistir execução;
  manual parcial, pinData e boot sem flag também são cercados. A fixture usa
  os adapters reais de controle/geração, com source capturado no socket.

O scan físico não prova decodificação de todo formato comprimido nem restore
operacional. Nenhum dump, log bruto, token ou desafio integra o relatório.
As rodadas preparatórias corrigiram o teste de status nativo Basic (401,
mantendo recusa antes de execução) e o escape do helper de inspeção manual;
nenhuma proteção de privacidade foi removida para passar o ensaio.

`npm run validate` foi aprovado: 2.901 testes, 2.846 aprovados, 55 skips
condicionais (53 existentes e as duas suítes novas que exigem banco dedicado),
zero falhas; formatação, tipos, lint, fronteiras e build aprovados. O build mantém
o aviso existente de chunk maior que 500 kB. As suítes WAP de PostgreSQL foram
executadas separadamente, sem skips, conforme os 22 casos acima.

A primeira rodada de validate encontrou somente a lista esperada do teste de
ações técnicas anterior às três ações WAP; a lista explícita foi atualizada
mantendo igualdade exata e negações. O gate foi repetido por essa falha concreta.
`npm run test:e2e -- --workers=4 --retries=2`: 1.061 aprovados, sete skips
legados, zero falhas e zero retries consumidos (9,7 minutos), incluindo áudio
sintético nativo Chromium/Firefox, teclado/foco, mobile e axe existentes.
`npm audit --audit-level=high`: zero vulnerabilidades.

O worker declara a dependência interna já existente `inbox-channels` no seu
manifest e lock; nenhuma dependência externa foi acrescentada. As duas suítes
novas foram incluídas no job PostgreSQL existente do CI. Testes focais de
pipeline/imagens/escopo de dependência no runtime Linux: 30 aprovados, zero skips.
Perfil/Dockerfile Evolution (`node --test ops/evolution/profile.test.mjs`):
nove aprovados, zero skips; recipe inline e fonte conferidos.
Os mesmos scripts Bash não iniciaram no sandbox Windows (status 3221225794);
nenhuma assertion foi alterada, e a execução Linux fixada passou integralmente.
Após o ajuste de empacotamento: `npm ci`, 22 testes focais de bootstrap/build,
composição do worker e rotas, `npm run check:boundaries` e nova auditoria foram
aprovados no mesmo runtime fixado; zero skips/falhas/vulnerabilidades. Nenhum
código de runtime mudou depois do gate completo; apenas declaração interna,
inclusão dos testes no CI e documentação/evidência.

Sem publicação, pareamento, flags reais, mensagens a clientes ou efeitos
financeiros reais. Containers, rede e diretório temporário de validação foram
removidos após conferir ownership; listagens por label ficaram vazias. O runner
também removeu seus containers/volumes/rede/imagem próprios. Nenhum recurso
preexistente foi alterado. A alteração alheia de index.html fica no patch externo
`C:/Users/sutil/AppData/Local/Temp/crm-silmer-wap-e02-index-20261116.patch`
(SHA-256 `033fa180ed8450aa218f428a9e4d38b145666b9b426036cffcb7d978087dfb75`).

## Correção de CI — PR 395

O primeiro CI de `4a267d7d` aprovou estática/E2E e encontrou uma falha em
`olist-upgrade-compat-postgres-live`: a linha SQL sintética usada para avaliar
os predicados não tinha os campos WAP acrescentados à outbox. A fixture agora
inclui `whatsapp_operation_id`, `whatsapp_action` e `max_attempts` (inteiro),
mantendo todas as comparações anteriores de compatibilidade e restrição.

Os novos negativos também expuseram a semântica de `CHECK(NULL)` do PostgreSQL:
sem um guard explícito, uma ação WAP nula podia passar pela constraint.
A expand 0077, ainda não integrada ou aplicada em ambiente real, exige agora
`whatsapp_action IS NOT NULL` na fronteira pessoal. INSERTs reais dos dois tipos
de job sem ação devem falhar com `23514/outbox_jobs_target_check`. A matriz
também verifica alvos misturados, fila/política incorretas e tentativa mutante
com mais de uma execução, sem retirar ou relaxar nenhuma assertion anterior.

Reprodução e validação em PostgreSQL 17 dedicado, Node 24.20.0/npm 11.19.0:
o teste original reproduziu o erro de coluna; a fixture ampliada expôs o NULL;
após o guard, as três suítes focalizadas passaram em 28 testes, zero skips.
Formatação, tipos, lint e diff-check focais aprovados. A execução integral do
job PostgreSQL também revelou a lista explícita de migrações do teste de
upgrade de cobrança terminando em 0076. Acrescentou-se 0077 à igualdade exata,
preservando as verificações de checksums e jobs anteriores; o caso isolado
passou sem skips. As etapas anteriores da cadeia passaram integralmente;
somente o bloco final afetado foi repetido após essa correção: 308 aprovados,
zero falhas/skips. O novo CI do PR será acompanhado até concluir, sem merge e
sem efeitos em ambiente real.

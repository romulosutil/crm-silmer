# Revisão independente — integração da master

Data: 10/10/2026. Escopo: `origin/master` em `b7b26db` integrado à branch
de mídia do Inbox. Rastreabilidade: MERGE-MASTER, INBOX-MEDIA-1/MED-01..32,
T27/T28 e contratos de arte, públicos, chat do site e loja das ADRs 023–028.

## Evidência adicional do teste pela tela

Adendo do Tech Lead após o relatório independente: imagem, áudio e vídeo
foram anexados e enviados pela interface local com workflow DEV 15. Os três
comandos, mensagens e entregas terminaram `sent`, com mídia `attached`,
job concluído em uma tentativa, erro nulo e reserva única. O agente
n8n conferiu esses resultados por SELECT restrito, sem ler payloads.
O navegador confirmou o badge DEV e o retorno ao composer sem anexo pendente.
Provas: `var/merge-master-browser-proof.json` e
`var/merge-n8n-standard-browser-send-proof.json`. Este adendo não altera
o limite de independência ou o escopo do parecer abaixo.

O Tech Lead repetiu a suíte geral após o ajuste final de versão: novamente
978/981 aprovados, zero falhas e três skips existentes. Os 13 checks e o build
também passaram novamente sobre a fonte final, nos mesmos logs integrados.

## Independência e limite

O verificador não escreveu os patches de código, contratos OpenAPI, workflow
n8n, migrations, reconciliação DEV ou renumeração de ADR/RFC aqui revisados.
Participou da resolução dos onze documentos canônicos e Dockerfile; essa
parte não é apresentada como verificação independente de seu próprio trabalho.
Não modifica código, SQL, configurações, dados ou testes durante a revisão.

Esta revisão não homologa microfone físico, Meta/WhatsApp, EasyPanel ou RustFS
remoto. T24 e privacidade de produção n8n permanecem gates próprios. Não há
declaração global de requisitos `Verified`.

## Evidência executada

O script independente `var/review-master-merge-static.mjs` terminou com exit
0 e registrou `var/review-master-merge-static.json`:

- Os quatro SQL de mídia renumerados para 0030–0033 são byte a byte iguais
  aos SQL da branch, antes do merge.
- Os três SQL da master 0027–0029 são byte a byte iguais à master.
- A ADR original em `docs/adr/history/023-midia-do-chat-no-rustfs.md` é byte a
  byte igual à decisão da branch antes do merge. A ADR 029 supersede a
  numeração em colisão e mantém storage/retenção; RFC 017 tem vínculo novo.
- OpenAPI tem 40 caminhos, sem perda na união dos 35 caminhos da branch com
  os 36 da master. Inclui mídia humana, leitura técnica reservada, arquivos
  do pedido e registro n8n do pedido pago da loja.
- Workflows canonical/DEV/local têm 84/91/91 nós, nomes únicos e nenhuma
  conexão com origem ou destino inexistente.

## Revisão de contratos e guardas

`apps/api/src/server.js` conserva a composição dos runtimes de pedidos,
loja, n8n, operação e chat. Configuração `OBJECT_STORAGE_*` dos arquivos do
pedido é separada de `MEDIA_S3_*` da mídia do Inbox. Leitura de conversa,
sessão, spool distinto, envelopes e flags de habilitação do chat continuam
nas fronteiras existentes.

`store-order-routes.js` usa autorização técnica compartilhada com identidade
de workflow/correlação/Basic e ação específica `store.order.record`; o limite
de corpo e rate limit da loja ficam no escopo da rota. A master conserva o
domínio de públicos, impressão v6, pedidos de loja travados e confirmação
após pagamento InfinitePay. `chat_media` permanece distinta de
`transient_media`, cuja destinação de handoff acompanha a migration da master.

`reconcile-chat-media-dev-ledger.mjs` exige host local, nome de banco DEV
dedicado, ausência de parâmetros de transporte, nome/fase/checksum aprovados
e destinos desocupados. A sequência move 0030 primeiro e 0027 por último,
evitando colisão intermediária. A transação usa lock e prova que somente as
versões do ledger mudaram; não refaz SQL nem apaga mídia. Isso é reparo DEV
explícito, não protocolo de migration de produção.

## Achados

Uma referência vigente no design citava 0029 para admissions. Foi comunicada
ao autor e corrigida para 0032. Numeração antiga em execução histórica não
foi tratada como contrato vigente. Não há finding funcional bloqueante no
escopo estático revisado até esta etapa.

## Sensor de discriminação

`var/review-master-merge-sensor.mjs` executou os testes do planner em cópia
isolada, sem banco, Docker ou mutação do checkout real. Baseline: **4/4 PASS**.
As quatro falhas deliberadas foram detectadas por assertions, com exit 1:

| Falha injetada                           | Assertion que discriminou                                                                   | Falhas |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| Aceitar host remoto                      | `test/chat-media-dev-ledger.test.js:91`: `assert.throws(() => assertLocalDevDatabase(url))` | 1      |
| Ignorar checksum                         | `test/chat-media-dev-ledger.test.js:34` e `:70`: `assert.throws` sobre histórico divergente | 2      |
| Aceitar destino ocupado                  | `test/chat-media-dev-ledger.test.js:43`: `assert.throws` sobre versão 0031 ocupada          | 1      |
| Aceitar override de transporte por query | `test/chat-media-dev-ledger.test.js:91`: `assert.throws(() => assertLocalDevDatabase(url))` | 1      |

Cada falha resultou em `Missing expected exception`, não erro de importação,
sintaxe ou timeout. Hashes SHA-256 de source e teste reais são idênticos antes
e depois; prova em `var/review-master-merge-sensor.json`. O source isolado foi
restaurado ao conteúdo original depois do sensor. Nenhuma assertion original
foi removida, enfraquecida ou pulada.

## Gate

Revisão independente dos contratos e do reparo DEV: **PASS no escopo
revisado**, com sensor **4/4** e isolamento confirmado. Gates completos de
build, SQL integrado, suíte unitária e UI foram executados pela equipe de
integração e seus resultados foram lidos pelo verificador, conforme abaixo.

## Evidências da equipe de integração

Estas execuções não são atribuídas ao verificador independente. Os resultados
finais foram conferidos nos logs da integração, sem alterar assertions:

| Gate                            | Resultado observado                                | Evidência                            |
| ------------------------------- | -------------------------------------------------- | ------------------------------------ |
| Treze checks do projeto e build | PASS, exit 0                                       | `var/merge-master-project-gates.log` |
| Suíte unitária completa         | 981 testes, 978 PASS, 0 falhas, 3 skips existentes | `var/merge-master-unit.log`          |
| PostgreSQL integrado            | 174 PASS, 0 falhas, 0 skips                        | `var/merge-master-sql-live.log`      |
| UI integrada                    | 217 testes, 210 PASS, 0 falhas, 7 skips existentes | `var/merge-master-ui.log`            |

O Tech Lead informou atualização local de API/worker construídos, com saúde
positiva e preservação de dados, variáveis e mounts. Este relato não é prova
operacional remota nem teste de browser executado pelo verificador.

### Ajuste final de proveniência DEV

O teste pela tela do Tech Lead encontrou um sufixo de versão introduzido na
integração que impedia classificar corretamente o envio como DEV. A revisão
independente confirmou o ajuste final no SDK (`mvp-simple-14`), gerador DEV e
ambos snapshots (`dev-mvp-simple-15`). O classificador T16 no repositório
PostgreSQL continua estrito, `^dev-mvp-simple-\d+$`, sem ampliar a expressão
para aceitar versões fora do contrato. O teste em
`test/n8n-dev-workflow.test.js:121` trava a versão exata; em `:123` trava o
formato reconhecido pelo classificador.

Depois desse ajuste, o verificador reexecutou os checks estáticos, o sensor
leve em cópia isolada e `var/merge-n8n-parity.mjs`: PASS, sem alteração de
arquivos reais. A paridade compara SDK com nós/conexões canonical e compara
integralmente ambos snapshots DEV/local com o gerador determinístico.

O log da equipe `var/merge-n8n-standard-focal.log` registra **66/66 PASS**, 0
falhas e 0 skips, após a correção de versão. A prova
`var/merge-n8n-local-update-proof.json` registra importação local dos 91 nós,
preservação dos 91 IDs, paridade integral, publicação, saúde, webhook do
painel estável e efeitos Meta do vendedor simulados. Também registra que
OpenAI/Graph externos não foram chamados e que a credencial para transcrição
inbound não está configurada nesse runtime local. Não atribuir à suíte
completa anterior uma execução posterior ao ajuste final de versão.

Novos envios reais pela tela ainda não foram recebidos como evidência nesta
revisão.

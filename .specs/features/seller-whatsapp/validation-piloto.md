# Piloto da etapa 1 — WAP-E12

WAP-T05-05, WAP-T05-06 e WAP-T05-07, 18/11/2026, branch cumulativo
`codex/wap-e05` (PR única
[romulosutil/crm-silmer#398](https://github.com/romulosutil/crm-silmer/pull/398)),
a partir do E11 `12b4c101`. [Spec](spec.md), [design §10](design.md),
[tasks](tasks.md), [roteiro do piloto](../../../docs/runbooks/seller-whatsapp.md#roteiro-do-piloto-wap-e12),
[prontidão](validation-etapa1.md) e ADRs 090/091.

## Estado

**E12 parcial.** A preparação e o ensaio local integrado estão concluídos.
A homologação real **não foi executada**. Nenhum gate live está aprovado, e
nenhum item T05-05/06/07 está concluído.

As duas evidências ficam separadas:

- **Local:** sintética, com PostgreSQL dedicado e transporte simulado. Ela prova
  o encadeamento do roteiro no código deste branch.
- **Live:** exige ambiente real, imagens publicadas e autorização. Ela é a
  única que fecha o aceite.

## Autorização operacional

Antes do primeiro efeito real, conferimos a autorização vigente. Nenhuma fonte
autoriza o piloto pessoal:

- A spec, o design §10 e o ADR 090 dizem que a documentação não autoriza
  publicação, pareamento real, mensagem a cliente nem efeito financeiro.
- O "piloto autorizado" do ADR 043 trata da linha geral WAHA e não se aplica aqui.
- Nenhuma instrução do proprietário nesta etapa cobre publicar imagens, parear
  números, enviar mensagens ou cobrar.

Por isso, nada foi publicado, pareado, enviado ou cobrado. Nenhuma flag foi
ligada em ambiente real.

## Publicação (18/11/2026)

A PR 398 foi mesclada por rebase na master (`1489c2fe`, conferido no GitHub)
e o branch `codex/wap-e05` foi apagado. A sessão "Seller WhatsApp prompts
conclusão" fez a publicação a pedido do proprietário e relatou:

- antes do merge, as expand `0080`, `0082` e `0083` foram aplicadas em produção
  pelo runner, com os arquivos do head `e5402ac3` (checksums conferidos);
- silmer-api, silmer-worker e silmer-edge-web foram implantados no SHA do merge;
  `/api/health/live` e `/ready` responderam 200; worker com heartbeat e filas
  com idade 0;
- a contract rodou pelo container novo e aplicou `0081`, mais `0012_remove_mfa`
  e `0018_remove_invitations`, pendentes desde setembro (tabelas sem uso). O
  backup anterior com essas tabelas é `pre-inbox-expand-0077-0079-2026-11-17`;
  o posterior, `post-wap-0080-0083-contract-0081-2026-11-18`;
- no smoke de leitura, Inbox, Pedidos, resumo e Contatos responderam 200, e
  `/me/clients` respondeu `503 SELLER_CLIENTS_DISABLED`: todas as flags
  pessoais seguem desligadas;
- o n8n de produção estava em `n8nio/n8n:2.43.7`, e o patch WAP estava travado
  por hash na 2.38.7. A PR 406 portou o patch para a 2.43.7 (master
  `0ade5f2f`, evidência `ops/evolution/wap-provider-spike.n8n-2.43.7.evidence.json`
  com `technicalGate` aprovado e `privacyFailures` vazio).

Imagens WAP em produção desde cerca de 22h10 de 18/11, com todas as flags WAP
desligadas (relato da mesma sessão):

- Evolution: o Dockerfile inline passou de `732d0fe2` (EVOL-01) para o da
  master (`ddc7a9a0`). O build imprimiu `WAP_EVOLUTION_GENERATION_PATCHED`. A
  linha geral seguiu `open`, e nenhuma `SILMER_WAP_*` está definida. O dump
  anterior ficou em `/tmp/pre-wap-evolution-2026-11-18.dump`, no container
  `silmer-evolution-db`, que é efêmero; esse banco não tinha backup configurado
  no EasyPanel.
- n8n: a fonte passou de imagem `n8nio/n8n:2.43.7` para um Dockerfile inline
  (base 2.43.7 por digest, com runtime e patch embutidos). O build imprimiu
  `WAP_N8N_INGRESS_PATCHED`, `healthz` e readiness responderam 200, e o
  workflow agendado rodou no container novo. O backup anterior é
  `pre-wap-ingress-n8n-2.43.7-20261118`. Rollback: voltar a fonte para a imagem
  `n8nio/n8n:2.43.7`. O Dockerfile inline do n8n ainda precisa ser versionado
  no repositório, como o do Evolution.
- Incidente fora do WAP: o merge do CP-T10 trouxe a expand `0084`, que não
  tinha sido aplicada. O boot guard barrou os deploys novos, e o container do
  `1489c2fe` serviu por cerca de 25 min, até a `0084` ser aplicada.
- Ainda não feito: workflows WAP no n8n, flags e allowlist (as imagens foram
  reconstruídas no passo 0, abaixo). A sequência está na
  [ativação em produção](../../../docs/runbooks/seller-whatsapp.md#ativação-em-produção-piloto-de-um-vendedor).
  Ela depende das respostas do PO: vendedores, visibilidade do Admin, F3 e
  cobrança.

**Integração real (19/11).** Ao preparar a instalação, três lacunas impediam o
piloto, todas corrigidas no branch `claude/wap-e12-live-wiring`:

- o Evolution só deixava sair `connection.update` das linhas pessoais; sem
  `messages.upsert` e `messages.update`, não havia entrada, eco nem recibo
  (`a3ee53f6`);
- o controle não alcançava o Evolution interno, que só responde por `http`; o
  Gateway exigia `https` (`1f222818`);
- não havia build de produção dos workflows a partir do principal vivo
  (`1f222818`, `ops/n8n/build-wap-production-workflows.mjs`).

Duas falhas de borda também foram corrigidas. A verificação do ingresso
pessoal dividia o limite técnico de 60/min, insuficiente para o tráfego de um
único IP do n8n; ela passou a ter 1200/min (`ac3b4087`). E o ingresso do n8n
transformava um `429` do CRM em `403` permanente, perdendo o evento; agora
devolve `503`, e o Evolution tenta de novo (`1f222818`). O ensaio local usava
stubs para o HTTP do Evolution e, por isso, não pegou nenhuma delas. Nada
disso foi executado em ambiente real.

A revisão adversarial do branch não achou P0. Foram corrigidos: retenção das
linhas pessoais no banco do Evolution (antes só a geral expirava), ajustes da
instância reaplicados e conferidos a cada conexão, integrações de saída do
Evolution travadas em `false` (`3c933542`); limite da verificação por linha,
com teto por IP, saída do build fora do repositório, prefixo exato das URLs do
ingresso, "mensagem para si mesmo" por LID ignorada e confirmação antecipada do
eco de mídia (`f991d551`). Ficam abertos, em P3: o evento de falha de imagem do
ingresso pessoal, provavelmente recusado em silêncio pelo CRM (anterior a este
branch), e "mensagem para si mesmo" por LID sem número alternativo. Eventos da
geração anterior que ainda estejam a caminho numa reconexão são recusados e não
voltam: perda aceita no piloto.

**Passo 0 da ativação (19/11, cerca de 00h50 BRT).** PR 411 mesclada
(`829e20e7`); API, worker e edge implantados nesse SHA, `/api/health/ready` 200. Com autorização do proprietário, nesta ordem:

- env do Evolution: 12 das 14 integrações de saída já estavam `false`;
  `NATS_ENABLED` e `PROVIDER_ENABLED` foram acrescentadas como `false`.
  `SENTRY_DSN` já estava vazio. Nenhuma `SILMER_WAP_*` definida;
- backups: `pg_dump` do `silmer-evolution-db` em
  `/var/lib/postgresql/data/pre-wap-e12-20261119.dump`, no volume de dados do
  banco (cerca de 396 KB, 217 entradas no índice), e backup manual
  `pre-wap-e12-live-wiring-20261119` do `n8n-db`, concluído;
- Evolution: o Dockerfile inline em produção era byte a byte o de `247cc9fb` e
  foi trocado pelo da master (`ops/evolution/Dockerfile.inline`, conferido por
  hash). O build imprimiu `WAP_EVOLUTION_GENERATION_PATCHED` e terminou com
  sucesso. O boot registrou `EVOLUTION_PROFILE_VALIDATED`, `DATABASE_READY` e
  `RETENTION_COMPLETED`; a linha geral voltou `open`. Rollback: o Dockerfile de
  `247cc9fb`;
- n8n: o Dockerfile inline em produção era o de `247cc9fb` e foi trocado pelo da
  master (`ops/n8n/wap-ingress-Dockerfile.inline`, conferido por hash). O build
  imprimiu `WAP_N8N_INGRESS_PATCHED` e terminou com sucesso. `healthz` e
  readiness 200; o webhook geral de eventos do Evolution segue roteado
  (sem credencial: `403`); o workflow agendado rodou com sucesso às 04:00:33Z, já
  no container novo. Rollback: o Dockerfile de `247cc9fb`.

Todas as flags WAP seguem desligadas.

**Passo 2, primeira tentativa (19/11), revertida.** O PO escolheu um vendedor
para o piloto (o ID fica só no env do EasyPanel). Foram acrescentados à API a
allowlist, o digest da linha geral (HMAC do número com a chave de lookup da
própria API, conferido no console), as três URLs do n8n e, como dizia o roteiro,
a credencial Basic do panel-command (`N8N_COMMAND_CLIENT_*`). O boot novo foi
recusado: esse segredo tem 13 caracteres, e o cliente de controle exige 32 ou
mais (`WHATSAPP_CONTROL_CONFIGURATION_INVALID`, reproduzido no console). O
EasyPanel manteve o container antigo; a tela do vendedor mostrava "A conexão
pessoal não está disponível". Nenhuma linha foi criada. O controle voltou para
`false`, a credencial copiada saiu, e um container novo subiu com esse env, para
não travar os próximos deploys. A allowlist, o digest e as URLs continuam no env,
inertes com o controle desligado.

Correção: o controle WAP passa a usar uma credencial própria
(`N8N_WAP_CLIENT_ID`/`N8N_WAP_CLIENT_SECRET`, segredo novo com 32 caracteres ou
mais) na API e no worker, sem tocar no panel-command da linha geral. O roteiro
agora manda conferir o container novo depois de cada reinício. Próximo passo:
implantar essa mudança e repetir o passo 2 com a credencial nova.

**Passo 2, segunda tentativa (19/11).** Com a PR 413 implantada, a credencial
WAP foi gerada no navegador (segredo aleatório de 64 caracteres, sem passar
pelo chat) e gravada no env da API e do worker; o controle foi ligado só na API.
O container novo subiu com a flag, `/api/health/ready` 200, e um usuário fora
da allowlist recebeu `403` ao tentar conectar. O worker segue sem
`SELLER_WHATSAPP_CONTROL_ENABLED`.

**Passos 3 e 4 (19/11).** O vendedor clicou "Conectar" uma vez; a tela mostra
"Preparando". O SQL somente leitura deu linha `preparing`, geração 1, operação
`connect` `pending` e job `whatsapp.control.deliver` `pending`; o ID da
linha e o nome da instância foram conferidos no banco, sem guardá-los em
documento.

**Passo 5 (19/11).** O export do principal vivo (144 nós, versão em edição igual
à publicada) mostrou que o normalizador do painel virou um nó Set, e o build
quebrava ao tentar o patch de envio mesmo sem linhas de envio. Corrigido: sem
`personalSendLineIds`, o build não produz `main-personal-send`, e um
normalizador que não seja nó Code é recusado com
`EVOLUTION_SEND_NODE_UNSUPPORTED`. Contra o export real, o build gerou o
inbound com 33 nós mantidos e 11 acrescentados (119 inalcançáveis e 3 gatilhos
removidos). Falta a credencial Basic do gatilho de controle no n8n, criada pelo
operador com o par `N8N_WAP_CLIENT_*`, para gerar a versão final.

Decisões do PO no mesmo dia:

- o piloto não precisa do Pedido passivo (cliente que procura primeiro); basta
  o cliente ser criado ou vinculado e ficar ligado à conversa, ao vendedor e
  ao Pedido;
- cada vendedor vê só as próprias conversas e as sem dono, e conversa da linha
  pessoal sempre tem dono. Pedidos de cliente da linha pessoal de outro vendedor
  não aparecem nas leituras de Pedido (F12). Implementado em `feb69b24`, depois
  do merge: lista, detalhe, busca, arquivos, cobrança, PDF, Olist, frete,
  Painel e comandos por id respondem conforme o leitor. O vendedor do pedido e
  o `COMMERCIAL_ADMIN` continuam vendo, e Pedidos da linha geral não mudam.

**Linha presa em `unknown` (19/11).** Depois de um reinício do Evolution, a
instância continuava em `fetchInstances` (`connecting`, sem titular), mas
`connectionState` respondia só com o nome da instância, sem `state`. O Gateway
recusava a leitura com `WAP_CONTROL_UNKNOWN`, nenhum resultado era gravado, e a
varredura reagendava o `reconcile` a cada minuto. Corrigido: instância sem
titular, sem socket em memória e não `open` é lida como `close`; a linha vai
para `disconnected` e o vendedor reconecta com geração nova. Titular presente
ou `open` continua incerto.

## Gates do piloto

O go/no-go está no [roteiro](../../../docs/runbooks/seller-whatsapp.md#gono-go-antes-do-primeiro-efeito-real).

| Gate                                                                  | Estado   | Bloqueio / dono                                                              |
| --------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| CI verde do HEAD da PR e merge linear                                 | feito    | PR 398 mesclada por rebase, master `1489c2fe`                                |
| SHA/digest, `/api/health/ready`, migrações `0077`–`0083`              | feito    | expand antes do merge, contract `0081` depois; health 200 (seção Publicação) |
| Imagens Evolution/n8n com patches WAP por digest                      | feito    | reconstruídas em 19/11 com a master `829e20e7` (passo 0); flags desligadas   |
| Código no mesmo celular (WAP-E01/T01-01)                              | pendente | aberto desde E01; sem ele não há autonomia mobile                            |
| Decisões F3 (trava pós-restore) e F4 (limite por usuário)             | pendente | Tech Lead/PO, [validation-etapa1](validation-etapa1.md#findings)             |
| Restore remoto, RPO/RTO e banco do n8n                                | pendente | DevOps, [recovery](../../../ops/recovery/RUNBOOK.md)                         |
| SHA de rollback, varredura de base dos logs, allowlist só no ambiente | pendente | DevOps/Privacidade, itens 7–9 do go/no-go                                    |
| Números dedicados, cliente sintético e janela                         | pendente | Operação                                                                     |
| Autorizações do PO, da Operação, da Privacidade e Financeira          | pendente | PO, Operação, Privacidade e Financeiro; cada uma por escrito                 |

## Ensaio local integrado

`test/integration/seller-whatsapp-pilot-rehearsal.test.js` executa o roteiro
inteiro como um único teste ordenado, com setup compartilhado. Ele roda contra
PostgreSQL 17.10 portátil em loopback, banco `crm_silmer_test_wap_e12`, com os
vendedores A e B na allowlist e C fora dela.

O que é real no ensaio:

- Passos humanos: `createServerApi` com sessão, Origin e CSRF reais. A ACL
  testada é a de produção.
- Passos n8n: rotas técnicas HTTP com a credencial Basic do executor.
- Pareamento: API → outbox → worker → cliente de controle → nós Code gerados do
  n8n → adapters reais de controle e geração do Evolution. Só os endpoints HTTP
  do Evolution são stubs.
- Despacho: `PostgresN8nCommandStore`, o mesmo do worker, com transporte stub.

O que é semeado:

- Usuários e senhas.
- Os dois Pedidos **confirmados** usados no envio da ficha em PDF. Confirmar
  exige uma ficha comercial completa, fora do roteiro. Todo Pedido pendente
  nasce pela rota HTTP real.

| Passo | Item   | Cobertura                                                                                                                                                                                                                                                                                                       |
| ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | prévio | Migrações até `0083` e contract `0081`. Com flags off, rotas pessoais falham fechadas. Com a allowlist [A,B], C segue negado                                                                                                                                                                                    |
| 1     | T05-06 | A pareia por QR, B por código. Desafio expirado (`409`, sem bytes), reconciliado por leitura e renovado. Replay de desafio, número do outro vendedor e segunda linha recusados. Varredura de 789 colunas e dos logs: 0 marcadores                                                                               |
| 2     | T05-05 | Cliente → titular humano A → Pedido no Assunto alvo → ficha. Repetir a chave mantém o número. Desconexão preserva a leitura. Replay não duplica. B e C negados por ID direto                                                                                                                                    |
| 3     | T05-06 | Envio pelo CRM, eco antes e depois do HTTP, recibos e mídia. Queda do transporte vira `outcome_unknown`, com uma única chamada e reconciliação aberta. Desconexão e reconexão elevam a geração a 3. O callback antigo repetido é `200 duplicate`, e o evento de entrada antigo, `409 WHATSAPP_GENERATION_STALE` |
| 4     | T05-07 | O mesmo `contactId` em duas carteiras, sem cópia. Conflito por campo, snapshots do Pedido intactos, primeiro envio de B sem inbound e resposta na conversa de B. Ficha pela linha de A e callback repetido sem segundo comando                                                                                  |
| 5     | final  | Ledger e outbox com um efeito por ação. Flags off bloqueiam efeitos novos e preservam histórico e ACL. Zero marcadores                                                                                                                                                                                          |

Contratos que o roteiro precisou seguir:

- Um Contact nascido na linha pessoal de A é privado de A. B recebe `404` ao
  vincular e `409 CONTACT_PHONE_MATCH`, sem candidato, ao cadastrar o telefone.
  O "mesmo Contact" do T05-07 é, portanto, um Contact comum de Clientes que A e
  B vinculam explicitamente.
- B lê por ID direto o detalhe avulso do Pedido de A (contrato E07). A conversa,
  o Assunto e o comprovante continuam negados.
- Desconectar a linha não bloqueia a leitura do Pedido nem da ficha. O titular
  continua podendo criar Pedido, como no [runbook de Pedido](../../../docs/runbooks/seller-whatsapp-orders.md).

### Resultado local

Node 24.20.0 e npm 11.19.0, com PostgreSQL 17.10 portátil em
`127.0.0.1:54372`, em bancos dedicados, sem Docker. Código acumulado E05–E12
depois das correções E12-1 a E12-3:

| Gate                                   | Resultado                                                       |
| -------------------------------------- | --------------------------------------------------------------- |
| Ensaio do piloto, 3 execuções          | 11/11 em cada uma, zero skips, cerca de 12 s                    |
| Ensaio do piloto, ciclo de correção    | 13 execuções seguidas verdes, sem `deadlock detected` no log    |
| Diagnóstico do ensaio                  | 789 colunas, 0 marcadores; hosts acessados `127.0.0.1,n8n.test` |
| Suítes PostgreSQL do CI (lista do job) | 824/824, zero skips                                             |
| Integração E07, E08, E10 e drill E11   | 1, 7, 17 e 7, zero falhas e zero skips                          |
| `npm run validate`                     | 2.893 aprovados, zero falhas, 61 skips live sem URL             |
| `npm run test:e2e -- --workers=2`      | 1.114 aprovados e 7 skips existentes; 1 falha instável, abaixo  |

A falha de E2E foi o BCS-07 (`billing-chat-real`): o axe capturou o botão
"Gerar só o link" com contraste 1,09 no tema escuro, durante a execução em
paralelo com as suítes PostgreSQL. Isolado, passou 5/5. Nenhum arquivo de
`apps/edge-web` mudou depois do E11, que passou essa spec. O registro fica
como instabilidade, não como aprovação silenciosa.

Depois da revisão de QA, E12-4 foi corrigido, e o ensaio foi endurecido. A
drenagem do worker real prova que o comando `outcome_unknown` termina em
`dead_letter`, sem chamar o transporte. O SSE de B tem um controle positivo.
Reexecução focal, zero falhas e zero skips: ensaio 11/11 três vezes;
`chat-media-upload` 22/22 duas vezes; `inbox` 10/10, `order-billing-send`
18/18, `chat-media-bind` 102/102 e integração E08 7/7.

Depois de E12-5, foram reexecutados: suítes PostgreSQL do CI 825/825;
integração E07, E08, E10 e E11 com 1, 7, 17 e 7; ensaio 11/11 três vezes;
`npm run validate` com 2.898 aprovados, zero falhas e 61 skips live sem URL.
Todas as respostas 4xx capturadas antes da mudança seguem idênticas, inclusive
nos headers.

`npm run test:e2e -- --workers=2`, sem carga paralela: 1.115 aprovados e os
7 skips existentes, inclusive o BCS-07.

## Demo local e QA exploratório

Para o teste do proprietário antes do merge, um ambiente local sintético roda
este branch com PostgreSQL próprio. As flags pessoais ficam ligadas só para
vendedores semeados. O controle de conexão real roda com o worker, os nós Code
gerados do n8n e os adapters reais do Evolution. Só os endpoints HTTP do
Evolution são simulados, e o QR é falso: não pareia nenhum aparelho. Scripts e
dados ficam fora do repositório. Isso não é evidência live.

Um QA independente fez teste exploratório de caixa preta em 10 áreas:
carteira, isolamento, Inbox pessoal, Pedido por Assunto, primeiro envio,
pareamento, flags, regressão da linha geral, acessibilidade e
console/rede. Os achados abaixo foram corrigidos com teste vermelho antes. O
reteste aprovou os 10 itens, com axe sem violações em 390 e 1366 px nos dois
temas. QR e código não apareceram em logs, banco, storage do navegador nem em
respostas além da própria chamada de desafio.

| ID     | Sev. | Achado                                                                                                     | Estado                             |
| ------ | ---- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| E12-6  | P2   | Inbox não mostrava de qual WhatsApp era a conversa (WAP-09)                                                | corrigido, `1d921374` e `5131192f` |
| E12-7  | P1   | QR/código sumia em cerca de 9 s (versão subia em reconciliação sem mudança), contra TTL de 60 s            | corrigido, `9effe6fa`              |
| E12-8  | P1   | Qualquer vendedor criava Pedido avulso para cliente privado de outra carteira e lia o nome (WAP-07/31)     | corrigido, `2a452533`              |
| E12-9  | P2   | Pedido em conversa pessoal sem Assunto nascia sem origem e travava o segundo Pedido (WAP-31/33)            | corrigido, `2a452533`              |
| E12-10 | P1   | `stream.reset` de outra linha apagava o QR; depois de recarregar, a renovação ficava presa em `409`        | corrigido, `4a9897f6`              |
| E12-11 | P2   | Linha bloqueada sem saída na tela; foco caía no `body` ao mostrar QR/código                                | corrigido, `4a9897f6`              |
| E12-12 | P2   | Linha pessoal caída ainda convidava a enviar (WAP-11); banner de onboarding para quem já conectou          | corrigido, `5131192f`              |
| E12-13 | P2   | Criar pedido apertado antes da leitura dos Assuntos era recusado sem abrir o diálogo (intermitente no E2E) | corrigido, `d8477e7e`              |
| E12-14 | P3   | Asserção nova listava conversas de outra suíte no banco compartilhado do CI e falhava ao decifrar          | corrigido, `2dddd6f7`              |
| E12-15 | P2   | Linha desconectada pedia o número de novo para reconectar, embora o servidor já o tivesse (relato do PO)   | corrigido neste PR (ver abaixo)    |

**E12-15 (19/11/2026):** em Meu WhatsApp, uma linha `disconnected` mostrava
o número mascarado e, logo abaixo, o campo "Número com código do país". Como a
linha nunca troca de número, redigitar só confirmava o que o servidor já sabia.
Agora a tela mostra "Reconectar o número" com o final mascarado e o botão
**Reconectar WhatsApp**, que envia só `expectedVersion`. A primeira conexão
continua pedindo o número. Contrato e idempotência na nota WAP-E12 do
[design](design.md); testes de rota, PostgreSQL real e E2E com axe. Evidência
local, não live.

Abertos, sem bloquear o piloto:

- P3: outra aba que pede novo desafio deixa o QR antigo visível na primeira
  até o TTL (a GET já expõe o id; falta comparar no polling).
- P3: Admin em Meus clientes faz duas leituras `403`.
- P3: rótulo do Admin usa só o primeiro nome do titular.
- P3: Assuntos no diálogo de Pedido sem data ou trecho.
- P3: busca de Meus clientes ignora maiúsculas, mas não acentos.

**Decisão de política (PO, F12), resolvida em 18/11 (seção Publicação):** a lista de Pedidos,
o detalhe e a busca por nome mostram a outro vendedor os Pedidos de cliente da
linha pessoal de A, com nome e ficha completa. É o comportamento de sempre do
quadro de Pedidos (`order.read` vê todos), agora aplicado a um cliente privado
de carteira.

## Findings do ensaio

| ID    | Sev. | Achado                                                                                                                                                                                                      | Estado                                                                |
| ----- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| E12-1 | P2   | Edição recusada de campo compartilhado restrito chegava como `403 INVALID_REQUEST`. `ClientRegistration.vue` só mantém o rascunho e orienta a revisão com o código próprio                                  | corrigido no E03/E09, `0ee59186`                                      |
| E12-2 | P2   | Envio pela Inbox com linha indisponível chegava como `SERVICE_UNAVAILABLE`. A Inbox não dizia que a linha caiu e que o rascunho foi mantido. Com flags off, `/me/clients` também mascarava o código         | corrigido no E04/E08, `0ee59186`                                      |
| E12-3 | P2   | Dois envios concorrentes da ficha em PDF com a mesma chave travavam (`40P01`) por ordem de lock invertida entre conversa e quota. Nunca houve comando duplicado                                             | corrigido no E08, `c94b280e`                                          |
| E12-4 | P2   | Revisão de QA: o gravador da ficha ainda fechava ciclo pelo FK `uploaded_by` → `crm.users` com um envio de mídia da Inbox do mesmo vendedor, em outra aba                                                   | corrigido no E08, `2493cdad`                                          |
| E12-5 | P2   | Anterior a este branch: erro sem `statusCode` (por exemplo, erro bruto do PostgreSQL) nas rotas de conversa e de operação caía no handler padrão do Fastify e devolvia `500` com código e mensagem do banco | corrigido, `faf72e02`: handler raiz com corpo genérico; 4xx idênticos |

## Resultado live

| Item       | Resultado | Motivo                                                       |
| ---------- | --------- | ------------------------------------------------------------ |
| WAP-T05-05 | pendente  | sem implantação nem autorização; nenhum fluxo real executado |
| WAP-T05-06 | pendente  | idem; código no mesmo celular sem prova (E01)                |
| WAP-T05-07 | pendente  | idem; cobrança real ou sandbox não autorizada                |

Sem esses três resultados, a etapa 1 não está aceita, e a autonomia mobile não
está declarada. Nada da etapa 2 (WAP-13/14/15) foi tocado.

## O que o ensaio não prova

Provedor Evolution/Baileys real, aparelho real, código no mesmo celular, n8n
real e sua persistência, JID de uma resposta real comparado ao `+E164` gravado,
cobrança InfinitePay real (só o envio da ficha foi ensaiado), EasyPanel,
RustFS/ClamAV remotos, capacidade de produção e RPO/RTO. O teste recusa
qualquer host fora de loopback e de `*.test`; o diagnóstico de hosts
acessados está no resultado local.

## Aceite necessário do proprietário

1. Merge da PR 398, depois do seu teste local e do CI verde.
2. Autorização escrita que nomeie vendedores, números, janela e as ações dos
   passos P1–P5 do roteiro. Ela inclui a decisão sobre F3/F4 e diz se a
   cobrança será sintética ou feita em sandbox.
3. Implantação pelo DevOps conforme a [ordem de publicação](../../../docs/runbooks/seller-whatsapp.md#ordem-de-publicação).

Com isso, o roteiro é executado uma vez e este documento recebe a evidência
live minimizada.

## Commits

| SHA        | Fronteira | Conteúdo                                                        |
| ---------- | --------- | --------------------------------------------------------------- |
| `0ee59186` | E03/E04   | E12-1 e E12-2: códigos públicos de que a interface depende      |
| `c94b280e` | E08       | E12-3: conversa antes da quota da ficha; 503 genérico nas rotas |
| `2493cdad` | E08       | E12-4: usuário, conversa e quota, nessa ordem                   |
| `9a3ffb7a` | E12       | ensaio local do piloto e passo no job PostgreSQL do CI          |
| `faf72e02` | E12       | E12-5: corpo genérico para 5xx e falhas sem `statusCode`        |
| `1d921374` | E12       | E12-6: selo de linha na Inbox                                   |
| `9effe6fa` | E02/E09   | E12-7: desafio fica pelo TTL inteiro                            |
| `2a452533` | E05       | E12-8 e E12-9: visibilidade do Contact e Assunto de origem      |
| `4a9897f6` | E09       | E12-10 e E12-11: pareamento recuperável, linha bloqueada, foco  |
| `5131192f` | E09/E12   | E12-12 e selo verde: aviso de linha caída, banner               |
| `2dddd6f7` | E12       | E12-14: asserção com escopo da suíte                            |
| `d8477e7e` | E05       | E12-13: Criar pedido espera a leitura dos Assuntos              |
| `a3ee53f6` | Evolution | linhas pessoais levam mensagens e recibos                       |
| `ac3b4087` | E04       | limite próprio para a verificação do ingresso pessoal           |
| `1f222818` | n8n       | build de produção dos workflows; Evolution interno; 429 → 503   |
| `f694eb8f` | E12       | sequência de ativação do piloto em produção                     |
| `f991d551` | n8n/E04   | QA: limite por linha, prefixos exatos, LID, eco de mídia        |
| `3c933542` | Evolution | QA: retenção pessoal, ajustes por conexão, egress travado       |

# WhatsApp pessoal — prontidão operacional da etapa 1

WAP-T05-01 e WAP-T05-04 (WAP-12/16), ADRs 090/091. Este é o índice
operacional da etapa 1: inventário de flags, limites medidos, ordem de
publicação, checklist do piloto e mapa de versões. Os contratos de cada
fronteira continuam nos runbooks de [controle](seller-whatsapp-control.md),
[ingresso](seller-whatsapp-inbound.md), [Pedido](seller-whatsapp-orders.md),
[saídas](seller-whatsapp-outbound.md), [carteira](seller-clients.md),
[provedor](seller-whatsapp-provider.md) e [recovery](seller-whatsapp-recovery.md).
A verificação independente está em [validation-etapa1](../../.specs/features/seller-whatsapp/validation-etapa1.md).

Nada aqui decide ou opera runtime. Evidência **local** é sintética, deste
repositório. **Live** exige ambiente real autorizado no WAP-E12.
**Pendente** ainda não tem evidência.

## Flags e allowlists

Cada flag é falsa quando ausente ou `false`. Valor inválido, incluindo `TRUE`,
`1`, `yes` ou espaços, impede o boot. Uma allowlist ligada precisa ser um array
JSON de IDs únicos (`^[A-Za-z0-9_-]{1,128}$`) e não vazio. Uma allowlist JSON
com texto vazio também impede o boot, mesmo com a flag desligada. Por isso,
omita a variável ou use `[]`. A matriz é coberta por
`test/seller-whatsapp-readiness-config.test.js` (14 casos) e pelas suítes
citadas em cada runbook.

| Flag e allowlist                                                                                                | Serviço    | Bloqueia quando desligada                                                |
| --------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `SELLER_WHATSAPP_CONTROL_ENABLED`, `SELLER_WHATSAPP_SELLER_IDS`, `SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST`        | API        | connect, desafio, disconnect (`503 WHATSAPP_CONTROL_DISABLED`)           |
| `SELLER_WHATSAPP_WEBHOOK_URL`, `N8N_WAP_CONTROL_URL`, `N8N_WAP_CHALLENGE_URL`                                   | API/worker | não lidas enquanto o controle está desligado; HTTPS e caminho fixo       |
| `SELLER_CLIENTS_ENABLED`, `SELLER_CLIENTS_SELLER_IDS`                                                           | API        | Meus clientes: lista, cadastro e vínculo (`503 SELLER_CLIENTS_DISABLED`) |
| `SELLER_WHATSAPP_INBOUND_ENABLED`, `SELLER_WHATSAPP_INBOUND_SELLER_IDS`                                         | API        | ingresso pessoal antes de gravar                                         |
| `SELLER_WHATSAPP_SEND_ENABLED`, `SELLER_WHATSAPP_SEND_SELLER_IDS`                                               | API/worker | outbox e despacho pessoal (`WHATSAPP_SEND_UNAVAILABLE`)                  |
| `SELLER_WHATSAPP_FIRST_SEND_ENABLED`, `SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS`                                   | API        | prévia e envio do primeiro contato, antes do banco                       |
| `ORDER_SUBJECT_CREATION_ENABLED`, `ORDER_SUBJECT_READERS_READY`, `ORDER_SUBJECT_SELLER_IDS` (lista por vírgula) | API        | Pedido por alvo/linha pessoal (`ORDER_SUBJECT_UNAVAILABLE`)              |
| `SILMER_WAP_INGRESS_ENABLED`, `_PATHS`, `_INSTANCES`, `_VERIFY_URL`, `_VERIFY_BASIC`                            | n8n        | caminhos pessoais (`403 WAP_INGRESS_DENIED`) antes do verificador        |
| `SILMER_WAP_CONTROL_ENABLED`, `SILMER_WAP_CONTROL_WEBHOOK_URL`                                                  | Evolution  | rotas de controle; exige geração ligada                                  |
| `SILMER_WAP_GENERATION_ENABLED`, `SILMER_WAP_GENERATION_INSTANCES`                                              | Evolution  | socket pessoal sem binding                                               |

`ORDER_SUBJECT_*` é avaliada por requisição, e valor inválido equivale a
desligado. Leitura de histórico e ACL pessoal não dependem de flag. O drill de
[recovery](seller-whatsapp-recovery.md#desligamento) prova que ambas
sobrevivem ao desligamento.

## Limites medidos

`ops/seller-whatsapp/capacity-rehearsal.mjs` mede os caminhos reais (API,
adapters PostgreSQL, worker n8n com transporte stub) para 2 e 10 vendedores.
O resultado está em [`capacity.evidence.json`](../../ops/seller-whatsapp/capacity.evidence.json).
O host foi Windows de desenvolvimento (i5-11400F, 32 GiB), com PostgreSQL 17.10
na mesma máquina e commit `d24c78c5` (`aad6f171` antes do rebase sobre a
master de 18/11, como guardado no JSON). **A medição não prova capacidade de
produção.**

| Caminho                  | 2 vendedores          | 10 vendedores         | Observação                                    |
| ------------------------ | --------------------- | --------------------- | --------------------------------------------- |
| Ingresso pessoal         | 131 msg/s, p95 256 ms | 206 msg/s, p95 177 ms | pool da API saturado (10) em concorrência 16  |
| `GET /me/clients` (2000) | p95 44 ms             | p95 148 ms            | `limit=100` p95 160 ms                        |
| Pedido por Assunto       | p95 178 ms            | p95 429 ms            | espera de pool p95 307 ms                     |
| Primeiro envio           | p95 43 ms             | p95 158 ms            | repetição pendente: `409`                     |
| Envio pessoal Inbox      | p95 58 ms             | p95 122 ms            | cinco abas: 1 × 202, 4 × 409                  |
| Drenagem do worker       | 1,06 cmd/s            | 1,01 cmd/s            | 61 comandos, p95 59,7 s até liquidar          |
| SSE                      | 4 streams             | 20 streams            | teto global de 30; reset a cada evento alheio |

Nenhuma fase teve deadlock, falha de serialização ou timeout de pool.

### Limites do piloto

| Escopo  | Limite                       | Valor              | Imposto por código                  |
| ------- | ---------------------------- | ------------------ | ----------------------------------- |
| Serviço | Vendedores na allowlist      | 2                  | não (decisão operacional, WAP-12)   |
| Serviço | Linhas por vendedor          | 1                  | sim (`0077`)                        |
| Serviço | Envios pessoais, teto        | 60/min             | sim, implícito: worker serial ≈1/s  |
| Serviço | Envios pessoais, orçamento   | 20/min             | não                                 |
| Serviço | Streams SSE por processo     | 30                 | sim                                 |
| Serviço | Processos                    | 1 API, 1 worker    | não; limites em memória multiplicam |
| Usuário | Primeiro envio não liquidado | 1 por destino      | sim (WAP-24); não vale para a Inbox |
| Usuário | Página de `/me/clients`      | 50, máximo 100     | sim                                 |
| Usuário | Vínculos ativos na carteira  | ≤ 2000 (ensaiado)  | não                                 |
| Usuário | Envios pessoais              | ≤ 10/min           | não                                 |
| Usuário | Streams SSE                  | ≤ 3                | não                                 |
| Linha   | Ingresso sustentado          | ≤ 2 msg/s, pico 20 | não                                 |

Na Inbox, uma resposta nova depois de um envio `outcome_unknown` gera outro
comando. O comando incerto nunca é reenviado e segue aberto para
reconciliação (ensaio do WAP-E12). Rate limits existentes são por IP e por
processo, não por usuário. A exceção é a verificação de ingresso pessoal
(`…/whatsapp-control/ingress/verify`): 1200/min por vínculo
(`X-Correlation-Id`, igual ao `bindingId`; sem ele, ou malformado, vale o
balde do IP) dentro de um teto de 6000/min por IP, que só conta pedidos já
admitidos pelo vínculo. O CRM responde 429, o n8n devolve 503 ao Evolution e
o Evolution tenta de novo 3 vezes em cerca de 20 s, dentro da mesma janela.
Os limites sem código restringem o piloto a dois vendedores sob observação.
Eles não autorizam ampliação. As lacunas estão em
[validation-etapa1](../../.specs/features/seller-whatsapp/validation-etapa1.md#findings).

## Ordem de publicação

1. PR com CI verde: checks estáticos, E2E, PostgreSQL (incluindo as suítes de
   integração e o drill) e auditoria.
2. Merge com histórico linear, imagem por digest e migrações expand até
   `0083` aplicadas manualmente. Ver
   [migração e rollback](../../EASYPANEL-TOPOLOGY.md#9-migração-e-rollback).
   Todas as flags pessoais seguem desligadas. A linha geral precisa seguir
   igual (smoke).
3. Contract `0081`, só depois de confirmar os leitores compatíveis.
4. Imagens Evolution/n8n com os patches WAP, com as flags desligadas.
   Workflows candidatos ficam inativos e não são copiados à mão.
5. Flags por allowlist, conforme a [implantação em fases](seller-whatsapp-recovery.md#implantação-em-fases).
   A sequência operacional exata está em
   [ativação em produção](#ativação-em-produção-piloto-de-um-vendedor).
6. Rollback: desligar as flags. Binário só para um SHA da tabela de
   [rollback](seller-whatsapp-recovery.md#rollback-de-binário).

## Ativação em produção (piloto de um vendedor)

Sequência para ligar **um** vendedor em produção, um passo por vez. Ela não
autoriza nada sozinha: cada passo real depende da autorização do
[go/no-go](#gono-go-antes-do-primeiro-efeito-real). Qualquer condição de
abortar aplica o [congelamento](#congelamento-e-reconciliação) e, se preciso,
o [rollback](#rollback-da-ativação). IDs de vendedor, linha, instância e
credencial ficam só no EasyPanel e na cópia privada do operador, nunca em
diff, ticket ou relatório. A evidência segue a regra
[minimizada](#evidência-minimizada).

| Passo | Ação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Conferência                                                                                                                                                                                                                                                                        | Abortar quando                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0     | Pré-requisitos. Master com os commits WAP-E12 desta etapa implantada (API, worker e edge no SHA; ver [validation-piloto](../../.specs/features/seller-whatsapp/validation-piloto.md#commits)). Antes do rebuild, as 14 integrações de saída do Evolution como `false` e `SENTRY_DSN` vazio no env do EasyPanel ([provedor](seller-whatsapp-provider.md)); sem elas o Evolution não sobe, e a linha geral cai junto. Nova imagem do Evolution (`ops/evolution/Dockerfile.inline` re-renderizado) e do n8n (`ops/n8n/wap-ingress-Dockerfile.inline` re-renderizado), com todas as flags desligadas. `pg_dump` do `silmer-evolution-db` (sem backup no EasyPanel) e backup do banco do n8n. Smoke da linha geral | `/api/health/ready` 200 no SHA. Build do Evolution imprime `WAP_EVOLUTION_GENERATION_PATCHED`, e o do n8n, `WAP_N8N_INGRESS_PATCHED`. Dumps conferidos. Smoke ok                                                                                                                   | SHA divergente, marcador ausente, dump faltando ou regressão da linha geral                              |
| 1     | Credenciais n8n: Basic do gatilho de controle, credencial própria do WAP (= `N8N_WAP_CLIENT_ID`/`_SECRET` da API e do worker; segredo novo com 32 caracteres ou mais, nunca a do panel-command); Basic do CRM `AUTOMATION_EXECUTOR` (= `CRM_AUTOMATION_CLIENT_*`, ações `whatsapp.control.read`, `.reserve` e `.result`); header `apikey` do Evolution (= `AUTHENTICATION_API_KEY`); header `X-Silmer-Evolution-Token` dos eventos (credencial existente)                                                                                                                                                                                                                                                     | Anotar só os IDs das quatro credenciais, na cópia privada                                                                                                                                                                                                                          | Segredo divergente do serviço de origem ou ação faltando no executor                                     |
| 2     | **Só a API** (o worker segue com `SELLER_WHATSAPP_CONTROL_ENABLED=false`): `SELLER_WHATSAPP_CONTROL_ENABLED=true`, `SELLER_WHATSAPP_SELLER_IDS=["<id do vendedor>"]`, `SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST`, `N8N_WAP_CONTROL_URL` e `N8N_WAP_CHALLENGE_URL` (`https://<n8n>/webhook/silmer/seller-whatsapp/control` e `…/challenge`), `SELLER_WHATSAPP_WEBHOOK_URL` (`…/events`), `N8N_WAP_CLIENT_ID` e `N8N_WAP_CLIENT_SECRET`. Reiniciar a API                                                                                                                                                                                                                                                           | Boot e `/api/health/ready` 200, **no container novo**: o EasyPanel mantém o antigo quando o boot falha, então conferir no console que o processo é recente e tem a flag. Só o worker consome a fila `whatsapp_control` e roda a varredura; por isso o job do passo 3 fica pendente | Boot recusado ou outro vendedor aceito                                                                   |
| 3     | O vendedor clica **Conectar** uma vez, em chamada com o operador, e não clica mais nada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A tela mostra a linha em preparação                                                                                                                                                                                                                                                | Clicou em Desconectar: isso cria uma operação de logout pendente                                         |
| 4     | SQL somente leitura (abaixo) em `crm.seller_whatsapp_lines`, `crm.seller_whatsapp_operations` e `crm.outbox_jobs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Linha `preparing`, operação `connect` `pending`, job `whatsapp.control.deliver` `pending`                                                                                                                                                                                          | Qualquer outro estado, mais de uma operação ou mais de um job                                            |
| 5     | Exportar o workflow principal `k7tI6T4RhQPyJkn9` atual (cópia privada, fora do repositório) e rodar o build (abaixo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Código de saída 0, cinco arquivos e hashes impressos. `crmBaseUrl` igual à origem dos nós CRM do export                                                                                                                                                                            | Qualquer código `WAP_BUILD_*` ou `EVOLUTION_SEND_*`                                                      |
| 6     | n8n: variáveis do `summary.json` (`environment.n8n`) mais `SILMER_WAP_INGRESS_VERIFY_BASIC` (valor completo `Basic …` do `AUTOMATION_EXECUTOR`). Reiniciar. Importar `control`, `challenge` e `inbound` **pelo editor** (novo workflow → importar arquivo → salvar). Ativar os três. **Não** aplicar `main-personal-send` no piloto                                                                                                                                                                                                                                                                                                                                                                           | Boot e `healthz` 200. Os três salvam e ativam. O workflow principal segue igual                                                                                                                                                                                                    | `WAP_WORKFLOW_WRITE_DENIED` (env errada), boot recusado ou workflow principal alterado                   |
| 7     | Evolution: `SILMER_WAP_GENERATION_ENABLED=true`, `SILMER_WAP_GENERATION_INSTANCES=<instância>`, `SILMER_WAP_CONTROL_ENABLED=true` e `SILMER_WAP_CONTROL_WEBHOOK_URL` idêntico, byte a byte, a `SELLER_WHATSAPP_WEBHOOK_URL`. Conferir tudo com o `summary.json` **antes**: env inválida derruba o boot do Evolution e a linha geral. Reiniciar; a linha geral cai por instantes                                                                                                                                                                                                                                                                                                                               | Boot do Evolution, linha geral `open` e smoke da linha geral                                                                                                                                                                                                                       | Boot recusado ou linha geral sem voltar                                                                  |
| 8     | Repetir o SQL do passo 4. Worker: espelhar as variáveis WAP da API, incluindo a allowlist, `N8N_WAP_CLIENT_*` e as chaves `CONTACT_IDENTITY_*` (o worker ainda não as tem), e reiniciar; conferir o container novo como no passo 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Antes: igual ao passo 4. Depois: o job pendente é entregue e a linha fica `awaiting_pairing`                                                                                                                                                                                       | Estado divergente antes do worker; depois, operação `failed_before_effect`, `unknown` ou linha `blocked` |
| 9     | O vendedor pede o QR e pareia. O QR fica em outra tela: o código no mesmo celular não está provado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A varredura marca a linha `connected`                                                                                                                                                                                                                                              | Número divergente, recusa do desafio ou linha `blocked`                                                  |
| 10    | Ligar o restante por fase, um passo por vez: `SELLER_CLIENTS_*`, depois `SELLER_WHATSAPP_INBOUND_*` e, por último, `ORDER_SUBJECT_*`. `SELLER_WHATSAPP_SEND_*` e `SELLER_WHATSAPP_FIRST_SEND_ENABLED` ficam desligadas no piloto inicial                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Em cada fase, outro vendedor segue recusado                                                                                                                                                                                                                                        | Outro vendedor aceito em qualquer fase                                                                   |

O envio pessoal exige o `main-personal-send`, com smoke próprio da linha
geral, e fica para depois. O primeiro envio exige o gate do JID
([saídas](seller-whatsapp-outbound.md)).

SQL dos passos 4 e 8, somente leitura. Registre só prefixos de 8 caracteres:

```sql
SELECT l.id, l.instance_name, l.state AS line_state,
       o.action, o.state AS operation_state,
       j.job_type, j.status AS job_status
  FROM crm.seller_whatsapp_lines l
  JOIN crm.seller_whatsapp_operations o ON o.line_id = l.id
  LEFT JOIN crm.outbox_jobs j ON j.whatsapp_operation_id = o.id
 WHERE l.seller_id = '<id do vendedor>'
 ORDER BY o.created_at DESC;
```

Build do passo 5, com saída fora do repositório:

```sh
node ops/n8n/build-wap-production-workflows.mjs <export.json> <config.json> <dir-fora-do-repo>
```

`config.json`, com valores sintéticos. O operador troca pelos reais só na
cópia privada:

```json
{
  "lineIds": ["00000000-0000-4000-8000-000000000001"],
  "instances": ["wap_00000000000000000000000000000001"],
  "crmBaseUrl": "https://<crm>",
  "evolutionBaseUrl": "http://schedule_silmer-evolution:8080",
  "n8nBaseUrl": "https://<n8n>",
  "sellerWhatsAppWebhookUrl": "https://<n8n>/webhook/silmer/seller-whatsapp/events",
  "evolutionControlWebhookUrl": "https://<n8n>/webhook/silmer/seller-whatsapp/events",
  "credentials": {
    "controlWebhookBasic": { "id": "synthetic-control-basic", "name": "..." },
    "crmBasic": { "id": "synthetic-crm-basic", "name": "..." },
    "evolutionApiHeader": { "id": "synthetic-evolution-api", "name": "..." },
    "evolutionEventsHeader": {
      "id": "synthetic-evolution-events",
      "name": "..."
    }
  },
  "personalSendLineIds": []
}
```

- `lineIds` e `instances` vêm do SQL do passo 4. No piloto,
  `personalSendLineIds` fica vazio.
- `crmBaseUrl` precisa ser a origem que os nós CRM do principal vivo já usam.
  Confira no export. O CRM aceita só `https`; o Evolution aceita só a origem
  interna acima.
- As duas URLs de webhook precisam ser iguais a
  `<n8nBaseUrl>/webhook/silmer/seller-whatsapp/events`.

O build grava, sem sobrescrever, `control.json`, `challenge.json`,
`inbound.json`, `main-personal-send.json` e `summary.json`. Todos saem
inativos. O `summary.json` traz as variáveis propostas para API, worker, n8n e
Evolution, validadas pelos loaders reais, e a lista dos segredos que não
mudam. A allowlist de vendedores sai como placeholder. Recusas, só com código
fixo:

| Código                                | Causa                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAP_BUILD_USAGE`                     | argumentos diferentes de três                                                                                                                                                                                   |
| `WAP_BUILD_OUTPUT_IN_REPO`            | diretório de saída dentro do repositório                                                                                                                                                                        |
| `WAP_BUILD_OUTPUT_EXISTS`             | diretório de saída já existe                                                                                                                                                                                    |
| `WAP_BUILD_CONFIG_INVALID`            | chave desconhecida, URL fora do formato ou credencial inválida                                                                                                                                                  |
| `WAP_BUILD_LINE_INVALID`              | `lineIds` vazio, repetido ou fora do formato; envio para linha não listada                                                                                                                                      |
| `WAP_BUILD_INSTANCE_INVALID`          | `instances` vazio, repetido ou fora de `wap_` + 32 hex                                                                                                                                                          |
| `WAP_BUILD_WEBHOOK_URL_MISMATCH`      | URLs de webhook diferentes do caminho de eventos do n8n                                                                                                                                                         |
| `WAP_BUILD_MAIN_INVALID`              | export sem `nodes` ou `connections` válidos                                                                                                                                                                     |
| `WAP_BUILD_MAIN_ID_MISMATCH`          | export de outro workflow                                                                                                                                                                                        |
| `WAP_BUILD_MAIN_NOT_ADAPTED`          | principal sem os nós do Evolution, ou ainda com WAHA/WPPConnect                                                                                                                                                 |
| `WAP_BUILD_MAIN_ALREADY_WAP`          | principal já tem nós `(WAP)`                                                                                                                                                                                    |
| `WAP_BUILD_CRM_ORIGIN_MISMATCH`       | nó CRM cujo prefixo literal da URL não começa com `crmBaseUrl` + `/api/`                                                                                                                                        |
| `WAP_BUILD_EVOLUTION_ORIGIN_MISMATCH` | nó do Evolution cujo prefixo literal sai de `evolutionBaseUrl`                                                                                                                                                  |
| `WAP_BUILD_INBOUND_UNSAFE`            | inbound com envio, gatilho extra, `$env`, nó de IA ou referência solta; URL com credencial cujo prefixo não se prova (fallback, ternário, template); leitura do Evolution que não seja a da instância de origem |
| `WAP_BUILD_ENVIRONMENT_INVALID`       | variáveis propostas recusadas por um loader ou pela sonda do ingresso                                                                                                                                           |
| `EVOLUTION_SEND_*`                    | âncoras do envio pessoal ausentes ou repetidas no principal                                                                                                                                                     |
| `WAP_BUILD_FAILED`                    | qualquer outra falha; o build não ecoa entrada, caminho nem causa                                                                                                                                               |

No passo 6, as variáveis do n8n são `SILMER_WAP_INGRESS_ENABLED=true`,
`SILMER_WAP_INGRESS_PATHS` (mapa JSON dos três caminhos para `control`,
`challenge` e `event`), `SILMER_WAP_INGRESS_INSTANCES`,
`SILMER_WAP_CONTROL_VERIFY_URL`
(`https://<crm>/api/v1/integrations/n8n/whatsapp-control/verify`),
`SILMER_WAP_INGRESS_VERIFY_URL` (`…/whatsapp-control/ingress/verify`) e
`SILMER_WAP_INGRESS_VERIFY_BASIC`. O import é pelo editor porque só o
salvamento pelo editor passa pelo guard de escrita.

### Riscos operacionais

- O vínculo de geração fica em memória no Evolution. Qualquer reinício ou
  redeploy do Evolution exige novo pareamento. Prepare todos os vendedores
  antes de um único reinício.
- Instância criada antes de `a3ee53f6` tem o webhook antigo e fica `blocked`
  na reconciliação. Ela precisa reconectar.
- Mensagens enviadas pelo CRM não geram eco `messages.upsert`
  (`emitOwnEvents: false`). A confirmação vem do HTTP e dos recibos.
- Evento de geração antiga é recusado com `403` no ingresso do n8n. O
  `409 WHATSAPP_GENERATION_STALE` do CRM é a segunda barreira.
- A retenção do Evolution (`retention.cjs`) só expira a instância geral.
  Mensagens pessoais no banco do Evolution não expiram (pendente).
- O cliente de controle tem timeout fixo de 15 s.

### Rollback da ativação

1. Desligar as flags na ordem do [desligamento](seller-whatsapp-recovery.md#desligamento).
2. Desativar os três workflows (`control`, `challenge` e `inbound`).
3. Voltar as imagens do Evolution e do n8n para as anteriores.

## Checklist de publicação e piloto

| Item                                                           | Estado   | Evidência / responsável                                                                                                                                          |
| -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags default off e allowlist fail-closed em todos os serviços | local    | teste de prontidão; suítes por fronteira                                                                                                                         |
| Limites numéricos por usuário/serviço                          | local    | ensaio de capacidade; não é capacidade de produção                                                                                                               |
| Matriz da spec, ACL, replay/SSE, QR sem persistência           | local    | validation-etapa1                                                                                                                                                |
| Desligamento, fases e restore sintéticos                       | local    | drill 7/7 ×3                                                                                                                                                     |
| Ensaio integrado do piloto (T05-05/06/07)                      | local    | ensaio 11/11 ×3; [validation-piloto](../../.specs/features/seller-whatsapp/validation-piloto.md)                                                                 |
| Trava de envio pós-restore no código                           | pendente | P1, decisão de Tech Lead/PO antes do piloto                                                                                                                      |
| Limite de envio por usuário                                    | pendente | P1 de capacidade, Backend antes de ampliar além de 2                                                                                                             |
| CI verde, merge e migrações em produção                        | feito    | PR 398 em `1489c2fe`; expand `0080`/`0082`/`0083`, contract `0081`; [publicação](../../.specs/features/seller-whatsapp/validation-piloto.md#publicação-18112026) |
| Imagens Evolution/n8n com patch e digest                       | feito    | reconstruídas em 19/11 com a master `829e20e7`, flags desligadas; [validation-piloto](../../.specs/features/seller-whatsapp/validation-piloto.md)                |
| Spike de provedor e código no mesmo celular (WAP-E01)          | pendente | E01 aberto; WAP-T05-06 no E12                                                                                                                                    |
| Pareamento mobile, sincronização e eco reais                   | pendente | WAP-E12                                                                                                                                                          |
| JID da resposta = `+E164` gravado (gate do primeiro envio)     | pendente | WAP-E12                                                                                                                                                          |
| Restore remoto, RPO/RTO e banco do n8n                         | pendente | DevOps, [recovery](../../ops/recovery/RUNBOOK.md)                                                                                                                |
| Aprovação operacional, financeira e de Privacidade             | pendente | PO, Operação e Privacidade                                                                                                                                       |

## Roteiro do piloto (WAP-E12)

WAP-T05-05, WAP-T05-06 e WAP-T05-07 formam **um único roteiro**, executado
uma vez, sem refazer o setup nem a cobrança entre as seções. O estado de cada
gate e a evidência ficam em
[validation-piloto](../../.specs/features/seller-whatsapp/validation-piloto.md).
Este roteiro não autoriza publicar, parear, enviar a cliente ou gerar efeito
financeiro. Cada passo real depende de uma autorização operacional explícita e
vigente que cubra exatamente aquela ação.

### Escopo autorizado mínimo

- Dois vendedores na allowlist (A e B), cada um com uma única linha. Um
  vendedor C, fora da allowlist, serve de controle negativo.
- Os números dos vendedores são dedicados ao piloto. O cliente é **sintético**:
  um aparelho de teste da equipe, sem cliente real e sem lista de transmissão.
- Cobrança e recebimento são sintéticos, ou feitos em sandbox autorizado por
  escrito. Nenhuma chave PIX, boleto ou link de pagamento real.
- Um processo de API e um de worker, conforme os [limites do piloto](#limites-do-piloto).

### Go/no-go antes do primeiro efeito real

Todos os itens precisam estar comprovados. Um item faltando impede o início, e
nenhum deles pode ser trocado por outro.

1. CI verde no HEAD da PR e merge com histórico linear.
2. API e worker no SHA do merge, com digest registrado. `/api/health/live`
   e `/api/health/ready` em 200 pelo edge
   ([health](../../EASYPANEL-TOPOLOGY.md)). Migrações expand até `0083`, e contract `0081` só
   depois dos leitores compatíveis.
3. Imagens Evolution 2.3.7 e n8n 2.43.7 com os patches WAP, por digest,
   reconstruídas com `a3ee53f6` e `1f222818`. As flags começam desligadas, e
   os workflows candidatos ficam inativos até o passo 5.
4. Smoke da linha geral sem regressão (entrada, Pedido manual e envio).
5. Flags ligadas por fase e por allowlist, um vendedor por vez:
   [implantação em fases](seller-whatsapp-recovery.md#implantação-em-fases).
   O vendedor C continua recusado em cada fase.
6. Decisão registrada sobre a trava pós-restore (F3) e o limite por usuário (F4)
   de [validation-etapa1](../../.specs/features/seller-whatsapp/validation-etapa1.md#findings).
7. Backup e recovery verificados no ambiente alvo: restore remoto com RPO/RTO
   medidos, banco do n8n incluído
   ([recovery](../../ops/recovery/RUNBOOK.md)). SHA de rollback escolhido da
   [tabela](seller-whatsapp-recovery.md#rollback-de-binário) e registrado.
8. Varredura de base dos logs de API, worker, n8n e Evolution, sem PII, QR ou
   código, antes do primeiro efeito.
9. Allowlists com IDs privados somente nas variáveis do EasyPanel, nunca em
   diff, documento, ticket ou relatório. Um processo de API e um de worker
   confirmados.
10. Autorizações explícitas do PO, da Operação, da Privacidade e, para a
    cobrança, do Financeiro. Cada uma nomeia vendedores, números, janela e
    ações permitidas.

Escopo decidido pelo PO em 18/11: o piloto não exige o Pedido passivo (P2
com cliente que procura primeiro). Basta o cliente ser criado ou vinculado e
ficar ligado à conversa, ao vendedor e ao Pedido; P2 pode partir de uma
conversa iniciada pelo vendedor (primeiro envio, P4).

### Passos

| Passo | Item     | Ação real                                                                                                              | Resultado esperado                                                                                                                                                                                                                                             |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1    | T05-06   | A pareia por QR, em outra tela. B pareia por **código no mesmo celular**.                                              | Uma linha por vendedor. Desafio só na resposta síncrona. Nenhum QR ou código em banco, log ou captura                                                                                                                                                          |
| P1    | T05-06   | Número errado, número já em uso pelo outro vendedor, desafio expirado e repetição do desafio                           | Recusa fixa sem bytes de desafio. A linha não fica `connected` com o número divergente                                                                                                                                                                         |
| P1    | T05-06   | Logout pelo aparelho e reconexão. Depois, callback e evento da geração antiga                                          | Nova geração. Callback repetido: `200 duplicate`. Resultado novo da geração antiga: `200 stale`, linha inalterada. Despacho ou geração divergente: `403`. Evento de entrada antigo: `403` no ingresso do n8n, `409 WHATSAPP_GENERATION_STALE` se chegar ao CRM |
| P2    | T05-05   | O cliente sintético escreve para A. A assume como titular humano e cria o Pedido no Assunto alvo. Depois, abre a ficha | Pendente numerado no Contact, conversa, Assunto e responsável corretos. Repetir a chave não duplica                                                                                                                                                            |
| P2    | T05-05   | A desconecta a linha. Depois, replay do mesmo evento e tentativa de B ou C pelo ID direto                              | Pedido e ficha continuam legíveis para A. Nenhuma duplicata. B e C negados sem vazar metadados                                                                                                                                                                 |
| P3    | T05-06   | Tráfego pelo CRM e pelo aparelho nas duas linhas: texto, mídia, recibos e eco antes do HTTP                            | Uma mensagem por efeito, na conversa da linha certa. Recibos aplicados                                                                                                                                                                                         |
| P3    | T05-06   | Queda do provedor ou do n8n durante um envio                                                                           | `outcome_unknown` reconciliado por leitura. Nenhum reenvio cego                                                                                                                                                                                                |
| P4    | T05-07   | B vincula o mesmo Contact e edita outro campo. Depois, uma edição concorrente no mesmo campo                           | Mesmo `contactId`. Conflito `409` só no campo disputado. Histórias privadas por carteira                                                                                                                                                                       |
| P4    | T05-07   | B envia a primeira mensagem individual, sem inbound prévio. O cliente sintético responde                               | Resposta na conversa de B, mesmo Contact. **JID da resposta = `+E164` gravado** (gate do primeiro envio)                                                                                                                                                       |
| P4    | T05-07   | Cobrança sintética do Pedido de A, linha offline logo após o envio, callback repetido                                  | Um único comando e um único recebimento. A cobrança sai pela linha de A. Snapshots do Pedido inalterados                                                                                                                                                       |
| P5    | encerrar | Desligar as flags pela ordem do [desligamento](seller-whatsapp-recovery.md#desligamento)                               | Efeitos novos bloqueados. Histórico, ledger e ACL preservados                                                                                                                                                                                                  |

### Congelamento e reconciliação

Qualquer resultado fora do esperado **congela o avanço**. Desligue a flag da fase
em curso e preserve o ledger, a outbox e os recibos. Não apague instância, não
faça down e não repita o efeito. Um efeito incerto só é resolvido por leitura do
provedor e pela reconciliação do runbook da fronteira. Enquanto houver
`outcome_unknown` aberto, ninguém redigita a mensagem pela Inbox nem pelo
aparelho: a Inbox aceitaria um comando novo, e isso seria repetição cega. O
próximo passo só começa depois de uma nova decisão registrada.

### Evidência minimizada

Registrar apenas: passo, horário, SHA/digest, IDs opacos (prefixo de 8
caracteres), versões, códigos HTTP e de erro, contagens e booleans de scan.
Nunca registrar telefone, JID, nome, e-mail, CPF/CNPJ, endereço, texto de
mensagem, mídia, QR, código, token, cookie, credencial, link de pagamento,
chave PIX nem captura de tela do desafio, da Inbox ou de conversa. A
comparação do JID com o `+E164` gravado entra só como boolean. Varrer banco e logs pelos
marcadores do piloto após P1 e após P5, sem copiar os bytes encontrados.
Um QR isolado não homologa nada. Sem o código no mesmo celular provado em P1,
o relatório declara essa limitação e **não declara autonomia mobile**.

## Mapa de versões

| Etapa   | Commits                                                                                     | Migrações      | Evidência local                                                                 |
| ------- | ------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| WAP-E01 | `c14df42c`, `5ff57934`, `7d032732`                                                          | —              | aceite bloqueado (provedor)                                                     |
| WAP-E02 | `ddc7a9a0`, `72b04055`                                                                      | `0077`         | [controle](seller-whatsapp-control.md)                                          |
| WAP-E03 | `5d948169`, `a6f2cdc5`                                                                      | `0078`, `0079` | [carteira](seller-clients.md)                                                   |
| WAP-E04 | `07ef190a`, `ad4e6695`, `f5833287`                                                          | —              | [ingresso](seller-whatsapp-inbound.md)                                          |
| WAP-E05 | `0d6645f8`                                                                                  | `0080`, `0081` | [Pedido](seller-whatsapp-orders.md)                                             |
| WAP-E06 | `17e35f09`                                                                                  | —              | [Pedido](seller-whatsapp-orders.md)                                             |
| WAP-E07 | `058f5912`                                                                                  | —              | [validation-pedido](../../.specs/features/seller-whatsapp/validation-pedido.md) |
| WAP-E08 | `6eb5a4d3`, `936390be`                                                                      | `0082`, `0083` | [saídas](seller-whatsapp-outbound.md)                                           |
| WAP-E09 | `82627f8b` … `ded870d7`                                                                     | —              | [carteira](seller-clients.md)                                                   |
| WAP-E10 | `16507d09` … `d24c78c5`                                                                     | —              | [saídas](seller-whatsapp-outbound.md)                                           |
| WAP-E11 | ver [validation-etapa1](../../.specs/features/seller-whatsapp/validation-etapa1.md#commits) | —              | este runbook e o drill                                                          |
| WAP-E12 | ver [validation-piloto](../../.specs/features/seller-whatsapp/validation-piloto.md#commits) | —              | ensaio local; homologação real pendente                                         |

E01–E04 estão na master. E05–E12 formam a PR única
[romulosutil/crm-silmer#398](https://github.com/romulosutil/crm-silmer/pull/398),
no branch `codex/wap-e05`.

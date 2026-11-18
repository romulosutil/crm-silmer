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
na mesma máquina e commit `aad6f171`. **A medição não prova capacidade de
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

| Escopo  | Limite                           | Valor              | Imposto por código                  |
| ------- | -------------------------------- | ------------------ | ----------------------------------- |
| Serviço | Vendedores na allowlist          | 2                  | não (decisão operacional, WAP-12)   |
| Serviço | Linhas por vendedor              | 1                  | sim (`0077`)                        |
| Serviço | Envios pessoais, teto            | 60/min             | sim, implícito: worker serial ≈1/s  |
| Serviço | Envios pessoais, orçamento       | 20/min             | não                                 |
| Serviço | Streams SSE por processo         | 30                 | sim                                 |
| Serviço | Processos                        | 1 API, 1 worker    | não; limites em memória multiplicam |
| Usuário | Envio não liquidado por conversa | 1                  | sim (WAP-24)                        |
| Usuário | Página de `/me/clients`          | 50, máximo 100     | sim                                 |
| Usuário | Vínculos ativos na carteira      | ≤ 2000 (ensaiado)  | não                                 |
| Usuário | Envios pessoais                  | ≤ 10/min           | não                                 |
| Usuário | Streams SSE                      | ≤ 3                | não                                 |
| Linha   | Ingresso sustentado              | ≤ 2 msg/s, pico 20 | não                                 |

Rate limits existentes são por IP e por processo, não por usuário. Os limites
sem código restringem o piloto a dois vendedores sob observação. Eles não
autorizam ampliação. As lacunas estão em
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
6. Rollback: desligar as flags. Binário só para um SHA da tabela de
   [rollback](seller-whatsapp-recovery.md#rollback-de-binário).

## Checklist de publicação e piloto

| Item                                                           | Estado   | Evidência / responsável                              |
| -------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| Flags default off e allowlist fail-closed em todos os serviços | local    | teste de prontidão; suítes por fronteira             |
| Limites numéricos por usuário/serviço                          | local    | ensaio de capacidade; não é capacidade de produção   |
| Matriz da spec, ACL, replay/SSE, QR sem persistência           | local    | validation-etapa1                                    |
| Desligamento, fases e restore sintéticos                       | local    | drill 7/7 ×3                                         |
| Trava de envio pós-restore no código                           | pendente | P1, decisão de Tech Lead/PO antes do piloto          |
| Limite de envio por usuário                                    | pendente | P1 de capacidade, Backend antes de ampliar além de 2 |
| CI verde do HEAD da PR                                         | pendente | GitHub Actions da PR 398                             |
| Imagens Evolution/n8n com patch e digest                       | pendente | DevOps                                               |
| Spike de provedor e código no mesmo celular (WAP-E01)          | pendente | E01 aberto; WAP-T05-06 no E12                        |
| Pareamento mobile, sincronização e eco reais                   | pendente | WAP-E12                                              |
| JID da resposta = `+E164` gravado (gate do primeiro envio)     | pendente | WAP-E12                                              |
| Restore remoto, RPO/RTO e banco do n8n                         | pendente | DevOps, [recovery](../../ops/recovery/RUNBOOK.md)    |
| Aprovação operacional, financeira e de Privacidade             | pendente | PO, Operação e Privacidade                           |

## Mapa de versões

| Etapa   | Commits                                                                                     | Migrações      | Evidência local                                                                 |
| ------- | ------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| WAP-E01 | `c14df42c`, `5ff57934`, `7d032732`                                                          | —              | aceite bloqueado (provedor)                                                     |
| WAP-E02 | `ddc7a9a0`, `72b04055`                                                                      | `0077`         | [controle](seller-whatsapp-control.md)                                          |
| WAP-E03 | `5d948169`, `a6f2cdc5`                                                                      | `0078`, `0079` | [carteira](seller-clients.md)                                                   |
| WAP-E04 | `07ef190a`, `ad4e6695`, `f5833287`                                                          | —              | [ingresso](seller-whatsapp-inbound.md)                                          |
| WAP-E05 | `37d4d006`                                                                                  | `0080`, `0081` | [Pedido](seller-whatsapp-orders.md)                                             |
| WAP-E06 | `ee89502d`                                                                                  | —              | [Pedido](seller-whatsapp-orders.md)                                             |
| WAP-E07 | `6343a51e`                                                                                  | —              | [validation-pedido](../../.specs/features/seller-whatsapp/validation-pedido.md) |
| WAP-E08 | `5fc03cbd`, `62294117`                                                                      | `0082`, `0083` | [saídas](seller-whatsapp-outbound.md)                                           |
| WAP-E09 | `48d38ca3` … `60f11d42`                                                                     | —              | [carteira](seller-clients.md)                                                   |
| WAP-E10 | `23977ca5` … `aad6f171`                                                                     | —              | [saídas](seller-whatsapp-outbound.md)                                           |
| WAP-E11 | ver [validation-etapa1](../../.specs/features/seller-whatsapp/validation-etapa1.md#commits) | —              | este runbook e o drill                                                          |

E01–E04 estão na master. E05–E12 formam a PR única
[romulosutil/crm-silmer#398](https://github.com/romulosutil/crm-silmer/pull/398),
no branch `codex/wap-e05`.

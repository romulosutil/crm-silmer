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
processo, não por usuário. Os limites
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

| Item                                                           | Estado    | Evidência / responsável                                                                                                                                          |
| -------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags default off e allowlist fail-closed em todos os serviços | local     | teste de prontidão; suítes por fronteira                                                                                                                         |
| Limites numéricos por usuário/serviço                          | local     | ensaio de capacidade; não é capacidade de produção                                                                                                               |
| Matriz da spec, ACL, replay/SSE, QR sem persistência           | local     | validation-etapa1                                                                                                                                                |
| Desligamento, fases e restore sintéticos                       | local     | drill 7/7 ×3                                                                                                                                                     |
| Ensaio integrado do piloto (T05-05/06/07)                      | local     | ensaio 11/11 ×3; [validation-piloto](../../.specs/features/seller-whatsapp/validation-piloto.md)                                                                 |
| Trava de envio pós-restore no código                           | pendente  | P1, decisão de Tech Lead/PO antes do piloto                                                                                                                      |
| Limite de envio por usuário                                    | pendente  | P1 de capacidade, Backend antes de ampliar além de 2                                                                                                             |
| CI verde, merge e migrações em produção                        | feito     | PR 398 em `1489c2fe`; expand `0080`/`0082`/`0083`, contract `0081`; [publicação](../../.specs/features/seller-whatsapp/validation-piloto.md#publicação-18112026) |
| Imagens Evolution/n8n com patch e digest                       | bloqueado | n8n de produção 2.43.7; portar `wap-ingress-patch.mjs` (travado na 2.38.7) antes do piloto                                                                       |
| Spike de provedor e código no mesmo celular (WAP-E01)          | pendente  | E01 aberto; WAP-T05-06 no E12                                                                                                                                    |
| Pareamento mobile, sincronização e eco reais                   | pendente  | WAP-E12                                                                                                                                                          |
| JID da resposta = `+E164` gravado (gate do primeiro envio)     | pendente  | WAP-E12                                                                                                                                                          |
| Restore remoto, RPO/RTO e banco do n8n                         | pendente  | DevOps, [recovery](../../ops/recovery/RUNBOOK.md)                                                                                                                |
| Aprovação operacional, financeira e de Privacidade             | pendente  | PO, Operação e Privacidade                                                                                                                                       |

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
3. Imagens Evolution 2.3.7 e n8n 2.38.7 com os patches WAP, por digest. As
   flags começam desligadas, e os workflows candidatos ficam inativos até o passo 5.
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

| Passo | Item     | Ação real                                                                                                              | Resultado esperado                                                                                                                                                                                                  |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1    | T05-06   | A pareia por QR, em outra tela. B pareia por **código no mesmo celular**.                                              | Uma linha por vendedor. Desafio só na resposta síncrona. Nenhum QR ou código em banco, log ou captura                                                                                                               |
| P1    | T05-06   | Número errado, número já em uso pelo outro vendedor, desafio expirado e repetição do desafio                           | Recusa fixa sem bytes de desafio. A linha não fica `connected` com o número divergente                                                                                                                              |
| P1    | T05-06   | Logout pelo aparelho e reconexão. Depois, callback e evento da geração antiga                                          | Nova geração. Callback repetido: `200 duplicate`. Resultado novo da geração antiga: `200 stale`, linha inalterada. Despacho ou geração divergente: `403`. Evento de entrada antigo: `409 WHATSAPP_GENERATION_STALE` |
| P2    | T05-05   | O cliente sintético escreve para A. A assume como titular humano e cria o Pedido no Assunto alvo. Depois, abre a ficha | Pendente numerado no Contact, conversa, Assunto e responsável corretos. Repetir a chave não duplica                                                                                                                 |
| P2    | T05-05   | A desconecta a linha. Depois, replay do mesmo evento e tentativa de B ou C pelo ID direto                              | Pedido e ficha continuam legíveis para A. Nenhuma duplicata. B e C negados sem vazar metadados                                                                                                                      |
| P3    | T05-06   | Tráfego pelo CRM e pelo aparelho nas duas linhas: texto, mídia, recibos e eco antes do HTTP                            | Uma mensagem por efeito, na conversa da linha certa. Recibos aplicados                                                                                                                                              |
| P3    | T05-06   | Queda do provedor ou do n8n durante um envio                                                                           | `outcome_unknown` reconciliado por leitura. Nenhum reenvio cego                                                                                                                                                     |
| P4    | T05-07   | B vincula o mesmo Contact e edita outro campo. Depois, uma edição concorrente no mesmo campo                           | Mesmo `contactId`. Conflito `409` só no campo disputado. Histórias privadas por carteira                                                                                                                            |
| P4    | T05-07   | B envia a primeira mensagem individual, sem inbound prévio. O cliente sintético responde                               | Resposta na conversa de B, mesmo Contact. **JID da resposta = `+E164` gravado** (gate do primeiro envio)                                                                                                            |
| P4    | T05-07   | Cobrança sintética do Pedido de A, linha offline logo após o envio, callback repetido                                  | Um único comando e um único recebimento. A cobrança sai pela linha de A. Snapshots do Pedido inalterados                                                                                                            |
| P5    | encerrar | Desligar as flags pela ordem do [desligamento](seller-whatsapp-recovery.md#desligamento)                               | Efeitos novos bloqueados. Histórico, ledger e ACL preservados                                                                                                                                                       |

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

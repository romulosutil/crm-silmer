# Piloto da etapa 1 — WAP-E12

WAP-T05-05, WAP-T05-06 e WAP-T05-07, 18/11/2026, branch cumulativo
`codex/wap-e05` (PR única
[romulosutil/crm-silmer#398](https://github.com/romulosutil/crm-silmer/pull/398)),
a partir do E11 `e627c508`. [Spec](spec.md), [design §10](design.md),
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

## Gates do piloto

O go/no-go está no [roteiro](../../../docs/runbooks/seller-whatsapp.md#gono-go-antes-do-primeiro-efeito-real).

| Gate                                                                  | Estado   | Bloqueio / dono                                                  |
| --------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| CI verde do HEAD da PR e merge linear                                 | pendente | GitHub Actions da PR 398; merge é decisão única do proprietário  |
| SHA/digest, `/api/health/ready`, migrações `0077`–`0083`              | pendente | DevOps, depois do merge; `0081` contract só após leitores        |
| Imagens Evolution/n8n com patches WAP por digest                      | pendente | DevOps; hoje só existem builds locais removidos (E01)            |
| Código no mesmo celular (WAP-E01/T01-01)                              | pendente | aberto desde E01; sem ele não há autonomia mobile                |
| Decisões F3 (trava pós-restore) e F4 (limite por usuário)             | pendente | Tech Lead/PO, [validation-etapa1](validation-etapa1.md#findings) |
| Restore remoto, RPO/RTO e banco do n8n                                | pendente | DevOps, [recovery](../../../ops/recovery/RUNBOOK.md)             |
| SHA de rollback, varredura de base dos logs, allowlist só no ambiente | pendente | DevOps/Privacidade, itens 7–9 do go/no-go                        |
| Números dedicados, cliente sintético e janela                         | pendente | Operação                                                         |
| Autorizações do PO, da Operação, da Privacidade e Financeira          | pendente | PO, Operação, Privacidade e Financeiro; cada uma por escrito     |

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

## Findings do ensaio

| ID    | Sev. | Achado                                                                                                                                                                                                      | Estado                                                                |
| ----- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| E12-1 | P2   | Edição recusada de campo compartilhado restrito chegava como `403 INVALID_REQUEST`. `ClientRegistration.vue` só mantém o rascunho e orienta a revisão com o código próprio                                  | corrigido no E03/E09, `cc01938c`                                      |
| E12-2 | P2   | Envio pela Inbox com linha indisponível chegava como `SERVICE_UNAVAILABLE`. A Inbox não dizia que a linha caiu e que o rascunho foi mantido. Com flags off, `/me/clients` também mascarava o código         | corrigido no E04/E08, `cc01938c`                                      |
| E12-3 | P2   | Dois envios concorrentes da ficha em PDF com a mesma chave travavam (`40P01`) por ordem de lock invertida entre conversa e quota. Nunca houve comando duplicado                                             | corrigido no E08, `f18225ff`                                          |
| E12-4 | P2   | Revisão de QA: o gravador da ficha ainda fechava ciclo pelo FK `uploaded_by` → `crm.users` com um envio de mídia da Inbox do mesmo vendedor, em outra aba                                                   | corrigido no E08, `d5384387`                                          |
| E12-5 | P2   | Anterior a este branch: erro sem `statusCode` (por exemplo, erro bruto do PostgreSQL) nas rotas de conversa e de operação caía no handler padrão do Fastify e devolvia `500` com código e mensagem do banco | corrigido, `354a31d3`: handler raiz com corpo genérico; 4xx idênticos |

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
| `cc01938c` | E03/E04   | E12-1 e E12-2: códigos públicos de que a interface depende      |
| `f18225ff` | E08       | E12-3: conversa antes da quota da ficha; 503 genérico nas rotas |
| `d5384387` | E08       | E12-4: usuário, conversa e quota, nessa ordem                   |
| `932f9c7a` | E12       | ensaio local do piloto e passo no job PostgreSQL do CI          |
| `354a31d3` | E12       | E12-5: corpo genérico para 5xx e falhas sem `statusCode`        |

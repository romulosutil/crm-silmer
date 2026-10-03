# Pedidos MVP — Tasks

**Spec:** [`spec.md`](spec.md) · **Decisões:** [`context.md`](context.md) · **Arquitetura:** [`design.md`](design.md)
**Prompts por grupo:** [`PROMPTS.md`](PROMPTS.md)
**Status:** Draft para aprovação

---

## Convenções

- **Uma task = um commit**, Conventional Commits em inglês, no padrão do repo
  (`feat(orders): …`, `test(e2e): …`, `docs(adr): …`).
- **Testes vivem na mesma task** que cria o código. Não existe task só de teste.
- Marcar desvio da spec no código ou no relatório com `SPEC_DEVIATION: <motivo>`.

### Matriz de testes (derivada do repo)

| Camada                                                      | Tipo               | Onde                                                            | Paralelo seguro                  |
| ----------------------------------------------------------- | ------------------ | --------------------------------------------------------------- | -------------------------------- |
| Domínio e aplicação (`modules/*/src/domain`, `application`) | unit (`node:test`) | `test/orders-*.test.js`                                         | Sim                              |
| Rotas e runtime da API (com repositório em memória)         | unit               | `test/order-routes.test.js`, `test/*-runtime*.test.js`          | Sim                              |
| Migration e adapter PostgreSQL                              | integração live    | `test/migrations*.test.js`, `test/orders-postgres-live.test.js` | **Não** (`--test-concurrency=1`) |
| Lib pura do front (`apps/edge-web/src/lib`)                 | unit               | `test/order-format.test.js`                                     | Sim                              |
| Views e componentes Vue                                     | e2e (Playwright)   | `test/e2e/orders.spec.js`, `test/e2e/crm-ui.spec.js`            | **Não**                          |
| Documentação                                                | nenhum             | —                                                               | Sim                              |

### Gates

| Gate   | Comando                                                                                   |
| ------ | ----------------------------------------------------------------------------------------- |
| docs   | `npm run format:check`                                                                    |
| quick  | `node --test <arquivos de teste da task> && npm run lint && npm run typecheck`            |
| live   | `npm run test:orders:live` (mesmo pré-requisito de banco de `npm run test:identity:live`) |
| e2e    | `npm run test:e2e -- <spec>`                                                              |
| full   | `npm run validate`                                                                        |
| online | Execuções do n8n online sem falha no nó novo + pedido conferido no CRM (ver T40)          |

---

## Plano de execução

### Grupos (um prompt por grupo em `PROMPTS.md`)

| Grupo                               | Tasks        | Depende de                                      |
| ----------------------------------- | ------------ | ----------------------------------------------- |
| **A** Contratos e decisão           | T01–T03      | —                                               |
| **B** Domínio e persistência        | T04–T13      | A                                               |
| **C** Autorização, API e tempo real | T14–T20      | B                                               |
| **D** Agente (n8n)                  | T21–T23, T40 | C; a T40 também depende de H e do deploy do CRM |
| **E** Impressão                     | T24–T25      | T04 (B) e T16 (C)                               |
| **F** Tela de Pedidos               | T26–T34      | C, E                                            |
| **G** Caixa de Entrada              | T35–T38      | C, T26 (F)                                      |
| **H** Verificação final             | T39          | todos                                           |

Depois de C: **D, E e o início de F rodam em paralelo**. G começa assim que
T26 estiver no branch base. A **T40** (publicação no n8n online) é a última
task da feature: só roda depois de H e do deploy do CRM em produção.

### Diagrama de dependências

```
A:  T01 ──┬──→ T02
          └──→ T03

B:  T04 ──┬──→ T05 [P] ──┐
          ├──→ T06 [P] ──┴──→ T07 ──→ T08 ──→ T09 ──→ T10 ──→ T11
          └──→ T12 ─────────────────────┐
                              T08 ──────┴──→ T13

C:  T01 ──→ T14 [P]
    T11, T13, T14 ──→ T15 ──→ T16 ──→ T17 ──→ T18
    T13 ──→ T19
    T13 ──→ T20

D:  T15 ──→ T21 ──→ T22
    T21, T02 ──→ T23
    T23, T39, deploy do CRM ──→ T40

E:  T04 ──→ T24 [P]
    T16, T24 ──→ T25

F:  T03 ──→ T26 [P]
    T27 [P]
    T16, T19, T26, T27 ──→ T28
    T25, T28 ──→ T29
    T17, T29 ──→ T30 ──→ T31 ──→ T32 ──→ T33
    T18, T33 ──→ T34

G:  T20, T26 ──→ T35 ──→ T36
    T16, T17, T26 ──→ T37
    T19, T36, T37 ──→ T38

H:  T23, T34, T38 ──→ T39
```

---

## Grupo A — Contratos e decisão

### T01: Registrar ADR 006 — Pedido com dois status

- **What:** Criar a ADR que introduz o Pedido (Pendente/Confirmado), a criação pelo agente como rascunho não oficial e a confirmação humana; marcar a ADR 004 como parcialmente supersedida.
- **Where:** `docs/adr/006-pedido-dois-status.md` (novo), `docs/adr/004-aposentar-kanban-e-negocio.md` (linha de status)
- **Depends on:** —
- **Reuses:** formato de `docs/adr/004-aposentar-kanban-e-negocio.md`
- **Requirement:** PCL-01, PCL-08, PAG-01, PAG-02, PAG-03

**Done when:**

- [x] ADR 006 registra D01–D09 e D24 de `context.md`
- [x] ADR 004 aponta para a 006 sem alterar a decisão original
- [x] Gate docs passa

**Tests:** none · **Gate:** docs · **Commit:** `docs(adr): introduce orders with two human-confirmed statuses`

### T02: Atualizar o contrato n8n ↔ CRM

- **What:** Documentar o evento `order.intent_confirmed`, a projeção do `briefing_patch` no pedido pendente e remover a afirmação sobre endpoints de conversão/campos/transição que não existem mais.
- **Where:** `docs/integrations/n8n/README.md`
- **Depends on:** T01
- **Reuses:** seções "Contrato n8n → CRM" e "Briefing, conversão e handoff"
- **Requirement:** PAG-01, PAG-02, PAG-03, PCL-01

**Done when:**

- [x] Payload, cabeçalhos e idempotência do novo evento descritos
- [x] Regra "patch ignorado quando a conversa está com vendedor" descrita
- [x] Nenhuma menção a endpoints inexistentes
- [x] Gate docs passa

**Tests:** none · **Gate:** docs · **Commit:** `docs(n8n): describe order intent event and briefing projection`

### T03: Adicionar os caminhos de pedido ao OpenAPI [P]

- **What:** Descrever as oito rotas de `design.md` → `order-routes`, esquemas `Order`, `Ficha`, `FichaItem` e erros.
- **Where:** `docs/api/openapi.v1.yaml`
- **Depends on:** T01
- **Reuses:** esquemas e respostas de erro já definidos no arquivo
- **Requirement:** PLI-02, PFI-01, PFI-06, PCL-04, PCL-07, PCL-10, PIM-02, PCX-07

**Done when:**

- [x] Oito operações com parâmetros, `expectedVersion`, `Idempotency-Key` e códigos 403/404/409/422
- [x] Rotas mortas de Kanban/Negócio **não** são alteradas (limpeza adiada)
- [x] `npm test` passa (inclui validações de contrato existentes, se houver)

**Tests:** none · **Gate:** docs + `npm test` · **Commit:** `docs(api): add order endpoints to OpenAPI`

---

## Grupo B — Domínio e persistência

### T04: Criar o workspace `modules/orders`

- **What:** Pacote ESM vazio com `src/index.js`, registrado nos workspaces e no `jsconfig.json`.
- **Where:** `modules/orders/package.json`, `modules/orders/src/index.js`, `package.json` (workspaces), `jsconfig.json`
- **Depends on:** T01
- **Reuses:** `modules/inbox-channels/package.json`
- **Requirement:** — (fundação)

**Done when:**

- [ ] `npm run check:boundaries` e `npm run typecheck` passam

**Tests:** none · **Gate:** `npm run check:boundaries && npm run typecheck` · **Commit:** `chore(orders): scaffold orders module`

### T05: Valor em reais [P]

- **What:** `parseBrlAmount(text)` → centavos e `formatBrlAmount(cents)`; recusa formato inválido, zero e negativo.
- **Where:** `modules/orders/src/domain/money.js`, `test/orders-money.test.js`
- **Depends on:** T04
- **Requirement:** PFI-11

**Done when:**

- [ ] `4.820,00` → `482000`; `4820` → `482000`; `4,820.00`, `abc`, `0`, `-1` → erro
- [ ] Gate quick passa com os testes novos

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): parse and format BRL amounts`

### T06: Ficha — validação, totais e mapeamento da pré-ficha [P]

- **What:** `validateSummary`, `validateItems`, `validateObservations`, `itemTotal`, `orderTotal`, `briefingToFicha`.
- **Where:** `modules/orders/src/domain/ficha.js`, `test/orders-ficha.test.js`
- **Depends on:** T04
- **Reuses:** forma de `docs/phase0/ficha-pdf-synthetic.json`; chaves da pré-ficha em `docs/integrations/n8n/README.md`
- **Requirement:** PFI-02, PFI-03, PFI-04, PFI-05, PFI-07, PFI-08

**Done when:**

- [ ] Item exige ≥1 malha e ≥1 linha de grade com quantidade inteira > 0
- [ ] "NAO APLICAVEL" aceito em mangas e viés
- [ ] Observações: 0..5 linhas
- [ ] Snapshot sintético gera total 32
- [ ] Campos da pré-ficha sem lugar na ficha vão para `serviceData`
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): validate ficha sections and compute totals`

### T07: Agregado Pedido

- **What:** `ORDER_STATUSES`, `PAYMENT_CONDITIONS`, `formatOrderNumber`, `confirmOrder`, `reopenOrder`, `missingForConfirmation`.
- **Where:** `modules/orders/src/domain/order.js`, `test/orders-domain.test.js`
- **Depends on:** T05, T06
- **Requirement:** PCL-04, PCL-05, PCL-07, PCL-08, PCL-12, PFI-09, PFI-12

**Done when:**

- [ ] `formatOrderNumber(1)` → `01-CRM`; `105` → `105-CRM`
- [ ] Confirmar exige valor > 0, condição válida e ≥1 item com grade (A01); grava data, autor e horário
- [ ] Reabrir só a partir de `confirmado`; mantém número, valor e condição; registra autor e horário
- [ ] Nova confirmação sobrescreve autor, horário e data (PCL-12)
- [ ] Nenhuma outra transição possível
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): model order confirmation and reopening`

### T08: Porta do repositório e implementação em memória

- **What:** Contrato `OrderRepository` e `InMemoryOrderRepository` com índice "um pendente por conversa" e versão otimista.
- **Where:** `modules/orders/src/ports/contracts.js`, `modules/orders/src/adapters/in-memory-order-repository.js`, `test/orders-repository-contract.test.js`
- **Depends on:** T07
- **Reuses:** `modules/inbox-channels/src/adapters/in-memory-inbox-repository.js`
- **Requirement:** PCL-02, PCL-09

**Done when:**

- [ ] Segundo pendente na mesma conversa é recusado
- [ ] Escrita com versão antiga lança conflito
- [ ] Suíte de contrato exportável para reuso em T13
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): define repository port with in-memory adapter`

### T09: Serviço — criação e projeção do agente

- **What:** `ensurePendingFromIntent`, `createManual`, `projectAgentBriefing` em `OrderService`.
- **Where:** `modules/orders/src/application/order-service.js`, `test/orders-service-create.test.js`
- **Depends on:** T08
- **Requirement:** PCL-01, PCL-02, PCL-03, PCL-10, PCL-11, PAG-01, PAG-02

**Done when:**

- [ ] Intenção sem pendente cria; com pendente devolve o existente; só confirmados → cria novo
- [ ] Criação manual pré-preenche com a pré-ficha
- [ ] Projeção só aplica com `automationState = 'assistant'`
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): create pending orders from intent and briefing`

### T10: Serviço — edição por seção, confirmar e reabrir

- **What:** `patchSection`, `confirm`, `reopen` com checagem de posse injetada.
- **Where:** `modules/orders/src/application/order-service.js`, `test/orders-service-commands.test.js`
- **Depends on:** T09
- **Requirement:** PFI-06, PFI-10, PCL-04, PCL-05, PCL-06, PCL-07, PCL-09, PCL-12

**Done when:**

- [ ] Seção inteira substituída e `total_pieces`/`missing_fields` recalculados
- [ ] Edição em pedido confirmado recusada
- [ ] Não dono e não admin → erro de permissão
- [ ] Conflito de versão propagado
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): edit sections, confirm and reopen orders`

### T11: Serviço — leituras

- **What:** `get`, `list({status, query, cursor, limit})`, `currentForConversation`.
- **Where:** `modules/orders/src/application/order-service.js`, `test/orders-service-read.test.js`
- **Depends on:** T10
- **Requirement:** PLI-02, PLI-03, PLI-04, PLI-05, PLI-06, PLI-07, PCX-07

**Done when:**

- [ ] Filtro por status, busca, paginação por cursor
- [ ] `currentForConversation` devolve o pendente ou, se não houver, o último confirmado
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): read and list orders`

### T12: Migration `0023_orders.expand.sql`

- **What:** Sequência, tabela `crm.orders`, restrições e índices de `design.md` → Modelo de dados.
- **Where:** `modules/database/migrations/0023_orders.expand.sql`, `test/migrations.test.js` (e `test/migrations-live.test.js` se listar migrations)
- **Depends on:** T04
- **Requirement:** PCL-02, PCL-04, PCL-09

**Done when:**

- [ ] `npm run test:database` passa
- [ ] Teste live confirma índice parcial de pendente e a restrição de campos do confirmado
- [ ] Nenhuma tabela `crm.deals*` referenciada

**Tests:** integração live · **Gate:** `npm run test:database && npm run test:database:live` · **Commit:** `feat(database): add orders table and number sequence`

### T13: Repositório PostgreSQL de pedidos

- **What:** `PostgresOrderRepository` com `ficha_envelope` cifrado e `crm.domain_events` (`aggregate_type='order'`) na mesma transação; script `test:orders:live`.
- **Where:** `modules/orders/src/adapters/postgres-order-repository.js`, `test/orders-postgres-live.test.js`, `package.json` (script)
- **Depends on:** T08, T12
- **Reuses:** `encryptJson`/`decryptJson` (padrão de `modules/n8n-integration/src/crypto.js`); suíte de contrato de T08
- **Requirement:** PCL-01, PCL-02, PCL-09, PLI-08

**Done when:**

- [ ] Suíte de contrato de T08 roda contra PostgreSQL e passa
- [ ] Nenhum dado pessoal em coluna aberta
- [ ] Evento gravado em toda escrita
- [ ] Gate live passa

**Tests:** integração live · **Gate:** live · **Commit:** `feat(orders): persist orders in PostgreSQL`

---

## Grupo C — Autorização, API e tempo real

### T14: Ações de pedido na allowlist [P]

- **What:** `order.read`, `order.create`, `order.edit`, `order.confirm`, `order.reopen`, `order.print` (operacionais) e `order.intent` (automação).
- **Where:** `modules/identity-access/src/authorization.js`, `apps/api/src/automation-credentials.js` (se as ações de automação vivem lá), `test/identity-authorization.test.js`
- **Depends on:** T01
- **Requirement:** PAU-01, PCL-06, PIM-05

**Done when:**

- [ ] Ações existem **só** na allowlist única
- [ ] `order.intent` indisponível para usuários humanos
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(identity): authorize order actions`

### T15: Runtime de pedidos e composição na API

- **What:** `createOrderRuntime` compondo serviço + repositório PostgreSQL + checagem de posse (dono da conversa ou `COMMERCIAL_ADMIN`); registro em `app.js`.
- **Where:** `apps/api/src/order-runtime.js`, `apps/api/src/app.js`, `apps/api/src/commercial-runtime.js`, `test/order-runtime.test.js`
- **Depends on:** T11, T13, T14
- **Reuses:** composição de `conversation-runtime.js`
- **Requirement:** PAU-01, PCL-06

**Done when:**

- [ ] Posse resolvida pela conversa em cada comando
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): compose orders runtime`

### T16: Rotas de leitura de pedido

- **What:** `GET /orders`, `GET /orders/:orderId`, `GET /conversations/:conversationId/order`.
- **Where:** `apps/api/src/order-routes.js`, `test/order-routes.test.js`
- **Depends on:** T15
- **Reuses:** `respond`, `rejectUnknownKeys` de `conversation-routes.js`
- **Requirement:** PLI-02, PLI-03, PLI-04, PLI-05, PLI-06, PLI-07, PFI-01, PCX-07

**Done when:**

- [ ] Parâmetros desconhecidos → 400; pedido inexistente → 404
- [ ] Resposta segue o tipo `Order` de `design.md`
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): expose order read endpoints`

### T17: Rotas de criação e edição por seção

- **What:** `POST /conversations/:conversationId/orders`, `PATCH /orders/:orderId/sections/:section`.
- **Where:** `apps/api/src/order-routes.js`, `test/order-routes.test.js`
- **Depends on:** T16
- **Requirement:** PCL-10, PCL-11, PFI-06, PAU-01

**Done when:**

- [ ] `Idempotency-Key` e `expectedVersion` obrigatórios
- [ ] 403 fora da posse; 409 versão; 422 validação com campos
- [ ] Criar com pendente existente → 200 com o existente
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): create orders and edit sections`

### T18: Rotas de confirmar e reabrir

- **What:** `POST /orders/:orderId/confirm`, `POST /orders/:orderId/reopen`.
- **Where:** `apps/api/src/order-routes.js`, `test/order-routes.test.js`
- **Depends on:** T17
- **Requirement:** PCL-04, PCL-05, PCL-06, PCL-07, PCL-09, PCL-12

**Done when:**

- [ ] 422 `ORDER_NOT_CONFIRMABLE` com `fields[]`
- [ ] Confirmações concorrentes: uma 200, outra 409
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): confirm and reopen orders`

### T19: Evento ao vivo `inbox.order.changed`

- **What:** `readLiveEvents` mapeia `aggregate_type='order'` para `inbox.order.changed` com `{orderId, conversationId}`.
- **Where:** `apps/api/src/operation-runtime.js`, `test/operation-runtime.test.js` (ou o teste que cobre `readLiveEvents`)
- **Depends on:** T13
- **Requirement:** PLI-08

**Done when:**

- [ ] Eventos de conversa e contato continuam iguais
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): stream order changes`

### T20: Leitura do inbox — Aguardando vendedor, motivo e pedido

- **What:** `listInbox` aceita `pendingHandoff`; cada conversa inclui `handoff.reasonCode`, `handoff.createdAt` e `order {id, number, status} | null`; ordenação por `handoff.createdAt` quando `pendingHandoff=true`.
- **Where:** `apps/api/src/operation-runtime.js`, `modules/inbox-channels/src/adapters/postgres-inbox-read-repository.js`, `test/operation-read-postgres-live.test.js`
- **Depends on:** T13
- **Requirement:** PCX-02, PCX-03, PCX-04, PCX-06

**Done when:**

- [ ] Filtros existentes (`assignedUserId`, `archived`, `automationState`, `unassignedHumanHandoff`) intactos
- [ ] `npm run test:operation-read:live` passa

**Tests:** integração live · **Gate:** `npm run test:operation-read:live && npm run lint` · **Commit:** `feat(inbox): expose waiting handoffs and order summary`

---

## Grupo D — Agente (n8n)

### T21: Evento `order.intent_confirmed` no endpoint do n8n

- **What:** `EVENT_ACTIONS['order.intent_confirmed'] = 'order.intent'` e chamada a `ensurePendingFromIntent`.
- **Where:** `apps/api/src/n8n-routes.js`, `apps/api/src/n8n-runtime.js`, `test/n8n-routes.test.js` (ou o teste existente das rotas n8n)
- **Depends on:** T15
- **Requirement:** PCL-01, PCL-02, PCL-03

**Done when:**

- [ ] Mesmo evento com a mesma `Idempotency-Key` não duplica
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(n8n): accept order intent events`

### T22: Projetar a pré-ficha no pedido pendente

- **What:** Após `#mergeBriefing`, projetar no pendente só com `automation_state='assistant'`; campos de preço, pagamento e status continuam recusados.
- **Where:** `modules/n8n-integration/src/postgres-repository.js`, `test/n8n-postgres-live.test.js` (ou o teste live existente do módulo)
- **Depends on:** T21
- **Requirement:** PAG-01, PAG-02, PAG-03

**Done when:**

- [ ] Conversa humana: patch não altera o pedido
- [ ] Gate live do módulo passa

**Tests:** integração live · **Gate:** teste live do módulo + `npm run lint` · **Commit:** `feat(n8n): project briefing into pending order`

### T23: Workflow emite a intenção de compra

- **What:** O workflow MVP envia `order.intent_confirmed` quando o cliente confirma que quer orçamento (roteiro 5.1 de `CAMPOS-FICHA-E-JORNADA-P0-1.md`). O nó que envia o evento não pode bloquear a resposta ao cliente: se o CRM recusar, o fluxo segue e registra a falha.
- **Where:** `ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js`, exports gerados (`render-mvp-workflow.mjs`, `*.sanitized.json`) e o workflow DEV derivado (`create-dev-test-workflow.mjs`)
- **Depends on:** T21, T02
- **Requirement:** PCL-01

**Done when:**

- [ ] Teste existente do workflow cobre o novo nó; se não houver teste do SDK, criar asserção sobre o nó que emite o evento
- [ ] Teste cobre o caminho de falha: recusa do CRM não impede a mensagem ao cliente
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(n8n): emit order intent from MVP workflow`

### T40: Publicar o fluxo no n8n online

- **What:** Levar o fluxo de T23 para a instância online do n8n: primeiro o workflow DEV `0S5ZS1xeDCSoWovs`, com teste ponta a ponta; depois o de produção `k7tI6T4RhQPyJkn9`, deixando a criação do pedido automática. Guardar a versão anterior de cada workflow para rollback e acompanhar as primeiras execuções.
- **Where:** instância n8n online, pelo conector MCP do n8n (detalhes, versões, diff, atualizar, publicar, restaurar, execuções); `ops/n8n/workflows/*.sanitized.json` sincronizados com o que foi publicado
- **Depends on:** T23, T39 e o deploy em produção da versão do CRM que contém T21 e T22
- **Requirement:** PCL-01, PAG-01

**Done when:**

- [ ] Id da versão ativa de cada workflow anotado antes de qualquer alteração
- [ ] Confirmado para qual CRM cada workflow aponta; nenhum dos dois é alterado enquanto o CRM de destino não aceitar `order.intent_confirmed`
- [ ] DEV publicado e testado: conversa sintética confirma a intenção e o pedido pendente aparece no CRM de destino, com a pré-ficha projetada
- [ ] Diff DEV × produção revisado; só os nós da intenção de pedido mudam
- [ ] Aprovação explícita do responsável obtida imediatamente antes de publicar produção
- [ ] Produção publicada; nenhuma falha ligada ao nó novo nas primeiras 20 execuções ou 2 horas, o que vier primeiro
- [ ] Primeiro pedido real criado pelo agente conferido na lista de Pedidos
- [ ] Qualquer falha em produção dispara a restauração da versão anotada
- [ ] Exports sanitizados no repositório batem com o publicado e não contêm credenciais

**Tests:** none (operação) · **Gate:** online · **Commit:** `chore(n8n): sync published MVP workflow export`

---

## Grupo E — Impressão

### T24: Extrair o renderer do template v2 [P]

- **What:** Mover `buildFichaHtml` e o CSS para `renderFichaHtml(snapshot, {synthetic})`; o script de revisão importa daqui.
- **Where:** `modules/orders/src/print/ficha-canonical-v2.js`, `scripts/ficha-pdf-review.mjs`, `test/ficha-pdf-review.test.js`
- **Depends on:** T04
- **Requirement:** PIM-02, PIM-04

**Done when:**

- [ ] Teste golden: saída com `synthetic:true` idêntica à anterior para o snapshot sintético
- [ ] `synthetic:false` remove só a faixa de amostra
- [ ] `npm run validate:ficha-pdf-review` passa (hashes aprovados intactos)

**Tests:** unit · **Gate:** `npm run test:ficha-pdf-review && npm run validate:ficha-pdf-review` · **Commit:** `refactor(orders): extract approved ficha v2 renderer`

### T25: Rota de impressão

- **What:** `GET /orders/:orderId/print` monta o snapshot a partir do pedido e devolve HTML A4 paisagem; 409 se pendente.
- **Where:** `apps/api/src/order-routes.js`, `test/order-routes.test.js`
- **Depends on:** T16, T24
- **Requirement:** PIM-02, PIM-03, PIM-05

**Done when:**

- [ ] Documento sem valor e sem condição de pagamento
- [ ] `vendedor` = quem confirmou; `data` = data do pedido; produção em branco
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): print confirmed orders`

---

## Grupo F — Tela de Pedidos

### T26: Formatação de pedido no front [P]

- **What:** Rótulos de status, condição e motivo (A03), `parseBrl`/`formatBrl`, "o que falta", tempo parado (A02).
- **Where:** `apps/edge-web/src/lib/order-format.js`, `test/order-format.test.js`
- **Depends on:** T03
- **Requirement:** PFI-11, PFI-12, PLI-05, PCX-03

**Done when:**

- [ ] Todos os `reason_code` de `0013` têm rótulo
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(edge-web): format order labels and amounts`

### T27: Rotas e item "Pedidos" no menu [P]

- **What:** `/pedidos` e `/pedidos/:orderId`; item "Pedidos" após "Caixa de Entrada" na sidebar e no menu móvel, ativo em `/pedidos/*`.
- **Where:** `apps/edge-web/src/router.js`, `apps/edge-web/src/App.vue`, `test/e2e/foundation.spec.js`
- **Depends on:** —
- **Requirement:** PLI-01, PGE-01

**Done when:**

- [ ] e2e verifica a ordem do menu e o item ativo
- [ ] Gate e2e passa

**Tests:** e2e · **Gate:** e2e (`test/e2e/foundation.spec.js`) · **Commit:** `feat(edge-web): add orders navigation`

### T28: Lista de Pedidos

- **What:** `OrdersView` com filtro, busca, grupos Confirmados/Pendentes, colunas, ações, "Ver mais" e atualização por `inbox.order.changed`.
- **Where:** `apps/edge-web/src/views/OrdersView.vue`, `apps/edge-web/src/screen-styles.css`, `test/e2e/orders.spec.js`
- **Depends on:** T16, T19, T26, T27
- **Reuses:** `.data-table`, `.badge`, `.filter-bar`, `.chip`; padrão de `ClientsView.vue`
- **Requirement:** PLI-02, PLI-03, PLI-04, PLI-05, PLI-06, PLI-07, PLI-08

**Done when:**

- [ ] "Imprimir" só em confirmados; "Continuar" só em pendentes
- [ ] `npm run check:design-tokens` passa
- [ ] Gate e2e passa

**Tests:** e2e · **Gate:** e2e (`test/e2e/orders.spec.js`) · **Commit:** `feat(edge-web): list orders by status`

### T29: Página do pedido — estrutura

- **What:** `OrderView` com rastro, cabeçalho, banner do que falta, "Imprimir" travado/liberado, controle `editingSection`, modo leitura para quem não é dono, SSE.
- **Where:** `apps/edge-web/src/views/OrderView.vue`, `apps/edge-web/src/screen-styles.css`, `test/e2e/orders.spec.js`
- **Depends on:** T25, T28
- **Requirement:** PFI-01, PFI-09, PFI-10, PIM-01, PGE-01, PAU-01

**Done when:**

- [ ] Menu ativo "Pedidos"; rastro mostra a origem quando vem da conversa
- [ ] Imprimir desabilitado com o motivo em pendente
- [ ] Gate e2e passa

**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(edge-web): add order page shell`

### T30: Seção Resumo do pedido

- **What:** Leitura/edição do resumo; cliente bloqueado com selo "vem da conversa"; data do pedido "definida na confirmação" (corrige o texto do mockup, D14).
- **Where:** `apps/edge-web/src/components/order/OrderSummarySection.vue`, `test/e2e/orders.spec.js`
- **Depends on:** T17, T29
- **Requirement:** PFI-02

**Done when:** [ ] editar e salvar aparece na lista · [ ] Gate e2e passa
**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(edge-web): edit order summary`

### T31: Seção Itens e especificações

- **What:** Cartões por item, editor de malhas e grade, totais calculados, "Não aplicável".
- **Where:** `apps/edge-web/src/components/order/OrderItemsSection.vue`, `test/e2e/orders.spec.js`
- **Depends on:** T30
- **Requirement:** PFI-03, PFI-04, PFI-07

**Done when:** [ ] quantidade inválida mostra erro na linha · [ ] totais batem · [ ] Gate e2e passa
**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(edge-web): edit order items and grade`

### T32: Seção Observações

- **What:** Lista numerada, 0..5 linhas.
- **Where:** `apps/edge-web/src/components/order/OrderObservationsSection.vue`, `test/e2e/orders.spec.js`
- **Depends on:** T31
- **Requirement:** PFI-05

**Done when:** [ ] sexta linha bloqueada · [ ] Gate e2e passa
**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(edge-web): edit order observations`

### T33: Faixas de produção e dados do atendimento

- **What:** "Controle de produção" (informativo) e "Dados do atendimento" (leitura, não impresso).
- **Where:** `apps/edge-web/src/components/order/OrderInfoStrips.vue`, `test/e2e/orders.spec.js`
- **Depends on:** T32
- **Requirement:** PFI-01, PFI-08

**Done when:** [ ] ordem das seções igual a PFI-01 · [ ] Gate e2e passa
**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(edge-web): show production and service data strips`

### T34: Fechamento — Confirmar e Reabrir

- **What:** Valor com prefixo `R$`, condição (Pix/Cartão de crédito/Cartão de débito), "Confirmar pedido" como único primário, erros por campo, "Reabrir pedido".
- **Where:** `apps/edge-web/src/components/order/OrderClosingSection.vue`, `test/e2e/orders.spec.js`
- **Depends on:** T18, T33
- **Requirement:** PCL-04, PCL-05, PCL-06, PCL-07, PFI-11, PFI-12, PFI-13

**Done when:**

- [ ] Jornada e2e: confirmar → Imprimir libera → reabrir → Imprimir trava
- [ ] Usuário sem posse não vê Confirmar/Reabrir
- [ ] Gate e2e passa

**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(edge-web): confirm and reopen orders`

---

## Grupo G — Caixa de Entrada

### T35: Filtro "Estado" no lugar de "Situação"

- **What:** Remover o menu "Situação" e o bloco "Sugestão pendente da IA"; adicionar "Estado": Todas · Aguardando vendedor · Com o agente · Com vendedor (`pendingHandoff`/`automationState`). Fila, arquivar e repassar intactos.
- **Where:** `apps/edge-web/src/views/InboxView.vue`, `apps/edge-web/src/screen-styles.css`, `test/e2e/crm-ui.spec.js`
- **Depends on:** T20, T26
- **Requirement:** PCX-01, PCX-02, PCX-05

**Done when:**

- [ ] e2e cobre os quatro estados combinados com a fila Minhas e com arquivadas
- [ ] Gate e2e passa

**Tests:** e2e · **Gate:** e2e (`test/e2e/crm-ui.spec.js`) · **Commit:** `feat(inbox): filter conversations by who must act`

### T36: Motivo da parada e ordenação por tempo parado

- **What:** Badge do motivo e tempo parado nas conversas com handoff pendente; ordenação por tempo parado em "Aguardando vendedor".
- **Where:** `apps/edge-web/src/views/InboxView.vue`, `test/e2e/crm-ui.spec.js`
- **Depends on:** T35
- **Requirement:** PCX-03, PCX-04

**Done when:** [ ] conversa mais antiga no topo · [ ] Gate e2e passa
**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(inbox): show stop reason and waiting time`

### T37: Gaveta do pedido

- **What:** `OrderDrawer` com número, status, o que falta, itens, total, valor, "Abrir pedido" e "Criar pedido"; fecha com Esc/clique fora e devolve foco.
- **Where:** `apps/edge-web/src/components/order/OrderDrawer.vue`, `test/e2e/crm-ui.spec.js`
- **Depends on:** T16, T17, T26
- **Reuses:** padrões de `dialog` e foco de `lib/ui.js`
- **Requirement:** PCX-07, PCX-08, PCX-09, PCL-10, PCL-11

**Done when:** [ ] navegação só por teclado funciona · [ ] Gate e2e passa
**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(inbox): add order drawer`

### T38: Botão "Pedido" no cabeçalho da conversa

- **What:** Botão com status (Pendente/Confirmado/Sem pedido) que abre a gaveta; atualiza com `inbox.order.changed`.
- **Where:** `apps/edge-web/src/views/InboxView.vue`, `test/e2e/crm-ui.spec.js`
- **Depends on:** T19, T36, T37
- **Requirement:** PCX-06, PLI-08

**Done when:** [ ] confirmar na página muda o status do botão sem recarregar · [ ] Gate e2e passa
**Tests:** e2e · **Gate:** e2e · **Commit:** `feat(inbox): open order drawer from conversation`

---

## Grupo H — Verificação final

### T39: Validação completa e rastreabilidade

- **What:** Rodar gate full e e2e completo; atualizar a tabela de rastreabilidade de `spec.md` para `Verified`; registrar desvios.
- **Where:** `.specs/features/pedidos-mvp/spec.md`
- **Depends on:** T23, T34, T38
- **Requirement:** todos

**Done when:**

- [x] `npm run validate` passa
- [x] `npm run test:e2e` passa
- [x] `npm run test:orders:live` passa
- [x] Nenhum requisito sem evidência

**Tests:** full · **Gate:** full · **Commit:** `docs(specs): verify orders MVP traceability`

---

## Grupo I — Lastro de datas do pedido (ADR 008)

Decidido pelo PO em 29/09/2026. As tasks T41–T46 partem de `master`; T47 vai no
branch `feat/ficha-por-produto`, antes da aprovação da v3 (T15 daquele branch).

### T41: ADR 008 e requisitos do lastro

- **What:** Registrar a decisão, os requisitos PLA-01..09, as decisões D27–D31, o desenho e estas tasks; marcar a ADR 006 como parcialmente supersedida.
- **Where:** `docs/adr/008-lastro-de-datas-do-pedido.md`, `docs/adr/006-pedido-dois-status.md`, `.specs/features/pedidos-mvp/{spec,context,design,tasks}.md`
- **Depends on:** —
- **Requirement:** PLA-01..09

**Done when:**

- [x] ADR 008 aceita e ligada à spec, ao contexto e às tasks
- [x] PFI-01 e PFI-10 apontam a exceção do lastro

**Tests:** none · **Gate:** docs · **Commit:** `docs(adr): record the order date trail`

### T42: Guardar primeiro contato, pagamento e entrega

- **What:** Migration `0024` com as três colunas e o backfill do primeiro contato; `recordMilestones` no domínio; `saveMilestones` na porta e nos dois adapters; o serviço copia a abertura da conversa na criação.
- **Where:** `modules/database/migrations/0024_order_milestones.expand.sql`, `modules/orders/src/**`, `test/orders-{domain,service-create,service-commands,repository-contract,postgres-live}.test.js`, `test/migrations-live.test.js`
- **Depends on:** T41
- **Requirement:** PLA-02, PLA-04, PLA-05, PLA-06

**Done when:**

- [x] Contrato do repositório passa em memória e no PostgreSQL
- [x] Backfill testado entre `0023` e `0024`
- [x] `npm run test:orders:live` passa

**Tests:** unit + integração live · **Gate:** quick + live · **Commit:** `feat(orders): keep first contact, paid and delivered days`

### T43: Rota do lastro

- **What:** `PATCH /api/v1/orders/:orderId/milestones` com a ação `order.milestones`, auditoria e idempotência; `firstContactAt`, `paidOn` e `deliveredOn` no contrato `Order`; OpenAPI.
- **Where:** `apps/api/src/order-{routes,runtime}.js`, `modules/identity-access/src/authorization.js`, `docs/api/openapi.v1.yaml`, `test/order-{routes,runtime}.test.js`, `test/identity-authorization.test.js`
- **Depends on:** T42
- **Requirement:** PLA-04, PLA-05, PLA-06, PLA-07

**Done when:**

- [x] 200 em pedido confirmado sem reabrir; 400, 403, 409 e 422 cobertos
- [x] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): record paid and delivered days`

### T44: Entrega confirmada em dd/mm/aaaa na v2

- **What:** O snapshot impresso formata a entrega confirmada como a data do pedido; o template v2 não muda.
- **Where:** `apps/api/src/order-routes.js`, `test/order-routes.test.js`
- **Depends on:** —
- **Requirement:** PLA-09

**Done when:**

- [x] `npm run validate:ficha-pdf-review` passa (hashes aprovados intactos)

**Tests:** unit · **Gate:** quick · **Commit:** `fix(api): print the confirmed delivery as dd/mm/aaaa`

### T45: Seção "Lastro do pedido"

- **What:** Linha do tempo das cinco datas logo depois do Resumo; "Editar" para dono e admin em qualquer status; erro junto ao campo para dia futuro ou recusado.
- **Where:** `apps/edge-web/src/components/order/OrderMilestonesSection.vue`, `apps/edge-web/src/views/OrderView.vue`, `apps/edge-web/src/lib/order-format.js`, `apps/edge-web/src/screen-styles.css`, `test/order-format.test.js`, `test/e2e/orders.spec.js`
- **Depends on:** T43
- **Requirement:** PLA-01, PLA-03, PLA-04, PLA-05, PLA-07

**Done when:**

- [x] Teclado: "Editar" leva o foco a "Pago em"; Salvar e Cancelar funcionam
- [x] axe sem violações
- [x] Desktop e 390 px conferidos

**Tests:** unit + e2e · **Gate:** quick + e2e · **Commit:** `feat(edge-web): show the order date trail`

### T46: Verificação do lastro

- **What:** Rodar os gates completos e registrar a rastreabilidade PLA em `spec.md`.
- **Where:** `.specs/features/pedidos-mvp/spec.md`
- **Depends on:** T42–T45
- **Requirement:** PLA-01..07, PLA-09

**Done when:**

- [x] `npm run validate`, `npm run test:e2e` e `npm run test:orders:live` passam

**Tests:** full · **Gate:** full · **Commit:** `docs(specs): trace the order date trail to its tests`

### T47: Lastro na ficha v3

> **Superada em 02/10/2026 pela [T63](#t63-template-v3-e-pacote-de-revisão)
> ([ADR 017](../../../docs/adr/017-ficha-impressa-com-os-sete-pontos.md)).**
> A v3 por produto não foi aprovada; o lastro entra na v3 com os sete pontos.
> O branch `feat/ficha-por-produto` não é mais a base.

- **What:** A v3 imprime as cinco datas no resumo da página 1; PDF sintético v3 gerado de novo e registro de aprovação ainda pendente.
- **Where:** branch `feat/ficha-por-produto`: `modules/orders/src/print/{ficha-canonical-v3,print-snapshot}.js`, `docs/phase0/ficha-pdf-synthetic-v3.json`, `output/pdf/ficha-canonica-sintetica-v3.pdf`, testes da v3
- **Depends on:** T43 (nomes dos campos), T15 da ficha por produto ainda aberta
- **Requirement:** PLA-08

**Done when:**

- [ ] Rose e Operação aprovam a v3 com o lastro (T15 da ficha por produto)

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): print the date trail on ficha v3`

## Grupo J — Ajustes da página do pedido (30/09/2026)

Pedidos do PO ao revisar a tela do lastro.

### T48: Rótulos do Resumo

- **What:** Na tela, "Entrega confirmada" vira "Entrega prometida" e "Aplicação" vira "Tipo de serviço", no Resumo, no banner do que falta, no diálogo de gerar e no lastro. Campos da API e ficha v2 impressa não mudam.
- **Where:** `apps/edge-web/src/components/order/{OrderSummarySection,OrderClosingSection}.vue`, `apps/edge-web/src/views/OrderView.vue`, `apps/edge-web/src/lib/order-format.js`, `test/order-format.test.js`, `test/e2e/orders.spec.js`
- **Depends on:** T45
- **Requirement:** PFI-02, PFI-09, PLA-03

**Done when:**

- [x] Resumo, banner, diálogo de gerar e lastro usam os rótulos novos
- [x] Ficha v2 impressa sem mudança

**Tests:** unit + e2e · **Gate:** quick + e2e · **Commit:** `fix(edge-web): name the summary fields as the PO asked`

### T49: Campos só de texto

- **What:** Resumo e itens sem lista de opções: some o `datalist` do catálogo e a seta dos campos; tudo é digitado à mão. A amostra de cor ao lado da cor digitada continua.
- **Where:** `apps/edge-web/src/components/order/{OrderSummarySection,OrderItemsSection}.vue`, `apps/edge-web/src/views/OrderView.vue`, `apps/edge-web/src/lib/order-catalog.js`, `apps/edge-web/src/screen-styles.css`, `test/e2e/orders.spec.js`
- **Depends on:** T48
- **Requirement:** PFI-14

**Done when:**

- [x] Nenhum `input[list]`, `datalist` ou `combobox` na página do pedido
- [x] axe sem violações; desktop e 390 px conferidos

**Tests:** e2e · **Gate:** quick + e2e · **Commit:** `fix(edge-web): type every order field by hand`

## Grupo ADR 015 — A conversa não volta para o bot (02/10/2026)

Decidido pelo PO em 02/10/2026: "A conversa nunca volta para o bot." As tasks
T54 e T55 partem de `master`, num branch próprio.

### T54: ADR 015 e requisitos da conversa que não volta

- **What:** Registrar a decisão; tirar "Devolver à IA" de PCX-05; trocar o caso de borda "WHEN a conversa volta para a IA" pela regra nova; tirar o retorno à IA da especificação do produto, do TDD e do contrato n8n.
- **Where:** `docs/adr/015-conversa-nao-volta-para-o-bot.md`, `docs/adr/README.md`, `.specs/features/pedidos-mvp/{spec,tasks}.md`, `CRM-MVP-ESPECIFICACAO.md`, `TECHNICAL-DESIGN.md`, `docs/integrations/n8n/README.md`
- **Depends on:** —
- **Requirement:** PCX-05, ORC-07, AGT-03

**Done when:**

- [x] ADR 015 aceita e ligada à spec e às tasks
- [x] Nenhum documento normativo descreve devolver a conversa à IA

**Tests:** none · **Gate:** docs · **Commit:** `docs(adr): record that a conversation never returns to the bot`

### T55: Remover "Devolver à IA" de ponta a ponta

- **What:** Tirar o botão da Caixa de Entrada, a rota `return-to-ai`, `returnToAi` no runtime, `reactivateAgent` no serviço e o ramo `reactivate` dos repositórios PostgreSQL e em memória; o domínio aceita só `CONVERSATION_MUTATIONS`; OpenAPI só com `takeover` e `close`. Histórico gravado fica como está, sem migração.
- **Where:** `apps/edge-web/src/views/InboxView.vue`, `apps/api/src/conversation-{routes,runtime}.js`, `modules/inbox-channels/src/**`, `docs/api/openapi.v1.yaml`, `test/{conversation-routes,inbox-domain,inbox-postgres-live}.test.js`, `test/e2e/crm-ui.spec.js`
- **Depends on:** T54
- **Requirement:** PCX-05, ORC-07, AGT-03

**Done when:**

- [x] `POST .../return-to-ai` responde 404 sem autorizar nem chamar o domínio
- [x] Serviço sem `reactivateAgent`; os repositórios recusam `reactivate` sem auditoria, evento ou comando ao n8n
- [x] A Caixa de Entrada não mostra "Devolver à IA"; as ações restantes seguem em ordem pelo teclado; axe sem violações
- [x] `npm run validate`, o live do inbox e o e2e do inbox passam

**Tests:** unit + live + e2e · **Gate:** quick + live + e2e · **Commit:** `feat(inbox): never hand a conversation back to the bot`

## Grupo K — Pedido abre no primeiro ponto da ficha (ADR 014)

Decidido pelo PO em 02/10/2026, depois do diagnóstico do cloud-dev. As tasks
T50–T53 partem de `master`, em ordem; a T52 depende do CRM da T51 no ambiente
antes de o workflow ir ao n8n. Depois do merge, o Tech Lead sincroniza o
workflow DEV `0S5ZS1xeDCSoWovs` e, com autorização do PO, o de produção
`k7tI6T4RhQPyJkn9`, como na T40.

### T50: ADR 014 e requisitos da abertura

- **What:** Registrar a decisão, as decisões D29–D30 da RFC 006, os requisitos PAB-01..04, o novo gatilho de PCL-01..03 e estas tasks.
- **Where:** `docs/adr/014-pedido-abre-no-primeiro-ponto-da-ficha.md`, `docs/adr/README.md`, `docs/rfc/006-atendimento-guiado-do-bot-no-n8n.md`, `.specs/features/pedidos-mvp/{spec,tasks}.md`
- **Depends on:** —
- **Requirement:** PCL-01..03, PAB-01..04

**Done when:**

- [x] ADR 014 aceita e ligada à RFC 006, à spec e às tasks

**Tests:** none · **Gate:** docs · **Commit:** `docs(adr): open the order at the first ficha point`

### T51: `open_order` no contrato n8n do CRM

- **What:** `message.send.requested` e `handoff.requested` aceitam o booleano `open_order`, sob a autorização do próprio evento; depois do commit, o CRM cria ou reutiliza o pendente, projeta como antes e responde `order`; a falha não falha o evento, é auditada e registrada sem PII. `order.intent_confirmed` fica obsoleto. Fixtures, schema e validador do contrato, OpenAPI e README do n8n.
- **Where:** `modules/n8n-integration/src/{service,postgres-repository}.js`, `apps/api/src/n8n-{routes,runtime}.js`, `schemas/fixtures/external/n8n/**`, `docs/api/openapi.v1.yaml`, `docs/integrations/n8n/README.md`, `test/n8n-{integration-domain,api-contract,routes,integration-postgres-live}.test.js`
- **Depends on:** T50
- **Requirement:** PCL-01..03, PAB-03, PAB-04

**Done when:**

- [x] Reserva com `open_order` cria um pendente e responde `order`; replay e retry concorrente não duplicam
- [x] Handoff com `open_order` cria o pendente
- [x] Falha do módulo de pedidos responde `opened: false`, aceita o evento e audita sem PII
- [x] `order.intent_confirmed` continua funcionando
- [x] Gate quick e suíte live do módulo passam

**Tests:** unit + integração live · **Gate:** quick + live · **Commit:** `feat(n8n-integration): open the pending order with the agent's event`

### T52: Regra de abertura e falha visível no workflow

- **What:** O nó de decisão calcula `open_order` pela ficha (D29) e o envia na reserva e no handoff; o handoff de arquivo usa a mesma regra; o ramo paralelo da intenção sai; o prompt perde `order_intent_confirmed`; "Pedido não abriu? (MVP)" envia `workflow.failed` com `ORDER_OPEN_FAILED`. Workflow `mvp-simple-11`, snapshot principal e runbook.
- **Where:** `ops/n8n/workflows/{k7tI6T4RhQPyJkn9-mvp-simple.sdk.js,render-mvp-workflow.mjs,k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json}`, `docs/runbooks/automation-executor.md`, `docs/integrations/n8n/README.md`, `test/n8n-workflow-contract.test.js`, `test/n8n-integration-postgres-live.test.js` (o `workflow.failed` gravado)
- **Depends on:** T51
- **Requirement:** PAB-01, PAB-02, PAB-04

**Done when:**

- [x] Primeiro ponto real abre; nome sozinho e "Definir com o vendedor" não; contexto externo nunca; handoff com ponto abre; aberto fica
- [x] `opened: false` gera `workflow.failed` com `ORDER_OPEN_FAILED` sem bloquear a resposta
- [x] Gate quick passa

**Tests:** unit + integração live · **Gate:** quick + live · **Commit:** `feat(n8n): open the order at the first ficha point`

### T53: Workflows DEV e local, roteiro e rastreabilidade

- **What:** `dev-mvp-simple-12` com `open_order` e `order` nos resultados do webhook DEV; snapshots DEV e local gerados de novo; roteiro do indicador com o novo momento de abertura; rastreabilidade PAB em `spec.md`.
- **Where:** `ops/n8n/workflows/{create-dev-test-workflow.mjs,0S5ZS1xeDCSoWovs-*.sanitized.json}`, `test/n8n-dev-workflow.test.js`, `docs/integrations/n8n/{README,roteiro-indicador-da-ficha}.md`, `docs/runbooks/automation-executor.md` (só formatação), `.specs/features/pedidos-mvp/spec.md`
- **Depends on:** T52
- **Requirement:** PAB-01..04

**Done when:**

- [x] Resultados DEV mostram `open_order` e a resposta `order` do CRM
- [x] PAB-01..04 com evidência em `spec.md`
- [x] `npm run validate` passa

**Tests:** unit · **Gate:** full · **Commit:** `feat(n8n): show the order opening in the DEV workflow`

### Validação do Grupo K

| Task | Camada                   | Matriz exige    | Task diz                | Depends on | Status |
| ---- | ------------------------ | --------------- | ----------------------- | ---------- | ------ |
| T50  | docs                     | none            | none                    | —          | ✅     |
| T51  | contrato, rota e adapter | unit + live     | unit + integração live  | T50        | ✅     |
| T52  | workflow                 | unit            | unit + integração live  | T51        | ✅     |
| T53  | workflow DEV e docs      | unit            | unit                    | T52        | ✅     |

## Itens com os sete pontos (ADR 016, 02/10/2026)

Decidido pelo PO em 02/10/2026, depois do diagnóstico dos pedidos do
cloud-dev. Branch `feat/itens-com-os-sete-pontos`, a partir de `master`; as
tasks rodam em ordem, uma por commit. A ficha impressa v3 (ADR 017) usa a
forma do item desta entrega.

### T56: ADR 016 e requisitos dos itens

- **What:** Registrar a decisão; requisitos PIT-01..11; notas em PFI-02, PFI-03, PFI-08, PFI-09, PFI-12, PCL-04 e PCL-05; A01 supersedida; tipos do desenho; notas no inventário da ficha; estas tasks.
- **Where:** `docs/adr/016-itens-com-os-sete-pontos-da-ficha.md`, `docs/adr/012-ficha-de-sete-pontos-e-ritmo-fixo.md` (só o status), `docs/adr/README.md`, `.specs/features/pedidos-mvp/{spec,context,design,tasks}.md`, `CAMPOS-FICHA-E-JORNADA-P0-1.md`
- **Depends on:** —
- **Requirement:** PIT-01..11

**Done when:**

- [x] ADR 016 ligada à spec, ao contexto e às tasks
- [x] A01, a ADR 012 e o inventário da ficha apontam para a ADR 016

**Tests:** none · **Gate:** docs · **Commit:** `docs(adr): build the order items on the seven ficha points`

### T57: Leitura dos tamanhos

- **What:** `parseSizes` no domínio de pedidos: texto, objeto e lista estruturada viram grade só sem dúvida, com os tamanhos do catálogo; o resto fica nulo.
- **Where:** `modules/orders/src/domain/sizes.js`, `test/orders-sizes.test.js`
- **Depends on:** T56
- **Requirement:** PIT-08

**Done when:**

- [x] Todos os exemplos da ADR 016 e os casos ambíguos cobertos
- [x] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): read the sizes the customer typed`

### T58: Item com os sete pontos no domínio e na API

- **What:** Forma do item com `cor`, `estampa` e `gola`; item incompleto ao salvar; ficha gravada lida com os campos novos vazios e o que falta recalculado; `missingFields` e 422 pela regra nova; mapeamento do bot para o item 1 (tipo, cor, estampa com locais, tecido, tamanhos, gola, técnica e "Definir com o vendedor"); OpenAPI.
- **Where:** `modules/orders/src/{domain/{ficha,order}.js,application/order-service.js,index.js}`, `docs/api/openapi.v1.yaml`, `test/fixtures/order-items.js`, `test/orders-{domain,ficha,service-create,service-commands,service-read,repository-contract,postgres-live}.test.js`, `test/order-{routes,runtime}.test.js`
- **Depends on:** T57
- **Requirement:** PFI-03, PCL-04, PCL-05, PIT-03..08

**Done when:**

- [x] Cada um dos sete pontos bloqueia sozinho; resumo e adicionais não
- [x] Item incompleto salva; linha de tamanho inválida continua recusada
- [x] Ficha sem as chaves novas é lida, e o que falta é recalculado
- [x] Gate quick e `npm run test:orders:live` passam

**Tests:** unit + integração live · **Gate:** quick + live · **Commit:** `feat(orders): build items on the seven ficha points`

### T59: Cliente só com nome confirmado

- **What:** `readOrderContext` usa o nome do contato só com origem `manual` ou `automation`; sem ele, vale o `customer_name` do briefing; o identificador do canal sai.
- **Where:** `modules/orders/src/adapters/postgres-order-conversation-port.js`, `test/orders-postgres-live.test.js`
- **Depends on:** T58
- **Requirement:** PIT-11

**Done when:**

- [x] Conversa sem nome confirmado dá o cliente do briefing ou vazio, nunca o "@handle"
- [x] Nome dado por pessoa ou promovido do bot vale
- [x] Gate live passa

**Tests:** integração live · **Gate:** quick + live · **Commit:** `fix(orders): name the customer only from a confirmed name`

### T60: Tela do item com principais e adicionais

- **What:** Itens com os sete principais na ordem e o cabeçalho "Item N · tipo · N peças"; "Adicionais (não obrigatórios)" recolhido; Gerar pedido com "Falta para gerar" por ponto e sem "Ainda em branco na ficha"; Situação da lista e gaveta pela regra nova; quantidade informada e aviso; rótulos novos.
- **Where:** `apps/edge-web/src/components/order/*.vue`, `apps/edge-web/src/views/{OrderView,OrdersView}.vue`, `apps/edge-web/src/lib/order-format.js`, `apps/edge-web/src/screen-styles.css`, `test/order-format.test.js`, `test/e2e/{orders,crm-ui}.spec.js`
- **Depends on:** T58
- **Requirement:** PFI-01, PFI-08, PFI-09, PFI-12, PIT-01, PIT-02, PIT-06, PIT-09, PIT-10

**Done when:**

- [x] Teclado abre e fecha os adicionais, com `aria-expanded` e o foco no botão
- [x] axe sem violações; desktop e 390 px conferidos
- [x] Gate e2e passa

**Tests:** unit + e2e · **Gate:** quick + e2e · **Commit:** `feat(edge-web): show the order items on the seven ficha points`

### T61: Entrega prometida exigida para gerar

- **What:** Decisão do PO de 02 e 03/10/2026: do lastro, só a entrega prometida (dia `AAAA-MM-DD`) passa a bloquear gerar; pagamento não bloqueia (gerar subentende o pagamento feito até o CRM tratar pagamento), nem entrega realizada, primeiro contato ou pedido fechado. `summary.data_entrega_confirmada` em `missingFields` e no 422; "Gerar pedido" com a linha "Entrega prometida" e "Informar no Resumo", que abre o resumo nesse campo; nota "exigida para gerar" no lastro; ADR 016 emendada, ADR 008 marcada, PIT-12, PLA-06, PCL-05 e OpenAPI.
- **Where:** `modules/orders/src/domain/order.js`, `apps/edge-web/src/components/order/{OrderClosingSection,OrderSummarySection}.vue`, `apps/edge-web/src/views/OrderView.vue`, `apps/edge-web/src/lib/order-format.js`, `apps/edge-web/src/screen-styles.css`, `docs/adr/{016-itens-com-os-sete-pontos-da-ficha,008-lastro-de-datas-do-pedido,README}.md`, `docs/api/openapi.v1.yaml`, `.specs/features/pedidos-mvp/{spec,context,design,tasks}.md`, `CAMPOS-FICHA-E-JORNADA-P0-1.md`, testes de domínio, serviço, rotas, runtime, live, `test/order-format.test.js` e `test/e2e/orders.spec.js`
- **Depends on:** T60
- **Requirement:** PIT-05, PIT-06, PIT-12, PLA-06, PCL-05

**Done when:**

- [x] Entrega prometida ausente ou em texto livre bloqueia; "Pago em" e "Entregue em" vazios não
- [x] Live: gerar recusado sem a entrega prometida e aceito com ela, sem "Pago em"
- [x] e2e: "Falta para gerar" nomeia a entrega prometida, e "Informar no Resumo" abre o campo

**Tests:** unit + integração live + e2e · **Gate:** quick + live + e2e · **Commit:** `feat(orders): require the promised delivery to generate an order`

### T66: Verificação dos itens

O número T65 é da ficha impressa (ADR 017); esta é a próxima livre.

- **What:** Rodar os gates completos e registrar a rastreabilidade PIT em `spec.md`.
- **Where:** `.specs/features/pedidos-mvp/{spec,tasks}.md`
- **Depends on:** T57–T61
- **Requirement:** PIT-01..12

**Done when:**

- [x] `npm run validate`, `npm run test:e2e` e `npm run test:orders:live` passam
- [x] Nenhum PIT sem evidência

**Tests:** full · **Gate:** full · **Commit:** `docs(specs): trace the seven-point items to their tests`

### Validação T56–T61 e T66

| Task | Escopo                         | Camada                 | Testes             | Depends on | Status |
| ---- | ------------------------------ | ---------------------- | ------------------ | ---------- | ------ |
| T56  | 1 ADR + requisitos             | docs                   | none               | —          | ✅     |
| T57  | 1 leitura de domínio           | domínio                | unit               | T56        | ✅     |
| T58  | forma do item e regra de gerar | domínio, serviço, API  | unit + live        | T57        | ✅     |
| T59  | 1 adapter                      | adapter PG             | live               | T58        | ✅     |
| T60  | seção de itens e fechamento    | lib + componentes      | unit + e2e         | T58        | ✅     |
| T61  | 1 regra de gerar, ponta a ponta | domínio, tela, docs   | unit + live + e2e  | T60        | ✅     |
| T66  | verificação                    | full                   | full               | T57–T61    | ✅     |

## Ficha impressa com os sete pontos (ADR 017, 02/10/2026)

Decidido pelo PO em 02/10/2026: a ficha impressa muda junto com a tela dos
itens, e a v3 só vale depois que o PO aprovar o PDF. Branch
`feat/ficha-impressa-sete-pontos`, a partir de `master`. Os itens com os sete
pontos (ADR 016) correm em paralelo; esta entrega usa só fixtures sintéticas
com o contrato combinado do item.

### T62: ADR 017 e requisitos da ficha v3

- **What:** Registrar a decisão, a regra dos adicionais e o gate; requisitos PIM-06..10 e a nova redação de PLA-08; nota na D31; estas tasks; T47 superada.
- **Where:** `docs/adr/017-ficha-impressa-com-os-sete-pontos.md`, `docs/adr/README.md`, `.specs/features/pedidos-mvp/{spec,context,tasks}.md`
- **Depends on:** —
- **Requirement:** PIM-06..10, PLA-08

**Done when:**

- [x] ADR 017 ligada à spec, ao contexto e às tasks
- [x] PLA-08 e T47 apontam para a v3 com os sete pontos

**Tests:** none · **Gate:** docs · **Commit:** `docs(adr): print the order ficha with the seven points`

### T63: Template v3 e pacote de revisão

- **What:** `ficha-canonical-v3` com os sete pontos, adicionais só preenchidos, lastro na página 1 e página 2 da v2; `printSnapshot` fora da rota; amostra sintética, PDF e registro de aprovação pendente pelo script de revisão (`--generate --v3`); o `--validate` cobre v2 e v3.
- **Where:** `modules/orders/src/print/{ficha-canonical-v3,print-snapshot,html}.js`, `scripts/ficha-pdf-review.mjs`, `docs/phase0/{ficha-pdf-synthetic-v3,ficha-pdf-approval-v3}.json`, `docs/phase0/FICHA-PDF-REVIEW-V3.md`, `output/pdf/ficha-canonica-sintetica-v3.pdf`, `test/ficha-print-v3.test.js`, `test/ficha-pdf-review-v3.test.js`
- **Depends on:** T62
- **Requirement:** PIM-06, PIM-07, PIM-08, PIM-09, PLA-08

**Done when:**

- [x] `ficha-canonical-v2.js` e o PDF v2 sem mudança; testes da v2 passam
- [x] `npm run validate:ficha-pdf-review` valida v2 aprovada e v3 pendente
- [ ] Rose e Operação assinam a amostra impressa e o PO confirma (T68; fora desta task)

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): add the ficha v3 with the seven points for review`

### T64: Ponto único de troca da impressão

- **What:** `PRINT_TEMPLATE` e `renderOrderFicha(order)` em `modules/orders/src/print/index.js`; a rota de impressão chama `renderOrderFicha` e continua na v2; a validação recusa a v3 nesse ponto com o gate pendente.
- **Where:** `modules/orders/src/print/index.js`, `modules/orders/src/index.js`, `apps/api/src/order-routes.js`, `scripts/ficha-pdf-review.mjs`, `docs/phase0/FICHA-PDF-REVIEW-V3.md`, `test/ficha-print-switch.test.js`
- **Depends on:** T63
- **Requirement:** PIM-10

**Done when:**

- [x] A rota imprime exatamente o mesmo HTML v2 de antes
- [x] Testes cobrem os dois templates e a recusa da v3 sem aprovação
- [ ] Depois da aprovação, o Tech Lead troca `PRINT_TEMPLATE` num commit próprio

**Tests:** unit · **Gate:** quick · **Commit:** `feat(api): print through one ficha template switch`

### Revisão do PDF pelo PO (02/10/2026)

O PO aprovou a regra dos adicionais e o "—" no dia não registrado, e pediu as
mudanças das tasks T65 a T68 (em 03/10/2026 corrigiu quem assina: só Rose e
Operação, à mão). Cada uma gera de novo o PDF e o registro, que
continua pendente.

### T65: Lastro sem datas repetidas

- **What:** Data do pedido e Entrega prometida só no Resumo; a faixa "Lastro do pedido" fica com Primeiro contato, Pagamento e Entrega realizada. A amostra mostra a entrega realizada vazia. (Em 03/10/2026 o PO confirmou que o pagamento não bloqueia a geração: por ora, gerar o pedido implica pagamento; corrigido na T67.)
- **Where:** `modules/orders/src/print/{ficha-canonical-v3,print-snapshot}.js`, `scripts/ficha-pdf-review.mjs`, `docs/phase0/ficha-pdf-approval-v3.json`, `output/pdf/ficha-canonica-sintetica-v3.pdf`, `test/ficha-print-{v3,switch}.test.js`, ADR 017, `docs/phase0/FICHA-PDF-REVIEW-V3.md`, `.specs/features/pedidos-mvp/{spec,context,tasks}.md`
- **Depends on:** T64
- **Requirement:** PLA-08

**Done when:**

- [x] Cada uma das cinco datas sai uma vez só na página 1
- [x] PDF e registro gerados de novo, aprovação pendente

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): print each trail day once on the ficha v3`

### T66: Português com acento na v3

- **What:** Todo rótulo impresso com acento, nas duas páginas e na faixa de amostra; o valor gravado "NAO APLICAVEL" sai como "NÃO APLICÁVEL" só no papel; texto digitado sai como foi digitado.
- **Where:** `modules/orders/src/print/ficha-canonical-v3.js`, `scripts/ficha-pdf-review.mjs`, `docs/phase0/ficha-pdf-approval-v3.json`, `output/pdf/ficha-canonica-sintetica-v3.pdf`, `test/ficha-{print-v3,pdf-review-v3,print-switch}.test.js`, ADR 017, `docs/phase0/FICHA-PDF-REVIEW-V3.md`, `.specs/features/pedidos-mvp/{spec,tasks}.md`
- **Depends on:** T65
- **Requirement:** PIM-07, PIM-11

**Done when:**

- [x] Rótulos com acento nas duas páginas; a v2 continua sem acento e sem mudança
- [x] PDF e registro gerados de novo, aprovação pendente

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): write the ficha v3 labels with their accents`

### T67: Páginas de continuação e amostra com três itens

- **What:** O template decide as páginas: a página 1 com Resumo, lastro e os primeiros itens; cada página de continuação com o cabeçalho, o número do pedido e "Página N · continuação dos itens"; observações e total na última página de itens; controle de produção por último. Altura estimada com folga e fonte com as medidas da Arial. Amostra com três itens (a baby look vai para a página 2); o registro confere as páginas planejadas. A amostra deixa de tratar o pagamento como bloqueio.
- **Where:** `modules/orders/src/print/{ficha-canonical-v3,ficha-v3-pages}.js`, `scripts/ficha-pdf-review.mjs`, `docs/phase0/{ficha-pdf-synthetic-v3,ficha-pdf-approval-v3}.json`, `output/pdf/ficha-canonica-sintetica-v3.pdf`, `test/ficha-{print-v3,pdf-review-v3}.test.js`, ADR 017, `docs/phase0/FICHA-PDF-REVIEW-V3.md`, `.specs/features/pedidos-mvp/{spec,tasks}.md`
- **Depends on:** T66
- **Requirement:** PIM-12, PLA-08

**Done when:**

- [x] PDF da amostra com três páginas, as mesmas que o template planejou
- [x] Conferido à parte no Chromium: 25 pedidos aleatórios de oito itens, cada PDF com as páginas planejadas e nenhuma altura estimada abaixo da real

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): repeat the ficha v3 header on continuation pages`

### T68: Assinatura física de Rose e Operação

- **What:** O registro da v3 espelha o da v2: aprovam só Rose e Operação (`reviewedBy.rose` e `reviewedBy.operation`), com assinatura física na amostra impressa (`signature: "physical"`, `signedPaperKeptAt`). A amostra ganha as linhas de assinatura e data. O registro continua pendente; o Tech Lead só registra depois que o PO confirmar a assinatura.
- **Where:** `modules/orders/src/print/ficha-canonical-v3.js`, `scripts/ficha-pdf-review.mjs`, `docs/phase0/ficha-pdf-approval-v3.json`, `output/pdf/ficha-canonica-sintetica-v3.pdf`, `test/ficha-{print-v3,pdf-review-v3}.test.js`, ADR 017, `docs/phase0/FICHA-PDF-REVIEW-V3.md`, `.specs/features/pedidos-mvp/{spec,context,tasks}.md`
- **Depends on:** T67
- **Requirement:** PIM-10

**Done when:**

- [x] Registro pendente, com Rose e Operação e assinatura física
- [x] Aprovação de outros assinantes, sem papel guardado ou parcial é recusada
- [ ] Rose e Operação assinam a amostra impressa e o PO confirma (fora desta task)

**Tests:** unit · **Gate:** quick · **Commit:** `feat(orders): sign the ficha v3 on paper by Rose and Operação`

### Validação T62–T68

| Task | Escopo                  | Camada            | Testes | Depends on | Status |
| ---- | ----------------------- | ----------------- | ------ | ---------- | ------ |
| T62  | 1 ADR + requisitos      | docs              | none   | —          | ✅     |
| T63  | 1 template + seu pacote | template impresso | unit   | T62        | ✅     |
| T64  | 1 ponto de troca + rota | rota/print        | unit   | T63        | ✅     |
| T65  | 1 faixa do template     | template impresso | unit   | T64        | ✅     |
| T66  | rótulos do template     | template impresso | unit   | T65        | ✅     |
| T67  | páginas do template     | template impresso | unit   | T66        | ✅     |
| T68  | registro de aprovação   | gate de revisão   | unit   | T67        | ✅     |

---

## Validação das tasks

### Granularidade

| Task          | Escopo                                      | Status   |
| ------------- | ------------------------------------------- | -------- |
| T01–T03       | 1 documento cada                            | ✅       |
| T04           | scaffold de 1 pacote                        | ✅       |
| T05, T06, T07 | 1 arquivo de domínio cada                   | ✅       |
| T08           | porta + adapter em memória (mesmo contrato) | ⚠️ coeso |
| T09, T10, T11 | 1 grupo de métodos do serviço cada          | ✅       |
| T12, T13      | 1 migration / 1 adapter                     | ✅       |
| T14–T20       | 1 ação, runtime ou grupo de rotas cada      | ✅       |
| T21–T23       | 1 ponto de integração cada                  | ✅       |
| T40           | 1 publicação (DEV → produção)               | ✅       |
| T24, T25      | 1 renderer / 1 rota                         | ✅       |
| T26–T34       | 1 lib, view ou componente cada              | ✅       |
| T35–T38       | 1 mudança de view ou componente cada        | ✅       |
| T39           | verificação                                 | ✅       |
| T41–T47       | 1 documento, camada ou template cada        | ✅       |

### Diagrama × definições

| Task     | Depends on (corpo) | Diagrama           | Status |
| -------- | ------------------ | ------------------ | ------ |
| T02      | T01                | T01→T02            | ✅     |
| T03      | T01                | T01→T03            | ✅     |
| T04      | T01                | (A→B)              | ✅     |
| T05, T06 | T04                | T04→T05, T04→T06   | ✅     |
| T07      | T05, T06           | T05,T06→T07        | ✅     |
| T08      | T07                | T07→T08            | ✅     |
| T09      | T08                | T08→T09            | ✅     |
| T10      | T09                | T09→T10            | ✅     |
| T11      | T10                | T10→T11            | ✅     |
| T12      | T04                | T04→T12            | ✅     |
| T13      | T08, T12           | T08,T12→T13        | ✅     |
| T14      | T01                | T01→T14            | ✅     |
| T15      | T11, T13, T14      | T11,T13,T14→T15    | ✅     |
| T16      | T15                | T15→T16            | ✅     |
| T17      | T16                | T16→T17            | ✅     |
| T18      | T17                | T17→T18            | ✅     |
| T19      | T13                | T13→T19            | ✅     |
| T20      | T13                | T13→T20            | ✅     |
| T21      | T15                | T15→T21            | ✅     |
| T22      | T21                | T21→T22            | ✅     |
| T23      | T21, T02           | T21,T02→T23        | ✅     |
| T24      | T04                | T04→T24            | ✅     |
| T25      | T16, T24           | T16,T24→T25        | ✅     |
| T26      | T03                | T03→T26            | ✅     |
| T27      | —                  | T27                | ✅     |
| T28      | T16, T19, T26, T27 | idem               | ✅     |
| T29      | T25, T28           | T25,T28→T29        | ✅     |
| T30      | T17, T29           | T17,T29→T30        | ✅     |
| T31      | T30                | T30→T31            | ✅     |
| T32      | T31                | T31→T32            | ✅     |
| T33      | T32                | T32→T33            | ✅     |
| T34      | T18, T33           | T18,T33→T34        | ✅     |
| T35      | T20, T26           | T20,T26→T35        | ✅     |
| T36      | T35                | T35→T36            | ✅     |
| T37      | T16, T17, T26      | idem               | ✅     |
| T38      | T19, T36, T37      | idem               | ✅     |
| T39      | T23, T34, T38      | idem               | ✅     |
| T40      | T23, T39 + deploy  | T23,T39,deploy→T40 | ✅     |
| T42      | T41                | T41→T42            | ✅     |
| T43      | T42                | T42→T43            | ✅     |
| T45      | T43                | T43→T45            | ✅     |
| T46      | T42–T45            | idem               | ✅     |
| T47      | T43 + T15 da v3    | idem               | ✅     |
| T48      | T45                | T45→T48            | ✅     |
| T49      | T48                | T48→T49            | ✅     |
| T55      | T54                | T54→T55            | ✅     |

`[P]` só em tasks sem dependência entre si na mesma fase: T03 (com T02), T05/T06/T24 (após T04), T14 (após T01), T26/T27. ✅

### Co-localização de testes

| Task     | Camada                    | Matriz exige    | Task diz                           | Status |
| -------- | ------------------------- | --------------- | ---------------------------------- | ------ |
| T01–T03  | docs                      | none            | none                               | ✅     |
| T04      | scaffold sem lógica       | none            | none (gate boundaries + typecheck) | ✅     |
| T05–T11  | domínio/aplicação         | unit            | unit                               | ✅     |
| T12, T13 | migration/adapter PG      | integração live | integração live                    | ✅     |
| T14–T19  | autorização/runtime/rotas | unit            | unit                               | ✅     |
| T20      | adapter de leitura PG     | integração live | integração live                    | ✅     |
| T21, T23 | rotas/workflow            | unit            | unit                               | ✅     |
| T22      | adapter PG                | integração live | integração live                    | ✅     |
| T24, T25 | renderer/rota             | unit            | unit                               | ✅     |
| T26      | lib pura do front         | unit            | unit                               | ✅     |
| T27–T38  | views/componentes         | e2e             | e2e                                | ✅     |
| T39      | verificação               | full            | full                               | ✅     |
| T40      | operação no n8n online    | none            | none (gate online)                 | ✅     |
| T42      | domínio/adapter PG        | unit + live     | unit + live                        | ✅     |
| T43, T44 | rotas/runtime             | unit            | unit                               | ✅     |
| T45      | lib + componente          | unit + e2e      | unit + e2e                         | ✅     |
| T47      | template impresso         | unit            | unit                               | ✅     |
| T48      | lib + componente          | unit + e2e      | unit + e2e                         | ✅     |
| T49      | componente                | e2e             | e2e                                | ✅     |
| T54      | docs                      | none            | none                               | ✅     |
| T55      | view, rota, domínio e PG  | unit + live + e2e | unit + live + e2e                | ✅     |

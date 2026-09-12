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

| Gate  | Comando                                                                                   |
| ----- | ----------------------------------------------------------------------------------------- |
| docs  | `npm run format:check`                                                                    |
| quick | `node --test <arquivos de teste da task> && npm run lint && npm run typecheck`            |
| live  | `npm run test:orders:live` (mesmo pré-requisito de banco de `npm run test:identity:live`) |
| e2e   | `npm run test:e2e -- <spec>`                                                              |
| full  | `npm run validate`                                                                        |

---

## Plano de execução

### Grupos (um prompt por grupo em `PROMPTS.md`)

| Grupo                               | Tasks   | Depende de        |
| ----------------------------------- | ------- | ----------------- |
| **A** Contratos e decisão           | T01–T03 | —                 |
| **B** Domínio e persistência        | T04–T13 | A                 |
| **C** Autorização, API e tempo real | T14–T20 | B                 |
| **D** Agente (n8n)                  | T21–T23 | C                 |
| **E** Impressão                     | T24–T25 | T04 (B) e T16 (C) |
| **F** Tela de Pedidos               | T26–T34 | C, E              |
| **G** Caixa de Entrada              | T35–T38 | C, T26 (F)        |
| **H** Verificação final             | T39     | todos             |

Depois de C: **D, E e o início de F rodam em paralelo**. G começa assim que
T26 estiver no branch base.

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

- [ ] Oito operações com parâmetros, `expectedVersion`, `Idempotency-Key` e códigos 403/404/409/422
- [ ] Rotas mortas de Kanban/Negócio **não** são alteradas (limpeza adiada)
- [ ] `npm test` passa (inclui validações de contrato existentes, se houver)

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

- **What:** O workflow MVP envia `order.intent_confirmed` quando o cliente confirma que quer orçamento (roteiro 5.1 de `CAMPOS-FICHA-E-JORNADA-P0-1.md`).
- **Where:** `ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js` e o workflow DEV derivado
- **Depends on:** T21, T02
- **Requirement:** PCL-01

**Done when:**

- [ ] Teste existente do workflow cobre o novo nó; se não houver teste do SDK, criar asserção sobre o nó que emite o evento
- [ ] Gate quick passa

**Tests:** unit · **Gate:** quick · **Commit:** `feat(n8n): emit order intent from MVP workflow`

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

- [ ] `npm run validate` passa
- [ ] `npm run test:e2e` passa
- [ ] `npm run test:orders:live` passa
- [ ] Nenhum requisito sem evidência

**Tests:** full · **Gate:** full · **Commit:** `docs(specs): verify orders MVP traceability`

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
| T24, T25      | 1 renderer / 1 rota                         | ✅       |
| T26–T34       | 1 lib, view ou componente cada              | ✅       |
| T35–T38       | 1 mudança de view ou componente cada        | ✅       |
| T39           | verificação                                 | ✅       |

### Diagrama × definições

| Task     | Depends on (corpo) | Diagrama         | Status |
| -------- | ------------------ | ---------------- | ------ |
| T02      | T01                | T01→T02          | ✅     |
| T03      | T01                | T01→T03          | ✅     |
| T04      | T01                | (A→B)            | ✅     |
| T05, T06 | T04                | T04→T05, T04→T06 | ✅     |
| T07      | T05, T06           | T05,T06→T07      | ✅     |
| T08      | T07                | T07→T08          | ✅     |
| T09      | T08                | T08→T09          | ✅     |
| T10      | T09                | T09→T10          | ✅     |
| T11      | T10                | T10→T11          | ✅     |
| T12      | T04                | T04→T12          | ✅     |
| T13      | T08, T12           | T08,T12→T13      | ✅     |
| T14      | T01                | T01→T14          | ✅     |
| T15      | T11, T13, T14      | T11,T13,T14→T15  | ✅     |
| T16      | T15                | T15→T16          | ✅     |
| T17      | T16                | T16→T17          | ✅     |
| T18      | T17                | T17→T18          | ✅     |
| T19      | T13                | T13→T19          | ✅     |
| T20      | T13                | T13→T20          | ✅     |
| T21      | T15                | T15→T21          | ✅     |
| T22      | T21                | T21→T22          | ✅     |
| T23      | T21, T02           | T21,T02→T23      | ✅     |
| T24      | T04                | T04→T24          | ✅     |
| T25      | T16, T24           | T16,T24→T25      | ✅     |
| T26      | T03                | T03→T26          | ✅     |
| T27      | —                  | T27              | ✅     |
| T28      | T16, T19, T26, T27 | idem             | ✅     |
| T29      | T25, T28           | T25,T28→T29      | ✅     |
| T30      | T17, T29           | T17,T29→T30      | ✅     |
| T31      | T30                | T30→T31          | ✅     |
| T32      | T31                | T31→T32          | ✅     |
| T33      | T32                | T32→T33          | ✅     |
| T34      | T18, T33           | T18,T33→T34      | ✅     |
| T35      | T20, T26           | T20,T26→T35      | ✅     |
| T36      | T35                | T35→T36          | ✅     |
| T37      | T16, T17, T26      | idem             | ✅     |
| T38      | T19, T36, T37      | idem             | ✅     |
| T39      | T23, T34, T38      | idem             | ✅     |

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

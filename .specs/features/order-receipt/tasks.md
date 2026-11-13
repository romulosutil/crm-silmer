# Recibo comercial — tarefas

Status: implementação autorizada em 12/11/2026. Executar com tlc-spec-driven.
Requisitos: [spec.md](spec.md). Protótipo aprovado na RFC 068.

## Test Coverage Matrix

Diretrizes: AGENTS.md, CONTRIBUTING.md; padrões de order-routes.test.js,
order-runtime.test.js, orders-list.spec.js e orders.spec.js.

| Code Layer   | Required Test Type | Coverage Expectation                                                           | Location Pattern                  | Run Command                                        |
| ------------ | ------------------ | ------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------- |
| Documento    | unit + render      | Centavos/frete, ausências, legado/loja, escaping, estados e paginação          | test/order-receipt.test.js        | node --test test/order-receipt.test.js             |
| HTTP/runtime | integration        | ACL positiva/negativa, stale antes/depois, auditoria, limites, HEAD e falhas   | test/order-receipt-routes.test.js | node --test test/order-receipt-routes.test.js      |
| Interface    | e2e + unit         | Lista/detalhe, foco, autosave, estados, troca de alvo, erro/retry, mobile/dark | test/e2e/order-receipt.spec.js    | npx playwright test test/e2e/order-receipt.spec.js |
| Contrato     | structural         | Spec e tarefas completas; referências válidas                                  | .specs/features/order-receipt     | validate_spec.py e validate_tasks.py               |

## Gate Check Commands

| Gate Level | When to Use        | Command                                                                                |
| ---------- | ------------------ | -------------------------------------------------------------------------------------- |
| Quick      | Documento/contrato | Testes da tarefa, validadores da skill e git diff --check                              |
| Full       | API/UI             | Testes da tarefa, npm run typecheck, npm run lint, npm run check:design-tokens         |
| Build      | Fechamento         | npm run validate; npm run test:e2e; npm audit --audit-level=high; revisão independente |

## Execution Plan

```text
T1 -> T2 -> T3 -> T4
```

## Task Breakdown

### T1: Registrar o contrato aprovado — RCP-T01

**Where**: `docs/adr/089-recibo-comercial-na-lista-e-no-pedido.md`
**Depends on**: None
**Tests**: structural
**Gate**: Quick

Fontes associadas: RFC 068, RULES, ARCHITECTURE, TECHNICAL-DESIGN, índices ADR/RFC
e arquivos desta spec. Premissas: aprovação inclui provisório; sem runtime.

**Done when**:

- [x] Decisão aprovada e extensão das regras 9/10 documentadas, preservando fábrica.
- [x] Requisitos, contrato HTTP e tarefas rastreáveis passam pelos validadores.

### T2: Produzir o documento comercial — RCP-T02a

**Where**: `modules/orders/src/print/order-receipt.js`
**Depends on**: T1
**Tests**: unit + render
**Gate**: Quick

Suporte: exportação no módulo e teste unitário dedicado. Premissas: input é
projeção autorizada; sem rede, sem texto interno, sem preço médio.

**Done when**:

- [ ] Projeção mínima e HTML A5 atendem RCP-03/04/05/10/11, incluindo continuação.
- [ ] Testes discriminam preço exato, preço fracionário, frete, ausências e escaping.

### T3: Disponibilizar a leitura comercial protegida — RCP-T02b

**Where**: `apps/api/src/order-receipt-routes.js`
**Depends on**: T2
**Tests**: integration
**Gate**: Full

Suporte: registro em order-routes, serviço/runtime de pedidos, testes HTTP e
runtime. Premissas: order.read mais ACL explícita; loja e sem dono só Admin.

**Done when**:

- [ ] Prévia/PDF revalidam ACL e revisão; mudanças durante render negam bytes.
- [ ] Download audita sem PII, sem mutação comercial ou primeira impressão.
- [ ] Cenários 400/401/403/404/409/429/503, HEAD e falha de auditoria testados.

### T4: Integrar uma prévia nas duas telas — RCP-T03/04

**Where**: `apps/edge-web/src/components/order/OrderReceiptPreview.vue`
**Depends on**: T3
**Tests**: e2e + unit
**Gate**: Build

Suporte: cliente HTTP, OrdersView, OrderView, tokens de papel, testes de cliente
e E2E, runbook e verificação independente. Premissas: modal local preserva a
lista; autosave termina antes de ler a prévia; PDF da fábrica mantém seu fluxo.

**Done when**:

- [ ] Botões atendem RCP-01/12 e fluxo atende RCP-02/07/08/09/11.
- [ ] Estados negativos, teclado, contraste, 320 px e regressão da ficha passam.
- [ ] Gates completos e Verifier PASS com evidências; commit/push e PR atualizados.

## Cross-check

| Task | Depends on | Diagram  | Co-location   |
| ---- | ---------- | -------- | ------------- |
| T1   | None       | início   | structural    |
| T2   | T1         | T1 -> T2 | unit + render |
| T3   | T2         | T2 -> T3 | integration   |
| T4   | T3         | T3 -> T4 | e2e + unit    |

Cada tarefa entrega um contrato, um documento, uma fronteira HTTP ou um fluxo
de interface verificável. O autor executa os gates; o Verifier não altera o patch.

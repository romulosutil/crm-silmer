# Execução das cobranças simplificadas

Escritor único root; revisão independente somente leitura até handoff do relatório.

## Test Coverage Matrix

| Code Layer              | Required Test Type | Coverage Expectation                                | Location Pattern                      | Run Command                                                      |
| ----------------------- | ------------------ | --------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Composição              | unit               | Identidade, órfãos, fontes, vínculo e ordem         | test/order-billing-operations.test.js | node --test test/order-billing-operations.test.js                |
| Vue/comandos existentes | E2E                | Lista, estados, payloads, ACL, falhas, teclado/axe  | test/e2e/_billing_.spec.js            | Playwright focado                                                |
| Integração              | build + smoke      | Gates, SQL existente e persistência local sintética | validadores e ambiente dedicado       | npm run validate; npm run test:e2e; npm audit --audit-level=high |

## Gate Check Commands

| Gate Level | When to Use | Command                                                                            |
| ---------- | ----------- | ---------------------------------------------------------------------------------- |
| Quick      | Composição  | node --test test/order-billing-operations.test.js                                  |
| Full       | UI          | unit + Playwright billing/order-timeline/orders                                    |
| Build      | Fechamento  | npm run validate; npm run test:e2e; npm audit --audit-level=high; git diff --check |

## Execution Plan

```mermaid
flowchart LR
  T1 --> T2
  T2 --> T3
```

## Task Breakdown

### T1: Compor operações por identidade (BCS-T01)

- [x] Concluída: quatro testes aprovados, sem skips. Cobrança agrupa seus
      pagamentos; manual é deduplicado por fonte/ID; eventos preservam vínculos
      e registros órfãos, sem alterar totais nem fabricar datas.

**Where**: `apps/edge-web/src/lib/order-billing-operations.js`

**Depends on**: none

**Tests**: unit BCS-01/02, cobrança/pagamento, manual duplicado, órfãos e cursor parcial.

**Gate**: Quick.

### T2: Integrar lista e ações reais (BCS-T02)

- [x] Concluída: cinco testes unitários, 13 E2E BCS e regressões focadas
      aprovados. Gate validate fixado em Node24.20/npm11.19: 2.539 aprovados,
      53 skips opcionais, zero falhas/cancelamentos. Smoke real local persistido;
      gate global de navegador e revisão independente em T3.

**Where**: `apps/edge-web/src/components/order/OrderBillingSection.vue`,
`OrderBillingWorkspace.vue`, novo `OrderBillingOperations.vue`, `OrderView.vue`
para suprimir substituição idêntica, helper de pendências e E2E.

**Depends on**: T1

**Tests**: BCS-01–09, regressão dos comandos e leitura, teclado, foco, axe e
320px; cache paginado, ausência de polling idle, ciclo silencioso e pausa em interação.

**Gate**: Full e npm run validate (Build); gate global de navegador fechado em T3.

### T3: Revisão independente e operação local (BCS-T03)

- [ ] Concluída.

**Where**: `.specs/features/billing-simplified/validation.md` e runbook.

**Depends on**: T2

**Tests**: matriz independente, sensor isolado, smoke persistido e gates finais.

**Gate**: Build e validate_state.py.

## Cross-check

| Dependency | Diagram | Definition |
| ---------- | ------- | ---------- |
| T1 → T2    | yes     | yes        |
| T2 → T3    | yes     | yes        |

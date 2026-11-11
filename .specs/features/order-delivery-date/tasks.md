# Execução DDE

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation                                  | Location Pattern        | Run Command                                                             |
| ---------- | ------------------ | ----------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| Comando    | unit/HTTP          | ACL, dia, replay, preservação financeira e estado     | test/_order_.test.js    | node --test test/manual-order-service.test.js test/order-routes.test.js |
| Interface  | E2E                | Botão, somente entrega, teclado, erro e reconciliação | test/e2e/order*.spec.js | Playwright focado                                                       |
| Integração | Build + revisão    | lint/tipos/build, regressão e smoke local             | gates existentes        | npm run validate e checks focados                                       |

## Gate Check Commands

| Gate Level | When to Use | Command                                                                 |
| ---------- | ----------- | ----------------------------------------------------------------------- |
| Quick      | Backend     | node --test test/manual-order-service.test.js test/order-routes.test.js |
| Full       | UI          | Playwright timeline/orders/billing focado                               |
| Build      | Fechamento  | npm run validate; git diff --check; validate_state.py                   |

## Execution Plan

```mermaid
flowchart LR
  T1 --> T2
  T2 --> T3
  T3 --> T4
```

## Task Breakdown

### T1: Permitir correção autorizada de entrega existente (DDE-T01)

- [x] Concluída: 65 testes de serviço/HTTP aprovados, sem skips;
  typecheck/lint e diff check aprovados. Fingerprint mantém compatibilidade
  quando deliveredOn é omitido e distingue as datas explícitas.

**Where**: comando confirmDelivery no serviço/runtime/rota, OpenAPI e testes.

**Depends on**: none

**Tests**: DDE-02/03; data, ACL, fingerprint, replay e invariantes.

**Gate**: Quick + typecheck/lint.

### T2: Unificar ação da seção (DDE-T02)

- [x] Concluída: 149 cenários E2E cobertos (147 aprovados na execução
  integrada e os dois ajustes de expectativas legadas aprovados em reteste).
  Gate completo aprovado: 2561 testes, zero falhas e 53 integrações opcionais
  sem ambiente; format/tipos/lint/boundaries/configuração/build aprovados.

**Where**: OrderMilestonesSection.vue, OrderView.vue e E2E.

**Depends on**: T1

**Tests**: DDE-01–04, remoção de edição genérica e persistência da correção.

**Gate**: Full e Build.

### T3: Verificar e disponibilizar localmente (DDE-T03)

- [x] Concluída: revisão independente 4/4 critérios e sensor isolado 2/2;
  smoke local persistido confirmar → alterar → reload, mantendo pagamento,
  recebimento/saldo e ficha. Runbook e contratos atualizados; gate completo,
  validate_state e diff check aprovados. Entrega no PR 348, sem merge/deploy.

**Where**: `.specs/features/order-delivery-date/validation.md` e runbook.

**Depends on**: T2

**Tests**: revisão independente, sensor isolado e smoke sintético persistido.

**Gate**: validate_state.py e diff check, commit/push/PR.

### T4: Atualizar regressões de revisão financeira para o fluxo aprovado (DDE-T04)

- [x] Concluída: o CI 43120232727 aprovou 989 E2E e recusou dois testes
  que ainda procuravam o editor removido. Os dois cenários foram adaptados:
  entrega/confirmação e correção preservam data de pagamento e revisão pendente;
  quitação explícita usa Revisar quitação no Dashboard, com o dia original e
  checkbox obrigatório. Corpos exatos e ausência de campos cruzados são verificados.
  Não houve alteração no produto ou remoção/skip de cenários.

**Where**: test/e2e/finance-payment-review.spec.js.

**Depends on**: T3

**Tests**: DDE-02/03 e compatibilidade de revisão financeira; 2 E2E aprovados
  localmente, lint/tipos aprovados e revisão independente das invariantes.

**Gate**: CI completo da revisão integrada antes de merge; autorização explícita
  do proprietário para atualizar master, acompanhar CI e integrar o PR 348.

## Cross-check

| Dependency | Diagram | Definition |
| ---------- | ------- | ---------- |
| T1 → T2    | yes     | yes        |
| T2 → T3    | yes     | yes        |
| T3 → T4    | yes     | yes        |

# Billing Simplified Validation

## Validation: billing-simplified - PASS

**Date**: 2026-11-11  
**Spec**: `.specs/features/billing-simplified/spec.md`  
**Diff range**: `80e23a54091463650cc945e736301122f300f09d..47187c3c`  
**Verifier**: independent sub-agent `billing_simplified_verifier` (author ≠ verifier).  
**Result**: PASS — revision 2 code and acceptance review; integrated gate closure is recorded below.

This is revision 2, including fix commit 47187c3c after the initial review of 1cc8e229. Source, tests,
branch and runtime data were not changed by the verifier. The report is the
verifier's only repository write. Graph discovery was read only; the source
and diff, rather than the older graph, determined this review.

## Task Completion

| Task         | Status                        | Evidence                                                       |
| ------------ | ----------------------------- | -------------------------------------------------------------- |
| T1 / BCS-T01 | Verified                      | Five unit cases pass; F2 fixed and same mutant eliminated.     |
| T2 / BCS-T02 | Verified                      | F1 fixed by dedicated pauseRefresh prop and parent-dialog E2E. |
| T3 / BCS-T03 | Verified                      | F1/F2 fixes and regression checks approved on 47187c3c.        |
| T4 / BCS-T04 | Verified by Tech Lead closure | Definitive gates and environment retests recorded below.       |

## Spec-Anchored Acceptance Criteria

| ID / trigger                                   | Spec-defined outcome                                                                                                                      | file:line + assertion / implementation evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Assessment                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| BCS-01 / mixed payments                        | One row per charge and external receipt; provider payments attached by charge ID                                                          | `test/order-billing-operations.test.js:33` — `assert.equal(rows.length, 2)`; lines34–40 assert source-qualified IDs and provider payment identity; `test/e2e/billing-chat-real.spec.js:1144` — list count2                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PASS; exact manual ledger ID/source assertions now cover F2.                                                    |
| BCS-02 / details and cursor                    | Correct dates, proof, method/installments, manual authorship/note, original/reversed records and ID-linked movements; prior pages survive | `test/order-billing-operations.test.js:46` exact event identities/order, dedupe and source separation; lines131–132 assert effective date versus recorded timestamp. `test/e2e/billing-chat-real.spec.js:1165` note visible; line1173 card3x; line1176 exact receipt href; lines1180–1181 creation date and no payment confirmation; lines1241–1256 no aborted slow page, two preserved events after poll                                                                                                                                                                                                                                                     | PASS; F2 ledger preservation now asserted.                                                                      |
| BCS-03 / settled or balance                    | Official server totals determine settlement/actions                                                                                       | `test/e2e/billing-chat-real.spec.js:1154` — new commands count0 when settled; line1159 totals contain zero; lines1407–1408 server-updated totals800/200 despite original row1000. `OrderBillingSection.vue:113` uses received/balance/total fields directly; composer never calculates official totals                                                                                                                                                                                                                                                                                                                                                        | Checked.                                                                                                        |
| BCS-04 / commands                              | Existing reviewed commands with correct payload, current versions, CSRF/idempotency and safe timeout/conflict recovery                    | `test/e2e/billing-chat-real.spec.js:1297` exact existing-charge action/ID/conversation/versions; line1304 no amount override; lines1305–1306 key/CSRF. Lines1331–1337 assert provider identifiers/current versions and balance unchanged. Lines1400–1406 assert refund amount20000/current versions/key/CSRF. Lines471,499–501 assert reversal reason and immutable recovery key/body/one charge; lines900–905 current order/billing/conversation versions and new review key                                                                                                                                                                                 | Checked across current BCS cases and retained BFUI regression cases.                                            |
| BCS-05 / invalid or uncertain link             | Unsafe copy/send unavailable; preserve local/provider distinction and explicit safe retry                                                 | `test/e2e/billing-chat-real.spec.js:853` and line856 unsafe copy/send absent for oversized link; lines864–867 no new issue path. Lines690–699 reviewed correction payload and retained old link. Lines1660–1661 unsafe retry blocked/no writes; lines1670–1679 safe retry exact intent/version and no second charge                                                                                                                                                                                                                                                                                                                                           | Checked.                                                                                                        |
| BCS-06 / failed read, access or stale response | Explicit failure/retry and private actions blocked until current authorized snapshot                                                      | `test/e2e/billing-chat-real.spec.js:1440` alert visible; lines1443–1448 private link absent/check disabled; lines1459–1462 explicit refresh restores; lines1850–1854 link-only and integrated command disabled/no writes. `OrderBillingWorkspace.vue:95` mutable and line106 privateReadable require canManage/current order version/no loading,error,pending; lines241,266–270 reject wrong target/abort and clear forbidden snapshots                                                                                                                                                                                                                       | Error path dynamically checked; access and late-response guards statically checked. No new backend ACL surface. |
| BCS-07 / keyboard, mobile, themes              | Native details, predictable focus, no axe violations or page overflow                                                                     | `test/e2e/billing-chat-real.spec.js:1501` Enter opens native details; line1513 axe violations equal[] in light/dark and1440/320/390; line1521 page overflow false; line1533 dialog fits; line1535 focus restored after Escape. Retained BFUI success path line329 asserts trigger focus                                                                                                                                                                                                                                                                                                                                                                       | Checked by browser log.                                                                                         |
| BCS-08 / integration                           | No repeated histories, timeline retained, existing0/X/100 and link-only/Inbox contracts, no new domain infrastructure                     | `test/e2e/billing-chat-real.spec.js:1144` count2; lines1146–1153 repeated histories/payment block count0; line1187 timeline visible; lines1596–1605 link-only exact existing endpoint payload/key/CSRF. Diff contains only feature spec/tasks, four Vue components/view, composer and tests; no migration/endpoint/transport/dependency                                                                                                                                                                                                                                                                                                                       | Checked; legacy0/100 and Inbox covered by retained regressions, global gate pending.                            |
| BCS-09 / idle or pending                       | No idle polling; one quiet pending cycle; pause all dialogs/editing/hidden tabs; identical snapshots cause no redraw                      | `test/order-billing-operations.test.js:136` idle/settled false, pending true, terminal intent wins. `test/e2e/billing-chat-real.spec.js:1698` exact initial-read counts after11.2s; line1769 zero busy/DOM mutations; lines1780–1791 own-dialog/hidden-tab pause and draft/focus; lines1833–1835 identical order preserves draft/focus/read count. Revision2 adds `OrderBillingSection.vue:920` pauseRefresh from parent modal/billing editing and `OrderBillingWorkspace.vue:663` guard. `test/e2e/billing-chat-real.spec.js:1902` exact read count unchanged during parent refund; lines1905–1908 amount/focus preserved and line1915 Escape focus restored | PASS F1 fixed.                                                                                                  |

The spec gives observable outcomes for all nine IDs. No spec-precision gap
was needed. Static security evidence is explicitly distinguished from a
dynamic revocation/late-response test.

## Initial Findings Resolved in Revision 2

### F1 — resolved: parent-owned billing dialogs did not pause polling

**Requirement**: BCS-09.  
**Evidence**: `apps/edge-web/src/components/order/OrderBillingSection.vue:340`
opens its own modal; lines916–918 supply workspace disabled state without
`modal`; `apps/edge-web/src/components/order/OrderBillingWorkspace.vue:661`
only pauses for its own `mode`. A pending/unknown/review charge keeps
`billingNeedsRefresh` true, so opening parent reconcile/refund/issue can still
read every five seconds. Existing pause E2E covers only the workspace external
receipt dialog.

**Fix**: pass a dedicated pause-refresh prop for parent dialogs/condition editing,
and include it only in the polling guard. Adding modal to disabled would make
the parent's workspaceBlocked guard block its own submit. Add a browser test
with pending billing while a parent-owned refund/reconcile dialog is open:
read count stays fixed, input/focus survives, polling resumes after close.

### F2 — resolved: manual ledger relationship could disappear without unit failure

**Requirements**: BCS-01/02.  
**Evidence**: `apps/edge-web/src/lib/order-billing-operations.js:56` guards the
standalone external-record fallback. Replacing it with unconditional fallback
overwrites the existing manual row and empties its payments array. All five
unit tests still pass (isolated sensor). Current assertions
`test/order-billing-operations.test.js:38`–40 cover external metadata, amount
and provider relationship, but do not assert the manual ledger relationship.

**Fix**: strengthen the existing mixed-source case with the exact manual
payment ID/source (and preserved payment metadata where relevant). Re-run the
same isolated mutation and require assertion failure. No production fix is
suggested; the original guard is correct.

## Revision 2 Fix Evidence

The verifier inspected `1cc8e229..47187c3c` independently. Parent Section
passes `pauseRefresh` for any parent modal or billing condition edit.
Workspace uses it solely in the compact polling guard. It does not affect
mutable/privateReadable, so the prior circular-blocking risk is avoided.
New E2E keeps an actual waiting charge beside a paid refundable charge:
the parent refund dialog remains open across a full polling interval, read
count stays fixed, typed amount/focus survive, and Escape returns focus.

The mixed-source unit case now asserts exact external payment ID and source
at `test/order-billing-operations.test.js:39` and line40.
Original F1/F2 details above retain the initial failure evidence and suggested
fixes for audit history; both fixes are now present. No outstanding ranked gap
remains. Candidate lessons L012/L013 were recorded by the author in the fix
commit.

## Discrimination Sensor

Lightweight presentation-only sensor: this feature does not change financial
calculation, authorization services, SQL or payment transport. Three behavior
mutations targeted new composition and refresh logic. All copies lived outside
the repository; no worktree, stash or build was used.

| Mutation                                                                                | Source                                                 | Observed outcome                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External fallback always runs, replacing an existing row and dropping ledger attachment | `apps/edge-web/src/lib/order-billing-operations.js:56` | KILLED in revision2: exit1 at the new exact ledger-ID assertion. The missing payments[0] produces a semantic TypeError at that assertion, not an import/syntax failure. Initial revision survived. |
| Provider payment searches a nonmatching charge namespace                                | `apps/edge-web/src/lib/order-billing-operations.js:47` | KILLED: exit1, assertion failure, valid imports/syntax.                                                                                                                                            |
| Pending-refresh helper always returns true, including idle                              | `apps/edge-web/src/lib/order-billing-operations.js:89` | KILLED: exit1, assertion failure, valid imports/syntax.                                                                                                                                            |

**Sensor outcome**: revision2, 3 injected, 3 killed, 0 survived. Provider-link and idle mutants fail with ERR_ASSERTION; ledger deletion fails evaluating the new ledger identity assertion because the required record is absent.  
**Isolation**: git porcelain identical before/after; external source/test copies
removed. Logs retained in
`C:/Users/Ronal/.codex/visualizations/2026/11/11/01a1c810-5a94-7872-98fd-a8def333c64d/bcs-sensor/`
(`result.json` preserves revision1; `result-r2.json` and three `*-r2.log` files preserve revision2).

## Gate Evidence

- Independently executed `rtk node --test test/order-billing-operations.test.js`:
  five passed, zero failed/skipped/cancelled.
- Independently executed `rtk proxy git diff --check`: exit0 on revision1; repeated on revision2.
- Reviewed `tmp/billing-simplified-bcs-final.log`: 13 BCS browser tests passed on revision1. Reviewed `tmp/billing-simplified-review-fix.log`: 14 BCS browser tests passed on revision2, including parent-owned refund pause.
- Reviewed `tmp/billing-simplified-validate-final.log`: 2539 passed,53 optional
  integration skips, zero failed/cancelled; build succeeded. Skips require
  dedicated optional integration resources such as TEST_DATABASE_URL and
  are not operational evidence.
- Reviewed `tmp/billing-simplified-real-smoke.json`: local synthetic CRM
  persisted two operations, received3000/balance7000, simulated delivery,
  manual reversal, reload preservation. This is not real-provider evidence.
- Initial full Windows browser run against1cc8e229 was interrupted by the author after roughly300 cases to protect disk capacity; Firefox environment failures were observed. It is not a complete global gate. Artifacts were preserved at D:/CodexTestArtifacts/crm-silmer-bcs-initial-20261111. A definitive revision47187c3c global run with output on D: is pending; no global success is claimed.
- New tests in this diff: five unit and14 BCS browser cases; existing BFUI cases
  adapted to the unified list, with no deleted behavior coverage found.
- Audit, final validate/build/global result and commit/push/PR remain author/orchestrator release gates. The verifier runs validate_state for this acceptance report; a passing report does not replace those unfinished gates.

## Code Quality and Limits

The patch preserves the approved Vue architecture and existing command API,
server-authoritative money and timeline. UI details are native, links pass
billingUrl and private-read guards, and uncertain writes freeze their whole
body/key. No scope expansion or new dependency was found. The parent/child polling pause and the ledger test discrimination gaps found in revision1 are both resolved in revision2.

No interactive user UAT or real message/payment/provider action was performed.
The author has exclusive ownership of fixes. Verifier did not modify the
spec traceability table because only this report was delegated for writes.

## Requirement Traceability Handoff

BCS-01–09 now match the inspected code and assertions. The author can update
their traceability statuses after incorporating this independent report.
Do not mark operational T4/release done until the final global gates and
delivery steps have their own completed evidence.

**Lessons signal**: initial F1/F2 produced candidate lessons L012/L013,
recorded by the author. Revision2 introduced no surviving mutants or new gaps.

## Summary

Acceptance and independent code/test review: PASS, nine of nine criteria.
Sensor: three of three mutants eliminated on revision2, real tree unchanged.
The operational gates were pending at the independent review handoff. Their
final result is recorded by the Tech Lead below. No real provider action was performed.

## Fechamento integrado pelo Tech Lead

Fonte final validada: `47187c3cb637862aa0a13cc35055ad65f4f25042`.
Os resultados abaixo foram incorporados após o handoff independente; a matriz
e os sensores acima permanecem evidência do verificador, não do autor.

- `npm run validate` final com Node24.20.0/npm11.19.0: **2.539 aprovados**,
  53 skips opcionais de integração, zero falhas/cancelamentos, build aprovado.
  Log: `tmp/billing-simplified-validate-47187c3c.log`. Uma execução anterior
  cancelou um teste de multipart por seu limite de três segundos; o gate foi
  repetido integralmente, sem alterar o teste/timeout, e passou.
- Global Windows, fonte final, **932 casos**: **923 aprovados, sete skips,
  duas falhas de ambiente**. Log: `tmp/billing-simplified-full-final.log`;
  artefatos: `D:/CodexTestArtifacts/crm-silmer-bcs-final-47187c3c`.
  O processo original continua registrado como saída1, não como zero falhas.
- Firefox: `spawn UNKNOWN` ao iniciar no Windows. Pelo runbook
  `docs/runbooks/playwright-audio-local.md`, arquivo-fonte exato da revisão,
  imagem oficial Playwright por digest, Node24.20/npm11.19, PulseAudio sintético,
  sem mount do checkout, portas ou credenciais: **dois casos Chromium/Firefox
  aprovados, zero skips**. Log: `tmp/billing-simplified-linux-audio.log`.
  Container dedicado `crm-silmer-bcs-audio` encerrado/removido após o resultado.
- `orders.spec.js:4578`: `ERR_NO_BUFFER_SPACE` na navegação, antes das
  assertions. Repetido inalterado, isoladamente e com ferramentas fixadas:
  **um aprovado**. Log: `tmp/billing-simplified-reopen-retest.log`;
  artefatos: `D:/CodexTestArtifacts/crm-silmer-bcs-retest-47187c3c`.
- O primeiro global foi interrompido preventivamente para mudar o destino dos
  traces do C: para o D:. Seus artefatos foram preservados; nenhum teste,
  assertion, timeout ou política de trace foi removido para contornar espaço.
- Auditoria do lockfile: **zero vulnerabilidades**. Cinco unit e 14 E2E BCS
  aprovados; tipos/lint/formato/fronteiras/tokens e diff check aprovados.
- Smoke repetido com código final na porta4180: emissão sem envio, envio do
  mesmo link pelo n8n/sink local, pagamento InfinitePay simulado, registro e
  estorno externo pela UI, dois registros preservados após reload e saldo
  oficial3000/7000 centavos. `tmp/billing-simplified-real-smoke.json`.
- Outro pedido quitado manteve apenas duas leituras iniciais do resumo e uma
  do histórico durante12s. E2E confirma zero mutações DOM em consulta idêntica,
  pausa de leitura/paginação, diálogos pai/filho, aba oculta e rascunho/foco.

Rastreabilidade canônica e [runbook](../../../docs/runbooks/order-billing-simplified.md)
atualizados. Entrega no [PR348](https://github.com/romulosutil/crm-silmer/pull/348),
com a timeline preservada e a base master71908c66. Não houve merge/deploy,
migração, dependência nova ou efeito em provedor real nesta validação.

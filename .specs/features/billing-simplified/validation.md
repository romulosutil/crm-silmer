# Billing Simplified Validation

## Validation: billing-simplified - PASS

**Date**: 2026-11-11
**Spec**: `.specs/features/billing-simplified/spec.md`
**Current reviewed source**: `c2478c20b2df1b2d6b8e3832a001b41342f702fe`
**Current master base**: `c1124fbc27ca84fab3c07642405e3256cb0d5635`
**Revision 3 diff range**: `7e055916d63d72f21a86a898bb1d9354d49716b1..c2478c20b2df1b2d6b8e3832a001b41342f702fe`
**Original historical review range**: `80e23a54091463650cc945e736301122f300f09d..47187c3c`
**Verifier**: independent sub-agent `billing_simplified_verifier` (author ≠ verifier).
**Result**: PASS — revision 3 acceptance and incremental integration review on c2478c20; historical global evidence is identified separately below.

This is revision 3, covering the rebased PDF-Inbox integration and clock delta on c2478c20. Revision2 covered fix commit47187c3c after the initial review of1cc8e229. Source, tests,
branch and runtime data were not changed by the verifier. The report is the
verifier's only repository write. Graph discovery was read only; the source
and diff, rather than the older graph, determined this review.

## Task Completion

| Task         | Status                                   | Evidence                                                                         |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------- |
| T1 / BCS-T01 | Verified                                 | Five unit cases pass; F2 fixed and same mutant eliminated.                       |
| T2 / BCS-T02 | Verified                                 | F1 fixed by dedicated pauseRefresh prop and parent-dialog E2E.                   |
| T3 / BCS-T03 | Verified                                 | F1/F2 fixes and regression checks approved on 47187c3c.                          |
| T4 / BCS-T04 | Verified by historical Tech Lead closure | Global gates on47187c3c and environment retests recorded below.                  |
| T5 / BCS-T05 | Verified                                 | Current clock/preflight delta reviewed; latest15 BCS cases and unit5 pass.       |
| T6 / BCS-T06 | Verifier evidence complete               | Revision3 report and validate_state complete; author owns final commit/PR steps. |

## Spec-Anchored Acceptance Criteria

| ID / trigger                                   | Spec-defined outcome                                                                                                                      | file:line + assertion / implementation evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Assessment                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| BCS-01 / mixed payments                        | One row per charge and external receipt; provider payments attached by charge ID                                                          | `test/order-billing-operations.test.js:33` — `assert.equal(rows.length, 2)`; lines34–40 assert source-qualified IDs and provider payment identity; `test/e2e/billing-chat-real.spec.js:1144` — list count2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PASS; exact manual ledger ID/source assertions now cover F2.                                                                                       |
| BCS-02 / details and cursor                    | Correct dates, proof, method/installments, manual authorship/note, original/reversed records and ID-linked movements; prior pages survive | `test/order-billing-operations.test.js:46` exact event identities/order, dedupe and source separation; lines131–132 assert effective date versus recorded timestamp. `test/e2e/billing-chat-real.spec.js:1165` note visible; line1173 card3x; line1176 exact receipt href; lines1180–1181 creation date and no payment confirmation; lines1241–1256 no aborted slow page, two preserved events after poll                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | PASS; F2 ledger preservation now asserted.                                                                                                         |
| BCS-03 / settled or balance                    | Official server totals determine settlement/actions                                                                                       | `test/e2e/billing-chat-real.spec.js:1154` — new commands count0 when settled; line1159 totals contain zero; lines1407–1408 server-updated totals800/200 despite original row1000. `OrderBillingSection.vue:113` uses received/balance/total fields directly; composer never calculates official totals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Checked.                                                                                                                                           |
| BCS-04 / commands                              | Existing reviewed commands with correct payload, current versions, CSRF/idempotency and safe timeout/conflict recovery                    | `test/e2e/billing-chat-real.spec.js:1297` exact existing-charge action/ID/conversation/versions; line1304 no amount override; lines1305–1306 key/CSRF. Lines1331–1337 assert provider identifiers/current versions and balance unchanged. Lines1400–1406 assert refund amount20000/current versions/key/CSRF. Lines471,499–501 assert reversal reason and immutable recovery key/body/one charge; lines900–905 current order/billing/conversation versions and new review key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Checked across current BCS cases and retained BFUI regression cases.                                                                               |
| BCS-05 / invalid or uncertain link             | Unsafe copy/send unavailable; preserve local/provider distinction and explicit safe retry                                                 | `test/e2e/billing-chat-real.spec.js:853` and line856 unsafe copy/send absent for oversized link; lines864–867 no new issue path. Lines690–699 reviewed correction payload and retained old link. Lines1660–1661 unsafe retry blocked/no writes; lines1670–1679 safe retry exact intent/version and no second charge. Revision3 `test/e2e/billing-chat-real.spec.js:1943` asserts Link vencido after identical HTTP; lines1947–1955 assert no Enviar/Copiar and Conferir available; line1956 asserts zero POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Checked.                                                                                                                                           |
| BCS-06 / failed read, access or stale response | Explicit failure/retry and private actions blocked until current authorized snapshot                                                      | `test/e2e/billing-chat-real.spec.js:1440` alert visible; lines1443–1448 private link absent/check disabled; lines1459–1462 explicit refresh restores; lines1850–1854 link-only and integrated command disabled/no writes. `apps/edge-web/src/components/order/OrderBillingWorkspace.vue:97` mutable and line108 privateReadable require canManage/current order version/no loading,error,pending; line244 rejects wrong target/abort, error branch clears forbidden snapshots                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Error path dynamically checked; access and late-response guards statically checked. No new backend ACL surface.                                    |
| BCS-07 / keyboard, mobile, themes              | Native details, predictable focus, no axe violations or page overflow                                                                     | `test/e2e/billing-chat-real.spec.js:1501` Enter opens native details; line1513 axe violations equal[] in light/dark and1440/320/390; line1521 page overflow false; line1533 dialog fits; line1535 focus restored after Escape. Retained BFUI success path line329 asserts trigger focus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Checked by browser log.                                                                                                                            |
| BCS-08 / integration                           | No repeated histories, timeline retained, existing0/X/100 and link-only/Inbox contracts, no new domain infrastructure                     | `test/e2e/billing-chat-real.spec.js:1144` count2; lines1146–1153 repeated histories/payment block count0; line1187 timeline visible; lines1596–1605 link-only exact existing endpoint payload/key/CSRF. Diff contains only feature spec/tasks, four Vue components/view, composer and tests; no migration/endpoint/transport/dependency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Checked; legacy0/100 and Inbox retained; latest base/PDF integration and clock focused gates pass. Historical global is not a c2478c20 global run. |
| BCS-09 / idle or pending                       | No idle polling; one quiet pending cycle; pause all dialogs/editing/hidden tabs; identical snapshots cause no redraw                      | `test/order-billing-operations.test.js:136` idle/settled false, pending true, terminal intent wins. `test/e2e/billing-chat-real.spec.js:1698` exact initial-read counts after11.2s; line1769 zero busy/DOM mutations; lines1780–1791 own-dialog/hidden-tab pause and draft/focus; lines1833–1835 identical order preserves draft/focus/read count. Revision2 adds `OrderBillingSection.vue:920` pauseRefresh from parent modal/billing editing and `apps/edge-web/src/components/order/OrderBillingWorkspace.vue:688` guard. `test/e2e/billing-chat-real.spec.js:1902` exact read count unchanged during parent refund; lines1905–1908 amount/focus preserved and line1915 Escape focus restored. Revision3 `apps/edge-web/src/components/order/OrderBillingWorkspace.vue:246` detects actual expiration crossings; lines251–273 update clock/snapshot only at that change during automatic reads; `test/e2e/billing-chat-real.spec.js:1943` proves expiration despite unchanged HTTP | PASS F1 fixed; clock expiration remains observable without continuous redraw.                                                                      |

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

## Revision 3 Integration and Clock Evidence

The verifier read the final immutable delta
`7e055916..c2478c20` on master base`c1124fbc`. The rebased billing/DTL
surface before the clock change was reported identical by the author; this
review does not count the historical global run as a new-base execution.

BCS-05/09: `apps/edge-web/src/components/order/OrderBillingWorkspace.vue:246`
detects a validity boundary crossed since the prior checkedAt.
Automatic compact reads update checkedAt and emit snapshot only for a changed
payload or this actual temporal state change. Thus an otherwise identical
response still preserves reference/zero DOM mutations, while an expiring
link loses send/copy eligibility and exposes conference. The Operations
component consumes the shared clock at lines15,95,113,212; it does not infer
new money/provider state.

Manual preflight at `apps/edge-web/src/components/order/OrderBillingWorkspace.vue:301`
aligns the clock and emits the current compact snapshot before opening any
workspace dialog. This keeps the parent's readAt aligned even when the
dialog is canceled across expiration. Lines303–311 refuse a selected charge
that has left the valid existing set; lines376–382 pass the exact charge
into contextual retry. No new POST, automatic resend, official-money
calculation or API/transport boundary was introduced.

New `test/e2e/billing-chat-real.spec.js:1919` starts with a valid waiting
link, then receives the same HTTP snapshot through expiration. Assertions
at lines1943–1956 require Link vencido, Enviar/Copiar absent, Conferir
available and zero mutations through command requests. Existing BCS-09
tests retain exact idle-read counts, zero DOM mutations for genuinely
unchanged state, parent/child pause, hidden tab, draft and focus.

Independent current unit run:5/5, zero skips/failures. The helper and its
unit test are byte-for-byte unchanged versus47187c3c (`git diff` empty),
so the three isolated revision2 sensor results remain applicable to those
same semantics; they were not mislabeled as new Vue-clock fault injection.
No build or parallel browser run was executed by the verifier.

Current reviewed logs:

- `tmp/billing-simplified-preflight-final.log`:15/15 BCS browser cases on
  the final preflight placement, including silent DOM, parent/child pause
  and expiration transition.
- `tmp/billing-simplified-clock-e2e.log`:64/64 focused billing and timeline
  regression cases for the clock integration.
- `tmp/billing-simplified-rebase-e2e.log`:91/91 billing/PDF-Inbox cases on
  the new base, before the final clock delta.
- `tmp/billing-simplified-validate-clock-final.log`:2559 passed,
  53 optional integration skips, zero failed/cancelled, build succeeded.
  After that full validate the only source adjustment moved the manual
  preflight snapshot emit; the author reports repeated typecheck/lint/diff/
  build and the inspected final15-case browser log passed.

The932-case historical Windows global and Linux/environment retests below
belong to47187c3c. They were not run globally againstc2478c20 or the new
PDF-Inbox base. Current confidence combines that unchanged-feature
baseline with the explicitly scoped integration/clock runs above.
No new ranked findings or surviving mutant appeared in this incremental
review. No source, test, branch, runtime or spec was changed by the verifier.

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
- Initial full Windows browser run against1cc8e229 was interrupted by the author after roughly300 cases to protect disk capacity; Firefox environment failures were observed. It is not a complete global gate. Artifacts were preserved at D:/CodexTestArtifacts/crm-silmer-bcs-initial-20261111. The later47187c3c global and environment retests are recorded in the historical Tech Lead section below; they are not current-head global evidence.
- New tests across this feature: five unit and15 BCS browser cases after revision3; existing BFUI cases
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
BCS-T05 is verified by the current focused integration/clock evidence. BCS-T06 report evidence is complete; the author retains final documentation commit/push/PR ownership. Keep the revision-specific limits of the historical global distinct from the current focused integration results.

**Lessons signal**: initial F1/F2 produced candidate lessons L012/L013,
recorded by the author. Revision2 eliminated the mutant and revision3 introduced no new gaps. The author separately discovered and fixed the clock boundary before this review.

## Summary

Acceptance and independent code/test review: PASS, nine of nine criteria.
Sensor: three of three mutants eliminated on revision2, real tree unchanged.
Current source c2478c20 passes the incremental acceptance review and final15 BCS cases; focused64-case clock and91-case base integration evidence are scoped above. The historical47187c3c global closure is retained below. No real provider action was performed.

## Fechamento histórico integrado pelo Tech Lead — revisão 47187c3c

Fonte histórica validada antes da nova base PDF/clock: `47187c3cb637862aa0a13cc35055ad65f4f25042`. Esta seção não descreve um gate global executado sobrec2478c20.
Os resultados abaixo foram incorporados após o handoff independente; a matriz
e os sensores acima permanecem evidência do verificador, não do autor.

- `npm run validate` final com Node24.20.0/npm11.19.0: **2.539 aprovados**,
  53 skips opcionais de integração, zero falhas/cancelamentos, build aprovado.
  Log: `tmp/billing-simplified-validate-47187c3c.log`. Uma execução anterior
  cancelou um teste de multipart por seu limite de três segundos; o gate foi
  repetido integralmente, sem alterar o teste/timeout, e passou.
- Global Windows, fonte histórica47187c3c, **932 casos**: **923 aprovados, sete skips,
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

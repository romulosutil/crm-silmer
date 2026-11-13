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
T1 -> T2 -> T3 -> T4 -> T5
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

- [x] Projeção mínima e HTML A5 atendem RCP-03/04/05/10/11, incluindo continuação.
- [x] Testes discriminam preço exato, preço fracionário, frete, ausências e escaping.

Evidência T2: `node --test test/order-receipt.test.js` passou 14/14, sem skip;
typecheck e ESLint do escopo passaram. Os cinco PDFs sintéticos (curto,
pendente, cancelado, longo e valor máximo) não fizeram requests externos.
Chromium confirmou zero overflow de linhas/rodapés; pypdf confirmou páginas
1/1/1/19/1 iguais ao plano. Poppler foi inspecionado no curto, pendente e nas
páginas intermediária/final do longo. Artefatos locais em `tmp/pdfs/receipt/`.

Adequação: todos os testes de T2 têm âncora RCP-03/04/05/10/11; não testam
transporte ou auditoria, que pertencem a T3. Assertions de conteúdo recompõem
as linhas e continuam exigindo o texto original escapado, sem HTML ativo.

| Critério T2                          | Evidência de assertion                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preços exatos e frete (RCP-05)       | `test/order-receipt.test.js:79`, `assert.deepEqual(receipt.items, [...])`; `:99`, `assert.equal(receipt.totalCents, 530500)`.                                                                            |
| Frações e revisão (RCP-04/05)        | `test/order-receipt.test.js:117`, `assert.equal(receipt.items[0].unitCents, null)`; `:118`, subtotal 10000; `:131`, `assert.equal(receipt.totalCents, null)`.                                            |
| Ausências e legado (RCP-04)          | `test/order-receipt.test.js:156`, quantidade null; `:163`, `assert.doesNotMatch(visible(html), /R\$ 0,00\|undefined\|null/u)`; `:171`, total legado 530500.                                              |
| Privacidade e imutabilidade (RCP-10) | `test/order-receipt.test.js:194`, chaves exatas; `:221`, `assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE-\|https:/u)`; `:222`, `assert.deepEqual(input, before)`.                                 |
| Estados por página (RCP-03)          | `test/order-receipt.test.js:242`, texto provisório; `:247`, cancelado; `:250`, `assert.doesNotMatch(visible(page), /provisório/u)` no confirmado.                                                        |
| Escaping/fontes (RCP-10)             | `test/order-receipt.test.js:262`, texto escapado recomposto; `:270`, data URI da fonte; `:272`, `assert.doesNotMatch(html, /<script\|<img\|<link\|<iframe\|\s(?:href\|src)="https?:/u)`.                 |
| Paginação (RCP-11)                   | `test/order-receipt.test.js:295`, total somente uma vez; `:301`, `assert.ok(plan.every((page) => page.usedHeight <= page.availableHeight))`; `:302`, todo texto preservado; `:364`, curto em uma página. |

Mapeamento reverso: casos iniciados em `test/order-receipt.test.js:77`, `:102`,
`:109`, `:122`, `:135`, `:144`, `:166`, `:178`, `:225`, `:256`, `:283`, `:315`,
`:331` e `:358` se vinculam aos IDs RCP dos seus títulos. Não há testes de
framework, transporte ou comportamento fora do contrato do documento.

RCP-10 e RCP-11 permanecem em implementação até os gates HTTP/UI e a revisão
independente. O documento não amplia autorização nem registra primeira impressão.

### T3: Disponibilizar a leitura comercial protegida — RCP-T02b

**Where**: `apps/api/src/order-receipt-routes.js`
**Depends on**: T2
**Tests**: integration
**Gate**: Full

Suporte: registro em order-routes, serviço/runtime de pedidos, testes HTTP e
runtime. Premissas: order.read mais ACL explícita; loja e sem dono só Admin.

**Done when**:

- [x] Prévia/PDF revalidam ACL e revisão; mudanças durante render negam bytes.
- [x] Download audita sem PII, sem mutação comercial ou primeira impressão.
- [x] Cenários 400/401/403/404/409/429/503, HEAD e falha de auditoria testados.

Gate T3: 11 testes HTTP novos e 100 regressões de rotas/runtime/loja/leitura
passaram sem skips. Typecheck, lint global, design tokens e diff-check passaram.
O campo aditivo receiptAvailable foi incluído na assertion estrita do contrato
existente, preservando a conferência de todas as chaves anteriores.

| Critério                       | Evidência e resultado definido                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCP-06/10, leitura e auditoria | `test/order-receipt-routes.test.js:144`, `assert.equal(pdf.statusCode, 200)`; `:154`, auditoria com ator/ação/pedido/revisão exatos; `:169`, pedido igual ao snapshot anterior.    |
| RCP-08, ACL/transferência      | `test/order-receipt-routes.test.js:183`, 403 ao outro vendedor/Financeiro/automação; `:250`, download negado após transferência; `:255`, sem dono nega vendedor; `:257`, Admin lê. |
| RCP-07, fonte corrente         | `test/order-receipt-routes.test.js:321`, 409 após versão/cliente/vendedor mudar; `:322`, código RECEIPT_STALE; `:364`, alteração durante render impede bytes.                      |
| RCP-09/10, falhas              | `test/order-receipt-routes.test.js:379`, 503; `:380`, corpo sanitizado; `:385`, sem auditoria de download; `:387`, repetição explícita retorna 200.                                |
| HEAD e limites                 | `test/order-receipt-routes.test.js:395`, HEAD 200 vazio, `:427`, sem render; `:438`, décima primeira geração recebe 429.                                                           |

Mapeamento reverso: todos os onze testes dessa suíte têm IDs RCP no título,
checando resultados/códigos/dados e não somente chamadas. Sem teste removido,
skip introduzido ou assertion existente enfraquecida.

### T4: Integrar uma prévia nas duas telas — RCP-T03/04

**Where**: `apps/edge-web/src/components/order/OrderReceiptPreview.vue`
**Depends on**: T3
**Tests**: e2e + unit
**Gate**: Full

Suporte: cliente HTTP, OrdersView, OrderView, tokens de papel, testes de cliente
e E2E, runbook e verificação independente. Premissas: modal local preserva a
lista; autosave termina antes de ler a prévia; PDF da fábrica mantém seu fluxo.

**Done when**:

- [x] Botões atendem RCP-01/12 e fluxo atende RCP-02/07/08/09/11.
- [x] Estados negativos, teclado, contraste, 320 px e regressão da ficha passam.
- [x] Gates de implementação completos e entrega atômica de código com commit/push no PR 375.

Evidência local T4 (Windows, Node 24.14.1): cliente HTTP 7/7; E2E dedicado
19 casos mais `orders-list.spec.js` e `orders.spec.js`, 172/172 sem skips.
Typecheck, lint global, design tokens e diff-check passaram. A UI mantém a
ficha existente e seu PDF, inclusive o botão móvel no rodapé. Nenhum teste ou
fixture existente foi alterado; o mock de pedidos foi reutilizado sem patch.

| Critério T4  | Evidência de assertion                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCP-01/02/12 | E2E `list action is between PDF/open...`: ordem exata das ações, busca estabilizada, Escape, mesmo foco, rolagem e URL.                                                                                                                                   |
| RCP-03/04/06 | E2E `list downloads a confirmed receipt...` e `detail preserves existing actions...`: estado confirmado sem provisório; pendente com aviso, total A definir e sem zero inventado; nomes independentes do recibo e ficha.                                  |
| RCP-07/08    | E2E `PDF failure permits explicit retry...`, `permission loss...`, quatro casos SSE e dois de resposta tardia: 409 remove artigo/download; 403 não permite retry; evento alheio preserva artigo; evento relevante e metadata revogada removem dados.      |
| RCP-09       | E2E `opening waits for blur autosave...`: segunda seção digitada durante espera também salva, prévia só abre na versão 4; `another successful section cannot clear...`: erro em uma seção bloqueia apesar de outra salvar, até corrigir a seção original. |
| RCP-10/11    | Quatro E2E 320/390 px × claro/escuro: payload HTML aparece como texto, sem img/script/iframe; overflow ≤ 1 px, papel branco e todos os td escuros; axe zero violações. Tab/Shift+Tab, Escape e retorno de foco explícitos.                                |
| RCP-07/08/09 | `test/order-receipt-client.test.js`: credenciais/signal, ordem/schema/fingerprint, versão/query, MIME, códigos negativos, abort após Blob e nomes por estado.                                                                                             |

Âncoras de adequação, com resultado esperado derivado da spec:

| Critério | Assertion e resultado definido |
| -------- | ------------------------------ |
| RCP-01/12 | `test/e2e/order-receipt.spec.js:113`, `toHaveText(/Gerar PDF\s*05-CRM\s*Recibo\s*05-CRM\s*Abrir pedido/u)`; `:189`, `expect(open).toBeVisible()` no detalhe. |
| RCP-02/11 | `test/e2e/order-receipt.spec.js:141`, `expect(button).toBeFocused()`; `:143`, `expect(await list.evaluate((el) => el.scrollTop)).toBe(before)`; `:163`, Fechar focado após Tab. |
| RCP-03/04/06 | `test/e2e/order-receipt.spec.js:156`, `not.toContainText('provisório')`; `:198`, total `A definir`; `:201`, `not.toContainText('R$ 0,00')`; `:170` e `:177`, nomes exatos e distintos dos dois PDFs. |
| RCP-07/08 | `test/e2e/order-receipt.spec.js:239`, `getByRole('article').toHaveCount(0)` após 409; `:266`, nenhum botão de retry após 403; `:353`, documento descartado após perda de acesso; `:410`, `expect(downloads).toBe(0)` após troca de alvo. |
| RCP-07/09 | `test/e2e/order-receipt.spec.js:283`, prévia recuperada contém `Buffet Casa Rosa`; `:324`, alerta ausente para evento alheio; `:449`, rodapé contém `Versão 4`; `:483`, `expect(control.previewReads).toBe(0)` após autosave falho. |
| RCP-10/11 | `test/e2e/order-receipt.spec.js:523`, HTML ativo ausente; `:533`, overflow no máximo 1 px; `:534`, papel `rgb(255, 255, 255)`; `:535`, todas as células `rgb(32, 22, 52)`; `:539`, `expect(axe.violations).toEqual([])`. |
| Cliente RCP-07/08/09 | `test/order-receipt-client.test.js:54`, payload exato da prévia; `:74`, resposta inválida rejeitada; `:125`, códigos/status exatos; `:149`, MIME inválido rejeitado com 502; `:173`, bytes abortados rejeitados com `AbortError`. |

Mapeamento reverso: os casos E2E iniciados em `:92`, `:147`, `:180`, `:207`,
`:225`, `:253`, `:271`, `:292` (três eventos), `:328`, `:362`, `:387`, `:413`,
`:452` e `:500` (quatro combinações) se vinculam aos IDs RCP de seus títulos.
Os sete casos do cliente em `:42`, `:62`, `:83`, `:109`, `:134`, `:157` e
`:181` também trazem o ID RCP. Nenhum caso sem requisito ou assertion rasa;
locais e padrões seguem CONTRIBUTING e as suítes existentes de pedidos.

Gate Linux T4: Node 24.20.0/npm 11.19.0, `npm run validate` passou com 2.758
testes aprovados, zero falhas e 53 skips de PostgreSQL sem banco de teste;
formatação, tipos, lint, fronteiras, contratos e build passaram. `npm audit
--audit-level=high` encontrou zero vulnerabilidades. E2E integral e Verifier
ficam em T5. Screenshots sintéticos: `test-results/order-receipt-*/receipt-*.png`.
Smoke no CRM local 4180 confirmou ambas as entradas, download PDF real de
19.910 bytes e pedido idêntico antes/depois, com dados exclusivamente sintéticos.
RCP permanece `implementing`; T5 registra a verificação independente.

### T5: Verificar a entrega integrada — RCP-T05

**Where**: `.specs/features/order-receipt/validation.md`
**Depends on**: T4
**Tests**: independent verification
**Gate**: Build

Suporte: spec, tasks, matriz de cobertura e revisão independente. Premissas:
T4 recebe o commit de código antes da auditoria; o Verifier não reescreve o
patch. O Tech Lead executa os gates finais no ambiente Linux dedicado.

**Done when**:

- [ ] Gates completos e evidências da integração registrados em validation.md.
- [ ] Verifier independente PASS por requisito e discriminação dos cenários negativos.
- [ ] Status de requisitos somente então verified; commit/push de verificação e PR atualizados.

## Cross-check

| Task | Depends on | Diagram  | Co-location   |
| ---- | ---------- | -------- | ------------- |
| T1   | None       | início   | structural    |
| T2   | T1         | T1 -> T2 | unit + render |
| T3   | T2         | T2 -> T3 | integration   |
| T4   | T3         | T3 -> T4 | e2e + unit    |
| T5   | T4         | T4 -> T5 | independent   |

Cada tarefa entrega um contrato, um documento, uma fronteira HTTP ou um fluxo
de interface verificável. O autor executa os gates; o Verifier não altera o patch.

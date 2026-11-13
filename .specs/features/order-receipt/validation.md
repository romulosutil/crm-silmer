# Validation: Recibo comercial do pedido — PASS

**Result**: PASS. Os 11 critérios de aceite, que abrangem RCP-01–12, têm
evidência de resultado. As nove falhas comportamentais injetadas foram
detectadas. Não há finding acionável ou lacuna de precisão da spec neste recorte.

**Data**: 13/11/2026. **Spec**: `.specs/features/order-receipt/spec.md`.
**Intervalo revisado**: `ac8169de..1ed008e0`.
O HEAD 1ed008e0 é a baseline de implementação. O commit T5 posterior
será exclusivamente documental e não faz parte do código submetido ao sensor.

**Verifier**: subagente independente `receipt_verifier`, autor de zero código
ou testes da entrega. A revisão não modificou implementação, testes ou Git.

O PASS cobre a implementação local e seus gates. Não declara CI, merge,
deploy, homologação física da ficha ou prontidão operacional de produção.

## Tarefas e escopo

| Tarefa          | Resultado da revisão                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| T1 / RCP-T01    | Contrato aprovado registrado na ADR 089; extensão restrita das regras 9/10 preserva a ficha da fábrica.     |
| T2 / RCP-T02a   | Projeção mínima, valores exatos e documento A5 verificados.                                                 |
| T3 / RCP-T02b   | Leitura protegida, fences e auditoria verificados.                                                          |
| T4 / RCP-T03/04 | Lista, detalhe, autosave, modal e cliente HTTP verificados no commit `1ed008e0`.                            |
| T5 / RCP-T05    | Revisão independente concluída neste relatório; atualização de status e commit/push pertencem ao Tech Lead. |

Foram inspecionados o diff dos 26 arquivos, a spec, ADR 089, RULES,
ARCHITECTURE, AGENTS e CONTRIBUTING. O grafo existente foi tratado somente
como mapa histórico; as conclusões vieram das fontes atuais. Não há nova
dependência, infraestrutura, migração, store global ou envio automático.

## Critérios de aceite e resultados esperados

As assertions abaixo foram conferidas contra os resultados da spec, inclusive
payloads e estados. Contagem de chamadas isolada não foi aceita como prova.

| AC / IDs      | Resultado definido pela spec                                                                                                 | Evidência `file:line` e assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Resultado |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1 / RCP-01/12 | Recibo após PDF e antes de Abrir pedido; uma entrada no cabeçalho do detalhe.                                                | `test/e2e/order-receipt.spec.js:113`, `toHaveText(/Gerar PDF\s*05-CRM\s*Recibo\s*05-CRM\s*Abrir pedido/u)`; `:189`, `expect(open).toBeVisible()`. Montagem única por tela em `apps/edge-web/src/views/OrdersView.vue:1515` e `apps/edge-web/src/views/OrderView.vue:1248`.                                                                                                                                                                                                                                                  | PASS      |
| 2 / RCP-02    | Fechar conserva busca, URL e rolagem e devolve foco previsível.                                                              | `test/e2e/order-receipt.spec.js:141`, `expect(button).toBeFocused()`; `:142`, busca mantém `Cliente`; `:143`, scroll igual ao anterior; `:144`, URL continua `/pedidos`; `:204`, foco volta ao botão do detalhe. Fallback quando o acionador saiu do DOM em `apps/edge-web/src/components/order/OrderReceiptPreview.vue:187`.                                                                                                                                                                                               | PASS      |
| 3 / RCP-03    | Pendente/reaberto provisório; cancelado histórico em cada página; confirmado sem provisório.                                 | `test/order-receipt.test.js:240`, número em cada página; `:242`, aviso provisório; `:247`, aviso cancelado; `:250`, ausência de provisório no confirmado. `test/e2e/order-receipt.spec.js:156`, confirmado sem provisório; `:195`, aviso pendente exato. `test/order-receipt-routes.test.js:290`, estado e sufixos do PDF.                                                                                                                                                                                                  | PASS      |
| 4 / RCP-04    | Ausências explícitas, sem zero inventado ou total parcial contratado; legado conserva total conhecido.                       | `test/order-receipt.test.js:156`, quantidade `null`; `:159`, total `null`; `:161`/`:162`, Não informado/A definir; `:163`, sem `R$ 0,00`; `:131`, subtotal não revisado impede total; `:171`, legado/loja conserva `530500`. `test/e2e/order-receipt.spec.js:198`, total `A definir`; `:201`, sem zero.                                                                                                                                                                                                                     | PASS      |
| 5 / RCP-05    | Quantidade/subtotal revisados e total com frete; unitário somente quando exato; preços distintos não se misturam.            | `test/order-receipt.test.js:79`, itens exatos com quantidades `120`/`60`, unitários `2900`/`3000` e subtotais `348000`/`180000`; `:97`–`:99`, peças `528000`, frete `2500`, total `530500`; `:106`, itens diferentes não se fundem; `:117`–`:119`, fração conserva `10000` e unitário `null`; `:325`, máximo seguro termina em `,91`.                                                                                                                                                                                       | PASS      |
| 6 / RCP-06    | PDF privado, sem alterar pedido, pagamento, posse, aviso da loja ou primeira impressão.                                      | `test/order-receipt-routes.test.js:144`–`:146`, 200/application/pdf/private-no-store; `:169`, pedido igual ao snapshot; `:230`, primeira impressão da loja continua `null`; `:299`–`:301`, pagamento/primeira impressão/versão preservados. `test/e2e/order-receipt.spec.js:170` e `:177`, nomes distintos `recibo-05-CRM.pdf` e `pedido-05-CRM.pdf`.                                                                                                                                                                       | PASS      |
| 7 / RCP-07    | Conteúdo/revisão alterados produzem 409 RECEIPT_STALE sem PDF; resposta/bytes tardios não cruzam alvos.                      | `test/order-receipt-routes.test.js:321`/`:322`, 409/código exato após versão, cliente ou vendedor mudar; `:364`–`:366`, alteração durante render nega bytes; `:276`/`:277`, proof de outro pedido negado. `test/e2e/order-receipt.spec.js:239`, artigo removido após 409; `:247`, atualização exibe cliente novo; `:379`/`:382`, resposta antiga não troca documento/título; `:410`, nenhum download tardio. `test/order-receipt-client.test.js:173`, Blob abortado rejeita com `AbortError`.                               | PASS      |
| 8 / RCP-08    | Sessão/perfil/posse inválidos negam prévia e PDF, inclusive Financeiro/automações; loja/sem dono só Admin.                   | `test/order-receipt-routes.test.js:183`/`:184`, 403 para outro vendedor, Financeiro e automação; `:191`, ausência de sessão; `:197`/`:198`, sessão revogada; `:226`/`:229`, loja/sem dono recusam vendedor e permitem Admin; `:250`–`:257`, transferência e conversa sem dono. `test/e2e/order-receipt.spec.js:218`/`:222`, flag ausente/falsa não ganha acesso; `:262`/`:266`, 403 remove conteúdo e retry; `:353`–`:359`, perda de acesso via metadata faz o mesmo.                                                       | PASS      |
| 9 / RCP-09    | Sem geração concorrente; autosave termina antes da prévia; falha de uma seção bloqueia até correção; retry é explícito.      | `test/e2e/order-receipt.spec.js:403`, geração desabilitada; `:438`/`:439`, preparação desabilitada e zero leituras antes do save; `:445`–`:449`, ambas as edições salvas na versão 4; `:479`–`:483`, seção falha bloqueia apesar de outra salvar; `:489`/`:493`, corrigir libera a prévia com `PRETA`; `:234`/`:238` e `:277`/`:282`, erros têm retry explícito. `test/order-receipt-routes.test.js:438`, 11ª geração recebe 429.                                                                                           | PASS      |
| 10 / RCP-10   | Allowlist, escaping, fontes embutidas, zero recurso externo, ressalva e auditoria mínima sem PII.                            | `test/order-receipt.test.js:194`, chaves exatas; `:221`/`:222`, sem canários privados e input imutável; `:262`/`:266`, HTML preservado como texto escapado; `:270`/`:272`, fonte embutida e sem recurso executável/externo; `:276`, ressalva exata. `test/order-receipt-routes.test.js:154`, auditoria com ator/ação/pedido/revisão/correlação exatos; `:165`, sem PII/valores; `:380`/`:385`, falha sanitizada sem sucesso auditado. `test/e2e/order-receipt.spec.js:520`/`:523`, texto hostil não cria img/script/iframe. | PASS      |
| 11 / RCP-11   | Teclado/foco acessíveis; 320 px e escuro com papel branco/texto escuro; PDF longo conserva linhas/identidade/estado e final. | `test/e2e/order-receipt.spec.js:157`–`:163`, foco inicial e ciclo Shift+Tab/Tab; `:533`, overflow ≤1 px; `:534`, papel `rgb(255, 255, 255)`; `:535`, todas as células `rgb(32, 22, 52)`; `:539`, axe sem violações; `:544`–`:547`, Escape devolve foco. `test/order-receipt.test.js:295`/`:296`, total somente na última página; `:301`/`:302`, orçamento e recomposição integral das linhas; `:240`–`:250`, identidade/estado por página.                                                                                  | PASS      |

O contrato HTTP adicional também tem prova: `test/order-receipt-routes.test.js:395`
e `:427` verificam HEAD vazio sem render; `:407` verifica 400 em entradas
inválidas; `:412`, 404; `:379`, 503 sem bytes. O cliente confere URL, versão,
fingerprint, credenciais e signal em `test/order-receipt-client.test.js:87`;
`:125` mantém status/código; `:149` rejeita sucesso com MIME errado.

## Adequação, integridade e revisão adversarial

Os 14 testes do documento cobrem RCP-03/04/05/10/11; os 11 HTTP cobrem
RCP-03/06/07/08/09/10; os sete do cliente cobrem RCP-03/06/07/08/09.
Os 19 E2E cobrem RCP-01/02/03/04/06/07/08/09/10/11/12. Cada caso traz
seu requisito no título. Os três eventos SSE e as quatro combinações
320/390 px × claro/escuro são casos parametrizados, não testes sem dono.

Não houve teste removido, skip novo ou assertion enfraquecida. O único teste
existente alterado preserva a lista exata de chaves e acrescenta
`receiptAvailable` (`test/order-routes.test.js:49`). As regressões de lista,
detalhe e fixtures existentes não foram reescritas.

Foram seguidos AGENTS e CONTRIBUTING: patch restrito, Vue/Router existentes,
dados sintéticos, autorização na API, foco/teclado e minimização. O guard
real de sessão/perfil foi lido em `apps/api/src/operation-runtime.js:1312`,
além do stub de testes. A projeção foi rastreada até preços/frete oficiais,
nome corrente de pendentes e composição legada válida. Campos internos não
entram no HMAC nem no documento projetado.

Não foi confirmado bypass de ACL, arredondamento, perda de linha, vazamento
de PII ou efeito comercial indevido. Não há fix task ou lição de falha para
registrar. Nenhum arquivo de lessons foi alterado.

## Sensor de discriminação

Profundidade ampliada por autorização/integridade: **9 injetadas, 9 mortas,
0 sobreviventes**. Cada mutação foi aplicada separadamente sobre o código
novo; a falha veio da assertion esperada, não de import, sintaxe ou build.

| Mutação | Fonte                                                 | Falha comportamental injetada                                    | Assertion que a detectou                                                                                               | Resultado     |
| ------- | ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| M01     | `modules/orders/src/application/order-service.js:467` | Ignorar a restrição responsável/Admin para humanos.              | `test/order-receipt-routes.test.js:183`, 200 indevido em vez de 403; também loja/sem dono e transferência.             | Morta, exit 1 |
| M02     | `apps/api/src/order-receipt-routes.js:86`             | Retirar comparação de conteúdo após render.                      | `test/order-receipt-routes.test.js:364`, PDF 200 indevido em vez de 409.                                               | Morta, exit 1 |
| M03     | `apps/api/src/order-receipt-routes.js:87`             | Omitir auditoria de download.                                    | `test/order-receipt-routes.test.js:153`, zero eventos em vez de um; `:379`, falha de auditoria deixa de impedir bytes. | Morta, exit 1 |
| M04     | `modules/orders/src/print/order-receipt.js:140`       | Arredondar unitário fracionário em vez de mantê-lo indisponível. | `test/order-receipt.test.js:117`, unitário `3333` em vez de `null`.                                                    | Morta, exit 1 |
| M05     | `modules/orders/src/print/order-receipt.js:172`       | Usar somente peças como total, perdendo frete.                   | `test/order-receipt.test.js:99`, `528000` em vez de `530500`.                                                          | Morta, exit 1 |
| M06     | `modules/orders/src/print/order-receipt.js:258`       | Mostrar confirmado no lugar do aviso provisório.                 | `test/order-receipt.test.js:242`, falta do aviso obrigatório por página.                                               | Morta, exit 1 |
| M07     | `apps/edge-web/src/lib/order-receipt.js:73`           | Entregar Blob abortado após preparação do corpo.                 | `test/order-receipt-client.test.js:173`, falta da rejeição `AbortError`.                                               | Morta, exit 1 |
| M08     | `apps/edge-web/src/views/OrderView.vue:140`           | Ignorar seção cujo autosave falhou.                              | `test/e2e/order-receipt.spec.js:479`, diálogo visível indevidamente.                                                   | Morta, exit 1 |
| M09     | `apps/edge-web/src/views/OrderView.vue:131`           | Não esperar a fila de gravações.                                 | `test/e2e/order-receipt.spec.js:438`, estado obrigatório de preparação ausente.                                        | Morta, exit 1 |

M01–M07 usaram cópias temporárias devolvidas por `registerHooks(load)`, com
baseline verde dos 32 testes. O loader registrou a aplicação de cada fault.
Uma tentativa inicial com caminho Windows inválido em `--import` foi
descartada; nenhum erro de loader foi contado como mutação morta.
M08/M09 usaram cópia isolada em `/tmp/crm-receipt-ui-sensor`, porta 4191,
com baseline 2/2 e zero retries. `/work` não recebeu mutações.

As cópias/loaders foram descartados; o scratch Linux foi removido após
conferência do destino. Não houve stash, worktree ou junction. O porcelain
do checkout real era vazio antes e continuou vazio após o descarte. Somente
depois dessa comparação este relatório foi criado.

Logs e resultados do sensor foram preservados fora da árvore em
`C:/Users/Ronal/AppData/Local/Temp/crm-receipt-sensor-fh8zhv2v/`:
`baseline.log`, `M01.log`–`M07.log`, `results.json`, `ui-baseline.log`,
`ui-M08.log`, `ui-M09.log`, `ui-results.json` e os dois snapshots porcelain.

## Gates e limites da evidência

| Gate                           | Executor/ambiente                                                                    | Resultado                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`             | Tech Lead, snapshot Linux dedicado, Node 24.20.0 e npm 11.19.0 explícito via npx     | Exit 0; 2.758 aprovados, zero falhas, 53 skips de PostgreSQL sem `TEST_DATABASE_URL`; formatação, tipos, lint, fronteiras, contratos e build aprovados. Log `tmp/receipt-final-validate.log`, resumo em `:5765`–`:5770`.                             |
| E2E integral                   | Tech Lead, Playwright 1.62.1/Linux, 2 workers e até 2 retries, npm 11.19.0 explícito | Exit 0; 1.052 aprovados, um flaky aprovado no retry 1, sete skips, total 1.060 em 9,8 min. Os 19 do recibo passaram sem retry. Log `/tmp/receipt-e2e.log` no container `crm-silmer-receipt-verify`, cópia `full-e2e.log` no diretório externo acima. |
| `npm audit --audit-level=high` | Tech Lead, mesmo snapshot                                                            | Exit 0, zero vulnerabilidades; `tmp/receipt-final-audit.log`.                                                                                                                                                                                        |
| Baseline dedicada Node         | Verifier, Windows/Node 24.14.1                                                       | `node --test test/order-receipt.test.js test/order-receipt-routes.test.js test/order-receipt-client.test.js`: 32/32, zero skip.                                                                                                                      |
| Baseline autosave              | Verifier, cópia Linux/Node 24.20.0, porta 4191                                       | Dois E2E alvo passaram, zero retry; depois M08/M09 foram detectadas com npm 11.19.0 explícito.                                                                                                                                                       |
| Validadores e diff             | Verifier                                                                             | `validate_spec.py order-receipt`, `validate_tasks.py order-receipt` e `git diff --check ac8169de..1ed008e0`: exit 0.                                                                                                                                 |

Os logs integrais foram consumidos pelo Verifier; o gate global não foi
repetido sem necessidade. O diff acrescenta 32 testes Node e 19 E2E, sem
remoções. Os totais anteriores inferidos sob a mesma descoberta são 2.779
Node e 1.041 E2E; não representam uma execução nova do commit anterior.

Os 53 skips Node são casos preexistentes de banco, individualmente nomeados
no log e condicionados à ausência de `TEST_DATABASE_URL`. Não são cobertura
PostgreSQL executada. Os sete E2E ignorados são os cenários aposentados de
Kanban/Negócio da ADR 004, em `test/e2e/crm-ui.spec.js:762`, `:3248`,
`:3271`, `:3308`, `:3317`, `:3336` e `:3348`. Nenhum pertence ao recibo.
O flaky é `test/e2e/audio-recorder.spec.js:426`, captura exata de 16 MiB:
a primeira execução falhou em `:438` e a primeira repetição passou.
Não houve alteração desse cenário ou de suas assertions.

Checksums SHA-256 dos logs consumidos:

- validate: `3229107216b630aedb2a1f2e117b9d2a1929e8a65f722b5fc508c636954535ed`.
- E2E integral: `8ece9953808be0ecfb8dfe73ebaa38dd75a598d34a00be71f3140effca4cb0b0`.
- audit: `6d8c5c8f3d7684adb070417bd608d01ae90aa3dc26a65af03ffda4955f38d9a3`.

## Documento real e interface

O Verifier inspecionou o recibo curto, o final do longo, a prévia no CRM
local e a captura móvel escura de 320 px. A extração independente com pypdf
confirmou 19 páginas no PDF longo e `Recibo do pedido` em todas, com total
e ressalva finais. Os artefatos sintéticos e a geometria estão em
`tmp/pdfs/receipt/`; não se presume que um plano HTML seja prova do PDF.

O smoke do Tech Lead no CRM local 4180 verificou lista/detalhe, foco, PDF
real de 19.910 bytes e pedido idêntico antes/depois. Suas assertions estão
em `tmp/receipt-live-smoke.mjs:28`, `:40`, `:42`, `:50` e `:54`; artefatos
`tmp/receipt-live.pdf` e `tmp/receipt-live-*.png`. A revisão visual foi
independente; não foi uma nova sessão de UAT humano em produção.

## Fechamento

RCP-01–12 estão aptos a passar de `implementing` para `verified`. A spec e
as tarefas foram preservadas para atualização pelo Tech Lead no commit T5.
Não há gaps ranqueados ou fix tasks neste recorte. A próxima ação é integrar
este relatório e a rastreabilidade, concluir o CI do PR e seguir o fluxo de
release aprovado.

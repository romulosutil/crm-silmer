# Validação independente — Datas do pedido

## Validation: PASS

**Result**: PASS para o comportamento DTL-01–12 implementado localmente.
Revisor: agente QA independente `review_timeline_proposal`, autor diferente
dos agentes de backend/frontend. Data: 11/11/2026.

Intervalo de código revisado: `ccb96b39..fca7d809`, composto pelo backend
`15414abc` e frontend integrado `fca7d809`. Especificação:
[spec.md](spec.md); tarefas T2/T3 e verificação T4 de [tasks.md](tasks.md).
Este relatório não autoriza merge, deploy, dinheiro ou mensagens reais.

Não foram encontrados achados bloqueantes na revisão final. As evidências
abaixo distinguem execução independente, gates integrados informados pelo
Tech Lead e limitações de ambiente. A execução global E2E terminou com duas
falhas de infraestrutura descritas abaixo; ambos os casos foram cobertos por
retestes inalterados, sem reclassificar o processo original como aprovado.

## Matriz de requisitos e resultados

| Requisito | Resultado e evidência do código                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidência observável nos testes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTL-01    | PASS. `apps/api/src/order-timeline-projection.js:16` consolida identidade com namespace por fonte/ID; `apps/api/src/order-billing-runtime.js:287` oferece a projeção aditiva autorizada.                                                                                                                                                                                                                                                                      | `test/order-timeline-projection.test.js:32` exige exatamente dois eventos com manual repetido; `test/order-timeline-projection.test.js:139` preserva IDs colidentes entre fontes e ordem determinística; `test/order-timeline-postgres-live.test.js:146` inclui outro pedido e exige somente seus dois recebimentos.                                                                                                                                                                                              |
| DTL-02    | PASS. `apps/edge-web/src/lib/order-timeline.js:40` compõe apresentação; não grava `paidOn` nem calcula saldo por soma dos eventos. `apps/edge-web/src/components/order/OrderMilestonesSection.vue:531` mostra totais oficiais.                                                                                                                                                                                                                                | `test/order-timeline-projection.test.js:154` não cria recebimentos do ledger vazio; `test/order-timeline.test.js:76` não transforma link aguardando em pagamento; `test/e2e/order-timeline.spec.js:187` exige pagamento parcial preservado após entrega.                                                                                                                                                                                                                                                          |
| DTL-03    | PASS. `apps/api/src/order-timeline-projection.js:55` usa `received_on` manual e `occurredAt=null`; `apps/edge-web/src/lib/order-timeline.js:109` separa a data efetiva dos detalhes de registro.                                                                                                                                                                                                                                                              | `test/order-timeline-projection.test.js:32` exige dia manual 04/11 e registro em 06/11, sem horário efetivo; `test/order-timeline-postgres-live.test.js:146` verifica essa distinção no PostgreSQL.                                                                                                                                                                                                                                                                                                               |
| DTL-04    | PASS. `apps/api/src/order-timeline-projection.js:57` usa `verified_at` convertido para São Paulo; `apps/edge-web/src/lib/order-timeline.js:136` identifica confirmação no CRM.                                                                                                                                                                                                                                                                                | `test/order-timeline-projection.test.js:32` exige 05/11 para `2026-11-06T01:30Z`; `test/order-timeline.test.js:42` exige informação de confirmação/verificação, sem alegar instante da transação.                                                                                                                                                                                                                                                                                                                 |
| DTL-05    | PASS. `apps/api/src/order-timeline-projection.js:37` distingue reversão, devolução parcial/integral, aplicação inválida e revisão; `apps/api/src/order-timeline-projection.js:68` e `apps/api/src/order-timeline-projection.js:86` mantêm correções ligadas ao original.                                                                                                                                                                                      | `test/order-timeline-projection.test.js:73`, `test/order-timeline-projection.test.js:97` e `test/order-timeline-projection.test.js:127` exigem original preservado, líquido aplicado, correções individuais e estados. SQL em `test/order-timeline-postgres-live.test.js:216`, `test/order-timeline-postgres-live.test.js:244` e `test/order-timeline-postgres-live.test.js:265` verifica replay de reversão, devolução parcial e pagamento tardio em revisão sem crédito duplicado.                              |
| DTL-06    | PASS. `apps/edge-web/src/lib/order-timeline.js:64` usa Pedido confirmado; `apps/edge-web/src/lib/order-timeline.js:189` ordena por dia, instante conhecido e ID; `apps/edge-web/src/components/order/OrderMilestonesSection.vue:616` dispõe os eventos em flex horizontal.                                                                                                                                                                                    | `test/e2e/order-timeline.spec.js:139` exige x crescente/y comum, quatro eventos para fontes mistas, ausência de `dl` e ausência do subtítulo Linha do tempo.                                                                                                                                                                                                                                                                                                                                                      |
| DTL-07    | PASS. `apps/edge-web/src/lib/order-timeline.js:147` preserva quitação legada sem valor/fonte inventados; `apps/edge-web/src/lib/order-timeline.js:168` usa somente entrega conhecida e prova correspondente para autoria.                                                                                                                                                                                                                                     | `test/order-timeline.test.js:30` não cria datas ausentes; `test/order-timeline.test.js:76` exige quitação sem valor; `test/order-timeline.test.js:126` impede empréstimo da autoria comercial para entrega legada; `test/e2e/order-timeline.spec.js:281` cobre ausência do endpoint financeiro.                                                                                                                                                                                                                   |
| DTL-08    | PASS. `apps/edge-web/src/components/order/OrderMilestonesSection.vue:58` associa snapshot ao pedido; `apps/edge-web/src/components/order/OrderMilestonesSection.vue:76` distingue versão desatualizada; `apps/edge-web/src/components/order/OrderBillingSection.vue:224` descarta leitura abortada/de outro pedido. O fallback em `apps/edge-web/src/components/order/OrderMilestonesSection.vue:68` preserva quitação conhecida enquanto falta detalhamento. | `test/order-timeline.test.js:141` exige quitação com status aguardando atualização; `test/e2e/order-timeline.spec.js:293` exige alerta e preservação de marcos; `test/e2e/order-timeline.spec.js:371` impede resposta antiga de substituir histórico de outro pedido; `test/e2e/order-timeline.spec.js:139` conserva duas leituras existentes de billing/workspace, sem terceira consulta pela seção de datas.                                                                                                    |
| DTL-09    | PASS. `apps/api/src/order-billing-runtime.js:53` revalida ator humano ativo e papel; `apps/api/src/order-billing-runtime.js:287` condiciona novos eventos a owner/admin; `apps/edge-web/src/lib/order-timeline.js:74` também omite eventos sem gestão autorizada. A projeção é whitelist e não devolve NSU, URL, nota ou motivo.                                                                                                                              | `test/order-timeline-postgres-live.test.js:281` exige acesso owner/admin, eventos vazios para outro vendedor e rejeição a Financeiro/inativo/automação; `test/order-timeline-postgres-live.test.js:146` e `test/order-timeline-projection.test.js:32` verificam ausência de canárias privadas nos eventos.                                                                                                                                                                                                        |
| DTL-10    | PASS. `apps/edge-web/src/components/order/OrderMilestonesSection.vue:89` limita botão a responsável/admin, atendimento confirmado, não teste/cancelado e sem entrega; `apps/edge-web/src/views/OrderView.vue:371` congela pedido/versão/chave. Endpoint existente `apps/api/src/order-routes.js:682` aceita somente versão e usa guardas normais.                                                                                                             | `test/e2e/order-timeline.spec.js:267` cobre cinco inelegibilidades; `test/e2e/order-timeline.spec.js:187` exige body somente com `expectedVersion`, chave de idempotência e CSRF; `test/manual-order-service.test.js:171` e testes de rota existentes preservam autorização/regras do comando.                                                                                                                                                                                                                    |
| DTL-11    | PASS. `apps/edge-web/src/components/order/OrderMilestonesSection.vue:144` só reflete sucesso retornado; `apps/edge-web/src/components/order/OrderMilestonesSection.vue:166` exige releitura explícita para resultado incerto; `apps/edge-web/src/components/order/OrderMilestonesSection.vue:110` bloqueia contexto obsoleto/dobro. `apps/api/src/order-billing-runtime.js:239` exige evento real correlacionado à auditoria para metadata de entrega.        | `test/e2e/order-timeline.spec.js:187` cobre persistência visual, data do servidor, cancelar/Escape e saldo/status preservados; `test/e2e/order-timeline.spec.js:238` não inventa entrega em conflito/falha; `test/e2e/order-timeline.spec.js:311` exige leitura antes de retry humano com mesma chave/body; `test/e2e/order-timeline.spec.js:343` exige uma escrita para duplo Enter. `test/order-timeline-postgres-live.test.js:331` impede no-op de atribuir nova autoria e retorna null para legado sem prova. |
| DTL-12    | PASS. `apps/edge-web/src/components/order/OrderMilestonesSection.vue:192` restaura foco; `apps/edge-web/src/components/order/OrderMilestonesSection.vue:476` oferece região nomeada/focável; detalhes são nativos. Formulário legado e comandos de datas permanecem.                                                                                                                                                                                          | `test/e2e/order-timeline.spec.js:187` exige foco em cancelar/resultado e zero violações axe; `test/e2e/order-timeline.spec.js:407` verifica 320px, sem overflow da página, ArrowRight com scroll real e modal que cabe na viewport. Regressão de Pedidos/Cobranças mantém edição de datas onde autorizada.                                                                                                                                                                                                        |

## Execuções e proveniência

Execuções realizadas pelo revisor independente:

- `node --test test/order-timeline-projection.test.js test/order-timeline-postgres-live.test.js`,
  com `TEST_DATABASE_URL` exclusivamente no banco sintético de testes
  `127.0.0.1:15436/crm_silmer_test_timeline`: **14 aprovados, zero falhas/skips**.
  Nenhuma migração foi aplicada ao banco de desenvolvimento compartilhado.
- `node --test test/order-timeline.test.js`: **6 aprovados, zero falhas/skips**.
- Inspeção estática independente dos contextos de entrega, foco, concorrência,
  autorização, privacidade, precisão de datas e reutilização de billing.

Gates integrados informados pelo Tech Lead, sobre o código final `fca7d809`:

- `npm run validate`: **2.509 aprovados**, 53 skips de suítes opcionais que
  exigem DB; tipos, lint, formato, fronteiras, tokens e build aprovados.
  Repetido com **Node 24.20.0/npm 11.19.0**, saída zero; log em
  `tmp/order-timeline-pinned-validate.log`.
- PostgreSQL dedicado: 14 testes novos e **69 regressões aprovadas**;
  as suítes live não são inferidas a partir dos skips do gate padrão.
- E2E novos: **15 aprovados**. Regressões centrais: **113 aprovadas**,
  sendo 109 na primeira rodada e quatro expectativas antigas atualizadas
  para a nova composição e aprovadas no reteste focado.
- Auditoria de dependências: **zero vulnerabilidades**.

Gate global de navegador: execução de 889 casos em
`tmp/order-timeline-full-e2e.log`: **880 aprovados, sete skips, duas falhas**.
Uma falha foi `Firefox launch UNKNOWN` no Windows. O Tech Lead executou o
fallback documentado em
`docs/runbooks/playwright-audio-local.md`, com arquivo-fonte exato de
`fca7d809`, Docker isolado, Node 24.20.0/npm 11.19.0:
**dois casos Chromium/Firefox aprovados, sem skips**. Esse fallback resolve a
evidência de áudio no ambiente suportado; não reclassifica o processo Windows
como execução global integralmente aprovada.

A segunda falha foi `test/e2e/order-billing.spec.js:163`, durante captura de
tela em `test/e2e/order-billing.spec.js:168`: `ENOSPC: no space left on device`
e arquivo de trace ZIP truncado. O erro observado é de gravação de artefato,
sem evidência de assertion financeira falhando. Após encerrar os containers
exclusivos de teste e recuperar espaço, o caso foi repetido sem alterar
screenshot/assertions:
`npm run test:e2e -- test/e2e/order-billing.spec.js --grep "0% saves no checkout" --workers=1`,
porta 4193: **um aprovado**, saída zero. O resultado cobre esse caso no
fechamento de T4, preservando o registro da falha original.

## Discrimination sensor

Dois defeitos de comportamento foram injetados apenas em cópias externas,
em `C:/Users/Ronal/.codex/visualizations/2026/11/11/01a1c810-5a94-7872-98fd-a8def333c64d/timeline-sensor`.
Imports das cópias apontaram para as dependências originais por file URL;
o checkout real não recebeu mutações, stash, troca de branch ou reescrita.

| Mutação                                                        | Contrato esperado                                                   | Resultado                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend: substituir iteração dos recebimentos por array vazio | DTL-01/03/04/05: pagamentos reais e correções devem aparecer        | Morta por **2 assertions** em cópia de `test/order-timeline.test.js`; falha de import/sintaxe foi explicitamente descartada pelo runner.           |
| Backend: usar dia de `verified_at` para recebimento manual     | DTL-03: dia efetivo manual deve permanecer independente do registro | Morta por **1 assertion** em cópia de `test/order-timeline-projection.test.js`; falha de import/sintaxe foi explicitamente descartada pelo runner. |

Nenhum mutante sobreviveu. As cópias ficam fora da árvore versionada e não
fazem parte do build. O revisor não editou os arquivos de implementação ou
testes reais durante o sensor.

## Smoke de integração local

Resultado inspecionado em `tmp/order-timeline-real-smoke.json`, executado
pelo Tech Lead em `crm-silmer-billing-fresh`/porta 4180:

- Pedido sintético novo, R$ 30 pela InfinitePay simulada e R$ 70 registrados
  manualmente: **dois recebimentos, recebido 10.000 centavos, saldo zero**.
- Interface mostrou as duas origens e confirmou entrega pelo botão real.
  Persistiu `deliveredOn=2026-11-11`; reload conservou o evento e saldo zero.
- API forneceu metadata de autoria da entrega. Capturas de revisão:
  `tmp/order-timeline-real-before.png` e `tmp/order-timeline-real-after.png`.

O smoke usa API/comandos reais do CRM e provedor/transporte sintéticos.
Não comprova pagamento, WhatsApp ou homologação InfinitePay reais.

## Achados, limites e fechamento

Achados bloqueantes: **nenhum**. Durante os protótipos, uma referência textual
ao dia manual e uma espera de visibilidade do acordeão foram corrigidas;
nenhuma alteração financeira foi justificada por esses ajustes visuais.

Limites preservados: não há migration, mudança de saldo/quitação, novo status,
mutação de ficha/PDF/Dashboard ou nova infraestrutura. Autoria de entrega
legada permanece ausente quando não há evidência correlacionada; data
InfinitePay representa confirmação verificada no CRM. O histórico não promete
listar todas as reaberturas.

O relatório atesta o comportamento revisado e os gates disponíveis. O Tech Lead
incorporou os retestes de ambiente e executou os validadores estruturais de
spec, tarefas e estado sem erros. Fechamento T4 publicado no
[PR 348](https://github.com/romulosutil/crm-silmer/pull/348), para revisão;
esta validação não executa merge/deploy.

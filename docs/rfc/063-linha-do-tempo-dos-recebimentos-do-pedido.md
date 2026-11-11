# RFC 063: linha do tempo dos recebimentos do pedido

Status: proposta para revisão visual e de produto. Não autoriza implantação.
Data: 10/11/2026. Base inspecionada: master `760f7924`.

## Objetivo e contratos relacionados

Exibir, em **Datas do pedido**, a sequência do pedido e os recebimentos
confirmados manualmente ou pela InfinitePay. Cada entrada identifica data,
valor, origem e situação. **Pago em** continua significando quitação integral.

Continua PLA-01–12, COB-01–08 e os contratos de recebimentos externos de
[order-billing-completion](../../.specs/features/order-billing-completion/spec.md),
[RFC 060](060-recebimentos-externos-e-conciliacao-de-cobrancas.md) e ADR 077.
Uma decisão durável futura deverá vincular esta proposta ao ADR correspondente;
nenhum ADR aprovado é alterado por este planejamento. Issue/PR: ainda não criados.

## Situação confirmada no código

- `OrderMilestonesSection.vue` mostra primeiro contato, pago em e entregue em.
  Resumo mantém data do pedido e previsão de entrega.
- `OrderView.vue` oferece `orderBillingState`; hoje esse estado contém apenas
  disponibilidade, gestão financeira e prontidão, sem os recebimentos.
- `GET /api/v1/orders/:orderId/billing` já fornece `payments` e
  `externalReceipts`, além do total recebido/saldo. Um recebimento externo
  está nas duas coleções: concatená-las duplicaria o dinheiro na interface.
- A view SQL `crm.order_billing_receipt_ledger`, migration 0075, consolida
  as duas fontes. Recebimento manual tem `received_on` e `recorded_at` distintos.
  Na InfinitePay, `received_on` deriva de `verified_at` em São Paulo.
  Não há nesse modelo a garantia de uma data efetiva informada pelo provedor.
- `charges[].paidAt` também é confirmação no CRM, não prova do instante da
  transação. A data da emissão do link não é data de pagamento.
- Reversões manuais estão em `order_billing_external_reversals`; devoluções
  InfinitePay conciliadas estão em `order_billing_refunds`. Um valor acumulado
  devolvido não basta para montar os instantes individuais de devolução.

## Experiência proposta

Manter o título **Datas do pedido**, o acordeão e o design existente.
Conforme revisão do proprietário em 11/11/2026 (DTL-P04), remover os três
marcos duplicados para evitar repetição. A revisão DTL-P05 dispõe os eventos
em uma sequência horizontal, do mais antigo ao mais recente, com **Confirmar
entrega** no cabeçalho **Datas do pedido** enquanto
não houver entrega registrada. A data canônica de quitação permanece no
modelo financeiro; a seção usa os recebimentos e o saldo sem repetir o bloco
de datas:

1. Primeiro contato e confirmação atual do pedido, quando conhecidos.
2. Cada recebimento confirmado, inclusive parcial, com valor, método e origem.
3. Correções: reversão de registro manual ou devolução conciliada, vinculadas
   ao recebimento original. O registro original permanece visível.
4. Entrega realizada, quando registrada.

A previsão permanece no Resumo e pode ser repetida como referência fora da
lista de acontecimentos; uma previsão não vira evento de entrega realizada.
Conforme revisão DTL-P06, chamar o marco de “Pedido confirmado”,
sem prometer uma história completa de todas as confirmações.

Exemplo: R$ 300 confirmados via InfinitePay em 06/11 e R$ 700 recebidos
manualmente em 09/11 para um pedido de R$ 1.000. A linha do tempo mostra ambos;
O modelo financeiro mantém 09/11 como quitação somente se essa for a data canônica retornada pela API.
O frontend nunca recalcula nem sobrescreve a data de quitação.

Detalhes nativos expansíveis mostram responsável e instante do registro
manual, confirmação no CRM e vínculo à cobrança. O lançamento manual usa
“Recebido em”; InfinitePay usa “Confirmado pela InfinitePay em”. Horário apenas
quando conhecido, em São Paulo. Dia manual não ganha horário fictício.
Os dados do protótipo são sintéticos e não efetuam comandos.

## Requisitos e aceite propostos

| ID     | Critério observável                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTL-01 | WHEN há recebimentos das duas fontes THEN a seção SHALL mostrar uma entrada por recebimento identificado por fonte + ID, sem duplicar `payments` e `externalReceipts`.                         |
| DTL-02 | WHEN um recebimento é parcial THEN a seção SHALL mostrar seu valor sem preencher Pago em; a quitação SHALL usar somente `order.paidOn` e a revisão oficial.                                    |
| DTL-03 | WHEN um pagamento manual é registrado retroativamente THEN a linha SHALL usar `receivedOn`, mostrar `recordedAt` nos detalhes e nunca inventar horário.                                        |
| DTL-04 | WHEN a fonte é InfinitePay THEN a linha SHALL identificar a data como confirmação verificada no CRM, sem afirmar que `verified_at` é a hora efetiva da transação.                              |
| DTL-05 | WHEN há reversão/devolução THEN a seção SHALL preservar o original, explicar seu efeito atual e mostrar a correção na data registrada, sem autorizar comandos financeiros pela linha do tempo. |
| DTL-06 | WHEN há recebimento não aplicável ou revisão THEN a seção SHALL mostrar “Em revisão”/“Não aplicado ao saldo”, sem chamá-lo de recebido ativo nem anunciar quitação.                            |
| DTL-07 | WHEN existe somente Pago em legado THEN a seção SHALL mostrar “Quitação registrada · sem detalhamento de recebimentos”, sem inventar valor, fonte ou transação InfinitePay.                    |
| DTL-08 | WHEN carregamento falha THEN a seção SHALL preservar os marcos do pedido e distinguir falha de histórico vazio; dados anteriores SHALL ser identificados como aguardando atualização.          |
| DTL-09 | WHEN a pessoa não pode consultar dados financeiros THEN API e interface SHALL omitir eventos financeiros e seus detalhes, conservando apenas os marcos já autorizados do pedido.               |
| DTL-10 | WHEN chega atualização ou muda o pedido selecionado THEN uma leitura compartilhada SHALL atualizar cobrança e datas coerentemente e descartar respostas obsoletas de outro pedido.             |
| DTL-11 | WHEN a seção é usada por teclado/leitor de tela ou a 320px THEN a lista SHALL preservar ordem, texto de situação, foco e detalhes operáveis, sem depender só de cores.                         |
| DTL-12 | WHEN chega callback duplicado, link é apenas emitido ou conferência está pendente THEN a seção SHALL não criar recebimentos fictícios ou eventos financeiros repetidos.                        |

## Contrato e implementação sugeridos

Reutilizar `GET /api/v1/orders/:orderId/billing`, sem novo endpoint de mutação.
Acrescentar à resposta `billing.timelineEvents`, aditivo e autorizado pelo mesmo
runtime. Preservar `payments`, `externalReceipts` e os consumidores existentes.

Cada evento: `id` estável com namespace, `kind` (`receipt`, `external_reversal`,
`refund`), `source`, `receiptId`, `chargeId` opcional, `day`, `occurredAt`
opcional, `dateBasis` (`effective_day`, `crm_verification`, `recorded_at`),
`amountCents`, `appliedAmountCents`, `status`, `method`, `recordedAt` e
`actorName` autorizado. Não incluir URLs de checkout, comprovante, NSU, notas
ou motivos privados na projeção resumida. IDs internos não aparecem como texto.

Na projeção, usar `payments` como fonte dos recebimentos e fazer join por ID
com `externalReceipts` apenas para autoria/reversão. Consultar as devoluções
individuais no backend com o mesmo escopo do pedido. Ordenar por dia; para
eventos com precisão de instante usar o instante como desempate, depois ID.
Eventos de precisão apenas diária no mesmo dia não alegam ordem intradiária.
O serviço pode fornecer diretamente a ordem estável para o frontend.

Marcos gerais vêm do objeto `order` já autorizado. Compor ambos em função pura
de apresentação; usar `confirmedAt`/`orderDate` com semântica explícita.
Não converter um dia ISO com timezone do navegador. Não criar tabela de
timeline ou gravar cópias de eventos financeiros. Não mudar Financeiro,
Dashboard, `paid_on`, ficha/PDF ou comandos de recebimento neste recorte.

Promover o carregamento financeiro ao escopo de `OrderView.vue`, através de
composable isolado (proposto `useOrderBilling.js`), compartilhado por cobrança
e datas. Extrair a lógica de leitura atual de `OrderBillingSection.vue`, mantendo
seus comandos existentes. Recarregar após os comandos e invalidações já usadas;
não adicionar SSE paralelo nem polling exclusivo. Preservar a distinção entre
leitura permitida e gestão financeira: `canManage` não concede nova capacidade.

Sem migration inicialmente. Se o produto exigir a data real da transação
InfinitePay, planejar separadamente contrato do provedor, persistência e
tratamento de legado, antes de mudar o significado desta data.

## Tarefas para implementação futura

| Tarefa  | Entrega e arquivos confirmados/propostos                                                                                                                                                            | Testes e gate                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTL-T01 | Projeção autorizada no `apps/api/src/order-billing-runtime.js`, tipos em `domain/billing.js` se necessários, consultas delimitadas de correções. Atende DTL-01/03–07/09/12.                         | Estender `test/order-billing-completion-routes.test.js` e `test/order-billing-completion-postgres-live.test.js`: fontes mistas, replay, reversão, devolução parcial, ACL, timezone e revisão. Gate: testes focados aprovados. |
| DTL-T02 | Leitura compartilhada em `OrderView.vue`, `OrderBillingSection.vue` e novo composable. Atende DTL-08/10. Depende T01.                                                                               | Testar respostas fora de ordem, troca de pedido, erro e atualização após comando. Gate: testes de integração da tela e typecheck.                                                                                             |
| DTL-T03 | Linha do tempo em `OrderMilestonesSection.vue`, novo `OrderPaymentTimeline.vue` e função pura em `lib/order-timeline.js`, reutilizando tokens e `OrderSheetHead`. Atende DTL-01–08/11. Depende T02. | Cenários unitários da projeção; E2E em `test/e2e/orders.spec.js` com semântica, teclado, foco, 320px, origens e estados. Gate: E2E/axe focados aprovados.                                                                     |
| DTL-T04 | Integração e evidências de regressão, documentação de cobrança e aceite visual. Depende T03.                                                                                                        | Conferir Financeiro/Dashboard/PDF sem mudança contratual; testes backend/e2e relevantes, checks padrão, `git diff --check`, commit e push por tarefa implementada.                                                            |

## Validação deste planejamento

DTL-P06 (11/11/2026): renomear o evento **Confirmação atual** para **Pedido
confirmado**, conforme solicitação do proprietário. A data mantém a semântica
de confirmação comercial vigente, inclusive após reabertura e reconfirmação;
não representa confirmação de pagamento.

DTL-P05 (11/11/2026): composição horizontal no protótipo conforme solicitação
do proprietário. Remover o subtítulo “Linha do tempo” e mover **Confirmar
entrega** para a linha de **Datas do pedido**. Priorizar data/título/origem/valor
nos eventos, preservando revisões e detalhes expansíveis com nomes acessíveis.
Eventos compartilham a mesma linha; quando não couberem, a rolagem fica
contida na seção, inclusive no celular, sem alargar a página. A região de
rolagem é nomeada e focável para teclado. A confirmação acrescenta o evento
e o foco continua chegando ao resultado. Gate: teste existente ampliado com
alinhamento horizontal, posição do botão no cabeçalho, ausência do subtítulo,
rolagem interna mobile e regressão do fluxo de entrega. Esta composição
substitui a orientação vertical da proposta anterior; contratos financeiros
continuam os mesmos.
Verificado: os cinco eventos do exemplo quitado com entrega cabem lado a
lado na tela de 1440px; rolagem nativa por ArrowRight e confirmação pelo
cabeçalho com acordeão mobile fechado também passaram no teste do harness.

DTL-P04 (11/11/2026): remover o resumo horizontal do protótipo e mover
**Confirmar entrega** para o cabeçalho da linha do tempo. Confirmar adiciona
o evento com dia/autor/horário, oculta o botão e move o foco para o título
**Pedido entregue**. Cancelar/Escape preservam o estado e devolvem foco ao
botão. Critérios: ausência do bloco horizontal, fluxo anterior preservado,
evento único e data correta, teclado e layout mobile. O teste existente do
harness passou após atualizar as expectativas para a nova composição.
Esta revisão substitui a disposição visual inicial de DTL-P02/P03; os
contratos de quitação e o estado financeiro permanecem iguais.

DTL-P03 (11/11/2026): acrescentar ao protótipo local o fluxo **Confirmar
entrega** solicitado pelo proprietário. Critérios desta entrega visual:

- Sem entrega: exibir botão junto a Entregue em, inclusive no exemplo quitado.
- Cancelar/Escape: não alterar data/eventos e devolver foco ao botão.
- Confirmar: registrar somente na memória do protótipo o dia atual de São
  Paulo e o instante, mostrar data, um único evento e autor de demonstração.
- Pagamento/saldo preservados, inclusive quando entregue sem quitação integral.
- Confirmação concluída move foco para o evento de entrega (revisão DTL-P04); detalhes são operáveis por
  teclado. Diálogo cabe no celular e o estado por cenário reinicia no reload.

Arquivos DTL-P03: `OrderDatesPreview.vue`, teste existente do harness e esta
documentação/README de protótipos. Gate: teste Chromium com confirmação,
cancelamento, Escape, foco, saldo, ausência de duplicata e fixture financeira
inalterada; diálogo desktop/mobile inspecionado. Não implementa a mudança no
produto nem altera o contrato do comando de entrega real.

DTL-P02 (11/11/2026): protótipo inserido no site local pelo harness existente
`docs/prototypes/billing-chat-preview.mjs`, com `datesPreview=true`.
`OrderDatesPreview.vue` substitui apenas a seção de datas em memória. O
componente financeiro do outro simulador é omitido nessa prévia focada.
O código em `apps/` e os dados financeiros não são alterados.
Endereço da avaliação: http://127.0.0.1:4190/pedidos/billing-preview-order.
Teste reproduzível: `node --test docs/prototypes/order-dates-preview.test.mjs`.
Gate: cinco cenários, detalhes por teclado, mobile sem overflow, ausência
de erro JS e estado financeiro das fixtures inalterado.
Verificação concluída: teste Chromium aprovado, lint e build aprovados,
`git diff --check` aprovado e revisão independente sem bloqueios após corrigir
a referência à data do recebimento revertido. Implementação DTL-T01–04 continua
futura; DTL-P02 entrega somente o protótipo navegável no contexto do site.

DTL-P01: planejar e apresentar protótipo interativo, sem alterar o produto.
Protótipo navegável: [Datas e recebimentos](../prototypes/order-dates-timeline.html).
Inspeção do endpoint, ledger, componente e consumidor realizada; o protótipo
deve permitir comparar parcial, quitado, reversão, legado e falha. A aprovação
visual não comprova implementação, integração de pagamento ou aceite das tarefas
DTL-T01–04. Próximo gate: revisão do fluxo e dos rótulos pelo proprietário.

Verificação do protótipo: cinco cenários exercitados em Chromium, abertura dos
detalhes, ausência de erros JavaScript e ausência de overflow horizontal a
320px. Renderizações desktop e mobile inspecionadas. Isso não substitui E2E/axe
da futura integração com a aplicação.

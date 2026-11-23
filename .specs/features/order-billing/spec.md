# Cobranças do pedido — contrato aprovado

Continuação autorizada em 08/11/2026: [ADR077](../../../docs/adr/077-recebimentos-externos-e-conciliacao-de-cobrancas.md)
e [order-billing-completion](../order-billing-completion/spec.md) acrescentam
recebimentos externos, consultas e frontend real no redesign atual. As seções
datadas de 06/11 abaixo registram o diferimento anterior, já supersedido.

Decisão: [ADR 058](../../../docs/adr/058-cobrancas-do-pedido-com-infinitepay.md)
e [RFC 049](../../../docs/rfc/049-cobrancas-do-pedido-com-infinitepay.md).
Protótipo aprovado pelo proprietário em 05/11/2026, seguido de autorização
expressa para implementar.

Emenda de 23/11/2026: a [ADR 098](../../../docs/adr/098-link-de-pagamento-do-crm-e-cobrancas-que-somam.md)
troca o link da InfinitePay pelo link do CRM e permite vários links que somam.
Ver [LPC-01–09](#link-de-pagamento-do-crm-lpc-0109) e o
[contrato](../../../docs/api/order-billing-links.md). Onde um critério abaixo
falar em uma cobrança ativa por pedido, em sinal e saldo como únicas partes ou
em link vencido, vale a LPC.

## Fronteira

Pedidos confirmados fora da loja. 0% salva sem entrada e a cobrança integral
é posterior, humana; 50% gera sinal e depois saldo por nova ação humana; 100%
quita integralmente, permitindo cartão parcelado pela InfinitePay.
Percentual inteiro, sinal arredondado ao centavo, saldo por subtração e mínimo
de R$ 1,00 em cada parte. Os valores do protótipo são fictícios.

Desde a ADR 098, a condição 0% · 50% · 100% só sugere o primeiro link. Depois,
cada link vale de R$ 1,00 até o livre para cobrar, e o vendedor divide o
restante como quiser.

## Critérios de aceite

| ID     | Critério verificável                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| COB-01 | Responsável atual pelo pedido/conversa ou administrador pode configurar e emitir; usuário desativado, outro vendedor, perfil Financeiro e agente são recusados. Revalidar ACL sob lock, inclusive no replay.                               |
| COB-02 | 0% salva sem entrada, 50% é a única entrada parcial e 100% cobra o integral. A emissão recusa outros percentuais, partes abaixo de R$ 1,00, ausência de preço e pedido pendente. Histórico, replays e cobranças de saldo de planos antigos continuam disponíveis. Um plano antigo sem crédito pode receber nova condição após o encerramento de todas as cobranças anteriores. |
| COB-03 | Pix e cartão são reconhecidos; parcelamento do cartão não gera parcelas comerciais no CRM nem altera o preço aprovado.                                                                                                                     |
| COB-04 | Sessão, CSRF, origem, idempotência e revisão protegem emissão; duas ações concorrentes produzem uma única reserva de cobrança.                                                                                                             |
| COB-05 | Repetição idêntica devolve o mesmo resultado; corpo divergente conflita; timeout após início do efeito permanece desconhecido, sem novo link automático.                                                                                   |
| COB-06 | Webhook/retorno forjado não quita. Conta, cobrança conhecida, fatura, NSU, método e valor são verificados no servidor; cobrança menor ou de outro pedido é recusada.                                                                       |
| COB-07 | Webhooks repetidos ou concorrentes com consulta de confirmação geram um único recebimento; comprovante tardio não duplica crédito nem muda o primeiro horário.                                                                             |
| COB-08 | O mesmo NSU não pode quitar loja e atendimento, ou duas cobranças. Recebimento, deduplicação, aplicação e auditoria compartilham transação.                                                                                                |
| COB-09 | Sinal confirmado mantém saldo e não preenche `paid_on`; somente o integral conciliado permite quitação. Taxas não aumentam o crédito comercial.                                                                                            |
| COB-10 | Reabertura, mudança de preço e pagamento tardio conservam histórico e exigem revisão do acordo anterior. O trigger financeiro vigente não é contornado.                                                                                    |
| COB-11 | APIs antigas de datas não podem declarar quitado um pedido gerido pela integração com saldo pendente. Migração preserva datas legadas sem inventar recebimentos.                                                                           |
| COB-12 | UI reutiliza design e componentes atuais, com teclado, foco, nomes acessíveis, celular e anúncios de processamento, pagamento, falha e resultado desconhecido.                                                                             |
| COB-13 | URLs somente HTTPS e hosts autorizados; credenciais, payloads, URLs privadas e PII ficam fora de log/auditoria. Consulta respeita o acesso ao pedido; não há tela financeira pública por ID.                                               |
| COB-14 | Reentrega, falha entre reserva e resposta, falha de auditoria e callbacks tardios são recuperáveis. Confirmar recebimento só após persistência durável ou deixar falha para reentrega.                                                     |
| COB-15 | Rollback impede novas emissões, mas mantém confirmação e reconciliação dos links existentes. Desligar a UI não interrompe o recebimento desses eventos.                                                                                    |
| COB-16 | Devolução conhecida, total ou parcial, é conciliada por comando humano autorizado, versionado e auditado; preserva o pagamento original e invalida quitação/check financeiro quando afetados. Repetição não duplica abatimento.            |

## Estados e recuperação

Cobrança: `queued`, `creating`, `waiting`, `unknown`, `paid`, `review`,
`closed`; são estados financeiros, não novos status comerciais. Plano tem
versão própria. Vínculo comercial usa confirmação, valor e condição, sem
invalidar recebimentos por edição de observação.

Conciliação humana `apply_current` reaplica crédito existente ao acordo
vigente após conferência; `close_unpaid` encerra risco local só após validade
vencida e conferência explícita. Callback tardio continua em revisão. Não
permitir saldo negativo nem inferir valor recebido de datas legadas.
Devolução é registro de operação já feita no provedor, sem estorno pelo CRM.

Desde a ADR 098, cada clique num link do CRM cria uma cobrança (tentativa)
com esses estados. `close_unpaid` fecha as cobranças antigas, sem link, e as
tentativas de link sem pagamento retidas em `review`; o link volta a `open`, ou
é cancelado com `order_changed` se o acordo mudou. A conciliação ganha
`cancel_open_links`, que cancela os links ainda não clicados.

## Link de pagamento do CRM, LPC-01–09

Decisão do proprietário em 23/11/2026:
[ADR 098](../../../docs/adr/098-link-de-pagamento-do-crm-e-cobrancas-que-somam.md)
e [RFC 074](../../../docs/rfc/074-link-de-pagamento-do-crm-e-cobrancas-que-somam.md).
Contrato: [links de pagamento](../../../docs/api/order-billing-links.md).
Tarefas: [LPC-T01–T10](tasks.md#lpc--link-de-pagamento-do-crm-e-cobranças-que-somam).

| ID     | Critério                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LPC-01 | A mensagem ao cliente leva o link do CRM. Nenhum pagamento é criado na InfinitePay antes do clique em Pagar.                                                                                  |
| LPC-02 | A página pública mostra só pedido, tipo e valor. Token inexistente e cancelado recebem a mesma resposta. Há limite de taxa e `noindex`, e nenhuma PII aparece em log.                         |
| LPC-03 | Responsável ou administrador cancelam um link `open`. Outro vendedor, Financeiro, agente e usuário desativado são recusados. Cancelar um link já clicado devolve conflito com o estado atual. |
| LPC-04 | Cancelar e clicar ao mesmo tempo produzem exatamente um resultado, comprovado por teste concorrente no Postgres.                                                                              |
| LPC-05 | Cliques repetidos e reentrega do comando não criam um segundo pagamento válido. Resultado incerto trava e reserva o link até a confirmação.                                                   |
| LPC-06 | A soma dos links abertos nunca passa do que falta receber, inclusive com criações concorrentes e recebimento por fora.                                                                        |
| LPC-07 | Recebimentos de vários links e por fora somam até a quitação. Links cancelados ficam fora da soma e no histórico.                                                                             |
| LPC-08 | Pagamento confirmado de link cancelado, vencido ou acima do acordo vai para conferência e não quita outro acordo em silêncio.                                                                 |
| LPC-09 | A UI segue o vocabulário e os estados desta RFC, com teclado completo, foco previsível e estado em texto, no notebook e no celular, nos dois temas.                                           |

### Estados do link

| Estado na API        | Na tela              | Quando                                                          | Reserva |
| -------------------- | -------------------- | --------------------------------------------------------------- | ------- |
| `open`               | Aguardando o cliente | Enviado ou gerado, sem clique; ou pagamento do provedor vencido | Sim     |
| `checkout_requested` | Em pagamento         | O cliente clicou e o CRM pediu o pagamento à InfinitePay        | Sim     |
| `checkout_open`      | Em pagamento         | A InfinitePay devolveu o pagamento                              | Sim     |
| `unknown`            | Resultado a conferir | Houve o clique, mas a resposta da InfinitePay não chegou        | Sim     |
| `paid`               | Recebido             | A InfinitePay confirmou                                         | Não     |
| `cancelled`          | Cancelado            | Vendedor, mudança de valor, recebimento por fora ou conciliação | Não     |

O link não tem validade própria. Só `open` pode ser cancelado. O vencimento do
pagamento no provedor é aplicado de forma preguiçosa, sob bloqueio: a tentativa
vira `closed` e o link volta a `open`. Esse vencimento nunca reabre um link
`unknown`. Uma tentativa reservada pelo n8n sem resposta há mais de 120 s
vira `unknown`; uma tentativa cujo job morreu antes da reserva fecha e devolve
o link a `open` (`checkout_failed`). De `unknown` se sai pelo callback, pelo
pagamento ou por **Confirmar resultado na InfinitePay**
(`POST …/billing/links/:linkId/confirm-result`, corpo
`{ invoiceSlug?, transactionNsu? }`, os dois ou nenhum). Com os
identificadores, enfileira um `payment_check` da tentativa incerta: pago leva
a `paid`; não pago depois do `valid_until` da tentativa encerra a tentativa e
devolve o link a `open`; não pago antes disso mantém `unknown`. Sem os
identificadores, só libera depois da validade; antes, 409
`BILLING_LINK_STILL_VALID`.

O selo da seção mostra o estado mais urgente: Resultado a conferir > Precisa
de conferência > Em pagamento > Aguardando o cliente > Quitado ou Pago
parcialmente > Sem cobrança. Quitado e Pago parcialmente se excluem. "Gerando
link" é só uma etapa do progresso do envio (Gerando link → Enviando → Enviado
→ Entregue), não um estado do link.

O clique só cria tentativa no provedor com `ORDER_BILLING_ENABLED=true`. Só com
`ORDER_BILLING_RECEIVE_ENABLED=true`, a leitura pública funciona e o clique num
link `open` responde `failed` sem criar nada. Com as duas desligadas, as rotas
respondem 404. Fora disso, token inexistente, malformado ou cancelado recebe
200 `{ "state": "unavailable" }`. Limites: por token, GET 60/min e POST
10/min; por IP, GET 120/min e POST 20/min. A página consulta a cada 2,5 s, a
cada 5 s depois de 20 s, até 60 s, e respeita `Retry-After`. O GET lê sem
bloqueio e só bloqueia quando uma transição preguiçosa ou o primeiro
`page_opened` está devido. Gerar ou enviar link exige `APP_BASE_URL` (503 sem ela).

Humanos não criam mais cobranças sem link: `POST …/charges` e as ações antigas
de emissão em `send-intents` respondem 409 `BILLING_USE_PAYMENT_LINK`. As
cobranças antigas em andamento seguem funcionando.

A condição 0% · 50% · 100% sugere só o primeiro link. O nome da linha sai do
valor na criação: Sinal, Pagamento integral, Saldo ou Parcela. Recebimento por
fora vale até o livre e pode cancelar links `open` na mesma confirmação. É
recusado quando o valor além do livre está num link Em pagamento
(`BILLING_LINK_IN_PAYMENT`) ou Resultado a conferir (`BILLING_LINK_UNKNOWN`),
e sem efeito quando um link escolhido para cancelar deixou de estar `open`
(`BILLING_LINK_NOT_OPEN`). Em conferência, aplicar os pagamentos continua disponível com link
Em pagamento, desde que recebido + links em `open`, `checkout_requested`,
`checkout_open` e `unknown` caibam no total; senão, 409
`BILLING_LINK_EXCEEDS_FREE`. Só o cancelamento fica bloqueado. A API expõe o
motivo da conferência.

Cancelar o pedido cancela os links `open` (`order_cancelled`), com evento e
auditoria. Quando um pagamento marca um link `paid`, as outras tentativas dele
nunca reservadas pelo n8n fecham; as que já existem na InfinitePay vão para
`review` e põem o pedido em conferência (`outside_agreement`), para que um
pagamento em dobro fique visível.

## Backend do envio integrado, BAPI-01–10

Autorizado pelo proprietário em 06/11/2026; [ADR 076](../../../docs/adr/076-intencoes-de-cobranca-e-envio-transacional.md).
Frontend adiado até o redesign. Contrato de comandos/respostas e erros:
[API de intenções](../../../docs/api/order-billing-chat.md).

| ID      | Critério de aceite                                                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BAPI-01 | WHEN uma intenção válida é submetida, THE API SHALL retornar 202 com identidade/versão/estado da intenção, sem afirmar envio ou pagamento. Publicar os schemas das cinco ações e leituras.                                                                                                                                                               |
| BAPI-02 | WHEN corpo contém campo extra/ausente, tipo coercível, inteiro inseguro, 0% para emitir, correção abaixo de R$ 1 ou confirmação ausente, THE API SHALL recusar 400 antes de chamar o serviço. Saldo não aceita valor do cliente; texto/destino externo não são aceitos.                                                                                  |
| BAPI-03 | WHEN uma operação é solicitada, THE API SHALL exigir sessão humana e capacidade de leitura/gestão; escrita exige origem, CSRF e Idempotency-Key. Basic é recusado. Ator vem da sessão e versões/ACL são revalidadas pelo serviço.                                                                                                                        |
| BAPI-04 | WHILE escrita está desativada, THE API SHALL retornar 503 BILLING_DISABLED sem chamar submit e preservar leitura de intenção/histórico. Default da fronteira HTTP é escrita desativada.                                                                                                                                                                  |
| BAPI-05 | WHEN ocorre leitura ou erro, THE API SHALL emitir headers privados e projeção sem PII/URLs privadas/payloads. Histórico aceita apenas cursor e limit 1–50, default20; erros usam problem JSON seguro.                                                                                                                                                    |
| BAPI-06 | WHEN comandos concorrentes ou replay ocorrem, THE backend SHALL preservar uma intenção/efeito por ação autorizada, revalidar ACL sob lock e rejeitar divergência de payload/ator. Intenção, outbox e auditoria compartilham a transação.                                                                                                                 |
| BAPI-07 | WHEN link é criado e o contexto mudou, THE backend SHALL preservar URL cifrada e bloquear envio; callback duplicado não cria nova mensagem. Reserva final revalida ator, responsável/ciclo, acordo, saldo, validade e revisão inbound, preservando o responsável.                                                                                        |
| BAPI-08 | WHEN há correção ou cobrança do saldo, THE backend SHALL preservar recebimentos e links, calcular saldo no servidor e bloquear emissão na quitação. Emenda da ADR 098: humanos não criam mais cobrança sem link do CRM (409 `BILLING_USE_PAYMENT_LINK`); as antigas em andamento seguem únicas por pedido. Links do CRM coexistem enquanto a soma dos abertos couber no que falta receber (LPC-06), com no máximo uma tentativa ativa por link; link errado é cancelado antes do clique (LPC-03). Callback tardio requer revisão. |
| BAPI-09 | WHEN transporte fica incerto, THE backend SHALL bloquear retry cego. Falha conhecida antes do envio permite nova intenção humana para o mesmo link válido e comando novo, sem consumir outra vez uma reserva anterior.                                                                                                                                   |
| BAPI-10 | WHILE emissão integrada está desligada, THE backend SHALL impedir novas intenções/reservas e conservar recebimento financeiro, consulta, conciliação e histórico. Transporte e recebimento mantêm estados independentes.                                                                                                                                 |
| BAPI-11 | WHEN uma intenção ou evento de envio é consultado, THE API SHALL projetar `supersedesChargeId` e `retryOfIntentId` dos vínculos persistidos, ou null quando inexistentes, sem inferir origem por data/valor. Os campos de resposta são opcionais para replay de resultados anteriores; comandos continuam estritos, leituras privadas e ACL inalteradas. |

B01 cobre a fronteira HTTP de BAPI-01–05. B02 implementa
admissão/idempotência durável, saldo/correção, locks e histórico, com testes
PostgreSQL de BAPI-05/06/08 e guardas iniciais de BAPI-07/09. B03 implementa
composição, callback e reserva/preflight finais de BAPI-07/09; B04 integra
rotas/flags e recuperação de BAPI-10. Evidências e limites nos relatórios de QA.
Não considerar
um teste com serviço sintético como evidência transacional.

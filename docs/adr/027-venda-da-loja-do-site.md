# ADR 027 — Venda da loja do site no CRM

Status: aceita; parcialmente supersedida pela
[ADR 028](028-pedido-pago-da-loja-pelo-n8n.md) em 09/10/2026 nos itens 1 e 2
(rota pública, contrato v1 do site, sem n8n), 4 (pago informado pelo cliente),
7 (preço e campos do produto) e 9 (`Origin`, limites por IP e por telefone).

Data: 07/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 07/10/2026, pediu que a venda da loja
do site entre no CRM como um pedido travado, "Pago", com nome e telefone e uma
ficha simplificada; aceitou as recomendações D1–D9 da RFC e acrescentou que o
pedido da loja aparece no Dashboard como uma venda normal, nas métricas. Tech
Lead definiu a rota pública, o modelo de dados, a validação, a proteção e a
ficha.

RFC: [RFC 015](../rfc/015-venda-da-loja-do-site.md). Requisitos
`LOJ-01`–`LOJ-14` da [spec](../../.specs/features/pedidos-mvp/spec.md);
tarefas T103–T109 de [tasks](../../.specs/features/pedidos-mvp/tasks.md).
Emenda, só para pedidos com `origin = loja`, a
[ADR 006](006-pedido-dois-status.md) (confirmação humana e reabertura), a
[ADR 008](008-lastro-de-datas-do-pedido.md) (dia do pagamento digitado por uma
pessoa) e as RULES 4, 5, 9, 10, 16 e técnica 7. A
[ADR 018](018-cliente-do-pedido-acompanha-o-contato.md) não muda.

## Contexto

O site `silmer.com.br/loja` vende um kit de 10 camisas por R$ 193,64 com Pix
estático do Sicredi e retirada na loja. Depois de pagar, a pessoa informa nome
e WhatsApp, e o navegador manda o pedido (contrato v1 do repositório
`silmer-web`). O QR é estático: nada liga um Pix a um pedido, e a Rose confere
no Sicredi. O CRM só conhecia pedidos de uma conversa, confirmados por uma
pessoa, e não tinha rota pública de escrita.

## Decisão

1. **Rota pública no CRM (D1).** `POST /api/v1/public/loja/pedidos`, com
   preflight `OPTIONS`, servida em `/api/*` como o resto da API. É a única
   mutação oficial sem autenticação: um efeito (criar o pedido da loja ao
   preço do catálogo do CRM), nenhuma leitura. Não passa pelo n8n.
2. **Contrato v1 do site, sem mudança.** `Idempotency-Key` igual a
   `pedido_id`; `201 {"numero"}` criado; `200` com o mesmo número para a mesma
   chave e o mesmo corpo (JSON canônico), antes de qualquer limite; `400`
   malformado; `409 idempotency_conflict`; `422` fora do catálogo, valor
   divergente, teste recusado ou horário fora da janela; `429 rate_limited`
   com `Retry-After`; `403 origem_nao_permitida`. Erros como `{"erro":
"<codigo>"}`. Corpo até 8 KB.
3. **Pedido da loja (D2).** `origin = loja` (os demais são `atendimento`),
   sem conversa. Nasce `confirmado`, autor `system:loja-do-site` ("Loja do
   site"), `created_by_kind = automation`, valor do catálogo, condição `pix`,
   `order_date` e `confirmed_at` no recebimento, `first_contact_at` no
   recebimento. Fica travado: editar, gerar, reabrir, lastro e arquivos
   respondem `409 ORDER_LOCKED`. Continua havendo dois status; "Pago" é a
   leitura de `origin = loja` com `paid_on`.
4. **Pago, informado pelo cliente.** `payment_declared_at` guarda o instante
   declarado (`pagamento.informado_pelo_cliente_em`), aceito entre 7 dias antes
   e 5 minutos depois do recebimento; `paid_on` é o dia dele em São Paulo. A
   tela mostra "Pago (informado pelo cliente em dd/mm/aaaa às hh:mm)".
5. **Conta como venda normal.** O pedido da loja entra em Vendido, pedidos,
   ticket médio e peças do Dashboard como qualquer confirmado, sem linha
   separada (adendo do PO). Pedido de teste não entra. A conferência no
   Sicredi usa o filtro "Loja do site" da lista.
6. **Cliente só no pedido (D3).** Nome e telefone ficam no `ficha_envelope`
   cifrado (`summary.cliente` e o bloco `loja`). Nenhum Contato, identidade,
   conversa ou pendente é criado, achado ou alterado: o telefone digitado não
   é verificado (RULES técnica 5). A busca acha o pedido pelo número e pelo
   telefone, por HMAC do E.164. A ADR 018 segue valendo para os pendentes.
7. **Catálogo e validação no CRM (D8).** O catálogo da loja mora em
   `modules/orders/src/domain/store-catalog.js`. Slug, cor e tamanho (com os
   ids do site), quantidade, valor e os campos descritivos do produto têm de
   bater com o catálogo, senão `422`. O pedido grava o preço do catálogo, nunca
   o `valor_centavos` do navegador.
8. **Teste (D4, D5).** `STORE_ORDERS_ACCEPT_TEST=true` aceita `teste: true` e
   marca o pedido (`is_test`), com selo "Teste", fora do Dashboard; `false`
   recusa com `422 teste_recusado`. Enquanto só existir o cloud-dev/piloto,
   Preview e Production da Vercel apontam para ele, com a variável em `true`
   até o Pix real.
9. **Proteção (D6, D7).** `Origin` obrigatório e da lista
   `STORE_ORDERS_ALLOWED_ORIGINS` (exata ou com `*` num rótulo, como os
   previews da Vercel). Limites: 30 requisições por minuto por IP na rota (em
   memória), 5 pedidos por hora por IP e 5 por 24 horas por telefone, contados
   no PostgreSQL na transação da criação. Cada criação grava um recibo em
   `crm.store_order_receipts` (pedido, `pedido_id`, `Origin`, HMAC do IP e do
   telefone, hash do corpo) e um `audit_events` `store.order.create`, na mesma
   transação do registro de idempotência. O IP nunca é guardado em claro nem
   logado.
10. **Ficha simplificada.** `ficha-loja-v1`, HTML A4 com só os campos padrão,
    na mesma rota `/print`; `?download=1` devolve o anexo
    `pedido-NN-CRM.html`. Não substitui a ficha canônica nem depende de
    `PRINT_TEMPLATE` ou da assinatura de Rose e Operação.
11. **Fora deste corte (D9).** "Pix não encontrado" e "Retirado em" no
    pedido da loja.

## Consequências

- A migration `0029_store_orders.expand.sql` acrescenta `origin`, `is_test` e
  `payment_declared_at`, torna `conversation_id` anulável só para a loja e cria
  `crm.store_order_receipts`. Pedidos existentes ficam `atendimento`.
- A `silmer-api` ganha `STORE_ORDERS_HMAC_KEY`,
  `STORE_ORDERS_ALLOWED_ORIGINS` e `STORE_ORDERS_ACCEPT_TEST` (e os limites,
  opcionais); sem as duas primeiras, a rota responde `404`.
- O contrato `Order` ganha `origin`, `isTest`, `paymentDeclaredAt`, `locked`
  e `ficha.loja`; a lista aceita `origin`. O n8n não muda.
- Um aviso falso conta como venda até alguém notar; a retirada só acontece
  com o Pix conferido. Tirar o pedido do Vendido exigirá decisão nova.
- O `numero` devolvido revela a sequência de pedidos a quem enviar um aviso.
- Produto ou preço mudado no site exige mudar o catálogo do CRM antes.

## Alternativas descartadas

Webhook público no n8n chamando a API autenticada, pedido pendente confirmado
depois do Sicredi, terceiro status "pago", Contato pelo telefone, conversa
"loja", preço do navegador e só limite em memória — razões na seção 4 da RFC.

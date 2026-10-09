# ADR 028 — Pedido pago da loja confirmado pela InfinitePay e registrado pelo n8n

Status: aceita

Data: 09/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 09/10/2026, decidiu que a loja do site
cobra pelo Checkout Integrado da InfinitePay, só Pix, e que o pedido pago entra
no CRM automaticamente, enviado pelo n8n, com a ficha e o link do comprovante,
sem WhatsApp automático ao vendedor por enquanto. Tech Lead definiu a rota de
automação, a ação, a validação, a idempotência, o modelo de dados e a leitura.

RFC: [RFC 016](../rfc/016-pedido-pago-da-loja-pelo-n8n.md). Requisitos
`LOJ-15`–`LOJ-25` da [spec](../../.specs/features/pedidos-mvp/spec.md);
tarefas T110–T115 de [tasks](../../.specs/features/pedidos-mvp/tasks.md).
Supersede a [ADR 027](027-venda-da-loja-do-site.md) nos itens 1 e 2 (D1: rota
pública, contrato v1 do site, sem n8n), 4 (pago "informado pelo cliente"), 7
(preço e campos do produto) e 9 (`Origin`, limites por IP e por telefone). Os
demais itens da ADR 027 continuam. Mantém a emenda da ADR 027 às ADRs
[006](006-pedido-dois-status.md) e [008](008-lastro-de-datas-do-pedido.md)
para `origin = loja`, agora com o pagamento confirmado pelo gateway.

## Contexto

A loja `silmer.com.br/loja` passou a cobrar pelo Checkout Integrado da
InfinitePay, só Pix. O workflow "Silmer | Loja | Checkout InfinitePay" (id
`SbNSW5jwBcXM5Afj`) cria o link, recebe o webhook e confirma o pagamento com
`payment_check` (pago é `paid` com `amount` maior ou igual ao valor do
pedido). O kit custa R$ 180,00, tem 10 peças da mesma cor e tamanho e tem prazo
por cor. A rota pública da ADR 027 nunca saiu da branch `feat/loja-do-site`:
o cloud-dev responde `404` e a migration `0029` nunca rodou fora dela.

## Decisão

1. **Rota de automação.** `POST /api/v1/integrations/n8n/store-orders`, com o
   contrato das rotas n8n: Basic do `AUTOMATION_EXECUTOR`
   (`CRM_AUTOMATION_CLIENT_ID`/`CRM_AUTOMATION_CLIENT_SECRET`),
   `Idempotency-Key` igual a `pedido_id`, `X-Correlation-Id`,
   `X-Silmer-Workflow-Key`, `X-Silmer-Workflow-Version`,
   `X-Silmer-Execution-Id`, corpo JSON até 16 KB, `schema_version` `1.0` e
   erros `application/problem+json`. A ação `store.order.record` só existe
   para o `AUTOMATION_EXECUTOR`; nenhuma pessoa a recebe. A rota pública
   `POST /api/v1/public/loja/pedidos`, seu CORS, a lista de origens e os
   limites por IP e telefone saem do código.
2. **Pagamento confirmado pelo gateway.** O n8n só chama o CRM depois do
   `payment_check`. O pedido guarda a fonte (`infinitepay`), o instante
   confirmado (`pago_em`), o valor pago, o `transaction_nsu`, o `invoice_slug`
   e, quando houver, o link do comprovante. A tela diz "Pago — confirmado pela
   InfinitePay em dd/mm/aaaa às hh:mm".
3. **Catálogo do CRM.** Preço 18000 centavos; 10 peças; prazo em dias úteis
   por cor (branca 0, pronta entrega; chumbo e preta 10). O corpo traz só
   ids (`slug`, `cor_id`, `tamanho_id`), quantidade, prazo e valor; tudo é
   conferido com `store-catalog.js` e o pedido grava o preço do catálogo.
   Divergência é `422 STORE_CATALOG_MISMATCH`; valor pago menor que o preço,
   `422 AMOUNT_BELOW_PRICE`; forma diferente de `pix` ou gateway diferente de
   `infinitepay`, `422 PAYMENT_METHOD_UNSUPPORTED`.
4. **Número da loja.** `numero_loja` é `LJ-` e os 8 primeiros hexadecimais do
   `pedido_id` em maiúsculas (`LJ-5B0C77ED`), conferido pelo CRM. Aparece junto
   do `NN-CRM` e a busca da lista o acha. Não é único no banco: o `pedido_id`
   é.
5. **Idempotência pela chave natural.** O `pedido_id` identifica o pedido.
   Mesmos dados → `200` com o mesmo resultado; comprovante que chega depois →
   grava, audita `store.order.receipt_attached` e responde `200`; dados
   diferentes ou outro comprovante → `409 STORE_ORDER_CONFLICT`. O
   `transaction_nsu` é único. O reenvio é respondido antes do catálogo.
6. **O pedido.** Como na ADR 027: `origin = loja`, `confirmado`, travado, sem
   conversa nem Contato, autor "Loja do site", `created_by_kind = automation`,
   `payment_condition = pix`. `paid_on` e `order_date` são o dia de `pago_em`
   em America/Sao_Paulo. Nome, telefone e link do comprovante ficam no
   `ficha_envelope` cifrado; o recibo `crm.store_order_receipts` guarda o
   `pedido_id`, o HMAC do telefone e o hash dos dados comparados, sem IP nem
   `Origin`. A auditoria `store.order.create` registra o ator técnico e a
   correlação, sem PII.
7. **Resposta.** `201` criado ou `200` existente, com `numero`,
   `numero_loja`, `pedido_id` (do CRM), `criado`, `comprovante_registrado`,
   `pedido_url` e `ficha_url`. As URLs partem de `APP_BASE_URL`; sem ela,
   saem relativas.
8. **Teste.** `STORE_ORDERS_ACCEPT_TEST=true` aceita `teste: true`, marca o
   pedido (`is_test`, fora do Dashboard) e aceita o valor de teste de 100
   centavos; `false` responde `422 TEST_REFUSED`.
9. **Sem aviso automático.** O vendedor acompanha pelo CRM e atende pelo
   WhatsApp dele, fora do CRM. Aviso por template do WhatsApp fica para quando
   houver template aprovado e token permanente da Meta.

## Consequências

- A migration `0029_store_orders.expand.sql`, que nunca rodou fora da branch,
  é ajustada no lugar: sai `payment_declared_at` e entram as colunas do
  gateway, `store_number` e `lead_time_business_days`; o CHECK
  `orders_store_confirmed_and_paid` dá lugar a `orders_store_paid_by_gateway`
  (pago, Pix, gateway, valor pago maior ou igual ao valor); o recibo perde IP e
  `Origin`.
- `STORE_ORDERS_ALLOWED_ORIGINS` e os três limites saem do inventário;
  `STORE_ORDERS_HMAC_KEY` (busca pelo telefone; sem ela a rota responde `404`)
  e `STORE_ORDERS_ACCEPT_TEST` ficam; `APP_BASE_URL` passa a ser lida.
- O contrato `Order` troca `paymentDeclaredAt` por `storeNumber`,
  `leadTimeBusinessDays` e `gatewayPayment`; a ficha `ficha-loja-v1`, nunca
  publicada, é ajustada no lugar (sem retirada, com prazo e pagamento do
  gateway) e mantém o hash do estilo.
- A RULES 21 passa a dizer que o pedido da loja é registrado pelo n8n depois da
  confirmação do gateway; a exceção da RULES técnica 7 deixa de existir.
- O contrato n8n ganha uma quarta rota, só do workflow da loja; o
  `contract-v1.json` do agente de atendimento não muda.
- Um Pix pago que o CRM recusa (`4xx`) ou não recebe (`5xx`) fica sem pedido
  até alguém agir: o workflow precisa tratar todo não `2xx` como falha visível
  e reenviar a mesma chamada.
- O pedido travado guarda o kit; frete ou retirada combinados depois no
  WhatsApp ficam fora dele.
- Link profundo do CRM aberto sem sessão volta à rota pedida depois do login.

## Alternativas descartadas

Manter a rota pública v1 (o navegador não é quem confirma o pagamento),
WhatsApp ao vendedor por template (exige template aprovado e token permanente
da Meta) e reusar o evento `open_order` (preso a uma conversa) — razões na
seção 3 da RFC 016.

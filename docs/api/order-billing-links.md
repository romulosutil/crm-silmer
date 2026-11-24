# Contrato — Link de pagamento do CRM e cobranças que somam (LPC)

Contrato de implementação da [RFC 074](../rfc/074-link-de-pagamento-do-crm-e-cobrancas-que-somam.md),
aprovada pelo proprietário em 23/11/2026 (ADR 098). Valores sempre em centavos
inteiros. Datas em ISO 8601 UTC na API; a UI formata. Este documento descreve
o que o backend implementa; os esquemas HTTP estão em
[`order-billing.v1.json`](order-billing.v1.json) e
[`order-billing-chat.v1.json`](order-billing-chat.v1.json).

## Decisões fixadas (pontos da RFC)

1. Link do CRM aprovado: nada é criado na InfinitePay antes do clique em Pagar.
2. O link do CRM não tem validade própria: termina só por pagamento ou cancelamento.
3. Quando o pagamento da InfinitePay vence sem ser pago, o link volta a `open` e
   o próximo clique cria um pagamento novo (nova tentativa = nova `charge`).
   Somem "Link vencido", "Gerar novo link" e "Encerrar link vencido".
4. A página pública mostra só pedido, tipo e valor.
5. Mudança de valor do pedido cancela sozinha os links `open`
   (`cancel_reason = order_changed`), com auditoria; links já clicados seguem
   para conferência como hoje.
6. Valor livre por link, de R$ 1,00 até o livre para cobrar. 0% · 50% · 100%
   ficam no pedido como condição e sugerem só o primeiro link.
7. Link em `unknown` (Resultado a conferir) reserva o seu valor.
8. Em conferência, "Aplicar os pagamentos" fica disponível mesmo com link Em
   pagamento; só o cancelamento é bloqueado.
9. A API expõe o motivo da conferência (`review.reason`).
10. O clique só cria tentativa na InfinitePay com `ORDER_BILLING_ENABLED`. Só com
    `ORDER_BILLING_RECEIVE_ENABLED`, o GET público funciona e o POST num link
    `open` responde `{ "state": "failed" }` sem criar nada (uma tentativa já
    existente continua sendo devolvida). Os dois falsos: rotas inexistentes (404).
11. "Confirmar resultado na InfinitePay" é
    `POST …/links/:linkId/confirm-result`. Com `invoiceSlug` e `transactionNsu`
    enfileira a consulta n8n existente (`billing.payment.check`): pago → fluxo de
    pagamento de hoje (link `paid`); não pago → se a validade da tentativa já
    passou, a tentativa fecha e o link volta a `open` (evento
    `checkout_expired`); se não passou, o link fica `unknown` e a view expõe
    `verifying.nextAt`. O vencimento preguiçoso nunca reabre um `unknown`
    sozinho, e nunca se cria tentativa nova enquanto o link está `unknown`.
12. Recebimento por fora: valor ≤ livre só registra. Valor > livre exige que a
    diferença venha de `cancelLinkIds`, todos `open`. Se o dinheiro que falta
    está só em links `checkout_requested`/`checkout_open` → 409
    `BILLING_LINK_IN_PAYMENT`; em `unknown` → 409 `BILLING_LINK_UNKNOWN`; um link
    listado que deixou de estar `open` (corrida) → 409 `BILLING_LINK_NOT_OPEN`
    com `{ state, clickedAt }`; valor > falta receber → 422
    `BILLING_INVALID_AMOUNT` (como hoje).

Desvio consciente da RFC: o token é procurado pelo hash SHA-256, mas também é
guardado cifrado (mesmo envelope de `checkout_envelope`) para o responsável
poder **Copiar link** depois. A página pública nunca recebe o envelope.

## Modelo

Migração `0085_order_billing_links.expand.sql`.

Tabela `crm.order_billing_links`:

| Coluna                                                    | Regra                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`, `created_sequence`                                  | uuid; ordem de criação                                                                                    |
| `order_id`                                                | FK do plano de cobrança do pedido (o plano é criado na primeira cobrança)                                 |
| `token_hash`                                              | bytea único, SHA-256 do token (26 caracteres base32 Crockford, 130 bits)                                  |
| `token_envelope`                                          | token cifrado, só para o responsável copiar                                                               |
| `amount_cents`                                            | ≥ 100                                                                                                     |
| `kind`                                                    | `signal` · `balance` · `full` · `installment` (derivado do valor na criação)                              |
| `state`                                                   | `open` · `checkout_requested` · `checkout_open` · `unknown` · `paid` · `cancelled`                        |
| `origin`                                                  | `sent` · `generated`                                                                                      |
| `cancel_reason`                                           | `seller` · `order_changed` · `order_cancelled` · `external_receipt` · `reconcile` (nulo se não cancelado) |
| `confirmed_at`, `order_amount_cents`, `payment_condition` | acordo vigente na criação                                                                                 |
| datas/autoria                                             | `created_at/by`, `page_opened_at`, `clicked_at`, `cancelled_at/by`, `paid_at`                             |
| `version`                                                 | +1 a cada mudança                                                                                         |

- Um gatilho torna a identidade imutável e só deixa o estado andar para frente:
  `open → checkout_requested | cancelled | paid`;
  `checkout_requested → checkout_open | unknown | open | paid`;
  `checkout_open → open | paid`; `unknown → checkout_open | open | paid`.
  `paid` e `cancelled` são finais: quem perdeu a corrida não desfaz o resultado.
- `crm.order_billing_charges.link_id` (nulo para cobranças antigas, imutável):
  cada clique cria uma `charge` (tentativa) pelo caminho de hoje (outbox
  `billing.checkout.create`, `order_nsu = charge_id`). Sem mudança no n8n nem no
  worker.
- O índice `order_billing_one_active_charge` (por pedido) passa a valer só para
  cobranças sem `link_id`; `order_billing_one_active_link_charge` garante no
  máximo uma tentativa não resolvida por link.
- `kind` da charge aceita também `installment`.
- `crm.order_billing_plans.review_reason` guarda o motivo da conferência.
- `crm.order_billing_send_intents.link_id`: o envio pela conversa aponta para o
  link (então `charge_id` é nulo). Novas ações `send_link` e `issue_link` e novo
  motivo de bloqueio `LINK_CANCELLED`.
- `crm.order_billing_link_events` guarda o histórico, sem PII: `created`,
  `page_opened`, `clicked`, `checkout_opened`, `checkout_unknown`,
  `checkout_failed`, `checkout_expired`, `paid`, `cancelled`, `refund`,
  `applied`, `review`. `sent` e `delivered` vêm dos eventos de envio da conversa
  e entram no mesmo `history`.
- Ordem de bloqueio: advisory do pedido → usuários → conversas → … → pedido →
  plano → **links** → cobranças → intenções. A página pública segue a mesma
  ordem, sem ator.

**Reserva (LPC-06):** sob o bloqueio do pedido, Σ `amount_cents` dos links em
`open`, `checkout_requested`, `checkout_open` e `unknown` ≤ total − recebido.
Validado na criação de link e no recebimento por fora. Uma cobrança antiga
(sem link) ainda não resolvida também impede links que a ultrapassem.

**Nome da linha (na criação):** `signal` se nada recebido, guardado ou aberto,
condição 50 e valor = sinal de 50%; `full` se nada recebido/guardado/aberto e
valor = falta receber; `balance` se nenhum outro link aberto e valor = livre;
senão `installment`.

**Vencimento e incerteza (preguiçosos, sob bloqueio: leitura pública, clique,
leitura e comandos do vendedor):**

- tentativa `waiting` (checkout criado) com `valid_until ≤ agora` → `closed`, link
  volta a `open` (evento `checkout_expired`);
- tentativa ainda `queued` (nunca reservada pelo n8n) vencida, ou com o job do
  outbox em `dead_letter`/`outcome_unknown` → `closed`, link volta a `open`
  (`checkout_expired` ou `checkout_failed`). É seguro: a reserva recusa a
  tentativa fechada, então o n8n nunca a cria;
- tentativa `creating` (reservada) sem resposta há mais de 120 s, ou com o job em
  `dead_letter`/`outcome_unknown` → tentativa e link `unknown`
  (`checkout_unknown`). Sai de `unknown` pelo callback `created`
  (→ `checkout_open`), pelo pagamento (→ `paid`) ou por `confirm-result`
  (decisão 11);
- ao voltar a `open`, um link criado sob outro acordo é cancelado
  (`order_changed`).

Pagamento tardio de tentativa fechada, de link cancelado ou já pago, ou acima do
que falta receber vai para conferência (LPC-08). Um pagamento de link vivo marca
o link `paid` mesmo quando fica em conferência (deixa de reservar). Na mesma
transação, as outras tentativas ainda ativas desse link são fechadas (nunca
reservadas) ou vão para `review` (já na InfinitePay), o que põe o pedido em
conferência: um segundo pagamento fica visível e nada fica esperando para
sempre. Resolver a conferência fecha essas tentativas sem pagamento.

**Pedido cancelado (ADR 068):** cancelar o pedido cancela os links `open`
(`cancel_reason = order_cancelled`), com evento e auditoria. Tentativas já
clicadas seguem a regra de hoje para pedido cancelado (pagamento fica como
evidência não aplicada) e a página pública responde `unavailable`.

## API do vendedor (sessão + CSRF + `Idempotency-Key`, só responsável ou administrador)

`GET /api/v1/orders/:orderId/billing` mantém `{ billing: {…} }` e passa a
incluir, **dentro de `billing`**, além do que já existe:

```json
{
  "canOperate": true,
  "ownerName": "Ana R.",
  "condition": { "percent": 50 },
  "figures": {
    "totalCents": 480000,
    "receivedCents": 240000,
    "remainingCents": 240000,
    "heldCents": 0,
    "reservedCents": 120000,
    "freeCents": 120000
  },
  "situation": "waiting",
  "settledAt": null,
  "review": {
    "reason": "order_changed",
    "previousTotalCents": 450000,
    "heldCents": 225000,
    "refundedCents": null
  },
  "links": [
    {
      "id": "…",
      "kind": "installment",
      "amountCents": 120000,
      "state": "open",
      "origin": "sent",
      "url": "https://crm…/pagar/…",
      "chargeId": null,
      "checkoutUrl": null,
      "createdAt": "…",
      "createdBy": "Ana R.",
      "sentAt": "…",
      "deliveredAt": "…",
      "pageOpenedAt": "…",
      "clickedAt": null,
      "providerValidUntil": null,
      "paidAt": null,
      "payMethod": null,
      "invoiceCode": null,
      "refundedCents": 0,
      "cancelledAt": null,
      "cancelledBy": null,
      "cancelReason": null,
      "verifying": null,
      "inReview": false,
      "history": [
        { "kind": "created", "at": "…", "actor": "Ana R.", "reason": null }
      ]
    }
  ]
}
```

- `situation`, por urgência: `unknown` > `review` > `paying`
  (`checkout_requested`/`checkout_open`) > `waiting` (`open`) > `settled` >
  `partial` > `none`.
- `review` é nulo fora de conferência. `review.reason`: `order_changed` ·
  `refund` · `outside_agreement` · `late_payment`. `previousTotalCents` só em
  `order_changed` quando o total mudou; `refundedCents` (soma devolvida) só em
  `refund`.
- `chargeId` é a tentativa mais recente do link (use-a em `check-payment` e
  `refund`); `checkoutUrl` (responsável) só em `checkout_open`/`unknown`;
  `providerValidUntil` é a validade da tentativa em andamento.
- `verifying`: última consulta da tentativa mais recente,
  `{ checkId, state: "queued"|"paid"|"not_paid"|"failed", requestedAt, checkedAt, nextAt }`.
- `invoiceCode` (responsável) é o código da fatura InfinitePay (`invoice_slug`)
  do pagamento do link; também sai em `billing.payments[].invoiceCode`.
- Recebimentos por fora continuam em `billing.externalReceipts` (formato atual);
  não há campo `receipts` novo.
- Para outro vendedor (`canOperate: false`): números, selo e movimentações, mas
  `url`, `chargeId`, `checkoutUrl`, `payMethod`, `invoiceCode` e dados de
  comprovante vêm nulos, assim como `charges[].id`, `payments[].chargeId`,
  `paymentChecks[].id`/`chargeId` e `verifying.checkId`.

Escritas (todas com `expectedVersion`/`expectedBillingVersion` como hoje):

| Método e rota                                                       | Corpo                                                                                                                     | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/orders/:orderId/billing/links`                        | `{ amountCents, percent? }`                                                                                               | 201 `{ billing, linkId }`. "Só gerar o link". `percent` grava a condição se ainda não houver; sem plano e sem `percent` → 400 `BILLING_INVALID_PERCENT`.                                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/v1/orders/:orderId/billing/send-intents` (atual)         | `{ action: "send_link", linkId, … }` ou `{ action: "issue_link", amountCents, percent?, … }` com os campos comuns de hoje | 202 com a intenção já `queued` (sem `waiting_link`); `linkId` preenchido e `chargeId` nulo, também em `GET send-intents/:intentId`. `send_link` exige link `open`.                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/v1/orders/:orderId/billing/links/:linkId/cancel`         | `{}` + versões                                                                                                            | 200 com a view; 409 `BILLING_LINK_NOT_OPEN` com `{ state, clickedAt }` se não está `open` (checado antes das versões, então a corrida é sempre reportada assim).                                                                                                                                                                                                                                                                                                                                            |
| `POST /api/v1/orders/:orderId/billing/links/:linkId/confirm-result` | `{ invoiceSlug?, transactionNsu? }` (os dois ou nenhum)                                                                   | Decisão 11. 200 `{ billing, check }`; 409 `BILLING_CONFLICT` com `{ state, clickedAt }` se o link não está `unknown`; sem identificadores e antes da validade → 409 `BILLING_LINK_STILL_VALID`.                                                                                                                                                                                                                                                                                                             |
| `POST /api/v1/orders/:orderId/billing/external-receipts`            | atual + `cancelLinkIds?: uuid[]`                                                                                          | Decisão 12. Cancela os links listados e registra na mesma transação. Id desconhecido → 404 `BILLING_NOT_FOUND`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `POST /api/v1/orders/:orderId/billing/reconcile`                    | `{ decision: "apply_current" \| "close_unpaid" \| "cancel_open_links", confirmedProviderReview: true }`                   | `close_unpaid` fecha cobranças antigas sem link já vencidas e as tentativas de link sem pagamento retidas em `review` (o link volta a `open`, ou é cancelado com `order_changed` se o acordo mudou). `cancel_open_links` cancela os links `open` e aplica. `apply_current` recusa com 409 `BILLING_LINK_EXCEEDS_FREE` se recebido + **todos** os links reservando (`open`, `checkout_requested`, `checkout_open`, `unknown`) passar do total (LPC-06); com link Em pagamento que caiba, aplica (decisão 8). |
| `check-payment`, `refund`, `reverse` (atuais)                       | usam o `chargeId` da tentativa do link                                                                                    | sem mudança de contrato                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**LPC-01 sem exceção:** nenhuma rota humana cria cobrança nova na InfinitePay.
`POST …/charges` e as ações `issue`, `balance` e `correct` de
`send-intents` respondem 409 `BILLING_USE_PAYMENT_LINK` (depois de sessão,
CSRF, corpo e `Idempotency-Key` válidos, sem efeito). Cobranças antigas já
criadas seguem funcionando de ponta a ponta: callbacks do n8n, pagamento,
`check-payment`, `refund`, `reconcile` (inclusive `close_unpaid`), e o
envio pela conversa de uma cobrança que já existe (`send_existing`, `retry`),
que não cria nada.

Mensagem ao cliente: `Pedido {número} — {sinal|saldo|parcela|pagamento integral} de R$ X. Link para pagamento: {APP_BASE_URL}/pagar/{token}`.

## API pública (sem sessão, sem cookie, sem CSRF)

Base da URL: `{APP_BASE_URL}/pagar/{token}`. `APP_BASE_URL` (já existente,
`https://` absoluta) é obrigatória para gerar ou enviar links; sem ela essas
escritas falham com 503. O POST aceita como `Origin` a origem de `APP_BASE_URL`
e as de `APP_ORIGIN`.

`GET /api/v1/payment-links/:token`

```json
{
  "state": "ready",
  "orderNumber": "07-CRM",
  "kind": "signal",
  "amountCents": 240000
}
```

- `state`: `ready` (open) · `in_progress` (clicado; inclui `checkoutUrl` quando
  a InfinitePay já devolveu) · `paid` (inclui `paidAt`) · `failed` (`unknown`)
  · `unavailable`.
- `unavailable` é idêntico (200 `{ "state": "unavailable" }`, sem número de
  pedido, com os mesmos cabeçalhos) para token inexistente, malformado e
  cancelado, e para pedido cancelado. O token é lido sem diferenciar
  maiúsculas. Malformado inclui qualquer forma: vazio, com mais de 100
  caracteres (a rota é um curinga, sem o 414 do roteador), com `/`, unicode,
  bytes de controle ou `%` inválido (este responde sem passar pelos limites,
  porque nada é lido). Nenhuma resposta ecoa o caminho ou o token.
- Registra `page_opened` na primeira abertura (sem mudar a versão da cobrança).
  Depois disso, a leitura não bloqueia nem escreve: só toma os bloqueios do
  pedido quando uma transição preguiçosa está devida.

`POST /api/v1/payment-links/:token/checkout` (corpo `{}` ou vazio)

- Idempotente por link, sob o mesmo bloqueio do cancelamento (LPC-04).
- `open` → cria a tentativa e enfileira o comando; responde 202
  `{ "state": "in_progress", orderNumber, kind, amountCents }`. A página consulta
  o GET até receber `checkoutUrl` e faz `location.assign`.
- `open` sem poder criar (decisão 10, pedido em conferência ou fora do acordo do
  link, ou valor que não cabe mais) → 200 `{ "state": "failed", … }`, nada
  criado.
- Tentativa existente → 200 com a mesma (`checkoutUrl` se houver).
- `unknown` → `{ "state": "failed" }`, sem nova tentativa (LPC-05).
- `paid` → `{ "state": "paid", paidAt }`; `cancelled`/inexistente →
  `{ "state": "unavailable" }`.
- Só `POST {token}/checkout` é clique; outro POST sob o prefixo → 404
  `INVALID_REQUEST`, sem eco. A ordem é: limite por IP → forma do caminho e
  `Origin` (antes de ler o corpo) → corpo → limite por token.
- Corpo inválido no clique (JSON quebrado ou envenenado, corpo que não é `{}`)
  → 400 `INVALID_REQUEST`; corpo acima de 1024 bytes → 413
  `REQUEST_TOO_LARGE`; tipo de conteúdo sem leitor → 415
  `UNSUPPORTED_MEDIA_TYPE`. Sempre `application/problem+json` fixo
  (`{type,title,status,code}`), com os cabeçalhos públicos e sem eco. Quando o
  erro vem do leitor do corpo, registra um único `warn` `api_request_failed`
  com esse código, nunca `error`, sem token.
- Conjunto fechado de status do clique: 200, 202, 400, 403, 404, 413, 415, 429.
- Proteções: limite por IP (GET 120/min, POST 20/min, tolerante a CGNAT) e por
  token, pelo hash (GET 60/min, POST 10/min, contados à parte; a página consulta
  a cada 2,5 s com recuo). Todo 429 (por IP ou por token, GET ou POST) é
  `application/problem+json` com `code: "RATE_LIMITED"` e `Retry-After` em
  segundos inteiros (de 1 até 60) até a janela liberar; registra um único
  `warn` `api_request_failed` com `error_code: RATE_LIMITED`, nunca `error`,
  sem token nem caminho. `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex, nofollow`, `Origin` obrigatória no POST (403
  `FORBIDDEN`), só os campos acima saem, nenhum token nem PII em log (o logger
  da API não registra URL nem parâmetros; a auditoria usa o id do link).
- Rotas inexistentes (404) quando `ORDER_BILLING_ENABLED` e
  `ORDER_BILLING_RECEIVE_ENABLED` estão falsos.

## Códigos públicos novos

`BILLING_LINK_NOT_OPEN`, `BILLING_LINK_AMOUNT_INVALID`,
`BILLING_LINK_EXCEEDS_FREE`, `BILLING_RECEIPT_EXCEEDS_FREE`,
`BILLING_LINK_IN_PAYMENT`, `BILLING_LINK_UNKNOWN`, `BILLING_USE_PAYMENT_LINK`.
`BILLING_LINK_NOT_OPEN` e
`BILLING_CONFLICT` podem trazer `state` e `clickedAt` no corpo do problema.

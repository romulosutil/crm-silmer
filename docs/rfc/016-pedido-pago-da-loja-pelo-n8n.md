# RFC 016 — Pedido pago da loja confirmado pelo gateway, via n8n

Status: decidida pelo PO em 09/10/2026 (seção 4); registrada na
[ADR 028](../adr/028-pedido-pago-da-loja-pelo-n8n.md), que supersede em parte
a [ADR 027](../adr/027-venda-da-loja-do-site.md).

Data: 09/10/2026

Responsável: Tech Lead. Aprovador: PO (Rômulo Sutil Corrêa).

Origem: a loja `silmer.com.br/loja` deixou o Pix estático do Sicredi e passou
a cobrar pelo Checkout Integrado da InfinitePay, só Pix. O workflow do n8n
"Silmer | Loja | Checkout InfinitePay" (id `SbNSW5jwBcXM5Afj`, na instância
n8n do projeto `schedule` do EasyPanel) cria o link de pagamento,
recebe o webhook da InfinitePay e confirma o pagamento com `payment_check`
(pago é `paid` com `amount` maior ou igual ao valor do pedido). Falta o CRM
receber o pedido pago. Tarefa T110 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md); requisitos
`LOJ-15`–`LOJ-25` da [spec](../../.specs/features/pedidos-mvp/spec.md).

## 1. Situação atual

| Parte                  | Hoje                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch da loja         | `feat/loja-do-site` (PR #155) implementa a ADR 027: rota pública `POST /api/v1/public/loja/pedidos`, aviso "Já pagou?" do navegador, Pix "informado pelo cliente", `Origin` permitido e limites por IP e telefone.           |
| Onde a rota está       | Em lugar nenhum fora da branch. O deploy automático só sai do `master` (ADR 022) e a PR não foi mergeada: o cloud-dev responde `404` na rota e a migration `0029_store_orders.expand.sql` nunca rodou num banco do ambiente. |
| Pagamento              | Checkout Integrado da InfinitePay, só Pix. O `order_nsu` do checkout é o `pedido_id` (UUID v4) gerado pelo site. O n8n confirma o pagamento no servidor; o navegador não sabe, com segurança, que pagou.                     |
| Kit                    | 10 peças da mesma cor e tamanho, R$ 180,00 (18000 centavos; antes 19364). Prazo por cor: branca pronta entrega (0 dia útil), chumbo e preta 10 dias úteis.                                                                   |
| Contrato n8n → CRM     | Basic com o ator técnico `AUTOMATION_EXECUTOR`, `Idempotency-Key`, `X-Correlation-Id`, identidade do workflow e `application/problem+json` (ADR 003, RULES técnica 10).                                                      |
| Atendimento pós-compra | WhatsApp do vendedor, fora do CRM. Não há aviso automático ao vendedor.                                                                                                                                                      |

## 2. Objetivo

1. O pedido pago entra no CRM sozinho, enviado pelo n8n depois que a
   InfinitePay confirma o Pix, com a ficha e o link do comprovante.
2. O vendedor abre o pedido no CRM por um link e vê "Pago — confirmado pela
   InfinitePay", o valor pago, o NSU, o prazo e o número da loja (`LJ-…`).
3. Reenvio, comprovante que chega depois e falha de rede não duplicam pedido.
4. Nenhuma escrita pública: o CRM volta a não ter mutação sem autenticação.

## 3. Alternativas

| Alternativa                                                   | Avaliação                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Manter a rota pública v1 (navegador → CRM)                 | O navegador não é quem confirma o pagamento: teria de repetir o que o n8n já sabe, sem prova. Mantém a exceção à RULES técnica 7, CORS, `Origin` e limites por IP para um efeito que agora nasce num servidor. A rota nunca foi publicada, então removê-la não quebra ninguém.           |
| B. Rota de automação nova (n8n → CRM) — **recomendada**       | Mesma credencial Basic e mesmos cabeçalhos das rotas n8n, uma ação nova só do `AUTOMATION_EXECUTOR`. O CRM continua dono do catálogo, do preço e da idempotência. A confirmação do pagamento vem do gateway, chamada servidor a servidor. A exceção da RULES técnica 7 deixa de existir. |
| C. Aviso ao vendedor pelo WhatsApp (template) junto do pedido | Descartada agora. Mensagem iniciada pela empresa fora da janela de 24 h exige template aprovado na Meta e token permanente do WhatsApp Business no n8n; nenhum dos dois existe hoje. O vendedor acompanha pelo CRM; o aviso volta quando houver template e token.                        |
| D. Reusar `POST /integrations/n8n/events` (`open_order`)      | Os eventos do n8n são presos a uma conversa, a `automation_epoch` e à revisão de origem; o pedido da loja não tem conversa (ADR 027, D3). Estender o evento misturaria o atendimento do bot com a venda da loja.                                                                         |

## 4. Decisão do PO (09/10/2026)

O PO decidiu: **o pedido pago entra no CRM automaticamente, enviado pelo
n8n**, com a ficha e o link do comprovante, para o vendedor ver no CRM; não
haverá WhatsApp automático ao vendedor por enquanto. Fatos que mudam a ADR 027:

- preço do kit **R$ 180,00** (18000 centavos), 10 peças da mesma cor e tamanho;
- **prazo por cor**: branca 0 dia útil (pronta entrega), chumbo e preta
  **10 dias úteis**;
- pagamento **confirmado pelo gateway** (`payment_check`), não "informado pelo
  cliente";
- **só Pix**;
- a chamada é **servidor a servidor, do n8n**, não do navegador;
- o atendimento depois da compra é o WhatsApp do vendedor, fora do CRM. O
  telefone do vendedor não entra no código nem na documentação.

## 5. Proposta técnica (alternativa B)

### 5.1 Rota

`POST /api/v1/integrations/n8n/store-orders`, no mesmo formato das rotas n8n:
`Authorization: Basic` (`CRM_AUTOMATION_CLIENT_ID`/`CRM_AUTOMATION_CLIENT_SECRET`),
`Idempotency-Key` igual a `pedido_id`, `X-Correlation-Id`,
`X-Silmer-Workflow-Key`, `X-Silmer-Workflow-Version`, `X-Silmer-Execution-Id`,
corpo JSON até 16 KB e erros em `application/problem+json`. A ação nova
`store.order.record` só existe para o `AUTOMATION_EXECUTOR`; nenhuma função ou
capacidade humana a recebe.

### 5.2 Corpo

```json
{
  "schema_version": "1.0",
  "pedido_id": "<uuid v4 do site = order_nsu da InfinitePay>",
  "numero_loja": "LJ-XXXXXXXX",
  "teste": false,
  "produto": { "slug": "camisa-masculina-lisa" },
  "item": {
    "cor_id": "preta",
    "tamanho_id": "m",
    "quantidade": 10,
    "prazo_dias": 10
  },
  "valor_centavos": 18000,
  "cliente": { "nome": "…", "telefone": "55DDDNUMERO" },
  "pagamento": {
    "gateway": "infinitepay",
    "forma": "pix",
    "transaction_nsu": "…",
    "invoice_slug": "…",
    "valor_pago_centavos": 18000,
    "pago_em": "2026-10-09T19:40:59Z",
    "receipt_url": "https://…"
  }
}
```

`receipt_url` pode ser `null`. Todas as chaves são obrigatórias e nenhuma
outra é aceita.

### 5.3 Validação contra o catálogo do CRM

O catálogo continua em `modules/orders/src/domain/store-catalog.js` e decide:
slug, `cor_id` (branca → Branco, chumbo → Grafite/chumbo, preta → Preto),
`tamanho_id` (`pp` … `jeg` → JEGÃO), quantidade 10, `prazo_dias` igual ao da
cor, `valor_centavos` igual a 18000 (ou 100 num pedido de teste aceito),
`valor_pago_centavos` maior ou igual ao valor, `forma` só `pix`, `gateway` só
`infinitepay`, `numero_loja` igual a `LJ-` e os 8 primeiros hexadecimais do
`pedido_id` em maiúsculas, `receipt_url` nulo ou `https://` num host da lista
fechada (`infinitepay.io`, `*.infinitepay.io`, `infinitepay.com.br`,
`*.infinitepay.com.br`) e `pago_em` em ISO UTC, no máximo 5 minutos à frente
do relógio do CRM e no máximo 30 dias atrás. O CRM grava o preço do próprio
catálogo, nunca o do corpo.

### 5.4 Idempotência pela chave natural

A chave é o `pedido_id`, não um hash do corpo, porque o comprovante pode chegar
numa segunda chamada:

- mesmo pedido, mesmos dados → `200` com o mesmo resultado, sem pedido novo;
- mesmo pedido, sem comprovante antes e com comprovante agora → grava o link,
  audita `store.order.receipt_attached` e responde `200`;
- mesmo pedido com dados diferentes (item, valor, NSU, cliente, data, outro
  comprovante) → `409 STORE_ORDER_CONFLICT`;
- `transaction_nsu` é único: outro pedido com o mesmo NSU também é `409`.

Os dados comparados ficam num hash (`record_sha256`) no recibo do pedido; o
reenvio é respondido antes do catálogo, então um reenvio continua `200` mesmo
depois de o preço mudar.

### 5.5 O pedido

Nasce como na ADR 027 (`origin = loja`, `confirmado`, travado, sem conversa nem
Contato, `created_by_kind = automation`, `payment_condition = pix`, autor
"Loja do site"), agora com:

- `paid_on` e `order_date` no dia de `pago_em` em America/Sao_Paulo;
- colunas do gateway: fonte `infinitepay`, confirmado em, valor pago, NSU e
  slug da fatura;
- `store_number` (`LJ-…`) e `lead_time_business_days` (prazo em dias úteis);
- nome, telefone e o link do comprovante dentro do `ficha_envelope` cifrado
  (o link abre um comprovante com dados do pagamento);
- auditoria `store.order.create` com o ator `AUTOMATION_EXECUTOR`, sem PII.

O recibo `crm.store_order_receipts` passa a guardar só `pedido_id`, o HMAC do
telefone (busca da lista), o `record_sha256` e o recebimento: sem IP nem
`Origin`.

### 5.6 Resposta

```json
{
  "numero": "37-CRM",
  "numero_loja": "LJ-5B0C77ED",
  "pedido_id": "<uuid do pedido no CRM>",
  "criado": true,
  "comprovante_registrado": true,
  "pedido_url": "<APP_BASE_URL>/pedidos/<uuid>",
  "ficha_url": "<APP_BASE_URL>/api/v1/orders/<uuid>/print?download=1"
}
```

`201` quando cria, `200` quando já existia. As URLs saem de `APP_BASE_URL`, que
já está no inventário da topologia; sem ela, saem relativas
(`/pedidos/<uuid>`). Erros: `400` (`INVALID_REQUEST`, `UNKNOWN_REQUEST_FIELD`
e os códigos dos campos), `401`, `403 FORBIDDEN_AUTOMATION_ACTION`,
`409 STORE_ORDER_CONFLICT`, `422` (`STORE_CATALOG_MISMATCH`,
`AMOUNT_BELOW_PRICE`, `TEST_REFUSED`, `PAYMENT_METHOD_UNSUPPORTED`) e `503`.

### 5.7 Leitura e interface

Lista e página mostram "Pago — confirmado pela InfinitePay em dd/mm/aaaa às
hh:mm", o valor pago, o NSU, o prazo ("Pronta entrega" ou "10 dias úteis"), o
`LJ-…` junto do `NN-CRM` e o link "Comprovante InfinitePay". A busca da lista
acha o pedido pelo `LJ-…`. Como o vendedor vai abrir o `pedido_url` de um link,
um link profundo aberto sem sessão volta à rota pedida depois do login.

### 5.8 Configuração

Sai: `STORE_ORDERS_ALLOWED_ORIGINS`, `STORE_ORDERS_MAX_PER_IP_HOUR`,
`STORE_ORDERS_MAX_PER_PHONE_DAY` e `STORE_ORDERS_MAX_REQUESTS_PER_MINUTE`.
Fica: `STORE_ORDERS_HMAC_KEY` (busca pelo telefone; sem ela a rota responde
`404`) e `STORE_ORDERS_ACCEPT_TEST`. Passa a ser usada: `APP_BASE_URL`. A
credencial é a de automação que o n8n já usa.

## 6. Impactos

- **ADR 006** (dois status, confirmação humana): a emenda da ADR 027 para
  `origin = loja` continua; o motivo melhora — o pagamento é confirmado pelo
  gateway, não declarado.
- **ADR 008** (dias digitados por uma pessoa): na loja, `paid_on` vem de
  `pago_em`, confirmado pela InfinitePay.
- **ADR 027**: supersedida nos itens 1 e 2 (D1: rota pública, contrato v1 do
  site, sem n8n), 4 ("informado pelo cliente"), 7 (preço e campos do produto)
  e 9 (`Origin`, limites por IP e telefone). Continuam: pedido nascido
  confirmado e travado (3), venda normal no Dashboard (5), cliente só no pedido
  (6), teste separado (8) e ficha simplificada (10).
- **RULES 21**: o pedido da loja é registrado pelo n8n depois da confirmação
  do gateway, com o dia do pagamento do gateway.
- **RULES técnica 7**: a exceção da rota pública sai; toda mutação oficial
  volta a passar por contrato autenticado.
- **ADR 003**: o contrato n8n ganha uma quarta rota, usada só pelo workflow da
  loja; o `contract-v1.json` do agente de atendimento não muda.

## 7. Riscos

- **Pago e recusado.** O dinheiro já entrou quando o n8n chama o CRM. Um `422`
  (catálogo do CRM diferente do site ou do n8n) ou um `5xx` deixam um Pix pago
  sem pedido. Mitigação: o workflow trata todo não `2xx` como falha visível
  (RULES técnica 6), reenvia a mesma chamada (idempotente) e, no `4xx`, avisa
  uma pessoa; preço e prazo mudam primeiro no CRM.
- **Pedido travado e frete combinado depois.** O pedido guarda o kit (R$ 180,00
  e prazo da cor). Frete, retirada ou ajuste combinados no WhatsApp ficam fora
  do pedido: ele não aceita edição. Mudar isso exige decisão nova.
- **Link do comprovante.** Quem tem o link vê o comprovante; ele fica cifrado
  no banco e só aparece para quem lê o pedido.
- **`LJ-…` repetido.** Oito hexadecimais podem coincidir entre dois pedidos
  (raro no volume da loja). O `LJ-…` não é único no banco; a busca devolve os
  dois. O `pedido_id` é único.
- **Número da migration.** A `0029` é ajustada no lugar porque nunca rodou fora
  da branch. A branch `codex/inbox-media-rustfs-plan` também tem uma `0029`; a
  que chegar depois ao `master` renumera.
- **`APP_BASE_URL` ausente.** O n8n recebe URLs relativas; o link para o
  vendedor precisa do domínio.

## 8. Critérios de aceite

`LOJ-15`–`LOJ-25` na [spec](../../.specs/features/pedidos-mvp/spec.md).

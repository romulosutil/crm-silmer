# Runbook — venda da loja do site

Decisão: [ADR 027](../adr/027-venda-da-loja-do-site.md) e
[RFC 015](../rfc/015-venda-da-loja-do-site.md). Requisitos `LOJ-01`–`LOJ-14`
da [spec](../../.specs/features/pedidos-mvp/spec.md); tarefa T109 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md).

O site `silmer.com.br/loja` (repositório `silmer-web`) manda ao CRM o aviso
"Já pagou?" depois do Pix estático. O CRM cria um pedido confirmado, travado,
sem conversa nem contato, com "Pago (informado pelo cliente)", e devolve o
número `NN-CRM`. Nada passa pelo n8n.

## URLs

| Ambiente                           | URL do endpoint                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Cloud-dev/piloto (único hoje)      | `https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host/api/v1/public/loja/pedidos` |
| Produção, quando o domínio existir | `https://crm.<dominio>/api/v1/public/loja/pedidos`                                      |
| Local (`npm run dev`)              | `http://127.0.0.1:4173/api/v1/public/loja/pedidos`                                      |

Na Vercel, projeto `silmer` (time `romulodesigns`), variável
`PUBLIC_LOJA_PEDIDOS_URL`: **Preview** e **Production** apontam para o
cloud-dev/piloto até `crm.<dominio>` existir (decisão D5). Depois, Production
passa à URL de produção.

## Variáveis da `silmer-api`

| Variável                               | Valor                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORE_ORDERS_HMAC_KEY`                | 32 bytes aleatórios em base64url. Segredo: nunca versionar nem reaproveitar de outra variável.                                                      |
| `STORE_ORDERS_ALLOWED_ORIGINS`         | `https://silmer.com.br,https://www.silmer.com.br,https://silmer-*-romulodesigns.vercel.app`. `http://localhost:4330` só num CRM de desenvolvimento. |
| `STORE_ORDERS_ACCEPT_TEST`             | `true` enquanto o Pix do site for o de teste (aceita e separa `teste: true`); `false` no CRM de produção (`422 teste_recusado`).                    |
| `STORE_ORDERS_MAX_PER_IP_HOUR`         | Opcional, padrão `5`.                                                                                                                               |
| `STORE_ORDERS_MAX_PER_PHONE_DAY`       | Opcional, padrão `5`.                                                                                                                               |
| `STORE_ORDERS_MAX_REQUESTS_PER_MINUTE` | Opcional, padrão `30` (por IP, na rota, em memória).                                                                                                |

A rota também usa `FAB_CODE`, `IDEMPOTENCY_ENVELOPE_KEY` e
`N8N_INTEGRATION_ENVELOPE_KEY`, que o CRM já tem. Sem
`STORE_ORDERS_HMAC_KEY` e `STORE_ORDERS_ALLOWED_ORIGINS` a rota responde
`404`; só uma das duas, ou um valor malformado, impede a API de subir.

Gerar a chave (fora do repositório, sem colar em chat ou log):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Ordem de implantação

1. Merge no `master`; o deploy automático GitHub → EasyPanel publica
   `silmer-api` e `silmer-edge-web` (ADR 022). O edge leva o hash do estilo
   da `ficha-loja-v1` no CSP da impressão.
2. Migration `0029_store_orders.expand.sql` pelo job `migrate`. É expand: a
   API anterior continua funcionando com ela.
3. Variáveis da tabela acima na `silmer-api` e redeploy do serviço.
4. Verificação da seção seguinte.
5. `PUBLIC_LOJA_PEDIDOS_URL` na Vercel e novo deploy do site.

Nenhum workflow do n8n muda.

## Verificação depois do deploy

Preflight de uma origem permitida — `204` com
`access-control-allow-origin: https://silmer.com.br`:

```bash
curl -si -X OPTIONS "https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host/api/v1/public/loja/pedidos" -H "Origin: https://silmer.com.br" -H "Access-Control-Request-Method: POST"
```

Um aviso de teste sintético (gere um UUID v4 novo e use-o nos dois lugares;
o horário precisa ser de agora) — `201 {"numero":"NN-CRM"}`; repetido, `200`
com o mesmo número:

```bash
curl -si -X POST "https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host/api/v1/public/loja/pedidos" -H "Origin: https://silmer.com.br" -H "Content-Type: application/json" -H "Idempotency-Key: <uuid>" --data '{"versao":"1","pedido_id":"<uuid>","teste":true,"produto":{"slug":"camisa-masculina-lisa","nome":"Camisa Masculina Lisa Dry Fit"},"item":{"tipo":"Camiseta","publico":"masculino","cor":"Preto","cor_id":"preta","tamanho":"M","tamanho_id":"m","malha":"Dry fit liso de poliéster","gola":"Gola redonda","quantidade":10},"valor_centavos":19364,"pagamento":{"forma":"pix","informado_pelo_cliente_em":"<agora em ISO UTC>"},"retirada":{"local":"Av. Carlos Lindenberg, 800 — Lojas 05 e 06, Glória, Vila Velha - ES"},"cliente":{"nome":"Teste Sintetico","telefone":"5527900000001"}}'
```

Depois, em Pedidos → "Loja do site": o pedido aparece com os selos "Loja" e
"Teste", a página está travada e "Baixar ficha" baixa
`pedido-NN-CRM.html`. O Dashboard não muda (pedido de teste não conta). O
pedido de teste fica no CRM: não há exclusão.

## Respostas e diagnóstico

| Resposta                                 | O que olhar                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `404`                                    | Rota desligada: faltam `STORE_ORDERS_HMAC_KEY` e `STORE_ORDERS_ALLOWED_ORIGINS`.                                    |
| `403 origem_nao_permitida`               | `Origin` fora de `STORE_ORDERS_ALLOWED_ORIGINS` (domínio novo do site, preview de outro projeto).                   |
| `400 corpo_invalido`, `versao_invalida`… | O site mudou o contrato v1. Comparar com `pedido-loja.ts` e o OpenAPI (`createStoreOrder`).                         |
| `409 idempotency_conflict`               | O mesmo `pedido_id` foi reenviado com outro corpo; o site gera outro id quando a pessoa muda os dados.              |
| `422 valor_divergente` e afins           | Produto, preço, cor ou tamanho do site diferentes de `modules/orders/src/domain/store-catalog.js`. Alinhar os dois. |
| `422 teste_recusado`                     | `teste: true` num CRM com `STORE_ORDERS_ACCEPT_TEST=false`.                                                         |
| `422 horario_invalido`                   | Relógio do aparelho muito adiantado ou aviso reenviado depois de 7 dias.                                            |
| `429 rate_limited`                       | Limite por IP ou por telefone; `Retry-After` diz quando liberar.                                                    |
| `503 indisponivel`                       | Falha interna; os logs da API trazem só o código do erro, nunca nome, telefone ou IP.                               |

Mudou produto ou preço no site: mude o catálogo do CRM primeiro, publique e
só então publique o site.

## Conferência no Sicredi

"Pago" é o que o cliente informou: o QR é estático e nada liga um Pix a um
pedido. A Rose filtra "Loja do site" em Pedidos e compara cada pedido com o
extrato do Sicredi (valor R$ 193,64, dia e hora informados). O kit só sai na
retirada com o Pix conferido. Um aviso sem Pix correspondente continua
contando como venda: tirar do Vendido exige uma decisão nova (D9). Até lá,
fale com o cliente pelo telefone do pedido e avise um administrador.

## Rollback

- Desligar a rota: remover `STORE_ORDERS_HMAC_KEY` e
  `STORE_ORDERS_ALLOWED_ORIGINS` e fazer redeploy. A rota responde `404`, e o
  site mostra "Não conseguimos registrar agora" com o caminho do WhatsApp.
- Voltar a imagem da API: a migration é expand e a versão anterior continua
  lendo os pedidos; os pedidos da loja já criados ficam no banco e voltam a
  aparecer completos quando a versão nova voltar.
- Nunca apagar `crm.store_order_receipts` nem pedidos da loja: são o lastro da
  venda e a base dos limites.

## Privacidade

Nome e telefone ficam só dentro da ficha cifrada do pedido. O recibo guarda
HMACs do IP e do telefone, nunca os valores. Nenhum dos três vai para log. A
retenção é a do pedido (documento comercial).

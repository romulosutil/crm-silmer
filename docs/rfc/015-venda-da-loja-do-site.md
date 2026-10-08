# RFC 015 — Venda da loja do site no CRM

Status: em revisão, aguardando a decisão do PO sobre D1–D9 (seção 7).

Data: 07/10/2026

Responsável: Tech Lead. Aprovador: PO (Rômulo Sutil Corrêa).

Origem: o PO pediu em 07/10/2026 para "computar a venda do site no CRM. Basta
o site avisar que o QR Code foi pago. Como lastro, o CRM cria um pedido
travado, com status 'Pago', com nome + telefone (…) e um download da ficha de
pedido simplificada, apenas com os detalhes padrão completos". O site
(`silmer-web`, branch `feat/loja-camisa-lisa`) já implementa o lado dele do
contrato v1 (`apps/landingpage/src/lib/pedido-loja.ts` e
`docs/superpowers/specs/2026-10-07-loja-contrato-crm.md` naquele repositório)
e roda em modo teste até existir o endpoint. Tarefa T103 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md); requisitos propostos
`LOJ-01`–`LOJ-14` na seção 6. A decisão vira a ADR 027.

## 1. Situação atual

| Parte             | Hoje                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loja do site      | Um produto: kit de 10 camisas "Camisa Masculina Lisa Dry Fit", R$ 193,64, uma cor e um tamanho por kit (Branco, Grafite/chumbo, Preto; PP a JEGÃO), Pix estático reutilizável do Sicredi, retirada na loja. Depois de pagar, a pessoa informa nome e WhatsApp e o navegador faz um `POST`.                                                                                         |
| Pedido            | Dois status, `pendente` e `confirmado`; confirmação e reabertura humanas ([ADR 006](../adr/006-pedido-dois-status.md); RULES 4, 5, 9 e 10).                                                                                                                                                                                                                                        |
| Vínculo do pedido | `crm.orders.conversation_id` é obrigatório e no máximo um pendente por conversa (`orders_one_pending_per_conversation`). O pendente lê o cliente da conversa ([ADR 018](../adr/018-cliente-do-pedido-acompanha-o-contato.md)); o bot cria e projeta só pendentes da conversa que atende.                                                                                           |
| Lastro de datas   | `paid_on` e `delivered_on` são dias digitados por uma pessoa e não mudam o status ([ADR 008](../adr/008-lastro-de-datas-do-pedido.md); RULES 16).                                                                                                                                                                                                                                  |
| Vendido           | `GET /api/v1/orders/summary` soma só `confirmado`: valor vendido, pedidos, ticket médio, peças.                                                                                                                                                                                                                                                                                    |
| Cliente           | `Contact` + `ContactIdentity` (RULES 2). Juntar identidades só com correlação verificável e auditável (RULES técnica 5). Nome e telefone ficam cifrados; a busca da lista passa pelas conversas.                                                                                                                                                                                   |
| API pública       | Só o webhook da Meta, autenticado por assinatura. Toda mutação oficial passa por contrato autenticado (RULES técnica 7). O chat do site entra pelo n8n ([ADR 026](https://github.com/romulosutil/crm-silmer/blob/feat/n8n-midia-e-chat-do-site/docs/adr/026-midia-e-chat-do-site-no-bot.md), ainda na branch `feat/n8n-midia-e-chat-do-site`), com o limite por IP como pendência. |
| Impressão         | `/api/v1/orders/:id/print` devolve HTML da `ficha-canonical-v6` (`PRINT_TEMPLATE`), só para pedido confirmado; o nginx libera o estilo de cada template por hash no CSP.                                                                                                                                                                                                           |
| Ambientes         | Só um CRM responde na internet: o cloud-dev/piloto `https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host`, que o workflow principal do WhatsApp já usa. O domínio de produção `crm.<dominio>` ainda não existe ([topologia](../../EASYPANEL-TOPOLOGY.md), seção 3).                                                                                                          |
| Infra de proteção | `@fastify/rate-limit` em memória (já usado no SSE), `trustProxy` para a rede interna, `crm.idempotency_records` transacional com resposta cifrada, `crm.audit_events`. Sem Redis (AGENTS e topologia).                                                                                                                                                                             |

## 2. Objetivo

1. O aviso "Já pagou?" do site vira um pedido no CRM, com número `NN-CRM`
   devolvido ao site, sem duplicar em reenvio.
2. O pedido é lastro da venda: travado, com status "Pago (informado pelo
   cliente em …)", nome e telefone, e uma ficha simplificada para baixar.
3. Conta como venda no Dashboard, com a parcela da loja visível para a Rose
   conferir no Sicredi.
4. Não se mistura com o atendimento: nenhum contato, conversa ou pendente do
   bot é criado, achado ou alterado.
5. O endpoint público resiste a abuso sem infraestrutura nova.

## 3. Proposta

### 3.1 Onde mora o endpoint (D1)

Rota pública **no CRM**: `POST /api/v1/public/loja/pedidos` (e o preflight
`OPTIONS` no mesmo caminho), servida pelo `silmer-edge-web` em `/api/*` como o
resto da API.

| Critério                       | Rota pública no CRM                                                                                  | Webhook público no n8n → API autenticada                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fronteira de confiança         | Internet → CRM. O navegador não guarda segredo nos dois casos.                                       | Internet → n8n → CRM. A credencial do n8n autentica o n8n, não o cliente: a fronteira pública é a mesma, com um salto a mais.                                                                              |
| Validação, preço, idempotência | No CRM, perto do dado.                                                                               | Também no CRM: a API autenticada precisa do mesmo endpoint de criação, catálogo e idempotência. O n8n só repassa.                                                                                          |
| Limite por IP e por telefone   | Contadores no PostgreSQL, na mesma transação da criação, mais o `@fastify/rate-limit` que já existe. | O n8n não tem limite por IP (pendência da ADR 026); contadores em `staticData` não são atômicos. O IP chegaria por cabeçalho repassado.                                                                    |
| CORS                           | Lista exata mais o padrão dos previews da Vercel, no código, com teste.                              | O webhook do n8n aceita uma lista fixa de origens; previews da Vercel mudam a cada deploy.                                                                                                                 |
| Falhas                         | Um serviço a menos no caminho: n8n parado não impede registrar a venda.                              | n8n parado ou workflow despublicado = venda não registrada depois do Pix pago.                                                                                                                             |
| Regras do repositório          | Exige exceção explícita à RULES técnica 7 (mutação oficial sem autenticação).                        | Cumpre a letra da RULES técnica 7, mas não o espírito: o contrato autenticado só carregaria o que o público mandou. A RULES técnica 6 põe no n8n canais, IA e orquestração — a loja não é nenhum dos três. |
| Mudança em produção do n8n     | Nenhuma.                                                                                             | Workflow novo e publicado no n8n de produção.                                                                                                                                                              |

**Recomendação:** rota pública no CRM, como exceção nomeada à RULES técnica 7
— uma rota, um efeito (criar pedido da loja ao preço do catálogo do CRM), sem
leitura de dado nenhum. O contrato do site é o mesmo nos dois casos.

### 3.2 Contrato v1 (igual ao que o site já implementa)

- `POST {URL}`, `Content-Type: application/json`, `Idempotency-Key` igual a
  `pedido_id` (UUID v4); `Origin` obrigatório e da lista (seção 3.7).
- Corpo exatamente com as chaves do contrato; chave desconhecida, faltando ou
  de tipo errado é `400`. `versao` diferente de `"1"` é `400`.
- Respostas: `201 {"numero":"NN-CRM"}` criado; `200` com o mesmo número para
  a mesma chave e o mesmo corpo; `400 {"erro":"<codigo>"}` malformado; `409
{"erro":"idempotency_conflict"}` mesma chave com outro corpo; `422
{"erro":"<codigo>"}` fora do catálogo, valor divergente, `teste` recusado ou
  horário fora da janela; `429 {"erro":"rate_limited"}` com `Retry-After`;
  `403 {"erro":"origem_nao_permitida"}` sem `Origin` da lista. O site só lê
  `numero` num `2xx`.
- "Mesmo corpo" é o JSON canônico (ordem das chaves não importa). O reenvio é
  respondido antes de qualquer limite: uma resposta perdida nunca vira `429`.
- `Idempotency-Key` diferente de `pedido_id` é `400`.
- Corpo até 8 KB.

### 3.3 O pedido da loja (D2)

- **Origem própria.** Coluna `origin`: `atendimento` (todo pedido de hoje) ou
  `loja`. O pedido da loja **não tem conversa** (`conversation_id` nulo, só
  para `loja`), então nunca entra em `ensurePendingFromIntent`, na projeção do
  bot, na gaveta da conversa nem no índice de um pendente por conversa. Um
  pendente que a mesma pessoa tenha com o bot continua intocado.
- **Nasce no estado oficial.** `status = confirmado`, com autor "Loja do
  site" (`confirmed_by = 'system:loja-do-site'`, `created_by_kind =
automation`), `confirmed_at` e `order_date` no recebimento (dia de São
  Paulo), `final_amount_cents` do catálogo do CRM (19364),
  `payment_condition = pix`. Número `NN-CRM` da mesma sequência (RULES 11).
- **Travado.** Nenhuma escrita depois de criado: editar seção, gerar, reabrir,
  lastro, arquivos da arte → `409 ORDER_LOCKED`, antes de qualquer checagem de
  dono. A tela não mostra esses controles.
- **Pago, informado pelo cliente.** `paid_on` = dia (São Paulo) de
  `pagamento.informado_pelo_cliente_em`, e a nova coluna
  `payment_declared_at` guarda o instante declarado. A interface mostra
  "Pago" com a ressalva "informado pelo cliente em dd/mm/aaaa às hh:mm". O
  instante vem do relógio do navegador: precisa estar entre 7 dias antes e 5
  minutos depois do recebimento, senão `422 horario_invalido`.
- **Ficha do pedido.** O item vem do catálogo do CRM: tipo `Camiseta`,
  público `masculino`, cor e tamanho escolhidos, malha `Dry fit liso de
poliéster`, gola `Gola redonda`, grade `[{tamanho, quantidade: 10}]`, arte
  `sem_estampa`. O resumo leva o cliente (nome); um bloco `loja` leva telefone,
  produto (slug e nome), endereço de retirada e o instante declarado. Tudo
  dentro do `ficha_envelope` cifrado, como o resto da ficha.

**Como isso concilia com a ADR 006.** A confirmação humana existe para alguém
decidir valor, condição e ficha completa (RULES 5, 6 e 10). Na loja, esses
três foram decididos antes, por uma pessoa, ao cadastrar o produto no catálogo
da loja no CRM (código versionado e revisado): preço fixo, Pix fixo, produto
fixo. Não sobra decisão para a confirmação, e reabrir levaria o pedido para um
fluxo de pendente sem conversa nem dono. Por isso o pedido nasce `confirmado`
e travado. Continuam dois status; "Pago" é leitura da origem e do lastro, não
um terceiro status. A ADR 027 emenda a ADR 006 e as RULES 4, 5, 9, 10 e 16
só para `origin = loja`.

### 3.4 Conta como venda e o Dashboard

- O pedido da loja conta em "Vendido", "Pedidos confirmados", "Ticket médio"
  e "Peças vendidas", como qualquer confirmado.
- `GET /api/v1/orders/summary` ganha `store: {count, amountCents}` e passa a
  ignorar pedidos de teste. O card "Vendido" mostra embaixo "inclui N da loja
  do site · R$ X informados pelo cliente", para a Rose comparar com o extrato
  do Sicredi.
- A lista ganha o filtro "Loja do site" (`origin=loja`), para a mesma
  conferência.

### 3.5 Cliente mínimo e contato (D3)

- **Não cria nem acha Contato.** Nome e telefone ficam só no pedido, cifrados.
  O telefone digitado num formulário público não é verificado: qualquer um
  digita o número de outra pessoa. Achar o Contato pelo E.164 penduraria um
  pedido não verificado na conversa de alguém real; criar um Contato com
  `ContactIdentity` de WhatsApp para esse número faria a próxima mensagem da
  pessoa cair num contato com o nome digitado por terceiros. As duas coisas
  quebram a RULES técnica 5 (correlação verificável e auditável, nunca por
  nome).
- **Convivência com a ADR 018.** A ADR 018 vale para pendentes, que leem o
  cliente da conversa. O pedido da loja nasce gerado e sem conversa: guarda o
  nome recebido, como todo pedido gerado guarda o da geração (PCT-02).
- **Achar o pedido pela pessoa.** A busca da lista acha o pedido da loja pelo
  número e pelo telefone: o CRM guarda um HMAC do E.164
  (`phone_digest`, chave `STORE_ORDERS_HMAC_KEY`) e compara com o HMAC do que
  foi digitado. Pelo nome não (cifrado), a mesma limitação registrada na ADR 018.
- Juntar o pedido da loja a um Contato fica para depois, com correlação
  verificável (por exemplo, a pessoa escreve no WhatsApp da Silmer citando o
  número do pedido).

### 3.6 Catálogo e validação no CRM (D8)

- Catálogo da loja no domínio de pedidos
  (`modules/orders/src/domain/store-catalog.js`), com o produto
  `camisa-masculina-lisa`: nome, tipo, público, malha, gola, preço (19364),
  peças por kit (10), endereço de retirada, as cores com o id do site
  (`branca → Branco`, `chumbo → Grafite/chumbo`, `preta → Preto`) e os
  tamanhos com o id do site (`pp → PP` … `jeg → JEGÃO`).
- `422` quando: slug desconhecido (`produto_desconhecido`), cor ou tamanho fora
  da lista ou com id que não corresponde (`cor_invalida`, `tamanho_invalido`),
  quantidade diferente do kit (`quantidade_divergente`), valor diferente do
  preço do CRM (`valor_divergente`), ou nome, tipo, público, malha, gola ou
  retirada diferentes do catálogo (`produto_divergente`). O CRM nunca usa o
  `valor_centavos` do navegador: grava o preço do próprio catálogo.
- `cliente.nome`: espaços normalizados, 2–80 caracteres, sem caracteres de
  controle. `cliente.telefone`: E.164 brasileiro sem `+`
  (`55` + DDD sem zero + celular de 9 dígitos começando com 9 ou fixo de 8
  começando com 2–5), a mesma regra do site; fora disso é `400`.
- Mudou o produto ou o preço no site, muda o catálogo do CRM no mesmo dia,
  antes do deploy do site; senão o aviso cai em `422` e o site mostra "envie o
  comprovante para a Rose no WhatsApp".

### 3.7 Proteção do endpoint público (D6, D7)

- **Origem.** `Origin` obrigatório e da lista: `https://silmer.com.br`,
  `https://www.silmer.com.br`, previews do projeto `silmer` do time
  `romulodesigns` na Vercel (`https://silmer-<…>-romulodesigns.vercel.app`) e,
  só onde configurado, `http://localhost:4330`. Lista em
  `STORE_ORDERS_ALLOWED_ORIGINS`. O preflight responde `204` com
  `Access-Control-Allow-Origin` (a origem pedida), `Allow-Methods: POST,
OPTIONS`, `Allow-Headers: Content-Type, Idempotency-Key`,
  `Expose-Headers: Retry-After`, `Max-Age: 600` e `Vary: Origin`; origem fora
  da lista não recebe cabeçalho CORS. CORS não autentica ninguém (um `curl`
  manda qualquer `Origin`): a proteção real são as três linhas seguintes.
- **Limites.** Três camadas, configuráveis:
  - 30 requisições por minuto por IP na rota, válidas ou não
    (`@fastify/rate-limit`, em memória, antes de ler o banco);
  - 5 pedidos criados por hora por IP e 5 por 24 horas por telefone, contados
    no PostgreSQL na mesma transação da criação (sem Redis; sobrevivem a
    restart);
  - `Retry-After` em segundos até a janela liberar.
    O IP é o do cliente visto pelo `trustProxy` já configurado (Traefik →
    nginx → API na rede interna).
- **Auditoria.** Cada criação grava um recibo em `crm.store_order_receipts`
  (pedido, `pedido_id`, `Origin`, HMAC do IP, HMAC do telefone, hash do corpo,
  recebimento) e um `audit_events` `store.order.create` com o ator
  `system:loja-do-site`. Recomendação D6: o IP fica como HMAC, não em claro —
  basta para limitar e ligar abusos da mesma origem sem guardar dado pessoal a
  mais (RULES técnica 8).
- **Idempotência.** A mesma `crm.idempotency_records` das outras rotas
  (escopo `system:loja-do-site:store.order.create`), com a criação do pedido,
  o recibo e a auditoria na mesma transação do registro. O `pedido_id` é
  também único no recibo.
- **Logs.** Nome, telefone e IP nunca vão para log; o logger seguro já corta.

### 3.8 Teste e ambientes (D4, D5)

- `STORE_ORDERS_ACCEPT_TEST=true`: `teste: true` cria o pedido marcado como
  teste (`is_test`), com selo "Teste" na lista, na página e na ficha ("PEDIDO
  DE TESTE"), fora do Dashboard e do "Vendido". `false`: `422
teste_recusado`.
- Hoje só existe o cloud-dev/piloto, que já é onde a operação roda. A
  recomendação é: as duas variáveis da Vercel apontam para ele até existir
  `crm.<dominio>`, com `STORE_ORDERS_ACCEPT_TEST=true` enquanto o Pix do site
  for o de teste. No CRM de produção, quando existir, `false`.
- Do lado do site, fora deste repositório: o Preview deveria mandar sempre
  `teste: true` (hoje o `teste` vem do produto em `loja.ts`, igual em todo
  ambiente). Quando o Pix real entrar e o produto passar a `teste: false`, um
  preview mandaria pedido real.
- A rota fica desligada (`404`) enquanto `STORE_ORDERS_HMAC_KEY` e
  `STORE_ORDERS_ALLOWED_ORIGINS` não estiverem configuradas, como os pedidos
  ficam sem `FAB_CODE`.

### 3.9 Interface

- **Lista de pedidos:** selo "Loja" ao lado do número; na coluna de situação,
  "Pago · informado pelo cliente em dd/mm/aaaa às hh:mm" em vez de
  "Confirmado por …"; selo "Teste" quando for teste; filtro "Loja do site".
- **Página do pedido:** cabeçalho "Pedido NN-CRM", status "Pago (informado
  pelo cliente)" e selo "Loja"; aviso "Pedido da loja do site: travado, sem
  edição"; um bloco só de leitura com cliente (nome e telefone), produto, tipo,
  público, cor, malha, gola, tamanho, quantidade, valor, Pix "informado pelo
  cliente em …", retirada e origem; botão **Baixar ficha** (e Imprimir ficha).
  Nenhuma seção editável, fechamento, lastro ou arquivos da arte.
- **Dashboard:** a linha da loja embaixo de "Vendido".
- Acessibilidade: selos com texto (não só cor), o status anunciado como texto,
  botões com nome acessível, foco no título ao abrir, tudo por teclado.

### 3.10 Ficha simplificada

- Template próprio `ficha-loja-v1`: HTML imprimível A4, uma página, com
  número, data, cliente (nome e telefone), produto, tipo, público, cor, malha,
  gola, tamanho, quantidade 10, valor R$ 193,64, Pix "informado pelo cliente
  em …", retirada na loja (endereço) e origem "Loja do site". Nada de arte,
  técnica, observações nem campos vazios.
- Mesma rota `GET /api/v1/orders/:id/print`: o pedido da loja usa a
  `ficha-loja-v1`, os outros seguem o `PRINT_TEMPLATE`. Com `?download=1` a
  resposta vem como anexo `pedido-NN-CRM.html`. O hash do estilo entra no CSP
  do nginx, como os das fichas canônicas.
- Não substitui a ficha canônica nem passa pela assinatura de Rose e Operação:
  é o comprovante da retirada de um produto de pronta entrega.

### 3.11 Dados e implantação

- Migration `0029_store_orders.expand.sql`:
  - `crm.orders`: `origin` (padrão `atendimento`), `is_test` (padrão `false`),
    `payment_declared_at`, `conversation_id` anulável com a regra "nulo se e
    só se `origin = loja`" e "teste só na loja";
  - `crm.store_order_receipts` (seção 3.7), com índices por HMAC de IP e de
    telefone e por recebimento.
    Os pedidos existentes ficam `atendimento`, sem mudança. Uma API da versão
    anterior não cria pedido da loja e lê os existentes como antes.
- Variáveis novas na `silmer-api`: `STORE_ORDERS_HMAC_KEY` (32 bytes),
  `STORE_ORDERS_ALLOWED_ORIGINS`, `STORE_ORDERS_ACCEPT_TEST` e, opcionais, os
  três limites.
- OpenAPI (`docs/api/openapi.v1.yaml`): a rota pública, o `Order` com
  `origin`, `isTest`, `paymentDeclaredAt`, `locked` e o bloco `ficha.loja`, o
  filtro `origin` da lista e o `store` do resumo.
- Ordem: migration → API → variáveis → URL na Vercel. Sem mudança no n8n.
- URLs: `https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host/api/v1/public/loja/pedidos`
  hoje; `https://crm.<dominio>/api/v1/public/loja/pedidos` quando o domínio de
  produção existir.

## 4. Alternativas consideradas

| Alternativa                                                          | Por que não                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook público no n8n chamando a API autenticada                    | Mesma fronteira pública com um salto e um ponto de falha a mais; o CRM precisaria do mesmo endpoint; sem limite por IP no n8n (seção 3.1).                                                                   |
| Pedido da loja nasce `pendente` e uma pessoa confirma após o Sicredi | Respeita a ADR 006 sem emenda, mas o PO pediu "Pago" e travado, e um pendente sem conversa não tem dono para confirmar. Conferir no Sicredi continua possível pelo filtro da loja e pela linha do Dashboard. |
| Terceiro status "pago"                                               | Quebra RULES 4 e cada filtro, contagem e regra que conhece dois status, para dizer o que a origem e o lastro já dizem.                                                                                       |
| Criar ou achar o Contato pelo telefone                               | Correlação não verificável (seção 3.5).                                                                                                                                                                      |
| Criar uma conversa "loja" para o pedido                              | Conversa sem mensagem na Caixa de Entrada, dono, handoff e bot em volta de algo que não é atendimento; o pendente do bot poderia colidir com ela.                                                            |
| Usar o `valor_centavos` do site                                      | O navegador decide o preço. Proibido pela RULES 6.                                                                                                                                                           |
| Recusar `teste: true` em todo ambiente                               | Não há outro CRM na internet para o site testar de ponta a ponta antes do Pix real.                                                                                                                          |
| Só o `@fastify/rate-limit` em memória                                | Zera a cada deploy e não conta por telefone. Fica como a primeira camada.                                                                                                                                    |

## 5. Riscos

- **Aviso falso.** Qualquer um informa "paguei" sem pagar: o pedido conta como
  venda até alguém notar. Mitigação: limites, a linha da loja no Dashboard e o
  filtro para a conferência no Sicredi; a retirada só acontece com o Pix
  conferido. Tirar um aviso falso do "Vendido" exige uma ação nova (D9).
- **Número exposto.** O `numero` devolvido revela a sequência de pedidos do
  CRM a quem fizer um envio. Aceito: é o que o contrato precisa.
- **Catálogo fora de sincronia.** Produto ou preço mudado no site sem mudar o
  CRM vira `422` para quem já pagou (seção 3.6). Mitigação: teste de contrato
  com o JSON do site e a ordem de implantação no runbook.
- **IP compartilhado.** Operadora móvel com CGNAT pode pôr muitos clientes num
  IP; 5 pedidos por hora é folgado para o volume da loja e configurável.
- **Exceção à RULES técnica 7.** Primeira mutação oficial sem autenticação.
  Fica restrita a uma rota, um efeito e um catálogo, nomeada na ADR 027 e na
  RULES, para não virar precedente genérico.
- **Previews da Vercel.** O padrão aceita qualquer projeto `silmer-…` cujo
  sufixo seja `-romulodesigns.vercel.app`. Como CORS não é autenticação, o
  risco é igual ao de um `curl`.

## 6. Critérios de aceite propostos

| ID     | Critério                                                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOJ-01 | `POST /api/v1/public/loja/pedidos` com o corpo do contrato v1 e `Origin` permitido cria um pedido e responde `201 {"numero":"NN-CRM"}`.                                                                        |
| LOJ-02 | Mesma `Idempotency-Key` e mesmo corpo responde `200` com o mesmo número, sem novo pedido, mesmo acima dos limites; outro corpo responde `409 idempotency_conflict`; chave diferente de `pedido_id` é `400`.    |
| LOJ-03 | Corpo malformado, chave desconhecida ou faltando, `versao` diferente de `"1"`, nome ou telefone inválidos respondem `400 {"erro": …}`.                                                                         |
| LOJ-04 | Slug, cor, tamanho, quantidade, valor ou campos do produto diferentes do catálogo do CRM respondem `422`; o pedido grava o preço do catálogo, nunca o do navegador.                                            |
| LOJ-05 | Com `STORE_ORDERS_ACCEPT_TEST=false`, `teste: true` responde `422 teste_recusado`; com `true`, o pedido nasce marcado como teste e fica fora do Dashboard e do Vendido.                                        |
| LOJ-06 | O pedido da loja nasce `confirmado`, `origin = loja`, sem conversa, autor "Loja do site", condição Pix, `paid_on` e `payment_declared_at` do aviso; nenhum contato, conversa ou pendente é criado ou alterado. |
| LOJ-07 | Editar, gerar, reabrir, lastro e arquivos num pedido da loja respondem `409 ORDER_LOCKED`; a página não mostra esses controles.                                                                                |
| LOJ-08 | Lista e página mostram selo "Loja" e "Pago (informado pelo cliente em dd/mm/aaaa às hh:mm)"; a lista filtra "Loja do site" e acha o pedido pelo número e pelo telefone.                                        |
| LOJ-09 | O Dashboard conta os pedidos da loja (não teste) em Vendido e mostra a parcela da loja.                                                                                                                        |
| LOJ-10 | "Baixar ficha" baixa `ficha-loja-v1` com só os campos padrão; a mesma rota imprime; o CSP do nginx libera só o estilo dela.                                                                                    |
| LOJ-11 | Preflight `OPTIONS` libera `POST`, `Content-Type` e `Idempotency-Key` só para as origens configuradas, com `Vary: Origin`; `POST` sem origem permitida é `403`.                                                |
| LOJ-12 | Acima de 5 pedidos/hora por IP ou 5/24 h por telefone, ou 30 requisições/minuto por IP, responde `429 rate_limited` com `Retry-After`.                                                                         |
| LOJ-13 | Cada criação grava recibo (pedido, `pedido_id`, `Origin`, HMAC do IP e do telefone, hash do corpo) e auditoria na mesma transação do pedido; nada disso vai para log.                                          |
| LOJ-14 | Toda a interface nova opera por teclado, com selos em texto e foco previsível.                                                                                                                                 |

## 7. Decisões para o PO

| #   | Decisão                                                   | Recomendação do Tech Lead                                                                                                       |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Onde mora o endpoint?                                     | Rota pública no CRM, como exceção nomeada à RULES técnica 7 (seção 3.1).                                                        |
| D2  | Em que estado nasce o pedido da loja?                     | `confirmado`, autor "Loja do site", travado, conta como venda; emenda da ADR 006 e das RULES só para `origin = loja`.           |
| D3  | Cria ou acha o Contato pelo telefone?                     | Não. Nome e telefone só no pedido; busca pelo telefone via HMAC.                                                                |
| D4  | O que fazer com `teste: true`?                            | Aceitar e separar (selo "Teste", fora das métricas) onde `STORE_ORDERS_ACCEPT_TEST=true`; recusar com `422` onde for `false`.   |
| D5  | Para onde apontam Preview e Production da Vercel?         | Os dois para o cloud-dev/piloto até existir `crm.<dominio>`; Preview do site sempre com `teste: true`.                          |
| D6  | O IP fica em claro na auditoria?                          | Não: HMAC do IP. Basta para limitar e ligar abusos.                                                                             |
| D7  | Quais limites?                                            | 5 pedidos/hora por IP, 5/24 h por telefone, 30 requisições/minuto por IP; configuráveis.                                        |
| D8  | Divergência nos campos descritivos do produto é recusada? | Sim, `422 produto_divergente`: o pedido registra o que o cliente viu e o CRM vende.                                             |
| D9  | Entram agora "Pix não encontrado" e "Retirado em"?        | Não. Ficam fora deste corte; o pedido nasce e fica travado. Voltam se a conferência mostrar avisos falsos ou faltar a retirada. |

## 8. Entrega proposta, depois da decisão

Branch `feat/loja-do-site`, a partir do `master`; cada tarefa vira um commit e
um push.

1. **T104** — ADR 027, emendas em RULES, ARCHITECTURE e TECHNICAL-DESIGN,
   `LOJ-*` na spec e tasks.
2. **T105** — Migration `0029_store_orders.expand.sql`, catálogo da loja,
   validação, criação travada e leituras no domínio de pedidos; testes de
   unidade e de repositório.
3. **T106** — Rota pública com CORS, limites, idempotência, recibo e
   auditoria; OpenAPI; testes de contrato com o JSON do site (criação,
   reenvio, 409, 422 de valor e de teste, CORS, 429).
4. **T107** — Lista, resumo do Dashboard e `ficha-loja-v1` com download e
   hash no CSP.
5. **T108** — Interface: selo "Loja", "Pago (informado pelo cliente)", pedido
   travado, "Baixar ficha", filtro e linha do Dashboard; E2E por teclado.
6. **T109** — Runbook de implantação (variáveis, ordem, URLs) e revisão
   integrada. Sem deploy e sem mudança no n8n sem pedido do PO.

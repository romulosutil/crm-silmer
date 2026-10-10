# RFC 019 — Aviso de pedido novo do site no Dashboard

Status: decidida pelo PO em 10/10/2026 (seção 4); registrada na
[ADR 031](../adr/031-aviso-de-pedido-novo-do-site.md), que supersede em parte
a [ADR 028](../adr/028-pedido-pago-da-loja-pelo-n8n.md) (item 9).

Data: 10/10/2026

Responsável: Tech Lead. Aprovador: PO (Rômulo Sutil Corrêa).

Origem: a jornada v3 da loja (prompt "Jornada da loja v3: pedido pago →
alerta no CRM", de 10/10/2026) pediu que o pedido pago do site deixe de entrar
no CRM sem que ninguém seja avisado. Tarefas T116–T120 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md); requisitos
`LOJ-26`–`LOJ-37` da [spec](../../.specs/features/pedidos-mvp/spec.md).

## 1. Situação atual

| Parte                          | Hoje                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pedido pago da loja            | Entra pelo n8n (`POST /api/v1/integrations/n8n/store-orders`) já **Confirmado**, travado, sem conversa nem Contato (ADR 028).                                                  |
| Aviso                          | Nenhum (ADR 028, item 9). O pedido só aparece na lista de Pedidos, no meio dos confirmados do atendimento.                                                                     |
| Tela do pedido                 | Selo "Pago — confirmado pela InfinitePay em …", folha com 18 campos (tipo, público, malha, gola, NSU…) e sem o painel "Fechamento e pagamento" dos outros pedidos confirmados. |
| Ficha impressa `ficha-loja-v1` | Uma página com Pedido, Cliente, Produto, Pagamento e Comprovante; repete o número, mostra NSU, fatura, tipo, público, malha e gola, que não ajudam a produzir o kit.           |
| Evento ao vivo                 | A criação do pedido da loja já grava a linha `order` em `crm.domain_events`; o painel recebe `inbox.order.changed`.                                                            |

## 2. Objetivo

1. Quem abre o CRM vê que há pedido pago do site esperando, sem procurar.
2. O aviso some sozinho quando a equipe começa a trabalhar no pedido, sem
   botão novo nem passo a mais.
3. O pedido da loja se parece ao máximo com um pedido do CRM depois de
   "Gerar pedido": mesmo status, mesmo painel, mesmas ações.
4. A ficha impressa mostra só o que a produção e o contato precisam.
5. O contrato com o n8n não muda.

## 3. Alternativas

| Alternativa                                                                 | Avaliação                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Marca "tirar" (fila "Para tirar", botão "Tirar pedido", estado "Tirado") | Proposta do prompt da jornada v3. Cria um conceito, um termo e uma escrita humana nova num pedido travado; o pedido da loja deixaria de se parecer com o pedido gerado no CRM. **Considerada e rejeitada pelo PO em 10/10/2026**, para manter a máxima semelhança com "Gerar pedido". |
| B. Aviso no Dashboard até a primeira impressão da ficha — **recomendada**   | O primeiro trabalho sobre o pedido pago é imprimir a ficha; a impressão já existe, já é autorizada (`order.print`) e já é o que a equipe faz. Registrar a primeira impressão não muda o pedido nem o status; o aviso é consequência.                                                  |
| C. Aviso por WhatsApp ao vendedor                                           | Continua fora: exige template aprovado e token permanente da Meta (ADR 028, alternativa C).                                                                                                                                                                                           |
| D. Contar pedidos da loja criados "hoje"                                    | Não diz se alguém já cuidou do pedido; um pedido da madrugada sumiria do aviso sem ninguém ver.                                                                                                                                                                                       |

## 4. Decisão do PO (10/10/2026)

1. O pedido pago do site continua chegando **Confirmado** e travado, como hoje
   (ADR 028): o mesmo status de qualquer pedido depois de "Gerar pedido", com
   as particularidades dele (origem Loja, pago pela InfinitePay, sem
   "Reabrir"). Não há status, ação ou termo "tirar".
2. **Aviso no Dashboard**: uma linha clicável no topo — "N pedidos novos do
   site" (singular "1 pedido novo do site"), o detalhe "Confirmados e pagos
   por Pix, o mais antigo em DD/MM, HH:MM. Imprima as fichas para começar a
   produção." e "Ver pedidos". O aviso inteiro é um link para Pedidos com o
   filtro "Loja do site". Some quando não há pedido novo e atualiza ao vivo.
3. **Pedido novo do site** é o pedido da loja (`origin = loja`), que não é
   teste, cuja ficha **nunca foi impressa**. Sai do aviso na primeira vez em
   que uma pessoa autenticada imprime ou baixa a ficha.
4. O CRM registra a primeira impressão (quem e quando), uma vez só. Lista e
   página mostram "Ficha não impressa" até lá e "Ficha impressa por …" depois.
5. O menu "Pedidos" mostra o número de pedidos novos do site.
6. A página do pedido da loja usa o mesmo layout dos outros pedidos
   confirmados: status "Confirmado", painel "Fechamento e pagamento" com
   Valor final, Forma de pagamento "Pix" e "Confirmado pela loja do site · …",
   o cartão da ficha e, no lugar de "Reabrir pedido", a explicação de que o
   pedido da loja não é reaberto.
7. A folha do pedido e a ficha impressa mostram só produto ("Camisa dry
   fit"), cor, tamanho, quantidade, prazo da cor, cliente, WhatsApp,
   pagamento e comprovante.
8. O cliente é avisado de que o kit ficou pronto pela equipe, manualmente,
   pelo WhatsApp. Automatizar isso fica para depois.

## 5. Desenho

- **Banco**: migration expand `0034_store_order_first_print.expand.sql` com
  `crm.orders.ficha_first_printed_at timestamptz` e
  `ficha_first_printed_by text REFERENCES crm.users (id) ON DELETE RESTRICT`,
  ambas nulas; CHECKs: os dois juntos e só em pedido da loja.
- **Registro**: a rota `GET /api/v1/orders/{orderId}/print` (com ou sem
  `download=1`), depois da autorização que já existe (`order.print`), chama
  `recordFirstPrint` quando o pedido é da loja e ainda não foi impresso. Um
  `UPDATE … WHERE ficha_first_printed_at IS NULL` grava só a primeira vez;
  na mesma transação, a versão sobe, entra o evento `order.ficha_first_printed`
  (`aggregate_type = 'order'`, ao vivo `inbox.order.changed`) e a auditoria
  `order.ficha.first_print`, com o id da pessoa e do pedido, sem PII.
  `updated_at` não muda: o pedido em si não mudou.
- **Leitura**: o contrato `Order` ganha `fichaFirstPrintedAt` e
  `fichaFirstPrintedBy` (`{id, name}`); `GET /api/v1/orders/summary` ganha
  `storeNewCount` e `storeNewOldestPaidAt` (instante do Pix confirmado do mais
  antigo), sem pedido de teste.
- **Interface**: aviso no Dashboard (`aria-live="polite"`, um só link para
  `/pedidos?origem=loja`), contador no menu com texto para leitor de tela,
  selo "Ficha não impressa" e linhas da lista, página no layout de duas
  colunas e ficha `ficha-loja-v1` revista (com o hash do estilo atualizado no
  CSP do nginx).
- **n8n**: contrato igual. O `numero` da resposta já é o código que o site
  mostra; o `/status` do workflow passa a devolver `codigo_crm` com ele, sem
  mudar o CRM.
- **Reenvio com outro `pago_em` (emenda o `LOJ-17`)**: o `/status` do
  workflow chama `store-orders` assim que vê o pedido pago, em paralelo ao
  webhook `/infinitepay`, e cada execução carimba o próprio `pago_em`. Como o
  hash do recibo inclui `pago_em`, o segundo envio do mesmo `pedido_id`, um
  segundo depois, virava `409 STORE_ORDER_CONFLICT`, que o n8n grava como
  erro permanente. O serviço passa a comparar o reenvio também com o
  instante que o CRM guardou na primeira chamada: diferença só em `pago_em`
  responde `200` com o mesmo `numero` e mantém o primeiro instante; qualquer
  outra diferença continua `409`. O formato do hash não muda.

## 6. Riscos

- A ficha aberta por engano tira o pedido do aviso. Aceito: o pedido continua
  na lista com "Ficha impressa por …", e quem imprimiu fica registrado.
- A API nova lê as colunas novas: a migration `0034` precisa rodar antes ou
  junto da imagem nova (é expand; a versão anterior convive com ela).
- Pedido de teste nunca entra no aviso; o aviso é validado pelos testes do
  CRM e, no go-live, com um pedido real.

# ADR 031 — Aviso de pedido novo do site até a primeira impressão da ficha

Status: aceita

Data: 10/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 10/10/2026, decidiu que o pedido
pago do site continua chegando Confirmado e travado, que o Dashboard avisa os
pedidos novos do site e que um pedido deixa de ser novo na primeira impressão
da ficha. O PO considerou e **rejeitou** a marca "tirar" proposta na jornada
v3 da loja (fila "Para tirar", ação "Tirar pedido", estado "Tirado"), para
manter a máxima semelhança com "Gerar pedido". Tech Lead definiu o registro,
a leitura e a interface.

RFC: [RFC 019](../rfc/019-aviso-de-pedido-novo-do-site.md). Requisitos
`LOJ-26`–`LOJ-37` da [spec](../../.specs/features/pedidos-mvp/spec.md);
tarefas T116–T120 de [tasks](../../.specs/features/pedidos-mvp/tasks.md).
Supersede em parte a [ADR 028](028-pedido-pago-da-loja-pelo-n8n.md): o item 9
("Sem aviso automático") passa a ter o aviso no Dashboard; o resto do item 9
(sem WhatsApp automático ao vendedor) e os demais itens continuam. Emenda o
`LOJ-22`: a lista e a página deixam de mostrar o NSU e o selo "Pago —
confirmado pela InfinitePay em …", que fica só na ficha impressa. Emenda o
`LOJ-17` (item 10): um reenvio que difere só em `pago_em` é o mesmo pedido.

## Contexto

O pedido pago do site entra no CRM pelo n8n, Confirmado e travado (ADR 028),
mas ninguém é avisado: ele fica no meio dos confirmados da lista. A tela e a
ficha da loja tinham campos que não ajudam a produzir o kit (NSU, fatura,
tipo, público, malha, gola) e uma aparência diferente da dos pedidos gerados
no CRM.

## Decisão

1. **Status.** O pedido da loja continua `confirmado`, `origin = loja`,
   travado, sem "Reabrir". Não existe status, ação, termo ou escrita "tirar".
2. **Pedido novo do site.** Pedido da loja que não é teste (`is_test` falso,
   ADR 028 item 8) e cuja ficha nunca foi impressa.
3. **Primeira impressão.** A migration expand
   `0034_store_order_first_print.expand.sql` cria
   `ficha_first_printed_at` e `ficha_first_printed_by` (usuário, `ON DELETE
RESTRICT`), nulas, só em pedido da loja e sempre juntas. A rota
   `GET /api/v1/orders/{orderId}/print`, com ou sem `download=1`, autorizada
   como já é (`order.print`, sessão humana), grava a primeira impressão de um
   pedido da loja com `UPDATE … WHERE ficha_first_printed_at IS NULL`; as
   seguintes não mudam nada. A mesma transação sobe a versão, grava o evento
   `order.ficha_first_printed` (`aggregate_type = 'order'`, ao vivo
   `inbox.order.changed`) e a auditoria `order.ficha.first_print`, com o
   usuário, o pedido e a correlação, sem PII. `updated_at` não muda.
4. **Leitura.** O contrato `Order` ganha `fichaFirstPrintedAt` e
   `fichaFirstPrintedBy` (`{id, name}`). `GET /api/v1/orders/summary` ganha
   `storeNewCount` e `storeNewOldestPaidAt` (instante em que a InfinitePay
   confirmou o Pix do mais antigo), sem pedido de teste.
5. **Dashboard.** Uma linha clicável no topo, em tom de atenção: "N pedidos
   novos do site" (ou "1 pedido novo do site"), o detalhe com o mais antigo e
   "Imprima as fichas para começar a produção.", e "Ver pedidos". É um único
   link para `/pedidos?origem=loja`, numa região `aria-live="polite"`; some
   com N = 0 e atualiza com `inbox.order.changed`. O menu "Pedidos" mostra o
   mesmo número.
6. **Lista e página.** O pedido da loja fica em "Confirmados", com as ações de
   sempre, o selo "Ficha não impressa" enquanto não impresso (exceto teste) e
   a situação "Confirmado pela loja do site · DD/MM/AAAA, HH:MM"; depois,
   "Ficha impressa por {nome} · …". A página usa o layout de duas colunas dos
   outros pedidos, com status "Confirmado" e o painel "Fechamento e
   pagamento" confirmado (Valor final, "Pix", "Confirmado pela loja do site ·
   …", o cartão da ficha) e a explicação de que o pedido da loja não é
   reaberto, no lugar de "Reabrir pedido".
7. **Folha e ficha.** A folha da página e a ficha `ficha-loja-v1` mostram só
   o que a produção e o contato usam: produto "Camisa dry fit" (rótulo de
   exibição; o catálogo e o slug não mudam), cor, tamanho, quantidade, prazo
   da cor, cliente, WhatsApp, pagamento e comprovante. A ficha nunca foi
   publicada fora do CRM de desenvolvimento, então muda no lugar; o hash do
   novo estilo entra no CSP do nginx. Por uma versão, o CSP mantém também o
   hash do estilo anterior: o nginx (imagem `edge-web`) e a API (imagem de
   runtime) sobem separados, e em qualquer ordem a ficha sairia sem estilo.
   A versão seguinte remove o hash anterior.
8. **Contrato n8n.** Igual: corpo e resposta de `store-orders` não mudam; o
   reenvio (`200`) devolve o mesmo `numero`, também depois da impressão.
9. **Cliente.** O aviso de que o kit está pronto é feito pela equipe, à mão,
   pelo WhatsApp do pedido; automação fica para depois.
10. **Reenvio com outro `pago_em` (emenda o `LOJ-17`).** O `/status` do
    workflow passou a chamar `store-orders` assim que vê o pedido pago, em
    paralelo ao webhook `/infinitepay`; cada execução carimba o próprio
    `pagamento.pago_em`. Duas chamadas do mesmo `pedido_id` que diferem só
    nesse instante são o mesmo pedido: `200`, mesmo `numero`, e o pedido
    mantém o `pago_em` da primeira. Qualquer outra diferença (produto, cor,
    tamanho, valores, cliente, NSU, fatura) continua `409
STORE_ORDER_CONFLICT`. O hash guardado no recibo não muda de formato: o
    reenvio é comparado de novo com o instante que o CRM guardou, o que vale
    igual nos repositórios PostgreSQL e em memória e para pedidos já gravados.

## Consequências

- A API nova lê as colunas novas: a `0034` roda antes ou junto da imagem nova.
  É expand: a versão anterior convive com ela.
- Imprimir é agora uma leitura com efeito: a primeira impressão de um pedido
  da loja grava quem e quando. A autorização não muda (`order.print`, sessão
  e origem do próprio CRM; Basic é recusado), e o efeito é idempotente.
- Uma conta que imprimiu uma ficha da loja passa a ter histórico e não pode
  ser excluída (`USER_HAS_HISTORY`), como quem confirmou pedidos.
- Sem a emenda do item 10, o segundo envio virava `409`, que o n8n grava
  como erro permanente (`crm_erro`) e não repete: o cliente nunca veria o
  código do pedido.
- O glossário ganha "Pedido novo do site"; "Confirmado" continua sem
  significar início da produção.
- O `LOJ-22` deixa de valer para a lista e a página quanto ao NSU e ao selo
  "Pago — confirmado pela InfinitePay"; a ficha impressa mantém a faixa.

## Alternativas descartadas

Marca "tirar" (rejeitada pelo PO), WhatsApp ao vendedor (template e token da
Meta) e contar pedidos do dia — razões na seção 3 da RFC 019.

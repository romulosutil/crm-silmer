# RFC 075 — CRM Silmer 2.0: leitura comercial do cliente

Proposta de 24/11/2026, em revisão no
[PR 463](https://github.com/romulosutil/crm-silmer/pull/463). Base analisada:
`origin/master` `0c89a1c7`. Este RFC cobre a fase **Leitura comercial** da
feature [`crm-20`](../../.specs/features/crm-20/spec.md): requisitos C20-01 a
C20-06 e a evolução C20-13, tarefas C20-T00 a T06, T15 e T16, decisões D02,
D03 e D05. A fase **Identidade entre linhas** (C20-07 a C20-12) está no
[RFC 076](076-identidade-do-cliente-entre-linhas.md).

**Pendência antes do aceite:** o documento de produto de origem ("proposta
CRM Silmer 2.0, versão 1.0", DOCX) não está no repositório. Antes do aceite,
registrar aqui a versão, a data e o local autorizado onde ele está guardado,
ou anexar um resumo sem dados pessoais.

## Por que mudar

O Silmer já separa Contato, identidades de canal, Conversas por ciclo,
Assuntos e Pedidos ([ADR 032](../adr/032-separar-pedido-conversa-e-assunto.md),
[ADR 033](../adr/033-telefone-no-cadastro-e-roteamento.md),
[ADR 090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md)).
O valor comercial do relacionamento, porém, não aparece em nenhuma tela do
cliente. O código atual mostra quatro lacunas:

1. **Pedidos do cliente incompletos.**
   [`ClientOrders.vue`](../../apps/edge-web/src/components/ClientOrders.vue)
   busca `/api/v1/orders?owner=me&cancellation=all&limit=100` e filtra o
   `contactId` no navegador. Só aparecem Pedidos do próprio vendedor, e uma
   página pode vir vazia enquanto os Pedidos do Contato estão nas seguintes.
   `GET /api/v1/orders` não tem filtro público por Contato.
2. **Painel da Inbox sem histórico.**
   [`ConversationOrderSummary.vue`](../../apps/edge-web/src/components/inbox/ConversationOrderSummary.vue)
   mostra o Pedido da conversa ativa, não o último Pedido do Contato.
3. **Conversas do Contato sem paginação.** O detalhe
   `GET /api/v1/contacts/:contactId` devolve `conversations` filtradas por
   `contactConversationVisible`, sem cursor
   ([`postgres-contact-read-repository.js`](../../modules/contacts/src/adapters/postgres-contact-read-repository.js)).
4. **Indicador de vendas só no agregado.** A apuração atual
   (`summary` e `commercialSales` em
   [`postgres-order-repository.js`](../../modules/orders/src/adapters/postgres-order-repository.js))
   soma todos os Pedidos visíveis, inclusive os da loja, e devolve ticket
   médio 0 quando a contagem é zero. Não há recorte por Contato.

## Proposta

Entregar uma leitura comercial aditiva, sem mudar escrita, carteira nem
identidade. O [design técnico](../../.specs/features/crm-20/design.md) detalha
os contratos.

1. **Três leituras sob `/api/v1/contacts/:contactId`:**
   `commercial-summary`, `commercial-orders` e `commercial-conversations`.
   Nomes e schemas são fixados no OpenAPI
   ([`openapi.v1.yaml`](../api/openapi.v1.yaml)) na T03, que também passa a
   validar o schema das respostas novas, além do `operationId`.
2. **Mesmo predicado dentro da consulta.** Pedidos usam `orderReadable`
   ([`order-contact-access.js`](../../modules/orders/src/adapters/order-contact-access.js));
   conversas usam `contactConversationVisible`
   ([`contact-access.js`](../../modules/contacts/src/adapters/contact-access.js)).
   O filtro vem antes de selecionar IDs, contar, somar ou paginar. O Pedido é
   deduplicado por ID antes de agregar. Contato fora do universo do leitor
   responde como inexistente.
3. **Universo de vendas igual ao da apuração atual.** O Pedido só tem os
   status `pendente` e `confirmado`
   ([`order.js`](../../modules/orders/src/domain/order.js)). Conta como venda
   `status='confirmado' AND NOT is_test AND cancelled_at IS NULL`, com
   `contact_id` igual ao Contato. Ficam fora o teste (`is_test`, só existe em
   Pedido da loja), o cancelado e o pendente, inclusive o reaberto ainda não
   reconfirmado (reabrir volta a `pendente` e grava `reopened_at`). O Pedido
   reconfirmado após reabertura conta, como hoje, salvo decisão diferente em
   D03.
4. **Valor e data oficiais.** Soma de `final_amount_cents` em centavos
   inteiros, sem recalcular itens nem ler a ficha criptografada. A data é
   `order_date`, gravada na confirmação no fuso America/Sao_Paulo. Ticket
   médio e última venda viram ausência (`null`) quando a contagem é zero, ao
   contrário do 0 da apuração atual.
5. **Loja fora do resumo por Contato.** Pedido da loja tem sempre
   `contact_id IS NULL`
   ([migração 0035](../../modules/database/migrations/0035_manual_contacts_orders.expand.sql)),
   então o dashboard inclui a loja e o resumo do Contato não. D03 aprova o
   rótulo que deixa essa divergência explícita
   ([ADR 027](../adr/027-venda-da-loja-do-site.md), parcialmente supersedida
   pela [ADR 028](../adr/028-pedido-pago-da-loja-pelo-n8n.md)).
6. **Paginação e índice.** Cursor por `(order_date, id)`, limite padrão 25 e
   máximo 100, como a lista de Pedidos atual. Não há índice em
   `(contact_id, order_date, id)`; a T03 inclui migração expand com índice
   parcial para o universo de vendas e registra o plano de consulta (G06),
   porque `orderReadable` roda EXISTS aninhados por linha.
7. **Flag estrita.** `CONTACT_COMMERCIAL_READ_ENABLED` (nome fixado na T03),
   `'true'|'false'`, valor inválido derruba a partida, com allowlist
   `*_SELLER_IDS`, no padrão de `SELLER_CLIENTS_ENABLED`
   ([`operation-runtime.js`](../../apps/api/src/operation-runtime.js)).
   Desligada, o perfil e o painel atuais continuam como estão.
8. **Consumidores.** A T04 substitui `ClientOrders.vue` pelo perfil novo em
   Clientes e Meus clientes; a T05 leva o resumo ao painel da Inbox. O campo
   `conversations` do detalhe atual permanece para os consumidores existentes
   até nova decisão; ambas as leituras usam o mesmo predicado.
9. **Eventos ao vivo.** A projeção só reage a invalidação genérica. A T03 não
   usa `inbox.order.changed` para levar dados do resumo; a política única de
   autorização desse evento fica com a C20-T17 do RFC 076.
10. **Encerramento.** C20-06 preserva o fluxo manual de CP-07 a CP-10. A
    sugestão interna de encerramento (C20-13) só entra após D05.

## Alternativas consideradas

- **Filtro `contactId` em `GET /api/v1/orders`.** Corrige a lista, mas não dá
  o agregado sob o mesmo predicado, mistura a semântica de `owner=me` e muda
  um contrato usado por outras telas. Descartada como caminho principal.
- **Reusar a apuração do dashboard com recorte por Contato.** Herda a loja e
  o ticket 0 com contagem zero, e não pagina por Contato. Descartada.
- **Read model ou projeção materializada.** Pode ser avaliada depois de medir
  os planos de consulta da T03. A primeira entrega usa consultas indexadas.
- **Novo cadastro central de clientes.** Duplicaria Contatos, carteira,
  autorização e Pedidos durante a transição, com migração e rollback mais
  caros. Descartada.

## Riscos

- **Vazamento por agregado.** Uma contagem ou soma que inclua Pedido oculto
  revela que ele existe. Mitigação: D02, predicado antes da agregação e
  regressão por papel em G02.
- **Número diferente do dashboard.** O vendedor compara o resumo com o painel
  e vê valores distintos por causa da loja. Mitigação: rótulo aprovado em D03.
- **Custo de consulta.** EXISTS aninhados por linha sem índice adequado.
  Mitigação: índice parcial e plano registrado na T03 (G06).
- **Resposta atrasada na UI.** Trocar de conversa ou perder acesso precisa
  descartar a resposta anterior (C20-04, G05).
- **Mudança de visibilidade pela fase seguinte.** Unir identidades amplia a
  visibilidade derivada do Contato. Mitigação: nenhuma associação entre linhas
  entra antes da C20-T17 e da D06 do RFC 076.

## Decisões a registrar

As decisões abaixo estão pendentes de aceite dos responsáveis. A coluna de
recomendação é a proposta deste RFC, não decisão tomada.

| ID  | Decisão e recomendação                                                                                                                                                                                                                                                                                                                              | Quem fecha                     | Bloqueia                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------ |
| D02 | ACL por recurso antes dos agregados. **Recomendação:** `orderReadable` e `contactConversationVisible` aplicados dentro de cada consulta antes de IDs, contagens, somas e cursores; Contato fora do universo responde como inexistente; papéis de C20-05 cobertos por regressão.                                                                     | Produto e Privacidade          | T03                      |
| D03 | Universo, rótulo do indicador, reconfirmado após reabertura e divergência com o dashboard. **Recomendação:** universo da apuração atual restrito ao `contact_id`; reconfirmado conta; ticket e última venda `null` com contagem zero; rótulo que diga que a loja não entra. A medição da T02 em produção alimenta esta decisão, sem bloquear a T03. | Produto e Comercial            | T03 a T06                |
| D05 | Critérios da sugestão de encerramento e priorização futura. **Recomendação:** sugestão interna, aceita por humano, sem fechamento automático; critérios definidos com o aprendizado da T06; T16 priorizada após a T14.                                                                                                                              | Produto, Operação, Privacidade | T15 e priorização de T16 |

D01, D04, D06 e D07 estão no
[RFC 076](076-identidade-do-cliente-entre-linhas.md#decisões-a-registrar).

Enquanto as decisões estiverem abertas, valem as autorizações e os
comportamentos atuais. Documentação, baseline e ensaios com dados sintéticos
podem avançar. Cada decisão aceita vira ADR com o próximo número livre na
`master` (hoje 099), vinculado a este RFC, antes da tarefa que ela bloqueia:
D02 e D03 antes da T03, D05 antes da T15.

## Rastreabilidade e próximos passos

- [Especificação e critérios de aceite](../../.specs/features/crm-20/spec.md)
- [Arquitetura e contratos propostos](../../.specs/features/crm-20/design.md)
- [Branches, dependências e ordem de merge](../../.specs/features/crm-20/tasks.md)
- [Matriz de regressão e homologação](../../.specs/features/crm-20/validation.md)
- [Pré-mortem e condições de parada](../../.specs/features/crm-20/pre-mortem.md)
- [Prompts por tarefa](../../.specs/features/crm-20/PROMPTS.md)
- Proposta em revisão no
  [PR 463](https://github.com/romulosutil/crm-silmer/pull/463).
- ADRs relacionadas: [006](../adr/006-pedido-dois-status.md),
  [027](../adr/027-venda-da-loja-do-site.md),
  [028](../adr/028-pedido-pago-da-loja-pelo-n8n.md),
  [032](../adr/032-separar-pedido-conversa-e-assunto.md),
  [033](../adr/033-telefone-no-cadastro-e-roteamento.md),
  [088](../adr/088-leitura-de-conversas-por-responsavel.md),
  [090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md) e
  [095](../adr/095-supervisao-das-linhas-pessoais.md).

Próximos passos:

1. Registrar a pendência do documento de origem acima.
2. Executar C20-T01 (baseline) e C20-T02 (inventário), que podem correr em
   paralelo. A T01 caracteriza o defeito de `ClientOrders.vue`.
3. Fechar D02 e D03 e registrar o ADR antes de abrir a T03.
4. T03 → T04/T05 → T06; ativar a leitura só após os gates da T06.
5. D05 após o aprendizado da T06; T15 e T16 seguem o plano.

# Recibo comercial do pedido

Status: aprovado pelo solicitante em 12/11/2026 para implementação.
Fontes: [RFC 068](../../../docs/rfc/068-recibo-comercial-do-pedido.md),
[ADR 089](../../../docs/adr/089-recibo-comercial-na-lista-e-no-pedido.md).

## Problem Statement

O vendedor precisa entregar ao cliente um resumo comercial simples, sem usar a
ficha da fábrica. O fluxo aprovado oferece Recibo na lista e no detalhe,
prévia e download em PDF com os dados salvos do pedido.

## Out of Scope

Recibo de pagamento, quitação, envio automático, cobrança, alteração de dados,
armazenamento do PDF, nova infraestrutura e alteração da ficha da fábrica.

## Assumptions & Open Questions

| Assumption             | Chosen default                                                                      | Rationale                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Aprovação do protótipo | Inclui resumo provisório em pendentes/reabertos e histórico cancelado identificado. | O solicitante aprovou o fluxo e pediu implementar após explorar seus estados. |
| Autorização            | Humano ativo responsável ou COMMERCIAL_ADMIN; loja/sem dono só Admin.               | Documento contém valores comerciais, sem herdar acesso amplo de impressão.    |
| Prévia                 | Modal na própria lista/detalhe, renderização Vue escapada.                          | Preserva busca, rolagem e foco sem HTML externo.                              |
| Legado                 | Total oficial conhecido é preservado; linhas sem preço ficam indisponíveis.         | Não ratear ou fabricar unitário.                                              |

Open questions: none.

## User Stories

Como vendedor responsável, quero abrir Recibo na linha do pedido ou no detalhe,
conferir os dados e baixar o PDF sem alterar a venda.

Acceptance Criteria:

1. WHEN há acesso comercial humano THEN o sistema SHALL oferecer Recibo na lista após Gerar PDF, quando existir, e antes de Abrir pedido, e uma ação no cabeçalho do detalhe, sem seção duplicada (RCP-01/12).
2. WHEN a prévia fecha THEN a interface SHALL preservar lista/filtros/rolagem e devolver foco ao acionador conectado ou a um destino previsível (RCP-02).
3. WHEN o pedido é pendente/reaberto ou cancelado THEN cada página SHALL identificar respectivamente o caráter provisório ou o cancelamento; confirmado SHALL não exibir aviso provisório (RCP-03).
4. WHEN dados ou preços estão ausentes THEN o recibo SHALL usar Não informado/A definir, sem transformar ausência em zero ou total parcial contratado (RCP-04).
5. WHEN existem preços por tamanho THEN o documento SHALL preservar quantidade, subtotal revisado e total oficial incluindo frete; unitário só existe quando exato em centavos e agrupamento não mistura preços diferentes (RCP-05).
6. WHEN o PDF é baixado THEN o sistema SHALL devolver application/pdf privado sem mudar pedido, pagamento, posse, aviso da loja ou primeira impressão da fábrica (RCP-06).
7. WHEN revisão ou qualquer dado exibido mudou após a prévia ou durante a renderização THEN a API SHALL responder 409 RECEIPT_STALE sem PDF; a interface SHALL descartar respostas/bytes de outro pedido ou geração (RCP-07).
8. WHEN sessão, perfil ou posse não autorizam o recibo THEN prévia e PDF SHALL recusar acesso direto com 401/403/404 conforme política, inclusive Financeiro/automação, e SHALL não entregar dados (RCP-08).
9. WHILE geração ou gravação do pedido está em andamento THEN a interface SHALL evitar ações concorrentes; gravação falha SHALL impedir prévia de um rascunho não salvo; erro de geração SHALL permitir repetição explícita (RCP-09).
10. WHEN o recibo é gerado THEN SHALL usar somente campos permitidos, conteúdo escapado, fontes embutidas e zero recursos externos, com ressalva fiscal/de pagamento; sucesso SHALL gerar auditoria mínima sem PII (RCP-10).
11. WHEN usado por teclado, em 320 px ou tema escuro THEN o fluxo SHALL manter controles/foco/avisos acessíveis e papel branco com texto escuro; PDF longo SHALL conservar linhas, identidade/estado em cada página e total/rodapé final (RCP-11).

## Contrato de dados e HTTP

`GET /api/v1/orders/:orderId/receipt` retorna `{receipt, fingerprint}`.
`receipt` contém somente: schema `order-receipt-v1`, orderId, number, status
(`pendente|confirmado|cancelado`), version, customerName, orderName, orderDate,
issuedAt, sellerName, deliveryOn, paymentCondition (rótulo ou null), isTest,
items (quantity, description, details, sizes, unitCents, subtotalCents),
piecesCents, freightCents e totalCents. Ausências são null/texto vazio,
valores monetários são centavos inteiros.

`GET /api/v1/orders/:orderId/receipt/pdf?expectedVersion=N&fingerprint=HEX`
revalida sessão, posse e fingerprint de todas as fontes exibidas antes e após
renderizar. O fingerprint HMAC usa chave efêmera do runtime, sem configuração
ou persistência nova; reiniciar exige atualizar a prévia. issuedAt é a data
de emissão do documento, não entra na comparação de conteúdo comercial.
HEAD valida mas não renderiza ou audita download. Ambas as rotas retornam
`Cache-Control: private, no-store`. PDF tem nome `recibo-NN-CRM.pdf`, com
sufixo `-provisorio` ou `-cancelado` conforme estado. Sem query com PII.

Erros: 400 entrada inválida, 401/403 sessão/ACL, 404 pedido ausente,
409 RECEIPT_STALE, 429 limite, 503 render indisponível. Falha/HEAD não audita.
Auditoria `order.receipt.download`: ator, pedido, revisão, correlação e ação.

## Requirement Traceability

| ID     | Tarefa | Status       |
| ------ | ------ | ------------ |
| RCP-01 | T4     | implementing |
| RCP-02 | T4     | implementing |
| RCP-03 | T2     | implementing |
| RCP-04 | T2     | implementing |
| RCP-05 | T2     | implementing |
| RCP-06 | T3     | implementing |
| RCP-07 | T3, T4 | implementing |
| RCP-08 | T3, T4 | implementing |
| RCP-09 | T4     | implementing |
| RCP-10 | T2, T3 | implementing |
| RCP-11 | T2, T4 | implementing |
| RCP-12 | T4     | implementing |

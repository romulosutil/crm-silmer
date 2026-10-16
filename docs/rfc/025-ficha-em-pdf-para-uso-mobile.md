# RFC 025 — Ficha em PDF para uso no celular

Status: decidida em 16/10/2026 na [ADR 037](../adr/037-gerar-pdf-da-ficha-para-uso-mobile.md).

Requisitos: [PIM-13, PIM-14 e LOJ-38](../../.specs/features/pedidos-mvp/spec.md).
Tarefa: [T134](../../.specs/features/pedidos-mvp/tasks.md).
Origem: pedido do PO para trocar a ação “Imprimir ficha” por “Gerar PDF”, com possibilidade de encaminhar o arquivo pelo WhatsApp no celular. Issues e PRs relacionados serão ligados à tarefa.

## Contexto

A API entrega HTML imprimível e o download da loja salva `.html`. No celular, a operação precisa de um PDF real que possa ser guardado ou compartilhado. Os templates v6 e loja v1 já definem a folha aprovada e não devem ser redesenhados nesta mudança.

## Opções

1. Renomear o botão e manter a janela de impressão: o resultado depende da opção “Salvar como PDF” do navegador e não entrega um arquivo ao CRM para compartilhar.
2. Montar outro PDF com uma biblioteca de desenho: duplica o layout aprovado e cria divergência entre a ficha impressa e a baixada.
3. Renderizar o HTML existente em Chromium no próprio runtime da API: preserva a folha, entrega `application/pdf` e mantém a autorização atual. A imagem cresce e a geração consome CPU; limite de concorrência e taxa são necessários.

## Proposta decidida

Adicionar `GET /api/v1/orders/{orderId}/pdf`, com a permissão `order.print`, somente para Pedido confirmado. O PDF é anexo privado `pedido-NN-CRM.pdf`, sem cache, gerado a partir do mesmo renderer do HTML. A rota HTML continua para compatibilidade. A interface baixa o PDF e, onde houver Web Share API com arquivos, oferece “Compartilhar PDF” para o usuário escolher o WhatsApp ou outro destino. Não existe envio automático nem link público. Para pedido da loja, apenas uma geração bem-sucedida conta como o primeiro acesso à ficha; `HEAD`, falha e acesso recusado não retiram o pedido do aviso.

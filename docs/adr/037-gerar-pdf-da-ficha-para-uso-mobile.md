# ADR 037 — Gerar PDF da ficha para uso no celular

Status: aceita em 16/10/2026 para o CRM.

RFC: [025](../rfc/025-ficha-em-pdf-para-uso-mobile.md).
Requisitos: [PIM-13, PIM-14 e LOJ-38](../../.specs/features/pedidos-mvp/spec.md).
Tarefa: [T134](../../.specs/features/pedidos-mvp/tasks.md).
Relacionados: [ADR 017](017-ficha-impressa-com-os-sete-pontos.md), [ADR 025](025-itens-por-publico.md), [ADR 031](031-aviso-de-pedido-novo-do-site.md), [TECHNICAL-DESIGN.md](../../TECHNICAL-DESIGN.md). Issues e PRs serão ligados à tarefa.

## Contexto

O HTML imprimível exige a ação de impressão do navegador para salvar um PDF. O download da loja é um arquivo HTML. O PO pediu um botão de geração de PDF para a operação no celular, com encaminhamento possível pelo WhatsApp.

## Decisão

1. A API oferece `GET /api/v1/orders/{orderId}/pdf` a qualquer usuário operacional com `order.print`, só para Pedido confirmado. O retorno é `application/pdf`, anexo `pedido-NN-CRM.pdf`, privado e sem cache.
2. O PDF é renderizado do HTML do template vigente (`ficha-canonical-v6` ou `ficha-loja-v1`) em Chromium dentro do runtime atual. O processo não executa JavaScript nem acessa recursos externos. Há limite de duas renderizações simultâneas e de dez requisições por minuto na rota. A geração não grava o PDF no servidor.
3. “Gerar PDF” baixa o arquivo. No celular compatível, “Compartilhar PDF” abre a folha nativa de compartilhamento com o próprio arquivo; a pessoa escolhe o WhatsApp. Falha de compartilhamento baixa o arquivo. Não há disparo automático para um destinatário ou URL pública.
4. A primeira geração bem-sucedida de PDF de um Pedido da loja usa o registro idempotente de primeira impressão da [ADR 031](031-aviso-de-pedido-novo-do-site.md). `HEAD`, erro de renderização e acesso negado não registram. Os campos e eventos internos mantêm os nomes existentes para não alterar a migração e a auditoria. A rota HTML permanece para compatibilidade e continua contando como primeiro acesso.

## Consequências

A imagem de runtime passa a incluir o Chromium headless correspondente à versão de Playwright. Os templates e hashes de revisão continuam intactos. A assinatura física da v6 ainda é o gate para produção. Monitorar tempo e falhas de renderização no piloto; se o navegador não oferecer compartilhamento de arquivo, a baixa do PDF continua disponível.

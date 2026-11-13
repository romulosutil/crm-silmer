# ADR 089 — Recibo comercial na lista e no pedido

Status: aceita pelo solicitante em 12/11/2026, após aprovação do protótipo.
RFC: [068](../rfc/068-recibo-comercial-do-pedido.md).
Requisitos/tarefas: [RCP-01–12](../../.specs/features/order-receipt/spec.md),
[RCP-T01–04](../../.specs/features/order-receipt/tasks.md). PR #375;
sem issue específica. [PR](https://github.com/romulosutil/crm-silmer/pull/375).

## Decisão

1. O CRM oferece Recibo na linha da lista, após Gerar PDF quando disponível e
   antes de Abrir pedido, e uma ação no cabeçalho do detalhe. A mesma prévia
   local permite conferir e baixar PDF, preservando origem, filtro e foco.
2. O documento é um resumo comercial, sem valor fiscal ou prova de pagamento.
   Usa somente campos permitidos do pedido, sem telefone, cadastro fiscal,
   notas internas, dados de cobrança ou arquivos de arte.
3. A partir de um pedido salvo, permite documento provisório em pendente ou
   reaberto; confirmado remove o aviso provisório; cancelado é histórico com
   marca de cancelamento em todas as páginas. Esta é uma extensão restrita
   às regras 9/10: os bloqueios da ficha da fábrica continuam integrais.
4. Exige humano ativo com acesso comercial: responsável atual ou Admin; loja e
   pedido sem responsável só Admin. Permissão de imprimir, perfil Financeiro,
   automação e checkbox Olist não concedem acesso.
5. Preços/quantidades/frete vêm das fontes oficiais. Ausência não vira zero;
   legado conserva total sem rateio. Unitário só aparece quando representável
   em centavos exatos. Preço não revisado não compõe total contratado.
6. Prévia/PDF são leituras privadas sem cache e sem persistir o arquivo. A API
   verifica sessão/posse e fingerprint do conteúdo antes e após renderizar;
   mudança exige atualizar a prévia. Sucesso audita só ator/pedido/revisão/ação.
   Não registra primeira impressão da loja ou muda dados comerciais.
7. Reutiliza monólito, Chromium e fontes existentes. A5 retrato, papel branco
   com texto escuro, continuação identificada para pedidos longos. Nenhum
   framework, serviço, dependência, migração ou envio automático novo.

## Alternativas e consequências

Reutilizar a ficha da fábrica foi rejeitado: conteúdo, autorização e efeitos
de primeira impressão são distintos. Apenas confirmados foi rejeitado pela
disponibilidade solicitada; o aviso provisório evita afirmar venda confirmada.
Modal na própria tela preserva a navegação melhor que uma rota nova. O PDF é
um retrato da versão baixada; nova edição não modifica cópias já entregues.
Reinício do runtime invalida fingerprints e pede atualizar a prévia.

Publicação segue os gates do CI/PR. A aprovação de implementar não comprova
implantação, saúde ou homologação do ambiente de produção.

# ADR 093 — Ficha de pedido para impressão

Data: 18/11/2026. Status: aceita para implementação e revisão.
Proposta: [RFC 070](../rfc/070-ficha-de-pedido-para-impressao.md).
Requisitos: [FPI-14 a FPI-16](../../.specs/features/ficha-por-item/spec.md).
Entrega: [FPI-T07](../../.specs/features/ficha-por-item/tasks.md).

Adotar **PDF para impressão** como ação principal no detalhe de pedidos
confirmados de atendimento. A ação pede `layout=impressao` no endpoint de PDF
e baixa um arquivo com o sufixo `-impressao.pdf`. O menu **Mais ações do
pedido** oferece o **PDF detalhado**. O download detalhado e **Compartilhar
PDF** usam o template definido na ADR 087.

O segundo PDF usa o mesmo snapshot e as mesmas instruções de fábrica.
A composição é por pedido, em A4 paisagem, com linha por tamanho e um
controle de produção compacto por item. O Chromium pagina a tabela e repete
seus cabeçalhos. O PDF para impressão inclui apenas a referência textual da
estampa. A rota HTML e a ficha da loja seguem os contratos atuais.

A amostra sintética exige revisão em papel com Rose e Operação antes da
publicação em produção. O rollback é reverter a entrega da opção. Nenhum dado
persistido depende do layout.

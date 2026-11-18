# RFC 070 — Ficha de pedido para impressão

Data: 18/11/2026. Decisão: [ADR 093](../adr/093-ficha-de-pedido-para-impressao.md).
Requisitos: [FPI-14 a FPI-16](../../.specs/features/ficha-por-item/spec.md).
Entrega: [FPI-T07](../../.specs/features/ficha-por-item/tasks.md).

A ficha detalhada dedica duas páginas a cada item. Para a rotina em papel,
o solicitante apresentou a amostra sintética v1, com cabeçalho por pedido e
uma linha de grade por tamanho. O PDF para impressão é a ação principal no
detalhe do pedido. O PDF detalhado fica em **Mais ações do pedido**.

O PDF para impressão usa A4 paisagem. A tabela reúne os itens e seus tamanhos
com especificações na primeira linha de cada item, quantidades conferíveis à
mão e total de peças. O documento imprime as observações uma vez e reúne os
campos de produção em uma tabela curta. As imagens ficam na ficha detalhada.
O texto e as linhas da grade podem ocupar páginas adicionais conforme o conteúdo.

O mesmo endpoint de PDF aceita uma seleção explícita de layout. As duas
opções usam as regras de acesso, confirmação e conteúdo de fábrica existentes.
A ficha simplificada da loja segue o fluxo atual.

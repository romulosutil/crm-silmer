# RFC 076 — Catálogo compartilhado de opções do pedido

Proposta aprovada pelo PO em 27/11/2026 na prévia da página real do Pedido.
Decisão registrada na [ADR 100](../adr/100-opcoes-compartilhadas-da-ficha-do-pedido.md).
Complementa a [RFC 005](005-catalogo-de-opcoes-do-pedido.md) na primeira etapa de
[PFI-14 e EDIT-06](../../.specs/features/pedidos-mvp/spec.md).

A primeira etapa cobre Cor geral, quatro cores por parte, Modelo de malha e
Tamanho. As cinco cores usam a mesma lista pesquisável. Cada seletor permite
adicionar uma opção explícita, que pode ser escolhida em pedidos seguintes.
Poliéster inclui as grafias com 100%. All Star inclui Allstar e All Star
Corrida. Elastano e demais composições explicitamente distintas conservam seus
rótulos. A colagem de grades, a seleção de várias malhas e o estado Não
aplicável das mangas continuam disponíveis.

O catálogo comercial completo da RFC 005 envolve combinações, fornecedores,
preços e automação. Nesta etapa, o objeto da aprovação é o preenchimento humano
da ficha. As opções adicionadas passam por validação e deduplicação na API. A
gravação automática de valores históricos foi descartada devido a ambiguidades
operacionais e ao risco de incorporar texto de cliente ao catálogo.

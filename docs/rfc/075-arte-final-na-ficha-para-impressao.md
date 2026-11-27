# RFC 075 — Arte final na ficha para impressão

Data: 26/11/2026. Decisão: [ADR 099](../adr/099-arte-final-na-ficha-para-impressao.md).
Requisito e entrega: [FPI-15](../../.specs/features/ficha-por-item/spec.md) e
[FPI-T08](../../.specs/features/ficha-por-item/tasks.md).

A produção precisa conferir a arte aprovada na mesma ficha que lista a grade
do pedido. A prévia aprovada pelo solicitante mostra uma linha de controle
para o pedido inteiro, com os campos de responsável, data e observação, e a
arte logo abaixo. A grade e o formato A4 paisagem seguem a ADR 093.

O campo **Arte final** do pedido identifica a versão destinada à produção
segundo PED-RD-10. A API usa apenas esse arquivo e lê o conteúdo pelo fluxo
privado existente. Imagens PNG, JPEG e WebP entram com suas proporções. O PDF
da arte recebe prévias rasterizadas em ordem. Arquivos nativos de design e
compactados seguem disponíveis no pedido, com aviso na ficha.

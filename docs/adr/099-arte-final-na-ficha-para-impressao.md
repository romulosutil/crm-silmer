# ADR 099 — Arte final na ficha para impressão

Data: 26/11/2026. Status: aceita. Proposta:
[RFC 075](../rfc/075-arte-final-na-ficha-para-impressao.md).
Requisito e entrega: [FPI-15](../../.specs/features/ficha-por-item/spec.md) e
[FPI-T08](../../.specs/features/ficha-por-item/tasks.md).

O layout `impressao` da [ADR 093](093-ficha-de-pedido-para-impressao.md)
passa a usar uma linha de controle por pedido e a mostrar logo abaixo o
arquivo cadastrado em **Arte final**, conforme PED-RD-10. A leitura usa a
autorização do pedido e a auditoria do download da [ADR 023](023-arquivos-da-arte-no-rustfs.md).
A API revalida acesso, confirmação e versão após a renderização. `HEAD` só
verifica o documento e suas guardas, sem abrir o arquivo.

Imagens PNG, JPEG e WebP são incorporadas localmente. Para PDF, o `pdftoppm`
do runtime rasteriza até quatro páginas para o documento, mantendo a
primeira com o controle e colocando as demais em folhas de continuação.
Uma leitura adicional detecta quando há outras páginas e indica onde abrir o
original. A conversão usa entrada e saída em memória, com tamanho, tempo e
concorrência limitados. O Chromium recebe somente imagens raster locais.

O PDF informa quando não há arte, o pedido é sem estampa, a leitura falha ou
o formato deve ser aberto no pedido. A ficha detalhada, o compartilhamento e
a loja continuam em seus fluxos atuais. O rollback é reverter FPI-T08 pela
PR, pois o layout e a conversão não modificam dados persistidos.

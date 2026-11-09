# Prévia de ficha por item

Proposta isolada, com dados sintéticos, sem acesso a API, banco ou provedor.
O seletor oficial `PRINT_TEMPLATE` e os pacotes v2–v6 permanecem intactos.

Gerar o HTML com as dependências existentes:

```powershell
node scripts/ficha-por-item-preview.mjs
```

Abrir `docs/prototypes/ficha-por-item/index.html` diretamente no navegador.
O arquivo incorpora fonte e estilos. A barra permite comparar orientações
e escolher o item da prévia; a impressão sempre inclui todos os itens.

Gerar PDFs com Playwright/Chromium instalado, inclusive no worker Mel:

```bash
node scripts/ficha-por-item-capture.mjs docs/prototypes/ficha-por-item/index.html output/pdf/ficha-por-item-proposta-2026-11-09
```

O script valida encaixe, fonte e os 14 campos. O último caso altera somente
o DOM de teste para confirmar que notas longas são detectadas; não gera
um PDF truncado desse caso.

Dados ilustrativos em `sample.json`; composição e fronteiras em
[DESIGN.md](DESIGN.md). A aprovação do desenho não declara implementação
da ficha v7, integração Olist ou cobrança InfinitePay.

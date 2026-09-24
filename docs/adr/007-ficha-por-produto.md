# ADR 007 — Ficha do pedido definida pelo produto

Status: aceito

Data: 24/09/2026

Decisores: PO, em sessão de design de 24/09/2026.

## Contexto

A ficha do pedido tinha os mesmos campos para qualquer peça: uma bermuda
imprimia "NÃO APLICÁVEL" em mangas e gola, e bonés e bandeiras não tinham onde
registrar regulagem, faces ou fixação. A Silmer aprovou um catálogo de opções
na planilha `005-lista-de-opcoes-para-aprovacao.xlsx` (linhas "Manter"), mas o
sistema usava listas copiadas à mão. O módulo `modules/catalog` pertence ao
runtime comercial de Negócio (ADR 004) e não guarda regra por campo.

## Decisão

- O produto do item define quais campos existem, com que rótulo e com quais
  sugestões. Regras por produto: Sim, Opcional, Não.
- O catálogo é gerado da planilha aprovada por
  `scripts/import-order-catalog.mjs` e versionado em git como
  `modules/orders/src/catalog/order-catalog.data.js`. O sistema não lê o
  Google Sheets em tempo de execução nem usa `modules/catalog`.
- Backend e frontend usam o mesmo resolvedor puro
  (`modules/orders/src/catalog/index.js`).
- Campos novos do item ficam em `specs`, `escala` e `outras` dentro do
  `ficha_envelope`, sem migration.
- "Sim" entra no banner de faltantes e não bloqueia a confirmação (A01).
- A ficha impressa ganha `ficha-canonical-v3`. A troca de template é um commit
  próprio, depois da aprovação de Rose e Operação registrada em
  `docs/phase0/ficha-pdf-approval-v3.json`.

## Consequências

- Supersede D10 e D15 da feature Pedidos MVP depois da aprovação da v3, e D11
  apenas para "locais da aplicação", que passam a ser campo do item e saem
  impressos.
- Mudar o catálogo é: editar a planilha, rodar o script, fazer commit e deploy.
- Um catálogo editável pela operação (tabelas no PostgreSQL) fica para uma
  decisão futura; o modelo relacional está em
  `.specs/features/ficha-por-produto/design.md`.

Decide o primeiro incremento da [RFC 005](../rfc/005-catalogo-de-opcoes-do-pedido.md)
(Opção A): produto filtra campos e opções, catálogo versionado, tamanhos por
produto. Códigos gravados, aliases, compatibilidades entre opções e preço
continuam propostos na RFC 005, para o ADR da estrutura final.

Links: [spec](../../.specs/features/ficha-por-produto/spec.md) ·
[design](../../.specs/features/ficha-por-produto/design.md) ·
[ADR 006](006-pedido-dois-status.md)

# ADR 035 — Fundação visual whitelabel e mobile-first

Status: aceita em 15/10/2026 pelo PO, depois de ver a fundação rodando no
celular.

RFC: [022](../rfc/022-fundacao-visual-whitelabel.md).
Evidência: [pesquisa com usuários sintéticos](../product/pesquisa-ux-sintetica-2026-10-15.md).
Tarefa: DS-T01 — fundação visual.
Relacionados: [ADR 001](001-adotar-vue-no-frontend.md),
[design.md](../../design.md), [PRODUCT.md](../../PRODUCT.md).

## Contexto

O CRM acumulou carga cognitiva (cabeçalhos enormes, rótulos minúsculos em
caixa alta, laranja em toda linha), inconsistência entre telas e uma marca
escrita à mão nos tokens. O produto vai virar whitelabel com a Silmer como
piloto, e os vendedores trabalham pelo celular o tempo todo.

## Decisão

1. **Tokens em três camadas** em `apps/edge-web/src/tokens.css`: entradas de
   marca (`--brand-*`), papéis semânticos derivados com `color-mix()` e tokens
   de componente. Uma empresa troca só as entradas de marca; cores de estado
   são do produto e não mudam por empresa.
2. **Identidade fora dos componentes** em `apps/edge-web/src/brand/index.js`
   (nome, produto, slogan, logotipo). O logotipo oficial é desenhado por
   `BrandMark.vue`; nenhum componente escreve o nome da empresa.
3. **Mobile-first**: cada tela é desenhada primeiro para 390×844. No celular a
   navegação é uma barra inferior fixa (Início, Caixa, Pedidos, Clientes, Mais)
   com folha "Mais"; alvos ≥ 44 px e campos de 16 px. No desktop, sidebar no
   canvas e trabalho num painel inset; no tablet, rail de ícones.
4. **Regras de interface**: uma ação primária por região, seleção neutra
   (nunca na cor primária), piso de 13 px, rótulos em caixa normal, sem
   eyebrow, títulos com foco programático sem anel.
5. **ReUI como referência, não dependência**: o projeto segue Vue 3 + CSS
   (ADR 001); a anatomia do ReUI orienta shell, tokens e componentes.

## Consequências

- Todas as telas herdam o novo visual sem mudar rota, API ou dados.
- `scripts/check-design-tokens.mjs` exige a camada de marca.
- Telas existentes precisam de um ciclo próprio para virar mobile-first de
  verdade (Caixa de Entrada, Painel e Pedidos já estão em andamento).
- Configurar outra empresa em runtime (sem editar código) fica para quando
  houver tela de configuração; até lá, troca-se `brand/index.js` e os
  `--brand-*`.

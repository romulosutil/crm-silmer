# Request for Comments

Esta pasta contém propostas de mudanças significativas que ainda precisam de
avaliação e decisão.

## Convenção

- Nomeie os arquivos como `NNN-titulo-em-kebab-case.md`.
- Use numeração sequencial com três dígitos, começando em `001`.
- Escreva o RFC em português, salvo quando houver motivo técnico para manter
  um termo em inglês.
- Inclua contexto, responsável pela proposta, aprovadores, impacto,
  premissas, critérios de decisão, opções, recomendação, ações e resultado.
- Mantenha o RFC editável durante a revisão e registre a decisão final no
  próprio documento; depois, crie o ADR correspondente quando houver uma
  decisão arquitetural durável.

## Quando usar

Use um RFC antes de comprometer arquitetura, processo, produto ou ferramenta
em uma mudança relevante. Depois da decisão, atualize o status do RFC e, se a
decisão for arquitetural, crie um ADR em [`../adr/`](../adr/) com o vínculo
entre os documentos.

## Decisões operacionais de 05/10/2026

- [009 — OpenAI no MVP](009-openai-no-mvp.md), decidida na ADR 021.
- [010 — Deploy automático GitHub → EasyPanel](010-deploy-automatico-github-easypanel.md), decidida na ADR 022.
- [011 — Arquivos da arte do pedido no RustFS](011-arquivos-da-arte-no-rustfs.md), decidida na ADR 023.

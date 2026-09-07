# Architecture Decision Records

Esta pasta contém as decisões arquiteturais já tomadas no CRM Silmer.

## Convenção

- Nomeie os arquivos como `NNN-titulo-em-kebab-case.md`.
- Use numeração sequencial com três dígitos, começando em `001`.
- Escreva o ADR em português, salvo quando houver motivo técnico para manter
  um termo em inglês.
- Inclua data, status, decisores, contexto, decisão, consequências e links
  para RFCs, requisitos, issues e PRs relacionados.
- ADR é registro histórico: não reescreva uma decisão aceita. Quando ela
  mudar, crie um novo ADR e marque o anterior como superseded.

## Quando usar

Crie um ADR depois que a decisão arquitetural estiver tomada ou em fase final
de formalização. Para uma proposta que ainda precisa de avaliação e aprovação,
use [`../rfc/`](../rfc/) primeiro.

O ADR não substitui `ARCHITECTURE.md`, `TECHNICAL-DESIGN.md` nem os requisitos
canônicos; ele registra o contexto e o motivo da escolha.

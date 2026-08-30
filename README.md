# CRM Silmer

CRM web próprio da Silmer para organizar conversas comerciais, qualificação,
vendas, PIX e geração da Ficha de Pedido. O produto substituirá integralmente o
Datacrazy; o piloto começa pela API oficial do WhatsApp Business.

> **Estado atual:** o bootstrap do runtime (`T00.1`), a supply chain de CI e
> imagens imutáveis (`T00.2`) e o kit local/offline de topologia (`T00.3`) estão disponíveis; as demais tarefas da Fase 0 permanecem guiadas por
> [`.specs/features/crm-mvp/tasks.md`](.specs/features/crm-mvp/tasks.md).

## Comece por aqui

Leia nesta ordem antes de implementar:

1. [`ABOUT.md`](ABOUT.md) — visão curta e mapa dos documentos.
2. [`RULES.md`](RULES.md) — invariantes de produto e implementação.
3. [`CRM-MVP-ESPECIFICACAO.md`](CRM-MVP-ESPECIFICACAO.md) — PRD canônico.
4. [`.specs/features/crm-mvp/spec.md`](.specs/features/crm-mvp/spec.md) — requisitos e critérios rastreáveis.
5. [`ARCHITECTURE.md`](ARCHITECTURE.md) — fronteiras e decisões do MVP.
6. [`TECHNICAL-DESIGN.md`](TECHNICAL-DESIGN.md) — desenho técnico completo.
7. [`.specs/features/crm-mvp/tasks.md`](.specs/features/crm-mvp/tasks.md) — ordem de implementação e gates.

Para trabalho assistido por IA, leia também [`AGENTS.md`](AGENTS.md) e
[`CODEX.md`](CODEX.md). Material em `historico-datacrazy/` é apenas arquivo
histórico e não define o sistema novo.

## Stack aprovada

- Frontend: HTML semântico, CSS e JavaScript vanilla.
- Runtime: monólito modular em JavaScript ESM, Node.js e Fastify.
- Dados: PostgreSQL com SQL e migrações versionadas.
- Processos: `edge-web`, `api` e `worker` no mesmo repositório.
- Integrações: ports/adapters para Meta, IA e storage S3-compatible.

Framework de frontend, Redis, microserviços, n8n no caminho crítico e estado de
domínio em `window` estão fora da baseline do MVP.

## Desenvolvimento

Pré-requisitos fixados: Node.js `24.14.0` e npm `11.9.0`. Instale e execute os
gates oficiais a partir da raiz:

```powershell
npm ci
npm run validate
npm run test:e2e
npm audit --audit-level=high
```

Comandos individuais: `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run check:boundaries`, `npm test` e
`npm run build`. O build determinístico é escrito em `dist/` e inclui um
manifesto SHA-256 sem timestamps.

O contrato local de `T00.3` fica em `ops/easypanel/topology.json` e
`ops/recovery/off-host-kit.json`. Execute `npm run validate:topology`,
`npm run test:recovery:mocks` e `npm run recovery:plan` para validar e gerar o
plano sem rede. Provisionamento, DNS, escrow, restore e drills reais continuam
externos e não são executados por esses comandos.

O contrato de build único, publicação por SHA/digest, SBOM, provenance, scan e
promoção manual está em [`docs/phase0/SUPPLY-CHAIN.md`](docs/phase0/SUPPLY-CHAIN.md).

Os processos executáveis ficam em `apps/api` e `apps/worker`; o frontend
estático e vanilla fica em `apps/edge-web`. Contratos compartilhados começam em
`modules/shared`.

Toda contribuição segue [`CONTRIBUTING.md`](CONTRIBUTING.md), mantém vínculo com
um requisito/tarefa e termina com validação, commit, push e atualização do
Graphify.

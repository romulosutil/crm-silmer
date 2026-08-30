# CRM Silmer

CRM web próprio da Silmer para organizar conversas comerciais, qualificação,
vendas, PIX e geração da Ficha de Pedido. O produto substituirá integralmente o
Datacrazy; o piloto começa pela API oficial do WhatsApp Business.

> **Estado atual:** fundação e planejamento técnico concluídos. O runtime ainda
> não foi criado; o próximo item executável é `T00.1` em
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

O bootstrap de código, scripts e dependências pertence ao item `T00.1`. Até ele
ser concluído, não há comando de instalação ou execução válido para documentar.
Quando os scripts existirem, este README deve expor apenas comandos reais do
`package.json` e o fluxo completo de desenvolvimento local.

Toda contribuição segue [`CONTRIBUTING.md`](CONTRIBUTING.md), mantém vínculo com
um requisito/tarefa e termina com validação, commit, push e atualização do
Graphify.

# CRM Silmer

CRM web próprio da Silmer para organizar conversas comerciais, qualificação,
vendas, PIX e geração da Ficha de Pedido. O produto substituirá integralmente o
Datacrazy; WhatsApp Business e Instagram Direct são canais obrigatórios do
piloto e disparam a mesma jornada no n8n.

> **Estado atual:** o bootstrap do runtime (`T00.1`), a supply chain de CI e
> imagens imutáveis (`T00.2`) e a decisão operacional e o gate de provisionamento
> (`T00.3`) estão disponíveis; as demais tarefas da Fase 0 permanecem guiadas por
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

- Frontend: Vue 3, Vue Router, JavaScript ESM e CSS; bundle estático com Vite.
- Runtime: monólito modular em JavaScript ESM, Node.js e Fastify.
- Dados: PostgreSQL com SQL e migrações versionadas.
- Processos do CRM: `edge-web`, `api` e `worker` no mesmo repositório.
- Automação: n8n obrigatório para WhatsApp, Instagram, OpenAI/Gemini e jornada,
  sempre por APIs do CRM e sem acesso direto ao banco.
- Integrações: contratos canônicos entre n8n e CRM; mídia transitória em volume
  privado da VPS, arquivos válidos no processo operacional Dropbox e storage
  S3-compatible diferido para a issue `#29`.

Pinia/Nuxt, outros frameworks de frontend, Redis, microserviços adicionais e
estado de domínio em `window` estão fora da baseline do MVP. A adoção de Vue
está registrada em [`docs/adr/001-adotar-vue-no-frontend.md`](docs/adr/001-adotar-vue-no-frontend.md).

## Desenvolvimento

Pré-requisitos fixados: Node.js `24.20.0` e npm `11.19.0`. Instale e execute os
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

### Ambiente local com atualização automática

Com Docker Desktop em execução, inicie tudo com:

```powershell
npm run dev
```

O comando sobe um PostgreSQL local persistente, espera a disponibilidade,
aplica as migrations, faz o build inicial, observa `apps/edge-web/src` e
reconstrói o frontend quando ele muda. Também inicia a API com o watcher nativo
do Node, que reinicia o processo ao mudar código carregado pela API. A aplicação fica em
`http://127.0.0.1:4173` e encaminha chamadas `/api/*` para a API local em
`http://127.0.0.1:3000`, preservando cookies e o mesmo origin.

O banco de desenvolvimento fica em um volume Docker nomeado. Para parar apenas
os containers, preservando os dados locais, use `npm run dev:down`. Um
`DATABASE_URL` exportado substitui o banco Docker gerenciado. Os valores de
porta/origem podem ser ajustados somente para a sessão atual com `API_HOST`,
`API_PORT`, `DEV_HOST`, `DEV_PORT` e `API_ORIGIN`. Esse fluxo é exclusivamente
local: não substitui `npm run build`, imagens por digest nem a promoção manual
dos ambientes operacionais.

No modo local, o comando gera em memória chaves de autenticação efêmeras e
aceita HTTP exclusivamente em `localhost`, `127.0.0.1` ou `::1`. Produção e
qualquer origem não local continuam exigindo HTTPS e segredos configurados.

Na primeira execução, o ambiente também cria contas sintéticas locais por meio
da API de identidade. Todas usam a senha `Desenvolvimento!2026`:

| Perfil                          | E-mail                                 | Função operacional | Capacidade adicional         |
| ------------------------------- | -------------------------------------- | ------------------ | ---------------------------- |
| Admin comercial                 | `admin@crm-silmer.local`               | Atendimento        | `COMMERCIAL_ADMIN`           |
| Atendimento                     | `atendimento@crm-silmer.local`         | Atendimento        | —                            |
| Vendedor                        | `vendedor@crm-silmer.local`            | Vendedor           | —                            |
| Encarregado de privacidade      | `privacidade@crm-silmer.local`         | Atendimento        | `PRIVACY_OFFICER`            |
| Executor técnico de privacidade | `privacidade-tecnica@crm-silmer.local` | Atendimento        | `TECHNICAL_PRIVACY_EXECUTOR` |

Essas credenciais são exclusivamente para o PostgreSQL local iniciado por
`npm run dev`; não são usadas nem aceitas em ambiente operacional. O seed é
idempotente e preserva contas existentes ao reiniciar o comando.

O contrato de `T00.3` fica em `ops/easypanel/topology.json`,
`ops/easypanel/provisioning-gate.json` e `ops/recovery/off-host-kit.json`.
Execute `npm run validate:topology`,
`npm run test:recovery:mocks` e `npm run recovery:plan` para validar e gerar o
plano sem rede. DNS, segredos, escrow, backup, restore e drills reais continuam
externos e não são executados por esses comandos.

O contrato de build único, publicação por SHA/digest, SBOM, provenance, scan e
promoção manual está em [`docs/phase0/SUPPLY-CHAIN.md`](docs/phase0/SUPPLY-CHAIN.md).

Os spikes locais de providers, a matriz de efeitos e o envelope provisório de
carga de `T00.4` estão em
[`docs/phase0/EXTERNAL-SPIKES.md`](docs/phase0/EXTERNAL-SPIKES.md). Execute
`npm run validate:external-spikes` e `npm run test:external-spikes`; aprovações
humanas e provas live continuam externas e não são simuladas por esses gates.
O runbook não produtivo do WhatsApp está em
[`docs/phase0/META-SANDBOX.md`](docs/phase0/META-SANDBOX.md).

O threat model e o catálogo de dados de `T00.5` estão em
[`docs/phase0/THREAT-MODEL-AND-DATA-CATALOG.md`](docs/phase0/THREAT-MODEL-AND-DATA-CATALOG.md).
Execute `npm run validate:security-catalog` e
`npm run test:security-catalog`; as revisões de Tech Lead e do Responsável de
Privacidade permanecem explicitamente pendentes.

O gate de defaults e papéis de `T00.6` está em
[`docs/phase0/PHASE-0-APPROVAL-GATE.md`](docs/phase0/PHASE-0-APPROVAL-GATE.md).
Execute `npm run validate:phase0-decisions` e
`npm run test:phase0-decisions`; T02, T03 e T05 permanecem bloqueadas até as
aprovações e designações humanas.

Os controles locais de observabilidade e hardening de `T00.7` estão em
[`docs/phase0/OBSERVABILITY-AND-HARDENING.md`](docs/phase0/OBSERVABILITY-AND-HARDENING.md).
Execute `npm run validate:observability` e `npm run test:observability`; ativação
do monitor externo e os drills permanecem explicitamente pendentes.

Os processos executáveis ficam em `apps/api` e `apps/worker`; a SPA Vue
compilada como assets estáticos fica em `apps/edge-web`. Contratos compartilhados começam em
`modules/shared`.

Toda contribuição segue [`CONTRIBUTING.md`](CONTRIBUTING.md), mantém vínculo com
um requisito/tarefa e termina com validação, commit, push e atualização do
Graphify.

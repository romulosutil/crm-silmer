# Graph Report - crm-silmer  (2026-08-30)

## Corpus Check
- 79 files · ~47,834 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 702 nodes · 745 edges · 67 communities (61 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b0c51936`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Technical Strategy and MVP
- Design System and UX
- Fase 0 — Fundação e riscos técnicos
- CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)
- Passagem de Produto para Tech Lead
- MVP Product Specification
- Infrastructure and Deployment
- CRM-MVP-ESPECIFICACAO.md
- CRM Silmer MVP — Requisitos Rastreáveis
- scripts
- Product Context and Scope
- compilerOptions
- validate-topology.mjs
- Fase 5 — Orçamento, PIX, Pedido e Ficha
- api/package.json
- validate-security-catalog.mjs
- README.md
- Arquitetura — Decisões do MVP
- Contribuindo com o CRM Silmer
- T00.4 — Spikes externos
- T00.5 — Threat model e catálogo de dados
- TECHNICAL-DESIGN.md
- Codex — Contexto do CRM Silmer
- CRM Silmer
- Agentes do CRM Silmer
- Legacy Qualification Flow
- openai-suggestion-schema.json
- devDependencies
- observability.test.js
- worker/package.json
- shared/package.json
- build.mjs
- edge-web/package.json
- check-boundaries.mjs
- validate-phase0-decisions.mjs
- bootstrap.test.js
- .prettierrc.json
- edge-web/src/app.js
- eslint.config.js
- T00.6 — Gate de aprovação da Fase 0
- serve-edge.mjs
- ci-images.test.js
- Runbook de recovery off-host — T00.3
- signature
- validate-external-spikes.mjs
- Fase 2 — Caixa de Entrada, canais e confiabilidade
- Supply chain da Fase 0
- Fase 1 — Identidade, acesso e infraestrutura de domínio
- Fase 3 — Negócio, Kanban e qualificação
- Fase 6 — Privacidade, relatórios e operação
- Fase 4 — Vendedor Silmer assistivo
- Fase 7 — Hardening, UAT e piloto
- CRM Silmer MVP — Plano de Implementação
- alerts.json
- T00.7 — Observabilidade e hardening mínimos
- Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?
- Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?
- Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?
- Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?
- Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?
- Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?
- Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?
- Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?
- Q: Como o P0.7 modela Admin, Atendimento e Vendedor?
- Q: Where are the agent roles and contribution protocol defined?

## God Nodes (most connected - your core abstractions)
1. `scripts` - 22 edges
2. `TDD — CRM Silmer MVP` - 22 edges
3. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
4. `Design do CRM Silmer` - 16 edges
5. `Topologia EasyPanel — CRM Silmer` - 15 edges
6. `compilerOptions` - 13 edges
7. `Passagem de Produto para Tech Lead` - 12 edges
8. `CRM Silmer MVP — Plano de Implementação` - 11 edges
9. `Fase 5 — Orçamento, PIX, Pedido e Ficha` - 10 edges
10. `Campos da Ficha e Jornada Conversacional — P0.1` - 10 edges

## Surprising Connections (you probably didn't know these)
- `capture()` --calls--> `createSafeLogger()`  [EXTRACTED]
  test/observability.test.js → modules/shared/src/observability.js
- `createApi()` --calls--> `createSafeLogger()`  [EXTRACTED]
  apps/api/src/app.js → modules/shared/src/observability.js
- `createApi()` --calls--> `normalizeTraceId()`  [EXTRACTED]
  apps/api/src/app.js → modules/shared/src/observability.js
- `Ficha de Pedido` --shares_data_with--> `Rose (Destinatária Ficha)`  [EXTRACTED]
  CAMPOS-FICHA-E-JORNADA-P0-1.md → CRM-MVP-ESPECIFICACAO.md
- `validateRecoveryKit()` --calls--> `validateTopologyDocument()`  [EXTRACTED]
  scripts/recovery-mock.mjs → scripts/validate-topology.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — caixa_de_entrada, kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]
- **Migração do Datacrazy para CRM Próprio** — historico_datacrazy_crm_processo_vendas, historico_datacrazy_datacrazy_setup, specs_features_crm_mvp_context, specs_features_crm_mvp_spec [INFERRED 0.85]

## Communities (67 total, 6 thin omitted)

### Community 0 - "Technical Strategy and MVP"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 1 - "Design System and UX"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 2 - "Fase 0 — Fundação e riscos técnicos"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar EasyPanel dev/hml/prod, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 3 - "CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)"
Cohesion: 0.06
Nodes (33): 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano, 7. O que a IA e o vendedor nunca afirmam, 8. Pendências que travam o processo hoje (+25 more)

### Community 4 - "Passagem de Produto para Tech Lead"
Cohesion: 0.06
Nodes (34): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+26 more)

### Community 5 - "MVP Product Specification"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 6 - "Infrastructure and Deployment"
Cohesion: 0.09
Nodes (22): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços por projeto, 3. Rede e domínios (+14 more)

### Community 7 - "CRM-MVP-ESPECIFICACAO.md"
Cohesion: 0.29
Nodes (6): Sobre o CRM Silmer, Caixa de Entrada (Backlog), Ficha de Pedido, Kanban Comercial, Rose (Destinatária Ficha), Vendedor Silmer (Agente IA)

### Community 8 - "CRM Silmer MVP — Requisitos Rastreáveis"
Cohesion: 0.12
Nodes (15): Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido, P1.4 Confiabilidade e canais (+7 more)

### Community 9 - "scripts"
Cohesion: 0.06
Nodes (33): engines, node, npm, name, packageManager, private, scripts, build (+25 more)

### Community 10 - "Product Context and Scope"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 11 - "compilerOptions"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 12 - "validate-topology.mjs"
Cohesion: 0.18
Nodes (15): buildRecoveryPlan(), expectedAdapterKeys, expectedDigestKeys, invariant(), main(), validateRecoveryKit(), expectedEnvironments, expectedProjects (+7 more)

### Community 13 - "Fase 5 — Orçamento, PIX, Pedido e Ficha"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 14 - "api/package.json"
Cohesion: 0.17
Nodes (11): dependencies, @crm-silmer/shared, fastify, @crm-silmer/shared, name, private, scripts, start (+3 more)

### Community 15 - "validate-security-catalog.mjs"
Cohesion: 0.33
Nodes (7): invariant(), main(), requiredFamilies, retention, validateDataCatalog(), validateThreatModel(), rootUrl

### Community 16 - "README.md"
Cohesion: 0.38
Nodes (3): Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 17 - "Arquitetura — Decisões do MVP"
Cohesion: 0.29
Nodes (7): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis

### Community 18 - "Contribuindo com o CRM Silmer"
Cohesion: 0.33
Nodes (5): Antes de alterar, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Validação

### Community 19 - "T00.4 — Spikes externos"
Cohesion: 0.33
Nodes (5): Decisões seguras, Evidências e pendências externas, Resultado local, T00.4 — Spikes externos, Verificação

### Community 20 - "T00.5 — Threat model e catálogo de dados"
Cohesion: 0.33
Nodes (5): Aprovação, Catálogo e retenção, Modelo de ameaças, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 22 - "Codex — Contexto do CRM Silmer"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 23 - "CRM Silmer"
Cohesion: 0.50
Nodes (4): Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada

### Community 24 - "Agentes do CRM Silmer"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 26 - "openai-suggestion-schema.json"
Cohesion: 0.06
Nodes (33): field, fieldSuggestions, handoffRequired, null, reply, source, stageSuggestion, string (+25 more)

### Community 27 - "devDependencies"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 28 - "observability.test.js"
Cohesion: 0.09
Nodes (24): createApi(), api, logger, port, WorkerRuntime, SERVICES, allowedContextFields, categoricalFields (+16 more)

### Community 29 - "worker/package.json"
Cohesion: 0.20
Nodes (9): dependencies, @crm-silmer/shared, @crm-silmer/shared, name, private, scripts, start, type (+1 more)

### Community 30 - "shared/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 31 - "build.mjs"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 32 - "edge-web/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 33 - "check-boundaries.mjs"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 34 - "validate-phase0-decisions.mjs"
Cohesion: 0.31
Nodes (7): expectedDecisionSubjects, expectedRoles, invariant(), main(), validatePendingApproval(), validatePhase0Decisions(), rootUrl

### Community 39 - "T00.6 — Gate de aprovação da Fase 0"
Cohesion: 0.29
Nodes (6): Como registrar uma aprovação real, Defaults aguardando confirmação, Papéis e separação de funções, Resultado local, T00.6 — Gate de aprovação da Fase 0, Verificação

### Community 40 - "serve-edge.mjs"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 41 - "ci-images.test.js"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

### Community 44 - "Runbook de recovery off-host — T00.3"
Cohesion: 0.50
Nodes (3): Execução externa pendente, Runbook de recovery off-host — T00.3, Uso offline por uma segunda pessoa

### Community 45 - "signature"
Cohesion: 0.15
Nodes (12): meta, messageFixture, signature, statusFixture, openai, schemaFixture, schemaVersion, appSecret (+4 more)

### Community 46 - "validate-external-spikes.mjs"
Cohesion: 0.40
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 47 - "Fase 2 — Caixa de Entrada, canais e confiabilidade"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 48 - "Supply chain da Fase 0"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 49 - "Fase 1 — Identidade, acesso e infraestrutura de domínio"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 50 - "Fase 3 — Negócio, Kanban e qualificação"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 51 - "Fase 6 — Privacidade, relatórios e operação"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 52 - "Fase 4 — Vendedor Silmer assistivo"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 53 - "Fase 7 — Hardening, UAT e piloto"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 54 - "CRM Silmer MVP — Plano de Implementação"
Cohesion: 0.67
Nodes (3): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico

### Community 55 - "alerts.json"
Cohesion: 0.15
Nodes (12): alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner, status (+4 more)

### Community 56 - "T00.7 — Observabilidade e hardening mínimos"
Cohesion: 0.40
Nodes (4): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local

### Community 57 - "Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 58 - "Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 59 - "Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 60 - "Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 61 - "Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 62 - "Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 63 - "Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 64 - "Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 65 - "Q: Como o P0.7 modela Admin, Atendimento e Vendedor?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 66 - "Q: Where are the agent roles and contribution protocol defined?"
Cohesion: 0.50
Nodes (3): Answer, Q: Where are the agent roles and contribution protocol defined?, Source Nodes

## Knowledge Gaps
- **460 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+455 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CRM Silmer MVP — Plano de Implementação` connect `CRM Silmer MVP — Plano de Implementação` to `Fase 0 — Fundação e riscos técnicos`, `Fase 5 — Orçamento, PIX, Pedido e Ficha`, `Fase 2 — Caixa de Entrada, canais e confiabilidade`, `Fase 1 — Identidade, acesso e infraestrutura de domínio`, `Fase 3 — Negócio, Kanban e qualificação`, `Fase 6 — Privacidade, relatórios e operação`, `Fase 4 — Vendedor Silmer assistivo`, `TECHNICAL-DESIGN.md`, `Fase 7 — Hardening, UAT e piloto`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `Technical Strategy and MVP` to `TECHNICAL-DESIGN.md`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `MVP Product Specification` to `CRM-MVP-ESPECIFICACAO.md`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _460 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Technical Strategy and MVP` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Design System and UX` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
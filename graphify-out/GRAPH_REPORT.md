# Graph Report - crm-silmer  (2026-08-31)

## Corpus Check
- 133 files · ~73,968 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1077 nodes · 1375 edges · 102 communities (90 shown, 12 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e63d7593`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- observability.test.js
- MVP Implementation Strategy
- Database Schema Protection
- Configuration Service
- Design System Guidelines
- database/src/index.js
- Product to Tech Handoff
- Sales Qualification Process
- AI Suggestion Schema
- Recovery Plan Validation
- integration-reliability/src/index.js
- Catalog Management Service
- MVP Product Specification
- TypeScript Configuration
- scripts
- api/package.json
- Infrastructure and Topology
- Identity and Access Service
- Development Tooling
- Decision Validation Tests
- P1 — MVP
- Database Module Configuration
- Monitoring and Alerts
- Integration Manifests
- Authorization and Capabilities
- Monorepo Workspace Root
- TECHNICAL-DESIGN.md
- README.md
- validate-external-spikes.mjs
- Security Catalog Validation
- Product Context and Backlog
- Phase 5: Financial Workflow
- Agent Roles and Protocols
- Recovery Runbook
- Phase 0: Foundation Tasks
- Phase 2: Communication Channels
- Arquitetura — Decisões do MVP
- Contribution Guidelines
- Phase 0 Approval Gate
- Supply Chain Security
- Phase 1: Domain Infrastructure
- Phase 3: CRM Kanban
- Phase 6: Privacy Operations
- T00.4 — Sandbox da Meta
- Threat Model Documentation
- Audit Privacy Module
- Catalog Module
- Configuration Module
- Identity Access Module
- Integration Reliability Module
- Shared Utilities Module
- Build System Scripts
- Phase 4: AI Assistant
- Phase 7: Hardening Pilot
- Edge Web Module
- Observability and Hardening
- Identity Access Baseline
- Workspace Boundary Checks
- Edge Server Utility
- Security Policy
- AI Authority Queries
- Product Readiness Queries
- AI Autonomy Queries
- Readiness P0.7 Queries
- Readiness P0.5 Queries
- Retention Policy Queries
- Business Logic Queries
- Readiness P0.6 Queries
- Role Modeling Queries
- Agent Protocol Queries
- Accessibility Requirement Queries
- Repository Security Queries
- CI Integration Queries
- Acceptance Criteria Queries
- Project Onboarding
- Bootstrap Tests
- CI Image Tests
- Prettier Configuration
- Implementation Roadmap
- Edge Web App
- ESLint Configuration
- Legacy Qualification Flow
- Database Documentation
- MVP Project Scope
- API Service Container
- Edge Web Container
- PostgreSQL Container
- Worker Service Container
- worker/package.json
- CRM Silmer MVP — Requisitos Rastreáveis
- Codex — Contexto do CRM Silmer
- Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?
- observability.js
- meta-sandbox.js
- openai-privacy-smoke.mjs
- audit-trail.js
- meta-sandbox.test.js
- validate-observability.mjs
- WorkerRuntime

## God Nodes (most connected - your core abstractions)
1. `scripts` - 29 edges
2. `TDD — CRM Silmer MVP` - 22 edges
3. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
4. `Design do CRM Silmer` - 16 edges
5. `Topologia EasyPanel — CRM Silmer` - 15 edges
6. `compilerOptions` - 13 edges
7. `normalizeConfigurationValues()` - 12 edges
8. `Passagem de Produto para Tech Lead` - 12 edges
9. `loadMigrations()` - 11 edges
10. `createSafeLogger()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `createMetaWebhookRuntime()` --calls--> `processMetaWebhook()`  [EXTRACTED]
  apps/api/src/server.js → modules/integration-reliability/src/meta-sandbox.js
- `harness()` --calls--> `createCatalogService()`  [EXTRACTED]
  test/catalog.test.js → modules/catalog/src/application/catalog-service.js
- `createHarness()` --calls--> `createConfigurationService()`  [EXTRACTED]
  test/configuration.test.js → modules/configuration/src/application/configuration-service.js
- `capture()` --calls--> `createSafeLogger()`  [EXTRACTED]
  test/observability.test.js → modules/shared/src/observability.js
- `createApi()` --calls--> `createSafeLogger()`  [EXTRACTED]
  apps/api/src/app.js → modules/shared/src/observability.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CRM Silmer Core Commercial Flow** — caixa_entrada, kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Monolith Modular Runtime Processes** — apps_api, apps_worker, apps_edge_web [EXTRACTED 1.00]
- **Documentation Precedence Hierarchy** — rules, specs_features_crm_mvp_spec, crm_mvp_especificacao, technical_design, architecture [EXTRACTED 1.00]
- **Espectro MVP Recovery Services** — silmer_api, silmer_worker, silmer_postgres, silmer_edge_web [EXTRACTED 1.00]
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]
- **Migração do Datacrazy para CRM Próprio** — historico_datacrazy_crm_processo_vendas, historico_datacrazy_datacrazy_setup, specs_features_crm_mvp_context, specs_features_crm_mvp_spec [INFERRED 0.85]

## Communities (102 total, 12 thin omitted)

### Community 0 - "observability.test.js"
Cohesion: 0.32
Nodes (11): createApi(), createMetaWebhookRuntime(), createServerApi(), SERVICES, createSafeLogger(), normalizeTraceId(), assertNoCanaries(), canaries (+3 more)

### Community 1 - "MVP Implementation Strategy"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 2 - "Database Schema Protection"
Cohesion: 0.09
Nodes (37): crm_meta.protect_catalog_entry, crm_meta.protect_catalog_version, crm_meta.protect_idempotency_record, crm_meta.reject_immutable_change, audit_events_immutable_rows, audit_events_immutable_truncate, catalog_materials_immutable_truncate, catalog_materials_protect_rows (+29 more)

### Community 3 - "Configuration Service"
Cohesion: 0.11
Nodes (27): createConfigurationService(), assertChannels(), assertExactKeys(), assertFab(), assertFeatureFlags(), assertJsonValue(), assertNonEmptyString(), assertPix() (+19 more)

### Community 4 - "Design System Guidelines"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 5 - "database/src/index.js"
Cohesion: 0.10
Nodes (17): pool, checkDatabaseReadiness(), createDatabase(), applyMigration(), checksum(), ensureDirectoryUrl(), loadMigrations(), migrate() (+9 more)

### Community 6 - "Product to Tech Handoff"
Cohesion: 0.06
Nodes (34): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+26 more)

### Community 7 - "Sales Qualification Process"
Cohesion: 0.06
Nodes (33): 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano, 7. O que a IA e o vendedor nunca afirmam, 8. Pendências que travam o processo hoje (+25 more)

### Community 8 - "AI Suggestion Schema"
Cohesion: 0.06
Nodes (33): field, fieldSuggestions, handoffRequired, null, reply, source, stageSuggestion, string (+25 more)

### Community 9 - "Recovery Plan Validation"
Cohesion: 0.13
Nodes (28): buildRecoveryPlan(), expectedAdapterKeys, expectedBlockerKeys, expectedCadenceEntryKeys, expectedCadenceKeys, expectedDigestKeys, expectedGateKeys, expectedRecoveryCheckKeys (+20 more)

### Community 10 - "integration-reliability/src/index.js"
Cohesion: 0.24
Nodes (10): canonicalJson(), clone(), createDeferred(), createIdempotentCommandExecutor(), fingerprintCommand(), IdempotencyConflictError, InMemoryIdempotencyRecordStore, requireNonEmpty() (+2 more)

### Community 11 - "Catalog Management Service"
Cohesion: 0.16
Nodes (18): createCatalogService(), assertExactKeys(), assertNonEmptyString(), assertRecord(), createCatalogSelection(), createPublishedCatalogVersion(), deepFreeze(), immutableCatalogClone() (+10 more)

### Community 12 - "MVP Product Specification"
Cohesion: 0.08
Nodes (27): Caixa de Entrada (Backlog), 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado (+19 more)

### Community 13 - "TypeScript Configuration"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 14 - "scripts"
Cohesion: 0.07
Nodes (29): scripts, build, check:boundaries, db:migrate, format, format:check, lint, preview (+21 more)

### Community 15 - "api/package.json"
Cohesion: 0.12
Nodes (15): dependencies, @crm-silmer/database, @crm-silmer/integration-reliability, @crm-silmer/shared, fastify, @crm-silmer/shared, name, private (+7 more)

### Community 16 - "Infrastructure and Topology"
Cohesion: 0.09
Nodes (22): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços no projeto, 3. Rede e domínios (+14 more)

### Community 17 - "Identity and Access Service"
Cohesion: 0.16
Nodes (14): constantTimeEqual(), createIdentityAccessService(), createInMemoryIdentityRepository(), DEFAULT_PASSWORD_PARAMETERS, deriveArgon2(), digest(), FUNCTIONS, hashPassword() (+6 more)

### Community 18 - "Development Tooling"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 19 - "Decision Validation Tests"
Cohesion: 0.24
Nodes (12): expectedDecisionSubjects, expectedRoles, invariant(), isCorporateId(), isIsoDate(), isVersionedEvidence(), main(), validateApproval() (+4 more)

### Community 20 - "P1 — MVP"
Cohesion: 0.25
Nodes (8): P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido, P1.4 Confiabilidade e canais, P1.5 Financeiro comercial, P1.6 Privacidade e acesso, P1.7 PIX e boas-vindas, P1 — MVP

### Community 21 - "Database Module Configuration"
Cohesion: 0.14
Nodes (13): dependencies, pg, devDependencies, @types/pg, exports, name, private, scripts (+5 more)

### Community 22 - "Monitoring and Alerts"
Cohesion: 0.15
Nodes (12): alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner, status (+4 more)

### Community 23 - "Integration Manifests"
Cohesion: 0.15
Nodes (12): meta, messageFixture, signature, statusFixture, openai, schemaFixture, schemaVersion, appSecret (+4 more)

### Community 24 - "Authorization and Capabilities"
Cohesion: 0.24
Nodes (9): actionCapabilities, authorize(), CAPABILITIES, createAccessControlService(), knownCapabilities, mfaRequiredCapabilities, operationalActions, harness() (+1 more)

### Community 25 - "Monorepo Workspace Root"
Cohesion: 0.17
Nodes (11): engines, node, npm, name, packageManager, private, type, version (+3 more)

### Community 26 - "TECHNICAL-DESIGN.md"
Cohesion: 0.40
Nodes (3): API Process, Edge Web Process, Worker Process

### Community 27 - "README.md"
Cohesion: 0.28
Nodes (4): Sobre o CRM Silmer, Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 28 - "validate-external-spikes.mjs"
Cohesion: 0.35
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 29 - "Security Catalog Validation"
Cohesion: 0.33
Nodes (7): invariant(), main(), requiredFamilies, retention, validateDataCatalog(), validateThreatModel(), rootUrl

### Community 30 - "Product Context and Backlog"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 31 - "Phase 5: Financial Workflow"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 32 - "Agent Roles and Protocols"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 33 - "Recovery Runbook"
Cohesion: 0.25
Nodes (7): Execução externa pendente, Lacunas, donos e prazo-gate, Pre-flight obrigatório, Runbook de recovery off-host — T00.3 / T07.3, Stop conditions, Uso offline por uma segunda pessoa, Tombstone Ledger (T06.3)

### Community 34 - "Phase 0: Foundation Tasks"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar serviços Silmer no EasyPanel, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 35 - "Phase 2: Communication Channels"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 36 - "Arquitetura — Decisões do MVP"
Cohesion: 0.25
Nodes (7): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis

### Community 37 - "Contribution Guidelines"
Cohesion: 0.29
Nodes (6): Antes de alterar, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Governança do repositório público, Validação

### Community 38 - "Phase 0 Approval Gate"
Cohesion: 0.29
Nodes (6): Como registrar uma aprovação real, Defaults aguardando confirmação, Papéis e separação de funções, Resultado local, T00.6 — Gate de aprovação da Fase 0, Verificação

### Community 39 - "Supply Chain Security"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 40 - "Phase 1: Domain Infrastructure"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 41 - "Phase 3: CRM Kanban"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 42 - "Phase 6: Privacy Operations"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 43 - "T00.4 — Sandbox da Meta"
Cohesion: 0.15
Nodes (11): Decisões seguras, Evidências e pendências externas, Resultado local, T00.4 — Spikes externos, Verificação, Ativos selecionados, Escopo e limite, Evidência de fechamento (+3 more)

### Community 44 - "Threat Model Documentation"
Cohesion: 0.33
Nodes (5): Aprovação, Catálogo e retenção, Modelo de ameaças, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 45 - "Audit Privacy Module"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 46 - "Catalog Module"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 47 - "Configuration Module"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 48 - "Identity Access Module"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 49 - "Integration Reliability Module"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 50 - "Shared Utilities Module"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 51 - "Build System Scripts"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 52 - "Phase 4: AI Assistant"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 53 - "Phase 7: Hardening Pilot"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 54 - "Edge Web Module"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 55 - "Observability and Hardening"
Cohesion: 0.40
Nodes (4): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local

### Community 56 - "Identity Access Baseline"
Cohesion: 0.40
Nodes (4): Baseline de identidade e acesso da Fase 1, Gates, Invariantes operacionais, Parâmetros versionados

### Community 57 - "Workspace Boundary Checks"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 58 - "Edge Server Utility"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 59 - "Security Policy"
Cohesion: 0.50
Nodes (3): Como reportar uma vulnerabilidade, Política de segurança, Versões suportadas

### Community 60 - "AI Authority Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 61 - "Product Readiness Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 62 - "AI Autonomy Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 63 - "Readiness P0.7 Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 64 - "Readiness P0.5 Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 65 - "Retention Policy Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 66 - "Business Logic Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 67 - "Readiness P0.6 Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 68 - "Role Modeling Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 69 - "Agent Protocol Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Where are the agent roles and contribution protocol defined?, Source Nodes

### Community 70 - "Accessibility Requirement Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais requisitos, tarefas, arquivos, contratos de acessibilidade, segurança e critérios de aceite estão relacionados à GitHub Issue #1?, Source Nodes

### Community 71 - "Repository Security Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?, Source Nodes

### Community 72 - "CI Integration Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?, Source Nodes

### Community 73 - "Acceptance Criteria Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual requisito, tarefa, arquivos e critérios de aceite correspondem à issue GitHub #2 deste repositório?, Source Nodes

### Community 74 - "Project Onboarding"
Cohesion: 0.50
Nodes (4): Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada

### Community 76 - "CI Image Tests"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

### Community 78 - "Implementation Roadmap"
Cohesion: 0.67
Nodes (3): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico

### Community 91 - "worker/package.json"
Cohesion: 0.20
Nodes (9): dependencies, @crm-silmer/shared, @crm-silmer/shared, name, private, scripts, start, type (+1 more)

### Community 92 - "CRM Silmer MVP — Requisitos Rastreáveis"
Cohesion: 0.25
Nodes (7): Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P2 — Depois do piloto, Problema, Rastreabilidade

### Community 93 - "Codex — Contexto do CRM Silmer"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 94 - "Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?, Source Nodes

### Community 95 - "observability.js"
Cohesion: 0.16
Nodes (10): allowedContextFields, allowedEvents, allowedMetrics, allowedServices, categoricalPolicies, createSafeLogRecord(), isFiniteNumber(), MetricRegistry (+2 more)

### Community 96 - "meta-sandbox.js"
Cohesion: 0.23
Nodes (9): deepFreeze(), extractMetaEvents(), immutableClone(), InMemoryMetaEventStore, MetaApiError, MetaWebhookPayloadError, processMetaWebhook(), requireNonEmpty() (+1 more)

### Community 97 - "openai-privacy-smoke.mjs"
Cohesion: 0.32
Nodes (11): buildRequest(), containsPii(), extractOutputText(), invariant(), main(), piiPatterns, runOpenAiPrivacySmoke(), SYNTHETIC_INPUT (+3 more)

### Community 98 - "audit-trail.js"
Cohesion: 0.27
Nodes (6): AuditEventValidationError, deepFreeze(), immutableClone(), InMemoryAuditTrail, requireNonEmptyString(), validateAuditEvent()

### Community 99 - "meta-sandbox.test.js"
Cohesion: 0.27
Nodes (6): createMetaMessagesClient(), MetaWebhookAuthenticationError, runMetaSendAttempt(), required(), runMetaSandboxSmoke(), sha256()

### Community 100 - "validate-observability.mjs"
Cohesion: 0.48
Nodes (6): invariant(), main(), requiredAlerts, rootUrl, validateAlertPolicy(), validateRuntimeHardening()

## Ambiguous Edges - Review These
- `Vendedor Silmer (IA Agent)` → `Kanban Comercial`  [AMBIGUOUS]
  CRM-MVP-ESPECIFICACAO.md · relation: calls

## Knowledge Gaps
- **560 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+555 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Vendedor Silmer (IA Agent)` and `Kanban Comercial`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `CRM Silmer MVP — Plano de Implementação` connect `Implementation Roadmap` to `Phase 0: Foundation Tasks`, `Phase 2: Communication Channels`, `Phase 1: Domain Infrastructure`, `Phase 3: CRM Kanban`, `Phase 6: Privacy Operations`, `Phase 4: AI Assistant`, `Phase 7: Hardening Pilot`, `TECHNICAL-DESIGN.md`, `Phase 5: Financial Workflow`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `MVP Implementation Strategy` to `TECHNICAL-DESIGN.md`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `Topologia EasyPanel — CRM Silmer` connect `Infrastructure and Topology` to `TECHNICAL-DESIGN.md`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _560 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `MVP Implementation Strategy` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Database Schema Protection` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._
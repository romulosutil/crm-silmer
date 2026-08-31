# Graph Report - .  (2026-08-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1061 nodes · 1357 edges · 94 communities (83 shown, 11 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 5,061 input · 1,134 output

## Graph Freshness
- Built from commit: `672fe3db`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- API and Worker Runtime
- MVP Reliability and Strategy
- Database Immutability and Protection
- Configuration Service and Validation
- Design System and UI Principles
- MVP Product Specification
- Database Migrations and CLI
- Tech Lead Handoff Documentation
- Sales Qualification Process
- System Recovery Planning
- Architecture and Topology
- Catalog Service and Versioning
- Audit Trail and Idempotency
- Project Scripts and Tasks
- TypeScript Configuration
- API Package Dependencies
- Identity and Access Service
- Gemini Privacy Smoke Tests
- MVP Implementation Roadmap
- Testing and Linting Tools
- Decision Validation Logic
- Database Package Configuration
- Alerting and Retention Rules
- Integration Manifests and Fixtures
- Authorization and Access Control
- Monorepo Workspace Configuration
- Project Documentation and Rules
- External Spike Validation
- Security and Threat Modeling
- Product Context and Backlog
- Phase 5: Orders and Payments
- Agent Roles and Protocols
- Recovery Runbook and Operations
- Phase 0: Technical Foundation
- Phase 2: Messaging Channels
- Contribution and Governance Guidelines
- Phase 0 Approval Gates
- Supply Chain Security
- Phase 1: Identity and Domain
- Phase 3: CRM Business Logic
- Phase 6: Privacy and Reporting
- Meta Sandbox Integration
- Threat Model Documentation
- Audit Privacy Package
- Catalog Module Configuration
- Configuration Module Configuration
- Identity Access Package
- Integration Reliability Package
- Shared Module Configuration
- Build and Manifest Scripts
- Phase 4: AI Sales Assistant
- Phase 7: Hardening and Pilot
- Edge Web Package
- CRM Context and Guardrails
- External Spike Verification
- Observability and Hardening
- Identity Baseline Documentation
- Workspace Boundary Checks
- Edge Server Implementation
- Security Policy and Reporting
- AI Sales Authority Queries
- Product Readiness Queries
- AI Autonomy Impact Queries
- Product Readiness P0.7 Queries
- Product Readiness P0.5 Queries
- Retention and Deletion Queries
- Business Logic Definition Queries
- Product Readiness P0.6 Queries
- Role Modeling Queries
- Agent Protocol Queries
- Accessibility Contract Queries
- Repository Security Queries
- CI/CD Integration Queries
- Acceptance Criteria Queries
- Gate Validation Queries
- Issue Dependency Queries
- Gemini Model Selection Queries
- Project Onboarding and Stack
- Implementation Plan Tasks
- Bootstrap Test Suite
- CI Image Tests
- Prettier Formatting Rules
- Edge Web Application
- ESLint Global Configuration
- Legacy Qualification Reference
- Database Module Documentation
- MVP Project Spectrum
- API Service Container
- Edge Web Container
- PostgreSQL Database Container
- Worker Process Container

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
10. `CRM Silmer MVP — Plano de Implementação` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Vendedor Silmer (AI Agent)` --calls--> `Kanban Comercial`  [AMBIGUOUS]
  TECHNICAL-DESIGN.md → CRM-MVP-ESPECIFICACAO.md
- `harness()` --calls--> `createCatalogService()`  [EXTRACTED]
  test/catalog.test.js → modules/catalog/src/application/catalog-service.js
- `createHarness()` --calls--> `createConfigurationService()`  [EXTRACTED]
  test/configuration.test.js → modules/configuration/src/application/configuration-service.js
- `capture()` --calls--> `createSafeLogger()`  [EXTRACTED]
  test/observability.test.js → modules/shared/src/observability.js
- `Vendedor Silmer (AI Agent)` --calls--> `Caixa de Entrada (Backlog)`  [INFERRED]
  TECHNICAL-DESIGN.md → CRM-MVP-ESPECIFICACAO.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Modular Monolith Processes** — apps_edge_web, apps_api, apps_worker [EXTRACTED 1.00]
- **External Integration Adapters** — meta_whatsapp, gemini_api, s3_storage [EXTRACTED 1.00]
- **Core Transactional Flow** — apps_api, apps_worker, postgresql [INFERRED 0.80]
- **CRM Silmer Core Commercial Flow** — caixa_entrada, kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Documentation Precedence Hierarchy** — rules, specs_features_crm_mvp_spec, crm_mvp_especificacao, technical_design, architecture [EXTRACTED 1.00]
- **Espectro MVP Recovery Services** — silmer_api, silmer_worker, silmer_postgres, silmer_edge_web [EXTRACTED 1.00]
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]
- **Migração do Datacrazy para CRM Próprio** — historico_datacrazy_crm_processo_vendas, historico_datacrazy_datacrazy_setup, specs_features_crm_mvp_context, specs_features_crm_mvp_spec [INFERRED 0.85]

## Communities (94 total, 11 thin omitted)

### Community 0 - "API and Worker Runtime"
Cohesion: 0.06
Nodes (43): createApi(), createMetaWebhookRuntime(), createServerApi(), WorkerRuntime, createMetaMessagesClient(), deepFreeze(), extractMetaEvents(), immutableClone() (+35 more)

### Community 1 - "MVP Reliability and Strategy"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 2 - "Database Immutability and Protection"
Cohesion: 0.09
Nodes (37): crm_meta.protect_catalog_entry, crm_meta.protect_catalog_version, crm_meta.protect_idempotency_record, crm_meta.reject_immutable_change, audit_events_immutable_rows, audit_events_immutable_truncate, catalog_materials_immutable_truncate, catalog_materials_protect_rows (+29 more)

### Community 3 - "Configuration Service and Validation"
Cohesion: 0.11
Nodes (27): createConfigurationService(), assertChannels(), assertExactKeys(), assertFab(), assertFeatureFlags(), assertJsonValue(), assertNonEmptyString(), assertPix() (+19 more)

### Community 4 - "Design System and UI Principles"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 5 - "MVP Product Specification"
Cohesion: 0.06
Nodes (35): API Process, Edge Web Process, Worker Process, Caixa de Entrada (Backlog), 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD (+27 more)

### Community 6 - "Database Migrations and CLI"
Cohesion: 0.10
Nodes (17): pool, checkDatabaseReadiness(), createDatabase(), applyMigration(), checksum(), ensureDirectoryUrl(), loadMigrations(), migrate() (+9 more)

### Community 7 - "Tech Lead Handoff Documentation"
Cohesion: 0.06
Nodes (34): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+26 more)

### Community 8 - "Sales Qualification Process"
Cohesion: 0.06
Nodes (33): 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano, 7. O que a IA e o vendedor nunca afirmam, 8. Pendências que travam o processo hoje (+25 more)

### Community 9 - "System Recovery Planning"
Cohesion: 0.13
Nodes (28): buildRecoveryPlan(), expectedAdapterKeys, expectedBlockerKeys, expectedCadenceEntryKeys, expectedCadenceKeys, expectedDigestKeys, expectedGateKeys, expectedRecoveryCheckKeys (+20 more)

### Community 10 - "Architecture and Topology"
Cohesion: 0.06
Nodes (30): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis, EasyPanel Topology (+22 more)

### Community 11 - "Catalog Service and Versioning"
Cohesion: 0.16
Nodes (18): createCatalogService(), assertExactKeys(), assertNonEmptyString(), assertRecord(), createCatalogSelection(), createPublishedCatalogVersion(), deepFreeze(), immutableCatalogClone() (+10 more)

### Community 12 - "Audit Trail and Idempotency"
Cohesion: 0.13
Nodes (16): AuditEventValidationError, deepFreeze(), immutableClone(), InMemoryAuditTrail, requireNonEmptyString(), validateAuditEvent(), canonicalJson(), clone() (+8 more)

### Community 13 - "Project Scripts and Tasks"
Cohesion: 0.07
Nodes (29): scripts, build, check:boundaries, db:migrate, format, format:check, lint, preview (+21 more)

### Community 14 - "TypeScript Configuration"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 15 - "API Package Dependencies"
Cohesion: 0.08
Nodes (23): dependencies, @crm-silmer/database, @crm-silmer/integration-reliability, @crm-silmer/shared, fastify, name, private, scripts (+15 more)

### Community 16 - "Identity and Access Service"
Cohesion: 0.16
Nodes (14): constantTimeEqual(), createIdentityAccessService(), createInMemoryIdentityRepository(), DEFAULT_PASSWORD_PARAMETERS, deriveArgon2(), digest(), FUNCTIONS, hashPassword() (+6 more)

### Community 17 - "Gemini Privacy Smoke Tests"
Cohesion: 0.24
Nodes (15): APPROVED_MODEL, APPROVED_PROVIDER, buildEndpoint(), buildRequest(), containsPii(), extractOutputText(), invariant(), main() (+7 more)

### Community 18 - "MVP Implementation Roadmap"
Cohesion: 0.12
Nodes (17): CRM MVP - Implementation Plan, CRM MVP - Traceable Requirements, Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer (+9 more)

### Community 19 - "Testing and Linting Tools"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 20 - "Decision Validation Logic"
Cohesion: 0.24
Nodes (12): expectedDecisionSubjects, expectedRoles, invariant(), isCorporateId(), isIsoDate(), isVersionedEvidence(), main(), validateApproval() (+4 more)

### Community 21 - "Database Package Configuration"
Cohesion: 0.14
Nodes (13): dependencies, pg, devDependencies, @types/pg, exports, name, private, scripts (+5 more)

### Community 22 - "Alerting and Retention Rules"
Cohesion: 0.15
Nodes (12): alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner, status (+4 more)

### Community 23 - "Integration Manifests and Fixtures"
Cohesion: 0.15
Nodes (12): gemini, schemaFixture, meta, messageFixture, signature, statusFixture, schemaVersion, appSecret (+4 more)

### Community 24 - "Authorization and Access Control"
Cohesion: 0.24
Nodes (9): actionCapabilities, authorize(), CAPABILITIES, createAccessControlService(), knownCapabilities, mfaRequiredCapabilities, operationalActions, harness() (+1 more)

### Community 25 - "Monorepo Workspace Configuration"
Cohesion: 0.17
Nodes (11): engines, node, npm, name, packageManager, private, type, version (+3 more)

### Community 26 - "Project Documentation and Rules"
Cohesion: 0.24
Nodes (4): Sobre o CRM Silmer, Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 27 - "External Spike Validation"
Cohesion: 0.35
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 28 - "Security and Threat Modeling"
Cohesion: 0.33
Nodes (7): invariant(), main(), requiredFamilies, retention, validateDataCatalog(), validateThreatModel(), rootUrl

### Community 29 - "Product Context and Backlog"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 30 - "Phase 5: Orders and Payments"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 31 - "Agent Roles and Protocols"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 32 - "Recovery Runbook and Operations"
Cohesion: 0.25
Nodes (7): Execução externa pendente, Lacunas, donos e prazo-gate, Pre-flight obrigatório, Runbook de recovery off-host — T00.3 / T07.3, Stop conditions, Uso offline por uma segunda pessoa, Tombstone Ledger (T06.3)

### Community 33 - "Phase 0: Technical Foundation"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar serviços Silmer no EasyPanel, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 34 - "Phase 2: Messaging Channels"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 35 - "Contribution and Governance Guidelines"
Cohesion: 0.29
Nodes (6): Antes de alterar, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Governança do repositório público, Validação

### Community 36 - "Phase 0 Approval Gates"
Cohesion: 0.29
Nodes (6): Como registrar uma aprovação real, Defaults aguardando confirmação, Papéis e separação de funções, Resultado local, T00.6 — Gate de aprovação da Fase 0, Verificação

### Community 37 - "Supply Chain Security"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 38 - "Phase 1: Identity and Domain"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 39 - "Phase 3: CRM Business Logic"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 40 - "Phase 6: Privacy and Reporting"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 41 - "Meta Sandbox Integration"
Cohesion: 0.33
Nodes (6): Ativos selecionados, Escopo e limite, Evidência de fechamento, Segredos e dados locais, Sequência operacional, T00.4 — Sandbox da Meta

### Community 42 - "Threat Model Documentation"
Cohesion: 0.33
Nodes (5): Aprovação, Catálogo e retenção, Modelo de ameaças, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 43 - "Audit Privacy Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 44 - "Catalog Module Configuration"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 45 - "Configuration Module Configuration"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 46 - "Identity Access Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 47 - "Integration Reliability Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 48 - "Shared Module Configuration"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 49 - "Build and Manifest Scripts"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 50 - "Phase 4: AI Sales Assistant"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 51 - "Phase 7: Hardening and Pilot"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 52 - "Edge Web Package"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 53 - "CRM Context and Guardrails"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 54 - "External Spike Verification"
Cohesion: 0.40
Nodes (5): Decisões seguras, Evidências e pendências externas, Resultado local, T00.4 — Spikes externos, Verificação

### Community 55 - "Observability and Hardening"
Cohesion: 0.40
Nodes (4): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local

### Community 56 - "Identity Baseline Documentation"
Cohesion: 0.40
Nodes (4): Baseline de identidade e acesso da Fase 1, Gates, Invariantes operacionais, Parâmetros versionados

### Community 57 - "Workspace Boundary Checks"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 58 - "Edge Server Implementation"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 59 - "Security Policy and Reporting"
Cohesion: 0.50
Nodes (3): Como reportar uma vulnerabilidade, Política de segurança, Versões suportadas

### Community 60 - "AI Sales Authority Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 61 - "Product Readiness Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 62 - "AI Autonomy Impact Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 63 - "Product Readiness P0.7 Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 64 - "Product Readiness P0.5 Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 65 - "Retention and Deletion Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 66 - "Business Logic Definition Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 67 - "Product Readiness P0.6 Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 68 - "Role Modeling Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 69 - "Agent Protocol Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Where are the agent roles and contribution protocol defined?, Source Nodes

### Community 70 - "Accessibility Contract Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais requisitos, tarefas, arquivos, contratos de acessibilidade, segurança e critérios de aceite estão relacionados à GitHub Issue #1?, Source Nodes

### Community 71 - "Repository Security Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?, Source Nodes

### Community 72 - "CI/CD Integration Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?, Source Nodes

### Community 73 - "Acceptance Criteria Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual requisito, tarefa, arquivos e critérios de aceite correspondem à issue GitHub #2 deste repositório?, Source Nodes

### Community 74 - "Gate Validation Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?, Source Nodes

### Community 75 - "Issue Dependency Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais dependências e critérios verificáveis da issue 5 ainda podem ser concluídos sem aceite humano, credenciais OpenAI ou designação do Tech Lead?, Source Nodes

### Community 76 - "Gemini Model Selection Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual modelo Gemini oferece o melhor custo-beneficio para os chats do CRM Silmer na issue 5?, Source Nodes

### Community 77 - "Project Onboarding and Stack"
Cohesion: 0.50
Nodes (4): Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada

### Community 78 - "Implementation Plan Tasks"
Cohesion: 0.50
Nodes (3): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico

### Community 80 - "CI Image Tests"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

## Ambiguous Edges - Review These
- `Vendedor Silmer (AI Agent)` → `Kanban Comercial`  [AMBIGUOUS]
  CRM-MVP-ESPECIFICACAO.md · relation: calls

## Knowledge Gaps
- **547 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+542 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Vendedor Silmer (AI Agent)` and `Kanban Comercial`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `CRM Silmer MVP — Plano de Implementação` connect `Implementation Plan Tasks` to `Phase 0: Technical Foundation`, `Phase 2: Messaging Channels`, `Phase 1: Identity and Domain`, `Phase 3: CRM Business Logic`, `Phase 6: Privacy and Reporting`, `Phase 4: AI Sales Assistant`, `Phase 7: Hardening and Pilot`, `Phase 5: Orders and Payments`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `MVP Reliability and Strategy` to `MVP Product Specification`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `CRM MVP - Traceable Requirements` connect `MVP Implementation Roadmap` to `Project Documentation and Rules`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _547 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API and Worker Runtime` be split into smaller, more focused modules?**
  _Cohesion score 0.05868544600938967 - nodes in this community are weakly interconnected._
- **Should `MVP Reliability and Strategy` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
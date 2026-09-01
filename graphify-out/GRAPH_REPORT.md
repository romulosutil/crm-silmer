# Graph Report - crm-silmer  (2026-09-01)

## Corpus Check
- 162 files · ~98,381 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1341 nodes · 1735 edges · 155 communities (107 shown, 48 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c61b9a95`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- observability.test.js
- TDD and Project Strategy
- Database Immutability and Protection
- Configuration Service and Validation
- R2 Storage Smoke Tests
- WhatsApp Sales Process
- Design System and UI
- database/src/index.js
- audit-privacy/src/index.js
- scripts
- T00.4 — Sandbox da Meta
- Recovery Plan Validation
- Catalog Service and Versioning
- PDF Review and Generation
- TypeScript Configuration
- Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?
- api/package.json
- EasyPanel Infrastructure Topology
- Field Mapping and Inventory
- MVP Product Specification
- Identity and Access Service
- Gemini Privacy Smoke Test
- Q: Como a baseline Gemini Developer API da issue 5 controla modelo, tier pago, ZDR, PII, persistencia e saida estruturada?
- Security Catalog Validation
- MVP Requirements and Scope
- Dev Dependencies and Tooling
- Phase 0 Decision Validation
- Database Package Configuration
- Alerting and Retention Rules
- Product to Tech Handoff
- Integration Manifests and Fixtures
- Contribution and Governance
- Authorization and Capabilities
- Monorepo Workspace Configuration
- Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?
- Codex — Contexto do CRM Silmer
- Telemetry and Health Signals
- External Spike Validation
- Privacy Provider Compliance
- Product Context and Backlog
- Phase 5: Commercial Flow
- README.md
- Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?
- Agent Roles and Protocols
- Architecture and Modeling Decisions
- Q: Como os contratos canonicos do CRM Silmer tratam imagens recebidas e enviadas, anexos validos, Dropbox, retencao P0.6, Cloudflare R2, fim da jornada de compra e exclusao em sete dias?
- Container Hardening Evidence
- Service Monitoring Status
- Recovery Runbook and Procedures
- Project Implementation Phases
- Phase 0: Foundation Tasks
- Phase 2: Inbox and Channels
- Phase 0 Approval Gate
- Supply Chain Traceability
- Threat Model and Catalog
- Activation Gate Schema
- Escalation and Routing
- Media Retention Validation
- Phase 1: Identity and Infra
- Phase 3: Business Kanban
- Phase 6: Privacy and Ops
- Transient Media Controls
- Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?
- Audit Privacy Package
- Catalog Module Package
- Configuration Module Package
- Identity Access Package
- Integration Reliability Package
- Shared Module Package
- Build and Asset Management
- Phase 4: AI Assistant
- Phase 7: Hardening and UAT
- Edge Web Package
- Observability and Hardening Gate
- Identity Access Baseline
- Security Policy and Dependabot
- Human Approval Evidence
- Workspace Boundary Checks
- Edge Server Utility
- PR Review and Phases
- AI Authority Decisions
- Product Readiness Decisions
- AI Autonomy Limits
- Tech Lead Readiness Queries
- Ficha Numbering Decisions
- FAB and Sequence Logic
- Role Modeling Queries
- Accessibility Requirements Queries
- Acceptance Criteria Queries
- Scope and Dependency Queries
- Implementation Plan Tasks
- Bootstrap Integration Tests
- CI Image Tests
- Technical Foundation Summary
- Query: P0.5 Definições FAB e Numeração
- Prettier Formatting Rules
- Edge Web App
- Governance and Workflow
- Validation and CI Workflow
- ESLint Configuration
- Qualification Workflow
- Query: Requisitos Issue #2
- Product Readiness Decisions
- Database Documentation
- Inbox and Channels
- AI Assistant Development
- Sales and Documents
- API Application
- Edge Web Application
- Worker Application
- Functional Boundaries
- Modeling Decisions
- Inbox Backlog
- MVP Project Scope
- Order Form
- Deployment Workflow
- Gemini API Integration
- Price Authority Decisions
- Order Form Decisions
- Historical Data Archive
- Commercial Kanban
- WhatsApp API Integration
- Database Module
- Shared Modules
- Canonical Form V1
- Canonical Form V2
- HTML Form Review
- Silmer API Service
- Silmer Web Frontend
- Postgres Database Service
- Background Worker Service
- Deals and Kanban
- Hardening and Pilot
- API Contracts
- Monolith Modules
- Risks and Mitigation
- Runtime Architecture
- Performance and SLOs
- integration-reliability/src/index.js
- observability-live-probe.mjs
- worker/package.json
- T00.4 — Spikes externos
- T00.7 — Ativação e drills de observabilidade
- T00.4 - Revisao do PDF canonico da Ficha
- Dívida #29 — Aprovação e validação futura do Cloudflare R2
- Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?
- Q: Quais dependências e critérios verificáveis da issue 5 ainda podem ser concluídos sem aceite humano, credenciais OpenAI ou designação do Tech Lead?
- Q: Qual modelo Gemini oferece o melhor custo-beneficio para os chats do CRM Silmer na issue 5?
- Q: Quais evidencias ainda bloqueiam o fechamento da issue 5 apos o merge do PR 26?
- Query: P0.7 Modelagem de Roles
- Query: Requisitos e Tarefas Issue #1
- Query: Escopo e Requisitos Issue #6

## God Nodes (most connected - your core abstractions)
1. `scripts` - 39 edges
2. `TDD — CRM Silmer MVP` - 22 edges
3. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
4. `Design do CRM Silmer` - 16 edges
5. `Topologia EasyPanel — CRM Silmer` - 15 edges
6. `compilerOptions` - 13 edges
7. `runR2LiveSmoke()` - 13 edges
8. `normalizeConfigurationValues()` - 12 edges
9. `invariant()` - 12 edges
10. `Passagem de Produto para Tech Lead` - 12 edges

## Surprising Connections (you probably didn't know these)
- `createMetaWebhookRuntime()` --calls--> `processMetaWebhook()`  [EXTRACTED]
  apps/api/src/server.js → modules/integration-reliability/src/meta-sandbox.js
- `harness()` --calls--> `createCatalogService()`  [EXTRACTED]
  test/catalog.test.js → modules/catalog/src/application/catalog-service.js
- `createHarness()` --calls--> `createConfigurationService()`  [EXTRACTED]
  test/configuration.test.js → modules/configuration/src/application/configuration-service.js
- `capture()` --calls--> `createSafeLogger()`  [EXTRACTED]
  test/observability.test.js → modules/shared/src/observability.js
- `Vendedor Silmer (AI Agent)` --references--> `Crazy API (WhatsApp)`  [INFERRED]
  .specs/features/crm-mvp/context.md → historico-datacrazy/DATACRAZY-SETUP.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Monolith Runtime Processes** — technical_design_runtime, specs_features_crm_mvp_tasks_phase0, github_workflow_ci [EXTRACTED 1.00]
- **Privacy & Security Framework** — technical_design_security, specs_features_crm_mvp_tasks_phase6, architecture_modeling [EXTRACTED 1.00]
- **Sales Funnel Logic** — architecture_modeling, technical_design_data_model, specs_features_crm_mvp_tasks_phase3, specs_features_crm_mvp_tasks_phase5 [EXTRACTED 1.00]
- **Phase 0 Milestones** — docs_phase0_external_spikes_t00_4, docs_phase0_ficha_pdf_review_t00_4, docs_phase0_threat_model_and_data_catalog_t00_5 [EXTRACTED 1.00]
- **CRM MVP Core Decisions** — graphify_out_memory_query_20260829_215453_p0_2, graphify_out_memory_query_20260830_002538_p0_4, graphify_out_memory_query_20260830_004047_p0_7 [INFERRED 0.85]
- **Vendedor Silmer Integration Flow** — vendedor_silmer, google_gemini_api [INFERRED 0.85]
- **Documentation Precedence Hierarchy** — rules, specs_features_crm_mvp_spec, crm_mvp_especificacao, technical_design, architecture [EXTRACTED 1.00]
- **Espectro MVP Recovery Services** — silmer_api, silmer_worker, silmer_postgres, silmer_edge_web [EXTRACTED 1.00]
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]

## Communities (155 total, 48 thin omitted)

### Community 0 - "observability.test.js"
Cohesion: 0.09
Nodes (33): createApi(), createMetaWebhookRuntime(), createServerApi(), WorkerRuntime, SERVICES, allowedContextFields, allowedEvents, allowedMetrics (+25 more)

### Community 1 - "TDD and Project Strategy"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 2 - "Database Immutability and Protection"
Cohesion: 0.09
Nodes (37): crm_meta.protect_catalog_entry, crm_meta.protect_catalog_version, crm_meta.protect_idempotency_record, crm_meta.reject_immutable_change, audit_events_immutable_rows, audit_events_immutable_truncate, catalog_materials_immutable_truncate, catalog_materials_protect_rows (+29 more)

### Community 3 - "Configuration Service and Validation"
Cohesion: 0.11
Nodes (27): createConfigurationService(), assertChannels(), assertExactKeys(), assertFab(), assertFeatureFlags(), assertJsonValue(), assertNonEmptyString(), assertPix() (+19 more)

### Community 4 - "R2 Storage Smoke Tests"
Cohesion: 0.11
Nodes (34): assertNoS3ObjectLockHeaders(), assertSafeR2Evidence(), awsDate(), awsEncode(), awsTimestamp(), BUCKETS, canonicalObjectPath(), canonicalQuery() (+26 more)

### Community 5 - "WhatsApp Sales Process"
Cohesion: 0.06
Nodes (36): Crazy API (WhatsApp), Datacrazy CRM, 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano (+28 more)

### Community 6 - "Design System and UI"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 7 - "database/src/index.js"
Cohesion: 0.10
Nodes (17): pool, checkDatabaseReadiness(), createDatabase(), applyMigration(), checksum(), ensureDirectoryUrl(), loadMigrations(), migrate() (+9 more)

### Community 8 - "audit-privacy/src/index.js"
Cohesion: 0.19
Nodes (11): AuditEventValidationError, deepFreeze(), immutableClone(), InMemoryAuditTrail, requireNonEmptyString(), validateAuditEvent(), isTransientMediaExpired(), resolveTransientMediaExpiresAt() (+3 more)

### Community 9 - "scripts"
Cohesion: 0.05
Nodes (39): scripts, build, check:boundaries, db:migrate, drill:observability:api, format, format:check, generate:ficha-pdf-review (+31 more)

### Community 10 - "T00.4 — Sandbox da Meta"
Cohesion: 0.20
Nodes (6): Ativos selecionados, Escopo e limite, Evidência de fechamento, Segredos e dados locais, Sequência operacional, T00.4 — Sandbox da Meta

### Community 11 - "Recovery Plan Validation"
Cohesion: 0.13
Nodes (28): buildRecoveryPlan(), expectedAdapterKeys, expectedBlockerKeys, expectedCadenceEntryKeys, expectedCadenceKeys, expectedDigestKeys, expectedGateKeys, expectedRecoveryCheckKeys (+20 more)

### Community 12 - "Catalog Service and Versioning"
Cohesion: 0.16
Nodes (18): createCatalogService(), assertExactKeys(), assertNonEmptyString(), assertRecord(), createCatalogSelection(), createPublishedCatalogVersion(), deepFreeze(), immutableCatalogClone() (+10 more)

### Community 13 - "PDF Review and Generation"
Cohesion: 0.17
Nodes (25): approvalCriteria, buildFichaHtml(), buildLegacyFichaHtml(), buildReviewPageHtml(), commercialItemFields, commercialOrderFields, containsPersonalContact(), countPdfPages() (+17 more)

### Community 14 - "TypeScript Configuration"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 15 - "Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?, Source Nodes

### Community 16 - "api/package.json"
Cohesion: 0.12
Nodes (15): dependencies, @crm-silmer/database, @crm-silmer/integration-reliability, @crm-silmer/shared, fastify, @crm-silmer/shared, name, private (+7 more)

### Community 17 - "EasyPanel Infrastructure Topology"
Cohesion: 0.08
Nodes (24): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços no projeto, 3. Rede e domínios (+16 more)

### Community 18 - "Field Mapping and Inventory"
Cohesion: 0.09
Nodes (22): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+14 more)

### Community 19 - "MVP Product Specification"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 20 - "Identity and Access Service"
Cohesion: 0.16
Nodes (14): constantTimeEqual(), createIdentityAccessService(), createInMemoryIdentityRepository(), DEFAULT_PASSWORD_PARAMETERS, deriveArgon2(), digest(), FUNCTIONS, hashPassword() (+6 more)

### Community 21 - "Gemini Privacy Smoke Test"
Cohesion: 0.22
Nodes (17): APPROVED_MODEL, APPROVED_PROVIDER, APPROVED_SUGGESTION_SCHEMA, buildEndpoint(), buildRequest(), containsPii(), extractOutputText(), invariant() (+9 more)

### Community 22 - "Q: Como a baseline Gemini Developer API da issue 5 controla modelo, tier pago, ZDR, PII, persistencia e saida estruturada?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a baseline Gemini Developer API da issue 5 controla modelo, tier pago, ZDR, PII, persistencia e saida estruturada?, Source Nodes

### Community 23 - "Security Catalog Validation"
Cohesion: 0.22
Nodes (13): approvedReview, invariant(), isIsoTimestamp(), main(), requiredFamilies, requiredFindings, retention, sha256() (+5 more)

### Community 24 - "MVP Requirements and Scope"
Cohesion: 0.12
Nodes (15): Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido, P1.4 Confiabilidade e canais (+7 more)

### Community 25 - "Dev Dependencies and Tooling"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 26 - "Phase 0 Decision Validation"
Cohesion: 0.24
Nodes (12): expectedDecisionSubjects, expectedRoles, invariant(), isCorporateId(), isIsoDate(), isVersionedEvidence(), main(), validateApproval() (+4 more)

### Community 27 - "Database Package Configuration"
Cohesion: 0.14
Nodes (13): dependencies, pg, devDependencies, @types/pg, exports, name, private, scripts (+5 more)

### Community 28 - "Alerting and Retention Rules"
Cohesion: 0.14
Nodes (13): activationGateRef, alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner (+5 more)

### Community 29 - "Product to Tech Handoff"
Cohesion: 0.15
Nodes (12): Decisões P0 para aprovação final e estimativa fechada, Gate recomendado, O que o Tech Lead já pode especificar, P0.1 resolvido — contrato de passagem, P0.2 resolvido — autoridade sobre preço, P0.3 resolvido — limite financeiro comercial, P0.4 resolvido — canais e limite operacional da IA, P0.5 resolvido — identidade, FAB e numeração da Ficha (+4 more)

### Community 30 - "Integration Manifests and Fixtures"
Cohesion: 0.15
Nodes (12): gemini, schemaFixture, meta, messageFixture, signature, statusFixture, schemaVersion, appSecret (+4 more)

### Community 31 - "Contribution and Governance"
Cohesion: 0.17
Nodes (10): Antes de alterar, Atualização de branches de pull request, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Governança do repositório público, Validação, Answer (+2 more)

### Community 32 - "Authorization and Capabilities"
Cohesion: 0.24
Nodes (9): actionCapabilities, authorize(), CAPABILITIES, createAccessControlService(), knownCapabilities, mfaRequiredCapabilities, operationalActions, harness() (+1 more)

### Community 33 - "Monorepo Workspace Configuration"
Cohesion: 0.17
Nodes (11): engines, node, npm, name, packageManager, private, type, version (+3 more)

### Community 34 - "Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 35 - "Codex — Contexto do CRM Silmer"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 36 - "Telemetry and Health Signals"
Cohesion: 0.18
Nodes (11): telemetry, evidenceRef, signals, source, status, api-5xx, api-latency, api-live-unavailable (+3 more)

### Community 37 - "External Spike Validation"
Cohesion: 0.35
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 38 - "Privacy Provider Compliance"
Cohesion: 0.20
Nodes (10): provider, dataRegion, dpaAccepted, evidenceRef, name, privacyReviewer, retentionDays, reviewedAt (+2 more)

### Community 39 - "Product Context and Backlog"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 40 - "Phase 5: Commercial Flow"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 41 - "README.md"
Cohesion: 0.15
Nodes (8): Sobre o CRM Silmer, Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada, Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 42 - "Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?, Source Nodes

### Community 43 - "Agent Roles and Protocols"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 44 - "Architecture and Modeling Decisions"
Cohesion: 0.25
Nodes (7): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis

### Community 45 - "Q: Como os contratos canonicos do CRM Silmer tratam imagens recebidas e enviadas, anexos validos, Dropbox, retencao P0.6, Cloudflare R2, fim da jornada de compra e exclusao em sete dias?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como os contratos canonicos do CRM Silmer tratam imagens recebidas e enviadas, anexos validos, Dropbox, retencao P0.6, Cloudflare R2, fim da jornada de compra e exclusao em sete dias?, Source Nodes

### Community 46 - "Container Hardening Evidence"
Cohesion: 0.25
Nodes (8): hardening, capabilitiesRemoved, digest, evidenceRef, nonRoot, readOnly, status, temporaryStorageLimited

### Community 47 - "Service Monitoring Status"
Cohesion: 0.25
Nodes (8): monitor, checkIntervalSeconds, consecutiveFailures, evidenceRef, liveUrl, location, monitorId, status

### Community 48 - "Recovery Runbook and Procedures"
Cohesion: 0.25
Nodes (7): Execução externa pendente, Lacunas, donos e prazo-gate, Pre-flight obrigatório, Runbook de recovery off-host — T00.3 / T07.3, Stop conditions, Uso offline por uma segunda pessoa, Tombstone Ledger (T06.3)

### Community 49 - "Project Implementation Phases"
Cohesion: 0.32
Nodes (8): Fase 0, Fase 1, Fase 2, Fase 3, Fase 4, Fase 5, Fase 6, Fase 7

### Community 50 - "Phase 0: Foundation Tasks"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar serviços Silmer no EasyPanel, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 51 - "Phase 2: Inbox and Channels"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 52 - "Phase 0 Approval Gate"
Cohesion: 0.29
Nodes (6): Como registrar uma aprovação real, Defaults aguardando confirmação, Papéis e separação de funções, Resultado local, T00.6 — Gate de aprovação da Fase 0, Verificação

### Community 53 - "Supply Chain Traceability"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 54 - "Threat Model and Catalog"
Cohesion: 0.29
Nodes (6): Aprovação, Catálogo e retenção, Modelo de ameaças, Matriz P0.6, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 55 - "Activation Gate Schema"
Cohesion: 0.29
Nodes (6): drills, issue, $schema, schemaVersion, status, task

### Community 56 - "Escalation and Routing"
Cohesion: 0.29
Nodes (7): routing, criticalEscalationMinutes, destinations, evidenceRef, highEscalationMinutes, ownerIds, status

### Community 57 - "Media Retention Validation"
Cohesion: 0.43
Nodes (4): invariant(), main(), validateMediaRetentionPolicy(), policyUrl

### Community 58 - "Phase 1: Identity and Infra"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 59 - "Phase 3: Business Kanban"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 60 - "Phase 6: Privacy and Ops"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 61 - "Transient Media Controls"
Cohesion: 0.33
Nodes (5): Controles mínimos para T02/T06, Decisão em linguagem natural, Limites desta entrega, T00.4 — Mídia transitória do piloto interno, Verificação

### Community 62 - "Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 63 - "Audit Privacy Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 64 - "Catalog Module Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 65 - "Configuration Module Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 66 - "Identity Access Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 67 - "Integration Reliability Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 68 - "Shared Module Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 69 - "Build and Asset Management"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 70 - "Phase 4: AI Assistant"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 71 - "Phase 7: Hardening and UAT"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 72 - "Edge Web Package"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 73 - "Observability and Hardening Gate"
Cohesion: 0.40
Nodes (4): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local

### Community 74 - "Identity Access Baseline"
Cohesion: 0.40
Nodes (4): Baseline de identidade e acesso da Fase 1, Gates, Invariantes operacionais, Parâmetros versionados

### Community 75 - "Security Policy and Dependabot"
Cohesion: 0.40
Nodes (4): Dependabot Configuration, Como reportar uma vulnerabilidade, Política de segurança, Versões suportadas

### Community 76 - "Human Approval Evidence"
Cohesion: 0.40
Nodes (5): completion, approvedAt, approvedBy, evidenceRef, humanApproved

### Community 77 - "Workspace Boundary Checks"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 78 - "Edge Server Utility"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 79 - "PR Review and Phases"
Cohesion: 0.50
Nodes (4): Jules PR Review, Phase 1: Identity & Access, Phase 6: Privacy & Ops, Security & LGPD

### Community 80 - "AI Authority Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 81 - "Product Readiness Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 82 - "AI Autonomy Limits"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 83 - "Tech Lead Readiness Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 84 - "Ficha Numbering Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 85 - "FAB and Sequence Logic"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 86 - "Role Modeling Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 87 - "Accessibility Requirements Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais requisitos, tarefas, arquivos, contratos de acessibilidade, segurança e critérios de aceite estão relacionados à GitHub Issue #1?, Source Nodes

### Community 88 - "Acceptance Criteria Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual requisito, tarefa, arquivos e critérios de aceite correspondem à issue GitHub #2 deste repositório?, Source Nodes

### Community 89 - "Scope and Dependency Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual é o escopo, os requisitos, as dependências, os critérios de aceite e as evidências esperadas da issue 6 do CRM Silmer?, Source Nodes

### Community 90 - "Implementation Plan Tasks"
Cohesion: 0.50
Nodes (3): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico

### Community 92 - "CI Image Tests"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

### Community 93 - "Technical Foundation Summary"
Cohesion: 0.67
Nodes (3): Technical Baseline, Phase 0: Foundation, TDD Summary

### Community 141 - "integration-reliability/src/index.js"
Cohesion: 0.10
Nodes (25): canonicalJson(), clone(), createDeferred(), createIdempotentCommandExecutor(), fingerprintCommand(), IdempotencyConflictError, InMemoryIdempotencyRecordStore, requireNonEmpty() (+17 more)

### Community 142 - "observability-live-probe.mjs"
Cohesion: 0.42
Nodes (11): assertSafeProbeEvidence(), canonicalLiveUrl(), invariant(), main(), observeApiTransition(), positiveInteger(), probeLiveEndpoint(), required() (+3 more)

### Community 143 - "worker/package.json"
Cohesion: 0.20
Nodes (9): dependencies, @crm-silmer/shared, @crm-silmer/shared, name, private, scripts, start, type (+1 more)

### Community 144 - "T00.4 — Spikes externos"
Cohesion: 0.25
Nodes (8): Cloudflare R2 Integration, Decisões seguras, Evidências e pendências externas, Gemini Developer API Integration, Meta Sandbox Validation, Resultado local, T00.4 — Spikes externos, Verificação

### Community 145 - "T00.7 — Ativação e drills de observabilidade"
Cohesion: 0.25
Nodes (7): Baseline não destrutiva, Drill controlado da API, Drills dos sinais internos, Hardening do digest promovido, Promoção da evidência, Pré-requisitos humanos e externos, T00.7 — Ativação e drills de observabilidade

### Community 146 - "T00.4 - Revisao do PDF canonico da Ficha"
Cohesion: 0.29
Nodes (7): Estado do gate, Ficha Canonical V2, Geracao e verificacao tecnica, Pacote versionado, Registro do aceite real, Roteiro executado por Rose e Operacao, T00.4 - Revisao do PDF canonico da Ficha

### Community 147 - "Dívida #29 — Aprovação e validação futura do Cloudflare R2"
Cohesion: 0.29
Nodes (7): Contrato candidato para implementação futura, Critérios live obrigatórios, Dívida #29 — Aprovação e validação futura do Cloudflare R2, Estado do gate, Procedimento live, Reconciliação de `PutObject` incerto, Verificação local

### Community 148 - "Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?, Source Nodes

### Community 149 - "Q: Quais dependências e critérios verificáveis da issue 5 ainda podem ser concluídos sem aceite humano, credenciais OpenAI ou designação do Tech Lead?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais dependências e critérios verificáveis da issue 5 ainda podem ser concluídos sem aceite humano, credenciais OpenAI ou designação do Tech Lead?, Source Nodes

### Community 150 - "Q: Qual modelo Gemini oferece o melhor custo-beneficio para os chats do CRM Silmer na issue 5?"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual modelo Gemini oferece o melhor custo-beneficio para os chats do CRM Silmer na issue 5?, Source Nodes

### Community 151 - "Q: Quais evidencias ainda bloqueiam o fechamento da issue 5 apos o merge do PR 26?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais evidencias ainda bloqueiam o fechamento da issue 5 apos o merge do PR 26?, Source Nodes

## Knowledge Gaps
- **694 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+689 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **48 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CRM Silmer MVP — Plano de Implementação` connect `Implementation Plan Tasks` to `Phase 4: AI Assistant`, `Phase 7: Hardening and UAT`, `Phase 5: Commercial Flow`, `Phase 0: Foundation Tasks`, `Phase 2: Inbox and Channels`, `Phase 1: Identity and Infra`, `Phase 3: Business Kanban`, `Phase 6: Privacy and Ops`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `TDD and Project Strategy` to `README.md`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _694 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `observability.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08571428571428572 - nodes in this community are weakly interconnected._
- **Should `TDD and Project Strategy` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Database Immutability and Protection` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._
- **Should `Configuration Service and Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.1141025641025641 - nodes in this community are weakly interconnected._
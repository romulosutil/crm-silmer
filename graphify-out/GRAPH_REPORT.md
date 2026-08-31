# Graph Report - crm-silmer  (2026-08-31)

## Corpus Check
- 144 files · ~82,095 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1135 nodes · 1478 edges · 105 communities (89 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d7ac367e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- integration-reliability/src/index.js
- Audit Trail and Idempotency
- CRM Sales Process
- MVP Implementation Strategy
- Database Security Policies
- Configuration Service
- Design System Guidelines
- database/src/index.js
- System Architecture Decisions
- Product to Tech Handoff
- System Recovery Planning
- Catalog Management Service
- scripts
- TypeScript Configuration
- API Service Dependencies
- MVP Product Specification
- Identity and Access Management
- AI Privacy Smoke Tests
- MVP Implementation Roadmap
- Development Tooling
- Phase 0 Decision Validation
- Database Package Configuration
- Monitoring and Alerts
- Integration Manifests
- Access Control Logic
- Monorepo Workspace Root
- External Spike Validation
- Project Documentation Rules
- External API Spikes
- Security Catalog Validation
- Product Context and Scope
- Phase 5: Payments and Orders
- Team Roles and Responsibilities
- Recovery Runbook
- Phase 0: Technical Foundation
- Phase 2: Inbox and Channels
- Contribution Guidelines
- Phase 0 Approval Gate
- Supply Chain Security
- Phase 1: Domain Infrastructure
- Phase 3: Kanban and Deals
- Phase 6: Privacy and Ops
- Meta Sandbox Evidence
- Threat Modeling
- Audit Privacy Package
- Catalog Package
- Configuration Package
- Identity Access Package
- Integration Reliability Package
- Shared Utilities Package
- Build System
- Phase 4: AI Assistant
- Phase 7: Hardening and UAT
- Edge Web Package
- Project Guardrails
- Observability and Hardening
- Identity Access Baseline
- Security Policy
- Workspace Boundary Checks
- Edge Server Implementation
- Project Onboarding
- Implementation Task List
- Bootstrap Tests
- CI Image Tests
- r2-live-smoke.mjs
- Prettier Configuration
- Edge Web Application
- ESLint Configuration
- Qualification Flow Reference
- PostgreSQL Database Module
- Database Documentation
- Project Espectro MVP
- PR Review Workflow
- Deployment Workflow
- Shared Modules
- Cloud Storage
- API Container
- Edge Web Container
- Postgres Container
- Worker Container
- Worker Service Dependencies
- T00.4 — Aprovação e validação do Cloudflare R2
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
- Q: Quais requisitos, tarefas, arquivos, contratos de acessibilidade, segurança e critérios de aceite estão relacionados à GitHub Issue #1?
- Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?
- Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?
- Q: Qual requisito, tarefa, arquivos e critérios de aceite correspondem à issue GitHub #2 deste repositório?
- Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?
- Q: Quais dependências e critérios verificáveis da issue 5 ainda podem ser concluídos sem aceite humano, credenciais OpenAI ou designação do Tech Lead?
- Q: Qual modelo Gemini oferece o melhor custo-beneficio para os chats do CRM Silmer na issue 5?
- Q: Como a baseline Gemini Developer API da issue 5 controla modelo, tier pago, ZDR, PII, persistencia e saida estruturada?
- Q: Quais evidencias ainda bloqueiam o fechamento da issue 5 apos o merge do PR 26?
- Q: Qual é o escopo, os requisitos, as dependências, os critérios de aceite e as evidências esperadas da issue 6 do CRM Silmer?

## God Nodes (most connected - your core abstractions)
1. `scripts` - 32 edges
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
- `Vendedor Silmer (AI Agent)` --calls--> `Kanban Comercial`  [AMBIGUOUS]
  .specs/features/crm-mvp/context.md → CRM-MVP-ESPECIFICACAO.md
- `Vendedor Silmer (AI Agent)` --calls--> `Caixa de Entrada (Backlog)`  [INFERRED]
  .specs/features/crm-mvp/context.md → CRM-MVP-ESPECIFICACAO.md
- `Vendedor Silmer (AI Agent)` --references--> `Crazy API (WhatsApp)`  [INFERRED]
  .specs/features/crm-mvp/context.md → historico-datacrazy/DATACRAZY-SETUP.md
- `harness()` --calls--> `createCatalogService()`  [EXTRACTED]
  test/catalog.test.js → modules/catalog/src/application/catalog-service.js
- `createHarness()` --calls--> `createConfigurationService()`  [EXTRACTED]
  test/configuration.test.js → modules/configuration/src/application/configuration-service.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 0 Technical Enablers** — docs_phase0_supply_chain, docs_phase0_external_spikes, docs_phase0_threat_model_and_data_catalog, docs_phase0_phase_0_approval_gate, docs_phase0_observability_and_hardening [EXTRACTED 1.00]
- **Modular Monolith Applications** — apps_api, apps_worker, apps_edge_web [EXTRACTED 1.00]
- **Vendedor Silmer Integration Flow** — vendedor_silmer, meta_whatsapp_api, google_gemini_api [INFERRED 0.85]
- **Modular Monolith Processes** — apps_edge_web, apps_api, apps_worker [EXTRACTED 1.00]
- **External Integration Adapters** — s3_storage [EXTRACTED 1.00]
- **Core Transactional Flow** — apps_api, apps_worker, postgresql [INFERRED 0.80]
- **CRM Silmer Core Commercial Flow** — caixa_entrada, kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Documentation Precedence Hierarchy** — rules, specs_features_crm_mvp_spec, crm_mvp_especificacao, technical_design, architecture [EXTRACTED 1.00]
- **Espectro MVP Recovery Services** — silmer_api, silmer_worker, silmer_postgres, silmer_edge_web [EXTRACTED 1.00]
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]

## Communities (105 total, 16 thin omitted)

### Community 0 - "integration-reliability/src/index.js"
Cohesion: 0.06
Nodes (43): createApi(), createMetaWebhookRuntime(), createServerApi(), WorkerRuntime, createMetaMessagesClient(), deepFreeze(), extractMetaEvents(), immutableClone() (+35 more)

### Community 1 - "Audit Trail and Idempotency"
Cohesion: 0.13
Nodes (16): AuditEventValidationError, deepFreeze(), immutableClone(), InMemoryAuditTrail, requireNonEmptyString(), validateAuditEvent(), canonicalJson(), clone() (+8 more)

### Community 2 - "CRM Sales Process"
Cohesion: 0.05
Nodes (39): Caixa de Entrada (Backlog), Crazy API (WhatsApp), Datacrazy CRM, Ficha de Pedido, 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação (+31 more)

### Community 3 - "MVP Implementation Strategy"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 4 - "Database Security Policies"
Cohesion: 0.09
Nodes (37): crm_meta.protect_catalog_entry, crm_meta.protect_catalog_version, crm_meta.protect_idempotency_record, crm_meta.reject_immutable_change, audit_events_immutable_rows, audit_events_immutable_truncate, catalog_materials_immutable_truncate, catalog_materials_protect_rows (+29 more)

### Community 5 - "Configuration Service"
Cohesion: 0.11
Nodes (27): createConfigurationService(), assertChannels(), assertExactKeys(), assertFab(), assertFeatureFlags(), assertJsonValue(), assertNonEmptyString(), assertPix() (+19 more)

### Community 6 - "Design System Guidelines"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 7 - "database/src/index.js"
Cohesion: 0.10
Nodes (17): pool, checkDatabaseReadiness(), createDatabase(), applyMigration(), checksum(), ensureDirectoryUrl(), loadMigrations(), migrate() (+9 more)

### Community 8 - "System Architecture Decisions"
Cohesion: 0.06
Nodes (34): API Application, Edge Web Application, Worker Application, Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline (+26 more)

### Community 9 - "Product to Tech Handoff"
Cohesion: 0.06
Nodes (34): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+26 more)

### Community 10 - "System Recovery Planning"
Cohesion: 0.13
Nodes (28): buildRecoveryPlan(), expectedAdapterKeys, expectedBlockerKeys, expectedCadenceEntryKeys, expectedCadenceKeys, expectedDigestKeys, expectedGateKeys, expectedRecoveryCheckKeys (+20 more)

### Community 11 - "Catalog Management Service"
Cohesion: 0.16
Nodes (18): createCatalogService(), assertExactKeys(), assertNonEmptyString(), assertRecord(), createCatalogSelection(), createPublishedCatalogVersion(), deepFreeze(), immutableCatalogClone() (+10 more)

### Community 12 - "scripts"
Cohesion: 0.06
Nodes (32): scripts, build, check:boundaries, db:migrate, format, format:check, lint, preview (+24 more)

### Community 13 - "TypeScript Configuration"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 14 - "API Service Dependencies"
Cohesion: 0.12
Nodes (15): dependencies, @crm-silmer/database, @crm-silmer/integration-reliability, @crm-silmer/shared, fastify, @crm-silmer/shared, name, private (+7 more)

### Community 15 - "MVP Product Specification"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 16 - "Identity and Access Management"
Cohesion: 0.16
Nodes (14): constantTimeEqual(), createIdentityAccessService(), createInMemoryIdentityRepository(), DEFAULT_PASSWORD_PARAMETERS, deriveArgon2(), digest(), FUNCTIONS, hashPassword() (+6 more)

### Community 17 - "AI Privacy Smoke Tests"
Cohesion: 0.22
Nodes (17): APPROVED_MODEL, APPROVED_PROVIDER, APPROVED_SUGGESTION_SCHEMA, buildEndpoint(), buildRequest(), containsPii(), extractOutputText(), invariant() (+9 more)

### Community 18 - "MVP Implementation Roadmap"
Cohesion: 0.12
Nodes (16): CRM MVP - Implementation Plan, Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido (+8 more)

### Community 19 - "Development Tooling"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 20 - "Phase 0 Decision Validation"
Cohesion: 0.24
Nodes (12): expectedDecisionSubjects, expectedRoles, invariant(), isCorporateId(), isIsoDate(), isVersionedEvidence(), main(), validateApproval() (+4 more)

### Community 21 - "Database Package Configuration"
Cohesion: 0.14
Nodes (13): dependencies, pg, devDependencies, @types/pg, exports, name, private, scripts (+5 more)

### Community 22 - "Monitoring and Alerts"
Cohesion: 0.15
Nodes (12): alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner, status (+4 more)

### Community 23 - "Integration Manifests"
Cohesion: 0.15
Nodes (12): gemini, schemaFixture, meta, messageFixture, signature, statusFixture, schemaVersion, appSecret (+4 more)

### Community 24 - "Access Control Logic"
Cohesion: 0.24
Nodes (9): actionCapabilities, authorize(), CAPABILITIES, createAccessControlService(), knownCapabilities, mfaRequiredCapabilities, operationalActions, harness() (+1 more)

### Community 25 - "Monorepo Workspace Root"
Cohesion: 0.17
Nodes (11): engines, node, npm, name, packageManager, private, type, version (+3 more)

### Community 26 - "External Spike Validation"
Cohesion: 0.35
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 27 - "Project Documentation Rules"
Cohesion: 0.24
Nodes (5): Sobre o CRM Silmer, Datacrazy Historical Archive, Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 28 - "External API Spikes"
Cohesion: 0.20
Nodes (8): Cloudflare R2, Decisões seguras, Evidências e pendências externas, Resultado local, T00.4 — Spikes externos, Verificação, Google Gemini Developer API, Meta WhatsApp Business API

### Community 29 - "Security Catalog Validation"
Cohesion: 0.33
Nodes (7): invariant(), main(), requiredFamilies, retention, validateDataCatalog(), validateThreatModel(), rootUrl

### Community 30 - "Product Context and Scope"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 31 - "Phase 5: Payments and Orders"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 32 - "Team Roles and Responsibilities"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 33 - "Recovery Runbook"
Cohesion: 0.25
Nodes (7): Execução externa pendente, Lacunas, donos e prazo-gate, Pre-flight obrigatório, Runbook de recovery off-host — T00.3 / T07.3, Stop conditions, Uso offline por uma segunda pessoa, Tombstone Ledger (T06.3)

### Community 34 - "Phase 0: Technical Foundation"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar serviços Silmer no EasyPanel, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 35 - "Phase 2: Inbox and Channels"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 36 - "Contribution Guidelines"
Cohesion: 0.29
Nodes (6): Antes de alterar, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Governança do repositório público, Validação

### Community 37 - "Phase 0 Approval Gate"
Cohesion: 0.29
Nodes (6): Como registrar uma aprovação real, Defaults aguardando confirmação, Papéis e separação de funções, Resultado local, T00.6 — Gate de aprovação da Fase 0, Verificação

### Community 38 - "Supply Chain Security"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 39 - "Phase 1: Domain Infrastructure"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 40 - "Phase 3: Kanban and Deals"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 41 - "Phase 6: Privacy and Ops"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 42 - "Meta Sandbox Evidence"
Cohesion: 0.33
Nodes (6): Ativos selecionados, Escopo e limite, Evidência de fechamento, Segredos e dados locais, Sequência operacional, T00.4 — Sandbox da Meta

### Community 43 - "Threat Modeling"
Cohesion: 0.33
Nodes (5): Aprovação, Catálogo e retenção, Modelo de ameaças, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 44 - "Audit Privacy Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 45 - "Catalog Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 46 - "Configuration Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 47 - "Identity Access Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 48 - "Integration Reliability Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 49 - "Shared Utilities Package"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 50 - "Build System"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 51 - "Phase 4: AI Assistant"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 52 - "Phase 7: Hardening and UAT"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 53 - "Edge Web Package"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 54 - "Project Guardrails"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 55 - "Observability and Hardening"
Cohesion: 0.40
Nodes (4): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local

### Community 56 - "Identity Access Baseline"
Cohesion: 0.40
Nodes (4): Baseline de identidade e acesso da Fase 1, Gates, Invariantes operacionais, Parâmetros versionados

### Community 57 - "Security Policy"
Cohesion: 0.40
Nodes (4): Dependabot Configuration, Como reportar uma vulnerabilidade, Política de segurança, Versões suportadas

### Community 58 - "Workspace Boundary Checks"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 59 - "Edge Server Implementation"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 60 - "Project Onboarding"
Cohesion: 0.50
Nodes (4): Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada

### Community 61 - "Implementation Task List"
Cohesion: 0.50
Nodes (3): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico

### Community 63 - "CI Image Tests"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

### Community 64 - "r2-live-smoke.mjs"
Cohesion: 0.11
Nodes (33): assertNoS3ObjectLockHeaders(), assertSafeR2Evidence(), awsDate(), awsEncode(), awsTimestamp(), BUCKETS, canonicalObjectPath(), canonicalQuery() (+25 more)

### Community 83 - "Worker Service Dependencies"
Cohesion: 0.20
Nodes (9): dependencies, @crm-silmer/shared, @crm-silmer/shared, name, private, scripts, start, type (+1 more)

### Community 84 - "T00.4 — Aprovação e validação do Cloudflare R2"
Cohesion: 0.25
Nodes (7): Contrato aprovado para implementação, Critérios live obrigatórios, Estado do gate, Procedimento live, Reconciliação de `PutObject` incerto, T00.4 — Aprovação e validação do Cloudflare R2, Verificação local

### Community 85 - "Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 86 - "Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 87 - "Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 88 - "Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 89 - "Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 90 - "Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 91 - "Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 92 - "Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 93 - "Q: Como o P0.7 modela Admin, Atendimento e Vendedor?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 94 - "Q: Where are the agent roles and contribution protocol defined?"
Cohesion: 0.50
Nodes (3): Answer, Q: Where are the agent roles and contribution protocol defined?, Source Nodes

### Community 95 - "Q: Quais requisitos, tarefas, arquivos, contratos de acessibilidade, segurança e critérios de aceite estão relacionados à GitHub Issue #1?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais requisitos, tarefas, arquivos, contratos de acessibilidade, segurança e critérios de aceite estão relacionados à GitHub Issue #1?, Source Nodes

### Community 96 - "Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?, Source Nodes

### Community 97 - "Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como integrar o arquivo pr-review.yml para que o Google Jules valide pull requests, respeitando requisitos, tarefas e automacoes GitHub existentes?, Source Nodes

### Community 98 - "Q: Qual requisito, tarefa, arquivos e critérios de aceite correspondem à issue GitHub #2 deste repositório?"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual requisito, tarefa, arquivos e critérios de aceite correspondem à issue GitHub #2 deste repositório?, Source Nodes

### Community 99 - "Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o gate da issue 3 impede falso passed e distingue T00.3 de T07.3?, Source Nodes

### Community 100 - "Q: Quais dependências e critérios verificáveis da issue 5 ainda podem ser concluídos sem aceite humano, credenciais OpenAI ou designação do Tech Lead?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais dependências e critérios verificáveis da issue 5 ainda podem ser concluídos sem aceite humano, credenciais OpenAI ou designação do Tech Lead?, Source Nodes

### Community 101 - "Q: Qual modelo Gemini oferece o melhor custo-beneficio para os chats do CRM Silmer na issue 5?"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual modelo Gemini oferece o melhor custo-beneficio para os chats do CRM Silmer na issue 5?, Source Nodes

### Community 102 - "Q: Como a baseline Gemini Developer API da issue 5 controla modelo, tier pago, ZDR, PII, persistencia e saida estruturada?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a baseline Gemini Developer API da issue 5 controla modelo, tier pago, ZDR, PII, persistencia e saida estruturada?, Source Nodes

### Community 103 - "Q: Quais evidencias ainda bloqueiam o fechamento da issue 5 apos o merge do PR 26?"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais evidencias ainda bloqueiam o fechamento da issue 5 apos o merge do PR 26?, Source Nodes

### Community 104 - "Q: Qual é o escopo, os requisitos, as dependências, os critérios de aceite e as evidências esperadas da issue 6 do CRM Silmer?"
Cohesion: 0.50
Nodes (3): Answer, Q: Qual é o escopo, os requisitos, as dependências, os critérios de aceite e as evidências esperadas da issue 6 do CRM Silmer?, Source Nodes

## Ambiguous Edges - Review These
- `Vendedor Silmer (AI Agent)` → `Kanban Comercial`  [AMBIGUOUS]
  CRM-MVP-ESPECIFICACAO.md · relation: calls

## Knowledge Gaps
- **578 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+573 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Vendedor Silmer (AI Agent)` and `Kanban Comercial`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `CRM Silmer MVP — Plano de Implementação` connect `Implementation Task List` to `Phase 0: Technical Foundation`, `Phase 2: Inbox and Channels`, `Phase 1: Domain Infrastructure`, `Phase 3: Kanban and Deals`, `Phase 6: Privacy and Ops`, `Phase 4: AI Assistant`, `Phase 7: Hardening and UAT`, `Phase 5: Payments and Orders`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `MVP Implementation Strategy` to `System Architecture Decisions`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `MVP Product Specification` to `CRM Sales Process`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _578 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `integration-reliability/src/index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06142410015649452 - nodes in this community are weakly interconnected._
- **Should `Audit Trail and Idempotency` be split into smaller, more focused modules?**
  _Cohesion score 0.12561576354679804 - nodes in this community are weakly interconnected._
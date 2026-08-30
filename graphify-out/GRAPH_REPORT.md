# Graph Report - .  (2026-08-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 990 nodes · 1227 edges · 87 communities (80 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.7)
- Token cost: 4,792 input · 971 output

## Graph Freshness
- Built from commit: `81b5caa8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- MVP Technical Strategy
- Design System Guidelines
- Foundation Phase Tasks
- Sales Process Qualification
- Product to Tech Handoff
- MVP Product Specification
- Infrastructure Topology
- MVP Feature Scope
- MVP Traceable Requirements
- Development Scripts
- Product Context Backlog
- TypeScript Configuration
- Recovery Validation Tools
- Order and Payment Implementation
- API Package Definition
- Security Catalog Validation
- Product and Technical Rules
- Architecture Decision Records
- Contribution Guidelines
- External Spike Documentation
- Threat Model Documentation
- Project Documentation Index
- Project Codex and Guardrails
- Project Onboarding
- Agent Roles and Protocols
- Qualification Flow Reference
- AI Suggestion Schema
- Development Dependencies
- Server and Worker Runtime
- Worker Package Definition
- Shared Module Definition
- Build System Scripts
- Web Frontend Definition
- Workspace Boundary Checks
- Decision Validation Tests
- Bootstrap Tests
- Prettier Formatting Config
- Edge App Entrypoint
- ESLint Configuration
- Phase 0 Approval Gate
- Edge Web Server
- CI Image Tests
- Recovery Runbook
- Integration Fixtures
- External Spike Validation
- Messaging and Inbox Implementation
- Supply Chain Security
- Identity and Domain Phase
- Sales Pipeline Implementation
- Privacy and Operations Phase
- AI Assistant Implementation
- Hardening and Pilot Phase
- Implementation Roadmap
- Monitoring and Alerts
- Observability Baseline
- AI Authority Decisions
- Product Readiness Queries
- AI Autonomy Analysis
- Admin Modeling Queries
- Technical Readiness Queries
- Data Retention Queries
- Concurrency Logic Queries
- Readiness Resolution Queries
- Role Modeling Queries
- Agent Protocol Queries
- Database Schema Protection
- Configuration Service
- Database Migration Utilities
- Audit and Idempotency
- Catalog Management Service
- Identity and Access Service
- Database Package Definition
- Access Control Authorization
- Monorepo Workspace Root
- Audit Module Definition
- Catalog Module Definition
- Configuration Module Definition
- Identity Module Definition
- Reliability Module Definition
- Identity Access Baseline
- Database Module Documentation
- Security Policy
- Accessibility Requirement Queries
- Repository Security Queries

## God Nodes (most connected - your core abstractions)
1. `scripts` - 26 edges
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
- `harness()` --calls--> `createCatalogService()`  [EXTRACTED]
  test/catalog.test.js → modules/catalog/src/application/catalog-service.js
- `createHarness()` --calls--> `createConfigurationService()`  [EXTRACTED]
  test/configuration.test.js → modules/configuration/src/application/configuration-service.js
- `capture()` --calls--> `createSafeLogger()`  [EXTRACTED]
  test/observability.test.js → modules/shared/src/observability.js
- `createApi()` --calls--> `createSafeLogger()`  [EXTRACTED]
  apps/api/src/app.js → modules/shared/src/observability.js
- `createApi()` --calls--> `normalizeTraceId()`  [EXTRACTED]
  apps/api/src/app.js → modules/shared/src/observability.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — caixa_de_entrada, kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]
- **Migração do Datacrazy para CRM Próprio** — historico_datacrazy_crm_processo_vendas, historico_datacrazy_datacrazy_setup, specs_features_crm_mvp_context, specs_features_crm_mvp_spec [INFERRED 0.85]

## Communities (87 total, 7 thin omitted)

### Community 0 - "MVP Technical Strategy"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 1 - "Design System Guidelines"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 2 - "Foundation Phase Tasks"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar EasyPanel dev/hml/prod, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 3 - "Sales Process Qualification"
Cohesion: 0.06
Nodes (33): 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano, 7. O que a IA e o vendedor nunca afirmam, 8. Pendências que travam o processo hoje (+25 more)

### Community 4 - "Product to Tech Handoff"
Cohesion: 0.06
Nodes (34): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+26 more)

### Community 5 - "MVP Product Specification"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 6 - "Infrastructure Topology"
Cohesion: 0.09
Nodes (22): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços por projeto, 3. Rede e domínios (+14 more)

### Community 7 - "MVP Feature Scope"
Cohesion: 0.40
Nodes (5): Caixa de Entrada (Backlog), Ficha de Pedido, Kanban Comercial, Rose (Destinatária Ficha), Vendedor Silmer (Agente IA)

### Community 8 - "MVP Traceable Requirements"
Cohesion: 0.12
Nodes (15): Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido, P1.4 Confiabilidade e canais (+7 more)

### Community 9 - "Development Scripts"
Cohesion: 0.08
Nodes (26): scripts, build, check:boundaries, db:migrate, format, format:check, lint, preview (+18 more)

### Community 10 - "Product Context Backlog"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 11 - "TypeScript Configuration"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 12 - "Recovery Validation Tools"
Cohesion: 0.18
Nodes (15): buildRecoveryPlan(), expectedAdapterKeys, expectedDigestKeys, invariant(), main(), validateRecoveryKit(), expectedEnvironments, expectedProjects (+7 more)

### Community 13 - "Order and Payment Implementation"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 14 - "API Package Definition"
Cohesion: 0.14
Nodes (13): dependencies, @crm-silmer/database, @crm-silmer/shared, fastify, @crm-silmer/shared, name, private, scripts (+5 more)

### Community 15 - "Security Catalog Validation"
Cohesion: 0.33
Nodes (7): invariant(), main(), requiredFamilies, retention, validateDataCatalog(), validateThreatModel(), rootUrl

### Community 16 - "Product and Technical Rules"
Cohesion: 0.67
Nodes (3): Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 17 - "Architecture Decision Records"
Cohesion: 0.29
Nodes (7): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis

### Community 18 - "Contribution Guidelines"
Cohesion: 0.29
Nodes (6): Antes de alterar, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Governança do repositório público, Validação

### Community 19 - "External Spike Documentation"
Cohesion: 0.33
Nodes (5): Decisões seguras, Evidências e pendências externas, Resultado local, T00.4 — Spikes externos, Verificação

### Community 20 - "Threat Model Documentation"
Cohesion: 0.33
Nodes (5): Aprovação, Catálogo e retenção, Modelo de ameaças, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 22 - "Project Codex and Guardrails"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 23 - "Project Onboarding"
Cohesion: 0.50
Nodes (4): Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada

### Community 24 - "Agent Roles and Protocols"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 26 - "AI Suggestion Schema"
Cohesion: 0.06
Nodes (33): field, fieldSuggestions, handoffRequired, null, reply, source, stageSuggestion, string (+25 more)

### Community 27 - "Development Dependencies"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 28 - "Server and Worker Runtime"
Cohesion: 0.09
Nodes (27): createApi(), createServerApi(), WorkerRuntime, SERVICES, allowedContextFields, allowedEvents, allowedMetrics, allowedServices (+19 more)

### Community 29 - "Worker Package Definition"
Cohesion: 0.20
Nodes (9): dependencies, @crm-silmer/shared, @crm-silmer/shared, name, private, scripts, start, type (+1 more)

### Community 30 - "Shared Module Definition"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 31 - "Build System Scripts"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 32 - "Web Frontend Definition"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 33 - "Workspace Boundary Checks"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 34 - "Decision Validation Tests"
Cohesion: 0.24
Nodes (12): expectedDecisionSubjects, expectedRoles, invariant(), isCorporateId(), isIsoDate(), isVersionedEvidence(), main(), validateApproval() (+4 more)

### Community 39 - "Phase 0 Approval Gate"
Cohesion: 0.29
Nodes (6): Como registrar uma aprovação real, Defaults aguardando confirmação, Papéis e separação de funções, Resultado local, T00.6 — Gate de aprovação da Fase 0, Verificação

### Community 40 - "Edge Web Server"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 41 - "CI Image Tests"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

### Community 44 - "Recovery Runbook"
Cohesion: 0.50
Nodes (3): Execução externa pendente, Runbook de recovery off-host — T00.3, Uso offline por uma segunda pessoa

### Community 45 - "Integration Fixtures"
Cohesion: 0.15
Nodes (12): meta, messageFixture, signature, statusFixture, openai, schemaFixture, schemaVersion, appSecret (+4 more)

### Community 46 - "External Spike Validation"
Cohesion: 0.40
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 47 - "Messaging and Inbox Implementation"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 48 - "Supply Chain Security"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 49 - "Identity and Domain Phase"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 50 - "Sales Pipeline Implementation"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 51 - "Privacy and Operations Phase"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 52 - "AI Assistant Implementation"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 53 - "Hardening and Pilot Phase"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 54 - "Implementation Roadmap"
Cohesion: 0.67
Nodes (3): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico

### Community 55 - "Monitoring and Alerts"
Cohesion: 0.15
Nodes (12): alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner, status (+4 more)

### Community 56 - "Observability Baseline"
Cohesion: 0.40
Nodes (4): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local

### Community 57 - "AI Authority Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 58 - "Product Readiness Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 59 - "AI Autonomy Analysis"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 60 - "Admin Modeling Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 61 - "Technical Readiness Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 62 - "Data Retention Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 63 - "Concurrency Logic Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 64 - "Readiness Resolution Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 65 - "Role Modeling Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 66 - "Agent Protocol Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Where are the agent roles and contribution protocol defined?, Source Nodes

### Community 67 - "Database Schema Protection"
Cohesion: 0.09
Nodes (37): crm_meta.protect_catalog_entry, crm_meta.protect_catalog_version, crm_meta.protect_idempotency_record, crm_meta.reject_immutable_change, audit_events_immutable_rows, audit_events_immutable_truncate, catalog_materials_immutable_truncate, catalog_materials_protect_rows (+29 more)

### Community 68 - "Configuration Service"
Cohesion: 0.11
Nodes (27): createConfigurationService(), assertChannels(), assertExactKeys(), assertFab(), assertFeatureFlags(), assertJsonValue(), assertNonEmptyString(), assertPix() (+19 more)

### Community 69 - "Database Migration Utilities"
Cohesion: 0.10
Nodes (17): pool, checkDatabaseReadiness(), createDatabase(), applyMigration(), checksum(), ensureDirectoryUrl(), loadMigrations(), migrate() (+9 more)

### Community 70 - "Audit and Idempotency"
Cohesion: 0.13
Nodes (16): AuditEventValidationError, deepFreeze(), immutableClone(), InMemoryAuditTrail, requireNonEmptyString(), validateAuditEvent(), canonicalJson(), clone() (+8 more)

### Community 71 - "Catalog Management Service"
Cohesion: 0.16
Nodes (18): createCatalogService(), assertExactKeys(), assertNonEmptyString(), assertRecord(), createCatalogSelection(), createPublishedCatalogVersion(), deepFreeze(), immutableCatalogClone() (+10 more)

### Community 72 - "Identity and Access Service"
Cohesion: 0.16
Nodes (14): constantTimeEqual(), createIdentityAccessService(), createInMemoryIdentityRepository(), DEFAULT_PASSWORD_PARAMETERS, deriveArgon2(), digest(), FUNCTIONS, hashPassword() (+6 more)

### Community 73 - "Database Package Definition"
Cohesion: 0.14
Nodes (13): dependencies, pg, devDependencies, @types/pg, exports, name, private, scripts (+5 more)

### Community 74 - "Access Control Authorization"
Cohesion: 0.24
Nodes (9): actionCapabilities, authorize(), CAPABILITIES, createAccessControlService(), knownCapabilities, mfaRequiredCapabilities, operationalActions, harness() (+1 more)

### Community 75 - "Monorepo Workspace Root"
Cohesion: 0.17
Nodes (11): engines, node, npm, name, packageManager, private, type, version (+3 more)

### Community 76 - "Audit Module Definition"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 77 - "Catalog Module Definition"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 78 - "Configuration Module Definition"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 79 - "Identity Module Definition"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 80 - "Reliability Module Definition"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 81 - "Identity Access Baseline"
Cohesion: 0.40
Nodes (4): Baseline de identidade e acesso da Fase 1, Gates, Invariantes operacionais, Parâmetros versionados

### Community 84 - "Security Policy"
Cohesion: 0.50
Nodes (3): Como reportar uma vulnerabilidade, Política de segurança, Versões suportadas

### Community 85 - "Accessibility Requirement Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais requisitos, tarefas, arquivos, contratos de acessibilidade, segurança e critérios de aceite estão relacionados à GitHub Issue #1?, Source Nodes

### Community 86 - "Repository Security Queries"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais contratos do CRM Silmer governam segurança do repositório público, GitHub Actions, imagens imutáveis, aprovação, publicação no GHCR e fechamento da T00.2 Issue 1?, Source Nodes

## Knowledge Gaps
- **529 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+524 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CRM Silmer MVP — Plano de Implementação` connect `Implementation Roadmap` to `Foundation Phase Tasks`, `Order and Payment Implementation`, `Messaging and Inbox Implementation`, `Identity and Domain Phase`, `Sales Pipeline Implementation`, `Privacy and Operations Phase`, `AI Assistant Implementation`, `Project Documentation Index`, `Hardening and Pilot Phase`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `MVP Technical Strategy` to `Project Documentation Index`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `MVP Product Specification` to `MVP Feature Scope`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _529 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `MVP Technical Strategy` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Design System Guidelines` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `Sales Process Qualification` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
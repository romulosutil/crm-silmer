# Graph Report - crm-silmer-t02-4  (2026-09-02)

## Corpus Check
- 208 files · ~149,706 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1841 nodes · 2935 edges · 156 communities (110 shown, 46 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cbae11e8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- integration-reliability/src/index.js
- PostgresTransientMediaRepository
- TDD — CRM Silmer MVP
- 0002_phase1_domain.expand.sql
- configuration-version.js
- scripts
- r2-live-smoke.mjs
- CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)
- Design do CRM Silmer
- database/src/index.js
- T00.4 — Spikes externos
- recovery-mock.mjs
- audit-privacy/src/index.js
- meta-whatsapp.js
- dependencies
- ficha-pdf-review.mjs
- compilerOptions
- Topologia EasyPanel — CRM Silmer
- identity-access/src/index.js
- Campos da Ficha e Jornada Conversacional — P0.1
- CRM Silmer — Especificação de Produto do MVP
- identity-access.md
- gemini-privacy-smoke.mjs
- edge-web/src/app.js
- authorization.js
- validate-security-catalog.mjs
- devDependencies
- observability-live-probe.mjs
- validate-phase0-decisions.mjs
- CRM Silmer MVP — Requisitos Rastreáveis
- worker/package.json
- database/package.json
- alerts.json
- identity-runtime.js
- Passagem de Produto para Tech Lead
- meta
- package.json
- inbox-channels/src/index.js
- README.md
- T00.7 — Ativação e drills de observabilidade
- signals
- validate-external-spikes.mjs
- authentication-throttle.js
- provider
- CRM Silmer MVP — Contexto de Produto
- Fase 5 — Orçamento, PIX, Pedido e Ficha
- postgres.js
- Agentes do CRM Silmer
- Baseline de identidade e acesso da Fase 1
- Arquitetura — Decisões do MVP
- Contribuindo com o CRM Silmer
- hardening
- monitor
- Runbook de recovery off-host — T00.3 / T07.3
- Fase 0 — Fundação e riscos técnicos
- Fase 2 — Caixa de Entrada, canais e confiabilidade
- T00.6 — Gate de aprovação da Fase 0
- Supply chain da Fase 0
- T00.5 — Threat model e catálogo de dados
- activation-gate.json
- routing
- validate-media-retention.mjs
- Fase 1 — Identidade, acesso e infraestrutura de domínio
- Fase 3 — Negócio, Kanban e qualificação
- Fase 6 — Privacidade, relatórios e operação
- T00.4 — Mídia transitória do piloto interno
- audit-privacy/package.json
- catalog/package.json
- configuration/package.json
- identity-access/package.json
- integration-reliability/package.json
- shared/package.json
- build.mjs
- Fase 4 — Vendedor Silmer assistivo
- Fase 7 — Hardening, UAT e piloto
- edge-web/package.json
- Política de segurança
- createPostgresAccessRepository
- completion
- check-boundaries.mjs
- serve-edge.mjs
- PrivateMediaVolume
- CRM Silmer
- bootstrap.test.js
- ci-images.test.js
- identity-contract.test.js
- .prettierrc.json
- CRM Silmer MVP — Plano de Implementação
- Technical Baseline
- Confirmed Decisions
- eslint.config.js
- FLUXO-QUALIFICACAO-GENERICO.md
- Jules PR Review
- 0003_identity_api_hardening.expand.sql
- database/README.md
- GET /api/v1/sessions/current
- API Application
- Edge Web Application
- Worker Application
- Functional Boundaries
- Modeling Decisions
- Caixa de Entrada (Backlog)
- Validation Gates
- crm.idempotency_records
- Espectro MVP Project
- Ficha de Pedido
- Promote Approved SHA Workflow
- Gemini Developer API
- Datacrazy Historical Archive
- Kanban Comercial
- Meta WhatsApp Business API
- Database Module
- Shared Modules
- Ficha Canonica Sintetica v1
- Ficha Canônica Sintética V2 PDF
- Revisão da Ficha HTML
- silmer-edge-web
- silmer-postgres
- Silmer AI Assistant
- API Contracts
- Essential Data Model
- Monolith Modules
- Reliability & Async
- Risks & Mitigation
- Runtime Architecture
- Performance & SLOs
- T00.4 — Sandbox da Meta
- 0005_phase2_worker_media.expand.sql
- Dívida #29 — Aprovação e validação futura do Cloudflare R2
- Codex — Contexto do CRM Silmer
- postgres-contact-identity-repository.js
- crm.transient_media
- postgres-webhook-inbox.js
- api/src/app.js
- inbox-channels/package.json
- catalog/src/index.js
- configuration/src/index.js
- catalog-version.js
- postgres-job-queue.js
- 0004_phase2_channel_webhook.expand.sql
- Webhook WhatsApp — decisões de T02.2
- whatsapp-webhook.test.js
- configuration-catalog-postgres-live.test.js
- observability.js
- 0006_phase2_inbox_contacts.expand.sql
- server.js
- validate-observability.mjs
- WorkerRuntime
- contacts/package.json
- crm.channel_events
- crm.outbox_jobs
- identity-routes.js
- T00.6 — Evidência de aprovação

## God Nodes (most connected - your core abstractions)
1. `scripts` - 43 edges
2. `TDD — CRM Silmer MVP` - 22 edges
3. `loadMigrations()` - 19 edges
4. `freezeInboxRecord()` - 17 edges
5. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
6. `migrate()` - 16 edges
7. `Design do CRM Silmer` - 16 edges
8. `PostgresTransientMediaRepository` - 15 edges
9. `createSafeLogger()` - 15 edges
10. `Topologia EasyPanel — CRM Silmer` - 15 edges

## Surprising Connections (you probably didn't know these)
- `createIdempotentCommandExecutor()` --indirect_call--> `request()`  [INFERRED]
  modules/integration-reliability/src/idempotency.js → apps/edge-web/src/app.js
- `createR2S3Client()` --indirect_call--> `request()`  [INFERRED]
  scripts/r2-live-smoke.mjs → apps/edge-web/src/app.js
- `createCatalogService()` --indirect_call--> `select()`  [INFERRED]
  modules/catalog/src/application/catalog-service.js → apps/edge-web/src/app.js
- `createCommercialRuntime()` --calls--> `createCatalogService()`  [EXTRACTED]
  apps/api/src/commercial-runtime.js → modules/catalog/src/application/catalog-service.js
- `createCommercialRuntime()` --calls--> `createConfigurationService()`  [EXTRACTED]
  apps/api/src/commercial-runtime.js → modules/configuration/src/application/configuration-service.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 0: Foundation and Technical Risks** — github_workflows_ci, docs_phase0_observability_and_hardening, docs_phase0_phase_0_approval_gate [EXTRACTED 1.00]
- **Identity, Access, and MFA Flow** — docs_api_openapi_v1, docs_phase1_identity_access_baseline, apps_edge_web_index [EXTRACTED 1.00]
- **Identity Security Secrets** — identity_bootstrap_token, identity_envelope_key, idempotency_envelope_key, auth_throttle_hmac_key [EXTRACTED 1.00]
- **Observability Drill Targets** — silmer_api, silmer_worker, api_health_live [EXTRACTED 0.90]
- **Monolith Runtime Processes** — technical_design_runtime [EXTRACTED 1.00]
- **Privacy & Security Framework** — technical_design_security, architecture_modeling [EXTRACTED 1.00]
- **Sales Funnel Logic** — architecture_modeling, technical_design_data_model [EXTRACTED 1.00]
- **Phase 0 Milestones** — docs_phase0_external_spikes_t00_4, docs_phase0_ficha_pdf_review_t00_4, docs_phase0_threat_model_and_data_catalog_t00_5 [EXTRACTED 1.00]
- **Vendedor Silmer Integration Flow** — vendedor_silmer, google_gemini_api [INFERRED 0.85]
- **Documentation Precedence Hierarchy** — rules, specs_features_crm_mvp_spec, crm_mvp_especificacao, technical_design, architecture [EXTRACTED 1.00]
- **Espectro MVP Recovery Services** — silmer_api, silmer_worker, silmer_postgres, silmer_edge_web [EXTRACTED 1.00]
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]

## Communities (156 total, 46 thin omitted)

### Community 0 - "integration-reliability/src/index.js"
Cohesion: 0.06
Nodes (41): createMetaWebhookRuntime(), canonicalJson(), clone(), createDeferred(), createIdempotentCommandExecutor(), fingerprintCommand(), IdempotencyConflictError, InMemoryIdempotencyRecordStore (+33 more)

### Community 1 - "PostgresTransientMediaRepository"
Cohesion: 0.21
Nodes (10): boundedString(), nonnegativeInteger(), positiveInteger(), PostgresTransientMediaRepository, reasonCode(), requireSingleMutation(), setTransactionBounds(), sha256() (+2 more)

### Community 2 - "TDD — CRM Silmer MVP"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 3 - "0002_phase1_domain.expand.sql"
Cohesion: 0.09
Nodes (37): crm_meta.protect_catalog_entry, crm_meta.protect_catalog_version, crm_meta.protect_idempotency_record, crm_meta.reject_immutable_change, audit_events_immutable_rows, audit_events_immutable_truncate, catalog_materials_immutable_truncate, catalog_materials_protect_rows (+29 more)

### Community 4 - "configuration-version.js"
Cohesion: 0.23
Nodes (20): assertChannels(), assertExactKeys(), assertFab(), assertFeatureFlags(), assertJsonValue(), assertNonEmptyString(), assertPix(), assertRecipient() (+12 more)

### Community 5 - "scripts"
Cohesion: 0.05
Nodes (43): scripts, build, check:boundaries, db:migrate, drill:observability:api, format, format:check, generate:ficha-pdf-review (+35 more)

### Community 6 - "r2-live-smoke.mjs"
Cohesion: 0.11
Nodes (34): assertNoS3ObjectLockHeaders(), assertSafeR2Evidence(), awsDate(), awsEncode(), awsTimestamp(), BUCKETS, canonicalObjectPath(), canonicalQuery() (+26 more)

### Community 7 - "CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)"
Cohesion: 0.06
Nodes (36): Crazy API (WhatsApp), Datacrazy CRM, 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano (+28 more)

### Community 8 - "Design do CRM Silmer"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 9 - "database/src/index.js"
Cohesion: 0.07
Nodes (24): pool, checkDatabaseReadiness(), createDatabase(), applyMigration(), checksum(), ensureDirectoryUrl(), loadMigrations(), migrate() (+16 more)

### Community 10 - "T00.4 — Spikes externos"
Cohesion: 0.13
Nodes (15): Cloudflare R2 Integration, Decisões seguras, Evidências e pendências externas, Gemini Developer API Integration, Meta Sandbox Validation, Resultado local, T00.4 — Spikes externos, Verificação (+7 more)

### Community 11 - "recovery-mock.mjs"
Cohesion: 0.13
Nodes (28): buildRecoveryPlan(), expectedAdapterKeys, expectedBlockerKeys, expectedCadenceEntryKeys, expectedCadenceKeys, expectedDigestKeys, expectedGateKeys, expectedRecoveryCheckKeys (+20 more)

### Community 12 - "audit-privacy/src/index.js"
Cohesion: 0.15
Nodes (14): AuditEventValidationError, createAuditEventEnvelope(), deepFreeze(), immutableClone(), InMemoryAuditTrail, requireNonEmptyString(), validateAuditEvent(), PostgresAuditTrail (+6 more)

### Community 13 - "meta-whatsapp.js"
Cohesion: 0.08
Nodes (46): absoluteInstant(), array(), boundedString(), deepFreeze(), dispositionFor(), immutableClone(), invalid(), MEDIA_TYPES (+38 more)

### Community 14 - "dependencies"
Cohesion: 0.08
Nodes (25): dependencies, @crm-silmer/audit-privacy, @crm-silmer/catalog, @crm-silmer/configuration, @crm-silmer/database, @crm-silmer/identity-access, @crm-silmer/inbox-channels, @crm-silmer/integration-reliability (+17 more)

### Community 15 - "ficha-pdf-review.mjs"
Cohesion: 0.17
Nodes (25): approvalCriteria, buildFichaHtml(), buildLegacyFichaHtml(), buildReviewPageHtml(), commercialItemFields, commercialOrderFields, containsPersonalContact(), countPdfPages() (+17 more)

### Community 16 - "compilerOptions"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 17 - "Topologia EasyPanel — CRM Silmer"
Cohesion: 0.08
Nodes (24): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços no projeto, 3. Rede e domínios (+16 more)

### Community 18 - "identity-access/src/index.js"
Cohesion: 0.15
Nodes (14): constantTimeEqual(), createIdentityAccessService(), createInMemoryIdentityRepository(), DEFAULT_PASSWORD_PARAMETERS, deriveArgon2(), digest(), FUNCTIONS, hashPassword() (+6 more)

### Community 19 - "Campos da Ficha e Jornada Conversacional — P0.1"
Cohesion: 0.09
Nodes (22): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+14 more)

### Community 20 - "CRM Silmer — Especificação de Produto do MVP"
Cohesion: 0.08
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 21 - "identity-access.md"
Cohesion: 0.10
Nodes (19): GET /api/health/ready, POST /api/v1/bootstrap/identity, AUTH_THROTTLE_HMAC_KEY, OpenAPI v1 Contract, Chave idempotente presa em `pending`, Escopo, Gates antes de publicar, Incidentes (+11 more)

### Community 22 - "gemini-privacy-smoke.mjs"
Cohesion: 0.22
Nodes (17): APPROVED_MODEL, APPROVED_PROVIDER, APPROVED_SUGGESTION_SCHEMA, buildEndpoint(), buildRequest(), containsPii(), extractOutputText(), invariant() (+9 more)

### Community 23 - "edge-web/src/app.js"
Cohesion: 0.20
Nodes (12): announce(), clearError(), elements, publicMessage(), readCookie(), request(), restoreSession(), showError() (+4 more)

### Community 24 - "authorization.js"
Cohesion: 0.17
Nodes (11): AccessControlError, actionCapabilities, authorize(), CAPABILITIES, createAccessControlService(), forbidden(), knownCapabilities, mfaRequiredCapabilities (+3 more)

### Community 25 - "validate-security-catalog.mjs"
Cohesion: 0.22
Nodes (13): approvedReview, invariant(), isIsoTimestamp(), main(), requiredFamilies, requiredFindings, retention, sha256() (+5 more)

### Community 26 - "devDependencies"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 27 - "observability-live-probe.mjs"
Cohesion: 0.35
Nodes (13): assertSafeProbeEvidence(), canonicalLiveUrl(), invariant(), isPathWithinDirectory(), main(), nativePathApi, observeApiTransition(), positiveInteger() (+5 more)

### Community 28 - "validate-phase0-decisions.mjs"
Cohesion: 0.25
Nodes (10): expectedDecisionSubjects, expectedRoles, invariant(), isCorporateId(), isIsoDate(), isVersionedEvidence(), main(), validateApproval() (+2 more)

### Community 29 - "CRM Silmer MVP — Requisitos Rastreáveis"
Cohesion: 0.13
Nodes (15): Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido, P1.4 Confiabilidade e canais (+7 more)

### Community 30 - "worker/package.json"
Cohesion: 0.20
Nodes (9): dependencies, @crm-silmer/shared, @crm-silmer/shared, name, private, scripts, start, type (+1 more)

### Community 31 - "database/package.json"
Cohesion: 0.14
Nodes (13): dependencies, pg, devDependencies, @types/pg, exports, name, private, scripts (+5 more)

### Community 32 - "alerts.json"
Cohesion: 0.14
Nodes (13): activationGateRef, alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner (+5 more)

### Community 33 - "identity-runtime.js"
Cohesion: 0.22
Nodes (8): createIdentityApiRuntime(), IdentityHttpError, readKey(), readOrigins(), requireSecret(), database, encodedKey, environment

### Community 34 - "Passagem de Produto para Tech Lead"
Cohesion: 0.15
Nodes (12): Decisões P0 para aprovação final e estimativa fechada, Gate recomendado, O que o Tech Lead já pode especificar, P0.1 resolvido — contrato de passagem, P0.2 resolvido — autoridade sobre preço, P0.3 resolvido — limite financeiro comercial, P0.4 resolvido — canais e limite operacional da IA, P0.5 resolvido — identidade, FAB e numeração da Ficha (+4 more)

### Community 35 - "meta"
Cohesion: 0.12
Nodes (15): instagram, whatsapp, gemini, schemaFixture, meta, canonicalInboundFixtures, messageFixture, signature (+7 more)

### Community 36 - "package.json"
Cohesion: 0.17
Nodes (11): engines, node, npm, name, packageManager, private, type, version (+3 more)

### Community 37 - "inbox-channels/src/index.js"
Cohesion: 0.06
Nodes (43): clone(), createAudit(), InMemoryInboxRepository, publicConversation(), advisoryLock(), createAudit(), decryptJson(), encryptJson() (+35 more)

### Community 38 - "README.md"
Cohesion: 0.17
Nodes (6): Sobre o CRM Silmer, CI and Immutable Images Workflow, PostgreSQL 17 Alpine Image, Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 39 - "T00.7 — Ativação e drills de observabilidade"
Cohesion: 0.18
Nodes (10): GET /api/health/live, Baseline não destrutiva, Drill controlado da API, Drills dos sinais internos, Hardening do digest promovido, Promoção da evidência, Pré-requisitos humanos e externos, T00.7 — Ativação e drills de observabilidade (+2 more)

### Community 40 - "signals"
Cohesion: 0.18
Nodes (11): telemetry, evidenceRef, signals, source, status, api-5xx, api-latency, api-live-unavailable (+3 more)

### Community 41 - "validate-external-spikes.mjs"
Cohesion: 0.35
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 42 - "authentication-throttle.js"
Cohesion: 0.22
Nodes (5): createPostgresAuthenticationThrottle(), POLICIES, HMAC_KEY, NOW, RecordingDatabase

### Community 43 - "provider"
Cohesion: 0.20
Nodes (10): provider, dataRegion, dpaAccepted, evidenceRef, name, privacyReviewer, retentionDays, reviewedAt (+2 more)

### Community 44 - "CRM Silmer MVP — Contexto de Produto"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 45 - "Fase 5 — Orçamento, PIX, Pedido e Ficha"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 46 - "postgres.js"
Cohesion: 0.31
Nodes (7): createPostgresIdentityRepository(), decodeEncryptedSecret(), mapFactor(), mapInvitation(), mapSession(), requireIsoString(), toIsoString()

### Community 47 - "Agentes do CRM Silmer"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 48 - "Baseline de identidade e acesso da Fase 1"
Cohesion: 0.25
Nodes (7): Edge Web Entry Point, Identity API OpenAPI v1, Baseline de identidade e acesso da Fase 1, Gates, Invariantes operacionais, Parâmetros versionados, Superfícies entregues

### Community 49 - "Arquitetura — Decisões do MVP"
Cohesion: 0.25
Nodes (7): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis

### Community 50 - "Contribuindo com o CRM Silmer"
Cohesion: 0.25
Nodes (7): Antes de alterar, Atualização de branches de pull request, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Governança do repositório público, Validação

### Community 51 - "hardening"
Cohesion: 0.25
Nodes (8): hardening, capabilitiesRemoved, digest, evidenceRef, nonRoot, readOnly, status, temporaryStorageLimited

### Community 52 - "monitor"
Cohesion: 0.25
Nodes (8): monitor, checkIntervalSeconds, consecutiveFailures, evidenceRef, liveUrl, location, monitorId, status

### Community 53 - "Runbook de recovery off-host — T00.3 / T07.3"
Cohesion: 0.25
Nodes (7): Execução externa pendente, Lacunas, donos e prazo-gate, Pre-flight obrigatório, Runbook de recovery off-host — T00.3 / T07.3, Stop conditions, Uso offline por uma segunda pessoa, Tombstone Ledger (T06.3)

### Community 54 - "Fase 0 — Fundação e riscos técnicos"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar serviços Silmer no EasyPanel, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 55 - "Fase 2 — Caixa de Entrada, canais e confiabilidade"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 56 - "T00.6 — Gate de aprovação da Fase 0"
Cohesion: 0.16
Nodes (11): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local, Como alterar esta aprovação, Defaults aprovados, Exceção de operação solo, Papéis designados (+3 more)

### Community 57 - "Supply chain da Fase 0"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 58 - "T00.5 — Threat model e catálogo de dados"
Cohesion: 0.29
Nodes (6): Aprovação, Catálogo e retenção, Modelo de ameaças, Matriz P0.6, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 59 - "activation-gate.json"
Cohesion: 0.29
Nodes (6): drills, issue, $schema, schemaVersion, status, task

### Community 60 - "routing"
Cohesion: 0.29
Nodes (7): routing, criticalEscalationMinutes, destinations, evidenceRef, highEscalationMinutes, ownerIds, status

### Community 61 - "validate-media-retention.mjs"
Cohesion: 0.43
Nodes (4): invariant(), main(), validateMediaRetentionPolicy(), policyUrl

### Community 62 - "Fase 1 — Identidade, acesso e infraestrutura de domínio"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 63 - "Fase 3 — Negócio, Kanban e qualificação"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 64 - "Fase 6 — Privacidade, relatórios e operação"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 65 - "T00.4 — Mídia transitória do piloto interno"
Cohesion: 0.33
Nodes (5): Controles mínimos para T02/T06, Decisão em linguagem natural, Limites desta entrega, T00.4 — Mídia transitória do piloto interno, Verificação

### Community 66 - "audit-privacy/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 67 - "catalog/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 68 - "configuration/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 69 - "identity-access/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 70 - "integration-reliability/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 71 - "shared/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 72 - "build.mjs"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 73 - "Fase 4 — Vendedor Silmer assistivo"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 74 - "Fase 7 — Hardening, UAT e piloto"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 75 - "edge-web/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 76 - "Política de segurança"
Cohesion: 0.40
Nodes (4): Dependabot Configuration, Como reportar uma vulnerabilidade, Política de segurança, Versões suportadas

### Community 78 - "completion"
Cohesion: 0.40
Nodes (5): completion, approvedAt, approvedBy, evidenceRef, humanApproved

### Community 79 - "check-boundaries.mjs"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 80 - "serve-edge.mjs"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 81 - "PrivateMediaVolume"
Cohesion: 0.15
Nodes (10): boundedString(), DEFAULT_ALLOWED_MIME_TYPES, MediaQuotaExceededError, MediaVolumeUnavailableError, positiveInteger(), PrivateMediaVolume, toAsyncIterable(), validDate() (+2 more)

### Community 82 - "CRM Silmer"
Cohesion: 0.50
Nodes (4): Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada

### Community 84 - "ci-images.test.js"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

### Community 87 - "CRM Silmer MVP — Plano de Implementação"
Cohesion: 0.50
Nodes (4): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico, Status operacional reconciliado

### Community 129 - "T00.4 — Sandbox da Meta"
Cohesion: 0.20
Nodes (6): Ativos selecionados, Escopo e limite, Evidência de fechamento, Segredos e dados locais, Sequência operacional, T00.4 — Sandbox da Meta

### Community 130 - "0005_phase2_worker_media.expand.sql"
Cohesion: 0.33
Nodes (5): crm.reject_transient_media_expiry_extension, crm.processing_attempts, crm.reconciliation_items, crm.outbox_jobs, transient_media_expiry_immutable

### Community 131 - "Dívida #29 — Aprovação e validação futura do Cloudflare R2"
Cohesion: 0.29
Nodes (7): Contrato candidato para implementação futura, Critérios live obrigatórios, Dívida #29 — Aprovação e validação futura do Cloudflare R2, Estado do gate, Procedimento live, Reconciliação de `PutObject` incerto, Verificação local

### Community 132 - "Codex — Contexto do CRM Silmer"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 133 - "postgres-contact-identity-repository.js"
Cohesion: 0.07
Nodes (41): auditEvent(), commandReplay(), identityScope(), InMemoryContactIdentityRepository, advisoryLock(), auditEvent(), decryptIdentity(), encryptIdentity() (+33 more)

### Community 135 - "postgres-webhook-inbox.js"
Cohesion: 0.12
Nodes (31): boundedString(), canonicalEventAad(), canonicalInstant(), canonicalJson(), decryptCanonicalEvent(), encryptCanonicalEvent(), encryptPayload(), MEDIA_TYPES (+23 more)

### Community 136 - "api/src/app.js"
Cohesion: 0.25
Nodes (13): createApi(), createWebhookAdmissionGate(), isJsonContentType(), isTransientWebhookPersistenceError(), SERVICES, createSafeLogger(), normalizeTraceId(), harness() (+5 more)

### Community 137 - "inbox-channels/package.json"
Cohesion: 0.22
Nodes (8): dependencies, @crm-silmer/audit-privacy, exports, @crm-silmer/audit-privacy, name, private, type, version

### Community 138 - "catalog/src/index.js"
Cohesion: 0.17
Nodes (9): select(), createCatalogService(), CatalogConflictError, CatalogError, CatalogForbiddenError, CatalogValidationError, assertCatalogPorts(), ADMIN (+1 more)

### Community 139 - "configuration/src/index.js"
Cohesion: 0.19
Nodes (8): createConfigurationService(), ConfigurationConflictError, ConfigurationError, ConfigurationForbiddenError, ConfigurationValidationError, assertConfigurationPorts(), ADMIN_ACTOR, createHarness()

### Community 140 - "catalog-version.js"
Cohesion: 0.24
Nodes (14): isoString(), mapCatalog(), requireString(), assertExactKeys(), assertNonEmptyString(), assertRecord(), createCatalogSelection(), createPublishedCatalogVersion() (+6 more)

### Community 141 - "postgres-job-queue.js"
Cohesion: 0.20
Nodes (16): boundedString(), calculateRetryDelayMs(), decideExpiredAttempt(), decideFailedAttempt(), errorCodeValue(), finishAttempt(), finishJob(), insertReconciliation() (+8 more)

### Community 142 - "0004_phase2_channel_webhook.expand.sql"
Cohesion: 0.53
Nodes (5): crm.channel_event_media, crm.channel_events, crm.outbox_jobs, crm.webhook_receipts, crm.transient_media

### Community 143 - "Webhook WhatsApp — decisões de T02.2"
Cohesion: 0.33
Nodes (5): Decisões aprovadas, Evidência necessária para fechamento, Invariantes, Rastreabilidade, Webhook WhatsApp — decisões de T02.2

### Community 144 - "whatsapp-webhook.test.js"
Cohesion: 0.15
Nodes (8): WEBHOOK_MAX_IN_FLIGHT, WEBHOOK_REQUESTS_PER_SECOND, createWhatsAppWebhookRuntime(), requireSecret(), WEBHOOK_BODY_LIMIT_BYTES, MetaWebhookPayloadError, normalize(), RECEIVED_AT

### Community 145 - "configuration-catalog-postgres-live.test.js"
Cohesion: 0.21
Nodes (9): createCommercialRuntime(), createPostgresCatalogRepository(), requireQueryable(), createPostgresConfigurationRepository(), isoString(), mapConfiguration(), requireQueryable(), requireString() (+1 more)

### Community 146 - "observability.js"
Cohesion: 0.16
Nodes (10): allowedContextFields, allowedEvents, allowedMetrics, allowedServices, categoricalPolicies, createSafeLogRecord(), isFiniteNumber(), MetricRegistry (+2 more)

### Community 147 - "0006_phase2_inbox_contacts.expand.sql"
Cohesion: 0.24
Nodes (12): crm.reject_identity_link_history_mutation, crm.ai_suggestions, crm.attachments, crm.contact_identities, crm.contacts, crm.conversations, crm.identity_links, crm.inbox_commands (+4 more)

### Community 148 - "server.js"
Cohesion: 0.26
Nodes (7): createDurableMetaWebhookRuntime(), createServerApi(), readEnvelopeKey(), requireConfiguredSecret(), configuredId(), createMetaWhatsAppNormalizer(), KEY

### Community 149 - "validate-observability.mjs"
Cohesion: 0.36
Nodes (11): assertNoSensitiveFields(), invariant(), isEvidenceReference(), isIsoTimestamp(), isOpaqueReference(), main(), requiredAlerts, rootUrl (+3 more)

### Community 151 - "contacts/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 155 - "identity-routes.js"
Cohesion: 0.30
Nodes (12): IdentityRequestError, parseCookies(), publicErrorCode(), readStatusCode(), registerIdentityRoutes(), requireAuthenticatedCommand(), requireBody(), requireCookie() (+4 more)

### Community 156 - "T00.6 — Evidência de aprovação"
Cohesion: 0.29
Nodes (6): Autoridade e fonte humana, Decisões aprovadas, Designações, Exceção de operação solo e risco aceito, Rastreabilidade, T00.6 — Evidência de aprovação

## Knowledge Gaps
- **732 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+727 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **46 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `request()` connect `edge-web/src/app.js` to `integration-reliability/src/index.js`, `r2-live-smoke.mjs`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `createIdempotentCommandExecutor()` connect `integration-reliability/src/index.js` to `edge-web/src/app.js`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `createR2S3Client()` connect `r2-live-smoke.mjs` to `edge-web/src/app.js`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _732 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `integration-reliability/src/index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.061457418788410885 - nodes in this community are weakly interconnected._
- **Should `TDD — CRM Silmer MVP` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `0002_phase1_domain.expand.sql` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._
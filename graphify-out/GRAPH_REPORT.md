# Graph Report - crm-silmer-issue7  (2026-08-31)

## Corpus Check
- 137 files · ~90,316 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1128 nodes · 1528 edges · 97 communities (74 shown, 23 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0d11482a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- integration-reliability/src/index.js
- worker/package.json
- TDD — CRM Silmer MVP
- 0002_phase1_domain.expand.sql
- configuration-version.js
- r2-live-smoke.mjs
- CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)
- Design do CRM Silmer
- database/src/index.js
- scripts
- recovery-mock.mjs
- catalog-version.js
- ficha-pdf-review.mjs
- compilerOptions
- api/package.json
- Campos da Ficha e Jornada Conversacional — P0.1
- CRM Silmer — Especificação de Produto do MVP
- Topologia EasyPanel — CRM Silmer
- audit-privacy/src/index.js
- identity-access/src/index.js
- gemini-privacy-smoke.mjs
- CRM Silmer MVP — Requisitos Rastreáveis
- devDependencies
- validate-phase0-decisions.mjs
- database/package.json
- alerts.json
- Passagem de Produto para Tech Lead
- signature
- authorization.js
- package.json
- README.md
- validate-external-spikes.mjs
- EXTERNAL-SPIKES.md
- validate-security-catalog.mjs
- CRM Silmer MVP — Contexto de Produto
- Fase 5 — Orçamento, PIX, Pedido e Ficha
- Agentes do CRM Silmer
- Arquitetura — Decisões do MVP
- Runbook de recovery off-host — T00.3 / T07.3
- Fase 0 — Fundação e riscos técnicos
- Fase 2 — Caixa de Entrada, canais e confiabilidade
- Contribuindo com o CRM Silmer
- T00.6 — Gate de aprovação da Fase 0
- Supply chain da Fase 0
- validateMediaRetentionPolicy
- Fase 1 — Identidade, acesso e infraestrutura de domínio
- Fase 3 — Negócio, Kanban e qualificação
- Fase 6 — Privacidade, relatórios e operação
- T00.5 — Threat model e catálogo de dados
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
- Codex — Contexto do CRM Silmer
- T00.7 — Observabilidade e hardening mínimos
- Baseline de identidade e acesso da Fase 1
- Política de segurança
- Issue 7 Package Logic
- check-boundaries.mjs
- serve-edge.mjs
- Q: Como o pacote da issue 7 valida o PDF canonico da Ficha, preserva campos de producao vazios e mantem a aprovacao de Rose e Operacao fail-closed?
- CRM Silmer MVP — Plano de Implementação
- bootstrap.test.js
- ci-images.test.js
- CI and Immutable Images Workflow
- .prettierrc.json
- edge-web/src/app.js
- eslint.config.js
- FLUXO-QUALIFICACAO-GENERICO.md
- database/README.md
- Worker Application
- Caixa de Entrada (Backlog)
- Espectro MVP Project
- Ficha de Pedido
- Jules PR Review Workflow
- Promote Approved SHA Workflow
- Datacrazy Historical Archive
- Kanban Comercial
- Database Module
- Shared Modules
- Ficha Canonica Sintetica v1
- Ficha Canônica Sintética V2 PDF
- Revisão da Ficha HTML
- silmer-api
- silmer-edge-web
- silmer-postgres
- silmer-worker

## God Nodes (most connected - your core abstractions)
1. `scripts` - 37 edges
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
- `harness()` --calls--> `createCatalogService()`  [EXTRACTED]
  test/catalog.test.js → modules/catalog/src/application/catalog-service.js
- `createHarness()` --calls--> `createConfigurationService()`  [EXTRACTED]
  test/configuration.test.js → modules/configuration/src/application/configuration-service.js
- `capture()` --calls--> `createSafeLogger()`  [EXTRACTED]
  test/observability.test.js → modules/shared/src/observability.js
- `Vendedor Silmer (AI Agent)` --references--> `Crazy API (WhatsApp)`  [INFERRED]
  .specs/features/crm-mvp/context.md → historico-datacrazy/DATACRAZY-SETUP.md
- `createApi()` --calls--> `createSafeLogger()`  [EXTRACTED]
  apps/api/src/app.js → modules/shared/src/observability.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Ficha Validation and Approval Flow** — graphify_out_memory_query_20260901_004317_como_o_pacote_da_issue_7_valida_o_pdf_canonico_da_validatefichasnapshot, graphify_out_memory_query_20260901_004317_como_o_pacote_da_issue_7_valida_o_pdf_canonico_da_validatefichaapprovalgate, graphify_out_memory_query_20260901_004317_como_o_pacote_da_issue_7_valida_o_pdf_canonico_da_t00_4_revisao_do_pdf_canonico_da_ficha [EXTRACTED 0.95]
- **External Integration Spikes (Phase 0)** — meta_api, google_gemini_api, cloudflare_r2 [EXTRACTED 0.90]
- **Vendedor Silmer Integration Flow** — vendedor_silmer, google_gemini_api [INFERRED 0.85]
- **Documentation Precedence Hierarchy** — rules, specs_features_crm_mvp_spec, crm_mvp_especificacao, technical_design, architecture [EXTRACTED 1.00]
- **Espectro MVP Recovery Services** — silmer_api, silmer_worker, silmer_postgres, silmer_edge_web [EXTRACTED 1.00]
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]

## Communities (97 total, 23 thin omitted)

### Community 0 - "integration-reliability/src/index.js"
Cohesion: 0.06
Nodes (43): createApi(), createMetaWebhookRuntime(), createServerApi(), WorkerRuntime, createMetaMessagesClient(), deepFreeze(), extractMetaEvents(), immutableClone() (+35 more)

### Community 1 - "worker/package.json"
Cohesion: 0.20
Nodes (9): dependencies, @crm-silmer/shared, @crm-silmer/shared, name, private, scripts, start, type (+1 more)

### Community 2 - "TDD — CRM Silmer MVP"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 3 - "0002_phase1_domain.expand.sql"
Cohesion: 0.09
Nodes (37): crm_meta.protect_catalog_entry, crm_meta.protect_catalog_version, crm_meta.protect_idempotency_record, crm_meta.reject_immutable_change, audit_events_immutable_rows, audit_events_immutable_truncate, catalog_materials_immutable_truncate, catalog_materials_protect_rows (+29 more)

### Community 4 - "configuration-version.js"
Cohesion: 0.11
Nodes (27): createConfigurationService(), assertChannels(), assertExactKeys(), assertFab(), assertFeatureFlags(), assertJsonValue(), assertNonEmptyString(), assertPix() (+19 more)

### Community 5 - "r2-live-smoke.mjs"
Cohesion: 0.11
Nodes (34): assertNoS3ObjectLockHeaders(), assertSafeR2Evidence(), awsDate(), awsEncode(), awsTimestamp(), BUCKETS, canonicalObjectPath(), canonicalQuery() (+26 more)

### Community 6 - "CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)"
Cohesion: 0.06
Nodes (36): Crazy API (WhatsApp), Datacrazy CRM, 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano (+28 more)

### Community 7 - "Design do CRM Silmer"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 8 - "database/src/index.js"
Cohesion: 0.10
Nodes (17): pool, checkDatabaseReadiness(), createDatabase(), applyMigration(), checksum(), ensureDirectoryUrl(), loadMigrations(), migrate() (+9 more)

### Community 9 - "scripts"
Cohesion: 0.05
Nodes (37): scripts, build, check:boundaries, db:migrate, format, format:check, generate:ficha-pdf-review, lint (+29 more)

### Community 10 - "recovery-mock.mjs"
Cohesion: 0.13
Nodes (28): buildRecoveryPlan(), expectedAdapterKeys, expectedBlockerKeys, expectedCadenceEntryKeys, expectedCadenceKeys, expectedDigestKeys, expectedGateKeys, expectedRecoveryCheckKeys (+20 more)

### Community 11 - "catalog-version.js"
Cohesion: 0.16
Nodes (18): createCatalogService(), assertExactKeys(), assertNonEmptyString(), assertRecord(), createCatalogSelection(), createPublishedCatalogVersion(), deepFreeze(), immutableCatalogClone() (+10 more)

### Community 12 - "ficha-pdf-review.mjs"
Cohesion: 0.17
Nodes (25): approvalCriteria, buildFichaHtml(), buildLegacyFichaHtml(), buildReviewPageHtml(), commercialItemFields, commercialOrderFields, containsPersonalContact(), countPdfPages() (+17 more)

### Community 13 - "compilerOptions"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit (+17 more)

### Community 14 - "api/package.json"
Cohesion: 0.12
Nodes (15): dependencies, @crm-silmer/database, @crm-silmer/integration-reliability, @crm-silmer/shared, fastify, @crm-silmer/shared, name, private (+7 more)

### Community 15 - "Campos da Ficha e Jornada Conversacional — P0.1"
Cohesion: 0.09
Nodes (22): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+14 more)

### Community 16 - "CRM Silmer — Especificação de Produto do MVP"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 17 - "Topologia EasyPanel — CRM Silmer"
Cohesion: 0.08
Nodes (24): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços no projeto, 3. Rede e domínios (+16 more)

### Community 18 - "audit-privacy/src/index.js"
Cohesion: 0.10
Nodes (21): AuditEventValidationError, deepFreeze(), immutableClone(), InMemoryAuditTrail, requireNonEmptyString(), validateAuditEvent(), isTransientMediaExpired(), resolveTransientMediaExpiresAt() (+13 more)

### Community 19 - "identity-access/src/index.js"
Cohesion: 0.16
Nodes (14): constantTimeEqual(), createIdentityAccessService(), createInMemoryIdentityRepository(), DEFAULT_PASSWORD_PARAMETERS, deriveArgon2(), digest(), FUNCTIONS, hashPassword() (+6 more)

### Community 20 - "gemini-privacy-smoke.mjs"
Cohesion: 0.22
Nodes (17): APPROVED_MODEL, APPROVED_PROVIDER, APPROVED_SUGGESTION_SCHEMA, buildEndpoint(), buildRequest(), containsPii(), extractOutputText(), invariant() (+9 more)

### Community 21 - "CRM Silmer MVP — Requisitos Rastreáveis"
Cohesion: 0.12
Nodes (15): Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido, P1.4 Confiabilidade e canais (+7 more)

### Community 22 - "devDependencies"
Cohesion: 0.13
Nodes (15): @axe-core/playwright, eslint, devDependencies, @axe-core/playwright, eslint, @playwright/test, prettier, @types/node (+7 more)

### Community 23 - "validate-phase0-decisions.mjs"
Cohesion: 0.24
Nodes (12): expectedDecisionSubjects, expectedRoles, invariant(), isCorporateId(), isIsoDate(), isVersionedEvidence(), main(), validateApproval() (+4 more)

### Community 24 - "database/package.json"
Cohesion: 0.14
Nodes (13): dependencies, pg, devDependencies, @types/pg, exports, name, private, scripts (+5 more)

### Community 25 - "alerts.json"
Cohesion: 0.15
Nodes (12): alerts, legalMaximumRetentionDays, monitorLocation, operationalRetentionDays, routing, destination, owner, status (+4 more)

### Community 26 - "Passagem de Produto para Tech Lead"
Cohesion: 0.15
Nodes (12): Decisões P0 para aprovação final e estimativa fechada, Gate recomendado, O que o Tech Lead já pode especificar, P0.1 resolvido — contrato de passagem, P0.2 resolvido — autoridade sobre preço, P0.3 resolvido — limite financeiro comercial, P0.4 resolvido — canais e limite operacional da IA, P0.5 resolvido — identidade, FAB e numeração da Ficha (+4 more)

### Community 27 - "signature"
Cohesion: 0.15
Nodes (12): gemini, schemaFixture, meta, messageFixture, signature, statusFixture, schemaVersion, appSecret (+4 more)

### Community 28 - "authorization.js"
Cohesion: 0.24
Nodes (9): actionCapabilities, authorize(), CAPABILITIES, createAccessControlService(), knownCapabilities, mfaRequiredCapabilities, operationalActions, harness() (+1 more)

### Community 29 - "package.json"
Cohesion: 0.17
Nodes (11): engines, node, npm, name, packageManager, private, type, version (+3 more)

### Community 30 - "README.md"
Cohesion: 0.15
Nodes (8): Sobre o CRM Silmer, Comece por aqui, CRM Silmer, Desenvolvimento, Stack aprovada, Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

### Community 31 - "validate-external-spikes.mjs"
Cohesion: 0.35
Nodes (7): invariant(), main(), statuses, validateExternalEffects(), validateFixtures(), validateLoadEnvelope(), rootUrl

### Community 32 - "EXTERNAL-SPIKES.md"
Cohesion: 0.06
Nodes (27): Cloudflare R2, Decisões seguras, Evidências e pendências externas, Resultado local, T00.4 — Spikes externos, Verificação, Estado do gate, Geracao e verificacao tecnica (+19 more)

### Community 33 - "validate-security-catalog.mjs"
Cohesion: 0.33
Nodes (7): invariant(), main(), requiredFamilies, retention, validateDataCatalog(), validateThreatModel(), rootUrl

### Community 34 - "CRM Silmer MVP — Contexto de Produto"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 35 - "Fase 5 — Orçamento, PIX, Pedido e Ficha"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

### Community 36 - "Agentes do CRM Silmer"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 37 - "Arquitetura — Decisões do MVP"
Cohesion: 0.25
Nodes (7): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis

### Community 39 - "Runbook de recovery off-host — T00.3 / T07.3"
Cohesion: 0.25
Nodes (7): Execução externa pendente, Lacunas, donos e prazo-gate, Pre-flight obrigatório, Runbook de recovery off-host — T00.3 / T07.3, Stop conditions, Uso offline por uma segunda pessoa, Tombstone Ledger (T06.3)

### Community 40 - "Fase 0 — Fundação e riscos técnicos"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar serviços Silmer no EasyPanel, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 41 - "Fase 2 — Caixa de Entrada, canais e confiabilidade"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 42 - "Contribuindo com o CRM Silmer"
Cohesion: 0.29
Nodes (6): Antes de alterar, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Governança do repositório público, Validação

### Community 44 - "T00.6 — Gate de aprovação da Fase 0"
Cohesion: 0.29
Nodes (6): Como registrar uma aprovação real, Defaults aguardando confirmação, Papéis e separação de funções, Resultado local, T00.6 — Gate de aprovação da Fase 0, Verificação

### Community 45 - "Supply chain da Fase 0"
Cohesion: 0.29
Nodes (6): Build e promoção, Pins verificados em 30/08/2026, Rastreabilidade e limite, Scanner, Supply chain da Fase 0, Verificação local

### Community 46 - "validateMediaRetentionPolicy"
Cohesion: 0.43
Nodes (4): invariant(), main(), validateMediaRetentionPolicy(), policyUrl

### Community 47 - "Fase 1 — Identidade, acesso e infraestrutura de domínio"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 48 - "Fase 3 — Negócio, Kanban e qualificação"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 49 - "Fase 6 — Privacidade, relatórios e operação"
Cohesion: 0.29
Nodes (7): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas, T06.6 Implementar UI de relatórios, configuração e privacidade

### Community 51 - "T00.5 — Threat model e catálogo de dados"
Cohesion: 0.33
Nodes (5): Aprovação, Catálogo e retenção, Modelo de ameaças, Resultado local, T00.5 — Threat model e catálogo de dados

### Community 52 - "T00.4 — Mídia transitória do piloto interno"
Cohesion: 0.33
Nodes (5): Controles mínimos para T02/T06, Decisão em linguagem natural, Limites desta entrega, T00.4 — Mídia transitória do piloto interno, Verificação

### Community 53 - "audit-privacy/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 54 - "catalog/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 55 - "configuration/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 56 - "identity-access/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 57 - "integration-reliability/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 58 - "shared/package.json"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 59 - "build.mjs"
Cohesion: 0.33
Nodes (4): copies, manifest, output, root

### Community 60 - "Fase 4 — Vendedor Silmer assistivo"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 61 - "Fase 7 — Hardening, UAT e piloto"
Cohesion: 0.33
Nodes (6): Fase 7 — Hardening, UAT e piloto, T07.1 Executar testes de carga e concorrência, T07.2 Executar auditoria de segurança e acessibilidade, T07.3 Executar recovery drill, T07.4 Executar UAT operacional, T07.5 Fazer go-live controlado

### Community 62 - "edge-web/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 63 - "Codex — Contexto do CRM Silmer"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

### Community 64 - "T00.7 — Observabilidade e hardening mínimos"
Cohesion: 0.40
Nodes (4): Evidência local versionada, Gate externo ainda aberto, T00.7 — Observabilidade e hardening mínimos, Verificação local

### Community 65 - "Baseline de identidade e acesso da Fase 1"
Cohesion: 0.40
Nodes (4): Baseline de identidade e acesso da Fase 1, Gates, Invariantes operacionais, Parâmetros versionados

### Community 66 - "Política de segurança"
Cohesion: 0.40
Nodes (4): Dependabot Configuration, Como reportar uma vulnerabilidade, Política de segurança, Versões suportadas

### Community 67 - "Issue 7 Package Logic"
Cohesion: 0.40
Nodes (5): Issue 7 Package Logic, Roteiro para Rose e Operacao, T00.4 - Revisao do PDF canonico da Ficha, validateFichaApprovalGate(), validateFichaSnapshot()

### Community 68 - "check-boundaries.mjs"
Cohesion: 0.40
Nodes (3): frontendPackage, root, workspacePackages

### Community 69 - "serve-edge.mjs"
Cohesion: 0.40
Nodes (4): contentTypes, port, root, server

### Community 70 - "Q: Como o pacote da issue 7 valida o PDF canonico da Ficha, preserva campos de producao vazios e mantem a aprovacao de Rose e Operacao fail-closed?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o pacote da issue 7 valida o PDF canonico da Ficha, preserva campos de producao vazios e mantem a aprovacao de Rose e Operacao fail-closed?, Source Nodes

### Community 72 - "CRM Silmer MVP — Plano de Implementação"
Cohesion: 0.50
Nodes (3): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico

### Community 74 - "ci-images.test.js"
Cohesion: 0.67
Nodes (3): json(), rootUrl, text()

### Community 75 - "CI and Immutable Images Workflow"
Cohesion: 0.67
Nodes (3): API Application, Edge Web Application, CI and Immutable Images Workflow

## Knowledge Gaps
- **564 isolated node(s):** `singleQuote`, `trailingComma`, `name`, `version`, `private` (+559 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CRM Silmer MVP — Plano de Implementação` connect `CRM Silmer MVP — Plano de Implementação` to `Fase 5 — Orçamento, PIX, Pedido e Ficha`, `Fase 0 — Fundação e riscos técnicos`, `Fase 2 — Caixa de Entrada, canais e confiabilidade`, `Fase 1 — Identidade, acesso e infraestrutura de domínio`, `Fase 3 — Negócio, Kanban e qualificação`, `Fase 6 — Privacidade, relatórios e operação`, `Fase 4 — Vendedor Silmer assistivo`, `Fase 7 — Hardening, UAT e piloto`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `TDD — CRM Silmer MVP` to `README.md`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `CRM Silmer — Especificação de Produto do MVP` to `README.md`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `name` to the rest of the system?**
  _564 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `integration-reliability/src/index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06142410015649452 - nodes in this community are weakly interconnected._
- **Should `TDD — CRM Silmer MVP` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `0002_phase1_domain.expand.sql` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._
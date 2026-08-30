# Graph Report - .  (2026-08-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 342 nodes · 320 edges · 35 communities (25 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.9)
- Token cost: 2,541 input · 397 output

## Graph Freshness
- Built from commit: `7d66fdbc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Technical Strategy and MVP
- Design System and UX
- Implementation Roadmap
- Sales Qualification Process
- Data Fields and Journey
- MVP Product Specification
- Infrastructure and Deployment
- Architecture and Backlog
- Traceable MVP Requirements
- AI Sales Automation
- Product Context and Scope
- Foundation and Technical Risks
- Inbox and Channel Integration
- Identity and Domain Infrastructure
- Business Logic and Kanban
- AI Authority Decisions
- Product Readiness Tech Decisions
- AI Autonomy Constraints
- System Readiness Decisions
- Operational Readiness Decisions
- Data Retention and Deletion
- Order Sequencing and Reservation
- Technical Readiness Resolution
- User Role Modeling
- Product and Technical Rules
- Legacy Qualification Flow
- Product Gate Approval
- Project Blockers and Estimates
- Tech Lead Specifications
- Data Contract Resolution
- Pricing Authority Resolution
- Financial Limit Resolution
- AI Operational Limits
- Identity and Numbering Resolution
- Project Closing Workshop

## God Nodes (most connected - your core abstractions)
1. `TDD — CRM Silmer MVP` - 22 edges
2. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
3. `Design do CRM Silmer` - 16 edges
4. `Topologia EasyPanel — CRM Silmer` - 15 edges
5. `CRM Silmer MVP — Plano de Implementação` - 11 edges
6. `Fase 5 — Orçamento, PIX, Pedido e Ficha` - 10 edges
7. `Campos da Ficha e Jornada Conversacional — P0.1` - 10 edges
8. `CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)` - 9 edges
9. `CHAT NA LANDING PAGE — o que existe e o que falta` - 9 edges
10. `Fase 0 — Fundação e riscos técnicos` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Ficha de Pedido` --shares_data_with--> `Rose (Destinatária Ficha)`  [EXTRACTED]
  CAMPOS-FICHA-E-JORNADA-P0-1.md → CRM-MVP-ESPECIFICACAO.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — caixa_de_entrada, kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]
- **Migração do Datacrazy para CRM Próprio** — historico_datacrazy_crm_processo_vendas, historico_datacrazy_datacrazy_setup, specs_features_crm_mvp_context, specs_features_crm_mvp_spec [INFERRED 0.85]

## Communities (35 total, 10 thin omitted)

### Community 0 - "Technical Strategy and MVP"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 1 - "Design System and UX"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 2 - "Implementation Roadmap"
Cohesion: 0.06
Nodes (32): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico, Fase 4 — Vendedor Silmer assistivo, Fase 5 — Orçamento, PIX, Pedido e Ficha, Fase 6 — Privacidade, relatórios e operação, Fase 7 — Hardening, UAT e piloto, T04.1 Implementar compositor de contexto (+24 more)

### Community 3 - "Sales Qualification Process"
Cohesion: 0.08
Nodes (23): 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano, 7. O que a IA e o vendedor nunca afirmam, 8. Pendências que travam o processo hoje (+15 more)

### Community 4 - "Data Fields and Journey"
Cohesion: 0.08
Nodes (22): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+14 more)

### Community 5 - "MVP Product Specification"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 6 - "Infrastructure and Deployment"
Cohesion: 0.09
Nodes (22): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços por projeto, 3. Rede e domínios (+14 more)

### Community 7 - "Architecture and Backlog"
Cohesion: 0.12
Nodes (14): Sobre o CRM Silmer, Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis (+6 more)

### Community 8 - "Traceable MVP Requirements"
Cohesion: 0.12
Nodes (16): CRM Silmer MVP — Requisitos Rastreáveis, Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Qualificação autônoma, P1.3 Ficha de Pedido (+8 more)

### Community 9 - "AI Sales Automation"
Cohesion: 0.20
Nodes (10): Agente "Vendedor Silmer", Automação, Base de conhecimento, BLOQUEADORES (não resolvidos), Campos adicionais de lead (13 novos), Datacrazy — Automação "Vendedor Silmer" (SDR WhatsApp → Vendedor humano), Fluxo desenhado, O que já está configurado (+2 more)

### Community 10 - "Product Context and Scope"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 11 - "Foundation and Technical Risks"
Cohesion: 0.25
Nodes (8): Fase 0 — Fundação e riscos técnicos, T00.1 Estruturar o monorepo JavaScript ESM, T00.2 Criar CI e imagens imutáveis, T00.3 Provisionar EasyPanel dev/hml/prod, T00.4 Fechar spikes externos, T00.5 Definir threat model e catálogo de dados, T00.6 Aprovar defaults de domínio e papéis, T00.7 Implantar telemetria e hardening mínimos

### Community 12 - "Inbox and Channel Integration"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 13 - "Identity and Domain Infrastructure"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 14 - "Business Logic and Kanban"
Cohesion: 0.29
Nodes (7): Fase 3 — Negócio, Kanban e qualificação, T03.1 Implementar conversão idempotente em Negócio, T03.2 Implementar máquina de estados do Deal, T03.3 Implementar campos e itens da Ficha, T03.4 Implementar Kanban acessível, T03.5 Implementar tarefas, responsável e handoff humano, T03.6 Implementar detalhe acessível do Negócio

### Community 15 - "AI Authority Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 16 - "Product Readiness Tech Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 17 - "AI Autonomy Constraints"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 18 - "System Readiness Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 19 - "Operational Readiness Decisions"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 20 - "Data Retention and Deletion"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 21 - "Order Sequencing and Reservation"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 22 - "Technical Readiness Resolution"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 23 - "User Role Modeling"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 24 - "Product and Technical Rules"
Cohesion: 0.50
Nodes (3): Regras de produto, Regras do CRM Silmer, Regras técnicas já impostas

## Knowledge Gaps
- **256 isolated node(s):** `Limite da feature`, `Backlog e lead`, `Vendedor Silmer`, `Integrações`, `Ficha, financeiro, privacidade e acesso` (+251 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CRM Silmer MVP — Plano de Implementação` connect `Implementation Roadmap` to `Architecture and Backlog`, `Foundation and Technical Risks`, `Inbox and Channel Integration`, `Identity and Domain Infrastructure`, `Business Logic and Kanban`?**
  _High betweenness centrality (0.140) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `Technical Strategy and MVP` to `Architecture and Backlog`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `MVP Product Specification` to `Architecture and Backlog`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **What connects `Limite da feature`, `Backlog e lead`, `Vendedor Silmer` to the rest of the system?**
  _256 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Technical Strategy and MVP` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Design System and UX` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `Implementation Roadmap` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._
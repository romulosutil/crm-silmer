# Graph Report - crm-silmer  (2026-08-30)

## Corpus Check
- 28 files · ~32,403 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 371 nodes · 366 edges · 29 communities (28 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `979f4060`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Technical Strategy and MVP
- Design System and UX
- CRM Silmer MVP — Plano de Implementação
- Sales Qualification Process
- Campos da Ficha e Jornada Conversacional — P0.1
- MVP Product Specification
- Infrastructure and Deployment
- README.md
- CRM Silmer MVP — Requisitos Rastreáveis
- AI Sales Automation
- Product Context and Scope
- Foundation and Technical Risks
- Inbox and Channel Integration
- Identity and Domain Infrastructure
- Fase 5 — Orçamento, PIX, Pedido e Ficha
- AI Authority Decisions
- Product Readiness Tech Decisions
- AI Autonomy Constraints
- System Readiness Decisions
- Operational Readiness Decisions
- Data Retention and Deletion
- Order Sequencing and Reservation
- Technical Readiness Resolution
- User Role Modeling
- Agentes do CRM Silmer
- Legacy Qualification Flow
- Passagem de Produto para Tech Lead
- Arquitetura — Decisões do MVP
- Codex — Contexto do CRM Silmer

## God Nodes (most connected - your core abstractions)
1. `TDD — CRM Silmer MVP` - 22 edges
2. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
3. `Design do CRM Silmer` - 16 edges
4. `Topologia EasyPanel — CRM Silmer` - 15 edges
5. `Passagem de Produto para Tech Lead` - 12 edges
6. `CRM Silmer MVP — Plano de Implementação` - 11 edges
7. `Fase 5 — Orçamento, PIX, Pedido e Ficha` - 10 edges
8. `Campos da Ficha e Jornada Conversacional — P0.1` - 10 edges
9. `CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)` - 9 edges
10. `CHAT NA LANDING PAGE — o que existe e o que falta` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Ficha de Pedido` --shares_data_with--> `Rose (Destinatária Ficha)`  [EXTRACTED]
  CAMPOS-FICHA-E-JORNADA-P0-1.md → CRM-MVP-ESPECIFICACAO.md

## Hyperedges (group relationships)
- **Documentação Central do MVP** — crm_mvp_especificacao, technical_design, easypanel_topology, product_readiness_tech_lead [EXTRACTED 1.00]
- **Fluxo Comercial Silmer** — caixa_de_entrada, kanban_comercial, vendedor_silmer, ficha_pedido [EXTRACTED 1.00]
- **Trilha de Implementação Técnica** — technical_design, easypanel_topology, specs_features_crm_mvp_tasks [EXTRACTED 1.00]
- **Migração do Datacrazy para CRM Próprio** — historico_datacrazy_crm_processo_vendas, historico_datacrazy_datacrazy_setup, specs_features_crm_mvp_context, specs_features_crm_mvp_spec [INFERRED 0.85]

## Communities (29 total, 1 thin omitted)

### Community 0 - "Technical Strategy and MVP"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 1 - "Design System and UX"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 2 - "CRM Silmer MVP — Plano de Implementação"
Cohesion: 0.07
Nodes (29): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico, Fase 3 — Negócio, Kanban e qualificação, Fase 4 — Vendedor Silmer assistivo, Fase 6 — Privacidade, relatórios e operação, Fase 7 — Hardening, UAT e piloto, T03.1 Implementar conversão idempotente em Negócio (+21 more)

### Community 3 - "Sales Qualification Process"
Cohesion: 0.08
Nodes (23): 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano, 7. O que a IA e o vendedor nunca afirmam, 8. Pendências que travam o processo hoje (+15 more)

### Community 4 - "Campos da Ficha e Jornada Conversacional — P0.1"
Cohesion: 0.09
Nodes (22): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+14 more)

### Community 5 - "MVP Product Specification"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 6 - "Infrastructure and Deployment"
Cohesion: 0.09
Nodes (22): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços por projeto, 3. Rede e domínios (+14 more)

### Community 7 - "README.md"
Cohesion: 0.09
Nodes (19): Sobre o CRM Silmer, Caixa de Entrada (Backlog), Antes de alterar, Commits e publicação, Contribuindo com o CRM Silmer, Durante a implementação, Validação, Ficha de Pedido (+11 more)

### Community 8 - "CRM Silmer MVP — Requisitos Rastreáveis"
Cohesion: 0.12
Nodes (15): Critério de passagem, CRM Silmer MVP — Requisitos Rastreáveis, Fora do escopo, Objetivos, P1.1 Caixa de Entrada e conversão, P1.2 Atendimento assistido pelo Vendedor Silmer, P1.3 Ficha de Pedido, P1.4 Confiabilidade e canais (+7 more)

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

### Community 14 - "Fase 5 — Orçamento, PIX, Pedido e Ficha"
Cohesion: 0.20
Nodes (10): Fase 5 — Orçamento, PIX, Pedido e Ficha, T05.1 Implementar orçamento versionado, T05.2 Implementar ledger de vendido, T05.3 Implementar subfluxo PIX, T05.4 Implementar número e Pedido, T05.5 Implementar ciclo da Ficha, T05.6 Implementar PDF íntegro e reproduzível, T05.7 Implementar envio e onboarding (+2 more)

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

### Community 24 - "Agentes do CRM Silmer"
Cohesion: 0.25
Nodes (8): Agentes do CRM Silmer, Composição eficiente por tipo de tarefa, Contrato de delegação e handoff, Definition of Done resumida, Equipe por responsabilidade, Escopo e missão, Precedência das fontes, Protocolo obrigatório

### Community 26 - "Passagem de Produto para Tech Lead"
Cohesion: 0.14
Nodes (12): Decisões P0 para aprovação final e estimativa fechada, Gate recomendado, O que o Tech Lead já pode especificar, P0.1 resolvido — contrato de passagem, P0.2 resolvido — autoridade sobre preço, P0.3 resolvido — limite financeiro comercial, P0.4 resolvido — canais e limite operacional da IA, P0.5 resolvido — identidade, FAB e numeração da Ficha (+4 more)

### Community 27 - "Arquitetura — Decisões do MVP"
Cohesion: 0.29
Nodes (7): Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis

### Community 28 - "Codex — Contexto do CRM Silmer"
Cohesion: 0.40
Nodes (5): Codex — Contexto do CRM Silmer, Fechamento, Forma de trabalhar, Guardrails do MVP, Inicialização obrigatória

## Knowledge Gaps
- **274 isolated node(s):** `Limite da feature`, `Backlog e lead`, `Vendedor Silmer`, `Integrações`, `Ficha, financeiro, privacidade e acesso` (+269 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CRM Silmer MVP — Plano de Implementação` connect `CRM Silmer MVP — Plano de Implementação` to `README.md`, `Foundation and Technical Risks`, `Inbox and Channel Integration`, `Identity and Domain Infrastructure`, `Fase 5 — Orçamento, PIX, Pedido e Ficha`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Why does `TDD — CRM Silmer MVP` connect `Technical Strategy and MVP` to `README.md`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `MVP Product Specification` to `README.md`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `Limite da feature`, `Backlog e lead`, `Vendedor Silmer` to the rest of the system?**
  _274 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Technical Strategy and MVP` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Design System and UX` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `CRM Silmer MVP — Plano de Implementação` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
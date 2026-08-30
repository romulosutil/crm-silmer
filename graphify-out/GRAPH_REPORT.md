# Graph Report - crm-silmer  (2026-08-30)

## Corpus Check
- 24 files · ~29,354 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 352 nodes · 334 edges · 29 communities (26 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3389814a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Design do CRM Silmer
- Especificação do MVP
- Mapeamento de Campos e Jornada
- Arquitetura — Decisões do MVP
- CHAT NA LANDING PAGE — o que existe e o que falta
- CRM Silmer MVP — Requisitos Rastreáveis
- CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)
- Transferência para Tech Lead
- CRM Silmer MVP — Contexto de Produto
- Q: Como o P0.7 modela Admin, Atendimento e Vendedor?
- TDD — CRM Silmer MVP
- CRM Silmer MVP — Plano de Implementação
- Decisões de Autoridade de Preço
- Resoluções de Limite Operacional
- Autonomia do Vendedor IA
- Auditoria e Permissões Técnicas
- Identidade e Numeração Ficha
- Retenção e Exclusão de Dados
- Definições de FAB e Reserva
- Resolução de Privacidade
- Gestão de Privacidade e Admin
- Contrato de Passagem Técnica
- Limite Financeiro Comercial
- Identidade e Sequenciamento Ficha
- Topologia EasyPanel — CRM Silmer
- Fase 2 — Caixa de Entrada, canais e confiabilidade
- Fase 1 — Identidade, acesso e infraestrutura de domínio
- Fase 4 — Vendedor Silmer assistivo
- Fase 6 — Privacidade, relatórios e operação

## God Nodes (most connected - your core abstractions)
1. `TDD — CRM Silmer MVP` - 22 edges
2. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
3. `Design do CRM Silmer` - 16 edges
4. `Topologia EasyPanel — CRM Silmer` - 15 edges
5. `CRM Silmer MVP — Plano de Implementação` - 11 edges
6. `Campos da Ficha e Jornada Conversacional — P0.1` - 10 edges
7. `Passagem de Produto para Tech Lead` - 10 edges
8. `Fase 5 — Orçamento, PIX, Pedido e Ficha` - 9 edges
9. `CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)` - 9 edges
10. `CHAT NA LANDING PAGE — o que existe e o que falta` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Vendedor Silmer (IA)` --calls--> `Caixa de Entrada (Backlog)`  [INFERRED]
  PRODUCT-READINESS-TECH-LEAD.md → CRM-MVP-ESPECIFICACAO.md
- `Vendedor Silmer (IA)` --calls--> `Kanban Comercial`  [INFERRED]
  PRODUCT-READINESS-TECH-LEAD.md → CRM-MVP-ESPECIFICACAO.md
- `CRM Silmer MVP — Requisitos Rastreáveis` --references--> `Vendedor Silmer (IA)`  [EXTRACTED]
  .specs/features/crm-mvp/spec.md → PRODUCT-READINESS-TECH-LEAD.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Decisões P0 para Prontidão Técnica** — product_readiness_tech_lead_p0_1, product_readiness_tech_lead_p0_2, product_readiness_tech_lead_p0_3, product_readiness_tech_lead_p0_4, product_readiness_tech_lead_p0_5, product_readiness_tech_lead_p0_6, product_readiness_tech_lead_p0_7 [EXTRACTED 1.00]
- **Migração do Datacrazy para CRM Próprio** — historico_datacrazy_crm_processo_vendas, historico_datacrazy_datacrazy_setup, specs_features_crm_mvp_context, specs_features_crm_mvp_spec [INFERRED 0.85]

## Communities (29 total, 3 thin omitted)

### Community 0 - "Design do CRM Silmer"
Cohesion: 0.05
Nodes (37): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+29 more)

### Community 1 - "Especificação do MVP"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 2 - "Mapeamento de Campos e Jornada"
Cohesion: 0.09
Nodes (22): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+14 more)

### Community 3 - "Arquitetura — Decisões do MVP"
Cohesion: 0.11
Nodes (14): Sobre o CRM Silmer, Aprovações ainda necessárias, Arquitetura — Decisões do MVP, Decisões confirmadas, Decisões de modelagem, Decisões técnicas propostas como baseline, Fronteiras funcionais, Projetos e documentos executáveis (+6 more)

### Community 4 - "CHAT NA LANDING PAGE — o que existe e o que falta"
Cohesion: 0.08
Nodes (24): A validar no primeiro teste real, Agente "Vendedor Silmer", Ajuste necessário no prompt do agente, Alternativas sem o custo da Crazy API, Arquitetura necessária, ATENÇÃO — definir qual número vai hospedar o agente, Automação, Base de conhecimento (+16 more)

### Community 5 - "CRM Silmer MVP — Requisitos Rastreáveis"
Cohesion: 0.09
Nodes (24): Caixa de Entrada (Backlog), Kanban Comercial, P0.2 — Autoridade sobre Preço, P0.4 — Canais e Limite Operacional da IA, P0.7 — Permissões e Auditoria da Ficha, Role Admin, CRM Silmer MVP — Requisitos Rastreáveis, Critério de passagem (+16 more)

### Community 6 - "CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)"
Cohesion: 0.14
Nodes (11): Fluxo de Qualificação — Referência Substituída, Sheet: OS Silmer 2013, 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano (+3 more)

### Community 7 - "Transferência para Tech Lead"
Cohesion: 0.18
Nodes (10): Passagem de Produto para Tech Lead, Gate recomendado, O que impede aprovação final e estimativa fechada, O que o Tech Lead já pode especificar, P0.1 resolvido — contrato de passagem, P0.2 resolvido — autoridade sobre preço, P0.3 resolvido — limite financeiro comercial, P0.4 resolvido — canais e limite operacional da IA (+2 more)

### Community 8 - "CRM Silmer MVP — Contexto de Produto"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 9 - "Q: Como o P0.7 modela Admin, Atendimento e Vendedor?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 10 - "TDD — CRM Silmer MVP"
Cohesion: 0.05
Nodes (41): 10. Confiabilidade e processamento assíncrono, 11. Vendedor Silmer e IA, 12. Segurança e LGPD, 13. Performance, capacidade e SLOs iniciais, 14. Observabilidade, 15. Estratégia de testes, 16. Deploy e rollback, 17. Riscos e mitigação (+33 more)

### Community 11 - "CRM Silmer MVP — Plano de Implementação"
Cohesion: 0.06
Nodes (32): CRM Silmer MVP — Plano de Implementação, Definition of Done global, Dependências e caminho crítico, Fase 0 — Fundação e riscos técnicos, Fase 3 — Negócio, Kanban e qualificação, Fase 5 — Orçamento, PIX, Pedido e Ficha, Fase 7 — Hardening, UAT e piloto, T00.1 Estruturar o monorepo JavaScript ESM (+24 more)

### Community 12 - "Decisões de Autoridade de Preço"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes fecham o P0.2 de autoridade do Vendedor Silmer sobre preco?, Source Nodes

### Community 13 - "Resoluções de Limite Operacional"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.4 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 14 - "Autonomia do Vendedor IA"
Cohesion: 0.50
Nodes (3): Answer, Q: Como a nova decisao do P0.4 limita a autonomia do Vendedor Silmer?, Source Nodes

### Community 15 - "Auditoria e Permissões Técnicas"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.7 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 16 - "Identidade e Numeração Ficha"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisões resolvem o P0.5 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 17 - "Retenção e Exclusão de Dados"
Cohesion: 0.50
Nodes (3): Answer, Q: Quais decisoes resolvem o P0.6 de retencao e exclusao?, Source Nodes

### Community 18 - "Definições de FAB e Reserva"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.5 define FAB, sequência, reserva, concorrência e reutilização do número da Ficha?, Source Nodes

### Community 19 - "Resolução de Privacidade"
Cohesion: 0.50
Nodes (3): Answer, Q: Como foi resolvido o P0.6 do PRODUCT-READINESS-TECH-LEAD?, Source Nodes

### Community 20 - "Gestão de Privacidade e Admin"
Cohesion: 0.67
Nodes (3): Administrador Técnico, P0.6 — Retenção, Exclusão e Responsáveis de Privacidade, Responsável de Privacidade

### Community 24 - "Topologia EasyPanel — CRM Silmer"
Cohesion: 0.09
Nodes (21): 10. Backups e disaster recovery, 11. Observabilidade e alertas, 12. Gates antes do piloto, 13. Riscos aceitos e evolução, 14. Referências verificadas, 1. Decisão, 2. Serviços por projeto, 3. Rede e domínios (+13 more)

### Community 25 - "Fase 2 — Caixa de Entrada, canais e confiabilidade"
Cohesion: 0.25
Nodes (8): Fase 2 — Caixa de Entrada, canais e confiabilidade, T02.1 Implementar adapter canônico de canais, T02.2 Implementar webhook WhatsApp, T02.3 Implementar fila PostgreSQL e worker, T02.4 Implementar Conversa, Mensagem e Contato, T02.5 Implementar reconciliação e saúde do canal, T02.6 Implementar UI da Caixa de Entrada, T02.7 Implementar Instagram Direct feature-gated

### Community 26 - "Fase 1 — Identidade, acesso e infraestrutura de domínio"
Cohesion: 0.29
Nodes (7): Fase 1 — Identidade, acesso e infraestrutura de domínio, T01.1 Implementar migrations e acesso PostgreSQL, T01.2 Implementar sessão e usuários por convite, T01.3 Implementar funções e capacidades ortogonais, T01.4 Criar audit trail e idempotency records, T01.5 Criar configuração versionada, T01.6 Implementar catálogo versionado

### Community 27 - "Fase 4 — Vendedor Silmer assistivo"
Cohesion: 0.33
Nodes (6): Fase 4 — Vendedor Silmer assistivo, T04.1 Implementar compositor de contexto, T04.2 Implementar adapter AIProvider, T04.3 Implementar sugestões separadas, T04.4 Implementar takeover seguro, T04.5 Criar evals de segurança comercial

### Community 28 - "Fase 6 — Privacidade, relatórios e operação"
Cohesion: 0.33
Nodes (6): Fase 6 — Privacidade, relatórios e operação, T06.1 Implementar retenção por classe, T06.2 Implementar legal hold e solicitações, T06.3 Implementar tombstones de restore, T06.4 Implementar relatórios comerciais, T06.5 Implementar observabilidade e alertas

## Knowledge Gaps
- **260 isolated node(s):** `Limite da feature`, `Backlog e lead`, `Vendedor Silmer`, `Integrações`, `Ficha, financeiro, privacidade e acesso` (+255 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Design do CRM Silmer` connect `Design do CRM Silmer` to `Arquitetura — Decisões do MVP`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `Especificação do MVP` to `Arquitetura — Decisões do MVP`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `Vendedor Silmer (IA)` connect `CRM Silmer MVP — Requisitos Rastreáveis` to `Arquitetura — Decisões do MVP`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `Limite da feature`, `Backlog e lead`, `Vendedor Silmer` to the rest of the system?**
  _260 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Design do CRM Silmer` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `Especificação do MVP` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `Mapeamento de Campos e Jornada` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
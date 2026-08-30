# Graph Report - crm-silmer  (2026-08-29)

## Corpus Check
- 21 files · ~20,279 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 225 nodes · 210 edges · 24 communities (21 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ff62238e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Design System e UX
- Especificação do MVP
- Mapeamento de Campos e Jornada
- Documentação de Arquitetura
- O que já está configurado
- CRM Silmer MVP — Requisitos Rastreáveis
- CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)
- Transferência para Tech Lead
- CRM Silmer MVP — Contexto de Produto
- Q: Como o P0.7 modela Admin, Atendimento e Vendedor?
- Integração Chat Landing Page
- Interface e Superfícies CRM
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

## God Nodes (most connected - your core abstractions)
1. `CRM Silmer — Especificação de Produto do MVP` - 17 edges
2. `Design do CRM Silmer` - 16 edges
3. `Campos da Ficha e Jornada Conversacional — P0.1` - 10 edges
4. `Passagem de Produto para Tech Lead` - 10 edges
5. `CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)` - 9 edges
6. `CHAT NA LANDING PAGE — o que existe e o que falta` - 9 edges
7. `CRM Silmer MVP — Requisitos Rastreáveis` - 8 edges
8. `P1 — MVP` - 8 edges
9. `O que já está configurado` - 7 edges
10. `5. Roteiro conversacional por etapa` - 7 edges

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

## Communities (24 total, 3 thin omitted)

### Community 0 - "Design System e UX"
Cohesion: 0.06
Nodes (31): 10. Interação e movimento, 11. Acessibilidade, 12. Linguagem e conteúdo, 13. Arquitetura de implementação visual, 14. Critérios de aceite do design system, 15. Antipadrões proibidos, 1. Objetivo, 2. Tradução da marca para o produto (+23 more)

### Community 1 - "Especificação do MVP"
Cohesion: 0.09
Nodes (23): 10. Jornada comercial aprovada, 11. Geração e envio da Ficha, 12. Financeiro comercial do MVP, 13. Privacidade e LGPD, 14. Critérios de sucesso do piloto, 15. Gate de produto para o Tech Lead, 16. Próximo passo recomendado, 1. Visão do produto (+15 more)

### Community 2 - "Mapeamento de Campos e Jornada"
Cohesion: 0.09
Nodes (22): 1. Leitura técnica do arquivo, 2.1 Identificação do pedido, 2.2 Itens, partes da peça e grade, 2.3 Observações do pedido, 2.4 Campos posteriores de produção, 2. Inventário completo dos campos da planilha, 3. Campos necessários no CRM que não existem na planilha, 4. Jornada definitiva e critérios de passagem (+14 more)

### Community 3 - "Documentação de Arquitetura"
Cohesion: 0.12
Nodes (11): Sobre o CRM Silmer, Arquitetura — Estado e Restrições, Decisões confirmadas, Decisões para o Tech Lead, Fronteiras funcionais, Ficha de Pedido (ficha_exemplo.xlsx), Arquivo Histórico Datacrazy, Jornada de Pagamento PIX (+3 more)

### Community 4 - "O que já está configurado"
Cohesion: 0.10
Nodes (17): Fluxo de Qualificação — Referência Substituída, Sheet: OS Silmer 2013, Agente "Vendedor Silmer", Alternativas sem o custo da Crazy API, ATENÇÃO — definir qual número vai hospedar o agente, Automação, Base de conhecimento, BLOQUEADORES (não resolvidos) (+9 more)

### Community 5 - "CRM Silmer MVP — Requisitos Rastreáveis"
Cohesion: 0.09
Nodes (24): Caixa de Entrada (Backlog), Kanban Comercial, P0.2 — Autoridade sobre Preço, P0.4 — Canais e Limite Operacional da IA, P0.7 — Permissões e Auditoria da Ficha, Role Admin, CRM Silmer MVP — Requisitos Rastreáveis, Critério de passagem (+16 more)

### Community 6 - "CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)"
Cohesion: 0.22
Nodes (9): 1. Visão geral do fluxo, 2. Card rápido de briefing, 3. Roteiro completo de qualificação — os 13 campos, 4. Tags e tipificação, 5. Pipeline "Vendas Estamparia" — as 5 etapas, 6. Transferência da IA pro vendedor humano, 7. O que a IA e o vendedor nunca afirmam, 8. Pendências que travam o processo hoje (+1 more)

### Community 7 - "Transferência para Tech Lead"
Cohesion: 0.18
Nodes (10): Passagem de Produto para Tech Lead, Gate recomendado, O que impede aprovação final e estimativa fechada, O que o Tech Lead já pode especificar, P0.1 resolvido — contrato de passagem, P0.2 resolvido — autoridade sobre preço, P0.3 resolvido — limite financeiro comercial, P0.4 resolvido — canais e limite operacional da IA (+2 more)

### Community 8 - "CRM Silmer MVP — Contexto de Produto"
Cohesion: 0.20
Nodes (9): Backlog e lead, CRM Silmer MVP — Contexto de Produto, Decisões confirmadas, Discrição do Tech Lead, Ficha, financeiro, privacidade e acesso, Ideias adiadas, Integrações, Limite da feature (+1 more)

### Community 9 - "Q: Como o P0.7 modela Admin, Atendimento e Vendedor?"
Cohesion: 0.50
Nodes (3): Answer, Q: Como o P0.7 modela Admin, Atendimento e Vendedor?, Source Nodes

### Community 10 - "Integração Chat Landing Page"
Cohesion: 0.22
Nodes (9): A validar no primeiro teste real, Ajuste necessário no prompt do agente, Arquitetura necessária, CHAT NA LANDING PAGE — o que existe e o que falta, Esforço estimado, O que a Conexão Universal pede, Pendências de conteúdo (a Silmer precisa fornecer), Ponto de atenção do fluxo no site (+1 more)

### Community 11 - "Interface e Superfícies CRM"
Cohesion: 0.33
Nodes (6): 9. Padrões por superfície do CRM, Caixa de Entrada, Conversa e atuação do Vendedor Silmer, Ficha de Pedido, Financeiro comercial, Kanban Comercial

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

## Knowledge Gaps
- **160 isolated node(s):** `Limite da feature`, `Backlog e lead`, `Vendedor Silmer`, `Integrações`, `Ficha, financeiro, privacidade e acesso` (+155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Design do CRM Silmer` connect `Design System e UX` to `Interface e Superfícies CRM`, `Documentação de Arquitetura`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **Why does `CRM Silmer — Especificação de Produto do MVP` connect `Especificação do MVP` to `Documentação de Arquitetura`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `Vendedor Silmer (IA)` connect `CRM Silmer MVP — Requisitos Rastreáveis` to `Documentação de Arquitetura`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **What connects `Limite da feature`, `Backlog e lead`, `Vendedor Silmer` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Design System e UX` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Especificação do MVP` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `Mapeamento de Campos e Jornada` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
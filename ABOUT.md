# Sobre o CRM Silmer

O CRM Silmer é um produto web próprio para organizar conversas comerciais, qualificação, vendas e geração de Fichas de Pedido. Ele substitui integralmente o Datacrazy.

O fluxo começa na Caixa de Entrada, tratada como backlog de conversas. Apenas oportunidades comerciais viram leads e entram no Kanban. No MVP, uma pessoa confirma a conversão; o agente de IA Vendedor Silmer conversa, coleta dados e sugere o próximo passo sem alterar o estado oficial do CRM.

O canal obrigatório do piloto é a API oficial do WhatsApp Business. O Instagram Direct participa quando disponível, mas não bloqueia o lançamento. O artefato central do domínio é `ficha_exemplo.xlsx`: os dados necessários para produzir e cobrar um pedido definem as perguntas, validações e etapas da jornada.

Documentos principais:

- `CRM-MVP-ESPECIFICACAO.md`: PRD e escopo canônico.
- `.specs/features/crm-mvp/spec.md`: requisitos rastreáveis e critérios de aceite.
- `.specs/features/crm-mvp/context.md`: decisões de produto já tomadas.
- `PRODUCT-READINESS-TECH-LEAD.md`: gate de passagem para especificação técnica.
- `CAMPOS-FICHA-E-JORNADA-P0-1.md`: inventário integral da Ficha, etapas
  definitivas, gates, PIX e boas-vindas.
- `RULES.md`: invariantes de produto e implementação.
- `ARCHITECTURE.md`: restrições e fronteiras já conhecidas; decisões técnicas ainda abertas.
- `historico-datacrazy/`: arquivo histórico, sem valor normativo para o sistema novo.

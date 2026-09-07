# Sobre o CRM Silmer

O CRM Silmer é um produto web próprio para organizar conversas comerciais, qualificação, vendas e geração de Fichas de Pedido. Ele substitui integralmente o Datacrazy.

O fluxo começa quando uma mensagem válida do cliente dispara automaticamente um workflow no n8n. O n8n é o motor obrigatório da jornada: integra os canais, executa o Vendedor Silmer, cria ou atualiza leads pelo contrato da API do CRM, move o Kanban quando os gates forem satisfeitos e transfere para uma pessoa quando necessário. Não existe botão da interface para iniciar essa automação.

O MVP é organizado em três objetivos que evoluem em paralelo e se conectam no lançamento:

1. **CRM:** fonte oficial dos dados, regras, permissões, estados, auditoria, pedidos e relatórios.
2. **Inbox Multicanal:** visão operacional das conversas, mensagens, pendências e tomada humana.
3. **Agente Vendedor Silmer no n8n:** integração WhatsApp, IA, orquestração da jornada, atualizações comerciais e handoff.

O n8n nunca acessa diretamente o banco. Toda mutação oficial passa pela API idempotente e autorizada do CRM; a interface observa o fluxo e permite intervenção humana, mas não o dispara.

Os canais obrigatórios do piloto são WhatsApp Business e Instagram Direct,
ambos integrados no n8n e conduzidos pela mesma jornada. O atendimento pode
migrar entre os canais preservando o Negócio; após correlação verificável, o
lead mantém o `@instagram` e o telefone como identidades distintas da mesma
pessoa. O artefato central do domínio é `ficha_exemplo.xlsx`: os dados
necessários para produzir e cobrar um pedido definem as perguntas, validações e
etapas da jornada.

Documentos principais:

- `README.md`: porta de entrada, estado atual e ordem de leitura.
- `AGENTS.md`: protocolo, papéis e Definition of Done para agentes.
- `CODEX.md`: contexto inicial e guardrails específicos do Codex.
- `CONTRIBUTING.md`: fluxo de contribuição, validação e publicação.
- `CRM-MVP-ESPECIFICACAO.md`: PRD e escopo canônico.
- `.specs/features/crm-mvp/spec.md`: requisitos rastreáveis e critérios de aceite.
- `.specs/features/crm-mvp/context.md`: decisões de produto já tomadas.
- `PRODUCT-READINESS-TECH-LEAD.md`: gate de passagem para especificação técnica.
- `CAMPOS-FICHA-E-JORNADA-P0-1.md`: inventário integral da Ficha, etapas
  definitivas, gates, PIX e boas-vindas.
- `RULES.md`: invariantes de produto e implementação.
- `ARCHITECTURE.md`: resumo das fronteiras e decisões técnicas propostas como baseline.
- `docs/adr/`: decisões arquiteturais tomadas, imutáveis e numeradas.
- `docs/rfc/`: propostas relevantes em avaliação antes da decisão.
- `TECHNICAL-DESIGN.md`: TDD canônico com stack, módulos, dados, APIs,
  segurança, SLOs, riscos e decisões técnicas do MVP.
- `EASYPANEL-TOPOLOGY.md`: projetos, serviços, sizing, CI/CD, backups e
  operação na VPS Hostinger/EasyPanel.
- `docs/phase0/TRANSIENT-MEDIA.md`: mídia temporária por até sete dias,
  handoff operacional ao Dropbox e diferimento do R2.
- `.specs/features/crm-mvp/tasks.md`: plano de implementação por fases com
  verificação e rastreabilidade.
- `historico-datacrazy/`: arquivo histórico, sem valor normativo para o sistema novo.

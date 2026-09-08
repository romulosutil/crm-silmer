# ADR 003 — Adotar integração n8n simples para o MVP

- Status: aceito
- Data: 2026-09-08
- RFC: [RFC 002](../rfc/002-simplificar-integracao-n8n-para-o-mvp.md)
- Supersede: [ADR 002](002-adotar-adaptador-de-integracao-n8n.md)
- Requisitos: ORC-01–08, INB-01–04, AGT-01–08, MSG-01–03, PRV-01–03
- Tarefa: N8N-MVP-1

## Decisão

O piloto WhatsApp usará um adaptador n8n de três rotas e um modelo de domínio
centrado em Contato/Identidade, Conversa, Mensagem, Handoff e Negócio.

Basic Auth, idempotência, correlação, metadados técnicos de workflow,
`automation_epoch`, revisão de origem, reserva única antes da Meta, auditoria e
outbox de comandos humanos permanecem obrigatórios. O fence é avaliado no
momento da mutação ou do envio, sem claim, lease ou token de rodada antecipado.

O briefing passa a ser um único snapshot criptografado na Conversa. O estado
de entrega permanece na Mensagem. `ai_turns`, `automation_runs`, versões de
briefing e tentativas detalhadas de entrega não serão usados pelo runtime do
MVP.

## Consequências

- O contrato externo cai de quatro para três rotas.
- O workflow perde a etapa de claim e deixa de propagar versão da conversa,
  `claim_id` e token; conserva somente a revisão da mensagem de origem.
- O caminho normal possui uma transação inbound e uma transação de reserva;
  observabilidade detalhada fica no n8n, sem duplicar runs no CRM.
- Uma falha incerta continua visível na Mensagem, mas não ganha nesta fase uma
  tela ou máquina própria de reconciliação.
- As tabelas técnicas da ADR 002 permanecem dormentes durante o rollout e são
  removidas somente por migração de contrato posterior.
- WhatsApp é o único canal desta fatia. Instagram continua planejado, mas
  deixa de bloquear a validação do piloto WhatsApp.

## Guardrails mantidos

- n8n nunca acessa o PostgreSQL do CRM.
- A simples mensagem recebida não cria Negócio.
- Dados comerciais oficiais usam os endpoints canônicos e os gates do CRM.
- Takeover e handoff invalidam respostas atrasadas pelo epoch.
- Replay de reserva nunca autoriza um segundo envio.
- Resultado incerto nunca recebe retry cego.
- Nenhum segredo ou conteúdo pessoal entra em log, métrica ou export.

## Reavaliação

Claims, runs, tentativas e reconciliação dedicada só poderão voltar após uma
falha observada ou requisito operacional mensurável. A nova decisão deve citar
a métrica, o incidente ou o volume que justificou o custo.

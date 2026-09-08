# RFC 001 — Contrato de integração n8n v1

- Status: aceito
- Data: 2026-09-07
- Requisitos: ORC-01–09, INB-01–04, AGT-01–08, MSG-01–04, PRV-01–03
- Tarefas: N8N-1–N8N-7
- Decisão: [ADR 002](../adr/002-adotar-adaptador-de-integracao-n8n.md)
- Contrato executável: [OpenAPI v1](../api/openapi.v1.yaml)

## Contexto

O workflow `k7tI6T4RhQPyJkn9` recebe mensagens do WhatsApp e coordena a IA e os
envios para a Meta. A versão-base preservada é
`98f96069-ede2-4900-aa5c-7fec0d3b80cb`. A integração anterior distribuía
estado, deduplicação e memória entre n8n e CRM, além de usar assinaturas HMAC
específicas por requisição. Isso permitia divergência entre o painel e a
automação, e não fornecia um fence atômico antes do efeito externo.

## Proposta

O PostgreSQL e os agregados canônicos do CRM permanecem como fonte da verdade.
O n8n usa um adaptador HTTP versionado, autenticado exclusivamente por Basic
Auth como `AUTOMATION_EXECUTOR`. Todos os pedidos exigem `Idempotency-Key`,
`X-Correlation-Id`, `X-Silmer-Workflow-Key`,
`X-Silmer-Workflow-Version` e `X-Silmer-Execution-Id`; upload exige também
`X-Silmer-Content-SHA256`.

O adaptador expõe exatamente quatro operações:

1. `POST /api/v1/integrations/n8n/messages/inbound` resolve contato e
   identidade, cria ou reutiliza conversa, persiste uma única mensagem e
   devolve revisão, epoch, modo, contexto recente e briefing.
2. `POST /api/v1/integrations/n8n/conversations/{id}/attachments` recebe um
   único arquivo por streaming, impõe quotas, recalcula SHA-256, detecta MIME,
   saneia o nome e só publica bytes aprovados pelo scanner.
3. `POST /api/v1/integrations/n8n/conversations/{id}/ai-turns/claim` concede um
   lease exclusivo por compare-and-swap de revisão, evento, modo e epoch.
4. `POST /api/v1/integrations/n8n/events` registra reservas de envio, estados
   de entrega, handoff, briefing e falhas com idempotência e fencing.

Os eventos aceitos são `message.send.requested`, `message.sent`,
`message.delivered`, `message.read`, `message.failed`,
`message.send.unknown`, `handoff.requested`, `lead.updated` e
`workflow.failed`.

## Invariantes

- O adaptador não cria outra entidade Cliente: usa `Contact` e
  `ContactIdentity`.
- Inbound não cria Negócio. `lead_patch` ignora nulos e atualiza somente o
  briefing criptografado e versionado.
- Apenas a primeira reserva válida `message.send.requested` autoriza a Meta.
  Replay devolve o resultado anterior e nunca nova autorização.
- Timeout após autorização produz `message.send.unknown` e reconciliação; não
  há retry cego.
- Takeover, handoff, retorno à IA, fechamento e desligamento alteram
  `automation_epoch`, invalidando claims antigos.
- Status de entrega não regride em `sent < delivered < read`; falha pertence à
  tentativa específica.
- Handoff começa sem responsável e com `target_role`. A atribuição usa CAS e
  só aceita pessoa ativa com papel compatível.
- `convertida_em_lead` encerra a triagem, não a conversa. A conversa permanece
  não terminal enquanto houver Negócio ativo.
- Mídia transitória expira no encerramento da jornada ou em sete dias, o que
  ocorrer primeiro.

## Segurança, privacidade e operação

Credenciais n8n→CRM e CRM→n8n são distintas, rotacionáveis e nunca entram em
logs, exportações ou repositório. Erros usam `application/problem+json`, sem
payload ou detalhe sensível. Logs e métricas admitem somente identificadores
opacos e códigos. Dados técnicos de execução são expurgados em até 30 dias.

O workflow permanece inativo durante migração, implantação, criação das duas
credenciais DEV e homologação. O corte transfere o webhook da Meta ao n8n e
desabilita a entrada direta do CRM. Rollback pausa/despublica a automação e
preserva efeitos incertos para reconciliação; não reativa fallback direto.

## Alternativas consideradas

- **n8n como fonte da verdade:** rejeitada por duplicar estado de domínio e
  impedir transações com idempotência, auditoria e fencing.
- **HMAC e timestamp por pedido:** rejeitada porque Basic Auth com TLS,
  allowlist, rotação e auditoria já atende a identidade técnica aprovada.
- **Retry automático após timeout da Meta:** rejeitado por risco de mensagem
  duplicada.
- **Acesso direto do n8n ao PostgreSQL:** rejeitado por violar fronteiras e
  autorização do domínio.

## Rollout e aceite

As fatias N8N-1–N8N-7 cobrem contrato, migrações, inbound/mídia, claim/eventos,
handoff/comandos, worker/observabilidade e workflow/homologação. A publicação
exige testes de contrato e concorrência, PostgreSQL real, privacidade, restart
do worker, indisponibilidade de dependências e o smoke completo
inbound → claim → IA → reserva → Meta → status com o número de homologação.

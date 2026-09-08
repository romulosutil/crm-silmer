# Integração CRM Silmer ↔ n8n — MVP simples

> **Decisão vigente:** [RFC 002](../../rfc/002-simplificar-integracao-n8n-para-o-mvp.md)
> e [ADR 003](../../adr/003-adotar-integracao-n8n-mvp-simples.md). RFC 001 e
> ADR 002 são histórico da alternativa mais robusta.

## Objetivo e limite

O n8n recebe o webhook oficial do WhatsApp, registra a mensagem no CRM, usa o
contexto devolvido pelo CRM, decide entre resposta de IA e handoff e pede ao CRM
uma autorização de uso único antes de chamar a Meta. PostgreSQL continua sendo
a fonte da verdade. O n8n não acessa o banco e não mantém cópia paralela de
cliente, conversa, briefing ou memória curta.

Esta entrega ativa somente WhatsApp. Instagram, leitura multimodal pela IA e
novas telas ficam nas fases posteriores. O adapter direto Meta → CRM permanece
apenas como fixture de desenvolvimento e nunca é fallback silencioso.

## Entidades que o fluxo cria ou altera

| Conceito de produto | Persistência oficial                    | Comportamento no fluxo                                                                                                            |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Cliente             | `contacts` + `contact_identities`       | Criado provisoriamente na primeira identidade de WhatsApp; não existe tabela paralela `customers` ou `leads`.                     |
| Conversa            | `conversations`                         | Uma conversa aberta por identidade/canal; guarda modo, `automation_epoch`, revisão inbound e o snapshot atual do briefing.        |
| Mensagem            | `messages`                              | Inbound e outbound cifrados; identidade externa ou `command_id` impede duplicidade. O estado de entrega fica na própria mensagem. |
| Briefing            | colunas cifradas da `conversation`      | Um snapshot consolidado; `briefing_patch` ignora nulos e só aceita campos de qualificação. Não promove dado oficial de Negócio.   |
| Handoff             | `handoffs`                              | Criado sem responsável, com papel-alvo Atendimento ou Vendedor; uma pessoa compatível o reivindica atomicamente.                  |
| Negócio             | `deals` e módulos canônicos             | Nunca é criado pela simples chegada de mensagem. Conversão, campos e etapas continuam nos endpoints de domínio.                   |
| Comando humano      | `n8n_commands` + `outbox_jobs`          | Estado oficial e outbox são gravados antes de o worker chamar o webhook do n8n.                                                   |
| Evidência técnica   | `n8n_events`, auditoria e reconciliação | Registra correlação, workflow, versão, execução e resultado sem conteúdo pessoal ou segredo técnico.                              |

As tabelas `ai_turns`, `automation_runs`, `conversation_briefing_versions` e
`message_delivery_attempts` foram criadas por migrações já publicadas, mas não
participam do runtime simplificado. Permanecem dormentes até uma migração
contract explícita e segura removê-las.

## Contrato n8n → CRM

Os três endpoints usam `Authorization: Basic`, `Idempotency-Key`,
`X-Correlation-Id`, `X-Silmer-Workflow-Key`, `X-Silmer-Workflow-Version` e
`X-Silmer-Execution-Id`. Upload também exige `X-Silmer-Content-SHA256`.

1. `POST /api/v1/integrations/n8n/messages/inbound`
   cria ou resolve Cliente, Conversa e Mensagem e devolve `source_revision`,
   `automation_epoch`, modo, mensagens recentes e briefing.
2. `POST /api/v1/integrations/n8n/conversations/{id}/attachments`
   recebe uma mídia por streaming, valida tamanho, hash, MIME e malware e só a
   vincula depois da quarentena. A IA multimodal fica diferida.
3. `POST /api/v1/integrations/n8n/events`
   recebe reserva de envio, callbacks de entrega, handoff e falha do workflow.

Eventos aceitos: `message.send.requested`, `message.sent`,
`message.delivered`, `message.read`, `message.failed`,
`message.send.unknown`, `handoff.requested` e `workflow.failed`.

Erros usam `application/problem+json`. Replay da mesma chave com o mesmo
payload devolve o resultado idempotente; a mesma chave com payload diferente
retorna `409`.

## Fence de envio simplificado

Não existe claim, lease nem token de rodada. Para uma resposta automática, o
`message.send.requested` deve apresentar a revisão inbound e o epoch devolvidos
pelo CRM. A autorização só é concedida quando a conversa continua aberta e em
modo IA, o epoch é atual e a revisão ainda não foi consumida. O CRM grava a
Mensagem com estado `sending` e avança `claimed_revision` na mesma transação.

Somente `send_authorized: true` permite chamar a Meta. Replay sempre devolve
`send_authorized: false`. Timeout depois da autorização vira
`message.send.unknown`; não há retry cego. Callbacks tardios de uma reserva já
aceita podem concluir o estado mesmo após takeover.

Takeover e handoff incrementam `automation_epoch`, invalidando decisões ainda
não reservadas. Status segue a ordem `sent < delivered < read` e nunca regride.

## Briefing, conversão e handoff

O agente recebe `recent_messages` e `briefing` na resposta inbound. Pode mandar
um `briefing_patch` junto de `message.send.requested` ou `handoff.requested`;
nulos são ignorados. Preço, pagamento, etapa e outros campos oficiais não são
aceitos nesse patch.

Inbound não cria Negócio. Quando houver intenção comercial, o workflow usa os
endpoints canônicos de conversão, campos e transição. `convertida_em_lead`
encerra a triagem, não a Conversa; ela só termina por `Sem lead`, `Fechado` ou
`Perdido` conforme as regras do domínio.

Handoffs de negociação ou briefing completo vão para Vendedor. Pedido humano,
reclamação, urgência, baixa confiança e conteúdo não suportado vão para
Atendimento. Não há mensagem automática de confirmação no primeiro corte.

## Workflow e configuração

- Workflow: `k7tI6T4RhQPyJkn9` — `Silmer | Atendimento WhatsApp IA`.
- Baseline preservada: `98f96069-ede2-4900-aa5c-7fec0d3b80cb`.
- Rascunho simplificado validado: `fae803db-eef0-4074-a7ae-1a6bb786e203`,
  com 42 nós e sem avisos estruturais.
- O workflow simplificado permanece inativo até credenciais e homologação.
- São necessárias duas credenciais Basic distintas: n8n → CRM e CRM → n8n.
- Segredos não entram em export, repositório, log, chat ou Data Table.
- Persistência de execuções manuais/sucesso e progresso deve ficar desabilitada;
  falhas são sanitizadas e têm expurgo técnico em até 30 dias.

## Rollout e recuperação

1. Aplicar migrações com a integração desligada.
2. Implantar API e worker e configurar as duas credenciais Basic.
3. Testar o workflow inativo com dados sintéticos e o número Meta de homologação.
4. Homologar inbound → contexto → IA/handoff → reserva → Meta → status.
5. Publicar o workflow, transferir o webhook da Meta e desabilitar a entrada direta.

Rollback pausa ou despublica o workflow e preserva mensagens, comandos e itens
incertos para reconciliação. A rota direta não é reativada automaticamente.

## Diagnóstico rápido

- `401/403`: conferir credencial e capacidade do `AUTOMATION_EXECUTOR`.
- `409 STALE_AUTOMATION_FENCE`: a pessoa assumiu, chegou mensagem nova ou a
  revisão já foi respondida; não enviar.
- `send_authorized: false`: replay; não chamar a Meta novamente.
- `message.send.unknown`: reconciliar pelo `command_id` antes de qualquer ação.
- mídia em quarentena/indisponível: abrir handoff e não afirmar que os bytes
  foram recuperados.

As próximas telas e a ordem de entrega estão em
[`docs/roadmap/PROXIMAS-FASES.md`](../../roadmap/PROXIMAS-FASES.md).

# Integração CRM Silmer ↔ n8n v1

Este documento é o ponto de entrada operacional da integração. O contrato
executável está em [`docs/api/openapi.v1.yaml`](../../api/openapi.v1.yaml), o
contexto em [RFC 001](../../rfc/001-contrato-integracao-n8n-v1.md) e a decisão
em [ADR 002](../../adr/002-adotar-adaptador-de-integracao-n8n.md).

## Fonte da verdade e entidades

| Conceito externo | Representação canônica                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Cliente/lead     | `Contact` + `ContactIdentity`; não existe tabela paralela `customers` ou `leads`            |
| Conversa         | `conversations`, com `inbound_revision`, `last_inbound_event_id`, estado, automação e epoch |
| Mensagem         | `messages`, criptografada e única por canal/conta/identidade externa                        |
| Briefing         | `conversation_briefing_versions`, criptografado, imutável e versionado                      |
| Rodada de IA     | `ai_turns`, contendo fences, lease, claim, token criptografado, workflow e efeito           |
| Execução         | `automation_runs`, sem segredos nem conteúdo pessoal técnico                                |
| Handoff          | `handoffs`, opcionalmente sem Negócio, inicialmente sem responsável e com `target_role`     |
| Comando ao n8n   | `n8n_commands`, imutável e idempotente                                                      |
| Entrega          | `message_delivery_attempts`, uma linha por tentativa e estado monotônico                    |

São reutilizados `idempotency_records`, `outbox_jobs`, `audit_events`,
`domain_events`, `reconciliation_items` e `transient_media`.

## Endpoints n8n → CRM

Todos são `POST`, usam HTTPS e exigem:

- `Authorization: Basic …`
- `Idempotency-Key`
- `X-Correlation-Id`
- `X-Silmer-Workflow-Key`
- `X-Silmer-Workflow-Version`
- `X-Silmer-Execution-Id`

As rotas são:

- `/api/v1/integrations/n8n/messages/inbound`
- `/api/v1/integrations/n8n/conversations/{id}/attachments`
- `/api/v1/integrations/n8n/conversations/{id}/ai-turns/claim`
- `/api/v1/integrations/n8n/events`

Upload adiciona `X-Silmer-Content-SHA256`. A resposta de erro usa
`application/problem+json` e inclui `accepted: false`, `error.code` e
`request_id` para compatibilidade. Reuso de chave idempotente com outro corpo
é `409`.

## Regras de execução

O inbound resolve identidade, cria ou reutiliza conversa ativa e só incrementa
`inbound_revision` para evento novo. O modo projetado é, nesta ordem:

1. terminal → `closed`;
2. handoff aberto e não atribuído → `handoff_pending`;
3. automação humana → `human_active`;
4. demais conversas ativas → `ai_active`.

Claim negado responde HTTP 200 com `claimed: false` e motivo. Claim aceito é
exclusivo até expirar. Takeover, handoff, retorno e fechamento elevam
`automation_epoch`; tokens antigos deixam de ser válidos.

`message.send.requested` é o único fence que autoriza uma chamada à Meta. A
autorização é de uso único. Timeout posterior vira `message.send.unknown` e
gera reconciliação. Estados `sent`, `delivered` e `read` nunca regridem; falha
fica presa à tentativa.

`lead_patch` ignora valores nulos e atualiza apenas o briefing. Promoção para
dados oficiais usa conversão, campos e transições canônicas do Negócio.
`convertida_em_lead` encerra triagem, não a Conversa. `Sem lead` é terminal;
uma Conversa com Negócio só termina pelos caminhos oficiais Fechado/Perdido.

## Fluxo humano

O painel usa as operações canônicas de mensagem, takeover, retorno à IA,
fechamento e claim de handoff. Primeiro ocorre a transação local com auditoria
e outbox; depois o worker entrega um comando idempotente ao webhook
`/webhook/silmer/panel-command` do n8n.

Handoffs `briefing_complete` e `negotiation` têm `target_role=Vendedor`.
`human_requested`, `complaint`, `urgency`, `low_confidence` e `unsupported`
têm `target_role=Atendimento`. O primeiro usuário ativo com papel compatível
que concluir o CAS assume; concorrentes recebem `409`.

## Mídia e retenção

O complemento versionado de catálogo de dados e modelo de ameaças está em
`security-privacy-addendum.json`. Ele preserva as evidências aprovadas da Fase 0
e precisa ser incorporado a uma nova revisão humana antes da ativação.

O upload é limitado por arquivo e quota total, escrito com permissão privada,
hasheado durante o stream, validado pelo hash declarado, inspecionado por MIME
real e antivírus e renomeado atomicamente somente quando seguro. Nome de arquivo
é saneado antes de persistir. Scanner indisponível ou assinatura desatualizada
mantém quarentena/falha fechada.

Bytes transitórios expiram ao terminar a jornada ou em sete dias, o que vier
primeiro. Dados técnicos de execução/manual do n8n devem ser expurgados em até
30 dias e não podem conter PII, mensagens ou credenciais.

## Configuração e rollout

São necessárias duas credenciais Basic distintas:

- n8n→CRM: valores configurados como segredo do CRM e credencial HTTP Basic no
  n8n;
- CRM→n8n: valores configurados como segredo do worker e credencial do webhook
  de comandos.

O operador cria e vincula as credenciais sem copiar valores para chat,
repositório ou export. O workflow `k7tI6T4RhQPyJkn9` fica inativo até o smoke de
homologação. Migrações entram primeiro com a integração desligada; depois API e
worker, credenciais, workflow, WhatsApp de homologação, publicação e corte do
webhook. A entrada direta no CRM fica indisponível após o corte.

O baseline completo sanitizado `98f96069-ede2-4900-aa5c-7fec0d3b80cb` e o
rascunho validado `0c41ee97-954b-4319-b822-fbb91f239b6e` estão em
`ops/n8n/workflows/`. O rascunho removeu os blocos HMAC, a memória curta e os
acessos à `silmer_failures`; desabilitou persistência de execução; adicionou os
headers técnicos e colocou um fence do CRM antes dos sete nós de envio à Meta.
As reservas, confirmações e resultados incertos da IA propagam `claim_id`,
token, revisão, versão da conversa, epoch e versão do workflow.
No upload, o próprio nó HTTP gera o `Content-Type` multipart com seu boundary;
o workflow não sobrescreve esse header.
Os nós HTTP Basic permanecem deliberadamente sem vínculo até o operador criar
as duas credenciais DEV distintas.

## Troubleshooting

- `401`: credencial Basic ausente/inválida; confira vínculo e janela de
  rotação sem imprimir o segredo.
- `403`: ação fora da allowlist do ator técnico.
- `409`: chave idempotente divergente, fence obsoleto ou disputa de handoff.
- `422`: evento/canal/MIME não suportado.
- `429`: capacidade/quota excedida; respeite `Retry-After`.
- `503`: CRM, volume, scanner ou n8n indisponível; não faça retry de envio já
  autorizado à Meta. Abra/reveja o item de reconciliação.

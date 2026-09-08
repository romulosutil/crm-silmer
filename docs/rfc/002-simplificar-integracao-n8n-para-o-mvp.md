# RFC 002 — Simplificar a integração n8n para o MVP

- Status: aceito
- Data: 2026-09-08
- Requisitos: ORC-01–08, INB-01–04, AGT-01–08, MSG-01–03, PRV-01–03
- Tarefa: N8N-MVP-1
- Decisão: [ADR 003](../adr/003-adotar-integracao-n8n-mvp-simples.md)
- Supersede: [RFC 001](001-contrato-integracao-n8n-v1.md)

## Problema

O primeiro adaptador n8n protegeu todos os efeitos com revisão, claim, lease,
token, execução, tentativa de entrega e reconciliação próprios. Esses controles
são adequados a uma automação de maior escala, mas antecipam problemas que o
piloto ainda não demonstrou e criam várias entidades técnicas sem valor direto
para a operação.

O piloto precisa provar primeiro que uma conversa real entra pelo WhatsApp, é
registrada uma vez, recebe resposta da IA, pode ser interrompida por uma pessoa
e não duplica um envio à Meta.

## Proposta

Manter o CRM como fonte da verdade e reduzir o contrato n8n→CRM a três rotas:

1. `POST /api/v1/integrations/n8n/messages/inbound` cria ou reutiliza
   `Contact`, `ContactIdentity` e `Conversation`, persiste uma única `Message` e
   devolve modo, `automation_epoch`, briefing atual e mensagens recentes.
2. `POST /api/v1/integrations/n8n/conversations/{id}/attachments` publica uma
   mídia transitória somente depois dos controles de tamanho, hash, MIME e
   scanner já existentes.
3. `POST /api/v1/integrations/n8n/events` aceita somente
   `message.send.requested`, `message.sent`, `message.delivered`,
   `message.read`, `message.failed`, `message.send.unknown`,
   `handoff.requested` e `workflow.failed`.

Cada requisição exige Basic Auth, `Idempotency-Key`, `X-Correlation-Id` e os
três identificadores técnicos de workflow, versão e execução; upload também
exige `X-Silmer-Content-SHA256`. Esses metadados ficam no recibo idempotente,
sem criar uma entidade de execução. A versão do payload continua em
`schema_version`.

## Modelo mínimo

- **Cliente:** `Contact` + `ContactIdentity`.
- **Atendimento:** `Conversation`, com modo, `automation_epoch` e um único
  snapshot criptografado de briefing.
- **Histórico:** `Message`, com estado de envio na própria linha.
- **Transferência:** `Handoff`, inicialmente sem responsável e com papel-alvo.
- **Venda:** `Deal`, criado somente pela conversão canônica.
- **Confiabilidade técnica:** `n8n_events` como recibo idempotente; para ações
  humanas, `n8n_commands` + `outbox_jobs` continuam como detalhe interno.

`ai_turns`, `automation_runs`, `conversation_briefing_versions` e
`message_delivery_attempts` deixam de participar do runtime. As tabelas já
aplicadas permanecem temporariamente para rollout seguro e serão removidas em
uma migração de contrato depois que nenhum ambiente usar a versão anterior.

## Regras de concorrência

- Uma mensagem inbound é única pelo identificador externo e pela chave
  idempotente.
- Takeover, handoff, retorno à IA e fechamento elevam `automation_epoch`.
- Não existe claim antecipado. O CRM compara epoch e revisão de origem no
  momento de reservar um envio automático ou criar handoff.
- `message.send.requested` insere a mensagem outbound com `command_id` único.
  Somente a primeira requisição aceita devolve `send_authorized: true`.
- O briefing atual pode ser atualizado, com merge que ignora nulos, na mesma
  transação da reserva ou do handoff; não existe evento separado para isso.
- Replay sempre devolve `send_authorized: false`; o n8n não chama a Meta.
- Timeout depois da autorização vira `message.send.unknown`; retry cego
  continua proibido.
- `sent < delivered < read` não regride. Falha atualiza a própria Mensagem, sem
  entidade separada por tentativa no MVP.

## Workflow mínimo

O workflow inativo `k7tI6T4RhQPyJkn9` foi reduzido ao caminho:

`WhatsApp → normalizar → inbound CRM → validar modo/epoch → contexto → IA →
reserva CRM → Meta → status CRM`.

Eventos de status seguem diretamente para o CRM. Pedido de pessoa cria
handoff. Comandos humanos continuam chegando pelo webhook privado, passam pela
reserva e só então seguem à Meta. Mídias podem ser armazenadas com segurança,
mas processamento multimodal, transcrição e descrição automática ficam fora
do primeiro smoke funcional.

O rascunho `fae803db-eef0-4074-a7ae-1a6bb786e203` possui 42 nós, permanece
inativo e está sem credenciais Basic vinculadas até a configuração e
homologação. Esta mudança não autoriza publicação.

## Fora desta fatia

- Interfaces de Inbox, conversa, contato e handoff.
- Painel de runs, claims ou reconciliação.
- Instagram e migração entre canais.
- Fallback entre provedores de IA, memória paralela e processamento multimodal.
- Remoção física imediata das tabelas técnicas descontinuadas.

Esses itens entram no roadmap somente quando o fluxo WhatsApp simples estiver
homologado ou quando uma métrica real justificar a complexidade.

## Aceite

- inbound duplicado cria uma Mensagem e uma revisão interna;
- takeover anterior à reserva bloqueia a resposta atrasada;
- duas reservas concorrentes autorizam no máximo uma chamada à Meta;
- status fora de ordem não regride a Mensagem;
- briefing substitui o snapshot atual sem criar histórico técnico;
- handoff é criado sem responsável e interrompe a IA;
- erro não ecoa PII ou segredo;
- workflow e OpenAPI descrevem o mesmo contrato de três rotas;
- nenhuma interface frontend é criada nesta fatia.

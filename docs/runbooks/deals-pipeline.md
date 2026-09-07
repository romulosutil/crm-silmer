# Runbook de Contato, Negócio e pipeline

## Escopo

Este runbook cobre `T03.1` a `T03.6`: conversão idempotente de Conversa
em Negócio, etapas ordenadas, gates, histórico, retorno, perda e campos oficiais
da Ficha. O contrato HTTP está em `docs/api/openapi.v1.yaml`.

## Segredo obrigatório

Configure `DEAL_ENVELOPE_KEY`, `QUALIFICATION_ENVELOPE_KEY` e
`HANDOFF_ENVELOPE_KEY` no cofre do ambiente
como chaves independentes de 32 bytes em base64url. A primeira cifra motivos de
perda; a segunda cifra PII, texto livre e motivos N/A da Ficha. Nunca reutilize
essas chaves para identidade, inbox ou respostas idempotentes. A chave de
handoff cifra resumos e textos de tarefas. Não troque uma
chave em produção sem migração de recriptografia aprovada e testada.
Configure também `KANBAN_CURSOR_HMAC_KEY` como chave independente de 32 bytes
em base64url. Ela assina os cursores opacos do Kanban e não cifra dados.

O inventário versionado declara somente o nome do segredo. Ele não prova que um
valor foi provisionado no EasyPanel. Sem `DEAL_ENVELOPE_KEY`,
`QUALIFICATION_ENVELOPE_KEY`, `HANDOFF_ENVELOPE_KEY`,
`KANBAN_CURSOR_HMAC_KEY` e
`IDEMPOTENCY_ENVELOPE_KEY`, o runtime não publica
as rotas de Negócio.

`HANDOFF_SLA_MINUTES` aceita 5 a 10080 minutos. Na ausência de configuração, o
runtime usa 240 minutos UTC com `HANDOFF_SLA_POLICY_VERSION=technical-default-v1`.
Esse valor é um default técnico provisório, não uma política operacional aprovada.
Transferências preservam o vencimento original; aceitar ou resolver um handoff
não reativa a automação. Esta etapa também não promete cancelar envios externos.

## Operação segura

- Toda mutação exige `Idempotency-Key`, correlação e `expectedVersion`.
- O destino de uma transição é derivado da etapa atual; a API não aceita uma
  etapa alvo.
- Atendimento e Vendedor usam sessão, origem permitida e CSRF. O executor
  técnico usa Basic Auth, `conversationId` e o `automationEpoch` corrente.
- Uma transição automatizada só é válida enquanto a conversa informada está
  ativa, em modo `assistant` e vinculada ao mesmo Contato do Negócio.
- O motivo de perda é cifrado. Logs, auditoria e eventos recebem somente
  metadados técnicos, nunca o texto do motivo.
- Cada patch de campos incrementa uma única versão raiz. Correções retornam
  atomicamente à primeira etapa anterior incompleta, sem aceitar etapa alvo.
- O patch é progressivo: somente os campos enviados são alterados. Remoções de
  item são explícitas e não podem deixar arquivo de arte órfão.
- Avaliações usam um registro fechado de campos. `nao_aplicavel` não substitui
  campos estruturais obrigatórios e sempre exige motivo cifrado onde permitido.
- O catálogo deve estar publicado para formar uma seleção oficial; versão em
  rascunho, ausente ou sem correspondência segura mantém o campo pendente para
  decisão assistida, sem promover texto livre. IDs, número de versão e snapshots
  publicados ficam vinculados à seleção histórica.
- Arquivos de arte referenciam anexos recebidos pelo CRM. A mutação valida, na
  mesma transação, que a mídia está limpa, disponível e pertence ao Contato do
  Negócio; a API não aceita o identificador externo do provedor como prova.
- `reasonCode` participa da identidade idempotente. `reasonDetail`, quando
  usado, é cifrado; eventos e auditoria recebem somente código e hash.
- As leituras do Kanban e do detalhe aceitam somente sessão humana ativa de
  Atendimento/Vendedor. Basic Auth recebe `403`. `Origin`, quando enviado, deve
  estar na allowlist; sem ele, `Sec-Fetch-Site` deve ser `same-origin` ou `none`.
- O Kanban contém somente Negócios ativos nas cinco etapas. Cada coluna tem
  paginação keyset própria, assinada e vinculada à etapa, filtros, ordem e limite.
- `GET /api/v1/events?topic=kanban` usa SSE e `Last-Event-ID` (ou `after`) como
  cursor durável. `stream.reset` exige recarregar REST; `kanban.card.changed`
  contém apenas IDs, versões, tipo de origem e horário, nunca payload livre. A
  réplica aceita até 30 streams simultâneos e 60 aberturas por minuto por IP;
  excesso retorna `429` com `Retry-After`.
- O detalhe usa `ETag` composto por Negócio, tarefas e handoffs; respostas usam
  `Cache-Control: private, no-cache` e `Vary: Origin, Cookie`.

## Migração e rollback

As migrations `0008_phase3_deal_state_machine.expand.sql`,
`0009_phase3_qualification.expand.sql` e
`0010_phase3_work_management.expand.sql` e
`0011_phase3_deal_read_models.expand.sql` são aditivas. Elas ampliam o Negócio e
criam gates, histórico, qualificação e eventos imutáveis, incluindo backfill
técnico para Negócios existentes. Faça backup antes das migrations e confirme
que todos os registros receberam histórico `created` e evento `deal.created`.

Para rollback da aplicação, reverta o digest do runtime sem remover tabelas nem
colunas. A remoção futura exige migration `contract` separada, depois de provar
que nenhum leitor, replay idempotente ou consumidor de eventos depende dos
dados.

A migration `0011` serializa a atribuição do cursor de eventos com lock
transacional adquirido antes do `nextval`. Não substitua esse protocolo por
`IDENTITY` ou `DEFAULT nextval`, pois isso permitiria observar um cursor mais
novo antes do commit de um cursor anterior.

## Gates antes de publicar

Execute `npm run validate`, `npm run test:e2e`, `npm run test:deal:live` com
`TEST_DATABASE_URL` apontando exclusivamente para `crm_silmer_test`,
`npm audit --audit-level=high`, `git diff --check` e a verificação de histórico
linear. Validação local ou CI não prova provisionamento do segredo, aprovação
operacional nem prontidão de produção.

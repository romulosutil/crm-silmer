# Runbook de Contato, Negócio e pipeline

## Escopo

Este runbook cobre `T03.1` e `T03.2`: conversão idempotente de Conversa em
Negócio, etapas ordenadas, gates, histórico, retorno e perda. O contrato HTTP
está em `docs/api/openapi.v1.yaml`.

## Segredo obrigatório

Configure `DEAL_ENVELOPE_KEY` no cofre do ambiente como 32 bytes independentes
em base64url. A chave cifra motivos de perda e nunca deve ser reutilizada para
identidade, inbox ou respostas idempotentes. Não troque a chave em produção sem
uma migração de recriptografia aprovada e testada.

O inventário versionado declara somente o nome do segredo. Ele não prova que um
valor foi provisionado no EasyPanel. Sem `DEAL_ENVELOPE_KEY` e
`IDEMPOTENCY_ENVELOPE_KEY`, o runtime não publica as rotas de Negócio.

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
- Até `T03.3` fornecer a qualificação persistente, o runtime de produção mantém
  todos os avanços bloqueados com gate indisponível. Retorno e perda continuam
  disponíveis conforme autorização.

## Migração e rollback

A migration `0008_phase3_deal_state_machine.expand.sql` é aditiva. Ela amplia o
Negócio e cria gates, histórico e eventos imutáveis, incluindo backfill técnico
para Negócios existentes. Faça backup antes da migração e confirme que todos os
registros receberam histórico `created` e evento `deal.created`.

Para rollback da aplicação, reverta o digest do runtime sem remover tabelas nem
colunas. A remoção futura exige migration `contract` separada, depois de provar
que nenhum leitor, replay idempotente ou consumidor de eventos depende dos
dados.

## Gates antes de publicar

Execute `npm run validate`, `npm run test:e2e`, `npm run test:deal:live` com
`TEST_DATABASE_URL` apontando exclusivamente para `crm_silmer_test`,
`npm audit --audit-level=high`, `git diff --check` e a verificação de histórico
linear. Validação local ou CI não prova provisionamento do segredo, aprovação
operacional nem prontidão de produção.

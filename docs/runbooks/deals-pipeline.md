# Runbook de Contato, Negócio e pipeline

## Escopo

Este runbook cobre `T03.1`, `T03.2` e `T03.3`: conversão idempotente de Conversa
em Negócio, etapas ordenadas, gates, histórico, retorno, perda e campos oficiais
da Ficha. O contrato HTTP está em `docs/api/openapi.v1.yaml`.

## Segredo obrigatório

Configure `DEAL_ENVELOPE_KEY` e `QUALIFICATION_ENVELOPE_KEY` no cofre do ambiente
como chaves independentes de 32 bytes em base64url. A primeira cifra motivos de
perda; a segunda cifra PII, texto livre e motivos N/A da Ficha. Nunca reutilize
essas chaves para identidade, inbox ou respostas idempotentes. Não troque uma
chave em produção sem migração de recriptografia aprovada e testada.

O inventário versionado declara somente o nome do segredo. Ele não prova que um
valor foi provisionado no EasyPanel. Sem `DEAL_ENVELOPE_KEY`,
`QUALIFICATION_ENVELOPE_KEY` e `IDEMPOTENCY_ENVELOPE_KEY`, o runtime não publica
as rotas de Negócio.

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

## Migração e rollback

As migrations `0008_phase3_deal_state_machine.expand.sql` e
`0009_phase3_qualification.expand.sql` são aditivas. Elas ampliam o Negócio e
criam gates, histórico, qualificação e eventos imutáveis, incluindo backfill
técnico para Negócios existentes. Faça backup antes das migrations e confirme
que todos os registros receberam histórico `created` e evento `deal.created`.

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

# Checkpoint — feat/inbox-ownership-realtime

## Escopo aprovado
1. Corrigir 403 (allowlist duplicada divergente)
2. Ownership: vendedor não rouba conversa de outro; só admin (`COMMERCIAL_ADMIN`) sobrepõe
3. Botão "Repassar venda" (vendedor → vendedor)
4. Editar nome do contato (Caixa de Entrada + Clientes)
5. Remover selects Estado/Canal
6. Remover botão Atualizar; tudo em tempo real (SSE)
7. Contraste: primary laranja + texto branco
8. Remover "Identidades" da página Clientes

## Fora de escopo (decisão do PO)
- Botão "Converter em negócio"
- Publicar workflow n8n `k7tI6T4RhQPyJkn9`
- HMAC + dedupe no `panel-command`

## Descobertas que mudaram o plano
- **Dois** bloqueios de 403, não um:
  1. `apps/api/src/identity-runtime.js` — `OPERATIONAL_ACTIONS` incompleta
  2. `modules/inbox-channels/src/application/inbox-service.js` — `validateHumanCommand`
     exige `functionName === 'Vendedor'`; admin é `Atendimento` → `InboxForbiddenError`
- `crm.conversations.assigned_user_id` já existe e é preenchido pelo takeover.
  **Não havia nenhuma checagem de posse** — qualquer um assumia conversa de qualquer um.
- Conversas **não** escrevem em `crm.domain_events` (só audit). Realtime exige emitir eventos.
- SSE (`GET /api/v1/events`) já é genérico por `topic`, mas o repositório rejeita
  qualquer topic != `kanban`.
- Nome do contato hoje deriva de `identity.displayHandle` (formato de handle do
  Instagram, `@x`) — impróprio para nome editável. Criada coluna `crm.contacts.display_name`.

## Ordem de execução
- [x] Branch `feat/inbox-ownership-realtime`
- [x] B1 migração `0019_contact_display_name`
- [x] B2 allowlists (identity-runtime + authorization)
- [x] B3 inbox-service: transfer + capabilities no ator
- [x] B4 pg-inbox-repository: guarda de posse + transfer + domain events
- [x] B5 in-memory-inbox-repository espelhado
- [x] B6 rename de contato (serviço + rota + leitura)
- [x] B7 SSE topic `inbox`
- [x] B8 rotas transfer/rename/`users/assignable`
- [x] F1 event-stream parametrizado por topic
- [x] F2 InboxView
- [x] F3 ClientsView
- [x] F4 contraste dos botões
- [x] T testes + lint + typecheck + build

## Correção do relatório de auditoria
A auditoria afirmou que havia **dois** bloqueios de 403. Só existe um.
A migração `0017_identity_single_role` reduziu `user_functions.function_name`
a `'Vendedor'`, então a exigência de `functionName === 'Vendedor'` em
`inbox-service.validateHumanCommand` já era satisfeita por todos os usuários,
inclusive o admin. O 403 vinha exclusivamente da allowlist duplicada.
Consequência de design: administrador não é uma função, é a capability
`COMMERCIAL_ADMIN` — foi assim que a regra de posse ficou modelada.

## Resultado
- `npm run lint` · `typecheck` · `build` · `check:boundaries` ·
  `check:design-tokens` limpos
- `npm test`: 403 testes, 399 passam, 0 falham, 4 pulados (live/Postgres)
- Pendência **pré-existente**, fora do escopo: `no-unused-vars`
  (`MAIN_WORKFLOW_ID`) em `ops/n8n/workflows/create-dev-test-workflow.mjs`,
  introduzida no commit `bc82671`

## Ainda por validar no ambiente
A migração `0019` precisa rodar (`npm run db:migrate`) antes do deploy: sem a
coluna `display_name` as leituras de contato quebram.

## Verificação no ambiente (10/09/2026)

Stack local: PostgreSQL 17 em container próprio na porta 55432 (a 5432 estava
ocupada), API em 127.0.0.1:3300, edge em 127.0.0.1:4173. Migração `0019`
aplicada — `crm.contacts.display_name` existe. Três usuários semeados
(admin com `COMMERCIAL_ADMIN`, dois vendedores) e conversas entrando pelo
endpoint real `POST /api/v1/integrations/n8n/messages/inbound`.

**21 de 21 verificações passaram** (`scratchpad/verify.mjs`).

### Dois defeitos que só o ambiente revelou

1. Erros de domínio da Caixa de Entrada não tinham `statusCode`, então
   `respond()` os relançava e o Fastify devolvia 500. Recusa por posse virava
   "serviço indisponível"; conflito de versão nunca chegava como 409.
2. Mensagens recebidas do WhatsApp entram pelo `PostgresN8nIntegrationRepository`,
   não pelo `PostgresInboxRepository` instrumentado no primeiro commit. As
   conversas ficavam ao vivo para comandos humanos e mudas para o cliente.

Corrigidos no commit `7788520`, ambos com teste — o segundo com asserção no
teste live contra PostgreSQL de verdade.

### Não verificado
Passada visual no browser (formulário de repasse, edição de nome inline, badge
de posse): exige login e não preencho campo de senha. A tela de acesso
confirmou o contraste novo (laranja com texto branco).

### Falhas pré-existentes confirmadas fora do escopo
- 3 testes em `test/inbox-postgres-live.test.js` falham igual no commit anterior
  (FK `conversations_assigned_user_fk` sem usuário semeado).
- `no-unused-vars` em `ops/n8n/workflows/create-dev-test-workflow.mjs`.

## PR
https://github.com/romulosutil/crm-silmer/pull/65

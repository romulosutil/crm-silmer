# Gestão de Usuários pelo Administrador — Arquitetura

Referência: [spec.md](spec.md). Pranchas de UI: artefato "Usuários do CRM Silmer".

## Princípio que orienta o corte

`identity-access` continua sendo o único dono da identidade. A API é uma porta HTTP fina sobre o serviço de domínio, como já é hoje: `identity-routes.js` valida forma, `identity-runtime.js` compõe transação + idempotência + auditoria, `modules/identity-access/src/index.js` decide. Nenhuma rota nova toca `crm.users` direto — o script de bootstrap é a única exceção deliberada, e ele existe justamente para viver fora da aplicação.

## Camadas afetadas

| Camada | Arquivo | Natureza da mudança |
| --- | --- | --- |
| Banco | `modules/database/migrations/0017_*.expand.sql` | nova coluna, migração de dados, troca de constraints |
| Banco | `modules/database/migrations/0018_*.contract.sql` | `DROP TABLE crm.invitations` |
| Domínio | `modules/identity-access/src/index.js` | remove convite, adiciona CRUD de usuário |
| Domínio | `modules/identity-access/src/authorization.js` | reduz capacidades e função operacional |
| Domínio | `modules/identity-access/src/postgres.js` | queries de listagem, atualização e disable |
| Domínio | `postgres-access.js`, `postgres-operational-user-port.js` | tipos e função única |
| API | `apps/api/src/identity-routes.js` | remove 2 rotas, adiciona 5 |
| API | `apps/api/src/identity-runtime.js` | novos métodos, `Vendedor` único |
| Consumidores | `deals-pipeline`, `qualification`, `inbox-channels`, `contacts`, `work-management`, `n8n-integration` | `['Atendimento','Vendedor']` → `'Vendedor'` |
| Frontend | `apps/edge-web/src/views/UsersView.vue` | tela nova |
| Frontend | `App.vue`, `router.js`, `AuthPanel.vue` | rota, nav condicional, remoção da aba |
| Contrato | `docs/api/openapi.v1.yaml` | rotas e enums |
| Scripts | `scripts/create-admin.mjs`, `scripts/seed-dev-users.mjs` | novo e reescrito |

## Banco

### 0017 — expand

Ordem importa: primeiro migrar os dados, depois apertar a constraint.

```sql
-- ROLE-01/USR-01: nome passa a ser parte da identidade
ALTER TABLE crm.users ADD COLUMN name text;
UPDATE crm.users SET name = split_part(email, '@', 1) WHERE name IS NULL;
ALTER TABLE crm.users
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT users_name_check
    CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120);

-- ROLE-02
UPDATE crm.user_functions SET function_name = 'Vendedor'
  WHERE function_name <> 'Vendedor';
ALTER TABLE crm.user_functions
  DROP CONSTRAINT user_functions_function_name_check,
  ADD CONSTRAINT user_functions_function_name_check
    CHECK (function_name = 'Vendedor');

-- ROLE-03
UPDATE crm.handoffs SET target_role = 'Vendedor' WHERE target_role <> 'Vendedor';
ALTER TABLE crm.handoffs
  DROP CONSTRAINT handoffs_target_role_check,
  ADD CONSTRAINT handoffs_target_role_check CHECK (target_role = 'Vendedor');

-- handoff_history tem trigger de imutabilidade: derrubar e recriar,
-- como o 0013 já faz.
DROP TRIGGER handoff_history_immutable ON crm.handoff_history;
UPDATE crm.handoff_history SET target_role = 'Vendedor' WHERE target_role <> 'Vendedor';
ALTER TABLE crm.handoff_history
  DROP CONSTRAINT handoff_history_target_role_check,
  ADD CONSTRAINT handoff_history_target_role_check CHECK (target_role = 'Vendedor');
CREATE TRIGGER handoff_history_immutable
BEFORE UPDATE OR DELETE ON crm.handoff_history
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

-- ROLE-05
DELETE FROM crm.user_capabilities
  WHERE capability IN ('PRIVACY_OFFICER', 'TECHNICAL_PRIVACY_EXECUTOR');
ALTER TABLE crm.user_capabilities
  DROP CONSTRAINT user_capabilities_capability_check,
  ADD CONSTRAINT user_capabilities_capability_check
    CHECK (capability = 'COMMERCIAL_ADMIN');
```

Os nomes reais das constraints geradas pelo PostgreSQL precisam ser conferidos antes de escrever o `DROP CONSTRAINT` — no `0002` várias foram declaradas inline e receberam nome automático.

`users_email_lower_unique` já existe e é o que sustenta **USR-07**. `disabled_at` já existe e já é filtrado em `postgres.js:110,208,293` e em `postgres-operational-user-port.js:16` — **USR-06** precisa só do caminho de escrita.

### 0018 — contract

`DROP TABLE crm.invitations;` — destrutivo, então fase separada, aplicada com `npm run db:migrate -- --phase contract` depois que o expand estiver estável.

## Domínio: `identity-access`

Sai da superfície pública do serviço: `createInvitation`, `acceptInvitation`. Sai do port `IdentityRepository`: `createInvitation`, `consumeInvitation` (e o `Map` correspondente no repositório em memória).

Entra no serviço, todas exigindo `COMMERCIAL_ADMIN` do ator e todas gravando auditoria na mesma transação:

```
createOperationalUser({ actorId, correlationId, email, name, password, reason })
  → { user: { id, name, email, functionName: 'Vendedor', capabilities: [] } }

updateUser({ actorId, correlationId, email?, name?, password?, reason, targetId })
  → { user }                     // campo ausente = inalterado

listUsers({ actorId })
  → { users: [{ id, name, email, functionName, capabilities, createdAt, disabledAt }] }

setUserDisabled({ actorId, correlationId, disabled, reason, targetId })
  → { user }
```

Ações de auditoria: `identity.user.created`, `identity.user.updated`, `identity.user.disabled`, `identity.user.enabled`. O envelope `IdentityAuditEvent` tem forma fixa — ator, ação, alvo, versão, motivo e `correlationId` — então o evento não enumera quais campos mudaram; ampliar o envelope seria uma mudança de contrato de auditoria fora do escopo desta feature. O que importa para **USR-09** está garantido: a senha e seu hash nunca entram no evento.

`hashPassword` perde a checagem `password.length < 16` e passa a exigir apenas `typeof password === 'string' && password !== ''` (**USR-05**). O `unknownUserPasswordHash` e o resto do fluxo de login não mudam.

`FUNCTIONS` vira `new Set(['Vendedor'])`. Em `authorization.js`, `CAPABILITIES` fica só com `COMMERCIAL_ADMIN`, as duas entradas `privacy.*` saem de `actionCapabilities`, e o teste de função operacional vira `actor.functionName === 'Vendedor'`.

## Contrato HTTP

Saem:

```
POST /api/v1/invitations
POST /api/v1/invitations/accept
```

Entram, todas exigindo sessão + CSRF + `COMMERCIAL_ADMIN`:

```
GET    /api/v1/users                → 200 { users: [...] }
POST   /api/v1/users                → 201 { user }          idempotency-key
PATCH  /api/v1/users/:id            → 200 { user }          idempotency-key
POST   /api/v1/users/:id/disable    → 200 { user }          idempotency-key
POST   /api/v1/users/:id/enable     → 200 { user }          idempotency-key
```

Nenhuma dessas respostas contém a senha em claro (**USR-03**). O corpo de `POST /api/v1/users` recebe `{ email, name, password, reason }`; o de `PATCH`, os mesmos campos todos opcionais menos `reason`.

Códigos reaproveitam o `publicErrorCode` existente: `403 FORBIDDEN` para não-admin (**USR-08**), `409 IDEMPOTENCY_KEY_REUSED`, e um `409` novo para e-mail duplicado — o mapeamento atual devolve `IDEMPOTENCY_KEY_REUSED` para todo `409`, então esse ramo precisa distinguir os dois casos antes de retornar.

`POST /api/v1/bootstrap/identity` continua, agora exigindo `name` (**BOOT-03**). `POST /api/v1/capabilities/grant|revoke` continua, servindo à promoção de admin (**BOOT-04**).

## Frontend

`UsersView.vue` em `/usuarios`, montada só quando `capabilities.includes('COMMERCIAL_ADMIN')`; o item de navegação em `App.vue` também é condicional, e a rota redireciona para `/dashboard` quando o ator não é admin. Isso é conveniência de UI — a autoridade continua no `authorize` do backend.

Estrutura da tela, conforme as pranchas: cabeçalho, coluna principal com `.data-table` de todas as contas, coluna lateral de 23rem com o formulário de criação. Ao criar, a coluna lateral troca para o painel de entrega com o bloco markdown e o botão copiar. Editar abre um diálogo modal sobre a lista, com nome, e-mail, nova senha e a ação de desativar.

O markdown é montado no cliente a partir dos valores digitados no formulário (**USR-03**):

```
**Acesso ao CRM Silmer**

- Nome: {name}
- E-mail: {email}
- Senha: {password}
- Entrar em: {location.origin}
```

`AuthPanel.vue` perde a aba de convite, o `role="tablist"`, `selectTab`, `handleTabKey` e `submitInvite`; sobra o formulário de login, sem `minlength` no campo de senha (**INV-02**, **USR-05**).

## Ordem de dependência

```
0017 expand
   ├─→ domínio identity-access ──→ API ──→ frontend
   │                                 └──→ OpenAPI
   ├─→ consumidores (Atendimento → Vendedor)
   └─→ scripts (create-admin, seed)
0018 contract  ← depois que tudo acima passa
```

A remoção do convite atravessa domínio, API, frontend e seed; só o `DROP TABLE` fica para o fim.

## Risco principal

`Atendimento` está em nove módulos e no `target_role` dos handoffs. O risco real não é a constraint — é um consumidor que continue comparando com a lista antiga e passe a negar acesso a quem deveria ter. A varredura precisa ser exaustiva e verificada por busca, não por memória: `grep -rn "Atendimento"` sem resultado fora de documentação histórica é o critério de pronto de ROLE-04.

## Testes

`TESTING.md` não existe neste repositório. Os testes existentes que tocam identidade e precisam ser reescritos: `test/identity-api.test.js`, `test/identity-api-live.test.js`, `test/identity-session.test.js`, `test/identity-postgres-live.test.js`, `test/phase1-schema-live.test.js`, `test/e2e/foundation.spec.js`.

Cobertura nova esperada:

- Domínio, em memória: criação exige `COMMERCIAL_ADMIN`; atualização parcial preserva campos ausentes; senha de 1 caractere é aceita; desativar impede login; auditoria emitida por operação.
- API, live PostgreSQL: as cinco rotas com sessão real, 403 para não-admin, idempotência repetida, e-mail duplicado.
- Schema, live: constraints rejeitam `Atendimento` e as capacidades de privacidade; `crm.invitations` some após o contract.
- E2E: criar vendedor, ver o bloco markdown, entrar com a conta criada.

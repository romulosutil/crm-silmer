# Runbook de identidade e acesso

## Escopo

Este runbook opera a entrega `T01.2` a `T01.4` da issue `#12`: bootstrap,
convites, sessões, MFA, capacidades, bloqueio progressivo, auditoria e
idempotência. O contrato HTTP está em `docs/api/openapi.v1.yaml`.

## Segredos obrigatórios

Configure no cofre do ambiente, nunca em arquivo versionado:

- `APP_ORIGIN`: origem HTTPS pública exata; múltiplas origens são separadas por
  vírgula.
- `IDENTITY_BOOTSTRAP_TOKEN`: autorização de uso único, com no mínimo 32
  caracteres; remova-a depois do bootstrap.
- `IDENTITY_ENVELOPE_KEY`: 32 bytes em base64url para segredos TOTP.
- `IDEMPOTENCY_ENVELOPE_KEY`: 32 bytes em base64url para respostas de replay.
- `AUTH_THROTTLE_HMAC_KEY`: 32 bytes em base64url para pseudonimizar conta e
  rede.

Gere cada chave de 32 bytes de forma independente com um gerador
criptograficamente seguro. Não reutilize uma chave entre finalidades. A versão
atual do envelope é `v1`; não troque `IDENTITY_ENVELOPE_KEY` ou
`IDEMPOTENCY_ENVELOPE_KEY` em produção sem uma migração de recriptografia
aprovada e testada.

## Primeiro bootstrap

1. Confirme que as migrations expand foram aplicadas e que `/api/health/ready`
   retorna `200`.
2. Abra uma sessão de operador sem gravação de histórico e carregue o token de
   bootstrap pelo cofre.
3. Execute uma única chamada `POST /api/v1/bootstrap/identity` com `Origin`
   permitido e `X-Bootstrap-Token`.
4. Entregue o segredo TOTP e os oito códigos de recuperação diretamente ao
   Admin. Eles são exibidos uma vez; não os copie para issue, log ou evidência.
5. Remova `IDENTITY_BOOTSTRAP_TOKEN` do serviço e faça um novo deploy. Uma nova
   tentativa de bootstrap deve falhar.

## Verificações operacionais

- Login válido define dois cookies: `crm_session` contém `HttpOnly; Secure;
SameSite=Lax`; `crm_csrf` contém `Secure; SameSite=Lax` e nunca autentica
  sozinho.
- `GET /api/v1/sessions/current` retorna `401` após logout, expiração,
  desativação do usuário ou revogação de capacidade privilegiada.
- Todo comando autenticado exige `Origin` exata e igualdade entre o cookie
  `crm_csrf` e `X-CSRF-Token`.
- Convite, MFA e concessão/revogação exigem `Idempotency-Key`. A mesma chave e
  payload reproduzem a resposta; payload divergente retorna `409`.
- Logs podem conter apenas códigos técnicos e IDs de correlação. Nunca devem
  conter e-mail, endereço de rede, senha, token, segredo TOTP ou código de
  recuperação.

Para observar o bloqueio sem expor sujeitos, consulte somente agregados por
`scope` e estado bloqueado. Não selecione nem exporte `subject_hash` como
evidência.

## Incidentes

### Tentativas excessivas

O bloqueio usa janela de 15 minutos, conta e rede pseudonimizadas, e backoff
limitado a 15 minutos. Confirme volume agregado por `scope`; não tente descobrir
o e-mail a partir do hash. Um login válido limpa somente o contador da conta.

### Suspeita de cookie ou sessão comprometida

Revogue as sessões ativas do usuário no PostgreSQL, registre motivo e
correlation ID no fluxo administrativo e force novo login. Não registre o valor
do cookie. Se uma capacidade privilegiada for removida pela API, a revogação de
sessões já integra a mesma transação.

### Chave idempotente presa em `pending`

Uma transação normal nunca confirma `pending`: falha do efeito causa rollback do
registro, efeito e auditoria. Um `pending` confirmado indica intervenção externa
ou versão incompatível; bloqueie replay, preserve somente metadados não sensíveis
e escale para investigação antes de alterar a linha.

## Rollback

A migration `0003_identity_api_hardening.expand.sql` é aditiva; a aplicação
anterior ignora a tabela de throttle e a nova constraint. Para rollback de
aplicação, reverta o digest do runtime sem remover tabelas. Remoção de schema é
uma migration `contract` futura, separada e somente depois de confirmar que não
há leitores nem respostas idempotentes necessárias.

## Gates antes de publicar

Execute `npm run validate`, `npm run test:e2e`, os testes live com
`TEST_DATABASE_URL` apontando exclusivamente para `crm_silmer_test`,
`npm audit --audit-level=high`, `git diff --check` e a verificação de histórico
linear. Validação local não substitui CI remoto, bootstrap humano nem evidência
de recuperação.

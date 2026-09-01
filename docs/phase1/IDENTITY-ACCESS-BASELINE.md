# Baseline de identidade e acesso da Fase 1

**Escopo:** T01.2, T01.3, T01.4 e `PRV-01`  
**Data:** 2026-08-30

**Implementação fechada em:** 2026-09-01, issue `#12`

## Parâmetros versionados

- Senhas usam Argon2id com 19.456 KiB, duas passagens, paralelismo 2, salt
  aleatório de 16 bytes e tag de 32 bytes. Testes podem injetar custo menor;
  produção não pode alterar o baseline sem nova versão e revisão de segurança.
- Convites são aleatórios, armazenados somente por hash, de uso único e sempre
  recebem expiração explícita. Não existe cadastro público.
- Sessões são opacas, armazenadas somente por SHA-256, expiram após 30 minutos
  de inatividade ou 12 horas absolutas e são entregues apenas em cookie
  `HttpOnly; Secure; SameSite=Lax`.
- Comandos autenticados exigem token CSRF independente. A aplicação não grava
  token de sessão ou CSRF em `localStorage`, `sessionStorage`, IndexedDB ou
  Cache Storage.
- TOTP usa passo de 30 segundos, seis dígitos e tolerância de uma janela para
  cada lado. O contador aceito não pode ser reutilizado. O segredo fica
  criptografado com AES-256-GCM e chave externa ao banco.
- O enrolamento MFA emite oito recovery codes de uso único. Somente hashes são
  persistidos; os códigos em claro são mostrados uma vez.
- `COMMERCIAL_ADMIN` e `TECHNICAL_PRIVACY_EXECUTOR` exigem MFA. Função
  `Atendimento|Vendedor`, `COMMERCIAL_ADMIN`, `PRIVACY_OFFICER` e
  `TECHNICAL_PRIVACY_EXECUTOR` permanecem ortogonais.

## Invariantes operacionais

- O primeiro Admin só pode ser provisionado uma vez e gera auditoria sem e-mail,
  senha, token ou conteúdo.
- Um Admin não pode conceder capacidade a si mesmo.
- Revogar capacidade privilegiada invalida imediatamente as sessões
  privilegiadas do destinatário sem alterar a autoria histórica.
- UI e API consomem a mesma política deny-by-default; ocultar controle nunca
  substitui autorização no backend.
- Auditoria guarda apenas ator, ação, alvo, versão, motivo, correlação e horário.
- Repetir o mesmo comando e fingerprint retorna a resposta observável original;
  reutilizar a chave com comando divergente retorna conflito.
- O bloqueio de autenticação usa HMAC-SHA-256 separado para conta e rede, janela
  de 15 minutos, limiares 3/20 e backoff limitado a 15 minutos. E-mail e
  endereço de rede não são persistidos no throttle nem emitidos em log.
- Todo comando autenticado valida origem HTTPS exata e igualdade entre o cookie
  CSRF separado e `X-CSRF-Token`; cookie duplicado é rejeitado como ambíguo.

## Superfícies entregues

- Contrato HTTP versionado em `docs/api/openapi.v1.yaml`, com bootstrap,
  convite/aceite, login, sessão atual, logout, MFA e concessão/revogação.
- Operação e rollback em `docs/runbooks/identity-access.md`, incluindo inventário
  de chaves e proibição de rotação destrutiva sem recriptografia.
- UI vanilla em `apps/edge-web`, sem storage de autenticação ou estado de domínio
  global, com navegação por teclado, foco pós-mudança e regiões `status`/`alert`.
- Repositórios PostgreSQL para usuário, convite, sessão, MFA/recovery, ACL,
  auditoria, throttle e idempotência; responses idempotentes ficam cifradas com
  AES-256-GCM e AAD ligada a escopo, chave e fingerprint.

## Gates

- Testes determinísticos cobrem Argon2id, convite, login/logout, sessão
  hasheada, CSRF, TOTP, recovery, segregação de capacidades, autoatribuição,
  revogação, auditoria e concorrência idempotente.
- A migration da Fase 1 deve provar constraints e compatibilidade em PostgreSQL
  efêmero antes de publicação.
- `test/identity-api-live.test.js` provou em PostgreSQL 17 bootstrap, TOTP,
  convite concorrente, MFA, grant/revoke, replay, `409`, revogação imediata e
  progressão `401, 401, 401, 429`; os testes E2E passaram axe e teclado.
- `ACL-P07-07..11` só pode receber prova E2E completa quando Pedido/Ficha e sua
  UI existirem na Fase 5; a Fase 1 fixa e testa a política reutilizável.

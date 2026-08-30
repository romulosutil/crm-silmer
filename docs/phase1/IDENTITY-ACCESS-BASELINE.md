# Baseline de identidade e acesso da Fase 1

**Escopo:** T01.2, T01.3, T01.4 e `PRV-01`  
**Data:** 2026-08-30

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

## Gates

- Testes determinísticos cobrem Argon2id, convite, login/logout, sessão
  hasheada, CSRF, TOTP, recovery, segregação de capacidades, autoatribuição,
  revogação, auditoria e concorrência idempotente.
- A migration da Fase 1 deve provar constraints e compatibilidade em PostgreSQL
  efêmero antes de publicação.
- `ACL-P07-07..11` só pode receber prova E2E completa quando Pedido/Ficha e sua
  UI existirem na Fase 5; a Fase 1 fixa e testa a política reutilizável.

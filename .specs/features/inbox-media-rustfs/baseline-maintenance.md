# Manutenção dos gates de INBOX-MEDIA-1

## BASE-01: corrigir dependência vulnerável

Status: concluída.

Escopo: somente `package-lock.json`, atualização transitiva de source-map-js
1.2.1 para 1.2.2. Nenhuma versão direta ou runtime declarado foi alterado.
Pré-requisito do gate Build em tasks.md; não conclui nenhuma tarefa MED.

Advisory: https://github.com/advisories/GHSA-68fv-2mgg-jv7q.

Evidência inicial:

- `npm audit --audit-level=high`: uma vulnerabilidade high antes; zero após.
- `npm run validate`: passou; 647 testes aprovados, três skips existentes,
  typecheck, lint, validadores e build aprovados.
- Runtime efetivo local: Node 24.14.1 / npm 11.12.1. Diverge do runtime
  declarado 24.20.0 / 11.19.0; estes checks não comprovam o runtime fixado.
- E2E exclusivo por revisor independente: 107 aprovados, sete skips
  existentes, zero falhas (`npm run test:e2e -- --workers=1`). Os seis
  cenários inicialmente falhos também passaram em execução separada.
- `git diff --check`: aprovado.

Conclusão: gate de segurança liberado sem alterar testes. Não executar E2E
simultaneamente a `build`/`validate`: scripts/build.mjs:64 remove o diretório
dist servido por Playwright, causando 404 temporário (reprodução no trace).
Sem testes novos para a atualização mecânica; audit é a evidência direta da
correção, suíte existente e build verificam regressão.

## Bloqueios externos observados

- O usuário corrigiu a instrução herdada sobre `dell-worker`: Docker local
  autorizado para desenvolvimento e testes. Docker Server 29.3.1 verificado.
- Banco PostgreSQL dedicado local: 11 testes live aprovados, zero skips.
- RustFS: existe apenas bucket Hermes e acesso Hermes listados. Ainda não
  há smoke autenticado, bucket CRM ou credencial restrita CRM comprovados.
  Não alterar nem reutilizar recursos do Hermes.

# Codex — Contexto do CRM Silmer

Este arquivo orienta o Codex. As regras operacionais normativas estão em
[`AGENTS.md`](AGENTS.md); as invariantes do produto estão em
[`RULES.md`](RULES.md). Não replique decisões aqui: atualize a fonte canônica e
mantenha este documento apenas como rota de entrada.

## Inicialização obrigatória

1. Consulte o Brain com `graphify query` antes de pesquisar arquivos do projeto.
2. Leia `ABOUT.md`, `RULES.md` e `ARCHITECTURE.md`.
3. Localize o requisito em `.specs/features/crm-mvp/spec.md` e a tarefa em
   `.specs/features/crm-mvp/tasks.md`.
4. Leia somente as seções relevantes do PRD, TDD e topologia.
5. Execute `git status` e preserve alterações que não pertencem à tarefa.

Se o grafo não responder com contexto suficiente, complemente com leitura direta
dos arquivos. O diretório `historico-datacrazy/` não é fonte normativa.

## Guardrails do MVP

- Use somente HTML, CSS e JavaScript vanilla no frontend.
- Use ESM, IIFE ou classes isoladas; não publique estado de domínio em `window`.
- Mantenha `Deal`/`Negocio` como única raiz do funil e PostgreSQL como fonte da
  verdade.
- A IA é assistiva: não converte, não move etapa, não atualiza campo oficial e
  não inventa preço, prazo ou condição comercial.
- Efeitos externos são idempotentes, auditáveis e podem terminar em
  `outcome_unknown`; nunca faça retry cego.
- Interfaces devem operar por teclado, gerenciar foco e anunciar mudanças com
  ARIA quando necessário.
- Não exponha PII, tokens, payloads de clientes ou segredos em código, fixtures,
  logs, prompts, commits ou saídas de ferramentas.

## Forma de trabalhar

- Entregue a menor fatia vertical que satisfaça critérios rastreáveis.
- Reuse contratos e módulos definidos; registre decisões novas antes de ampliar
  arquitetura ou stack.
- Um agente escreve cada arquivo por vez. Investigações e revisões podem ocorrer
  em paralelo quando não criam conflito de edição.
- Não considere testes verdes suficientes quando o critério de produto ainda
  estiver aberto.
- Não invente comandos, dependências, variáveis ou serviços ausentes do
  repositório.

## Fechamento

1. Rode os checks proporcionais ao risco e `git diff --check`.
2. Confirme rastreabilidade e documentação afetada.
3. Faça commit atômico e push no branch solicitado.
4. Execute `graphify update .`.
5. Se o grafo versionado mudar, faça um commit mecânico `chore(graph)` e novo
   push; finalize com o worktree limpo.

O handoff deve registrar arquivos alterados, verificações executadas, commit,
push, riscos residuais e próximo item desbloqueado.

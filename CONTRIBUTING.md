# Contribuindo com o CRM Silmer

## Antes de alterar

1. Leia `README.md`, `RULES.md`, `ARCHITECTURE.md` e `AGENTS.md`.
2. Escolha um item em `.specs/features/crm-mvp/tasks.md` e identifique os
   critérios correspondentes em `.specs/features/crm-mvp/spec.md`.
3. Consulte o contexto existente com `graphify query`.
4. Verifique o worktree e não misture alterações de outras tarefas.

Uma mudança sem requisito rastreável deve ser classificada como correção de
documentação, manutenção interna ou nova decisão. Mudanças de arquitetura,
stack ou escopo exigem aprovação explícita e atualização da fonte canônica.

## Durante a implementação

- Prefira uma fatia vertical pequena, observável e reversível.
- Mantenha frontend em HTML/CSS/JS vanilla e módulos JavaScript em ESM.
- Trate acessibilidade, autorização, privacidade e idempotência no primeiro
  patch.
- Não adicione dependência sem justificar necessidade, risco, licença e impacto
  operacional.
- Não use dados reais de clientes em desenvolvimento ou testes.
- Atualize documentação e contratos no mesmo trabalho que muda comportamento.

## Validação

Execute os scripts reais definidos pelo repositório para lint, testes, build,
E2E e acessibilidade. Enquanto o bootstrap `T00.1` não existir, a validação
documental mínima é:

```powershell
git diff --check
git status --short
```

Não invente um comando ausente. Ao criar o bootstrap, documente aqui e no
`README.md` a matriz oficial de comandos e seus pré-requisitos.

## Commits e publicação

- Um commit representa uma tarefa ou uma mudança mecânica claramente isolada.
- Use Conventional Commits, por exemplo `docs: add contributor and agent base`.
- Registre no handoff os checks executados e qualquer risco residual.
- Faça push do commit concluído e execute `graphify update .`.
- Se a atualização modificar artefatos rastreados, publique um commit
  `chore(graph)` separado e confirme que o worktree ficou limpo.

O Definition of Done completo permanece em
`.specs/features/crm-mvp/tasks.md`; este guia não o substitui.

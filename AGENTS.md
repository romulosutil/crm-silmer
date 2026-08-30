# Agentes do CRM Silmer

## Escopo e missão

Estas instruções valem para todo o repositório. A equipe deve entregar o MVP
como um monólito modular confiável, acessível e operável, preservando os
contratos de produto, segurança, privacidade e recuperação já aprovados.

## Precedência das fontes

Quando houver conflito, use esta ordem:

1. `RULES.md` — invariantes que não podem ser quebradas.
2. `.specs/features/crm-mvp/spec.md` — requisitos e critérios de aceite.
3. `CRM-MVP-ESPECIFICACAO.md` — escopo e comportamento do produto.
4. `TECHNICAL-DESIGN.md` e `EASYPANEL-TOPOLOGY.md` — implementação e operação.
5. `ARCHITECTURE.md` — resumo das decisões.
6. `.specs/features/crm-mvp/tasks.md` — sequência de entrega.
7. `ABOUT.md`, `README.md` e `CODEX.md` — navegação e contexto.

`historico-datacrazy/` nunca supera uma fonte acima.

## Protocolo obrigatório

1. **Vault-first:** antes da pesquisa em código ou documentos, execute
   `graphify query` com a pergunta da tarefa.
2. **Contexto mínimo:** leia `ABOUT.md`, `ARCHITECTURE.md` e `RULES.md`; depois
   carregue somente requisitos e seções técnicas relevantes.
3. **Rastreabilidade:** associe a mudança a um ID de requisito e a uma tarefa.
4. **Patch estreito:** altere apenas a fronteira necessária e preserve mudanças
   locais de terceiros.
5. **A11y e segurança:** trate teclado, foco, ARIA, autorização, PII,
   idempotência e auditoria como parte da implementação, não como revisão tardia.
6. **1:1:1:1:** uma tarefa concluída gera uma entrega atômica, um commit, um push
   e uma atualização `graphify update .`. Se o grafo rastreado mudar, publique-o
   em um commit mecânico separado e deixe o worktree limpo.

Não introduza frameworks de frontend, estado de domínio em `window`, Redis,
microserviços ou nova infraestrutura sem autorização explícita e decisão
registrada.

## Equipe por responsabilidade

Ative somente os papéis necessários para a fatia. O Tech Lead continua dono da
integração e da decisão final; especialistas entregam evidência, não decisões
silenciosas.

| Papel | Quando ativar | Responsabilidade | Evidência de saída |
|---|---|---|---|
| Tech Lead / Orquestrador | Sempre | Escopo, dependências, contratos, integração e fechamento | Plano, decisões, diff integrado e gate final |
| Produto / Domínio | Regra ambígua, fluxo ou aceite | Mapear comportamento para PRD/spec e impedir expansão de escopo | IDs atendidos, exemplos e dúvidas bloqueantes |
| Frontend / Acessibilidade | HTML, CSS, JS de interface | Semântica, teclado, foco, estados, ARIA e composição responsiva | Cenários por teclado e estados verificados |
| Backend / Dados | API, domínio, SQL ou autenticação | Transações, constraints, ACL, migrações e contratos REST | Testes positivos, negativos e concorrentes |
| Integrações / Confiabilidade | Meta, IA, storage, worker ou PDF | Adapters, assinatura, idempotência, retry, reconciliação e falhas | Fixtures, matriz de efeitos e casos de recuperação |
| QA / Segurança / Privacidade | Toda fatia de risco | Revisão adversarial, regressão, PII, abuso, autorização e observabilidade | Findings priorizados e critérios executados |
| DevOps / Release | CI, imagem, EasyPanel, backup ou go-live | Build reproduzível, digest, segredos, health, rollback e recovery | Logs de pipeline, digest e runbook validado |

### Composição eficiente por tipo de tarefa

- UI: Tech Lead + Frontend/A11y + QA.
- API ou domínio: Tech Lead + Backend/Dados + QA.
- Canal, IA, worker ou documento: Tech Lead + Backend + Integrações + QA.
- CI/deploy/recovery: Tech Lead + DevOps + QA; Privacidade participa quando há
  dados, backup, logs ou operador externo.
- Documentação ou configuração estreita: Tech Lead executa sozinho e chama
  revisão especializada apenas se alterar contrato.

## Contrato de delegação e handoff

Cada trabalho delegado deve informar:

- objetivo e critério de aceite;
- requisito/tarefa associados;
- arquivos que o papel pode editar;
- arquivos, decisões e mudanças locais que deve preservar;
- comandos de verificação esperados;
- formato do retorno: achados, mudanças, evidências, riscos e bloqueios.

Divida trabalho apenas quando as partes forem independentes. Um único papel é
dono de cada arquivo; investigação é somente leitura; revisão não reescreve o
patch sem combinar a posse. O Tech Lead integra, executa os gates completos e
responde pelo resultado ponta a ponta.

## Definition of Done resumida

- Critérios rastreáveis atendidos, incluindo cenários negativos.
- Autorização validada na API e na interface quando aplicável.
- Operação completa por teclado e foco previsível em toda UI alterada.
- Nenhuma PII ou segredo em log, fixture, diff ou artefato.
- Migração, idempotência, falha externa e rollback cobertos conforme o risco.
- Documentação e runbook atualizados junto com a mudança.
- `git diff --check`, checks do projeto, commit, push e Graphify concluídos.

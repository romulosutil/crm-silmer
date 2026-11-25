# Tarefas e plano de merge do CRM Silmer 2.0

Este plano materializa o [RFC 075](../../../docs/rfc/075-crm-20-centrado-no-cliente.md).
Os IDs D referem-se às decisões do RFC. Os IDs G referem-se à
[matriz de regressão](validation.md). Cada tarefa tem um
[prompt de execução](PROMPTS.md). T00 é a proposta documental. As demais
marcam trabalho futuro.

## Branches e dependências

Cada linha abaixo corresponde a uma branch curta, um commit atômico e um PR
para `master`. Criar a branch a partir de `origin/master` já contendo todos
os pré-requisitos. A coluna de merge descreve o estado permitido nessa ponta.
Um mesmo checkout tem um escritor. Execução paralela só onde as fronteiras
são independentes e o procedimento de checkout de `AGENTS.md` é atendido.

| Tarefa                             | Branch                               | Depende de                      | Requisitos e gates                                 | O que pode ser mesclado                                                                                                                                       |
| ---------------------------------- | ------------------------------------ | ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C20-T00 — SDD e RFC                | `docs/crm-20-sdd`                    | Base do MVP                     | C20-01–13 · G00                                    | Proposta revisável, sem mudança de runtime.                                                                                                                   |
| C20-T01 — Baseline de regressão    | `test/crm20-01-baseline`             | T00                             | C20-01, 05, 06, 09 · G01, G02, G03, G04            | Testes de caracterização reproduzíveis para regras vigentes.                                                                                                  |
| C20-T02 — Inventário de dados      | `chore/crm20-02-inventory`           | T00                             | C20-03, 07, 08, 10 · G00, G07                      | Consulta de diagnóstico somente leitura, dados sintéticos e relatório agregado. Pode avançar em paralelo com T01.                                             |
| C20-T03 — API de leitura comercial | `feat/crm20-03-read-api`             | T01, T02, D02 e D03             | C20-02, 03, 05 · G01, G02, G06                     | Endpoints aditivos com capacidade desabilitada, sem trocar consumidores.                                                                                      |
| C20-T04 — Perfil de Clientes       | `feat/crm20-04-clients`              | T03                             | C20-01, 02, 03, 05 · G01, G02, G05                 | Perfil em Clientes e Meus clientes. Pode avançar em paralelo com T05 após T03.                                                                                |
| C20-T05 — Painel de atendimento    | `feat/crm20-05-inbox-context`        | T03                             | C20-04, 05, 06 · G01, G02, G05                     | Resumo no painel existente, com falhas e concorrência de leitura isoladas.                                                                                    |
| C20-T06 — Homologar leitura        | `test/crm20-06-read-release`         | T04, T05                        | C20-01–06, 12 · G00, G01, G02, G05, G06, G09       | Evidência do fluxo integrado e dos controles de observação. Ativação após aceite da leitura e conferência do artefato implantado.                             |
| C20-T07 — Expandir identidade      | `feat/crm20-07-phone-schema`         | T01, T02, D01 registrada em ADR | C20-07, 08, 10, 12 · G03, G06, G07                 | Migração aditiva compatível com o leitor e escritor anteriores. Pode avançar em paralelo com T04/T05 se D01 estiver fechada.                                  |
| C20-T08 — Resolução de telefone    | `feat/crm20-08-phone-resolver`       | T07                             | C20-07, 08 · G03, G06                              | Serviço transacional com testes reais de concorrência, ainda fora dos pontos de entrada.                                                                      |
| C20-T09 — Integrar ingresso        | `feat/crm20-09-inbound`              | T08                             | C20-06, 07, 08, 09, 12 · G01, G03, G04             | Resolver no ingresso aprovado, com flag desabilitada por padrão e allowlist vazia.                                                                            |
| C20-T10 — Primeiro envio e eco     | `feat/crm20-10-first-send-echo`      | T09                             | C20-08, 09, 12 · G01, G03, G04                     | Integrar ou validar os caminhos de saída e eco. Compatibilidade com versão anterior e efeitos protegidos pelo mesmo escopo.                                   |
| C20-T11 — Ensaio da migração       | `chore/crm20-11-migration-report`    | T08, D04 para escopo de ensaio  | C20-08, 10, 12 · G03, G07, G08                     | Inventário de candidatos e plano de lotes em modo de simulação, sem alterações de vínculos. Pode avançar em paralelo com T09 se arquivos forem independentes. |
| C20-T12 — Aplicar e reverter lotes | `feat/crm20-12-migration-batches`    | T10, T11, D04 para escrita      | C20-08, 10, 12 · G03, G07, G08                     | Executor com simulação padrão, pré-condições e autorização para escrita. Ensaio de aplicação em cópia isolada.                                                |
| C20-T13 — Sinal de simultaneidade  | `feat/crm20-13-concurrent-attention` | T05, T09, D02 para aviso        | C20-05, 11, 12 · G02, G03, G05                     | Aviso autorizado com flag independente desabilitada. Pode avançar em paralelo com T11/T12.                                                                    |
| C20-T14 — Homologar duas linhas    | `test/crm20-14-pilot-gates`          | T06, T10, T12, T13, D04         | C20-06–12 · G00, G02, G03, G04, G06, G07, G08, G09 | Evidências e instruções de ativação. Operação executa ativação aprovada após merge no SHA implantado.                                                         |
| C20-T15 — Sugerir encerramento     | `feat/crm20-15-close-suggestion`     | T06, D05 para sugestão          | C20-05, 06, 13 · G01, G02, G05, G10                | Sugestão interna com aceitação humana. Flag desabilitada na entrega. Pode avançar em paralelo com a trilha de identidade após a decisão.                      |
| C20-T16 — Projetar escopo futuro   | `docs/crm20-16-future-decisions`     | T14, priorização de D05         | C20-13 · G00, G10                                  | Proposta de requisitos, riscos e critérios para futuras entregas. Mudanças de comportamento seguem planos e RFCs próprios.                                    |

## Ordem de merge e ativação

1. **Fundação documental e testes.** T00 → T01/T02. Se teste de caracterização
   revela um defeito no caminho afetado, registrar e corrigir com regressão
   antes de aceitar uma mudança que depende daquele caminho.
2. **Leitura comercial.** T03 → T04/T05 → T06. A API já tem de estar disponível
   antes dos consumidores. Testar a UI contra resposta vazia, falha transitória
   e indisponibilidade do resumo. Ativar a projeção após os gates de T06.
   Registrar D01–D05 no ADR e nas fontes canônicas correspondentes.
3. **Identidade protegida.** T07 → T08 → T09 → T10. A migração é aditiva.
   Flag, allowlist e fallback compatível entram junto ao primeiro ponto de
   entrada. Se houver mudança de workflow, publicar a versão dependente
   somente depois de confirmar CRM compatível e ingressos antigos funcionando.
4. **Lotes e piloto.** T11 → T12. T13 pode ser mesclada com a projeção
   desligada. T14 aceita a ponta integrada quando a matriz passar. PR e deploy
   preservam o piloto desligado. Ativar apenas nas linhas de D04, após aceite
   e checagem de SHA, configuração e rollback.
5. **Evoluções.** T15 é independente do rollout de duas linhas. T16 entrega
   critérios para decisões futuras. Um gate reprovado bloqueia o merge
   dependente. Resolver a causa e repetir regressões no novo SHA.

Manter o histórico linear com rebase. Após integração, remover a branch
concluída segundo o [guia de contribuição](../../../CONTRIBUTING.md). Nos PRs
anotar requisito, tarefa, critérios, testes e estado da flag. Gate obrigatório:
`git diff --check`, validação aplicável, checks exigidos no SHA final e
conversas de revisão resolvidas. Quando houver rollback autorizado, usar o
procedimento do [design](design.md#upgrade-ativação-e-recuperação).

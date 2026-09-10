# Execução paralela das próximas fases

> **Atualizado em:** 09/09/2026  
> **Fila de produto:** `.specs/features/crm-mvp/tasks.md`  
> **Ordem de experiência:** `docs/roadmap/PROXIMAS-FASES.md`

Este plano transforma a fila canônica em duas frentes que podem ser executadas
em paralelo. Ele não cria requisito, entidade, canal ou decisão arquitetural:
em caso de divergência, prevalecem `RULES.md`, a especificação e o plano macro.

## Ponto de partida e limite operacional

O ambiente de desenvolvimento já permite executar o workflow `DEV | Silmer |
Fluxo completo sem WhatsApp` com a API do CRM e simular os dois envios do
canal. Isso prova o caminho técnico de desenvolvimento, mas **não encerra
OPS-1**: a homologação do número oficial, a publicação e a troca do webhook
continuam sendo a última etapa conjunta com o cliente.

Portanto, os dois desenvolvedores podem construir e validar com dados
sintéticos sem aguardar a credencial ou o número oficial. Nenhuma tarefa abaixo
autoriza salvar segredo no repositório, dar acesso do n8n ao PostgreSQL ou
reativar a entrada Meta direta como fallback.

## Frentes e posse exclusiva

| Frente | Dono | Pode alterar | Não altera |
| --- | --- | --- | --- |
| A — domínio, integração e operação | Desenvolvedor A | `modules/**`, `apps/api/**`, `modules/database/migrations/**`, `ops/n8n/**`, contratos e testes de API/integração | `apps/edge-web/**` |
| B — experiência operacional | Desenvolvedor B | `apps/edge-web/**` e `test/e2e/**` | módulos de domínio, API, migrações, workflows e OpenAPI |
| Integração de release | Tech Lead | apenas o ajuste mínimo que não possa ser isolado, após revisão dos dois PRs | lógica de produto nova |

O Desenvolvedor A é também o único editor de `docs/api/openapi.v1.yaml`,
`apps/api/src/app.js` e das migrações durante estas fases. O Desenvolvedor B
consome o contrato publicado e, se precisar de um campo ou endpoint, abre uma
solicitação de contrato em vez de alterar esses arquivos. Essa regra elimina os
três hotspots de conflito do repositório.

## Sequência de trabalho

As atividades da mesma onda são paralelas. Uma dependência marcada com seta só
libera a implementação completa da tarefa posterior quando o PR anterior tiver
sido integrado em `master`.

| Onda | Desenvolvedor A — domínio, integração e operação | Desenvolvedor B — experiência operacional | Dependência e saída integrada |
| --- | --- | --- | --- |
| 0 — agora | **A0. Estabilizar o teste DEV n8n** (`N8N-MVP-1`, preparação de `OPS-1`): manter o workflow sanitizado, fixtures, execução sintética e runbook de diagnóstico; publicar o contrato de leitura segura de anexo se ele ainda não existir. | **B0. Completar a parte pendente de UI-1**: atualização da Inbox, estados offline/erro e teste sem mouse sobre os endpoints existentes; renderizar anexo somente após o contrato seguro de A0. | Podem iniciar juntos. A0 não conecta WhatsApp oficial; B0 não cria um botão para iniciar n8n. |
| 1 | **A1. Publicar a consulta de fila de handoffs** (`UI-2`, `AGT-03–05`, `AGT-08`, `PRV-01`): read model paginado, ACL por papel, minimização, cursor, OpenAPI e testes de disputa `409`. | **B1. Evoluir UI-3 e UI-4 sobre contratos existentes**: detalhe do Contato e do Negócio, vínculos, gates, tarefas e histórico, sem merge/unmerge até existir o comando de domínio. | B1 é independente. A1 integrado libera B2. |
| 2 | **A2. CRM-3 — fechamento, Pedido e Ficha** (`ORD-01–05`, `PAY-01–05`, `FIN-01–03`): orçamento versionado, venda, PIX, confirmação humana, contador `NN-CRM`, snapshot/PDF e efeitos externos idempotentes/reconciliáveis. | **B2. Entregar UI-2**: fila de Handoffs, filtros por papel, idade/SLA, detalhe da conversa e `claim`, usando exclusivamente a consulta e o contrato de A1. | A2 e B2 podem avançar juntos depois de A1. A aprovação de venda/pagamento/Ficha nunca é automatizada pela UI. |
| 3 | **A3. Confiabilidade e operação sob evidência** (`INBOX-3`, `AGENTE-6`): saúde, itens `outcome_unknown`, retry e reconciliação; só abrir a tela se o piloto justificar `UI-5`. | **B3. Consolidar a jornada operacional**: acabamento acessível de UI-1 a UI-4 e, somente quando A3 e o piloto aprovarem, a superfície mínima de reconciliação (`UI-5`). | UI-5 não é backlog automático; precisa de evidência de uso real. |
| posterior | **A4. Adapter e contrato Instagram** (`CANAL-2`), depois do MVP WhatsApp e da correlação verificável de identidade. | **B4. Experiência multicanal Instagram** após A4, preservando o mesmo Contato e Negócio. | `CANAL-2` não bloqueia o primeiro MVP e não permite fusão por similaridade. |

## Limites de cada entrega

### A0 — teste de desenvolvimento do n8n

- **Arquivos típicos:** `ops/n8n/workflows/**`,
  `docs/integrations/n8n/**`, `apps/api/src/n8n-*.js`,
  `modules/n8n-integration/**`, `modules/integration-reliability/**` e testes
  `test/n8n-*.test.js`.
- **Aceite:** workflow DEV importável/sanitizado, execução sintética
  repetível, replay sem duplicidade, handoff e `message.send.unknown`
  diagnosticáveis; nenhuma credencial ou payload pessoal no export ou log.
- **Fora de escopo:** publicar o workflow principal, trocar webhook Meta ou
  configurar o número do cliente.

### A1 — read model de handoffs

- A consulta deve devolver somente handoffs que o ator pode visualizar; a
  reivindicação continua protegida por compare-and-swap no servidor.
- O contrato vem antes da tela e deve cobrir paginação, estados vazios,
  autorização, `409` de corrida e dados minimizados de conversa/Negócio.
- A migração, se necessária, é criada por A imediatamente antes da integração,
  usando o próximo número disponível em `master`; não se reserva numeração em
  branches paralelas.

### A2 — CRM-3

- O domínio é independente da interface e do n8n: cada efeito de cobrança,
  numeração, geração, envio ou boas-vindas precisa de idempotência, auditoria e
  caminho de reconciliação.
- A entrega é fatiada por efeito observável (por exemplo: orçamento/venda,
  pagamento, depois Pedido/Ficha), cada qual com migração, contrato, testes
  negativos e commit próprio. Não há PR único para todo o CRM-3.
- A evidência de ACL de Pedido/Ficha fecha a parte aplicável da issue `#13`; um
  double não substitui o cenário E2E com as entidades reais.

### B0 a B4 — interface

- O frontend usa apenas endpoints e SSE já publicados; não acessa PostgreSQL,
  não mantém estado de domínio em `window` e não calcula elegibilidade, preço,
  gate, epoch ou revisão no cliente.
- Cada tela inclui loading, vazio, erro, offline, foco previsível, teclado,
  ARIA, autorização e conteúdo pessoal minimizado. Testes Playwright e axe
  entram na mesma entrega da tela.
- B2 espera A1 integrado. B3 pode começar pelos vínculos que os read models já
  expõem; merge/unmerge só entra com comando, reversibilidade e auditoria
  aprovados pelo domínio.

## Ritual para não gerar conflito

1. Ambos criam branches a partir do mesmo `origin/master` e mantêm uma tarefa
   rastreável por PR. Um PR não mistura as frentes A e B.
2. Antes de iniciar uma mudança de contrato, A registra no PR o endpoint,
   campos, ACL, erros e exemplos; B implementa contra essa versão, nunca contra
   um endpoint presumido.
3. A integra migrações somente após rebase em `master` e aloca o número naquele
   momento. Se houver duas migrações prontas, a segunda é renomeada no próprio
   PR antes do merge, nunca depois de aplicada em ambiente compartilhado.
4. `OpenAPI`, `app.js` e runbooks de integração têm um único dono (A). O
   frontend não altera esses arquivos; dúvidas viram issue/comentário de PR.
5. Cada PR executa ao menos `npm test`, lint/typecheck e os testes diretamente
   afetados. Alterações em UI executam também `npm run test:e2e`; alterações de
   API/migração executam os testes PostgreSQL aplicáveis. Antes de release,
   executar `npm run validate` e o smoke DEV do n8n.
6. Depois de cada entrega: `git diff --check`, commit atômico, push por PR e
   `graphify update .` em commit mecânico separado se o grafo tiver mudado. Não
   forçar uma atualização do grafo que reduza ou substitua dados existentes sem
   investigação.

## Gates que não pertencem a uma frente de código

| Gate | Momento | Responsáveis |
| --- | --- | --- |
| OPS-1: número oficial, credenciais finais, publicação e webhook Meta | Após A0 e antes do lançamento | Cliente + operação + Desenvolvedor A |
| Backup/restore, storage externo e monitor off-host (issues `#3`, `#29`, `#11`) | Antes de produção | DevOps/Tech Lead |
| DPA, retenção/ZDR do provedor de IA (issue `#5`) | Antes de PII em produção | Privacidade + cliente |
| Aprovação UAT de Inbox, handoff, PIX e Ficha | Após A2/B3 | Produto + operação |

Esses gates podem ser preparados em paralelo, mas uma execução sintética, teste
automatizado ou configuração DEV não os declara concluídos.

## Critério de conclusão desta organização

O plano está funcionando quando cada desenvolvedor consegue abrir o próximo PR
sem editar arquivo de posse do outro, os contratos chegam antes das telas que
deles dependem e `master` continua sempre testável com o workflow DEV. A ordem
de produto permanece: OPS-1, UI-1, UI-2, UI-3, UI-4, UI-5 sob evidência e,
por último, CANAL-2.

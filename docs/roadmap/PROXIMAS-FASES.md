# Próximas fases — interfaces operacionais do CRM Silmer

> **Atualizado em:** 08/09/2026  
> **Status:** sequência executiva posterior ao contrato n8n v1  
> **Fila canônica:** `.specs/features/crm-mvp/tasks.md`

Este documento torna visível a ordem das próximas entregas de interface. Ele
não cria requisitos paralelos: detalha a execução dos requisitos existentes e
deve ser atualizado junto da fila canônica quando uma fase mudar de estado.

## Estado de partida

- A aplicação Vue possui autenticação, shell responsivo, Kanban, detalhe do
  Negócio e Conta nas rotas `/kanban`, `/negocios/:dealId` e `/conta`.
- O contrato n8n v1 e as mutações humanas de mensagem, takeover, retorno à IA,
  fechamento e claim de handoff estão implementados no backend.
- Inbox, conversa, fila de handoffs, detalhe do Contato e telas operacionais
  ainda precisam de seus read models e contratos de consulta completos antes
  da implementação visual.
- A ativação real do workflow n8n pode avançar em paralelo às primeiras telas,
  mas a homologação ponta a ponta é obrigatória antes do gate final.

## Ordem das próximas fases

| Ordem | Fase | Tela/rota principal                      | Resultado observável                                                                  | Rastreabilidade                            |
| ----: | ---- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
|     1 | UI-1 | Inbox `/inbox`                           | Operação encontra e prioriza conversas sem misturá-las ao Kanban                      | INB-01, MSG-01–03, ORC-08                  |
|     2 | UI-2 | Atendimento `/conversas/:id`             | Pessoa lê o histórico, responde, assume, devolve à IA ou encerra                      | AGT-01, AGT-03, AGT-05–06, ORC-07          |
|     3 | UI-3 | Fila `/handoffs`                         | Atendimento e Vendedor reivindicam somente handoffs compatíveis                       | AGT-03–05, AGT-08, PRV-01                  |
|     4 | UI-4 | Contato `/contatos/:id`                  | “Cliente” aparece como Contato, identidades, conversas e Negócios                     | INB-02, INB-04, ORC-09, PRV-01–03          |
|     5 | UI-5 | Kanban e Negócio existentes              | Telas atuais passam a conectar Contato, Conversa, briefing e ações restantes          | AGT-02, AGT-07–08, ORD-01–05               |
|     6 | UI-6 | Monitor `/operacao/automacoes`           | Operação identifica falhas, claims, comandos e reconciliações sem acessar PII técnica | ORC-04–05, ORC-08, AGT-06, MSG-02–03       |
|     7 | UI-7 | Integrações `/configuracoes/integracoes` | Administrador vê saúde e versões e controla somente opções permitidas                 | ORC-02, ORC-04, ORC-06, MSG-04, PRV-01–03  |
|     8 | UI-8 | Validação transversal                    | Fluxos passam por E2E, acessibilidade, segurança e homologação multicanal             | ORC-01–09, INB-01–04, AGT-01–08, MSG-01–04 |

## UI-1 — Inbox

**Inclui:** lista paginada, busca e filtros por canal, estado, modo, papel-alvo
e responsável; contato projetado, última mensagem, timestamp, pendência,
handoff e saúde da automação; loading, vazio, erro, offline e atualização em
tempo real.

**Contrato anterior à tela:** publicar na OpenAPI o read model de
`GET /api/v1/inbox/conversations`, com paginação por cursor, filtros fechados,
ACL e resposta sem payload bruto do canal.

**Aceite:** Atendimento ou Vendedor encontra uma conversa usando somente
teclado, entende por que ela requer atenção e não vê conversas fora do seu
escopo.

## UI-2 — Atendimento da conversa

**Inclui:** cabeçalho do Contato e canal, linha do tempo, anexos seguros,
briefing versionado, composer e estados de entrega; ações de responder,
takeover, retorno à IA e fechamento com confirmação e feedback auditável.

**Contratos:** adicionar a consulta de detalhe da conversa e reutilizar as
mutações já implementadas em `/messages`, `/takeover`, `/return-to-ai` e
`/close`. A tela apresenta modo, revisão e epoch, mas nunca permite que o
cliente escolha fences técnicos manualmente.

**Aceite:** takeover durante geração invalida a resposta antiga; replay da ação
humana não duplica mensagem; foco retorna ao ponto previsível após modal, erro
ou sucesso.

## UI-3 — Fila de handoffs

**Inclui:** filas separadas por `target_role`, motivo, prioridade, idade,
conversa e eventual Negócio; detalhe resumido e ação de assumir.

**Contratos:** publicar consulta paginada de handoffs abertos e reutilizar
`POST /api/v1/handoffs/{id}/claim`. O backend continua sendo responsável por
validar pessoa ativa, papel e compare-and-swap.

**Aceite:** pessoa incompatível não vê ou não consegue assumir a fila;
concorrência produz um vencedor e `409` para o segundo operador, com mensagem
compreensível e atualização da lista.

## UI-4 — Detalhe do Contato

**Inclui:** dados canônicos do `Contact`, identidades de WhatsApp e Instagram,
origem, histórico de vínculos, conversas, handoffs e Negócios relacionados.

Esta é a representação visual do “Cliente”. Não será criada tabela ou tela de
cadastro paralela chamada `customers` ou `leads`. Merge/unmerge de identidade,
quando exposto, continua humano, reversível, motivado e auditado.

**Contrato:** criar a projeção autorizada de `GET /api/v1/contacts/{id}` sem
descriptografar ou retornar campos que a função atual não pode consultar.

**Aceite:** um Contato recorrente mostra várias identidades e Negócios sem
fundir pessoas por nome, telefone parecido ou inferência da IA.

## UI-5 — Kanban e detalhe do Negócio

Esta fase evolui telas já existentes; não as reimplementa. Deve conectar o
Negócio ao Contato e à Conversa, exibir briefing promovido, gates, tarefas,
handoffs e histórico, e completar as ações comerciais previstas nas fases
CRM-2 e CRM-3.

**Aceite:** Backlog continua fora do Kanban; automação e pessoa usam as mesmas
regras oficiais; correção retorna à primeira etapa incompleta sem apagar o
histórico.

## UI-6 — Monitor de automações e reconciliação

**Inclui:** versão do workflow, execução, provedor/modelo, duração, estado do
claim, comando, tentativa de entrega, falha e `outcome_unknown`; filtros por
estado e correlação e acesso ao item de reconciliação.

**Contrato:** criar read models operacionais minimizados sobre
`automation_runs`, `ai_turns`, `n8n_commands`, `message_delivery_attempts` e
`reconciliation_items`. Mensagem, prompt, token, segredo e payload pessoal não
entram nessa projeção.

**Aceite:** Operação identifica a pendência e o próximo procedimento sem banco,
logs brutos ou editor do n8n; repetir uma ação incerta à Meta não é oferecido
como botão genérico.

## UI-7 — Configuração da integração

**Inclui:** integração habilitada/desabilitada, canal, ambiente, workflow e
versão esperados, último smoke, saúde do CRM/n8n/Meta e estado da rotação de
credencial. Segredos aparecem apenas como configurado, ausente ou em rotação.

**Contrato:** reutilizar o catálogo versionado e criar somente as projeções e
comandos administrativos ainda ausentes. A tela não publica workflow, não
transfere webhook e não exibe valor de credencial sem uma decisão posterior
explícita.

**Aceite:** apenas função autorizada altera configuração; toda mudança gera
auditoria; configuração incompleta permanece fail-closed.

## UI-8 — Gate transversal e homologação

- Executar Playwright e axe nos caminhos felizes, vazios, falhos e sem
  permissão, incluindo viewport móvel e operação sem mouse.
- Testar concorrência entre IA, takeover e claim de handoff.
- Homologar WhatsApp antes da publicação e Instagram antes do lançamento
  integral.
- Validar ausência de PII e segredos em DOM, URL, analytics, log, fixture,
  screenshot e export.
- Atualizar OpenAPI, runbooks e documentação da fase no mesmo commit da
  implementação.

## Arquivos e fronteiras prováveis

- `apps/edge-web/src/router.js`, `App.vue`, `views/` e `features/`: rotas,
  navegação e telas Vue.
- `apps/edge-web/src/lib/api-client.js` e `event-stream.js`: comunicação e
  atualização em tempo real, sem estado de domínio em `window`.
- `apps/api/src/`: rotas de leitura e autorização das novas projeções.
- `modules/inbox-channels`, `contacts`, `work-management`, `deals-pipeline` e
  `n8n-integration`: queries e serviços nas fronteiras existentes.
- `docs/api/openapi.v1.yaml`: contrato executável criado antes do consumo pela
  interface.
- `test/` e Playwright: autorização, concorrência, UX, regressão e
  acessibilidade.

## Documentos que guiam a execução

Use esta ordem quando houver dúvida:

1. `RULES.md`: invariantes que nenhuma tela pode quebrar.
2. `.specs/features/crm-mvp/spec.md`: requisitos e critérios de aceite.
3. `CRM-MVP-ESPECIFICACAO.md`: comportamento e escopo do produto.
4. `TECHNICAL-DESIGN.md`: módulos, dados, APIs, segurança e estados.
5. `docs/api/openapi.v1.yaml`: contrato HTTP executável.
6. `.specs/features/crm-mvp/tasks.md`: ordem canônica das entregas e status.
7. Este documento: visão executiva e detalhamento das próximas interfaces.
8. `docs/integrations/n8n/README.md`: operação e limites da integração.
9. `ARCHITECTURE.md` e `EASYPANEL-TOPOLOGY.md`: decisões duráveis, rollout e
   operação.

ADRs explicam decisões já tomadas; RFCs registram propostas relevantes. Em
conflito, prevalece a ordem definida em `AGENTS.md`, e este roadmap deve ser
corrigido para refletir a fonte superior.

# Próximas fases — produto e interfaces do CRM Silmer

> **Atualizado em:** 08/09/2026  
> **Status:** sequência posterior à simplificação n8n MVP
> **Fila canônica:** `.specs/features/crm-mvp/tasks.md`
> **Execução em duas frentes:** `docs/roadmap/EXECUCAO-PARALELA.md`

Nenhuma interface nova faz parte da entrega `N8N-MVP-1`. Este documento mostra
o que deve aparecer em tela depois que o fluxo WhatsApp estiver homologado,
sem criar entidades ou requisitos paralelos.

## Estado de partida

O frontend já possui autenticação, shell, Dashboard operacional, Inbox,
detalhe da conversa, Kanban, detalhe do Negócio, Clientes e Conta. Inbox e
Clientes consomem read models autorizados do PostgreSQL; Dashboard agrega
somente Kanban e Inbox, sem fabricar vendas ou pedidos ainda inexistentes. O
read model da fila de Handoffs continua pendente.

### Entregue na conexão frontend/backend de 08/09/2026

- `GET /api/v1/inbox/conversations` e
  `GET /api/v1/inbox/conversations/{id}`, com filtros fechados, paginação por
  cursor assinado, minimização e ACL `conversation.read`;
- `GET /api/v1/contacts` e `GET /api/v1/contacts/{id}`, com identidades
  decifradas somente após autorização e ACL `contact.read`;
- Inbox ligada às mutações existentes de resposta, takeover, retorno à IA e
  encerramento, usando versão esperada, CSRF e idempotência;
- estados acessíveis de loading, vazio, erro e repetição em Dashboard, Inbox e
  Clientes; remoção do dataset e do aviso de demonstração.

Permanecem fora desta fatia anexos seguros, atualização em tempo real da Inbox,
fila dedicada de Handoffs e merge/unmerge de identidades. Portanto, UI-1 e UI-3
avançaram, mas não devem ser declaradas integralmente encerradas.

## Ordem recomendada

| Ordem | Fase                            | Resultado para a operação                                                                                       | Dados principais                                                              |
| ----: | ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
|     0 | OPS-1 — homologação WhatsApp    | O fluxo real é validado ainda sem nova UI; falhas são verificadas por contrato e runbook.                       | Conversa, Mensagem, briefing, Handoff e eventos técnicos.                     |
|     1 | UI-1 — Inbox + Conversa         | A pessoa encontra conversas, lê histórico e briefing, responde, assume, devolve à IA ou encerra no mesmo fluxo. | `Contact`, `Conversation`, `Message` e estado de entrega.                     |
|     2 | UI-2 — Fila de handoffs         | Atendimento e Vendedor veem e reivindicam somente itens compatíveis.                                            | `Handoff`, papel-alvo, motivo, SLA e responsável.                             |
|     3 | UI-3 — Detalhe do Cliente       | “Cliente” aparece como Contato, identidades, conversas e Negócios relacionados.                                 | `Contact` + `ContactIdentity`; nenhuma tabela `customers`.                    |
|     4 | UI-4 — Evolução do Negócio      | Kanban e detalhe existentes mostram origem da conversa, dados promovidos, gates, tarefas e handoff.             | `Deal`, Contato e Conversa; Backlog continua fora do Kanban.                  |
|     5 | UI-5 — Operação e reconciliação | Somente se o piloto demonstrar necessidade, a operação vê comandos falhos e resultados incertos.                | `n8n_commands`, `reconciliation_items`, Mensagem e metadados de `n8n_events`. |
|     6 | CANAL-2 — Instagram             | O mesmo domínio recebe a segunda identidade e a jornada multicanal é homologada.                                | Nova `ContactIdentity`, sem duplicar Cliente ou Negócio.                      |

## UI-1 — Inbox e atendimento da conversa

Os read models são `GET /api/v1/inbox/conversations` e
`GET /api/v1/inbox/conversations/{id}`. A tela combina lista e detalhe responsivos:
última mensagem, prioridade, canal, modo IA/humano, indicador de handoff,
histórico, anexos seguros, briefing atual, composer e estados de entrega.

Reutiliza `POST /messages`, `/takeover`, `/return-to-ai` e `/close`. A UI não
expõe edição manual de epoch ou revisão. O aceite cobre teclado, foco, loading,
vazio, erro, offline, autorização e replay sem mensagem duplicada.

Rastreabilidade: INB-01, AGT-01, AGT-03, AGT-05–06, ORC-07–08 e MSG-01–03.

## UI-2 — Fila de handoffs

Criar consulta paginada de handoffs abertos e reutilizar
`POST /api/v1/handoffs/{id}/claim`. A lista separa Atendimento e Vendedor e
mostra motivo, idade, SLA, conversa e Negócio quando existir. O servidor decide
elegibilidade e compare-and-swap; numa disputa há um vencedor e o outro recebe
`409` compreensível.

Rastreabilidade: AGT-03–05, AGT-08 e PRV-01.

## UI-3 — detalhe do Cliente

Usar `GET /api/v1/contacts` e `GET /api/v1/contacts/{id}` com ACL e
minimização. A tela mostra dados
canônicos, identidades verificadas, conversas, handoffs e Negócios. Não funde
pessoas por nome, telefone parecido ou inferência de IA. Merge/unmerge, quando
exposto, é humano, reversível, motivado e auditado.

Rastreabilidade: INB-02, INB-04, ORC-09 e PRV-01–03.

## UI-4 — Kanban e detalhe do Negócio

Evoluir as telas existentes, sem reimplementá-las. Exibir vínculo com Contato e
Conversa, campos que já foram promovidos ao domínio, gates, tarefas, handoffs e
histórico. O briefing da conversa pode aparecer como referência, claramente
separado dos dados oficiais do Negócio.

Rastreabilidade: AGT-02, AGT-07–08 e ORD-01–05.

## UI-5 — operação somente quando necessária

Não haverá tela de runs, claims ou tentativas: esses conceitos saíram do MVP.
Se o uso real justificar uma interface operacional, criar uma projeção mínima
de comandos, Mensagens `outcome_unknown`, reconciliações e metadados sanitizados
de eventos. Nunca exibir segredo, prompt, token ou payload bruto do cliente.

Rastreabilidade: ORC-04–05, ORC-08 e MSG-02–03.

## CANAL-2 — Instagram

Implementar o adapter de canal e homologar a correlação explícita entre
identidade do Instagram e telefone. A segunda identidade preserva o mesmo
Contato e Negócio apenas após correlação verificável e auditável. Esta fase não
deve reintroduzir lógica específica de canal nas entidades canônicas.

Rastreabilidade: ORC-02, ORC-09 e MSG-04.

## Documentos que guiam os próximos passos

Use esta ordem em caso de dúvida:

1. `RULES.md` — invariantes.
2. `.specs/features/crm-mvp/spec.md` — requisitos e aceite.
3. `CRM-MVP-ESPECIFICACAO.md` — escopo e comportamento.
4. `TECHNICAL-DESIGN.md` — módulos, dados, APIs e segurança.
5. `docs/api/openapi.v1.yaml` — contrato HTTP executável.
6. `.specs/features/crm-mvp/tasks.md` — ordem e status das entregas.
7. Este roadmap — composição e sequência das próximas telas.
8. `docs/integrations/n8n/README.md` — operação e limite da integração.
9. `ARCHITECTURE.md` e `EASYPANEL-TOPOLOGY.md` — decisões e rollout.

Cada fase começa pelo read model e OpenAPI, segue com backend e testes e só
então implementa Vue. Acessibilidade, autorização, PII e estados de erro fazem
parte da fase, não de uma revisão posterior.

Quando duas pessoas trabalharem ao mesmo tempo, usar
`EXECUCAO-PARALELA.md` para a posse de arquivos, dependências e ordem de merge.
Ele organiza a execução, mas não altera esta sequência nem os critérios acima.

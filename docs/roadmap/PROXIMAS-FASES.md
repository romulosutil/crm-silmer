# Próximas fases — produto e interfaces do CRM Silmer

> **Atualizado em:** 11/09/2026  
> **Status:** jornada de atendimento priorizada antes da jornada comercial  
> **Fila canônica:** `.specs/features/crm-mvp/tasks.md`

Nenhuma interface nova faz parte da entrega `N8N-MVP-1`. Este documento mostra
o que deve aparecer em tela depois que o fluxo WhatsApp estiver homologado,
sem criar entidades ou requisitos paralelos.

## Estado de partida

O frontend já possui autenticação, shell, Dashboard operacional, Inbox,
detalhe da conversa, Kanban, detalhe do Negócio, Clientes e Conta. Inbox e
Clientes consomem read models autorizados do PostgreSQL; Dashboard agrega
somente Kanban e Inbox, sem fabricar vendas ou pedidos ainda inexistentes. O
read model de Handoffs está disponível na Caixa de Entrada para operadores Vendedor, assim
como o claim atômico já existente. A migração vigente de identidade consolidou
as funções humanas em `Vendedor`; este roadmap não volta a introduzir a antiga
separação Atendimento/Vendedor sem decisão, migração e autorização explícitas.

### Entregue na conexão frontend/backend de 08/09/2026

- `GET /api/v1/inbox/conversations` e
  `GET /api/v1/inbox/conversations/{id}`, com filtros fechados, paginação por
  cursor assinado, minimização e ACL `conversation.read`;
- `GET /api/v1/contacts` e `GET /api/v1/contacts/{id}`, com identidades
  decifradas somente após autorização e ACL `contact.read`;
- Inbox ligada às mutações existentes de resposta, takeover, retorno à IA e
  encerramento, usando versão esperada, CSRF e idempotência;
- estados acessíveis de loading, vazio, erro e repetição em Dashboard, Inbox e
  Clientes; remoção do dataset e do aviso de demonstração;
- `GET /api/v1/inbox/handoffs`, com ACL `handoff.read`, cursor assinado e
  minimização após autorização, e seção de handoffs na Caixa de Entrada que
  reivindica pela mutação
  oficial com versão esperada, CSRF e idempotência;
- atualização em tempo real da Inbox, incluindo handoffs, sem roubar o foco,
  incluindo tratamento compreensível de disputa (`409`) ao assumir um handoff.

Permanecem fora desta fatia anexos seguros e merge/unmerge de identidades.
UI-1 e UI-2 estão disponíveis para homologação conjunta; UI-3 não deve ser
declarada integralmente encerrada até que a relação de handoffs seja exposta no
detalhe do Cliente.

## Corte atual — jornada de atendimento completa

Este corte fecha a operação de atendimento antes de qualquer evolução comercial:
entrada por n8n, criação ou resolução de Contato e Conversa, resposta da IA,
handoff, fila, assumir conversa, responder manualmente, devolver à IA,
transferir para outro Vendedor e encerrar. A fonte da verdade permanece o CRM;
o n8n simula apenas o transporte WhatsApp no workflow de desenvolvimento.

Não fazem parte deste corte conversão de Negócio, Kanban comercial, preço,
pedido, PIX ou Ficha. A separação evita que a validação operacional dependa de
dados comerciais ainda não homologados.

| Frente                     | Dono sugerido    | Pode seguir em paralelo                                                   | Dependência / fronteira protegida                                                                   |
| -------------------------- | ---------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Homologação do atendimento | QA/Integrações   | Executar os quatro cenários DEV e as ações humanas no ambiente publicado. | Não altera contratos, banco nem workflow sem registrar a evidência.                                 |
| Robustez do atendimento    | Backend/Frontend | Cobrir anexos seguros, offline e detalhes de handoff no Cliente.          | Preserva `conversation-routes`, `operation-routes` e OpenAPI; mudanças de contrato são coordenadas. |
| Jornada comercial          | Produto/Backend  | Refinar critérios e modelos de conversão em uma branch futura.            | Só inicia após a homologação deste corte; não muda Inbox, Handoff ou workflow DEV.                  |

Aceite operacional: para um mesmo Contato, um operador consegue observar a
Conversa, disputar e assumir o Handoff com um único vencedor, responder sem
duplicação, devolver a automação, transferir o responsável e receber atualizações
em tempo real. O teste DEV deve cobrir `message`, `handoff`, `send_unknown` e
`delivery_status` com identificadores de evento inéditos.

Durante a automação, a Conversa também mantém uma pré-ficha criptografada. A IA
extrai cada informação confirmada e pergunta pelo próximo campo obrigatório;
o handoff `briefing_complete` só ocorre quando a pré-ficha de atendimento está
completa. Ela é uma preparação para o Vendedor, não a Ficha/Pedido oficial e
não autoriza preço, disponibilidade, prazo garantido, pagamento ou conversão
automática de Negócio.

## Ordem recomendada

| Ordem | Fase                            | Resultado para a operação                                                                                       | Dados principais                                                              |
| ----: | ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
|     0 | OPS-1 — homologação WhatsApp    | O fluxo real é validado ainda sem nova UI; falhas são verificadas por contrato e runbook.                       | Conversa, Mensagem, briefing, Handoff e eventos técnicos.                     |
|     1 | UI-1 — Inbox + Conversa         | A pessoa encontra conversas, lê histórico e briefing, responde, assume, devolve à IA ou encerra no mesmo fluxo. | `Contact`, `Conversation`, `Message` e estado de entrega.                     |
|     2 | UI-2 — Handoffs na Inbox        | Vendedor vê e reivindica itens pendentes na mesma tela de atendimento.                                          | `Handoff`, papel-alvo, motivo, SLA e responsável.                             |
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

## UI-2 — Handoffs na Caixa de Entrada

Disponibilizar, dentro da Caixa de Entrada, a consulta paginada de handoffs
abertos e reutilizar `POST /api/v1/handoffs/{id}/claim`. A lista mostra motivo,
idade, SLA e conversa. Ao assumir, a própria Caixa de Entrada abre a conversa
assumida. O servidor decide elegibilidade e compare-and-swap; numa disputa há
um vencedor e o outro recebe `409` compreensível. A primeira versão está
entregue para a função humana vigente `Vendedor`.

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

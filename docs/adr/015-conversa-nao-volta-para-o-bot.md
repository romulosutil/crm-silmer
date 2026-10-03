# ADR 015 — A conversa não volta para o bot

Status: aceito; esclarecida pelo PO em 03/10/2026: a regra vale dentro de um
ciclo de atendimento. Quando uma conversa encerrada como `Sem lead` recebe uma
mensagem nova do cliente, o ciclo novo começa com o bot, como para qualquer
cliente novo (caso de borda da
[especificação Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md)).

Data: 02/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 02/10/2026: "A conversa nunca volta
para o bot." A resposta 404 da rota removida, a recusa no domínio e a
preservação do histórico são decisões do Tech Lead.

Requisitos: `PCX-05` e o caso de borda do pedido pendente na
[especificação Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md);
`ORC-07` e `AGT-03` na
[especificação do MVP](../../.specs/features/crm-mvp/spec.md). Tarefas T54 e
T55 em [tasks](../../.specs/features/pedidos-mvp/tasks.md). Mantém o
`automation_epoch` da [ADR 003](003-adotar-integracao-n8n-mvp-simples.md) e
as regras de transferência da
[ADR 009](009-regras-de-transferencia-e-teto-do-bot.md); limita a projeção da
pré-ficha da [ADR 006](006-pedido-dois-status.md) ao tempo em que a conversa
está com o bot.

## Contexto

A Caixa de Entrada oferecia "Devolver à IA" a quem estava com a conversa. O
botão chamava `POST /api/v1/conversations/{id}/return-to-ai`, que voltava
`automation_state` para `assistant`, tirava o responsável, subia o
`automation_epoch` e avisava o n8n com o comando `return_to_ai`. O bot voltava
a responder um cliente que um vendedor já atendia e a projetar a pré-ficha no
pedido pendente.

A conversa só sai do bot por handoff (preço, pedido de pessoa, ficha
completa, teto, pedido que não começa do zero; ADR 009 a 013) ou por uma
pessoa que assume o atendimento. Devolvê-la reabre o que o handoff fechou: o
cliente volta a ouvir perguntas que já respondeu ao vendedor, e o bot e o
vendedor passam a escrever no mesmo pedido.

## Decisão

1. **A conversa nunca volta para o bot.** Depois do handoff ou de "Assumir
   atendimento", a conversa segue com uma pessoa até o encerramento. Repassar
   o atendimento troca o vendedor; não devolve ao bot.
2. **Sem "Devolver à IA" na Caixa de Entrada.** Com o bot ou aguardando
   vendedor, a única mudança de atendimento é "Assumir atendimento". As demais
   ações (filas Todas/Minhas/Sem responsável, Arquivar e ver arquivadas,
   Repassar atendimento, Editar nome, Ver contato e o botão do pedido)
   continuam iguais e na mesma ordem de tabulação.
3. **Sem rota.** `POST /api/v1/conversations/{id}/return-to-ai` deixa de ser
   registrada e responde 404, como qualquer rota desconhecida, antes da
   autenticação e sem tocar a conversa. O contrato OpenAPI lista só
   `takeover` e `close`.
4. **Sem método nem ramo no domínio.** `reactivateAgent` sai do serviço da
   Caixa de Entrada. Os repositórios PostgreSQL e em memória aceitam só as
   mudanças de `CONVERSATION_MUTATIONS` (`archive`, `send`, `takeover`,
   `transfer`, `transition`, `unarchive`) e recusam qualquer outra, inclusive
   `reactivate`, com `INBOX_INVALID`, antes de ler ou gravar. Nenhuma delas
   grava `automation_state = 'assistant'`.
5. **Histórico intacto, sem migração.** Auditorias e eventos de domínio
   `conversation.assistant_reactivated` e comandos `return_to_ai` já gravados
   continuam no banco. A constraint de `crm.n8n_commands` continua aceitando
   `return_to_ai` para não invalidar linhas antigas, e `automation_state`
   mantém os valores `assistant` e `human`.

## Consequências

- **Pedido pendente:** depois do handoff ou de "Assumir atendimento", o bot
  não volta a projetar a pré-ficha no pedido pendente. O `briefing_patch` de
  uma conversa com vendedor já era ignorado para o pedido (`PAG-02`); agora
  isso vale até o encerramento. O que o bot coletou antes fica no pedido e no
  resumo do handoff, e o vendedor completa o resto.
- Na spec do Pedidos MVP, `PCX-05` deixa de listar "Devolver à IA" e o caso
  de borda "WHEN a conversa volta para a IA THEN o pedido pendente SHALL
  voltar a receber a projeção" dá lugar à regra desta ADR.
- Quem assumiu por engano não devolve a conversa ao bot: repassa a outro
  vendedor ou encerra.
- O `automation_epoch` continua subindo na tomada humana, no handoff e no
  encerramento; o retorno à IA sai dessa lista.
- A ação `conversation.reactivate-agent` continua na lista de ações
  operacionais de `modules/identity-access`, sem rota que a use, como as ações
  do Kanban aposentado ([ADR 004](004-aposentar-kanban-e-negocio.md)).
- Ficam fora deste corte, para decisão do PO: uma mensagem nova depois de
  `Sem lead` abre um novo ciclo da conversa, que começa com o bot; o workflow
  do n8n e o outbox de comandos ainda reconhecem a ação `return_to_ai`, que o
  CRM não emite mais.

## Alternativas descartadas

- **Manter o botão só para administradores:** o PO quer a regra sem exceção;
  um administrador também repassa ou encerra.
- **Esconder só o botão:** a rota e o método continuariam devolvendo a
  conversa por fora da interface.
- **Responder 400 ou 410 na rota antiga:** exigiria manter uma rota só para
  recusar; o 404 já é a resposta a um comando desconhecido e não chega à
  autenticação nem ao domínio.
- **Migração para apagar o histórico ou mudar a constraint:** apagaria parte
  de uma auditoria que é append-only, sem mudar o comportamento.

# ADR 009 — Regras de transferência e teto do bot no n8n

Status: aceito

Data: 30/09/2026

Decisores: PO (Rômulo Sutil Corrêa), em 30/09/2026.

RFC: [RFC 006](../rfc/006-atendimento-guiado-do-bot-no-n8n.md). Requisitos:
`AGT-01`, `AGT-03`, `AGT-05`, `AGT-06`, `PFI-14`. PRs:
romulosutil/crm-silmer#99 e romulosutil/crm-silmer#109.

O número 007 continua reservado para a ADR da ficha por produto.

## Contexto

O Vendedor Silmer conversa com o cliente no WhatsApp e preenche a pré-ficha.
O PO quer um atendimento consultivo que transfira para um vendedor quando o
cliente pergunta preço, pede alguém pelo nome ou não é compreendido, e que
tenha um teto de mensagens.

O contrato atual tem três limites:

- a reserva de envio e o handoff consomem a mesma revisão inbound
  (`claimed_revision`), então o workflow não consegue avisar o cliente e
  transferir na mesma rodada;
- a constraint `handoffs_reason_code_check` não aceita um motivo para o teto;
- o ator de automação não recebe a lista de vendedores.

`recent_messages` traz no máximo 20 mensagens das últimas 24 horas e não serve
para contar 15 respostas do bot.

## Decisão

1. **O modelo classifica e o código decide.** O modelo devolve sinais
   (`asks_price`, `person_request`, `requested_seller`, `answer_status`,
   `asked_field`); o nó de decisão do workflow aplica as regras de forma
   determinística e escreve o aviso ao cliente.
2. **Teto.** No máximo 15 mensagens do agente por Conversa; a 15ª é o aviso
   de transferência. O CRM é a autoridade: conta as mensagens do agente da
   Conversa na transação da reserva e recusa uma resposta normal quando só
   sobra a vaga do aviso. O teto tem motivo próprio, `iteration_limit`.
3. **Aviso junto do handoff.** `handoff.requested` passa a aceitar um `notice`
   opcional. O CRM grava o handoff, reserva o aviso como mensagem do
   assistente e conta o aviso no teto, tudo na mesma transação. O handoff
   existe mesmo se a Meta falhar.
4. **Preço.** Pergunta de preço, valor, desconto, frete ou pagamento gera aviso
   e handoff `negotiation`, em qualquer rodada. A palavra "orçamento" sozinha
   não dispara.
5. **Vendedor pelo nome.** O inbound devolve os vendedores ativos (id e
   primeiro nome). Pedido por um deles gera aviso e handoff `human_requested`
   sem responsável, com o nome no resumo; a atribuição continua atômica.
6. **Nome fora do CRM.** Na primeira vez, o bot registra o nome em `notes` e
   continua. Se o cliente pedir essa pessoa de novo, transfere com
   `human_requested`.
7. **Duas tentativas.** O estado fica em `briefing_status = clarifying` e
   `next_required_field` (que aceita `order_intent` para a pergunta de
   orçamento), sem campo novo no contrato. Na segunda resposta incompreensível
   ou indecisa para o mesmo item, o bot transfere com `low_confidence`.
   Perguntas do cliente não contam.
8. **Sem handoff antecipado** por informação suficiente; o bot coleta até a
   pré-ficha completa, um gatilho ou o teto.
9. **Sugestões rasas** de malha, técnica, cor e modelo são permitidas antes do
   catálogo, sem afirmar que a Silmer trabalha com a opção. O catálogo nasce de
   duas semanas de Pedidos digitados à mão (`PFI-14`) e fecha a RFC 005.
10. **Só Vendedor.** A função Atendimento não recebe mais handoffs; todos os
    motivos declaram `target_role` Vendedor. A regra 20 de `RULES.md` muda
    junto com esta ADR.
11. **Campo deixado para o vendedor** recebe "Definir com o vendedor", não é
    perguntado de novo e aparece no resumo do handoff.
12. **Retirada** é sempre na loja da Silmer; o bot não pergunta o local.
13. **Outro idioma e qualquer reclamação** transferem com aviso.

## Consequências

- O BOT-03 da RFC 006 (romulosutil/crm-silmer#111) traz a migração 0025 do
  motivo `iteration_limit`, a contagem na reserva, o aviso no handoff, a lista
  de vendedores no inbound, o OpenAPI e o rótulo "Limite de mensagens" na Inbox.
  O contador não precisa de coluna: o CRM conta as mensagens do agente.
- Diante de um CRM sem o BOT-03, o workflow conta mensagens do cliente
  (`source_revision`), lê `SILMER_PILOT_SELLERS` e grava o teto como
  `low_confidence`; o aviso não é autorizado e não sai pelo WhatsApp.
- O workflow de produção só pode ser publicado com o BOT-03 no CRM de destino.
- A regra das duas tentativas não exige mudança no CRM.

## Alternativas descartadas

- **Teto e contadores só no n8n** (Data Table ou memória do workflow): cria
  estado paralelo ao CRM e não resiste a execuções concorrentes.
- **Contar pelo `recent_messages`:** a janela de 20 mensagens em 24 horas não
  alcança 15 respostas.
- **Atribuir direto ao vendedor pedido:** quebraria a atribuição atômica da
  regra 20 sem ganho para uma equipe de quatro pessoas.
- **Campo `field_attempts` no briefing:** um estado `clarifying` basta para
  duas tentativas.

# ADR 085 — Recuperação de leads por modo de atendimento

Data: 11/11/2026. Status: aceita pelo proprietário quanto à orquestração e à
separação entre sugestão humana e envio pelo agente.
Proposta: [RFC 063](../rfc/063-recuperacao-de-leads-sem-retorno-no-n8n.md).
Requisitos [REC-01–12](../../.specs/features/lead-recovery/spec.md);
tarefas [REC-T00–T04](../../.specs/features/lead-recovery/tasks.md).
Sem issue específica; PR da entrega documental vinculada no handoff.

Complementa as ADRs 003, 015, 059, 061 e 065. Não supersede a proibição de
retorno ao bot após handoff nem autoriza envio automático em conversa humana.

## Contexto

O proprietário solicitou um fluxo no n8n acionado quando o cliente cair em
Sem retorno. Ao escolher o tratamento das conversas humanas, confirmou:
"Sugerir ao vendedor; enviar automaticamente só nas conversas com o agente".

A aba é calculada em leitura por tempo e mensagens efetivas, sem um evento
de transição persistido. Recuperação exige uma fonte de autorização própria:
o turno inbound normal consome uma revisão de mensagem do cliente e não deve
ser reexecutado nem falsificado para originar o contato.

## Decisão

1. Um workflow dedicado no **n8n** orquestra a recuperação após a elegibilidade
   de Sem retorno definida pelo CRM. Não depende de a Inbox estar aberta.
2. Se o atendimento continua **com o agente**, o fluxo pode enviar uma
   retomada contextual após reserva autorizada, idempotente e auditada.
3. Se o atendimento está **humano**, o fluxo prepara apenas uma sugestão
   interna para o vendedor. A pessoa revisa e envia pela Inbox. O workflow
   não envia ao cliente, não assume identidade humana, não muda o responsável
   e não reativa o bot.
4. O CRM continua sendo a fonte de estado, autorização, contexto, controle de
   tentativas e auditoria. n8n usa API técnica; não acessa o banco diretamente.
5. Respostas do cliente seguem o inbound normal, mantendo o modo de
   atendimento atual. Preço, mínimo e prazo continuam sujeitos às decisões
   humanas e às regras comerciais aprovadas.
6. Os mecanismos propostos na RFC — poll de cinco minutos, uma tentativa por
   ciclo, expediente, lembretes, piloto e autorização específica — devem ser
   fechados e verificados nas tarefas de implementação. Esta ADR não declara
   esses mecanismos implementados nem concede acesso técnico já disponível.

## Consequências

- A regra 5 de RULES ganha uma capacidade de recuperação distinta do
  acompanhamento da ficha; a observação em atendimento humano continua sem
  envio automático. A regra 19 permanece integral.
- Precisam ser implementados contrato de elegibilidade e reserva, ledger,
  sugestão na Inbox, workflow e testes de concorrência/cancelamento. A
  reserva normal dependente de inbound e a classificação pessoal de lembrete
  não podem ser reaproveitadas sem resolver suas diferenças semânticas.
- Implantação e ativação são gates separados. O lote histórico não é
  autorização para disparar mensagens ao publicar o workflow.
- Esta entrega é documental. Não altera runtime, canais, credenciais,
  mensagens, dono, modo ou estado de nenhuma conversa.

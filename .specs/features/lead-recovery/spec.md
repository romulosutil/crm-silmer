# Recuperação de leads sem retorno

Decisão de produto: [ADR 085](../../../docs/adr/085-recuperacao-de-leads-por-modo-de-atendimento.md),
11/11/2026. Desenho técnico proposto na
[RFC 063](../../../docs/rfc/063-recuperacao-de-leads-sem-retorno-no-n8n.md).
Planejamento [REC-T00–T04](tasks.md). Runtime ainda não implementado.

## Requisitos

- **REC-01 — Orquestração:** o n8n SHALL executar workflow dedicado após a
  elegibilidade de Sem retorno reconhecida pela API do CRM, sem depender da
  tela aberta, acessar o banco ou fabricar inbound.
- **REC-02 — Elegibilidade:** o CRM SHALL aplicar o limite de 72 horas e a
  precedência PCX-19/ADR 065 a partir das mensagens efetivas. Encerrada,
  arquivada, perda ativa, falha/incerteza de envio ou nova inbound SHALL NOT
  autorizar recuperação automática. Sem retorno é derivado, não novo status.
- **REC-03 — Atendimento humano:** modo humano SHALL produzir apenas sugestão
  interna. SHALL NOT enviar ao cliente, alterar posse, reativar agente nem
  registrar a sugestão como mensagem outbound. Regra 19/ADR 015 preservadas.
- **REC-04 — Com o agente:** somente modo agente atual e elegível SHALL
  permitir envio automático após reserva de recuperação de uso único. A
  revisão inbound já consumida SHALL NOT ser reutilizada como autorização.
- **REC-05 — Ciclo e duplicidade:** o ledger SHALL identificar o ciclo de
  atendimento e a última inbound, inclusive sua ausência. Poll, replay,
  reinício, lembrete e mensagem da própria recuperação SHALL NOT duplicar a
  tentativa. Cadência inicial proposta: uma tentativa por ciclo de silêncio.
- **REC-06 — Concorrência:** persistência de sugestão e reserva SHALL revalidar
  modo, dono, permissões, epoch, revisões, mensagem mais recente, configuração
  e elegibilidade sob fronteira transacional. Mudança humana SHALL invalidar
  envio automático preparado; reserva não garante cancelamento de efeito já
  iniciado no provedor.
- **REC-07 — Sugestão:** dono/Admin autorizado SHALL poder ler, revisar,
  descartar e enviar pelo compositor humano existente. Contexto ou posse
  alterados SHALL tornar a sugestão obsoleta/inacessível ao dono anterior.
  Conversa humana sem dono SHALL usar fila autorizada, sem claim automático.
- **REC-08 — Conteúdo:** a retomada SHALL usar contexto conhecido, preservar
  Assunto/Pedido e não repetir coleta respondida. Dúvida comercial, prazo
  antigo ou divergência SHALL exigir revisão humana. Conversas de atendentes
  SHALL NOT criar automaticamente preço, mínimo, catálogo ou prazo aprovado.
- **REC-09 — Transporte:** envio SHALL integrar reserva, histórico e callbacks
  da Inbox. Resultado desconhecido SHALL bloquear retry criador. Replay
  SHALL devolver estado sem nova autorização de efeito. Resposta do cliente
  SHALL seguir inbound normal, preservando o modo atual.
- **REC-10 — Operação:** flag própria SHALL iniciar desligada; workflow SHALL
  iniciar inativo. Primeira ativação SHALL ter corte e piloto privado; lote
  histórico SHALL exigir habilitação separada. Expediente e adiamento pelo
  responsável SHALL ser resolvidos no contrato, sem imitar lembrete de ator.
- **REC-11 — Privacidade e autorização:** APIs SHALL usar capacidade técnica
  específica, limites, idempotência e correlação; UI SHALL conservar ACL,
  sessão, CSRF/origem, teclado e foco. Contexto e texto persistidos SHALL ser
  cifrados; logs, métricas, testes e execuções retidas SHALL NOT conter PII.
- **REC-12 — Evidência:** métricas SHALL separar sugestão, tentativa, envio
  conhecido, resultado incerto e resposta posterior, com janela e denominador.
  Saída da aba SHALL NOT comprovar recuperação. Desativar SHALL preservar o
  ledger e impedir reenvio por reativação.

REC-01, REC-03 e a separação de REC-04 refletem a decisão expressa do PO.
Os demais requisitos concretizam a proposta técnica e as guardas existentes;
seu fechamento e teste fazem parte de REC-T01, sem presumir aceite operacional.

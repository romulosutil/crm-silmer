# RFC 063 — Recuperação de leads sem retorno no n8n

Data: 11/11/2026. Responsável: Tech Lead. Decisão de produto registrada na
[ADR 085](../adr/085-recuperacao-de-leads-por-modo-de-atendimento.md).
Requisitos [REC-01–12](../../.specs/features/lead-recovery/spec.md);
entrega documental REC-T00 e tarefas de implementação no
[plano](../../.specs/features/lead-recovery/tasks.md). Sem issue específica;
PR desta entrega vinculada no handoff.

O proprietário escolheu um workflow n8n disparado pela entrada em **Sem
retorno**. Em 11/11 confirmou: **sugerir ao vendedor; enviar automaticamente
só nas conversas com o agente**. Essa escolha não autoriza reativar o bot em
conversa humana. Os detalhes técnicos abaixo são a proposta de implementação;
não representam runtime entregue, publicação ou envio autorizado em lote.

## Contexto confirmado no código

- `SILENT_AFTER_HOURS = 72`, em
  `modules/inbox-channels/src/turn-policy.js`, é a fonte do limite de silêncio.
- A classificação em
  `modules/inbox-channels/src/adapters/postgres-inbox-read-repository.js`,
  função `turnJoins`, é derivada em leitura, com precedência para falha de
  envio, perda ativa, handoff e mensagem do cliente. O relógio pode mudar a
  aba sem nenhuma escrita, webhook ou evento SSE de transição.
- O corte é contado da última resposta efetiva da Silmer, nos estados
  `sent|delivered|read`, conforme a ADR 065. Não basta selecionar a última
  inbound com mais de 72 horas.
- Lembretes são pessoais: a mesma conversa pode estar em Aguardando para
  quem adiou e em Sem retorno para outro leitor. O executor técnico precisa
  de uma política explícita, sem simular a sessão de um vendedor.
- `message.send.requested` depende de modo, epoch e revisão inbound atual,
  consumida uma vez. Reexecutar o atendimento original ou fabricar uma
  inbound para iniciar a recuperação quebraria esse contrato.
- As regras 5 e 19 de RULES e a ADR 015 mantêm o atendimento humano. A
  sugestão interna é compatível com essa fronteira; envio automático nessas
  conversas continua proibido.

A observação da Inbox de 10/11 encontrou 37 conversas na aba e uma amostra
com orçamento enviado, coleta interrompida, dúvida comercial pendente e prazo
antigo. Não é inventário atual nem seleção de destinatários. Nenhuma
transcrição, nome, telefone ou ID de cliente integra esta proposta.

## Workflow proposto

Nome: **Silmer | Recuperar leads sem retorno**. Workflow separado do
atendimento inbound, inativo até o gate REC-T04. Fuso `America/Sao_Paulo`.
Proposta inicial: Schedule Trigger a cada cinco minutos, uma tentativa por
ciclo de silêncio, com envio somente no expediente comercial vigente.

| Nó                                  | Responsabilidade                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Agendar verificação                 | Acordar a cada cinco minutos; não manter uma execução Wait por cliente.                                    |
| CRM — Listar recuperações elegíveis | API técnica aplica a política oficial, pagina e retorna candidatos mínimos.                                |
| CRM — Preparar recuperação          | Reserva a preparação do ciclo; fornece histórico e dados já conhecidos sob autorização.                    |
| Agente — Preparar retomada          | Produz texto curto, contextual e uma decisão estruturada: sugerir, enviar ou encaminhar para revisão.      |
| CRM — Validar decisão               | Revalida contexto, modo, versões, bloqueios e destino; persiste a decisão e seu conteúdo cifrado.          |
| Atendimento humano?                 | Usa o modo atual devolvido pelo CRM, nunca a inferência do modelo.                                         |
| CRM — Salvar sugestão               | Disponibiliza ao responsável/Admin autorizado, sem chamar transporte nem criar mensagem outbound.          |
| CRM — Reservar envio de recuperação | Autoriza um único efeito do ciclo, com fonte própria e guardas finais.                                     |
| Transporte existente — Enviar       | Usa o ramo de envio e os contratos da Inbox, sem credencial de canal nova ou envio direto fora da reserva. |
| CRM — Registrar resultado           | Persiste enviado, falha definitiva ou resultado desconhecido; timeout não reenvia.                         |

O CRM continua sendo a fonte da verdade, da elegibilidade, do responsável e
do ledger. O n8n agenda, prepara o texto e orquestra; não lê nem escreve o banco.
Endpoints e campos novos devem ser fechados em REC-T01; os rótulos acima não
são rotas existentes. Não usar endpoints humanos com cookie de administrador.

## Ciclo de silêncio e revalidação

Proposta de identidade durável: conversa + ciclo do atendimento + última
mensagem inbound do cliente. A ausência de inbound usa um marcador explícito
do ciclo, sem chave nula que permita duplicatas. A última saída efetiva e as
versões observadas são provas de elegibilidade, não uma chave que renasce a
cada mensagem enviada pela própria recuperação.

Uma recuperação enviada, sugerida, descartada ou de resultado incerto não
autoriza outra por novo poll, reinício do n8n, troca de responsável, vencimento
de lembrete ou mais 72 horas de silêncio. Nova mensagem real do cliente encerra
o ciclo anterior. Uma nova tentativa depende de um novo ciclo elegível;
cadências adicionais exigem decisão própria.

Preparação pode ser repetida sem efeito externo; reserva de envio tem uso
único e nunca é reapresentada como nova autorização no replay. Troca para
atendimento humano invalida o envio e permite, no máximo, sugestão interna.
Uma sugestão precisa indicar a revisão que a originou e ficar obsoleta se o
contexto ou responsável mudar; não deve vazar para o responsável antigo.

Antes de persistir sugestão e antes de autorizar envio, verificar sob a
fronteira transacional existente: última inbound e última saída efetiva,
atendimento aberto, modo, posse/ACL, epoch, revisão, canal/destino, falha ou
incerteza anterior, perda ativa, configuração e janela de expediente. Eventos
posteriores à reserva obedecem aos fences do transporte existente; o sistema
não promete cancelar um efeito que já começou no provedor.

Proposta conservadora para lembretes: adiar pelo responsável atual suspende a
recuperação até o prazo. Lembretes alheios não escondem a conversa de todos.
Conversa humana sem dono produz sugestão na fila autorizada, sem atribuição
automática. Validar esses detalhes em REC-T01 junto com a política da fila.

## Conteúdo e atendimento

- Usar os aprendizados aprovados e a versão efetivamente publicada; confirmar
  as pendências VND-L04/L05 antes de afirmar que a melhoria está em produção.
- Conversas novas informam a revisão e o contexto individual. Não viram
  automaticamente catálogo, preços, mínimo ou promessa de prazo.
- Não repetir dados já conhecidos nem reabrir o questionário inteiro.
- Preço, disponibilidade, prazo antigo, dúvida comercial não resolvida ou
  divergência entre pedido e orçamento exigem revisão humana, sem promessa.
- Em conversa humana, mostrar **Sugestão de retomada**, permitindo revisão,
  descarte e envio humano pelo compositor e pela autorização já existentes.
  Não preencher nem enviar o compositor automaticamente.
- O envio automático é identificado como agente. A resposta do cliente usa
  o fluxo inbound normal e respeita o modo atual; não há takeover reverso.

## Implantação e critérios

Primeiro, contratos, ledger, testes e UI; depois, workflow inativo e canário
sintético. Habilitação requer flag própria desligada por padrão, corte de
ativação e allowlist de piloto privada. Conversas que já estavam em Sem
retorno não entram em disparo retroativo por ligar o workflow: o lote histórico
tem revisão e habilitação separadas. O tamanho do piloto é definido nesse gate.

Validar dois polls concorrentes, repetição de execução, nova inbound durante
preparação, ação humana antes da reserva, sugestão obsoleta, troca de dono,
lembrete, perda, fechamento, resultado incerto e isolamento entre usuários.
Auditoria usa códigos, versões e correlação; texto e contexto ficam cifrados,
sem PII em log, fixture, PR ou dados de execução persistidos do n8n.

Não medir recuperação pela saída da aba: a mensagem enviada pode mudar essa
classificação. Medir ciclos elegíveis, sugestões, tentativas, entrega conhecida,
respostas posteriores e conversões com janela e denominador explícitos;
resposta posterior não comprova causalidade.

Rollback: desligar a flag e o workflow; preservar ledger, mensagens,
resultados incertos e auditoria. Reativação não libera tentativas consumidas.
Não restaurar banco, fazer replay de inbound ou limpar tentativas para reenviar.

## Alternativas consideradas

- Webhook em toda mudança da aba: não existe hoje; a passagem do tempo não
  gera escrita. O poll evita persistir um segundo estado de conversa.
- Wait de 72 horas por atendimento: exige cancelamento de execuções antigas e
  não resolve a revalidação; preferir descoberta periódica pelo CRM.
- Ativar o vendedor original novamente: rejeitado para conversas humanas e
  inadequado para uma recuperação sem nova inbound.
- Envio direto Evolution pelo n8n sem ledger: rejeitado por eliminar os
  contratos de autorização, histórico, idempotência e resultado desconhecido.

## Estado da entrega

REC-T00 registra a decisão de produto e prepara requisitos, tarefas e este
desenho. REC-T01–T04 permanecem pendentes. Não há código de runtime,
migration, endpoint novo, workflow importável/publicado, flag habilitada nem
envio a clientes nesta entrega.

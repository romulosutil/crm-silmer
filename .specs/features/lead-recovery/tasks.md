# Recuperação de leads — plano de entrega

[Spec REC-01–12](spec.md),
[RFC 063](../../../docs/rfc/063-recuperacao-de-leads-sem-retorno-no-n8n.md),
[ADR 085](../../../docs/adr/085-recuperacao-de-leads-por-modo-de-atendimento.md).
Uma entrega atômica, commit e push por tarefa; implementação e ativação não
estão incluídas na decisão documental.

## REC-T00 — decisão e proposta rastreável

- [x] Registrar n8n dedicado, sugestão no atendimento humano e envio apenas
      no modo agente, conforme escolha expressa do PO em 11/11/2026.
- [x] Confirmar no código a aba derivada, o corte de 72 horas, lembrete
      pessoal e a reserva atual dependente de inbound.
- [x] Preparar RFC, ADR, requisitos, plano e referências canônicas.
- [x] Validar documentação, concluir commit/push e abrir PR da entrega.

Verificação documental: referências locais dos quatro documentos novos,
formatação Prettier, revisão especializada sem findings bloqueantes e
`git diff --cached --check`. Não foram executadas suítes de runtime nesta
entrega exclusivamente documental. Commit e PR constam no handoff.

## REC-T01 — contrato, elegibilidade e ledger

REC-01–06, 09–12. Backend/Dados + Integrações + QA.

- [ ] Fechar endpoints/capacidade, identidade do ciclo sem inbound, política
      de lembrete, expediente, lote histórico, quota e paginação limitada.
- [ ] Implementar no monólito a elegibilidade equivalente à Inbox, sem
      persistir cópia do status e sem depender da sessão de um vendedor.
- [ ] Implementar ledger cifrado, revisão de contexto, preparação idempotente,
      sugestão e reserva de efeito por ciclo, com migration expand quando necessária.
- [ ] Integrar o transporte/recibos existentes com fonte de recuperação
      explícita; não consumir/reabrir turno inbound, alterar posse ou inventar
      mensagem do cliente. Preservar modo e autoria reais.
- [ ] Testar 72h exatas, modo humano/agente, duas reservas concorrentes,
      replay, nova inbound, nova saída humana, handoff/takeover, fechamento,
      perda, adiamento, troca de dono e resultado incerto com PostgreSQL sintético.
- [ ] Atualizar documentação HTTP/runbook, executar gates, commit e push.

## REC-T02 — sugestão no atendimento humano

REC-03, 06–08, 11. Frontend/A11y + Backend/Dados + QA.

- [ ] Expor sugestão interna autorizada, revisão, descarte e uso consciente
      no compositor humano, preservando tokens, layout e a autoria de quem envia.
- [ ] Invalidar resposta tardia após troca de conversa/contexto/posse e
      revogação; não preencher rascunho existente sem ação humana explícita.
- [ ] Testar isolamento entre usuários, teclado, foco, obsolescência, erro,
      conflito e preservação do rascunho; gates, commit e push.

## REC-T03 — workflow n8n e conteúdo

REC-01, 03–06, 08–12. Integrações + Backend/Dados + QA.

- [ ] Gerar workflow separado e inativo conforme os nós da RFC, com endpoints
      efetivamente implementados em T01, sem placeholders de efeito operacional.
- [ ] Proposta inicial: poll a cada cinco minutos em São Paulo; API controla
      expediente, uma tentativa por ciclo, cutoff e allowlist de piloto privada.
- [ ] Confirmar versão publicada e aprendizados aprovados; revisar conversas
      recentes sem transcrição ou PII em Git e sem inferir novas regras comerciais.
- [ ] Testar com fixtures sintéticas: modo humano só salva sugestão; modo
      agente envia apenas com reserva fresca; conflito/erro/unknown não enviam de novo.
- [ ] Comparar nós, credenciais e contrato de transporte; runbook com retenção
      de execução, desligamento e reconciliação; gates, commit e push.

## REC-T04 — ativação e avaliação do piloto

REC-09–12. Tech Lead + DevOps/Release + QA/Privacidade.

- [ ] Implantar API/migration/UI compatíveis e importar workflow inativo;
      validar capacidade, identidade da linha, cifragem e retenção de execução.
- [ ] Executar canário sintético nos dois modos e comprovar que a sugestão
      humana não cria mensagem outbound nem muda dono/modo.
- [ ] Definir privadamente corte, tamanho/allowlist e destinos do piloto;
      revisar o lote antigo separadamente e apresentar textos para liberação.
- [ ] Habilitar flag/workflow somente após revisão do resultado concreto;
      observar entrega, respostas e falhas sem replay de cliente.
- [ ] Registrar evidência sem PII; separar recuperação observada de
      causalidade/conversão, confirmar desligamento e ausência de duplicidade.

T01–T04 estão pendentes. Esta entrega não implementa nem publica automação.

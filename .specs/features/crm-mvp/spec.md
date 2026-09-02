# CRM Silmer MVP — Requisitos Rastreáveis

## Problema

As conversas comerciais chegam por canais de mensagem, mas nem toda conversa é uma oportunidade. A Silmer precisa separar backlog de leads, apoiar a qualificação sem perder controle humano e transformar o resultado em uma Ficha de Pedido válida para produção e cobrança.

## Objetivos

- Conduzir o caminho feliz do WhatsApp oficial até a Ficha de Pedido.
- Usar o Vendedor Silmer para conversar e sugerir ações, sem alterar o estado oficial do CRM no MVP.
- Manter rastreabilidade, reversão humana e reconciliação de falhas.
- Medir as vendas originadas no CRM.

## P1 — MVP

### P1.1 Caixa de Entrada e conversão

**User story:** Como Atendimento, quero triar conversas antes de transformá-las em lead para que o Kanban contenha somente oportunidades comerciais.

**Critérios de aceite:**

1. **INB-01:** WHEN uma mensagem válida chega pela API oficial THEN o sistema SHALL criar ou atualizar uma conversa no backlog sem criar automaticamente um lead apenas pela chegada.
2. **INB-02:** WHEN uma pessoa aciona `Transformar em lead` THEN o sistema SHALL criar ou vincular o Contato e criar exatamente um Negócio no Kanban.
3. **INB-03:** WHEN o Vendedor Silmer identifica intenção comercial THEN o sistema SHALL sugerir a conversão e aguardar confirmação humana, sem criar Contato, Lead ou Card.
4. **INB-04:** WHEN a mesma conversão humana é repetida THEN o sistema SHALL retornar o resultado existente sem duplicar Contato, Lead ou Card.

**Teste independente:** receber uma conversa, mantê-la no backlog, obter uma sugestão do agente e convertê-la uma única vez por ação humana.

### P1.2 Atendimento assistido pelo Vendedor Silmer

**User story:** Como operação, quero que o Vendedor Silmer converse, colete informações e sugira o próximo passo para reduzir trabalho manual mantendo as decisões oficiais sob controle humano.

**Critérios de aceite:**

1. **AGT-01:** WHEN existe uma conversa ou lead ativo THEN o agente SHALL consultar o histórico e os campos já respondidos antes de perguntar.
2. **AGT-02:** WHEN os campos obrigatórios da etapa estão válidos THEN o agente SHALL sugerir a próxima etapa sem mover o card.
3. **AGT-03:** WHEN o cliente pede um vendedor da Silmer THEN o agente SHALL interromper sua atuação e transferir com resumo e responsável.
4. **AGT-04:** WHEN o cliente insiste em valor antes de existir orçamento humano aprovado THEN o agente SHALL transferir sem calcular, negociar ou inventar valor.
5. **AGT-05:** WHEN o agente encontra bloqueio não resolvível THEN ele SHALL registrar o motivo e transferir sem descartar o contexto.
6. **AGT-06:** WHEN o agente envia mensagem, sugere ação ou transfere atendimento THEN um usuário autorizado SHALL conseguir auditar o evento.
7. **AGT-07:** WHEN todos os campos obrigatórios aplicáveis da etapa estão `preenchido` ou `nao_aplicavel` com motivo THEN o sistema SHALL permitir que uma pessoa registre o gate e avance exatamente uma etapa conforme `CAMPOS-FICHA-E-JORNADA-P0-1.md`.
8. **AGT-08:** WHEN um campo obrigatório está `pendente` ou `divergente`, ou uma correção invalida etapa anterior, THEN o sistema SHALL impedir avanço ou exigir retorno à primeira etapa incompleta sem apagar o histórico.

**Teste independente:** conduzir um lead simulado por todas as etapas, confirmar humanamente cada mudança e repetir com os três cenários de handoff.

### P1.3 Ficha de Pedido

**User story:** Como Vendedor, quero gerar a Ficha com dados já coletados para encaminhar um pedido sem redigitação.

**Critérios de aceite:**

1. **ORD-01:** WHEN um pedido está pronto THEN o sistema SHALL validar todos os campos obrigatórios derivados da Ficha.
2. **ORD-02:** WHEN um usuário autorizado aprova a primeira Ficha THEN o sistema SHALL reservar `01-CRM`; as seguintes SHALL usar a sequência `02-CRM`, `03-CRM` e assim por diante, sem depender de numeração legada.
3. **ORD-03:** WHEN o envio é confirmado THEN o sistema SHALL enviar para Rose
   usando o telefone resolvido por `secret://crm/order-recipient-phone`, sem
   versionar o dado pessoal, e guardar o estado e identificador do envio.
4. **ORD-04:** WHEN o envio falha THEN o sistema SHALL preservar a Ficha aprovada e oferecer retry auditável sem gerar novo pedido.
5. **ORD-05:** WHEN a Ficha é gerada THEN o sistema SHALL preencher todos os campos comerciais aplicáveis do inventário aprovado, calcular o total pela grade, registrar versão, autor e horário e manter vazios os campos posteriores de produção.

**Teste independente:** gerar a Ficha `01-CRM`, revisar, enviar e repetir o envio sem duplicar pedido ou consumir outro número.

### P1.4 Confiabilidade e canais

**User story:** Como Atendimento, quero saber quais mensagens foram processadas ou ficaram pendentes para que uma falha de integração não fique invisível.

**Critérios de aceite:**

1. **MSG-01:** WHEN um webhook é recebido mais de uma vez THEN o sistema SHALL processá-lo idempotentemente, sem duplicar mídia, validação ou handoff operacional.
2. **MSG-02:** WHEN o processamento falha ou a mídia temporária fica indisponível THEN o sistema SHALL colocar o evento em pendência visível com motivo e opção de retomada quando ainda possível.
3. **MSG-03:** WHEN o canal ou o volume temporário fica indisponível THEN o sistema SHALL exibir o estado e o último evento recebido sem afirmar que mensagens ou bytes não observados foram recuperados.
4. **MSG-04:** WHEN o piloto é iniciado THEN o WhatsApp oficial SHALL estar operacional; o Instagram Direct SHALL fazer parte do piloto quando disponível, mas sua indisponibilidade não poderá bloquear ou adiar o lançamento pelo WhatsApp.

**Teste independente:** repetir webhooks com mídia, induzir falha e perda da
cópia temporária, concluir o reprocessamento possível e comprovar que não há
duplicidade nem alegação falsa de recuperação e que a indisponibilidade do
Instagram não interrompe o WhatsApp.

### P1.5 Financeiro comercial

**User story:** Como gestor, quero saber quanto o CRM vendeu para acompanhar o resultado comercial.

**Critérios de aceite:**

1. **FIN-01:** WHEN uma venda é fechada THEN o sistema SHALL registrar valor vendido, data e vendedor.
2. **FIN-02:** WHEN o gestor seleciona um período THEN o sistema SHALL exibir total vendido, quantidade de vendas e ticket médio.
3. **FIN-03:** WHEN uma venda é cancelada THEN o sistema SHALL preservar histórico e removê-la dos totais ativos conforme regra aprovada.

**Teste independente:** fechar, cancelar e consultar vendas em um período conhecido; valores recebidos e saldo a receber não integram o cálculo do MVP.

### P1.6 Privacidade e acesso

**User story:** Como responsável pelo negócio, quero acesso controlado e tratamento previsível dos dados pessoais para operar o piloto com segurança.

**Critérios de aceite:**

1. **PRV-01:** WHEN um usuário acessa ou altera dados THEN o sistema SHALL aplicar as permissões de Atendimento/Vendedor ou Admin definidas no P0.7.
2. **PRV-02:** WHEN dados pessoais são alterados, exportados, anonimizados ou excluídos THEN o sistema SHALL registrar a operação conforme a política aprovada no P0.6.
3. **PRV-03:** WHEN o prazo de retenção é alcançado THEN o sistema SHALL aplicar a regra aprovada de descarte ou anonimização e permitir a execução pelo administrador técnico designado; para mídia transitória, o prazo SHALL ser o menor entre o encerramento da jornada e sete dias do recebimento ou envio.

**Responsável de privacidade:** Rômulo Sutil Corrêa. A política do piloto foi aprovada após consulta jurídica.

**Teste independente:** validar acesso por função e executar o procedimento de
retenção em dados de teste com relógio controlado, cobrindo encerramento antes
de sete dias, teto de sete dias e documento comercial excluído da purga curta.

### P1.7 PIX e boas-vindas

**User story:** Como cliente com venda aprovada, quero receber instruções PIX e uma confirmação clara do pedido para saber o que fazer e o que esperar.

**Critérios de aceite:**

1. **PAY-01:** WHEN uma pessoa autorizada registra a venda como aprovada THEN o sistema SHALL criar uma única cobrança com o valor final do orçamento humano aprovado e enviar a chave PIX configurada.
2. **PAY-02:** WHEN a instrução PIX é enviada THEN o sistema SHALL guardar chave mascarada, horário, identificador da mensagem e estado do envio sem duplicar a cobrança em retries.
3. **PAY-03:** WHEN um comprovante é recebido THEN o sistema SHALL anexá-lo ao negócio e solicitar conferência humana sem marcar o pagamento como confirmado.
4. **PAY-04:** WHEN uma pessoa autorizada confirma o pagamento THEN o sistema SHALL registrar autor e horário e liberar a geração da Ficha.
5. **PAY-05:** WHEN a Ficha é gerada THEN o sistema SHALL enviar boas-vindas com número do pedido, resumo, data confirmada, modalidade logística e contato de suporte de forma idempotente.

**Teste independente:** aprovar uma venda, enviar PIX, receber comprovante, confirmar manualmente e repetir os eventos sem duplicar cobrança, pedido ou boas-vindas.

## P2 — Depois do piloto

- Chave `vendedor_silmer_autonomia_comercial`, desabilitada por padrão, para permitir que o agente converta conversas, atualize campos e mova cards apenas após especificação, testes, auditoria e rollback próprios.
- Canal próprio de atendimento do site; no MVP, o site apenas direciona para o WhatsApp.
- Automação periférica com n8n quando houver benefício comprovado.
- Precificação automática baseada em política comercial futura; no MVP, o agente só comunica orçamento aprovado por uma pessoa.
- Valores recebidos e saldo a receber.

## Fora do escopo

- ERP contábil/fiscal.
- Estoque.
- Gestão completa da produção.
- App nativo.
- Pós-venda automatizado.

## Rastreabilidade

| Grupo              | IDs             | Status                            |
| ------------------ | --------------- | --------------------------------- |
| Inbox e conversão  | INB-01 a INB-04 | Pronto para especificação técnica |
| Agente assistivo   | AGT-01 a AGT-08 | Pronto para especificação técnica |
| Pedido             | ORD-01 a ORD-05 | Pronto para especificação técnica |
| Mensagens e canais | MSG-01 a MSG-04 | Pronto para especificação técnica |
| Financeiro         | FIN-01 a FIN-03 | Pronto para especificação técnica |
| Privacidade        | PRV-01 a PRV-03 | Pronto para especificação técnica |
| PIX e boas-vindas  | PAY-01 a PAY-05 | Pronto para especificação técnica |

**Cobertura:** 32 requisitos de MVP; 32 mapeados; nenhuma decisão de produto P0 aberta. Essa cobertura não representa aprovação humana dos gates operacionais. A decomposição em tarefas pertence ao Tech Lead.

## Critério de passagem

**GO de produto.** P0.1 a P0.7 estão resolvidos e rastreados em `PRODUCT-READINESS-TECH-LEAD.md`. O Tech Lead possui o caminho completo para produzir desenho técnico, tarefas e estimativas sem depender de nova decisão de produto. Esse GO não é um GO operacional e não libera fases sujeitas a gates humanos.

Em 02/09/2026, a T00.6 foi aprovada na issue `#10` e deixou de bloquear T02, T03 e T05.

A fonte humana está versionada em `docs/phase0/T00.6-APPROVAL-EVIDENCE.md`;
`docs/phase0/PHASE-0-APPROVAL-GATE.md` descreve o gate aprovado e
`docs/phase0/domain-decisions.json` é o espelho executável fail-closed. Os
papéis usam `silmer:romulo.sutil`, com MFA confirmado e exceção de operação
solo limitada ao piloto interno.

Essa aprovação remove apenas o bloqueio da T00.6; os demais gates técnicos,
externos e operacionais continuam independentes.

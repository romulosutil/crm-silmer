# CRM Silmer MVP — Requisitos Rastreáveis

## Problema

As conversas comerciais chegam por canais de mensagem, mas nem toda conversa é uma oportunidade. A Silmer precisa separar backlog de leads, automatizar a qualificação sem perder controle humano e transformar o resultado em uma Ficha de Pedido válida para produção e cobrança.

## Objetivos

- Conduzir o caminho feliz do WhatsApp até a Ficha com o Vendedor Silmer.
- Manter rastreabilidade, reversão humana e reconciliação de falhas.
- Medir as vendas originadas no CRM.

## P1 — MVP

### P1.1 Caixa de Entrada e conversão

**User story:** Como Atendimento, quero triar conversas antes de transformá-las em lead para que o Kanban contenha somente oportunidades comerciais.

**Critérios de aceite:**

1. **INB-01:** WHEN uma mensagem válida chega pela API oficial THEN o sistema SHALL criar ou atualizar uma conversa no backlog sem criar automaticamente um lead apenas pela chegada.
2. **INB-02:** WHEN uma pessoa aciona `Transformar em lead` THEN o sistema SHALL criar ou vincular o Contato e criar exatamente um Negócio no Kanban.
3. **INB-03:** WHEN o Vendedor Silmer identifica intenção comercial THEN o sistema SHALL permitir que ele execute a mesma conversão por ferramenta autorizada.
4. **INB-04:** WHEN a mesma conversão é repetida THEN o sistema SHALL retornar o resultado existente sem duplicar Contato, Lead ou Card.

**Teste independente:** receber uma conversa, mantê-la no backlog e convertê-la uma única vez por ação humana e por agente.

### P1.2 Qualificação autônoma

**User story:** Como operação, quero que o Vendedor Silmer complete e avance a jornada para reduzir trabalho manual sem perder controle.

**Critérios de aceite:**

1. **AGT-01:** WHEN existe um lead ativo THEN o agente SHALL consultar campos já respondidos antes de perguntar.
2. **AGT-02:** WHEN os campos obrigatórios da etapa estão válidos THEN o agente SHALL registrar a decisão e avançar o card.
3. **AGT-03:** WHEN o cliente pede um vendedor THEN o agente SHALL interromper sua atuação e transferir com resumo e responsável.
4. **AGT-04:** WHEN o cliente insiste em valor antes da conclusão necessária THEN o agente SHALL transferir sem inventar valor.
5. **AGT-05:** WHEN o agente encontra bloqueio não resolvível THEN ele SHALL registrar motivo e transferir sem descartar o contexto.
6. **AGT-06:** WHEN uma ação automática ocorre THEN um usuário autorizado SHALL conseguir auditar e reverter a ação.
7. **AGT-07:** WHEN todos os campos obrigatórios aplicáveis da etapa estão `preenchido` ou `nao_aplicavel` com motivo THEN o sistema SHALL registrar o gate e avançar exatamente uma etapa conforme `CAMPOS-FICHA-E-JORNADA-P0-1.md`.
8. **AGT-08:** WHEN um campo obrigatório está `pendente` ou `divergente`, ou uma correção invalida etapa anterior, THEN o sistema SHALL impedir avanço ou retornar à primeira etapa incompleta sem apagar o histórico.

**Teste independente:** conduzir um lead simulado por todas as etapas e repetir com os três cenários de handoff.

### P1.3 Ficha de Pedido

**User story:** Como Vendedor, quero gerar a Ficha com dados já coletados para encaminhar um pedido sem redigitação.

**Critérios de aceite:**

1. **ORD-01:** WHEN um pedido está pronto THEN o sistema SHALL validar todos os campos obrigatórios derivados da Ficha.
2. **ORD-02:** WHEN um usuário autorizado aprova a Ficha THEN o sistema SHALL reservar número único, gerar documento versionado e registrar autor e horário.
3. **ORD-03:** WHEN o envio é confirmado THEN o sistema SHALL enviar para Rose em `+55 27 99901-0303` e guardar o estado e identificador do envio.
4. **ORD-04:** WHEN o envio falha THEN o sistema SHALL preservar a Ficha aprovada e oferecer retry auditável sem gerar novo pedido.
5. **ORD-05:** WHEN a Ficha é gerada THEN o sistema SHALL preencher todos os campos comerciais aplicáveis do inventário aprovado, calcular o total pela grade e manter vazios os campos posteriores de produção.

**Teste independente:** gerar, revisar, enviar e repetir o envio de uma Ficha de teste sem duplicar pedido.

### P1.4 Confiabilidade e canal

**User story:** Como Atendimento, quero saber quais mensagens foram processadas ou ficaram pendentes para que uma falha de integração não fique invisível.

**Critérios de aceite:**

1. **MSG-01:** WHEN um webhook é recebido mais de uma vez THEN o sistema SHALL processá-lo idempotentemente.
2. **MSG-02:** WHEN o processamento falha THEN o sistema SHALL colocar o evento em pendência visível com motivo e opção de retomada.
3. **MSG-03:** WHEN o canal fica indisponível THEN o sistema SHALL exibir o estado e o último evento recebido sem afirmar que mensagens não observadas foram recuperadas.

**Teste independente:** repetir webhooks, induzir falha e concluir o reprocessamento pela fila.

### P1.5 Financeiro comercial

**User story:** Como gestor, quero saber quanto o CRM vendeu para acompanhar o resultado comercial.

**Critérios de aceite:**

1. **FIN-01:** WHEN uma venda é fechada THEN o sistema SHALL registrar valor, data e vendedor.
2. **FIN-02:** WHEN o gestor seleciona um período THEN o sistema SHALL exibir total vendido, quantidade de vendas e ticket médio.
3. **FIN-03:** WHEN uma venda é cancelada THEN o sistema SHALL preservar histórico e removê-la dos totais ativos conforme regra aprovada.

**Teste independente:** fechar, cancelar e consultar vendas em um período conhecido.

### P1.6 Privacidade e acesso

**User story:** Como responsável pelo negócio, quero acesso controlado e tratamento previsível dos dados pessoais para operar o piloto com segurança.

**Critérios de aceite:**

1. **PRV-01:** WHEN um usuário acessa dados THEN o sistema SHALL aplicar permissões de sua função.
2. **PRV-02:** WHEN dados pessoais são alterados ou excluídos THEN o sistema SHALL registrar a operação conforme política aprovada.
3. **PRV-03:** WHEN o prazo de retenção é alcançado THEN o sistema SHALL aplicar a regra aprovada de descarte ou anonimização.

**Teste independente:** validar acesso por função e executar o procedimento de retenção em dados de teste.

### P1.7 PIX e boas-vindas

**User story:** Como cliente com venda aprovada, quero receber instruções PIX e
uma confirmação clara do pedido para saber o que fazer e o que esperar.

**Critérios de aceite:**

1. **PAY-01:** WHEN uma pessoa autorizada registra a venda como aprovada THEN o sistema SHALL criar uma única cobrança com o valor final e enviar a chave PIX configurada.
2. **PAY-02:** WHEN a instrução PIX é enviada THEN o sistema SHALL guardar chave mascarada, horário, identificador da mensagem e estado do envio sem duplicar a cobrança em retries.
3. **PAY-03:** WHEN um comprovante é recebido THEN o sistema SHALL anexá-lo ao negócio e solicitar conferência humana sem marcar o pagamento como confirmado.
4. **PAY-04:** WHEN uma pessoa autorizada confirma o pagamento THEN o sistema SHALL registrar autor e horário e liberar a geração da Ficha.
5. **PAY-05:** WHEN a Ficha é gerada THEN o sistema SHALL enviar boas-vindas com número do pedido, resumo, data confirmada, modalidade logística e contato de suporte de forma idempotente.

**Teste independente:** aprovar uma venda, enviar PIX, receber comprovante,
confirmar manualmente e repetir os eventos sem duplicar cobrança, pedido ou
boas-vindas.

## P2 — Depois do piloto

- Integração com Instagram.
- Canal próprio de atendimento do site.
- Automação periférica com n8n quando houver benefício comprovado.
- Precificação automática baseada em política comercial aprovada.
- Valores recebidos e saldo a receber, caso não entrem no P1.

## Fora do escopo

- ERP contábil/fiscal.
- Estoque.
- Gestão completa da produção.
- App nativo.
- Pós-venda automatizado.

## Rastreabilidade

| Grupo | IDs | Status |
|---|---|---|
| Inbox e conversão | INB-01 a INB-04 | Pronto para design |
| Agente | AGT-01 a AGT-08 | Jornada pronta para design; bloqueada parcialmente por preço |
| Pedido | ORD-01 a ORD-05 | Campos prontos; bloqueado parcialmente por numeração/permissões |
| Mensagens | MSG-01 a MSG-03 | Pronto para design |
| Financeiro | FIN-01 a FIN-03 | Bloqueado parcialmente pelo limite vendido × recebido |
| Privacidade | PRV-01 a PRV-03 | Bloqueado por políticas concretas |
| PIX e boas-vindas | PAY-01 a PAY-05 | Caminho inicial pronto para design; relatórios dependem do P0.3 |

**Cobertura:** 31 requisitos; 31 mapeados ao MVP; tarefas ainda não criadas.

## Critério de passagem

O design técnico da jornada pode começar com o P0.1 resolvido. A aprovação
final do design e a criação de tarefas de implementação dependem da resolução
dos P0.2–P0.7 listados em `PRODUCT-READINESS-TECH-LEAD.md`.

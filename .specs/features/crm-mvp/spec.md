# CRM Silmer MVP — Requisitos Rastreáveis

## Problema

As conversas comerciais chegam por canais de mensagem, mas nem toda conversa é uma oportunidade. A Silmer precisa organizar atendimento e pedidos pendentes, automatizar a qualificação sem perder a autoridade do domínio e transformar o resultado em uma Ficha de Pedido válida para produção e operação.

## Objetivos

- Conduzir o caminho feliz do WhatsApp oficial até a Ficha de Pedido; adicionar
  Instagram em uma fase posterior sobre o mesmo domínio.
- Disparar automaticamente o n8n a cada mensagem recebida, sem botão na UI.
- Usar o Vendedor Silmer no n8n para conversar, coletar dados, criar ou completar pedido pendente e transferir para uma pessoa quando necessário.
- Manter o CRM como fonte da verdade, com APIs autorizadas, rastreabilidade, tomada humana e reconciliação de falhas.
- Medir as vendas originadas no CRM.

## Baseline vigente — 05/10/2026

ADRs 004, 006 e 020 supersedem funil linear e gates antigos de Ficha. OpenAI é a baseline da [ADR 021](../../../docs/adr/021-adotar-openai-no-mvp.md); deploy automático permanece conforme [ADR 022](../../../docs/adr/022-manter-deploy-automatico-github-easypanel.md). IDs preservados não comprovam homologação; estados de entrega estão na rastreabilidade.

## P1 — MVP

### P1.0 n8n como motor obrigatório

**User story:** Como operação, quero que toda mensagem recebida inicie automaticamente a jornada no n8n para que canais, IA e etapas comerciais funcionem sem depender de um botão na interface.

**Critérios de aceite:**

1. **ORC-01:** WHEN uma mensagem recebida é validada pelo canal THEN ela SHALL disparar automaticamente o n8n, sem ação da UI.
2. **ORC-02:** WHEN o n8n recebe ou envia uma mensagem pelo WhatsApp oficial
   THEN ele SHALL normalizar o evento e registrar seu resultado no CRM por
   contrato versionado; o adapter futuro do Instagram SHALL reutilizar esse
   contrato sem criar outro domínio.
3. **ORC-03:** WHEN o Vendedor Silmer atualiza briefing, cria ou completa Pedido pendente ou solicita handoff THEN o n8n SHALL usar API autenticada, autorizada, idempotente e auditável do CRM e nunca acessar diretamente o banco.
4. **ORC-04:** WHEN um workflow executa THEN o CRM SHALL correlacionar `workflow_key`, versão publicada, `execution_id`, mensagem, `automation_epoch` e resultado sem armazenar segredo.
5. **ORC-05:** WHEN eventos são repetidos, concorrentes ou chegam fora de ordem THEN CRM e n8n SHALL produzir no máximo um efeito oficial e expor divergências para reconciliação.
6. **ORC-06:** WHEN o workflow chama OpenAI, provedor escolhido para produção, THEN ele SHALL preservar o schema estruturado, segurança, privacidade e avaliação; um provedor alternativo exige nova decisão e homologação.
7. **ORC-07:** WHEN uma pessoa assume a conversa ou a automação é desligada THEN o CRM SHALL incrementar o `automation_epoch` e rejeitar comandos e envios de execuções antigas.
8. **ORC-08:** WHEN n8n, canal ou provedor de IA fica indisponível ou retorna resultado incerto THEN o sistema SHALL tornar a pendência visível e retomável, sem avançar silenciosamente a jornada.
9. **ORC-09:** WHEN a fase posterior CANAL-2 executa migração de canal THEN o sistema SHALL associar @instagram e telefone ao mesmo Contato somente após correlação verificável e auditável, preservando os históricos.

O contrato executável de ORC-01–08 é a OpenAPI v1: três endpoints n8n→CRM,
Basic Auth como `AUTOMATION_EXECUTOR`, idempotência com hash e o fence de uso
único `message.send.requested`, validado por `automation_epoch` e
`source_revision`. Resultado desconhecido exige reconciliação e nunca retry
cego à Meta. Não há claim, lease ou token de rodada no MVP simples.

**Teste independente:** receber uma mensagem realista, comprovar o disparo automático do n8n, executar a jornada com OpenAI, repetir eventos e assumir a conversa durante uma execução sem duplicar ou aplicar efeito atrasado.

### P1.1 Caixa de Entrada e conversão

**User story:** Como Vendedor, quero observar conversas e os pedidos pendentes correspondentes para assumir o atendimento quando necessário.

**Critérios de aceite:**

1. **INB-01:** WHEN uma mensagem válida chega THEN o sistema SHALL resolver Contato e Conversa na Caixa de Entrada sem confirmar uma venda automaticamente.
2. **INB-02:** WHEN o agente recebe dados da ficha que indicam pedido THEN o n8n SHALL solicitar criação ou atualização de um único Pedido pendente por conversa, conforme ADRs 006 e 014.
3. **INB-03:** WHEN o atendimento não representa oportunidade THEN o sistema SHALL permitir encerramento auditável da Conversa sem exigir Pedido.
4. **INB-04:** WHEN criação automática ou manual é repetida THEN o sistema SHALL retornar o pendente existente sem duplicar Contato ou Pedido.

Para INB-01–04, Cliente é Contact + ContactIdentity; Pedido é rascunho até confirmação humana. Kanban e Negócio estão aposentados pela ADR 004, com Pedido vigente pela ADR 006.

**Teste independente:** receber duas conversas, completar dados da ficha na comercial e repetir eventos sem duplicar Contato, Conversa ou Pedido pendente.

### P1.2 Atendimento assistido pelo Vendedor Silmer

**User story:** Como operação, quero que o Vendedor Silmer converse, colete informações e conduza automaticamente os passos permitidos, preservando os gates humanos explícitos.

**Critérios de aceite:**

1. **AGT-01:** WHEN existe conversa ativa THEN o agente SHALL consultar histórico e campos já respondidos antes de perguntar.
2. **AGT-02:** WHEN o cliente informa dados em qualquer ordem THEN o agente SHALL validar e persistir respostas inequívocas e perguntar pelo próximo dado faltante, sem exigir avanço linear.
3. **AGT-03:** WHEN o cliente pede uma pessoa da Silmer THEN o agente SHALL interromper sua atuação e criar handoff com resumo, motivo e papel-alvo, inicialmente sem responsável.
4. **AGT-04:** WHEN o cliente insiste em valor antes de existir orçamento humano aprovado THEN o agente SHALL transferir sem calcular, negociar ou inventar valor.
5. **AGT-05:** WHEN o agente encontra bloqueio não resolvível THEN ele SHALL registrar o motivo e transferir sem descartar o contexto.
6. **AGT-06:** WHEN o agente envia mensagem, decide, altera estado ou transfere atendimento THEN um usuário autorizado SHALL conseguir auditar o evento e sua correlação com a execução do n8n.
7. **AGT-07:** WHEN todos os campos obrigatórios atuais da ficha estão válidos THEN o sistema SHALL permitir que dono da conversa ou administrador gere o Pedido; o agente SHALL preservar essa confirmação humana.
8. **AGT-08:** WHEN um campo obrigatório está ausente ou divergente THEN o sistema SHALL impedir geração, indicar pendências e permitir salvar rascunho sem apagar dados e histórico.

O contexto do agente vem de `recent_messages` e do snapshot de briefing da
Conversa; não existe memória comercial paralela no n8n. `briefing_patch` ignora
nulos, aceita somente campos de qualificação e altera apenas esse snapshot até sua projeção autorizada no Pedido pendente; o agente não sobrescreve escolhas humanas.

**Teste independente:** coletar dados fora de ordem, preencher pedido pendente, preservar preço, condição e confirmação humana e repetir com os três cenários de handoff.

### P1.3 Ficha de Pedido

**User story:** Como Vendedor, quero gerar a Ficha com dados já coletados para encaminhar um pedido sem redigitação.

**Critérios de aceite:**

1. **ORD-01:** WHEN uma pessoa solicita gerar Pedido THEN o sistema SHALL validar os campos obrigatórios de PFI e TEC-01..08 em Pedidos MVP.
2. **ORD-02:** WHEN o primeiro Pedido é criado THEN o sistema SHALL reservar 01-CRM; seguintes SHALL usar sequência global NN-CRM; confirmar e reabrir SHALL preservar esse número (ADR 006).
3. **ORD-03:** WHEN o encaminhamento operacional da Ficha é homologado THEN ele SHALL alcançar Rose e registrar evidência de entrega; eventual envio automático é evolução própria, com telefone em secret://crm/order-recipient-phone e sem PII versionada.
4. **ORD-04:** WHEN o encaminhamento da Ficha falha THEN a operação SHALL preservar o Pedido confirmado e registrar retomada sem criar outro Pedido; automação desse efeito depende do contrato de ORD-03.
5. **ORD-05:** WHEN Pedido é gerado THEN o sistema SHALL registrar pessoa e horário, fixar nome do cliente, calcular peças pela grade e liberar impressão v5, deixando produção vazia; assinatura física de Rose e Operação SHALL preceder produção.

**Teste independente:** criar Pedido `01-CRM`, completar, gerar por pessoa autorizada, imprimir e reabrir sem duplicar Pedido ou consumir outro número; homologar encaminhamento a Rose separadamente.

### P1.4 Confiabilidade e canais

**User story:** Como Vendedor, quero saber quais mensagens foram processadas ou ficaram pendentes para que uma falha de integração não fique invisível.

**Critérios de aceite:**

1. **MSG-01:** WHEN um webhook é recebido mais de uma vez THEN o sistema SHALL processá-lo idempotentemente, sem duplicar mídia, validação ou handoff operacional.
2. **MSG-02:** WHEN o processamento falha ou a mídia temporária fica indisponível THEN o sistema SHALL colocar o evento em pendência visível com motivo e opção de retomada quando ainda possível.
3. **MSG-03:** WHEN o canal ou o volume temporário fica indisponível THEN o sistema SHALL exibir o estado e o último evento recebido sem afirmar que mensagens ou bytes não observados foram recuperados.
4. **MSG-04:** WHEN o primeiro MVP operacional é iniciado THEN WhatsApp
   Business SHALL estar operacional no n8n; WHEN a fase `CANAL-2` é iniciada
   THEN Instagram Direct SHALL reutilizar a mesma jornada, inclusive correlação
   de identidade e handoff.

O domínio comum preserva fronteiras neutras de canal, mas o contrato desta
entrega aceita somente WhatsApp. Instagram é uma fase posterior e não bloqueia
a validação do primeiro MVP operacional.

**Teste independente:** repetir webhooks com mídia, induzir falha e perda da
cópia temporária, concluir o reprocessamento possível e comprovar que não há
duplicidade nem alegação falsa de recuperação e que a indisponibilidade do
um canal não corrompe o histórico do outro.

### P1.5 Financeiro comercial

**User story:** Como gestor, quero saber quanto o CRM vendeu para acompanhar o resultado comercial.

**Critérios de aceite:**

1. **FIN-01:** WHEN Pedido é confirmado THEN o sistema SHALL registrar valor, data e pessoa responsável e contabilizar a venda uma vez.
2. **FIN-02:** WHEN gestor consulta Dashboard THEN o sistema SHALL explicitar período e universo dos totais de confirmados, sem contar pendentes ou recebimentos.
3. **FIN-03:** WHEN Pedido é reaberto THEN o sistema SHALL preservar histórico e retirá-lo dos totais de confirmados; cancelamento/perda comercial permanecem fora do ciclo MVP (ADR 006).

**Teste independente:** confirmar, reabrir e consultar totais de pedidos em um universo conhecido; valores recebidos e saldo a receber não integram o cálculo do MVP.

### P1.6 Privacidade e acesso

**User story:** Como responsável pelo negócio, quero acesso controlado e tratamento previsível dos dados pessoais para operar o piloto com segurança.

**Critérios de aceite:**

1. **PRV-01:** WHEN uma pessoa ou o ator técnico do n8n acessa ou altera dados THEN o sistema SHALL aplicar as capacidades mínimas definidas no P0.7 e no contrato `AUTOMATION_EXECUTOR`, sem permitir autoatribuição ou acesso direto ao banco.
2. **PRV-02:** WHEN dados pessoais são alterados, exportados, anonimizados ou excluídos THEN o sistema SHALL registrar a operação conforme a política aprovada no P0.6.
3. **PRV-03:** WHEN o prazo de retenção é alcançado THEN o sistema SHALL aplicar a regra aprovada de descarte ou anonimização e permitir a execução pelo administrador técnico designado; para mídia transitória legada, o prazo SHALL ser o menor entre o encerramento da jornada e sete dias do recebimento ou envio. A nova mídia enviada do chat segue ADR 023 e MED-15: preservar até nova decisão de política, sem expurgo por sete dias ou encerramento; implementação pendente em INBOX-MEDIA-1.

**Responsável de privacidade:** Rômulo Sutil Corrêa. A política do piloto foi aprovada após consulta jurídica.

**Teste independente:** validar acesso por função e executar o procedimento de
retenção em dados de teste com relógio controlado, cobrindo encerramento antes
de sete dias, teto de sete dias e documento comercial excluído da purga curta.

### P2.1 PIX e boas-vindas — diferido

A ADR 006 retirou cobrança, comprovante e status de pagamento do MVP. PAY-01..05 são preservados como rastreabilidade da evolução; não descrevem capacidade entregue nem bloqueiam gerar o Pedido atual. Datas manuais da ADR 008 não implementam esse fluxo.

**User story:** Como cliente com venda aprovada, quero receber instruções PIX e uma confirmação clara do pedido para saber o que fazer e o que esperar.

**Critérios de aceite:**

1. **PAY-01:** WHEN uma pessoa autorizada registra a venda como aprovada THEN o sistema SHALL criar uma única cobrança com o valor final do orçamento humano aprovado e enviar a chave PIX configurada.
2. **PAY-02:** WHEN a instrução PIX é enviada THEN o sistema SHALL guardar chave mascarada, horário, identificador da mensagem e estado do envio sem duplicar a cobrança em retries.
3. **PAY-03:** WHEN um comprovante é recebido THEN o sistema SHALL anexá-lo ao pedido e solicitar conferência humana sem marcar o pagamento como confirmado.
4. **PAY-04:** WHEN uma pessoa autorizada confirma o pagamento THEN o sistema SHALL registrar autor e horário e liberar a geração da Ficha.
5. **PAY-05:** WHEN a Ficha é gerada THEN o sistema SHALL enviar boas-vindas com número do pedido, resumo, data confirmada, modalidade logística e contato de suporte de forma idempotente.

**Teste independente:** aprovar uma venda, enviar PIX, receber comprovante, confirmar manualmente e repetir os eventos sem duplicar cobrança, pedido ou boas-vindas.

## P2 — Depois do piloto

- Canal próprio de atendimento do site; no MVP, o site apenas direciona para o WhatsApp.
- Escala do n8n em queue mode e Redis somente quando medições justificarem a infraestrutura adicional.
- Precificação automática baseada em política comercial futura; no MVP, o agente só comunica orçamento aprovado por uma pessoa.
- Valores recebidos e saldo a receber.

## Fora do escopo

- ERP contábil/fiscal.
- Estoque.
- Gestão completa da produção.
- App nativo.
- Pós-venda automatizado.

## Rastreabilidade

| Grupo              | IDs             | Status                                                                            |
| ------------------ | --------------- | --------------------------------------------------------------------------------- |
| Orquestração n8n   | ORC-01 a ORC-09 | WhatsApp implementado; homologação pendente; ORC-09 em CANAL-2                    |
| Inbox e conversão  | INB-01 a INB-04 | Implementada no contrato n8n v1                                                   |
| Agente vendedor    | AGT-01 a AGT-08 | Implementado; publicação pendente                                                 |
| Pedido             | ORD-01 a ORD-05 | Pedido e impressão v5 implementados; encaminhamento e assinatura física pendentes |
| Mensagens e canais | MSG-01 a MSG-04 | WhatsApp: homologação pendente; Instagram em CANAL-2                              |
| Financeiro         | FIN-01 a FIN-03 | Confirmados e valor vendido implementados; UAT pendente                           |
| Privacidade        | PRV-01 a PRV-03 | Coberta no contrato; homologação pendente                                         |
| PIX e boas-vindas  | PAY-01 a PAY-05 | Diferidos pela ADR 006; datas manuais não implementam cobrança                    |

**Cobertura:** 41 IDs preservados, incluindo 5 PAY diferidos; implementação, homologação e aprovação externa têm estados distintos. Essa cobertura não representa aprovação humana dos gates operacionais. A decomposição em tarefas pertence ao Tech Lead.

## Critério de passagem

**GO de produto.** P0.1 a P0.7 estão resolvidos e rastreados em `PRODUCT-READINESS-TECH-LEAD.md`. O Tech Lead possui o caminho completo para produzir desenho técnico, tarefas e estimativas sem depender de nova decisão de produto. Esse GO não é um GO operacional e não libera fases sujeitas a gates humanos.

Em 02/09/2026, a T00.6 foi aprovada na issue `#10` e deixou de bloquear T02, T03 e T05.

A fonte humana está versionada em `docs/phase0/T00.6-APPROVAL-EVIDENCE.md`;
`docs/phase0/PHASE-0-APPROVAL-GATE.md` descreve o gate aprovado e
`docs/phase0/domain-decisions.json` é o espelho executável fail-closed. Os
papéis usam `silmer:romulo.sutil` e exceção de operação solo limitada ao piloto interno. Esse registro histórico não comprova controles de autenticação ou segregação do runtime atual.

Essa aprovação remove apenas o bloqueio da T00.6; os demais gates técnicos,
externos e operacionais continuam independentes.

# CRM Silmer MVP — Contexto de Produto

**Coletado em:** 29/08/2026  
**Atualizado em:** 06/09/2026 — n8n definido como motor obrigatório
**Spec:** `.specs/features/crm-mvp/spec.md`
**Status:** P0.1 a P0.7 resolvidos; pronto para especificação técnica e implementação

## Limite da feature

Entregar a jornada comercial desde a entrada de uma conversa no WhatsApp oficial até a geração, envio e registro comercial da Ficha de Pedido. Cada mensagem recebida dispara automaticamente o n8n, que executa o Vendedor Silmer e orquestra a jornada. O CRM continua sendo a fonte da verdade e a única fronteira autorizada para mutações oficiais.

O trabalho será conduzido como três objetivos divergentes — CRM, Inbox Multicanal e Agente Vendedor Silmer no n8n — que se conectam no teste integrado e no lançamento.

## Decisões confirmadas

### Backlog e lead

- Caixa de Entrada funciona como backlog.
- Conversa não cria lead automaticamente apenas por existir.
- A simples chegada de uma mensagem não cria lead.
- Quando identifica intenção comercial, o Vendedor Silmer solicita ao CRM a criação ou atualização idempotente do Contato e do Negócio.
- A interface pode oferecer conversão manual durante a tomada humana, mas esse botão não inicia nem substitui o workflow do n8n.

### Vendedor Silmer

- Lê o contexto autorizado, conversa, coleta dados e decide o próximo passo dentro dos gates do domínio.
- Converte conversa, atualiza campos oficiais e move o card por APIs autenticadas, autorizadas, idempotentes e auditáveis do CRM.
- Transfere quando o cliente pede vendedor, insiste em valores sem orçamento humano aprovado ou existe bloqueio real não resolvível.
- Pode comunicar um orçamento já aprovado por pessoa autorizada, sem calcular, negociar ou alterar preço.
- O n8n é o runtime obrigatório do agente e da orquestração comercial.
- OpenAI e Gemini são provedores intercambiáveis atrás do mesmo contrato; nenhum provedor pode contornar regras do CRM.
- Tomada humana incrementa o `automation_epoch`, invalida execuções antigas e impede que uma resposta atrasada retome a automação.

### Integrações

- WhatsApp Business e Instagram Direct usam APIs oficiais e são canais obrigatórios do MVP; a verificação do WhatsApp já foi obtida e a do Instagram continua como gate operacional.
- Webhooks e envios operacionais dos dois canais pertencem ao n8n; o CRM recebe eventos canônicos e comandos, não payloads usados como estado de domínio.
- Instagram Direct e WhatsApp Business disparam a mesma jornada no n8n.
- O atendimento pode migrar entre Instagram e WhatsApp preservando o mesmo Negócio. O CRM conecta `@instagram` e telefone ao lead somente por correlação verificável e auditável.
- No MVP, o site direciona o visitante para o WhatsApp.
- O destinatário da Ficha é Rose; o telefone é resolvido pela referência
  `secret://crm/order-recipient-phone` e não é versionado.

### Ficha, financeiro, privacidade e acesso

- A Ficha real orienta os campos, perguntas e etapas.
- O inventário e a jornada definitivos estão em `CAMPOS-FICHA-E-JORNADA-P0-1.md`.
- Backlog fica fora do Kanban; as colunas são Produto, Especificação, Estampa, Logística e Fechamento.
- Campo obrigatório `pendente` ou `divergente` bloqueia passagem; correção retorna à primeira etapa incompleta.
- O primeiro pedido é `01-CRM`, seguido por `02-CRM`, `03-CRM` e assim por diante, sem dependência de número legado.
- O caminho inicial de pagamento envia chave PIX, exige confirmação humana e então dispara Ficha e boas-vindas idempotentes.
- O MVP mede valor vendido, quantidade de vendas e ticket médio; recebido e saldo a receber ficam para P2.
- A política de privacidade do piloto foi aprovada após consulta jurídica. Rômulo Sutil Corrêa é o Responsável de Privacidade.
- Atendimento/Vendedor executa a operação comercial; Admin governa usuários, configurações, retenção e atos administrativos da Ficha.
- No piloto interno, `silmer:romulo.sutil` concentra Produto, Operação, Tech
  Lead, equipe de entrega, Privacidade e Administração Técnica com MFA. A
  exceção solo mantém capacidades ortogonais, autorização e execução em
  eventos distintos, auditoria obrigatória e revisão antes de piloto externo
  ou quando houver segundo operador.

## Discrição do Tech Lead

- Backend, banco e detalhes internos dos contratos, preservadas as fronteiras aprovadas.
- Estratégia de filas, retries, observabilidade, anexos e documentos.
- Escolha entre OpenAI e Gemini por ambiente ou política versionada, condicionada aos gates de privacidade.
- Formato interno dos contratos, desde que preserve as regras do produto.
- Revisão da exceção de operação solo antes do piloto externo ou quando houver
  um segundo operador disponível.

## Ideias adiadas

- Canal próprio de atendimento do site.
- Valores recebidos e saldo a receber.
- ERP financeiro completo, estoque, chão de fábrica e pós-venda.

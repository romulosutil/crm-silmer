# CRM Silmer MVP — Contexto de Produto

**Coletado em:** 29/08/2026
**Spec:** `.specs/features/crm-mvp/spec.md`
**Status:** P0.1 a P0.7 resolvidos; pronto para especificação técnica e implementação

## Limite da feature

Entregar a jornada comercial desde a entrada de uma conversa no WhatsApp oficial até a geração, envio e registro comercial da Ficha de Pedido. No MVP, o Vendedor Silmer conversa, coleta dados e sugere ações; apenas pessoas alteram o estado oficial do CRM.

## Decisões confirmadas

### Backlog e lead

- Caixa de Entrada funciona como backlog.
- Conversa não cria lead automaticamente apenas por existir.
- Pessoas possuem o botão `Transformar em lead`.
- No MVP, o Vendedor Silmer pode sugerir a conversão, mas não executá-la.

### Vendedor Silmer

- Lê o contexto, conversa, coleta dados e sugere o próximo passo.
- Não converte conversa, atualiza campo oficial nem move card no MVP.
- Transfere quando o cliente pede vendedor, insiste em valores sem orçamento humano aprovado ou existe bloqueio real não resolvível.
- Pode comunicar um orçamento já aprovado por pessoa autorizada, sem calcular, negociar ou alterar preço.
- O núcleo do agente pertence ao CRM; n8n é opcional.
- A autonomia comercial fica para o pós-MVP sob a chave `vendedor_silmer_autonomia_comercial`, desabilitada por padrão e sujeita a especificação, auditoria e rollback próprios.

### Integrações

- WhatsApp usa a API oficial e é o canal obrigatório para lançar o piloto; a verificação já foi obtida.
- Instagram Direct integra o piloto quando disponível, mas não bloqueia nem adia o lançamento pelo WhatsApp.
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

## Discrição do Tech Lead

- Backend, banco, hospedagem e runtime de IA.
- Estratégia de filas, retries, observabilidade, anexos e documentos.
- Uso eventual do n8n fora do caminho crítico.
- Formato interno dos contratos, desde que preserve as regras do produto.
- Designação do administrador técnico executor da política de privacidade antes do piloto.

## Ideias adiadas

- Ativação da autonomia comercial do Vendedor Silmer pela chave pós-MVP.
- Canal próprio de atendimento do site.
- Valores recebidos e saldo a receber.
- ERP financeiro completo, estoque, chão de fábrica e pós-venda.

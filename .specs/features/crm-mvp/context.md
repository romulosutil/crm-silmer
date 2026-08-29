# CRM Silmer MVP — Contexto de Produto

**Coletado em:** 29/08/2026  
**Spec:** `.specs/features/crm-mvp/spec.md`  
**Status:** P0.1 resolvido; pronto para design condicional

## Limite da feature

Entregar a jornada comercial desde a entrada de uma conversa no WhatsApp oficial até a geração, envio e registro comercial da Ficha de Pedido, com autonomia do Vendedor Silmer e fallback humano.

## Decisões confirmadas

### Backlog e lead

- Caixa de Entrada funciona como backlog.
- Conversa não cria lead automaticamente apenas por existir.
- Pessoas possuem botão `Transformar em lead`.
- Vendedor Silmer pode executar a mesma conversão quando identifica intenção comercial.

### Vendedor Silmer

- Tenta conduzir a jornada inteira sozinho.
- Preenche os dados e avança os cards quando conclui cada etapa.
- Transfere quando o cliente pede vendedor, insiste em valores antes da hora ou existe bloqueio real não resolvível.
- O núcleo do agente pertence ao CRM.

### Integrações

- WhatsApp será integrado pela API oficial e a verificação já foi obtida.
- n8n é opcional; pode ser descartado sem afetar o agente.
- O destinatário da Ficha é Rose, `+55 27 99901-0303`.

### Ficha, financeiro e privacidade

- A Ficha real orienta os campos, perguntas e etapas.
- O inventário e a jornada definitivos estão em `CAMPOS-FICHA-E-JORNADA-P0-1.md`.
- Backlog fica fora do Kanban; as colunas são Produto, Especificação, Estampa,
  Logística e Fechamento.
- Campo obrigatório `pendente` ou `divergente` bloqueia passagem; correção
  retorna à primeira etapa incompleta.
- O caminho inicial de pagamento envia chave PIX, exige confirmação humana e
  então dispara Ficha e boas-vindas idempotentes.
- O CRM precisa informar quanto vendeu.
- LGPD seguirá uma linha de base de mercado, a transformar em critérios concretos antes do piloto.

## Discrição do Tech Lead

- Backend, banco, hospedagem e runtime de IA.
- Estratégia de filas, retries e observabilidade.
- Uso eventual do n8n fora do caminho crítico.
- Formato interno dos contratos, desde que preserve as regras do produto.

## Ideias adiadas

- Instagram e canal próprio do site, salvo nova decisão para o primeiro piloto.
- ERP financeiro completo.
- Estoque, chão de fábrica e pós-venda.

# RFC 019 — Cliente, pedido manual e assuntos do atendimento

Status: aprovado para implementação pelo PO em 13/10/2026.

Decisão: [ADR 032](../adr/032-separar-pedido-conversa-e-assunto.md).
Requisitos: [CP-01..18](../../.specs/features/cliente-pedido-assuntos/spec.md).
Entrega: [CP-T01..04](../../.specs/features/cliente-pedido-assuntos/tasks.md).

## Problema

O Pedido de atendimento nasce somente numa Conversa, e o briefing único da
Conversa alimenta o único Pedido pendente dela. Isso mistura respostas quando
um cliente discute dois pedidos, ou um pedido e outro assunto. O vendedor
também não consegue criar um Pedido a partir de Pedidos enquanto o canal não
está disponível. Arquivar na Inbox não encerra o ciclo de Conversa, e o
fechamento existente classifica todo encerramento como `sem_lead`.

## Proposta

1. Permitir Contato cadastrado por vendedor sem identidade de canal. Nome é
   obrigatório; uma identidade WhatsApp/Instagram só nasce pelo fluxo de
   identidade verificável já existente. A criação e a busca são autorizadas,
   auditadas e limitadas por página. Contatos com nomes iguais não são unidos.
2. Permitir Pedido de atendimento manual com Contato e vendedor responsável,
   sem Conversa. Ele nasce `pendente`, usa a numeração e a ficha atuais e pode
   ser editado, gerado, reaberto e impresso pelas regras atuais. `loja` continua
   isolado, confirmado pelo gateway e travado. Pedido manual não cria conversa
   nem aciona o n8n. Número, status, cliente e totais continuam sujeitos às
   regras do domínio, não a texto livre da tela.
3. Encerrar Conversa por ato humano explícito e auditado, com motivo neutro
   `concluido` ou `sem_pedido`. Pedido confirmado ou inatividade não encerram a
   Conversa automaticamente. Uma mensagem posterior abre o próximo ciclo;
   arquivar continua sendo apenas organização da Inbox.
4. Criar Assunto dentro de uma Conversa, com vínculo opcional a um Pedido do
   mesmo Contato. Um Pedido pode ser referido em ciclos diferentes. Mensagem
   pode referir mais de um Assunto; uma escrita na ficha exige Pedido alvo
   inequívoco. O briefing do agente passa a pertencer ao Assunto, e comandos
   n8n levam o identificador do Assunto e do Pedido alvo. O CRM valida vínculo,
   permissões, epoch, revisão e idempotência antes de projetar dados.
5. Enquanto o workflow não enviar esses identificadores, o contrato antigo
   continua restrito a um pendente por Conversa. A nova capacidade de múltiplos
   pendentes na mesma Conversa só é habilitada junto da atribuição por Assunto.

## Compatibilidade e rollout

- Expandir dados/API antes das telas. Pedidos atuais continuam com Conversa e
  dono derivados dela. Pedidos manuais recebem dono próprio. Uma futura ligação
  entre Pedido manual e Conversa é explícita e auditada, sem troca automática
  de dono ou sobrescrita da ficha.
- Liberar criação manual antes do WhatsApp. Depois, liberar encerramento
  neutro. Assuntos entram com leitura e atribuição humana antes dos comandos
  do agente. Implantar CRM compatível antes do workflow novo.
- Nunca inferir equivalência de Contatos por nome ou telefone digitado. O
  vínculo posterior de identidade segue a correlação verificável vigente.
- A aprovação do canal, a UAT no ambiente alvo e os gates de privacidade do
  agente continuam independentes dos testes locais.

## Alternativas descartadas

- Criar Conversa fictícia para cada Pedido manual: polui Inbox, cria canal e
  identidade inexistentes e confunde a automação.
- Reutilizar `origin = loja`: pedidos da loja são pagos e travados.
- Escolher sempre o pendente mais recente: altera o pedido errado em mensagens
  ambíguas ou com dois pedidos ativos.
- Encerrar ao gerar Pedido: ainda podem existir outros pedidos ou assuntos.

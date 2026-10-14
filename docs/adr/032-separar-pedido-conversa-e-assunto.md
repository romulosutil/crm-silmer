# ADR 032 — Separar Pedido, Conversa e Assunto

Status: aceito pelo PO em 13/10/2026 ao solicitar a implementação da
[RFC 019](../rfc/019-cliente-pedido-manual-e-assuntos.md).

Requisitos: [CP-01..18](../../.specs/features/cliente-pedido-assuntos/spec.md).
Tasks: [CP-T01..04](../../.specs/features/cliente-pedido-assuntos/tasks.md).
Relacionados: ADRs [006](006-pedido-dois-status.md),
[015](015-conversa-nao-volta-para-o-bot.md),
[018](018-cliente-do-pedido-acompanha-o-contato.md),
[027](027-venda-da-loja-do-site.md). Issues e PRs serão ligados nas tasks
quando criados.

## Contexto

O cliente pode ter vários pedidos em andamento e discutir, na mesma troca de
mensagens, mais de um pedido ou assuntos sem pedido. Um pedido também pode
continuar em outro ciclo de conversa. O vínculo obrigatório Pedido → Conversa,
o briefing único e a unicidade de pendente por Conversa não representam isso.
Sem o WhatsApp aprovado, o vendedor precisa registrar Pedido a partir de
Pedidos, inclusive para Contato ainda sem identidade de canal.

## Decisão

1. Contato é a entidade estável do cliente e pode existir sem identidade de
   canal quando cadastrado por pessoa autorizada. Identidades de canal só são
   associadas por correlação verificável. Pedido de atendimento guarda o
   Contato; a Conversa é opcional na criação manual. Pedido da loja continua
   sem Contato e sem Conversa, sob suas regras exclusivas.
2. Pedido manual nasce pendente, com vendedor responsável explícito. Pedidos
   originados na Conversa continuam seguindo o dono da Conversa até migração
   deliberada; não há mudança silenciosa de propriedade. A ficha do pendente
   lê o nome atual do Contato; gerar congela o nome conforme ADR 018.
3. Conversa é ciclo de atendimento do canal. Começa na primeira mensagem
   válida após ciclo terminal e termina por comando humano explícito com
   motivo. O novo estado terminal neutro é `encerrada`; `sem_lead` histórico
   permanece. Arquivamento não encerra. Gerar Pedido não encerra. Novo ciclo
   começa com o bot, salvo decisão posterior, conforme ADR 015.
4. Assunto identifica o contexto comercial dentro da Conversa. Ele pode não
   ter Pedido ou apontar para um Pedido do mesmo Contato. O mesmo Pedido pode
   ser mencionado em mais de um ciclo. Mensagens podem ter vários vínculos de
   Assunto. Uma mutação de Pedido exige alvo explícito; ambiguidade suspende a
   mutação e pede esclarecimento.
5. O briefing que pode projetar na ficha pertence ao Assunto. O contrato
   antigo do n8n mantém no máximo um pendente por Conversa. Remover essa
   restrição requer implantar primeiro IDs de Assunto/Pedido, validação no CRM
   e workflow atualizado; replay, epoch e revisão continuam obrigatórios.

## Consequências

- A regra 9 de `RULES.md` passa a limitar apenas o contrato legado sem
  Assunto. Vários pedidos pendentes do mesmo Contato são permitidos; vários
  na mesma Conversa dependem do contrato por Assunto.
- Ações de Pedido manual usam idempotência, versão, auditoria e autorização
  por vendedor responsável ou administrador. A UI de Pedidos ganha criação
  com busca paginada de Contatos e cadastro mínimo quando não houver um.
- A gaveta da Inbox deixa de representar somente o pendente ou o último
  confirmado quando a leitura de Assuntos for implantada.
- Nenhum novo status de Pedido, framework, store global, serviço ou banco é
  introduzido.

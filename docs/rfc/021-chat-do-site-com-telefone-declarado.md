# RFC 021 — Chat do site com telefone declarado

Status: decidida para o piloto de chat em 14/10/2026.

Responsável: Tech Lead. Aprovador: PO, que pediu o chat antes da liberação
plena do WhatsApp pela Meta e adiou a confirmação desse canal.

Requisitos: [CP-21..22](../../.specs/features/cliente-pedido-assuntos/spec.md).
Tarefa: [CP-T06](../../.specs/features/cliente-pedido-assuntos/tasks.md).
Decisão: [ADR 034](../adr/034-chat-do-site-com-telefone-declarado.md).

## Problema

O chat do site hoje cria uma identidade sintética `999…` por sessão sem pedir
nome ou telefone. O CRM precisa receber esses dados para orientar atendimento,
mas o número digitado não prova controle da identidade WhatsApp, que ainda
depende da aprovação operacional da Meta.

## Opções

1. Tratar o telefone digitado como `wa_id` confirmado e unir com cliente
   anterior: simplifica o roteamento, mas pode dar acesso ao pedido de outra
   pessoa e viola correlação verificável.
2. Bloquear o chat até confirmação WhatsApp: impede o piloto de chat.
3. Guardar o telefone como declaração da sessão, usar busca apenas para
   indicação interna e abrir Pedidos novos em Contato isolado: atende o piloto
   sem expor histórico de terceiros.

## Recomendação e resultado

Adotar a opção 3. O site pede nome e telefone antes da primeira mensagem;
WhatsApp não usa esse formulário. O n8n entrega a declaração em ingresso
autenticado ao CRM, que cifra o dado e distingue a origem `site_chat` de uma
identidade de canal confirmada. A busca interna retorna candidatos com estado
"informado no site"; ao workflow cabe no máximo uma classificação sem
identificadores pessoais, não enviada ao modelo nem ao visitante. Conversa e
Pedido novos pertencem ao Contato sintético da sessão. A confirmação pelo
WhatsApp poderá ser adicionada mais tarde para unir históricos, mas não
bloqueia atendimento e Pedido novos.
No repasse, o vendedor continua em texto pela caixa de entrada do CRM. O
widget consulta mensagens da sua sessão aleatória, inclusive a resposta
humana, sem usar o telefone informado como chave de leitura.

## Aceite

- Mesmo telefone em duas sessões não une Contatos nem Pedidos.
- Telefone de cliente existente não devolve histórico, nome ou Pedido ao chat.
- Replay de ingresso mantém uma só declaração, mensagem e Pedido.
- Troca de telefone na sessão requer comando explícito e auditável, ou recusa.
- Busca humana distingue número declarado de número confirmado.
- Chat e formulário operam sem WhatsApp disponível; widget segue tokens Silmer
  e testes de teclado/celular.
- Transferência permite resposta humana pelo CRM visível na mesma sessão do
  chat, sem revelar mensagens de outra sessão.

Issues e PRs: registrar na [tarefa CP-T06](../../.specs/features/cliente-pedido-assuntos/tasks.md)
quando criados.

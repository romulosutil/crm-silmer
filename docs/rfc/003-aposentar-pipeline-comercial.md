# RFC 003 — Aposentar pipeline comercial

## Contexto

O replanejamento do MVP concentra a jornada em atendimento, contatos e coleta
progressiva de informações. O Kanban e o conceito de Negócio não fazem parte
do próximo corte. A futura entidade Pedido será especificada separadamente.

## Proposta

- Remover a superfície Kanban, suas rotas públicas, eventos ao vivo e testes.
- Retirar o acesso navegável ao detalhe de Negócio.
- Manter Inbox, contato, mensagens, handoff e automação n8n.
- Preservar migrations históricas já aplicadas; elas não representam uma
  capacidade ativa do produto.

## Fora de escopo

Não cria Pedido, catálogo comercial, preço, pagamento ou novo fluxo de venda.

## Decisão

Aceita por ADR 004.

## Rastreabilidade

Preserva INB-01, ORC-01, ORC-09, AGT-07 e AGT-08 para a jornada de atendimento.
Os critérios INB-02 a INB-04, que pressupõem conversão comercial, são
substituídos por esta RFC e serão redefinidos na futura especificação de Pedido.

# ADR 008 — Lastro de datas do pedido

Status: aceito; emendada pela
[ADR 016](016-itens-com-os-sete-pontos-da-ficha.md) só no ponto em que
nenhuma data bloqueia a confirmação: a entrega prometida passou a ser exigida
para gerar o pedido.

Data: 29/09/2026

Decisores: PO, em 29/09/2026.

O número 007 está reservado para a ADR da ficha por produto, ainda em revisão
no branch `feat/ficha-por-produto`.

## Contexto

A ADR 006 deixou fora do MVP cobrança, comprovante e status de pagamento,
produção, entrega e marcos. A operação agora precisa de um lastro em cada
pedido: saber, na ficha digital e na impressa, quando o cliente fez o primeiro
contato, quando o pedido fechou, quando pagou, quando o vendedor prometeu
entregar e quando a entrega de fato aconteceu.

Duas dessas datas já existem. A data do pedido é gravada ao gerar o pedido
(PCL-04) e, numa nova confirmação, passa a ser a da nova confirmação (PCL-12).
A entrega confirmada está no resumo da ficha. As outras três não existem.

## Decisão

### As cinco datas

1. **Primeiro contato:** abertura da conversa que originou o pedido, ou seja, a
   primeira mensagem recebida naquele atendimento. É copiada para o pedido na
   criação (`first_contact_at`) e nunca é digitada. Pedidos criados antes
   desta decisão recebem o mesmo valor pela migração.
2. **Pedido fechado:** a data do pedido, sem mudança de regra.
3. **Pagamento:** `paid_on`, dia informado por uma pessoa.
4. **Entrega prometida:** a entrega confirmada do resumo
   (`data_entrega_confirmada`), sem mudança de regra.
5. **Entrega realizada:** `delivered_on`, dia informado por uma pessoa. É
   sempre manual.

### Pagamento e entrega realizada

- Quem informa é o dono da conversa ou um administrador, a mesma posse da
  edição (D08), pela ação `order.milestones`. A escrita usa `expectedVersion` e
  `Idempotency-Key` e é auditada.
- Valem para pedido pendente ou confirmado, sem reabrir: pagamento e entrega
  costumam vir depois de gerar o pedido, e reabrir travaria a impressão.
- As duas datas vão sempre juntas; vazio limpa uma delas. Cada uma precisa ser
  um dia de calendário válido e não pode ser depois de hoje no horário de São
  Paulo (D00.6-05).
- O pagamento é um dia só. Sinal, parcelas e saldo continuam fora.

### O que não muda

- Nenhuma data do lastro muda o status, bloqueia a confirmação, entra no que
  falta ou mexe na impressão. D05 e PCL-08 continuam valendo.
- Continuam fora: cobrança, comprovante, status de pagamento, produção, status
  de entrega, pedido perdido ou cancelado e Mesa de Trabalho. Receber
  comprovante PIX segue sem confirmar pagamento (RULES 15); o dia do pagamento
  é sempre digitado por uma pessoa.
- As datas ficam em colunas próprias, fora do envelope cifrado da ficha: não
  são dado pessoal e permitem medir prazos sem decifrar a ficha.

### Ficha impressa

A v2 aprovada é travada por hash e não muda. O lastro entra na ficha impressa
pela v3 (ficha por produto), antes da aprovação de Rose e Operação (T15 daquele
branch), para que o documento novo passe por uma única aprovação. Até a troca
de template, a v2 só passa a imprimir a entrega confirmada em dd/mm/aaaa, como
na amostra aprovada: o dado vinha da tela em ISO e saía como `2026-10-24`.

## Consequências

Esta decisão supersede, na ADR 006, o trecho "Fora do escopo do MVP" só no que
diz respeito a registrar os dias de pagamento e de entrega e ao lastro de
datas. O restante daquela lista continua fora.

A seção "Lastro do pedido" é a exceção a PFI-10: continua editável depois que
o pedido é gerado. A migration `0024_order_milestones.expand.sql` acrescenta as
três colunas, todas anuláveis para a troca de versão da API. A rota
`PATCH /api/v1/orders/:orderId/milestones` grava pagamento e entrega. O
contrato `Order` ganha `firstContactAt`, `paidOn` e `deliveredOn`.

Requisitos: PLA-01 a PLA-09 em
[especificação Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md);
decisões D27 a D31 em
[contexto](../../.specs/features/pedidos-mvp/context.md); tarefas T41 a T47
em [tasks](../../.specs/features/pedidos-mvp/tasks.md).

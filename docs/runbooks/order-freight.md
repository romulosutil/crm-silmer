# Frete no total do Pedido — operação, migration 0076 e rollback

OLC-T01 / OLC-05a–j. Contrato:
[ADR 080](../adr/080-valor-final-com-frete.md) e
[RFC 062](../rfc/062-valor-final-com-frete.md). Requisitos em
[spec](../../.specs/features/olist-confirmed/spec.md#frete-no-total-do-pedido).
Este documento descreve o que a entrega grava, como aplicar a migration e como
voltar o código sem recalcular total de Pedido que tem frete (ADR 080 item 14).
Não é evidência de produção: aplicação e verificação reais são registradas à
parte, no momento da implantação.

## O que a entrega grava

- `crm.orders.freight_cents` (bigint, default 0, 0 a 9007199254740991) e a
  origem do frete: `freight_source` (`seller` ou `quote`),
  `freight_quote_id`, `freight_quote_service_id`, `freight_quoted_cents`,
  `freight_set_by`, `freight_set_at`.
- `crm.orders.pricing_rule`: `pieces-v1` (total = subtotais; todo Pedido
  anterior) ou `pieces-freight-v1` (total = subtotais + frete). Passa a
  `pieces-freight-v1` quando o frete é informado ou quando um Pedido
  precificado por tamanho é confirmado pelo código novo. Nunca é inferido.
- `crm.orders.commercial_revision`: contador de alterações de conteúdo
  comercial exportável. Datas de pagamento/entrega, primeira impressão e o
  marcador de cancelamento não o incrementam. Ainda não é lido por nenhuma
  guarda (OLC-T03).
- `crm.order_freight_events`: histórico append-only. `set` guarda valor
  informado, valor anterior, origem e, quando existe, a cotação selecionada e
  o valor cotado; `confirmed` guarda peças, frete, origem e total com autor e
  instante. Só centavos, identificadores e instantes: sem nome, telefone,
  endereço ou texto livre.
- Comando `POST /api/v1/orders/{orderId}/freight` (ação `order.freight`),
  evento de domínio `order.freight_updated` e auditoria `order.freight`, ambos
  só com identificadores.

Pedido legado (sem composição por tamanho) e Pedido da loja ficam com frete
zero e `pieces-v1`; total, snapshot, ficha, PDF, cobrança e quitação não mudam.
A ficha não mostra frete e `PRINT_TEMPLATE` não muda. O Olist continua
exigindo `valorFrete` zero até OLC-T02: um Pedido com frete positivo fica
bloqueado para o Olist, que é o estado seguro esperado.

## Aplicação da migration 0076

Somente expand, aditiva e sem `UPDATE` de dados: as colunas entram com default
e nenhum gatilho de linha dispara. Não há migration contract.

1. Backup do PostgreSQL conforme o runbook de implantação vigente.
2. Com a imagem nova, no container da API:

   ```sh
   node /app/modules/database/src/cli.js --phase=expand
   ```

   Resultado esperado: `applied_count: 1` na primeira execução e `0` na
   repetição.

3. Conferir que nenhum Pedido ganhou frete e que o histórico está vazio:

   ```sql
   SELECT count(*) FILTER (WHERE freight_cents <> 0) AS com_frete,
          count(*) FILTER (WHERE pricing_rule <> 'pieces-v1') AS regra_nova,
          count(*) FILTER (WHERE commercial_revision <> 1) AS revisao_movida
   FROM crm.orders;
   SELECT count(*) FROM crm.order_freight_events;
   ```

   Os quatro números devem ser zero logo após a migration.

A migration pode ser aplicada antes da imagem nova: o código anterior ignora
as colunas e, sem Pedido com frete, a guarda descrita abaixo não bloqueia
nada.

## Rollback de código

O rollback volta apenas a imagem. **Não remova colunas, tabela, função ou
gatilho** da migration 0076: o dado do frete fica preservado.

### Como o banco impede o recálculo sem frete

O gatilho `orders_freight_pricing_guard`
(`crm.guard_order_freight_pricing()`) roda em todo `UPDATE` de `crm.orders`:

1. O frete só muda enquanto o Pedido está e continua `pendente`
   (`ORDER_FREIGHT_FROZEN`, constraint `order_freight_frozen`). Vale para
   qualquer código.
2. Em Pedido com frete maior que zero, mudar `final_amount_cents`, `status`
   ou `freight_cents` exige que a transação tenha declarado a regra nova com
   `set_config('crm.order_pricing_rule', 'pieces-freight-v1', true)`. O
   repositório novo declara isso em toda escrita comercial. O código anterior
   não declara e recebe `ORDER_FREIGHT_RULE_REQUIRED` (SQLSTATE 23514,
   constraint `order_freight_rule_required`): a escrita falha fechada e nada
   é gravado.

Com a imagem anterior, portanto, um Pedido **com frete**:

- não tem o total recalculado só pelos subtotais (edição de subtotal ou de
  quantidade com composição completa falha);
- não é confirmado nem reaberto;
- continua aceitando o que não toca total, situação ou frete: datas de
  pagamento e entrega, cobrança InfinitePay e recebimentos, cancelamento
  local, primeira impressão, e edição da ficha enquanto a composição estiver
  incompleta (total nulo antes e depois).

Pedido sem frete (todo o legado e a loja) não é afetado pela guarda. A
interface anterior mostra erro genérico nesses Pedidos com frete; eles voltam
a ser editáveis quando a imagem nova retorna.

### Antes de voltar a imagem

Liste os Pedidos que ficarão bloqueados para escrita comercial e avise os
responsáveis. A consulta devolve só identificadores e valores:

```sql
SELECT number, status, freight_cents, final_amount_cents, freight_source,
       freight_set_by, freight_set_at
FROM crm.orders
WHERE freight_cents > 0 AND cancelled_at IS NULL
ORDER BY status, number_sequence;
```

Se a lista estiver vazia, o rollback não tem efeito sobre Pedidos. Se não
estiver, o caminho suportado é manter esses Pedidos intocados até a imagem
nova voltar. Não zere o frete por SQL para "destravar": em Pedido confirmado o
banco recusa (`ORDER_FREIGHT_FROZEN`) e, em pendente, isso mudaria o total
combinado com o cliente sem autor e sem histórico.

### Depois de voltar para a imagem nova

Nenhuma ação: frete, origem, regra e histórico estavam preservados. Conferir
que não houve escrita divergente durante a janela:

```sql
SELECT o.number, o.final_amount_cents, o.freight_cents, e.total_cents
FROM crm.orders o
JOIN LATERAL (
  SELECT total_cents FROM crm.order_freight_events
  WHERE order_id = o.id AND total_cents IS NOT NULL
  ORDER BY order_version DESC LIMIT 1
) e ON true
WHERE o.freight_cents > 0 AND o.final_amount_cents IS DISTINCT FROM e.total_cents;
```

Uma linha aqui indica Pedido cujo total gravado difere do último total
registrado no histórico de frete. Com a guarda ativa a causa esperada é
subtotal ou quantidade alterados pelo código novo depois do último registro;
confira pelo Pedido antes de qualquer correção, que deve ser feita pela
interface, pelo vendedor responsável.

## Verificação automatizada

- `test/orders-freight.test.js`: domínio, autorização, comando, cotação,
  confirmação e ficha.
- `test/order-routes.test.js`: contrato HTTP do comando.
- `test/orders-postgres-live.test.js`: autorização na transação,
  concorrência, idempotência, cotação real persistida, confirmação,
  reabertura com quitação, Dashboard e performance.
- `test/order-billing-postgres-live.test.js`: cobrança e plano com frete.
- `test/migrations-live.test.js`: migration 0076 sobre schema populado,
  constraints e a guarda de rollback.
- `test/store-orders-postgres-live.test.js`: loja com frete zero.

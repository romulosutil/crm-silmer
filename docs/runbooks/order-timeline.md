# Datas do pedido e confirmação de entrega

Contrato: [DTL-01–12](../../.specs/features/order-timeline/spec.md),
[RFC 063](../rfc/063-linha-do-tempo-dos-recebimentos-do-pedido.md).

## Leitura

**Datas do pedido** mostra contato, **Pedido confirmado**, recebimentos,
correções e entrega em sequência horizontal. Somente datas existentes geram
eventos. Em telas pequenas, a região **Cronologia do pedido** contém a
rolagem, recebe foco e permite navegar por teclado.

A seção compartilha o snapshot do endpoint de cobrança existente, sem
adicionar consulta ao ciclo de resumo/workspace já usado por Cobranças.
Abrir o histórico não gera link, mensagem ou recebimento.

- Manual: **Recebido em** é o dia efetivo informado; registro/autoria ficam
  nos detalhes, sem atribuir horário fictício ao dia efetivo.
- InfinitePay: **Confirmado no CRM** é a data verificada em São Paulo, sem
  afirmar que seja a hora efetiva da transação no provedor.
- Reversões/devoluções preservam o original e aparecem separadamente. A UI
  usa os totais oficiais; não soma os valores dos eventos para calcular saldo.
- Legado: quitação conhecida é preservada sem inventar origem ou valor.
  Em falha de leitura, aparece **Detalhamento aguardando atualização**.
- Revisão/aplicação inválida ficam explícitas. Link emitido ou consulta
  pendente não são recebimentos.

## Entrega

O botão **Confirmar entrega** fica no cabeçalho para responsável atual ou
Admin ativo, em Pedido de atendimento confirmado, não teste, não cancelado
e sem entrega. Após a confirmação, a mesma ação passa a **Alterar data de
entrega**, com somente o campo **Entregue em**. Não há editor genérico de
datas ou campo de pagamento nesta seção ([DDE-01–04](../../.specs/features/order-delivery-date/spec.md)).
Loja conserva suas travas.

Cancelar/Escape fecham sem comando e devolvem foco. Confirmar envia somente
`expectedVersion` ao endpoint existente
`POST /api/v1/orders/:orderId/delivery-confirmation`, com sessão, CSRF,
origem e idempotência. ID, versão e chave ficam congelados no diálogo.
Duplo Enter não repete a escrita. A API fixa o dia de São Paulo; o resultado
preenche **Pedido entregue** e recebe foco. Pagamento/saldo/status/snapshot
da ficha permanecem independentes. A correção de uma entrega existente envia
também `deliveredOn`, dia válido e não vazio até hoje em São Paulo. Não permite
apagar a entrega nem escolher data na primeira confirmação; mesma data não
gera escrita na UI e é no-op na API. A data integra o fingerprint idempotente.

Falha/conflito não simulam sucesso. **Atualizar pedido** relê o resultado;
se o dia corresponder ao solicitado, mostra a entrega. A data antiga não
comprova o sucesso de uma correção. Sem resultado e com a mesma versão, uma nova
confirmação humana conserva a mesma chave; versão diferente exige revisão
do contexto. Nunca repetir automaticamente um comando de resultado incerto.

Autoria e horário aparecem somente quando a auditoria explícita
`order.delivery.confirm` corresponde à mudança real de milestones e ao dia
de `deliveredOn`. Legado/no-op/edição sem prova não ganham autoria fictícia;
a data conhecida continua visível. Uma correção retroativa pode não exibir
autoria/horário na timeline quando não houver essa correspondência; a auditoria
do comando continua preservada. Resposta atrasada não substitui versão mais
recente já lida na tela.

## Contrato e operação

`GET /api/v1/orders/:orderId/billing` acrescenta `timelineEvents`: IDs com
namespace por fonte, kind `receipt|external_reversal|refund`, source
`external|infinitepay`, dia/precisão temporal, centavos, método, situação e
autoria autorizada. `deliveryConfirmation` é opcional, com `day`,
`confirmedAt` e `actorName`. Sem gestão autorizada, os novos eventos são
vazios e a metadata de entrega é nula. Não há NSU, URL, nota ou motivo
privado na projeção resumida. Recebimentos externos são relacionados por ID,
sem concatenar duas coleções como dinheiro independente.

Não há migration ou infraestrutura nova. Flags de emissão/recebimento
conservam seus contratos; emissão desligada com recebimento ativo mantém
consulta autorizada. Endpoint indisponível não remove os marcos do Pedido.

O smoke foi executado em `crm-silmer-billing-fresh`/porta 4180 com dados
sintéticos: R$ 30 pela InfinitePay simulada e R$ 70 por transferência
registrada manualmente, entrega pelo botão real e releitura após reload.
Dois recebimentos e entrega persistiram, com saldo zero. Isso comprova
integração local, sem representar dinheiro ou homologação de provedor real.

No smoke DDE, um novo pedido sintético recebeu R$ 30 manualmente, confirmou
entrega hoje, alterou para o dia anterior e foi relido após reload. A data
persistiu com um único evento; recebimento, saldo de R$ 70, `paidOn`, status
e ficha permaneceram iguais. O editor genérico estava ausente.

## Verificação e rollback

Testes de projeção, PostgreSQL exclusivo, composição, E2E/axe e regressões
de Pedidos/Cobranças/entrega. Suites que limpam schemas nunca devem usar
banco compartilhado. A evidência final fica na
[validação](../../.specs/features/order-timeline/validation.md).

Rollback usa a imagem anterior, preservando recebimentos, datas e auditoria.
Campos da API são aditivos e o comando já existia; não apagar dados para
remover a visualização. Correções financeiras usam os comandos próprios,
nunca edição direta do banco. PDF e Dashboard mantêm seus contratos.

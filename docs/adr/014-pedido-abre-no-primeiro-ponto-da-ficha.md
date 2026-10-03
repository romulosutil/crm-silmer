# ADR 014 — Pedido abre no primeiro ponto da ficha

Status: aceito

Data: 02/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 02/10/2026, depois do diagnóstico do
cloud-dev, para quando o pedido abre (D29) e para a falha visível (D30). O
desenho do contrato (`open_order` na reserva e no handoff, resposta `order` e
`ORDER_OPEN_FAILED`) é decisão do Tech Lead.

RFC: [RFC 006](../rfc/006-atendimento-guiado-do-bot-no-n8n.md), decisões
D29–D30. Requisitos: `PCL-01`–`03` e `PAB-01`–`04` da
[especificação de Pedidos](../../.specs/features/pedidos-mvp/spec.md), história
P1-1. Tasks: T50–T53 de
[tasks.md](../../.specs/features/pedidos-mvp/tasks.md). Substitui o item 1 da
[ADR 010](010-intencao-de-pedido-sem-pergunta-e-tom-do-bot.md) (a intenção de
compra marcada pelo modelo) e o evento separado da T23. A regra de não abrir
pedido do que não é pedido do zero, da
[ADR 013](013-pedido-do-zero-e-meta-de-meia-ficha.md), continua valendo; a
ficha de sete pontos é a da
[ADR 012](012-ficha-de-sete-pontos-e-ritmo-fixo.md).

## Contexto

O diagnóstico do cloud-dev de 02/10/2026 (23 pedidos e 130 conversas) achou
dois problemas na abertura do Pedido pendente.

1. **A abertura dependia do modelo.** O pedido só abria quando o modelo
   marcava `order_intent_confirmed` (ou com a pré-ficha completa). O mesmo
   roteiro abriu o pedido na mensagem 2, na mensagem 4 e nunca. Uma conversa
   que começou com "Quero fazer 30 camisetas" e o nome de uma vendedora foi
   transferida com a quantidade gravada e sem pedido.
2. **A abertura era uma chamada paralela, sem retorno.** O ramo "Cliente
   confirmou intenção de pedido? (MVP)" → "Preparar intenção de pedido (MVP)"
   → "CRM - Registrar intenção de pedido (MVP)" corria ao lado da resposta,
   com `onError: continueErrorOutput` e nada ligado à saída de erro. Em 30/09 e
   01/10, o CRM respondeu `500 SERVICE_UNAVAILABLE` ao `order.intent_confirmed`
   (execução 32565 do n8n; a API estava à frente da migração 0024), e 26
   handoffs de pré-ficha completa não abriram pedido, em silêncio. No meio da
   conversa, a rodada seguinte reenviava a intenção e corrigia o pedido; no
   handoff não há rodada seguinte.

## Decisão

1. **Quando abre (D29).** O Pedido pendente abre na rodada em que a ficha da
   conversa — o briefing anterior unido ao `briefing_patch` da rodada — passa a
   ter, pela primeira vez, um valor real em pelo menos um dos sete pontos
   (`FICHA_RHYTHM` do SDK: `product_model`, `colors`, `quantity`,
   `artwork_status`, `fabrics`, `sizes`, `collar`).
   - "Definir com o vendedor" não conta. O nome (`customer_name`) sozinho não
     abre.
   - O que não é pedido do zero (ADR 013, `external_context`) nunca abre.
   - Um handoff de qualquer motivo abre quando a ficha tem pelo menos um ponto
     naquele momento, inclusive o handoff de arquivo ou áudio, que não passa
     pelo modelo e lê o briefing devolvido pelo CRM.
   - Uma vez aberto, fica: o prefixo `quote_` de `briefing_status` continua
     marcando o pedido aberto, e o workflow pede a abertura em toda rodada
     seguinte. Como a abertura é idempotente, isso não duplica o pedido e
     corrige sozinho uma abertura que falhou no meio da conversa.
   - O modelo não decide mais. A instrução de `order_intent_confirmed` sai do
     prompt e do contexto, e a saída estruturada deixa de declarar a chave.
     Como o esquema não proíbe chaves extras (o nó do agente não tem saída de
     erro), um modelo que ainda a envie continua sendo lido, e o nó de decisão
     a ignora.

2. **Como abre, sem falha silenciosa (D30).** A abertura viaja no mesmo
   evento que leva a ficha da rodada, não numa chamada à parte.
   - **Contrato:** `message.send.requested` e `handoff.requested` do contrato
     n8n v1 aceitam o booleano opcional `open_order`. Outro tipo de valor, ou o
     campo em outro evento, é recusado com `400`. Com `open_order: true`, a
     rota exige também a ação de automação `order.intent`, a mesma do evento
     antigo.
   - **CRM:** depois que a transação do evento confirma, o CRM cria ou
     reutiliza o pedido pendente da conversa com a semântica de
     `ensurePendingFromIntent` (PCL-01..03), a partir da ficha já unida. Um
     pedido que já existia recebe a projeção, como antes; um pedido criado
     nesta rodada já nasce da ficha unida e não é projetado de novo. A
     resposta do evento ganha `order: {opened: true, id, created}` ou
     `order: {opened: false, error: <código>}`. O replay da mesma
     `Idempotency-Key` tenta de novo e responde do mesmo jeito: um retry depois
     de uma falha abre o pedido.
   - **Falha:** um erro do módulo de pedidos nunca falha o evento, porque a
     resposta ao cliente precisa sair. O CRM registra a falha no log sem dados
     pessoais (código, conversa, correlação e tipo do evento), grava a
     auditoria `integration.n8n.order.open_failed` na conversa, com o código
     como motivo, e devolve `opened: false`. Um código de domínio
     (`CONVERSATION_NOT_FOUND`...) é devolvido como está; qualquer outro erro,
     inclusive do banco, vira `ORDER_OPEN_FAILED`, e sem o módulo de pedidos a
     resposta é `ORDERS_RUNTIME_UNAVAILABLE`.
   - **Workflow:** o nó de decisão calcula `open_order` com a regra do item 1
     e o envia na reserva e no handoff. O ramo paralelo da intenção sai. As
     respostas da reserva e do handoff passam por "Pedido não abriu? (MVP)";
     com `order.opened === false`, o workflow envia o `workflow.failed` que já
     existia, agora com `failure.code = ORDER_OPEN_FAILED`, o `conversation_id`
     e o código do CRM em `failure.reason`. Esse ramo fica acima da resposta e
     do aviso no canvas, então o n8n (`executionOrder` v1) o executa antes, e a
     sua chamada ao CRM continua em caso de erro: ele nunca impede a mensagem
     ao cliente. Onde a equipe vê a falha está no
     [runbook do ator técnico](../runbooks/automation-executor.md).

3. **Compatibilidade.** O CRM continua aceitando `order.intent_confirmed`,
   agora obsoleto, para os workflows até `mvp-simple-10`: o de produção
   (`k7tI6T4RhQPyJkn9`) está inativo, mas sincronizado com o `master`. A
   remoção do evento fica para outra ADR, quando nenhum workflow o enviar.

## Consequências

- O workflow passa a `mvp-simple-11` (DEV `dev-mvp-simple-12`). **Ordem de
  implantação:** o CRM que aceita `open_order` vai ao cloud-dev antes do
  workflow novo; um CRM antigo recusa a chave desconhecida com
  `400 UNKNOWN_REQUEST_FIELD`, e a resposta do bot não sai. O rollback do
  workflow para `mvp-simple-10` continua funcionando com o CRM novo.
- O pedido pendente abre mais cedo e em mais conversas: toda conversa de
  pedido do zero com um ponto da ficha ganha um pendente, mesmo que o cliente
  desista depois. O pendente é rascunho, não pedido oficial (ADR 006).
- Como já acontecia com a intenção persistente, uma conversa que volta à IA
  depois de um pedido confirmado abre um novo pendente na rodada seguinte
  (PCL-03).
- Um handoff cujo pedido não abriu fica visível na auditoria, no
  `workflow.failed` da conversa e no log da API; o vendedor que assume a
  conversa pode criar o pedido com "Criar pedido" (PCL-10).
- O prompt fica menor: perde a instrução da intenção e a linha "Intenção de
  pedido" do contexto.
- No roteiro do indicador da ficha, o KPI-01 passa a abrir o pedido na
  mensagem 3 ("Camiseta comum"), não na 2, que só traz o nome.

## Alternativas descartadas

- **Manter a flag do modelo (`order_intent_confirmed`):** é a causa da
  abertura irregular; a mesma conversa abria o pedido em rodadas diferentes ou
  não abria. A regra precisa ser determinística, como os gatilhos da ADR 009.
- **Manter a chamada paralela, com mais retries:** o retry do n8n não resolve
  um erro persistente (a API à frente da migração), a falha continuaria
  invisível no handoff, e o evento separado continuaria podendo chegar antes da
  reserva e abrir o pedido sem a ficha da rodada. Também seriam duas chamadas
  por rodada em vez de uma.
- **O CRM decidir sozinho ao unir o patch:** o CRM não sabe o que não é pedido
  do zero (ADR 013), que é decidido no workflow, e a regra ficaria em dois
  lugares.
- **Falhar o evento quando o pedido não abre:** o cliente ficaria sem resposta
  por um problema que não é dele, e o handoff não aconteceria.

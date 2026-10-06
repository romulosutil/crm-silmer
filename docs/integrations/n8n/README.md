# Integração CRM Silmer ↔ n8n — MVP simples

> **Decisão vigente:** [RFC 002](../../rfc/002-simplificar-integracao-n8n-para-o-mvp.md)
> e [ADR 003](../../adr/003-adotar-integracao-n8n-mvp-simples.md). RFC 001 e
> ADR 002 são histórico da alternativa mais robusta. O Pedido criado pelo
> agente segue a [ADR 006](../../adr/006-pedido-dois-status.md) e abre como
> manda a [ADR 014](../../adr/014-pedido-abre-no-primeiro-ponto-da-ficha.md).

## Objetivo e limite

OpenAI é o provedor do MVP, conforme a
[ADR 021](../../adr/021-adotar-openai-no-mvp.md). O workflow versionado
usa Responses API com `gpt-5.6-luna`; confirmação do modelo implantado e
controles de privacidade ficam no [checklist OpenAI](../openai/README.md).
Spikes Gemini não são dependência do lançamento. Deploy preserva o fluxo
GitHub → EasyPanel existente ([ADR 022](../../adr/022-manter-deploy-automatico-github-easypanel.md)).

O n8n recebe o webhook oficial do WhatsApp, registra a mensagem no CRM, usa o
contexto devolvido pelo CRM, decide entre resposta de IA e handoff e pede ao CRM
uma autorização de uso único antes de chamar a Meta. PostgreSQL continua sendo
a fonte da verdade. O n8n não acessa o banco e não mantém cópia paralela de
cliente, conversa, briefing ou memória curta.

## Pré-ficha guiada antes do handoff

Em cada mensagem de texto, a IA extrai somente fatos confirmados para o
`briefing_patch` criptografado da Conversa e pergunta pelo próximo ponto da
ficha (ADR 012, ADR 021). A saudação pede o nome e o que o cliente quer
personalizar, nunca "qual camisa"; se o cliente não disser o nome, a resposta
seguinte reage ao que ele contou e pede só o nome, e depois o bot não insiste.
Os pontos, nesta ordem, são: produto (`product_type`), modelo
(`product_model`, só para roupa, boné, mochila ou bolsa), cor (`colors`),
quantidade (`quantity`), onde vai a estampa (`artwork_locations`) e para
quando o cliente precisa (`needed_by`, desejo do cliente, nunca prazo
confirmado). Origem da arte, técnica, tecido, tamanhos, gola, personalização
individual e divisão por público nunca são perguntados: o bot grava o que o
cliente disser e o vendedor completa. A divisão por público vai em
`audiences` ("4 masculinas, 3 femininas e 3 infantis"), e o CRM a transforma
em um item por público quando a lê sem dúvida (ADR 022). O bot nunca oferece criar a arte e, de
tecido, só fala de algodão, poliéster e dry fit. Os demais campos
(identificação do pedido, finalidade, perfil de compra, logística e
anotações) também só são gravados quando o cliente fala deles. A retirada é
sempre na "Loja da Silmer".

Sem perguntar, o workflow grava o que já está definido (`KITS`): abadá é
sublimação total em poliéster branco com gola regata; sublimação total pede
poliéster branco; regata tem gola "regata", polo tem "gola polo", e boné,
mochila e bolsa têm gola `NAO APLICAVEL`. Também grava o produto a partir do
modelo dito ("30 regatas"), o modelo quando o produto já o nomeia ("abadás",
"ecobags") e o nome do produto no modelo de boné e bolsa ("bonés trucker").
Só preenche campo vazio, e o que preenche não é perguntado. O resumo da
transferência traz "Atenção" (`ALERTS`: sublimação em algodão ou em peça
escura, bordado com foto) e "Dica" (`HINTS`: técnica usual do produto,
personalização individual, divisão por público), só para o vendedor.

O workflow escolhe o próximo ponto pela constante `FICHA_RHYTHM` do SDK, o
primeiro ponto do produto ainda vazio, um por mensagem, e calcula de forma
determinística os pontos pendentes depois de unir o patch ao briefing atual.
O nó de contexto diz ao modelo o produto reconhecido e como perguntar o
próximo ponto (`POINT_QUESTIONS`). Ele só emite `briefing_complete` quando os
pontos do produto e o nome estiverem presentes; o nome pedido duas vezes sem
resposta deixa de ser exigido. Os grupos de produto ficam em `PRODUCT_KINDS`
e `NAMED_MODELS`. Para trocar a ordem ou acrescentar um kit, edite
`ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js`, atualize o snapshot
sanitizado principal com os nós gerados por `render-mvp-workflow.mjs` e rode
`npm run generate:n8n-dev-workflow` e `npm run generate:n8n-local-workflow`.
Os gatilhos de transferência da ADR 009 são
aplicados pelo nó de decisão, não só pelo prompt: pergunta de preço, frete ou
pagamento; pedido de pessoa ou de vendedor pelo nome; nome fora do CRM pedido
duas vezes; conversa que não é pedido do zero (camisa ou boné do post, "quero
essa camisa", pedido de contato por e-mail, WhatsApp ou telefone, algo já
combinado com a Silmer; ADR 013); duas respostas incompreensíveis ou indecisas
para o mesmo item; reclamação; urgência; conteúdo não suportado; e o teto de
15 mensagens. O resumo de todo handoff traz "Ficha: X de N (Y%)", o indicador
da meta de 50% da ficha, com N igual ao nome, enquanto o bot o pede, mais os
pontos do produto (7 para roupa, boné ou bolsa; 6 para outro produto); o
[roteiro do indicador da ficha](roteiro-indicador-da-ficha.md) tem as
mensagens para testá-lo.
`briefing_status` e `next_required_field` guardam o estado desses gatilhos e
não vão para a Ficha. Nenhuma informação inferida vira Pedido oficial,
catálogo, preço, prazo garantido ou pagamento. O agente pode criar um Pedido
`pendente`, que é rascunho não oficial, na rodada em que a ficha ganha o
primeiro dos seus pontos ou um campo que ele só grava, em geral o produto
(ADR 014); oficial é o Pedido `confirmado`, e a confirmação permanece humana
(ADR 006).

Esta entrega ativa somente WhatsApp. Instagram, leitura multimodal pela IA e
novas telas ficam nas fases posteriores. O adapter direto Meta → CRM permanece
apenas como fixture de desenvolvimento e nunca é fallback silencioso.

## Entidades que o fluxo cria ou altera

| Conceito de produto | Persistência oficial                    | Comportamento no fluxo                                                                                                            |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Cliente             | `contacts` + `contact_identities`       | Criado provisoriamente na primeira identidade de WhatsApp; não existe tabela paralela `customers` ou `leads`.                     |
| Conversa            | `conversations`                         | Uma conversa aberta por identidade/canal; guarda modo, `automation_epoch`, revisão inbound e o snapshot atual do briefing.        |
| Mensagem            | `messages`                              | Inbound e outbound cifrados; identidade externa ou `command_id` impede duplicidade. O estado de entrega fica na própria mensagem. |
| Briefing            | colunas cifradas da `conversation`      | Um snapshot consolidado; `briefing_patch` ignora nulos e só aceita campos de qualificação. Não promove dado oficial.              |
| Handoff             | `handoffs`                              | Criado sem responsável para a função humana vigente `Vendedor`; uma pessoa compatível o reivindica atomicamente.                  |
| Pedido              | `orders`                                | Criado `pendente` pelo `open_order` da reserva ou do handoff (ADR 014), nunca pela chegada de mensagem. Confirmar é ação humana.  |
| Comando humano      | `n8n_commands` + `outbox_jobs`          | Estado oficial e outbox são gravados antes de o worker chamar o webhook do n8n.                                                   |
| Evidência técnica   | `n8n_events`, auditoria e reconciliação | Registra correlação, workflow, versão, execução e resultado sem conteúdo pessoal ou segredo técnico.                              |

As tabelas `ai_turns`, `automation_runs`, `conversation_briefing_versions` e
`message_delivery_attempts` foram criadas por migrações já publicadas, mas não
participam do runtime simplificado. Permanecem dormentes até uma migração
contract explícita e segura removê-las.

## Contrato n8n → CRM

Os três endpoints usam `Authorization: Basic`, `Idempotency-Key`,
`X-Correlation-Id`, `X-Silmer-Workflow-Key`, `X-Silmer-Workflow-Version` e
`X-Silmer-Execution-Id`. Upload também exige `X-Silmer-Content-SHA256`.

1. `POST /api/v1/integrations/n8n/messages/inbound`
   cria ou resolve Cliente, Conversa e Mensagem e devolve `source_revision`,
   `automation_epoch`, modo, mensagens recentes e briefing.
2. `POST /api/v1/integrations/n8n/conversations/{id}/attachments`
   recebe uma mídia por streaming, valida tamanho, hash, MIME e malware e só a
   vincula depois da quarentena. A IA multimodal fica diferida.
3. `POST /api/v1/integrations/n8n/events`
   recebe reserva de envio, callbacks de entrega, handoff, abertura do Pedido
   pendente (`open_order` na reserva ou no handoff) e falha do workflow.

Eventos aceitos: `message.send.requested`, `message.sent`,
`message.delivered`, `message.read`, `message.failed`,
`message.send.unknown`, `handoff.requested`, `order.intent_confirmed`
(obsoleto desde a ADR 014, aceito para workflows antigos) e `workflow.failed`.

O retorno do inbound também traz `automation_message_count` (mensagens do
agente já reservadas na Conversa), `automation_message_cap` (15) e `sellers`
(vendedores ativos, só id e primeiro nome), conforme a ADR 009.

Erros usam `application/problem+json`. Replay da mesma chave com o mesmo
payload devolve o resultado idempotente; a mesma chave com payload diferente
retorna `409`.

## Fence de envio simplificado

Não existe claim, lease nem token de rodada. Para uma resposta automática, o
`message.send.requested` deve apresentar a revisão inbound e o epoch devolvidos
pelo CRM. A autorização só é concedida quando a conversa continua aberta e em
modo IA, o epoch é atual e a revisão ainda não foi consumida. O CRM grava a
Mensagem com estado `sending` e avança `claimed_revision` na mesma transação.

Somente `send_authorized: true` permite chamar a Meta. Replay sempre devolve
`send_authorized: false`. Timeout depois da autorização vira
`message.send.unknown`; não há retry cego. Callbacks tardios de uma reserva já
aceita podem concluir o estado mesmo após takeover.

### Teto e aviso de transferência (ADR 009, BOT-03)

O agente envia no máximo `automation_message_cap` (15) mensagens por Conversa,
contadas pelo CRM nas mensagens com autor `assistant`, inclusive envios
incertos. A última vaga é do aviso de transferência: com 14 mensagens, o CRM
recusa um `message.send.requested` normal com `409 AUTOMATION_MESSAGE_CAP`.

`handoff.requested` aceita `handoff.notice` (`command_id` e `text`). Na mesma
transação do handoff, o CRM reserva o aviso como mensagem do agente e responde
`notice.send_authorized: true`. Replay ou teto já gasto respondem `false`, e o
handoff acontece mesmo assim. O workflow só chama a Meta com `true` e depois
registra `message.sent` ou `message.send.unknown` pelo `command_id` do aviso.
O handoff pelo teto usa o motivo `iteration_limit` (migração 0025).

Takeover e handoff incrementam `automation_epoch`, invalidando decisões ainda
não reservadas. Status segue a ordem `sent < delivered < read` e nunca regride.

Uma mudança de entrega do comando de mensagem humana (`sent`, `failed` ou
`outcome_unknown`) atualiza a mensagem e publica um evento SSE na mesma
transação. O evento contém só o identificador da conversa; Inbox e Pedidos
reconsultam a API autorizada. A recuperação de lease ou fila incerta aplica o
mesmo sinal uma vez, sem rebaixar um envio já confirmado.

## Briefing, conversão e handoff

O agente recebe `recent_messages` e `briefing` na resposta inbound. Pode mandar
um `briefing_patch` junto de `message.send.requested` ou `handoff.requested`;
nulos são ignorados. Preço, pagamento, etapa e outros campos oficiais não são
aceitos nesse patch.

Inbound não cria Pedido. Na rodada em que a ficha ganha o primeiro dos sete
pontos, a reserva de envio ou o handoff leva `open_order: true` (ver "Pedido
criado pelo agente"). O bot não pergunta se pode montar o orçamento nem o nome
do pedido (ADR 010).
`convertida_em_lead` encerra a triagem, não a Conversa; ela só termina por
`Sem lead`, `Fechado` ou `Perdido` conforme as regras do domínio.

Todo handoff vai para Vendedor (ADR 009). O aviso ao cliente de que um
vendedor vai continuar vai junto do `handoff.requested` (`handoff.notice`),
conforme a ADR 009.

## Pedido criado pelo agente

### Abertura com `open_order` (ADR 014)

`message.send.requested` e `handoff.requested` aceitam o booleano opcional
`open_order`. O workflow o calcula pela regra da
[ADR 014](../../adr/014-pedido-abre-no-primeiro-ponto-da-ficha.md): `true` na
rodada em que a ficha (briefing anterior unido ao patch da rodada) ganha o
primeiro valor real de um dos pontos (ADR 021: o produto é o primeiro) e em
todas as seguintes; o nome sozinho e "Definir com o vendedor" não abrem, e o
que não é pedido do zero
(ADR 013) nunca abre. Um valor que não seja booleano, ou o campo em outro
evento, volta `400`. A autorização é a do próprio evento.

```json
{
  "schema_version": "1.0",
  "event_id": "reserve:<conversa>:<revisão>:ai-response",
  "event_type": "message.send.requested",
  "conversation_id": "<id da conversa>",
  "automation_epoch": 3,
  "source_revision": 7,
  "command_id": "<conversa>:<revisão>:ai-response",
  "message": { "type": "text", "text": "<resposta>" },
  "briefing_patch": { "quantity": 30 },
  "open_order": true,
  "occurred_at": "<ISO 8601>"
}
```

Depois que a transação do evento confirma, o CRM cria ou reutiliza o Pedido
pendente da conversa a partir da ficha já unida (sem pendente, cria um; com
pendente, reutiliza; só com pedidos confirmados, cria um novo: PCL-01..03) e
responde no mesmo corpo:

```json
{
  "accepted": true,
  "send_authorized": true,
  "order": { "opened": true, "id": "<pedido>", "created": true }
}
```

- Um pedido que já existia recebe a projeção da pré-ficha (`created: false`);
  um pedido criado agora já nasce da ficha unida.
- Replay da mesma `Idempotency-Key` tenta de novo e devolve `order` do mesmo
  jeito, sem novo pedido: um retry depois de uma falha abre o pedido.
- Uma falha ao abrir não falha o evento: a reserva continua autorizada e o
  handoff acontece. A resposta traz
  `"order": { "opened": false, "error": "<CÓDIGO>" }`, com o código de domínio
  (por exemplo `CONVERSATION_NOT_FOUND`), `ORDER_OPEN_FAILED` para qualquer
  outro erro ou `ORDERS_RUNTIME_UNAVAILABLE` sem o módulo de pedidos. O CRM
  grava a auditoria `integration.n8n.order.open_failed` na conversa e um log
  sem dados pessoais (código, conversa, correlação e tipo do evento).
- Sem `open_order`, ou com `false`, a resposta não traz `order` e nada muda no
  Pedido além da projeção de antes.

### Evento `order.intent_confirmed` (obsoleto)

Obsoleto desde a ADR 014: os workflows a partir de `mvp-simple-11` usam
`open_order`. O CRM continua aceitando o evento para os workflows antigos,
com as mesmas regras de criação.

Enviado em `POST /api/v1/integrations/n8n/events` quando o agente identifica a
intenção de compra. Usa os mesmos cabeçalhos dos demais eventos:
`Authorization: Basic`, `Idempotency-Key`, `X-Correlation-Id`,
`X-Silmer-Workflow-Key`, `X-Silmer-Workflow-Version` e `X-Silmer-Execution-Id`.
A credencial precisa da ação de automação `order.intent`, que não existe para
usuários humanos.

```json
{
  "schema_version": "1.0",
  "event_id": "<id único do evento no workflow>",
  "event_type": "order.intent_confirmed",
  "conversation_id": "<id da conversa devolvido pelo inbound>",
  "occurred_at": "<ISO 8601>"
}
```

`briefing_patch` continua aceito somente em `message.send.requested` e
`handoff.requested`; ele não acompanha este evento.

Regras:

- Conversa sem pedido pendente: o CRM cria exatamente um pedido `pendente`
  vinculado à conversa e ao contato, com número `NN-CRM` reservado.
- Conversa com pedido pendente: o CRM reutiliza o pendente; nenhum pedido novo
  é criado.
- Conversa só com pedidos confirmados: o CRM cria um novo pedido `pendente`.
- Idempotência: replay da mesma `Idempotency-Key` com o mesmo payload devolve o
  resultado original; a mesma chave com payload diferente retorna `409`.
  Intenções repetidas com chaves diferentes também não duplicam o pendente.
- O evento nunca confirma, reabre nem altera valor ou condição de pagamento.

### Projeção da pré-ficha no pedido pendente

Depois de unir o `briefing_patch` ao briefing da conversa, o CRM projeta os
campos da ficha no pedido `pendente` da conversa:

- Conversa com o agente (`automation_state = assistant`) e com pedido
  pendente: os campos são projetados no pedido.
- Conversa com vendedor (`automation_state = human`): o patch é ignorado para o
  pedido e o fato fica registrado na auditoria. A conversa não volta para a IA
  (ADR 015), então o pendente não recebe mais a projeção: o vendedor completa
  o pedido.
- Pedido confirmado nunca recebe projeção.
- Preço, valor, condição de pagamento, status e outros campos oficiais
  continuam recusados no `briefing_patch`, como antes.

## Workflow e configuração

- Workflow: `k7tI6T4RhQPyJkn9` — `Silmer | Atendimento WhatsApp IA`.
- Workflow DEV: `0S5ZS1xeDCSoWovs` — `DEV | Silmer | Fluxo completo sem
WhatsApp`. Ele deriva da mesma definição do MVP, recebe eventos sintéticos por
  `silmer/dev-mvp-flow`, usa a API real do CRM e simula apenas os dois envios
  pelo WhatsApp. O webhook CRM→n8n isolado é `silmer/dev-panel-command`. A
  versão DEV aceita `scenario: message`, `handoff`, `send_unknown` e
  `delivery_status`; o cenário só muda o envelope sintético, nunca grava dados
  diretamente no PostgreSQL. Além do webhook, há um **Chat Trigger** hospedado,
  restrito ao usuário autenticado do n8n. Ele atravessa o mesmo caminho CRM → IA
  → handoff/reserva → callback simulado e mostra a resposta no chat. A identidade
  WhatsApp sintética deriva do `sessionId` do Chat Trigger. Recarregar pode
  limpar o histórico visível sem trocar esse identificador: nesse caso, o CRM
  continua a conversa anterior. Para isolar um novo teste, use outra sessão do
  navegador ou o webhook DEV com um `wa_id` sintético inédito; não interprete
  uma janela vazia como conversa nova. O resultado do webhook DEV devolve
  `route` (`ai_reply`,
  `handoff` ou `no_action`), `trigger`, `handoff_reason`, `turn`, o
  `briefing_patch` da rodada, `open_order` e a resposta `order` do CRM (ADR
  014), para testes automatizados de conversa.
- Baseline preservada: `98f96069-ede2-4900-aa5c-7fec0d3b80cb`.
- Rascunho simplificado validado: `fae803db-eef0-4074-a7ae-1a6bb786e203`,
  com 42 nós e sem avisos estruturais.
- O workflow simplificado permanece inativo até credenciais e homologação.
- Vendedores do piloto: o nó `Montar contexto da IA (MVP)` usa a lista
  `sellers` do inbound. Diante de um CRM sem o BOT-03, ele lê os primeiros nomes
  da variável `SILMER_PILOT_SELLERS` do n8n, separados por vírgula, e conta o
  teto pelas mensagens do cliente. Os nomes não entram no repositório.
- São necessárias duas credenciais Basic distintas: n8n → CRM e CRM → n8n.
- Segredos não entram em export, repositório, log, chat ou Data Table.
- Persistência de execuções manuais/sucesso e progresso deve ficar desabilitada;
  falhas são sanitizadas e têm expurgo técnico em até 30 dias.

Gere o snapshot sanitizado da variante DEV com
`npm run generate:n8n-dev-workflow` e a variante localhost com
`npm run generate:n8n-local-workflow`. Para preparar um JSON importável a partir
de um export autenticado do workflow principal, execute
`node ops/n8n/workflows/create-dev-test-workflow.mjs <origem.json>
<destino.json> --deployment`. O arquivo de implantação preserva credenciais não
WhatsApp já vinculadas e referencia, somente por nome, as duas credenciais
Basic DEV. Nenhum segredo deve ser salvo no repositório.

### Loop local completo

`npm run dev` inicia um n8n em `127.0.0.1:5678`, com banco PostgreSQL e volume
próprios, sem acesso ao PostgreSQL do CRM. Ele importa uma única vez o workflow
`LOCAL | Silmer | Fluxo completo sem WhatsApp`, que expõe
`/webhook/silmer/local-mvp-flow` e `/webhook/silmer/local-panel-command`. O
container alcança a API local por `host.docker.internal`; o worker local alcança
o webhook por loopback. HTTP só é aceito neste caminho quando
`APP_ENV=development`, a opção explícita está ativa e o host é `localhost`,
`127.0.0.1` ou `::1`; qualquer endpoint operacional continua exigindo HTTPS.

Na primeira execução, crie o proprietário do n8n, vincule a credencial OpenAI
local ao nó `OpenAI - Modelo do MVP` e ative o workflow. A autenticação n8n →
CRM é um header Basic efêmero gerado pelo processo local; a autenticação CRM →
n8n continua sendo enviada pelo worker, mas o webhook local não a valida porque
está publicado apenas no loopback. Isso é uma conveniência de desenvolvimento,
não um substituto das duas credenciais Basic distintas dos ambientes DEV ou
operacionais. A importação não é repetida automaticamente para não apagar a
credencial OpenAI local.

O n8n remoto precisa alcançar `SILMER_PANEL_BASE_URL`; uma API executada apenas
em `127.0.0.1` não é acessível pelo host remoto. Para testar uma branch local
sem o loop acima, use um endpoint HTTPS temporário autorizado ou um ambiente
DEV publicado e aponte o worker do CRM para
`/webhook/silmer/dev-panel-command`.

## Rollout e recuperação

O CRM sempre aceita um campo novo do `briefing_patch` antes de o workflow
enviá-lo, porque uma chave desconhecida volta como `400`. Para o `collar` da
ADR 012, o CRM com o campo vai ao cloud-dev antes do workflow `mvp-simple-7`
(DEV `dev-mvp-simple-8`). Pelo mesmo motivo, o CRM que aceita `open_order`
(ADR 014) vai antes do workflow `mvp-simple-11` (DEV `dev-mvp-simple-12`); o
workflow anterior continua funcionando com o CRM novo, que ainda aceita
`order.intent_confirmed`. O workflow `mvp-simple-12` (DEV
`dev-mvp-simple-13`, ADR 021) não muda o contrato e não tem ordem de
implantação: `product_type` e o valor `NAO APLICAVEL` da gola já eram aceitos.
O CRM que aceita `audiences` no `briefing_patch` e lê a divisão por público
(ADR 022) vai ao ambiente **antes** do workflow `mvp-simple-13` (DEV
`dev-mvp-simple-14`), que envia o campo; um CRM antigo recusa a chave com
`400`, e a resposta do bot não sai. O workflow anterior continua funcionando
com o CRM novo.

1. Aplicar migrações com a integração desligada.
2. Implantar API e worker e configurar as duas credenciais Basic.
3. Testar o workflow inativo com dados sintéticos e o número Meta de homologação.
4. Homologar inbound → contexto → IA/handoff → reserva → Meta → status.
5. Publicar o workflow, transferir o webhook da Meta e desabilitar a entrada direta.

Rollback pausa ou despublica o workflow e preserva mensagens, comandos e itens
incertos para reconciliação. A rota direta não é reativada automaticamente.

## Diagnóstico rápido

- `401/403`: conferir credencial e capacidade do `AUTOMATION_EXECUTOR`.
- `409 STALE_AUTOMATION_FENCE`: a pessoa assumiu, chegou mensagem nova ou a
  revisão já foi respondida; não enviar.
- `send_authorized: false`: replay; não chamar a Meta novamente.
- `message.send.unknown`: reconciliar pelo `command_id` antes de qualquer ação.
- `order.opened: false` na reserva ou no handoff: o Pedido pendente não abriu,
  mas a resposta saiu e o handoff aconteceu. O workflow registra
  `workflow.failed` com `ORDER_OPEN_FAILED`; onde ver e o que fazer estão no
  [runbook do ator técnico](../../runbooks/automation-executor.md).
- mídia em quarentena/indisponível: abrir handoff e não afirmar que os bytes
  foram recuperados.

As próximas telas e a ordem de entrega estão em
[`docs/roadmap/PROXIMAS-FASES.md`](../../roadmap/PROXIMAS-FASES.md).

# Integração CRM Silmer ↔ n8n — MVP simples

> **Decisão vigente:** [RFC 002](../../rfc/002-simplificar-integracao-n8n-para-o-mvp.md)
> e [ADR 003](../../adr/003-adotar-integracao-n8n-mvp-simples.md). RFC 001 e
> ADR 002 são histórico da alternativa mais robusta. O Pedido criado pelo
> agente segue a [ADR 006](../../adr/006-pedido-dois-status.md).

## Objetivo e limite

O n8n recebe o webhook oficial do WhatsApp, registra a mensagem no CRM, usa o
contexto devolvido pelo CRM, decide entre resposta de IA e handoff e pede ao CRM
uma autorização de uso único antes de chamar a Meta. PostgreSQL continua sendo
a fonte da verdade. O n8n não acessa o banco e não mantém cópia paralela de
cliente, conversa, briefing ou memória curta.

## Pré-ficha guiada antes do handoff

Em cada mensagem de texto, a IA extrai somente fatos confirmados para o
`briefing_patch` criptografado da Conversa e pergunta pelo próximo dado
necessário. A pré-ficha reúne identificação do pedido, tipo/modelo de peça,
quantidade, malha, cores, grade, arte, técnica, locais de aplicação, data
desejada, finalidade, perfil de compra e modalidade logística. Entrega exige
cidade e endereço; retirada exige o local escolhido.

O workflow calcula de forma determinística os campos pendentes depois de unir o
patch ao briefing atual. Ele só emite `briefing_complete` quando todos os campos
aplicáveis estiverem presentes. Pedido explícito de pessoa, negociação,
reclamação, urgência, baixa confiança ou conteúdo não suportado continuam sendo
exceções de handoff imediato. Nenhuma informação inferida vira Pedido oficial,
catálogo, preço, prazo garantido ou pagamento. O agente pode criar um Pedido
`pendente`, que é rascunho não oficial; oficial é o Pedido `confirmado`, e a
confirmação permanece humana (ADR 006).

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
| Pedido              | `orders`                                | Criado `pendente` por `order.intent_confirmed`, nunca pela simples chegada de mensagem. Confirmar e reabrir são ações humanas.    |
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
   recebe reserva de envio, callbacks de entrega, handoff, intenção de compra e
   falha do workflow.

Eventos aceitos: `message.send.requested`, `message.sent`,
`message.delivered`, `message.read`, `message.failed`,
`message.send.unknown`, `handoff.requested`, `order.intent_confirmed` e
`workflow.failed`.

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

Takeover e handoff incrementam `automation_epoch`, invalidando decisões ainda
não reservadas. Status segue a ordem `sent < delivered < read` e nunca regride.

## Briefing, conversão e handoff

O agente recebe `recent_messages` e `briefing` na resposta inbound. Pode mandar
um `briefing_patch` junto de `message.send.requested` ou `handoff.requested`;
nulos são ignorados. Preço, pagamento, etapa e outros campos oficiais não são
aceitos nesse patch.

Inbound não cria Pedido. Quando o cliente confirma que quer orçamento, o
workflow emite `order.intent_confirmed` (ver "Pedido criado pelo agente").
`convertida_em_lead` encerra a triagem, não a Conversa; ela só termina por
`Sem lead`, `Fechado` ou `Perdido` conforme as regras do domínio.

Handoffs de negociação ou briefing completo vão para Vendedor. Pedido humano,
reclamação, urgência, baixa confiança e conteúdo não suportado vão para
Atendimento. Não há mensagem automática de confirmação no primeiro corte.

## Pedido criado pelo agente

### Evento `order.intent_confirmed`

Enviado em `POST /api/v1/integrations/n8n/events` quando o cliente confirma a
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
  pedido e o fato fica registrado na auditoria. Quando a conversa volta para a
  IA, o pendente volta a receber a projeção.
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
  → handoff/reserva → callback simulado e mostra a resposta no chat. Cada página
  de chat cria uma identidade WhatsApp sintética; o n8n não recarrega a sessão
  anterior, portanto atualizar a página inicia uma nova conversa de teste. Isso
  preserva o histórico oficial durante a conversa aberta, sem misturá-lo com uma
  nova sessão manual.
- Baseline preservada: `98f96069-ede2-4900-aa5c-7fec0d3b80cb`.
- Rascunho simplificado validado: `fae803db-eef0-4074-a7ae-1a6bb786e203`,
  com 42 nós e sem avisos estruturais.
- O workflow simplificado permanece inativo até credenciais e homologação.
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
- mídia em quarentena/indisponível: abrir handoff e não afirmar que os bytes
  foram recuperados.

As próximas telas e a ordem de entrega estão em
[`docs/roadmap/PROXIMAS-FASES.md`](../../roadmap/PROXIMAS-FASES.md).

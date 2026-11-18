# Saídas correntes do WhatsApp pessoal

WAP-E08 implementa WAP-T02-08, WAP-T03-01, WAP-T03-02 e WAP-T02-09.
Requisitos WAP-06/09/10/11/12/17/19/27/28/30.
Ver [ADRs 090 e 091](../adr/091-contratos-da-etapa1-whatsapp-pessoal.md) e
[contrato HTTP](../api/openapi.v1.yaml).

## Configuração e reserva

Aplicar a expansão `0082` antes de instalar os escritores. API e worker leem
`SELLER_WHATSAPP_SEND_ENABLED` com default `false` e
`SELLER_WHATSAPP_SEND_SELLER_IDS` com default `[]`. A flag ativa requer uma
allowlist JSON explícita. Use `ops/n8n/workflows/create-seller-whatsapp-evolution-workflow.mjs`
para gerar os candidatos inativos sobre o gerador Evolution anterior. O candidato do painel recebe
`personalSendLineIds` com IDs opacos das linhas autorizadas. Lista vazia no
workflow recusa comandos pessoais. A versão e a execução que obtiveram a
reserva são obrigatórias na autorização de despacho e na conclusão.

O comando humano guarda destino cifrado, conta, instância, binding, geração,
identidade e versão do vínculo. A fila, `message.send.requested`, a leitura
de mídia e o `POST` sem corpo em `commands/{commandId}/preflight` revalidam a
origem. O `POST` carimba `whatsapp_dispatched_at` uma vez, depois da validação
de destinatário e dos preparos da mídia existentes. O envio usa o mesmo
workflow e os mesmos nós Evolution de texto e mídia. O lock da linha ordena
o despacho com disconnect. A perda da resposta depois do carimbo exige
reconciliação, inclusive quando o provider ainda não recebeu a chamada.

Resultados do efeito iniciado usam a prova da reserva original mesmo depois
de disconnect ou revogação. O worker trata ACK genérico sem a conclusão CRM
como incerto. O evento `message.sent` só conclui envio pessoal com prova de
despacho, execução e origem. Use o ledger e o ID confirmado para reconciliar.
Uma geração nova não autoriza reaproveitar o comando antigo.

## Observações e anexos

O ingresso pessoal compartilha a configuração default off e a allowlist da
[E04](seller-whatsapp-inbound.md). `messages.upsert` com `fromMe: true` vira
`message.external.sent` v1 apenas após as guardas de origem. A API valida
conta, binding, instância, geração, relógio e destinatário individual. O fato
guarda a origem em `personal_whatsapp_external_sends` por conta e ID do
provedor. A Inbox mostra **WhatsApp da linha**. A origem expressa que o
provedor observou a saída da linha. Ela não identifica a pessoa ao teclado.

Eco e resposta podem chegar em qualquer ordem. A associação exige o mesmo
ID, conta, conversa e geração comprovados. A linha provisória cede lugar à
mensagem reservada do CRM, com autoria original e o melhor recibo conhecido.
Recibos que chegam antes da mensagem ficam no ledger existente, sem criar
conversa. Uma saída observada pode abrir atendimento humano com revisão inbound
zero. O fluxo não aciona o bot, não cria Pedido e não enfileira resposta.

Mídia observada usa consulta autenticada pelo ID na instância de origem e
upload em `attachments` com `X-Silmer-WhatsApp-Binding`. O CRM revalida o
binding antes de armazenar e vincular. Scanner, checksum, MIME e limites do
pipeline transitório seguem vigentes. Sem bytes válidos a Inbox mostra a
lacuna. Mídia retida do próprio CRM conserva a referência privada original.

## Cobrança e ficha

A intenção de cobrança prepara um destino com as versões de linha, identidade,
carteira e Contact. Na composição e no envio, a preparação ainda deve passar
pelas guardas de pedido, saldo, pagamento, responsável e revisão da conversa.
Se a preparação pessoal ficar obsoleta, a emissão autorizada da cobrança e
os callbacks financeiros continuam pelo contrato vigente. Pagamento repetido
registra uma vez. Reconectar não reemite nem reenfileira a cobrança anterior.

Com a expansão `0083` aplicada e a admissão de mídia privada disponível, um
vendedor habilitado pode usar **Enviar ficha pelo WhatsApp** no Pedido de
atendimento confirmado e ligado à sua linha pessoal ativa. A confirmação
exibe os finais da linha e do WhatsApp do cliente daquela conversa.
`GET /orders/{orderId}/pdf/whatsapp` admite a versão do Pedido e prepara o
destino. O POST recebe somente a versão, a preparação e a chave de idempotência.

O CRM gera a ficha canônica em PDF, passa pelo scanner e vincula a mídia
privada à mensagem e à fila na mesma transação. A reserva, a leitura dos bytes
e o despacho no n8n revalidam a linha, o destino e a versão do Pedido.
O nó Evolution de mídia envia o documento pela instância reservada.
O retorno HTTP 202 indica registro na fila. A conversa exibe o estado do envio.
O download e o compartilhamento nativo do PDF continuam disponíveis no Pedido.

## Primeiro envio individual (WAP-E10)

WAP-T04-03, requisitos WAP-22/23/24/32. O primeiro envio é opcional e
individual: abrir, salvar ou vincular Cliente não envia, e o atendimento
passivo e o Pedido não dependem dele. Não exige migração nova.

**Gate de liberação:** mantenha `SELLER_WHATSAPP_FIRST_SEND_ENABLED` desligada
em qualquer ambiente real até a homologação E12 provar que o JID da resposta
coincide com o `+E164` gravado. O `wa_id` brasileiro sem o nono dígito criaria
outro Contact e outra conversa. Não corrija isso por fusão de telefone: o
ADR 090 e a seção 6 do desenho proíbem unir Clientes pelo número.

- `GET /contacts/{contactId}/whatsapp/first-message-preview` não cria
  identidade, conversa, mensagem nem outbox. Devolve versões de Contact,
  vínculo e linha, geração, finais mascarados, `restriction` e `pendingSend`.
  `pendingSend` é verdadeiro quando algum ciclo da mesma linha e destino,
  ativo ou encerrado, tem envio do titular em `queued`, `sending` ou
  `outcome_unknown`.
- `POST /contacts/{contactId}/whatsapp/conversations` recebe texto, as quatro
  versões esperadas e `expectedConversation`, com `Idempotency-Key`, CSRF e
  Origin. `expectedConversation` repete `preview.conversation`: `null` ou
  `{id, version}`. Conta, instância e destino `+E164` vêm do servidor, a
  partir do telefone do Contact. O destino não pode ser o número confirmado
  da própria linha. O corpo recusa `to`, `userId`, `instanceName`,
  `accountId` e URLs. Responde 201, ou 200 no replay, depois de revalidar
  sessão, guardas, titular e vínculo ativo.

A guarda própria é `SELLER_WHATSAPP_FIRST_SEND_ENABLED`, com default `false`,
e `SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS`, com default `[]`. Com a flag ativa,
a allowlist JSON é obrigatória. Configuração inválida derruba a API na
partida. O vendedor também precisa constar nestas guardas:

- `SELLER_WHATSAPP_SEND_*`, para o envio pessoal;
- `SELLER_WHATSAPP_INBOUND_*`, para que a resposta do cliente seja aceita;
- `SELLER_CLIENTS_*`, para a carteira.

Uma guarda que nega responde 503 `SELLER_WHATSAPP_FIRST_SEND_DISABLED`, ou
403 fora das allowlists de primeiro envio e carteira. Só o Vendedor ativo,
titular da linha e com vínculo ativo próprio, usa a rota. Vendedor sem linha
recebe 503 `WHATSAPP_SEND_UNAVAILABLE`. Admin, Financeiro e usuário inativo
recebem 403 `FORBIDDEN`. Vínculo cadastral não dá acesso à conversa de outra
linha.

A transação única não faz HTTP e segue a ordem do inbound pessoal:

1. usuário/função e linha com binding atual, todos `FOR SHARE`;
2. advisory `n8n-conversation:evolution:{conta}:{destino}`;
3. recibo idempotente com chave `sha256([ator, chave])`;
4. advisory `identity:{hash}`;
5. Contact, identidade, vínculo e conversa, nessa ordem, com `FOR UPDATE`;
6. mensagem, comando n8n e outbox, conversa, evento e auditoria.

O teste concorrente com resposta inbound prova a ordem sem deadlock. Se a
identidade já pertencer a outro Contact, a rota responde 409
`WHATSAPP_IDENTITY_CONFLICT` genérico, sem reassociação. Uma conversa ativa
só é reutilizada quando é humana e do titular; caso contrário, responde 409
`CONVERSATION_UNAVAILABLE`. Uma conversa encerrada fica intacta e o envio
abre novo ciclo. A identidade nasce `confirmed`, a única opção do schema para
WhatsApp. O índice de busca por telefone só é preenchido pelo inbound.

Sob o lock da conversa, a rota confere primeiro a reconciliação. Um envio
anterior do titular em fila, despacho ou `outcome_unknown` responde 409
`WHATSAPP_OPERATION_UNCERTAIN` sem gravar nada. A conferência cobre todos os
ciclos da mesma conta e destino: encerrar a conversa não conclui um efeito
incerto, e o novo ciclo só abre depois da reconciliação. Ela lê apenas
mensagens do próprio titular. Depois, a conversa ativa deve
coincidir com `expectedConversation`, ou a rota responde 409
`CONVERSATION_VERSION_CONFLICT`. Duas abas da mesma prévia geram um 201 e
um 409, com uma mensagem e um outbox. Uma segunda mensagem exige o envio
anterior concluído e nova prévia, e reutiliza a conversa. O replay da mesma
chave responde 200 antes dessas conferências.

Os erros são:

- 400 `INVALID_REQUEST` ou `IDEMPOTENCY_KEY`;
- 403 e 404;
- 409 `CONTACT_VERSION_CONFLICT`, `WHATSAPP_GENERATION_STALE`,
  `WHATSAPP_IDENTITY_CONFLICT`, `CONVERSATION_UNAVAILABLE`,
  `CONVERSATION_VERSION_CONFLICT`, `WHATSAPP_OPERATION_UNCERTAIN` ou
  `IDEMPOTENCY_CONFLICT`;
- 422 `WHATSAPP_DESTINATION_INVALID`;
- 429;
- 503 `WHATSAPP_SEND_UNAVAILABLE` ou `SELLER_WHATSAPP_FIRST_SEND_DISABLED`.

Linha offline antes da reserva desfaz tudo. Depois da reserva, a mensagem usa
o caminho E08 sem alteração. Timeout fica `outcome_unknown` com item de
reconciliação. Não repita o envio às cegas: reconcilie pelo ledger.

Riscos residuais:

- O `wa_id` brasileiro pode omitir o nono dígito, e a resposta criaria outra
  identidade e outro Contact. Esse risco motiva o gate de liberação acima.
- Se um inbound de número novo vencer a corrida, a rota responde 409
  `WHATSAPP_IDENTITY_CONFLICT`. A interface trata o retorno como nova
  conferência; não há deadlock.
- Bloqueio ou outro erro do banco responde 503 `SERVICE_UNAVAILABLE`
  genérico, sem efeito gravado.

Para rollback, desligue `SELLER_WHATSAPP_FIRST_SEND_ENABLED`. Isso impede
novos primeiros envios e preserva identidades, conversas, mensagens,
comandos e incertezas. O ensaio usa o banco `crm_silmer_test_wap_e10` e
`node --test test/integration/seller-whatsapp-first-send.test.js`. A
evidência local não homologa o provedor nem o pareamento real.

## Ensaio local e rollback

Use PostgreSQL dedicado em loopback com banco `crm_silmer_test_wap_e08`.
`node --test test/integration/seller-whatsapp-outbound.test.js` exige esse
banco e aplica as expansões. O ensaio cobre duas contas, recibo adiantado,
eco/HTTP concorrentes, geração antiga, disputa com disconnect/revogação,
acesso à mídia, composição comercial obsoleta e replay financeiro. O cenário
da ficha usa Chromium para gerar o PDF e substitui scanner, armazenamento e
transporte externo por dependências sintéticas. Cobre autorização, confirmação
concorrente, integridade dos bytes, versão obsoleta, uma autorização de
despacho e resultado tardio. Os testes de workflow usam artefatos inativos.
O Playwright verifica teclas, foco e acessibilidade do diálogo em 390 e 1366 px.

Para rollback, desative o envio pessoal na API, worker e candidato n8n.
Se precisar suspender a observação de saídas e anexos, desligue também o
ingresso pessoal conforme o runbook E04. Preserve a expansão, os vínculos,
as provas e os efeitos incertos. Evite voltar a um escritor anterior que
desconheça saídas com zero revisões inbound, provas de despacho 0082 ou
documentos gerados pela expansão 0083.
Nenhum teste local valida pareamento, transporte real ou produção.

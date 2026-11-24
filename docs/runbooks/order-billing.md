# Cobranças InfinitePay — operação e recuperação

Estado atual conferido em10/11/2026, T9: emissão, envio pelo chat, recebimento e
conferência habilitados na API e no worker, com ORDER_BILLING_RECEIVE_ENABLED=true,
ORDER_BILLING_ENABLED=true e ORDER_BILLING_CHAT_SEND_ENABLED=true nos processos
reais. O proprietário autorizou ativar tudo antes de seu teste manual posterior.
Proteção de envio preservada no atendimento; Basic existente mantida. Nenhum
checkout, pagamento ou envio real foi ensaiado pelo agente. A ativação não
constitui homologação e alcança todos os operadores com as capacidades existentes.
[Evidência atual](../qa/order-billing-manual-activation-2026-11-10.md),
[janela anterior de recebimento](../qa/order-billing-receive-only-2026-11-10.md) e
[ativação/recuperação](order-billing-activation.md).

Integração para implantação em09/11/2026: migrações inéditas de cobrança
renumeradas de0063/0064/0065 para0073/0074/0075, preservando todas as migrações
da master/Olist. ADR066/067 desta branch passam a076/077 e RFC053 para060;
as decisões publicadas da master com os números antigos não mudam.
Implantar código não habilita emissão ou envio por si só. As flags foram
habilitadas depois, na janela T9 explicitamente autorizada acima, sem ensaio financeiro.

Preparação técnica de produção em08/11/2026:
[diagnóstico, candidatos inativos e pendências de implantação](../qa/order-billing-production-preparation-2026-11-08.md).
API/worker permanecem com emissão/envio desligados. A preparação não conclui
COB-OPS-01 nem autoriza teste financeiro real.

## Link de pagamento do CRM, 23/11/2026

[ADR 098](../adr/098-link-de-pagamento-do-crm-e-cobrancas-que-somam.md),
[LPC-01–09](../../.specs/features/order-billing/spec.md) e
[contrato](../api/order-billing-links.md). O cliente recebe
`{origem pública do CRM}/pagar/{token}`. O pagamento na InfinitePay só nasce
quando ele clica em **Pagar**. Cada clique cria uma tentativa pelo mesmo
caminho de hoje (outbox `billing.checkout.create`, worker, n8n); o n8n e o
worker não mudam.

### Publicação

- Aplicar a migração expand `0085_order_billing_links.expand.sql` antes da
  imagem nova, junto com as anteriores da versão. Conferir checksum e
  readiness.
- Conferir `APP_BASE_URL` na API: URL `https://` absoluta da origem pública do
  CRM. Sem ela, gerar ou enviar link falha com 503. O clique público exige
  `Origin` igual à origem de `APP_BASE_URL` ou a uma de `APP_ORIGIN`; se a
  página for servida por outro domínio, inclua-o em `APP_ORIGIN`, senão o
  clique recebe 403.
- O CRM do vendedor só mostra ou copia um link cuja origem é a mesma da
  página aberta (defesa contra um endereço estranho vindo da API: o vendedor
  nunca repassa ao cliente um domínio que não reconhece). Se o CRM for aberto
  por outro endereço que não o de `APP_BASE_URL` (domínio interno, IP,
  Tailscale), o link continua existindo, mas a seção mostra o aviso "O
  endereço deste link é diferente do endereço deste CRM, então ele não é
  mostrado nem copiado aqui…", some "Copiar link"/"Copiar mensagem" e
  nenhuma mensagem sai com o link vazio. **Enviar link na conversa** continua
  funcionando, porque a API monta a mensagem com `APP_BASE_URL`. Correção:
  abrir o CRM pelo endereço de `APP_BASE_URL` ou corrigir `APP_BASE_URL`.
  Aceitar outra origem no navegador foi recusado de propósito: a página não
  tem como saber qual origem é a oficial.
- Publicar a edge com o `docker/nginx.conf` novo: `/pagar/` serve a página e
  `/api/v1/payment-links/` vai à API, ambos sem access log nem error log, para
  o token não ficar em log. Conferir em produção que a página responde com
  `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` e
  `Cache-Control: no-store`, mantendo os demais cabeçalhos de segurança.
- Limites da rota pública: por token, GET 60/min e POST 10/min; por IP, GET
  120/min e POST 20/min. A página consulta a cada 2,5 s, a cada 5 s depois de
  20 s, até 60 s, e respeita `Retry-After`. Um cliente que recarrega muito
  recebe 429 e deve esperar um minuto.
- Cobranças antigas, sem link, não são mais criadas por humanos: as rotas
  antigas respondem 409 `BILLING_USE_PAYMENT_LINK`. As que já estão em
  andamento seguem com callback, consulta, conciliação e devolução.
- Sem flag nova. O clique só cria tentativa na InfinitePay com
  `ORDER_BILLING_ENABLED=true`. Só com `ORDER_BILLING_RECEIVE_ENABLED=true`, a
  página abre e o clique num link aberto mostra a falha, sem criar nada. Com as
  duas falsas, as rotas públicas não existem (404). Com alguma ligada, token
  inexistente, malformado ou cancelado recebe a mesma página "Link
  indisponível" ("Este link não está disponível. Fale com a Silmer pelo
  WhatsApp."), que não diz o motivo; a página do cliente também não anuncia
  sessão a leitores de tela.

### Estados de cada link

| Na tela              | O que significa                                          | O que fazer                                                      |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Aguardando o cliente | Enviado ou gerado, sem clique em Pagar                   | Copiar link ou Cancelar link. O valor está reservado.            |
| Em pagamento         | O cliente clicou e a InfinitePay criou o pagamento       | Aguardar ou **Verificar pagamento na InfinitePay**. Não cancela. |
| Resultado a conferir | Houve o clique, mas a resposta da InfinitePay não chegou | **Confirmar resultado na InfinitePay**. Não criar outro link.    |
| Recebido             | A InfinitePay confirmou                                  | Ver comprovante; devolução feita no provedor vira registro.      |
| Cancelado            | Cancelado antes do clique                                | Nada. Fica no histórico, fora da soma, com o motivo.             |

**Resultado a conferir.** O CRM pediu o pagamento e não sabe se a InfinitePay o
criou. O link fica travado e continua reservando o valor, para não cobrar duas
vezes. Ele aparece quando o n8n reservou a tentativa e não respondeu em 120 s,
ou quando o comando se perdeu depois da reserva. Se o comando morreu antes de
o n8n reservar a tentativa, o link volta sozinho a Aguardando o cliente
(evento "falha ao abrir"), porque o provedor nunca a cria. Na Situação, o
valor dele aparece como "A conferir", separado de "Em links abertos"; o
Próximo passo diz que o link não reabre sozinho e que nenhum pagamento novo é
criado até a confirmação.

Para resolver, procure o pedido no painel da InfinitePay e use **Confirmar
resultado na InfinitePay** na linha:

- Achou o pagamento: informe o código da fatura e o NSU. O CRM enfileira uma
  consulta (`payment_check`). Pago: o link vira Recebido. Não pago e com a
  validade da tentativa vencida: a tentativa é encerrada e o link volta a
  Aguardando o cliente. Não pago antes da validade: continua em Resultado a
  conferir; repita depois da validade.
- Não achou nada: confirme sem identificadores depois da validade da
  tentativa (24 h). Antes disso, o CRM recusa com "ainda válido".

O link incerto nunca reabre sozinho pelo vencimento. Enquanto isso, não envie outro link para
o mesmo valor e não registre pagamento por fora sobre ele: o registro é
recusado. A página do cliente mostra "Não conseguimos abrir o pagamento
agora", e um novo toque não cria outra tentativa.

**O cliente diz que o link está cancelado.** A página dá a mesma resposta para
link cancelado, inexistente ou digitado errado. Abra as movimentações do
pedido: o link cancelado mostra quem cancelou e o motivo (vendedor, mudança de
valor do pedido, pagamento por fora ou conciliação). Se ainda falta receber,
use **Enviar outro link**. Se o cliente usou um link antigo, use **Copiar
link** na linha aberta. Nunca peça ao cliente o link nem o token por escrito
para investigar; o token não vai para log.

**Pagamento vencido e novo clique.** O pagamento na InfinitePay vale 24 h. Se
vencer sem ser pago, o link volta a Aguardando o cliente e o próximo clique
cria um pagamento novo. Não existe mais "Link vencido", "Gerar novo link" nem
"Encerrar link vencido". Se a tentativa vencida for paga depois, o pagamento é
registrado e vai para Precisa de conferência; não quita outro acordo sozinho.
Se o cliente fechou a aba depois de clicar, a página mostra "Continuar na
InfinitePay", com o mesmo pagamento.

**Cancelar perdeu para o clique.** O servidor decide quem chegou primeiro. Se o
cancelamento for recusado com "o cliente clicou em Pagar", acompanhe o
pagamento. Se o cliente pagar um valor que não cabe mais, vai para conferência.

**Mudança de valor do pedido.** Os links ainda não clicados são cancelados
sozinhos, com o motivo "mudança de valor". Confira a Situação e envie um link
novo com o livre para cobrar. Links já clicados seguem para conferência quando
necessário. Em Precisa de conferência, **Resolver conferência** pode aplicar os
pagamentos mesmo com link Em pagamento, ou cancelar os links abertos.
Durante a conferência a Situação não mostra "Livre para cobrar" (a API
recusa link novo com `BILLING_REVIEW_REQUIRED`). Se o dinheiro guardado é um
recebimento registrado por fora (por exemplo, Pix fora da InfinitePay), o texto
diz isso e pede para conferir o registro, não o painel da InfinitePay; a linha
do registro aparece como "Guardado para conferência".

**Pedido cancelado.** Os links Aguardando o cliente são cancelados sozinhos,
com o motivo "pedido cancelado"; a página mostra "Link indisponível". Na
seção do pedido, a Situação mostra "Pedido cancelado · Nada a receber", sem
"Falta receber" nem "Livre para cobrar", e não há ação de cobrança. Tentativas já
clicadas seguem a regra de pedido cancelado: o pagamento fica como evidência,
sem ser aplicado.

**Pagamento em dobro.** Quando um pagamento quita o link, outra tentativa dele
que já exista na InfinitePay vai para conferência. Confira no painel se o
cliente pagou duas vezes; devolução feita no provedor vira registro.

**Conflito de versão.** Um vencimento aplicado numa leitura (pela página do
cliente ou por outra aba) sobe a versão da cobrança. Um diálogo do vendedor
aberto antes recebe conflito de versão: feche, releia o pedido e repita a
ação. É esperado e não perde dados.

**Pagamento por fora.** Vale até o livre para cobrar. Se o valor depende de
links Aguardando o cliente, a mesma confirmação cancela esses links e registra
o recebimento. Se o valor além do livre está num link Em pagamento ou
Resultado a conferir, o registro é recusado: verifique ou confirme o link
antes. Se o cliente clicou num link escolhido para cancelar enquanto o diálogo
estava aberto, o registro é recusado sem efeito; atualize e revise.

**Parar novos pagamentos (rollback).** Desligue `ORDER_BILLING_ENABLED` na API
e no worker e mantenha `ORDER_BILLING_RECEIVE_ENABLED=true`. Nenhum clique cria
pagamento novo; a página continua abrindo e o clique mostra a falha. Se quiser
encerrar de vez os links já enviados, cancele os Aguardando o cliente.
Pagamentos já criados na InfinitePay continuam pagáveis até vencer, e os
callbacks continuam chegando.

## Continuação de 08/11/2026

Recebimentos externos, conferência de pagamento e interface real no redesign
foram autorizados na [ADR077](../adr/077-recebimentos-externos-e-conciliacao-de-cobrancas.md).
Contrato em [pagamentos](../api/order-billing-payments.md); ambiente local em
[DEV interativo](billing-development.md); requisitos e evidências em
[order-billing-completion](../../.specs/features/order-billing-completion/spec.md).
As seções históricas abaixo descrevem as entregas anteriores. Nenhuma delas
nem a nova implementação habilitam produção ou transações reais.

## Backend do envio integrado, B01–B05 (06/11/2026)

Migração expand `0073_order_billing_send_intents` cria intenções, snapshots
de autorização/acordo e eventos append-only. A migração expand 0074 acompanha
o estado real do transporte. API e worker integram as filas existentes com
mensagem, comando, auditoria e invalidação da Inbox na mesma transação.
Não alterar migrações anteriores; aplicar todas as migrações da versão antes
de futura ativação, incluindo as entregas da master incorporadas em 08/11/2026.

No encerramento histórico B01–B05, o backend foi validado com PostgreSQL e dados
sintéticos e emissão/envio real estavam desligados. A orientação original de
ligar `ORDER_BILLING_CHAT_SEND_ENABLED=true` somente após homologação foi
substituída pela autorização explícita de T9 registrada no início deste runbook.
A interface integrada ainda dependia
do protótipo/design; contrato e implementação estão na
[ADR 076](../adr/076-intencoes-de-cobranca-e-envio-transacional.md) e na
[API de intenções](../api/order-billing-chat.md).

`waiting_link` aguarda a composição; link existente válido/retry seguro podem
compor imediatamente. Emissão cria o job financeiro na mesma transação;
link existente/retry não criam outro job de checkout. O n8n financeiro não
envia mensagens: a entrega usa a reserva humana e o preflight da Inbox.

Rollback é por flag, preservando tabelas/URLs/recebimentos. Aplique a orientação
financeira ao final deste runbook e mantenha recebimento/reconciliação dos
links existentes. Não usar DROP ou apagar intenções/eventos para desfazer
uma operação comercial. Banco local sintético não comprova deploy ou recovery
remotos. Evidências de B02 no relatório de QA da entrega.

[ADR 058](../adr/058-cobrancas-do-pedido-com-infinitepay.md),
[RFC 049](../rfc/049-cobrancas-do-pedido-com-infinitepay.md),
[COB-01–16](../../.specs/features/order-billing/spec.md) e
[COB-DEL-01/COB-OPS-01](../../.specs/features/order-billing/tasks.md).
Contrato HTTP: [OpenAPI das cobranças](../api/order-billing.v1.json).

## Fluxo e limites

Responsável/admin abre pedido confirmado, escolhe 0%, X% ou 100%, revisa
valor e gera link. 0% salva sem emitir, 50% cobra sinal e depois saldo, e 100%
cobra integral. O cliente escolhe Pix/cartão e parcelas na InfinitePay.
Compartilhamento é humano. “Pago parcialmente” não muda o status comercial
nem qualifica quitação do Financeiro. A interface real não tem simulação.

A interface existente usa compartilhamento manual. O backend do comando
**Gerar e enviar cobrança**, definido na
[RFC 047](../rfc/047-enviar-cobranca-pela-conversa.md), está integrado com
flags desligadas. Protótipo atualizado da entrada pelo chat precede a
implementação da interface e não habilita envio real.

Links em revisão, de pedido reaberto, vencidos ou com leitura desatualizada
não são oferecidos para compartilhamento normal. O acesso ao link anterior
fica explicitamente na conferência; isso não cancela o link no gateway.
Para links do CRM (23/11/2026), valem a condição como sugestão do primeiro
link, os vários links que somam e o cancelamento antes do clique descritos
na seção do link de pagamento acima.

A conta da loja é reaproveitada, mas o workflow e os IDs das cobranças do CRM
são próprios. Não apontar essa rotina para `store-orders` nem reutilizar a
Data Table da loja. No atendimento, a alteração autorizada é somente a guarda
de preflight revisada, preservando os nós e ramos originais; conferir versão
publicada e diff conforme o roteiro de ativação coordenada.

## Configuração

| Processo   | Variável                                                   | Uso                                                                                                                     |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| API        | `ORDER_BILLING_ENABLED=true`                               | Configuração e novas emissões; implica receber callbacks.                                                               |
| API        | `ORDER_BILLING_RECEIVE_ENABLED=true`                       | Mantém leitura, callbacks e conciliação quando emissão está desligada.                                                  |
| Worker     | `ORDER_BILLING_ENABLED=true`                               | Inicia consumidor da fila `billing`.                                                                                    |
| Worker     | `ORDER_BILLING_N8N_URL`                                    | URL HTTPS privada do webhook de emissão do workflow dedicado.                                                           |
| API/Worker | `ORDER_BILLING_CHECK_N8N_URL`                              | URL privada da conferência; publicar o workflow dedicado e configurar nas duas aplicações antes de oferecer a consulta. |
| API        | `N8N_INTEGRATION_ENVELOPE_KEY`, `IDEMPOTENCY_ENVELOPE_KEY` | Chaves existentes, válidas, de 32 bytes em base64. Nunca versionar.                                                     |
| API        | `CRM_AUTOMATION_CLIENT_ID/SECRET`                          | Credencial Basic existente do n8n → CRM, com capacidades técnicas específicas.                                          |
| Worker     | `N8N_COMMAND_CLIENT_ID/SECRET`                             | Credencial Basic existente do CRM → n8n.                                                                                |

Sem flags, as rotas e a seção ficam desabilitadas. Não habilitar emissão
sem ter configurado e conferido o workflow/conta. Em desenvolvimento somente,
o worker admite HTTP de loopback quando `N8N_COMMAND_ALLOW_INSECURE_LOCAL=true`.
Produção exige HTTPS e não segue redirects no transporte financeiro.

## Workflow n8n — preparar antes de ativar

### Desenvolvimento isolado antes da produção

O perfil de desenvolvimento usa o mesmo gerador/grafo financeiro com caminhos
`silmer/order-billing-dev/create` e `silmer/order-billing-dev/paid`, credenciais
sintéticas e destinos HTTP locais validados. Gerar export inativo:

```powershell
node ops/n8n/workflows/create-order-billing-dev-workflow.mjs var/billing-dev-workflow.json
```

O comando recusa sobrescrever o destino. Não importar esse arquivo no n8n de
produção nem vincular credenciais reais. A exportação de produção abaixo
continua independente e inativa por padrão. A configuração DEV não aceita
domínio remoto, InfiniteTag real, expressão ou credencial embutida.

O ensaio completo da fronteira financeira roda em containers exclusivos:

```powershell
$env:RUN_BILLING_LOCAL_SMOKE = 'yes'
node scripts/billing-development-smoke.mjs
```

Requer Docker local, dependências do projeto e a versão Node fixada em
`.node-version`. Usa n8n 2.38.7, runtime/rotas/worker financeiros reais e
PostgreSQL 17 dedicado. A rede Docker é interna, sem saída externa; nenhuma
porta é publicada. O runner controla HTTP por `docker exec` dentro da rede
isolada e cria seus próprios recursos. Não reaproveita nem reseta o banco DEV
persistente ou containers existentes.
O estado do n8n é descartável e separado do n8n de atendimento.

O simulador HTTP verifica os pedidos de `/links` e `/payment_check`; o
pagamento só muda quando o roteiro de teste o confirma. As URLs devolvidas
são fixtures no formato HTTPS aceito pelo domínio financeiro, não checkouts
locais nem links para abrir. Nenhuma chamada InfinitePay ou WhatsApp real
pertence a esse roteiro. Relatórios sintéticos ficam em
`var/billing-development-*/report.json`; verificar o veredito e os cenários,
não apenas a subida dos containers. Recursos Docker próprios são removidos
ao final, inclusive em falha; os artefatos de diagnóstico locais permanecem.

O ensaio não é um servidor DEV permanente nem prova de login/sessão ou UI.
O adaptador de sessão humana é sintético; autenticação técnica, rotas,
reserva, persistência e worker financeiro usam a implementação do projeto.
Mensagem na outbox comprova composição, não execução do transporte. O ensaio
do workflow humano/preflight/envio simulado, a matriz completa de correção e
a interface pós-redesign continuam no plano da RFC 047. Homologação real
segue COB-OPS-01. Não habilitar flags remotas por ter aprovado o simulador.

### Exportação para o candidato de produção

Gerador reproduzível, sem segredos, produz um export **inativo**:

```powershell
node ops/n8n/workflows/create-order-billing-workflow.mjs <destino-privado.json> [config-publica.json]
```

Configuração opcional contém somente `crmBaseUrl`, `handle` e `webhookUrl`.
Sem ela, preencher os dois nós “Configurar…” após importar. Esses campos
ficam em Edit Fields/Set, sem depender de custom variables de plano pago.
`crmBaseUrl` é a base HTTPS do CRM, sem `/api/v1`; `handle` é a InfiniteTag
da conta conferida; `webhookUrl` é o endereço publicado do webhook de aviso
`silmer/order-billing/paid`. Não usar endereços `webhook-test`.

Vincular pelas credenciais privadas do n8n:

- `Silmer CRM para n8n Basic`: credencial recebida pelo webhook de emissão,
  igual à usada pelo worker.
- `Silmer n8n para CRM Basic`: credencial do ator técnico da API.
- `InfinitePay Checkout API Key`: Header Auth com nome `X-Api-Key`. Cadastrar
  pela interface privada; nunca copiar para export, config pública ou chat.

Conferir ambos os nós de configuração e todos os vínculos de credencial.
Export mantém execuções sem payload salvo em sucesso/erro/manual. Confirmar
também política global de logging/retenção do n8n; não registrar corpos,
links, cabeçalhos de autenticação ou respostas completas do provedor.

O webhook privado `silmer/order-billing/create` recebe somente
`{schema_version:"1.0",charge_id:"<UUID da cobrança>"}`. A reserva na API
devolve `allowed:true` uma vez por cobrança. Só essa execução cria `/links`,
sem retry; a configuração fixa `single_payment` e validade de 24h. Não
confundir HTTP recebido pelo n8n com link salvo no CRM.

O webhook de aviso é público: seus identificadores são candidatos, não
prova. O workflow consulta a cobrança conhecida na API, chama `payment_check`
com a conta configurada, confere principal/meio/parcelas e persiste callback
autenticado antes do ACK. Falha não deve virar resposta 200 de sucesso.

Referências oficiais: [InfinitePay](https://www.infinitepay.io/checkout-documentacao)
e [limites do n8n Community](https://docs.n8n.io/deploy/host-n8n/community-edition-features/).

## Publicação ordenada

O registro global de transações normaliza caixa somente para NSUs no formato
UUID canônico; identificadores opacos preservam caixa. A migração falha se o
histórico já contiver o mesmo UUID em caixas diferentes: conferir a origem e
resolver a duplicidade antes de prosseguir, sem descartar recebimentos.

1. Gates locais/CI, revisão e commit da entrega. Confirmar imagem/digest da
   versão aprovada; o push de branch por si só não comprova publicação.
2. Aplicar as migrações da versão, incluindo expand `0055_order_billing`,
   `0073_order_billing_send_intents`, `0074_billing_send_transport` e
   `0075_billing_external_receipts_and_checks` e
   `0085_order_billing_links.expand.sql`,
   no ambiente alvo **antes de habilitar flags**; conferir checksum e readiness. Não editar migrações
   anteriores nem copiar um banco sintético para o remoto.
3. Publicar API/worker/edge da mesma entrega, inicialmente sem emissão.
4. Importar o workflow dedicado, preencher configuração não secreta,
   vincular credenciais e conferir a conta da loja. Preservar checkout e
   atendimento existentes. Só então publicar o workflow.
5. Configurar recebimento na API, URL do worker e emissão em ambos; conferir
   health e a seção Cobranças no pedido autorizado.
6. Homologar pagamento real de baixo valor previamente autorizado; testar
   reentrega, cartão/parcelas quando aplicável, saldo, conciliação e retorno.
   Não cobrar cliente real nem executar transação de teste sem autorização.

## Conferência e recuperação

`queued` aguarda o worker; `creating` tem reserva consumida; `waiting` tem
link salvo e aguarda pagamento. `unknown` pode existir depois de timeout ou
reserva parada: **não recriar outro link**. Conferir o pedido/cobrança e o
painel da InfinitePay. Callbacks tardios podem completar o resultado.

Reabertura/mudança de preço ou condição invalida aplicação ao acordo atual,
preservando pagamentos. Em Conferir cobrança, `apply_current` exige declarar
a conferência no provedor e reaplica recebimentos existentes ao acordo
vigente; não recebe dinheiro nem inventa nova transação. Cobertura insuficiente
continua com saldo; acima do devido exige revisão/devolução.

`close_unpaid` exige validade vencida, ausência de pagamento e conferência
explícita no painel. Não cancela o link no gateway nem ignora callback tardio:
um recebimento posterior fica em revisão. Não usar encerramento da conversa
ou troca de vendedor como descarte de cobrança. Desde a ADR 098,
`close_unpaid` fecha as cobranças antigas, sem link, e as tentativas de link
sem pagamento retidas em conferência; o link volta a Aguardando o cliente, ou
é cancelado se o acordo mudou. Links do CRM não clicados saem por
cancelamento. **Aplicar os pagamentos** é recusado quando o recebido mais
todos os links que reservam passam do total: cancele links abertos antes.

Para refazer uma cobrança de plano anterior à entrada fixa de 50%, confirme
o pedido, confira a ausência de pagamento na InfinitePay e encerre o link
depois do vencimento. Com todas as cobranças anteriores encerradas e nenhum
crédito aplicado, escolha a condição atual e revise o novo valor antes de emitir.

Registrar devolução só depois de fazê-la/conferi-la na InfinitePay. Informar
valor devolvido no comando da cobrança, com idempotência e versões; isso
reduz o crédito aplicado, preserva o original e invalida quitação/check quando
necessário. Resultado HTTP incerto deve repetir a mesma intenção/chave,
sem abrir outra devolução enquanto a primeira não for resolvida.

“Pago em” é derivado do livro de recebimentos nos pedidos geridos. Uma data
manual antiga não prova valor recebido; conferir e corrigir o lastro antes
da primeira emissão. Não contornar a API com SQL de ajuste em produção.

## Rollback

### Envio integrado pela conversa (COB-CHAT-B03/B04)

Aplicar as migrações expand 0073, 0074 e 0075 antes da imagem compatível; conferir
checksums. `ORDER_BILLING_CHAT_SEND_ENABLED` permanece ausente/false por
padrão na API e no worker e exige também `ORDER_BILLING_ENABLED=true`.
Configuração true sem banco, autorização ou outbox funcional impede startup
da API. A chave `INBOX_MESSAGE_ENVELOPE_KEY` cifra a mensagem; as chaves
financeira e da identidade mantêm seus contextos separados.

Antes de futura ativação, preparar uma cópia da exportação privada do
workflow humano existente, preservando credenciais e IDs:

```powershell
node ops/n8n/billing-send-preflight.mjs <export-privado.json> <review-novo.json>
```

O patch local é idempotente, recusa drift/contexto parcial e não sobrescreve
arquivos nem publica o workflow. O gerador Evolution histórico permanece
intacto; aplique o patch explicitamente sobre o candidato inativo ou sobre
uma exportação privada conferida. Conferir Basic técnico, os headers de execução e o nó
preflight imediatamente anterior ao envio de texto humano marcado
`billing_send:true`. Só `{valid:true}` permite envio. O fluxo financeiro
continua criando links e recebendo callbacks, sem enviar WhatsApp diretamente.

O desligamento da flag na API e no worker impede novas intenções/reservas e
bloqueia mensagens ainda elegíveis, preservando link, histórico e recebimentos.
Envio comum da Inbox permanece independente. Consulta e recebimento exigem
`ORDER_BILLING_ENABLED=true` ou `ORDER_BILLING_RECEIVE_ENABLED=true` na API.
Não apagar migrações/envelopes durante rollback. Intenções bloqueadas não
voltam automaticamente à fila ao religar a flag.

`waiting_link`/`queued` podem ser bloqueadas por pagamento/contexto alterado.
`sending` precisa de preflight vigente; uma mudança depois do preflight não
prova que o HTTP externo foi interrompido. Aguardar confirmação ou registrar
incerteza. `unknown` exige conferência e não admite retry. `failed` só permite
nova intenção humana quando há prova de falha anterior ao envio e link válido;
falha de entrega com ID externo não satisfaz essa condição. Callback tardio
da execução original pode completar o resultado sem duplicar o recebimento.

Nenhuma publicação remota, flag real ou transação financeira foi executada
por esta entrega. Frontend integrado ao redesign na continuação de 08/11/2026;
homologação segue COB-OPS-01.

### Emissão financeira

Desligar `ORDER_BILLING_ENABLED` na API e no worker; manter
`ORDER_BILLING_RECEIVE_ENABLED=true` na API e o workflow de callbacks ativo.
Não excluir tabelas, chaves, credenciais, URLs ou histórico enquanto houver
links/pagamentos em circulação. A seção conserva consulta e conciliação.
Reverter para imagem anterior sem suporte a callbacks requer manter uma
instância compatível até concluir todos os recebimentos pendentes.

## Evidência

Os testes de domínio/rotas, PostgreSQL real sintético, worker/workflow e
E2E/axe distinguem implementação local de estado operacional. A fixture
executa código e expressões do export com respostas sintéticas; não comprova
importação/execução no n8n real. O runner de desenvolvimento acrescenta essa
prova local: importa/publica exclusivamente no container efêmero e percorre
o motor n8n por HTTP, com simulador e PostgreSQL dedicados. Isso não comprova
transporte WhatsApp, login/UI ou operação remota. Registros de gates e pendências ficam em
[tasks](../../.specs/features/order-billing/tasks.md).

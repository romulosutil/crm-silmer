# WAP-E04 — atendimento pessoal e isolamento

Contrato: WAP-04–08/10/11/17/20/21/28/29/32, WAP-T02-05/06/07,
[ADRs 090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md),
[091](../adr/091-contratos-da-etapa1-whatsapp-pessoal.md) e
[092](../adr/092-sanitizacao-pre-persistencia-e-geracao-na-origem.md).
Complementa [controle](seller-whatsapp-control.md),
[carteira](seller-clients.md) e [visibilidade](conversation-visibility.md).
Esta entrega é código e prova sintética; não autoriza publicar workflow, parear,
ativar flags reais ou enviar a clientes. Não homologa Evolution ou produção.

## Ingresso e transação

O callback Evolution captura a origem antes da fila. O sanitizador n8n valida
instância/token por geração antes da primeira persistência e descarta o token.
O workflow pessoal compartilhado usa `personalInbound: true`, allowlist de
linhas e caminho reservado `silmer/seller-whatsapp/*`; não criar cópia por
vendedor nem acoplar o ramo à jornada da linha geral. Nenhum QR/código/token,
chave de mídia ou objeto bruto passa à execução persistida.

`POST /api/v1/integrations/n8n/messages/inbound` conserva Basic técnico,
headers de workflow/correlação/execução/idempotência e schema 1.0 existentes.
O ramo pessoal exige a identidade técnica `seller-whatsapp-inbound/1.0`,
fixada no factory e conferida novamente no ingresso e callbacks.
Na conta pessoal Evolution exige `source: {bindingId,lineId,accountId,generation}`
autenticada pelo ingresso. Não aceitar geração arbitrária do callback nem
substituí-la pela atual. API compara novamente binding, conta, linha, titular,
estado, corte temporal e geração sob locks, inclusive em replay.

`SELLER_WHATSAPP_INBOUND_ENABLED` é **false** por padrão;
`SELLER_WHATSAPP_INBOUND_SELLER_IDS` é allowlist JSON, vazia por padrão.
Ausência, desativação ou exclusão da allowlist nega o ingresso pessoal; não
recai na linha geral. As guardas de controle e o workflow técnico continuam
independentes. Nenhuma flag de envio é habilitada por receber atendimento.

Ordem de locks: usuário → linha → descoberta da identidade → Contact →
identidade → conversa → evento. A descoberta pessoal não bloqueia identidade
antes do Contact; movimento concorrente da identidade exige nova revisão.
Cliente oficial, vínculo comprovado e conversa humana atribuída ao titular
entram na mesma transação; rollback desfaz todos. Sem janela pública sem dono,
IA, resposta automática, importação incidental ou Pedido.

Titular inativo conserva a mensagem cifrada na conversa humana atribuída ao
titular, em pendência administrativa privada (`requer_atencao`). Não criar
vínculo novo nem oferecer claim/transferência genéricos. A expansão 0079 guarda
somente origem imutável da mensagem e indicador `administrative_pending`;
conteúdo segue os envelopes e a retenção de mensagens já existentes.

Deduplicar por conta/ID externo e recibo idempotente. Evento repetido não
incrementa revisão nem muda titular. Reconexão mantém conta/Contact/história,
mas a geração anterior não recebe relabeling. Callback antigo é recusado antes
do replay/efeito. Resultado externo incerto exige reconciliação do ledger;
nunca autoriza retry criador cego.

No teste WAP-09/WAP-T05-06, usar uma conversa individual iniciada antes do
pareamento. Com a linha conectada, conferir no mesmo histórico uma entrada do
outro número e uma resposta escrita no WhatsApp do titular. Conferir horário,
direção e uma ocorrência de cada mensagem. No workflow pessoal, os nós Code
em modo `runOnceForEachItem` retornam `null` para encerrar o ramo que não
corresponde ao evento. Retornar uma lista vazia pode interromper a execução
antes de registrar a saída observada.

## Leitura, comandos e revogação

O predicado compartilhado de conversa exige, para linha pessoal, titular,
posse elegível e vínculo ativo ao Contact atual. Linha sem dono permanece
privada. Desconexão conserva a história autorizada. Vínculo comum não abre
conversa, pedido, preço, cobrança ou recebimento de outro vendedor.

Aplicar escopo antes de busca/count/cursor/paginação/joins em Inbox e
handoffs; detalhe, contexto do assistente, mídia temporária/retida, Assuntos,
sugestões de Pedido e histórico seguem a conversa. Leituras comerciais mantêm
ACL própria. Candidatos de Pedido em Assuntos também exigem ACL comercial.
Lembretes pessoais e ações/projeções da Central obedecem ao mesmo isolamento
nas linhas pessoais; os lembretes da linha geral conservam o contrato anterior.
Transferência genérica pessoal é recusada inclusive para Admin; sucessão é
etapa futura. Mutações e recibos revalidam acesso dentro da transação.

SSE revalida sessão/capacidade a cada projeção e heartbeat. Payload público
usa allowlist de tipo e IDs mínimos, inclusive para Admin; nunca valores
cadastrais, corpo de mensagem, QR ou token. Conversa oculta vira `stream.reset`
com `{}`. O heartbeat de 15 segundos compara digest do escopo e invalida telas
mesmo sem novo evento. Cursores de Inbox/handoffs incluem digest de
posse/linha/vínculo/capacidades; cursor anterior não continua em outro escopo.

Na UI, invalidação aborta leituras, remove relações e projeções privadas e
nega retorno atrasado. Cadastro compartilhado pode preservar rascunho comum
autorizado enquanto revalida relações; conflito avisa sem identificar outra
carteira. A recusa de contato/Assuntos também limpa a conversa. Criar pedido
continua no cabeçalho conforme `d7537b3c`.

## Ensaio dedicado e recuperação

Usar somente loopback e banco `crm_silmer_test` sintético. As suítes novas
recriam seu próprio schema; executá-las serialmente, nunca contra operação.
Rodar testes focais, as suítes PostgreSQL `seller-whatsapp-inbound` e
`seller-conversation-access`, E2E `seller-whatsapp-isolation` e gates de
CONTRIBUTING. CI inclui as duas suítes novas no job PostgreSQL obrigatório.

Rollback operacional: desligar ingresso pessoal e remover suas allowlists
antes de reverter escritor/workflow. Conservar expansão 0079, bindings,
carteiras, envelopes e histórico. A versão restaurada deve manter o predicado
de isolamento e recusar contas pessoais; código anterior ao isolamento não é
rollback seguro de leitura. Não apagar vínculo/linha/mensagem para recuperar
envio e não reaproveitar evento de geração antiga. Controle incerto segue
reconciliação, sem pareamento ou logout repetidos automaticamente.

Arquivos fora da fronteira inicialmente prevista são necessários para esta
mesma entrega: readers/guards de mídia em `integration-reliability`, runtime
de mídia inbound, readers de handoff em `work-management`, runtime de Assuntos
e claim, guards de contexto de frete e motivo de perda, projeções de conversa
no Pedido comercial, lembretes/Central, sanitizador pré-persistência E01,
expansão 0079, OpenAPI, CI e mocks
dos testes desses contratos. Não introduzem infraestrutura ou dependências.

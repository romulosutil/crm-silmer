# Saídas correntes do WhatsApp pessoal

WAP-E08 implementa WAP-T02-08, WAP-T03-01 e WAP-T03-02 e cobre a parte de
cobrança e versão da ficha de WAP-T02-09. Requisitos WAP-06/09/10/11/12/17/19/27/28/30.
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

A preparação para o compartilhamento móvel da ficha consulta o PDF com
`expectedVersion`. A API confere versão e autorização após renderizar. O
navegador mantém o PDF preparado associado ao Pedido e à versão exibidos.
A folha nativa de compartilhamento entrega um arquivo local, e o sistema
operacional permite que a pessoa escolha a conta e o destinatário. O envio
de ficha com conta e destinatário vinculados pelo CRM segue pendente em
WAP-T02-09.

## Ensaio local e rollback

Use PostgreSQL dedicado em loopback com banco `crm_silmer_test_wap_e08`.
`node --test test/integration/seller-whatsapp-outbound.test.js` exige esse
banco e aplica as expansões. O ensaio cobre duas contas, recibo adiantado,
eco/HTTP concorrentes, geração antiga, disputa com disconnect/revogação,
acesso à mídia, composição comercial obsoleta e replay financeiro.
Os testes de workflow e do contrato usam artefatos sintéticos inativos.

Para rollback, desative o envio pessoal na API, worker e candidato n8n.
Se precisar suspender a observação de saídas e anexos, desligue também o
ingresso pessoal conforme o runbook E04. Preserve a expansão, os vínculos,
as provas e os efeitos incertos. Evite voltar a um escritor anterior que
desconheça saídas com zero revisões inbound e provas de despacho 0082.
Nenhum teste local valida pareamento, transporte real ou produção.

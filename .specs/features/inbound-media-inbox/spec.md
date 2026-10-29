# Imagens e áudios recebidos na Inbox

Correção INBOX-IMG-01, vinculada a INBOX-2/3, INB-01..05, MSG-01/02 e
PRV-03 do MVP. Preserva o monólito, o contrato de anexos e a retenção legada.

## Escopo e premissas

O operador confirmou em 28/10/2026 que produção usa WAHA temporariamente.
O workflow implantado diverge do snapshot Meta versionado. A correção deve
ser preparada sobre uma exportação atual do WAHA e preservar seus nós e
conexões de atendimento. Nenhuma execução, envio, publicação, alteração de
configuração ou recuperação de dados reais está autorizada por este documento.

Arquivos de canal continuam transitórios: sete dias do recebimento original
ou encerramento da jornada, o que ocorrer primeiro. O scanner permanece
obrigatório; esta correção não altera a política de mídia do vendedor.
O piloto observado usa uma instância de API. O ingresso protege o ciclo
snapshot, scan e vínculo por mensagem nessa instância; múltiplos processos
ou réplicas exigem coordenação durável antes de escalar.

## Requisitos e critérios de aceite

- **IMG-01:** WHEN uma mensagem recebida possui imagem vinculada, disponível,
  validada e dentro da retenção THEN a API SHALL projetar a mídia na Inbox
  com URL relativa autenticada e entregar os bytes originais para o componente
  de imagem existente, sem expor caminho de disco, URL do provedor ou segredo.
- **IMG-02:** WHEN a leitura não tem sessão, capacidade ou vínculo com a
  conversa THEN a API SHALL negar os bytes; WHEN o arquivo está vencido,
  a jornada terminou, o scanner não liberou ou o conteúdo sumiu/divergiu THEN
  a API SHALL preservar o histórico sem servir o arquivo.
- **IMG-03:** WHEN o patch offline recebe um workflow WAHA compatível THEN
  ele SHALL acrescentar somente um ramo de persistência de imagens, inclusive
  no atendimento humano e em replay, conservando todos os nós e caminhos
  anteriores; esse ramo SHALL não alcançar IA, reserva ou envio de mensagens.
- **IMG-04:** WHEN esse ramo recebe uma imagem THEN ele SHALL validar a URL
  privada do WAHA, impedir redirects, limitar a imagem a 5 MB e enviar bytes,
  MIME, SHA256 e identidade da mensagem pelo endpoint de anexos existente,
  com Basic Auth e chave idempotente estável; uma falha SHALL gerar evento
  redigido, sem texto do cliente, URLs ou detalhes de credencial. WHEN scanner,
  volume ou quota se recuperam de falha temporária THEN a API SHALL permitir
  nova validação do mesmo anexo, sem reiniciar retenção, duplicar bytes ou
  dispensar a inspeção; `rejected`, `deleted` e `lost` SHALL não ser reabertos
  por esse retry. Quarentena por assinaturas antigas SHALL ser revalidada
  sobre a mesma cópia, sem outra ocupação de quota.
- **IMG-05:** WHEN uma imagem antiga é recuperada THEN o upload SHALL manter
  a retenção a partir do recebimento original e SHALL não reexecutar o
  atendimento nem enviar mensagem; a recuperação real depende da disponibilidade
  do arquivo no WAHA e de uma aplicação controlada em produção.

## Entrega e validação

Uma tarefa atômica: INBOX-IMG-01. Arquivos: leitura da Inbox, composição da
API, rota/runtime de mídia recebida, patch offline do n8n, revalidação do volume
transitório e suas guardas de persistência, testes associados e runbook.
Sem migration, alteração de infraestrutura ou publicação neste patch.

Gates locais: testes das rotas/projeção e do patch WAHA, typecheck, lint,
fronteiras, build, regressão e E2E de mídia, `git diff --check`. SQL deve ser
validado em PostgreSQL dedicado com dados sintéticos. Verificador independente
registra evidências e mutações isoladas em `validation.md`.

## Complemento autorizado em 29/10/2026 — imagem no pedido

O proprietário solicitou exibir as imagens recebidas e anexá-las no pedido.
A ponte vigente é Evolution/Baileys (ADR 050); as observações WAHA acima
registram o diagnóstico anterior, não a configuração atual.

- **IMG-06 / ARQ-02:** uma imagem recebida, disponível e validada oferece
  ação humana de anexar como referência em um pedido pendente vinculado à
  conversa. A pessoa escolhe explicitamente o pedido, inclusive quando há
  apenas um; nunca promover automaticamente nem enviar mensagem ao cliente.
- **IMG-07 / ARQ-04:** a cópia usa a leitura privada da conversa e o upload
  autenticado já existente dos arquivos do pedido, com sessão, CSRF e chave
  idempotente reutilizada após resposta incerta. Sucesso só é anunciado após
  resposta do upload; erro preserva a possibilidade de tentar novamente.
- **IMG-08 / PRV-03:** a interface oferece a ação somente ao responsável ou
  administrador, em conversa aberta e para imagem recebida. Pedido confirmado,
  mídia indisponível e mensagem enviada não oferecem a ação. A API continua
  responsável por validar acesso, estado do pedido, formato e limite de arquivos.

Tarefa **INBOX-IMG-ORDER-01**: ação da Inbox, testes da composição real da
tela e da cadeia completa de persistência Evolution, documentação e evidências.
Não altera retenção, scanner, infraestrutura ou política do RustFS. Imagens
antigas sem bytes vinculados continuam dependendo de recuperação operacional.

## Complemento autorizado em 29/10/2026 — áudio recebido

Tarefa **INBOX-AUDIO-01**, EVOL-01D, INB-01 e MSG-01..04. O proprietário
solicitou corrigir o player dos áudios recebidos e testar envio pela Inbox
com recebimento e reprodução no WhatsApp de teste.

- **AUD-IN-01:** áudio OGG/MP3 recebido deve atravessar o ramo independente
  de persistência, tanto em atendimento humano quanto com IA, e vincular os
  bytes à mensagem original pelo endpoint autenticado de anexos. O player
  existente usa a URL privada; transcrição não substitui armazenamento.
- **AUD-IN-02:** validar tipo/MIME do evento e do binário, limitar áudio a
  16 MiB e conservar imagens em 5 MiB, scanner, hash, idempotência e retenção
  original. Proxy permite multipart até 17 MiB somente no POST da coleção
  exata de anexos da integração. Não ampliar outros endpoints.
- **AUD-IN-03:** patch sobre exportação atual Evolution altera somente filtro
  e medição do ramo existente; preserva IDs, conexões, credenciais e settings.
  Contexto inesperado impede aplicação; reaplicação não duplica nós/efeitos.
- **AUD-IN-04:** homologação exige nova entrada com player reproduzível e
  envio único pela Inbox observado e reproduzido no WhatsApp de teste.
  Resultado incerto não autoriza reenvio. Histórico anterior sem anexo exige
  recuperação pontual, preservando identidade e prazo original, sem IA/envios.

Estado operacional e recuperação em
[runbook de áudio](../../../docs/runbooks/inbound-audio-inbox.md).

## Limites operacionais de imagens

Antes da ativação, verificar armazenamento transitório e scanner real da API.
O socket do clamd pertence ao worker; não presumir que a API consegue usá-lo.
Exportar a revisão atual e revisar o diff antes de publicar. Recuperar somente
os anexos afetados, nunca o workflow comercial completo. A evidência local
não confirma exibição das imagens reais em produção.

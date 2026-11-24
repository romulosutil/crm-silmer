# PDF recebido na Caixa de Entrada

INBOX-PDF-01; INB-01, MSG-01–03 e PRV-03. Correção de 11/11/2026.

## Causa e comportamento

O transporte normalizava `documentMessage` e `documentWithCaptionMessage`, mas
a persistência independente no n8n aceitava somente imagem/áudio. A projeção
da Inbox, a rota privada de conteúdo e o componente de mídia também excluíam
PDF. A mensagem de documento podia existir sem arquivo utilizável.

PDF recebido continua `document`, com legenda preservada. O cartão mostra
**Documento PDF** e **Baixar PDF**; não envia o documento à IA nem abre conteúdo
ativo dentro do CRM. Ausência de bytes é indisponibilidade explícita para novos
documentos cujo MIME foi observado, sem inventar um link de conteúdo.

O limite é 16 MiB, compatível com o multipart de 17 MiB do edge existente.
Continuam obrigatórios scanner limpo, MIME detectado, SHA-256, vínculo à
mensagem/conversa, sessão humana autorizada e retenção transitória. O download
usa `attachment`, nome sintético, `private, no-store` e `nosniff`. Não há
migração, dependência, infraestrutura ou política de retenção nova.

## Aplicação no workflow ativo

O repositório entrega um patch **offline**, separado dos artefatos históricos
e da referência publicada. Após disponibilizar a API/interface corrigidas:

1. Exporte a versão corrente do workflow Evolution para local privado, fora
   do Git. Preserve uma cópia para rollback e registre o hash da versão.
2. Execute `node ops/n8n/patch-evolution-inbound-pdf.mjs <atual.json> <revisao.json>`.
   O comando não publica nem acessa rede. Ele exige a cadeia de persistência
   independente e recusa contexto incompleto/inesperado. Reaplicar é no-op.
3. Revise o diff privado: somente filtro, decoder, medição, prioridade do ramo
   e política de erro do relatório. IDs, credenciais, SHA, upload, metadados,
   nomes dos nós, conexões e fluxos comerciais permanecem preservados.
4. Publique esse delta no workflow corrente pelo procedimento operacional
   existente. Não substitua a produção por um export sanitizado do repositório.
5. Homologue um PDF sintético com legenda e um sem legenda; confira cartão,
   download com bytes idênticos, replay sem duplicata, atendimento humano e bot.
   Faça também upload inválido, documento indisponível e acesso sem permissão.

O patch aceita apenas `document` com MIME `application/pdf`, obtém bytes pelo
gateway autenticado já configurado e valida base64 canônico, tamanho e assinatura
`%PDF-`. A validação definitiva continua no scanner do CRM. A falha usa a cadeia
existente de eventos e não bloqueia o atendimento comercial.

## Histórico e rollback

Esta correção não recupera automaticamente PDFs anteriores: o envelope antigo
pode não conter MIME, e bytes nunca baixados podem ter expirado no provedor.
Qualquer recuperação exige retenção ainda válida, identificadores originais,
TTL vigente e reprocessamento idempotente; não reenviar mensagem nem afirmar
que o arquivo foi recuperado sem observar e conferir os bytes.

Para rollback do n8n, restaure a exportação privada anterior. Reverter o commit
da API/interface por PR retoma a apresentação anterior sem apagar mensagens ou
anexos. Não remova dados nem altere scanner, ACL ou retenção para contornar falhas.

## Verificação

- `node --test test/evolution-inbound-pdf-patch.test.js test/inbound-media-content.test.js`
- `TEST_DATABASE_URL` sintético dedicado: `node --test test/inbound-media-postgres-live.test.js`
- `npx playwright test test/e2e/media-message.spec.js test/e2e/inbox-media.spec.js`
- Gate do projeto: `npm run validate`, E2E e auditoria de dependências.

Testes locais não comprovam publicação nem recebimento real no canal ativo.

## PDF e CDR — INBOX-DOC-02 (16/11/2026)

Solicitação do proprietário: liberar PDF e CDR recebidos no WhatsApp. O gate de
publicação de INBOX-PDF-01 continuava pendente; código preparado não prova que
os bytes do documento relatado chegaram a ser persistidos.

Use agora `node ops/n8n/patch-evolution-inbound-documents.mjs <atual.json> <revisao.json>`
no export privado corrente. O patch inclui a correção PDF anterior se ausente e
aceita documentos candidatos PDF/Corel, inclusive `application/octet-stream`
quando o gateway não informa o formato. Confere bytes/base64 e assinatura PDF,
RIFF/CDR ou ZIP; o ZIP é somente candidato. O scanner/libmagic precisa detectar
`application/vnd.corel-draw` (RIFF) ou
`application/x-vnd.corel.draw.document+zip` (Corel moderno); ZIP genérico, HTML,
SVG e executáveis continuam recusados. Os nomes originais não determinam caminhos
nem são expostos; CDR baixa como `documento.cdr`. Limite: 16 MiB por documento.

As duas variantes seguem o scanner, SHA-256, retenção, ACL e download `attachment`
existentes. O cartão oferece **Documento CDR / Baixar CDR**; PDF mantém o cartão
anterior. Não há renderização do Corel ou envio do documento à IA. O pedido não
muda. Instale a API/interface antes de publicar o delta do n8n; preserve a cópia
privada anterior e confira apenas os nós listados pelo patch. Reaplicação é no-op.

Verificar: testes `evolution-inbound-documents-patch`, `private-media-volume`,
`inbound-media-content`, `inbound-media-postgres-live` e E2E `media-message`.
O teste de PostgreSQL requer banco sintético dedicado. Homologação real e
recuperação histórica continuam distintas dos testes locais.

MIME do detector: [libmagic RIFF](https://github.com/file/file/blob/master/magic/Magdir/riff)
e [libmagic ZIP/Corel](https://github.com/file/file/blob/master/magic/Magdir/archive).
Rollback: restaurar o export protegido anterior e reverter o commit via PR,
sem apagar anexos ou contornar scanner/ACL. Arquivos antigos sem bytes ainda
podem exigir novo envio pelo cliente; não afirmar recuperação sem conferência.

## Vídeo MP4 e CDR enviado como ZIP — INBOX-VIDEO-01 / INBOX-CDR-ZIP-01 (24/11/2026)

Medição em produção de 23/11/2026 na linha pessoal do vendedor (workflow
"Silmer seller WhatsApp inbound", Evolution/Baileys): o filtro do ramo de mídia
descartava sem erro `videoMessage` MP4 (`video/mp4`, 4,3 MB e 18 MB) e arquivos
CorelDRAW `*.cdr` que o WhatsApp declara como `application/zip` (2,5 MB e
9,3 MB). Não havia ramo de vídeo, e o suporte a CDR só reconhecia MIME próprio
do Corel.

O patch `ops/n8n/patch-evolution-inbound-video-cdr-zip.mjs` acrescenta, com os
marcadores `/* INBOX-VIDEO-01 */` e `/* INBOX-CDR-ZIP-01 */`, somente:

- **Vídeo:** `message_type` `video` com MIME `video/mp4` na origem e na resposta
  do gateway; base64 canônico e assinatura `ftyp` no deslocamento 4. Salva como
  `video.mp4`, tipo `video/mp4`.
- **CDR como ZIP:** `message_type` `document` com MIME `application/zip` ou
  `application/x-zip-compressed` **e** nome terminado em `.cdr` (sem diferenciar
  maiúsculas). Exige cabeçalho ZIP `50 4B 03 04` e envia ao CRM como
  `application/x-vnd.corel.draw.document+zip`, nome `documento.cdr`. O nome
  original serve apenas para admitir o candidato; ZIP genérico continua recusado
  pelo libmagic do CRM, que precisa detectar o tipo Corel declarado.
- **CorelDRAW 17+ no CRM:** o CDR atual é um ZIP cuja primeira entrada
  `mimetype` diz `application/x-vnd.corel.zcf.draw.document+zip`, e o libmagic
  devolve exatamente esse tipo ("Corel Draw drawing, version 17-22"). O CRM só
  aceitava a variante sem `zcf` e respondia 415 também na linha principal. O
  scanner (`clamav-media-scanner.js`) passa a nomear a variante `zcf` pelo tipo
  canônico `application/x-vnd.corel.draw.document+zip`; o resto do CRM não muda.
  Os dois CDR de 23/11 receberam 415 no teste de 24/11 antes dessa correção e
  ficaram `rejected` no CRM, portanto não podem ser reenviados pelo mesmo
  identificador.

Filtrar, Baixar e Medir recebem os dois blocos antes do código existente; os
demais nós, conexões e configurações ficam idênticos, e imagem, áudio, PDF e
Corel seguem pelo caminho anterior. Medir relê os bytes armazenados e confere
de novo tipo, tamanho e assinatura. Erros: `INBOUND_VIDEO_INVALID` e
`INBOUND_DOCUMENT_INVALID`. Scanner, SHA-256, TTL, ACL e download `attachment`
do CRM não mudam.

**Limite de 16 MiB por arquivo.** Arquivos maiores continuam sem anexo — por
exemplo o vídeo de 18 MB medido e um `.ai` de 140 MB. Nas linhas pessoais não há
evento de falha registrável no CRM: o arquivo não chega e nada avisa, e o
vendedor precisa pedir outro envio (link ou arquivo menor). Formatos fora desta
lista (`.ai`, MOV, ZIP sem `.cdr`) continuam fora do escopo.

Aplicação, sempre sobre o export corrente e sem publicar pelo script:

1. Exporte a versão ativa do workflow da linha pessoal para local privado, fora
   do Git; guarde a cópia para rollback e registre o hash.
2. Execute `node ops/n8n/patch-evolution-inbound-video-cdr-zip.mjs <atual.json> <revisao.json>`.
   O comando não acessa rede e recusa sobrescrever a saída. Ele falha se faltar
   (ou estiver duplicado) Filtrar, Baixar ou Medir, se a expressão do filtro não
   tiver o formato `={{ ... }}` ou se os marcadores já existirem — não reaplique.
   A função exportada `patchInboundVideoAndCdrZip(workflow)` é pura e pode rodar
   no navegador sobre o JSON do workflow, com o mesmo resultado.
3. Compare os dois JSON: só a condição do Filtrar e o `jsCode` de Baixar e Medir
   mudam, com os blocos novos no início.
4. Atualize o workflow corrente com esse delta e publique pelo procedimento
   operacional existente.
5. Verifique com um MP4 curto e um `.cdr` pequeno enviados ao número de teste:
   anexo presente, download com bytes idênticos e replay sem duplicata. Confira
   também que um ZIP comum e um arquivo acima de 16 MiB continuam sem anexo.

Prova de 24/11/2026: o código novo de Baixar e Medir, executado pelo utilitário
inativo de recuperação contra os arquivos reais de 23/11, gravou o vídeo de
4,3 MB (anexo presente, download 200 `video/mp4` com o mesmo tamanho). Ordem de
publicação: primeiro o CRM com o scanner corrigido, depois o patch no n8n, para
que nenhum CDR novo seja recusado em definitivo.

Rollback: restaurar o export privado anterior. Verificação local:
`node --test test/evolution-inbound-video-cdr-zip-patch.test.js test/evolution-inbound-documents-patch.test.js test/evolution-inbound-pdf-patch.test.js`.
Testes locais não comprovam publicação nem recebimento real.

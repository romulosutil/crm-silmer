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

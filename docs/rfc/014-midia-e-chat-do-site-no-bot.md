# RFC 014 — Imagem, áudio e chat do site no bot

Status: decidida em 07/10/2026; registrada na
[ADR 026](../adr/026-midia-e-chat-do-site-no-bot.md).

Data: 07/10/2026

Origem: o PO pediu, em 07/10/2026, que o workflow principal
`k7tI6T4RhQPyJkn9` fique igual ao DEV `0S5ZS1xeDCSoWovs`, leia imagens e
áudios e atenda no WhatsApp e no chat que ficará no site. Até aqui a leitura
multimodal estava diferida ([RFC 002](002-simplificar-integracao-n8n-para-o-mvp.md),
[RFC 006](006-atendimento-guiado-do-bot-no-n8n.md)) e toda mídia transferia
para um vendedor. Requisitos propostos `MID-01`–`MID-05` e `SITE-01`–`SITE-06`
na seção 5; tarefa T102 de [tasks](../../.specs/features/pedidos-mvp/tasks.md).

## 1. Situação atual

| Parte                    | Hoje                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mídia no WhatsApp        | Imagem, áudio, documento e vídeo entram no CRM e abrem handoff `unsupported` com o aviso "Recebi o seu arquivo".                                                          |
| Outros tipos do WhatsApp | Figurinha, localização, contato, reação e tipos desconhecidos chegam ao CRM com um `message.type` que ele recusa (`400`); a execução falha e o cliente fica sem resposta. |
| Canais do CRM            | O inbound n8n aceita só `channel: whatsapp`, com identidade E.164.                                                                                                        |
| Chat do DEV              | Chat Trigger restrito ao usuário do n8n, identidade sintética `55419…` (parece um celular real de Curitiba) e envio simulado.                                             |
| Envio humano             | O comando do painel sempre chama a Meta com o número da identidade.                                                                                                       |

## 2. Opções

### Chat do site

1. **Canal novo no CRM (`site`).** Migração, contrato, Inbox e identidade
   próprios. Correto a longo prazo, mas muda o CRM, o OpenAPI e a Inbox antes
   de o chat existir no site.
2. **Identidade WhatsApp sintética que nunca é um número real** (recomendada).
   O chat entra pelo mesmo caminho do WhatsApp, com um número `999` + 12
   dígitos derivado da sessão do navegador. O código de país 999 nunca é
   atribuído pela UIT, então nenhuma mensagem pode chegar a uma pessoa real.
   Não muda o CRM.
3. **Chat sem CRM.** Descartada: quebra a regra de que toda mensagem válida
   entra na Caixa de Entrada.

### Leitura de mídia

1. **Imagem para o modelo e áudio transcrito** (recomendada). A imagem vai
   anexada ao agente; o áudio é transcrito pela mesma conta OpenAI e entra
   como texto.
2. **Descrição da imagem por outro modelo.** Duplica custo e perde contexto
   da conversa.
3. **Manter o handoff de mídia.** Contradiz o pedido do PO.

## 3. Recomendação

Opção 2 para o chat e opção 1 para a mídia, sem mudança no CRM:

- **Chat do site:** Chat Trigger público em modo `webhook` (widget embutido),
  só para `https://silmer.com.br` e `https://www.silmer.com.br`, com upload de
  imagem e áudio. A resposta da IA, o aviso e o "vendedor vai falar com você"
  voltam no próprio chat; a reserva, o `message.sent` e o handoff seguem o
  mesmo contrato do WhatsApp.
- **Sem resposta humana no chat:** o vendedor não consegue responder dentro do
  widget. Todo aviso de transferência no chat troca "aqui mesmo" por um pedido
  do WhatsApp do visitante, e o painel recusa (`422`) mensagem humana para um
  número `999`, que o CRM registra como falha.
- **Mídia:** imagem até 5 MB e áudio até 16 MB (os limites do CRM). O que não
  for possível baixar, preparar ou transcrever chega ao modelo como "não
  consegui abrir", e o bot pede para o cliente escrever; documento, vídeo e
  tipo desconhecido continuam transferindo.
- **Tipos do WhatsApp:** figurinha vira imagem sem leitura, localização e
  contato viram texto, reação e avisos de sistema são ignorados, e tipo
  desconhecido vira texto e transfere. Nenhum deles derruba mais a execução.

## 4. Riscos e controles

| Risco                                                | Controle                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imagem e áudio com dados pessoais enviados à OpenAI  | Mesmo provedor e gate da ADR 021 (DPA, retenção, ZDR); o prompt proíbe descrever pessoas ou gravar dados pessoais vistos na imagem. Produção com PII segue bloqueada pelo gate. |
| Abuso do chat público (custo de IA, contatos falsos) | CORS só do site, teto de 15 mensagens por conversa, texto de até 2000 caracteres, um arquivo por mensagem. Limite de taxa por IP no proxy fica como ação pendente.              |
| Vendedor responde a um visitante do site             | Número `999` nunca é real; o painel recusa com `422` e a mensagem fica como falha.                                                                                              |
| Execução do chat termina num nó que não é a resposta | O nó "Responder no chat do site?" fica no topo do canvas e roda antes de qualquer ramo irmão (executionOrder v1); teste automatizado garante a posição.                         |
| Áudio AAC/AMR que a transcrição não aceita           | Chega ao modelo como não lido; o bot pede texto. O vendedor vê o áudio original na Inbox.                                                                                       |

## 5. Requisitos propostos

| ID      | Critério de aceite                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MID-01  | Áudio do WhatsApp ou do site é transcrito e entra no contexto como a mensagem do cliente; as redes de preço, pessoa e pedido do zero leem a transcrição.                |
| MID-02  | Imagem do WhatsApp ou do site vai anexada ao agente; arte vira `artwork_status` "cliente enviou a arte por imagem", referência vai para `notes`, peça pronta transfere. |
| MID-03  | Mídia que não pôde ser baixada, preparada ou transcrita chega ao modelo como não lida e o bot pede para o cliente escrever; nunca derruba a execução.                   |
| MID-04  | Figurinha, localização, contato, reação, aviso de sistema e tipo desconhecido nunca geram `400` no inbound; documento, vídeo e tipo desconhecido transferem.            |
| MID-05  | O bot não descreve pessoas nem grava dados pessoais que aparecem na imagem.                                                                                             |
| SITE-01 | O chat do site é público só para as origens do site, aceita imagem e áudio e entra no CRM como identidade `999` + 12 dígitos estável por sessão do navegador.           |
| SITE-02 | A resposta da IA, o aviso de transferência e o "vendedor vai falar com você" aparecem no chat; a reserva e o `message.sent` usam o mesmo contrato do WhatsApp.          |
| SITE-03 | No chat, todo aviso de transferência pede o WhatsApp do visitante com DDD em vez de dizer que o atendimento continua ali.                                               |
| SITE-04 | O painel recusa com `422` mensagem humana para identidade `999`; nada sai para a Meta.                                                                                  |
| SITE-05 | DEV e LOCAL não publicam o chat público; o chat de teste aceita imagem e áudio.                                                                                         |
| SITE-06 | O workflow passa a `mvp-simple-14` (DEV `dev-mvp-simple-15`) sem mudança de contrato nem ordem de implantação com o CRM.                                                |

## 6. Ações

1. Workflow canônico, snapshots DEV/LOCAL e testes (T102).
2. Publicar o workflow `k7tI6T4RhQPyJkn9` com as credenciais WhatsApp e
   OpenAI já vinculadas e testar imagem, áudio e chat.
3. Embutir o widget `@n8n/chat` no site com a URL do Chat Trigger publicado.
4. Pendentes: limite de taxa no proxy do chat; evidências do gate de
   privacidade da ADR 021 para mídia; canal `site` no CRM se o volume do chat
   justificar (opção 1).

## 7. Resultado

Decidida em 07/10/2026 pelas recomendações da seção 3 e registrada na
[ADR 026](../adr/026-midia-e-chat-do-site-no-bot.md).

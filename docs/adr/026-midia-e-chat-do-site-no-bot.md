# ADR 026 — Imagem, áudio e chat do site no bot

Status: aceita

Data: 07/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 07/10/2026, pediu que o workflow
principal fique igual ao DEV, leia imagens e áudios e atenda no WhatsApp e no
chat do site. Tech Lead definiu a identidade do chat, a leitura da mídia, o
fallback do que não pode ser lido e a recusa de envio humano ao chat.

RFC: [RFC 014](../rfc/014-midia-e-chat-do-site-no-bot.md). Requisitos
`MID-01`–`MID-05` e `SITE-01`–`SITE-06` da
[spec](../../.specs/features/pedidos-mvp/spec.md); tarefa T102 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md). Supera, só na leitura de
mídia, o diferimento da [RFC 002](../rfc/002-simplificar-integracao-n8n-para-o-mvp.md)
e da [RFC 006](../rfc/006-atendimento-guiado-do-bot-no-n8n.md); mantém o
contrato da [ADR 003](003-adotar-integracao-n8n-mvp-simples.md) e o provedor
da [ADR 021](021-adotar-openai-no-mvp.md).

## Contexto

O cliente manda foto da arte, print de referência e áudio, e toda mídia
transferia para um vendedor. O site precisa de um chat com o mesmo bot. O CRM
só conhece o canal WhatsApp e identidades E.164, e o vendedor só responde
pela Meta.

## Decisão

1. **Mídia lida pelo bot.** Imagem (até 5 MB) vai anexada ao agente
   (`passthroughBinaryImages`); áudio (até 16 MB) é transcrito pela mesma
   conta OpenAI (`/v1/audio/transcriptions`) e entra como a mensagem do
   cliente. No WhatsApp, a mídia é consultada e baixada da Graph API com a
   credencial WhatsApp; no site, já chega como arquivo.
2. **O que não pode ser lido não derruba a execução.** Falha ao consultar,
   baixar, preparar ou transcrever leva ao modelo uma mídia "não lida", e o
   bot pede para o cliente escrever. Documento, vídeo e tipo desconhecido
   continuam transferindo, com aviso por tipo ("o seu arquivo").
3. **Tipos do WhatsApp.** Figurinha é guardada como imagem e não vai ao
   modelo; localização e contato viram texto; reação e avisos de sistema são
   ignorados; tipo desconhecido vira texto e transfere. O inbound não recebe
   mais um tipo que o CRM recusa.
4. **Chat do site.** Chat Trigger público em modo `webhook`, só para
   `https://silmer.com.br` e `https://www.silmer.com.br`, com upload de imagem
   e áudio. Entra no CRM como WhatsApp, com identidade `999` + 12 dígitos
   derivada da sessão do navegador e nome "Visitante do site". O código de
   país 999 nunca é atribuído, então o número nunca é de uma pessoa real.
5. **Respostas no chat.** A reserva, o `message.sent` (com id `site:<comando>`)
   e o handoff usam o contrato de sempre; a resposta da IA, o aviso e a
   mensagem "um vendedor vai falar com você pelo WhatsApp" voltam no próprio
   chat. O nó que responde ao site fica no topo do canvas para rodar antes de
   qualquer ramo irmão sob `executionOrder: v1`.
6. **Sem resposta humana no chat.** Todo aviso de transferência no chat troca
   "aqui mesmo" pelo pedido do WhatsApp do visitante. O painel recusa com
   `422 site_chat_contact_has_no_whatsapp` mensagem humana para identidade
   `999`, e o CRM registra a falha; o vendedor responde no número que o
   visitante deixar.
7. **Prompt.** O bot usa a imagem só para entender o pedido: arte vira
   `artwork_status` "cliente enviou a arte por imagem", referência vai para
   `notes`, peça pronta é pedido que não começa do zero (ADR 013), e dados
   pessoais vistos na imagem nunca são descritos nem gravados.
8. **Versões e implantação.** Workflow `mvp-simple-14`, DEV
   `dev-mvp-simple-15`. Sem mudança de contrato com o CRM e sem ordem de
   implantação. DEV e LOCAL não publicam o chat público; o chat de teste
   aceita imagem e áudio.

## Consequências

- Mais conversas seguem com o bot depois de uma foto ou áudio, e a ficha
  ganha o que o cliente disse por voz.
- O texto do áudio não volta ao histórico do CRM: as rodadas seguintes veem os
  fatos pelo briefing, e o vendedor ouve o original na Inbox.
- Imagem e áudio com dados pessoais passam pela OpenAI: valem o gate de
  privacidade da ADR 021 e a retenção de mídia da regra 18.
- O chat do site cria contatos `999…` no CRM; o vendedor os reconhece pelo
  nome "Visitante do site" e não consegue responder pelo painel.
- Pendências: limite de taxa por IP no proxy do chat público, embutir o
  widget no site e, se o volume justificar, um canal `site` próprio no CRM.

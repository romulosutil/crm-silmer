# ADR 013 — Só pedido do zero no bot e meta de meia ficha

Status: aceito

Data: 01/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 01/10/2026, ao pedir o roteiro de
teste do bot. A rede de palavras, o motivo `human_requested` e a medida no
resumo do handoff são decisões do Tech Lead.

RFC: [RFC 006](../rfc/006-atendimento-guiado-do-bot-no-n8n.md), decisões
D27–D28 e roteiro da seção 6.2. Requisitos: `AGT-01`, `AGT-03`, `AGT-05`.
Acrescenta um gatilho às regras de transferência da
[ADR 009](009-regras-de-transferencia-e-teto-do-bot.md) e mede a ficha de sete
pontos da [ADR 012](012-ficha-de-sete-pontos-e-ritmo-fixo.md), que continuam
valendo.

## Contexto

A Silmer posta camisas prontas, atende pelo WhatsApp dos vendedores, por
telefone e por e-mail, e parte dos clientes chega com algo já em andamento.
Mensagens como "quero a camisa do post", "quero essa camisa" ou "envie por
e-mail, WhatsApp" parecem vagas para o bot, que tentava montar a ficha do zero
em cima delas. A leitura do Direct do Instagram (ADR 012) mostra o mesmo
padrão: produto pronto na loja, pergunta pronta de anúncio e encaminhamento ao
WhatsApp de um consultor.

Faltava também uma meta para a ficha. O bot exige o nome e os sete pontos para
`briefing_complete`, mas não havia medida de quanto da ficha ele preenche
quando a conversa é transferida antes.

## Decisão

1. **Só pedido do zero (D27).** O bot monta a ficha apenas de um pedido que
   começa do zero na conversa. Quando a mensagem atual mostra algo que já
   existe fora dela, o bot avisa e transfere na mesma rodada, sem perguntar
   nada da ficha:
   - peça pronta ou já mostrada pela Silmer: a camisa do post, do story, do
     reels, do feed, do anúncio ou da foto, um link, "quero essa camisa",
     pronta entrega;
   - outro canal: pedido de envio ou contato por e-mail, WhatsApp ou ligação,
     ou telefone e e-mail passados na conversa;
   - algo já combinado: pedido, orçamento ou arte já tratados com alguém da
     Silmer, ou um pedido igual a um anterior.

   Contar só como conheceu a Silmer ("vi vocês no Instagram", "vim pelo
   anúncio") e descrever o que quer fazer é pedido do zero. A regra vale em
   qualquer mensagem, não só na primeira; o que já foi coletado segue no
   resumo.

   - **Mecanismo:** o modelo informa `external_context`, e o nó de decisão
     soma uma rede de palavras na mensagem atual: post, story, reels, feed,
     link, "quero essa camisa", "pronta entrega", e-mail, "manda" ou "chama no
     whats", telefone, celular, "me liga" e "já falei com". A rede é larga de
     propósito: transferir uma conversa que o bot poderia levar custa pouco a
     um vendedor; montar ficha do zero para uma camisa pronta é o que o PO quer
     evitar.
   - **Prioridade:** pergunta de preço (D2) e pedido de pessoa (D3) mantêm o
     motivo; depois vem este gatilho, antes de idioma, reclamação, urgência,
     tentativas e teto.
   - **Motivo e fila:** `human_requested`, na fila sem responsável, para
     qualquer vendedor. O resumo começa com "Motivo: Não é um pedido do zero:
     peça do post, outro canal ou algo já combinado." O aviso ao cliente é
     "Claro! Vou chamar um dos nossos vendedores para te ajudar com isso, e o
     atendimento continua aqui mesmo."
   - **Pedido:** este gatilho não abre Pedido pendente, mesmo que o cliente
     diga que quer comprar ("quero 10 da camisa do post"); o vendedor abre. Um
     Pedido já aberto antes, na mesma conversa, continua.

2. **Meta de meia ficha (D28).** O indicador do bot é o preenchimento da
   ficha: quantos dos oito itens (o nome e os sete pontos da ADR 012) o
   cliente preencheu. "Definir com o vendedor" não conta; a gola que o
   workflow grava para regata, abadá e polo conta. A meta é de **pelo menos
   50% (4 de 8)** nas conversas de pedido do zero; as conversas transferidas
   pelo item 1 ficam fora da conta.
   - A meta é piso, não ponto de parada: o bot continua até a ficha completa
     (`briefing_complete`), como manda o D11.
   - O resumo de todo handoff traz "Ficha: X de 8 (Y%)", e a decisão expõe
     `ficha_filled` e `ficha_total`, que o workflow DEV devolve no webhook.
   - O roteiro de mensagens para medir a meta está na seção 6.2 da RFC 006.

## Consequências

- O workflow passa a `mvp-simple-8` (DEV `dev-mvp-simple-9`). Não há mudança
  no CRM nem migração: o workflow pode ir ao DEV sem novo deploy do CRM.
- Na Inbox, o motivo aparece como "Pediu uma pessoa"; o motivo real está no
  resumo. Um código próprio exige migração da constraint de motivos, como a
  0025, e fica para o BOT-05 se a métrica por motivo precisar dele.
- Falsos positivos esperados da rede: "posso mandar a arte pelo whats?" e "vi o
  post de vocês e quero fazer camisas" transferem. Se pesarem nos testes, a
  rede pode ser estreitada sem mudar a regra.

## Alternativas descartadas

- **Só o prompt:** o modelo pode seguir montando a ficha em cima de uma
  camisa pronta; a regra precisa valer sempre, como os gatilhos da ADR 009.
- **Motivo novo no CRM agora:** migração e deploy ordenado por um rótulo; o
  resumo basta para o piloto.
- **Transferir ao chegar a 50%:** o PO quer o máximo da ficha; 50% é o piso
  da meta, não o fim da coleta.

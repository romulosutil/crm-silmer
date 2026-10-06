# ADR 012 — Ficha de sete pontos e ritmo fixo do bot

Status: aceito; parcialmente supersedida pela
[ADR 016](016-itens-com-os-sete-pontos-da-ficha.md) no trecho do item 3 (D26)
que põe a gola no texto do modelo do item: a gola passou a ser campo do item;
e pela [ADR 021](021-atendimento-comeca-pelo-produto.md) nos itens 1, 2 e 4:
os pontos passam a ser produto, modelo, cor, quantidade, local da estampa e
prazo; arte, tecido, tamanhos e gola só são gravados; o nome vem no começo;
sai a exceção de "lisa ou com estampa?"; e a gola de regata e polo vira kit.

Data: 01/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 01/10/2026, ao achar o bot "sem
ritmo" nas conversas do DEV. A ordem dos pontos vem da leitura anonimizada do
Direct do Instagram da Silmer; as regras de gola do item 4 são do Tech
Lead.

RFC: [RFC 006](../rfc/006-atendimento-guiado-do-bot-no-n8n.md), decisões
D24–D26. Requisitos: `AGT-01`, `AGT-05`. Muda o que é exigido para
`briefing_complete` e substitui a lista de perguntas com opções do item 4 da
[ADR 010](010-intencao-de-pedido-sem-pergunta-e-tom-do-bot.md) e a preferência
de pergunta do item 6 da
[ADR 011](011-pergunta-ignorada-e-ficha-por-mensagem.md). As regras de
transferência da [ADR 009](009-regras-de-transferencia-e-teto-do-bot.md), da
ADR 010 e da ADR 011 continuam valendo.

## Contexto

O bot exigia 14 campos, mais endereço na entrega, em até 15 mensagens. O
modelo escolhia livremente a próxima pergunta e podia juntar dois assuntos na
mesma mensagem. A gola ficava escondida em `product_model` ("tipo de camisa,
gola e manga") e nunca era perguntada. Para o PO, a conversa ficou longa e sem
ritmo.

## Decisão

1. **Ficha de sete pontos e o nome (D24).** A transferência
   `briefing_complete` exige o nome (`customer_name`, pedido uma vez, conforme
   o item 7 da ADR 011) e sete pontos:
   - tipo de roupa (`product_model`): camiseta comum, polo, regata, abadá,
     mais justinha (baby look) ou outra;
   - cor (`colors`);
   - quantidade (`quantity`);
   - estampa (`artwork_status`): já tem a arte ou a logo, vai mandar, quer que
     a Silmer crie ou não quer estampa. A mesma pergunta cobre estampada ou
     bordada e grava `artwork_technique` quando o cliente disser, mas
     `artwork_technique` não é obrigatório;
   - tecido (`fabrics`): algodão, dry fit, poliéster ou outro;
   - tamanhos (`sizes`): quantas de cada tamanho. O cliente costuma mandar
     quantidade e tamanhos juntos, e o bot grava os dois;
   - gola (`collar`): gola redonda, gola V, gola polo ou outra.

   As opções usam o vocabulário dos clientes no Direct ("camisa", "abadá",
   "regata", "polo"); baby look fica no fim porque o PO a citou.

   Todo o resto (`product_type`, `order_name`, `needed_by`, `purpose`,
   `purchase_profile`, `delivery_mode`, `city_or_postal_code`,
   `delivery_address`, `artwork_locations`, `artwork_technique`, `notes` e os
   demais) deixa de ser exigido. O bot nunca pergunta esses campos, mas grava o
   que o cliente disser; o vendedor completa. A retirada continua sempre
   "Loja da Silmer" quando o cliente diz que retira.

2. **Ritmo fixo (D25).** Quem escolhe o próximo ponto é o workflow, não o
   modelo. Há uma única sequência, a constante `FICHA_RHYTHM` do
   [SDK do workflow](../../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js),
   e o próximo ponto é o primeiro dela ainda vazio; ponto preenchido ou
   deixado para o vendedor ("Definir com o vendedor") é pulado. O ponto que o
   bot acabou de perguntar vem primeiro até ser respondido. Um ponto por
   mensagem; a única exceção é perguntar, junto do tipo de roupa, se a peça vai
   lisa ou com estampa, agrupamento que aparece no Direct. Se o cliente disser
   lisa, a regra que já existia grava "sem aplicação" na estampa, e o ponto é
   pulado. O nó de contexto diz ao modelo qual é o próximo ponto, a lista do
   que falta na ordem e o que perguntar se o cliente pular o ponto agora. O nó
   de decisão recalcula o ponto depois de unir o `briefing_patch` e só aceita o
   `asked_field` do modelo quando ele é um ponto que ainda falta. A saída
   estruturada ainda aceita em `asked_field` os campos que o bot perguntava
   antes, para que um deslize do modelo não derrube a execução.
   - **Ordem:** tipo de roupa → cor → quantidade → estampa → tecido →
     tamanhos → gola. No Direct, a atendente pergunta primeiro o tipo (ou
     "lisa ou personalizada?"), depois cor, quantidade e arte; a cor vem
     sempre antes da quantidade, e o tipo sempre antes da cor. Tecido,
     tamanhos e gola nunca foram perguntados lá (o cliente traz, e a ficha
     completa é fechada no WhatsApp), então a posição deles é inferência e
     pode mudar com os testes. Para trocar, basta reordenar `FICHA_RHYTHM` e
     gerar de novo os snapshots.
   - **Nome:** pedido na primeira resposta, junto da apresentação. Se o
     cliente pular, volta uma única vez, quando os sete pontos estiverem
     completos.
   - **Ponto com resposta falha (`clarifying`):** o mesmo ponto é perguntado de
     novo, com duas ou três opções simples.
   - **Ponto pulado (`skipped`, item 8 da ADR 011):** se o cliente pula o
     ponto, mas acrescenta algo à ficha, a resposta pergunta o ponto seguinte
     da sequência. Na rodada depois do pulo, os pontos deixados para trás vão
     para o fim da fila, e o bot volta a eles depois.

3. **Gola como campo próprio (D26).** `collar` passa a existir no
   `briefing_patch` do CRM e na Ficha. Como o item da Ficha não tem campo de
   gola (o `vies_gola` é o acabamento que o vendedor define), a gola entra no
   texto do modelo do item ("camiseta comum, gola V"). O template impresso v2
   e os nomes de campo da API não mudam.

4. **Regata, abadá e polo sem pergunta de gola (Tech Lead, revogável pelo
   PO).** Regata não tem gola, o abadá da Silmer é feito na regata e a polo já
   tem a gola polo. Quando o tipo de roupa é só regata ou abadá, o nó de
   decisão grava `collar` = "regata"; quando é só polo, grava "gola polo". Isso
   não depende do modelo, e o bot não pergunta a gola. Um pedido misto
   ("camisetas e regatas", "camiseta e polo") continua com a pergunta, e uma
   gola dita pelo cliente nunca é sobrescrita.

5. **Tom.** As mensagens humanas no Direct são muito curtas e quase sem emoji:
   o bot usa frases curtas e no máximo um emoji, raramente. Regras comerciais
   vistas no Direct (mínimos de quantidade, cor obrigatória para peça
   unitária, nomes internos de tecido) não entram no prompt; continuam com o
   vendedor e com o catálogo da RFC 005.

## Consequências

- **Ordem de implantação:** o CRM que aceita `collar` precisa estar no
  cloud-dev antes do workflow novo. Um CRM antigo recusa a chave desconhecida
  com `400`, e a resposta do bot não sai.
- O workflow passa a `mvp-simple-7` (DEV `dev-mvp-simple-8`). O estado
  continua em `briefing_status` e `next_required_field`, sem migração.
- Conversa que ficou pendente num campo que o bot não pergunta mais (por
  exemplo, `purchase_profile`) não tem campo pendente; o bot segue a sequência.
- O resumo do handoff lista em "Faltam" só os sete pontos e o nome, e em "Para
  o vendedor definir" qualquer campo deixado para o vendedor.
- A Ficha recebe menos dados do bot (data, finalidade, logística); o vendedor
  completa na conversa.

## Alternativas descartadas

- **Manter o modelo escolhendo a próxima pergunta:** é o que deixava a
  conversa sem ritmo e juntava assuntos.
- **Gola dentro de `product_model`:** o cliente não fala da gola sem ser
  perguntado, e o vendedor não a encontra na Ficha.
- **Ordem definida no prompt:** o modelo não segue a ordem com segurança, e o
  nó de decisão não conseguiria contar a pergunta pendente.

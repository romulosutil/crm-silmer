# ADR 011 — Pergunta ignorada transfere e toda mensagem alimenta a ficha

Status: aceito

Data: 01/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 01/10/2026, depois da rodada 5 de
testes no DEV.

RFC: [RFC 006](../rfc/006-atendimento-guiado-do-bot-no-n8n.md), decisões D21 e
D22. Requisitos: `AGT-01`, `AGT-05`. Complementa as regras de transferência da
[ADR 009](009-regras-de-transferencia-e-teto-do-bot.md) e a
[ADR 010](010-intencao-de-pedido-sem-pergunta-e-tom-do-bot.md).

## Contexto

Sem a pergunta de orçamento (ADR 010), um cliente que só tirava dúvidas recebia
boas respostas, mas o bot repetia a mesma pergunta em todas elas ("Qual é seu
nome e o que você precisa?") até o teto de 15 mensagens. Para o PO, o bot não
deve repetir a pergunta indefinidamente: deve transferir para um vendedor.

O PO também pediu que toda mensagem que acrescente algo à ficha, mesmo avulsa
ou fora de ordem, seja aproveitada. O bot deve comentar de forma positiva e
seguir com uma pergunta na mesma frase. Exemplo: o cliente diz "Quero camisa
branca!" e o bot responde "Que legal, e quer estampada onde?".

## Decisão

1. **Pergunta ignorada.** Uma resposta ignora a pergunta pendente quando não a
   responde (`answer_status = other`) e também não acrescenta nada à ficha. O
   campo `notes` sozinho não conta como acréscimo.
2. **Duas vezes transfere.** Quando a mesma pergunta é ignorada duas vezes
   seguidas, o bot transfere com `low_confidence`. O resumo diz "Cliente não
   respondeu à mesma pergunta duas vezes".
3. **Faltas somadas.** Uma resposta falha (`unclear` ou `undecided`, D4) e uma
   ignorada na mesma pergunta somam duas faltas e também transferem.
4. **O que não conta nem zera:** uma pergunta sobre o próprio campo ("qual a
   diferença entre algodão e dry fit?") e uma mensagem que acrescenta algo à
   ficha.
5. **Pergunta nova recomeça.** A contagem vale enquanto o bot repete a mesma
   pergunta; se ele pergunta outro campo, a contagem recomeça.
6. **Ficha por mensagem.** O bot grava o que cada mensagem acrescenta à ficha,
   reage de forma positiva, sem listar o que anotou, e emenda a próxima
   pergunta na mesma frase. De preferência, a pergunta segue o que o cliente
   acabou de dizer (depois da cor, a estampa).
7. **Nome pedido uma vez.** Se o cliente pula a pergunta do nome e fala do
   pedido, o bot segue o assunto dele. Só pede o nome de novo, uma única vez,
   quando o resto da ficha estiver completo. O nó de contexto informa ao modelo
   se o nome já foi pedido.
8. **Pergunta pulada não se repete.** Se o cliente pula qualquer pergunta mas
   acrescenta algo à ficha, a resposta seguinte não insiste nela: o estado
   `skipped` avisa o modelo para perguntar outro campo e voltar à pergunta
   pulada mais tarde. Uma sugestão aceita ("pode ser esse") é gravada.
9. **Linguagem simples.** O bot fala com quem não entende de confecção e só
   quer uma camisa bonita: "tipo de camisa", "tecido", "quantas de cada
   tamanho", "estampa", "onde vai a estampa". Nomes técnicos (silk,
   sublimação, DTF, PV, piquet, fio, malha, grade) só aparecem se o cliente
   usar primeiro. O bot pergunta pelo resultado que o cliente quer ("uma logo
   simples ou algo bem colorido, com foto?"), e o vendedor define a técnica.

## Consequências

- Os estados novos `ignored` e `skipped` ficam no próprio `briefing_status`
  (`[quote_]ignored`, `[quote_]skipped`), sem campo novo no contrato nem
  migração no CRM.
- O workflow passa a `mvp-simple-6` (DEV `dev-mvp-simple-7`).
- Cliente que só tira dúvidas é transferido depois de ignorar a mesma pergunta
  duas vezes, em vez de gastar o teto.

## Alternativas descartadas

- **Contar qualquer pergunta do cliente como ignorada:** transferiria quem está
  decidindo justamente o campo perguntado, o que contraria o atendimento
  consultivo.
- **Motivo de handoff próprio:** exigiria migração da constraint;
  `low_confidence` ("Agente sem confiança") já descreve a situação para o
  vendedor, e o resumo traz o detalhe.

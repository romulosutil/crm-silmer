# ADR 024 — O atendimento começa pelo produto

Status: aceita

Data: 05/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 05/10/2026, decidiu que a primeira
pergunta é o que o cliente quer personalizar; que o nome vem sempre no começo
e, sem resposta, é pedido de novo, sozinho, logo em seguida; que malha,
técnica, tamanhos e arte são passivos e obrigação do vendedor; que o bot só
fala de algodão, poliéster e dry fit; e que o que perguntar depende de
"pré-kits" (abadá é sublimação total). Tech Lead definiu os grupos de
produto, o local da estampa e o prazo como perguntas, os kits, as dicas e os
alertas ao vendedor; essas escolhas são revogáveis pelo PO.

RFC: [RFC 012](../rfc/012-atendimento-comeca-pelo-produto.md). Requisitos
`AGT-01`, `AGT-05` e `PRD-01`–`PRD-08` da
[spec](../../.specs/features/pedidos-mvp/spec.md); tarefas T93–T95 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md). Supersede parcialmente a
[ADR 012](012-ficha-de-sete-pontos-e-ritmo-fixo.md) (itens 1, 2 e 4: os sete
pontos, a exceção de "lisa ou com estampa?", o nome no fim e a gola
implícita, que vira kit) e o item 7 da
[ADR 011](011-pergunta-ignorada-e-ficha-por-mensagem.md) quanto a quando o
nome volta; ajusta o indicador da
[ADR 013](013-pedido-do-zero-e-meta-de-meia-ficha.md).

## Contexto

A Silmer personaliza camisas, bonés, mochilas e praticamente qualquer
produto, mas o bot começava por "Que tipo de camisa você quer?", perguntava
tecido, tamanhos e gola a qualquer cliente, oferecia criar a arte e nunca
perguntava o prazo nem onde vai a estampa.

## Decisão

1. **Nome e produto primeiro.** A saudação pede o nome e o que a pessoa quer
   personalizar ("camisetas ou outras roupas, bonés, mochilas e bolsas, ou
   outro produto"). Se o cliente não disser o nome, a resposta seguinte reage
   ao que ele contou e pergunta só o nome. Pedido duas vezes, o nome não é
   mais perguntado nem segura a ficha; o vendedor confirma.
2. **Ritmo.** Produto → modelo → cor → quantidade → onde vai a estampa →
   para quando (`FICHA_RHYTHM`), um ponto por mensagem, sem exceção. O
   modelo só é perguntado para roupa, boné, mochila ou bolsa
   (`MODEL_KINDS`), com as opções do produto (`POINT_QUESTIONS`). O prazo é
   desejo do cliente, nunca prazo confirmado.
3. **Passivos.** Origem da arte, técnica, malha, tamanhos, gola,
   personalização individual e divisão por público nunca são perguntados: o
   bot grava o que o cliente disser, e o vendedor completa. O bot nunca
   oferece criar a arte e só cita algodão, poliéster e dry fit.
4. **Kits.** Uma tabela (`KITS`) diz o que um produto ou uma técnica já
   define: abadá (sublimação total, poliéster, branca, gola regata),
   sublimação total (poliéster, branca), regata (gola regata), polo (gola
   polo), boné, mochila e bolsa (gola `NAO APLICAVEL`). O workflow também
   grava o produto a partir do modelo dito, o modelo quando o produto já o
   nomeia e o nome do produto no modelo de boné e bolsa. Só preenche campo
   vazio; o que foi preenchido não é perguntado.
5. **Avisos ao vendedor.** O resumo da transferência traz "Atenção" (`ALERTS`:
   sublimação em algodão ou em peça escura, bordado com foto) e "Dica"
   (`HINTS`: técnica usual do produto, personalização individual, divisão
   por público). O bot nunca fala disso com o cliente.
6. **Indicador.** "Ficha: X de N" conta o nome, enquanto o bot o pede, e os
   pontos do produto. A meta de 50% não muda.
7. **Contrato.** O `briefing_patch`, a API do CRM e a projeção no pedido da
   ADR 016 não mudam. O workflow passa a `mvp-simple-12` (DEV
   `dev-mvp-simple-13`), sem ordem de implantação.

## Consequências

- A conversa fica entre 4 e 7 perguntas e traz o prazo e o local, que mais
  mudam o orçamento; o abadá, por exemplo, pede nome, produto, quantidade,
  local e data.
- O vendedor recebe menos dados técnicos do bot e passa a completar malha,
  técnica, tamanhos, gola e arte, que continuam exigidos para gerar o pedido.
- A divisão por público chega como texto em Dados do atendimento; o pedido
  com um item por público depende de nova proposta no CRM (RFC 012, seção 6).
- Kits, dicas e alertas crescem com o uso: cada linha nova é um commit no SDK
  e novos snapshots.

## Alternativas descartadas

- **Trocar só a primeira pergunta:** o bot seguiria perguntando tecido,
  tamanhos e gola para boné e caneca.
- **O modelo escolhe as perguntas:** volta o problema de ritmo da ADR 012.
- **Catálogo de produtos no CRM (ADR 007, não aceita):** depende de perfis de
  produto que o PO não aprovou.
- **Perguntar gola e arte:** pouco ganho por mensagem; ficam com o vendedor.

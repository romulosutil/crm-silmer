# RFC 009 — O atendimento começa pelo produto

Status: decidida em 05/10/2026 pelo PO, com as escolhas do Tech Lead
revogáveis pelo PO; registrada na
[ADR 021](../adr/021-atendimento-comeca-pelo-produto.md). Os itens por
público no CRM (seção 6) seguem em proposta própria.

Data: 05/10/2026

Origem: o PO (Rômulo Sutil Corrêa) pediu que o atendimento pergunte primeiro o
que o cliente quer personalizar, e não qual camisa: a Silmer faz camisas,
bonés, mochilas e praticamente qualquer coisa personalizável, e todo o fluxo
tem de ser revisto. Na mesma sessão, o PO acrescentou: gênero e idade criam
itens; malha, técnica, tamanhos e arte são do vendedor; o cliente comum só
conhece algodão, poliéster e dry fit; o nome vem sempre no começo; e o que
perguntar depende de "pré-kits" (abadá é sublimação total). A revisão de
estamparia do Tech Lead acrescentou o prazo, o local da estampa, as
restrições da sublimação e os avisos ao vendedor. Requisitos `PRD-01`–`PRD-08`
da [spec](../../.specs/features/pedidos-mvp/spec.md), tarefas T88–T90 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md).

## 1. Problema observado

- O ritmo fixo da [ADR 012](../adr/012-ficha-de-sete-pontos-e-ritmo-fixo.md)
  começava por "Que tipo de camisa você quer?", e quem queria boné ou mochila
  recebia uma pergunta de camisa.
- Os sete pontos eram todos de roupa e técnicos para o cliente: tecido,
  tamanhos e gola eram perguntados a qualquer um, e a arte era sempre
  oferecida ("quer que a gente crie?").
- O prazo e o local da estampa, que mais mudam o orçamento, nunca eram
  perguntados.
- Exceções como "regata não tem gola" ficavam espalhadas no código.

## 2. Decisões do PO (05/10/2026)

1. A primeira pergunta é o que personalizar, nunca "qual camisa".
2. O nome vem sempre no começo, na saudação. Se o cliente não responder, a
   mensagem seguinte reage ao que ele disse e pergunta só o nome ("Que legal
   que você quer camisetas! Qual é o seu nome?").
3. Malha (algodão, poliéster, dry fit), técnica (silk, DTF, sublimação…),
   tamanhos e arte são **passivos**: o bot grava se o cliente falar e o
   vendedor tem obrigação de completar. A Silmer só cria a arte quando não
   há jeito, então o bot nunca oferece.
4. O cliente comum só conhece algodão, poliéster e dry fit: nada de termo
   técnico.
5. O que perguntar depende do produto e da técnica, em "pré-kits" que serão
   melhorados com o uso. Abadá é sublimação total: não se pergunta cor.
6. Gênero e idade criam itens ("10 camisas: 4 masculinas, 3 femininas e 3
   infantis" são 3 itens). Só se cria item novo quando o cliente falar; os
   itens assumem o mesmo modelo, cor, malha e arte.

## 3. Fluxo decidido

| #   | O bot pergunta      | Quando                                                       |
| --- | ------------------- | ------------------------------------------------------------ |
| 1   | Nome e produto      | Na saudação; o nome de novo, sozinho, se o cliente não disse |
| 2   | Modelo              | Roupa, boné, mochila ou bolsa, se nenhum kit já definiu      |
| 3   | Cor                 | Se nenhum kit já definiu                                     |
| 4   | Quantidade          | Sempre                                                       |
| 5   | Onde vai a estampa  | Sempre                                                       |
| 6   | Para quando precisa | Sempre (desejo do cliente, nunca prazo confirmado)           |

O bot só grava, sem perguntar: origem da arte, técnica, malha, tamanhos,
gola, personalização individual (nome e número) e divisão por público.

Grupos de produto e perguntas do modelo:

| Produto                              | Modelo perguntado                                                    |
| ------------------------------------ | -------------------------------------------------------------------- |
| Roupa (camisa, polo, regata, abadá…) | camiseta comum, manga longa, polo, regata, abadá, baby look ou outro |
| Boné (boné, viseira, chapéu, touca…) | trucker (com tela atrás), aba curva, aba reta ou outro               |
| Mochila ou bolsa (mochila, ecobag…)  | mochila de costas, mochila saco, ecobag ou outro                     |
| Outro produto (caneca, chaveiro…)    | não pergunta; o vendedor detalha                                     |

## 4. Kits, dicas e alertas (Tech Lead, revogáveis pelo PO)

Uma tabela no workflow diz o que um produto ou uma técnica já define. O
workflow grava esses campos quando estão vazios, nunca por cima do que o
cliente disse, e o bot não os pergunta:

| Quando o cliente diz             | Já vem definido                                                 |
| -------------------------------- | --------------------------------------------------------------- |
| só abadá                         | sublimação total; malha poliéster; cor branca; gola regata      |
| sublimação total (qualquer peça) | malha poliéster; cor branca (a sublimação pede poliéster claro) |
| só regata (ou regata e abadá)    | gola regata                                                     |
| só polo                          | gola polo                                                       |
| só boné, mochila ou bolsa        | gola `NAO APLICAVEL` ("NÃO APLICÁVEL" no pedido)                |
| produto que já nomeia o modelo   | o modelo ("abadás", "camisas polo", "ecobags", "trucker")       |

O modelo de boné e de bolsa leva o nome do produto ("bonés trucker"), que é o
que o item do pedido mostra; o modelo dito também grava o produto ("30
regatas").

Duas listas vão só para o resumo do vendedor; o bot nunca fala disso com o
cliente:

- **Atenção** (o que a produção não faz como pedido): sublimação em algodão;
  sublimação em peça escura; bordado com foto ou arte muito colorida.
- **Dica** (o que o produto costuma levar): boné costuma ser bordado; caneca,
  squeeze, garrafa e mouse pad costumam ser sublimação; personalização
  individual pede a lista de nomes, números e tamanhos; divisão por público
  vira um item por público.

## 5. Outros efeitos

- **Indicador.** "Ficha: X de N" conta o nome e os pontos do produto: 7 para
  roupa, boné ou bolsa, 6 para outro produto e antes de saber o produto. O
  nome deixa de contar depois de pedido duas vezes. A meta de 50% da
  [ADR 013](../adr/013-pedido-do-zero-e-meta-de-meia-ficha.md) não muda.
- **Pedido pendente.** Abre na primeira mensagem com um ponto da ficha ou um
  campo que o bot só grava (arte, malha, tamanhos, gola), em geral a que diz
  o produto ([ADR 014](../adr/014-pedido-abre-no-primeiro-ponto-da-ficha.md)).
- **Contrato.** Nenhum campo novo: `product_type`, `artwork_locations`,
  `needed_by`, `customizations`, `notes` e o valor `NAO APLICAVEL` já eram
  aceitos. O workflow passa a `mvp-simple-12` (DEV `dev-mvp-simple-13`), sem
  ordem de implantação.
- **Gerar o pedido** continua exigindo malha, técnica, tamanhos, gola e arte
  ([ADR 016](../adr/016-itens-com-os-sete-pontos-da-ficha.md) e
  [ADR 020](../adr/020-tecnica-por-item-e-arte-do-pedido.md)), agora como
  obrigação do vendedor.

## 6. Itens por público no CRM (próxima proposta)

O bot grava a divisão por público em `notes` ("Divisão por público: 4
masculinas, 3 femininas, 3 infantis") e avisa o vendedor. Para o pedido nascer
com um item por público, o CRM precisa de:

- um campo **Público** no item (masculino, feminino, infantil…);
- um campo próprio no `briefing_patch` para a divisão, aceito pelo CRM antes
  do workflow que o envia;
- a projeção do bot gerando N itens que compartilham modelo, cor, malha e
  arte;
- uma ficha impressa v6, porque a v5 está aprovada e travada por hash.

Também fica para essa proposta o rótulo "Tecido" virar **Modelo de malha** na
tela e no papel, como o PO chamou.

## 7. Alternativas consideradas

- **Só trocar a primeira pergunta:** o bot seguiria perguntando tecido,
  tamanhos e gola a quem quer boné ou caneca.
- **Deixar o modelo escolher as perguntas pelo produto:** volta o problema de
  ritmo que a ADR 012 resolveu.
- **Catálogo de produtos no CRM (a v3 da `feat/ficha-por-produto`, ADR 007 não
  aceita):** depende de perfis de produto que o PO não aprovou. Os kits ficam
  no workflow, numa tabela curta e fácil de crescer.
- **Perguntar a gola (padrão da ADR 012):** a grande maioria é gola redonda;
  a pergunta custa uma mensagem por pouco ganho. Fica com o vendedor.
- **Perguntar a divisão por público:** só cria item quando o cliente fala
  (decisão do PO); perguntar alongaria toda conversa.

## 8. Riscos

- **Produto fora das listas** vira "outro produto" e não tem o modelo
  perguntado; o vendedor completa. As listas são `PRODUCT_KINDS` e
  `NAMED_MODELS` no SDK.
- **Correção do produto depois de um kit**: se o cliente troca "abadá" por
  "camiseta", a cor branca gravada pelo kit continua (o CRM ignora `null` no
  patch); o vendedor corrige.
- **Contagem do nome**: o bot conta as mensagens dele que falam "nome" no
  histórico recente; uma menção em outro sentido ("nome e número") pode
  encurtar o segundo pedido do nome.

## 9. Resultado

Implementado no workflow `mvp-simple-12` (DEV `dev-mvp-simple-13`), com
testes de contrato do workflow e de projeção no pedido, e o
[roteiro do indicador da ficha](../integrations/n8n/roteiro-indicador-da-ficha.md)
com roteiros de roupa, abadá, boné, ecobag e outro produto.

# Roteiro do indicador da ficha

Mensagens para testar o bot à mão e medir a meta da
[ADR 013](../../adr/013-pedido-do-zero-e-meta-de-meia-ficha.md): em pedido do
zero, o bot preenche pelo menos **50% da ficha (4 de 8)** antes de transferir.
A ficha tem oito itens: o nome e os sete pontos da
[ADR 012](../../adr/012-ficha-de-sete-pontos-e-ritmo-fixo.md) (tipo de roupa,
cor, quantidade, estampa, tecido, tamanhos e gola). "Definir com o vendedor"
não conta; a gola que o workflow grava sozinho para regata, abadá e polo
conta.

## Como rodar

- Use o workflow DEV `dev-mvp-simple-9` ou mais novo. Cada roteiro é uma
  conversa nova: no chat manual do DEV, recarregue a página antes de começar.
- Mande as mensagens na ordem, uma por vez, e espere a resposta. Se o bot
  perguntar outra coisa, responda com o fato do roteiro que couber.
- Depois da transferência, mande a última mensagem do roteiro: o bot deve ficar
  calado, porque a conversa está com um vendedor.
- Na Inbox do CRM, abra a transferência e confira o motivo, o resumo com
  "Ficha: X de 8 (Y%)" e o Pedido pendente. O webhook DEV também devolve
  `ficha_filled` e `ficha_total`.
- O indicador da rodada é a média da coluna "Ficha" dos roteiros KPI-01 a
  KPI-04 na hora da transferência; a meta é cada um chegar a 4/8 ou mais. O
  KPI-05 e os roteiros EXT são transferidos pela regra do pedido do zero e
  ficam fora da conta.

## Pedido do zero

A coluna "Ficha" é o preenchimento esperado depois da mensagem.

### KPI-01 — Cliente que responde uma coisa por vez

| #   | Você manda                                                          | O bot deve                                                                                                                              | Ficha  |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Oi, boa tarde!                                                      | Apresentar-se como assistente virtual da Silmer e pedir o nome e o que você precisa                                                     | 0/8    |
| 2   | Sou a Carla. Queria fazer uns uniformes pro time de vôlei da escola | Reagir bem e perguntar o tipo de roupa, com opções terminando em "ou outra"; pode juntar "lisa ou com estampa?". Abre o Pedido pendente | 1/8    |
| 3   | Camiseta comum, com estampa                                         | Perguntar a cor; "com estampa" ainda não responde a estampa (falta saber se já tem a arte)                                              | 2/8    |
| 4   | Azul marinho                                                        | Perguntar a quantidade                                                                                                                  | 3/8    |
| 5   | 25                                                                  | Perguntar a estampa: já tem a arte ou a logo? Estampada ou bordada?                                                                     | 4/8 ✅ |
| 6   | Já tenho a logo, vai estampada na frente                            | Perguntar o tecido: algodão, dry fit, poliéster ou outro                                                                                | 5/8    |
| 7   | Qual a diferença entre algodão e dry fit?                           | Explicar em palavras simples, sem dizer que a Silmer tem, e perguntar o tecido de novo; não transfere                                   | 5/8    |
| 8   | Vou de dry fit então                                                | Perguntar os tamanhos (quantas de cada)                                                                                                 | 6/8    |
| 9   | 5 P, 10 M, 8 G e 2 GG                                               | Perguntar a gola: redonda, V, polo ou outra                                                                                             | 7/8    |
| 10  | Gola redonda                                                        | Dizer que anotou tudo e transferir (Pré-ficha completa)                                                                                 | 8/8    |
| 11  | Obrigada!                                                           | Ficar calado                                                                                                                            | —      |

### KPI-02 — Cliente que manda quase tudo de uma vez

| #   | Você manda                                                                                    | O bot deve                                                                                              | Ficha  |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Oi! Me chamo Paulo, preciso de 40 regatas brancas de dry fit pra uma corrida, já tenho a arte | Gravar nome, regata (gola "regata" sem perguntar), 40, branca, dry fit e arte; perguntar só os tamanhos | 7/8 ✅ |
| 2   | 10 P, 15 M e 15 G                                                                             | Dizer que anotou tudo e transferir (Pré-ficha completa)                                                 | 8/8    |
| 3   | Valeu                                                                                         | Ficar calado                                                                                            | —      |

### KPI-03 — Cliente que pula o nome e deixa o tecido para o vendedor

| #   | Você manda                                       | O bot deve                                                                                            | Ficha  |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------ |
| 1   | Bom dia, quero fazer camisas polo pra minha loja | Apresentar-se e pedir o nome; não perguntar a gola (polo já tem)                                      | 2/8    |
| 2   | Preta                                            | Reagir bem e perguntar a quantidade, sem pedir o nome de novo                                         | 3/8    |
| 3   | 20                                               | Perguntar a estampa                                                                                   | 4/8 ✅ |
| 4   | Bordado, a logo eu mando depois                  | Perguntar o tecido                                                                                    | 5/8    |
| 5   | O tecido o vendedor me indica                    | Aceitar sem insistir e perguntar os tamanhos                                                          | 5/8    |
| 6   | 8 M, 8 G e 4 GG                                  | Pedir o nome uma única vez, porque os sete pontos fecharam                                            | 6/8    |
| 7   | Roberto                                          | Dizer que anotou tudo e transferir (Pré-ficha completa); "Para o vendedor definir: fabrics" no resumo | 7/8    |
| 8   | Ok                                               | Ficar calado                                                                                          | —      |

### KPI-04 — Cliente indeciso que pergunta o preço no meio

| #   | Você manda                                      | O bot deve                                                                                             | Ficha  |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| 1   | Oi, queria ver uns abadás pro bloco de carnaval | Apresentar-se e pedir o nome; não perguntar a gola (abadá grava "regata")                              | 2/8    |
| 2   | Juliana                                         | Perguntar a cor                                                                                        | 3/8    |
| 3   | Não sei ainda, o que fica bom?                  | Sugerir 2 ou 3 cores com o motivo, sem forçar, e perguntar a cor de novo                               | 3/8    |
| 4   | Pode ser branco então                           | Perguntar a quantidade                                                                                 | 4/8 ✅ |
| 5   | Umas 100. Quanto fica cada?                     | Dizer que os valores são com os vendedores e transferir (Perguntou o valor); a quantidade fica gravada | 5/8    |
| 6   | Tá bom                                          | Ficar calado                                                                                           | —      |

### KPI-05 — Cliente que começa do zero e depois cita o post

Este roteiro mede as duas regras juntas: a ficha começa, e a menção ao post
transfere na hora.

| #   | Você manda                                            | O bot deve                                                                                                                     | Ficha  |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | Oi, sou a Bia, quero fazer camisetas pra minha equipe | Perguntar o tipo de roupa (ou a cor, se já gravou camiseta)                                                                    | 1/8    |
| 2   | Camiseta comum, branca                                | Perguntar a quantidade                                                                                                         | 3/8    |
| 3   | 15                                                    | Perguntar a estampa                                                                                                            | 4/8 ✅ |
| 4   | Na verdade quero igual à que vocês postaram ontem     | Avisar que vai chamar um vendedor e transferir na hora; resumo "Não é um pedido do zero"; o Pedido pendente já aberto continua | 4/8    |
| 5   | Ok, obrigada                                          | Ficar calado                                                                                                                   | —      |

## Não é pedido do zero: transferência imediata

Cada linha é uma conversa nova com uma única mensagem, seguida de "ok". O bot
não pergunta nada da ficha, avisa "Claro! Vou chamar um dos nossos vendedores
para te ajudar com isso, e o atendimento continua aqui mesmo." e transfere. Na
Inbox, o motivo é "Pediu uma pessoa", o resumo começa com "Não é um pedido do
zero" e nenhum Pedido pendente novo aparece. O "ok" seguinte não tem resposta.

| ID     | Você manda                                                                   | O que testa                             |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------- |
| EXT-01 | Quero a camisa do post                                                       | Peça postada                            |
| EXT-02 | Quero essa camisa                                                            | Peça mostrada                           |
| EXT-03 | Oi! Pode me enviar o catálogo por e-mail?                                    | Outro canal: e-mail                     |
| EXT-04 | Me chama no WhatsApp, por favor                                              | Outro canal: WhatsApp                   |
| EXT-05 | Vi no story a camisa do Outubro Rosa, ainda tem?                             | Peça postada, com pergunta de estoque   |
| EXT-06 | Tem pronta entrega?                                                          | Peça pronta                             |
| EXT-07 | Já falei com a moça da loja sobre as camisas do time, queria saber como está | Algo já combinado                       |
| EXT-08 | Quero repetir o pedido do ano passado, as mesmas 30 camisas                  | Pedido anterior; só o modelo identifica |
| EXT-09 | https://www.instagram.com/p/exemplo quero essa                               | Link                                    |
| EXT-10 | Pode me ligar? Prefiro resolver por telefone                                 | Outro canal: ligação                    |
| EXT-11 | Quero 10 da camisa do Outubro Rosa que vocês postaram                        | Intenção de compra não abre Pedido      |

## Pedido do zero: o bot segue a ficha

Também uma conversa nova por linha. O bot não transfere; segue a ficha com a
próxima pergunta.

| ID      | Você manda                                                        | O bot deve                                                         |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| ZERO-01 | Oi, vi vocês no Instagram e quero fazer 20 camisetas pro meu time | Apresentar-se, pedir o nome e seguir a ficha                       |
| ZERO-02 | Vim pelo anúncio. Vocês fazem camisa personalizada?               | Seguir sem afirmar que a Silmer faz; dizer que o vendedor confirma |
| ZERO-03 | Preciso das camisas prontas até dia 20                            | Seguir; a data é desejo, não prazo, e não é pronta entrega         |
| ZERO-04 | Quero 50 camisetas com nome e número nas costas                   | Seguir a ficha                                                     |

## Registro

Para cada roteiro, anote: motivo da transferência, "Ficha: X de 8" do resumo,
se o Pedido pendente foi criado (só nos KPI), e qualquer resposta fora do
esperado (pergunta repetida, dois assuntos na mesma mensagem, preço, prazo,
"a Silmer tem/faz", termo técnico que você não usou).

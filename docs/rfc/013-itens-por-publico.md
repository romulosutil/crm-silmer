# RFC 013 — Itens por público no pedido

Status: decidida pelo PO em 05/10/2026, que seguiu as recomendações D1–D7 da
seção 7; registrada na [ADR 025](../adr/025-itens-por-publico.md).

Data: 05/10/2026

Origem: o PO definiu em 05/10/2026 que gênero e idade criam itens: "10 camisas
sendo 4 masculinas, 3 infantis e 3 femininas são 3 itens que provavelmente são
iguais, mas geram itens distintos na ficha". Também definiu que só se cria item
novo quando o cliente fala da divisão e que os itens assumem o mesmo modelo,
cor, malha e arte. A [RFC 012](012-atendimento-comeca-pelo-produto.md) e a
[ADR 024](../adr/024-atendimento-comeca-pelo-produto.md) já fazem o bot gravar
a divisão como texto em `notes` e avisar o vendedor; esta RFC propõe o que o
CRM precisa para o pedido nascer com um item por público. Tarefa T96 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md); requisitos propostos
`PUB-01`–`PUB-09` na seção 6.

## 1. Situação atual

| Parte                     | Hoje                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item (`ficha.items[]`)    | Sete pontos (ADR 016/020) e adicionais; não há campo de público. A quantidade não é gravada: é a soma de `grade`.                                                      |
| Bot → pedido              | `briefingToFicha` e `projectBriefingOntoFicha` (`modules/orders/src/domain/ficha.js`) projetam só o item 1, enquanto a conversa está com o bot.                        |
| Divisão dita pelo cliente | Desde a ADR 024, vai como texto em `notes` ("Divisão por público: 4 masculinas…") e aparece em Dados do atendimento, com a dica "cada público vira um item" no resumo. |
| Quantidade dita           | `quantity` fica no atendimento como "Quantidade informada"; o aviso de diferença compara com o total do pedido (ADR 016, item 7).                                      |
| Tamanhos                  | A leitura da ADR 016 (item 6, `sizes.js`) só aceita tamanhos de adulto; "infantil 4, 6, 8" fica com o vendedor.                                                        |
| Catálogo                  | A RFC 005 já listava a modelagem "Infantil", "Masculina reta" e "Feminina acinturada/baby look" e a grade infantil 2–16, sem aprovação.                                |
| Impressão                 | `ficha-canonical-v5` aprovada provisoriamente e travada por hash; qualquer campo novo no papel exige uma v6 e nova aprovação.                                          |
| Armazenamento             | A ficha é JSON cifrado (`ficha_envelope`); campo novo no item é lido vazio nas fichas antigas, sem migração SQL (como na ADR 016, item 9).                             |

Hoje o vendedor cria os itens à mão: adiciona um item, copia tipo, cor,
técnica, tecido e gola do primeiro e ajusta a grade, sem lugar para dizer de
que público é o item.

## 2. Objetivo

1. Cada item pode dizer seu **público** (masculino, feminino, infantil…), na
   tela e no papel.
2. Quando o cliente divide a quantidade, o pedido pendente nasce com **um item
   por público**, iguais em tudo menos o público e a quantidade dita.
3. O vendedor separa um item por público em um gesto, mesmo sem o bot.
4. Nada disso bloqueia quem não divide: sem divisão, o pedido continua com um
   item e sem público.

## 3. Proposta

### 3.1 Público no item

- Campo novo `items[].publico`, **opcional** e fora dos pontos que bloqueiam
  gerar. Valores: `masculino`, `feminino`, `infantil`, `unissex`, ou vazio
  (não informado). Lista fechada, para contar e imprimir sempre igual.
- Na tela, o público aparece no cabeçalho do item: "Item 2 · Camiseta comum ·
  Feminino · 10 peças". A edição é um seletor com rótulo visível "Público", ao
  lado de "Tipo de roupa", operável por teclado.
- "Baby look" continua sendo modelo ou tipo de roupa, não público; o bot não
  deduz "feminino" de "baby look".

### 3.2 Quantidade informada por item

- Campo novo `items[].quantidade_informada`, inteiro opcional e só de
  referência, como a quantidade informada do pedido (ADR 016, item 7). Não
  substitui a grade, nunca é somado ao total e não bloqueia.
- Quando o item tem grade e a soma difere, aparece o aviso já existente, agora
  por item: "A soma dos tamanhos (X) é diferente da quantidade informada (Y)".
  Sem grade, a Quantidade do item mostra "— (cliente informou Y)".

### 3.3 Divisão do bot

- Campo novo `audiences` no `briefing_patch`: o texto da divisão com as
  palavras do cliente ("10 masculinas, 10 femininas e 5 infantis"). O bot
  continua sem perguntar; só grava quando o cliente fala. O workflow deixa de
  usar `notes` para isso.
- O CRM lê o texto **só quando não há dúvida**, como faz com os tamanhos: cada
  parte é um número inteiro positivo junto de um público conhecido, uma vez
  cada ("4 masculinas, 3 femininas e 3 infantis", "masculino 10, feminino 5",
  "10 homens e 8 mulheres"). Palavras reconhecidas: masculin\*, homem/homens,
  masc → masculino; feminin\*, mulher/mulheres, fem → feminino; infantil,
  infantis, criança(s), kids → infantil; unissex. Fica para o vendedor tudo
  que deixa dúvida ("metade masculina", "infantil masculino", público
  repetido, parte sem número). A leitura mora no domínio de pedidos
  (`modules/orders/src/domain/audiences.js`), ao lado de `sizes.js`.
- Uma divisão com uma parte só ("20 femininas") marca o público do item 1, sem
  criar outro item.

### 3.4 Do bot para o pedido

- Com divisão lida, `briefingToFicha` gera um item por parte, na ordem dita,
  cada um com o público e a quantidade informada da parte e **os mesmos**
  tipo, cor, técnica, tecido, gola e estampa (referência) que hoje vão para o
  item 1. A grade só é preenchida quando há um item; com vários, os tamanhos
  ditos ficam em "Tamanhos informados" para o vendedor repartir.
- `projectBriefingOntoFicha` continua valendo só enquanto a conversa está com
  o bot. Os itens da divisão são do bot até o handoff: uma correção do cliente
  ("são 12 masculinas") refaz os itens da divisão, preservando técnica já
  escolhida pelo vendedor e itens que o vendedor acrescentou depois deles.
- Sem divisão lida, nada muda: um item, como hoje, e o texto em Dados do
  atendimento.

### 3.5 Separar por público na tela

- Ação **Duplicar item** em cada item: cria uma cópia logo abaixo, com todos
  os campos menos grade e quantidade informada, e leva o foco ao seletor de
  público do item novo. Serve para a divisão sem o bot e para qualquer item
  parecido.
- Rótulo acessível "Duplicar item N"; o leitor de tela anuncia "Item N+1
  criado".

### 3.6 Impressão v6

- `ficha-canonical-v6` mostra o público junto do número do item (selo
  "FEMININO" sob "Item 2") e a quantidade informada só quando difere da soma
  da grade. Os sete pontos e a paginação da v5 não mudam.
- Opcional, conforme a decisão D5: "Tecido" passa a "Modelo de malha" na tela
  e no papel, nome que o PO usa.
- V2–v5, PDFs e hashes não mudam. `PRINT_TEMPLATE` só passa à v6 depois da
  aprovação provisória do PO sobre uma amostra sintética; a assinatura física
  de Rose e Operação continua exigida antes da produção.

### 3.7 Contrato, dados e implantação

- API: o `PATCH` da seção Itens aceita `publico` (lista fechada) e
  `quantidade_informada` (inteiro de 1 a 100000), ambos opcionais; o OpenAPI e
  o validador de itens mudam. Fichas antigas são lidas com os dois vazios.
- n8n: `audiences` entra em `BRIEFING_PATCH_FIELDS`, no contrato
  `contract-v1.json` e no schema. **Ordem de implantação:** o CRM que aceita
  `audiences` vai ao ambiente antes do workflow que o envia (`mvp-simple-13`);
  um CRM antigo recusa a chave com `400`.
- Workflow: grava a divisão em `audiences`; a dica "divisão por público"
  passa a ler esse campo.
- Sem migração SQL, sem estado novo fora da ficha e sem nova infraestrutura.

## 4. Alternativas consideradas

| Alternativa                                                           | Por que não                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Público dentro do texto do tipo ("camiseta comum feminina")           | Zero mudança, mas não dá para contar nem imprimir de forma uniforme, e o vendedor precisa lembrar a convenção.                           |
| Público no campo adicional `modelo`                                   | A ADR 020 tirou `modelo` da tela; o público ficaria escondido e fora do papel.                                                           |
| Público como oitavo ponto obrigatório                                 | Obrigaria escolher público em todo pedido, inclusive boné e caneca; o PO quer item novo só quando o cliente fala.                        |
| Divisão estruturada vinda do modelo de IA (`[{publico, quantidade}]`) | O workflow achata objetos em texto e o modelo erra estrutura; o padrão do projeto é o CRM ler o texto só quando não há dúvida (ADR 016). |
| Continuar com a divisão só em `notes`                                 | É o estado atual (ADR 024): funciona, mas o vendedor monta os itens à mão a cada pedido dividido.                                        |
| Grade infantil lida automaticamente por público                       | Os tamanhos são passivos e quase nunca vêm separados por público; a leitura ficaria cheia de casos de dúvida. Fica para o vendedor.      |

## 5. Riscos

- **Divisão corrigida depois do handoff:** a projeção para no handoff (ADR 015);
  o vendedor ajusta os itens à mão.
- **Público errado num item duplicado:** o seletor recebe o foco logo após
  duplicar, para o vendedor escolher antes de seguir.
- **Mais itens no papel:** três itens por pedido dividido aumentam a chance de
  a página 1 transbordar; a paginação da v5 já reparte itens entre páginas, e
  a amostra da v6 deve testar um pedido com quatro públicos.
- **Ordem de implantação:** se o workflow novo for publicado antes do CRM, a
  resposta do bot não sai (`400`). O runbook da integração passa a listar o
  passo.

## 6. Critérios de aceite propostos

| ID     | Critério                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUB-01 | Cada item tem `publico` opcional (masculino, feminino, infantil, unissex ou vazio), editável por teclado com rótulo visível e mostrado no cabeçalho do item; não bloqueia gerar.        |
| PUB-02 | Cada item tem `quantidade_informada` opcional, só de referência; com grade e soma diferente, o item mostra o aviso de diferença; sem grade, "— (cliente informou Y)".                   |
| PUB-03 | O CRM aceita `audiences` no `briefing_patch` e lê a divisão só quando não há dúvida; o texto original fica em Dados do atendimento como "Divisão informada".                            |
| PUB-04 | Com divisão lida, o pedido pendente nasce com um item por público, na ordem dita, com os mesmos pontos projetados do bot, o público e a quantidade informada de cada parte.             |
| PUB-05 | Enquanto a conversa está com o bot, uma nova divisão refaz os itens da divisão sem apagar a técnica do vendedor nem itens acrescentados por ele; depois do handoff, nada é reprojetado. |
| PUB-06 | **Duplicar item** copia o item sem grade nem quantidade informada, insere a cópia logo abaixo e leva o foco ao público do item novo.                                                    |
| PUB-07 | `ficha-canonical-v6` imprime o público junto do número do item; v2–v5 intactas; `PRINT_TEMPLATE` muda só após a aprovação provisória do PO.                                             |
| PUB-08 | O workflow `mvp-simple-13` grava a divisão em `audiences`, nunca a pergunta, e vai ao ambiente depois do CRM que aceita o campo.                                                        |
| PUB-09 | Fichas gravadas antes são lidas com `publico` e `quantidade_informada` vazios; nenhuma migração SQL.                                                                                    |

## 7. Decisões do PO (05/10/2026: todas conforme a recomendação)

| #   | Decisão                                                                 | Recomendação do Tech Lead                                                   |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| D1  | Público é lista fechada ou texto livre?                                 | Lista fechada: masculino, feminino, infantil, unissex.                      |
| D2  | Infantil se divide por gênero (infantil masculino e infantil feminino)? | Não por enquanto; o vendedor anota no tipo se precisar.                     |
| D3  | Público bloqueia gerar o pedido?                                        | Não: só existe quando o cliente divide.                                     |
| D4  | Quantidade informada por item?                                          | Sim, só de referência (seção 3.2).                                          |
| D5  | "Tecido" passa a "Modelo de malha" na tela e na v6?                     | Sim, se for o nome usado na Silmer; é só rótulo, a chave `malhas` não muda. |
| D6  | Onde o público aparece no papel?                                        | Junto do número do item, sem mexer nos sete pontos.                         |
| D7  | Ação "Duplicar item" entra nesta entrega?                               | Sim: resolve a divisão sem o bot e qualquer item parecido.                  |

## 8. Entrega proposta, depois da decisão

1. ADR 025 com as decisões e critérios `PUB-*` na spec.
2. Domínio e API: `publico`, `quantidade_informada`, leitura de `audiences`,
   projeção em N itens; OpenAPI, contrato n8n e testes.
3. Tela do pedido: seletor de público, cabeçalho, aviso por item e Duplicar
   item, com E2E por teclado.
4. Impressão v6 com amostra sintética de quatro públicos para aprovação.
5. Workflow `mvp-simple-13` com `audiences`, depois do CRM no ambiente.

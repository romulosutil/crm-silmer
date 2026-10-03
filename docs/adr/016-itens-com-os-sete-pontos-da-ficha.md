# ADR 016 — Itens com os sete pontos da ficha

Status: aceito

Data: 02/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 02/10/2026, depois do diagnóstico dos
pedidos do cloud-dev. A leitura dos tamanhos, a regra do nome do cliente, a
compatibilidade das fichas gravadas e as chaves de `missingFields` são do Tech
Lead.

Requisitos: `PFI-01..14`, `PCL-04`, `PCL-05` e os novos `PIT-01..11` da
[especificação Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md);
tarefas T56–T61 em [tasks](../../.specs/features/pedidos-mvp/tasks.md).
Substitui a regra A01 do
[contexto](../../.specs/features/pedidos-mvp/context.md) e, na
[ADR 012](012-ficha-de-sete-pontos-e-ritmo-fixo.md), só o trecho do item 3
(D26) que põe a gola no texto do modelo. A ficha impressa com os mesmos pontos
é a [ADR 017](017-ficha-impressa-com-os-sete-pontos.md), que usa a forma do
item desta decisão.

## Contexto

Desde a ADR 012, o bot coleta sete pontos em ordem fixa: tipo de roupa, cor,
quantidade, estampa, tecido, tamanhos e gola. O pedido continuava montado
sobre o item da ficha v2 (tipo, modelo, malhas, cor de cada parte, viés e
grade), e o diagnóstico do cloud-dev em 02/10/2026 mostrou que quase nada do
que o bot coleta chega ao pedido:

- os 23 pedidos mostram 0 peças: os tamanhos chegam como texto ("5 P, 10 M")
  e nunca viram grade;
- cor e quantidade ficam só em "Dados do atendimento", que vem fechado e não
  sai na ficha;
- "Tipo de serviço" recebe "estampada", "foto" e "sem aplicação", que não são
  técnicas;
- o tipo de roupa cai em Modelo, e Tipo fica vazio;
- "Definir com o vendedor" sai impresso como tecido;
- o cliente pode ser o nome do perfil do WhatsApp.

A regra A01 deixava gerar o pedido com um único item com grade, valor e
condição: um pedido sem cor, sem estampa ou sem gola podia ir para a fábrica.

## Decisão

1. **Forma do item.** Cada `ficha.items[]` tem, na ordem da tela:
   - **Principais:** `tipo` "Tipo de roupa"; `cor` "Cor" (novo); Quantidade,
     que não é gravada e é sempre a soma de `grade`; `estampa` "Estampa"
     (novo); `malhas` "Tecido" (lista de textos); `grade` "Tamanhos" (lista de
     `{tamanho, quantidade}`); `gola` "Gola" (novo).
   - **Adicionais (não obrigatórios):** `modelo` "Modelo", `cor_frente` "Cor
     frente", `cor_costas` "Cor costas", `cor_manga_direita` "Manga direita",
     `cor_manga_esquerda` "Manga esquerda", `vies_gola` "Viés gola" e
     `vies_mangas` "Viés mangas". Mangas e viés mantêm "Não aplicável". Na tela,
     ficam num bloco recolhível "Adicionais (não obrigatórios)", fechado ao
     abrir.
   - O cabeçalho do item é "Item N · <tipo de roupa ou —> · <quantidade>
     peças".
   - Esta forma é o contrato da ficha impressa v3 (ADR 017): mudar uma chave
     exige combinar com ela.

2. **Gerar pedido.** Para gerar (confirmar) o pedido, é preciso ao menos um
   item e, em todo item, os sete principais: tipo, cor, estampa, ao menos um
   tecido não vazio, ao menos uma linha de tamanho (logo, quantidade maior que
   zero) e gola; além do valor final e da forma de pagamento. Nada mais
   bloqueia nem aparece como faltando: os adicionais nunca, e o resumo
   (cliente, evento/nome, tipo de serviço, entrega prometida) deixa de ser
   listado como "em branco", embora continue editável.
   - `missingFields`, nesta ordem: `items` (nenhum item);
     `items[N].tipo`, `items[N].cor`, `items[N].estampa`, `items[N].malhas`,
     `items[N].grade` e `items[N].gola` (N a partir de 0; a grade vale também
     pela quantidade, que não tem chave própria); `finalAmount`;
     `paymentCondition`. Os mesmos nomes voltam em `fields` do 422
     `ORDER_NOT_CONFIRMABLE`.
   - "Falta para gerar: …" diz cada ponto em palavras simples: "cor do item
     1", "tamanhos do item 2", "valor final", "forma de pagamento".

3. **Salvar itens.** A seção Itens aceita item incompleto, porque o bot abre o
   pedido com o que tem
   ([ADR 014](014-pedido-abre-no-primeiro-ponto-da-ficha.md)) e o vendedor
   completa aos poucos. Sai a
   regra "ao menos um tecido e uma linha de grade para salvar". Continuam: cada
   linha de tamanho com tamanho não vazio e quantidade inteira maior que zero,
   tecido sem linha em branco, textos de até 200 caracteres e até 50 itens.

4. **Rótulos da tela.** "Condição de pagamento" vira "Forma de pagamento" (o
   campo da API continua `paymentCondition`); "Grade" vira "Tamanhos";
   "Malhas" vira "Tecido"; "Tipo" vira "Tipo de roupa". Em "Dados do
   atendimento", `sizes` é "Tamanhos informados" e `artwork_technique` é
   "Estampa desejada".

5. **Do bot para o pedido (só o item 1).** A projeção continua só enquanto a
   conversa está com o bot (`automation_state = 'assistant'`); como a
   conversa nunca volta ao bot
   ([ADR 015](015-conversa-nao-volta-para-o-bot.md)), não há projeção depois
   do handoff.
   - `product_model` → `tipo`; sem ele, `product_type` → `tipo`; com ele,
     `product_type` fica no atendimento.
   - `colors` → `cor`. As quatro cores por parte nunca vêm do bot.
   - `artwork_status` → `estampa`; quando `artwork_locations` tem um local de
     verdade (nem "sem aplicação" nem "Definir com o vendedor"), entra depois
     de " · ". "Sem aplicação" vira "Sem estampa".
   - `fabrics` → `malhas` (uma entrada), como antes.
   - `collar` → `gola`, que deixa de entrar no modelo. O modelo fica com o
     vendedor.
   - `sizes` → `grade` quando o texto não deixa dúvida (item 6); senão a grade
     fica vazia e o texto fica em "Tamanhos informados".
   - `quantity` fica no atendimento, como "Quantidade informada" (item 7).
   - `artwork_technique` → `summary.aplicacao` só quando nomeia uma técnica:
     silk ou serigrafia, sublimação (total ou parcial), DTF, DTG, bordado,
     transfer ou "sem aplicação". "Estampada", "com estampa", "foto" e
     descrições ficam como "Estampa desejada".
   - "Definir com o vendedor" nunca vira valor da ficha: o campo fica vazio, e
     por isso bloqueia o pedido até o vendedor preencher, e o texto fica no
     atendimento.
   - `order_name` → `summary.nome`, como antes.

6. **Leitura dos tamanhos.** O texto vira grade só quando cada parte é um
   tamanho conhecido junto de uma quantidade inteira maior que zero, na mesma
   ordem em todo o texto: "5 P, 10 M, 8 G, 2 GG", "P5 M10 G10", "10 P, 15 M e
   15 G", "25 M e 25G", "M10, G15 e GG5", "P 40, M 70, G 60 e GG 30" e "M: 15;
   G: 15" (o objeto `{"M": 15, "G": 15}` achatado pelo workflow). Também valem
   o objeto e a lista estruturada que o CRM já lia. Os tamanhos são os
   alfabéticos de adulto do catálogo (RFC 005, seção 6.6, e
   `order-catalog.js`): PP, P, M, G, GG, XG, XGG, EG, EGG, G1 a G5, XX e
   JEGÃO. Baby look é modelagem no catálogo, não tamanho. Fica para o
   vendedor tudo que deixa dúvida: tamanhos infantis numéricos ("4 anos 3"),
   "10 de cada", um total junto da divisão, tamanho repetido, palavra que
   sobra, ordem trocada no meio do texto, quantidade zero. A leitura mora no
   domínio de pedidos (`modules/orders/src/domain/sizes.js`).

7. **Quantidade informada.** A tela mostra a quantidade que o cliente disse
   ao lado de "Total de peças". Quando há tamanhos e a soma difere, aparece o
   aviso, que não bloqueia: "A soma dos tamanhos (X) é diferente da quantidade
   informada (Y)". Sem tamanhos, a Quantidade do item 1 mostra "— (cliente
   informou Y)".

8. **Cliente.** O cliente do pedido é sempre um nome confirmado, nunca o do
   perfil. O CRM não guarda o nome do perfil do WhatsApp: o contato nasce sem
   nome, e `display_name` só é escrito por uma pessoa, ao renomear o contato
   (origem `manual` em `display_name_source`), ou pela promoção do
   `customer_name` do bot em `#promoteCustomerName` (origem `automation`),
   que o workflow só grava quando o cliente digitou o nome (ADR 011, item 7).
   O único nome não confirmado que o pedido usava era o identificador do canal
   (o "@handle" do Instagram). Regra: o nome do contato quando a origem é
   `manual` ou `automation`; senão o `customer_name` do briefing; senão
   vazio. Não há mudança de esquema. Um nome de perfil gravado como
   `customer_name` por versões do workflow anteriores a 30/09/2026 não se
   distingue de um nome confirmado, e os pedidos já abertos guardam o
   cliente que receberam.

9. **Fichas gravadas.** A ficha é JSON cifrado, sem migração SQL possível sem
   decifrar. Uma ficha gravada antes desta decisão é lida com `cor`,
   `estampa` e `gola` vazios, e `missingFields` e o total de peças são
   recalculados a cada leitura pela regra nova; a coluna é corrigida na
   próxima escrita. `ficha_version` continua 1: nenhum código a lia para
   evoluir a forma. Por uma versão, o `PATCH` da seção Itens aceita item sem
   as três chaves novas e grava as três vazias; a versão seguinte passa a
   exigi-las, como as demais.

## Consequências

- A regra A01 do contexto está substituída: além de valor e forma de
  pagamento, todo item precisa dos sete principais. Um pedido pendente que
  hoje mostra "Pronto para confirmar" pode passar a mostrar o que falta.
- Na ADR 012, o item 3 (D26) continua valendo para o `briefing_patch`; só a
  parte em que a gola entra no texto do modelo é substituída: a gola é campo
  do item. O resto da ADR 012 não muda.
- A ficha impressa v2 não muda (travada por hash): ignora `cor`, `estampa` e
  `gola` e continua imprimindo os pedidos antigos e os novos. A v3 da ADR 017
  imprime os sete pontos.
- O workflow do n8n não muda, e o CRM pode ir ao ambiente sem ordem de
  implantação. O contrato do `briefing_patch` é o mesmo.
- Os pedidos já abertos não são remapeados: o tipo de roupa que caiu em
  Modelo continua lá até o vendedor editar, e a próxima projeção do bot, se a
  conversa ainda estiver com ele, preenche os principais do item 1.
- O vendedor tem de preencher cor, estampa e gola em pedidos que antes já
  podiam ser gerados.

## Alternativas descartadas

- **Manter A01 (um item com grade basta):** é o que deixava ir para a fábrica
  pedido sem cor, estampa ou gola.
- **Bloquear também o resumo e os adicionais:** recria o gate rígido que
  tornou o Kanban inviável (ADR 004); o PO quer bloquear só o que a fábrica
  não pode adivinhar.
- **Migrar as fichas gravadas e subir `ficha_version`:** exigiria decifrar e
  cifrar de novo cada envelope num job da aplicação; ler com os campos vazios
  resolve sem risco.
- **Gravar a quantidade no item:** seria um segundo número para a mesma coisa,
  que pode discordar dos tamanhos; a quantidade dita fica como referência.
- **Ler os tamanhos com o modelo no workflow:** não é determinístico; o CRM
  lê só o que não deixa dúvida e guarda o texto original.
- **Distribuir a cor do bot nas quatro partes:** o cliente diz uma cor da
  peça; frente, costas e mangas são detalhe que o vendedor define.

# ADR 022 — Itens por público no pedido

Status: aceita

Data: 05/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 05/10/2026, definiu que gênero e idade
criam itens, só quando o cliente fala da divisão, e que os itens assumem o
mesmo modelo, cor, malha e arte; depois, aceitou as recomendações D1–D7 da
RFC. Tech Lead definiu a leitura da divisão, a projeção em vários itens, a
compatibilidade das fichas gravadas e a ordem de implantação.

RFC: [RFC 010](../rfc/010-itens-por-publico.md). Requisitos `PUB-01`–`PUB-09`
da [spec](../../.specs/features/pedidos-mvp/spec.md); tarefas T92–T96 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md). Complementa a
[ADR 016](016-itens-com-os-sete-pontos-da-ficha.md) (forma do item, projeção do
bot e quantidade informada), a [ADR 020](020-tecnica-por-item-e-arte-do-pedido.md)
(rótulos) e a [ADR 021](021-atendimento-comeca-pelo-produto.md) (a divisão
deixa `notes` e ganha campo próprio).

## Contexto

"10 camisas, sendo 4 masculinas, 3 femininas e 3 infantis" são três itens na
ficha, iguais em tudo menos o público e a quantidade. O item não tinha onde
dizer o público, a projeção do bot só preenchia o item 1 e o vendedor copiava
os pontos à mão em cada item novo.

## Decisão

1. **Público (D1–D3).** `items[].publico` é opcional, numa lista fechada:
   `masculino`, `feminino`, `infantil`, `unissex`, ou vazio. Infantil não se
   divide por gênero. O público não é ponto obrigatório e não entra em
   `missingFields`. A tela o mostra no cabeçalho do item e o edita num
   seletor com rótulo "Público".
2. **Quantidade informada por item (D4).** `items[].quantidade_informada` é um
   inteiro opcional de 1 a 100000, só de referência: não é somado, não
   substitui a grade e não bloqueia. Com grade e soma diferente, o item mostra
   o aviso da ADR 016 (item 7); sem grade, a Quantidade do item mostra "—
   (cliente informou Y)".
3. **Divisão do bot.** O `briefing_patch` ganha `audiences`, o texto da
   divisão com as palavras do cliente. O CRM o lê só quando não há dúvida:
   cada parte é um inteiro positivo junto de um público conhecido, uma vez
   cada público; o resto fica com o vendedor, e o texto não lido aparece em Dados do
   atendimento como "Divisão informada". A leitura mora em
   `modules/orders/src/domain/audiences.js`.
4. **Projeção em vários itens.** Com duas ou mais partes lidas, o pedido
   pendente nasce com um item por parte, na ordem dita, cada um com o público,
   a quantidade informada e os mesmos pontos que o bot projeta (tipo, cor,
   técnica, tecido, gola e estampa de referência); a grade só é projetada
   quando há um item. Uma parte só marca o público e a quantidade informada
   do item 1. Enquanto a conversa está com o bot, uma divisão nova refaz os
   itens da divisão, sem apagar a técnica do vendedor nem os itens que ele
   acrescentou depois; depois do handoff, nada é reprojetado (ADR 015).
5. **Duplicar item (D7).** Cada item tem a ação "Duplicar item N": a cópia
   entra logo abaixo, sem grade nem quantidade informada, e o foco vai ao
   público do item novo.
6. **Rótulo (D5).** "Tecido" passa a **Modelo de malha** na tela e no papel; a
   chave `malhas` e a API não mudam.
7. **Impressão v6 (D6).** `ficha-canonical-v6` mostra o público junto do
   número do item, o novo rótulo do ponto 5 e a quantidade informada quando
   difere da soma; os sete pontos e a paginação da v5 continuam. V2–v5, PDFs e
   hashes não mudam. `PRINT_TEMPLATE` só passa à v6 depois da aprovação
   provisória do PO sobre a amostra sintética de quatro públicos; a
   assinatura física de Rose e Operação continua exigida antes da produção.
8. **Compatibilidade e implantação.** Fichas gravadas são lidas com
   `publico` e `quantidade_informada` vazios, sem migração SQL; a coluna é
   corrigida na próxima escrita. O CRM que aceita `audiences` vai ao ambiente
   antes do workflow `mvp-simple-13`, que o envia; um CRM antigo recusa a
   chave com `400`.

## Consequências

- Um pedido dividido chega com os itens prontos para o vendedor repartir os
  tamanhos, e o papel diz de que público é cada item.
- O vendedor separa itens parecidos com um gesto, mesmo sem o bot.
- Pedidos sem divisão não mudam: um item, sem público.
- A divisão escrita de forma ambígua continua só como texto para o vendedor.
- O rótulo "Modelo de malha" muda na tela já; no papel, só quando a v6 for
  aprovada.

## Alternativas descartadas

- **Público no texto do tipo ou no `modelo`:** sem estrutura, escondido ou fora
  do papel.
- **Público como oitavo ponto obrigatório:** exigiria público em boné e
  caneca e em todo pedido sem divisão.
- **Divisão estruturada vinda do modelo de IA:** frágil; o padrão do projeto é
  o CRM ler o texto só quando não há dúvida (ADR 016).
- **Divisão só em `notes`:** o vendedor seguiria montando os itens à mão.

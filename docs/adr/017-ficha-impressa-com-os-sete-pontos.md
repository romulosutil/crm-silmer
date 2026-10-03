# ADR 017 — Ficha impressa com os sete pontos

Status: aceito. A v3 só passa a imprimir pedidos depois que o PDF de revisão
for aprovado; até lá a v2 continua imprimindo, sem mudar nenhum byte.

Data: 02/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 02/10/2026, ao decidir que a ficha
impressa muda junto com a tela do pedido: "gero um PDF novo com os 7 pontos no
lugar e você aprova antes de valer". A regra de impressão dos adicionais, o
ponto único de troca e o gate de aprovação são decisões técnicas, revogáveis
pelo PO na revisão do PDF.

Relacionadas: [ADR 008](008-lastro-de-datas-do-pedido.md) (lastro de datas),
[ADR 012](012-ficha-de-sete-pontos-e-ritmo-fixo.md) (ficha de sete pontos do
bot) e ADR 016 (itens do pedido com os sete pontos, em branch paralela, sem
link até entrar no `master`). Requisitos: `PIM-06` a `PIM-10` e `PLA-08` em
[especificação Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md);
tarefas T62 a T64 em [tasks](../../.specs/features/pedidos-mvp/tasks.md).
Revisão do PDF: [roteiro da v3](../phase0/FICHA-PDF-REVIEW-V3.md).

## Contexto

A tela do pedido passa a mostrar cada item como os sete pontos da ficha do bot
(ADR 012): tipo de roupa, cor, quantidade, estampa, tecido, tamanhos e gola,
com os demais campos do item recolhidos como adicionais (ADR 016). A ficha
impressa aprovada, `ficha-canonical-v2`, organiza o item de outro jeito: tipo
e modelo no título, malha, cor de cada parte da peça e viés. Ela não tem cor,
estampa nem gola; desde a ADR 012 a gola só chega ao papel dentro do texto do
modelo. Com tela e papel diferentes, a fábrica teria de traduzir um no outro.

A v2 foi aprovada por Rose e Operação em 31/08/2026 e está travada por hash
(T00.4). A ADR 008 previa levar o lastro de datas ao papel numa v3 "ficha por
produto", guiada pelo catálogo, no branch `feat/ficha-por-produto`. Essa v3
nunca foi aprovada, e o catálogo saiu da tela (T49: campos só de texto). A T48
também renomeou dois rótulos do Resumo na tela, "Tipo de serviço" e "Entrega
prometida", sem mudar a v2.

Na revisão do PDF (02 e 03/10/2026), o PO decidiu que a Entrega prometida
precisa estar preenchida para gerar o pedido (bloqueio na ADR 016), então o
pedido impresso sempre a traz. O Pagamento não bloqueia: por ora, gerar o
pedido implica pagamento, e o dia fica na faixa do lastro, com "—" enquanto
ninguém o registrar. A Entrega realizada é conciliação depois da venda e nunca
bloqueia.

## Decisão

1. **Novo template `ficha-canonical-v3`.** O arquivo
   `modules/orders/src/print/ficha-canonical-v3.js` é novo; o da v2 fica
   idêntico byte a byte e continua imprimindo até a aprovação.

2. **Página 1.**
   - **Resumo:** Cliente, Entrega prometida (`data_entrega_confirmada`), Total
     de peças e Tipo de serviço (`aplicacao`); abaixo, Evento / Nome,
     Vendedor, Data do pedido e FAB. Valor final e forma de pagamento
     continuam fora do papel (D12).
   - **Lastro do pedido:** cada uma das cinco datas da ADR 008 sai uma vez só
     na página 1. A data do pedido (Pedido fechado) e a Entrega prometida
     ficam só no Resumo, como "Data do pedido" e "Entrega prometida"; a faixa
     do lastro traz as outras três, nesta ordem: Primeiro contato (o dia em
     São Paulo), Pagamento e Entrega realizada.
   - **Itens:** cada item traz os sete pontos numerados de 1 a 7, nesta ordem
     e com estes rótulos: Tipo de roupa (`tipo`), Cor (`cor`), Quantidade
     (soma da grade, nunca gravada), Estampa (`estampa`), Tecido (`malhas`,
     unidas por " / "), Tamanhos (blocos de tamanho e quantidade, da `grade`)
     e Gola (`gola`).
   - **Observações e total de peças**, como na v2, depois do último item.

3. **Adicionais só quando preenchidos** (aprovado pelo PO). Modelo, Cor
   frente, Cor costas, Manga direita, Manga esquerda, Viés gola e Viés mangas
   saem num bloco compacto "Adicionais", no pé do item, só quando ao menos um
   deles estiver preenchido, e só os preenchidos, sempre nessa ordem. "NAO
   APLICAVEL" é valor preenchido. Motivos:
   - A ficha do CRM é a fonte da verdade (RULES 4). Linhas em branco para
     escrever à mão convidariam a decidir especificação comercial no papel,
     fora do CRM, sem autor nem auditoria (RULES 8 e 10). O que se preenche à
     mão é o controle de produção da página 2.
   - O que define a peça são os sete pontos. Adicional vazio quer dizer "segue
     os pontos principais", não "esquecido"; sete linhas vazias em todo item
     esconderiam o item que tem de fato um detalhe diferente.
   - Espaço: com o bloco só quando há conteúdo, resumo, lastro e dois itens
     cabem na página 1, e menos itens vão para a continuação.
   - Ordem fixa: a fábrica acha cada adicional sempre na mesma posição
     relativa, como lia a peça na v2 (modelo, corpo, mangas, viés).

4. **Campo vazio sai como "—"** (A01, aprovado pelo PO): ponto principal,
   campo do Resumo ou dia do lastro ainda não registrado (a Entrega realizada
   e, enquanto ninguém o registrar, o Pagamento). Uma ficha gravada antes desta mudança não tem `cor`, `estampa`
   nem `gola`: esses três pontos saem como "—" e todos os campos da v2
   (modelo, cores por parte e viés) continuam no papel, nos adicionais. Nada
   da v2 se perde.

5. **Português com acento** (pedido do PO na revisão do PDF). A v3 passa
   por uma aprovação nova, então todo rótulo impresso sai com acento, nas duas
   páginas e na faixa de amostra ("Amostra sintética — não produzir",
   "Controle de produção", "Conferência e embalagem"...). O valor gravado
   "NAO APLICAVEL" sai como "NÃO APLICÁVEL" só no papel; o dado gravado não
   muda. O que as pessoas digitam sai como foi digitado.

6. **Controle de produção como na v2.** Os 14 campos de produção chegam em
   branco, com os mesmos rótulos, ordem e leiaute da v2 aprovada; só os
   acentos mudam. A faixa de amostra e a caixa de aprovação pendente saem só
   na amostra de revisão: um pedido impresso não diz à fábrica que há um gate
   pendente. Na v2 a caixa sai também no pedido real, porque a v2 é travada.

7. **Páginas de continuação** (pedido do PO na revisão do PDF). O navegador
   não repete um cabeçalho nas páginas que ele mesmo quebra, então o
   template decide as páginas: a página 1 leva o Resumo, o lastro e os
   primeiros itens; os itens que não cabem vão para páginas de continuação,
   cada uma com o mesmo cabeçalho (Silmer, "FICHA DE PEDIDO" e o número do
   pedido) e a marca "Página N · continuação dos itens"; observações e total
   fecham a última página de itens; o controle de produção vem por último,
   com o seu cabeçalho. Item nunca se divide entre páginas e mantém o número
   (Item 3 na página 2). A altura de cada item é estimada pelo tamanho dos
   textos, dos tamanhos e dos adicionais, com folga: o item que talvez não
   caiba passa para a página seguinte, em vez de cair numa página sem
   cabeçalho. Para a estimativa valer em qualquer máquina, a v3 imprime em
   Arial ou fonte com as mesmas medidas (Helvetica, Liberation Sans, Arimo),
   sem a Poppins da v2. O PDF de revisão confere que tem exatamente as
   páginas planejadas; no rodapé dele, "Página X de N" segue a mesma conta.

8. **Aprovação antes de valer.** O pacote de revisão da v3 espelha o da v2:
   amostra sintética (`docs/phase0/ficha-pdf-synthetic-v3.json`, um pedido no
   contrato `Order` que passa pelo mesmo `printSnapshot` da rota), registro
   (`docs/phase0/ficha-pdf-approval-v3.json`), PDF
   (`output/pdf/ficha-canonica-sintetica-v3.pdf`) e validação fail-closed em
   `npm run validate:ficha-pdf-review`. Os hashes travam a amostra, o HTML
   renderizado e o PDF. O HTML entra no registro porque o PDF não se reproduz
   byte a byte em outra máquina (fontes do sistema e data de criação), e o
   HTML sim: mudar o template depois do PDF quebra a validação. A aprovação
   fica pendente. **Quem assina é decisão do PO:** na v2 assinaram Rose e
   Operação; o registro da v3 aceita a lista de papéis e nomes que o PO
   definir, com os seis critérios da v2 e uma evidência sem PII. Versão
   aprovada não se regera; correção depois da aprovação cria uma v4.

9. **Ponto único de troca.** A constante `PRINT_TEMPLATE`, em
   `modules/orders/src/print/index.js`, escolhe o template de todo pedido
   impresso; a rota `GET /api/v1/orders/:orderId/print` chama
   `renderOrderFicha(order)` e não escolhe nada. Ela fica em
   `ficha-canonical-v2`. Depois da aprovação, o Tech Lead registra a
   aprovação no gate e troca a constante para `TEMPLATE_V3` num commit
   próprio. A validação e os testes recusam a v3 nesse ponto enquanto o gate
   estiver pendente.

## Alternativas descartadas

- **Manter a v2:** tela e papel com itens diferentes, e cor, estampa e gola
  fora do papel ou escondidas no texto do modelo.
- **Retomar a v3 por produto** (`feat/ficha-por-produto`, ADR 007 reservada e
  não aceita): o item dependia do catálogo e de perfis de produto que o PO não
  aprovou, e não seguia os sete pontos. Dela vieram só o lastro na página 1
  (T47) e o snapshot de impressão fora da rota.
- **Adicionais sempre impressos, com linhas para escrever à mão:**
  especificação decidida no papel, fora do CRM, e item mais alto; com três ou
  mais itens a página 1 transborda.
- **Adicionais sempre impressos com "—":** sete "—" por item na maior parte
  dos pedidos, ruído sem informação.
- **Deixar o navegador quebrar as páginas:** a página que ele cria não tem
  cabeçalho nem número do pedido. Repetir o cabeçalho por CSS (`thead` de
  tabela) não leva o número de cada página, e as caixas de margem de `@page`
  só existem no Chromium; as páginas decididas pelo template valem em
  qualquer navegador.
- **Lastro com as cinco datas na faixa:** repetia no papel a Data do pedido e
  a Entrega prometida, que já estão no Resumo; o PO pediu cada data uma vez.
- **Trocar a v2 direto, sem amostra:** quebraria o gate por hash da T00.4 e a
  decisão do PO de aprovar antes de valer.

## Consequências

- Até a aprovação nada muda no papel: a v2 imprime como hoje (PIM-02,
  PLA-09). Depois da troca, a v2 continua no repositório, travada, como
  referência.
- D15 ("impressão só no template v2") vale até a troca. `PLA-08` passa a
  apontar para esta v3, e a T47 fica superada pela T63.
- Enquanto a ADR 016 não grava `cor`, `estampa` e `gola`, todo pedido real
  impresso na v3 sairia com "—" nesses pontos; a troca de template deve vir
  depois dela.
- A v2 continua sem acento, como foi aprovada; a v3 sai com acento nas duas
  páginas.
- O PDF de revisão é gerado no Dell, com Liberation Sans no lugar de Arial
  (mesmas medidas). O pedido impresso pelo navegador usa a Arial da máquina
  que imprime. O rodapé "Página X de N" é do PDF de revisão; no pedido real, o
  número de cada página de continuação está no cabeçalho, e o rodapé depende
  da opção de cabeçalho e rodapé do navegador, como na v2.
- A estimativa de altura deixa espaço livre no pé de algumas páginas: é o
  preço de nunca imprimir um item numa página sem cabeçalho.

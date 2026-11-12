# ADR 086 — Pedido refinado

Status: aceita em 12/11/2026 pelo PO (Rômulo), a partir do protótipo "Pedido
refinado".

Decisores: PO (Rômulo) e Tech Lead UX.
Não supersede nenhuma ADR. Estende a [ADR 083](083-edicao-no-lugar.md) (edição
no lugar) de "Itens e especificações" para Resumo, Arte e Observações, e aplica
ao pedido a escala e a hierarquia da [ADR 084](084-caixa-de-entrada-refinada.md).
Antecipa, sem antecipar o código, as [ADR 079](079-olist-a-partir-do-pedido-confirmado.md),
[ADR 080](080-valor-final-com-frete.md) e
[ADR 082](082-cadastro-obrigatorio-somente-no-envio-olist.md).
Contrato visual: [design.md](../../design.md), §22 (PED-RD) e um parágrafo de
remissão na §9.
Requisitos: PED-RD-01 a PED-RD-16 em
[Pedido refinado](../../.specs/features/pedido-refinado/spec.md); tarefas
PED-RD-T00 a T10 em
[tasks.md](../../.specs/features/pedido-refinado/tasks.md). Preservados:
PFI-04, PFI-10, PFI-13 a PFI-16, PFI-19, PFI-20, PIT-01 a PIT-05, OLIST-43 e
EDIT-01.
RFC: não houve, como nas ADR 083 e 084; a proposta foi avaliada diretamente no
protótipo (canvas Design privado, com cópia local em
`output/prototipos/pedido-refinado/`, que não é versionada).
Esta entrega é documental; nenhuma tela foi alterada.

## Contexto

Problemas observados na página do pedido (`/pedidos/:id`,
`apps/edge-web/src/views/OrderView.vue`) e na revisão do protótipo:

- Nove seções empilhadas com o mesmo peso visual; nada diz o que é o pedido,
  o que falta e o que é bastidor.
- Quatro modelos de salvamento convivendo: edição no lugar nos itens,
  "Editar" + Salvar/Cancelar no Resumo, na Arte e nas Observações, comando por
  alteração na data e diálogo no fechamento.
- Cliente, entrega e peças repetidos em três ou quatro lugares (cabeçalho,
  Resumo, Datas, Fechamento).
- Abaixo de 1200 px o painel "Fechamento e pagamento" cai depois de todas as
  seções; a ação principal e o progresso ficam no fim da página (hoje o rail
  entra em 75rem e, antes disso, vem depois da ficha).
- "Datas do pedido" foi movida e achatada em tentativas anteriores, embora o
  container em produção seja bom e só precise de acabamento.
- Os componentes não reagem à largura do próprio container: o que cabe em um
  arranjo quebra em outro.

Não há medida numérica de produção nesta decisão; os números (contagem de
ações, nós em cada tamanho de texto, espaços fora da escala) são coletados na
tarefa PED-RD-T10, antes e depois, e entram na §22 do `design.md` quando
existirem.

História do protótipo: uma v1 (ficha com rail) foi desenhada; o PO testou uma
v2 sem rail, com blocos de largura total ordenados por momento, e a rejeitou
em favor da v1, pedindo que se refinasse a arquitetura e a hierarquia da
informação. Também disse que o container de "Datas do pedido" de produção é
muito bom e só deve ser refinado, que "Arte final" e "Arquivos da arte" devem
ficar lado a lado e que faltava responsividade aos componentes.

## Decisão

1. **Três camadas.** Cabeçalho (identidade e fatos-chave), ficha (o que será
   produzido) e rail de fechamento (o negócio). O cabeçalho é a fonte única de
   entrega, peças e valor; nenhum outro bloco os repete.
2. **Ficha numa folha só**, na ordem da ficha impressa: Resumo do pedido →
   Datas do pedido → Itens e especificações → Arte do pedido → Observações do
   pedido → Dados do atendimento (recolhido e fora da impressão). Capítulos
   separados por divisor e respiro, não um cartão por seção; só os cartões de
   item têm borda dentro da folha.
3. **Rail = "Fechamento e pagamento".** Pendente: progresso honesto "Para gerar
   o pedido: N de 3", "Valor do pedido" (Peças + Frete = Total) e a única
   primária da página. Confirmado: fechamento em leitura, resumo de Cobranças
   e bloco Olist, cada um com a sua primária.
4. **Rail antes da ficha abaixo de 75rem.** Ele é o primeiro filho do layout
   no DOM; as áreas de grade (`grid-template-areas`) o põem à direita a partir
   de 75rem. A ordem visual e a ordem do DOM e do foco coincidem em toda
   largura.
5. **Resumo sem fatos repetidos:** Cliente (texto, "Ver cadastro"), Nome do
   pedido e Previsão de entrega; os dois campos lado a lado em container de
   40rem ou mais.
6. **Arte:** "Quem faz a arte" no topo; "Arte final" e "Arquivos da arte" lado
   a lado em container de 32rem ou mais, empilhados no estreito.
7. **Datas = container de produção refinado**
   (`OrderMilestonesSection.vue`): contador neutro no cabeçalho, linha do
   tempo horizontal com data acima, ponto na trilha (concluído preenchido,
   próximo vazado), título sublinhado em pontilhado que abre o detalhe,
   subtítulo, e rodapé com "Recebido" e "Falta receber" (só confirmado).
   Em container de 30rem ou menos vira vertical, sem rolagem lateral.
8. **Quatro níveis de hierarquia** (página, capítulo ou bloco do rail,
   subseção, rótulo e metadado) e ritmo vertical de 32 px entre capítulos, 24
   px entre subseções e 16 px entre campos, na escala de 4 px. Uma superfície
   por nível.
9. **Responsividade por container.** Todo container de layout declara
   `container-type: inline-size`, `inline-size: 100%` e `min-inline-size: 0`;
   as grades internas usam `@container`. Nunca centralizar com
   `margin-inline: auto` dentro de grade ou flex sem largura explícita.
10. **Edição no lugar (§20) estendida** a Resumo, Arte e Observações: sem
    "Editar <seção>", sem Salvar/Cancelar de seção, `SaveStatus` no cabeçalho
    do capítulo. Observações ganha cabeçalho visível das colunas e `BlankRow`.

## O que não muda

- Rascunho aceita campos em branco; só gerar o pedido cobra o que falta
  (`RULES.md`, regra 14), lido de `missingFields`.
- Quantidade do item e total do pedido saem dos tamanhos e nunca são digitados
  (PFI-04); subtotais por tamanho continuam obrigatórios (decisão do PO de
  10/11/2026).
- Pedido confirmado e quem não pode editar veem tudo em leitura (PFI-10); a
  autorização continua na API.
- Uma só ação primária por região (PFI-13, §14).
- Gerar e imprimir continuam ações distintas; estado, autor e horário da
  confirmação ficam visíveis.
- O cadastro incompleto do cliente nunca entra em "Para gerar o pedido"; só
  bloqueia "Gerar no Olist" (ADR 082).

## Alternativas consideradas

- **v2 sem rail, blocos de largura total ordenados por momento:** testada
  pelo PO e rejeitada em 12/11/2026; a ação principal volta a depender da
  rolagem e a leitura perde o fechamento sempre à vista no notebook.
- **Manter a página atual:** preserva o código, mas mantém os problemas do
  contexto, em especial os quatro modelos de salvamento e o rail depois da
  ficha.
- **Linha do tempo vertical dentro do rail:** resolvia a rolagem horizontal,
  mas misturava as datas, que são da ficha, com o negócio e o pagamento, e
  tirava de "Datas do pedido" o container que o PO aprovou. O container
  horizontal fica na ficha e vira vertical só quando o container é estreito.

## Consequências

- **Substitui em parte:** PFI-17 e PFI-18 em
  [Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md) (ordem das seções
  e posição do painel de fechamento; o "Editar" por seção já foi emendado por
  EDIT-01) e o texto da §9 "Ficha de Pedido" do `design.md`. PFI-01 também
  precisa de conferência da ordem. A emenda é a tarefa PED-RD-T00 e entra
  antes ou junto do primeiro PR de tela, porque a especificação tem precedência
  sobre o `design.md`. Esta entrega não edita a spec de Pedidos MVP.
- **Dependências:**
  - O campo "Frete" e a linha Peças + Frete = Total dependem de OLC-T01 e da
    [ADR 080](080-valor-final-com-frete.md); antes dele o rail mostra só o
    total que o código calcula hoje.
  - "Gerar no Olist" no pedido confirmado depende de OLC-T03 e OLC-T04
    ([ADR 079](079-olist-a-partir-do-pedido-confirmado.md)).
  - O interior de "Cobranças e pagamentos" espera o PR 348
    (`codex/order-timeline`, BCS-01–09); o rail só mostra o resumo e o link.
- **Orçamento de ações da §16:** atendido na primeira tela, que é o que a
  meta conta: 3 ações no pendente a 390×844 e 3 a 1366×768 (metas 12 e 16),
  travadas por `test/e2e/ux-budget.spec.js`. Os botões de remover tamanho, um
  por linha, ficam abaixo da primeira tela.
- **Não verificado:** renderização no app real (o protótipo é estático e foi
  conferido só como canvas), leitor de tela e aparelho real.
- Os seletores que o E2E principal (`test/e2e/orders.spec.js`) usa
  (regiões "Resumo do pedido", "Datas do pedido", "Itens e especificações",
  "Arte do pedido", "Fechamento e pagamento", "Dados do atendimento", classes
  `.op-*`, "Gerar pedido", "Confirmar e gerar ficha") precisam ser preservados
  ou migrados junto, em cada tarefa.

## Aceite da implementação

- Cada requisito PED-RD-01 a 16 com os cenários negativos da spec.
- Operação completa por teclado, com a ordem de foco igual à ordem visual,
  reflow a 320 px sem rolagem horizontal, temas claro e escuro e
  `prefers-reduced-motion` respeitado.
- Nenhum estado transmitido só por cor; nenhum texto abaixo de `--text-xs`.
- Nenhum PII em fixture, log ou captura.

## Links

- Decisões relacionadas: [ADR 079](079-olist-a-partir-do-pedido-confirmado.md),
  [ADR 080](080-valor-final-com-frete.md),
  [ADR 082](082-cadastro-obrigatorio-somente-no-envio-olist.md),
  [ADR 083](083-edicao-no-lugar.md),
  [ADR 084](084-caixa-de-entrada-refinada.md).
- Contrato visual: [design.md](../../design.md), §22 (e §9, §16, §19, §20).
- Requisitos e tarefas:
  [spec.md](../../.specs/features/pedido-refinado/spec.md) e
  [tasks.md](../../.specs/features/pedido-refinado/tasks.md).

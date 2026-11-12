# Pedido refinado — tarefas

Requisitos: [spec.md](spec.md). Decisão:
[ADR 086](../../../docs/adr/086-pedido-refinado.md), sem RFC. Contrato visual:
[design.md](../../../design.md), §22. Cada tarefa é uma entrega atômica: um PR,
um commit e um push, a partir de `origin/master`, no checkout único e com
branch curto (AGENTS.md).

Arquivos comuns: `apps/edge-web/src/views/OrderView.vue`,
`apps/edge-web/src/components/order/*` e
`apps/edge-web/src/styles/screens/40-order.css`. Todas as tarefas de tela
mexem nos mesmos arquivos: **sequenciar, não rodar em paralelo**.

Verificação de toda tarefa de tela: `npm run validate` e
`npx playwright test test/e2e/orders.spec.js`; mais `git diff --check` e
Prettier nos arquivos tocados.

Seletores do E2E principal (`test/e2e/orders.spec.js`) que cada tarefa
preserva ou migra no mesmo PR: regiões "Resumo do pedido", "Datas do pedido",
"Itens e especificações", "Arte do pedido", "Fechamento e pagamento" e "Dados
do atendimento"; classes `.op-*`; botões "Gerar pedido" e "Confirmar e gerar
ficha"; "Para gerar o pedido". Um seletor que muda de nome por decisão desta
spec (por exemplo "Editar resumo") é migrado no PR do capítulo, nunca deixado
quebrado.

### PED-RD-T00: emendas de spec e documentação

- [x] Registrar a ADR 086, a §22 do `design.md` e o parágrafo de remissão da
      §9.
- [x] Escrever esta spec e estas tarefas.
- [x] Emendar, em [Pedidos MVP](../pedidos-mvp/spec.md), antes ou junto do
      primeiro PR de tela (feito na PR 358, com o texto de cada emenda em
      PFI-01, PFI-17 e PFI-18):
  - **PFI-01:** a ordem das seções passa a ser Resumo, Datas, Itens, Arte,
    Observações e Dados do atendimento; o Fechamento e pagamento é o rail.
  - **PFI-17:** o cabeçalho de capítulo passa a ter, além do estado e do
    `SaveStatus`, a ação do capítulo quando existir (Datas: "Confirmar
    entrega"); o "Editar" já está emendado por EDIT-01 e deve ser removido de
    Resumo, Arte e Observações.
  - **PFI-18:** o painel de fechamento vem antes da ficha abaixo de 75rem; o
    acordeão do celular segue a ordem nova e, com o rail antes, o primeiro
    passo pendente continua definindo a seção aberta.
  - Conferir PFI-15 (progresso no rail), PFI-16 (rodapé) e PFI-20 (Arte) só
    quanto à posição; o texto não muda.
- [x] Acrescentar o índice da ADR 086 em `docs/adr/README.md` (feito em
      57d5e4d9).
- Depends on: none.
- Done when: PED-RD-01 a 16 existem na spec e na §22, as emendas acima estão
  na spec de Pedidos MVP e as pendências estão marcadas como pendentes.
- Gate: `git diff --check`, Prettier nos arquivos tocados e links relativos.

### PED-RD-T01: casca do layout e ordem do rail

- [x] Reordenar o DOM de `OrderView.vue`: rail primeiro; ficha depois. Trocar
      o `@media (width >= 75rem)` atual de `.op-layout` por
      `grid-template-areas`, com o rail à direita, sticky, em
      `minmax(20rem, 24rem)`.
- [x] Containers de layout com `container-type: inline-size`,
      `inline-size: 100%` e `min-inline-size: 0`.
- [x] Cabeçalho com a linha de fatos-chave como fonte única (PED-RD-02) e sem
      repetição nos blocos.
- [x] Ficha como uma folha com capítulos separados por divisor, sem cartão por
      seção (PED-RD-01).
- [ ] Rodapé fixo do celular acompanhando o rail antes da ficha (PED-RD-08).
- Entregue em 70bb636d; a folha única veio depois, em `.op-main.op-ficha`
  (uma superfície; capítulos com divisor `--color-border-subtle`; rail,
  cartões de item e pedido da loja mantêm o cartão), com o E2E "PED-RD-01: a
  ficha é uma folha só". Rodapé mantido, sem mudança.
- Depends on: T00.
- Arquivos: `OrderView.vue`, `OrderSheetHead.vue`, `OrderInfoStrips.vue`,
  `40-order.css`.
- Done when: PED-RD-01, 02, 08 e 14 (itens do layout) com os cenários
  negativos; ordem de Tab igual à visual a 1440, 1024 e 390 px.
- Cuidado: o E2E depende de ordem de regiões e de `.op-layout`, `.op-main`,
  `.op-rail`.

### PED-RD-T02: capítulo Datas refinado

- [x] Refinar `OrderMilestonesSection.vue` como em PED-RD-04: contador, ação
      no cabeçalho, trilha horizontal com ponto de dois estados, título em
      pontilhado, rodapé Recebido/Falta receber.
- [x] Linha do tempo vertical em container de 30rem ou menos (`@container`),
      sem rolagem lateral.
- [x] Posição de 2º capítulo da ficha.
- Entregue em 65697179 e e402851c (Datas horizontal no notebook).
- Depends on: T01. Não toca o conteúdo do detalhe de cada data nem a cobrança
  (PR 348).
- Arquivos: `OrderMilestonesSection.vue`, `40-order.css`.
- Done when: PED-RD-04 e o item de Datas de PED-RD-14; E2E das datas verde.

### PED-RD-T03: Resumo em edição no lugar

- [x] Resumo com Cliente (texto), Nome do pedido e Previsão de entrega em
      `Field` em linha, lado a lado a partir de 40rem, em edição no lugar.
- [x] Link "Ver cadastro" ao lado do Cliente. Entregue (PED-RD-09): o payload
      do pedido traz `contactId` e o link abre `/clientes/:contactId`.
- [x] Remover "Editar resumo", "Salvar resumo" e Cancelar; `SaveStatus` no
      cabeçalho; vendedor, data e FAB para Dados do atendimento.
- [x] Migrar os testes que usam "Editar resumo" e "Salvar resumo".
- Entregue em 26f35b16.
- Depends on: T01 (e T06 para o destino de vendedor, data e FAB).
- Arquivos: `OrderSummarySection.vue`, `40-order.css`, `orders.spec.js`.
- Done when: PED-RD-09 e PED-RD-12 no Resumo.

### PED-RD-T04: Arte em edição no lugar, lado a lado

- [ ] "Quem faz a arte" como chips de alternância que salvam ao tocar.
      Mantidos como checkboxes, para preservar rótulos e testes.
- [x] "Arte final" e "Arquivos da arte" em duas colunas a partir de 32rem; um
      só "Adicionar arquivo" por lista.
- [x] Remover "Editar arte"; `SaveStatus` no cabeçalho.
- [x] Preservar o fluxo de "Enviar arte final" e a regra de que referências
      não vão para a produção.
- Entregue em b4af9c87.
- Depends on: T01. Não rodar junto de T03 e T05 no mesmo checkout.
- Arquivos: `OrderArtworkSection.vue`, `OrderArtworkFiles.vue`,
  `40-order.css`, `orders.spec.js`.
- Done when: PED-RD-10 e PED-RD-12 na Arte.

### PED-RD-T05: Observações em edição no lugar

- [x] Lista numerada com cabeçalho visível das colunas, `BlankRow` no fim e
      dica de uma linha; limite de 5 linhas de 200 caracteres.
- [x] Remover "Editar observações"; `SaveStatus` no cabeçalho.
- Entregue em 5afca49f.
- Depends on: T01.
- Arquivos: `OrderObservationsSection.vue`, `40-order.css`.
- Done when: PED-RD-11 e PED-RD-12 nas Observações.

### PED-RD-T06: Dados do atendimento como último capítulo

- [x] Capítulo recolhido por padrão, com `button` de `aria-expanded` e
      `aria-controls` no `h2` e o aviso "Não vai para a ficha impressa.".
- [x] Receber vendedor, data do pedido e FAB.
- [ ] Receber origem e campanha. Pendente: esses dados não existem no payload
      do pedido.
- [x] Atenção ao acordeão do celular (PFI-18): a mesma seção, sem duplicar.
- Entregue em 651898b2.
- Depends on: T01.
- Arquivos: `OrderInfoStrips.vue` (onde a seção existe hoje), `OrderView.vue`,
  `40-order.css`.
- Done when: PED-RD-05; ficha impressa sem o conteúdo do capítulo.

### PED-RD-T07: Fechamento, pedido pendente

- [x] Rail com "Para gerar o pedido: N de 3", "Valor do pedido" e a única
      primária "Gerar pedido" com `aria-disabled` e motivo.
- [x] Só o próximo passo com botão. Ele continua `primary`, como em PFI-13 e
      PFI-16: enquanto há pendência, "Gerar pedido" fica `aria-disabled` e
      fora do estilo primário, então a região tem uma só primária. O PO
      manteve essa regra em 12/11/2026 (sem `soft`).
- [x] Manter "Revisar pendências" e o total 4; manter o cadastro incompleto
      fora do progresso.
- [ ] **Slot do frete (gated por OLC-T01):** Peças + Frete = Total, campo
      "Frete" em edição no lugar, "Usar cotação" e aviso de cotação vencida.
      Sem OLC-T01, o slot não é renderizado e o rail mostra só o total
      atual. Pendente (OLC-T01): não renderizado.
- Entregue em a9d37d24.
- Depends on: T01; o slot do frete depende de OLC-T01 (ADR 080). Pode entrar
  o resto e deixar o slot para um PR seguinte, sem marcar esta tarefa como
  concluída até ele.
- Arquivos: `OrderClosingSection.vue`, `OrderProgress.vue`,
  `OrderPriceBreakdown.vue`, `40-order.css`.
- Done when: PED-RD-06 (itens 6 a 9 só com OLC-T01); E2E "Gerar pedido" e
  "Confirmar e gerar ficha" verdes.

### PED-RD-T08: Fechamento, pedido confirmado

- [x] Fechamento em leitura: selo de confirmação, Valor do pedido, Forma de
      pagamento, "Ficha v{N}" e "Baixar ficha em PDF".
- [ ] Resumo de Cobranças com `Meter` e "Ver cobranças"; sem tocar o interior
      da cobrança. Pendente: PR 348.
- [x] Linha com cadeado no topo da ficha; campos em leitura.
- [ ] **Bloco Olist (gated por OLC-T03 e OLC-T04):** estados da PED-RD-07
      item 4. Sem eles, o bloco não é renderizado. Pendente: OLC-T03 e
      OLC-T04.
- Entregue em a9d37d24. "Ficha v{N}" mostra "Ficha {número} · gerada {data}":
  o pedido não tem campo de versão.
- Depends on: T07; Cobranças depende do PR 348 para qualquer mudança além do
  resumo; Olist depende de OLC-T03 e OLC-T04.
- Arquivos: `OrderClosingSection.vue`, `OrderBillingSection.vue` (só o
  resumo), `OrderOlistPanel.vue`, `40-order.css`.
- Done when: PED-RD-07 (item 4 só com OLC-T03/T04).

### PED-RD-T09: hierarquia e ritmo na escala de 4 px

- [x] Níveis de texto de PED-RD-13 aplicados nas regras de `40-order.css`.
- [x] Ritmo de 32/24/16 px e valores fora da escala viram `--space-*`; regras
      sem marcação saem.
- Entregue em f36b12a4: valores fora da escala de 216 para 4 (as linhas em
  `calc` com `em` foram mantidas); regras sem marcação removidas.
- Depends on: T01 a T08 (limpa depois que a marcação nova existe).
- Arquivos: `40-order.css`.
- Done when: PED-RD-13 com a contagem antes e depois; regressão visual das
  telas do pedido sem diferença além da prevista.

### PED-RD-T10: medição e E2E

- [x] Medir e registrar, na §22 do `design.md`, as "Medidas a coletar" da spec
      (ações a 390×844 e 1366×768, repetições dos fatos-chave, distância até
      "Gerar pedido", tamanhos e pesos de texto, espaços fora da escala).
- [x] Atualizar `test/e2e/orders.spec.js` para o fluxo final, preservando os
      seletores listados no topo e acrescentando: ordem do rail, ordem de Tab,
      sem rolagem horizontal a 320 px, nenhum "Editar <seção>" nos capítulos
      migrados.
- [ ] Teste manual com leitor de tela e em aparelho real, registrado como
      feito ou como pendente. Pendente: não verificado.
- Entregue em 6a1384a7 e nos commits de correção de medição: medição em 390,
  1024, 1366 e 1440 px. Na página inteira a 1366 px, pendente tem 19 ações
  e confirmado 8. A meta da §16 conta a primeira tela: 3 ações a 390×844 e 3
  a 1366×768 no pendente (metas 12 e 16), travadas por
  `test/e2e/ux-budget.spec.js`. E2E completo: 995 passou,
  7 ignorados, 0 falhou; `npm run validate` verde.
- Depends on: T09.
- Done when: PED-RD-15 e PED-RD-16 com evidência; `npm run validate` e
  `npx playwright test test/e2e/orders.spec.js` verdes.

## Decisões do PO

- **12/11/2026 — Primária do pendente:** continua a PFI-16. O próximo passo é
  a primária enquanto há pendência e "Gerar pedido" fica neutro com
  `aria-disabled`; "Gerar pedido" vira primária com tudo pronto. O `soft` do
  protótipo não entra.

- **12/11/2026 — v1 sobre v2:** ficha com rail de fechamento; a v2 sem rail
  (blocos de largura total por momento) foi testada e rejeitada. Refinar a
  arquitetura e a hierarquia da informação.
- **12/11/2026 — Datas mantida e refinada:** o container de "Datas do pedido"
  de produção é muito bom e só é refinado (trilha horizontal, ponto de dois
  estados, rodapé de totais), voltando a ser o 2º capítulo da ficha.
- **12/11/2026 — Arte lado a lado:** "Arte final" e "Arquivos da arte" ficam
  lado a lado.
- **12/11/2026 — Responsividade por container:** os componentes devem reagir
  à largura do próprio container, com largura explícita em todo container de
  layout.

## Pendências

- Botões de remover tamanho contra a meta da §16 (decisão do PO).
- Frete no rail: OLC-T01. Gerar no Olist: OLC-T03 e OLC-T04. Interior de
  Cobranças: PR 348.
- Não verificado: render no app real, leitor de tela e aparelho real.

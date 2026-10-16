# RFC 024 — Jornadas com menos botões

Status: aprovada pelo PO em 15/10/2026, com as opções recomendadas. Decisão:
[ADR 036](../adr/036-padroes-de-jornada.md).

Responsável: Tech Lead UX. Aprovador: PO (Rômulo). Base: `origin/master` em
15/10/2026 (`e9dc75e`).

Requisitos: emendas e IDs novos sobre [pedidos-mvp](../../.specs/features/pedidos-mvp/spec.md),
com vínculo a FIN-02 de [crm-mvp](../../.specs/features/crm-mvp/spec.md)
(seção "Emendas de requisitos"). Princípios: [`design.md`](../../design.md) §3 e §9,
[`PRODUCT.md`](../../PRODUCT.md) e [`RULES.md`](../../RULES.md).
Evidência: [pesquisa com usuários sintéticos](../product/pesquisa-ux-sintetica-2026-10-15.md).
Tarefas: T121–T133 em [`tasks.md`](../../.specs/features/pedidos-mvp/tasks.md)
(T131 adiada).
Branch de integração: `ux/jornadas`. Issues e PRs: a vincular no PR de
`ux/jornadas` para o `master`.

## Contexto e evidência

O PO relatou "muitos botões e jornada nada intuitiva". A auditoria de
15/10/2026 contou os controles visíveis na primeira tela, com dados sintéticos,
no celular (390×844) e no notebook (1366×768):

| Tela             | Celular                       | Notebook |
| ---------------- | ----------------------------- | -------- |
| Caixa de Entrada | 19                            | 32       |
| Pedidos          | 16                            | 23       |
| Pedido aberto    | 17, em 3.600–4.800 px de tela | —        |
| Conversa         | 14                            | 32       |

No pedido aberto, a contagem no notebook não foi registrada; a meta abaixo
vale a partir da primeira medição.

A [pesquisa sintética](../product/pesquisa-ux-sintetica-2026-10-15.md) já
apontava o mesmo nos achados 1 (Caixa de Entrada como workspace: "uma ação
primária + duas visíveis + menu Mais"), 2 (Painel por papel), 3 (Pedidos para
produção) e 8 (primeira execução: vazio inicial diferente de vazio por
filtro); o achado 7 cobre o vocabulário de confecção.

Referências de padrão consultadas:

- growth.design: paradoxo da escolha (YouTube), divulgação progressiva (HEY e
  Trello), progresso dotado e efeito Zeigarnik, modelos mentais e hierarquia
  de dashboard.
- uxpatterns.dev: button, filter-panel, tabs, wizard, progress-indicator,
  accordion, dashboard e list-view.

Regras que este RFC adota a partir dessas fontes:

1. Uma ação primária por região.
2. No máximo duas secundárias visíveis; o resto vai para "Mais".
3. Rótulo de botão é verbo + objeto ("Assumir atendimento", não "Assumir").
4. Alvos de toque de 44 px ou mais, com 8 px entre eles.
5. Controle indisponível usa `aria-disabled` e continua focável, com o motivo
   ao lado; nunca some sem explicação.
6. Abas: de 2 a 7, com 1 a 3 palavras cada.
7. Indicador de progresso só quando é honesto: cada passo é real e o total não
   muda no meio.
8. Acordeão mostra o estado da seção em texto no próprio cabeçalho.

## Problemas

### 1. Pedido

- Oito seções e quatro botões "Editar", cada um com a sua edição própria.
- A checklist "Pronto para gerar N de 5" fica no fim da página (no celular, a
  ~3.000 px do topo) ou numa coluna lateral (notebook): quem abre o pedido não
  vê o que falta.
- Valor final e Forma de pagamento ficam sempre abertos, um segundo modelo de
  edição que não segue "Editar → Salvar".
- "Gerar pedido" fica fixo e parece pronto mesmo com 1 de 5.
- A seção de arte tem dois botões de envio.
- Jargão interno na tela: "Lastro", "Estampa", "Controle de produção".

### 2. Conversa

- Três botões antes da mensagem no celular; quatro no notebook, com
  "Encerrar" colado à ação primária.
- "Pedido · Sem pedido" é um status disfarçado de botão; ele abre uma gaveta
  que repete "Sem pedido" três vezes.
- "Assumir" e "Enviar resposta" aparecem juntos: duas primárias na mesma
  região.

### 3. Fila da Caixa de Entrada

- Três mecanismos de filtro ao mesmo tempo: cinco abas de estado (Todas,
  Aguardando vendedor, Com o agente, Com vendedor, Arquivadas), o seletor
  "Fila" (Todas, Minhas, Sem responsável) e a busca.
- No celular a quinta aba sai cortada.

### 4. Pedidos

- Oito chips que misturam estado, responsável, origem, prazo e prontidão:
  Todos, Pendentes, Meus pendentes, Prontos para produção, Confirmados, Loja
  do site, Entrega atrasada e Próximas entregas.
- "Pendentes" e "Confirmados" duplicam os grupos que a lista já mostra
  (PLI-03).

### 5. Painel

- Não responde "o que faço agora".
- O seletor de período só afeta "Vendido", mas parece valer para a tela toda.
- Quando a fila falha, a seção some. No demo, a causa provável é de ambiente
  (API defasada ou migração `0035_manual_contacts_orders` ausente), a
  confirmar na fatia D0.

### 6. Vocabulário

- O vocabulário de confecção está fixo nas telas (achado 7 da pesquisa).
  Este RFC só troca rótulos de tela; o glossário configurável fica fora.

## Premissas

- Vue 3 e Vue Router continuam a base ([ADR 001](../adr/001-adotar-vue-no-frontend.md)).
  Nenhuma dependência nova.
- Nenhuma mudança de API, contrato de dados ou migração. Tudo o que as
  propostas usam já existe: `missingFields`, os filtros por query string da
  lista de Pedidos e da Caixa de Entrada e os resumos do Painel.
- Mobile-first: cada proposta é desenhada a partir de 390×844 e ampliada para
  o notebook ([ADR 035](../adr/035-fundacao-visual-whitelabel-mobile-first.md)).
- Tokens e componentes base de [`design.md`](../../design.md); nenhuma cor
  literal fora de `tokens.css`.
- A ficha impressa não muda: rótulos, templates e hashes continuam como estão.

## Propostas e opções

### A. Pedido

1. **Só mover a checklist para o topo.** Barato, mas mantém oito seções
   abertas, quatro "Editar" e dois modelos de edição.
2. **Progresso real no topo e uma seção por vez (recomendada).**
   - **Progresso real.** O topo mostra três passos derivados de
     `missingFields`: Entrega prometida (`summary.data_entrega_confirmada`),
     Itens (`items` e `items[N].*`) e Arte do pedido (`artwork`). Só o
     próximo passo pendente tem botão, com verbo ("Informar a entrega
     prometida", "Completar os itens", "Marcar quem faz a arte"). Valor final
     e forma de pagamento saem da contagem porque passam a ser digitados no
     diálogo de gerar.
   - **Acordeão no celular.** Uma seção aberta por vez, cada cabeçalho com o
     estado em texto ("Completo", "Falta a cor do item 2", "Sem arquivos").
     No notebook as seções continuam empilhadas.
   - **Um só modelo de edição.** "Gerar pedido" abre um diálogo com Valor
     final, Forma de pagamento e a revisão do que vai ser gerado. O bloco que
     hoje fica sempre aberto deixa de existir.
   - **"Editar" com objeto.** "Editar resumo", "Editar datas", "Editar
     itens", "Editar arte" e "Editar observações". Enquanto uma seção está em
     edição, as outras ficam com `aria-disabled` e o motivo ("Salve ou
     cancele a edição aberta"), mantendo PFI-06.
   - **Microcopy.** "Arte do pedido" no lugar de "Estampa e arquivos" e
     "Datas do pedido" no lugar de "Lastro do pedido", só na tela; a ficha
     impressa mantém "Lastro" (ADR 008, ADR 017). O bloco "Controle de
     produção" sai da página: ele é informativo e só existe no papel.
3. **Assistente em páginas separadas.** Rejeitada: viola a regra 4 de
   `RULES.md` ("o preenchimento é progressivo e não linear") e PIT-03, que
   aceita salvar itens incompletos em qualquer ordem.

### B. Conversa

1. **Manter a gaveta do pedido e só reordenar os botões.**
2. **Uma ação por vez (recomendada).**
   - "Assumir atendimento" ocupa o lugar do campo de mensagem até alguém
     assumir; depois disso o campo aparece e "Enviar resposta" é a única
     primária.
   - O pedido vira um link no cabeçalho, com número e estado ("Pedido
     04-CRM · Pendente"), que abre a página do pedido.
   - "Criar pedido" aparece só para o dono da conversa (ou administrador)
     quando não há pedido (PCL-10, PCL-11).
   - O resumo do pedido vai para Detalhes › Pedido; a gaveta é removida.
   - "Encerrar conversa" vai para "Mais".

### C. Filtros

1. **Manter abas e seletor, só encurtando os rótulos.**
2. **Atalhos com contagem e folha de filtros (recomendada).**
   - **Caixa de Entrada:** busca, três atalhos com contagem (Todas ·
     Aguardando · Minhas) e um botão "Filtros" que abre uma folha com
     Situação e Responsável. Os filtros ativos aparecem num resumo com botão
     de remover cada um.
   - **Pedidos:** três chips (Todos · Meus pendentes · Prontos para produção)
     e uma folha "Filtros" com os oito filtros agrupados em Situação,
     Responsável, Origem, Entrega e Produção. A escolha continua única, como
     hoje.
   - Os links do Painel continuam funcionando (`?status=`, `?entrega=`,
     `?vendedor=eu`, `?origem=loja` em Pedidos; `?fila=` e `?situacao=` na
     Caixa de Entrada) e abrem a lista com o filtro já no resumo.

### D. Painel

1. **Manter os indicadores e só corrigir a legenda do período.**
2. **Cartão "Próximo passo" por papel (recomendada).**
   - Vendedor, em ordem: responder conversas → assumir as que aguardam →
     completar pedidos pendentes → entregas atrasadas → "Nada urgente agora".
   - Gestor, em ordem: conversas fora do SLA → entregas atrasadas → agente
     parado → pedidos a confirmar.
   - O seletor de período ganha a legenda "Vale para Vendido".
   - Quando a fila falha, o número mostra "—" com "Tentar novamente", nunca
     "0" nem a seção sumindo.
   - Opção para o PO (pergunta D3): o vendedor entra em `/inbox?fila=minhas`
     depois do login, em vez do Painel.

## Metas de controles na primeira tela

Contagem fora da navegação do app.

| Tela             | Celular                                                      | Notebook |
| ---------------- | ------------------------------------------------------------ | -------- |
| Pedido aberto    | ≤ 12; documento ≤ 1.800 px; ≤ 1 "Editar" visível; 1 primária | ≤ 16     |
| Conversa         | ≤ 9 antes de assumir; ≤ 12 depois; cabeçalho ≤ 2             | ≤ 24     |
| Caixa de Entrada | ≤ 15; barra de ferramentas de 7 para 5                       | ≤ 24     |
| Pedidos          | ≤ 12, com o 1º cartão inteiro acima da barra inferior        | ≤ 19     |

## Fatias e sequência

Uma tarefa é uma fatia, um commit e um push. Nenhuma fatia muda API, migração
ou dependência.

| Onda | Fatias (∥ = em paralelo) | Conteúdo                                                               | Depende de        |
| ---- | ------------------------ | ---------------------------------------------------------------------- | ----------------- |
| 0    | S1 ∥ S2 ∥ S3 ∥ D0        | S1: este RFC; D0: confirmar a causa da falha da fila no demo           | —                 |
| gate | S4                       | Emendas de requisitos e tarefas T121–T133                              | Pergunta D1 do PO |
| 1    | A1 ∥ B1 ∥ C1 ∥ D1        | Primeiras fatias de Pedido (A), Conversa (B), Filtros (C) e Painel (D) | S4                |
| 2    | A2a ∥ B2                 | Pedido e Conversa                                                      | Onda 1            |
| 3    | A4 ∥ B3                  | Pedido e Conversa                                                      | Onda 2            |
| 4    | A2b                      | Pedido                                                                 | Onda 3            |
| 5    | A3                       | Diálogo "Gerar o pedido" com valor final e forma de pagamento          | Pergunta D2 do PO |
| 6    | E1                       | Entrada do vendedor pela Caixa em "Minhas" (adiada pelo PO, D3)        | Pergunta D3 do PO |
| 7    | F1, F2                   | T132: orçamento de controles; T133: fechamento da documentação         | Ondas anteriores  |

O escopo de cada fatia de A1 a F2 (A1–A4, B1–B3, C1, D1, E1, F1 e F2) está
nas tarefas T121–T133 criadas em S4; a letra indica o tema da seção
"Propostas e opções". S2 e S3 foram preparação técnica, sem tarefa T.

## Emendas de requisitos

Aplicadas em S4, depois da aprovação do PO (ver "Resultado"). IDs novos:

| Grupo           | IDs novos       | Tema                                                           |
| --------------- | --------------- | -------------------------------------------------------------- |
| Pedido          | PFI-15 a PFI-20 | Progresso real, acordeão, diálogo de gerar, microcopy          |
| Conversa e fila | PCX-10 a PCX-14 | Assumir no lugar do composer, link do pedido, filtros em folha |
| Lista           | PLI-09 e PLI-10 | Três chips e folha de filtros em Pedidos                       |
| Painel          | PNL-01 a PNL-04 | Próximo passo por papel, legenda do período, falha visível     |

Critérios existentes a emendar:

- **PFI-01** (ordem das seções; "Controle de produção" sai da tela),
  **PFI-06** (um "Editar" por vez, agora com `aria-disabled`), **PFI-08** (Dados do atendimento dentro do acordeão),
  **PFI-09** (o banner do topo vira o progresso real) e **PFI-13** (a única
  primária passa a ser a do próximo passo ou "Gerar pedido").
- **PIT-06** ("Falta para gerar" nomeia os passos do topo; valor final e
  forma de pagamento passam para o diálogo).
- **PLA-01** e **PLA-07** ("Datas do pedido" na tela; "Editar datas").
- **TEC-03** e **ARQ-01** ("Arte do pedido" no lugar de "Estampa e
  arquivos" na tela).
- **PCX-02** e **PCX-05** (atalhos com contagem e folha de filtros no lugar
  das abas e do seletor "Fila"), **PCX-06 a PCX-09** (o botão "Pedido" e a
  gaveta dão lugar ao link no cabeçalho e a Detalhes › Pedido).
- **PLI-02** (três chips e folha de filtros).

Critérios que continuam valendo e só ganham link: PIT-05, PLA-04, TEC-08, PIM-01, PAU-01, PCL-07, PCL-10, PCL-11, PCX-04, PLI-03, PLI-08,
LOJ-07, LOJ-24, LOJ-31, LOJ-33, LOJ-34, REV-06, REV-10 e FIN-02 (crm-mvp).

ADRs relacionados: [015](../adr/015-conversa-nao-volta-para-o-bot.md)
(conversa não volta para o bot), [016](../adr/016-itens-com-os-sete-pontos-da-ficha.md)
(sete pontos e `missingFields`), [020](../adr/020-tecnica-por-item-e-arte-do-pedido.md)
(arte do pedido), [023](../adr/023-arquivos-da-arte-no-rustfs.md) (arquivos
da arte), [031](../adr/031-aviso-de-pedido-novo-do-site.md) (aviso de pedido
do site no Painel) e [035](../adr/035-fundacao-visual-whitelabel-mobile-first.md)
(fundação visual e mobile-first). [`design.md`](../../design.md) §3 e §9 e
[`PRODUCT.md`](../../PRODUCT.md) recebem os padrões depois da decisão.

## Testes impactados

Riscos de regressão que cada fatia precisa tratar no mesmo commit:

- **`test/e2e/orders.spec.js`**
  - Cerca de 40 usos de `getByRole('button', { name: 'Editar' })` (36
    contados em 15/10/2026); sem `exact`, continuam encontrando "Editar
    resumo" e os demais por substring, mas podem ficar ambíguos.
  - Textos da checklist: os testes afirmam "Falta para gerar: …" com valor
    final e forma de pagamento no fim da lista, que mudam quando os dois vão
    para o diálogo; "Pronto para gerar" e o "N de 5" da checklist não são
    afirmados hoje.
  - Botões da checklist "Informar no Resumo (entrega prometida)" e "Informar
    na Estampa (quem faz a arte)", e o texto "Marque quem faz a arte em
    Estampa e arquivos.".
  - Regiões "Estampa e arquivos" e "Lastro do pedido" e a lista de títulos
    `h2` na ordem de PFI-01.
  - `.op-mobile-action` (rodapé fixo do celular), PFI-13 e o fluxo de Valor
    final na região "Fechamento e pagamento".
  - O contador "N de 5" dos arquivos da arte (ARQ-01) e o "N de 5 linhas"
    das observações (PFI-05) não mudam; não confundir com o "N de 5" da
    checklist.
  - `filter-summary` e os chips da lista de Pedidos estão neste arquivo.
- **`test/e2e/store-orders.spec.js`**: região "Fechamento e pagamento" e a
  ausência de botões de edição no pedido da loja (LOJ-07, LOJ-34).
- **`test/e2e/crm-ui.spec.js`**: botão `/^Pedido/` e "Pedido · Pendente" ou
  "Pedido · Confirmado", a gaveta, o laço de Tab do cabeçalho, o grupo
  "Estado das conversas", `getByLabel('Fila').selectOption(...)` e a lista
  do "Mais".
- **`test/e2e/dashboard-roles.spec.js`** e
  **`test/e2e/dashboard-refresh.spec.js`**: cartões por papel, período e
  falha da fila.

Notas:

- O Playwright trata `aria-disabled="true"` como desabilitado: `click()`
  espera e falha. Para ativar de propósito (e ver o motivo), use foco e
  Enter.
- Não há `orders-list.spec.js`; os testes da lista estão em
  `orders.spec.js`. Superado pela S3 (`6fb9fbb`): os testes da lista de
  Pedidos passaram a `test/e2e/orders-list.spec.js`, e `orders.spec.js`
  ficou só com a página do pedido.

## Fora de escopo

Pedem ADR próprio:

- Os sete pontos da ficha e a grade de tamanhos.
- "Modelo de malha", Gola, Viés e FAB.
- Template de impressão parametrizado.
- Glossário configurável por empresa.
- Telas de Clientes e de Vendedores.

## Critérios de decisão

- As metas de controles medidas em 390×844 e 1366×768 com dados sintéticos.
- Nenhuma mudança de API, migração ou dependência no diff das fatias.
- `npm run validate` e `npm run test:e2e` verdes, incluindo os testes axe.
- Toda jornada nova operável por teclado, com foco previsível e alvos de
  44 px no toque.

## Perguntas ao PO

| ID  | Pergunta                                                                             | Bloqueia                     | Premissa até a resposta       |
| --- | ------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------- |
| D1  | Aprovar este RFC com as opções recomendadas?                                         | S4 e o merge de A, B, C e D1 | —                             |
| D2  | Valor final e forma de pagamento passam a ser digitados no diálogo "Gerar o pedido"? | Só A3                        | Sim                           |
| D3  | O vendedor entra pela Caixa de Entrada em "Minhas" depois do login?                  | Só E1                        | Não implementar até responder |

## Resultado

Aprovada pelo PO em 15/10/2026 e registrada no
[ADR 036](../adr/036-padroes-de-jornada.md), seguindo o precedente do RFC 022
→ ADR 035.

- **D1 — sim.** Valem as opções recomendadas: A2 (progresso real e uma seção
  por vez), B2 (uma ação por vez na conversa), C2 (atalhos com contagem e
  folha de filtros) e D2 (cartão "Próximo passo" por papel).
- **D2 — sim.** Valor final e forma de pagamento passam a ser digitados no
  diálogo "Gerar o pedido" (PFI-19, T125).
- **D3 — adiada.** O vendedor continua entrando pelo Painel depois do login;
  a E1 não é implementada. PNL-04 fica registrado como adiado e a T131 sem
  implementação ativa até nova decisão.

Emendas aplicadas na S4: PFI-15 a PFI-20, PCX-10 a PCX-14 e PLI-09 a PLI-10
em [Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md), PNL-01 a PNL-04
em [CRM MVP](../../.specs/features/crm-mvp/spec.md), notas nos critérios
emendados, glossário e [`design.md`](../../design.md) §16.

Situação das fatias na branch `ux/jornadas`, fechada na T133 (15/10/2026):

| Fatia | Tarefa | Commit    | Situação e entrega                                                                                                                |
| ----- | ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| S1    | —      | `cb430dc` | Concluída: este RFC                                                                                                               |
| S2    | —      | `e19fa2c` | Concluída: `screen-styles.css` separado por tela em `styles/screens/`, com CSS gerado idêntico                                    |
| S3    | —      | `6fb9fbb` | Concluída: suporte do E2E em `test/e2e/support/` e lista de Pedidos em `orders-list.spec.js`                                      |
| D0    | —      | —         | Concluída sem commit: a falha da fila no demo era API defasada no ambiente, não bug do Painel                                     |
| S4    | —      | `6f3b476` | Concluída: emendas de requisitos, tarefas T121–T133, ADR 036, `design.md` §16 e glossário                                         |
| D1    | T130   | `069ae76` | Concluída: cartão "Próximo passo" por papel, "Vale para Vendido" e fila em falha com "—" (PNL-01 a PNL-03)                        |
| A1    | T121   | `d78f7ab` | Concluída: progresso real "Para gerar o pedido: N de 3" e rodapé do próximo passo (PFI-15, PFI-16)                                |
| C1    | T129   | `aeec878` | Concluída: três chips, folha "Filtros" e filtro nomeado com "Limpar filtro" em Pedidos (PLI-09, PLI-10)                           |
| B1    | T126   | `c1a9023` | Concluída: link "Pedido NN-CRM" no cabeçalho, "Criar pedido" por papel e Detalhes › Pedido; gaveta removida (PCX-10 a PCX-12)     |
| B2    | T127   | `accc1b0` | Concluída: "Assumir atendimento" no lugar do composer e "Encerrar conversa" em "Mais" (PCX-13)                                    |
| A2a   | T122   | `ab24ea4` | Concluída: cabeçalho de seção com estado em texto e "Editar" + seção, com `aria-disabled` e motivo (PFI-17)                       |
| B3    | T128   | `f3935a9` | Concluída: busca, atalhos Todas · Aguardando · Minhas com contagem e folha "Filtrar conversas" na Caixa de Entrada (PCX-14)       |
| A4    | T123   | `a25cba7` | Concluída: "Arte do pedido", "Datas do pedido", sem "Controle de produção" na tela e um só controle de adicionar arquivo (PFI-20) |
| P1    | —      | `fb7e932` | Acabamento: 44 px na folha "Filtros" também a partir de 48rem e título das credenciais vindo de `brand.productName`               |
| A2b   | T124   | `5baadf5` | Concluída: acordeão no celular com hash na URL, abertura pelo próximo passo e seção em edição que não fecha (PFI-18)              |
| A3    | T125   | `6a56687` | Concluída: diálogo "Gerar o pedido" com revisão, "Valor final" e "Forma de pagamento" (PFI-19)                                    |
| P2    | —      | `3351c33` | Acabamento: progresso compacto quando pronto e atalhos da Caixa com 44 px e 8 px em toda tela de toque                            |
| E1    | T131   | —         | Adiada pelo PO (D3); PNL-04 sem implementação                                                                                     |
| F1    | T132   | —         | Em andamento: teste de orçamento de controles por região                                                                          |
| F2    | T133   | —         | Concluída: rastreabilidade das specs, `design.md` §9 e §16, glossário, pesquisa e este "Resultado"                                |

### Medições registradas pelas fatias

Só entram números que constam nas mensagens de commit das fatias ou que os
testes afirmam. Dados sintéticos; celular 390×844 e notebook 1366×768.

| Tela             | Antes (auditoria de 15/10/2026)           | Depois                                                                                                                                                                                                                                                     | Fonte                                                                                                                |
| ---------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Caixa de Entrada | Barra com 7 controles; 19 / 32 na 1ª tela | Barra com 5 controles (busca, três atalhos e "Filtros"); 1ª tela dentro de ≤ 15 no celular, também com o resumo de filtro, e ≤ 24 no notebook                                                                                                              | `f3935a9`; `crm-ui.spec.js` “PCX-14: filters the Inbox…” e “PCX-14: on a 390 px phone…”                              |
| Conversa         | 3 botões antes da mensagem no celular     | Cabeçalho sem primária; com o dono, 3 botões visíveis ("Criar pedido", "Mais ações", "Detalhes"); uma primária na conversa, no composer                                                                                                                    | `accc1b0`; `crm-ui.spec.js` “never offers to hand the conversation back to the AI…”                                  |
| Pedidos          | 8 chips; barra de filtros com 9 controles | 3 chips; barra com 5 controles; 1º cartão inteiro acima da barra inferior no celular; folha com 44 px, 8 px entre opções e sem rolagem no notebook                                                                                                         | `aeec878`, `fb7e932`; `orders-list.spec.js` “PLI-09: …”                                                              |
| Pedido aberto    | 17 controles em 3.600–4.800 px no celular | Pendente com 1 item: documento de 2.166 px para 1.862 px e painel de fechamento de 448 px para 145 px (A3); pendente pronto com o Resumo aberto: 1.862 px para 1.642 px (P2), dentro da meta de 1.800 px; 1 controle de adicionar arquivo em 390 e 1280 px | `6a56687`, `3351c33`, `a25cba7`; `orders.spec.js` “keeps a ready pending order within 1.800 px on a phone (RFC 024)” |
| Painel           | Sem "o que faço agora"                    | Um link de próximo passo; vendedor no celular com 6 controles (5 indicadores e o próximo passo); gestor no notebook com 11 (3 de período, 7 indicadores e o próximo passo)                                                                                 | `069ae76`; `dashboard-next-step.spec.js`                                                                             |

O progresso do pedido é real: conta só `missingFields` agrupado em três
passos, não avança por visita e trata pendência desconhecida como um quarto
passo ("Revisar pendências"), nunca um falso "3 de 3" (`d78f7ab`, `ab24ea4`).
A contagem de controles por região contra as metas de "Metas de controles na
primeira tela" é a T132 (F1), ainda em andamento.

## Pendências após o RFC 024

Registradas na T133 para decisão ou fatia futura; nenhuma foi resolvida aqui.

1. **"Entrega atrasada" não combina com a busca.** A API recusa `delivery`
   junto com `q` (`order-service.js`: a lista por entrega não se combina com
   outros filtros nem pagina), e a tela limpa o filtro de entrega quando
   alguém digita na busca (`OrdersView.vue`).
2. **Ícones Baixar e Remover dos arquivos da arte** com 36 px e sem
   espaçamento entre eles, abaixo dos 44 px com 8 px da §16.
3. **"Enviar arte final" com 40 px no notebook** e o link "← Pedidos" do
   rastro pequeno como alvo.
4. **Cabeçalho da conversa no celular com 3 controles** contando o botão
   voltar, acima da meta "cabeçalho ≤ 2".
5. **A URL da Caixa de Entrada e de Pedidos não reflete o filtro** escolhido
   nos atalhos, chips ou folha; só os links do Painel entram pela URL.
6. **Hash do acordeão gravado por `router.options.history.replace`**, fora da
   navegação do Vue Router, porque o `App.vue` usa a `fullPath` como chave da
   view e remontaria a página (perdendo foco e rascunho). Funciona, mas é um
   desvio do router a revisar se a chave da view mudar.
7. **Pedido da loja não usa o acordeão** no celular: nenhum cabeçalho de
   seção vira botão, e a página longa continua inteira na rolagem.
8. **Destino do login por papel (E1, PNL-04)** adiado pelo PO (D3).
9. **"Criar pedido" no "Mais" com pedido já confirmado:** a API aceita e a
   tela oferece; falta a decisão do PO sobre manter.
10. **PNL-01 com a fila em falha:** o cartão do gestor pula as condições da
    fila e mostra a próxima que leu, e o do vendedor diz "A fila não
    respondeu; tente de novo mais abaixo." sem "Tentar novamente" no próprio
    cartão; o critério pede que não pule a condição e traga a ação no cartão.
    Decidir entre emendar o critério ou ajustar o cartão (ver
    [spec do CRM MVP](../../.specs/features/crm-mvp/spec.md)).
11. **Lacuna de teste em PLI-10:** o vazio por filtro com "Limpar filtro" só
    tem teste para "Prontos para produção".

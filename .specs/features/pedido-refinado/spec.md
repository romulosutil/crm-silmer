# Pedido refinado

Decisão do PO em 12/11/2026, a partir do protótipo "Pedido refinado" (canvas
Design privado; cópia local em `output/prototipos/pedido-refinado/`, não
versionada). Decisão: [ADR 086](../../../docs/adr/086-pedido-refinado.md), sem
RFC. Contrato visual: [design.md](../../../design.md), §22 e ajustes nas §9 e
§16. Tarefas: [tasks.md](tasks.md). Base: PFI-01 a PFI-20 em
[Pedidos MVP](../pedidos-mvp/spec.md), EDIT-01 (ADR 083), OLC-01–16 e
OLC-05a–j em [Olist a partir do confirmado](../olist-confirmed/spec.md).

## Problema

A página do pedido tem nove seções com o mesmo peso, quatro modelos de
salvamento, cliente, entrega e peças repetidos em três ou quatro lugares, e o
painel de fechamento cai depois de todas as seções abaixo de 1200 px. O PO
testou uma v2 sem rail e a rejeitou em favor da v1 (ficha com rail),
pedindo refino da arquitetura e da hierarquia da informação. Detalhes e
alternativas na [ADR 086](../../../docs/adr/086-pedido-refinado.md).

## Fora de escopo

- Contratos REST, `missingFields`, ficha impressa e seus templates e hashes.
- O interior de "Cobranças e pagamentos": espera o PR 348
  (`codex/order-timeline`, BCS-01–09).
- Ferramentas administrativas do Olist (conferência, recuperação): ficam fora
  da jornada da vendedora e não mudam.
- Pedido da loja (LOJ-07): mantém o fluxo próprio.
- Os botões de remover tamanho, um por linha (EDIT-01): ficam como estão;
  abaixo da primeira tela, não entram no orçamento da §16.

## Dependências

- **OLC-T01 (ADR 080):** campo "Frete" e Peças + Frete = Total no rail. Sem
  ele, PED-RD-06 itens 6 e 7 ficam pendentes e o rail mostra só o total que o
  código calcula hoje.
- **OLC-T03 e OLC-T04 (ADR 079):** o bloco "Gerar no Olist" do pedido
  confirmado (PED-RD-07 item 4). Sem eles o bloco não é desenhado.
- **PR 348:** o resumo de Cobranças do rail só liga ao que o PR entregar;
  nenhum interior de cobrança é redesenhado aqui.

## Requisitos

Cada requisito vale em claro e escuro, por teclado, a 320 px e com zoom de
200%, e não transmite estado só por cor (§14 do `design.md`). O que ainda não
está no código está marcado como "pendente de OLC-T0x"; nenhum requisito
abaixo está implementado até a sua tarefa ser entregue.

### PED-RD-01 — Arquitetura em três camadas

1. A página SHALL ter, nesta ordem lógica: cabeçalho (identidade e
   fatos-chave), ficha (uma folha com os capítulos) e rail "Fechamento e
   pagamento".
2. A ficha SHALL ser uma única superfície (`--color-surface`, borda 1 px
   `--color-border`, `--radius-lg`); os capítulos SHALL ser separados por
   divisor e respiro, não por cartões.
3. **Negativo:** nenhum capítulo SHALL ter cartão próprio com borda; só o
   cartão de item e os blocos do rail são superfícies dentro do nível deles.
4. **Negativo:** a página SHALL NOT voltar a blocos de largura total sem rail
   (v2 rejeitada em 12/11/2026).

Verificação: inspeção do DOM e das superfícies nos dois estados do pedido.

### PED-RD-02 — Cabeçalho e fatos-chave

1. O cabeçalho SHALL trazer, em contexto → estado → ação: trilha "← Pedidos",
   h1 "Pedido {número}" (24 px; 20 px no celular), selo de status com ícone e
   texto, linha de contexto ("{cliente} — {nome do pedido} · com {vendedor}")
   e a linha de fatos-chave: entrega, peças e valor.
2. Entrega, peças e valor SHALL aparecer nessa linha e SHALL NOT se repetir
   como texto em Resumo, em Datas (além do ponto "Previsão de entrega" da
   linha do tempo) nem no rail, salvo o "Valor do pedido" do rail, que é o
   cálculo do fechamento. O campo "Previsão de entrega" do Resumo é entrada de
   dado, não fato repetido.
3. As ações SHALL ser "Abrir conversa" e "Gerar PDF" (padrão) e o botão de
   ícone "Mais ações do pedido" (Compartilhar PDF, Cancelar pedido; no
   confirmado também Reabrir pedido).
4. **Negativo:** o cabeçalho SHALL NOT ter botão primário (PFI-13 e uma só
   primária por região).
5. **Negativo:** o selo SHALL NOT ser só cor nem se comportar como botão.

Verificação: contagem das ocorrências de entrega, peças e valor na tela com
dados sintéticos.

### PED-RD-03 — Ordem da ficha

1. A ficha SHALL seguir a ordem da ficha impressa: Resumo do pedido, Datas do
   pedido, Itens e especificações, Arte do pedido, Observações do pedido e
   Dados do atendimento.
2. Cada capítulo SHALL ter um `h2` (`--text-lg`, peso 600), o estado em texto
   com ícone ("Entrega 20/11/2026", "Falta: aplicação do item 2", "2 itens ·
   150 peças", "2 de 5 linhas") e, onde há edição, o `SaveStatus` com
   `role="status"`; nada mais no cabeçalho além da ação do capítulo, se houver.
3. A pendência exibida no estado do capítulo SHALL ser lida de
   `missingFields`, com as mesmas palavras do progresso e do rodapé (§20).
4. **Negativo:** "Controle de produção" SHALL NOT aparecer na tela.
5. **Negativo:** nenhum capítulo migrado SHALL ter "Editar <seção>" nem
   Salvar/Cancelar de seção (EDIT-01).

Verificação: leitura da árvore de regiões; busca por botões com nome
`/^Editar\b/` nos capítulos migrados.

### PED-RD-04 — Capítulo "Datas do pedido"

1. O capítulo SHALL ser o container de produção
   (`OrderMilestonesSection.vue`) refinado, sem trocar de contrato: contador
   neutro no cabeçalho ("1 de 3 datas") e a ação padrão "Confirmar entrega"
   à direita quando houver (só no confirmado).
2. A linha do tempo SHALL ser horizontal: data acima, ponto na trilha
   (concluído preenchido em sucesso, próximo vazado), título sublinhado em
   pontilhado como botão que abre o detalhe, e subtítulo.
3. O rodapé SHALL ter divisor, "Recebido: …" à esquerda e "Falta receber: …"
   à direita, só no confirmado.
4. WHEN o container tem 30rem ou menos THEN a mesma linha do tempo SHALL virar
   vertical, sem rolagem lateral.
5. **Negativo:** a linha do tempo SHALL NOT sair do capítulo para o rail nem
   achatar em lista.
6. **Negativo:** o estado de cada ponto SHALL NOT ser só visual: o nome
   acessível diz concluído, próximo ou futuro e a data ("sem data" quando
   não há).
7. **Negativo:** o botão do título SHALL manter o comportamento atual de abrir
   o detalhe do evento; esta entrega não muda o conteúdo dele.

Verificação: cenários do E2E das datas ("Datas do pedido", "Alterar data de
entrega") a 1440 e a 390 px; medida do container a 30rem.

### PED-RD-05 — Dados do atendimento

1. O último capítulo SHALL ser "Dados do atendimento", recolhido por padrão,
   com `button` de `aria-expanded` e `aria-controls` dentro do `h2` e o aviso
   "Não vai para a ficha impressa.".
2. O conteúdo SHALL listar vendedor, data do pedido, FAB, origem e campanha
   quando existirem.
3. **Negativo:** esse capítulo SHALL NOT aparecer na ficha impressa nem no PDF.
4. **Negativo:** SHALL NOT entrar no progresso de gerar o pedido.

Verificação: ficha impressa de um pedido sintético sem o texto do capítulo;
teclado abre e fecha com Enter e Espaço.

### PED-RD-06 — Fechamento e pagamento, pedido pendente

1. O rail SHALL ter o título "Fechamento e pagamento" e, nesta ordem: "Para
   gerar o pedido: N de 3" (passos Previsão de entrega, Itens e Arte, só do
   `missingFields`; só o próximo passo tem botão), "Valor do pedido" e "Gerar
   pedido".
2. A página SHALL ter uma só primária (PFI-13, PFI-16): o botão do próximo
   passo enquanto há pendência e "Gerar pedido" com tudo pronto. Com
   pendência, "Gerar pedido" SHALL ficar fora do estilo primário, usar
   `aria-disabled="true"`, continuar focável e mostrar o motivo ao lado
   ("Falta: aplicação do item 2 e mais 1 ponto") como descrição acessível.
3. Uma pendência que a tela não conhece SHALL virar o passo "Revisar
   pendências" e o total SHALL passar a 4, nunca um falso "3 de 3" (PFI-15).
4. O rail SHALL NOT aparecer para quem não edita nem para pedido da loja.
5. **Negativo:** o cadastro incompleto do cliente SHALL NOT aparecer em "Para
   gerar o pedido" nem bloquear "Gerar pedido" (ADR 082).
6. (Pendente de OLC-T01.) "Valor do pedido" SHALL mostrar Peças (soma dos
   itens, calculada), Frete e Total; o responsável edita o frete no lugar
   (`Field` "Frete" em R$), com a cotação do servidor como botão quieto "Usar
   cotação: R$ … · {serviço}" e a origem como texto.
7. (Pendente de OLC-T01.) Cotação vencida SHALL mostrar aviso de atenção com
   ícone, sem bloquear.
8. **Negativo:** o Total SHALL NOT ser digitado; SHALL ser calculado, com
   `tabular-nums` e destaque `--color-emphasis-*`.
9. **Negativo:** até OLC-T01 o rail SHALL NOT mostrar campo de frete nem
   "Peças + Frete" com um frete que o servidor não aceita.

Verificação: progresso 0 a 3 de 3 e o caso 4; Playwright dos passos
"Para gerar o pedido" e "Gerar pedido".

### PED-RD-07 — Fechamento e pagamento, pedido confirmado

1. O fechamento SHALL ser leitura: selo "Confirmado por {nome} · {data},
   {hora}", Valor do pedido (frete somente leitura, com origem), Forma de
   pagamento e "Ficha v{N} · gerada {data}, {hora}" com "Baixar ficha em PDF".
2. O rail SHALL mostrar "Cobranças" como resumo ("Recebido R$ … de R$ …" com
   `Meter` e "Ver cobranças"); SHALL NOT desenhar o interior da cobrança
   (PR 348).
3. A ficha SHALL ter, no topo, uma linha com cadeado: "Pedido confirmado. Para
   alterar, reabra o pedido em Mais ações.", e os campos SHALL ser texto
   (`dl`/`dd`), sem campo desabilitado em massa (PFI-10).
4. (Pendente de OLC-T03 e OLC-T04.) Só para quem é "Habilitado Olist", o rail
   SHALL ter um bloco próprio com a primária "Gerar no Olist", com os estados
   Pronto, Cadastro incompleto, Aguardando processamento, Processando (com
   etapa), Gerado (venda nº e "Abrir venda no Olist"), Conferência necessária
   e Falha de consulta.
5. **Negativo:** com cadastro incompleto "Gerar no Olist" SHALL usar
   `aria-disabled`, dizer o que falta ("CPF ou CNPJ, endereço de entrega"),
   oferecer "Completar cadastro" e SHALL NOT entrar no progresso de gerar o
   pedido (ADR 082).
6. **Negativo:** em "Conferência necessária" SHALL NOT haver botão de
   repetir; em "Falha de consulta" só "Atualizar situação", somente leitura.
7. **Negativo:** quem não é "Habilitado Olist" SHALL NOT ver o bloco nem texto
   que o cite.
8. **Negativo:** "Gerar no Olist" SHALL NOT abrir diálogo de prévia
   (ADR 079): é comando direto e o bloco acompanha o estado.

Verificação: cenários sintéticos por estado do bloco Olist (quando OLC-T04
existir) e leitura do pedido confirmado sem campos editáveis.

### PED-RD-08 — Rail antes da ficha abaixo de 75rem

1. O rail SHALL ser o primeiro filho do layout no DOM; abaixo de 75rem vem
   antes da ficha, logo depois do cabeçalho; a partir de 75rem a grade
   (`grid-template-areas`) o põe à direita, sticky, com
   `minmax(20rem, 24rem)`.
2. A ordem de foco por teclado SHALL ser igual à ordem visual em toda largura.
3. No celular, o rodapé fixo SHALL levar o próximo passo enquanto houver
   pendência e "Gerar pedido" só sem pendência (PFI-16).
4. **Negativo:** nenhuma regra SHALL usar `order`, `flex-direction: *-reverse`
   ou posicionamento que mude a ordem visual sem mudar o DOM.
5. **Negativo:** abaixo de 75rem o progresso e a ação SHALL NOT cair depois
   das seções da ficha.

Verificação: ordem de Tab a 1440, 1024 e 390 px; `getBoundingClientRect` do
rail contra o primeiro capítulo.

### PED-RD-09 — Resumo

1. O Resumo SHALL mostrar Cliente (texto não editável, com "Ver cadastro"),
   "Nome do pedido" e "Previsão de entrega", em edição no lugar (`Field` em
   linha, §20).
2. Em container de 40rem ou mais, Nome do pedido e Previsão de entrega SHALL
   ficar lado a lado.
3. **Negativo:** o Resumo SHALL NOT repetir peças, valor, vendedor, data do
   pedido nem FAB; vendedor, data do pedido e FAB vão para Dados do
   atendimento.
4. **Negativo:** SHALL NOT haver "Editar resumo" nem Salvar/Cancelar.
5. **Negativo:** "Previsão de entrega" ausente SHALL ter `FieldGap` ("Falta
   para gerar o pedido"), `aria-required="true"` e nunca `aria-invalid`.

Verificação: E2E do Resumo adaptado a campos abertos; contagem de ocorrências
dos fatos-chave.

### PED-RD-10 — Arte, "Arte final" e "Arquivos da arte" lado a lado

1. "Quem faz a arte" SHALL ficar no topo, como dois chips de alternância
   (`aria-pressed`) que salvam ao tocar.
2. Abaixo, "Arte final" (a versão aprovada que vai para a produção) e
   "Arquivos da arte" (referências e rascunhos; não vão para a produção)
   SHALL ficar lado a lado em container de 32rem ou mais, empilhados no
   estreito, cada um com `h3`.
3. Cada lista SHALL ter um só controle "Adicionar arquivo" e remover por botão
   de ícone de 44 px com nome ("Remover {arquivo}").
4. **Negativo:** SHALL NOT haver "Editar arte" nem Salvar/Cancelar.
5. **Negativo:** um arquivo de "Arquivos da arte" SHALL NOT aparecer como arte
   final nem entrar na ficha de produção.
6. **Negativo:** sem escolha em "Quem faz a arte", o estado do capítulo SHALL
   dizer "Falta marcar quem faz a arte" com `FieldGap`, nunca erro.

Verificação: E2E de arte final e arquivos (`Enviar arte final`) com o novo
arranjo; medida das duas colunas a 32rem.

### PED-RD-11 — Observações

1. O capítulo SHALL ser uma lista numerada com cabeçalho visível das colunas
   ("Nº", "Observação"), uma linha por observação (até 5 de 200 caracteres) e
   `BlankRow` tracejada no fim, mais uma dica de uma linha sob a lista.
2. Cada linha SHALL salvar ao sair do campo ou com Enter; remover SHALL ser
   botão de ícone com nome ("Remover observação 1").
3. **Negativo:** SHALL NOT haver botão "Adicionar linha" nem "Editar
   observações"; a `BlankRow` não tem botão de remover, não gera pendência e
   não conta no limite de 5.
4. **Negativo:** ao chegar a 5 linhas a `BlankRow` SHALL sair e a dica dizer o
   limite; observação em branco SHALL NOT ser gravada.

Verificação: criar, editar e remover linhas por teclado, com 5 linhas e com
colagem.

### PED-RD-12 — Edição no lugar e leitura

1. Quem pode editar SHALL ver Resumo, Arte e Observações com campos abertos;
   cada alteração salva sozinha (EDIT-01), com `SaveStatus` por capítulo.
2. Quem não pode editar e o pedido confirmado SHALL ver o mesmo layout em
   leitura.
3. **Negativo:** SHALL NOT haver mistura dos dois modelos num capítulo
   migrado; um capítulo ainda não migrado SHALL manter o modelo anterior até
   a sua tarefa.
4. **Negativo:** falha de salvamento SHALL virar erro no campo com o valor
   preservado; conflito de versão SHALL oferecer recarregar (§20).
5. Mudar a quantidade ou o valor SHALL continuar exigindo a revisão humana do
   subtotal (OLIST-43); esta spec não muda isso.

Verificação: simulação de falha de rede e de 409 por campo.

### PED-RD-13 — Hierarquia e ritmo

1. A página SHALL ter quatro níveis: (1) página, `h1`; (2) capítulo ou bloco
   do rail, `h2` `--text-lg` 600; (3) subseção, `h3` `--text-base` 600;
   (4) rótulo de campo e metadado, `--text-sm` 500 atenuado e `--text-xs`.
2. O ritmo SHALL ser 32 px entre capítulos, 24 px entre subseções e 16 px
   entre campos, e 8 a 12 px dentro de um grupo; só valores da escala de 4 px
   (`--space-*`).
3. Subseções SHALL agrupar por espaço, não por caixa.
4. **Negativo:** SHALL NOT haver peso 700 em texto corrido, caixa alta, texto
   abaixo de `--text-xs`, nem valores de espaço fora da escala nas regras
   novas ou tocadas.

Verificação: contagem de nós por tamanho e peso e de espaços fora da escala
em `40-order.css`, antes e depois (§19 do `design.md`).

### PED-RD-14 — Responsividade por container

1. Todo container de layout (ficha, capítulo, blocos do rail, lista de itens,
   linha do tempo) SHALL declarar `container-type: inline-size`,
   `inline-size: 100%` e `min-inline-size: 0`.
2. As grades internas SHALL reagir ao container com `@container`: Resumo a
   40rem, Arte a 32rem, Datas a 30rem; a única consulta de viewport do layout
   é a de 75rem do rail.
3. SHALL NOT haver rolagem horizontal da página a 320 px nem a 200% de zoom.
4. **Negativo:** nenhum container de layout SHALL ser centralizado com
   `margin-inline: auto` dentro de grade ou flex sem largura explícita; um
   container sem largura intrínseca encolhe a zero.
5. **Negativo:** a mesma marcação SHALL funcionar com o rail ao lado (75rem),
   a 1024 px e a 390 px, sem marcação duplicada por tamanho.

Verificação: larguras de container medidas a 1440, 1366, 1024, 768, 390 e 320
px; busca por `margin-inline: auto` nos containers.

### PED-RD-15 — Acessibilidade

1. Cada capítulo e bloco do rail SHALL ser uma região com nome (`h2` ligado
   por `aria-labelledby`); os nomes SHALL permanecer "Resumo do pedido",
   "Datas do pedido", "Itens e especificações", "Arte do pedido",
   "Observações do pedido", "Dados do atendimento" e "Fechamento e pagamento".
2. O foco SHALL ser previsível depois de salvar, remover e criar linha; uma
   resposta atrasada SHALL NOT roubar o cursor (§20).
3. Alvos SHALL ter 44 px no toque e 8 px entre alvos; nada depende de hover.
4. **Negativo:** nenhum campo SHALL ser nomeado só por placeholder ou
   `aria-label` (§20); `Meter` e progresso SHALL ter nome e valor.
5. **Negativo:** com `prefers-reduced-motion: reduce` o chevron do disclosure
   e qualquer rolagem SHALL NOT animar.

Verificação: varredura com teclado, `axe` no E2E e checagem manual com leitor
de tela (ainda não feita).

### PED-RD-16 — Orçamento de ações e medidas

1. A contagem de ações (botões, links e itens de menu; campos não contam,
   ADR 083) da primeira tela do pedido SHALL ser medida a 390×844 e a
   1366×768, antes e depois, com dados sintéticos.
2. **Negativo:** a meta da §16 SHALL NOT ser declarada atendida sem a medição;
   ações abaixo da primeira tela (como os botões de remover tamanho, um por
   linha) não entram nela.
3. Medido em 12/11/2026: 3 ações no pendente a 390×844 e 3 a 1366×768, contra
   12 e 16; `test/e2e/ux-budget.spec.js` (`pedidoPrimeiraTela`) trava o limite.

Verificação: ver "Medidas a coletar".

## Medidas a coletar (antes e depois)

Método da §19 do `design.md`, com um pedido sintético de 2 itens e 3 tamanhos
por item, nos estados pendente e confirmado:

- Ações por tela a 390×844 e 1366×768 (§16).
- Quantas vezes entrega, peças e valor aparecem como texto.
- Distância, em px, do topo da página até "Gerar pedido" abaixo de 75rem.
- Nós de texto por tamanho e por peso; espaços fora da escala de 4 px em
  `40-order.css`.
- Modelos de salvamento por capítulo (meta: um).
- Largura útil do container de cada capítulo a 1440, 1024 e 390 px.

## Pendências do PO

- Botões de remover tamanho por linha contra a meta de ações da §16.
- Interior de Cobranças: depois do PR 348.
- Textos finais do bloco Olist e de "Cotação vencida": depois de OLC-T03,
  OLC-T04 e OLC-T01.
- Acordeão do celular (PFI-18): o protótipo mantém, na ordem nova; segue
  valendo até o PO decidir o contrário.

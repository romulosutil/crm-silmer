# ADR 083 — Edição no lugar no pedido

Status: aceita em 10/11/2026 pelo PO (Rômulo), a partir do protótipo de
"Itens e especificações".

Decisores: PO (Rômulo) e Tech Lead UX.
Supersede em parte a [ADR 036](036-padroes-de-jornada.md), só no ponto "Um só
modelo de edição" (Editar + seção → Salvar/Cancelar). O restante da ADR 036
permanece.
Contrato visual: [design.md](../../design.md), §20 (EDIT-01) e ajustes nas
§8, §9, §15 e §16.
Requisitos afetados em
[Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md): PFI-17 (botões
"Editar" do cabeçalho de seção), PFI-18 (acordeão com seção em edição) e
PIT-02 (bloco recolhível "Adicionais"). Preservados: PFI-04, PFI-10, PFI-13,
PFI-14, PFI-15, PFI-16, PIT-01, PIT-03, PIT-05, PIT-09 e OLIST-43.
RFC: não houve; a proposta foi avaliada diretamente no protótipo, que fica em
`output/prototipos/itens-especificacoes/` e não é versionado.
Esta entrega é documental; nenhuma tela foi alterada.

## Contexto

A seção "Itens e especificações" tinha dois modelos de edição. Antes dos
subtotais, "Editar itens" abria todos os itens num formulário único com um
Salvar no fim. Depois dos subtotais, cada alteração era um comando com
formulário próprio. No celular, o formulário único somava oito campos por
item em uma coluna, mais tamanhos e adicionais, e Cancelar descartava tudo.
Cada tamanho custava um toque em "Adicionar tamanho" e uma linha com cinco
controles.

A API de subtotais por tamanho já recebe um comando por alteração
(`update_group`, `add_line`, `change_quantity`, `rename_line`, `remove_line`,
`review_subtotal`, `add_group`, `duplicate_group`, `remove_group`,
`reorder_groups`).

## Decisão

1. O modelo de edição do pedido passa a ser a edição no lugar: quem pode
   editar vê os campos abertos e cada alteração salva ao sair do campo ou com
   Enter. Não há modo de edição, botão "Editar" de seção nem Salvar/Cancelar
   de seção.
2. Começa em "Itens e especificações" e segue para as demais seções do
   pedido. Uma seção ainda não migrada mantém o modelo anterior; nenhuma tela
   nova nasce com ele, e uma tela migrada não mistura os dois.
3. Fica em diálogo apenas o que compromete ou é irreversível: gerar,
   cancelar, reabrir e enviar.
4. Em "Itens e especificações", tamanho, quantidade e subtotal ficam na mesma
   linha desde a primeira linha; o passo "Usar subtotais por tamanho" deixa
   de existir na interface.
5. Saem os botões de − e + da quantidade e a reordenação de tamanhos. A
   leitura continua na ordem canônica; mover itens continua disponível.
6. A meta de controles da primeira tela do pedido passa a contar ações
   (botões, links e itens de menu); campos de dados não contam.
7. Os componentes `Field` em linha, `FieldGap`, `SaveStatus`, `BlankRow` e
   `InlineConfirm` entram na biblioteca do design system, com as regras da
   §20 do `design.md`.

## O que não muda

- Rascunho aceita campos em branco; só gerar o pedido cobra o que falta
  (`RULES.md`, regra 14), lido de `missingFields`.
- Quantidade do item e total do pedido saem dos tamanhos e nunca são
  digitados (PFI-04).
- Mudar a quantidade exige revisão humana do subtotal (OLIST-43); a tela
  marca a linha e oferece manter o valor.
- O subtotal é informado por tamanho; não há preço unitário digitado. O
  valor por peça é só conferência na tela.
- Campos da ficha continuam texto livre, sem lista de opções (PFI-14).
- Pedido confirmado e quem não pode editar veem tudo em leitura (PFI-10); a
  autorização continua na API.
- Uma só ação primária por região (PFI-13).

## Alternativas consideradas

- Manter "Editar itens" e encurtar o formulário: preserva o contrato, mas
  mantém dois modelos na mesma seção e a rolagem longa no celular.
- Editar um item por vez, com Salvar por item: menos mudança de contrato,
  porém ainda um modo de edição e um rascunho a perder.
- Edição no lugar com um comando por campo: escolhida, por usar os comandos
  que a API já aceita e eliminar o rascunho.

## Consequências

- A implementação precisa emendar PFI-17, PFI-18 e PIT-02 na especificação
  antes ou junto do primeiro PR de tela, porque a especificação tem
  precedência sobre o `design.md`.
- Cada campo passa a gerar uma requisição; conflito de versão e falha de
  rede precisam de tratamento no campo, com o valor digitado preservado.
- Iniciar os subtotais deixa de ser um ato do vendedor; a tela passa a
  enviar `initialize` quando o primeiro tamanho é criado.
- A meta de controles do pedido volta a ser medida depois da migração; até
  lá a linha do `design.md` é meta, não medição.
- Sem teste com leitor de tela nem em aparelho real até aqui: o protótipo
  foi conferido por script no Chrome a 390 px.

## Aceite da implementação

- Nenhum botão "Editar" + seção numa seção migrada.
- Todo campo com rótulo visível e a anatomia única do `Field`.
- Pendência de gerar ligada ao campo por `aria-describedby`, com texto e
  ícone, sem `aria-invalid`.
- Operação completa por teclado, foco previsível depois de criar e remover
  linha, alvos de 44 px no toque e reflow a 320 px.
- Salvamento anunciado numa só região `role="status"` por seção.

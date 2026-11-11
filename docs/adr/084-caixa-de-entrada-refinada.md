# ADR 084 — Caixa de Entrada refinada

Status: aceita em 11/11/2026 pelo PO (Rômulo), a partir do protótipo da
Caixa de Entrada.

Decisores: PO (Rômulo) e Tech Lead UX.
Não supersede nenhuma ADR. Abre uma exceção ao orçamento de ações da
[ADR 036](036-padroes-de-jornada.md) só no compositor da conversa; o restante
da ADR 036, a [ADR 065](065-caixa-de-entrada-por-vez-de-responder.md) (abas
por vez de responder) e a [ADR 083](083-edicao-no-lugar.md) (anatomia do
`Field`) permanecem.
Contrato visual: [design.md](../../design.md), §21 (INBOX-RD) e ajustes nas
§7, §8, §9 e §16.
Requisitos: INBOX-RD-01 a INBOX-RD-09 em
[Caixa de Entrada refinada](../../.specs/features/inbox-redesign/spec.md);
tarefas INBOX-RD-T00 a T09 em
[tasks.md](../../.specs/features/inbox-redesign/tasks.md). Preservados:
PCX-10 a PCX-19, PCX-16a–h, INBOX-UX-03/04, UX-FUNC-01, MEVQ-06/08 e BFUI-01.
RFC: não houve, como na ADR 083; a proposta foi avaliada diretamente no
protótipo, que fica em `output/prototipos/caixa-de-entrada/` e não é
versionado.
Esta entrega é documental; nenhuma tela foi alterada.

## Contexto

Medidas de produção em 11/11/2026, numa Caixa com 70 conversas:

- A lista com 224 px (`--inbox-list-inline-size: 14rem`) cortava 47% das
  prévias e 4 nomes; com 300 px corta 31% e nenhum nome.
- Não existia aviso de mensagem nova: quem estava em outra tela, com outra
  conversa aberta ou em outra aba da Caixa não via que um cliente escreveu.
- Na conversa, 74% dos nós de texto estavam em 13 px e 48% em peso 600 ou
  700; havia espaços fora da escala de 4 px (3,2 px, 6 px e 5,6 px).
- O histórico ocupava 1612 px de largura, com balões nas duas bordas e o
  cabeçalho de autor repetido em todas as 19 mensagens.
- O compositor era um campo sem borda nem fundo e cinco botões só de ícone
  com 4 px entre eles.
- O rail tinha 2 px entre itens e o mesmo ícone em Pedidos, Olist e Melhor
  Envio.

O `design.md` também tinha ficado para trás: a §9 ainda descrevia os atalhos
"Atender / Fechar pedidos / Todas" e "Todas · Aguardando vendedor · Meus
atendimentos", "Assumir atendimento" no compositor, "Mais" em folha no
celular e o item "Repassar"; a §7 citava "Vendedores" e não listava Olist,
Melhor Envio e Saúde e erros.

## Decisão

1. **INBOX-RD-01:** a lista tem `clamp(14rem, 24vw, 18.75rem)` no desktop
   (300 px a partir de cerca de 1250 px). O celular não muda.
2. **INBOX-RD-02:** a Caixa avisa mensagem nova: selo "Mensagem nova" como
   primeiro selo do card e prévia em `--color-text` peso 500; contador no
   item Caixa da navegação; título do documento com "(N) "; faixa
   `.inbox-live-notice` quando a marca está fora da vista; um anúncio por
   chegada. A marca é por navegador, some ao abrir a conversa, não marca a
   conversa aberta e não marca nada na primeira carga.
3. **INBOX-RD-03:** o histórico vira uma coluna de leitura centralizada com
   largura máxima, com balão de largura máxima, e mensagens seguidas do mesmo
   autor formam um grupo, com o autor uma vez e a hora em cada balão.
4. **INBOX-RD-04:** selos de status têm ícone e texto na lista, no cabeçalho e
   no painel; 8 px entre ações do cabeçalho; alvos de 40 px com mouse e 44 px
   no toque.
5. **INBOX-RD-05:** o compositor tem duas linhas: o campo de resposta com a
   anatomia do `Field` da §20 e as ferramentas em dois grupos (mídia; pedido),
   8 px entre botões, rótulo de texto quando há largura e "Enviar resposta"
   como única primária. Ação indisponível usa `aria-disabled` com motivo
   visível.
6. **INBOX-RD-06:** a casca de jornada (diálogo com título, fechar em botão de
   ícone, corpo rolável, rodapé de ações, elevação flutuante; folha inferior
   no celular) é aplicada ao diálogo de frete, sem caixas aninhadas. Depois
   de vincular o frete, "Escrever resposta com o frete" é a primária.
7. **INBOX-RD-07:** a navegação é agrupada por espaço em operação,
   integrações, administração e Conta, com 4 px entre itens, 16 px entre
   grupos e um ícone por destino (Melhor Envio usa `truck`; Olist ganha
   `package`).
8. **INBOX-RD-08:** as seções do painel Atendimento passam a ser `Tabs` de
   verdade, e o resumo do pedido é o primeiro bloco de "Pedidos e assuntos".
9. **INBOX-RD-09:** valores fora da escala viram token e regras CSS sem
   marcação saem.
10. **Exceção ao orçamento da §16:** o compositor pode ter uma primária e até
    quatro ferramentas em dois grupos. Nenhuma outra região herda a exceção.

## O que não muda

- As quatro abas da ADR 065 (Responder, Aguardando, Sem retorno, Perdidos),
  suas contagens, ordens e cursores (PCX-19).
- "Assumir atendimento" no cabeçalho como única primária antes da tomada
  humana (PCX-15); depois, "Enviar resposta" no compositor. A conversa nunca
  volta ao agente (ADR 015).
- O rascunho de cada conversa fica só em memória (UX-FUNC-01); a marca de
  mensagem nova não guarda conteúdo.
- Comandos, permissões, versões e confirmações da Caixa, do frete
  (MEVQ-06/08) e da cobrança (BFUI-01).
- Uma só ação primária por região (§14) e alvos de 44 px no toque (§11).

## Fora desta decisão

- **Jornada de cobrança:** o PR 348 (`codex/order-timeline`, contratos
  BCS-01–09) está reescrevendo a cobrança do pedido. A casca de jornada será
  aplicada a "Cobranças e pagamentos" depois que ele for mesclado, em tarefa
  própria; até lá o diálogo de cobrança fica como está.
- **Marca lida no servidor:** a marca de mensagem nova não acompanha a pessoa
  entre aparelhos nem navegadores. Um marcador de lido no servidor fica para
  decisão futura.
- Os pontos da seção "Decisões pendentes" do protótipo que não estão nos IDs
  acima, listados no fim da §21 do `design.md`.

## Alternativas consideradas

- **Só alargar a lista:** resolve o corte dos nomes, mas não o aviso de
  mensagem nova nem a leitura do histórico.
- **Marca de lido no servidor já agora:** acompanharia a pessoa entre
  aparelhos, mas exige migração, endpoint e regra de quem leu numa conversa
  com vários atores. Fica para quando houver pedido do PO.
- **Bolinha colorida no card:** depende só de cor (§15); escolhido o selo com
  ícone e texto.
- **Manter o compositor numa caixa única e só aumentar o espaço:** mantém o
  campo sem borda, que a §15 proíbe.
- **Aplicar a casca também à cobrança agora:** retrabalho certo, porque o
  PR 348 muda o conteúdo da cobrança.

## Consequências

- O `design.md` passa a registrar o que o código entrega na Caixa (§9) e na
  navegação (§7), e ganha os componentes da §8 e a §21.
- A marca de mensagem nova depende do armazenamento do navegador; sem ele, a
  marca dura só a visita, sem erro.
- O compositor deixa de ser só ícone no notebook; a contagem de ações da
  conversa continua dentro da meta da §16, exceto gravando áudio no celular
  (ponto pendente na §21).
- Sem teste com leitor de tela nem em aparelho real até aqui: o protótipo foi
  medido no navegador a 1920×945, 1366×768 e 390×844.

## Aceite da implementação

- Cada requisito INBOX-RD-01 a 09 com os cenários negativos da spec.
- Operação completa por teclado, foco previsível, reflow a 320 px, temas
  claro e escuro e `prefers-reduced-motion` respeitado.
- Nenhum estado transmitido só por cor; nenhum texto abaixo de `--text-xs`.
- Nenhum dado de cliente no armazenamento do navegador.

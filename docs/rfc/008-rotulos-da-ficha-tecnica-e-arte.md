# RFC 008 — Rótulos da ficha: técnica por item e arte do pedido

Status: decidida pelo PO em 03/10/2026; registrada na [ADR 020](../adr/020-tecnica-por-item-e-arte-do-pedido.md).

Data: 03/10/2026

Origem: o PO pediu a revisão de todas as labels da ficha de pedido, agrupadas
por seção, para achar conceitos “parecidos” (por exemplo, “Tipo de roupa”,
“Tipo de serviço” e “Técnica da arte”). A análise leu a tela do pedido, a
ficha impressa v4 e os “Dados do atendimento” no `master` c237200.
Requisitos `TEC-01`–`TEC-08` da [spec](../../.specs/features/pedidos-mvp/spec.md),
tarefas T83–T87 de [tasks](../../.specs/features/pedidos-mvp/tasks.md).

## Problema observado

Cada seção tem uma função clara (Resumo: o pedido inteiro; Lastro: datas;
Itens: o que costurar; Estampa e arquivos: a arte; Controle de produção: a
fábrica; Dados do atendimento: o que o bot ouviu; Fechamento: dinheiro), mas
alguns conceitos aparecem com vários nomes ou com o mesmo nome para coisas
diferentes:

| Grupo                            | O que confunde                                                                                                                                                                                        | Gravidade  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A. Como a arte é feita           | “Tipo de serviço” (item), “Técnica da arte (referência)” (resumo), “Técnica de estampa informada” (atendimento) e “Serviços dos itens” (papel) guardam a mesma coisa: silk, DTF, sublimação, bordado. | alta       |
| B. Estampa e arte                | O ponto 4 do item, “Estampa”, recebia do bot a origem da arte (“já tem a logo”), que o glossário manda não usar como descrição; a mesma origem existia em “Quem fez a arte?”.                         | alta       |
| C. Cor do tecido × cores da arte | “Cor frente”, “Cor costas”, “Manga direita” (cor do tecido) e “Cores Frente”, “Costas”, “Manga Direita” (contagem de tintas na produção) usam as mesmas palavras.                                     | alta       |
| D. Peça e gola                   | “Tipo de roupa”, “Tipo de peça”, “Modelo” e “Definição da gola” se sobrepõem; o aviso do modelo antigo pede para conferir os dois.                                                                    | média      |
| E. Datas                         | “Pagamento” = “Pago em” e “Entrega realizada” = “Entregue em”: a mesma data com dois nomes.                                                                                                           | média      |
| F. Copy                          | “Evento / Nome” × nome do cliente; “Viés mangas” × “Viés das mangas”; “Feito” × “Feita”.                                                                                                              | baixa      |
| G. Fora do papel                 | Numeração, personalizações e patrocinadores só aparecem em “Dados do atendimento”.                                                                                                                    | observação |

## Proposta decidida

1. **A — Técnica por item.** Um conceito só, chamado **Técnica**, em cada
   item (silk, DTF, sublimação, bordado… ou “Sem estampa”). É o ponto 4 do
   item, obrigatório para gerar. O bot pode preencher quando o cliente nomeia
   uma técnica; o vendedor confirma. “Técnica da arte (referência)” e
   “Serviços dos itens” saem.
2. **B — Arte no pedido.** “Estampa e arquivos” guarda quem faz a arte:
   **O cliente envia a arte**, **A Silmer cria a arte** ou **Sem estampa**.
   O bot preenche pelo que ouviu, o vendedor corrige e anexa os arquivos.
   Uma marcação é obrigatória para gerar. A estampa do item vira
   **Estampa (referência)**, opcional, entre os adicionais.
3. **C — Cores.** Os adicionais viram **Cor do tecido — frente/costas/manga
   direita/manga esquerda**; a produção vira **Cores da arte** com
   **Nº de cores — …**.
4. **D — Simplificar.** Os pontos do item ficam Tipo de roupa, Cor,
   Quantidade, Técnica, Tecido, Tamanhos e **Gola**. “Tipo de peça” dito ao bot
   aparece como “Tipo de roupa informado”. O aviso do modelo antigo sai.
5. **E — Datas.** **Pago em** e **Entregue em** na tela e no papel.
6. **F — Copy.** “Evento / Nome” vira **Nome do pedido**; “Viés das mangas”;
   entrega prometida é “a data combinada com o cliente”; o total de peças não
   mostra mais “cliente informou N”.
7. **G** fica como observação: esses campos não fazem parte da coleta atual do
   bot e, quando aparecem, o vendedor leva o que importa para Estampa
   (referência) ou Observações.

## Alternativas consideradas

- Manter “Tipo de serviço” como nome da técnica. Rejeitada: o PO escolheu
  **Técnica**, que diz o que o campo guarda.
- Deixar a origem da arte opcional e só a técnica obrigatória. Rejeitada: a
  produção precisa saber se a arte vem do cliente ou é criada; “Sem estampa”
  cobre a peça lisa.
- Manter “Serviços dos itens” no resumo impresso. Rejeitada: repete o que o
  item já mostra.
- Reescrever a v4 aprovada. Rejeitada: a impressão muda numa nova versão, v5.

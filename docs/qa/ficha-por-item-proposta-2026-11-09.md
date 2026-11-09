# Proposta medida — uma folha de fábrica por item

Data: 09/11/2026. Continuação da
[auditoria de campos](ficha-impressa-auditoria-2026-11-09.md).
Rastreabilidade: PIM-06–09/12–14, TEC-05/07, PUB-07 e referências T100/T134;
o futuro pacote de impressão deverá se coordenar com OLIST-49/50 e T25,
sem declarar essa tarefa concluída por esta proposta.

## Decisões do proprietário

- Repetir cliente/pedido, item e controle em cada página.
- A equipe conhece paisagem, mas o proprietário pediu que o retrato fosse
  mostrado e delegou a escolha da melhor estrutura.
- **Nenhum valor sai para a ficha, jamais. A ficha é fábrica, não financeiro.**
  A regra vale também com Olist e InfinitePay futuros.

## Recomendação

**A4 retrato, um item por face**, por leitura contínua e espaço de escrita.
Número do pedido e Item X de Y se repetem no topo e no rodapé. As folhas
podem acompanhar separadamente as peças sem perder sua identificação.

O ganho é operacional: cada item leva a própria especificação e controle.
Não é promessa de economizar papel; os oito itens da amostra geram oito
folhas, enquanto o modelo anterior distribuía itens e controle em seis.

| Medida real                                 |       Retrato |      Paisagem |
| ------------------------------------------- | ------------: | ------------: |
| Folhas / itens                              |         8 / 8 |         8 / 8 |
| Fonte mínima do PDF                         |       9,75 pt |       9,75 pt |
| Largura para nome do conferente de arremate |       54,6 mm |       26,6 mm |
| Altura livre dessa linha                    |        5,3 mm |        4,0 mm |
| Campos de produção por folha                |            14 |            14 |
| Pares tamanho/quantidade conferidos         |            31 |            31 |
| Valores de conteúdo rastreados              | 367 presentes | 367 presentes |
| Caracteres fora da página                   |             0 |             0 |

As medidas da linha usam o campo `conferido_arremate_por`; não generalizam
a largura para todos os campos. O retrato oferece aproximadamente o dobro
da extensão para nomes, sem reduzir a letra. Paisagem permanece como
comparação legítima, não como configuração ativada.

## Composição e conteúdo

O cabeçalho mantém marca oficial, pedido, Item X/Y, cliente, telefone,
e-mail, endereço, nome do pedido, vendedor e FAB. Primeiro contato, data do
pedido, previsão de entrega e entregue em são dados operacionais. A data
de quitação e qualquer bloco de cobrança ficam fora.

O centro contém tipo de roupa, público, cor, aplicação, modelo de malha,
gola, total calculado e grade. Adicionais mostram modelo, referência de
estampa, cores de frente/costas/mangas e os dois vieses. A origem da arte
e os seis nomes de arquivo aparecem; os arquivos não são imagens embutidas.

As cinco observações e os 11 dados de atendimento ilustrativos também
aparecem, identificados como informações do pedido repetidas em todas as
folhas. Isso é proposta de ampliação do conteúdo, não comportamento
entregue pela API vigente. Na implementação, notas precisam de revisão
para conter somente instruções de fábrica.

O controle tem Arremate, Conferência e embalagem e Cores da arte, com os
14 campos vazios. Nesta proposta ele passa a pertencer ao item da folha.
“Cores distintas” é do item, enquanto “Total nas partes” soma as aplicações
nas partes da peça. Essa mudança em relação ao total global antigo precisa
ser formalizada no contrato antes do runtime.

Olist e InfinitePay não são chamados. Os rótulos Aplicação e Previsão de
entrega antecipam a emenda aprovada OLIST-49/50; isso não habilita exportação,
inclui preços/subtotais ou declara a ficha v7 pronta.

## Prova e limite

Fonte própria `sample.json`: associação, contato, endereço, produtos, cores,
grades, técnicas, nomes de arquivos e notas são ilustrativos e sintéticos.
Não é outra emissão pela API do pedido da auditoria anterior. O HTML
autocontido foi aberto diretamente na Mel com Chromium, fonte incorporada
e tráfego externo bloqueado. O worker apenas renderizou arquivos locais;
não houve alteração da aplicação, configuração, banco ou template oficial.

Os oito itens somam 97 peças. O primeiro tem dez tamanhos e quantidade
informada diferente da grade, para testar densidade e referência. Todos
os itens possuem dados adicionais completos, cinco notas e seis nomes de
arquivo. A seleção de um item na prévia foi testada: a impressão ainda
mostra os oito itens.

Conferência com `pdfplumber`: 367 valores por orientação, 31 pares de
grade, oito páginas, limites físicos e fonte mínima. Texto em colunas foi
validado também pela caixa individual dos adicionais para evitar falso
negativo de extração intercalada. As 16 páginas foram inspecionadas na
revisão independente.

No teste adversarial, cinco observações de 200 caracteres superaram a face
disponível; a condição foi detectada. **Uma folha não comporta conteúdo
arbitrariamente extenso.** O gerador de amostra interrompe o encaixe
excedido sem encolher fonte ou apagar texto. Antes de ativar, será preciso
decidir uma continuação identificada para esse item ou um limite revisado
de conteúdo. O botão do HTML é apenas a prévia da amostra fixa; não é uma
validação de edição de notas reais.

A projeção enumera dados de fábrica, descartando dados financeiros e
cadastro fiscal. Sentinelas de preço, condição, entrada, saldo, checkout e
pagamento foram injetadas na origem e ficaram fora do HTML. Referências
financeiras comuns em texto livre também interrompem a geração, em vez de
apagar notas. Essa expressão determinística não resolve a interpretação
semântica de qualquer frase; a revisão das notas continua necessária.

## Skills e revisão

- **design-taste-frontend:** Achromatic ledger, seed `1472980212`, paleta e
  tipo preservados; aplicado como relatório/documento. Sem fotografias,
  gráficos ou movimento, pois não ajudam o trabalho no papel. A fonte é
  Poppins da dependência já existente, com licença preservada.
- **impeccable:** Operate/Read, extensão da identidade existente, estrutura
  fixada pelo usuário e construção em código. Contexto carregado uma vez;
  detector executado uma vez, sem achados. `design.md` global preservado;
  o protótipo tem contrato de superfície próprio.
- **ui-ux-pro-max:** consulta `dense data readability typography`, domínio
  UX, com recomendações verificadas de contraste e legibilidade. A
  recomendação de ações em lote foi descartada por não se aplicar à folha.
- Lint Taste: zero FAIL e WARN. Inspeção final em 1440, 768 e 390 px:
  zero FAIL, zero WARN e zero rolagem horizontal da página. A grade larga
  tem rolagem própria e foco por teclado no celular.
- Typecheck, ESLint dos arquivos, formatação, fronteiras, regressão dos
  templates vigentes e `git diff --check` completam o gate da proposta.
- Revisão independente Impeccable: **ship**, estritamente para apresentar
  esta proposta sintética; sem correções materiais pendentes.

Crítica final: primeiro olhar reconhece pedido e item; composição por
seções `identidade / especificação / grade / adicionais / instruções /
controle`. A interação útil compara orientações e troca o item sem mudar
a impressão completa. Avaliação interna, sem pretensão de premiação:
design 8, usabilidade 8, criatividade 6,5, conteúdo 9 → **7,8/10**.
Limites: dados de atendimento densos; escrita real e impressão física não
foram testadas. A recomendação do retrato é sustentada pela composição e
medida digital, e deve ser confrontada com uma amostra em papel.

## Artefatos

- [Retrato](../../output/pdf/ficha-por-item-proposta-2026-11-09/ficha-por-item-retrato.pdf)
  e [paisagem](../../output/pdf/ficha-por-item-proposta-2026-11-09/ficha-por-item-paisagem.pdf).
- [Prévia interativa](../prototypes/ficha-por-item/index.html) e
  [contrato visual local](../prototypes/ficha-por-item/DESIGN.md).
- [Medições de layout e limite](../../output/pdf/ficha-por-item-proposta-2026-11-09/layout-metrics.json),
  [conferência dos PDFs](../../output/pdf/ficha-por-item-proposta-2026-11-09/pdf-checks.json)
  e [inspeção do navegador](../../output/pdf/ficha-por-item-proposta-2026-11-09/browser-checks.json).

Pacotes v2–v6, hashes, CSP e `PRINT_TEMPLATE` não mudaram. Esta entrega
permite revisar a forma concreta antes de definir contrato e implementação.

# Ficha por item — contrato do protótipo

Proposta sintética de superfície Operate/Read; não substitui o contrato visual
global nem os templates aprovados do CRM.

## Composição

Uma face por item. A identificação do pedido e `Item X de Y` se repetem em
todas as folhas. Cliente/pedido vêm primeiro, especificações e grade em
seguida, adicionais/arte/instruções e controle de produção da própria peça.

- Retrato: leitura vertical e controle no rodapé.
- Paisagem: especificações em dois terços da largura, controle lateral e
  instruções abaixo; mesma informação e mesma fonte.
- A prévia inicia no primeiro item; selecionar um item altera somente a
  prévia. A impressão inclui todas as folhas.

## Tokens e impressão

Os tokens estão em `style.css`, herdando tinta e assinatura Silmer. A marca
vem de `apps/edge-web/src/brand/index.js`, com seu logotipo oficial.

| Papel                   | Valor                                      |
| ----------------------- | ------------------------------------------ |
| Família                 | Poppins incorporada, pesos 400/500/600/700 |
| Texto/rótulo mínimo     | 13 px = 9,75 pt                            |
| Entrelinha do documento | 1,3; títulos com 1,2–1,35                  |
| Tinta                   | `--ink: #0c042d`                           |
| Texto secundário        | `--muted: #514d61`                         |
| Papel                   | `--paper: #fff`                            |
| Linha estrutural        | `--rule: #d5d3db`                          |
| Linha para escrita      | `--writing: #777280`                       |
| Assinatura da marca     | `--brand: #c94300`, somente no logotipo    |
| Margem física           | 8 mm nos quatro lados                      |
| Área útil retrato       | 194 × 281 mm                               |
| Área útil paisagem      | 281 × 194 mm                               |

Rótulos em caixa normal; valores alinhados, números tabulares, fundo branco.
As linhas pertencem à grade e aos campos para preenchimento manual. Sem
fotografias, cartões decorativos, sombras ou movimento: esta superfície é
um documento físico de fábrica. A fonte está sob a licença em
`FONT-LICENSE.txt`, proveniente da dependência Poppins já existente.

## Conteúdo e fronteira financeira

A projeção `productionData` enumera dados de fábrica e não recebe valor,
preço, subtotal, condição, cobrança, quitação, sinal, saldo ou checkout.
O cadastro fiscal também fica fora. Datas operacionais: primeiro contato,
data do pedido, previsão de entrega e entregue em. Não existe “Pago em”.

Referências financeiras comuns encontradas em texto livre interrompem a
geração para revisão; o gerador não apaga uma instrução silenciosamente.
Essa guarda determinística não substitui revisão humana e não prova
classificação semântica perfeita de qualquer frase.

Os adicionais incluem modelo e viés da gola separadamente. Notas e nomes
dos seis arquivos acompanham a folha; imagens dos arquivos não são
embutidas. Todos os 14 campos de controle se referem ao item da folha.
“Cores distintas” é proposta de contagem do item, não quitação ou valor.

## Estados e limite

Fonte preservada na tela; abaixo de 850 px o papel vira uma coluna de
leitura. Grade larga rola em sua própria região com foco por teclado; nada
faz a página inteira rolar horizontalmente. Alvos da barra têm 44 px e
foco visível. Preferência de formato não muda dados ou estado de domínio.

O script de captura bloqueia o PDF se o conteúdo superar a folha; não
encolhe texto nem corta notas. O limite foi exercitado com cinco notas de
200 caracteres. Para ativação real ainda é necessário definir a política
de continuação de um item que excede uma face.

## Verificação

Estudo Tasteskill Achromatic ledger, seed `1472980212`, com paleta e tipo
preservados. Estrutura fixada pelo usuário; sem mudança de identidade,
gráficos ou sorteio de composição Impeccable. A assinatura própria é a
folha que acompanha o item até a conferência física.

Validação: 8 itens/97 peças, 8 páginas por orientação, 14 campos por item,
31 pares de grade por PDF, fonte mínima 9,75 pt. Prévia em 1440/768/390 px
sem transbordamento. Revisão independente: `ship` no escopo de proposta
sintética; escrita e legibilidade em papel continuam a exigir teste físico.

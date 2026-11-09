# Revisão de conteúdo v7 / loja-v2

Estado: **aguardando revisão do PO; não ativado**. Tarefa FIP-T01;
[requisitos](../../.specs/features/ficha-informacoes/spec.md). O proprietário
adiou o redesign em 09/11/2026: estes templates conservam o formato existente.

## Conteúdo

- Atendimento: modelo e viés da gola entre os adicionais; cores das duas mangas,
  viés das mangas, demais adicionais, sete pontos e grade preservados.
- Observações: cinco linhas existentes mais nove instruções complementares da
  fixture de auditoria. Modelo/dia desejado do atendimento são identificados
  como informação complementar, sem substituir item e previsão confirmados.
- Loja: observações com CEP/orientação de envio. Bloco de pagamento,
  comprovante, valor, forma e marca do gateway removidos.
- Atendimento: “Pago em” removido. Subtotais por tamanho e futuros objetos
  Olist/InfinitePay não entram na projeção.
- Rótulos Aplicação e Previsão de entrega conforme OLIST-49/50.
- Controle de produção: mesmos 14 campos vazios, página e composição atuais.

## Medição

Os dados sintéticos são os gravados na auditoria real do Mel, sem criar outra
venda. Os candidatos foram renderizados pelo novo código em diretório isolado
no Mel, com Node 24.20.0 e Chromium. Esta execução não é evidência de resposta
HTTP da API ativa com v7: a API continua com seu template anterior.

| Prova                                  | Resultado                                                   |
| -------------------------------------- | ----------------------------------------------------------- |
| Atendimento                            | 8 itens, 97 peças, 31 pares tamanho/quantidade preservados  |
| PDF atendimento                        | 6 páginas A4 paisagem, como o PDF anterior da mesma fixture |
| Observações/instruções                 | 14 entradas presentes                                       |
| Campos de produção                     | 14 vazios                                                   |
| PDF loja                               | 1 página A4 retrato, como o formato atual da loja           |
| CEP/orientação de envio                | Presentes                                                   |
| Sentinelas de modelo/viés/mangas/notas | 54/54 presentes no atendimento; 2/2 na loja                 |
| Caracteres fora da página              | 0 nas sete páginas                                          |
| Número do pedido                       | Presente em todas as páginas                                |
| Moeda/gateway/pagamento/comprovante    | Ausentes nos textos dos dois PDFs                           |
| Saúde do Mel antes/depois              | Mesmos resultados; diferença somente no horário             |

Todas as páginas foram renderizadas em PNG e inspecionadas. Não houve redução
de fontes, mudança de orientação ou redistribuição do controle de produção.

Teste adicional no Mel: observação com 100 linhas explícitas e token sem espaços
de 4.000 caracteres. Foram planejadas e geradas oito páginas, todas com número
do pedido e zero caracteres fora do papel; marcadores finais presentes.
[Medição adversarial](../../output/pdf/ficha-informacoes-2026-11-09/stress-measurements.json).
O teste unitário também cobre a observação válida de 199 caracteres/100 linhas
e cinco observações semelhantes, preservando todos os caracteres.

Gates locais: `npm run validate` passou (format, TypeScript, ESLint, fronteiras,
tokens, validadores, testes e build): 1.967 aprovados, 22 ignorados, zero falhas.
A regressão da loja comprova que uma recusa durante o render não grava primeira
impressão nem remove o aviso operacional. Versões/hashes históricos válidos.

Artefatos: [atendimento](../../output/pdf/ficha-informacoes-2026-11-09/attendance.pdf),
[loja](../../output/pdf/ficha-informacoes-2026-11-09/store.pdf),
[medição PDF](../../output/pdf/ficha-informacoes-2026-11-09/pdf-measurements.json),
[medição navegador](../../output/pdf/ficha-informacoes-2026-11-09/browser-measurements.json).
Hashes em [registro](ficha-pdf-approval-v7.json); entradas sintéticas em
[amostra](ficha-pdf-synthetic-v7.json).

## Ativação

A [ADR 017](../adr/017-ficha-impressa-com-os-sete-pontos.md) exige aprovação
da amostra antes da troca. `PRINT_TEMPLATE` continua em v6, incluindo loja-v1;
a seleção explícita de v7 usa loja-v2. O validador verifica ambas as amostras e
recusa a troca enquanto faltar aprovação provisória vinculada ao pacote.
Rose e Operação ainda devem assinar fisicamente antes da produção.

Rollback da futura ativação: voltar o switch a v6, que também volta a loja-v1;
nenhuma migração ou dado comercial é alterado. A volta restaura o comportamento
histórico, inclusive seu conteúdo financeiro na loja, e não deve ser confundida
com a correção atual.

Limites: nomes de anexos/cadastro fiscal fora desta fatia. Textos financeiros
explícitos bloqueiam a impressão para revisão; frases monetárias implícitas
podem não ser reconhecidas pelo detector. Sem exportação Olist, cobrança real,
mudança de runtime, deploy ou aprovação humana presumida.

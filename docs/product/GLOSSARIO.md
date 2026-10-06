# Glossário de produto e texto da interface

Rastreabilidade: `PCL-01..12`, `PFI-01..13`, `PLI-01..08`, `PCX-01..09`,
`ORD-01..04`, `TEC-01..08`, tarefas `T24..T38` e `T83..T87` de Pedidos MVP. As alterações solicitadas em
03/10/2026 acrescentam técnica por item, arte do pedido (ADR 020) e a
leitura operacional de vendas e inatividade. Este glossário fixa a redação; as regras de
permissão e estado continuam em `RULES.md` e na especificação.

| Termo na interface                       | Significado e uso                                                                                                                                                                                                 | Evitar                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Cliente**                              | Pessoa ou organização atendida; o cadastro técnico é `Contact`.                                                                                                                                                   | Alternar entre lead, contato e cliente na mesma tela.                           |
| **Conversa**                             | Histórico do canal e local de atendimento.                                                                                                                                                                        | Tratar chegada de mensagem como venda ou pedido.                                |
| **Atendimento**                          | Trabalho do agente ou de uma pessoa sobre a conversa.                                                                                                                                                             | Usar “concluído” para indicar pedido confirmado.                                |
| **Pedido**                               | Registro comercial ligado à conversa, com número `NN-CRM`, itens e situação.                                                                                                                                      | “Ficha” como nome do registro editável.                                         |
| **Pendente**                             | Pedido em edição; ainda não foi confirmado por pessoa autorizada.                                                                                                                                                 | “Aprovado”, “em produção” ou “pago”.                                            |
| **Confirmado**                           | Pedido gerado por pessoa autorizada, com valor e condição registrados; permite imprimir.                                                                                                                          | Inferir recebimento ou início da produção.                                      |
| **Ficha de pedido**                      | Documento impresso a partir de pedido confirmado.                                                                                                                                                                 | Chamar o formulário de edição de ficha impressa.                                |
| **Item**                                 | Uma peça do pedido com sete pontos: tipo de roupa, cor, quantidade, técnica, tecido, tamanhos e gola. Um pedido pode ter vários itens.                                                                            | Aplicar uma técnica única ao pedido inteiro.                                    |
| **Tipo de roupa**                        | Nome da peça no item (camiseta, polo, regata…). O que o cliente disse ao bot aparece como “Tipo de roupa informado”.                                                                                              | “Modelo” ou “Tipo de peça” como segundo campo.                                  |
| **Técnica**                              | Como a arte é aplicada naquele item: silk, DTF, sublimação, bordado… ou “Sem estampa”. Obrigatória para gerar; o bot pode sugerir.                                                                                | “Tipo de serviço”, “Técnica da arte” ou uma técnica no resumo.                  |
| **Gola**                                 | A gola que a produção deve executar.                                                                                                                                                                              | Presumir que toda gola usa viés.                                                |
| **Estampa (referência)**                 | Adicional do item: o que vai estampado e onde, quando ajuda a produção. Não bloqueia.                                                                                                                             | Usar para dizer quem faz a arte.                                                |
| **Cor do tecido — frente/costas/mangas** | Adicionais com a cor do tecido de cada parte, quando difere da cor do item.                                                                                                                                       | Confundir com o número de cores da arte.                                        |
| **Viés das mangas**                      | Acabamento das mangas quando aplicável.                                                                                                                                                                           | Confundir com a gola.                                                           |
| **Arte do pedido**                       | Quem faz a arte, em Estampa e arquivos: “O cliente envia a arte”, “A Silmer cria a arte” (podem coexistir) ou “Sem estampa”. Uma marcação é obrigatória para gerar; o bot preenche e o vendedor confere.          | Repetir a origem da arte dentro do item.                                        |
| **Arquivo da arte**                      | Um dos até cinco arquivos, de até 10 MB cada, que orientam designers e impressão. É enviado na página do pedido e guardado no RustFS; PNG, JPEG e WebP mostram miniatura, os demais formatos o ícone da extensão. | Expor link público, nome com PII ou mostrar o arquivo antes do envio concluído. |
| **Arte final**                           | O arquivo definitivo da arte do pedido: um por pedido, fora da conta dos cinco arquivos da arte, com as mesmas regras de envio e download.                                                                        | Chamar referência de arte final ou anexar mais de uma.                          |
| **Cores da arte**                        | Bloco do controle de produção: número de cores de tinta por parte da peça, preenchido à mão.                                                                                                                      | “Cor frente”, que é a cor do tecido.                                            |
| **Nome do pedido**                       | Evento, empresa, time ou turma do pedido.                                                                                                                                                                         | “Nome” sozinho, que se confunde com o cliente.                                  |
| **Pago em / Entregue em**                | Datas do lastro informadas pelo vendedor; o mesmo nome na tela e no papel.                                                                                                                                        | “Pagamento” para uma data.                                                      |
| **Peças**                                | Soma das quantidades da grade dos itens.                                                                                                                                                                          | Valor digitado manualmente.                                                     |
| **Vendas**                               | Número de pedidos confirmados.                                                                                                                                                                                    | Contar pendentes como vendas ou confundir com recebimentos.                     |
| **Valor vendido**                        | Soma do valor final dos pedidos confirmados.                                                                                                                                                                      | Chamar de faturamento recebido ou saldo.                                        |
| **Cliente sem resposta**                 | Sinal de acompanhamento 48 horas após o envio confirmado da última mensagem da Silmer, sem resposta posterior. O tempo na fila não conta.                                                                         | Contar envio falho/incerto ou afirmar que o cliente desistiu.                   |
| **Pedido sem movimentação**              | Tempo desde a última alteração do pedido.                                                                                                                                                                         | Apresentar como probabilidade de fechamento.                                    |

## Verbos das ações

| Ação                  | Texto recomendado                        | Resultado                                                      |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Abrir pedido          | **Abrir pedido** ou **Continuar pedido** | Navega para o registro; não altera estado.                     |
| Salvar seção          | **Salvar alterações**                    | Persiste a seção em edição.                                    |
| Gerar                 | **Gerar pedido**                         | Registra pessoa, horário, valor e condição; libera impressão.  |
| Reabrir               | **Reabrir pedido**                       | Volta a Pendente e bloqueia a impressão.                       |
| Imprimir              | **Imprimir ficha**                       | Abre o documento do pedido confirmado.                         |
| Recarregar após falha | **Tentar novamente**                     | Consulta novamente após erro; atualização normal é automática. |

## Para quem cada informação serve

- **Vendedor:** resolve pendências, confirma os dados e a arte do pedido. A IA apenas coleta relatos e sugere dados dentro de sua capacidade.
- **Rômulo:** acompanha valor vendido, quantidade de vendas e pontos que pedem
  intervenção. Indicadores devem declarar período e universo considerado.
- **Rose:** recebe a ficha confirmada e confere o financeiro. Qualquer aviso
  automático por e-mail ou n8n requer fluxo próprio acordado com a operação.
- **Designers:** precisam da ficha, da técnica de cada item, de quem faz a arte
  e da localização dos arquivos ou referências.
- **Costureiras:** usam tipo de roupa, tecido, cores, gola, mangas e tamanhos do
  item.
- **Embalador:** usa o número `NN-CRM` e a ficha impressa para identificar e
  conferir o pacote.

## Regras para mensagens de estado

- Escrever o que aconteceu e a próxima ação: “Falta o valor final para
  confirmar”, “Cliente sem resposta há 2 dias; considere retomar contato”.
- Em erro, dizer o que pode ser tentado sem culpar a pessoa: “Não foi possível
  salvar. Tente novamente.” Conflito de versão deve pedir revisão dos dados
  atualizados antes de salvar.
- Estados vazios explicam o próximo passo. Não mostrar botões de atualização
  durante a operação normal; manter “Tentar novamente” quando uma consulta
  falhar ou a conexão em tempo real estiver indisponível.

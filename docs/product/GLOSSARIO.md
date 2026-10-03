# Glossário de produto e texto da interface

Rastreabilidade: `PCL-01..12`, `PFI-01..13`, `PLI-01..08`, `PCX-01..09`,
`ORD-01..04`, tarefas `T24..T38` de Pedidos MVP. As alterações solicitadas em
03/10/2026 acrescentam tipo de serviço por item, origem da estampa e a leitura
operacional de vendas e inatividade. Este glossário fixa a redação; as regras de
permissão e estado continuam em `RULES.md` e na especificação.

| Termo na interface               | Significado e uso                                                                                                                           | Evitar                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Cliente**                      | Pessoa ou organização atendida; o cadastro técnico é `Contact`.                                                                             | Alternar entre lead, contato e cliente na mesma tela.                          |
| **Conversa**                     | Histórico do canal e local de atendimento.                                                                                                  | Tratar chegada de mensagem como venda ou pedido.                               |
| **Atendimento**                  | Trabalho do agente ou de uma pessoa sobre a conversa.                                                                                       | Usar “concluído” para indicar pedido confirmado.                               |
| **Pedido**                       | Registro comercial ligado à conversa, com número `NN-CRM`, itens e situação.                                                                | “Ficha” como nome do registro editável.                                        |
| **Pendente**                     | Pedido em edição; ainda não foi confirmado por pessoa autorizada.                                                                           | “Aprovado”, “em produção” ou “pago”.                                           |
| **Confirmado**                   | Pedido gerado por pessoa autorizada, com valor e condição registrados; permite imprimir.                                                    | Inferir recebimento ou início da produção.                                     |
| **Ficha de pedido**              | Documento impresso a partir de pedido confirmado.                                                                                           | Chamar o formulário de edição de ficha impressa.                               |
| **Item**                         | Um tipo de roupa, cor, descrição da estampa, tecido, tamanhos, definição da gola, grade e tipo de serviço. Um pedido pode ter vários itens. | Aplicar um serviço único ao pedido inteiro.                                    |
| **Tipo de roupa**                | Nome da peça no item. O campo anterior “Modelo” sai do fluxo comercial.                                                                     | “Modelo” como segundo campo obrigatório ou sinônimo.                           |
| **Definição da gola**            | Descrição da gola que a produção deve executar; substitui “Viés gola”.                                                                      | Presumir que toda gola usa viés.                                               |
| **Viés das mangas**              | Acabamento das mangas quando aplicável.                                                                                                     | Confundir com a definição da gola.                                             |
| **Tipo de serviço**              | Serviço específico daquele item, descrito para produção e designers.                                                                        | Colocar apenas no resumo do pedido.                                            |
| **Técnica da arte (referência)** | Informação geral coletada no atendimento sobre como a arte será aplicada; não substitui o tipo de serviço de cada item.                     | Tratar como serviço único para todos os itens.                                 |
| **Estampa do item**              | Descrição do que será impresso, bordado ou aplicado naquele item.                                                                           | Usar a origem da arte como descrição suficiente.                               |
| **Estampa feita pelo cliente**   | Origem informada e marcada pelo vendedor após conferir a referência.                                                                        | Inferir origem pela IA ou pelo nome do arquivo.                                |
| **Estampa feita pela Silmer**    | Origem informada e marcada pelo vendedor quando a Silmer faz a arte.                                                                        | Tratar a marcação como aprovação da arte.                                      |
| **Arquivo da estampa**           | Arquivo fornecido ou produzido para orientar designers e impressão; vínculo ao pedido e localização visível.                                | Expor link público, nome com PII ou prometer Dropbox antes do envio concluído. |
| **Peças**                        | Soma das quantidades da grade dos itens.                                                                                                    | Valor digitado manualmente.                                                    |
| **Vendas**                       | Número de pedidos confirmados.                                                                                                              | Contar pendentes como vendas ou confundir com recebimentos.                    |
| **Valor vendido**                | Soma do valor final dos pedidos confirmados.                                                                                                | Chamar de faturamento recebido ou saldo.                                       |
| **Cliente sem resposta**         | Sinal de acompanhamento quando a última mensagem da Silmer foi enviada há pelo menos 48 horas sem resposta posterior.                       | Contar envio falho/incerto ou afirmar que o cliente desistiu.                  |
| **Pedido sem movimentação**      | Tempo desde a última alteração do pedido.                                                                                                   | Apresentar como probabilidade de fechamento.                                   |

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

- **Vendedor:** resolve pendências, confirma os dados e marca a origem da
  estampa. A IA apenas coleta relatos e sugere dados dentro de sua capacidade.
- **Rômulo:** acompanha valor vendido, quantidade de vendas e pontos que pedem
  intervenção. Indicadores devem declarar período e universo considerado.
- **Rose:** recebe a ficha confirmada e confere o financeiro. Qualquer aviso
  automático por e-mail ou n8n requer fluxo próprio acordado com a operação.
- **Designers:** precisam da ficha, do tipo de serviço de cada item, da origem
  da estampa e da localização dos arquivos ou referências.
- **Costureiras:** usam tipo de roupa, malha, cores, definição da gola, mangas e
  grade do item.
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

# Carteira de pedidos e Mapa de corte

[RFC 077](../../../docs/rfc/077-carteira-de-pedidos-e-mapa-de-corte.md) ·
[ADR 101](../../../docs/adr/101-carteira-de-pedidos-e-mapa-de-corte.md)

| Requisito | Aceite                                                                                                                                                                                                                                                                                        | Tarefa  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| CAR-01    | A carteira apresenta vendas do mês e comparação com o mês anterior, total de pedidos, peças e ticket médio. Vendedor vê sua carteira. Administrador pode filtrar a equipe por vendedor.                                                                                                       | CAR-T01 |
| CAR-02    | Pedido de atendimento elegível começa na arte na primeira confirmação. Pessoas autorizadas registram o avanço com versão, idempotência e auditoria. Legado sem informação tem etapa a confirmar. Entrega usa o comando vigente.                                                               | CAR-T01 |
| CAR-03    | A carteira filtra por atraso, risco e etapa no servidor, preserva busca, paginação e documentos existentes, e apresenta os confirmados em grupos de prazo. O risco cobre o dia atual e os próximos três dias enquanto o pedido não está pronto.                                               | CAR-T01 |
| CAR-04    | Seleção explícita de 1 a 50 pedidos na arte ou na produção, com contador, revisão por teclado, toque e retorno de foco. Pendentes, prontos, entregues, cancelados, teste e loja ficam fora do mapa.                                                                                           | CAR-T02 |
| CAR-05    | Soma de quantidades por tamanho sem misturar modelo, cor, público, malha ou outras especificações de corte preenchidas. O público obrigatório no documento pode ser Unissex, Masculino, Feminino ou Infantil. Se faltar dado ou a grade divergir, a prévia identifica o pedido para correção. | CAR-T02 |
| CAR-06    | A4 privado com números dos pedidos, totais e grade por lote, no estilo da ficha. Sem nomes de clientes ou valores. A versão e o acesso são rechecados antes e depois de renderizar. Download auditado sem primeira impressão ou avanço de etapa.                                              | CAR-T02 |
| CAR-07    | Homologar uma amostra com a Rose e executar os gates de migração e release antes de disponibilizar a operação em produção.                                                                                                                                                                    | CAR-T03 |
| CAR-08    | Cada geração bem-sucedida registra todos os pedidos da seleção com suas versões. A carteira sinaliza os pedidos mapeados e permite consultar a data da emissão. A prévia desatualizada não pode emitir um mapa.                                                                               | CAR-T04 |
| CAR-09    | O mapa tem um número único na carteira e no PDF. Cada pedido pertence a um único mapa. O pedido fica disponível para consulta e sai da seleção. A API recusa toda seleção que contenha um pedido já mapeado, inclusive quando duas gerações concorrem pelo mesmo pedido.                      | CAR-T05 |
| CAR-10    | A etiqueta numerada abre a composição do mapa e permite baixar exatamente o PDF emitido. Consulta e download exigem acesso a todos os pedidos do mapa, não criam nova emissão e continuam válidos depois de alterações posteriores nos pedidos.                                               | CAR-T06 |
| CAR-11    | O histórico na Carteira lista os mapas emitidos por número decrescente, com data de emissão, números dos pedidos e download do PDF original quando disponível. Mapas antigos sem arquivo continuam consultáveis. A lista é paginada e inclui somente mapas para os quais a pessoa tem acesso a todos os pedidos. | CAR-T07 |

Recebimentos e saldo seguem os contratos de cobrança e da declaração de
pagamento no detalhe do pedido. A coluna Valor da carteira exibe o total do
pedido. Antes da emissão, mudanças na seleção ou nos pedidos exigem uma nova
prévia.

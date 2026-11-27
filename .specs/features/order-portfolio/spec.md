# Carteira de pedidos e Mapa de corte

[RFC 076](../../../docs/rfc/076-carteira-de-pedidos-e-mapa-de-corte.md) ·
[ADR 100](../../../docs/adr/100-carteira-de-pedidos-e-mapa-de-corte.md)

| Requisito | Aceite                                                                                                                                                                                                                                                                                        | Tarefa  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| CAR-01    | A carteira apresenta vendas do mês e comparação com o mês anterior, total de pedidos, peças e ticket médio. Vendedor vê sua carteira. Administrador pode filtrar a equipe por vendedor.                                                                                                       | CAR-T01 |
| CAR-02    | Pedido de atendimento elegível começa na arte na primeira confirmação. Pessoas autorizadas registram o avanço com versão, idempotência e auditoria. Legado sem informação tem etapa a confirmar. Entrega usa o comando vigente.                                                               | CAR-T01 |
| CAR-03    | A carteira filtra por atraso, risco e etapa no servidor, preserva busca, paginação e documentos existentes, e apresenta os confirmados em grupos de prazo. O risco cobre o dia atual e os próximos três dias enquanto o pedido não está pronto.                                               | CAR-T01 |
| CAR-04    | Seleção explícita de 1 a 50 pedidos na arte ou na produção, com contador, revisão por teclado, toque e retorno de foco. Pendentes, prontos, entregues, cancelados, teste e loja ficam fora do mapa.                                                                                           | CAR-T02 |
| CAR-05    | Soma de quantidades por tamanho sem misturar modelo, cor, público, malha ou outras especificações de corte preenchidas. O público obrigatório no documento pode ser Unissex, Masculino, Feminino ou Infantil. Se faltar dado ou a grade divergir, a prévia identifica o pedido para correção. | CAR-T02 |
| CAR-06    | A4 privado com números dos pedidos, totais e grade por lote, no estilo da ficha. Sem nomes de clientes ou valores. A versão e o acesso são rechecados antes e depois de renderizar. Download auditado sem primeira impressão ou avanço de etapa.                                              | CAR-T02 |
| CAR-07    | Homologar uma amostra com a Rose e executar os gates de migração e release antes de disponibilizar a operação em produção.                                                                                                                                                                    | CAR-T03 |

Recebimentos e saldo seguem os contratos de cobrança e da declaração de
pagamento. A carteira sinaliza a quitação quando registrada. O mapa deve ser
gerado novamente quando a seleção ou o conteúdo de algum pedido mudar.

# Revisão heurística do CRM — 03/10/2026

**Baseline reconciliada em 05/10/2026:** PR 142 integrada; Técnica por item, arte do pedido e v5 (ADR 020). A tabela de achados registra a revisão original e seus refinamentos; evidências visuais datadas da v4 não comprovam ensaio da v5.

Rastreabilidade: `PFI-01..13`, `PLI-01..08`, `PCX-01..09`, `PIM-01..05`,
`PAU-01`, `REV-01..10`, `TEC-01..08` e tarefas T76–T87 de Pedidos MVP. Avaliação do código e
das telas locais. Os dois PDFs fornecidos em 03/10/2026 servem de referência
visual; a rota real exige sessão autorizada, e o workflow n8n não ficou
acessível neste ambiente. Validar com as pessoas da operação após o deploy.
Prioridade `P1` afeta conclusão da tarefa; `P2` causa confusão ou retrabalho;
`P3` é refinamento.

| Heurística                     | Achado concreto                                                                                                 | Prioridade | Ajuste nesta entrega / verificação                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Visibilidade do estado         | Pedido pendente e confirmado existem, mas “parado há” mede alteração do pedido, não resposta do cliente.        | P1         | Mostrar sinais separados para pedido sem movimentação e cliente sem resposta, com origem do dado explícita.        |
| Correspondência com a operação | “Modelo”, “Viés gola” e serviço no resumo não descrevem a decisão por item da produção.                         | P1         | Usar Tipo de roupa, Gola e Técnica em cada item (ADR 020).                                                         |
| Controle da pessoa             | Edição por seção e confirmação humana já existem; falta tornar clara a responsabilidade pela origem da estampa. | P1         | Origem no pedido; bot só projeta relato inequívoco ainda vazio e vendedor confere (ADR 020).                       |
| Consistência                   | “Gerar pedido”, “Confirmar pedido” e “Ficha” apareciam para efeitos distintos.                                  | P1         | Usar os verbos do glossário em botões, bloqueios e estados.                                                        |
| Prevenção de erro              | O impresso só abre após confirmação, mas arquivo sem validação e destino incerto pode sumir ou expor dados.     | P1         | Preparar contrato de upload com validação, acesso autorizado e destino explícito antes de habilitar armazenamento. |
| Reconhecimento                 | A página de pedido reúne muitos blocos e pendências sem indicar a sequência operacional.                        | P2         | Priorizar próximo passo, agrupar especificações por item e deixar informações somente de leitura menos dominantes. |
| Eficiência                     | Linhas de lista exigiam acionar botão estreito; indicador precisava de “Atualizar”.                             | P2         | Área principal das linhas navega por mouse e teclado; dados observam eventos do CRM.                               |
| Design sóbrio                  | Dashboard era dominado por conversas e não respondia “quanto vendeu”.                                           | P2         | Dar destaque a valor vendido e vendas confirmadas; limitar análises ao que os dados sustentam.                     |
| Recuperação de erro            | SSE pode cair e consulta falhar.                                                                                | P2         | Indicar reconexão e oferecer nova tentativa quando necessário, preservando conteúdo já carregado.                  |
| Ajuda e orientação             | Termos iguais tinham sentidos distintos entre pedido, conversa e produção.                                      | P2         | Glossário canônico e microtextos com próximo passo.                                                                |

## Revisão adversarial e correções de integração

| Situação observada                                                                                          | Ajuste e evidência                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pedidos antigos mostravam cor e gola vazias na tela v3; editar podia perder a gola histórica.               | Leitura e formulário aproveitam `cor_frente`/`cor_costas` e `vies_gola` quando os campos novos não existem. Cenário E2E salva outro campo e confere que cor e gola continuam no pedido.                  |
| Renomear um cliente não atualizava o pedido pendente.                                                       | A API projeta o nome atual no pedido pendente e congela o nome vigente ao confirmar. Eventos de contato atualizam lista e detalhe; testes de runtime e E2E cobrem as duas leituras.                      |
| O sinal “Cliente sem resposta” alcançava somente as 100 conversas mais recentes e podia contar envio falho. | O pedido recebe metadados da última mensagem por consulta em lote. A interface sinaliza apenas envio `sent`, `delivered` ou `read` com 48 horas ou mais; envio falho ou incerto não entra.               |
| Evento recebido durante edição era descartado e um conflito 409 deixava a tela obsoleta.                    | A tela guarda a necessidade de atualizar, preserva o rascunho até cancelar e então busca a versão atual. Cenário E2E verifica a nova consulta.                                                           |
| A tabela de pedidos aumentava a largura da página em celular.                                               | A tabela rola dentro de uma região focável, com instrução visível em tela pequena. Teste E2E em 390 px verifica largura da página e rolagem por teclado.                                                 |
| O template foi visualmente conferido com dois itens, mas um pedido pode ter mais.                           | A candidata v4 com dois itens gerou duas páginas A4 paisagem. Com seis itens sintéticos, gerou quatro páginas: seis itens nas três primeiras e controle de produção na última.                           |
| Uma grade com 100 tamanhos podia exceder a altura de um cartão e cair em página sem cabeçalho.              | A candidata v4 divide a grade em partes numeradas de até sete tamanhos. Um ensaio sintético extremo imprimiu os 100 tamanhos uma vez, com cabeçalho em todas as páginas comerciais e produção na última. |

## Cenários de aceite manual

1. Vendedor usa somente teclado para abrir um pedido da lista, editar um item,
   salvar, confirmar e abrir a ficha; foco permanece previsível.
2. Outro vendedor abre o pedido em leitura e não consegue marcar estampa,
   editar item nem confirmar pela API.
3. Pedido com dois itens aceita técnicas distintas; arte pertence ao pedido. Confirmar Sem estampa exclusivo das outras origens e leitura da Técnica na ficha v5.
4. Dashboard muda após confirmação ou reabertura sem recarregar a página;
   valor vendido e vendas contam apenas confirmados.
5. Pedido com última mensagem enviada pela Silmer há mais de 48 horas recebe
   sinal de cliente sem resposta; conversa que recebeu resposta ou cuja saída
   falhou não recebe.
6. A impressão candidata preserva campos de produção vazios, sem valor ou
   condição de pagamento, e não altera versões/hashes v2–v4.

## Limites de interpretação

Um “termômetro” de chance de venda precisaria de histórico suficiente e de
critérios comerciais validados. A interface usa sinais observáveis de tempo e
resposta, sem porcentagem de fechamento. A comparação visual da ficha usa
`ficha-canonica-sintetica-v3.pdf` e a candidata
`output/pdf/ficha-canonica-sintetica-v4.pdf`; o exemplar real
`25-CRM-ficha-v3.pdf` não deve ser copiado para testes ou relatórios. A v5 está selecionada com aprovação provisória do PO; a assinatura física de Rose e Operação continua obrigatória antes da produção. O envio ao
Dropbox e as notificações a Rose ficam para fluxos de produção acordados com
a Silmer.

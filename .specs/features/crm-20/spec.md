# CRM Silmer 2.0 centrado no cliente

Proposta em revisão conforme [RFC 075](../../../docs/rfc/075-crm-20-centrado-no-cliente.md).
A primeira entrega dá ao vendedor contexto para atender um cliente recorrente.
O piloto seguinte exercita duas linhas de WhatsApp sobre o mesmo cadastro
quando houver correlação verificável. A avaliação usa o código de
`0c89a1c7`. A base real, os workflows publicados e as linhas do piloto
exigem evidência operacional própria.

## Contratos de referência

- [Regras do CRM](../../../RULES.md), [especificação do MVP](../crm-mvp/spec.md)
  e [design técnico vigente](../../../TECHNICAL-DESIGN.md).
- [Cliente, Pedido e Assuntos](../cliente-pedido-assuntos/spec.md),
  [WhatsApp por vendedor](../seller-whatsapp/spec.md) e
  [visibilidade de conversas](../conversation-visibility/spec.md).
- [Contrato do n8n](../../../docs/integrations/n8n/README.md),
  [cobranças e recebimentos](../order-billing/spec.md) e
  [venda da loja](../../../docs/adr/027-venda-da-loja-do-site.md).

## Escopo da primeira entrega

| ID     | Requisito e critério verificável                                                                                                                                                                                                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C20-01 | Em Clientes e Meus clientes, buscar pelo nome ou telefone pelos contratos existentes. Um Contato sem canal continua consultável. Cadastro manual, carteira, busca paginada e opção de revisão de homônimos ou colisões continuam operáveis.                                                                                                          |
| C20-02 | O perfil mostra Pedidos e ciclos visíveis, com origem, status, datas e links autorizados. Um pedido ligado por mais de um caminho aparece uma vez. Cada lista possui cursor próprio e ordenação estável. Lista vazia, falha e acesso revogado são distinguíveis.                                                                                     |
| C20-03 | Apurar em centavos pedidos de atendimento confirmados, visíveis, vinculados e elegíveis. Excluir teste, cancelado, pendente e pedido reaberto. Ticket médio usa o total dividido pela mesma contagem, arredondado para centavos. Com denominação zero, exibir ausência de ticket e de última venda. Usar data oficial da venda no fuso de São Paulo. |
| C20-04 | No atendimento ativo, mostrar contexto comercial autorizado no painel existente, com último pedido elegível e acesso ao perfil. Funcionar por teclado e em largura móvel. Trocar de conversa ou perder acesso descarta a resposta anterior, inclusive se ela chegar atrasada.                                                                        |
| C20-05 | Aplicar ACL por recurso antes da paginação e agregação. Cobrir operador autorizado, outro vendedor, titular, supervisor designado, administrador geral, conta revogada e Financeiro. IDs, contadores, links, cursores, SSE e metadados seguem a mesma política.                                                                                      |
| C20-06 | Preservar o fluxo de encerramento manual previsto por CP-07 a CP-10. Encerrada sai da fila ativa, permanece no histórico autorizado e um novo inbound válido gera outro ciclo. Arquivar atua sobre a fila. Reentregar o evento antigo mantém a mensagem no ciclo original.                                                                           |

## Escopo do piloto com duas linhas

| ID     | Requisito e critério verificável                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C20-07 | Primeiro ingresso elegível com evidência aprovada pode reutilizar um Contato canônico. Duas linhas elegíveis recebendo simultaneamente o mesmo número confirmado convergem para um Contato e dois ciclos, cada qual no seu escopo. Vínculos confirmados anteriores têm precedência.                   |
| C20-08 | Número digitado, não verificável, em disputa, reciclado ou com origem de linha inválida segue fluxo compatível e revisão quando aplicável. Vincular, revogar ou corrigir o vínculo exige autorização, versão, motivo e auditoria. Correções preservam IDs, fichas confirmadas e origem das mensagens. |
| C20-09 | Cada ciclo mantém a política de automação e atribuição da sua linha. Saída pelo aparelho, eco, retry e primeiro envio do vendedor mantêm suas semânticas e idempotência. Pós-venda usa Assunto com alvo autorizado do mesmo Contato.                                                                  |
| C20-10 | Inventariar e reconciliar Contatos, vínculos, ciclos, mensagens, Pedidos e carteiras antes e depois. Toda diferença tem causa rastreável. Histórico legado preserva as fronteiras comprovadas. Lotes têm retomada, auditoria, reversão e aceitação humana.                                            |
| C20-11 | O aviso de simultaneidade segue a política aprovada. Sem visibilidade da outra conversa, o estado e a resposta devem ser equivalentes aos de um cliente sem aquela conversa, salvo uma projeção neutra expressamente aprovada.                                                                        |
| C20-12 | Ensaiar carga, retries, rollback, restore e promoção com escopo definido. Flag desabilitada conserva o comportamento baseline. Pausar o piloto bloqueia novas associações automáticas e conserva eventos externos confirmados e resultados incertos.                                                  |

## Evoluções sujeitas a decisão

**C20-13.** Uma sugestão interna de encerramento pode ser avaliada após D05.
Ela identifica o pedido e a pendência pelos contratos atuais, com acesso
derivado da conversa. O vendedor continua responsável pelo comando de fechar.
Fechamento automático, vínculo da loja, valor recebido líquido, contexto
ampliado para IA, novos canais, segmentação, campanhas e relatórios avançados
ganham critérios e aprovação próprios.

## Cenários de aceite

1. Uma vendedora abre o perfil de um Contato com dois Pedidos visíveis
   confirmados de R$ 100 e R$ 200, um mesmo Pedido com múltiplos Assuntos no
   histórico e um cancelado. Vê duas vendas, R$ 300 e ticket de R$ 150.
2. O supervisor designado consulta dois ciclos permitidos de um Contato.
   Uma vendedora vinculada a apenas uma linha vê somente o ciclo permitido.
   Após transferência na linha geral ou revogação do vínculo, uma requisição
   em curso e o replay da sessão respeitam a nova autorização.
3. O cliente escreve após um encerramento. O novo inbound cria outro ciclo.
   Replay do inbound antigo o encontra no primeiro ciclo, sem somar mensagens
   ou reativar a automação.
4. As duas linhas elegíveis recebem o mesmo telefone confirmado em paralelo.
   Há um Contato e dois ciclos. Repetir com uma colisão declarada ou número
   reciclado preserva os vínculos anteriores e encaminha o caso para revisão.
5. O processo interrompe um lote após um commit. Retomar apresenta os mesmos
   vínculos e relatórios de contagem. Desligar a escrita e reverter um vínculo
   autorizado preserva mensagens, Pedidos e snapshots.

A [matriz de validação](validation.md) liga esses cenários aos gates do
[plano de tarefas](tasks.md).

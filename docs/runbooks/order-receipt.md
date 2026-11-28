# Recibo comercial do pedido

Contrato: [ADR 089](../adr/089-recibo-comercial-na-lista-e-no-pedido.md),
[spec RCP-01–12](../../.specs/features/order-receipt/spec.md).

## Uso e disponibilidade

Na lista de Pedidos, abra **Mais ações** na linha e escolha **Recibo**.
No detalhe, **Recibo do pedido** fica no cabeçalho. No modal, confira a
prévia e selecione **Baixar PDF**.
**Fechar** ou Escape devolve o foco ao acionador e conserva a lista e os
filtros. Se a linha saiu da lista, o foco retorna à busca; no detalhe, ao título.

O botão depende de `receiptAvailable === true` devolvido pela API. A autorização
é revalidada em cada leitura: humano ativo responsável ou `COMMERCIAL_ADMIN`;
pedido da loja e pedido sem responsável exigem Admin. Não há nova flag de
ativação, infraestrutura, configuração de segredo ou migração.

Pedido pendente/reaberto gera resumo provisório; confirmado mostra **Pedido
confirmado**; cancelado mostra **documento histórico**. Campo ausente continua
**Não informado**/**A definir**. O recibo não tem valor fiscal e não comprova
pagamento. A lista de Pedidos oferece **Gerar PDF** para a ficha de produção.
No detalhe de um pedido de atendimento confirmado, a ação principal baixa o
**PDF para impressão** e o menu **Mais ações do pedido** oferece o **PDF
detalhado**.

## Ficha para a produção

Em **PDF para impressão**, confira uma linha de controle por pedido e a
prévia logo abaixo. A imagem vem do arquivo **Arte final**. Para CorelDRAW
ou outro formato sem prévia, abra o original no capítulo **Arte**. Se a
ficha indicar falha de leitura, confira se o arquivo abre no pedido. Quando
só a conversão de PDFs falhar, verifique `pdftoppm -v` na imagem da API.

Valide com um pedido sintético de dois itens, uma imagem final e um rascunho.
Para PDF da arte, confira a primeira página na ficha e as seguintes nas
folhas de continuação. Use a correlação para diagnóstico, sem anexar a arte
a logs ou tickets. O rollback por PR é a reversão de FPI-T08.

## Gravações e atualização

Ao abrir no detalhe, o fluxo espera as gravações de seções iniciadas no blur,
inclusive as enfileiradas durante uma gravação lenta. Uma seção cuja gravação
falhou bloqueia a prévia até salvar novamente essa seção ou recarregar
explicitamente o pedido. Salvar outra seção não elimina o bloqueio.

A prévia usa JSON renderizado com escaping Vue, sem HTML/iframe remoto. Cada
download pede bytes novos com a versão e o fingerprint da prévia. Fechar,
desmontar, trocar alvo, perder acesso ou receber atualização relevante cancela
a operação e descarta dados/bytes tardios. Evento explicitamente associado a
outro pedido, contato ou conversa não invalida o documento aberto.

`GET /api/v1/orders/:id/receipt` devolve `{receipt, fingerprint}`.
`GET /api/v1/orders/:id/receipt/pdf?expectedVersion=N&fingerprint=HEX` devolve
`application/pdf`, privado e sem cache. O fingerprint HMAC usa chave efêmera;
reiniciar a API exige atualizar prévias que já estavam abertas. Não se deve
copiar o fingerprint para logs de suporte.

## Falhas e recuperação

| Situação                                | Conduta                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Falha de gravação                       | Corrigir ou tentar salvar novamente a seção indicada antes de abrir o recibo.                                |
| 409 `RECEIPT_STALE` ou evento relevante | A prévia é descartada; usar **Atualizar prévia** para conferir a fonte atual antes de baixar.                |
| 401/403/404                             | Conteúdo e download são removidos; fechar e atualizar os pedidos ou restaurar a sessão/acesso legítimo.      |
| 429                                     | Aguardar a janela de limite e repetir explicitamente. Limites das rotas: 30 prévias/minuto e 10 PDFs/minuto. |
| 503, rede ou resposta inválida          | **Tentar novamente** repete a leitura/geração; nenhum PDF anterior é reutilizado.                            |
| PDF não iniciou no dispositivo          | Conferir permissões de download do navegador e repetir explicitamente.                                       |

Para diagnóstico, usar status/código, correlação e revisão. Não registrar
nomes de cliente, textos do pedido, PDF, fingerprint ou dados pessoais em logs
ou tickets. A auditoria de sucesso `order.receipt.download` contém somente
ator, ação, pedido, revisão e correlação. HEAD, falha e geração rejeitada não
registram sucesso. O recibo não altera pagamento, posse, pedido ou primeira
impressão da ficha de produção.

## Verificação e reversão

Usar somente dados sintéticos. Executar os testes de documento, rotas e
cliente, depois o E2E dedicado `test/e2e/order-receipt.spec.js`. A regressão
local da UI inclui `orders-list.spec.js` e `orders.spec.js`; typecheck, lint e
design tokens devem passar. O fechamento da feature exige os gates completos
e revisão independente previstos na spec.

No teste manual, conferir lista e detalhe, Escape/Tab/retorno de foco, 320 e
390 px, tema escuro, autosave lento/falho, acesso revogado e prévia desatualizada.
Em PDF curto/longo, conferir linhas e totais, estado em todas as páginas e
rodapé final. Papel permanece branco e tabela tem texto escuro nos dois temas.

Se houver regressão, reverter a entrega atômica de UI/API pelo fluxo normal de
PR e release. Não há dados ou migração para desfazer; a ficha de produção não
depende das novas rotas. Validar o download existente da fábrica após a reversão.

# RFC 068 — Recibo comercial do pedido

Data: 12/11/2026. Status: **proposta em revisão**. Entrega: **RCP-P01**.
Pedido de produto: permitir que o vendedor baixe, dentro do pedido do cliente,
um recibo simplificado inspirado no talão apresentado pelo solicitante.

Esta entrega contém planejamento e protótipo. A autorização de implementar o
runtime e a decisão sobre documentos de pedidos pendentes continuam em revisão.
Não há ADR novo: após a decisão, vincular o ADR correspondente aqui, às regras
afetadas e à síntese técnica. Sem issue específica; PR vinculada no handoff.

## Objetivo e fluxo

Adicionar um único botão **Recibo do pedido** no cabeçalho do detalhe, sem
seção adicional de documentos ou outro ponto de entrada. O vendedor abre a prévia,
confere os dados salvos e escolhe **Baixar PDF**. Pode repetir o download sem
confirmar novamente, alterar o pedido ou produzir efeitos na integração.

O recibo apresenta um resumo comercial para o cliente. A referência visual
orienta a organização: marca e número no cabeçalho, cliente, quantidade,
descrição, unitário, subtotal e total; vendedor e previsão de entrega no fim.
Os nomes, o telefone, a numeração e a assinatura da fotografia não são dados
para fixtures nem evidência de pagamento. O protótipo usa dados fictícios.

O nome proposto na interface e no documento é **Recibo do pedido**, acompanhado
do texto **Sem valor fiscal. Este resumo não comprova pagamento.** Não há
declaração de recebimento, assinatura fabricada ou alteração de quitação.

## Contexto verificado

- O grafo em `graphify-out/2026-09-23/` aponta `OrderView.vue`, `order-service.js`,
  `order-routes.js` e o pipeline de impressão. Ele antecede a versão atual;
  as conclusões foram confirmadas nos arquivos após atualizar `origin/master`
  até `f536a58d`.
- `apps/edge-web/src/views/OrderView.vue` contém as ações de PDF, a versão do
  pedido e o acompanhamento das gravações. `OrderMoreActions.vue` concentra
  ações secundárias e já trata teclado e devolução de foco.
- `apps/edge-web/src/lib/order-pdf.js` oferece download por Blob e
  compartilhamento nativo do arquivo. O endpoint atual é
  `GET /api/v1/orders/:orderId/pdf`, autorizado por `order.print`.
- `apps/api/src/order-pdf.js` renderiza HTML privado com Chromium, sem JavaScript
  ou recursos externos, com concorrência limitada. Essa infraestrutura atende
  o recibo sem novo serviço ou dependência.
- A ficha atual da fábrica usa `ficha-canonical-v9`, por item, com duas folhas
  A4. As regras 10 e 13 de `RULES.md` exigem confirmação e completude para a
  ficha. Seu conteúdo financeiro tem guardas específicas; não se deve mudar
  esse template para produzir o documento comercial.
- `modules/orders/src/domain/order.js`, `freight.js`, `size-pricing.js` e
  `size-pricing-composition.js` definem total, frete e preços por tamanho.
  `apps/api/src/order-runtime.js` expõe os valores calculados e o frete.
  O recibo consome essas fontes oficiais, sem recalcular com ponto flutuante.

Referências: [RULES](../../RULES.md), [design](../../design.md),
[ORD-05/06](../../.specs/features/crm-mvp/spec.md),
[ADR 037 — PDF mobile](../adr/037-gerar-pdf-da-ficha-para-uso-mobile.md),
[ADR 080 — frete](../adr/080-valor-final-com-frete.md) e
[ADR 087 — ficha da fábrica](../adr/087-ficha-por-item-controle-no-verso.md).
RCP é um recorte novo; não marcar os requisitos anteriores como modificados
ou concluídos por este planejamento.

## Proposta de disponibilidade

Interpretar “a qualquer momento” como **a partir de um pedido salvo**, sem
exigir pagamento, cadastro fiscal completo, Olist ou preenchimento da ficha
da fábrica. Proposta a confirmar antes da implementação:

| Situação                     | Comportamento proposto                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Confirmado                   | Recibo com os dados comerciais oficiais da versão confirmada.                        |
| Pendente ou reaberto         | Resumo com destaque “Pedido pendente · resumo provisório, sujeito a alterações”.     |
| Dados parciais               | Exibir “Não informado” ou “A definir”; não transformar ausência em zero.             |
| Edição/gravação em andamento | Aguardar conclusão e reler; prévia só usa dados salvos, com explicação junto à ação. |
| Cancelado                    | Download histórico identificado “Pedido cancelado”; sem afirmação de venda vigente.  |
| Sem acesso ao pedido         | Não oferecer a ação; API recusa acesso direto e revalida a sessão.                   |

A versão provisória é uma capacidade nova. A ficha e seu endpoint continuam
restritos a pedidos confirmados. A aprovação dessa extensão deve ser registrada
em ADR e nas fontes canônicas antes do runtime; este protótipo não muda a regra 10.

## Conteúdo e precisão

- Marca oficial, título, número CRM, data do pedido e estado comercial.
- Cliente e nome do pedido quando presentes. Telefone não integra o recorte
  inicial; não é necessário ao resumo entregue ao próprio cliente.
- Itens com descrição curta (modelo, cor, tecido e aplicação), quantidade
  derivada da grade, tamanhos, unitário quando existente com precisão exata e
  subtotal. Sem desenhos, checklist da fábrica ou dados internos do atendimento.
- Agrupar tamanhos somente quando a composição comercial for equivalente e o
  unitário exato for o mesmo. Preços diferentes geram linhas distintas.
  Não inventar preço médio nem arredondar frações para fechar uma linha.
- Em legado/loja sem preços por linha, mostrar valores indisponíveis como
  “Não informado” e preservar o total oficial conhecido. Não exigir composição
  Olist nem ratear o total. A modalidade da loja usa seu adapter existente.
- Frete oficial separado do subtotal de peças quando aplicável, seguido do
  total único do pedido. Cotação de frete não vira valor contratado.
- Previsão de entrega, condição de pagamento registrada, vendedor, data de
  emissão e versão. Ausências permanecem explícitas; datas usam São Paulo.
- Sem saldo, recebimentos, comprovantes, QR de cobrança, dados fiscais,
  endereço, links internos, notas livres ou observações privadas nesta versão.

Formato proposto: A5 retrato, fundo branco, logotipo oficial e contraste de
impressão. Pedido curto cabe em uma página; pedidos longos usam continuação
com número/estado e cabeçalho da tabela repetidos, sem cortar linhas ou reduzir
texto para caber. O total e o rodapé ficam na última página.

## Requisitos e critérios de aceite propostos

| ID     | Critério observável                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCP-01 | WHEN o vendedor responsável ou Admin humano ativo abre um pedido autorizado THEN o sistema SHALL oferecer “Recibo do pedido” no próprio detalhe, inclusive no celular. Habilitação Olist e `order.print` isoladamente não ampliam esse acesso comercial. |
| RCP-02 | WHEN a prévia abre THEN o sistema SHALL apresentar somente dados salvos e sua revisão; voltar SHALL devolver foco à ação que abriu a prévia.                                                                                                             |
| RCP-03 | WHEN o pedido está pendente ou reaberto THEN o documento SHALL identificar o estado provisório na prévia e em todas as páginas do PDF, conforme a extensão de produto a aprovar.                                                                         |
| RCP-04 | WHEN dados opcionais ou preços estão ausentes THEN o documento SHALL indicar ausência sem inventar quantidade, preço, condição ou prazo; um total parcial SHALL NOT ser apresentado como total contratado.                                               |
| RCP-05 | WHEN há composição de preços e frete THEN linhas e total SHALL corresponder às fontes oficiais em centavos; preços distintos SHALL permanecer distintos, sem média ou rateio.                                                                            |
| RCP-06 | WHEN a pessoa baixa o recibo THEN a API SHALL retornar PDF privado com número, revisão e estado correspondentes à prévia, sem confirmar pedido, alterar pagamento ou registrar primeira impressão da ficha da loja.                                      |
| RCP-07 | WHEN o pedido ou os dados exibidos mudam após a prévia THEN a geração SHALL recusar a revisão obsoleta e solicitar atualização; bytes preparados para outro pedido ou revisão SHALL ser descartados.                                                     |
| RCP-08 | WHEN sessão, acesso ou posse não autorizam a leitura THEN a API SHALL recusar prévia/PDF inclusive por URL direta e sem entregar bytes; a interface SHALL informar a perda de acesso.                                                                    |
| RCP-09 | WHEN a geração está em andamento THEN a ação SHALL indicar carregamento e impedir cliques concorrentes; falha SHALL manter o pedido intacto e permitir nova tentativa explícita.                                                                         |
| RCP-10 | WHEN o documento é gerado THEN SHALL conter a ressalva fiscal e de pagamento, usar conteúdo escapado e não carregar recursos externos, PII em logs ou URL pública; download bem-sucedido SHALL ter auditoria mínima autorizada.                          |
| RCP-11 | WHEN a interface é usada de 320 px a desktop, por teclado ou leitor de tela THEN controles SHALL permanecer operáveis, sem sobreposição, com foco visível e mensagens anunciadas; PDF longo SHALL preservar todas as linhas e cabeçalhos.                |

## Contrato técnico proposto

Rotas novas, **ainda inexistentes**:

| Método e rota                             | Entrada                                                                                           | Saída                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/orders/:orderId/receipt`     | Sessão humana autenticada.                                                                        | Projeção mínima permitida: número, estado, revisão, emissão, cliente, linhas, frete, total, condição, previsão e vendedor; fingerprint opaco para conferir os dados efetivamente apresentados. |
| `GET /api/v1/orders/:orderId/receipt/pdf` | Revisão e fingerprint devolvidos pela prévia, tratados como conferência e nunca como autorização. | `application/pdf`, anexo `recibo-NN-CRM.pdf`; pendente usa sufixo `-provisorio`, cancelado usa `-cancelado`.                                                                                   |

Ambas as rotas usam `Cache-Control: private, no-store`, revalidam ACL comercial
no servidor e não aceitam HTML, cliente, preços ou total enviados pelo navegador.
Fingerprint gerado no servidor inclui todas as fontes exibidas, inclusive
identificação do cliente e nome do vendedor, para não ignorar alterações que
não incrementem a versão do pedido. Não expor esses valores na query string.

Erros: 401 (sessão), 403/404 conforme política vigente de ocultação, 409
(prévia obsoleta), 429 (limite de requisições) e 503 (render ocupado/falha).
Reutilizar o formato de erro vigente. Não compartilhar a autorização ampla
de `order.print` por conveniência. Download não usa a operação
`markFichaPrinted`, não elimina aviso do Dashboard e não muda status ou posse.

O PDF é gerado no runtime atual, com limite de concorrência/rate limit, sem
persistência de arquivos por padrão. Nova auditoria usa apenas ator, pedido,
revisão e tipo de documento; não inclui nomes, preços, telefone ou conteúdo.
Nenhuma migração é prevista; confirmar a capacidade do catálogo de auditoria
e a política de autorização em RCP-T01.

## Arquivos e tarefas de implementação futura

| Tarefa  | Fronteira e arquivos                                                                                                                                                                                                                                                                                                                          | Evidência / gate                                                                                                                                                         | Estado                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| RCP-P01 | Esta RFC e `docs/prototypes/order-receipt/index.html`.                                                                                                                                                                                                                                                                                        | Prévia, retorno ao pedido, três PDFs sintéticos, erro/retry, teclado, responsividade e leitura visual do PDF.                                                            | Entregue como protótipo. |
| RCP-T01 | Fechar decisão de pendentes/cancelados, ACL e conteúdo; criar ADR e atualizar RULES, spec e sínteses pertinentes.                                                                                                                                                                                                                             | Aprovação explícita do contrato e matriz de acesso; nenhum runtime nesta tarefa.                                                                                         | Proposta.                |
| RCP-T02 | Projetor e template novos em `modules/orders/src/print/`; exportação em `modules/orders/src/index.js`; rotas em `apps/api/src/order-routes.js`, política em `modules/orders/src/application/order-service.js` e registro de autorização em `apps/api/src/identity-runtime.js`, conforme contrato fechado. Reusar `apps/api/src/order-pdf.js`. | Testes de ACL/IDOR, pendente, cancelado, loja/legado, centavos/frete, revisão obsoleta, auditoria, escaping e render sem rede; regressão de primeira impressão.          | Depende de T01.          |
| RCP-T03 | `OrderView.vue`, `OrderMoreActions.vue`, novo `OrderReceiptPreview.vue` e cliente específico em `apps/edge-web/src/lib/`; usar `tokens.css` e marca canônicos.                                                                                                                                                                                | E2E do detalhe até download, autosave em andamento, troca de pedido, erro/retry, foco, 320/390 px e temas claro/escuro; sem substituir a ação da ficha da fábrica.       | Depende de T02.          |
| RCP-T04 | Fixtures sintéticas e testes em `test/`/`test/e2e/`; documentação operacional.                                                                                                                                                                                                                                                                | Pedidos longos, texto extenso e unitários fracionários; `git diff --check`, checks completos do projeto e aceite visual do PO. Registrar limite e rollback da ação nova. | Depende de T03.          |

RCP-P01 não comprova os requisitos de API RCP-06–08/10 nem geração dinâmica.
O protótipo contém PDFs pré-gerados para os três cenários; o cenário de falha
simula erro na primeira tentativa e sucesso ao repetir. Não há acesso ao CRM,
envio ao WhatsApp ou uso de dados reais. O total sintético é 200 × R$ 29,00 =
R$ 5.800,00, retirada na loja sem frete.

## Pontos para validação do produto

Recomendação inicial: manter o nome pedido pelo solicitante, permitir o resumo
provisório antes da confirmação e dispensar telefone. Confirmar esses pontos
ao revisar o protótipo; o recorte pode ser reduzido a confirmados sem alterar
o fluxo visual. Compartilhamento nativo é evolução possível, reaproveitando o
arquivo, depois do aceite do fluxo de download. Envio automático e recibo de
pagamento ficam fora desta proposta.

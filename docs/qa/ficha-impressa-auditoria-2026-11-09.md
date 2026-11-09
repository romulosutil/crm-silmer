# Auditoria medida da ficha impressa — 09/11/2026

## Resultado

No CRM de desenvolvimento da Mel, a ficha de atendimento v6 preservou os
134 valores rastreados previstos para impressão. Nenhum desses valores se
perdeu entre HTML e PDF. As instruções que ficam somente nos dados do
atendimento não chegam ao papel; a ficha da loja também omite a observação
que contém CEP e orientação de envio. Essas ausências são diferentes de
corte de texto na conversão para PDF.

Rastreabilidade: PIM-02/06–09/12–14, PFI-05/08, TEC-05/07, PUB-07,
LOJ-21/36/38; tarefas existentes T100 e T134. A análise de evolução considera
OLIST-49/50 e OLIST-T25, COB-09 e COB-DEL-01/COB-OPS-01. Esta auditoria
não altera contratos nem implementa uma ficha nova.

## Ambiente e método

- Acesso solicitado pelo proprietário: `ssh mel`.
- Checkout executado: `/home/romulo-sutil-corr-a/crm-silmer`, branch `master`,
  commit `5bc36118f6e0d1a96a6e04301484ab778fcf61b8`, de 05/11/2026.
- Interface local: `127.0.0.1:4173`; API: `127.0.0.1:3002`.
- PostgreSQL dedicado: `127.0.0.1:5436/crm_silmer`; `APP_ENV=development` e
  `N8N_INTEGRATION_ENABLED=false`. Nenhuma configuração foi alterada.
- Artefatos de atendimento gerados em 09/11/2026, às 11h40, horário de
  São Paulo. O HTML e o PDF vieram das rotas autenticadas reais `/print`
  e `/pdf`, ambas com HTTP 200; não são reconstruções locais do template.
- Texto extraído com Poppler `pdftotext -layout`; todas as seis páginas de
  atendimento e a página da loja renderizadas com `pdftoppm` e inspecionadas.
  Quantidades, posições e fontes medidas adicionalmente com `pdfplumber`.
- Grafo de 04/10 usado somente como mapa; fontes atuais conferidas com
  `rg` e leitura direta, inclusive no checkout remoto. Grafo não atualizado.

As falhas preexistentes do diagnóstico geral da Mel permaneceram iguais:
contagem esperada de containers, alerta de idade do backup do cofre,
contagem de linhas do Tailscale e sujeira do checkout SquadOne. Central,
n8n, Hermes e serviços consultados mantiveram os mesmos estados antes/depois.
Nenhum serviço foi reiniciado ou reconfigurado.

## Amostras persistidas

### Atendimento `01-CRM`

ID `80b5c616-802f-4de2-a1e2-fe10c999e5b2`, versão 9, confirmado. Contato
sintético identificado como **NÃO PRODUZIR**, cadastro completo, oito itens,
quatro públicos, 97 peças, 31 linhas de grade, dois tecidos por item, todos
os adicionais com marcadores diferentes, quantidade informada divergente,
duas origens de arte marcadas, cinco observações e seis anexos registrados
pela API: cinco referências e uma arte final. Valor sintético R$ 9.876,54 e
condição `cartao_credito`. Datas declaradas sinteticamente; nenhum pagamento
ou entrega real ocorreu.

Contato, cadastro, pedido, itens, observações, origem da arte, anexos,
confirmação e datas foram preenchidos pelas APIs locais. Os 11 dados do
atendimento foram inseridos como fixture somente nesse pedido novo, ainda
pendente, por `PostgresOrderRepository.projectBriefing`, com versão e evento
do repositório real. Há guarda de ID/contato/nome sintético. Isso foi
necessário porque não existe seção humana para editar `serviceData`.
Não houve SQL manual de `UPDATE` nem execução do bot/n8n.

Adicionar campos próprios `manga` e `notes` aos itens foi tentado na API:
ambos retornaram HTTP 400, `ORDER_INVALID`. O pedido não oferece esses
campos independentes no contrato atual. A ficha continuou sendo preenchida
com os campos efetivamente suportados.

### Loja `02-CRM`

ID `bbc54ea0-e2a5-474d-9197-817f1ca9f92f`, `isTest=true`. Produto do catálogo,
10 peças, CEP opcional, NSU, slug e comprovante inteiramente sintéticos.
Registro pelo `createStoreOrderService.record` real, no mesmo banco de
desenvolvimento; impressão e PDF pelas rotas HTTP reais. Não houve webhook
nem chamada à InfinitePay. O texto impresso de confirmação do Pix decorre
da fixture, não comprova transação externa.

## Medições

| Verificação                                | Resultado                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Valores rastreados no atendimento          | 177: 134 presentes no HTML/PDF e 43 ausentes nos dois                               |
| Itens                                      | 8/8; o primeiro foi dividido em duas partes identificadas                           |
| Tamanhos e quantidades                     | 31/31 pares conferidos no PDF, por posição do número abaixo do tamanho              |
| Cor da manga direita/esquerda              | 16/16 valores presentes                                                             |
| Viés das mangas                            | 8/8 valores presentes                                                               |
| Observações do pedido                      | 5/5 presentes, na última página comercial                                           |
| Produção                                   | 14 campos presentes e vazios                                                        |
| Páginas de atendimento                     | 6: cinco comerciais e uma de produção                                               |
| Cabeçalhos                                 | Número do pedido em todas as páginas comerciais                                     |
| Perda de valores rastreados entre HTML/PDF | Zero                                                                                |
| Texto fora dos limites físicos da página   | Zero caracteres na amostra, pelas coordenadas do PDF                                |
| Fonte de adicionais                        | Rótulos 5,25 pt; valores 7,5 pt                                                     |
| Fonte das observações                      | Aproximadamente 7,12 pt                                                             |
| Loja                                       | PDF de uma página; produto, tamanho, quantidade, Pix, valor e comprovante presentes |

Os 177 são **valores/marcadores rastreados**, não o total de campos do
pedido. Público, quantidade informada, quantidades da grade, datas, FAB,
vendedor e origem da arte têm verificações separadas. Primeiro contato,
Data do pedido, Pago em e Entregue em ficaram em 09/11; entrega prometida
foi 20/11. Esta amostra prova presença, não diferencia uma eventual troca
de origem entre as quatro datas iguais. Uploads e metadados dos seis anexos foram
confirmados; a auditoria não executou download para validar seus bytes.

## Informações preenchidas que não chegaram ao papel

| Informação                                 | Quantidade rastreada ausente | Interpretação                                                                                                       |
| ------------------------------------------ | ---------------------------: | ------------------------------------------------------------------------------------------------------------------- |
| `items[].modelo`                           |                            8 | Exclusão prevista desde REV-01/ADR 019; dado legado continua armazenado.                                            |
| `items[].vies_gola`, com `gola` preenchida |                            8 | O papel usa `gola`; o viés legado só é fallback, não um adicional separado.                                         |
| `serviceData`                              |                           11 | Exclusão prevista por PFI-08, com risco operacional para instruções de produção.                                    |
| Valor e condição do atendimento            |                            2 | Obrigatórios para confirmar, excluídos do papel por PIM-02/09.                                                      |
| Valores selecionados do cadastro           |                            8 | Razão social, documento, Instagram, cidade, rua, bairro, número e complemento não integram o snapshot de impressão. |
| Nomes dos arquivos de arte                 |                            6 | Referências/arte final não são incorporadas ou relacionadas no papel.                                               |

Essas 43 ausências não equivalem a 43 defeitos. Parte é exclusão expressa do
contrato. A reclamação operacional pode existir mesmo quando o contrato
atual está sendo cumprido.

### Manga, opcionais e notas

- **Cores e viés das mangas:** presentes em todos os itens. Estampa de
  referência e cores de frente/costas também chegaram ao PDF. Os adicionais
  não estavam cortados na inspeção visual desta amostra.
- **Tipo de manga:** `CAMISETA DE MANGA LONGA I01TIPO` impresso como tipo de
  roupa; `MANGA RAGLAN I01MODELO` salvo em modelo e ausente. Não existe campo
  próprio `manga`, conforme a recusa HTTP 400 medida.
- **Notas:** a observação `OBS0911LINHA1` saiu. A anotação do atendimento
  `NOTAS0911ATENDIMENTO - Fazer manga curta e nao longa; nao produzir.`
  ficou salva e não saiu. Não há promoção automática de notas para as
  observações da ficha. A divergência proposital da fixture demonstra que o
  papel pode mostrar manga longa enquanto uma instrução diferente permanece
  somente no atendimento; não é prova de extração ou revisão pelo bot.
- Os demais dados do atendimento ausentes foram personalizações, numeração,
  patrocinadores, endereço, modalidade de entrega, prazo desejado, perfil,
  finalidade, cidade/CEP e modelo informado.
- **Legibilidade:** mesmo presentes, os adicionais usam rótulos de 5,25 pt e
  valores de 7,5 pt. Isso merece revisão física; presença e coordenadas não
  comprovam leitura confortável numa impressora.

### Observações da loja

O pedido `02-CRM` persistiu:

> Dados de envio — CEP: 69301-000. Entrar em contato para pegar as informações de entrega.

O CEP e a orientação não aparecem no HTML nem no PDF da loja. O renderizador
simplificado não lê `ficha.observations`. É uma lacuna operacional comprovada;
LOJ-36 não manda imprimi-los explicitamente. A decisão de simplificação é
anterior à inclusão do CEP no contrato de entrada: não atribuir ao PO uma
decisão explícita de excluir esse novo dado.

## Olist e InfinitePay: preparação para a próxima versão

A implantação da Mel examinada **ainda não contém** os arquivos de cobranças
InfinitePay nem `size-pricing`/Olist presentes no checkout deste chat.
`GET /api/v1/orders/{id}/billing` retornou 404. Nenhuma flag foi ligada para
forçar o teste; o resultado descreve essa implantação, não a produção.

No checkout `d3c0fadb`, os testes selecionados de ficha v6, domínio de preços
por tamanho e domínio/rotas de cobrança passaram: 24/24, zero skips. Isso
não é prova de implantação nem de integração com provedores.

| Frente                                                    | Estado e impacto sobre a ficha                                                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Olist: subtotais por tamanho, IDs e revisão de quantidade | Núcleo de domínio entregue; persistência/API/UI e vínculo com a grade ainda pendentes em T20/T21. Não preencher um campo inexistente remotamente como se estivesse entregue.                   |
| Olist: rótulos                                            | OLIST-49/50 e T25 exigem futura v7: **Aplicação** por item e **Previsão de entrega**. A Mel ainda imprime **Técnica** e **Entrega prometida** na v6.                                           |
| Olist: dinheiro na impressão                              | A emenda aprovada não acrescenta preços implicitamente ao papel. Não confundir subtotal necessário à exportação com requisito de impressão.                                                    |
| Cadastro para Olist                                       | O cadastro sintético completo foi salvo; seus dados fiscais/endereço não saem na ficha atual. Completude de exportação exige seu contrato próprio.                                             |
| InfinitePay: plano, cobranças, recebido e saldo           | Código local entregue, operação real em COB-OPS-01 pendente. A implantação testada não expõe a rota. Nenhuma cobrança foi criada externamente nesta auditoria.                                 |
| InfinitePay: “Pago em”                                    | COB-09 exige quitação integral conciliada; sinal não preenche essa data. A amostra v6 testa somente a data declarada sinteticamente pelo fluxo manual existente.                               |
| InfinitePay: informação no papel                          | O contrato atual não acrescenta plano, percentual de entrada, saldo, link de checkout, parcelas ou comprovante à ficha de atendimento. O comprovante da loja já aparece em seu modelo próprio. |

Referências de evolução: [emenda vigente de Pedidos](../../.specs/features/pedidos-mvp/spec.md),
[progresso Olist](../integrations/olist/implementation-progress.md),
[RFC 050](../rfc/050-geracao-assistida-de-pedidos-no-olist.md),
[contrato de cobranças](../../.specs/features/order-billing/spec.md) e
[gates de cobranças](../../.specs/features/order-billing/tasks.md).

## Evidências e limites

- [PDF do atendimento](../../output/pdf/auditoria-ficha-2026-11-09/atendimento.pdf)
  e [PDF da loja](../../output/pdf/auditoria-ficha-2026-11-09/loja.pdf).
- [Matriz de 177 valores](../../output/pdf/auditoria-ficha-2026-11-09/campos.csv),
  [medição e respostas negativas](../../output/pdf/auditoria-ficha-2026-11-09/medicao.json)
  e [pares de grade/fontes/coordenadas](../../output/pdf/auditoria-ficha-2026-11-09/pdf-metrics.json).
- [Pedido salvo](../../output/pdf/auditoria-ficha-2026-11-09/order-saved.json),
  [cadastro salvo](../../output/pdf/auditoria-ficha-2026-11-09/contact-saved.json),
  [anexos registrados](../../output/pdf/auditoria-ficha-2026-11-09/files-saved.json)
  e [requisições/hashes](../../output/pdf/auditoria-ficha-2026-11-09/manifest.json).
- HTML, texto extraído e fixture da loja acompanham os PDFs. Não foram
  guardados cookies, credenciais, chaves ou dados de clientes reais.

A amostra ficou disponível no banco dedicado para revisão. Não houve
alteração de template, deploy, workflow, chamada Olist/InfinitePay ou teste
em impressora física. A ausência de cortes foi conferida nesta amostra;
não é garantia para qualquer combinação de textos nos limites máximos.
A decisão sobre incluir notas, manga estruturada, CEP, arte ou informação
financeira exige contrato explícito e nova versão de ficha, preservando as
versões aprovadas por hash.

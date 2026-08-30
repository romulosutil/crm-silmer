# Campos da Ficha e Jornada Conversacional — P0.1

> **Data:** 29/08/2026  
> **Status:** aprovado como contrato de produto do P0.1  
> **Fontes:** `ficha_exemplo.xlsx`, `PRODUCT-READINESS-TECH-LEAD.md` e `CRM-MVP-ESPECIFICACAO.md`  
> **Decisão:** as etapas definitivas são Backlog, Produto, Especificação, Estampa, Logística e Fechamento.

Este documento transforma a planilha de exemplo em um contrato de dados e em
uma jornada conversacional testável. Ele separa o que o cliente informa, o que
o CRM calcula, o que a operação comercial confirma e o que só é preenchido no
chão de fábrica.

## 1. Leitura técnica do arquivo

- Pasta de trabalho: `ficha_exemplo.xlsx`.
- Planilha: `OS Silmer 2013`.
- Área utilizada: `A1:O39`.
- A ficha possui uma linha de cabeçalho do pedido, até 21 linhas para itens e
  grade (`7:27`), cinco linhas de observação (`31:35`) e campos posteriores de
  produção (`36:39`).
- O total de peças em `K28` é calculado por `SUM(K7:K27)` e não deve ser
  digitado novamente.
- As células auxiliares `L3` e `L17` não possuem rótulo. Elas não entram no
  contrato até a operação explicar seu significado; o CRM não deve inventar
  campos para elas.
- As colunas ocultas `M` e `N` estão vazias e não contêm campos de negócio.

### Vocabulário de preenchimento

Cada campo aplicável possui um destes estados:

| Estado | Significado | Permite avançar? |
|---|---|---|
| `preenchido` | Valor válido e confirmado | Sim |
| `nao_aplicavel` | Exceção prevista, com motivo registrado | Sim |
| `pendente` | Falta resposta ou decisão | Não, se o campo for obrigatório na passagem |
| `divergente` | Valores se contradizem ou falham na validação | Não |

“Não sei”, “talvez” e “a definir” são respostas válidas na conversa, mas
viram `pendente`. O Vendedor Silmer pode continuar coletando outros dados, sem
avançar o card até a pendência ser resolvida por cliente ou pessoa autorizada.

## 2. Inventário completo dos campos da planilha

### 2.1 Identificação do pedido

| ID canônico | Rótulo original | Célula/intervalo | Origem | Obrigatório para gerar a Ficha | Regra |
|---|---|---|---|---|---|
| `pedido.numero` | `PEDIDO N°` | `B2` | Sistema | Sim | Sequência global do namespace próprio: começa em `01-CRM`, usa sufixo `-CRM`, não reinicia e não depende de número legado. |
| `pedido.fab` | `FAB` | `C2` | Configuração/operação | Sim | Código controlado da unidade fabril; no piloto, valor fixo `01`, exibido como `FAB 01`. |
| `pedido.vendedor` | `Vendedor:` | `F2:G2` | CRM/operação | Sim | Usuário responsável no momento do fechamento. |
| `pedido.data` | `Data do Pedido:` | `J2:K2` | Sistema | Sim | Data da geração da versão aprovada. |
| `pedido.nome` | `Nome` | `C3:G3` | Cliente/operação | Sim | Nome do evento, grupo ou referência reconhecível do pedido. |
| `pedido.data_entrega_confirmada` | `Data da Entrega` | `J3:K3` | Operação | Sim | Data confirmada, nunca apenas o desejo inicial do cliente. |
| `pedido.cliente` | `Cliente` | `C4:G4` | Cliente/CRM | Sim | Pessoa ou organização que contrata o pedido. |
| `pedido.aplicacao` | `Aplicação:` | `J4:K4` | Qualificação/operação | Sim | Técnica final, por exemplo `SUBLIMAÇÃO TOTAL`; `SEM APLICAÇÃO` é valor explícito. |

### 2.2 Itens, partes da peça e grade

Os campos abaixo se repetem nas linhas `7:27`. O CRM deve modelá-los como
itens e linhas de grade, não como posições fixas da planilha.

| ID canônico | Rótulo original | Coluna | Origem | Obrigatoriedade | Regra |
|---|---|---|---|---|---|
| `itens[].tipo` | `Ítem` | `A` | Cliente/operação | Obrigatório por item | Tipo de peça. |
| `itens[].modelo` | `Modelo` | `B` | Cliente/operação | Obrigatório por item | Modelo confirmado a partir do catálogo ou decisão assistida. |
| `itens[].malhas[]` | `Malha` | `C` | Cliente/operação | Obrigatório por item | Aceita mais de uma especificação, como ocorre nas linhas `C7:C8`. |
| `itens[].cor_frente` | `Frente` | `D` | Cliente/operação | Obrigatório ou `nao_aplicavel` | Cor/material da frente da peça. |
| `itens[].cor_costas` | `Costa` | `E` | Cliente/operação | Obrigatório ou `nao_aplicavel` | Nome canônico usa “costas”; a exportação preserva o rótulo legado. |
| `itens[].cor_manga_direita` | `Manga Direita` | `F` | Cliente/operação | Obrigatório ou `nao_aplicavel` | Não inferir que as duas mangas são iguais. |
| `itens[].cor_manga_esquerda` | `Manga Esq` | `G` | Cliente/operação | Obrigatório ou `nao_aplicavel` | Não inferir que as duas mangas são iguais. |
| `itens[].vies_gola` | `VIÉS Gola` | `H` | Cliente/operação | Obrigatório ou `nao_aplicavel` | Pode conter tipo e cor; o exemplo usa `OLIMPICA` e `VERDE`. |
| `itens[].vies_mangas` | `Viés Mangas` | `I` | Cliente/operação | Obrigatório ou `nao_aplicavel` | Registrar acabamento e cor quando houver. |
| `itens[].grade[].tamanho` | `TAM` | `J` | Cliente/operação | Obrigatório por linha de grade | Valor do catálogo ou tamanho especial preservado como informado. |
| `itens[].grade[].quantidade` | `Qtd.` | `K` | Cliente/operação | Obrigatório por linha de grade | Inteiro maior que zero. |
| `pedido.quantidade_total` | `Total` | `K28` | Sistema | Sim | Soma das quantidades da grade de todos os itens. |

Validações obrigatórias:

1. Cada item possui ao menos uma linha de grade.
2. Não existem tamanhos repetidos no mesmo item sem justificativa explícita.
3. A soma da grade é igual à quantidade total confirmada.
4. Item, modelo e malha nunca são recuperados apenas de texto livre no momento
   da emissão: precisam estar estruturados.

### 2.3 Observações do pedido

| ID canônico | Rótulo original | Célula/intervalo | Origem | Obrigatoriedade | Regra |
|---|---|---|---|---|---|
| `pedido.observacoes[]` | `Observações:` linhas 1–5 | `B31:K35` | Cliente/operação | Condicional | Lista ordenada de instruções que não cabem nos campos estruturados. Não substitui um campo obrigatório. |

### 2.4 Campos posteriores de produção

Estes campos fazem parte do arquivo lido, mas não são perguntas da jornada
comercial e não bloqueiam a criação do pedido. Eles começam vazios na Ficha e
são preenchidos por pessoas da produção. No primeiro MVP, o CRM apenas os
preserva no documento.

| ID canônico | Rótulo original | Célula/intervalo | Responsável | Momento |
|---|---|---|---|---|
| `producao.conferido_arremate_por` | `Conferido para arrematar por:` | `D36` | Produção | Conferência para arremate |
| `producao.conferido_arremate_em` | `Data:` | `F36` | Produção | Conferência para arremate |
| `producao.arrematado_por` | `Arrematado:` | `H36:I36` | Produção | Arremate |
| `producao.arrematado_em` | `Data:` | `K36` | Produção | Arremate |
| `producao.observacao_arremate` | `OBS:` | `A37:E37` | Produção | Arremate |
| `producao.conferido_embalado_por` | `Conferido / Embalado por:` | `H37:I37` | Produção | Embalagem |
| `producao.conferido_embalado_em` | `Data:` | `K37` | Produção | Embalagem |
| `producao.cores_frente` | `Cores Frente:` | `C38` | Produção/arte | Separação de cores |
| `producao.cores_costas` | `Costas:` | `E38` | Produção/arte | Separação de cores |
| `producao.cores_manga_direita` | `Manga Direita:` | `G38` | Produção/arte | Separação de cores |
| `producao.cores_manga_esquerda` | `Manga Esq:` | `I38` | Produção/arte | Separação de cores |
| `producao.total_cores_partes` | `Total:` | `K38` | Produção/arte | Soma das cores por parte |
| `producao.observacao_cores` | `OBS:` | `A39:G39` | Produção/arte | Separação de cores |
| `producao.quantidade_total_cores` | `Qtd total de cores do pedido:` | `K39` | Produção/arte | Total final validado |

## 3. Campos necessários no CRM que não existem na planilha

Eles não alteram o layout da Ficha, mas tornam a conversa, a negociação, o PIX
e a auditoria executáveis.

| Grupo | Campos mínimos |
|---|---|
| Contato | `contato.nome`, `contato.whatsapp`, `contato.id_externo`, `canal` |
| Qualificação | `intencao_comercial`, `arte.status`, `arte.arquivos[]`, `estampa.locais[]`, `finalidade`, `perfil_compra` |
| Logística | `prazo_desejado`, `modalidade_entrega`, `cidade`, `endereco` quando entrega, `retirada_local` quando retirada |
| Negociação | `orcamento.versao`, `valor_proposto`, `valor_final`, `condicao`, `validade`, `aprovado_por`, `aprovado_em`, `motivo_perda` |
| PIX | `pagamento.status`, `pagamento.valor`, `pix.chave_id`, `pix.chave_mascarada`, `pix.enviado_em`, `pix.mensagem_id`, `comprovante`, `confirmado_por`, `confirmado_em` |
| Boas-vindas | `onboarding.template_versao`, `onboarding.enviado_em`, `onboarding.mensagem_id`, `onboarding.status` |
| Auditoria | autor, origem, valor anterior, valor novo, timestamp e motivo de cada alteração |

## 4. Jornada definitiva e critérios de passagem

Backlog é um estado da Caixa de Entrada; não é coluna do Kanban. Ao reconhecer
uma oportunidade, o CRM cria o negócio diretamente em **Produto**. As colunas
do Kanban do MVP são **Produto**, **Especificação**, **Estampa**, **Logística** e
**Fechamento**.

| Etapa | Objetivo | Campos obrigatórios para sair | Próximo estado |
|---|---|---|---|
| **1. Backlog — Caixa de Entrada** | Receber, acolher e decidir se existe oportunidade | Contato vinculado; WhatsApp/canal; `pedido.cliente`; `pedido.nome`; intenção comercial `sim` | Cria um único negócio em **Produto** |
| **2. Produto** | Definir a peça e o volume inicial | Para cada item: tipo, modelo e quantidade estimada maior que zero | **Especificação** |
| **3. Especificação** | Fechar construção, cores e grade | Para cada item: malha; frente, costas, mangas e viés preenchidos ou `nao_aplicavel`; grade exata; soma da grade igual ao total | **Estampa** |
| **4. Estampa** | Fechar arte, técnica e locais | Situação da arte; arquivo ou responsabilidade de criação; técnica/aplicação; locais; campos de cor de estampa aplicáveis ou `nao_aplicavel` | **Logística** |
| **5. Logística** | Entender data, uso, perfil e entrega | Prazo desejado; finalidade; perfil de compra; entrega ou retirada; endereço/cidade ou local de retirada conforme escolha | **Fechamento** |
| **6. Fechamento** | Orçar, negociar e obter decisão | Resumo confirmado; orçamento versionado; valor final; condição; vendedor; data de entrega confirmada; decisão `aprovado` ou `perdido` | Pedido + PIX, ou **Perdido** |

### Regras transversais da máquina de estados

1. O agente pergunta apenas o próximo dado obrigatório que ainda falta; pode
   agrupar no máximo três perguntas naturalmente relacionadas.
2. Informação espontânea é extraída e confirmada sem repetir a pergunta.
3. Resposta ambígua gera uma pergunta de desambiguação, não uma escolha
   silenciosa do agente.
4. `pendente` e `divergente` impedem passagem; `nao_aplicavel` exige motivo.
5. Em pedidos com vários itens, todos os itens precisam cumprir o gate.
6. Correção que invalida uma etapa anterior move o card de volta para a
   primeira etapa incompleta, preservando histórico.
7. O negócio pode virar `Perdido` em qualquer etapa, com motivo. Conversa sem
   intenção comercial encerra no Backlog como `Sem lead`, nunca como perdida.
8. Preço, prazo confirmado, disponibilidade e política comercial não são
   inventados. Uma pessoa autorizada registra e aprova o orçamento; o Vendedor
   Silmer pode apenas comunicar a versão aprovada, vigente e imutável.

## 5. Roteiro conversacional por etapa

As frases são exemplos de intenção e podem variar. O contrato está nos campos
e gates, não em texto fixo.

### 5.1 Backlog — acolhimento e conversão

Mensagem inicial:

> Oi! Sou o assistente da Silmer e vou organizar seu pedido para o time. Para
> começar, qual nome devo usar para o cliente e como podemos identificar este
> pedido — por exemplo, nome do evento, empresa ou grupo?

Em seguida, confirmar intenção: “Você quer solicitar um orçamento para esse
pedido?” Se a resposta for positiva, criar o negócio idempotentemente. O nome
e o número do WhatsApp já conhecidos pelo canal não devem ser perguntados de
novo; basta confirmar quando houver conflito.

### 5.2 Produto

Perguntas-base:

1. “Que peça você precisa e qual modelo imagina?”
2. “Quantas peças serão, aproximadamente?”

Se o cliente não souber o modelo, o agente oferece somente opções presentes no
catálogo autorizado. Sem catálogo ou correspondência segura, registra a
pendência e transfere para decisão assistida.

### 5.3 Especificação

Perguntas-base:

1. “Qual malha ou tecido você prefere?”
2. “A peça terá a mesma cor na frente, costas e mangas? Se não, me diga a cor
   de cada parte e dos viéses de gola e manga.”
3. “Como fica a quantidade por tamanho? Ex.: P 10, M 20 e G 15.”

O agente lê a grade de uma única mensagem, apresenta a soma e pede confirmação
quando ela divergir da quantidade informada em Produto.

### 5.4 Estampa

Perguntas-base:

1. “A arte está pronta, será enviada depois ou precisa ser criada pela Silmer?”
2. “Qual técnica será usada?”
3. “Em quais partes da peça haverá aplicação?”

Arquivo recebido deve ser associado ao item e ao local correto. Se não houver
estampa, registrar `SEM APLICAÇÃO` e marcar arte, locais e cores como
`nao_aplicavel`; não deixar campos silenciosamente vazios.

### 5.5 Logística

Perguntas-base:

1. “Para quando você gostaria do pedido? Essa é uma data desejada; o time ainda
   vai confirmar a viabilidade.”
2. “É para evento, uniforme, revenda ou outra finalidade?”
3. “É compra para revenda/atacado ou uso próprio?”
4. “Prefere entrega ou retirada?”

Entrega exige cidade e endereço; retirada exige o local escolhido. O perfil de
compra é sempre perguntado, nunca inferido pela quantidade.

### 5.6 Fechamento

O sistema apresenta um resumo estruturado antes do orçamento:

> Confira comigo: [itens e quantidades], [malha e cores], [grade], [estampa],
> [entrega/retirada] e data desejada [data]. Está correto?

Após confirmação, uma pessoa autorizada registra orçamento, negociação, valor
final, condição e data de entrega confirmada. O resultado é:

- `aprovado`: inicia a jornada PIX;
- `perdido`: exige motivo e encerra sem gerar pedido;
- sem decisão: permanece em Fechamento com próxima ação e prazo registrados.

## 6. Jornada inicial de pagamento por PIX

PIX é um subfluxo de Fechamento, não uma nova coluna do Kanban.

| Estado | Entrada | Ação obrigatória | Saída |
|---|---|---|---|
| `aprovado_aguardando_pix` | Cliente aprovou valor e condição | Criar cobrança com valor final e chave PIX configurada | `pix_enviado` |
| `pix_enviado` | Mensagem aceita pelo canal | Guardar chave mascarada, horário e ID da mensagem | Aguarda comprovante ou confirmação humana |
| `comprovante_recebido` | Cliente envia comprovante | Anexar ao negócio e criar tarefa de conferência | Não marcar como pago automaticamente |
| `pagamento_confirmado` | Pessoa autorizada confirma | Registrar autor/horário; liberar geração da Ficha e boas-vindas | `pedido_gerado` |
| `pagamento_rejeitado` | Pessoa identifica divergência | Registrar motivo e pedir correção sem reenviar chave duplicada | Retorna a `pix_enviado` |
| `excecao_pagamento` | Condição diferente de PIX é autorizada | Registrar responsável, condição e motivo | Handoff humano; fora do caminho automático inicial |

Uma venda aprovada permanece em **Fechamento** enquanto aguarda PIX. O card só
recebe o estado terminal `Fechado` depois de `pagamento_confirmado`, geração da
Ficha e registro do onboarding. Assim, “aprovado” não é confundido com pedido
liberado. A saída `Perdido` continua disponível antes desse ponto, com motivo.

Mensagem de PIX:

> Pedido aprovado no valor de **[valor]**. Para seguir, faça o PIX usando a
> chave **[chave exibida]** e envie o comprovante nesta conversa. A produção
> será liberada após a confirmação do pagamento pelo time Silmer.

Regras:

1. A chave é lida de configuração autorizada e nunca gerada pelo agente.
2. O envio é idempotente: retry reutiliza a mesma cobrança e não cria outra.
3. O CRM não declara pagamento confirmado apenas por receber imagem ou PDF.
4. O MVP mede apenas valor vendido, quantidade de vendas e ticket médio;
   recebido e saldo a receber ficam para P2.

## 7. Boas-vindas ao cliente após confirmação

Quando o pagamento for confirmado e a Ficha for gerada, enviar:

> Pagamento confirmado — seja bem-vindo(a) à Silmer! Seu pedido é o
> **[número]**. Registramos **[resumo dos itens]**, com entrega/retirada prevista
> para **[data confirmada]**. A partir daqui nosso time acompanha a produção.
> Se precisar corrigir algo, responda por aqui e informe o número do pedido.

A mensagem deve conter número do pedido, resumo curto, data confirmada,
modalidade logística e canal de suporte. O CRM registra versão do template,
ID da mensagem, horário e estado do envio. Falha no onboarding gera retry
auditável e não duplica pedido nem cobrança.

## 8. Critérios de aceite do P0.1

1. **JRN-01:** WHEN uma conversa sem intenção comercial é encerrada THEN o CRM
   SHALL mantê-la no Backlog como `Sem lead` e não criar card.
2. **JRN-02:** WHEN a intenção comercial e os campos de identificação estão
   válidos THEN o CRM SHALL criar exatamente um negócio em Produto.
3. **JRN-03:** WHEN qualquer campo obrigatório da etapa está `pendente` ou
   `divergente` THEN o CRM SHALL impedir o avanço e indicar o próximo campo.
4. **JRN-04:** WHEN todos os campos aplicáveis de uma etapa estão `preenchido`
   ou `nao_aplicavel` THEN o CRM SHALL permitir que uma pessoa registre o gate
   e avance uma etapa; no MVP, o Vendedor Silmer apenas sugere esse avanço.
5. **JRN-05:** WHEN a grade é informada THEN o CRM SHALL calcular o total e
   impedir passagem se ele divergir da quantidade confirmada.
6. **JRN-06:** WHEN o cliente aprova a venda THEN o CRM SHALL iniciar uma única
   cobrança PIX com o valor final autorizado.
7. **JRN-07:** WHEN um comprovante é recebido THEN o CRM SHALL anexá-lo e pedir
   conferência humana sem afirmar pagamento confirmado.
8. **JRN-08:** WHEN uma pessoa confirma o pagamento THEN o CRM SHALL gerar a
   Ficha com todos os campos comerciais obrigatórios, preservar os campos de
   produção vazios e enviar as boas-vindas de forma idempotente.
9. **JRN-09:** WHEN uma correção invalida uma etapa concluída THEN o CRM SHALL
   voltar à primeira etapa incompleta sem apagar a trilha anterior.

## 9. Decisão de fechamento

O contrato de jornada deste documento e os contratos P0.2 a P0.7 de
`PRODUCT-READINESS-TECH-LEAD.md` estão **resolvidos**. O Tech Lead pode
especificar a máquina de estados, o esquema dos campos e a implementação sem
rediscutir etapas, preço, financeiro, canais, identidade da Ficha, privacidade
ou permissões.

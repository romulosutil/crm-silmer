# ADR 019 — Ficha espelhada e sinais operacionais

Status: aceita para desenvolvimento; troca da impressão depende da revisão da nova amostra.

Data: 03/10/2026

Decisores: PO (Rômulo Sutil Corrêa) definiu os campos, as personas e autorizou ajustar o design da ficha junto da tela; Tech Lead definiu compatibilidade, cálculo e gates. Contexto e alternativas na [RFC 007](../rfc/007-revisao-da-ficha-e-leitura-operacional.md). Requisitos `REV-01`–`REV-10` da [spec](../../.specs/features/pedidos-mvp/spec.md), tarefas T76–T82 de [tasks](../../.specs/features/pedidos-mvp/tasks.md). PR: vincular após recuperação do checkout Git.

## Contexto

A [ADR 016](016-itens-com-os-sete-pontos-da-ficha.md) fixa sete pontos por
item e apenas eles, mais a entrega prometida, bloqueiam a geração. A nova
decisão do PO exige tipo de serviço distinto por item; o vendedor precisa
completá-lo antes de gerar, sem ampliar a coleta do bot. A
[ADR 017](017-ficha-impressa-com-os-sete-pontos.md) fixa a v3 provisoriamente
aprovada e sua amostra por hash. A
[ADR 018](018-cliente-do-pedido-acompanha-o-contato.md) fixa nome atual do
pedido pendente e nome congelado no gerado. Todas permanecem válidas onde
esta decisão não as altera.

## Decisão

1. **O serviço pertence ao item.** `items[].tipo_servico` é texto livre no
   MVP. Pode faltar durante a edição parcial; a geração exige um valor em
   cada item. O bot mantém os sete pontos. Um gerado antigo sem serviço abre
   e imprime sem migração. `summary.aplicacao` permanece como técnica da arte
   legada, sem suprir ou substituir o serviço.
2. **Vocabulário da peça.** `items[].tipo` é “Tipo de roupa”. `modelo` deixa
   de aparecer na edição e na nova ficha, mas valores históricos continuam
   armazenados. O ponto `items[].gola` é “Definição da gola”; se vazio, a
   leitura pode usar `vies_gola` antigo. Uma edição não apaga esse dado por
   acidente. `vies_mangas` continua adicional separado.
3. **Origem da estampa é decisão humana.** `ficha.artwork` guarda os dois
   booleanos independentes. Só vendedor com permissão de escrita no pedido
   pode mudá-los. O agente e o fluxo n8n não projetam essa decisão. A lista
   de arquivos é reservada e não aceita escrita pela rota de seção.
4. **A v3 não é sobrescrita.** Uma revisão `ficha-canonical-v4` apresenta
   serviço por item, origem da estampa e novo rótulo da gola, preservando
   lastro, paginação e 14 campos vazios de produção. A v2 e a v3, seus PDFs e
   hashes permanecem intactos. `PRINT_TEMPLATE` continua v3 até o PO revisar
   a amostra sintética nova; Rose e Operação assinam fisicamente o exemplar
   exigido antes da produção. Uma troca posterior usa o seletor único de
   impressão e gate de aprovação próprio.
5. **Métricas declaradas.** “Vendas” conta pedidos confirmados. “Valor
   vendido” soma `finalAmountCents` desses pedidos; não representa dinheiro
   recebido (regra 16 de `RULES.md`). Um total não inclui pendentes.
6. **Sinais, não previsão.** “Cliente sem resposta” exige última mensagem de
   saída com status `sent`, `delivered` ou `read` há pelo menos 48 horas,
   sem mensagem de entrada posterior. “Pedido sem movimentação” deriva de
   `updatedAt` e é mostrado separadamente. Nenhum percentual de chance de
   venda é exibido. A API consulta metadados de mensagem em lote, sem texto
   nem PII no evento SSE.
7. **Leitura acessível e atual.** Área principal da linha abre o registro;
   link e foco continuam disponíveis por teclado. Eventos de pedido, contato
   e usuário atualizam as telas. Durante edição, o formulário preserva o
   rascunho e busca a versão nova depois de cancelar; conflito de versão é
   explícito. Uma tentativa manual só aparece quando a consulta falhou ou a
   conexão está indisponível.
8. **Arquivos preparados.** A tela informa `CRM/<numero-lowercase>/` e os
   formatos pretendidos, mas o input fica desabilitado. O primeiro upload,
   criação idempotente da pasta e envio ao Dropbox serão ativados em produção
   com storage durável, validação e auditoria. A retenção transitória de
   canal não é reutilizada (regras 18 e técnica 9 de `RULES.md`). O aviso a
   Rose via n8n/e-mail fica como proposta de fluxo, sem implementação aqui.

## Consequências

- A confirmação pode pedir ao vendedor um campo a mais por item. O pedido
  parcial e a coleta do bot continuam sem bloqueio por serviço.
- A revisão da ficha impressa é demonstrável sem invalidar a aprovação v3;
  a nova versão só entra em uso após o gate humano aplicável.
- Consultas de lista carregam estado de mensagem em lote; o DTO expõe só
  direção, horário e estado de entrega, jamais conteúdo.
- Designers e fábrica veem o serviço de cada item e a referência da arte;
  a localização do arquivo só aparecerá depois de um envio durável real.

## Relação com decisões anteriores

Esta ADR **supersede parcialmente** a frase “nada mais bloqueia” da
[ADR 016](016-itens-com-os-sete-pontos-da-ficha.md) pela exigência do serviço
por item e os rótulos Modelo/Viés gola. A
[ADR 017](017-ficha-impressa-com-os-sete-pontos.md) não é reescrita: sua v3
segue em uso até a nova aprovação. A
[ADR 018](018-cliente-do-pedido-acompanha-o-contato.md) continua integral.

# ADR 018 — O cliente do pedido acompanha o contato

Status: aceito

Data: 03/10/2026

Decisores: PO (Rômulo Sutil Corrêa), em 03/10/2026: "O pedido pendente deve
acompanhar quando alguém renomeia o contato." Ler o cliente a cada leitura em
vez de gravar no renomear, gravar o nome ao gerar e manter a busca como está
são decisões do Tech Lead.

Requisitos: os novos `PCT-01`–`03` (história P1-12) da
[especificação Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md), que
promovem o caso de borda "WHEN o contato muda de nome", e `PIT-11`, cuja regra
do nome esta decisão reusa. Tasks: T70–T72 de
[tasks](../../.specs/features/pedidos-mvp/tasks.md). Na
[ADR 016](016-itens-com-os-sete-pontos-da-ficha.md), item 8, a frase "os
pedidos já abertos guardam o cliente que receberam" passa a valer só para os
pedidos gerados. Os dois status são os da
[ADR 006](006-pedido-dois-status.md); o ciclo de atendimento é o da
[ADR 015](015-conversa-nao-volta-para-o-bot.md).

## Contexto

- O cliente do pedido (`ficha.summary.cliente`) era gravado uma vez, na
  criação, dentro do envelope cifrado da ficha, pela regra da PIT-11 (ADR 016):
  o nome confirmado do contato (dado por uma pessoa, origem `manual`, ou
  promovido do `customer_name` do bot, origem `automation`); senão o
  `customer_name` do briefing; senão vazio. Nada o atualizava depois: o
  cliente é bloqueado no Resumo, e a projeção do bot só o preenche quando está
  vazio.
- Desde a [ADR 014](014-pedido-abre-no-primeiro-ponto-da-ficha.md), o pedido
  abre no primeiro ponto da ficha, quase sempre antes de o cliente dizer o
  nome. O vendedor corrige o nome em "Editar nome" na Caixa de Entrada, ou o
  bot promove o nome que o cliente digitou, e o pedido continua em branco ou
  com o nome antigo.
- O caso de borda da spec ("WHEN o contato muda de nome THEN o cliente do
  pedido pendente SHALL refletir o nome atual; o pedido confirmado SHALL
  manter o nome da confirmação") nunca foi implementado.
- O nome muda em mais de um lugar: "Editar nome" (`renameContact` na API), a
  promoção do `customer_name` na integração n8n (`#promoteCustomerName`) e a
  troca do contato para onde a identidade aponta (`current_contact_id`).
- O pedido já resolve o vendedor na leitura: `seller` é o dono atual da
  conversa, lido a cada resposta; a ficha impressa usa quem gerou
  (`confirmedBy`), que fica gravado.

## Decisão

1. **O pendente lê o cliente da conversa.** Enquanto o pedido está pendente,
   o cliente é calculado a cada leitura pela regra da PIT-11, com o contato
   para onde a identidade da conversa aponta agora. Vale em toda saída do
   serviço de pedidos: detalhe (`GET /orders/{id}`), lista
   (`GET /orders`), gaveta da conversa (`GET /conversations/{id}/order`) e a
   resposta de cada comando. Uma consulta (`readOrderContexts`) cobre todos os
   pendentes de uma página.
2. **Renomear não é mudança do pedido.** Nada é gravado no pedido quando o
   contato muda de nome: a versão, o `updatedAt` (o "há quanto tempo o pedido
   não muda" da lista) e os eventos `order.*` ficam como estão, e um vendedor
   com uma seção aberta não recebe 409 por causa de um renomear. Sem escrita,
   não há efeito a deduplicar. As leituras não têm ETag
   (`private, no-cache`); a versão continua sendo a das escritas do pedido.
3. **O nome gravado num pendente é só cópia.** Ninguém lê o cliente gravado na
   ficha de um pendente como verdade. Toda escrita na ficha de um pendente
   (salvar uma seção, a projeção do bot) grava o cliente atual, porque o
   comando parte do pedido como ele é mostrado.
4. **Gerar grava o cliente.** Ao gerar (confirmar), o serviço lê o cliente
   atual e o grava na ficha, na mesma transação do status: `saveStatus` passa
   a gravar a ficha. O pedido gerado mostra e imprime esse nome, e renomear o
   contato depois não o alcança. Vale o nome lido ao gerar: se o contato foi
   renomeado com a página aberta, o pedido é gerado com o nome novo, que volta
   na resposta.
5. **Reabrir volta a acompanhar.** Reaberto, o pedido é pendente de novo e lê
   o cliente da conversa; gerar outra vez grava o nome desse momento, como
   autor, horário e data do pedido (PCL-12).
6. **Nunca o perfil nem o identificador.** A regra é a da PIT-11: o CRM não
   guarda o nome do perfil do WhatsApp, e o "@handle" do Instagram nunca é o
   cliente. Se uma pessoa apaga o nome do contato, o pendente volta ao
   `customer_name` do briefing da sua conversa ou fica vazio; o nome antigo
   não fica.
7. **A busca não muda.** A busca da lista continua pelo nome atual do contato,
   pelo identificador do canal e pelo telefone. Um pendente é achado pelo nome
   que mostra quando esse nome vem do contato; um gerado é achado pelo nome
   atual do contato, pelo número ou pelo telefone.

## Consequências

- O pendente e a Caixa de Entrada passam a concordar no nome do cliente; o
  vendedor gera a ficha com o nome que corrigiu.
- Um gerado cujo contato foi renomeado mostra o nome da geração, e a busca
  pelo nome antigo só o acha se o nome atual do contato ainda o contiver.
  Achar também o nome gravado dos gerados, ou o `customer_name` de um
  pendente sem nome no contato, exigiria decifrar a ficha ou o briefing de
  cada pedido a cada busca; fica para o PO decidir se vale o custo.
- Tempo real: a lista de Pedidos e a página do pedido recarregam com
  `inbox.order.changed`; o renomear publica `inbox.contact.changed`, que essas
  telas não escutam. O nome novo aparece ao abrir de novo a lista, a página ou
  a gaveta, ou na próxima mudança do pedido. Recarregar essas telas também com
  `inbox.contact.changed` é mudança de interface, fora deste corte.
- Cada leitura que tem pendentes faz uma consulta a mais (uma por página, não
  por pedido) e decifra o briefing das conversas desses pendentes; cada
  comando faz uma consulta a mais.
- Pedidos gravados, sem migração: os pendentes mostram o cliente pela regra
  atual já na próxima leitura, inclusive os abertos com o "@handle" antes da
  ADR 016. Os gerados antes desta decisão mantêm o cliente que já mostravam e
  imprimiam, gravado na criação.
- A ficha impressa v2 e a v3
  ([ADR 017](017-ficha-impressa-com-os-sete-pontos.md)) não mudam: só
  imprimem pedido gerado, com o cliente gravado.
- O contrato do n8n, o OpenAPI e a tela não mudam: `summary.cliente` continua
  só leitura e "vem do contato da conversa", e a dica do Resumo ("Vem da
  conversa e não muda no pedido") continua certa.
- Uma mensagem nova numa conversa encerrada como `Sem lead` abre outra
  conversa (outro ciclo) do mesmo contato. Um pendente do ciclo anterior
  continua acompanhando esse contato, e o `customer_name` de reserva vem do
  briefing da conversa do próprio pedido.

## Alternativas descartadas

- **Gravar nos pendentes a cada renomear:** exigiria um gancho em cada lugar
  que muda o nome (a API, a integração n8n e a troca do contato da
  identidade) e decifrar e cifrar fichas fora do módulo de pedidos. Cada
  renomear subiria a versão e o `updatedAt` de pedidos que não mudaram, daria
  409 a quem estivesse editando e publicaria eventos de pedido sem mudança. Um
  caminho de renomear esquecido deixaria o pedido para trás.
- **Resolver só na apresentação da API, como o vendedor:** gerar precisa gravar
  o nome, e isso é regra do serviço; lido no serviço, o cliente segue uma
  regra só, também nas respostas dos comandos.
- **Ler o cliente também no gerado:** a ficha impressa mudaria depois de
  gerada, o que o PO não quer.
- **Copiar o nome para uma coluna em claro para buscar:** nome é dado pessoal
  e fica só dentro do envelope da ficha.

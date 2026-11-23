# RFC 074 — Link de pagamento do CRM e cobranças que somam

Proposta de 23/11/2026, aguardando a decisão do proprietário. Nada aqui está
implementado. A decisão vira um ADR novo que supersede a regra de uma cobrança
ativa por pedido do [ADR 058](../adr/058-cobrancas-do-pedido-com-infinitepay.md)
e ajusta os [ADR 076](../adr/076-intencoes-de-cobranca-e-envio-transacional.md)
e [ADR 077](../adr/077-recebimentos-externos-e-conciliacao-de-cobrancas.md)
onde eles dependem dessa regra.

Abra o [protótipo navegável](../prototypes/cobrancas-recebimentos.html) no
navegador. A barra do topo troca o cenário (12), a largura, o papel e o tema.
**Anotações** explica cada tela e lista as decisões pendentes.

## Por que mudar

O PO apontou problemas graves na seção **Cobranças e recebimentos** do pedido.
Num sinal de R$ 15,00 em "Precisa de conferência", três ações lado a lado —
"Conferir pagamento", "Abrir link anterior para conferência" e "Conferir
cobrança" — fazem coisas diferentes com o mesmo verbo, e a tela não diz a causa
nem o próximo passo. A leitura do código de `OrderBillingSection.vue`,
`OrderBillingWorkspace.vue`, `OrderBillingOperations.vue` e
`ConversationBillingAction.vue` encontrou o mesmo padrão em toda a jornada:

1. **Seis "conferir" para seis coisas:**
   - `payment_check`;
   - `reconcile`;
   - repetir um comando incerto;
   - abrir o link;
   - "Solicitar conferência";
   - "Registrar conferência", usado até no diálogo de devolução.
2. **Sem próximo passo:**
   - estados de atenção não dizem a causa;
   - o feedback aparece longe do botão que o gerou;
   - botões ficam desabilitados sem motivo.
3. **Estados sem tom:**
   - "Link vencido" e "Resultado a conferir" saem neutros;
   - o resumo lateral pode dizer "A receber" enquanto a seção diz "Precisa de
     conferência".
4. **O mesmo estado com nomes diferentes**, além de códigos crus e datas ISO na
   tela.
5. **Ações principais escondidas** atrás de um "Detalhes" que nunca muda de
   rótulo.
6. **Condição perguntada duas vezes**: no pedido e de novo no envio.
7. **Na Caixa de Entrada:**
   - o pedido nunca vem pré-selecionado;
   - abre um diálogo por cima de outro;
   - a mensagem manda copiar, mas não há botão de copiar.

Boa parte da complexidade vem de uma restrição do provedor: a InfinitePay não
deixa o CRM cancelar um link. Por isso existem hoje "Link vencido", "Gerar novo
link", "Encerrar link vencido" e a maior parte das causas de conferência. O PO
pediu duas mudanças de direção:

- **"Mantenha a InfinitePay e crie o link do CRM que dá pra cancelar antes de o
  cliente clicar em Pagar."**
- **Vários links ao mesmo tempo, "somando" os pagamentos.**

Não há uso real para medir: as cobranças estão desligadas em produção. Os
problemas acima vêm do código e do print do PO, não de métricas.

## O que muda para o cliente

O cliente recebe um link do CRM, por exemplo `crm.silmer.com.br/pagar/7Q4K2M`,
e não o da InfinitePay. Ao abrir, vê uma página pública da Silmer com o número
do pedido, o tipo (Sinal, Saldo, Parcela ou Pagamento integral), o valor e o
botão **Pagar R$ X**.

**Só no clique em Pagar** o CRM pede à InfinitePay o pagamento e redireciona o
cliente para lá. Antes do clique, nada existe no provedor, e por isso o link
pode ser cancelado. Depois do clique, o pagamento na InfinitePay segue as
regras de hoje: uso único, 24 h de validade, sem cancelamento pelo CRM.

A página tem cinco estados (cenário 12 do protótipo):

| Estado                 | O que o cliente vê                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Pronto para pagar      | Valor e botão "Pagar R$ X".                                                              |
| Pagamento em andamento | "Você já abriu este pagamento." Botão "Continuar na InfinitePay", com o mesmo pagamento. |
| Já pago                | "Pagamento confirmado em 23/11, 14:05."                                                  |
| Cancelado              | "Este link foi cancelado. Fale com a Silmer pelo WhatsApp."                              |
| Falha ao abrir         | "Não conseguimos abrir o pagamento agora." "Tentar de novo" não cobra duas vezes.        |

**Proposta:** quando o pagamento na InfinitePay vence sem ser pago, o mesmo
link do CRM volta a "Pronto para pagar", e o próximo clique cria um pagamento
novo. Com isso somem da jornada do vendedor "Link vencido", "Gerar novo link"
e "Encerrar link vencido".

## O que muda para o vendedor

### Uma situação, um próximo passo, as movimentações

A seção passa a ter três camadas, com o mesmo nome e o mesmo selo no pedido, no
resumo lateral e na Caixa de Entrada:

1. **Situação:**
   - "Falta receber" em destaque;
   - a frase "Recebido R$ X de R$ Y · N%" com a barra logo abaixo;
   - a condição combinada.

   A barra fica presa à frase. Três valores espalhados sobre ela pareciam marcas
   de uma régua, e o PO rejeitou essa versão. Quando há links abertos, a barra
   ganha um segundo trecho e a legenda "Em links abertos R$ A · Livre para
   cobrar R$ B".

2. **Próximo passo:** uma frase, uma ação principal com o valor e no máximo duas
   secundárias. Em atenção, diz a causa e o que fica bloqueado. O retorno das
   ações aparece dentro deste bloco.
3. **Movimentações:** sempre visíveis, uma linha por link ou recebimento. As
   ações raras ficam no menu "Mais ações" de cada linha, e o "Histórico desta
   cobrança" abre e fecha com o rótulo certo.

### Um verbo por ação

| Ação                                     | Rótulo                                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| Enviar um link pela conversa             | Enviar link na conversa · secundária "Só gerar o link" |
| Cancelar um link antes do clique         | Cancelar link                                          |
| Mais um link enquanto há outro           | Enviar outro link                                      |
| `payment_check`                          | Verificar pagamento na InfinitePay                     |
| `reconcile`                              | Resolver conferência                                   |
| Comando de criação com resultado incerto | Confirmar resultado na InfinitePay                     |
| Recebimento fora da InfinitePay          | Registrar pagamento por fora                           |
| Devolução feita na InfinitePay           | Registrar devolução                                    |
| Desfazer um registro manual              | Estornar registro                                      |

### Estados de cada link

| Estado               | Quando                                                   | Ações da linha                                            |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Aguardando o cliente | Enviado ou gerado, sem clique em Pagar                   | Copiar link · Cancelar link                               |
| Em pagamento         | O cliente clicou e a InfinitePay criou o pagamento       | Abrir na InfinitePay · Verificar pagamento na InfinitePay |
| Resultado a conferir | Houve o clique, mas a resposta da InfinitePay não chegou | Confirmar resultado na InfinitePay                        |
| Recebido             | A InfinitePay confirmou                                  | Ver comprovante · Registrar devolução                     |
| Cancelado            | O vendedor cancelou antes do clique                      | — (fica no histórico, fora da soma)                       |

O selo da seção mostra o estado mais urgente: Resultado a conferir > Precisa de
conferência > Em pagamento > Aguardando o cliente > Pago parcialmente >
Quitado.

### Vários links somando

- Cada link aberto (Aguardando o cliente, Em pagamento ou Resultado a conferir)
  **reserva** o seu valor.
- **Livre para cobrar** = falta receber − soma dos links abertos.
- Um novo link vale de R$ 1,00 (o mínimo da InfinitePay) até o livre.
- A condição 0% · 50% · 100% continua no pedido e define a sugestão do primeiro
  link (o sinal). Depois, o vendedor divide o restante como quiser.
- O nome da linha sai do valor:
  - "Sinal · 50%" para a entrada;
  - "Saldo" quando o link cobre todo o livre e nada mais está aberto;
  - "Parcela" nos outros casos.
- O pedido fica quitado quando os recebimentos somam o total. Links cancelados
  ficam fora da soma.

### Pagamento por fora com link aberto

**Registrar pagamento por fora** aceita até o livre. Se o valor depende de
dinheiro reservado num link Aguardando o cliente, o diálogo oferece "Cancelar o
link do saldo e registrar", com uma confirmação para os dois efeitos e a revisão
"Link do saldo: cancelado · Recebido passa a R$ 4.800,00 · Quitado". Se o link
está Em pagamento, o diálogo recusa: "O cliente está pagando este link na
InfinitePay. Aguarde ou verifique o pagamento."

### Corrida entre cancelar e clicar

O servidor decide quem chegou primeiro, sob o mesmo bloqueio da linha do link.
Se o clique venceu, o cancelamento é recusado dentro do diálogo: "Não deu para
cancelar: o cliente clicou em Pagar às 14:03. Acompanhe o pagamento." Se o
cancelamento venceu, o cliente vê a página "Cancelado".

### Caixa de Entrada

A ferramenta **Cobranças e recebimentos** abre um só diálogo, com:

- o pedido pré-selecionado;
- a mesma Situação e o mesmo Próximo passo do pedido;
- a prévia da mensagem como o cliente recebe;
- o envio acompanhado até "Entregue";
- "Cancelar link" enquanto não houver clique.

A condição não é perguntada de novo: vem do pedido.

### Papéis

Só o responsável pelo pedido ou um administrador opera cobranças. Outro vendedor
vê números, selo e movimentações, mas nenhum link nem comprovante, e no lugar do
Próximo passo aparece a linha "Só Ana R. (responsável) ou um administrador opera
as cobranças deste pedido."

## Contrato técnico proposto

1. **Link do CRM:**
   - Uma entidade nova ligada à cobrança, com token aleatório de alta entropia,
     armazenado apenas como hash.
   - Estados: `open`, `checkout_requested`, `checkout_open`, `paid`,
     `cancelled`, `unknown`.
   - Auditoria de criação, abertura da página, clique, cancelamento e
     pagamento.
2. **Página pública `/pagar/:token`** (lida por `GET /api/v1/payment-links/:token`):
   - Sem sessão. Mostra só o número do pedido, o tipo e o valor.
   - Usa `noindex`, `Referrer-Policy: no-referrer`, limite de taxa por IP e por
     token, e a mesma resposta para token inexistente e cancelado.
   - Não expõe a URL do checkout da InfinitePay antes do clique.
3. **Clique em Pagar, `POST /api/v1/payment-links/:token/checkout`:**
   - Idempotente por link.
   - Sob bloqueio da linha: recusa se o link estiver cancelado. Se já existe
     pagamento válido, devolve o mesmo. Se não existe, reserva a criação e
     enfileira o comando pelo caminho de hoje (CRM → worker → n8n →
     InfinitePay → n8n → API).
   - A página espera o resultado persistido e redireciona.
   - Resposta incerta vira `unknown`: o link fica travado e reservado até
     `Confirmar resultado na InfinitePay`. Nunca se cria um segundo pagamento
     às cegas.
4. **Cancelar, `POST /api/v1/orders/:orderId/billing/links/:link/cancel`:**
   - Só o responsável ou um administrador, com chave de idempotência.
   - Sob o mesmo bloqueio do clique, só cancela em `open`; nos outros estados
     devolve conflito com o estado atual.
5. **Reserva:**
   - A soma dos links abertos nunca passa do que falta receber. A criação de
     link e o recebimento por fora validam isso na mesma transação.
   - Isso substitui a regra "uma cobrança não resolvida por pedido" do RFC 049
     e do ADR 058.
6. **Pagamento tardio:** a confirmação de um pagamento criado antes de um
   cancelamento ou de uma mudança de valor continua obrigatória. Quando não
   cabe no acordo vigente, vai para **Precisa de conferência**, como hoje.
7. **Mudança de valor do pedido (proposta):**
   - links `open` são cancelados automaticamente, com auditoria;
   - links já clicados seguem para a conferência quando necessário.

Continuam valendo:

- a confirmação por `payment_check`;
- a deduplicação de transação entre cobranças e loja;
- o recebimento por fora sem comprovante;
- devolução e estorno apenas como registro;
- pagamento que não confirma o pedido.

## Critérios propostos

| ID     | Critério                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LPC-01 | A mensagem ao cliente leva o link do CRM. Nenhum pagamento é criado na InfinitePay antes do clique em Pagar.                                                                                  |
| LPC-02 | A página pública mostra só pedido, tipo e valor. Token inexistente e cancelado recebem a mesma resposta. Há limite de taxa e `noindex`, e nenhuma PII aparece em log.                         |
| LPC-03 | Responsável ou administrador cancelam um link `open`. Outro vendedor, Financeiro, agente e usuário desativado são recusados. Cancelar um link já clicado devolve conflito com o estado atual. |
| LPC-04 | Cancelar e clicar ao mesmo tempo produzem exatamente um resultado, comprovado por teste concorrente no Postgres.                                                                              |
| LPC-05 | Cliques repetidos e reentrega do comando não criam um segundo pagamento válido. Resultado incerto trava e reserva o link até a confirmação.                                                   |
| LPC-06 | A soma dos links abertos nunca passa do que falta receber, inclusive com criações concorrentes e recebimento por fora.                                                                        |
| LPC-07 | Recebimentos de vários links e por fora somam até a quitação. Links cancelados ficam fora da soma e no histórico.                                                                             |
| LPC-08 | Pagamento confirmado de link cancelado, vencido ou acima do acordo vai para conferência e não quita outro acordo em silêncio.                                                                 |
| LPC-09 | A UI segue o vocabulário e os estados desta RFC, com teclado completo, foco previsível e estado em texto, no notebook e no celular, nos dois temas.                                           |

## Alternativas consideradas

- **Manter o link da InfinitePay com validade curta.** Não permite corrigir um
  link errado e mantém "Link vencido" e "Gerar novo link" na jornada.
- **Cancelar no painel da InfinitePay.** É manual e fora do CRM, e o CRM não
  tem como confirmar que foi feito.
- **Criar o pagamento na hora do envio e esconder a URL atrás de um
  redirecionamento.** O pagamento já existe no provedor e continua pagável por
  quem tiver a URL. Não resolve o cancelamento.
- **Só sinal e saldo, um link por vez (hoje).** É mais simples, mas não atende
  ao pedido de dividir a cobrança.

## Riscos

- **Latência no clique.** O caminho via n8n é assíncrono e o cliente espera na
  página até o redirecionamento. É preciso medir na homologação; se passar de
  alguns segundos, a página precisa de um estado de espera honesto.
- **Página pública nova.** É superfície de abuso: enumeração de tokens e
  scraping. O mitigador é token de alta entropia, resposta uniforme, limite de
  taxa e nenhuma PII na página.
- **Mais estados.** Precisam de cobertura de teste de efeitos, de reconciliação
  e de recuperação após reinício do worker.

## Pontos para a decisão

1. Aprovar o link do CRM, com o pagamento criado na InfinitePay só no clique
   em Pagar.
2. O link do CRM tem validade própria, ou só termina por pagamento ou
   cancelamento?
3. Aprovar o novo clique depois do vencimento do pagamento na InfinitePay, que
   retira "Link vencido", "Gerar novo link" e "Encerrar link vencido".
4. Confirmar o que a página pública mostra: pedido, tipo e valor.
5. Cancelar automaticamente os links ainda não clicados quando o valor do
   pedido muda?
6. Aceitar valores livres por link (de R$ 1,00 até o livre), mantendo 0% ·
   50% · 100% apenas como sugestão do primeiro link? A COB-T50 já levou essa
   condição a RULES.md e à spec, mas ainda sem ADR.
7. Link em "Resultado a conferir" reserva o seu valor?
8. Em "Precisa de conferência", deixar "Aplicar os pagamentos" disponível
   mesmo com um link Em pagamento, bloqueando só o cancelamento?
9. Ainda para decidir no protótipo:
   - o motivo da conferência exposto pela API;
   - o tom e o ícone dos estados de cobrança (DESIGN.md §21);
   - a casca única na Caixa de Entrada.

## Rastreabilidade e próximos passos

- Requisitos de origem: `.specs/features/order-billing/spec.md` (COB-01–16,
  COB-T50), order-billing-completion (BFIN/BFUI) e billing-simplified (BCS).
- Decisões e propostas anteriores: RFC 047, RFC 049, RFC 060 e RFC 064; ADR 058,
  ADR 076 e ADR 077.
- O PR 350 (protótipo de cobranças em lista única) trata do mesmo tema e deve
  ser comparado antes da decisão.
- Após a decisão:
  - ADR novo;
  - atualização de RULES.md, da spec e de `TECHNICAL-DESIGN.md`;
  - tarefas LPC-T01… em `.specs/features/order-billing/tasks.md`, começando
    pela entidade do link, pela página pública e pelo teste concorrente de
    cancelar × clicar.

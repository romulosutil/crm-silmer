# Caixa de Entrada refinada — tarefas

Requisitos: [spec.md](spec.md). Decisão:
[ADR 084](../../../docs/adr/084-caixa-de-entrada-refinada.md), sem RFC.
Contrato visual: [design.md](../../../design.md), §21. Cada tarefa é uma
entrega atômica: um PR, um commit e um push, a partir de `origin/master`.

### INBOX-RD-T00: decisão e documentação

- [x] Registrar a ADR 084 e a entrada no índice de ADRs.
- [x] Corrigir a §9 do `design.md` contra o código (abas da ADR 065, folha
      Filtros, Assumir no cabeçalho, "Mais" ancorado, "Transferir
      atendimento", faixa da vez, "Cotar para CEP", Cobranças e pagamentos,
      Ampliar conversa) e a §7 (destinos e grupos).
- [x] Acrescentar à §8 a casca de jornada, o grupo de mensagens, o
      compositor, o selo de status com ícone e o aviso de mensagem nova; à
      §16 a exceção do compositor e a espera da cobrança; e a §21.
- [x] Escrever esta spec e estas tarefas.
- Depends on: none.
- Done when: os IDs INBOX-RD-01 a 09 existem na spec e na §21, e as
  pendências do protótipo estão marcadas como pendentes.
- Gate: `git diff --check`, Prettier nos arquivos tocados e links relativos.

### INBOX-RD-T01: largura da lista

- [ ] Trocar a largura da lista no desktop pela fórmula de INBOX-RD-01, num
      token.
- [ ] Medir nomes e prévias cortados com dados sintéticos a 1920, 1366, 1250
      e 390 px.
- Depends on: T00.
- Done when: INBOX-RD-01 com os cenários negativos; decisão do tablet
  registrada (pendência da §21).

### INBOX-RD-T02: aviso de mensagem nova

- [ ] Regra pura da marca (primeira carga, conversa aberta, autor, abrir,
      armazenamento indisponível) com testes unitários.
- [ ] Selo no card, contador no rail e na barra inferior, "(N) " no título,
      faixa "Ver mensagens novas" e um anúncio por chegada.
- [ ] Guardar só identificador e instante; conferir que nenhum dado do
      cliente vai para o armazenamento.
- Depends on: T00.
- Done when: INBOX-RD-02 itens 1 a 15, com teste de navegador em duas
  conversas sintéticas e `prefers-reduced-motion`.

### INBOX-RD-T03: histórico, selos e cabeçalho

- [ ] Coluna de leitura e balão com largura máxima, nos tokens novos.
- [ ] Grupo de mensagens com autor e hora para leitor de tela em cada item.
- [ ] Selo de status com ícone na lista, no cabeçalho e no painel; 8 px e
      altura de controle no cabeçalho.
- Depends on: T00. Selo "Mensagem nova" de T02 usa o mesmo selo; se T02
  entrar antes, T03 só confere.
- Done when: INBOX-RD-03 e INBOX-RD-04 com os cenários negativos.

### INBOX-RD-T05: compositor em duas linhas

- [ ] Campo com a anatomia do `Field`, ferramentas em dois grupos, 8 px e
      rótulo de texto a partir de 40rem.
- [ ] `aria-disabled` com motivo visível no lugar de `disabled`, sem perder
      rascunho.
- [ ] Recontar as ações da conversa contra a §16.
- Depends on: T00 e T03 (mesma região da conversa; não rodar em paralelo no
  mesmo checkout).
- Done when: INBOX-RD-05 com os cenários negativos. Rótulo visível do campo
  e peso do texto seguem a decisão do PO sobre as pendências da §21.

### INBOX-RD-T06: casca de jornada no frete

- [ ] Componente de casca de jornada da §8, com folha inferior no celular.
- [ ] Aplicar ao diálogo de frete, sem caixas aninhadas, com a troca de
      primária depois de vincular.
- Depends on: T00 e T05 (o botão "Cotar frete" muda de lugar no
  compositor).
- Done when: INBOX-RD-06 com os cenários negativos, sem tocar "Cobranças e
  pagamentos".

### INBOX-RD-T07: navegação agrupada

- [ ] Grupos por espaço no rail, na sidebar expandida e na folha "Mais".
- [ ] Ícone `package` no `AppIcon` e `truck` em Melhor Envio.
- Depends on: T00. O contador da Caixa de T02 fica no mesmo item: se as duas
  mexerem no shell ao mesmo tempo, sequenciar.
- Done when: INBOX-RD-07 conferido para administrador, vendedor e
  Financeiro.

### INBOX-RD-T08: abas do painel Atendimento

- [ ] Trocar os botões `aria-pressed` por `Tabs`.
- [ ] Resumo do pedido como primeiro bloco de "Pedidos e assuntos".
- Depends on: T00 e T03 (selos do painel).
- Done when: INBOX-RD-08 com o cenário negativo.

### INBOX-RD-T09: limpeza

- [ ] Valores fora da escala viram token na Caixa e no shell.
- [ ] Larguras literais viram token; regras CSS sem marcação saem.
- Depends on: T01, T03, T05, T06, T07 e T08 (limpa depois que a marcação
  nova existe).
- Done when: INBOX-RD-09 com regressão visual das telas do pedido sem
  diferença.

### Depois do PR 348: casca de jornada na cobrança

Fora desta lista de IDs. Quando o PR 348 (`codex/order-timeline`, BCS-01–09)
for mesclado, abrir tarefa própria para aplicar a casca a "Cobranças e
pagamentos", com a emenda de BFUI-01 e o mapa de tom e ícone dos estados de
cobrança.

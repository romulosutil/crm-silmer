# Caixa de Entrada refinada

Decisão do PO em 11/11/2026, a partir do protótipo
`output/prototipos/caixa-de-entrada/` (local, não versionado). Decisão:
[ADR 084](../../../docs/adr/084-caixa-de-entrada-refinada.md), sem RFC.
Contrato visual: [design.md](../../../design.md), §7, §8, §9, §16 e §21.
Tarefas: [tasks.md](tasks.md). Base: PCX-10 a PCX-19 e INBOX-UX-03 em
[Pedidos MVP](../pedidos-mvp/spec.md) e [CRM MVP](../crm-mvp/spec.md),
PCX-16a–h e UX-FUNC-01 em [CRM MVP](../crm-mvp/spec.md), MEVQ-06/08 em
[Melhor Envio](../melhor-envio/spec.md).

## Problema

Em produção, em 11/11/2026, a lista de 224 px cortava 47% das prévias e 4
nomes em 70 conversas; nada avisava mensagem nova; o histórico ocupava
1612 px com o autor repetido em toda mensagem; o compositor era um campo sem
borda com cinco botões só de ícone a 4 px; o rail tinha 2 px entre itens e o
mesmo ícone em três destinos. As medidas completas estão na §21 do
`design.md`.

## Fora de escopo

- Abas, contagens, ordens e cursores da Caixa (PCX-19, ADR 065).
- Comandos, permissões, versões e confirmações da Caixa, do frete e da
  cobrança; nenhum contrato REST muda.
- Jornada de cobrança: espera o PR 348 (`codex/order-timeline`, BCS-01–09).
- Marcador de lido no servidor, que acompanharia a pessoa entre aparelhos.
- Os pontos marcados como pendentes na §21 do `design.md`.

## Requisitos

Cada requisito vale em claro e escuro, por teclado, a 320 px e com zoom de
200%, e não transmite estado só por cor (§14 do `design.md`).

### INBOX-RD-01 — Largura da lista

1. WHEN a Caixa abre no desktop THEN a coluna da lista SHALL medir
   `clamp(14rem, 24vw, 18.75rem)`: 300 px a partir de cerca de 1250 px de
   janela e nunca menos de 224 px.
2. A lista e a conversa SHALL continuar rolando cada uma por dentro, sem
   rolagem horizontal da página.
3. **Negativo:** no celular (até 768 px) a lista e a conversa SHALL
   continuar como telas separadas, sem mudança de largura.
4. **Negativo:** "Ampliar conversa" SHALL continuar escondendo a lista
   inteira, sem remontar o histórico nem perder o rascunho (PCX-16e).

Verificação: largura medida a 1920, 1366, 1250 e 390 px; contagem de nomes
cortados com dados sintéticos.

### INBOX-RD-02 — Aviso de mensagem nova

1. WHEN chega mensagem do cliente numa conversa que a pessoa pode ler e que
   não está aberta THEN a conversa SHALL ganhar a marca de mensagem nova.
2. Com a marca, o card SHALL mostrar o selo "Mensagem nova" (tom informação,
   ícone e texto) como primeiro selo, dentro do limite de dois selos
   visíveis, e a prévia SHALL usar `--color-text` peso 500. O nome
   acessível do card SHALL começar com "Mensagem nova.".
3. O item Caixa de Entrada do rail e o item Caixa da barra inferior SHALL
   mostrar o número de conversas marcadas, no padrão do contador de Pedidos,
   com o número no nome do link ("Caixa de Entrada, 2 conversas com mensagem
   nova"). Com zero, o contador SHALL NOT aparecer.
4. O título do documento SHALL começar com "(N) " enquanto houver N
   conversas marcadas, e voltar ao título sem prefixo em zero.
5. WHEN há marca fora da vista (outra aba selecionada, lista rolada ou busca
   que esconde o card) THEN a faixa `.inbox-live-notice` SHALL dizer "N
   conversas com mensagem nova em Responder" e oferecer "Ver mensagens
   novas", que vai para Responder, limpa a busca, rola a lista ao topo e leva
   o foco ao primeiro card marcado. Com todas as marcas à vista, a faixa
   SHALL NOT aparecer.
6. Cada chegada SHALL gerar um só anúncio na região `role="status"` do
   shell. A faixa SHALL NOT ser região viva.
7. WHEN a pessoa abre a conversa THEN a marca SHALL sumir no card, no
   contador, no título e na faixa.
8. A marca SHALL ser guardada por navegador, com só o identificador da
   conversa e o instante da mensagem.
9. **Negativo:** a primeira carga da Caixa neste navegador SHALL NOT marcar
   nenhuma conversa, mesmo com mensagens não respondidas.
10. **Negativo:** mensagem que chega na conversa aberta SHALL NOT marcar.
11. **Negativo:** mensagem do vendedor, do agente ou do sistema SHALL NOT
    marcar.
12. **Negativo:** sem permissão de armazenamento (modo privado, cota cheia
    ou acesso bloqueado) o aviso SHALL funcionar durante a visita e
    SHALL NOT mostrar erro, quebrar a Caixa ou registrar falha visível.
13. **Negativo:** o armazenamento SHALL NOT conter nome, telefone, texto de
    mensagem ou outro dado do cliente (UX-FUNC-01).
14. **Negativo:** a chegada SHALL NOT tocar som, mover o foco ou abrir a
    conversa. Com `prefers-reduced-motion: reduce`, "Ver mensagens novas"
    SHALL rolar sem animação; selo, contador e faixa SHALL NOT piscar.
15. Limite declarado: a marca SHALL NOT acompanhar a pessoa entre aparelhos
    ou navegadores; isso não é defeito desta entrega.

Verificação: testes da regra de marca (primeira carga, conversa aberta,
autor, abrir, armazenamento indisponível) e cenário de navegador com duas
conversas sintéticas.

### INBOX-RD-03 — Histórico em coluna e grupos de mensagens

1. A coluna do histórico SHALL ser centralizada e SHALL NOT passar de
   `--inbox-thread-max-inline-size` (48rem); o balão SHALL NOT passar de
   `--inbox-message-max-inline-size` (34rem).
2. Mensagens seguidas do mesmo autor SHALL formar um grupo, com avatar e
   nome uma vez e a hora em cada balão.
3. Cada mensagem SHALL começar, para leitor de tela, com autor e hora; o
   cabeçalho visível do grupo SHALL ficar fora da leitura.
4. O histórico SHALL continuar a lista ordenada "Histórico da conversa",
   focável, abrindo na última mensagem e acompanhando as novas, salvo quando
   a pessoa rolou para ler algo antigo.
5. **Negativo:** vendedor e agente SHALL NOT entrar no mesmo grupo, mesmo do
   mesmo lado; mensagem de outro autor no meio SHALL abrir grupo novo.
6. **Negativo:** agrupar SHALL NOT esconder a hora, o aviso de entrega, a
   pergunta de assunto, o atalho "Cotar para CEP" nem a mídia de nenhuma
   mensagem.

Verificação: contagem de cabeçalhos de autor por mensagem com histórico
sintético; leitura do nome acessível de cada item.

### INBOX-RD-04 — Selos com ícone e alvos do cabeçalho

1. Todo selo de status na lista, no cabeçalho da conversa e no painel
   Atendimento SHALL ter ícone decorativo (`aria-hidden`) e o texto literal
   do estado, com o tom: sucesso `check`, atenção `alert`, informação `info`,
   erro `alert`, neutro.
2. As ações do cabeçalho SHALL ter 8 px entre si e altura de controle: pelo
   menos 40 px com mouse e 44 px no toque, inclusive Assumir atendimento,
   Criar pedido e o link do pedido.
3. **Negativo:** nenhum selo SHALL ser só cor ou só ícone, nem se comportar
   como botão.
4. **Negativo:** o cabeçalho SHALL continuar com no máximo quatro controles
   (§16) e Assumir atendimento como única primária antes da tomada humana
   (PCX-15).

Verificação: inspeção dos selos por estado; medida dos alvos com ponteiro
fino e com `pointer: coarse`.

### INBOX-RD-05 — Compositor em duas linhas

1. O campo de resposta SHALL usar a anatomia do `Field` da §20: borda
   `--color-border-strong`, fundo `--color-surface`, raio `--radius-md`,
   foco com halo e erro na borda.
2. As ferramentas SHALL ficar numa segunda linha, em dois grupos separados
   por divisor, nesta ordem: mídia (Anexar arquivo, Gravar áudio) e pedido
   (Cobranças e pagamentos, Cotar frete), com 8 px entre botões; "Enviar
   resposta" à direita, como única primária.
3. Com 40rem ou mais de largura, as ferramentas do pedido e o envio SHALL
   mostrar ícone e texto; abaixo disso, só ícone, com `aria-label` e `title`.
4. Ação indisponível SHALL usar `aria-disabled="true"`, continuar focável e
   ter o motivo visível e como descrição acessível ("Somente o vendedor
   responsável pode responder.").
5. Enter SHALL enviar e Shift+Enter quebrar a linha; no toque, só o botão
   envia. Gravando, o foco SHALL ir para Parar gravação; Esc descarta e
   devolve o foco a Gravar áudio.
6. **Negativo:** ativar ação indisponível SHALL NOT enviar, gravar, abrir
   diálogo nem apagar o rascunho.
7. **Negativo:** as ferramentas do pedido SHALL NOT aparecer para quem não
   pode usá-las; antes de assumir SHALL NOT haver compositor (PCX-15).
8. **Negativo:** o compositor SHALL NOT ter segunda primária nem mais que
   quatro ferramentas fora da gravação (exceção da §16).

Verificação: cenário de navegador com dono, outro vendedor e administrador;
foco e Esc na gravação; contagem de ações da conversa contra a §16.

### INBOX-RD-06 — Casca de jornada no frete

1. "Cotar frete" SHALL abrir a casca de jornada da §8: título, fechar em
   botão de ícone ("Fechar cotação"), corpo rolável, rodapé com as ações e
   `--elevation-floating`; no celular, folha inferior de largura total com os
   botões empilhados.
2. O corpo SHALL NOT ter caixa com borda dentro da casca (fieldset, serviço
   ou estimativa).
3. "Consultar frete" SHALL ser a primária até haver frete vinculado; depois,
   "Escrever resposta com o frete" (ou "Acrescentar resposta com o frete"
   quando já há rascunho) SHALL ser a primária e "Consultar frete" a
   secundária.
4. Ao abrir, o foco SHALL ir ao seletor de pedido; Esc e fechar SHALL
   devolver o foco ao botão que abriu, inclusive ao atalho "Cotar para CEP".
5. **Negativo:** abrir, consultar ou vincular SHALL NOT enviar mensagem nem
   mudar total, ficha, pagamento ou status (MEVQ-08); escrever a resposta
   SHALL só preencher o compositor (MEVQ-06).
6. **Negativo:** a casca SHALL NOT abrir outro diálogo por cima.
7. **Negativo:** "Cobranças e pagamentos" SHALL continuar como está nesta
   entrega; a casca entra nela depois do PR 348, em tarefa própria.

Verificação: cenário de frete com pedido sintético e Melhor Envio simulado;
contagem de primárias por etapa.

### INBOX-RD-07 — Navegação agrupada

1. Os destinos SHALL ficar na mesma ordem, em quatro grupos separados só por
   espaço: operação (Dashboard, Caixa de Entrada, Pedidos, Clientes),
   integrações (Olist, Melhor Envio), administração (Usuários, Saúde e erros)
   e Conta; 4 px entre itens e 16 px entre grupos.
2. Cada destino SHALL ter ícone próprio: Melhor Envio `truck`, Olist
   `package` (novo no `AppIcon`).
3. A folha "Mais" do celular SHALL seguir os mesmos grupos, com Aparência e
   Sair.
4. **Negativo:** os grupos SHALL NOT ter título nem divisor desenhado.
5. **Negativo:** um perfil sem destino num grupo SHALL NOT ver espaço vazio
   no lugar dele, e nenhuma permissão SHALL mudar (Olist, Melhor Envio,
   Usuários e Saúde e erros seguem as regras atuais).

Verificação: inspeção do rail para administrador, vendedor e Financeiro;
contagem de ícones distintos.

### INBOX-RD-08 — Abas do painel Atendimento

1. "Pedidos e assuntos" e "Resumo" SHALL ser `Tabs`: `tablist`, `tab` com
   `aria-selected` e `aria-controls`, `tabpanel` ligado ao `tab`, setas,
   Home e End e `tabindex` móvel.
2. Em "Pedidos e assuntos", o resumo do pedido SHALL ser o primeiro bloco,
   antes da avaliação das sugestões de pedido e dos Assuntos do atendimento.
3. **Negativo:** trocar de aba SHALL NOT recarregar o resumo, cancelar
   comando em andamento nem fechar o painel (PCX-16h).

Verificação: navegação por teclado entre as abas; ordem dos blocos.

### INBOX-RD-09 — Limpeza de valores e regras

1. Na Caixa e no shell, 3 px, 3,2 px, 6 px, 5,6 px e os 2 px entre itens de
   navegação e entre abas SHALL virar `--space-1` ou `--space-2`.
2. Larguras literais SHALL virar token: `--journey-inline-size`,
   `--inbox-context-inline-size` e `--menu-inline-size`.
3. Regras CSS da Caixa sem marcação correspondente SHALL sair.
4. **Negativo:** a limpeza SHALL NOT mudar o CSS de `40-order.css` nem dos
   primitivos `Field`, `FieldGap`, `SaveStatus` e `InlineConfirm`, que
   esperam a decisão do conjunto de ícones (§21, pendências).

Verificação: busca pelos valores fora da escala nos arquivos da Caixa e do
shell; regressão visual das telas do pedido sem diferença.

## Notas

- PCX-13 já está emendada por PCX-15 (Assumir no cabeçalho); os atalhos de PCX-14 e
  PCX-18 foram substituídos pelas abas de PCX-19 (RFC 052). Nenhum requisito existente precisa
  de emenda para INBOX-RD-01 a 09; as emendas de PCX-13/15, MEVQ-06/08 e
  BFUI-01 citadas no protótipo dependem dos pontos pendentes da §21.
- Medidas sem leitor de tela nem aparelho real até aqui.

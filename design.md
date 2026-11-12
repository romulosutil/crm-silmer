# Design do CRM Silmer

> **Status:** direção visual e contrato de interface para o MVP  
> **Referência de marca:** [silmer.com.br](https://silmer.com.br/), inspecionado em 29/08/2026  
> **Escopo:** produto web responsivo em Vue 3, HTML semântico, CSS e JavaScript ESM

## 1. Objetivo

O CRM Silmer deve transmitir a mesma personalidade da marca pública — roxo profundo, laranja, tipografia Poppins e linguagem direta — sem reproduzir a intensidade visual de uma página promocional dentro de uma ferramenta de trabalho.

O produto é usado para triar conversas, acompanhar oportunidades, revisar dados e concluir pedidos. Portanto, a interface deve priorizar:

1. **clareza operacional:** o próximo passo e o estado atual devem ser reconhecidos sem interpretação;
2. **baixa sobrecarga cognitiva:** cada região possui uma ação principal, informações secundárias aparecem sob demanda e elementos decorativos não competem com dados;
3. **confiança:** ações automáticas, alterações, falhas e responsáveis permanecem visíveis e auditáveis;
4. **consistência:** o mesmo componente, estado e termo têm a mesma aparência em todo o produto;
5. **acessibilidade:** light e dark são equivalentes, navegação por teclado é completa e cor nunca é o único indicador de significado.

## 2. Tradução da marca para o produto

### Elementos preservados

- Poppins como família tipográfica principal.
- Laranja `#ff5b01` como cor de ação prioritária e assinatura da marca.
- Roxo escuro `#0c042d` como base do tema dark.
- Roxos intermediários para foco, links e estados selecionados.
- Cantos arredondados, com raio menor e mais funcional do que no site institucional.
- Texto direto, humano e orientado à ação.

### Adaptações intencionais

- O CRM não usa títulos promocionais gigantes, faixas animadas, brilhos ou grandes áreas laranja.
- Gradientes, fotografias e efeitos de glow ficam restritos a autenticação, onboarding ou comunicação institucional; nunca aparecem atrás de dados operacionais.
- Pills são usadas apenas para status, filtros compactos e contadores. Containers, tabelas e formulários usam raios moderados.
- A profundidade vem primeiro de contraste entre superfícies e bordas; sombras são discretas e raras.
- A densidade é moderada: mais compacta que o site, mas sem transformar todas as telas em tabelas densas.

## 3. Princípios de baixa carga cognitiva

### Hierarquia previsível

- Cada página possui um único `h1`, uma descrição opcional e uma ação primária.
- A ordem visual é sempre: contexto → estado → conteúdo → ação.
- A navegação principal não muda de posição entre módulos.
- Ações destrutivas ficam separadas das ações de continuidade.
- Métricas usam rótulo, valor e contexto; não dependem de ícone ou cor para serem entendidas.

### Divulgação progressiva

- Mostrar primeiro o necessário para decidir; histórico, metadados e auditoria ficam em painéis expansíveis ou drawer.
- Formulários longos da Ficha são divididos por grupos da jornada, não por conveniência técnica.
- Filtros frequentes permanecem visíveis; filtros avançados abrem em popover ou drawer.
- Cards do Kanban exibem apenas identificação, valor/contexto essencial, responsável, próxima pendência e tempo no estágio.

### Uma ação principal por região

- A ação mais importante usa botão `primary` laranja.
- Ações alternativas usam `secondary` ou `ghost`.
- Uma mesma região não deve exibir dois botões `primary`.
- Links dentro de texto continuam parecendo links; não viram botões sem necessidade.

### Estados explícitos

- Todo carregamento, vazio, erro, sucesso, indisponibilidade e falta de permissão possui tratamento próprio.
- No MVP, a atuação do Vendedor Silmer informa `o que respondeu`, `o que sugeriu`, `quando` e `em nome de qual regra`; alterações oficiais continuam humanas.
- Estado de sincronização e envio usa texto curto mais ícone; nunca somente uma bolinha colorida.

## 4. Temas e tokens semânticos

Os componentes consomem somente tokens semânticos. Cores brutas não devem ser usadas diretamente fora da definição do tema.

### Implementação canônica e regra de evolução

- `apps/edge-web/src/tokens.css` é a única fonte para valores de cor, tipografia, espaçamento, raios, sombras, foco e movimento do produto.
- `apps/edge-web/src/main.js` o importa antes de `styles.css`; CSS de tela e componente consome somente `var(--token-semântico)`, inclusive para foco, overlay e estados.
- Novos valores brutos de cor (`#...`, `rgb()`, `hsl()` ou cores nomeadas) só podem ser declarados em `tokens.css`. Se um papel ainda não existe, criar ou evoluir o token semântico antes de usá-lo.
- `npm run check:design-tokens` é o guardrail executável dessa regra e integra `npm run validate`; uma alteração de frontend não está pronta se ele falhar.

### Camadas de token e whitelabel (RFC 022)

O produto é whitelabel e a Silmer é o piloto. `tokens.css` tem três camadas:

1. **Marca** — as únicas entradas por empresa:

| Entrada                        | Silmer                | Papel                                                |
| ------------------------------ | --------------------- | ---------------------------------------------------- |
| `--brand-primary`              | `#ff5b01`             | assinatura: logotipo, faixas, ícone ativo            |
| `--brand-primary-strong`       | `#c94300`             | preenchimento de ação; branco sobre ele passa 4.78:1 |
| `--brand-ink`                  | `#0c042d`             | texto, neutros, superfícies escuras e tema escuro    |
| `--brand-secondary` / `-light` | `#6544ee` / `#b2a1f7` | link, foco e seleção (claro / escuro)                |
| `--brand-font`                 | Poppins               | família única                                        |
| `--brand-radius`               | `0.5rem`              | raio base; `sm`, `lg` e `xl` derivam dele            |

2. **Semânticos** — derivados da marca com `color-mix()`; componentes só usam
   estes. Os neutros são a tinta misturada ao branco em poucas porcentagens, por
   isso trocar `--brand-ink` re-tinge canvas, bordas, texto e sombras.

| Papel                                    | Light                | Dark                   | Uso                               |
| ---------------------------------------- | -------------------- | ---------------------- | --------------------------------- |
| `--color-canvas`                         | tinta 5%             | tinta + preto          | fundo do shell e da navegação     |
| `--color-page`                           | tinta 1.5%           | tinta                  | painel de trabalho (inset)        |
| `--color-surface`                        | branco               | branco 5%              | cards, campos, botões secundários |
| `--color-surface-raised`                 | tinta 4%             | branco 9%              | hover e segundo nível             |
| `--color-surface-active`                 | tinta 8%             | branco 14%             | pressionado                       |
| `--color-text`                           | tinta                | branco 94%             | texto principal (≥ 16:1)          |
| `--color-text-muted`                     | tinta 64%            | branco 68%             | texto secundário (≥ 5.5:1)        |
| `--color-border` / `-strong` / `-subtle` | tinta 14% / 45% / 8% | branco 16% / 45% / 10% | limites; `strong` em campos (3:1) |
| `--color-accent`                         | primária             | primária               | faixa, ícone ativo, assinatura    |
| `--color-accent-solid`                   | primária forte       | primária forte         | botão primário (texto branco)     |
| `--color-link` / `--color-focus`         | secundária           | secundária clara       | links, anel e halo de foco        |
| `--color-selected`                       | secundária 9%        | secundária 22%         | chip ou linha selecionada         |

3. **Componentes** — `--control-height` (40 px; 44 px em `pointer: coarse`),
   `--target-min`, `--sidebar-inline-size`, `--sidebar-rail-size`,
   `--topbar-block-size`.

Regras para uma nova marca: `--brand-ink` escura (luminância < 5%) e
`--brand-primary-strong` com contraste ≥ 4.5:1 com branco. Nome da empresa,
nome do produto, slogan e logotipo ficam em `apps/edge-web/src/brand/index.js`;
`BrandMark.vue` desenha o logotipo oficial. Nenhum componente escreve o nome da
empresa.

### Cores semânticas

| Estado     | Light: fundo / texto  | Dark: fundo / texto   |
| ---------- | --------------------- | --------------------- |
| sucesso    | `#e7f6ed` / `#146c43` | `#123a2a` / `#8fe3b3` |
| atenção    | `#fff4d6` / `#7a4a00` | `#4a2e00` / `#ffd17a` |
| erro       | `#fdecec` / `#a12a2a` | `#491a22` / `#ffb4c0` |
| informação | `#eaf2ff` / `#205aa7` | `#152f56` / `#a8caff` |

Cada estado combina cor, ícone e rótulo. Os nomes dos tokens devem expressar função, nunca a cor: `--status-error-text`, não `--red-700` dentro de componentes.

### Aplicação do tema

- O modo claro é a aparência inicial quando não existe preferência salva ou a preferência legada for inválida.
- A escolha manual oferece `Claro` e `Escuro`; a preferência do sistema não é usada.
- Aplicar `data-theme="light|dark"` no elemento `html` e declarar `color-scheme` correspondente.
- Persistir somente a preferência de tema, sem estado global em `window`.
- Aplicar o tema antes da primeira pintura para evitar flash entre temas.
- Nenhuma informação, ação ou ilustração pode existir apenas em um dos temas.

A tinta da marca é texto no modo claro, não fundo de navegação. Laranja nunca
marca seleção (chip, segmentado, aba): seleção é neutra ou usa
`--color-selected`; o laranja fica para a ação primária e a assinatura.

## 5. Tipografia

**Família:** `Poppins, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.

Uma única família reduz ruído e custo de carregamento. Pesos permitidos: `400`, `500`, `600` e `700`; `800` fica reservado à autenticação ou comunicação institucional.

| Token         |   Tamanho / linha |    Peso | Uso                                             |
| ------------- | ----------------: | ------: | ----------------------------------------------- |
| `--text-xs`   | `0.8125rem / 1.5` |     500 | metadados, legendas e rótulos (piso do produto) |
| `--text-sm`   |  `0.875rem / 1.5` | 400–600 | controles compactos e tabelas                   |
| `--text-base` |      `1rem / 1.5` |     400 | texto e campos                                  |
| `--text-lg`   |  `1.125rem / 1.4` |     600 | título de painel                                |
| `--text-xl`   |  `1.25rem / 1.35` |     600 | seção                                           |
| `--text-2xl`  |   `1.5rem / 1.25` |     600 | título de página (h1)                           |
| `--text-3xl`  |      `2rem / 1.2` |     700 | estados especiais e autenticação                |

- Texto corrido não ultrapassa aproximadamente 75 caracteres por linha.
- Não usar caixa alta nem eyebrow acima de títulos; rótulos ficam em caixa normal, peso 500 e cor secundária.
- Nenhum texto abaixo de `--text-xs` (13 px).
- Números financeiros usam `font-variant-numeric: tabular-nums`.
- Placeholder é dica, nunca substituto de `label`.

## 6. Espaçamento, forma e elevação

### Escala de espaçamento

Base de `4px`: `4`, `8`, `12`, `16`, `20`, `24`, `32`, `40`, `48`, `64`.

- `4–8px`: relação entre ícone e rótulo ou metadados.
- `12–16px`: padding interno de controles e grupos compactos.
- `20–24px`: padding de painéis e distância entre grupos.
- `32–48px`: separação entre seções de página.

### Raios

| Token           |   Valor | Uso                                 |
| --------------- | ------: | ----------------------------------- |
| `--radius-sm`   |   `6px` | badge, item compacto, segmento      |
| `--radius-md`   |   `8px` | inputs, botões e menus              |
| `--radius-lg`   |  `12px` | cards, painéis e dialogs            |
| `--radius-xl`   |  `16px` | painel de trabalho e tela de acesso |
| `--radius-pill` | `999px` | chips, contadores e avatar          |

### Elevação

- `level-0`: canvas, sem sombra.
- `level-1`: superfície + borda sutil.
- `level-2`: popover, menu e sticky header com borda e sombra curta.
- `level-3`: dialog, com overlay e sombra moderada.
- No tema dark, elevação é indicada principalmente por uma superfície mais clara e borda; glow não é elevação padrão.

## 7. Estrutura da aplicação

### App shell

**Mobile-first (15/10/2026):** os vendedores operam pelo celular. Toda tela é
desenhada primeiro para 390×844.

- **Celular (≤ 768 px):** topo de 56 px com o logotipo e o estado da conexão;
  barra inferior fixa de `--mobile-nav-block-size` (64 px + safe-area) com
  Início, Caixa, Pedidos, Clientes e Mais. "Mais" abre uma folha inferior com
  a conta (nome e função), os destinos que não estão na barra (Olist, Melhor
  Envio, Usuários, Saúde e erros e Conta, conforme a permissão), Aparência e
  Sair; Escape fecha e devolve o foco. O perfil Financeiro vê na barra só
  Olist (quando habilitado) e Minha conta, sem "Mais". As telas reservam a
  barra no fim da rolagem e acima de rodapés fixos. Campos usam 16 px para o
  iOS não dar zoom.

- Sidebar de `248px` no canvas, sem borda; item ativo usa superfície branca,
  peso semibold e ícone na cor da marca, sem sombra. Recolhe para rail de `72px` entre 769 e
  1199 px, com o monograma da marca. A Inbox começa com menu compacto quando
  não há preferência; `Expandir menu` / `Recolher menu` preserva a escolha
  no navegador para todas as telas desktop/tablet. No celular permanece a barra inferior.
  Ícones compactos mantêm nomes acessíveis e rótulos no hover e no foco.
- O trabalho fica num painel inset (`--color-page`, raio `xl`) com topbar de
  `56px`: trilha "Empresa › Tela", função, estado da conexão e tema.
- Uma lista de rotas alimenta a sidebar, a barra inferior e a folha "Mais";
  todos oferecem os mesmos destinos, inclusive Usuários (admin) e Sair.
- **Destinos (código em 11/11/2026):** Dashboard, Caixa de Entrada, Pedidos
  (com o contador de pedidos novos do site), Clientes, Olist (administrador
  ou usuário habilitado no Olist), Melhor Envio e Usuários (administrador),
  Saúde e erros (quem pode ler) e Conta. Hoje Pedidos, Olist e Melhor Envio
  usam o mesmo ícone e os itens do rail têm 2 px entre si.
- **Grupos (INBOX-RD-07, §21):** os mesmos destinos, na mesma ordem, em
  quatro grupos separados só por espaço: operação (Dashboard, Caixa de
  Entrada, Pedidos, Clientes), integrações (Olist, Melhor Envio),
  administração (Usuários, Saúde e erros) e Conta. 4 px entre itens e 16 px
  entre grupos, sem título nem divisor de grupo. Cada destino tem ícone
  próprio: Melhor Envio usa `truck` e Olist ganha `package`. Grupo sem
  destino visível para o perfil não deixa espaço vazio. A folha "Mais" do
  celular segue os mesmos grupos. A Caixa de Entrada ganha contador de
  conversas com mensagem nova, no mesmo padrão do contador de Pedidos
  (INBOX-RD-02).
- Cabeçalho de página: h1 de 24 px (20 px no celular), uma linha de contexto e
  a ação primária da tela, que no celular ocupa a largura toda. Sem eyebrow.
- Conexão: verde discreto quando ativa, atenção durante reconexão, erro só
  quando indisponível.
- Títulos recebem foco programático na navegação sem desenhar anel; controles
  sempre mostram o anel.

### Responsividade

- `>= 1200px`: navegação completa e layouts list/detail lado a lado.
- `768–1199px`: sidebar recolhida; painéis secundários abrem em drawer.
- `< 768px`: navegação em drawer, uma coluna e ações primárias fixadas apenas quando isso reduz rolagem.
- Kanban no mobile usa colunas navegáveis com nome e contagem sempre visíveis; não comprime todas as colunas na tela.
- Tabelas priorizam colunas essenciais e oferecem detalhe por linha; rolagem horizontal não é a única forma de acessar informação.

## 8. Biblioteca de componentes

### Primitivos obrigatórios

| Componente                      | Variantes ou responsabilidades                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                        | secundário por padrão; `.primary` (uma por região), `.quiet`, `.danger`, `.link-button`; `.button-link` para links com cara de botão; loading e disabled                                                      |
| `IconButton`                    | alvo mínimo de `44×44px`, tooltip e nome acessível                                                                                                                                                            |
| `Field`                         | label visível, descrição, input/select/textarea, erro e estado obrigatório; variante **em linha** (rótulo à esquerda, campo à direita) para edição no lugar; uma só anatomia de campo em todo o produto (§20) |
| `FieldGap`                      | `Badge` de atenção "Falta" sob o campo exigido para concluir a tarefa; ligado ao campo por `aria-describedby`, com `aria-required`; nunca `aria-invalid` (§20)                                                |
| `SaveStatus`                    | "Salvando…" → "Salvo" no cabeçalho da seção, `role="status"`, texto + ícone; falha vira erro no campo (§20)                                                                                                   |
| `BlankRow`                      | última linha de uma lista editável, sempre vazia e tracejada; preencher cria a linha; substitui "Adicionar linha" (§20)                                                                                       |
| `InlineConfirm`                 | confirmação de ação destrutiva no próprio item: pergunta, `Manter` e `Remover`; foco em `Manter`, Esc cancela (§20)                                                                                           |
| `Checkbox` / `Radio` / `Switch` | label clicável, foco visível e estado indeterminado quando necessário                                                                                                                                         |
| `SearchField`                   | limpeza, atalho opcional e anúncio de resultados                                                                                                                                                              |
| `Badge` / `Status`              | texto + ícone; nunca somente cor                                                                                                                                                                              |
| `Panel` / `Card`                | estrutura visual; não deve embutir regra de domínio                                                                                                                                                           |
| `Tabs`                          | setas entre abas, `Home/End` e associação `tab`/`tabpanel`                                                                                                                                                    |
| `Menu` / `Popover`              | foco gerenciado, Escape e retorno de foco                                                                                                                                                                     |
| `Dialog` / `Drawer`             | título, descrição, foco contido, Escape e ação explícita                                                                                                                                                      |
| `Toast`                         | feedback breve; erros persistentes também aparecem junto ao contexto                                                                                                                                          |
| `EmptyState`                    | motivo, ação recuperável e sem ilustração excessiva                                                                                                                                                           |
| `Skeleton`                      | mesma geometria do conteúdo; respeita reduced motion                                                                                                                                                          |
| `DataTable` / `DataList`        | cabeçalhos reais, seleção, ordenação e alternativa responsiva                                                                                                                                                 |
| `Tooltip`                       | apoio curto; nunca guarda informação necessária para concluir tarefa                                                                                                                                          |
| `ThemeSwitcher`                 | `Claro`, `Escuro`, com rótulo acessível                                                                                                                                                                       |

### Composição de domínio

Componentes de domínio devem compor os primitivos acima, sem duplicar estilo ou interação:

- `ConversationListItem`, `ConversationPanel` e `LeadConversionAction`;
- `KanbanColumn`, `OpportunityCard` e `StageChangeDialog`;
- `AgentActivity`, `HandoffSummary` e `AuditTimeline`;
- `OrderSheetSection`, `OrderValidationSummary` e `OrderSendStatus`;
- `SalesKpi`, `SalesFilterBar`, `SalesDataTable`, `ActionRow`,
  `ActionDetail`, `ReasonSheet` e `Meter` (regras na §18, ACT-T04);
- casca de jornada, grupo de mensagens, compositor, selo de status com ícone
  e aviso de mensagem nova (regras abaixo e na §21, INBOX-RD).

Cada componente precisa documentar: propósito, anatomia, variantes, estados, comportamento responsivo, teclado, ARIA e exemplos de uso/não uso.

### Componentes da Caixa de Entrada — INBOX-RD (11/11/2026)

Decisão do PO em 11/11/2026 ([ADR 084](docs/adr/084-caixa-de-entrada-refinada.md),
§21). Compõem os primitivos acima e os da §20; não criam estilo novo de
botão, campo, selo ou painel (§15).

#### Casca de jornada

- **Propósito:** dar uma só forma às tarefas que comprometem algo (gerar,
  enviar, vincular) e precisam de foco protegido.
- **Deriva de:** `Dialog`. Os campos de dentro são o `Field` da §20 e o
  retorno de cada ação segue o `SaveStatus` da §20.
- **Anatomia:** `dialog` modal em três faixas: cabeçalho com título
  (`--text-lg`, peso 600) e fechar em botão de ícone com o nome que o produto
  já usa ("Fechar cotação"); corpo rolável; rodapé com as ações, uma só
  primária por etapa. Elevação `--elevation-floating` e largura
  `--journey-inline-size` (40rem no protótipo). No corpo, grupos por
  proximidade (8 px dentro, 24 px entre regiões) e listas em linhas com
  divisor; nenhuma caixa com borda dentro da casca.
- **Estados:** uma etapa por vez, com o título acompanhando a etapa;
  carregando, vazio, erro e retorno desenhados (§16).
- **Responsivo:** no celular, folha inferior de largura total, com os botões
  do rodapé empilhados.
- **Teclado/ARIA:** `aria-labelledby` no título; foco contido; ao abrir, o
  foco vai ao primeiro campo da etapa; Esc numa etapa interna volta à etapa
  anterior com o foco no botão que a abriu; Esc na primeira etapa fecha e
  devolve o foco ao acionador. Erro recebe foco em `role="alert"`; retorno
  recebe foco em `role="status"`.
- **Usar:** frete na conversa (INBOX-RD-06). A cobrança entra depois do
  PR 348 (§16).
- **Não usar:** diálogo sobre diálogo (§15), caixa com borda para cada grupo,
  botão de texto para fechar no cabeçalho, duas primárias no rodapé.

#### Grupo de mensagens

- **Propósito:** ler o histórico sem repetir quem falou em cada mensagem.
- **Deriva de:** composição do `ConversationPanel`; nenhum primitivo da §20.
- **Anatomia:** mensagens seguidas do mesmo autor formam um grupo: avatar e
  nome uma vez (`--text-sm`, peso 600), balões com 4 px entre si e a hora em
  `--text-xs` atenuada dentro de cada balão; 16 px entre grupos. A coluna do
  histórico é centralizada e não passa de `--inbox-thread-max-inline-size`
  (48rem no protótipo); o balão não passa de
  `--inbox-message-max-inline-size` (34rem no protótipo).
- **Estados:** cliente à esquerda; vendedor e agente à direita, com a cor de
  cada autor que o produto já usa. A mensagem do cliente com CEP mantém o
  atalho "Cotar para CEP 00000-000".
- **Responsivo:** no celular a coluna ocupa a largura da conversa; a largura
  máxima do balão continua valendo.
- **Teclado/ARIA:** continua a lista ordenada "Histórico da conversa". O
  cabeçalho visível do grupo fica fora da leitura; cada mensagem começa com
  autor e hora em texto só para leitor de tela, então nada se perde ao
  agrupar.
- **Usar:** sempre que duas ou mais mensagens seguidas têm o mesmo autor.
- **Não usar:** para juntar autores diferentes do mesmo lado (vendedor e
  agente ficam em grupos separados) nem para esconder a hora.

#### Compositor

- **Propósito:** escrever e enviar a resposta, com as ferramentas da
  conversa à mão.
- **Deriva de:** `Field` da §20 para o campo de resposta e `IconButton` para
  as ferramentas.
- **Anatomia:** duas linhas. Em cima, o campo "Responder" com borda
  `--color-border-strong`, fundo `--color-surface`, raio `--radius-md`, foco
  e erro do `Field`; o texto do campo usa `--text-sm` no notebook e
  `--text-base` no celular, com peso 400, porque é o texto que o cliente lê.
  Embaixo, dois grupos separados por divisor: mídia (Anexar arquivo, Gravar
  áudio) e pedido (Cobranças e pagamentos, Cotar frete), com 8 px entre
  botões; à direita, "Enviar resposta", a única primária. Com 40rem ou mais
  de largura, as duas ferramentas do pedido e o envio mostram ícone e texto;
  abaixo disso, só ícone.
- **Estados:** ocioso (Enviar indisponível até haver texto); gravando
  ("Gravando áudio. Pare para revisar.", "N de 300 segundos", Parar gravação
  e Descartar gravação, o resto indisponível); indisponível (campo e
  ferramentas com `aria-disabled`, ainda focáveis, e o motivo visível, como
  "Somente o vendedor responsável pode responder."). As ferramentas do pedido
  não aparecem para quem não pode usá-las. Antes de assumir não há
  compositor (PCX-15).
- **Responsivo:** no celular a barra inferior sai e o compositor encosta no
  teclado (§9); se ela sai ao focar o campo ou só enquanto se digita está
  pendente (§21). Se o rótulo "Responder" fica visível ou continua só para
  leitor de tela também está pendente (§21).
- **Teclado/ARIA:** Enter envia e Shift+Enter quebra a linha; no toque, só o
  botão envia. Cada botão mantém `aria-label` e `title`. Ao gravar o foco vai
  para Parar gravação; Esc descarta e devolve o foco a Gravar áudio. O motivo
  da indisponibilidade é a descrição acessível de cada controle.
- **Usar:** no rodapé da conversa, depois que alguém a assume.
- **Não usar:** campo sem borda, uma caixa em volta de tudo, uma segunda
  primária, ferramenta que some sem explicação.

#### Selo de status com ícone

- **Propósito:** dizer o estado de pedido, assunto, cobrança ou frete sem
  depender de cor.
- **Deriva de:** o `Badge` de atenção do `FieldGap` da §20 (ícone de 14 px e
  4 px até o texto).
- **Anatomia:** `.badge` com tom, ícone e o rótulo literal do domínio
  ("Confirmado", "Pendente", "Em foco").
- **Estados:** sucesso (`check`), atenção (`alert`), informação (`info`),
  erro (`alert`) e neutro.
- **Responsivo:** o rótulo não trunca; o selo quebra para a linha seguinte.
- **Teclado/ARIA:** não é controle. O ícone é decorativo (`aria-hidden`); o
  texto carrega o estado.
- **Usar:** na lista, no cabeçalho da conversa e no painel Atendimento
  (INBOX-RD-04).
- **Não usar:** só cor, só ícone, ou como botão. O mapa de tom e ícone dos
  estados de cobrança espera o PR 348 (§21, pendências).

#### Aviso de mensagem nova

- **Propósito:** avisar que um cliente escreveu e ninguém abriu a conversa
  neste navegador.
- **Anatomia:** quatro peças que leem a mesma marca: o selo "Mensagem nova"
  (tom informação, ícone e texto), sempre o primeiro selo do card, com a
  prévia em `--color-text` peso 500; o contador `nav-count` no item Caixa de
  Entrada do rail e no item Caixa da barra inferior; "(N) " no início do
  título do documento; a faixa `.inbox-notice.inbox-live-notice` "N conversas
  com mensagem nova em Responder" com o botão `quiet` "Ver mensagens novas".
- **Estados:** com marca e sem marca. O selo conta no limite de dois selos
  visíveis do card; os demais vão para "+N". O contador e o "(N) " somem em
  zero e contam conversas, não mensagens. A faixa só aparece quando há marca
  fora da vista (outra aba selecionada, lista rolada ou busca que esconde o
  card) e some quando a última marca é aberta.
- **Responsivo:** igual em todas as larguras; no celular o contador fica no
  ícone da barra inferior.
- **Teclado/ARIA:** o nome acessível do card começa com "Mensagem nova."; o
  selo visível fica fora da leitura para não repetir. O número entra no nome
  do link da navegação ("Caixa de Entrada, 2 conversas com mensagem nova").
  "Ver mensagens novas" vai para a aba Responder, limpa a busca, rola a lista
  ao topo e leva o foco ao primeiro card marcado. A faixa não é região viva:
  o anúncio sai uma vez por chegada, pela região `role="status"` do shell.
- **Usar:** só para mensagem do cliente numa conversa que não está aberta.
- **Não usar:** bolinha colorida sozinha, a palavra "Nova" sozinha (é nome de
  estado de conversa), negrito no nome do contato, marca para mensagem do
  vendedor ou do agente, som, ação primária na faixa ou foco roubado na
  chegada.

## 9. Padrões por superfície do CRM

> Desde o [ADR 036](docs/adr/036-padroes-de-jornada.md) (RFC 024, 15/10/2026),
> os padrões de jornada da §16 prevalecem sobre esta seção onde divergirem.
> O texto abaixo foi alinhado na T133 ao que as fatias entregaram em
> `ux/jornadas`: filtros e cabeçalho da Caixa de Entrada, link do pedido no
> lugar da gaveta, "Assumir atendimento" no composer e a página do pedido.
> Em 11/11/2026 (ADR 084, INBOX-RD-T00) a "Caixa de Entrada" abaixo foi
> conferida contra o código: as abas são as da ADR 065, "Assumir
> atendimento" fica no cabeçalho (PCX-15) e "Mais" é ancorado em todas as
> larguras. O refinamento aprovado nessa data está na §21.

### Caixa de Entrada

Apresentação refinada aprovada em 04/11/2026 (INBOX-UX-04, PCX-16a–h):
na Inbox, rail de 56 px e topo de 48 px deixam mais espaço para o chat;
expandir a navegação sobrepõe a lista e preserva a preferência manual. O
acionador usa só ícone, nome acessível, dica e estado. Ampliar conversa libera
a coluna da lista sem remontar histórico nem perder rascunho. Demais telas
preservam seus tamanhos de shell.

Abas por vez de responder ([ADR 065](docs/adr/065-caixa-de-entrada-por-vez-de-responder.md),
RFC 052, PCX-19, 08/11/2026) substituem os atalhos Atender / Fechar pedidos
/ Todas de INBOX-UX-06 (PCX-18) e Todas · Aguardando vendedor · Meus
atendimentos de PCX-14. Responder, Aguardando, Sem retorno e Perdidos formam
um `tablist` ("Vez de responder") acima do workspace, com setas, Home e End;
a contagem entra no nome acessível ("Responder, 12 conversas") e o número de
Responder ganha tom de atenção quando há conversa. A ordem da aba aparece no
resumo da lista ("· Mais recentes primeiro"). Seguem o botão `soft` Filtros,
com o número de filtros ativos, e o resumo "Filtro:" com um chip por filtro
e "Limpar filtros" quando há mais de um. No celular o botão Filtros vai para
a linha da busca. Filtros abre a folha "Filtrar conversas" com Responsável
(Todos, Minhas, Sem dono; a escolha fica no navegador), Pedido ("Só pedidos
prontos", só para conversas em andamento) e Consultar (Em andamento (abas),
Encerradas, Arquivadas); consultar encerradas ou arquivadas esconde as abas.
Ver resultados aplica o rascunho, "Limpar filtros" prepara a remoção e
Escape ou fechar descartam edições não aplicadas, devolvendo foco ao botão.
A busca fica na lista e vale só para as conversas carregadas, por contato,
telefone ou última mensagem. Ver mais conversas percorre as páginas
oficiais sem trocar a seleção ou o rascunho. Mais ações é ancorado em todas
as larguras, sem alterar capacidades ou confirmações.
Sugestões ficam fora das mensagens, abertas quando pendentes e recolhíveis;
histórico/omissão/bloqueios ficam em Atendimento, com uma única instância
persistente. Resumo inicia compacto, preservando aviso comercial, vendedor
solicitado e acesso ao texto completo. Estes pontos prevalecem sobre a
apresentação anterior abaixo; contratos comerciais permanecem iguais.

Workspace de altura fixa para a atendente (pesquisa UX de 15/10/2026, achado 1):
a página ocupa exatamente a altura abaixo da barra superior e nunca rola; cada
coluna rola por dentro.

- **Colunas (INBOX-UX-03):** lista | conversa. Atendimento e Cadastro abrem
  somente sob demanda, em painéis modais sobrepostos em todas as larguras;
  não comprimem o histórico nem reabrem por preferência antiga. O ícone
  Detalhes abre Atendimento; o nome abre Cadastro. Escape fecha e devolve
  foco ao acionador. Atendimento separa Pedidos e assuntos de Resumo; hoje
  com dois botões `aria-pressed` num grupo, que INBOX-RD-08 troca por `Tabs`.
- **Ampliar conversa:** fora do celular, um botão de ícone na barra da tela
  ("Ampliar conversa" / "Mostrar lista de conversas", com `aria-pressed`)
  esconde e devolve a lista (PCX-16e).
- **Celular primeiro (ADR 035):** desenhada para 390×844 e ampliada. Lista e
  conversa são telas separadas, com voltar; o cabeçalho mantém só o voltar,
  o nome clicável, o link do pedido quando há pedido, `Assumir atendimento`
  ou `Criar pedido` quando cabe (ver "Cabeçalho da conversa"), `Mais` e o
  ícone Detalhes. `Mais` abre um menu ancorado ao botão, como no notebook,
  com Criar pedido quando não cabe no cabeçalho, Transferir atendimento,
  Arquivar ou Desarquivar conversa e Encerrar conversa. A
  resposta fica acima da barra; ao digitar, a barra sai e a resposta encosta
  no teclado (`interactive-widget=resizes-content`). Alvos de 44 px; nada
  depende de hover.
- **Endereço:** `/inbox/:conversationId` abre a conversa direto (Pedido,
  Clientes e Dashboard linkam assim). A conversa aberta pelo endereço continua
  aberta mesmo fora do filtro, arquivada ou além das 100 carregadas; trocar de
  conversa muda o endereço sem recarregar a lista, a busca ou os filtros. No
  celular o endereço decide entre a lista e a conversa (voltar = `Conversas`).
- **Filtros e links (PCX-19, RFC 052):** abas, busca e folha como descrito
  acima. Os links do Painel continuam valendo, mapeados para as abas: `?aba=`
  escolhe a aba, `?fila=` o responsável, `?situacao=` as filas antigas e
  `?responsavel=` as conversas de um vendedor (PNL-06). Vazio por busca
  ("Nenhuma conversa encontrada"), vazio por filtro ("Nenhuma conversa com
  esse filtro" + `Limpar filtros`) e vazio da aba ("Ninguém esperando
  resposta" em Responder) são diferentes. Os atalhos de PCX-14 e PCX-18, a
  Situação da folha, as abas de estado e o seletor "Fila" deixaram de
  existir.
- **Lista (card da RFC 052):** quem e há quanto tempo (nome, ícone do canal e
  tempo da vez, com a frase completa para leitor de tela e na dica), o que
  foi dito (prévia com o autor) e até dois selos, com os demais em "+N". Só
  o selo de falha de envio tem ícone hoje (INBOX-RD-04 dá ícone a todos). O
  item aberto usa `--color-selected` e `aria-current`, sem borda lateral
  colorida.
- **Cabeçalho da conversa:** compacto, nome clicável, o link do pedido e uma
  linha com canal e atendimento. Telefone e cadastro ficam no painel do nome;
  metadados ficam em Atendimento › Resumo. Assumir é a única primária antes
  da tomada humana (PCX-15); depois Enviar é a primária no compositor. Com pedido, o link
  "Pedido NN-CRM" com o status em selo de texto (sucesso para Confirmado,
  atenção para os demais; hoje sem ícone) abre `/pedidos/:id?conversa=`
  e acompanha `inbox.order.changed` (PCX-10); sem pedido, nada aparece.
  `Criar pedido` fica no cabeçalho só para o dono de conversa humana, sem
  handoff pendente e sem pedido; os outros casos que a API aceita
  (administrador, agente ainda atendendo, pedido já confirmado) vão para
  `Mais` (PCX-11). Depois vêm `Mais` (Transferir atendimento,
  Arquivar/Desarquivar conversa e Encerrar conversa em todas as larguras,
  PCX-13) e o botão de ícone Detalhes do atendimento. `Mais` abre pelo
  teclado no primeiro item e Esc devolve o foco. "Transferir atendimento"
  abre, abaixo do cabeçalho, o formulário "Transferir atendimento para" com
  o seletor, "Confirmar transferência" (hoje primária) e Cancelar. A gaveta
  do pedido e o botão "Pedido · status" foram removidos (T126).
- **Atendimento › Pedidos e assuntos (PCX-12):** número, status, itens,
  total, valor e `Abrir pedido`, só para leitura; as pendências aparecem em
  disclosure, agrupadas por item e pedido. Dados ainda indefinidos mostram
  A definir, sem sugerir quantidade ou valor zero. Mantém carregando, erro
  com `Tentar novamente` e "Sem pedido nesta conversa." uma vez só. Hoje a
  avaliação das sugestões de pedido vem antes do resumo do pedido, e depois
  vêm os Assuntos do atendimento; INBOX-RD-08 põe o resumo em primeiro.
- **Histórico:** abre na última mensagem e acompanha as novas, salvo quando a
  pessoa rolou para ler algo antigo; conversa curta fica junto da resposta.
  Hoje cada mensagem repete avatar, autor, papel e hora, e os balões ocupam
  a largura do painel (INBOX-RD-03 agrupa e limita a coluna). Na mensagem do
  cliente que traz um CEP, quem pode cotar frete vê o atalho "Cotar para CEP
  00000-000", que abre a cotação com o CEP de destino preenchido.
- **Assumir no cabeçalho (PCX-15):** enquanto ninguém assumiu e quem
  abre pode agir, a região abaixo do cabeçalho mostra o motivo da parada e o tempo parado
  (PCX-03), ou que o agente está atendendo e não volta depois (ADR 015), com
  `Assumir atendimento` como única primária da conversa. Depois de assumir,
  o campo de resposta aparece com `Enviar resposta` como única primária e
  recebe o foco; o resultado é anunciado em `role="status"`. Quem não pode
  agir vê o aviso "Esta conversa está sob responsabilidade de outro
  vendedor…" e o composer desabilitado com o motivo.
- **Faixa da vez (INBOX-VEZ-03, RFC 052):** acima da resposta. Em Sem
  retorno, diz há quanto tempo o cliente não responde (e o lembrete, se
  houver) e oferece `Lembrar depois`, que abre o formulário "Quando lembrar
  você?" (data e horário de São Paulo, até 90 dias, sem mensagem ao cliente;
  `Salvar lembrete` e `Cancelar`, Esc fecha), e `Marcar perdido`, que abre o
  diálogo de motivo e fica com `aria-disabled` e o motivo quando não é
  possível. Em Perdidos, "Marcada como perdida · motivo · quando" e
  `Reabrir`. Retomar é a própria resposta; fora desses estados a faixa não
  aparece.
- **Resposta:** visível no rodapé da conversa assim que alguém a assume. Enter envia, Shift+Enter
  quebra a linha; em teclado de toque Enter só quebra a linha. Hoje é uma
  caixa única: o campo "Responder" (rótulo só para leitor de tela,
  placeholder "Escreva uma mensagem…", até 2000 caracteres, sem borda
  própria) e, numa linha, Anexar arquivo, Cobranças e pagamentos, Cotar
  frete, Gravar áudio e Enviar resposta, todos só com ícone, nome acessível e
  dica, com 4 px entre eles. Gravando, aparecem Parar gravação e Descartar
  gravação. Cotar frete aparece para quem tem a função Vendedor e é o dono da
  conversa ou administrador; Cobranças e pagamentos também para administrador
  que pode responder. Controles indisponíveis usam `disabled`. O hint de
  envio fica sob demanda. INBOX-RD-05 (§21) redesenha o compositor.
- Conversa encerrada informa Atendimento concluído ou Sem pedido neste
  atendimento; isso não altera status nem dados de pedidos (CP-07..10).

### Kanban Comercial

- Backlog não aparece como coluna.
- Cabeçalho de coluna exibe nome, contagem e limite quando existir.
- O drag-and-drop é um acelerador, não o único mecanismo: cada card possui ação de mover acessível por teclado.
- Antes de mover, a UI informa campos pendentes ou regra de passagem.
- `Fechado` e `Perdido` são resultados explícitos; `Perdido` exige motivo.

### Conversa e atuação do Vendedor Silmer

- Mensagens humanas, do cliente e do agente são visualmente distintas, mas permanecem legíveis nos dois temas.
- A área de composição mantém uma ação principal de envio e torna anexos/ações extras secundários; antes de alguém assumir, `Assumir atendimento` ocupa o lugar dela (PCX-13).
- Mensagens, sugestões e handoffs do agente aparecem em uma linha do tempo auditável, agrupada por etapa.
- Sugestões como `Transformar em lead` e `Avançar etapa` exigem confirmação humana explícita no MVP; a interface nunca representa a sugestão como ação já executada.
- A chave pós-MVP `vendedor_silmer_autonomia_comercial` não aparece como controle operacional do MVP.
- Handoff mostra motivo, resumo, responsável e ação para assumir; não depende de toast.
- Reversão identifica impacto antes de confirmar.

### Ficha de Pedido

A refinação aprovada em 12/11/2026 (cabeçalho com fatos-chave, ficha em uma
folha, rail de Fechamento antes da ficha abaixo de 75rem, Datas e Arte
refinadas) está na [§22](#22-pedido-refinado--ped-rd-12112026). Até cada
tarefa ser entregue, a §9 descreve o que o código faz.

A página do pedido (`/pedidos/:id`) segue a ordem da ficha impressa, com as
palavras da tela (PFI-01, PFI-20): Resumo do pedido, Datas do pedido, Itens e
especificações, Arte do pedido, Observações do pedido, Dados do atendimento
(não impresso) e Fechamento e pagamento. O bloco "Controle de produção" não
aparece na tela; ele só existe na ficha impressa. As fichas v2 a v7 mantêm
"Lastro do pedido" e os mesmos templates e hashes; a v8 (ADR 078, FPI-01) não
tem esse título e imprime os dados em cada folha, sem Pago em.

- **Progresso real no topo (PFI-15):** "Para gerar o pedido: N de 3", com os
  passos Previsão de entrega, Itens e Arte do pedido, lidos só de
  `missingFields`; só o próximo passo tem botão, com verbo e objeto
  ("Informar a previsão de entrega", "Completar os itens", "Marcar quem faz a
  arte"). Uma pendência que a tela não conhece vira o passo "Revisar
  pendências" e o total passa a 4, nunca um falso "3 de 3". Com os três
  passos feitos, o progresso vira uma linha só ("Tudo pronto para gerar · 3
  de 3"), com o mesmo título e o mesmo `role="status"`. Não aparece para
  quem não edita, para pedido confirmado nem para pedido da loja.
- **Cabeçalho de seção (PFI-17):** título, estado em texto com ícone
  ("Entrega 20/11/2026", "Falta: cor do item 1", "1 item · 150 peças", "1 de
  3 datas") e o `SaveStatus`. Decisão do PO em 10/11/2026 (§20): os botões
  `Editar resumo`, `Editar datas`, `Editar itens`, `Editar arte` e `Editar
observações` saem; quem pode editar encontra os campos abertos. Enquanto
  uma seção não for migrada, ela mantém o botão e o bloqueio "Salve ou
  cancele a edição aberta."; nenhuma seção nova nasce com eles.
- **Itens e especificações (§20, protótipo
  `output/prototipos/itens-especificacoes/`):** um cartão por item. Cabeçalho:
  número na linha do nome, "MODELO · Público", peças e valor, e o menu "Mais
  ações do item N" (Duplicar para outro público, Mover, Remover). Corpo:
  `Field` em linha na ordem Modelo, Cor, Aplicação, Malha, Gola; adicionais
  entram um a um por botão quieto e só aparecem com dado. Tamanhos: uma
  linha por tamanho com Tamanho, Quantidade e Subtotal, a `BlankRow` no fim
  e o total do item. Sem botões de − e +, sem reordenar tamanhos e sem o
  passo "Usar subtotais por tamanho": o subtotal existe desde a primeira
  linha. No notebook, especificações à esquerda e tamanhos à direita.
- **Acordeão no celular (PFI-18):** até 768 px, uma seção aberta por vez,
  Dados do atendimento inclusive; acima disso, tudo aberto e empilhado.
- **Arte do pedido (PFI-20):** quem faz a arte ("A {empresa} cria a arte" com
  `brand.companyName`), arte final ("A versão aprovada que vai para a
  produção.") e arquivos da arte ("Referências e rascunhos; não vão para a
  produção."), com um só controle de adicionar arquivo por vez.
- **Rodapé e diálogo (PFI-16, PFI-19):** no celular o rodapé fixo leva o
  próximo passo enquanto houver pendência e `Gerar pedido` só sem pendência;
  `Gerar pedido` abre o diálogo "Gerar o pedido" com a revisão, `Valor final`
  e `Forma de pagamento`. O painel "Fechamento e pagamento" do pedido
  pendente mostra só "Falta para gerar" e `Gerar pedido`.
- Erros aparecem no campo; a pendência que o servidor recusar fecha o
  diálogo e leva ao próximo passo.
- Gerar e imprimir são ações distintas; estado, autor e horário da
  confirmação permanecem visíveis.

### Financeiro comercial

- O topo apresenta total vendido, quantidade de vendas e ticket médio no período.
- Toda métrica mostra período, unidade e regra de inclusão.
- Gráficos são complementares; valores exatos continuam disponíveis em texto/tabela.
- Cancelamentos permanecem no histórico e não somem silenciosamente.
- Formatação monetária usa `pt-BR` e valores alinhados por casas decimais.

## 10. Interação e movimento

- Hover/foco: `120–160ms`.
- Expansão, drawer e popover: `180–240ms`.
- Dialog: até `240ms`.
- Movimento serve para explicar mudança de estado, não para decorar.
- Não animar continuamente cards, métricas, badges ou indicadores de automação.
- Respeitar `prefers-reduced-motion: reduce` e remover transições não essenciais.
- Nunca atrasar uma ação crítica para concluir uma animação.

## 11. Acessibilidade

- Texto normal: contraste mínimo `4.5:1`; texto grande e limites de controles: `3:1`.
- Alvo mínimo de toque: `44×44px`.
- Todos os controles funcionam por teclado e possuem foco visível de pelo menos `2px` com offset.
- Ordem de foco acompanha a ordem visual e não atravessa regiões escondidas.
- Dialogs, drawers, menus, tabs, comboboxes e Kanban mantêm ARIA dinâmica conforme o estado.
- Mudanças assíncronas relevantes usam região `aria-live`; mensagens não devem ser repetidas excessivamente.
- Ícones decorativos usam `aria-hidden="true"`; botões apenas com ícone recebem nome acessível.
- Drag-and-drop sempre possui alternativa por botão/teclado.
- Zoom a `200%`, reflow a `320px` e preferências de contraste/movimento não podem bloquear tarefas.
- Status combina texto, forma/ícone e cor.

## 12. Linguagem e conteúdo

- Usar português brasileiro direto e termos já definidos pelo domínio.
- Botões começam com verbo: `Transformar em lead`, `Aprovar Ficha`, `Tentar envio novamente`.
- Confirmações descrevem consequência: “A conversa será encerrada como Sem lead. O histórico será preservado.”
- Evitar “OK”, “Confirmar” ou “Erro inesperado” quando uma ação ou recuperação específica puder ser nomeada.
- Datas, valores, telefone e quantidade seguem formatação local consistente.
- Dados pessoais não aparecem em notificações globais ou superfícies sem necessidade operacional.

## 13. Arquitetura de implementação visual

- CSS organizado por camadas: `tokens.css` concentra `tokens`; `styles.css` concentra `base`, `layout`, `components` e poucas `utilities`.
- Tokens de tema ficam em `:root` e seletores `[data-theme]`; componentes não conhecem valores hexadecimais.
- Componentes interativos são módulos ESM ou classes isoladas e não registram estado em `window`.
- HTML semântico é a base; ARIA complementa o comportamento que o HTML nativo não cobre.
- Regras de domínio ficam fora dos componentes visuais. Primitivos recebem estado e eventos; composições coordenam o fluxo.
- Utilitários devem ser poucos e semânticos. Evitar uma classe nova para cada valor arbitrário.
- Ícones usam um único conjunto de SVGs de traço consistente; não misturar emoji, ícones preenchidos e outline como linguagem principal.

## 14. Critérios de aceite do design system

Uma tela ou componente só está pronto quando:

- usa tokens semânticos e funciona em light, dark e preferência do sistema;
- possui estados default, hover, focus, active, disabled, loading, empty e error quando aplicáveis;
- pode ser operado integralmente por teclado;
- mantém nome, papel, valor e mudanças de estado compreensíveis para tecnologia assistiva;
- funciona a `320px`, `768px`, `1200px` e com zoom de `200%`;
- não depende somente de cor, hover, drag-and-drop ou toast;
- reutiliza um primitivo existente antes de criar nova estrutura;
- mantém uma única ação primária por região;
- expõe erros perto da origem e oferece recuperação clara;
- não adiciona animação, sombra, gradiente ou container sem função perceptível.

## 15. Antipadrões proibidos

- Copiar a estética promocional do site para todas as telas operacionais.
- Usar o laranja como grande área de fundo ou para múltiplas ações concorrentes.
- Criar cards para todo agrupamento de texto.
- Esconder ações essenciais apenas em hover ou menu de três pontos.
- Usar modal sobre modal.
- Usar placeholder como label.
- Exibir status somente como ponto colorido.
- Criar um novo estilo de botão, input, badge ou panel dentro de uma feature.
- Campo sem borda, sem fundo ou que só parece campo no foco ou no hover.
- Campo cujo único nome visível é o placeholder ou um `aria-label`.
- Pendência mostrada como texto colorido solto, sem ícone e sem ligação com o
  campo.
- Borda tracejada fora de `BlankRow` e de "Adicionar item".
- Modo de edição por seção (Editar → Salvar/Cancelar) em tela nova.
- Um controle próprio para "adicionar linha" quando a `BlankRow` resolve.
- Número, selo ou ícone centralizado contra um bloco de várias linhas: ele
  alinha com a primeira linha de texto.
- Truncar conteúdo crítico sem alternativa para leitura completa.
- Usar drag-and-drop como única forma de alterar etapa.

## 16. Padrões de jornada

Decisão: [ADR 036](docs/adr/036-padroes-de-jornada.md), a partir do
[RFC 024](docs/rfc/024-jornadas-com-menos-botoes.md), aprovado pelo PO em
15/10/2026. Requisitos: PFI-15 a PFI-20, PCX-10 a PCX-14 e PLI-09 a PLI-10
em [Pedidos MVP](.specs/features/pedidos-mvp/spec.md); PNL-01 a PNL-04 em
[CRM MVP](.specs/features/crm-mvp/spec.md). Valem para toda tela nova ou
alterada e completam a §3 (baixa carga cognitiva) e a §11 (acessibilidade).

### Orçamento de ações por região

- No máximo uma ação primária e duas secundárias visíveis por região; o resto
  vai para "Mais".
- **Exceção do compositor (ADR 084, INBOX-RD-05, 11/11/2026):** o
  compositor da conversa pode ter uma primária ("Enviar resposta") e até
  quatro ferramentas, em dois grupos separados por divisor: mídia (Anexar
  arquivo, Gravar áudio) e pedido (Cobranças e pagamentos, Cotar frete).
  Gravando áudio, Parar gravação e Descartar gravação entram e as demais
  ficam indisponíveis. A exceção vale só para o compositor; nenhuma outra
  região a herda, e uma quinta ferramenta exige nova decisão.
- **Jornadas da conversa:** a casca de jornada da §8 vale para o frete
  (INBOX-RD-06). A jornada de cobrança aguarda o PR 348
  (`codex/order-timeline`, contratos BCS-01–09), que reescreve a cobrança do
  pedido; a casca será aplicada a ela depois da mesclagem, em tarefa própria.
- Rótulo de botão é verbo + objeto: "Assumir atendimento", "Editar itens",
  "Limpar filtro"; nunca só "Assumir" ou "Editar".
- Alvos de toque de 44 px ou mais, com 8 px entre eles. Como entregue: nos
  atalhos e chips das listas, o contrato de 44 px e 8 px vale no celular e em
  toda tela de toque (`pointer: coarse`, tablet incluído); com mouse no
  notebook eles seguem a altura de controle (`--control-height`, 40 px). Na
  folha "Filtros", opções e botões têm 44 px (`--target-min`) em qualquer
  largura e ponteiro, notebook com mouse inclusive (P1, `fb7e932`).
- Abas só de 2 a 7, com 1 a 3 palavras cada; mais que isso vira atalho com
  contagem ou filtro em folha.

### Próximo passo único, com progresso real

- Quando uma tarefa tem passos, a tela mostra quantos estão feitos ("Para
  gerar o pedido: 1 de 3") e dá botão só ao próximo passo pendente.
- O progresso é honesto: cada passo é uma pendência real lida do domínio
  (`missingFields`), o total não muda no meio e visitar ou abrir uma seção não
  conta como feito. Sem leitura, não há número.
- Pendência que a tela não conhece vira um passo a mais ("Revisar
  pendências", total "N de 4") que leva ao painel de fechamento; nunca um
  falso "3 de 3" com a ação final bloqueada.
- Com todos os passos feitos, o progresso encolhe para uma linha ("Tudo
  pronto para gerar · 3 de 3"), com o mesmo título e o mesmo `role="status"`;
  a lista volta assim que houver pendência (P2, `3351c33`).
- O rodapé fixo do celular leva a mesma ação primária do próximo passo; a
  ação final ("Gerar pedido") só vira primária quando não há pendência.
- O preenchimento continua progressivo e não linear (`RULES.md`, regra 4):
  nada de assistente em páginas separadas.

### Ação indisponível

- Ação indisponível mas relevante usa `aria-disabled="true"`, continua
  focável e mostra o motivo ao lado ou na descrição acessível ("Salve ou
  cancele a edição aberta", "Falta: previsão de entrega").
- Ativá-la não executa nada nem perde dado; nunca some sem explicação.

### Filtros em folha

- Na lista: busca, até três atalhos com contagem e o botão "Filtros".
- "Filtros" abre uma folha (painel que sobe sobre a tela no celular) com os
  grupos de filtro; Esc fecha e devolve o foco ao botão.
- Os filtros ativos aparecem num resumo, cada um com botão de remover;
  filtro fora dos atalhos aparece nomeado com "Limpar filtro".
- A contagem do resultado fica junto da lista, em região
  `aria-live="polite"`.
- Links profundos por query string abrem a lista com o filtro já no resumo.
- Vazio por filtro é diferente do vazio inicial: diz que nada atende ao filtro
  e oferece "Limpar filtro".

### Acordeão no celular

- Até 768 px, páginas longas de seções viram acordeão de uma seção aberta por
  vez; acima disso, as seções ficam abertas e empilhadas.
- O cabeçalho de cada seção é um botão com `aria-expanded` e `aria-controls`
  e mostra o estado em texto ("Completo", "Falta a cor do item 2"), que entra
  no nome acessível.
- A seção inicial vem do hash da URL (por exemplo `#itens`), senão do
  primeiro passo pendente, senão do Resumo. Com edição no lugar (§20), trocar
  de seção confirma o campo em foco antes de fechar; não há rascunho a
  perder. Numa seção ainda não migrada, ela não fecha até Salvar ou Cancelar
  e o rascunho sobrevive a redimensionar a tela.
- Abrir uma seção grava o hash na URL sem navegar (`history.replace` do
  router), para não remontar a view, que o shell identifica pela `fullPath`,
  e perder foco e rascunho.
- Só em seção ainda não migrada para a §20: o botão "Editar" + seção fica
  fora do botão do cabeçalho (irmão do `h2`) e só aparece na seção aberta;
  com uma seção em edição, os outros cabeçalhos ficam com `aria-disabled` e
  o motivo.

### Um só modelo de edição

- O modelo é a **edição no lugar** (§20, decisão do PO em 10/11/2026): quem
  pode editar vê os campos abertos e cada alteração salva sozinha. Substitui
  "Editar" + seção → Salvar/Cancelar, que permanece só nas seções ainda não
  migradas e não pode ser usado em tela nova.
- Continua valendo um só modelo por tela pronta: uma tela migrada não mistura
  seção com botão "Editar" e seção editável no lugar.
- Fica em diálogo apenas o que compromete ou é irreversível (gerar,
  cancelar, reabrir, enviar).
- O diálogo da ação final (por exemplo, "Gerar o pedido") revisa o que vai
  acontecer, pede só o que falta, foca o primeiro campo e devolve o foco com
  Esc ou "Voltar" ao botão que o abriu (no pedido, o do trilho ou o do
  rodapé do celular).
- Como entregue no diálogo "Gerar o pedido" (T125): revisão com cliente,
  itens e peças, previsão de entrega e arte do pedido; erro no campo sem enviar
  nada; envio único mesmo com Enter duplo (`aria-busy`/`aria-disabled`); 422
  com pendência fora do diálogo fecha, relê o pedido e leva o foco ao próximo
  passo; 409 e queda de conexão mantêm o diálogo aberto com a mensagem
  focada; campos, opções e botões com 44 px.

### Estados desenhados

- Carregando, vazio, erro e sem permissão têm desenho próprio em toda região.
- Erro de leitura nunca vira "0" nem faz a seção sumir: o número mostra "—"
  com "Tentar novamente".
- Sem permissão, a ação não aparece; a API continua autorizando.

### Metas de controles na primeira tela

Contagem fora da navegação do app, com dados sintéticos, em 390×844 e
1366×768. A T132 transforma as metas em teste; as medições registradas pelas
fatias estão no "Resultado" do
[RFC 024](docs/rfc/024-jornadas-com-menos-botoes.md).

| Tela             | Celular                                                       | Notebook            |
| ---------------- | ------------------------------------------------------------- | ------------------- |
| Pedido aberto    | ≤ 12 ações; documento ≤ 1.800 px; nenhum "Editar"; 1 primária | ≤ 16 ações          |
| Conversa         | ≤ 9 antes de assumir; ≤ 12 depois; cabeçalho ≤ 4              | ≤ 24; cabeçalho ≤ 4 |
| Caixa de Entrada | ≤ 15; barra de ferramentas de 7 para 5                        | ≤ 24                |
| Pedidos          | ≤ 12, com o 1º cartão inteiro acima da barra inferior         | ≤ 19                |

Decisão do PO em 10/11/2026 (§20): na tela com edição no lugar a meta conta
**ações** (botões, links e itens de menu visíveis); campos de dados não
contam. O limite de altura do documento vale com as seções do acordeão
fechadas e a seção do próximo passo aberta. A medição do pedido migrado entra
aqui quando a implementação for entregue; até lá a linha é meta, não medida.

INBOX-UX-03, layout autorizado em 03/11/2026: os quatro controles do
cabeçalho incluem o acesso ao cadastro pelo nome, pedido/criação/assumir,
Detalhes e Mais. O novo acesso ao nome e Detalhes direto no celular passam
a contar nesse limite; os orçamentos da primeira tela e a primária única
permanecem. Detalhes não se repete no menu Mais. Ícones menores preservam
alvos de pelo menos 40 px, com 44 px no compositor e no toque.

---

Este documento define a direção visual. Etapas do Kanban, permissões, campos obrigatórios da Ficha e vocabulário financeiro estão resolvidos nos documentos canônicos e prontos para especificação e implementação pelo Tech Lead.

## 17. Ênfase por função — UX-FUNC-01 (04/11/2026)

Complementa a fundação da ADR 035 e os padrões da ADR 036, preservando marca,
temas, layout e a única ação primária por região.

- **Compromisso:** `primary`, preenchimento de marca e peso 600. É a ação
  principal de enviar, gerar ou assumir. **Continuidade:** `soft`, fundo suave,
  texto de ação e peso 600, para abrir filtros ou recuperar uma lista.
- **Alternativa:** botão padrão com borda, peso 500 e sem sombra. **Utilidade:**
  `quiet` ou botão de ícone, fundo transparente e alvo preservado. **Navegação:**
  link; abrir um pedido na linha não compete visualmente com executar sua ação.
  Risco usa a semântica destrutiva existente, sem tornar toda ação vermelha.
- **Chip seleciona ou remove:** a seleção é neutra/roxa e nomeada;
  `FilterChip` remove o critério com nome acessível e fechamento explícito.
  **Badge informa:** raio pequeno, peso 500 e texto de status; não imita botão.
- **Hint explica:** `AppHint` neutro para contexto, informação para limites e
  mudança de escopo, atenção para impedimento recuperável, erro para falha e
  sucesso para prontidão. O texto dá significado; ícone e cor o reforçam.
  Apenas resultados assíncronos relevantes recebem região de anúncio.
- **Cores têm papel:** seleção não é prontidão. Edição em andamento usa
  informação; pronto usa sucesso, atenção e erro permanecem operacionais.
  Labels usam peso 500; valores e títulos usam 600/700 conforme a hierarquia.
- **Elevação tem função:** botões e links em repouso ficam planos;
  menus, painéis sobrepostos e folhas usam `--elevation-floating`.
- **Filtros:** PLI-09 continua sendo uma visualização exclusiva. A folha
  explicita a troca; não apresenta combinação que a API não suporta. Vazio de
  filtro oferece limpar filtro; vazio de busca oferece limpar busca e retorna
  foco ao campo. A busca em visão de entrega avisa que muda para todos.
- **Compositor:** cada conversa mantém seu próprio rascunho temporário; o
  término de um envio não muda o contexto que o vendedor está operando.

## 18. Central de ações — ACT-01–12 (05/11/2026)

Protótipo refinado aprovado, RFC 044 / ADR 059. O vendedor abre uma fila
compacta de objetos reais, com filtros por intenção e detalhe por seleção.
No celular, fila e detalhe ocupam momentos separados, com volta e foco
previsíveis. Usar os tokens existentes, seleção neutra e cor de atenção
apenas quando a ação exigir; sem composer ou chat paralelo.

Conferências perguntam se o pedido foi pago integralmente ou entregue;
silêncio do cliente gera sugestão, nunca diagnóstico. Formulário captura
versão e valor ao abrir, preserva rascunho na falha e exige nova revisão
explícita diante de conflito. Lembrete não comprova quitação/entrega.

O orçamento do vendedor na primeira tela, com fixture de cinco objetos,
passa a 9 controles em 390×844 e 14 em 1366×768: inclui quatro filtros e
cinco objetos selecionáveis. Gestor preserva 11/12. Filtros têm quatro
controles e a tarefa tem no máximo três ações no contexto. Substitui apenas
o orçamento anterior do Dashboard informacional do vendedor.

Performance e checkpoint apresentam estados de erro e cobertura explícitos.
Prévia do checkpoint não equivale a envio; aceito pelo provedor não equivale
a entregue. Sem indicadores artificiais de conversão entre coortes distintas.

### Componentes e regras do Dashboard (ACT-T04) — 05/11/2026

Escala o redesenho do Dashboard ao design system. Os componentes abaixo
compõem os primitivos da §8 e não criam estilo novo de botão, badge ou
painel (§15). Nada aqui altera ACT-01–12 ou PERF-01–08; onde um item
depende de decisão ainda não registrada, isso está dito no próprio item.

#### `SalesKpi`

- **Propósito:** mostrar um número do período e levar à lista que o explica.
- **Anatomia:** rótulo (`--text-xs`/`--text-sm`, peso 500, cor secundária),
  valor (`--text-xl`, peso 600, `tabular-nums`) e contexto curto (período,
  unidade ou regra de inclusão). Card `--radius-lg`, `level-1`.
- **Estados:** carregando (skeleton com a mesma geometria), com valor, sem
  dado (“—” + motivo, por exemplo “Sem atribuição registrada”), erro (“—” +
  “Tentar novamente”, §16). Sem dado ou erro nunca mostram “0”; zero só
  quando a apuração retornou zero.
- **Responsivo:** grade de 2 colunas no celular, 4 no notebook; o valor não
  trunca, o contexto quebra linha.
- **Teclado/ARIA:** o card inteiro é um único link (`<a>`) para a lista
  filtrada; o nome acessível reúne rótulo, valor e contexto. Sem botão
  interno. Foco visível no card.
- **Usar** para totais do período. **Não usar** para nota, meta ou ranking
  (PERF-06), nem quando não há lista de destino.

#### `StatusBadge`

- **Propósito:** informar estado; não é botão nem filtro (§17).
- **Anatomia:** ícone + texto, sempre os dois; raio `--radius-sm`, peso 500,
  `--text-xs`. Tons `success`, `warning`, `error` e `info` usam apenas
  `--status-*-surface` e `--status-*-text`.
- **Estados:** estático; não tem hover, foco nem seleção.
- **Responsivo:** não quebra linha; em espaço curto, o texto encurta para
  um termo equivalente, nunca some.
- **Teclado/ARIA:** ícone `aria-hidden="true"`; o texto é o significado.
- **Variante “Proposta”** (borda tracejada): só em protótipo, para marcar
  métrica que depende de RFC pendente. **Proibida em produção**; métrica
  sem decisão não é entregue.
- **Não usar** cor sozinha, ponto colorido ou badge como ação clicável.

#### `ActionRow`

- **Propósito:** uma linha da fila da central (ACT-01/02).
- **Anatomia:** avatar (`--radius-pill`), quem, verbo + motivo (“Responder
  — cliente aguarda”), selo de prazo/espera em `StatusBadge`.
- **Estados:** padrão, hover, foco, selecionada (`--color-selected`, nunca
  laranja), adiada vencida de volta à fila, desatualizada (ACT-09).
- **Responsivo:** alvo ≥ 44 px em qualquer largura; no celular ocupa a
  largura toda e abre o detalhe em outra região, com volta à mesma linha.
- **Teclado/ARIA:** a linha inteira é um único `button` que abre o detalhe
  (`aria-pressed` ou `aria-current` para a selecionada); sem botões, links
  ou menus internos. Ordem de leitura: quem → motivo → prazo.
- **Usar** para objeto real acionável. **Não usar** para executar a ação na
  própria linha: a fila não tem `primary` (§3).

#### `ActionDetail`

- **Propósito:** resolver um objeto com uma pergunta.
- **Anatomia:** título com quem/objeto, contexto mínimo (motivo, espera,
  prazo prometido quando existir), uma pergunta, no máximo 1 `primary` e até
  2 `quiet`; ações raras (dispensar, adiar por data) ficam em “Mais”.
- **Estados:** carregando, pronto, enviando (`aria-busy`, envio único),
  conflito 409 (pede atualizar, preserva rascunho), erro na região, sucesso
  que devolve o foco à fila (ACT-08/09/11).
- **Responsivo:** painel ao lado no notebook; tela própria com voltar no
  celular.
- **Teclado/ARIA:** região nomeada pelo título; foco vai ao título ao abrir;
  ação indisponível usa `aria-disabled` com motivo (§16).
- Reforça a regra da §18: **tarefa tem no máximo três ações no contexto**.
- **Não usar** composer, chat paralelo ou segundo `primary`.

#### `FilterChips` e `SegmentedControl`

- **Propósito:** `FilterChips` filtra a fila por intenção (quatro, ACT-01);
  `SegmentedControl` escolhe o período do desempenho: 7 ou 30 dias (PERF-02).
- **Anatomia:** chip com rótulo + contagem real; segmento com rótulo curto.
  Seleção neutra (`--color-selected`, peso), nunca laranja (§4).
- **Estados:** padrão, hover, foco, pressionado; contagem indisponível
  mostra “—”, não “0”.
- **Responsivo:** chips rolam ou quebram sem truncar rótulo; 44 px no toque.
- **Teclado/ARIA:** cada chip e cada segmento é `button` com `aria-pressed`;
  a contagem entra no nome acessível; o resultado anuncia em `aria-live`.
- **Não usar** para mais de quatro intenções (vira folha “Filtros”, §16)
  nem para períodos fora de 7/30 dias sem decisão.

#### `SalesDataTable`

- **Propósito:** desempenho por pessoa e canal no período.
- **Anatomia:** `<table>` com `<th scope="col">` reais, valores
  `tabular-nums` alinhados à direita. Linhas de canal (“Loja do site”) e
  “Sem atribuição” ficam separadas das pessoas, e o total reconcilia com a
  soma (PERF-05).
- **Papéis:** o vendedor recebe da API apenas a própria linha (PERF-07); a
  linha própria destacada vale na visão do administrador, quando ele também
  vende. Busca e “Ver todos (N)” aparecem com 8 pessoas ou mais.
- **Estados:** carregando, vazio do período, erro com retry, cobertura
  histórica limitada sinalizada (PERF-05).
- **Responsivo:** no celular vira lista de cartões com os mesmos campos e a
  mesma ordem; rolagem horizontal não é a única saída (§7).
- **Teclado/ARIA:** cabeçalhos ordenáveis são `button` dentro do `th`, com
  `aria-sort` no `th`; linha própria identificada em texto (“Você”).
- **Não usar** para ranking punitivo ou nota única (PERF-06).

#### `Meter`

- **Propósito:** reforço visual de proporção dentro de uma linha.
- **Anatomia:** barra de uma única cor (`--color-link` ou neutro; nunca o
  laranja da ação), `aria-hidden="true"`; o valor fica sempre em texto ao
  lado.
- **Estados:** com valor, sem dado (barra ausente + “—”).
- **Não usar** como única fonte do número, com várias cores ou como meta.

#### `ReasonSheet`

- **Propósito:** pedir um motivo explícito antes de uma decisão auditável.
- **Anatomia:** `Drawer`/folha modal com título, `fieldset` + `legend`,
  opções em `radio` obrigatório; “Outro” revela campo de texto curto
  obrigatório; ações “Confirmar …” (verbo + objeto) e “Cancelar”.
- **Estados:** confirmar fica `aria-disabled` com motivo até haver escolha
  (e texto, se “Outro”); enviando; erro preserva a escolha.
- **Teclado/ARIA:** foco contido, foco inicial na `legend`/primeira opção,
  setas entre radios, Escape fecha sem salvar e devolve o foco ao acionador.
- **Uso pendente:** o motivo de perda do lead ainda não tem decisão; até o
  RFC complementar (ACT-T04), a spec proíbe inferir perda e não há status
  novo. O componente não entra em produção para esse fluxo antes disso.

#### `EmptyState` e limite

- Vazio diz o motivo (“Nada para responder agora”, “Nenhum resultado para o
  filtro” + “Limpar filtro”); erro não vira vazio (ACT-09).
- A fila corta em 100 itens (`DASHBOARD_ACTION_LIMIT`); com `hasMore`, a
  interface sempre anuncia que há mais itens fora da lista, sem total
  inventado (ACT-01).

#### Conformidade reforçada pelo redesenho

- Nenhum texto abaixo de `--text-xs` (13 px); sem caixa alta nem eyebrow (§5).
- Cards em `--radius-lg` (12 px); badge em `--radius-sm` (§6).
- h1 em `--text-2xl`, com o ajuste de 20 px no celular previsto na §7.
- Uma `primary` por região: a fila não tem botões; o detalhe tem uma.
- O orçamento da §18 permanece: 9 controles em 390×844 e 14 em 1366×768
  para o vendedor, com fixture de cinco objetos.

## 19. Práticas adotadas no design (ACT-T04, 05/11/2026)

Práticas usadas no redesenho do Dashboard e adotadas para qualquer nova
superfície. Valem antes do código: um desenho que não cumpre estas práticas
volta para revisão, não segue para implementação.

### Partir do que existe

- Desenhar sobre o que já está no `master` e nas specs, não sobre a memória
  do produto. Antes da primeira prancheta, confirmar requisitos, contratos de
  API e componentes entregues; o desenho não cria comportamento sem requisito.
- Quando o desenho pede algo que a spec exclui ou não define, a proposta vira
  pergunta ao PO e, se aceita, RFC/ADR antes do código.
- Verificar se outra sessão está alterando os mesmos arquivos antes de
  implementar; duas reescritas paralelas da mesma tela são proibidas.

### Protótipo por papel e por momento

- Uma prancheta por papel (gestor, vendedor) e por momento da tarefa (fila,
  detalhe, folha de decisão), nos tamanhos de referência 390×844 e
  1366–1440 px. Páginas são fluidas e precisam funcionar na largura do
  celular.
- Protótipos interativos só onde a interação decide o desenho (filtros,
  período, escolha obrigatória); o resto é estático.

### Dados de exemplo honestos

- Dados sempre sintéticos, com nomes abreviados e sem PII ou mensagens
  reais.
- Os números fecham entre todas as telas: a soma por vendedor, loja e "sem
  atribuição" é igual ao total; o período do gráfico bate com o indicador.
  Números incoerentes escondem erro de modelo.
- Métrica que ainda não existe no código aparece marcada como "Proposta"
  (borda tracejada) até ter RFC; existente e proposta nunca se misturam sem
  marca.

### Carga cognitiva

- Uma ação principal por região; listas não carregam botões. O padrão é fila
  de linhas selecionáveis + detalhe com uma pergunta e uma ação principal.
- Ações raras ficam em "Mais"; decisões auditáveis (como perda) abrem folha
  com motivo obrigatório.
- Tabela com muitas colunas vira visões alternáveis (Vendas, Atendimento,
  Ritmo e perdas) em vez de rolagem lateral de 13 colunas.
- Respeitar o orçamento de controles da §16 e da §18 na primeira tela.

### Métricas de pessoas

- Toda métrica tem definição visível ("Como medimos") com fonte, janela e
  exclusões.
- Sem nota única nem ranking punitivo (PERF-06): destaques nomeiam o fato
  ("7 conversas sem resposta no expediente"), não um julgamento.
- O vendedor vê só os próprios números (PERF-07). Medidas de presença ou
  ritmo de colaboradores exigem finalidade declarada, transparência para a
  equipe e retenção limitada.

### Integrações refletem o provedor

- A interface só oferece o que o provedor suporta: um link InfinitePay vence
  em 24h e é de uso único, então a ação é "Gerar novo link", nunca
  "Reenviar".
- Estados do provedor aparecem com o rótulo do domínio (por exemplo,
  "Resultado a conferir"); resultado incerto vai para conferência humana.
- Integração ainda fora do `master` aparece como "Em breve", sem números
  que pareçam operacionais.

### Escala desde o desenho

- Limites declarados na interface: a fila corta em 100 itens e anuncia o
  corte; com 8 ou mais pessoas, a tabela da equipe ganha busca e "Ver
  todos".
- Nomes longos são cortados com reticências e o nome completo fica
  acessível; tabelas largas rolam dentro do próprio quadro; valores grandes
  usam `tabular-nums`.
- Novos canais de venda entram como linhas próprias que reconciliam o total,
  sem mudar a estrutura da tabela.

### Revisão de conformidade antes de publicar

- Piso de 13 px, sem caixa alta, raios da §6, uma `primary` por região, alvo
  de 44 px, contraste 4,5:1 e status com texto e ícone.
- Botões, links e campos reais mesmo no protótipo (`button`, `a href`,
  `label`); ícone sem texto leva nome acessível.

### Escalar ao design system no mesmo ciclo

- Todo padrão novo vira componente documentado na §8 e na seção da superfície
  (anatomia, estados, teclado/ARIA, uso e não uso) no mesmo ciclo do
  desenho, e a prancheta "Componentes" do protótipo espelha este documento.
- Decisões do PO entram com data no `tasks.md` da feature; numeração de
  RFC, ADR e migração segue o maior número entre todas as branches remotas.

## 20. Edição no lugar — EDIT-01 (10/11/2026)

Decisão do PO em 10/11/2026, a partir do protótipo
`output/prototipos/itens-especificacoes/` (local, não versionado). Registro:
[ADR 083](docs/adr/083-edicao-no-lugar.md), que supersede em parte a ADR 036
no modelo "Editar" + seção → Salvar/Cancelar. Completa as §8, §16 e §17. A
especificação (PFI-17, PFI-18, PIT-02) é emendada junto da primeira tela
migrada. Começa em "Itens e especificações" e
segue para as demais seções do pedido; até cada seção ser migrada, o código
dela continua no modelo anterior.

### Regra

- Quem pode editar vê o campo aberto, com o valor atual. Não existe modo de
  edição, botão "Editar" nem Salvar/Cancelar de seção.
- Cada alteração salva sozinha ao sair do campo ou com Enter: um campo, um
  comando. Não há rascunho de seção.
- Quem não pode editar e o pedido confirmado veem o mesmo cartão em leitura,
  com texto no lugar do campo; nenhum campo desabilitado em massa.
- Nada do que é opcional bloqueia salvar. Só gerar o pedido cobra o que
  falta (`RULES.md`, regra 14).

### Campo: uma anatomia só

- Todo campo é o `Field` da §8: rótulo visível, campo com borda
  `--color-border-strong` (3:1), fundo `--color-surface`, raio
  `--radius-md`, altura `--control-height` (44 px no toque), texto de
  `--text-base` com peso 500 e 16 px no celular.
- Hover escurece a borda para `--color-text-muted`; foco troca a borda por
  `--color-focus` e soma o halo de 3 px `--color-focus-halo`; desabilitado
  usa `--color-surface-muted` e texto atenuado; erro usa
  `--status-error-text` na borda e mensagem logo abaixo.
- `Field` em linha: rótulo à esquerda em coluna fixa (6,5rem), campo à
  direita ocupando o resto; descrição, `FieldGap` e erro ficam sob o campo,
  na coluna dele. Rótulo com peso 500 e cor atenuada, sem caixa alta.
- É proibido campo sem borda, campo que só aparece no foco e campo nomeado
  só por placeholder ou `aria-label`. Em tabela editável o cabeçalho da
  coluna é o rótulo visível e cada célula repete o nome em `aria-label`
  ("Quantidade do tamanho M, item 1").
- O texto é gravado e mostrado como foi digitado, só sem espaços nas pontas:
  a ficha imprime o que está gravado. `autocapitalize` apenas sugere caixa
  alta no teclado; não há `text-transform` em campo nem em rótulo.

### Pendência no campo (`FieldGap`)

- O que falta para concluir a tarefa é estado do campo, não erro: o campo
  leva `aria-required="true"` e `aria-describedby` apontando para o
  `FieldGap`; nunca `aria-invalid`.
- O `FieldGap` é um `Badge` de atenção com ícone e o texto "Falta"; o nome
  acessível completa o motivo ("Falta para gerar o pedido").
- Ele some quando o campo recebe valor e nunca aparece em campo opcional.
- A mesma pendência aparece, com as mesmas palavras, no estado do cabeçalho
  da seção e no rodapé ("Falta: aplicação do item 1 e mais 2 pontos"); os
  três leem a mesma fonte (`missingFields`).
- O rodapé leva ao primeiro campo pendente e põe o foco nele.

### Salvamento (`SaveStatus`)

- Uma só região `role="status"` por seção, no cabeçalho: "Salvando…" e
  depois "Salvo", com ícone. Não há toast de sucesso.
- Falha de salvamento vira erro no campo, com o valor digitado preservado e
  a recuperação na mensagem; conflito de versão diz que o pedido mudou e
  oferece recarregar.
- Mudança que invalida outro dado mostra o efeito ao lado dele, com ação
  nomeada: quantidade alterada marca o subtotal com atenção e "Manter R$
  640,00" (`RULES.md`, revisão humana do subtotal). Quando a mesma mudança
  invalida várias linhas, uma ação só resolve todas ("Manter os 8
  subtotais").
- Depois de salvar, o foco só é movido se a pessoa não o levou a outro
  lugar; uma resposta atrasada nunca rouba o cursor.
- Seção não migrada em edição deixa a seção com edição no lugar em leitura,
  com o motivo, até Salvar ou Cancelar.
- Totais e somas são recalculados enquanto se digita e nunca são digitados.

### Listas editáveis (`BlankRow`)

- Toda lista em que se digita termina numa linha em branco, com borda
  tracejada. Preencher e sair dela, ou Enter, cria a linha; outra em branco
  aparece no lugar. Não existe botão "Adicionar linha".
- A linha só é criada com tudo o que o domínio exige dela (no pedido,
  tamanho e quantidade). Sair com a linha incompleta mantém o texto e diz o
  que falta, sem erro.
- A `BlankRow` não tem botão de remover, não gera pendência e não entra em
  total.
- Colar uma lista na primeira célula cria várias linhas de uma vez ("P 20 M
  60 G 50"). Um valor repetido soma na linha existente e avisa; nunca cria
  duas linhas iguais.
- Uma dica de uma linha sob a lista diz o que a linha em branco faz; com a
  lista vazia ela dá o exemplo de colar.
- Enter percorre como planilha: da esquerda para a direita e, na última
  célula, para a linha seguinte.
- Remover linha é botão de ícone de 44 px com nome ("Remover tamanho M do
  item 1"); o foco vai para a linha seguinte ou para a `BlankRow`.

### Campos opcionais

- Opcional não ocupa espaço vazio: cada um entra por um botão quieto com
  "+" e o nome do campo, e passa a ficar visível enquanto tiver dado.
- Não há acordeão "Adicionais" abrindo vários campos de uma vez.
- "Não aplicável" é um chip de alternância ao lado do campo; ligado, o
  campo mostra "Não aplicável" desabilitado e guarda o valor anterior.

### Cartão de item

- O número do item fica na primeira linha, alinhado ao nome, com a altura da
  linha do nome; nunca centralizado contra duas linhas.
- O nome do cartão é lido dos campos ("CAMISETA · Feminino") e não é um
  campo; "Modelo" é o primeiro `Field` do corpo.
- Peças e valor ficam sob o nome no celular e à direita dele no notebook.
- Ações do item ficam em "Mais ações do item N"; remover usa
  `InlineConfirm`.

### Botões desta superfície

- `Adicionar item` é o único botão de borda tracejada; "+ campo" é `quiet`
  com texto de ação; a primária é só a do rodapé ("Completar itens" ou
  "Gerar pedido").
- Botão padrão tem borda `--color-border` e peso 500; peso 600 só em
  `primary` e `soft`.

### Não usar

- Edição no lugar em dado que compromete ou não tem volta: isso é diálogo.
- Salvar a cada tecla.
- Esconder que salvou: sem `SaveStatus` a seção não está pronta.
- Um segundo modelo na mesma tela migrada.

## 21. Caixa de Entrada refinada — INBOX-RD (11/11/2026)

Decisão do PO em 11/11/2026, a partir do protótipo
`output/prototipos/caixa-de-entrada/` (local, não versionado). Registro:
[ADR 084](docs/adr/084-caixa-de-entrada-refinada.md), sem RFC, como na
ADR 083. Requisitos e cenários em
[Caixa de Entrada refinada](.specs/features/inbox-redesign/spec.md); tarefas
INBOX-RD-T00 a T09 em [tasks.md](.specs/features/inbox-redesign/tasks.md).
Completa as §7, §8, §9 e §16; mantém as abas da ADR 065, a tomada humana de
PCX-15 e a anatomia do `Field` da §20. Até cada tarefa ser entregue, a §9
descreve o que o código faz.

### Por que mudar (produção, 11/11/2026)

| Medida                 | Antes                                                                  | No protótipo aprovado                                                                       |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Lista                  | 224 px; 47% das prévias e 4 nomes cortados em 70 conversas             | 300 px; 31% das prévias e nenhum nome cortados                                              |
| Mensagem nova          | nenhum aviso                                                           | selo, contador, título e faixa                                                              |
| Texto da conversa      | 74% dos nós em 13 px; 48% em peso 600 ou 700                           | 59% em 13 px; 37% em 600; nenhum 700                                                        |
| Espaços fora da escala | 3 px, 3,2 px, 6 px e 5,6 px                                            | nenhum                                                                                      |
| Histórico              | painel de 1612 px, balões nas duas bordas; autor em 19 de 19 mensagens | coluna de 753 px centralizada; maior balão 544 px; autor em 5 de 9 mensagens (um por grupo) |
| Compositor             | campo sem borda nem fundo; cinco botões de 44×44 com 4 px entre eles   | campo com borda e fundo; dois grupos, 8 px entre botões                                     |
| Rail                   | 9 itens com 2 px entre eles; três com o mesmo ícone                    | 4 px entre itens e 16 px entre grupos; 9 ícones diferentes                                  |

O "Antes" foi medido em produção a 1920 px; o protótipo, a 1920×945, com o
mesmo método (tamanho e peso de fonte de cada elemento visível com texto
direto; paddings e gaps de todo elemento visível; texto só para leitor de
tela fora da conta).

### Regras

- **Lista (INBOX-RD-01):** coluna da lista com
  `clamp(14rem, 24vw, 18.75rem)` no desktop, 300 px a partir de cerca de
  1250 px, num token (hoje `--inbox-list-inline-size: 14rem`). O celular continua com lista e
  conversa em telas separadas. O tablet (769 a 1199 px) hoje usa o mesmo
  token; com a fórmula, ficaria entre 224 e 288 px (pendência abaixo).
- **Mensagem nova (INBOX-RD-02):** as quatro peças do "Aviso de mensagem
  nova" da §8 leem uma marca só. A marca nasce quando chega mensagem do
  cliente numa conversa que não está aberta, depois da primeira carga da
  Caixa; a primeira carga não marca nada. Abrir a conversa apaga a marca; a
  conversa aberta não ganha marca. A marca é por navegador e guarda só o
  identificador da conversa e o instante da mensagem, nunca nome, telefone
  ou texto (UX-FUNC-01). Sem armazenamento disponível, a marca dura a visita,
  sem erro e sem aviso de falha. Um anúncio por chegada na região
  `role="status"` do shell; nunca som nem foco roubado. Limite declarado: a
  marca não acompanha a pessoa entre aparelhos ou navegadores; um marcador
  de lido no servidor fica para decisão futura. A faixa reaproveita o padrão
  `.inbox-notice.inbox-live-notice` que hoje dá o estado das atualizações
  automáticas, como elemento próprio e sem `role="status"`.
- **Histórico (INBOX-RD-03):** coluna de leitura centralizada até
  `--inbox-thread-max-inline-size` (48rem) e balão até
  `--inbox-message-max-inline-size` (34rem), com o "Grupo de mensagens" da
  §8. Autor e hora continuam disponíveis a leitor de tela em cada mensagem.
- **Selos e cabeçalho (INBOX-RD-04):** todo selo de status da lista, do
  cabeçalho da conversa e do painel Atendimento segue o "Selo de status com
  ícone" da §8. No cabeçalho, 8 px entre ações (hoje 4 px) e botões na altura
  de controle: 40 px com mouse e 44 px no toque, inclusive Assumir, Criar
  pedido e o link do pedido.
- **Compositor (INBOX-RD-05):** o "Compositor" da §8, dentro da exceção ao
  orçamento da §16. Ação indisponível usa `aria-disabled`, continua focável e
  mostra o motivo (§16, "Ação indisponível"); ativá-la não faz nada nem perde
  o rascunho.
- **Jornada do frete (INBOX-RD-06):** "Cotar frete" abre a "Casca de
  jornada" da §8, sem borda no fieldset, em cada serviço ou na estimativa;
  CEPs lado a lado; peso e medidas numa linha. "Consultar frete" é a
  primária até haver frete vinculado; depois, "Escrever resposta com o
  frete" ("Acrescentar resposta com o frete" quando já há rascunho) passa a
  ser a primária e "Consultar frete" vira secundária. A jornada de cobrança
  fica como está até o PR 348 (§16).
- **Navegação (INBOX-RD-07):** os grupos e ícones da §7.
- **Painel Atendimento (INBOX-RD-08):** "Pedidos e assuntos" e "Resumo" são
  `Tabs` da §8 (`tablist`, `tab` com `aria-selected` e `aria-controls`,
  `tabpanel`, setas, Home e End, `tabindex` móvel). Em "Pedidos e assuntos",
  o resumo do pedido é o primeiro bloco; depois vêm a avaliação das
  sugestões de pedido e os Assuntos do atendimento. Título de seção em
  `--text-sm` peso 600 e 24 px entre seções.
- **Limpeza (INBOX-RD-09):** na Caixa e no shell, 3 px, 3,2 px (padding do
  `.badge`), 6 px, 5,6 px e os 2 px entre itens de navegação e entre abas
  viram `--space-1` ou `--space-2`; as larguras literais viram token
  (`--journey-inline-size` 40rem, hoje 46rem solto nos diálogos de frete e
  cobrança; `--inbox-context-inline-size` 24rem; `--menu-inline-size`
  17rem). Regras CSS sem marcação correspondente saem.

### Movimento

- Rolar até a primeira marca com "Ver mensagens novas" não anima com
  `prefers-reduced-motion: reduce`.
- Selo, contador e faixa não piscam nem pulsam (§10).

### Pendências (dependem do PO)

Da seção "Decisões pendentes" do protótipo, sem decisão nesta data:

- "Confirmar transferência" como secundária e a transferência no modelo do
  `InlineConfirm` (emenda PCX-13/PCX-15); retorno de ação com ícone no modelo
  do `SaveStatus` fora do pedido.
- Selo "Frete vinculado" no lugar do botão desabilitado (MEVQ-06/08).
- Tom e ícone dos estados de cobrança e a casca na cobrança, depois do
  PR 348; emenda de BFUI-01 (etapas numa casca só, Esc voltando uma etapa).
- Rótulo visível "Responder" no campo de resposta: o protótipo o mantém só
  para leitor de tela, com o placeholder visível, o que a §15 proíbe; falta
  decidir entre rótulo visível e exceção registrada.
- Peso 400 e `--text-sm` no notebook para o texto do compositor, que diverge
  do `Field` da §20 (`--text-base`, peso 500); o protótipo justifica por ser
  o texto que o cliente lê.
- Papéis de texto da conversa na §5 (metadado, conteúdo, identidade; sem
  peso 700).
- Meta da §16 para Caixa e Conversa: passar a contar ações, como no pedido.
  Gravando áudio, a conversa soma 13 ações no celular, contra a meta de 12;
  decidir se as ferramentas do pedido saem da linha durante a gravação.
- No celular, a barra inferior sai quando o foco entra no compositor, o que
  move as ferramentas 64 px antes do toque; no protótipo ela só sai enquanto
  se digita. Não verificado em aparelho real.
- Conjunto de ícones: `AppIcon.vue` e `OrderIcon.vue` têm sete nomes em
  comum com desenhos diferentes; levar `FieldGap` e `SaveStatus` à Caixa
  obriga a escolher um. Os valores fora da escala no CSS desses primitivos em
  `40-order.css` se alinham na mesma decisão.
- Lista no tablet (769 a 1199 px): adotar a mesma fórmula de INBOX-RD-01 ou
  manter 14rem. O protótipo e a decisão tratam só do desktop e do celular.
- Título do documento: o protótipo mostra "(2) Caixa de Entrada · CRM
  Silmer", mas hoje o título é "CRM Silmer" em todas as rotas;
  INBOX-RD-02 só acrescenta "(N) ".

### Não usar

- Aviso de mensagem nova só com cor, com som ou que rouba o foco.
- Marca de mensagem nova para mensagem do vendedor ou do agente.
- Dado de cliente no armazenamento do navegador.
- Uma segunda primária no compositor ou na casca de jornada.
- Diálogo sobre diálogo ou caixa com borda dentro da casca.
- O mesmo ícone para dois destinos da navegação.

## 22. Pedido refinado — PED-RD (12/11/2026)

Decisão do PO em 12/11/2026, a partir do protótipo "Pedido refinado" (canvas
Design privado; cópia local em `output/prototipos/pedido-refinado/`, não
versionada). Registro: [ADR 086](docs/adr/086-pedido-refinado.md), sem RFC,
como nas ADR 083 e 084. Requisitos e cenários em
[Pedido refinado](.specs/features/pedido-refinado/spec.md); tarefas
PED-RD-T00 a T10 em [tasks.md](.specs/features/pedido-refinado/tasks.md).
Completa as §9, §16, §19 e §20; mantém a anatomia do `Field` e a edição no
lugar da §20. Até cada tarefa ser entregue, a §9 descreve o que o código faz.

### Regras

- **Três camadas (PED-RD-01):** cabeçalho, ficha e rail. A ficha é uma folha
  só, com os capítulos separados por divisor e respiro; só os cartões de item
  têm borda dentro dela.
- **Cabeçalho (PED-RD-02):** trilha "← Pedidos", h1 "Pedido {número}", selo de
  status com ícone, contexto ("{cliente} — {nome} · com {vendedor}") e a linha
  de fatos-chave (entrega, peças, valor), que é a fonte única desses dados.
  Sem primária no cabeçalho; "Abrir conversa", "Gerar PDF" e "Mais ações do
  pedido".
- **Ordem da ficha (PED-RD-03):** Resumo do pedido, Datas do pedido, Itens e
  especificações, Arte do pedido, Observações do pedido e Dados do
  atendimento.
- **Resumo (PED-RD-09):** Cliente (texto, "Ver cadastro"), Nome do pedido e
  Previsão de entrega, os dois campos lado a lado em container de 40rem ou
  mais. Não repete peças, valor, vendedor, data do pedido nem FAB.
- **Arte (PED-RD-10):** "Quem faz a arte" no topo; "Arte final" e "Arquivos da
  arte" lado a lado em container de 32rem ou mais, empilhados no estreito.
- **Observações (PED-RD-11):** lista numerada com cabeçalho visível das
  colunas, `BlankRow` no fim, dica de uma linha, até 5 linhas de 200
  caracteres.
- **Dados do atendimento (PED-RD-05):** último capítulo, recolhido, com o
  aviso "Não vai para a ficha impressa.".
- **Edição no lugar (PED-RD-12):** a §20 se estende a Resumo, Arte e
  Observações: sem "Editar <seção>", sem Salvar/Cancelar de seção, `SaveStatus`
  no cabeçalho do capítulo. Pedido confirmado e quem não edita veem o mesmo
  layout em leitura, com a linha "Pedido confirmado. Para alterar, reabra o
  pedido em Mais ações.".
- **Rail antes da ficha abaixo de 75rem (PED-RD-08):** o rail é o primeiro
  filho do layout no DOM e vem logo depois do cabeçalho; a partir de 75rem a
  grade (`grid-template-areas`) o põe à direita, sticky, com
  `minmax(20rem, 24rem)`. A ordem visual é a do DOM e a do foco.

### Fechamento e pagamento (o rail)

| Estado     | Blocos, em ordem                                                                                                                                                     | Primária                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pendente   | Para gerar o pedido: N de 3 (Previsão de entrega, Itens, Arte); Valor do pedido (Peças + Frete = Total); Gerar pedido com o motivo ao lado                           | Uma só (PFI-16): o próximo passo enquanto há pendência, com "Gerar pedido" neutro e `aria-disabled`; "Gerar pedido" com tudo pronto. Decisão do PO em 12/11/2026 |
| Confirmado | Fechamento em leitura (selo "Confirmado por … · data, hora", Valor do pedido, Forma de pagamento, "Ficha v{N}" com "Baixar ficha em PDF"); Cobranças (resumo); Olist | "Gerar no Olist" no seu bloco, só para quem é "Habilitado Olist"                                                                                                 |

- **Progresso:** só do `missingFields` (§9, PFI-15). Pendência desconhecida
  vira "Revisar pendências" e o total passa a 4. O cadastro incompleto do
  cliente nunca aparece aqui (ADR 082).
- **Valor do pedido:** Peças (soma dos itens, calculada), Frete e Total
  (calculado, nunca digitado, `tabular-nums`, destaque `--color-emphasis-*`).
  O frete é do responsável, em edição no lugar, com "Usar cotação: R$ … ·
  {serviço}" como botão quieto e a origem em texto; cotação vencida mostra
  aviso de atenção com ícone, sem bloquear. **Pendente de OLC-T01
  (ADR 080):** até lá o rail não tem campo de frete.
- **Cobranças:** só o resumo ("Recebido R$ … de R$ …", `Meter`, "Ver
  cobranças"); o interior espera o PR 348.
- **Olist (pendente de OLC-T03 e OLC-T04):** bloco próprio, com a sua
  primária e estados Pronto, Cadastro incompleto (`aria-disabled` com o que
  falta e "Completar cadastro"), Aguardando processamento, Processando com
  etapa, Gerado (venda nº e "Abrir venda no Olist"), Conferência necessária
  (sem botão de repetir) e Falha de consulta ("Atualizar situação", leitura).
  Sem diálogo de prévia (ADR 079).

### Datas do pedido, o container de produção refinado

- É o container de `OrderMilestonesSection.vue`, sem trocar de contrato, como
  2º capítulo da ficha.
- Cabeçalho do capítulo: contador neutro ("1 de 3 datas") e, só no
  confirmado, a ação padrão "Confirmar entrega" à direita.
- Linha do tempo horizontal: data acima, ponto na trilha (concluído
  preenchido em sucesso, próximo vazado), título sublinhado em pontilhado
  como botão que abre o detalhe, subtítulo abaixo.
- Rodapé com divisor: "Recebido: …" à esquerda e "Falta receber: …" à
  direita, só no confirmado.
- Em container de 30rem ou menos a mesma linha do tempo vira vertical, sem
  rolagem lateral. O estado do ponto também está no nome acessível.

### Hierarquia

| Nível | Papel                             | Elemento e tipografia                                       | Espaço                                    |
| ----- | --------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| 1     | Página                            | `h1` 24 px (20 px no celular), selo, contexto, fatos-chave  | 24 px abaixo do cabeçalho                 |
| 2     | Capítulo da ficha e bloco do rail | `h2` `--text-lg` 600, estado (ícone + texto) e `SaveStatus` | 32 px entre capítulos                     |
| 3     | Subseção dentro do capítulo       | `h3` `--text-base` 600 (Arte final, Arquivos da arte, item) | 24 px entre subseções; 8 a 12 px no grupo |
| 4     | Rótulo de campo e metadado        | `--text-sm` 500 atenuado; metadado `--text-xs`              | 16 px entre campos                        |

Uma superfície por nível: a folha da ficha e os cartões do rail são o nível
de superfície; dentro deles, só o cartão de item tem borda. Subseções agrupam
por espaço, não por caixa. Valores só da escala de 4 px.

### Responsividade

- Todo container de layout (ficha, capítulo, bloco do rail, lista de itens,
  linha do tempo) declara `container-type: inline-size`, `inline-size: 100%`
  e `min-inline-size: 0`.
- As grades internas usam `@container`: Resumo a 40rem, Arte a 32rem, Datas a
  30rem. A única consulta de viewport do layout é a de 75rem do rail.
- Nunca centralizar um container com `margin-inline: auto` dentro de grade ou
  flex sem largura explícita: sem largura intrínseca ele encolhe a zero (foi o
  defeito que colapsou a v2 do protótipo numa coluna de poucos pixels).
- Sem rolagem horizontal a 320 px nem a 200% de zoom.

### Pendências (dependem do PO)

- **Orçamento de ações (§16), resolvido por medição em 12/11/2026:** a meta
  conta a primeira tela. O pendente tem 3 ações a 390×844 (Abrir conversa,
  Resumo do pedido, Gerar pedido) e 3 a 1366×768 (Abrir conversa, Gerar PDF,
  Gerar pedido), contra 12 e 16; `test/e2e/ux-budget.spec.js`
  (`pedidoPrimeiraTela`) trava o limite. As 19 ações a 1366 px são a página
  inteira, 10 delas em "Itens e especificações" (EDIT-01), e não entram
  nessa meta.
- **Frete no total:** o contrato do OLC-T01 (ADR 080) está no master, e o
  campo no rail está na PR 364 (rascunho). Com ele, a altura do pedido no
  celular fica no limite de 1800 px da meta da §16 e passa dele somada a
  outra linha (decisão do PO).
- **Gerar no Olist:** depende de OLC-T03 e OLC-T04 (ADR 079); o texto final dos
  estados fica para o PO.
- **Cobranças:** o resumo no rail (medidor e "Ver cobranças") está na PR 363,
  depois da PR 348. O interior segue com BCS.
- **Acordeão do celular (PFI-18):** o protótipo o mantém, na ordem nova; fica
  assim até o PO decidir o contrário.
- **Verificação de 12/11/2026 (PED-RD-T10):** app real com API e Postgres
  locais. Teclado a 1366 e a 390 px, toque emulado a 390 px, tema escuro (sem
  texto abaixo de 4,5:1) e árvore de acessibilidade conferidos. **Não
  verificado:** leitor de tela (NVDA ausente na máquina), aparelho real e o
  foco de checkbox e radio. O tema escuro vem do botão "Escuro"
  (`data-theme`); `prefers-color-scheme` sozinho não troca a tela.

### Não usar

- O rail como linha do tempo empilhada (as datas são um capítulo da ficha).
- Blocos de largura total sem rail, como na v2 rejeitada em 12/11/2026.
- Repetir entrega, peças e valor no Resumo, nas Datas ou no rail.
- Container de layout sem largura explícita, ou centralizado com
  `margin-inline: auto` dentro de grade ou flex.
- Ordem visual diferente da ordem do DOM (`order`, `*-reverse`).
- Cadastro incompleto do cliente dentro de "Para gerar o pedido".
- Segundo modelo de edição no mesmo capítulo migrado, ou "Editar <seção>".

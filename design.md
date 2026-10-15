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

| Entrada | Silmer | Papel |
|---|---|---|
| `--brand-primary` | `#ff5b01` | assinatura: logotipo, faixas, ícone ativo |
| `--brand-primary-strong` | `#c94300` | preenchimento de ação; branco sobre ele passa 4.78:1 |
| `--brand-ink` | `#0c042d` | texto, neutros, superfícies escuras e tema escuro |
| `--brand-secondary` / `-light` | `#6544ee` / `#b2a1f7` | link, foco e seleção (claro / escuro) |
| `--brand-font` | Poppins | família única |
| `--brand-radius` | `0.5rem` | raio base; `sm`, `lg` e `xl` derivam dele |

2. **Semânticos** — derivados da marca com `color-mix()`; componentes só usam
   estes. Os neutros são a tinta misturada ao branco em poucas porcentagens, por
   isso trocar `--brand-ink` re-tinge canvas, bordas, texto e sombras.

| Papel | Light | Dark | Uso |
|---|---|---|---|
| `--color-canvas` | tinta 5% | tinta + preto | fundo do shell e da navegação |
| `--color-page` | tinta 1.5% | tinta | painel de trabalho (inset) |
| `--color-surface` | branco | branco 5% | cards, campos, botões secundários |
| `--color-surface-raised` | tinta 4% | branco 9% | hover e segundo nível |
| `--color-surface-active` | tinta 8% | branco 14% | pressionado |
| `--color-text` | tinta | branco 94% | texto principal (≥ 16:1) |
| `--color-text-muted` | tinta 64% | branco 68% | texto secundário (≥ 5.5:1) |
| `--color-border` / `-strong` / `-subtle` | tinta 14% / 30% / 8% | branco 16% / 30% / 10% | limites; `strong` em campos (3:1) |
| `--color-accent` | primária | primária | faixa, ícone ativo, assinatura |
| `--color-accent-solid` | primária forte | primária forte | botão primário (texto branco) |
| `--color-link` / `--color-focus` | secundária | secundária clara | links, anel e halo de foco |
| `--color-selected` | secundária 9% | secundária 22% | chip ou linha selecionada |

3. **Componentes** — `--control-height` (40 px; 44 px em `pointer: coarse`),
   `--target-min`, `--sidebar-inline-size`, `--sidebar-rail-size`,
   `--topbar-block-size`.

Regras para uma nova marca: `--brand-ink` escura (luminância < 5%) e
`--brand-primary-strong` com contraste ≥ 4.5:1 com branco. Nome da empresa,
nome do produto, slogan e logotipo ficam em `apps/edge-web/src/brand/index.js`;
`BrandMark.vue` desenha o logotipo oficial. Nenhum componente escreve o nome da
empresa.

### Cores semânticas

| Estado | Light: fundo / texto | Dark: fundo / texto |
|---|---|---|
| sucesso | `#e7f6ed` / `#146c43` | `#123a2a` / `#8fe3b3` |
| atenção | `#fff4d6` / `#7a4a00` | `#4a2e00` / `#ffd17a` |
| erro | `#fdecec` / `#a12a2a` | `#491a22` / `#ffb4c0` |
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

| Token | Tamanho / linha | Peso | Uso |
|---|---:|---:|---|
| `--text-xs` | `0.8125rem / 1.5` | 500 | metadados, legendas e rótulos (piso do produto) |
| `--text-sm` | `0.875rem / 1.5` | 400–600 | controles compactos e tabelas |
| `--text-base` | `1rem / 1.5` | 400 | texto e campos |
| `--text-lg` | `1.125rem / 1.4` | 600 | título de painel |
| `--text-xl` | `1.25rem / 1.35` | 600 | seção |
| `--text-2xl` | `1.5rem / 1.25` | 600 | título de página (h1) |
| `--text-3xl` | `2rem / 1.2` | 700 | estados especiais e autenticação |

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

| Token | Valor | Uso |
|---|---:|---|
| `--radius-sm` | `6px` | badge, item compacto, segmento |
| `--radius-md` | `8px` | inputs, botões e menus |
| `--radius-lg` | `12px` | cards, painéis e dialogs |
| `--radius-xl` | `16px` | painel de trabalho e tela de acesso |
| `--radius-pill` | `999px` | chips, contadores e avatar |

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
  conta, Vendedores (admin), Conta, aparência e Sair; Escape fecha e devolve o
  foco. As telas reservam a barra no fim da rolagem e acima de rodapés fixos.
  Campos usam 16 px para o iOS não dar zoom.

- Sidebar de `248px` no canvas, sem borda; item ativo é um cartão branco com
  sombra curta e ícone na cor da marca. Recolhe para rail de `72px` entre 769 e
  1199 px, com o monograma da marca.
- O trabalho fica num painel inset (`--color-page`, raio `xl`) com topbar de
  `56px`: trilha "Empresa › Tela", função, estado da conexão e tema.
- Uma lista de rotas alimenta a sidebar, a barra inferior e a folha "Mais";
  todos oferecem os mesmos destinos, inclusive Vendedores (admin) e Sair.
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

| Componente | Variantes ou responsabilidades |
|---|---|
| `Button` | secundário por padrão; `.primary` (uma por região), `.quiet`, `.danger`, `.link-button`; `.button-link` para links com cara de botão; loading e disabled |
| `IconButton` | alvo mínimo de `44×44px`, tooltip e nome acessível |
| `Field` | label, descrição, input/select/textarea, erro e estado obrigatório |
| `Checkbox` / `Radio` / `Switch` | label clicável, foco visível e estado indeterminado quando necessário |
| `SearchField` | limpeza, atalho opcional e anúncio de resultados |
| `Badge` / `Status` | texto + ícone; nunca somente cor |
| `Panel` / `Card` | estrutura visual; não deve embutir regra de domínio |
| `Tabs` | setas entre abas, `Home/End` e associação `tab`/`tabpanel` |
| `Menu` / `Popover` | foco gerenciado, Escape e retorno de foco |
| `Dialog` / `Drawer` | título, descrição, foco contido, Escape e ação explícita |
| `Toast` | feedback breve; erros persistentes também aparecem junto ao contexto |
| `EmptyState` | motivo, ação recuperável e sem ilustração excessiva |
| `Skeleton` | mesma geometria do conteúdo; respeita reduced motion |
| `DataTable` / `DataList` | cabeçalhos reais, seleção, ordenação e alternativa responsiva |
| `Tooltip` | apoio curto; nunca guarda informação necessária para concluir tarefa |
| `ThemeSwitcher` | `Claro`, `Escuro`, com rótulo acessível |

### Composição de domínio

Componentes de domínio devem compor os primitivos acima, sem duplicar estilo ou interação:

- `ConversationListItem`, `ConversationPanel` e `LeadConversionAction`;
- `KanbanColumn`, `OpportunityCard` e `StageChangeDialog`;
- `AgentActivity`, `HandoffSummary` e `AuditTimeline`;
- `OrderSheetSection`, `OrderValidationSummary` e `OrderSendStatus`;
- `SalesKpi`, `SalesFilterBar` e `SalesDataTable`.

Cada componente precisa documentar: propósito, anatomia, variantes, estados, comportamento responsivo, teclado, ARIA e exemplos de uso/não uso.

## 9. Padrões por superfície do CRM

### Caixa de Entrada

Workspace de altura fixa para a atendente (pesquisa UX de 15/10/2026, achado 1):
a página ocupa exatamente a altura abaixo da barra superior e nunca rola; cada
coluna rola por dentro.

- **Colunas:** lista | conversa | contexto. O contexto (pedido, assuntos,
  cliente) é recolhível pelo botão `Detalhes` do cabeçalho; abre por padrão a
  partir de 1440 px e a última escolha da pessoa vale naquele navegador. No
  tablet o contexto cobre a conversa; no celular aparece um painel por vez.
- **Celular primeiro (ADR 035):** desenhada para 390×844 e ampliada. Lista e
  conversa são telas separadas, com voltar; o cabeçalho mantém só a ação
  primária, `Pedido` e `Mais`, que abre uma folha inferior acima da barra de
  navegação (Detalhes, Repassar, Arquivar, Encerrar). A resposta fica acima da
  barra; ao digitar, a barra sai e a resposta encosta no teclado
  (`interactive-widget=resizes-content`). Alvos de 44 px; nada depende de
  hover.
- **Endereço:** `/inbox/:conversationId` abre a conversa direto (Pedido,
  Clientes e Dashboard linkam assim). A conversa aberta pelo endereço continua
  aberta mesmo fora do filtro, arquivada ou além das 100 carregadas; trocar de
  conversa muda o endereço sem recarregar a lista, a busca ou os filtros. No
  celular o endereço decide entre a lista e a conversa (voltar = `Conversas`).
- **Filtros:** um único eixo segmentado com totais (`Todas · Aguardando
  vendedor · Com o agente · Com vendedor · Arquivadas`), seleção neutra e a
  fila (`Todas · Minhas · Sem responsável`, PCX-05) num seletor ao lado. A busca
  fica no topo da lista.
- **Lista:** nome, horário curto (hora hoje, dia no ano, data antes; a data
  completa no tooltip), trecho de uma linha, canal, estado, motivo e tempo
  parado. O item aberto usa `--color-selected`, sem borda lateral colorida.
- **Cabeçalho da conversa:** compacto, nome e uma linha de identidade; no
  máximo uma ação primária (`Assumir atendimento`), duas visíveis
  (`Pedido · status`, `Encerrar conversa`) e o resto em `Mais` (Repassar,
  Arquivar/Desarquivar). `Mais` abre pelo teclado no primeiro item e Esc
  devolve o foco.
- **Histórico:** abre na última mensagem e acompanha as novas, salvo quando a
  pessoa rolou para ler algo antigo; conversa curta fica junto da resposta.
- **Resposta:** sempre visível no rodapé da conversa. Enter envia, Shift+Enter
  quebra a linha; em teclado de toque Enter só quebra a linha. Sem espaço,
  Anexar e Gravar ficam só com ícone (nome acessível mantido) e Enviar continua
  na mesma linha.
- Conversa encerrada usa `Sem lead`; nunca reutilizar o estado visual `Perdido` do Kanban.

### Kanban Comercial

- Backlog não aparece como coluna.
- Cabeçalho de coluna exibe nome, contagem e limite quando existir.
- O drag-and-drop é um acelerador, não o único mecanismo: cada card possui ação de mover acessível por teclado.
- Antes de mover, a UI informa campos pendentes ou regra de passagem.
- `Fechado` e `Perdido` são resultados explícitos; `Perdido` exige motivo.

### Conversa e atuação do Vendedor Silmer

- Mensagens humanas, do cliente e do agente são visualmente distintas, mas permanecem legíveis nos dois temas.
- A área de composição mantém uma ação principal de envio e torna anexos/ações extras secundários.
- Mensagens, sugestões e handoffs do agente aparecem em uma linha do tempo auditável, agrupada por etapa.
- Sugestões como `Transformar em lead` e `Avançar etapa` exigem confirmação humana explícita no MVP; a interface nunca representa a sugestão como ação já executada.
- A chave pós-MVP `vendedor_silmer_autonomia_comercial` não aparece como controle operacional do MVP.
- Handoff mostra motivo, resumo, responsável e ação para assumir; não depende de toast.
- Reversão identifica impacto antes de confirmar.

### Ficha de Pedido

- Usar um fluxo em seções: Identificação, Produto, Personalização, Grade e Entrega, Fechamento e Revisão.
- Exibir progresso por completude real, não apenas por visita a uma etapa.
- Erros aparecem no campo e em um resumo navegável no topo da seção.
- Revisão final é uma visualização estável, separada da edição.
- Aprovação e envio são ações distintas; estado, versão, autor, horário e destinatário permanecem visíveis.

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
- Truncar conteúdo crítico sem alternativa para leitura completa.
- Usar drag-and-drop como única forma de alterar etapa.

---

Este documento define a direção visual. Etapas do Kanban, permissões, campos obrigatórios da Ficha e vocabulário financeiro estão resolvidos nos documentos canônicos e prontos para especificação e implementação pelo Tech Lead.

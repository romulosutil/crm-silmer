# ADR-001: Adotar Vue 3 no frontend do CRM

- **Status:** Aceita
- **Data:** 2026-09-07
- **Decisor:** Rômulo Sutil Corrêa
- **Tags:** frontend, arquitetura, acessibilidade

## Contexto

O frontend do CRM nasceu em HTML, CSS e JavaScript sem framework. A entrega de
Contato, Negócio e Kanban (CRM-2, tarefas T03.1..T03.6) elevou a quantidade de
estado de sessão, rotas, atualização SSE, formulários e restauração de foco. O
usuário autorizou explicitamente a adoção de um framework em 2026-09-07, antes
da expansão para Inbox e superfícies operacionais adicionais.

## Direcionadores

- preservar HTML semântico, teclado, foco previsível e ARIA dinâmica;
- manter o frontend como assets estáticos no Nginx e web/API na mesma origem;
- migrar incrementalmente, sem reescrever regras de domínio ou clientes HTTP;
- evitar estado global e abstrações prematuras;
- manter build reproduzível, CSP sem CDN e versões exatas.

## Opções consideradas

1. **Vue 3 + Vue Router + Vite:** templates próximos do HTML atual, ciclo de
   vida explícito e migração incremental com SFCs.
2. **React + React Router + Vite:** ecossistema amplo, mas exige maior mudança
   para JSX e composição mais distante da base atual.
3. **Permanecer em JavaScript sem framework:** evita dependências agora, mas
   aumenta o custo de coordenar rotas, sessão, foco e atualização reativa nas
   próximas telas.

## Decisão

Adotar Vue 3, Vue Router 4 e Vite 8, com JavaScript ESM e JSDoc. Sessão e o único
EventSource ficam na raiz da aplicação; estado remoto permanece local às views.
Não adotar Pinia, Nuxt, biblioteca de componentes ou formulários dirigidos por
schema nesta fase. Os módulos imperativos do Kanban e detalhe serão preservados
temporariamente atrás de um adaptador de ciclo de vida e migrados quando houver
ganho funcional claro.

Poppins é empacotada localmente; os tokens visuais Silmer são versionados no CSS
do CRM. O brandbook social é referência de marca, não contrato da interface
operacional. `design.md` continua sendo a autoridade visual do produto.

## Consequências

- O build passa a compilar SFCs e fontes antes de gerar o manifesto.
- Deep links dependem do fallback já existente no Nginx e no preview local.
- Vue melhora composição e ciclo de vida, mas não substitui validações manuais
  de acessibilidade, autorização, foco e estados de falha.
- Novas dependências aumentam manutenção e superfície de supply chain; versões,
  licenças, audit e bundle ficam cobertos pelos gates do repositório.

## Links

- Tarefas: CRM-2 / T03.1..T03.6; futura INBOX-4 / T02.6
- Base da entrega: PR #52
- Contrato visual: `design.md`

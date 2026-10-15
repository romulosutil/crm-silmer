# RFC 022 — Fundação visual whitelabel do CRM

Status: em revisão. A fundação (tokens, shell, componentes base) está
implementada na branch `design/fundacao-whitelabel` para avaliação; o ADR só
será escrito depois da aprovação do PO.

Responsável: Tech Lead. Aprovador: PO (Rômulo), que pediu reestruturar o design
a partir da base, com o logotipo real da Silmer, as cores da marca nas ações, o
tema claro preservado e o produto preparado para whitelabel com a Silmer como
piloto.

Requisitos: contrato visual de [`design.md`](../../design.md) §1–§4 e
Definition of Done de [`AGENTS.md`](../../AGENTS.md) (teclado, foco, contraste).
Evidência: [pesquisa com usuários sintéticos](../product/pesquisa-ux-sintetica-2026-10-15.md).
Tarefa: DS-T01 — fundação visual (este RFC).

## Problema

O CRM cresceu tela a tela e acumulou três dívidas que a pesquisa confirmou:

1. **Carga cognitiva.** Cada tela abre com eyebrow, título de 44 px e parágrafo;
   a Caixa de Entrada empurra a conversa para baixo da dobra em 1366×768.
   Rótulos de 10–12 px em caixa alta, botões laranja em toda linha de tabela e
   um anel de foco desenhado em volta de cada título competem com o trabalho.
2. **UX.** O menu do celular não tem Vendedores nem Sair; uma reconexão comum
   aparece em vermelho; o mesmo controle tem aparências diferentes por tela.
3. **UI e marca.** O logotipo era a palavra "SILMER." em texto; neutros, foco,
   sombras e superfícies eram roxos escritos à mão, então outra marca exigiria
   reescrever o tema inteiro.

## Premissas

- Vue 3 + CSS com tokens continua sendo a base (ADR 001). Nenhum framework,
  biblioteca de componentes ou dependência de runtime nova.
- O tema claro é a aparência padrão e não pode piorar; o escuro continua
  equivalente.
- Cores de estado (sucesso, atenção, erro, informação) são do produto e não
  mudam por empresa.
- `npm run check:design-tokens` continua proibindo cor literal fora de
  `tokens.css`.

## Opções

1. **Adotar ReUI/shadcn como biblioteca.** Componentes prontos e bem
   resolvidos, mas exigem React + Tailwind: viola ADR 001 e a regra de não
   introduzir framework.
2. **Polir o visual atual.** Barato, mas mantém a marca chumbada nos tokens e
   não resolve whitelabel.
3. **Refazer a fundação em Vue + CSS, adotando o contrato do ReUI.** Usar ReUI
   como referência de anatomia (shell com painel inset, tokens semânticos,
   badges `-light`, estilo "nova" de alturas e raios) e reconstruir tokens,
   shell e componentes base no próprio projeto.

## Recomendação

Opção 3.

### Tokens em três camadas (`apps/edge-web/src/tokens.css`)

1. **Marca** — as únicas entradas por empresa: `--brand-primary`,
   `--brand-primary-strong` (variante com branco ≥ 4.5:1), `--brand-ink`,
   `--brand-secondary`, `--brand-secondary-light`, `--brand-font`,
   `--brand-radius`.
2. **Semânticos** — os tokens já usados pelas telas (`--color-canvas`,
   `--color-surface*`, `--color-text*`, `--color-border*`, `--color-accent*`,
   `--color-link`, `--color-focus`, navegação, ênfase, sombras, overlay) passam a
   ser derivados da marca com `color-mix()`. Nenhuma tela precisou mudar de
   token.
3. **Componentes** — `--control-height`, `--target-min` (44 px em toque),
   `--sidebar-*`, `--topbar-block-size`.

Regras de marca para uma nova empresa: `--brand-ink` precisa ser escura
(luminância < 5%) e `--brand-primary-strong` precisa passar 4.5:1 com branco; a
validação de contraste na configuração da empresa fica para quando houver tela
de configuração.

### Identidade fora dos componentes (`apps/edge-web/src/brand/index.js`)

Nome da empresa, nome do produto, slogan, logotipo e monograma em um só objeto.
`BrandMark.vue` desenha o logotipo oficial (`silmer-web/brand.svg`) com
`--color-brand-logo`.

### Shell e componentes base

**Mobile-first.** Pedido do PO em 15/10/2026: "Quero foco no mobile first,
principalmente porque os vendedores usam celular o tempo todo". No celular, a
navegação fica numa barra inferior fixa (Início, Caixa, Pedidos, Clientes,
Mais), com folha "Mais" para o restante; o desktop amplia esse desenho.

- Sidebar no canvas e trabalho num painel inset (ReUI `c-sidebar-1`); trilha
  "Empresa › Tela" no topo; rail de ícones entre 769 e 1199 px.
- Uma lista de rotas alimenta sidebar e menu móvel (paridade, Sair no celular).
- Ícones de traço no desenho do Lucide (mesmo conjunto do ReUI).
- Cabeçalho de página: h1 24 px sem eyebrow, uma linha de contexto, uma ação
  primária.
- Botões: secundário por padrão, primário laranja só para a ação da região,
  `quiet`, `danger`, `link-button`; altura 40 px (44 px em toque).
- Campos com borda de 3:1 e halo de foco; seleção (segmentado, chips) neutra,
  nunca laranja.
- Piso tipográfico de 13 px; rótulos em caixa normal.
- Títulos recebem foco programático sem anel; controles mantêm o anel.

## Impacto

- Visual de todas as telas muda pela fundação, sem mudança de comportamento,
  rota, API ou contrato de dados.
- Testes: `foundation.spec.js` atualizado (título da tela de acesso e menu
  móvel com Vendedores e Sair).
- `scripts/check-design-tokens.mjs` passa a exigir a camada de marca.

## Fora de escopo (próximos RFCs ou tarefas)

Caixa de Entrada como workspace, Painel por papel, Pedidos para produção, grade
de tamanhos, glossário do assistente, confirmação de ações destrutivas,
vocabulário por segmento e configuração de empresa em runtime. Ver a seção
"Achados por tela" da pesquisa.

## Critérios de decisão

- Tema claro aprovado visualmente pelo PO em desktop e celular.
- `npm run validate` e `npm run test:e2e` verdes, incluindo os testes axe.
- Trocar os `--brand-*` por outra marca re-tinge o produto sem editar telas.

## Resultado

Pendente de revisão do PO.

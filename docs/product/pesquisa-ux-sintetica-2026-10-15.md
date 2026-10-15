# Pesquisa de UX com usuários sintéticos (15/10/2026)

> **Método:** quatro estudos heurísticos com personas sintéticas, em think-aloud
> simulado sobre o código real de `apps/edge-web/src` e sobre capturas das telas
> com dados sintéticos (1366×768 e 390×844, temas claro e escuro).
> **Limite:** não substitui teste com pessoas reais da Silmer. Os achados de
> severidade 4 devem ser confirmados com a equipe antes de virar requisito.
> **Uso:** base da fundação visual do [RFC 022](../rfc/022-fundacao-visual-whitelabel.md).

## Personas

| Persona | Papel | Cenário | Dor principal |
| --- | --- | --- | --- |
| Camila, 27 | Atendente/vendedora | 8 h/dia na Caixa de Entrada, notebook 1366×768 | A conversa e o campo de resposta ficam abaixo da dobra; botões demais antes da mensagem |
| Sílvio, 52 | Dono/gestor (admin) | Entra pelo celular entre visitas | No celular não há Vendedores nem Sair; o Painel fala do histórico, não do dia |
| Rose, 44 | Líder de produção/PCP | Desktop antigo ou tablet na fábrica | Tamanho com menos peso que quantidade; rótulos pequenos em caixa alta |
| Marina, 38 | Dona de gráfica avaliando o produto (whitelabel) | Demo de 5 minutos | "É o CRM da Silmer, não o meu": marca e vocabulário fixos no código |

## Achados que viraram fundação (resolvidos neste ciclo)

| Eixo | Achado | Evidência | Resposta na fundação |
| --- | --- | --- | --- |
| Carga cognitiva | Eyebrow + h1 de 44 px + parágrafo em toda tela ocupam ~1/3 da altura útil | `.eyebrow`, `h1 clamp(1.8rem, 4vw, 2.75rem)` | Cabeçalho compacto (h1 24 px), sem eyebrow |
| Carga cognitiva | Rótulos em caixa alta e espaçados; 63 regras ≤ 12 px | `screen-styles.css` | Piso de 13 px (`--text-xs`), rótulos em caixa normal |
| UI | Logotipo era texto "SILMER." | `App.vue` | Logotipo real (`silmer-web/brand.svg`) via `BrandMark` |
| UI | Segmentado da Inbox e "Imprimir ficha" em laranja disputavam com a ação primária | `.inbox-queue-options`, `OrdersView.vue` | Seleção neutra; laranja só na ação primária da região |
| UI | Foco programático desenhava anel roxo em volta do h1 a cada navegação | `:focus-visible` em `h1[tabindex=-1]` | Títulos recebem foco sem anel; controles mantêm o anel |
| UX | Menu móvel sem Vendedores e sem Sair | `App.vue` (mobile-nav) | Uma lista de rotas alimenta sidebar e menu móvel |
| UX | "Sincronizando atualizações…" em vermelho para uma reconexão comum | `.connection-state` | Reconexão em tom de atenção; erro só quando indisponível |
| Whitelabel | Cores, neutros, foco e sombras escritos à mão com o roxo da Silmer | `tokens.css` | Tokens em 3 camadas; ~6 entradas de marca derivam o resto |
| Whitelabel | Nome do produto e textos de marca fixos | `App.vue`, `index.html` | `src/brand/index.js` concentra nome, slogan e logotipo |

## Achados por tela (próximos ciclos)

Ordenados por severidade. Cada item cita a persona e a evidência original.

1. **Caixa de Entrada como workspace (Camila, sev. 4).** _Entregue em
   `design/inbox-workspace`; contrato em `design.md` §9 Caixa de Entrada._ Altura fixa na viewport:
   lista | conversa | contexto recolhível; composer sempre visível; histórico
   ancorado na última mensagem; uma ação primária + duas visíveis + menu "Mais";
   rota `/inbox/:conversationId` para links profundos (`OrderView.vue`,
   `ClientsView.vue` hoje levam para a Inbox genérica). Enter envia.
2. **Painel por papel (Sílvio, Camila, sev. 4).** Gestor: hoje, a receber,
   atrasados, esperando resposta, saúde do assistente. Atendente: "Minha fila"
   primeiro. Cartões clicáveis que abrem listas filtradas. Exige período e SLA no
   endpoint de resumo.
   *Resposta (branch `design/painel-por-papel`, FIN-02/REV-06):* o gestor
   (`COMMERCIAL_ADMIN`) vê "Vendas e entregas" com período Hoje/7 dias/Mês e
   depois "Atendimento" (esperando vendedor, assistente, minhas conversas); a
   atendente vê "Minha fila" primeiro. `GET /api/v1/orders/summary?period=`
   devolve vendas do período e entregas atrasadas/próximas (dias de São Paulo
   no servidor); `GET /api/v1/inbox/summary` devolve a fila do leitor, os
   handoffs além do `due_at` do SLA e a saúde do assistente (sem resposta há
   10 min ou mais, envio falho em 24 h). "A receber" ficou fora: RULES.md,
   regra 16, deixa recebimentos e saldo fora do MVP. A entrega prometida vem
   da ficha (`data_entrega_confirmada`); pedido da loja não tem e não entra.
3. **Pedidos para produção (Rose, Sílvio, sev. 4).** Pendentes e exceções
   primeiro; coluna "Entrega" com prazo relativo; filtro "Prontos para produção";
   cartões empilhados no celular em vez de tabela com rolagem lateral.
   *Resolvido na tela (branch `design/pedidos-producao-celular`):* Pendentes
   antes de Confirmados; dentro de cada grupo, exceções (entrega atrasada,
   pedido parado, ficha da loja não impressa) e depois a entrega mais
   próxima. Coluna "Entrega" com prazo relativo, filtro "Prontos para
   produção" (confirmados, sem teste e não entregues) e cartões abaixo de
   768 px. A ordem vale para as páginas já carregadas; a API não mudou.
4. **Grade de tamanhos (Rose, sev. 4).** Tamanho e quantidade com o mesmo peso,
   ordem canônica, alerta de tamanho duplicado — na tela e na ficha impressa.
   *Resolvido na tela:* a ordem canônica só reordena a leitura; os dados e a
   edição mantêm a ordem digitada. *Pendente:* a ficha impressa segue a ordem
   digitada e sem alerta até um ADR que supersede o ADR 017. Adicionais
   preenchidos já abrem em pedido confirmado.
5. **Glossário único (todas, sev. 3).** O assistente aparece como "IA",
   "agente", "Assistente Silmer" e "Vendedor Silmer". Um termo, configurável.
   _Na Caixa de Entrada e nos selos de conversa: "Agente", vindo de
   `brand.assistant` (`src/brand/index.js`); demais telas no próximo ciclo._
6. **Ações destrutivas e feedback (Sílvio, sev. 3).** "Desativar" e "Reabrir
   pedido" sem confirmação; sucesso só anunciado para leitor de tela. Toast
   visível com "Desfazer".
   *Resolvido para Reabrir pedido e Desativar vendedor:* confirmação que
   descreve a consequência e toast visível (`AppToast`); "Desfazer" só onde
   a volta é segura (reativar a conta), não na reabertura.
7. **Vocabulário de segmento (Marina, sev. 4).** Os sete pontos da ficha,
   catálogo, "FAB", "feito_pela_silmer" e a grade de tamanhos são de confecção.
   Esquema de item por segmento e template de impressão parametrizado (pede ADR).
8. **Primeira execução (Marina, sev. 3).** Vazio inicial (com CTA) diferente de
   vazio por filtro (com "Limpar filtros"); checklist de primeiros passos.

## Referências consultadas

- Dribbble: "CRM Inbox – Light Theme" (Alper Tornaci), "Client Balance Overview ·
  CRM @Ekwateur", "Clean CRM Dashboard UI/UX Concept", "Relasify – CRM
  Dashboard", "Sidebar" (light navigation). Padrões tirados: navegação calma no
  canvas com conteúdo em painel, título de página compacto, tabelas com status em
  badge claro, uma cor de ação.
- ReUI: `c-sidebar-1` (shell com painel inset e conta no rodapé), `c-table-7` e
  `c-data-grid-34` (tabela de pedidos com badges `-light`), skill de cor e tema
  (tokens semânticos, estados `success/info/warning/destructive`, estilo "nova":
  botões 32–36 px, raio `lg`, cartões `xl`).

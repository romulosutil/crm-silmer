# Pedidos MVP — Contexto e decisões

**Coletado em:** 09/09 a 12/09/2026, em revisão de design com o PO
**Spec:** [`spec.md`](spec.md)
**Status:** Pronto para arquitetura

---

## Limite da feature

Um pedido nasce da conversa (pelo agente ou pelo vendedor), é completado de
forma não linear, tem só dois status — **Pendente** e **Confirmado** — e só
pode ser impresso depois de uma confirmação humana. A Caixa de Entrada ganha a
triagem por quem precisa agir e uma gaveta com o resumo do pedido. A lista de
Pedidos substitui o que seria o Kanban.

---

## Decisões de implementação

### Ciclo de vida

- **D01** Dois status: `pendente` e `confirmado`. Única transição humana de ida:
  "Confirmar pedido". Única volta: "Reabrir pedido".
- **D02** O **agente cria** o pedido pendente quando confirma a intenção de
  compra. Isso muda a regra atual do contrato n8n ("nenhuma informação inferida
  vira Pedido oficial"). Reconciliação: **Pendente é rascunho não oficial;
  oficial é Confirmado**, e confirmar continua sendo humano. Registrar em ADR
  006, que supersede o trecho "Pedido será uma decisão posterior" da ADR 004.
- **D03** O vendedor (dono) ou um admin também pode **criar manualmente** quando
  o agente não detectou a intenção. Sem isso a conversa ficaria sem saída.
- **D04** **Vários pedidos por conversa, um pendente por vez.** Nova intenção
  com pendente aberto reaproveita o pendente.
- **D05** **Toda confirmação é humana.** Nada muda o status sozinho: nem
  pagamento, nem produção, nem tempo, nem o agente (exceto criar).
- **D06** **Reabrir existe no MVP**: dono da conversa ou admin; volta a
  Pendente, preserva número, bloqueia impressão de novo e registra quem
  reabriu.

### Posse e permissões

- **D07** **Confirmar**: dono da conversa + admin (não reutiliza as ações
  admin-only `order-form.approve`, `quote.approve`, `sale.approve`).
- **D08** **Editar pedido pendente segue o dono da conversa.** Outro vendedor
  retoma usando "Repassar atendimento" ou assumindo conversa sem responsável.
  Não existe posse própria de pedido.
- **D09** **Imprimir**: qualquer usuário operacional, desde que o pedido esteja
  confirmado.

### Campos e documento

- **D10** Campos e ordem das seções seguem o template aprovado
  `ficha-canonical-v2` (`scripts/ficha-pdf-review.mjs → buildFichaHtml` e
  `docs/phase0/ficha-pdf-synthetic.json`).
- **D11** Arte, locais, logística, finalidade e perfil de compra ficam em
  "Dados do atendimento": só leitura, a partir da pré-ficha, e **não saem na
  ficha impressa**.
- **D12** Valor final: texto em reais com prefixo `R$`, formato brasileiro,
  guardado em centavos. Condição: Pix, Cartão de crédito, Cartão de débito.
  Valor e condição **não aparecem** no documento impresso.
- **D13** Cliente vem do contato da conversa e fica bloqueado no pedido.
- **D14** Número `NN-CRM` é reservado **na criação** do pedido (a lista mostra
  número em pendentes). Data do pedido é definida **na confirmação**.
  ⚠️ O mockup da página ainda diz "número e data saem na confirmação" — corrigir
  o texto de apoio na implementação.
- **D15** Impressão só no template v2. v1 fica como fallback documental.

### Vocabulário e navegação

- **D16** "Pedido" é o termo único na interface. "Ficha" só aparece como nome
  do documento impresso interno ("FICHA DE PEDIDO").
- **D17** A página do pedido pertence a **Pedidos** (menu ativo "Pedidos"),
  com rastro "← Pedidos / NN-CRM" e origem quando aberta de uma conversa. Dois
  caminhos de entrada: lista de Pedidos e gaveta da conversa.
- **D18** Item "Pedidos" entra no menu logo após "Caixa de Entrada".

### Caixa de Entrada

- **D19** O filtro "Situação" atual (Nova, Em análise, Em atendimento, Requer
  atenção, Atendimento concluído, Atendimento encerrado) **não faz sentido e
  sai**. Entra o filtro "Estado" do design novo: **Todas · Aguardando vendedor
  · Com o agente · Com vendedor**, com motivo da parada e ordenação por tempo
  parado.
- **D20** Ficam como estão: fila **Todas / Minhas / Sem responsável**,
  **Arquivar / ver arquivadas**, **Repassar atendimento**, Assumir, Devolver à
  IA, Editar nome, Ver contato.
- **D21** Sai o bloco **"Sugestão pendente da IA"**.
- **D22** Pedido na conversa aparece numa **gaveta lateral sob demanda**, só
  **resumo + "Abrir pedido"** (e "Criar pedido" quando cabe). Edição acontece
  só na página do pedido.
- **D23** Na lista de Pedidos, a coluna **"Situação"** do design novo fica
  (pendente: o que falta + tempo parado; confirmado: quem e quando).

### Escopo cortado

- **D24** Sem cobrança/comprovante/status de pagamento, produção, entrega,
  perdido/cancelado, Mesa de Trabalho, marcos, anel de completude, histórico
  visível, artboard mobile dedicado.

---

## Discrição do agente (validar na revisão da spec)

- **A01** Confirmar exige, além de valor e condição, **ao menos um item com
  grade**. Campos vazios da ficha **não bloqueiam**: aparecem no banner e saem
  como "—" no documento. Motivo: confirmação é julgamento humano; bloquear tudo
  recria o gate rígido que tornou o Kanban inviável.
- **A02** "Tempo parado": no inbox, desde a criação do handoff pendente; na
  lista de Pedidos, desde a última alteração do pedido.
- **A03** Rótulos de motivo a partir de `handoffs.reason_code`:
  `price_before_quote`/`negotiation` → "Perguntou o valor";
  `customer_requested_human`/`human_requested` → "Pediu um vendedor";
  `briefing_complete` → "Pré-ficha completa"; `unresolved_blocker` →
  "Dado divergente"; `low_confidence` → "Agente sem confiança";
  `complaint` → "Reclamação"; `urgency` → "Urgência";
  `unsupported` → "Conteúdo não suportado".
- **A04** Impressão por página HTML do template v2 com `window.print()` no
  navegador, sem Chromium no container da API.

---

## Referências específicas

- Canvas de design: `.design/mesa-de-trabalho/` — quadros "Escopo dos status",
  "Pedidos", "Caixa de Entrada + Pedido" e "Pedido".
- Documento aprovado: `output/pdf/ficha-canonica-sintetica-v2.pdf`, gate em
  `docs/phase0/ficha-pdf-approval.json` (não sobrescrever versão aprovada).
- Contrato atual do agente: `docs/integrations/n8n/README.md`.

---

## Ideias adiadas

- Pedidos no detalhe do Cliente; KPIs de pedidos no Dashboard.
- Linha do tempo de preenchimento por campo.
- Mesa de Trabalho como visão de portfólio.
- Limpeza das rotas mortas de Kanban/Negócio no OpenAPI e do módulo
  `deals-pipeline` órfão.
- Rever a coluna "Situação" do Cliente e o KPI "Requerem atenção" do Dashboard,
  que ainda usam os estados antigos da conversa.

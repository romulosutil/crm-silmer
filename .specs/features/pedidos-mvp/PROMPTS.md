# Pedidos MVP — Prompts por grupo

Cada bloco abaixo é para colar numa **conversa nova** do Claude Code aberta no
repositório. Os prompts são autocontidos: o agente não precisa desta conversa.

## Ordem de execução

```
A ──→ B ──→ C ──┬──→ D ─────────────┐
                ├──→ E ──→ F ───────┼──→ H
                └──→ G (após T26) ──┘
```

- **A** primeiro, sozinho.
- **B** depois de A no branch de integração.
- **C** depois de B.
- **D** e **E** em paralelo depois de C.
- **F** depois de E (precisa de T25). **G** pode começar junto com F, mas só
  depois que **T26** (primeira task de F) estiver no branch de integração.
- **H** por último.

Branch de integração: `feat/pedidos-mvp`. Cada grupo abre PR contra ele. O PR
final `feat/pedidos-mvp → master` sai depois de H.

---

## Grupo A — Contratos e decisão (T01–T03)

```text
Você vai executar o Grupo A da feature "Pedidos MVP" no repositório
C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer (GitHub: romulosutil/crm-silmer).

LEIA ANTES DE QUALQUER ALTERAÇÃO
- .specs/features/pedidos-mvp/spec.md
- .specs/features/pedidos-mvp/context.md
- .specs/features/pedidos-mvp/design.md
- .specs/features/pedidos-mvp/tasks.md → execute SOMENTE T01, T02 e T03
- docs/adr/004-aposentar-kanban-e-negocio.md
- docs/integrations/n8n/README.md
- CLAUDE.md e AGENTS.md na raiz

BRANCH
- git fetch origin
- Crie um worktree isolado (o checkout principal pode estar em uso por outra
  sessão): git worktree add ../crm-silmer-pedidos-a -b feat/pedidos-mvp-a origin/feat/pedidos-mvp
- Trabalhe só dentro desse worktree.

COMO TRABALHAR
- Use a skill tlc-spec-driven (fase Execute) para seguir cada task.
- Uma task = um commit, Conventional Commits em inglês, com a mensagem sugerida
  na task.
- Rode o Gate de cada task antes do commit e só commite com o gate verde.
- Este grupo é só documentação: não altere código.
- A ADR 005 deve refletir exatamente as decisões D01–D09 e D24 do context.md.
  Não invente decisão nova; se algo estiver ambíguo, pare e pergunte.
- No OpenAPI, apenas adicione os caminhos de pedido. Não remova as rotas mortas
  de Kanban/Negócio (limpeza adiada).
- Se o conteúdo precisar divergir da spec, registre "SPEC_DEVIATION: <motivo>"
  no relatório.

ENTREGA
- git push -u origin feat/pedidos-mvp-a
- Abra PR contra feat/pedidos-mvp com título "Pedidos MVP — Grupo A: contratos
  e decisão" e, no corpo, a lista de tasks com os requisitos cobertos.
- Relatório final, por task: status (Done/Blocked/Partial), arquivos alterados,
  comando do gate e resultado, desvios e pendências.
```

---

## Grupo B — Domínio e persistência (T04–T13)

```text
Você vai executar o Grupo B da feature "Pedidos MVP" no repositório
C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer (GitHub: romulosutil/crm-silmer).

PRÉ-REQUISITO
- O PR do Grupo A (T01–T03) precisa estar mesclado em feat/pedidos-mvp.
  Confirme que docs/adr/005-pedido-dois-status.md existe em origin/feat/pedidos-mvp.
  Se não existir, pare e avise.

LEIA ANTES DE QUALQUER ALTERAÇÃO
- .specs/features/pedidos-mvp/spec.md, context.md, design.md
- .specs/features/pedidos-mvp/tasks.md → execute SOMENTE T04 a T13, na ordem
  do diagrama (T05 e T06 podem ser feitas em qualquer ordem; T12 é independente
  de T05–T11)
- docs/adr/004-aposentar-kanban-e-negocio.md e docs/adr/005-pedido-dois-status.md
- modules/inbox-channels/src (estrutura de módulo a copiar)
- modules/n8n-integration/src/crypto.js e postgres-repository.js (envelope cifrado)
- docs/phase0/ficha-pdf-synthetic.json (forma da ficha)
- modules/database/migrations (padrão de migration .expand.sql)
- CLAUDE.md e AGENTS.md na raiz

BRANCH
- git fetch origin
- git worktree add ../crm-silmer-pedidos-b -b feat/pedidos-mvp-b origin/feat/pedidos-mvp
- Trabalhe só dentro desse worktree.

COMO TRABALHAR
- Use as skills tlc-spec-driven (fase Execute) e superpowers:test-driven-development:
  escreva o teste que falha, implemente, veja passar.
- Uma task = um commit, com a mensagem sugerida na task. Testes na mesma task.
- Rode o Gate de cada task antes do commit.
- Proibido usar ou referenciar crm.deals*, modules/deals-pipeline ou
  modules/qualification (ADR 004).
- Nenhum dado pessoal (nome, telefone, endereço) em coluna aberta: tudo dentro
  de ficha_envelope cifrado, com o mesmo padrão de encryptJson/decryptJson.
- Descubra como o envelopeKey chega ao repositório do n8n e use a mesma
  configuração; não crie variável de ambiente nova sem registrar SPEC_DEVIATION.
- Os testes live (T12, T13) exigem o PostgreSQL de desenvolvimento, com o mesmo
  pré-requisito de "npm run test:identity:live". Se o banco não estiver
  disponível, pare e peça para subir; não pule o gate.
- A suíte de contrato do repositório (T08) deve ser a mesma usada em T13.
- Se precisar tocar em arquivo de outro grupo, pare e reporte.

ENTREGA
- git push -u origin feat/pedidos-mvp-b
- PR contra feat/pedidos-mvp: "Pedidos MVP — Grupo B: domínio e persistência".
- Relatório final, por task: status, arquivos, gate (comando, resultado e
  quantidade de testes), SPEC_DEVIATION e pendências.
```

---

## Grupo C — Autorização, API e tempo real (T14–T20)

```text
Você vai executar o Grupo C da feature "Pedidos MVP" no repositório
C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer (GitHub: romulosutil/crm-silmer).

PRÉ-REQUISITO
- Grupo B mesclado em feat/pedidos-mvp. Confirme que existem em
  origin/feat/pedidos-mvp: modules/orders/src/application/order-service.js,
  modules/orders/src/adapters/postgres-order-repository.js e
  modules/database/migrations/0023_orders.expand.sql. Se faltar, pare e avise.

LEIA ANTES DE QUALQUER ALTERAÇÃO
- .specs/features/pedidos-mvp/spec.md, context.md, design.md
- .specs/features/pedidos-mvp/tasks.md → execute SOMENTE T14 a T20
- apps/api/src/conversation-routes.js (formato de rotas, respond, posse via
  authorizeHumanCommand)
- apps/api/src/app.js, commercial-runtime.js, conversation-runtime.js
- apps/api/src/operation-runtime.js (listInbox e readLiveEvents)
- modules/identity-access/src/authorization.js (allowlist única)
- modules/inbox-channels/src/adapters/postgres-inbox-read-repository.js
- CLAUDE.md e AGENTS.md na raiz

BRANCH
- git fetch origin
- git worktree add ../crm-silmer-pedidos-c -b feat/pedidos-mvp-c origin/feat/pedidos-mvp

COMO TRABALHAR
- Skills: tlc-spec-driven (Execute) e superpowers:test-driven-development.
- Uma task = um commit; testes na mesma task; gate verde antes do commit.
- Ações novas SOMENTE em modules/identity-access/src/authorization.js. Não
  redeclare listas de ações em apps/api (esse bug já aconteceu).
- Posse: dono da conversa (assigned_user_id) ou capability COMMERCIAL_ADMIN.
  Imprimir e ler: qualquer usuário operacional.
- Todas as escritas exigem expectedVersion e Idempotency-Key. Códigos de erro
  conforme design.md → Tratamento de erros.
- Em T20, os filtros existentes do inbox (assignedUserId, archived,
  automationState, unassignedHumanHandoff) precisam continuar funcionando
  exatamente como hoje.
- T20 roda "npm run test:operation-read:live": exige o PostgreSQL de
  desenvolvimento. Sem banco, pare e peça.
- Não implemente a rota de impressão (é do Grupo E) nem mudanças no n8n (Grupo D).

ENTREGA
- git push -u origin feat/pedidos-mvp-c
- PR contra feat/pedidos-mvp: "Pedidos MVP — Grupo C: autorização, API e tempo real".
- Relatório por task: status, arquivos, gate e contagem de testes, desvios.
```

---

## Grupo D — Agente n8n (T21–T23)

```text
Você vai executar o Grupo D da feature "Pedidos MVP" no repositório
C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer (GitHub: romulosutil/crm-silmer).

PRÉ-REQUISITO
- Grupo C mesclado em feat/pedidos-mvp (apps/api/src/order-runtime.js existe).
  Se não, pare e avise.

LEIA ANTES DE QUALQUER ALTERAÇÃO
- .specs/features/pedidos-mvp/spec.md, context.md, design.md
- .specs/features/pedidos-mvp/tasks.md → execute SOMENTE T21, T22 e T23
- docs/integrations/n8n/README.md (já atualizado pelo Grupo A)
- apps/api/src/n8n-routes.js e n8n-runtime.js
- modules/n8n-integration/src/postgres-repository.js (#mergeBriefing)
- ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js e o workflow DEV derivado
- CAMPOS-FICHA-E-JORNADA-P0-1.md, seção 5.1 (confirmação de intenção)
- CLAUDE.md e AGENTS.md na raiz

BRANCH
- git fetch origin
- git worktree add ../crm-silmer-pedidos-d -b feat/pedidos-mvp-d origin/feat/pedidos-mvp

COMO TRABALHAR
- Skills: tlc-spec-driven (Execute) e superpowers:test-driven-development.
- Uma task = um commit; testes na mesma task; gate verde antes do commit.
- A projeção da pré-ficha no pedido só acontece com automation_state =
  'assistant'. Com vendedor, o patch não toca o pedido.
- Preço, pagamento e status continuam recusados no briefing_patch.
- Altere apenas os arquivos do workflow versionados no repositório. NÃO publique,
  ative ou edite workflows na instância do n8n; isso é feito por uma pessoa.
- Descubra onde estão os testes existentes das rotas n8n, do repositório
  PostgreSQL do n8n e do SDK do workflow antes de criar arquivos novos. Se não
  houver teste do SDK, crie uma asserção sobre o nó que emite o evento.
- Testes live exigem o PostgreSQL de desenvolvimento. Sem banco, pare e peça.

ENTREGA
- git push -u origin feat/pedidos-mvp-d
- PR contra feat/pedidos-mvp: "Pedidos MVP — Grupo D: agente n8n".
- Relatório por task: status, arquivos, gate e contagem de testes, desvios, e
  os passos manuais necessários para publicar o workflow na instância.
```

---

## Grupo E — Impressão (T24–T25)

```text
Você vai executar o Grupo E da feature "Pedidos MVP" no repositório
C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer (GitHub: romulosutil/crm-silmer).

PRÉ-REQUISITO
- Grupo C mesclado em feat/pedidos-mvp (apps/api/src/order-routes.js existe com
  as rotas de leitura). Se não, pare e avise.

LEIA ANTES DE QUALQUER ALTERAÇÃO
- .specs/features/pedidos-mvp/spec.md (P1-5), context.md (D10, D12, D15, A04),
  design.md (renderer e snapshot de impressão)
- .specs/features/pedidos-mvp/tasks.md → execute SOMENTE T24 e T25
- scripts/ficha-pdf-review.mjs, test/ficha-pdf-review.test.js
- docs/phase0/FICHA-PDF-REVIEW.md, docs/phase0/ficha-pdf-approval.json,
  docs/phase0/ficha-pdf-synthetic.json
- output/pdf/ficha-canonica-sintetica-v2.pdf (referência visual)
- CLAUDE.md e AGENTS.md na raiz

BRANCH
- git fetch origin
- git worktree add ../crm-silmer-pedidos-e -b feat/pedidos-mvp-e origin/feat/pedidos-mvp

COMO TRABALHAR
- Skills: tlc-spec-driven (Execute) e superpowers:test-driven-development.
- Uma task = um commit; testes na mesma task; gate verde antes do commit.
- O template v2 está APROVADO e travado por hash. NUNCA regenere nem sobrescreva
  os PDFs em output/pdf nem altere hashes em docs/phase0.
- T24 é refatoração pura: comece pelo teste golden que captura o HTML atual para
  o snapshot sintético e só então extraia. Com synthetic:true a saída tem de ser
  byte a byte igual. "npm run validate:ficha-pdf-review" precisa continuar verde.
- O documento impresso não mostra valor nem condição de pagamento; vendedor =
  quem confirmou; data = data do pedido; campos de produção em branco.
- Pedido pendente → 409 ORDER_NOT_CONFIRMED.
- Não adicione Chromium/Puppeteer à API: a impressão é HTML A4 paisagem e o
  navegador imprime.

ENTREGA
- git push -u origin feat/pedidos-mvp-e
- PR contra feat/pedidos-mvp: "Pedidos MVP — Grupo E: impressão".
- Relatório por task com status, arquivos, gate, contagem de testes e desvios.
```

---

## Grupo F — Tela de Pedidos (T26–T34)

```text
Você vai executar o Grupo F da feature "Pedidos MVP" no repositório
C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer (GitHub: romulosutil/crm-silmer).

PRÉ-REQUISITO
- T26 só depende do Grupo A (OpenAPI com os caminhos de pedido). Faça T26
  PRIMEIRO, logo que o Grupo C estiver mesclado, e abra um PR só com ela, porque
  o Grupo G depende dela.
- T27–T34 exigem os Grupos C e E mesclados em feat/pedidos-mvp (rotas de pedido
  completas e GET /api/v1/orders/:orderId/print). Se faltar, pare e avise.

LEIA ANTES DE QUALQUER ALTERAÇÃO
- .specs/features/pedidos-mvp/spec.md (P1-3 a P1-7), context.md, design.md
  (seção Frontend)
- .specs/features/pedidos-mvp/tasks.md → execute SOMENTE T26 a T34
- Mockups aprovados em .design/mesa-de-trabalho/: Pedidos.dc.html (lista),
  Ficha.dc.html (página do pedido) e Status.dc.html (escopo dos status).
  Abra os arquivos .dc.html como referência de layout, textos e hierarquia.
- apps/edge-web/src/views/InboxView.vue e ClientsView.vue (padrão de view Vue
  com <script setup>, api-client, liveEvent injetado)
- apps/edge-web/src/tokens.css, styles.css, screen-styles.css
- apps/edge-web/src/App.vue e router.js
- test/e2e/foundation.spec.js e crm-ui.spec.js (padrão Playwright)
- CLAUDE.md e AGENTS.md na raiz

BRANCH
- git fetch origin
- git worktree add ../crm-silmer-pedidos-f -b feat/pedidos-mvp-f origin/feat/pedidos-mvp

COMO TRABALHAR
- Skills: tlc-spec-driven (Execute) e superpowers:test-driven-development.
- Uma task = um commit; e2e da task no mesmo commit (test/e2e/orders.spec.js);
  gate verde antes do commit.
- edge-web não pode ter dependências de runtime novas. Só tokens existentes;
  rode "npm run check:design-tokens".
- Vocabulário: "pedido" em toda a interface. "Confirmar pedido" é o único botão
  primário da página. "Imprimir" desabilitado com cadeado e motivo até confirmar.
- Página do pedido pertence a Pedidos: item de menu ativo "Pedidos" e rastro
  "← Pedidos / NN-CRM" com a origem quando vier da conversa.
- Uma seção em edição por vez (editingSection na view).
- Correção obrigatória do mockup (context.md D14): o número do pedido já existe
  no pendente; só a data do pedido é definida na confirmação.
- Quem não é dono da conversa nem admin vê tudo em leitura, sem Editar,
  Confirmar ou Reabrir.
- Não altere InboxView.vue (é do Grupo G).
- Os e2e exigem o ambiente usado por "npm run test:e2e". Se não subir, pare e peça.

ENTREGA
- PR 1 (só T26) contra feat/pedidos-mvp: "Pedidos MVP — Grupo F: formatação de pedido".
- PR 2 (T27–T34) contra feat/pedidos-mvp: "Pedidos MVP — Grupo F: tela de Pedidos".
- Relatório por task: status, arquivos, gate e contagem de testes, desvios, e
  capturas de tela da lista, da página pendente e da página confirmada.
```

---

## Grupo G — Caixa de Entrada (T35–T38)

```text
Você vai executar o Grupo G da feature "Pedidos MVP" no repositório
C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer (GitHub: romulosutil/crm-silmer).

PRÉ-REQUISITO
- Grupo C mesclado em feat/pedidos-mvp e T26 do Grupo F mesclada
  (apps/edge-web/src/lib/order-format.js existe). Se faltar, pare e avise.

LEIA ANTES DE QUALQUER ALTERAÇÃO
- .specs/features/pedidos-mvp/spec.md (P1-8 e P1-9), context.md (D19–D22, A02,
  A03), design.md (Frontend e listInbox)
- .specs/features/pedidos-mvp/tasks.md → execute SOMENTE T35 a T38
- Mockup aprovado: .design/mesa-de-trabalho/Main.dc.html (Caixa de Entrada +
  pedido). Observação: o mockup mostra o pedido como coluna fixa, mas a decisão
  final (D22) é GAVETA LATERAL SOB DEMANDA com resumo + "Abrir pedido".
- apps/edge-web/src/views/InboxView.vue inteiro (fila, arquivar, repassar,
  posse, liveEvent)
- apps/edge-web/src/lib/ui.js (dialog e foco), lib/order-format.js
- test/e2e/crm-ui.spec.js
- CLAUDE.md e AGENTS.md na raiz

BRANCH
- git fetch origin
- git worktree add ../crm-silmer-pedidos-g -b feat/pedidos-mvp-g origin/feat/pedidos-mvp

COMO TRABALHAR
- Skills: tlc-spec-driven (Execute) e superpowers:test-driven-development.
- Uma task = um commit; e2e da task no mesmo commit; gate verde antes do commit.
- Remover: menu "Situação" (INBOX_STATES) e bloco "Sugestão pendente da IA".
- Adicionar: filtro "Estado" com Todas · Aguardando vendedor · Com o agente ·
  Com vendedor, usando pendingHandoff e automationState do servidor.
- MANTER funcionando como hoje: fila Todas/Minhas/Sem responsável, Arquivar e
  ver arquivadas, Repassar atendimento, Assumir, Devolver à IA, Editar nome e
  Ver contato. Cubra as combinações no e2e.
- Motivo da parada a partir de handoff.reasonCode com os rótulos de A03; tempo
  parado desde handoff.createdAt; ordenar por tempo parado em "Aguardando vendedor".
- Gaveta: fecha com Esc e clique fora, devolve o foco ao botão "Pedido",
  navegável só por teclado. Não edita; "Criar pedido" só para dono ou admin.
- edge-web sem dependências novas; só tokens existentes ("npm run check:design-tokens").
- Não altere as views de Pedidos (Grupo F).

ENTREGA
- git push -u origin feat/pedidos-mvp-g
- PR contra feat/pedidos-mvp: "Pedidos MVP — Grupo G: Caixa de Entrada".
- Relatório por task com status, arquivos, gate, contagem de testes, desvios e
  capturas de tela do filtro "Estado" e da gaveta aberta.
```

---

## Grupo H — Verificação final (T39)

```text
Você vai executar o Grupo H (verificação final) da feature "Pedidos MVP" no
repositório C:\Users\sutil\Documents\dev\PESSOAL\apps\crm-silmer
(GitHub: romulosutil/crm-silmer).

PRÉ-REQUISITO
- Grupos A a G mesclados em feat/pedidos-mvp. Confira na lista de PRs mesclados
  e no log de origin/feat/pedidos-mvp. Se faltar algum, pare e avise.

LEIA
- .specs/features/pedidos-mvp/spec.md (todas as histórias e a tabela de
  rastreabilidade), context.md, tasks.md (T39)
- Skill tlc-spec-driven, references/validate.md

BRANCH
- git fetch origin
- git worktree add ../crm-silmer-pedidos-h -b feat/pedidos-mvp-h origin/feat/pedidos-mvp

COMO TRABALHAR
- Use superpowers:verification-before-completion: nenhum "passou" sem a saída
  do comando.
- Rode, nesta ordem, e guarde as saídas:
  1. npm run validate
  2. npm run test:orders:live
  3. npm run test:operation-read:live
  4. npm run test:e2e
- Para cada requisito da tabela de rastreabilidade, aponte a evidência (teste,
  arquivo e linha) e mude o status para Verified. Requisito sem evidência fica
  Pending e entra no relatório como lacuna.
- Não corrija código neste grupo. Falha ou lacuna vira item no relatório com o
  grupo responsável.
- Faça um roteiro de UAT curto (máximo 10 passos) cobrindo: agente cria pedido,
  vendedor assume, edita seção, confirma, imprime, reabre; e o filtro "Estado"
  com a gaveta.

ENTREGA
- Commit único "docs(specs): verify orders MVP traceability" com a spec atualizada.
- git push -u origin feat/pedidos-mvp-h e PR contra feat/pedidos-mvp.
- Relatório: resultado de cada comando, lacunas por requisito, falhas por grupo
  e o roteiro de UAT.
```

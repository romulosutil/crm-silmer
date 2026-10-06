# Architecture Decision Records

Esta pasta contém as decisões arquiteturais já tomadas no CRM Silmer.

## Convenção

- Nomeie os arquivos como `NNN-titulo-em-kebab-case.md`.
- Use numeração sequencial com três dígitos, começando em `001`.
- Escreva o ADR em português, salvo quando houver motivo técnico para manter
  um termo em inglês.
- Inclua data, status, decisores, contexto, decisão, consequências e links
  para RFCs, requisitos, issues e PRs relacionados.
- ADR é registro histórico: não reescreva uma decisão aceita. Quando ela
  mudar, crie um novo ADR e marque o anterior como superseded.

## Quando usar

Crie um ADR depois que a decisão arquitetural estiver tomada ou em fase final
de formalização. Para uma proposta que ainda precisa de avaliação e aprovação,
use [`../rfc/`](../rfc/) primeiro.

O ADR não substitui `ARCHITECTURE.md`, `TECHNICAL-DESIGN.md` nem os requisitos
canônicos; ele registra o contexto e o motivo da escolha.

## Índice

- [001 — Adotar Vue 3 no frontend do CRM](001-adotar-vue-no-frontend.md)
- [002 — Adotar adaptador de integração n8n](002-adotar-adaptador-de-integracao-n8n.md)
- [003 — Adotar integração n8n simples para o MVP](003-adotar-integracao-n8n-mvp-simples.md)
- [004 — Aposentar Kanban e Negócio](004-aposentar-kanban-e-negocio.md)
- [005 — Excluir contas sem histórico](005-excluir-contas-sem-historico.md)
- [006 — Pedido com dois status e confirmação humana](006-pedido-dois-status.md)
- 007 — reservado para a ficha por produto (branch `feat/ficha-por-produto`), não aceita e superada pela 017
- [008 — Lastro de datas do pedido](008-lastro-de-datas-do-pedido.md)
- [009 — Regras de transferência e teto do bot no n8n](009-regras-de-transferencia-e-teto-do-bot.md)
- [010 — Intenção de pedido sem pergunta e tom do bot](010-intencao-de-pedido-sem-pergunta-e-tom-do-bot.md)
- [011 — Pergunta ignorada transfere e toda mensagem alimenta a ficha](011-pergunta-ignorada-e-ficha-por-mensagem.md)
- [012 — Ficha de sete pontos e ritmo fixo do bot](012-ficha-de-sete-pontos-e-ritmo-fixo.md)
- [013 — Só pedido do zero no bot e meta de meia ficha](013-pedido-do-zero-e-meta-de-meia-ficha.md)
- [014 — Pedido abre no primeiro ponto da ficha](014-pedido-abre-no-primeiro-ponto-da-ficha.md)
- [015 — A conversa não volta para o bot](015-conversa-nao-volta-para-o-bot.md)
- [016 — Itens com os sete pontos da ficha](016-itens-com-os-sete-pontos-da-ficha.md)
- [017 — Ficha impressa com os sete pontos](017-ficha-impressa-com-os-sete-pontos.md)
- [018 — O cliente do pedido acompanha o contato](018-cliente-do-pedido-acompanha-o-contato.md)
- [019 — Ficha espelhada e sinais operacionais](019-ficha-espelhada-e-sinais-operacionais.md)
- [020 — Técnica por item e arte do pedido](020-tecnica-por-item-e-arte-do-pedido.md)
- [021 — Adotar OpenAI no MVP](021-adotar-openai-no-mvp.md)
- [022 — Manter deploy automático GitHub → EasyPanel](022-manter-deploy-automatico-github-easypanel.md)
- [023 — Mídia do chat no RustFS](023-midia-do-chat-no-rustfs.md)

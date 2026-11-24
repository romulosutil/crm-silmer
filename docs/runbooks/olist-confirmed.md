# Olist a partir do Pedido confirmado (`OLC-T01`–`OLC-T06`)

Rastreabilidade: [spec OLC-01–16](../../.specs/features/olist-confirmed/spec.md),
[tarefas OLC-T01–T06](../../.specs/features/olist-confirmed/tasks.md),
[ADR 079](../adr/079-olist-a-partir-do-pedido-confirmado.md),
[ADR 080](../adr/080-valor-final-com-frete.md),
[ADR 082](../adr/082-cadastro-obrigatorio-somente-no-envio-olist.md),
[ADR 062](../adr/062-olist-exportacao-com-unitario-exato-em-centavos.md),
[ADR 069](../adr/069-olist-invalidacao-administrativa-de-export.md),
[ADR 070](../adr/070-olist-quota-com-espera-de-leitura-e-folga.md) e
[RFC 050](../rfc/050-geracao-assistida-de-pedidos-no-olist.md).
Runbooks complementares preservados como base histórica e de detalhes:
[frete no Pedido](order-freight.md), [Fase 2](olist-phase2.md),
[Fase 3](olist-phase3.md), [Fase 4](olist-phase4.md),
[Fase 5](olist-phase5.md) e [Fase 6](olist-phase6.md).

Este documento consolida a operação do fluxo simplificado a partir do Pedido
confirmado, registra as evidências sanitizadas de `OLC-T05` (em ambiente local
Docker/PostgreSQL 17 com dados sintéticos) e define o checklist operacional para
abertura e aceite do piloto real (`OLC-T06`).

## 1. Fluxo vigente e arquitetura enxuta

Fluxo operacional no detalhe do Pedido (`/pedidos/:orderId`):

`Pedido confirmado → Gerar no Olist → Venda conferida`

1. Enquanto o Pedido está `pendente`, o vendedor responsável informa o frete (ou
   aplica uma cotação válida), revisa itens/tamanhos e confirma o Pedido (`Gerar pedido` / confirmação comercial). Cadastro incompleto do comprador ou unitário não divisível em centavos **não** bloqueia salvar, confirmar nem gerar PDF (`ADR 082`).
2. Com o Pedido `confirmado` (não cancelado), o operador habilitado no piloto vê o bloco **Olist** no detalhe (`OrderOlistSection.vue`), com eventual bloqueio acionável por campo (`pendingFields` com atalho para cadastro/itens/configuração) ou ação direta **Gerar no Olist**.
3. O clique dispara diretamente `POST /api/v1/orders/:orderId/olist/export` (sem exigir prévia manual em dois gestos para pedidos elegíveis). Em falha segura pré-efeito (`state='failed_safe'` com `retrySafe === true`), o operador pode acionar **Retomar geração** (incluindo data de vencimento quando `paymentDuePolicy='per_order'`).
4. O acompanhamento assíncrono exibe o progresso por etapas (`OrderOlistProgress.vue`: comprador, produto, variação e venda) até **Venda conferida** (`confirmed` ou `linked`).

### Superfícies de interface e autorização

| Aspecto | `OrderOlistSection.vue` (`/pedidos/:orderId`) | `OrderOlistPanel.vue` (`/olist`) |
| --- | --- | --- |
| Papel na arquitetura | Fluxo principal enxuto no detalhe comercial (`OLC-T04`). | Painel herdado (Fases 2/4) de lookup e fluxo administrativo em dois gestos (`OLIST-33`). |
| Disparo de geração | Direto: `Gerar no Olist` / `Retomar geração` (`POST /export` sem `previewToken`). | Explícito em 2 gestos: `Revisar envio` (`POST /preview` → `/preview/check`) → `Enviar para Olist`. |
| Menu e escopo de leitura | Zero menu novo para vendedor; usa leitura comercial existente do Pedido. | Acesso em `/olist` para `COMMERCIAL_ADMIN` ou usuário com `olistEnabled=true`. |
| Conexão e recuperação | Exibe `OrderOlistRecovery.vue` no detalhe somente para `COMMERCIAL_ADMIN`. | `OlistView.vue` concentra OAuth (`/authorize`, `/callback`, `/disconnect`), parâmetros centrais, flag de criação, confirmação pós-restore, catálogos e mapeamento por UUID. |

Regras invariantes de autorização (`OLC-02` e `OLIST-02`–`05`):

- **Autorização efetiva:** exige usuário humano ativo (`status='active'`), checkbox `olistEnabled=true` (default `false` no banco e na gestão Admin em `/usuarios`), leitura comercial do Pedido (`orderReadable`, preservando carteiras privadas `WAP-07/08` e bloqueando outros vendedores) e ID exato presente em `OLIST_PILOT_USER_IDS`.
- **Sem herança nem auto-habilitação:** `COMMERCIAL_ADMIN` não herda permissão de gerar/retomar no Olist sem o checkbox próprio e inclusão na allowlist privada; Admin também não pode se auto-habilitar.
- **Financeiro isolado:** `Financeiro` não acessa `/pedidos/:orderId`, não possui leitura comercial (`commercialRead=false`), recebe `403 FORBIDDEN` em qualquer comando Olist de Pedido e não recebe `pendingFields` nem `retrySafe` na projeção (`/api/v1/orders/:orderId/olist`).
- **Revalidação sob lock (`api` e `worker`):** `createOlistExportCommand` e `createOlistDispatchRuntime` exigem `requireCommercialRead: true`, bloqueando despacho ou próximo estágio caso o usuário perca `olistEnabled`, deixe `OLIST_PILOT_USER_IDS`, seja desativado ou tenha perfil rebaixado antes de nova reserva.

## 2. Configuração central, mínimos fiscais e regras monetárias

### Variáveis de ambiente privadas (API e worker alinhados)

Consulte [`.env.example`](../../.env.example), [`ops/easypanel/topology.json`](../../ops/easypanel/topology.json) e [`modules/olist/src/configuration.js`](../../modules/olist/src/configuration.js). API (`silmer-api`) e worker (`silmer-worker`) devem receber os mesmos valores para as flags e chaves compartilhadas:

| Variável | Função e guarda |
| --- | --- |
| `OLIST_ENABLED` | `true` habilita conexão/consultas; ausente/`false` desliga toda a integração mantendo startup saudável. |
| `OLIST_DISPATCH_ENABLED` | `true` inicia a fila `olist` (`olist.export`) no worker; desligado/ausente estanca efeitos criadores imediatamente sem desligar `olist_reconcile`. |
| `OLIST_PILOT_USER_IDS` | Lista privada separada por vírgula com até 16 IDs exatos de usuários CRM (`[A-Za-z0-9:_-]{1,200}`); ausente, vazia ou inválida nega geração para todos. |
| `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET` | Credenciais do aplicativo OAuth privado; nunca entram em logs, respostas ou UI. |
| `OLIST_REDIRECT_URI` | URL HTTPS exata na mesma origem de `APP_ORIGIN`, caminho `/olist`, sem query, fragmento ou usuário/senha. |
| `OLIST_EXPECTED_ACCOUNT_DOCUMENT` | CPF (11 dígitos) ou CNPJ (14 caracteres normalizados) esperado da empresa; conferido em `/info` antes de gravar tokens. |
| `OLIST_ENVELOPE_KEY` | Chave exclusiva de 32 bytes em base64 para envelopes AES-256-GCM. |
| `OLIST_IDENTITY_HMAC_KEY` | Chave distinta de 32 bytes em base64 para HMAC-SHA256 de conta e identidades de recursos. |
| `IDEMPOTENCY_ENVELOPE_KEY` | Chave de 32 bytes em base64url usada por `PostgresIdempotencyRecordStore`. |

### Parâmetros centrais e mínimos fiscais (`crm.olist_settings`)

Configurados em `/olist` por `COMMERCIAL_ADMIN` com versão otimista e auditados por código fixo:

- **Obrigatórios para gerar:** `sellerId`, `operationNatureId`, `warehouseId`, `paymentMethodId`, `originId`. Ausência ou inconsistência com o catálogo remoto bloqueia com `OLIST_SETTINGS_REQUIRED` / `OLIST_SETTINGS_INVALID`.
- **Mínimos fiscais para novos produtos (`productFiscal`):** `ncm` (8 dígitos), `origin` (inteiro `0..8`) e `unit` (`1..6` caracteres alfanuméricos maiúsculos) — exigidos em conjunto ou todos omitidos/adiados explicitamente; não existem defaults fiscais nem preenchimento automático.
- **Política de vencimento (`paymentDuePolicy`):**
  - `erp`: omite pagamento/parcelas para definição no Olist (recomendado no piloto).
  - `fixed_date`: usa `paymentDueOn` (`YYYY-MM-DD`) central.
  - `per_order`: exige `paymentDueOn` válido no envio direto e também ao acionar **Retomar geração**.
- **Compra/recebimento opcionais:** `receivingMethodId`, `priceListId`, `paymentTerms` (enum/texto limitado, nunca derivado para data), `purchaseOrder`.

### Cadastro completo obrigatório (`ADR 082`), frete (`ADR 080`) e centavos exatos (`ADR 062`)

- **Comprador completo somente no envio Olist (`ADR 082`):** `modules/olist/src/existing-buyer.js` (`OLIST_BUYER_REQUIRED_REGISTRATION`) exige no envio os campos `personType`, `document`, `legalName`, `postalCode`, `city`, `state`, `street`, `district` e `number`, além de `stateRegistration` para pessoa jurídica (`company`), `buyer.name` e `buyer.phone` normalizado (`buyer.email` opcional válido). Qualquer pendência gera `OLIST_BUYER_REQUIRED` / `OLIST_BUYER_INVALID` com atalho por campo antes de reserva ou chamada HTTP. Não há atalho por `erp-existing-v1` ou busca por nome/telefone no novo envio; o vínculo administrativo histórico (`readonly-inspector.js` / `legacy-sale-only-v1`) permanece isolado.
- **Frete no total e `valorFrete` (`ADR 080`):** Pedidos novos precificados por tamanho gravam `pricing_rule = 'pieces-freight-v1'` e `final_amount_cents = sum(subtotals) + freight_cents`. A confirmação congela `freight_cents` (`ORDER_FREIGHT_FROZEN` em banco). Na exportação:
  - Quando `freight_cents === 0`, `valorFrete` é omitido do POST para compatibilidade byte a byte com reservas sem frete.
  - Quando `freight_cents > 0`, `valorFrete` vai como literal decimal em reais fora dos unitários; `valorTotalProdutos` equivale à soma dos itens e `valorTotalPedido` equivale a `valorTotalProdutos + valorFrete` (`valorDesconto` e `valorOutrasDespesas` ausentes ou zero). Divergência no readback pós-POST preserva `observed_sale_id` e marca a operação como incerta.
- **Centavos exatos (`ADR 062`):** `prepareExactCentExport` e `reconcileExactCentExport` exigem `subtotalCents % quantity === 0` por linha de tamanho. Unitário fracionário (`OLIST_FRACTIONAL_CENT_UNIT`) bloqueia apenas a exportação Olist, mantendo confirmação, cobrança e PDF intactos.
- **Revisão comercial (`commercial_revision`):** alterações comerciais incrementam `commercial_revision` e invalidam snapshots/prévias pendentes; marcos operacionais independentes (`payment`, `delivery`, `first_print`) atualizam `version` sem incrementar `commercial_revision`, preservando envio enfileirado quando `snapshot.commercialRevision` permanece igual. Após reserva/envio/vínculo, `olist-commercial-lock.js` bloqueia edição comercial, reabertura, enriquecimento (`/price-breakdown`) e correção da loja (`ORDER_OLIST_LOCKED`).

## 3. Operação, quotas, segurança, recuperação e rollback

### Quotas e backoff (`modules/olist/src/quota.js` e `apps/worker/src/worker.js`)

| Perfil / regra | Limite vigente | Comportamento |
| --- | --- | --- |
| Janela compartilhada (`crm.olist_quotas`) | 30 chamadas / 60 s por conta | Coordenada em Postgres via advisory lock; `429` do provedor aplica `Retry-After` ou bloqueio de 60 s. |
| Leitura do worker (`worker`) | espera até 90 s (teto 30) | Dorme em fatias ≤ 10 s + jitter 250 ms emitindo `heartbeat` (lease 30 s). |
| Leitura pós-POST (`patient`) | espera até 180 s (teto 30) | Confirmada por ticket após escrita já reservada. |
| Leitura na API (`api`) | espera cumulativa ≤ 8 s por request (teto 24) | Reserva 6 unidades por janela ao worker; estouro devolve `429 OLIST_RATE_LIMITED`. |
| Conferência de conta (`verifyAccount`) | espera até 15 s (teto 30) | Executada logo após troca OAuth; timeout invalida a conexão (`generation + 1`). |
| Headroom de escrita (`OLIST_WRITE_READBACKS`) | `customer: 2`, `product: 2`, `variation: 3`, `sale: 2` | POST não reserva nem dispara se não houver folga para o readback obrigatório na mesma janela. |
| Retry de fila (`olist`) | Base 15 s, dobra até 300 s, `max_attempts: 8` (~17 min) | Somente falhas pré-efeito seguras (`OLIST_RATE_LIMITED`, `OLIST_UNAVAILABLE`, `OLIST_REFRESH_IN_PROGRESS`); depois vai para `dead_letter` aguardando Admin. |

### PII, logs, proxy e retenção

- **Sem PII em superfície operacional:** CPF/CNPJ, telefone, endereço, payloads, parâmetros centrais e texto de `reason` nunca entram em logs estruturados, `crm.audit_events`, códigos de erro (`application/problem+json`), URLs ou payloads de fila (`crm.outbox_jobs` armazena somente `olist_export_id`).
- **Criptografia e sigilo:** payloads e provas ficam em `jsonb` cifrado com AES-256-GCM (`crm.olist_envelope_valid`) usando AAD por finalidade/conta/entidade; buscas usam HMAC-SHA256.
- **Callback `/olist` no edge/proxy:** `docker/nginx.conf` desliga `access_log`/`error_log` em `location = /olist` e aplica `Cache-Control: private, no-store`; o frontend limpa `code`/`state` da URL antes de inicializar o Vue Router. No EasyPanel/Traefik em frente ao edge, manter supressão de logs de acesso/Referer para `/olist` antes de autorizar OAuth real.
- **Retenção (`T15-REH-8`):** `crm.olist_exports`, `crm.olist_resources`, `crm.olist_attempts`, `crm.olist_export_resources` e `crm.olist_events` são preservados sem rotina automática de expurgo para garantir deduplicação, trilha fiscal e prevenção de reenvio.

### Reconexão, restore e reconciliação administrativa

1. **Reconexão OAuth:** `refresh_nonce` serializa renovação de token; falha após gasto do refresh token ou divergência de `/info` marca `reconnect_required=true` e incrementa `generation`. Jobs pré-efeito da geração antiga param com segurança até invalidação administrativa (`Invalidar esta geração`), que arquiva a operação sem apagar recursos já confirmados.
2. **Incerteza (`outcome_unknown` / tentativa de venda):** nunca libera `retrySafe` nem `Retomar geração` (bloqueado no banco, handler `createOlistJobHandler`, projeção e UI). Somente `COMMERCIAL_ADMIN` executa **Conferir no Olist** (`POST /reconcile`) na etapa incerta e, se a venda já existir no ERP, **Vincular venda existente** (`POST /links`).
3. **Divergência em recurso recorrente (`OLIST_RESOURCE_DIVERGENT`):** `payload_hash` dos recursos compartilhados é imutável; se o comprador/produto cadastrado antes mudou fora ou no CRM após confirmação anterior, não apagar/alterar cadastro via SQL nem tentar forçar novo POST — lançar manualmente no Olist e vincular via conferência administrativa.
4. **Restore lógico do PostgreSQL:** flags vivem no próprio banco restaurado; manter `OLIST_DISPATCH_ENABLED` desligado ao subir após restore, garantir `creation_enabled=false` e `recovery_required=true` na conta, aposentar leases vencidos, invalidar prévias/gerações pré-efeito abertas e reconciliar a janela de recursos e vendas antes de retirar `recovery_required` e religar criação (ensaiado em `T15-REH-R` via `CREATE DATABASE ... TEMPLATE`).

### Rollback conservador

- **Parada imediata de escrita:** desligar `OLIST_DISPATCH_ENABLED` no `silmer-worker` (e/ou desligar criação em `/olist` para gravar `creation_enabled=false`). Isso estanca novas reservas/POSTs mantendo leitura administrativa e invalidação locais ativas.
- **Rollback de código (`OLC-T02`–`OLC-T05`):** esta entrega **não** adicionou novas migrations (usa as migrations já presentes em `origin/master` até `0079`, incluindo `0063`–`0072` do Olist e `0076_order_freight.expand.sql`). Reverter `apps/` e `modules/` para o commit anterior em `master` mantém compatibilidade desde que:
  - nenhuma migration `expand` ou tabela/coluna/evento/ledger seja removida (`Nunca` executar down destrutivo);
  - se já houver geração `invalidated` no banco, não voltar imagem anterior à migration `0071`;
  - se já houver Pedido com `freight_cents > 0`, manter `0076` (`orders_freight_pricing_guard` bloqueia `UPDATE` comercial de código anterior sem `crm.order_pricing_rule='pieces-freight-v1'` — comportamento seguro documentado em [`order-freight.md`](order-freight.md));
  - jamais editar `crm.olist_exports`/`attempts` em SQL para contornar estado `uncertain` ou cancelar venda no Olist automaticamente.

## 4. Evidências sanitizadas de `OLC-T05`

Todas as execuções abaixo ocorreram em ambiente local sintético (Node `v24.14.1`, npm `11.12.1`, Docker PostgreSQL `17.12`, banco exclusivo `crm_silmer_test` em loopback), **sem chamadas reais ao Olist, sem OAuth real, sem deploy e sem alteração de produção**.

### Correções integradas na revisão adversarial (`OLC-T05`)

1. **Alto (`OLC-02`) — Isolamento de `Financeiro` na projeção e na revalidação do worker:**
   - `apps/api/src/olist-runtime.js`: `project()` passou a exigir `commercialRead` antes de rodar `preview.localPlan(...)` e calcular `retrySafe`, impedindo vazamento de `pendingFields` e `retrySafe` para `Financeiro`.
   - `modules/olist/src/repository.js`, `apps/api/src/olist-export-command.js` e `apps/worker/src/olist-runtime.js`: adicionado `options.requireCommercialRead` (`lockExportActor` / `assertOlistOrderCommercialRead`) no comando e em todos os guards do worker (`dispatchGuard`, `effectGuard`, `exportCommandGuard`, `resolutionGuard`, `ensureResource`), fechando o intervalo caso um operador seja rebaixado para `Financeiro` após enfileirar o job.
   - Cobertura adicionada em `test/olist-export-command-postgres-live.test.js`.
2. **Médio (`OLC-13`) — Retomada `failed_safe` com vencimento `per_order` e pendências acionáveis:**
   - `apps/edge-web/src/components/order/OrderOlistSection.vue`: `showDueInput` passou a exibir o campo de vencimento também quando `canResume` está ativo e `paymentDuePolicy === 'per_order'`, e `canResume` passou a exigir `actionableIssues.length === 0`.
   - Cobertura adicionada em `test/e2e/olist-confirmed-t04.spec.js`.

### Matriz de gates executados (`OLC-T05`)

| Gate / Comando | Escopo e observações | Resultado exato |
| --- | --- | --- |
| `npm run validate` | Prettier (`format:check`), `tsc`, `eslint`, fronteiras, design tokens, suíte unitária (`npm test`) e build Vite (`224` módulos) | **Aprovado:** `3.084` testes (`3.022` pass, `0` fail, `62` skips condicionais sem DB nesse runner) |
| `npm run test:olist:live` | Suíte SQL Olist completa em PostgreSQL 17.12, filtros `cancelled_at` (`7` suítes), upgrade compat, runtime, guardas comerciais e ensaio T15 | **Aprovado:** `371/371` pass, `0` fail, `0` skipped |
| Regressão live de módulos vizinhos | `orders-postgres-live`, `store-orders-postgres-live`, `order-billing-postgres-live`, `finance-postgres-live` (`--test-concurrency=1`) | **Aprovado:** `73/73` pass, `0` fail, `0` skipped |
| Regressão live complementar | `migrations-live`, `store-order-correction-postgres-live`, `dashboard-postgres-live`, `identity-postgres-live` (`--test-concurrency=1`) | **Aprovado:** `12/12` pass, `0` fail, `0` skipped |
| Playwright E2E — Olist, Orders, Billing, Financeiro, Usuários, UX Budget (`21` specs) | Inclui novo cenário `per_order`/pendências em `olist-confirmed-t04.spec.js`, Axe light/dark e mobile `320px`/`390px` | **Aprovado:** `529` passed, `0` failed, `0` skipped |
| Playwright E2E — Regressão dos demais specs Chromium (`40` specs, `--ignore-snapshots`) | Restante de `test/e2e/!(audio-recorder).spec.js` (Inbox, WhatsApp, Ficha v8/v9, Pagamento público, Loja, Shipping) | **Aprovado:** `630` passed, `7` pre-existing literal skips (`crm-ui.spec.js`), `0` failed |
| `npm audit --audit-level=high` | Dependências de produção/dev com `package-lock.json` intocado | **Aprovado:** `0` vulnerabilidades (`found 0 vulnerabilities`) |
| `npm run format:check`, `npm run typecheck`, `npm run lint`, `git diff --check` | Executados após fechamento das correções e desta documentação | **Aprovado:** saída `0`, sem erros de formatação ou whitespace |

> **Observação de escopo E2E:** `test/e2e/audio-recorder.spec.js` não foi executado porque exige Firefox + PulseAudio (ambiente local possui apenas Chromium, alinhado ao recorte condicional de `.github/workflows/ci.yml`). A soma dos specs Chromium executados totaliza **1.159 aprovados, 7 skips pré-existentes e 0 falhas**.

## 5. Checklist operacional pronto para `OLC-T06` (Piloto real autorizado)

Não iniciar escrita real nem ampliar usuários antes de verificar **todos** os itens abaixo na janela de execução de `OLC-T06`:

### Pré-voo de ambiente, segurança e conta (com criação desligada)

1. **Release e health no EasyPanel:** confirmar SHA/digest de `silmer-edge-web`, `silmer-api` e `silmer-worker` correspondentes ao commit integrado, `/healthz`, `/api/health/live` e `/api/health/ready` respondendo `200`, e `node /app/modules/database/src/cli.js --phase=expand` sem pendências (`applied_count: 0` se já até `0079`).
2. **Flags alinhadas entre API e worker:** confirmar `OLIST_ENABLED=true`, `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`, `OLIST_REDIRECT_URI` (`https://<dominio>/olist`), `OLIST_EXPECTED_ACCOUNT_DOCUMENT`, chaves de 32 bytes (`OLIST_ENVELOPE_KEY`, `OLIST_IDENTITY_HMAC_KEY`, `IDEMPOTENCY_ENVELOPE_KEY`) com backup privado off-host e `OLIST_PILOT_USER_IDS` contendo **exclusivamente** o ID CRM validado da operadora piloto autorizada.
3. **Proxy e logs em `/olist`:** confirmar no proxy/Traefik que `GET /olist?...` não grava query string (`code`/`state`) nem `Referer` em logs de acesso e que `/olist` responde `Cache-Control: private, no-store`.
4. **Backup pré-janela e estado inicial da conta:** concluir snapshot/backup recuperável do PostgreSQL antes de ligar criação; confirmar em `/olist` conexão ativa com a empresa correta, parâmetros centrais salvos (sem defaults fiscais indevidos, `paymentDuePolicy` conforme decisão PO), **nenhuma** incerteza/item de reconciliação em aberto, `recovery_required` conferido e tratado somente após inventário do existente (`OLIST_RECOVERY_CONFIRMED`), e `creation_enabled=false` + `OLIST_DISPATCH_ENABLED` ainda desligado até o instante autorizado.
5. **Autorização individual no CRM (`/usuarios`):** confirmar conta ativa da operadora piloto com `olistEnabled=true`; confirmar que demais vendedores, Admins e `Financeiro` permanecem com `olistEnabled=false` (ou ausentes de `OLIST_PILOT_USER_IDS`).

### Seleção do caso e prevenção de duplicata

6. **Pedido confirmado inédito:** escolher Pedido `confirmado`, não cancelado, com cadastro do comprador 100% preenchido no CRM (`ADR 082`), subtotais por tamanho divisíveis pela quantidade (`ADR 062`), frete congelado coerente (`ADR 080`) e **sem** venda manual pré-existente no Olist.
7. **Caso já lançado manualmente no ERP:** se consulta prévia no Olist indicar que a venda já existe, **não** usar esse Pedido no piloto de criação e **não** exigir `OLC-F02`; encaminhar para conferência fora do fluxo criador para evitar duplicata.

### Execução supervisionada e critério de aceite (`OLC-T06`)

8. **Habilitação restrita na janela:** ativar `OLIST_DISPATCH_ENABLED=true` no worker (alinhado com `OLIST_PILOT_USER_IDS`) e ligar `creation_enabled=true` em `/olist` registrando motivo administrativo.
9. **Observação do fluxo no detalhe do Pedido:** confirmar que a operadora autorizada (e somente ela) vê o bloco no Pedido escolhido, aciona **Gerar no Olist** uma vez, acompanha o polling por etapas no CRM (`comprador → produto → variação → venda`) até **Venda conferida** e que reload da página / novo acesso preserva o estado sem novo envio.
10. **Conferência linha a linha no Olist ERP:** validar na venda gerada no ERP:
    - comprador exato (CPF/CNPJ, razão/nome, endereço e telefone);
    - cada produto pai e variação por tamanho, sem troca de SKU/descrição;
    - quantidades, unitários e subtotais exatos por linha;
    - `valorFrete` idêntico ao frete congelado do Pedido (ou ausente/zero se frete zero), `valorTotalProdutos`, `valorTotalPedido` e ausência de desconto/despesa inventados;
    - situação inicial prevista em aberto, vencimento conforme política central e ausência de emissão automática de NF/baixa de estoque/financeiro fora do combinado.
11. **Fechamento e decisão:** registrar evidência sanitizada (sem PII, tokens ou IDs privados em artefatos versionados). Se ocorrer qualquer erro remoto inesperado ou incerteza, **não** repetir clique nem editar SQL: desligar `creation_enabled=false`/`OLIST_DISPATCH_ENABLED` se necessário e conduzir por diagnóstico administrativo (`/reconcile` / `/invalidate`). Qualquer ampliação de `OLIST_PILOT_USER_IDS` depende de aceite explícito do PO e da Operação após o piloto observado.

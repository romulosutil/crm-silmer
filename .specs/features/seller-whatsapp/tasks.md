# WhatsApp por vendedor — plano de execução enxuto

Revisão **WAP-T00e**, 16/11/2026. [Spec](spec.md), [design](design.md),
[prompts completos](PROMPTS.md), [ADR 090](../../../docs/adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md)
e [ADR 091](../../../docs/adr/091-contratos-da-etapa1-whatsapp-pessoal.md).

A unidade de execução é **WAP-E01–E12**. Os 32 itens T do SDD inicial são
checklist interno de rastreabilidade, agrupados abaixo; não requerem 32 chats,
PRs ou ciclos completos de preparação e validação. O gate prioritário é
**WAP-E07**, equivalente ao aceite WAP-T02a-05. Primeira saída continua depois.
Nenhum item de runtime está concluído por esta revisão documental.

## WAP-T00e — reduzir o custo de execução do SDD

- [x] Consolidar os 32 itens em 12 entregas com fronteiras coerentes, dependências
      explícitas, prompts completos e modelo escolhido por risco.
- [x] Manter todos os aceites e testes; preservar o mapa T→E para retomada sem
      retrabalho, incluindo o histórico WAP-T00d.
- [x] Validar correspondência, cobertura, DAG, links e formatação; evidências em
      [validation-sdd.md](validation-sdd.md).

## Unidade de entrega e gates

Execute E01 → E12 serialmente, com dependências integradas. E05 pode ter seu
schema e leitores preparados antes, mas só entrega o escritor após E04. Cada
E é uma entrega/PR revisável: seus itens T são passos internos na ordem
indicada, com commits atômicos quando houver fronteiras distintas. Sem branch
ou PR extra por subitem mecânico. Reuse o contexto e não repita gates completos
entre passos sem alteração/falha que justifique; rode-os uma vez na fronteira
integrada antes de publicar. Não pule teste negativo, PostgreSQL real sintético
ou a11y; redução de prompts não é dispensa de aceite.

Cada entrega que introduz efeito já traz guard fail-closed/default off; E11
apenas consolida configuração/capacidade. ACL/histórico persistem com flag off.
Os prompts leem instruções vigentes e preservam trabalho de outras sessões.
Não ativar runtime parcialmente protegido; sem produção ou efeito real até o
roteiro e autorização operacional aplicáveis. Etapa 2 segue fora desta execução.

## Registro das 12 entregas

| Estado / ID | Entrega                                                                          | Modelo       | Dependência     | Checklist interno                              |
| ----------- | -------------------------------------------------------------------------------- | ------------ | --------------- | ---------------------------------------------- |
| [ ] WAP-E01 | [Provar viabilidade do provedor e privacidade](PROMPTS.md#wap-e01)               | Sol/Opus     | Base documental | WAP-T01-01                                     |
| [x] WAP-E02 | [Entregar conexão pessoal no backend e n8n](PROMPTS.md#wap-e02)                  | Sol/Opus     | WAP-E01         | WAP-T01-02, WAP-T01-03, WAP-T01-04             |
| [x] WAP-E03 | [Entregar carteira e cadastro compartilhado no servidor](PROMPTS.md#wap-e03)     | Sol/Opus     | WAP-E02         | WAP-T02-01, WAP-T02-02, WAP-T02-03, WAP-T02-04 |
| [x] WAP-E04 | [Receber atendimento humano com isolamento ponta a ponta](PROMPTS.md#wap-e04)    | Sol/Opus     | WAP-E03         | WAP-T02-05, WAP-T02-06, WAP-T02-07             |
| [x] WAP-E05 | [Criar Pedido por Assunto com compatibilidade transacional](PROMPTS.md#wap-e05)  | Sol/Opus     | WAP-E04         | WAP-T02a-01, WAP-T02a-02, WAP-T02a-03          |
| [x] WAP-E06 | [Entregar a interface mínima de Pedido pela conversa](PROMPTS.md#wap-e06)        | Terra/Sonnet | WAP-E05         | WAP-T02a-04                                    |
| [x] WAP-E07 | [Aceitar o fluxo passivo integrado de Pedido](PROMPTS.md#wap-e07)                | Sol/Opus     | WAP-E06         | WAP-T02a-05                                    |
| [x] WAP-E08 | [Completar mensagens correntes e efeitos pela linha correta](PROMPTS.md#wap-e08) | Sol/Opus     | WAP-E07         | WAP-T02-08, WAP-T03-01, WAP-T03-02, WAP-T02-09 |
| [x] WAP-E09 | [Completar Meus clientes e Meu WhatsApp na interface](PROMPTS.md#wap-e09)        | Terra/Sonnet | WAP-E08         | WAP-T04-01, WAP-T04-02, WAP-T04-05             |
| [x] WAP-E10 | [Entregar primeiro envio humano individual](PROMPTS.md#wap-e10)                  | Sol/Opus     | WAP-E09         | WAP-T04-03, WAP-T04-04                         |
| [x] WAP-E11 | [Concluir verificação e prontidão operacional](PROMPTS.md#wap-e11)               | Sol/Opus     | WAP-E10         | WAP-T05-01, WAP-T05-02, WAP-T05-03, WAP-T05-04 |
| [ ] WAP-E12 | [Homologar o piloto real da etapa 1](PROMPTS.md#wap-e12)                         | Sol/Opus     | WAP-E11         | WAP-T05-05, WAP-T05-06, WAP-T05-07             |

## Mapa de rastreabilidade dos 32 itens internos

### Evidência WAP-E07 / WAP-T02a-05 — aceite do fluxo passivo

Aceite sintético em 17/11/2026 no branch cumulativo `codex/wap-e05`, sobre
E06 `ee89502d`. O Chromium usou a API e o PostgreSQL 17.11 reais em
loopback. Dois vendedores com o mesmo Contact criaram Pedidos em conversas
e Assuntos próprios, inclusive após a queda da linha. O ensaio verificou
numeração, edição, reuso, duplo clique, concorrência e recusas por ACL,
encerramento e inativação. Corrigido o redirecionamento indevido do foco
durante a ressincronização SSE de Meus clientes.

Ensaio integrado aprovado, com mais 109 verificações PostgreSQL aprovadas
e zero skips live. Comandos, achados, limites e rollback constam no
[registro de aceite](validation-pedido.md) e no
[runbook](../../../docs/runbooks/seller-whatsapp-orders.md#ensaio-integrado-wap-e07).
Pareamento, transporte e produção seguem nos gates operacionais.

### Evidência WAP-E06 / WAP-T02a-04 — interface mínima

WAP-01/17/31/32/33, ADRs 090/091, sobre E05 `37d4d006` no branch
`codex/wap-e05`. Meus clientes lê a carteira existente e abre conversa
autorizada; confirmação captura Contact, conversa, Assunto e versões, preserva
rascunho e cancela em mudança de contexto/acesso. Resposta 201/200 anuncia
criação/reutilização e abre a ficha. O botão do cabeçalho de `d7537b3c`
permanece. [Contrato e rollback](../../../docs/runbooks/seller-whatsapp-orders.md).

- `node --test test/order-assistance-ui.test.js`: 4/4; E2E focal de carteira,
  alvo, pendente, resposta atrasada e alteração de usuário: 5/5, com teclado,
  foco, axe e viewport 390/1366. Regressão focal do cabeçalho: aprovada;
  `order-assistance.spec.js`: 14/14 na rodada focal.
- `npm run validate`: 2.866 aprovados, zero falhas, 61 skips condicionais
  live sem URL; build, lint, tipos e validações passaram. PostgreSQL sintético
  real e sem skips do E05 está registrado abaixo; esta fatia não altera SQL.
- `npm run test:e2e -- --workers=4`: 1.070 aprovados e sete skips existentes;
  `npm audit --audit-level=high`: zero vulnerabilidades; `git diff --check`.

Não houve pareamento, flag real, envio, IA ou efeito financeiro. A prova UI
usa projeções sintéticas; WAP-E07/T02a-05 permanece o gate integrado e não há
homologação de provedor ou produção.

### Evidência WAP-E05 / WAP-T02a-01–03 — Pedido por Assunto

Entrega em 17/11/2026 sobre `origin/master` `f5833287`, com WAP-E04
integrado. WAP-17/30/31/33 e OA-05/07; ADRs 090/091.
[Contrato, gates e rollback](../../../docs/runbooks/seller-whatsapp-orders.md),
[OpenAPI](../../../docs/api/openapi.v1.yaml). SHA/PR no handoff da entrega.

- 0080 expande origem nullable com FK composta, CHECK de conversa e índice,
  reutilizando a UNIQUE de 0037 e conservando o índice global. Backfill só
  alcança pendente ativo com vínculo único comprovado e mesma conversa/Contact;
  confirmados/cancelados/vínculos múltiplos permanecem intactos.
- Leitores/ports preservam origem, nome oficial, primeiro contato, snapshots e
  briefing do alvo; recusam ambiguidade e projeção automática sem alvo seguro.
  Adoção posterior também exige vínculo único; nome da pré-ficha legada não
  desaparece. Assistência e serviço de Assuntos conservam a origem na transação.
- 0081 é contrato explícito após instalar todos os consumidores compatíveis:
  cria unicidades parciais legado/alvo antes de remover o índice global.
  Criação por alvo/pessoal exige flags próprias default off, confirmação dos
  leitores compatíveis, allowlist do responsável e índices prontos.
- POST existente recebe o par opcional Assunto/versão no fingerprint. Locks
  revalidam humano/ativo/capacidade, titular, carteira, Contact, posse,
  atendimento aberto e CAS antes de efeito ou replay. Pedido/vínculo/número,
  evento/auditoria/recibo cifrado compartilham conexão e commit. Duas chaves
  sobre versão inicial criam uma vez; a perdedora recebe conflito e relê o alvo.
- Novo alvo permite outro Pedido; pendente elegível abre sem duplicar;
  confirmado/cancelado exige outro Assunto. Reabertura preserva origem e
  disputa unicidade, sem coexistir com legado não resolvido. Canal offline
  não bloqueia criação local. Admin conserva titular como responsável e não
  contorna carteira revogada. ACL comercial não libera conversa/Assunto ocultos.

Evidência sintética, Node 24.20.0/npm 11.19.0 e PostgreSQL 17.11 portátil
exclusivo em loopback, encerrado ao terminar as provas (sem Docker neste host):

- `npm run test:database`: **15/15**. Focais consolidados de ports, assistência,
  rotas, runtime e contrato em memória: **105/105**.
- PostgreSQL integrado WAP-E05 + Pedidos/assistência/cancelamento: **70/70**,
  zero skips. Última prova focal após cercar adoção ambígua: **14/14**, zero
  skips, em segundo banco dedicado para não disputar schemas. Grupos se
  sobrepõem; não somar como cenários distintos.
- Consumidores n8n/ACL, migrações/rollback e upgrade de cobrança: **28/28**,
  zero skips. Fixture do upgrade passa a exigir 0080; assertions preservadas.
- `npm run validate`: **2.865 aprovados, zero falhas, 61 skips condicionais**
  das suítes live sem URL no comando geral; formatação, typecheck, lint,
  fronteiras, validadores e build aprovados. Provas reais acima sem skips.
- E2E/axe/teclado/foco/mobile: **1.065 cenários aprovados**, sete skips legados.
  Rodada integral teve 1.063 aprovados e duas falhas de timing em áudio Firefox
  e cobrança; `playwright test --last-failed --workers=1` passou **2/2** sem
  mudar assertions ou código desses testes. Rodada inicial com build concorrente
  foi interrompida e descartada; rodada usada não teve build concorrente.
- `npm audit --audit-level=high`: **zero vulnerabilidades**. Revisão QA somente
  leitura não encontrou bloqueios no diff final. `git diff --check` aprovado.

CI PostgreSQL inclui a nova suíte explicitamente; a expansão 0080 também faz
parte da expectativa do upgrade existente. Sem UI de E06, flag/ambiente real,
pareamento, publicação de workflow, envio, IA ou cobrança. Após múltiplos alvos,
rollback somente para SHA compatível com criação desligada. À época, UI e gate
integrado eram pendentes; a evidência E06 acima não conclui E07 nem homologa
provedor ou produção.

### Evidência WAP-E04 / WAP-T02-05–07 — atendimento humano isolado

Entrega em 17/11/2026 sobre `origin/master` `a6f2cdc5`, com WAP-E03
integrado. WAP-04–08/10/11/17/20/21/28/29/32; ADRs 090/091/092.
[Contrato, fronteiras e rollback](../../../docs/runbooks/seller-whatsapp-inbound.md),
[OpenAPI](../../../docs/api/openapi.v1.yaml). SHA/PR no handoff da entrega.

- Ingresso pessoal pelo n8n autentica origem antes da persistência e revalida
  binding/conta/linha/geração/titular na transação. Flag própria default off,
  allowlist de vendedores e identidade técnica `seller-whatsapp-inbound/1.0`.
  Workflow único compartilhado, não publicado; sem IA, resposta automática,
  observação automática de Pedido, comando de saída ou importação incidental.
- Contact/vínculo/conversa humana/atribuição são atômicos, sem fila pública.
  Titular inativo previamente verificado conserva pendência privada Admin;
  repetição/reconexão não duplica nem reclassifica origem. Expansão 0079 guarda
  somente a origem imutável; envelopes, snapshots e retenção são preservados.
- Predicado comum de linha/posse/vínculo protege Inbox, counts/paginação,
  detalhe/contexto, mídia temporária/retida, Assuntos, sugestões, handoffs,
  motivo de perda, lembretes/Central e contexto de frete. Mutações/recibos revalidam sob locks;
  reancoragem concorrente retorna 409. Admin e ACL comercial são independentes:
  Pedido/cotação legíveis não projetam IDs ou metadados da conversa oculta.
- Transferência pessoal genérica é negada inclusive para Admin. Novo envio
  pessoal permanece fechado com `WHATSAPP_SEND_UNAVAILABLE` até WAP-E08;
  esta recusa não implementa nem antecipa a próxima entrega.
- SSE revalida sessão/capacidade, projeta somente tipos/IDs permitidos e
  invalida escopo também no heartbeat. Cursor anterior não cruza mudança de
  vínculo/posse/linha/identidade. UI aborta requisições e limpa conteúdo privado;
  respostas tardias não restauram dados. Conflito cadastral preserva rascunho
  comum autorizado sem revelar carteira alheia. Criar pedido de `d7537b3c`
  foi preservado.

Verificação sintética em Node 24.20.0/npm 11.19.0 e PostgreSQL 17 portátil
dedicado em loopback (sem Docker/WSL disponíveis no host):

- Focais pedidos consolidados, contratos de ingresso, sanitização e ACL; novos
  testes de cursor/eventos/heartbeat. Provas PostgreSQL reais incluem corrida,
  rollback, inativo, duas linhas/mesmo Contact, callback antigo, reancoragem,
  mídia HTTP e preservação da ACL comercial, sem skips.
- Regressões PostgreSQL que usavam somente atores projetados passaram a
  cadastrar usuários/funções/capacidades reais; assertivas de isolamento e
  contratos públicos mantidas. Migrações anteriores são imutáveis; fixtures de
  upgrade passam a esperar também 0079.
- Auditorias `npm audit --audit-level=high` e
  `npm audit --omit=dev --audit-level=high`: zero vulnerabilidades.
- `npm run validate` final aprovado: **2.861 testes aprovados, zero falhas,
  60 skips condicionais** de suítes live sem URL no comando geral; build,
  formatação, typecheck, lint, fronteiras e validadores aprovados. As suítes
  PostgreSQL desta fronteira foram executadas separadamente sem skips.
- PostgreSQL focal final: ingresso/E02/n8n **40/40**; regressões de ACL/cadastro
  **30 casos verdes**; mídia HTTP/quotas **21/21**. Última matriz de guards de
  mídia e isolamento **29/29**, seguida de lembretes/Central/matriz ampliada
  **12/12**. Grupos se sobrepõem; não somar como cenários distintos. Migração,
  concorrência e rollback foram executados em banco real sintético.
- E2E/axe/teclado/foco/mobile: cobertura final de **1.065 cenários aprovados**
  e sete skips legados. A rodada completa passou 1.063 e encontrou duas
  fixtures de renomeação que devolviam 404 em Assuntos; a fixture autorizada
  foi corrigida sem mudar assertions e a repetição focal passou **4/4**.
  Os quatro cenários novos cobrem duas sessões, revogação, resposta atrasada,
  cadastro compartilhado e recusa de Assuntos em 390/1366 px. Sem build
  concorrente no gate E2E. Banco dedicado encerrado ao fim das provas.

`git diff --check` aprovado; commit/push/PR constam do handoff desta entrega.

Seguimento do CI da [PR 397](https://github.com/romulosutil/crm-silmer/pull/397):
o job estático/E2E passou; o job PostgreSQL encontrou uma chamada legada de
Assuntos sem ator. A fixture passou a usar o vendedor sintético autenticado.
O grupo posterior, ainda não alcançado pelo CI, também foi executado localmente:
fixtures de mídia/Painel/abas agora cadastram papéis e concessões reais;
cursores incluem a versão de escopo e o upgrade espera 0079. Transferência e
replay por outro ator exigem `403 INBOX_FORBIDDEN` antes de consultar o recibo,
preservando as assertions de rollback/quota e o conflito de conteúdo do titular.
Somente testes e este registro mudaram; guardas, flags e runtime permanecem
intactos. O resultado final do CI fica registrado no handoff da PR.
Verificação local deste seguimento: pedidos cancelados **6/6**; abas, Painel
e upgrade **16/16**; mídia **102 casos cobertos**, com 100 aprovações na
rodada integral e as duas expectativas de autorização corrigidas verificadas
na repetição focal **3/3** (inclui encerramento). Nenhum skip nessas provas.
Typecheck, ESLint, Prettier e `git diff --check` aprovados.

Segundo seguimento do CI / OPS-DEPS-02: o run 1005 passou **808 testes
PostgreSQL sem skips**, **2.861 testes de validate** e **1.065 E2E/axe**, mas
foi bloqueado pelo novo advisory de picomatch. O
[runbook da correção](../../../docs/runbooks/picomatch-security-override.md)
registra a revisão do fork, procedência, limites e retirada do override exato
restrito à árvore do Vite **8.3.5**, preservado. Os **2.004 testes do fork** e
**quatro testes novos** de ataque/consumidores passaram; instalação pelo lock,
assinaturas/attestations e auditorias completa/runtime passaram, sem supressão.
O validate integral passou **2.865 testes**, zero falhas, 60 skips condicionais
de live, tipos/lint e build aprovados.
E2E/axe integral passou **1.065 testes**, sete skips legados, zero falhas ou
retries, incluindo Chromium/Firefox com áudio sintético e superfícies móveis.
Manifesto/lock, teste e runbook são necessários ao gate desta mesma entrega;
nenhum próximo E, regra de produto ou infraestrutura foi alterado. Gates
completos e conclusão do CI constam na PR para o SHA publicado.

Nenhum resultado local homologa provedor/n8n real ou autoriza produção,
pareamento, flags reais, mensagens a clientes ou efeitos financeiros.

### Evidência WAP-E03 / WAP-T02-01–04 — carteira e cadastro no servidor

Entrega em 17/11/2026 sobre `origin/master` `72b04055`, com WAP-E02
integrado. WAP-06/07/08/18/20/21/24–30; ADRs 090/091.
[Contrato e rollout/rollback](../../../docs/runbooks/seller-clients.md),
[OpenAPI](../../../docs/api/openapi.v1.yaml). SHA/PR no handoff da entrega.

- Expansão 0078: par vendedor/Contact único e independente da linha, proveniência
  imutável, revogação/reativação versionada, histórico e versão de escopo.
  `wallet_created` preserva o universo legado sem publicar cadastros pessoais
  após revogação ou movimento da última identidade. Nenhum backfill inferido.
- GET/POST `/me/clients` e POST `/me/clients/:contactId/link`: default off,
  allowlist própria, sessão/origem/CSRF/idempotência atuais. Contact+vínculo
  atômicos; seleção mantém o ID; replay reautoriza. Sem criar identidade,
  conversa, Pedido, envio ou concessão comercial. Colisão privada é genérica.
- Escritores oficiais de nome/detalhes/registro e merge/unmerge revalidam
  autoridade/acesso/CAS dentro da transação. Locks: usuário → advisory de
  telefone, se aplicável → Contacts ordenados → identidade/vínculo → ledger.
  Provas concorrentes cobrem segundo vínculo, edição, revogação, replay e
  leitura Olist, sem deadlock. Comuns/fiscal vazio permitidos; CPF/CNPJ/tipo
  preenchidos e telefone compartilhado usam Admin/conferência/motivo cifrado.
  Reenviar restrito igual não bloqueia comum; fallback privado não vira principal.
- Escopo antes de busca/cursor/count, em Clientes geral, carteira, detalhes,
  identidades e eventos de Contact. Cursores vinculam leitor/modo/versão;
  histórico, phone lookup e completude não revelam outra linha. Snapshots
  confirmados ficam byte a byte intactos; nome pendente segue o Contact e
  versões invalidam preparações sem redirecionar reservas iniciadas.
- Reconciliação interna default dry-run, contagens sem PII, somente atribuição
  comercial comprovada e allowlist; revalida prova ao aplicar e não ressuscita
  revogados. CLI local comprovou `{"dryRun":true,"candidates":0,"linked":0}`;
  aplicação/repetição/corrida de prova foram verificadas em dados sintéticos.

Verificação em Node 24.20.0/npm 11.19.0 e PostgreSQL 18.6 portátil dedicado
em loopback (Docker/WSL indisponíveis no host):

- `npm ci`, `npm run test:database` (15 aprovados), comandos focais da
  solicitação consolidados com testes novos e de contrato/eventos.
- 35 testes PostgreSQL novos nas três suítes `seller-client-links`,
  `seller-clients` e `seller-client-identity`; rodada serial com migrações,
  cadastro/leituras/Inbox/Pedidos/Olist e regressão E02: **162 aprovados, zero
  skips**. Duas fixtures legadas foram adequadas a campos de evento e Admin
  real; apenas essas duas suítes foram repetidas e passaram 2/2.
- `npm run validate`: **2.853 aprovados, 58 skips condicionais, zero falhas**;
  build aprovado. As três suítes PG novas foram executadas separadamente sem
  skips. `npm audit --audit-level=high` e `npm audit --omit=dev --audit-level=high`:
  **zero vulnerabilidades**.
- `npm run test:e2e -- --workers=2`: 1.055 aprovados/sete skips legados e seis
  falhas com página 404 durante o rebuild concorrente do `validate`. Sem mudar
  assertions/UI, `--last-failed --workers=2` passou **6/6** após cessar o rebuild:
  cobertura final de **1.061 cenários aprovados**. Sem build concorrente nos
  próximos gates. Criar pedido de `d7537b3c` foi preservado e seu cenário passou.
- `git diff --check`, formatação e checks focais finais aprovados. Nenhuma
  alteração de frontend; componentes, teclado/foco/mobile/axe do CRM foram
  exercitados pelo E2E vigente. Recursos PostgreSQL temporários encerrados.

Fora da fronteira inicial somente o necessário para a mesma entrega: contratos
OpenAPI/runbook/tarefas, CLI de rollout e job PostgreSQL existente do CI; busca
lateral de Pedido e seleção de telefone Olist recebem o filtro de identidade
pessoal para impedir que a ACL comercial exponha canal alheio. Fixtures
legadas refletem a nova autoridade/metadados sem enfraquecer assertions.

Sem publicação de workflow, pareamento, flag real, mensagem a cliente ou efeito
financeiro. Prova local não homologa provedor/produção. Rollback desliga a nova
fronteira e conserva expansão/vínculos/isolamento/histórico/motivos; exige SHA
compatível com a política pessoal. E04 e demais entregas não foram iniciadas.

Complemento de CI do [PR 396](https://github.com/romulosutil/crm-silmer/pull/396),
17/11/2026: a execução `44063976315` aprovou estática/E2E e os testes novos
de carteira, mas reprovou `order-billing-upgrade-postgres-live` porque a lista
exata de migrações esperadas ainda terminava em 0077. Falha reproduzida em
PostgreSQL local real; acrescentada somente 0078 à expectativa, mantendo as
assertions de histórico, jobs Olist/cobrança, constraints e reaplicação vazia.
Esse teste e `seller-client-links-postgres-live` passaram **9/9, zero skips**.
A nova execução do CI acompanha o commit corretivo no mesmo PR.

### Evidência WAP-E02 / WAP-T01-02/03/04 — backend e controle desligados

Entrega implementada em 16/11/2026 sobre `origin/master` `7d032732`, com o gate
técnico corrigido de E01 integrado e autorização posterior para executar E02.
WAP-E01/T01-01 continuam abertos para mobile/retenção operacional; esta entrega
não os homologa. [Contrato/runbook e comandos](../../../docs/runbooks/seller-whatsapp-control.md),
[schemas](../../../schemas/seller-whatsapp-control.v1.json) e
[evidência n8n sanitizada](../../../ops/n8n/whatsapp-control.evidence.json).

- T01-02: migração expand 0077 e repositório; linha/conta/instância estáveis,
  reserva de número inclusive desconectado e conflito geral, CAS/geração,
  bindings imutáveis e ledger/outbox de metadados. Nenhum backfill comercial.
- T01-03: estado e comandos humanos próprios, sessão/origem/CSRF/capacidade,
  versão/idempotência/limite e técnico Basic com workflow/correlação/execução.
  GET sem efeito; QR/código só ao titular atual e sem persistência/replay.
- T01-04: worker e workflows gerados inativos, controle parametrizado n8n →
  Evolution, desafio síncrono efêmero e reconciliação só por leitura. Conectar
  exige número/webhook/socket atual comprovados; callback antigo não reativa.
  Revogação é imediata mesmo com desafio/efeito em voo; logout aguarda leitura.
- PostgreSQL real sintético: **22 testes novos e 20 de regressão compartilhada**,
  zero skips/falhas; upgrade, constraints, duas transações/abas, callback antigo,
  inativação/reativação, socket antigo, desafio incerto e disconnect concorrente.
  `npm run test:database`: 15 aprovados; seis suítes focalizadas: 74 aprovados.
- n8n real com adapter/generation reais e upstream sintético:
  `technicalGate=passed`, `privacyFailures=[]`; nenhum canário em banco/dump,
  logs, snapshots ou arquivos físicos PostgreSQL/WAL. Sucesso, erro após bytes,
  progresso, manual real, replay, pinData e default off cobertos; recursos removidos.
- Gates em Node 24.20.0/npm 11.19.0: `validate` **2.846 aprovados/55 skips
  condicionais/zero falhas**, build aprovado; E2E **1.061 aprovados/sete skips
  legados/zero falhas ou retries**; audit **zero vulnerabilidades**. As duas
  suítes PostgreSQL novas foram executadas separadamente sem skips. O gate foi
  repetido somente após atualizar a lista exata esperada de ações técnicas WAP.
- Manifest/lock do worker declaram o módulo interno reutilizado; as duas suítes
  novas integram o job PostgreSQL existente do CI (30 testes focais aprovados).
  São ajustes necessários à mesma entrega, sem dependência externa nova.

Sem publicação de workflow, pareamento, flags reais, mensagens ou efeito
financeiro. Preservados Contact/ACL comercial/snapshots/retenção/linha geral e
Criar pedido de `d7537b3c`; patch alheio de index.html guardado fora do checkout.
Rollback desliga controle/ingresso, preservando expand/ledger/ACL/incerteza;
nunca apaga instância ou reativa geração antiga. E04/E08 e homologação continuam
pendentes; nenhum próximo E foi iniciado nesta sessão. SHA/PR no handoff.

### Evidência WAP-E01 / WAP-T01-01 — spike executado, aceite bloqueado

Correção autorizada em 16/11/2026, [RFC 069](../../../docs/rfc/069-ingresso-efemero-e-geracao-autenticada-do-whatsapp.md)
/ [ADR 092](../../../docs/adr/092-sanitizacao-pre-persistencia-e-geracao-na-origem.md):
[evidência corrigida](../../../ops/evolution/wap-provider-spike.fixed.evidence.json)
com technicalGate=passed, privacyFailures vazio e sem acerto físico PostgreSQL/WAL.
O gate E2E integrado foi aprovado após corrigir a fixture HTTP de áudio no
limite de 16 MiB (MED-12/30) e delimitar um seletor de Olist ao painel correto:
1.061 aprovados, sete skips legados, zero falhas/retries, sem enfraquecer
assertions. Detalhes e demais verificações no runbook vinculado abaixo.

- [x] Remover credenciais antes do output/primeiro SQL n8n e cercar manual,
      REST pinData/settings e metadados sintéticos antes de persistência.
- [x] Capturar source/token no callback do socket antes da fila; provar
      atraso A1, A2/replay, token cruzado e retry 503→revogação→403→A3 200.
- [x] Omitir pairingCode da cópia Prisma antes de SQL, preservando protocolo,
      objeto vivo e material criptográfico de sessão; scans físicos negativos.
- [x] Provar default off em nova inicialização da imagem n8n e recursos
      isolados removidos, sem flags/imagens reais modificadas.
- [ ] Homologação do código no mesmo celular e retenção operacional de
      múltiplas instâncias. Não são comprovadas por notificações sintéticas.

Os checkboxes principais E01/T01-01 continuam abertos somente nos critérios
remanescentes. API/controlador/verificador real são E02/E04 e não foram
implementados nesta correção. A descrição a seguir preserva a evidência
negativa inicial e suas limitações, superada pelos patches nos pontos acima.

Investigação em 16/11/2026, base `f7a06389`, Mel via SSH autorizado, recursos
Docker dedicados e dados sintéticos. [Contrato, reprodução, limites e alternativas](../../../docs/runbooks/seller-whatsapp-provider.md).
Código de prova em `ops/evolution/wap-provider-spike.mjs`; workflow somente de
ensaio em `ops/n8n/wap-pairing-privacy-probe.mjs`. Nenhuma rota/flag/instância de
ambiente real alterada, nenhuma conta pareada ou mensagem enviada.

- Fonte/imagem fixadas inspecionadas; create/connect/status/logout e QR/código
  observados em duas instâncias não pareadas, incluindo round-trip pelo n8n.
- Scan detectou token técnico sintético em claro em `execution_data`/pg_dump,
  apesar de save-success/error=none e save-manual/progress=false. É reprovação
  do gate de privacidade, não evidência de ausência de segredo.
- Origem por geração não é garantida pelo wrapper/token global nem pela
  configuração mutável de webhook upstream. Evento antigo não pode ser
  classificado com a geração atual. Retenção de múltiplas instâncias também
  não está provada pelo expurgo atual de uma única instância.
- Código retornado não homologa operação no mesmo celular; pareamento real
  continua fora da autorização desta entrega.

Os checkboxes **WAP-E01 e WAP-T01-01 continuam abertos**. Habilitação e avanço
dependente bloqueados até solução revisada e nova prova dos critérios faltantes;
o runbook separa limites materiais, alternativas e homologação. Não avançar E02
nesta sessão. Resultados completos dos testes e gates constam do relatório
do runbook e do PR da entrega.

As referências T existentes continuam válidas. Cada item pertence a exatamente
uma entrega E; seu checkbox só fecha quando o critério específico passar.
Os modelos e unidades de publicação são os da tabela E, que substitui a divisão
inicial de sessões/PRs por T.

| Estado / item   | Critério preservado                                      | Entrega executora             | Requisitos                        |
| --------------- | -------------------------------------------------------- | ----------------------------- | --------------------------------- |
| [ ] WAP-T01-01  | Provar controle, código mobile e privacidade do provedor | [WAP-E01](PROMPTS.md#wap-e01) | WAP-02/03/04/10/12                |
| [x] WAP-T01-02  | Persistir linha pessoal e ledger de controle             | [WAP-E02](PROMPTS.md#wap-e02) | WAP-02/04/10/11/12                |
| [x] WAP-T02-01  | Persistir vínculo durável de carteira                    | [WAP-E03](PROMPTS.md#wap-e03) | WAP-06/08/18/20/21/24/29          |
| [x] WAP-T02-02  | Aplicar escrita compartilhada por campo                  | [WAP-E03](PROMPTS.md#wap-e03) | WAP-25/26/27/28/29/30             |
| [x] WAP-T02-03  | Isolar leituras de Clientes e projeções comuns           | [WAP-E03](PROMPTS.md#wap-e03) | WAP-07/08/20/21/24/28             |
| [x] WAP-T02-04  | Compor cadastro e vínculo de Cliente                     | [WAP-E03](PROMPTS.md#wap-e03) | WAP-18/20/21/24/29                |
| [x] WAP-T01-03  | Expor comandos e estado de controle pessoal              | [WAP-E02](PROMPTS.md#wap-e02) | WAP-01/02/03/04/10/11/12          |
| [x] WAP-T01-04  | Conectar controle n8n e desafio efêmero                  | [WAP-E02](PROMPTS.md#wap-e02) | WAP-02/03/04/10/11/12             |
| [x] WAP-T02-05  | Receber na linha pessoal com atribuição humana atômica   | [WAP-E04](PROMPTS.md#wap-e04) | WAP-04/05/06/08/10/20/21/32       |
| [x] WAP-T02-06  | Proteger conversa e leituras auxiliares da linha         | [WAP-E04](PROMPTS.md#wap-e04) | WAP-07/08/17/28                   |
| [x] WAP-T02-07  | Cercar eventos, replay e revogação de acesso             | [WAP-E04](PROMPTS.md#wap-e04) | WAP-07/11/28/29                   |
| [x] WAP-T02a-01 | Adicionar origem de Assunto ao Pedido                    | [WAP-E05](PROMPTS.md#wap-e05) | WAP-17/31/33                      |
| [x] WAP-T02a-02 | Resolver Pedido por alvo sem escolha arbitrária          | [WAP-E05](PROMPTS.md#wap-e05) | WAP-17/30/31/33                   |
| [x] WAP-T02a-03 | Criar ou reutilizar Pedido no alvo transacional          | [WAP-E05](PROMPTS.md#wap-e05) | WAP-17/31/33; OA-05/07            |
| [x] WAP-T02a-04 | Entregar fluxo passivo de Pedido em Meus clientes        | [WAP-E06](PROMPTS.md#wap-e06) | WAP-01/17/31/32/33                |
| [x] WAP-T02a-05 | Verificar gate prioritário ponta a ponta                 | [WAP-E07](PROMPTS.md#wap-e07) | WAP-17/19/31/32/33                |
| [x] WAP-T02-08  | Revalidar linha na reserva e no despacho humano          | [WAP-E08](PROMPTS.md#wap-e08) | WAP-06/10/11/12/19                |
| [x] WAP-T03-01  | Normalizar fato externo enviado pelo aparelho            | [WAP-E08](PROMPTS.md#wap-e08) | WAP-09/10/12                      |
| [x] WAP-T03-02  | Persistir saída externa e reconciliar eco                | [WAP-E08](PROMPTS.md#wap-e08) | WAP-06/09/10/11                   |
| [x] WAP-T04-01  | Completar cadastro e vínculo na carteira                 | [WAP-E09](PROMPTS.md#wap-e09) | WAP-01/17/18/20/21/24/25/26/27/29 |
| [x] WAP-T04-02  | Entregar Meu WhatsApp e onboarding dispensável           | [WAP-E09](PROMPTS.md#wap-e09) | WAP-01/02/03/04/11/12             |
| [x] WAP-T04-03  | Compor primeiro envio individual no servidor             | [WAP-E10](PROMPTS.md#wap-e10) | WAP-22/23/24/32                   |
| [x] WAP-T04-04  | Expor compositor do primeiro envio opcional              | [WAP-E10](PROMPTS.md#wap-e10) | WAP-22/23/24/32                   |
| [x] WAP-T02-09  | Preservar cobrança e preparo pela linha correta          | [WAP-E08](PROMPTS.md#wap-e08) | WAP-17/19/27/28/30                |
| [x] WAP-T04-05  | Conservar contexto das ações comerciais na carteira      | [WAP-E09](PROMPTS.md#wap-e09) | WAP-17/19/25/28/30                |
| [x] WAP-T05-01  | Consolidar flags, allowlist e limites sem ativação       | [WAP-E11](PROMPTS.md#wap-e11) | WAP-12/16                         |
| [x] WAP-T05-02  | Auditar regressão funcional, a11y e privacidade          | [WAP-E11](PROMPTS.md#wap-e11) | WAP-01–12/17–33                   |
| [x] WAP-T05-03  | Ensaiar rollback e recovery sem reativar efeitos         | [WAP-E11](PROMPTS.md#wap-e11) | WAP-10/11/12/16/29/33             |
| [x] WAP-T05-04  | Consolidar roteiro operacional e evidências              | [WAP-E11](PROMPTS.md#wap-e11) | WAP-12/16; WAP-T05                |
| [ ] WAP-T05-05  | Homologar fluxo passivo real de Pedido                   | [WAP-E12](PROMPTS.md#wap-e12) | WAP-04/05/07/17/31/32/33          |
| [ ] WAP-T05-06  | Homologar pareamento mobile e sincronização reais        | [WAP-E12](PROMPTS.md#wap-e12) | WAP-01/02/03/04/09/10/11/12       |
| [ ] WAP-T05-07  | Homologar ações comerciais e primeiro envio do piloto    | [WAP-E12](PROMPTS.md#wap-e12) | WAP-17–30/32                      |

### Evidência local de WAP-E08

A expansão `0082` e o ensaio `test/integration/seller-whatsapp-outbound.test.js`
cobrem a reserva concorrente com desconexão, preflight com carteira revogada,
resultado após desconexão, duas contas com o mesmo ID do provedor, eco/HTTP em
ambas as ordens, recibos adiantados e mídia privada ou indisponível. O workflow
sintético usa o transporte humano existente e mantém o gerador histórico.
Teclado, foco, mídia e atribuição foram verificados na Inbox em 390 e 1366 px.

WAP-T02-09 cobre ACL comercial, preparo de cobrança obsoleto e replay
financeiro após disconnect. A expansão `0083` e o ensaio PostgreSQL da E08
cobrem PDF canônico, confirmação da origem e do destino, dois POSTs com um
único comando, mídia privada com checksum, versão obsoleta antes do despacho,
resultado tardio e liberação de quota de PDF sem vínculo. O workflow sintético
envia o documento pelo nó de mídia existente. O Playwright verificou a
confirmação, o foco, a repetição idempotente e o axe em 390 e 1366 px.
O [runbook](../../../docs/runbooks/seller-whatsapp-outbound.md) registra o
contrato, o ensaio e o rollback.

### Evidência local de WAP-E09

`seller-whatsapp-interface.spec.js` cobre cadastro sem pareamento, vínculo,
restrições, conflito sem candidato privado, desafio explícito, expiração,
fechamento, revogação, duas abas e reconexão sintéticos, sem screenshot,
vídeo ou trace do desafio. `seller-whatsapp-order.spec.js` cobre carteira →
Pedido → cobrança simulada e volta, canal indisponível, ACL e troca de alvo;
os percursos principais foram verificados por teclado e axe em 390 e 1366 px.
O [runbook](../../../docs/runbooks/seller-clients.md) registra a fronteira.

Com Node 24.20.0/npm 11.19.0, `npm run validate` passou (2.870 testes,
61 skips gerais sem configuração); `npm run test:e2e -- --workers=2`
passou (1.091 testes e 7 skips existentes), seguido de dois cenários focados
após ajuste. Auditorias npm completa e de runtime não apontaram vulnerabilidades.
Os ensaios PostgreSQL dedicados de E02–E04 e Assunto passaram 80 testes sem
skip; E07 passou 1 e E08 7, também sem skip. Um cluster portátil local usou
somente dados sintéticos; a prova não homologa provedor, código no mesmo
celular, recuperação remota ou produção. As expectativas de upgrade das
suítes E02/E03 foram atualizadas para incluir 0080/0082/0083.

### Evidência local de WAP-E10

`POST /contacts/:contactId/whatsapp/conversations` e a prévia sem efeito
`GET …/whatsapp/first-message-preview` compõem identidade, conversa humana,
mensagem, outbox E08 e auditoria numa transação, na ordem de locks do inbound
pessoal. Guarda própria `SELLER_WHATSAPP_FIRST_SEND_*` default off, somada às
guardas de envio, inbound e carteira. `test/integration/seller-whatsapp-first-send.test.js`
(PostgreSQL 17 sintético, 15/15 em três execuções, sem skip) cobre rollback,
duas abas (um 201 e um 409), replay, identidade de outro Contact, encerrada →
novo ciclo, linha offline antes da reserva, eco antes/depois do HTTP, timeout
`outcome_unknown` sem novo comando, envio pendente que exige reconciliação e
resposta posterior no mesmo Contact/conversa. Regressão E08 7/7 e suítes live
E02–E04/carteira 76/76.

`seller-whatsapp-first-message.spec.js` (18 cenários) cobre abrir sem efeito,
dupla aba, offline, timeout/reenvio com a mesma chave, recarga com envio
pendente, troca de Cliente, perda de acesso, teclado/foco e axe em 390 e
1366 px. `npm run validate` passou (2.936 testes, 61 skips sem URL live);
`npm run test:e2e -- --workers=2` passou (1.110 e 7 skips existentes);
auditorias npm completa e de runtime sem vulnerabilidades. O [runbook](../../../docs/runbooks/seller-whatsapp-outbound.md)
registra contrato, códigos e rollback. Gate de liberação: a flag segue
desligada em ambiente real até E12 provar que o JID da resposta coincide com
o `+E164` gravado (nono dígito); não corrigir por fusão por telefone. A prova
local não homologa provedor, n8n real ou produção.

### Evidência local de WAP-E11

Verificação independente e prontidão em 18/11/2026 sobre E10 `aad6f171`
([registro](validation-etapa1.md), [prontidão](../../../docs/runbooks/seller-whatsapp.md),
[recovery](../../../docs/runbooks/seller-whatsapp-recovery.md)). WAP-T05-01:
matriz fail-closed de todas as flags e allowlists de API, worker, n8n e
Evolution, 14/14; ensaio de capacidade sintético para 2 e 10 vendedores, sem
deadlock ou timeout, com limites numéricos propostos por usuário e serviço.
Os limites sem código restringem o piloto a dois vendedores e não provam
produção. WAP-T05-02: revisão adversarial sem P0; todas as suítes PostgreSQL
da etapa 1 e da linha geral, zero falhas e zero skips; QR/código ausentes em
788 colunas e nos logs. Correções nas fronteiras donas, com teste vermelho
antes: `9c6ae568`, Pedido legado na linha geral com alvo desligado (P1);
`22c95d35`, envio incerto através de ciclos encerrados (P2); `7eaae6d6` e
`1ae5fa87`, fixtures que paravam o job PostgreSQL do CI desde o E05.

WAP-T05-03: drill de desligamento, implantação em fases e restore por
snapshot local, 7/7 em três execuções, zero skips. Preserva carteira, ACL,
ledger, `outcome_unknown` e snapshots, sem QR restaurado. Rollback testado
em `60f11d42` e no HEAD com primeiro envio desligado; `f5833287` não é
permitido. O código não tem trava pós-restore: o bloqueio até a
reconciliação é procedimento obrigatório, e a trava fica como lacuna P1 para
decisão antes do piloto. WAP-T05-04: checklist de publicação e piloto, mapa
de versões e ordem API/migração → workflows → flags. O CI passa a rodar as
suítes de integração E08/E10 e o drill (`beeeb520`).

`npm run validate`: 2.889 aprovados, zero falhas, 61 skips live sem URL;
`npm run test:e2e -- --workers=2`: 1.115 aprovados e sete skips existentes;
auditorias completa e de runtime sem vulnerabilidades;
`validate:topology` e `test:recovery:mocks` (18) aprovados. Pendentes,
sem evidência live: CI verde da PR, imagens com digest, spike do provedor
(E01), pareamento e tráfego reais, restore remoto e aprovações (WAP-E12).

## Cobertura por requisito

Esta matriz aponta tarefas que implementam/verificam cada contrato; os aceites
literais continuam na spec. Não reinterpretar um requisito pelo resumo do prompt.

| Requisito | Tarefas principais                                  |
| --------- | --------------------------------------------------- |
| WAP-01    | T01-03, T02-04, T04-01, T04-02                      |
| WAP-02    | T01-01–04, T04-02                                   |
| WAP-03    | T01-01/03/04, T04-02, T05-02/06                     |
| WAP-04    | T01-01–04, T02-05, T05-06                           |
| WAP-05    | T02-05/06, T02a-05                                  |
| WAP-06    | T01-02, T02-01/05/08, T03-02                        |
| WAP-07    | T02-03/06/07, T05-02                                |
| WAP-08    | T02-01/03/04/05/06                                  |
| WAP-09    | T03-01/02, T05-06                                   |
| WAP-10    | T01-01–04, T02-05/08, T03-01/02, T05-03             |
| WAP-11    | T01-02/03/04, T02-07/08, T04-02, T05-03             |
| WAP-12    | T01-01–04, T02-08, T03-01, T05-01/02/03/04/05/06/07 |
| WAP-16    | T05-03/04                                           |
| WAP-17    | T02-06, T02a-01–05, T04-01/05, T05-07               |
| WAP-18    | T02-01/04, T04-01                                   |
| WAP-19    | T02-08/09, T04-05, T02a-05, T05-07                  |
| WAP-20    | T02-01/03/04/05, T04-01                             |
| WAP-21    | T02-01/03/04/05, T04-01                             |
| WAP-22    | T04-03/04, T05-07                                   |
| WAP-23    | T04-03/04, T03-02                                   |
| WAP-24    | T02-01/03/04, T04-01/03/04                          |
| WAP-25    | T02-02, T04-01, T05-07                              |
| WAP-26    | T02-02, T04-01, T05-07                              |
| WAP-27    | T02-02/09, T04-01, T05-07                           |
| WAP-28    | T02-02/03/06/07, T05-02/07                          |
| WAP-29    | T02-01/02/04/07, T04-01, T05-03                     |
| WAP-30    | T02-02, T02a-02, T02-09, T05-07                     |
| WAP-31    | T02a-01–05, T05-05                                  |
| WAP-32    | T02-05, T02a-04/05, T04-03/04, T05-07               |
| WAP-33    | T02a-01–05, T05-03/05                               |

WAP-13/14/15 são exclusivos da etapa 2. WAP-16 vale desde o rollback da etapa 1.

## Conclusão dos épicos por checklist interno

- WAP-T01: T01-01–04, provas de controle e privacidade sem habilitação implícita.
- WAP-T02: T02-01–09, sem exposição parcial de carteira ou despacho inseguro.
- WAP-T02a: T02a-01–05, gate prioritário integrado, independente da primeira saída.
- WAP-T03: T03-01/02 e evidência real T05-06.
- WAP-T04: T04-01–05 e superfícies passivas entregues em T02a-04.
- WAP-T05: T05-01–07; piloto e aceite real são separados da evidência sintética.

Não marcar épico só porque migração, QR, chat ou teste isolado passou.

## Histórico WAP-T00d — SDD inicial

WAP-T00d entregou originalmente 32 prompts em 16/11/2026. A revisão WAP-T00e
reduz a execução a 12 entregas sem alterar ADR 091 ou critérios de produto.
O gate prioritário passa a ser acompanhado como E07, mantendo o ID T02a-05.

## WAP-T00 — RFC, requisitos e plano

- [x] Confirmar baseline, adapter de linha única, saídas do aparelho ignoradas,
      carteira geral e ADR 088 atual sem alterar arquivos de terceiros.
- [x] Propor duas etapas só WhatsApp, configuração pessoal por QR, estados,
      limites mobile, privacidade, vínculo/ACL, envio correto e reconciliação.
- [x] Documentar critérios WAP e decisões D1–D4 (ADR pendente naquela entrega,
      posteriormente decidido em WAP-T00c).
- [x] Verificar links/formatação/diff e concluir commit, push e PR (handoff WAP-T00).

Validação proporcional: Prettier nos documentos alterados, referências locais,
rastreabilidade e `git diff --check`. Sem suítes de runtime para esta proposta
documental; não há novo endpoint, migração, workflow ou pareamento nesta entrega.

## WAP-T00a — explicitar a operação comercial completa

- [x] Registrar o esclarecimento do proprietário: Meus clientes inclui cadastro
      de contatos, pedidos, cobranças e demais ações CRM elegíveis na etapa 1.
- [x] Acrescentar WAP-17–19 e cenários de contexto comercial, cadastro sem
      conversa, envio de cobrança pela linha correta e pagamento após disconnect.
- [x] Alinhar tarefas e referências; verificar documentação e publicar o
      complemento em commit/push na PR 372 da RFC, sem alterar runtime.

## WAP-T00b — revisar Cliente oficial, vínculo e primeira mensagem

- [x] Conferir Contact, cadastro manual, colisão de telefone, identidade por
      conta e envio atual que exige conversa; preservar ADR 033 e regra 2.
- [x] Explicitar quando o Cliente aparece, vínculo antes de parear, reutilização
      do contactId e limites de compartilhamento; WAP-20–24 e cenários negativos.
- [x] Propor primeiro envio humano na etapa 1 sem inbound fictícia, separado de
      salvar/vincular; acrescentar D5 e impacto transacional em WAP-T01/02/04/05.
- [x] Validar documentação, revisar consistência, commit/push e PR de revisão.

Protótipo conceitual da conversa usa dados simulados; não é implementação,
prova do provedor ou mudança no CRM local. Regras propostas continuam sujeitas
ao aceite naquele momento; WAP-T00c registra a decisão posterior. WAP-T00b
não mudou RULES ou runtime.

Evidência WAP-T00b: formatação dos quatro documentos focalizados e 213
referências locais nos cinco arquivos verificadas; 24 IDs de requisito únicos;
`git diff --check` sem falhas. Revisão independente confirmou Contact/vínculos,
identidade, colisões e envio humano; corrigiu a contradição do onboarding para
permitir cadastro antes de parear e aprovou o delta final. Sem testes de runtime
para esta entrega documental. A prévia simulada foi conferida em 320 px e no
desktop: cadastro sem pareamento, vínculo/replay sem cópia, duplicata com
conferência, primeiro envio por Enter sem inbound no mesmo Cliente, cobrança
separada e bloqueio de envio offline; zero erro JavaScript. Não é prova live.

## WAP-T00c — aceite D1–D5, cadastro compartilhado e prioridade do Pedido

- [x] Registrar aceite do PO em 15/11/2026 na RFC e ADR 090: um único número
      por vendedor, atendimento passivo/humano, etapas e importação até 30 dias,
      QR/código, primeiro envio opcional e regras de edição compartilhada.
- [x] Acrescentar WAP-25–33 e gate prioritário de criar Pedido pela conversa
      sem sugestão da IA, primeiro envio, cadastro completo ou canal online.
- [x] Alinhar RULES, spec/PRD, ARCHITECTURE/TDD, índices e tarefas preservando
      decisões anteriores e os contratos comerciais de pedidos/cobranças.
- [x] Verificar referências/formatação/rastreabilidade/diff; commit/push e PR
      constam do handoff WAP-T00c. Sem execução ou ativação de runtime.

## Etapa 2 — WAP-T06 e WAP-T07

### WAP-T06 — carteira e histórico anteriores

WAP-07–08, 12–14, 16, 30. Produto, Integrações, Backend/Dados e QA/Privacidade.

- [ ] Medir dados disponíveis no recorte aprovado de até 30 dias, aplicar retenção
      vigente por tipo e
      distinguir contato, conversa, histórico e lacuna sem prometer agenda integral.
- [ ] Implementar prévia/seleção, confirmação, execução limitada, checkpoint,
      deduplicação e retomada; sem escrita direta n8n→banco CRM.
- [ ] Marcar origem histórica e impedir bot/recuperação/lembrete/contagem de
      venda ou lead novo; não importar grupos/status/agenda pessoal indiscriminada.
- [ ] Verificar importação parcial, repetição, isolamento e cutoff concorrente
      com inbound nova; UAT autorizado, gates, documentação, commit/push.

### WAP-T07 — troca de número e sucessão administrativa

WAP-04, 07–08, 10–12, 15–16. Backend/Dados, DevOps e QA/Privacidade.

- [ ] Implementar troca de número com prova e revogação da geração antiga;
      não mover retroativamente mensagens para outro remetente.
- [ ] Sucessão por Admin exige motivo, escopo/versão e transação de revogação/
      atribuição/auditoria, preservando crédito e pedidos históricos.
- [ ] Exercitar sessões abertas, SSE, cursores, operações/callbacks em voo,
      inativo e recovery; impedir autoapropriação de número desconectado.
- [ ] Registrar runbook, gates/rollback, piloto autorizado e aceite; commit/push.

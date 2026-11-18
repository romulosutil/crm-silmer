# Pedido por Assunto — WAP-E05

WAP-T02a-01/02/03; WAP-17/30/31/33, OA-05/07 e ADRs 090/091.
Contrato HTTP em [OpenAPI](../api/openapi.v1.yaml), desenho na
[seção 7](../../.specs/features/seller-whatsapp/design.md#7-pedido-pela-conversa-contrato-e-transação).
WAP-E06 acrescenta a interface mínima; o gate integrado é WAP-E07 e provedor
e produção exigem seus próprios aceites.

## Interface mínima — WAP-E06

Em Clientes, o vendedor acessa **Meus clientes**, que lê a carteira pelo
`GET /api/v1/me/clients` existente e permite abrir uma conversa autorizada.
Busca por nome e paginação usam o mesmo contrato; falha ou flag desligada não
substitui a carteira pela lista geral. A leitura de cadastro não concede acesso
à conversa nem ao Pedido: cada rota mantém sua própria autorização.

O botão existente no cabeçalho abre confirmação humana. A tela captura Contact,
conversa, versões, lista de Assuntos e chave idempotente; quando há Assuntos
e a criação por alvo está disponível para a conversa, exige o alvo e envia sua versão junto com a versão da conversa. Um Assunto com
Pedido pendente pode devolver o mesmo Pedido. Após sucesso, abre a ficha e
anuncia criação ou reutilização a partir do status HTTP 201/200; cancelar
devolve foco ao acionador. O rascunho
do chat permanece em memória na navegação da aplicação. Mudança de contexto,
versão ou acesso cancela a confirmação e cerca respostas tardias; erro exige
nova conferência. A API permanece responsável por autorizar e revalidar todas
as condições, inclusive titular ativo e acesso comercial. Nenhuma dessas
operações envia mensagem, ativa IA ou exige cadastro completo ou canal online.

Rollback da interface usa um SHA compatível com o modelo de múltiplos alvos.
Desligue novas criações antes de qualquer retorno após uso desse modelo.
O ensaio WAP-E07 está descrito abaixo e tem seus resultados no
[registro de aceite](../../.specs/features/seller-whatsapp/validation-pedido.md).

## Contrato e compatibilidade

`POST /api/v1/conversations/:conversationId/orders` conserva sessão, CSRF,
Origin, `Idempotency-Key` e `expectedVersion` da conversa. Aceita
`subjectId`/`expectedSubjectVersion` opcionais **em par**. O alvo e a versão
integram o fingerprint. Com a criação por alvo disponível (seção abaixo), sem
par, zero ou um Assunto permitem resolver o legado; vários Assuntos retornam
`409 ORDER_TARGET_REQUIRED`, mesmo havendo um atual. Não há escolha pela ordem
do banco ou pela última interação.

Com zero Assuntos e nenhum pendente, a criação por alvo grava na mesma
transação um Assunto `geral` atual (evento `conversation.subjects_changed` e
auditoria `conversation.subject_created`), promovido ao Pedido criado: o
Pedido nasce com origem e a ficha inicial usa a pré-ficha da conversa, pois o
Assunto novo não tem briefing próprio. Um Assunto criado depois é um novo
alvo explícito. Pendente legado já existente (origem nula, gravado com a
criação por alvo desligada) é devolvido sem Assunto inferido e continua
exigindo resolução explícita — Assunto que o nomeia — antes de outro alvo;
até lá, par explícito recebe `409 ORDER_TARGET_REQUIRED`. Prova:
subtestes `P2-1` e `legacy draft cannot coexist with unresolved explicit
target` em `test/order-subject-postgres-live.test.js`.

`POST /api/v1/orders` (pedido sem conversa) aplica ao `contactId` a mesma
visibilidade de `GET /api/v1/contacts/:id`; Contact invisível responde
`404 CONTACT_NOT_FOUND` sem escrita nem nome, e a verificação se repete sob o
lock do Contact (subteste `P1-1`).

### Linha geral com criação por alvo desligada

Sem os três gates (ou sem os índices de 0081) para o responsável da conversa,
a linha geral cria como na `master` `f5833287`: corpo sem par grava rascunho
legado (`origin_subject_id` nulo), sem promover nem alterar Assuntos, e repetir
devolve `200` com o mesmo pendente. Assuntos sem Pedido (geral manual) ou com
Pedidos confirmados (cliente recorrente do bot) não bloqueiam a criação,
`GET /api/v1/conversations/:id/order` nem a projeção automática: quantidade de
Assuntos não é ambiguidade. Continuam recusados: par explícito ou linha pessoal
(`ORDER_SUBJECT_UNAVAILABLE`), vários pendentes na conversa e projeção sem par
sobre pendente com origem (`ORDER_TARGET_REQUIRED`).

O mesmo `GET` informa `subjectCreationAvailable`, apenas orientativo; o POST
decide de novo na transação. O Inbox só pede o Assunto quando esse campo é
`true` ou quando a leitura responde `ORDER_TARGET_REQUIRED`; qualquer outra
resposta mantém o diálogo da linha geral sem seletor. Provas: subteste
`WAP-E11: general line keeps legacy creation while targeted creation is off`
em `test/order-subject-postgres-live.test.js` e os cenários `WAP-E11` de
`test/e2e/seller-whatsapp-order.spec.js` (390 e 1366 px, teclado, foco, axe).

Assunto geral sem Pedido é promovido na transação. Assunto com pendente
elegível devolve o mesmo Pedido; confirmado/cancelado exige outro Assunto.
CAS obsoleto retorna `VERSION_CONFLICT`. Duas chaves concorrentes sobre a mesma
versão criam uma vez; a perdedora relê a versão do Assunto antes de abrir o
Pedido existente. Replay da chave original pode usar sua versão original,
pois revalida autoridade atual antes de abrir o recibo.

Pedido, vínculo recíproco, reserva do número, evento, auditoria e recibo
idempotente cifrado usam a mesma conexão/transação. Falha de auditoria desfaz
todo o efeito. A sequência PostgreSQL pode deixar lacunas em rollback; números
confirmados não duplicam nem reiniciam. Nenhum Pedido nasce sem conversa para
ser ligado depois neste fluxo.

A transação revalida pessoa ativa, função/capacidade, linha e carteira,
Contact atual, posse, atendimento humano aberto e versões. Admin executa com
sua própria autoria, conservando o titular como responsável. Locks de usuários
são ordenados, seguidos por linha, Contact, conversa e Assuntos; revogação e
encerramento concorrentes vencem antes de criar/reabrir recibo. Estado online,
bot/sugestão, primeiro envio e cadastro completo não são dependências. As
exigências cadastrais já vigentes do fluxo legado são preservadas.

Ficha inicial vem apenas do briefing do alvo, com `firstContactAt` da conversa.
Pendente acompanha o nome oficial do Contact; a adoção de legado conserva o
nome já comprovado na ficha quando ainda não há nome comum/briefing do alvo.
Confirmados/cancelados e documentos históricos conservam snapshots. Origem
não muda por confirmação, reabertura ou cancelamento. Reabertura disputa o
alvo e recusa coexistir com um pendente legado não resolvido.

`findPendingByConversation` e contexto comercial recusam ambiguidade. Inbox
omite o Pedido canônico quando há múltiplos Assuntos/pendentes, preservando
listagens e a sinalização de existência de pendências. Projeção automática
sem Assunto/Pedido explícitos recusa alvo com origem persistida; o caminho
explícito mantém os fences, versões e recuperação existentes. A assistência
vigente grava origem na sua própria transação e continua conservadora quando
já existe pendente. ACL comercial permanece independente; `originSubjectId`
é omitido/nulo sem acesso à conversa, assim como seus metadados privados.

## Implantação em fases, sem ativação implícita

1. Aplicar as expansões usuais, incluindo **0080**. Acrescenta origem nullable,
   CHECK de conversa, FK composta usando a UNIQUE de 0037 e índice de consulta.
   Mantém `orders_one_pending_per_conversation`. Backfill alcança só pendente
   ativo com exatamente um vínculo comprovado, mesma conversa/Contact.
   Cancelados, confirmados e vínculos ambíguos permanecem intocados.
2. Instalar este binário compatível em **todos** os consumidores API/worker e
   confirmar as integrações n8n existentes. Manter criação por alvo desligada.
   Inventariar pendentes sem origem e vínculos múltiplos em relatório privado
   de IDs; não imprimir cadastro, texto ou envelopes. Não inferir alvos para
   limpar o relatório. Legado ativo sem vínculo exige resolução explícita
   antes de criar outro alvo na conversa.
3. Somente depois dos leitores compatíveis, aplicar **0081**, fase `contract`.
   Instala unicidade por conversa apenas para legado NULL e unicidade por
   origem para pendentes ativos, antes de remover o índice global. Essa fase
   é separada do startup/migrador `expand`. Para selecionar apenas esta
   mudança, usar `loadMigrations()` filtrado por `version === '0081'` e
   `migrate(pool, { migrations, phase: 'contract' })`; não aplicar outros
   contratos antigos incidentalmente. O ensaio PostgreSQL executa esse caminho.
4. Habilitação futura exige autorização operacional própria e os três gates
   privados abaixo. Esta entrega **não altera** ambientes reais.

| Configuração                     | Default   | Condição                                                                                                 |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `ORDER_SUBJECT_CREATION_ENABLED` | desligado | somente literal `true`                                                                                   |
| `ORDER_SUBJECT_READERS_READY`    | desligado | confirmação explícita de todos os consumidores compatíveis                                               |
| `ORDER_SUBJECT_SELLER_IDS`       | vazia     | IDs privados separados por vírgula; precisa incluir o responsável/titular, inclusive para execução Admin |

Ausência de qualquer gate, ou dos dois índices substitutos, ou presença do
índice global, recusa o escritor por alvo com `ORDER_SUBJECT_UNAVAILABLE`.
O mesmo vale para criação na linha pessoal, inclusive com corpo legado.
Não usar lista de Admin para liberar implicitamente qualquer carteira.

## Rollback e recuperação

Antes de 0081, o índice global ainda impede múltiplos pendentes. Após usar
múltiplos alvos, **binário antigo não é rollback seguro**. Desligar novas
criações e manter/restaurar somente SHA compatível com origem e leitores
sem ambiguidade. Preservar colunas, FKs, índices, carteira, ACL, recibos e
histórico; não reconstruir a unicidade global sobre dados com vários alvos.
Não desfazer backfill comprovado nem editar cancelados para fazer rollback.

O ensaio de rollback usa este leitor compatível com criação desligada e
comprova listagem/detalhe dos dois alvos. Não homologa recovery de produção.
Nenhum comando desta entrega faz HTTP externo, IA, cobrança ou envio; n8n
continua obrigatório para os efeitos de canal existentes. Incerteza de efeito
externo segue reconciliação, nunca retry cego.

## Evidências locais

Ambiente dedicado com PostgreSQL 17.11 portátil em loopback, dados sintéticos,
Node 24.20.0/npm 11.19.0. Sem Docker disponível no host. Para reproduzir, usar
`TEST_DATABASE_URL` apontando exclusivamente a `crm_silmer_test` dedicado;
as suítes reais reinicializam seus schemas e devem rodar serialmente.

```text
npm run test:database
node --test test/order-conversation-port.test.js test/order-assistance.test.js test/order-routes.test.js test/order-runtime.test.js test/orders-repository-contract.test.js
node --test --test-concurrency=1 test/order-subject-postgres-live.test.js test/orders-postgres-live.test.js test/order-assistance-postgres-live.test.js test/cancelled-orders-inbox-subject-postgres-live.test.js test/cancelled-orders-orders-repository-postgres-live.test.js
```

WAP-E05 é incluído no job PostgreSQL obrigatório do CI, além do teste padrão
que sinaliza skip sem banco. A prova focal real não admite skips. No Windows
sandbox, `TEMP`/`TMP` foram apontados ao diretório de artefatos da tarefa para
que URLs de fixtures não fossem truncadas pelo `#` do caminho do sandbox.
Resultados integrais e limites de E2E ficam registrados no checklist da entrega.

### Ensaio integrado WAP-E07

Reserve um cluster PostgreSQL descartável em loopback e crie nele o banco
`crm_silmer_test_wap_e07`. O teste exige esse nome e host `127.0.0.1`,
recria os schemas `crm` e `crm_meta` e aplica as expansões e o contrato 0081.
Defina `TEST_DATABASE_URL` para esse banco. Rode em um checkout com as
dependências do lockfile e Chromium Playwright instalados.

```powershell
npm run build
node --test test/integration/seller-whatsapp-passive-order.test.js
```

O ensaio sobe Fastify e o proxy local do frontend. Reserve a porta de edge
4187 ou use `WAP_TEST_EDGE_PORT` para indicar outra porta livre em loopback.
O teste usa contas, credenciais e origens de linha sintéticas, envia o evento
ao endpoint autenticado de inbound do n8n e usa sessões reais no navegador.
A resolução cadastral explícita e a queda da linha são estados de fixture.
Confira o registro de aceite para a cobertura e os limites da prova.

Execute as suítes live já existentes serialmente em outro banco sintético
dedicado `crm_silmer_test`, pois cada suíte reinicializa schemas.
Encerre a instância descartável após a execução.

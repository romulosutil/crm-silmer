# Execução INBOX-MEDIA-1

## T10: Vinculo atomico e conservacao de quota

MED-05..08/15/28: criterios e arquivos comunicados antes do patch. Novo teste SQL escrito primeiro reproduziu ready sem bind e negativas sem rejeicao. Fixtures iniciais corrigidas para respeitar auditoria imutavel (schema sintetico recriado por caso) e metadata ready size_bytes real; outcomes/assertions preservados. Bind valida mesmo autor/conversa/ready/clean/tipo/SHA/MIME/limite/reserva sob locks antes do takeover. Mensagem/vinculo/quota/outbox/audit/SSE/command usam a transacao existente; reserva vira used apenas nela. Replay hidrata antes do bind; concorrencia tem um vencedor, mesma midia nao liga a segunda mensagem. Admin read nao autoriza bind de outro ator. Allowlist coincide com T4, imagem5MiB e audio/video16MiB. Texto preservado.

### Adequação bidirecional

Cada cenário da spec está ligado às assertions discriminantes abaixo. A coluna
cenário faz a associação suficiente; a coluna fonte/assertion faz a associação
inversa de cada teste ao contrato, incluindo expansões por arrays parametrizados.
Nenhuma assertion/timeouts/skips publicada foi enfraquecida.

| Critério / requisito | file:line + assertion | Resultado |
| --- | --- | --- |
| T10: isolamento/fixture | `test/chat-media-bind-postgres-live.test.js:34` `assert.equal(new URL(connectionString).pathname, '/crm_silmer_test');` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:176` `assert.equal((await snapshot()).automation, 'assistant');` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:181` `assert.equal(row.state, 'attached');` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:182` `assert.equal(row.message_id, message.id);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:183` `assert.equal(Number(row.reservation_bytes), 0);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:184` `assert.deepEqual(await snapshot(), { messages: 1, commands: 1, audits: 1, reserved: '0', used: '100', automation: 'human', });` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:192` `assert.equal((await inbox.sendHumanMessage(input)).id, message.id);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:193` `assert.deepEqual(await snapshot(), { messages: 1, commands: 1, audits: 1, reserved: '0', used: '100', automation: 'human', });` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: bind/message/outbox/audit/takeover and quota commit together; replay charges once,  | `test/chat-media-bind-postgres-live.test.js:201` `assert.equal( Number( (await pool.query(`SELECT count(*) AS count FROM crm.domain_events`)) .rows[0].count, ), 1, );` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: concurrent sends of one media have one winner,  | `test/chat-media-bind-postgres-live.test.js:216` `assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: concurrent sends of one media have one winner,  | `test/chat-media-bind-postgres-live.test.js:217` `assert.equal((await snapshot()).messages, 1);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: concurrent sends of one media have one winner,  | `test/chat-media-bind-postgres-live.test.js:218` `assert.equal((await snapshot()).used, '100');` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/08: invalid bind ${JSON.stringify(options)} rolls back,  | `test/chat-media-bind-postgres-live.test.js:229` `await assert.rejects(service().sendHumanMessage(command(id)), { statusCode: 409, });` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/08: invalid bind ${JSON.stringify(options)} rolls back,  | `test/chat-media-bind-postgres-live.test.js:232` `assert.deepEqual(await snapshot(), before);` | Resultado explícito discriminante da assertion |
| test(T10/MED-08: admin read capability cannot bind another actor media,  | `test/chat-media-bind-postgres-live.test.js:236` `await assert.rejects( service().sendHumanMessage( command(id, { actor: { ...actor, capabilities: ['COMMERCIAL_ADMIN'] }, }), ), { statusCode: 409 }, );` | Resultado explícito discriminante da assertion |
| test(T10/MED-08: admin read capability cannot bind another actor media,  | `test/chat-media-bind-postgres-live.test.js:244` `assert.equal((await snapshot()).automation, 'assistant');` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: second message cannot reuse attached media,  | `test/chat-media-bind-postgres-live.test.js:250` `await assert.rejects( inbox.sendHumanMessage(command(id, { expectedVersion: 2 })), { statusCode: 409 }, );` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: second message cannot reuse attached media,  | `test/chat-media-bind-postgres-live.test.js:254` `assert.equal((await snapshot()).messages, 1);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: ${failure} preserves ready reservation,  | `test/chat-media-bind-postgres-live.test.js:260` `await assert.rejects( service({ [failure]: true }).sendHumanMessage(command(id)), /synthetic-/u, );` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: ${failure} preserves ready reservation,  | `test/chat-media-bind-postgres-live.test.js:264` `assert.deepEqual(await snapshot(), before);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05/28: ${failure} preserves ready reservation,  | `test/chat-media-bind-postgres-live.test.js:265` `assert.equal( (await pool.query('SELECT state FROM crm.chat_media WHERE id=$1', [id])) .rows[0].state, 'ready', );` | Resultado explícito discriminante da assertion |
| test(T10/MED-07: ${scenario} after upload prevents stale send,  | `test/chat-media-bind-postgres-live.test.js:282` `await assert.rejects(service().sendHumanMessage(command(id)), { statusCode: 409, });` | Resultado explícito discriminante da assertion |
| test(T10/MED-07: ${scenario} after upload prevents stale send,  | `test/chat-media-bind-postgres-live.test.js:285` `assert.equal((await snapshot()).messages, 0);` | Resultado explícito discriminante da assertion |
| test(T10/MED-07: ${scenario} after upload prevents stale send,  | `test/chat-media-bind-postgres-live.test.js:286` `assert.equal((await snapshot()).reserved, '100');` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: message kind and validated MIME must agree,  | `test/chat-media-bind-postgres-live.test.js:290` `await assert.rejects( service().sendHumanMessage( command(id, { messageType: 'audio', content: { mediaId: id } }), ), { statusCode: 409 }, );` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: message kind and validated MIME must agree,  | `test/chat-media-bind-postgres-live.test.js:296` `assert.equal((await snapshot()).messages, 0);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: ready ${kind} binds validated kind,  | `test/chat-media-bind-postgres-live.test.js:308` `assert.equal(sent.type, kind);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: ready ${kind} binds validated kind,  | `test/chat-media-bind-postgres-live.test.js:309` `assert.equal((await snapshot()).used, '100');` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: MIME ${mime} outside approved formats cannot bind,  | `test/chat-media-bind-postgres-live.test.js:318` `await assert.rejects(service().sendHumanMessage(command(id)), { statusCode: 409, });` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: MIME ${mime} outside approved formats cannot bind,  | `test/chat-media-bind-postgres-live.test.js:321` `assert.equal((await snapshot()).messages, 0);` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: image above five MiB cannot bind despite a ready row,  | `test/chat-media-bind-postgres-live.test.js:334` `await assert.rejects(service().sendHumanMessage(command(id)), { statusCode: 409, });` | Resultado explícito discriminante da assertion |
| test(T10/MED-05: image above five MiB cannot bind despite a ready row,  | `test/chat-media-bind-postgres-live.test.js:337` `assert.equal((await snapshot()).reserved, String(size));` | Resultado explícito discriminante da assertion |

Gates: Quick: types/lint/format/diff e npm test781 aprovados/3 skips antigos; Live25/25 (18 novos+7 regressao inbox), zero skips. Autor não é Verifier; requisitos permanecem In Progress.


## Fix T6/MED-19: Integridade da admissão até a variante

Achado independente: prepare substituía o SHA original persistido por T7,
permitindo um spool alterado válido de mesmo tamanho. Testes escritos primeiro
falharam: unit não registrou invalid_format e SQL retornou linha/hash substituído
onde o contrato exigia null. Worker agora compara originalSha256 da validação
com o original previamente admitido antes de prepare/PUT; divergência é rejected
invalid_format, sem PUT/ready. SQL prepare preserva original por COALESCE e CAS
exige original null ou idêntico e content_sha256 null. Variante preparada nunca
é substituída. Seeds legados com original null continuam preenchidos pela
validação. Nenhuma migration publicada alterada, nenhum teste enfraquecido.

| Critério / requisito ↔ assertion | Evidência necessária |
| --- | --- |
| Mesmo tamanho não autoriza troca, MED-19 | `test/chat-media-process-worker.test.js:307` `assert.equal(Buffer.byteLength('different'),BYTES.length)`; :310 failures invalid_format; :311 prepared0; :312 puts0; :313 ready0; :314 original SHA preservado |
| SQL/worker rejeita sem cobrança liberada | `test/chat-media-process-postgres-live.test.js:688` original SHA; :689 contentnull; :690 rejected; :691 invalid_format; :692 puts0; :693 reserved igual; :694 used0 |
| Hash original e variante imutáveis | `test/chat-media-process-postgres-live.test.js:707` prepare divergente null; :714 originalSHA; :715 contentnull; :717 originalSHA; :718 contentSHA; :719 segundo prepare divergente null; :726 contentSHA preservado |

Adequação inversa: assertions307–314 ligadas à divergência antes do efeito;
assertions680–694 ligadas à conservação SQL/quota; assertions707–726 ligadas
à CAS/hash e variante, incluindo preenchimento da linha legítima. Testes
anteriores de pipeline/retry/lease conservados. Gates: unit17/17, SQL15/15;
types/lint/diff verdes. Pipeline16/16 com scanner/normalizer da imagem construída
sha256:d372430897763a95b471898d349af004525ae234003fb350e7f5538fbaaf1655 e
RustFS local alpha.99, 58.9s, zero skips. Handler/SQL/SDK no host e ferramentas
da imagem por helper; não prova worker process completo nem n8n, que seguem T24.
Autor não é Verifier.

## T9: Conteúdo privado com Range e recuperação

Critérios e arquivos comunicados antes do patch: content route/runtime, app/server,
repository CAS de lost, testes API/SQL, OpenAPI e runbook. Testes escritos primeiro:
primeira execução falhou ERR_MODULE_NOT_FOUND no endpoint ausente. Depois passaram
18 casos de API (cinco Ranges válidos, cinco inválidos, retenção e ACL, recuperação,
metadata divergente, 16 MiB em chunks e rollback de admissão), mais SQL CAS real.
HEAD/GET verificam variante SHA/MIME/tamanho antes de bytes; contador do stream
impede resposta maior/truncada. Timeout503 nunca substitui durable ready/attached.
MissingObject marca lost410 por CAS version/key/hash, sem tocar quota. Leitura
usa private,no-store/nosniff. CHAT_MEDIA_READ_ENABLED preserva histórico ao
desligar CHAT_MEDIA_ENABLED. Nenhum vínculo ou objeto é removido pelo rollback.

### Adequação suficiente e inversa

Cada assertion abaixo liga a exigência ao resultado, e cada cenário de T9 tem
assertions listadas. Arrays de Range expandem para cinco casos positivos e cinco
negativos; assertions dentro deles valem para todas as entradas documentadas.

| Critério / requisito | file:line + assertion | Resultado necessário |
| --- | --- | --- |
| test(MED-15/17: full retained attached bytes remain readable with private headers,  | `test/chat-media-content-routes.test.js:111` `assert.equal(response.statusCode, 200);` | Valor esperado explícito na assertion |
| test(MED-15/17: full retained attached bytes remain readable with private headers,  | `test/chat-media-content-routes.test.js:112` `assert.equal(response.body, 'abcdefghij');` | Valor esperado explícito na assertion |
| test(MED-15/17: full retained attached bytes remain readable with private headers,  | `test/chat-media-content-routes.test.js:113` `assert.equal(response.headers['cache-control'], 'private, no-store');` | Valor esperado explícito na assertion |
| test(MED-15/17: full retained attached bytes remain readable with private headers,  | `test/chat-media-content-routes.test.js:114` `assert.equal(response.headers['x-content-type-options'], 'nosniff');` | Valor esperado explícito na assertion |
| test(MED-15/17: full retained attached bytes remain readable with private headers,  | `test/chat-media-content-routes.test.js:115` `assert.equal(response.headers['accept-ranges'], 'bytes');` | Valor esperado explícito na assertion |
| test(MED-15/17: full retained attached bytes remain readable with private headers,  | `test/chat-media-content-routes.test.js:116` `assert.equal(response.headers['content-length'], '10');` | Valor esperado explícito na assertion |
| test(MED-17: range ${range} returns exact 206,  | `test/chat-media-content-routes.test.js:127` `assert.equal(response.statusCode, 206);` | Valor esperado explícito na assertion |
| test(MED-17: range ${range} returns exact 206,  | `test/chat-media-content-routes.test.js:128` `assert.equal(response.body, expected);` | Valor esperado explícito na assertion |
| test(MED-17: range ${range} returns exact 206,  | `test/chat-media-content-routes.test.js:129` `assert.equal(response.headers['content-range'], contentRange);` | Valor esperado explícito na assertion |
| test(MED-17: range ${range} returns exact 206,  | `test/chat-media-content-routes.test.js:130` `assert.equal(Number(response.headers['content-length']), expected.length);` | Valor esperado explícito na assertion |
| test(MED-17: invalid range ${range} returns 416 without bytes,  | `test/chat-media-content-routes.test.js:141` `assert.equal(response.statusCode, 416);` | Valor esperado explícito na assertion |
| test(MED-17: invalid range ${range} returns 416 without bytes,  | `test/chat-media-content-routes.test.js:142` `assert.equal(response.headers['content-range'], 'bytes */10');` | Valor esperado explícito na assertion |
| test(MED-17: invalid range ${range} returns 416 without bytes,  | `test/chat-media-content-routes.test.js:143` `assert.equal(response.headers['cache-control'], 'private, no-store');` | Valor esperado explícito na assertion |
| test(MED-17: invalid range ${range} returns 416 without bytes,  | `test/chat-media-content-routes.test.js:144` `assert.equal(response.body.includes('abcdefghij'), false);` | Valor esperado explícito na assertion |
| test(MED-16: missing session and forbidden actor cannot read bytes,  | `test/chat-media-content-routes.test.js:147` `assert.equal((await harness(t).get({ cookie: '' })).statusCode, 401);` | Valor esperado explícito na assertion |
| test(MED-16: missing session and forbidden actor cannot read bytes,  | `test/chat-media-content-routes.test.js:148` `assert.equal( (await harness(t).get({ cookie: '' })).headers['cache-control'], 'private, no-store', );` | Valor esperado explícito na assertion |
| test(MED-16: missing session and forbidden actor cannot read bytes,  | `test/chat-media-content-routes.test.js:152` `assert.equal((await harness(t, { forbidden: true }).get()).statusCode, 403);` | Valor esperado explícito na assertion |
| test(MED-19: transient storage failure recovers without durable state replacement,  | `test/chat-media-content-routes.test.js:156` `assert.equal((await h.get()).statusCode, 503);` | Valor esperado explícito na assertion |
| test(MED-19: transient storage failure recovers without durable state replacement,  | `test/chat-media-content-routes.test.js:157` `assert.equal(h.row.state, 'attached');` | Valor esperado explícito na assertion |
| test(MED-19: transient storage failure recovers without durable state replacement,  | `test/chat-media-content-routes.test.js:158` `assert.equal((await h.get()).statusCode, 200);` | Valor esperado explícito na assertion |
| test(MED-19: confirmed missing object returns 410 and marks lost,  | `test/chat-media-content-routes.test.js:163` `assert.equal(response.statusCode, 410);` | Valor esperado explícito na assertion |
| test(MED-19: confirmed missing object returns 410 and marks lost,  | `test/chat-media-content-routes.test.js:164` `assert.equal(response.headers['cache-control'], 'private, no-store');` | Valor esperado explícito na assertion |
| test(MED-19: confirmed missing object returns 410 and marks lost,  | `test/chat-media-content-routes.test.js:165` `assert.equal(h.row.state, 'lost');` | Valor esperado explícito na assertion |
| test(MED-19: confirmed missing object returns 410 and marks lost,  | `test/chat-media-content-routes.test.js:166` `assert.equal(response.body.includes('secret-key'), false);` | Valor esperado explícito na assertion |
| test(MED-17/19: storage metadata mismatch and ignored Range fail before bytes,  | `test/chat-media-content-routes.test.js:169` `assert.equal((await harness(t, { badMime: true }).get()).statusCode, 503);` | Valor esperado explícito na assertion |
| test(MED-17/19: storage metadata mismatch and ignored Range fail before bytes,  | `test/chat-media-content-routes.test.js:170` `assert.equal( (await harness(t, { ignoredRange: true }).get({ range: 'bytes=1-2' })) .statusCode, 503, );` | Valor esperado explícito na assertion |
| test(MED-17: large object streams in bounded chunks,  | `test/chat-media-content-routes.test.js:178` `assert.equal(response.statusCode, 200);` | Valor esperado explícito na assertion |
| test(MED-17: large object streams in bounded chunks,  | `test/chat-media-content-routes.test.js:179` `assert.equal(response.rawPayload.length, 16 * 1024 * 1024);` | Valor esperado explícito na assertion |
| test(MED-17: large object streams in bounded chunks,  | `test/chat-media-content-routes.test.js:180` `assert.equal(response.rawPayload[response.rawPayload.length - 1], 7);` | Valor esperado explícito na assertion |
| test(MED-15: unvalidated content is blocked before storage read,  | `test/chat-media-content-routes.test.js:183` `assert.equal( ( await harness(t, { row: { state: 'rejected', validation_status: 'invalid_format' }, }).get() ).statusCode, 409, );` | Valor esperado explícito na assertion |
| test(MED-15/16: disabling admission preserves history routes,  | `test/chat-media-content-routes.test.js:216` `assert.equal( ( await api.inject({ method: 'POST', url: '/api/v1/conversations/c/media', headers, }) ).statusCode, 404, );` | Valor esperado explícito na assertion |
| test(MED-15/16: disabling admission preserves history routes,  | `test/chat-media-content-routes.test.js:226` `assert.equal( ( await api.inject({ method: 'GET', url: `/api/v1/conversations/c/media/${id}`, headers, }) ).statusCode, 200, );` | Valor esperado explícito na assertion |
| test(MED-15/16: disabling admission preserves history routes,  | `test/chat-media-content-routes.test.js:236` `assert.equal( ( await api.inject({ method: 'GET', url: `/api/v1/conversations/c/media/${id}/content`, headers, }) ).body, 'retained', );` | Valor esperado explícito na assertion |
| MED-19 / CAS e quota | `test/chat-media-upload-postgres-live.test.js:659` `assert.equal( await repository.markLost({ ...row, version: Number(row.version) + 1 }), false, );` | Versão stale não altera; lost preserva reserva |
| MED-19 / CAS e quota | `test/chat-media-upload-postgres-live.test.js:663` `assert.equal(await repository.markLost(row), true);` | Versão stale não altera; lost preserva reserva |
| MED-19 / CAS e quota | `test/chat-media-upload-postgres-live.test.js:664` `assert.equal(await repository.markLost(row), false);` | Versão stale não altera; lost preserva reserva |
| MED-19 / CAS e quota | `test/chat-media-upload-postgres-live.test.js:665` `assert.deepEqual(await counts(), quota);` | Versão stale não altera; lost preserva reserva |
| MED-19 / CAS e quota | `test/chat-media-upload-postgres-live.test.js:666` `assert.equal( ( await repository.readForActor({ mediaId: admission.id, conversationId: admission.conversationId, actor: admission.actor, }) ).state, 'lost', );` | Versão stale não altera; lost preserva reserva |
| MED-19 / CAS e quota | `test/chat-media-upload-postgres-live.test.js:676` `await assert.rejects( repository.readForActor({ mediaId: admission.id, conversationId: 'different', actor: admission.actor, }), { statusCode: 404 }, );` | Versão stale não altera; lost preserva reserva |

Gates: validate 779 aprovados / 3 skips antigos; SQL 15/15; E2E 107/7 skips antigos,114 total; diff/skill validators verdes. Autor não é Verifier; requisitos permanecem In Progress.


## T8: Status autorizado e erros de sessão

Premissas e arquivos comunicados ao integrador antes do patch. Fonte de ACL:
conversation.read canônica, sessão de Vendedor; draft restrito a autor/admin,
attached segue leitura já autorizada. Arquivos: status route/runtime, app/server,
repository readForActor, identity/operation runtime e código tipado INVALID_SESSION
no serviço existente, testes status/produção SQL, OpenAPI, estado/traceabilidade.
Erros401 são opt-in somente para mídia: outros leitores mantêm403 anterior.
DB não vira credencial inválida. Upload faz preflight autenticado antes do CSRF.
Roots equivalentes são normalizados e não podem coincidir com PRIVATE_MEDIA_ROOT.

18 unit/integration novos e um cenário SQL composto, incluindo sessão real,
Vendedor200, não Vendedor403, outro draft403, admin draft200, attached outro200,
ausente/inválida/revogada/expirada401, origem403, CSRF403, DB503 em GET/POST.
Nenhuma assertion publicada alterada; helpers de auth T7 ganharam authorizeRead
sem alterar resultados. Novo fixture de ação encaminhada corrigido de inbox.read
para conversation.read após falhar antes da autenticação; códigos esperados
401/403/503 preservados. Primeira expiração artificial falhou CHECK sessions;
fixture passou a manter created_at anterior à expiração, sem mudar assertion.

### Adequação suficiente

| Critério / AC | file:line + assertion | Resultado esperado | Coberto |
| --- | --- | --- | --- |
| Draft autor/admin, outro403 | `test/chat-media-status-runtime.test.js:48`: `assert.deepEqual(await harness()(),{mediaId:id,kind:'image',origin:'attachment',state:'ready',validationStatus:'clean',mimeType:'image/png',sizeBytes:100,durationMs:null})`; :61 `await assert.rejects(get({id:'other',capabilities:[]}),{statusCode:403})` | Metadata safe; somente autor/admin | Sim |
| Attached ACL | `test/chat-media-status-runtime.test.js:76`: `assert.equal(dto.state,state)`; :78 `assert.equal(JSON.stringify(dto).includes('secret-key'),false)` | Outro leitor autorizado acessa attached/lost metadata | Sim |
| MED29 formato reprovado | `test/chat-media-status-routes.test.js:79`: `assert.equal(response.statusCode,200)`; :80 `assert.equal(response.json().state,'rejected')`; :81 `assert.equal(response.json().reason,'invalid_format')` | Rejeição assíncrona200 com reason exato | Sim |
| DTO sem keys/filename/URL | `test/chat-media-status-runtime.test.js:48`: `assert.deepEqual(await harness()(),...)`; :92 `assert.equal(JSON.stringify(dto).includes('secret-filename'),false)` | Allowlist exata, nenhuma referência de storage | Sim |
| Estados e cache privado | `test/chat-media-status-routes.test.js:66`: `assert.equal(response.statusCode,200)`; :67 `assert.equal(response.json().state,state)`; :71 `assert.equal(response.headers['cache-control'],'private, no-store')` | uploaded/processing/ready/attached/unavailable/lost200 | Sim |
| Identidade production real | `test/chat-media-upload-postgres-live.test.js:508`: `assert.equal((await get()).statusCode,200)`; :546 `assert.equal((await get('crm_session=bogus')).statusCode,401)`; :555 e :560 `assert.equal((await get()).statusCode,401)` | Sessão real validada; inválida/revogada/expirada401 | Sim |
| Origem/capacidade/ownership/admin/attached | `test/chat-media-upload-postgres-live.test.js:513`: `assert.equal((await get('crm_session=other-synthetic-session')).statusCode,403)`; :520403; :527200 admin; :542200 attached | Bloqueios403, autorizações200 | Sim |
| CSRF e preflight upload | `test/chat-media-upload-postgres-live.test.js:584`: `assert.equal((await post('bogus')).statusCode,401)`; :585 `assert.equal((await post(undefined,'wrong')).statusCode,403)`; :586 `assert.equal((await post()).statusCode,202)` | Credencial distinta de CSRF, sem bypass | Sim |
| DB failure propagada, legado compatível | `test/chat-media-status-runtime.test.js:142`: `await assert.rejects(identity.authorizeOperationalRead({action:'conversation.read',sessionToken:'invalid'}),{statusCode:403})`; :170 `await assert.rejects(unavailable.authorizeOperationalRead(...),error=>error===failure)` | Default403 preservado; DB não mascarado | Sim |
| Spool distinto do legado | `test/chat-media-status-runtime.test.js:95`: `assert.throws(()=>requireMediaSpoolRoot({CHAT_MEDIA_SPOOL_ROOT:'var/private/../private',PRIVATE_MEDIA_ROOT:'var/private'}),/distinct CHAT_MEDIA_SPOOL_ROOT/u)` | resolve/case Windows fecham bypass de configuração | Sim |

Adequação: valores/códigos exatos e payload completo assertados. Testes sem
call-count como evidência; convenções CONTRIBUTING.md/node:test/checkJs.
Gates T8 concluídos: validate761 aprovados/3 skips antigos,764 total;
SQL conjunto25/25, teste composto final14/14 (13T7+1T8) com DB real, zero skips;
E2E exclusivo107 aprovados/7 skips antigos,114 total; types/lint/diff verdes.
DB503 foi comprovado também no POST com preflight, além do GET, em
`test/chat-media-upload-postgres-live.test.js:626`: `assert.equal((await failedApi.inject({...method:'POST'...})).statusCode,503)`.
Status T8 concluída; requisito MED16 permanece In Progress até T9/T13/Verifier.

## T7: Upload humano com admissão durável

Concluída com gates verdes. Premissas/arquivos/sucesso enviados ao integrador
antes do patch. Migration 0029 adiciona ledger de admissão sem reescrever
migrations publicadas; nenhum lock/transação SQL fica aberto durante bytes.
Arquivos: upload route/runtime/wiring app/server, repository/export, migration,
testes HTTP/SQL, OpenAPI, design, runbook, spec/tasks/STATE e esta evidência.
T8 continua responsável pelo status do processamento assíncrono.

Testes vieram de MED-04/06/07/08/20/26/28/29 e Done when T7 antes do código.
20 cenários HTTP e 13 SQL novos, sem alterar/remover/ignorar testes existentes.
Gates: validate 743 aprovados, três skips antigos, 746 total; SQL conjunto
24/24 sem skips; E2E exclusivo um worker 107 aprovados, sete skips antigos,
114 total; audit zero; git diff --check, validate_tasks/spec e types/lint verdes.
Node 24.20.0/npm 11.19.0 portátil, PostgreSQL sintético local dedicado.

Reserva antecede bytes: imagem/anexo 2×limite; gravação 3×16 MiB. Tamanho/hash
real ajusta reserva para 2×entrada ou entrada+32 MiB. Filename usa AES-GCM
com AAD UUID, verificado por decrypt autenticado. Empty 422 não cria metadados
fictícios. Campo/file/truncamento inválidos não enfileiram job. MIME/codec
invalidáveis depois do POST permanecem processamento após 202 (MED-29/T8).

Replay completo consome/hash bounded sem spool/reserva; também conta no limite
12/minuto por hash de crm_session canônico. Admissão receiving no mesmo scope
usa 409. Quota soma used+reserved. Transferência/close são revalidados antes
da conversão atômica ledger→mídia/job. Commit incerto consulta estado sob lock;
consumed ou consulta indisponível preservam spool. Remoção falha preserva
reserva. Discovery receiving >24h é contrato para T22, sem sweeper agora.

Correções durante implementação: handler multipart aguardava pipeline de um
source já destruído pelo parser; writer agora é fechado antes do cleanup.
QA encontrou bypass por cookies extras, commit perdido apagando spool e
replay sem throttle. Os três foram corrigidos e têm provas SQL/HTTP próprias.
Primeiro comando de teste expandiu PATH no shell externo; substituído por
Command com quoting simples antes dos gates. Fixtures SQL de hash de senha
e fechamento foram corrigidas antes de rodar; nenhuma assertion enfraquecida.

### Adequação suficiente

| Critério / AC | file:line + assertion | Resultado da spec | Coberto |
| --- | --- | --- | --- |
| 202 com ID opaco/state | `test/chat-media-upload-routes.test.js:120`: `assert.equal(response.statusCode, 202)`; :116 `assert.equal(response.json().state, 'processing')` | Upload aceito e ainda não enviado | Sim |
| Metadata byte-real/quota | `test/chat-media-upload-routes.test.js:124`: `assert.equal(saved.sizeBytes, 15)`; :121 `assert.equal(saved.reservationBytes, 30)` | Reserva 2×entrada medida | Sim |
| Reserva antes do job | `test/chat-media-upload-postgres-live.test.js:110`: `assert.deepEqual(await counts(), {media:0,jobs:0,reserved:String(row.reservationBytes)})` | Pior caso cobrado, zero mídia/job | Sim |
| Upload sem takeover | `test/chat-media-upload-postgres-live.test.js:120`: `assert.equal((await pool.query('SELECT automation_state,automation_epoch,version FROM crm.conversations')).rows[0].automation_state,'assistant')` | Upload não assume conversa | Sim |
| Replay exato / payload diverso | `test/chat-media-upload-routes.test.js:157`: `assert.deepEqual(replay.json(), first.json())`; :161 `assert.equal(response.statusCode, 409)` | Mesmo resultado, outro arquivo 409 | Sim |
| Auth/ACL/CSRF/status negativos | `test/chat-media-upload-routes.test.js:175`: `assert.equal(response.statusCode,statusCode)` para 403/409/429/503; :193 `assert.equal(response.statusCode,401)`; :200 `assert.equal(response.statusCode,403)` | Todas negativas imediatas do contrato | Sim |
| Excesso/truncamento/Content-Length | `test/chat-media-upload-routes.test.js:214`: `assert.equal(response.statusCode,413)`; :217 `assert.equal(response.statusCode,422)`; :220 `assert.deepEqual(await readdir(h.root),[])` | Limite real, nenhum job/parcial solto | Sim |
| Zero-byte / reprovação futura | `test/chat-media-upload-routes.test.js:243`: `assert.equal(response.statusCode,422)`; :246 `assert.equal(response.statusCode,202)` para SVG | Zero inválido antes do 202; tipo real assíncrono | Sim |
| Gravação/limite 16 MiB/cleanup falho | `test/chat-media-upload-routes.test.js:264`: `assert.equal([...h.records.values()][0].reservationBytes,15+32*1024*1024)`; :269 `assert.equal(response.statusCode,413)`; :283 `assert.equal(h.reservations.size,1)` | Reserva da conversão, limite e liberação só após cleanup | Sim |
| Concorrência / used+reserved | `test/chat-media-upload-postgres-live.test.js:183`: `assert.equal(results.filter(r=>r.status==='fulfilled').length,1)`; :214 `await assert.rejects(repository.admit(input()),{statusCode:429})` | Um vencedor; quota conservada | Sim |
| Replay throttle/cookies extras | `test/chat-media-upload-postgres-live.test.js:203`: `await assert.rejects(repository.admit({...row,id:randomUUID()}),{statusCode:429})`; :299 `assert.equal(response.statusCode,n<12?422:429)` | 13º request não passa usando mesmo token | Sim |
| Transfer/close e rollback job | `test/chat-media-upload-postgres-live.test.js:235`: `await assert.rejects(repository.complete(completed(row)),{statusCode:mutate.startsWith('assigned')?403:409})`; :325 `assert.deepEqual(await counts(),{media:0,jobs:0,reserved:String(row.reservationBytes)})` | Nunca publicar envio indevido ou meia transação | Sim |
| Commit perdido / DB indisponível | `test/chat-media-upload-postgres-live.test.js:404`: `assert.equal((await api.inject(request)).statusCode,503)`; :402 `assert.deepEqual(await counts(),{media:1,jobs:1,reserved:'30'})`; :410 `assert.equal(replay.json().mediaId,media.id)` | Spool preservado e replay único, sem falso sucesso | Sim |
| Discovery orphan e liberação uma vez | `test/chat-media-upload-postgres-live.test.js:439`: `assert.deepEqual(await repository.listAbandonedAdmissions(),[])`; :430 `assert.deepEqual(await counts(),{media:0,jobs:0,reserved:'0'})` | Não liberar sem confirmação nem cobrar duplamente | Sim |
| Erro previsível e privacidade | `test/chat-media-upload-routes.test.js:176`: `assert.equal(response.json().accepted,false)`; :182 `assert.equal(response.headers['content-type'],'application/problem+json; charset=utf-8')`; :145 `assert.equal(response.body.includes('private-canary'),false)` | Campos de erro estáveis, sem filename/plaintext | Sim |

Adequação: cada critério tem estado/valor assertado; assertions não se limitam
a call counts. Filename também autenticado por AES-GCM (:131). Convenções
CONTRIBUTING.md/node:test/checkJs seguidas. Requisitos seguem In Progress;
nenhum Verified ou validation.md final produzido.

## T6: Worker de processamento persistente

Premissas, arquivos e sucesso enviados ao integrador antes do patch: preservar
fila existente e efeitos Meta, nova migration 0028 sem reescrever 0027,
CAS/attempt vigente, persistir variante antes do PUT e confirmar cleanup antes
de ready. Arquivos: handler, repository, job queue, exports, worker, updater,
allowlists de observabilidade, migration, testes unit/live e documentação.
Nenhuma dependência nova. O fixture T2 passou a usar queue canônica chat_media,
sem mudar suas oito assertions/cenários. Requisitos MED-14/19/26/28/29 seguem
In Progress até verificação independente e integração das próximas fases.

Quick/Topology/Build: validate PASS, 722 aprovados, três skips antigos,
725 total, Node 24.20.0/npm 11.19.0. Novos unitários: 16 handler e quatro
composição/lifecycle. Suite SQL conjunta: 23/23 PASS (13 T6, oito schema T2,
dois queue legados), zero skips. Ciclo combinado final: 14/14 PASS, 54,16 s,
incluindo os 13 SQL e PNG + gravação WebM Chromium reais contra RustFS alpha.99,
SDK e banco dedicados. Hash original/final, tamanho, MIME, ready, quota e
spool vazio confirmados. Objetos sintéticos removidos pelo teste.

Imagem final construída com T6:
`sha256:d372430897763a95b471898d349af004525ae234003fb350e7f5538fbaaf1655`,
400961795 bytes. Container isolado com USER node/UID 1000, read-only,
2 GiB/1 CPU e tmpfs privado. Scanner e normalizador reais vieram dos módulos
`/app/modules` dessa imagem; handler/repository/SDK rodaram no host contra
DB e RustFS locais. A imagem T5 7105b14c contém somente T5 e anteriores.
Não alegamos worker completo remoto ou ativação operacional, pendentes T23/T24.

Falhas de desenvolvimento: FK do attempt inicialmente UUID contra coluna
TEXT existente; corrigida para TEXT antes da entrega. Harness de recovery
descartava um claim recém-criado, corrigido preservando o claim. Primeiro
replay na imagem usou helper relativo ao WORKDIR /app, corrigido para caminho
absoluto /workspace. Todos os cenários reexecutados; nenhum teste enfraquecido.
QA encontrou ACK terminal antes da persistência da rejeição; corrigido com
retrySafe em DB throw/CAS false e convergência comprovada no mesmo registro.

Contratos: queue chat_media/job chat_media.process/effect internal; claim
carrega chatMediaId. Heartbeat de 5 s acompanha scanner/encoder. PUT é efeito
interno imutável e reconciliável, sem marcar efeito Meta. prepare persiste
SHA/tamanho/MIME antes de PUT; HEAD divergente não sobrescreve. Cleanup
confirmado precede transação ready; reserva cobre spool/intermediários/objeto
e só reduz ao tamanho final após cleanup, used muda somente em T10. Falha de
cleanup ou rollback conserva reserva; replay após cleanup e DB crash usa
HEAD no mesmo registro, sem segunda conversão/PUT. Rejeitados conservam
reserva até cleanup T22. Freshclam inicia em background; stop/concurrent
start não recriam timer depois de shutdown. Mídia continua fail-closed.

### Adequação: suficiência e discriminação

Aliases: unit = test/chat-media-process-worker.test.js;
sql = test/chat-media-process-postgres-live.test.js;
composition = test/chat-media-worker-composition.test.js.
Referências abaixo são linhas concretas das assertions.

| Critério                        | Assertion concreta                          | Esperado                                          |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Replay e variante única         | unit:173/174/184/185; sql:303               | Um PUT e um prepare/ready                         |
| Variante preparada antes do PUT | unit:107/110                                | SHA presente, bytes exatos                        |
| Quota ready                     | sql:300/301/302/304                         | Reserva final, used zero, spool vazio             |
| Rollback após PUT e cleanup     | sql:326/330/331/332/337/338/339/340/341/342 | Mesmo registro, HEAD, sem novo PUT/scan           |
| Cleanup falho                   | sql:362/363/367/381/382/383/384             | Reserva integral até remover spool                |
| HEAD divergente                 | sql:398/399/400                             | Não sobrescrever nem liberar reserva              |
| Scanner e formato negados       | unit:210/211/212; sql:414/415/416           | Sem PUT/ready, rejeição persistida                |
| Rejeição com DB/CAS falho       | sql:462/463/477/482/490/491                 | Retry no mesmo registro antes de ACK              |
| Fencing e concorrência          | sql:281/291/510/512/513/515                 | Um owner, stale attempt não publica               |
| Lease durante subprocesso       | unit:244/245/246/254/255                    | Sem efeito perdido, heartbeat repetido            |
| Queue e integração              | sql:252/253/254; composition:22/23          | ID e handler na fila canônica                     |
| Texto e lifecycle               | composition:66/67/90/91                     | CDN pendente não bloqueia texto/timer             |
| Privacidade observável          | composition:38/39/40/41                     | Dimensões técnicas, sem canários privados         |
| Ciclo real na imagem            | sql:647/653/654/659/660/664                 | Ready, hash/tamanho/MIME, used zero e spool vazio |

Near misses discriminados: ready sem cleanup falha sql:304; liberar reserva
no rollback falha sql:326/340/341; confiar só no HEAD sem comparar SHA/MIME/size
falha sql:398/399; reprocessar gravação após PUT incerto falha unit:195;
ACK antes de persistir rejected falha sql:462/463/477/482; marcar efeito Meta
falha unit:154 e sql:311; aguardar CDN antes de texto falha composition:66;
timer recriado após stop falha composition:91. Veredito: suficiente e
discriminante para a fronteira T6, condicionado aos gates finais registrados
no fechamento desta seção. Verifier independente da feature ainda obrigatório.

Fechamento T6: E2E exclusivo com um worker PASS, 107 aprovados e sete skips
antigos, 114 cenários preservados (1,1 min). npm audit: zero vulnerabilidades.
git diff --check: PASS. Quick/Topology/Live/Build e adequação: PASS. Fase 1
concluída; próxima tarefa T7 pelo integrador, sem implementação antecipada.

## T5: Normalização de gravações e assinaturas

Premissas, arquivos e sucesso foram enviados ao integrador antes do patch:
entrada validada em T4, OGG/Opus mono a 48 kHz e saída escaneada, temporário
privado e publicação exclusiva. Arquivos: módulo, testes, export, Docker,
atualizador de assinaturas, composição do worker, runbook, spec e tasks.
Sem nova dependência JavaScript ou serviço. FFmpeg/ffprobe, freshclam e CA
suportam gravações e verificação genuína; os copyrights dos pacotes Debian
permanecem na imagem. O digest da base Node foi preservado.

Gates Quick, Topology e Build: PASS, 701 aprovados, três skips antigos, 704 total.
10 unitários do normalizador, quatro do atualizador e um de header enganoso;
tipos e lint verdes. Runtime explícito: um teste aprovado em 103,23 s.
WebM do Chromium, OGG/Opus e MP4/AAC viram OGG/Opus mono confirmado por
channels=1; OGG de 300 s retorna durationMs=300000, WebM de 301 s é rejeitado
sem saída. Sem skips ou assinaturas falsas. CPU: 87,93 s user e 15,03 s system;
RSS máximo: 989248 KiB, zero swaps. Medição por GNU time inclui subprocessos;
fixture sintética não substitui o teste de carga em T23.

Imagem runtime construída e executada localmente:
digest `sha256:7105b14c4563b8daeeed2b1eee1aa20f3bf873e0b965cfb13a7fe67c140fb8fd`,
400957267 bytes. USER node, UID 1000; assinatura-base daily 28144, main 63 e
bytecode 339 baixada e testada oficialmente durante o build. Verificação
executável na própria imagem confirmou baseline, freshclam genuíno e marcador
publicado. Runtime remoto, limites, mount de definições e backup continuam
como gates em T23.

O timeout de 120 s é do encoder; por arquivo, scan 60 s, libmagic 10 s,
probe 10 s e decodificação 30 s: limite somado de 340 s nas fases locais,
além de IO, DB e PUT. Escolha explícita no design e runbook; o handler em T6
renova lease. Recomenda-se limite de 2 GiB por worker, pela medição próxima
de 1 GiB, com conversão e scan sequenciais. Freshclam tem timeout de 180 s
no startup e a cada 24 h, com falha técnica observável. Marcador só depois
de freshclam com exit 0, por arquivo temporário e rename atômico; falha
preserva conteúdo e mtime anteriores. Base instalada é exigida; marcador
inválido, futuro ou stale impede liberação. O scanner legado da API deverá
compartilhar definições privadas com o worker em T23.

### Adequação: suficiência

Nesta seção, unit = test/recorded-audio-normalizer.test.js,
runtime = test/recorded-audio-normalizer-runtime.test.js,
refresh = test/clamav-signature-refresh.test.js e
validator = test/chat-media-validation.test.js. Números indicam linhas das
assertions atuais; valores de timeout estão em milissegundos.

| Critério                          | Assertion concreta                                                                                                   | Esperado                                | Coberto |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| Conversão MED-14                  | unit:72 channels=1, :73 codec=opus, :75 scans=2; runtime:51/52/53                                                    | Mono, OGG/Opus, scan de entrada e saída | Sim     |
| Bytes e vazio MED-04              | unit:89 rejects entrada vazia ou 16 MiB + 1; :97 diretório somente com entrada                                       | Entrada inválida não converte           | Sim     |
| Duração MED-12                    | unit:116 razão invalid_format em 300001 ms; runtime:93 durationMs=300000; :126 rejects 301 s; :134 ausência de saída | Teto útil inclusivo de 300 s            | Sim     |
| Header enganoso                   | validator:210 rejects header 1 s e timeline 301 s                                                                    | Não confiar no header                   | Sim     |
| Timeout e recursos                | unit:44 timeout=120000, :45 buffer=65536, :47 cap=301, :48 protocol=file; :116 processing_failed                     | Subprocesso limitado e erro sanitizado  | Sim     |
| Saída infectada ou estéreo MED-26 | unit:116 infected e não mono rejeitados; :127 cleanup                                                                | Saída falha fechado                     | Sim     |
| Cleanup                           | unit:76 diretório com entrada e saída; :127 somente entrada                                                          | Sem intermediário órfão                 | Sim     |
| Variante imutável                 | unit:137 EEXIST; :145 bytes originais preservados                                                                    | Não substituir saída existente          | Sim     |
| Refresh e cadência                | refresh:27 intervalo de 24 h, :29 uma chamada no startup, :31 timeout=180000, :32 buffer, :33 timestamp válido       | Refresh limitado                        | Sim     |
| Marcador após falha               | refresh:112 conteúdo anterior, :113 mtime anterior; :77 inválido/futuro/stale rejeitados                             | Falha não forja freshness               | Sim     |
| Concorrência                      | refresh:132 calls=1                                                                                                  | Um updater em curso                     | Sim     |

### Adequação: discriminação

| Near miss                                  | Assertion que falha            | Distinção                         |
| ------------------------------------------ | ------------------------------ | --------------------------------- |
| Encoder com -ac 1 sem provar mono          | runtime:51/98                  | Saída estéreo não passa           |
| Scan somente da entrada                    | unit:75/116                    | Saída deve ser escaneada          |
| Aceitar header curto ou truncar 301 s      | validator:210; runtime:126/134 | Timeline útil excedente rejeitada |
| Usar metadata OGG com padding para o teto  | runtime:93                     | 300 s úteis aceitos               |
| Deixar temporário após erro                | unit:127                       | Cleanup obrigatório               |
| Sobrescrever variante                      | unit:137/145                   | Publicação exclusiva              |
| Atualizar marcador quando freshclam falha  | refresh:112/113                | Conteúdo e mtime preservados      |
| Aceitar marcador inválido, futuro ou stale | refresh:77                     | Falha fechado                     |

Veredito: suficiente e discriminante; Quick, Topology, Build e runtime PASS.
Requisitos ainda dependentes de API, UI ou worker permanecem In Progress.

## T4: Validação de mídia

Premissas antes do patch: somente allowlist aprovada, scanner existente e
ffprobe no backend; declarado não substitui MIME real. Arquivos: módulo
`chat-media-validation.js`, export, dois testes e spec/tasks/execution.
Gerador sintético Chromium versionado adicionado após finding deQA, para
preservar reprodução de gravações streaming sem duration.
Sucesso: pelo menos12 cenários, fixtures reais para seis formatos, MIME/codec,
malware/stale e fronteiras de tamanho/legenda; Quick, runtime real e Build.

Quick/Build final:685 pass, três skips preexistentes,688 total, Node24.20.0;
types/lint verdes.16 testes unitários específicos. E2E não repetido nesta
tarefa sem mudançaUI; baseline integral107+7skips de T2 permanece histórico,
novo gate integral ao concluir a fase. Requisitos seguem In Progress.

Runtime isolado usa Node24.20.0 bookworm, FFmpeg5.1.9, ClamAV1.4.3 e libmagic.
Freshclam oficial atualizou daily28144/main63/bytecode339, verificou cada
database e terminou0. Primeiro download falhou por faltaCA; instalação
explícita de ca-certificates resolveu, requisito da imagem emT5. Nenhuma
assinatura sintética/fake usada. Aviso NotifyClamd semdaemon não impediu
update; T5 desabilitará essa opção. Runtime remoto permanece gateT23.

O scanner rejeita infecção, indisponibilidade e assinatura>36h. ffprobe
tem timeout10s/maxBuffer64KiB/probesize8MiB/maxalloc64MiB/protocolfile e MOV
sem refs externas. MP3 admite uma capa JPEG/PNG apenas com attached_pic=1.
Gravação streaming sem duration é decodificada por FFmpeg com threads1,
timeout30s, teto301s e progresso limitado; timeline>300s é rejeitada.
Não se aceita duration ausente por suposição. Erros são sanitizados.

### Adequação: suficiência

| Critério           | Evidência assertion                                                                                                           | Esperado                        | Coberto |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------- |
| MED01..03 formatos | `test/chat-media-validation.test.js:106` MIME exato; :107 tamanho15; :108 SHA64; seis fixtures; runtime:72 MIME/:73 tamanho   | Allowlist e bytes/codec válidos | Sim     |
| MED04 limites      | `test/chat-media-validation.test.js:230` limite exato; :238 throws status413 para+1                                           | Fronteira5/16MiB                | Sim     |
| Legenda            | `test/chat-media-validation.test.js:254`1024; :2621025throws; :274 áudio throws                                               | Limites aprovados               | Sim     |
| MIME/codec MED29   | `test/chat-media-validation.test.js:295` razão invalid_format; :344 rejects HEVC/MP3video/Vorbis; runtime:151/:181 rejects    | Disfarce/codec não ficam ready  | Sim     |
| Scanner MED26      | `test/chat-media-validation.test.js:367` razões infected/stale/scanner_unavailable e mensagem fixa; runtime:198 EICARinfected | Fail closed, sem dado privado   | Sim     |
| MP3 capa           | `test/chat-media-validation.test.js:160`audioCodec mp3/:162 vídeo comum rejects; runtime:99 capa real aceita                  | Capa embutida válida            | Sim     |
| WebM streaming     | `test/chat-media-validation.test.js:189`1200ms/:191301s rejects; runtime:134durationundefined/:145 timeline real1..2s         | Duração medida e limitada       | Sim     |
| Declaração300s     | `test/chat-media-validation.test.js:422`300000ms/:424300.001s rejects                                                         | Teto inclusivo                  | Sim     |
| Probe/empty        | `test/chat-media-validation.test.js:391`rejects                                                                               | Falha nunca ready               | Sim     |

### Adequação: discriminação

| Near miss                           | Assertion que falha  | Resultado incorreto distinguido                  |
| ----------------------------------- | -------------------- | ------------------------------------------------ |
| Aceitar MIME declarado sem detector | unit:295/runtime:151 | PNG declaradoJPEG aceito                         |
| Aceitar qualquer codecMP4/OGG       | unit:344/runtime:181 | HEVC/mpeg4/Vorbis aceitos                        |
| Fail open no scanner                | unit:367/runtime:198 | EICAR ou scanner erro aceito                     |
| Rejeitar MP3 com capa               | unit:160/runtime:99  | Arquivo permitido rejeitado                      |
| Supor duraçãoWebM ausente           | unit:189/runtime:145 | Gravação Chromium rejeitada ou duração inventada |
| Truncar gravação longa e aceitar    | unit:191             | 301s aceitos                                     |

Runtime final PASS: um teste, zero skips,111s; seis formatos reais, MP3capa,
WebMChromium com duração ausente e timeline medida, MIMEdisfarçado/codec/EICAR.
Reprodução: executar `node scripts/generate-chat-media-recording-fixture.mjs`
com PlaywrightChromium instalado; executar teste no container com
`RUN_CHAT_MEDIA_RUNTIME_TESTS=yes` e `CHAT_MEDIA_CHROMIUM_FIXTURE` apontando
para `var/tooling/chromium-media-recorder.webm` no mount. Gerador usa apenas
oscilador, não microfone; bytes/hash variam por serial/timestamps da gravação.
Pico clamscan observado750MiB; orçamento operacional medido emT5.

Veredito: suficiente e discriminante; Quick/runtime/Build PASS. Nenhum
requisito completo Verified, pois API/UI/worker ainda estão pendentes.

## T3: Adapter privado RustFS

PASS: nove unitários e um ciclo real do SDK na alpha.99 local. Gate Quick
668 pass, três skips preexistentes, 671 total; tipo/lint/audit verdes.
T3 não declara requisitos inteiros verificados, pois API/worker seguem pendentes.

### Antes do patch

- Premissas: source validada fornece SHA-256, tamanho e MIME; key UUID opaco;
  bucket CRM isolado; nenhuma URL assinada retornada para browser.
- Arquivos: `rustfs-media-store.js`, export `index.js`, manifest do módulo e
  lockfile, testes `rustfs-media-store.test.js` e `rustfs-media-store-live.test.js`,
  spec/tasks/execution. Nenhuma dependência frontend adicionada.
- Sucesso: pelo menos oito unitários, operações streaming e falhas parciais,
  mais ciclo real SDK em alpha.99; Quick, smoke T1, tipos/lint e audit.
- Dependência: T2 `b94e5f1`; correção de negativas T1 `cacb897`.

### Dependência e contrato

`@aws-sdk/client-s3` fixado em 3.1146.0 no módulo backend, 26 pacotes novos.
Metadados npm: Apache-2.0 e Node >=20, compatível com runtime 24.20.0.
Justificativa: assinatura/autenticação, streaming e operações S3 necessárias,
evitando implementar protocolo próprio no runtime. Risco: superfície de
dependências e defaults de checksum; lockfile, audit high e ciclo real
contra imagem exata fazem parte do gate.

[AWS checksum docs](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html)
confirma CRC32 automático desde 3.729.0. O adapter usa SHA256 precomputado,
ContentLength e settings WHEN_REQUIRED, path-style e maxAttempts=1.
`IfNoneMatch='*'` foi comprovado na alpha.99: replay 412 só retorna sucesso
se HEAD reconcilia o mesmo SHA/tamanho/MIME. Variante divergente não sobrescreve.
Erro de PUT preserva código MEDIA_STORAGE_UNAVAILABLE; não vira invalid_format.

Métodos: `putValidated({key,stream,sizeBytes,sha256,mimeType})`, `head(key)`,
`read(key,range?)`, `deleteDraft(key)`. Read retorna stream Node, tamanho,
SHA, MIME e Content-Range; não retorna URL/key/bucket/ETag. Delete exige que
o chamador bloqueie e revalide `message_id IS NULL` antes, implementado em T22.
Byte count/hash são verificados durante PUT; erros de read parcial são
sanitizados. Falhas 404/416/externa têm códigos distintos. SDK não retry cego.

Ciclo real em `rtk proxy node --test test/rustfs-media-store-live.test.js`,
com credencial DEV limitada e opt-in explícito: PUT streaming, HEAD hash/size,
GET bytes exatos, Range bytes exatos, replay condicional, rejeição de variante
divergente, GET original preservado, DELETE e HEAD404. Um teste passou, zero
skips. Warnings SDK de request streaming não retryable em 412 são genéricos;
nenhum segredo/chave/provider body vai para log ou DTO.
Smoke T1 atual `var/rustfs-local-alpha99-object-denial-evidence.json` passou
com 11 checks reais na mesma imagem/digest, após instalar o SDK.

### Adequação: suficiência

| Critério / requisito                  | Evidência assertion                                                                                                                                                                                                             | Resultado esperado                                        | Coberto |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| PUT streaming/hash/size               | `test/rustfs-media-store.test.js:43`: `assert.deepEqual(await collect(command.input.Body), BYTES)`; linha46 `assert.deepEqual(result,{sizeBytes:BYTES.length,sha256:SHA})`; linha38 assert checksum base64                      | Bytes exatos, digest/tamanho da variante                  | Sim     |
| HEAD                                  | `test/rustfs-media-store.test.js:57`: `assert.deepEqual(result,{sizeBytes:BYTES.length,sha256:SHA,mimeType:'image/jpeg'})`                                                                                                      | Metadata privada exata, sem ETag                          | Sim     |
| Reconciliação sem overwrite MED-15/19 | `test/rustfs-media-store.test.js:80`: `assert.deepEqual(await adapter.putValidated(upload()),{sizeBytes:BYTES.length,sha256:SHA})`; linha85 `assert.rejects` variante com código MEDIA_STORAGE_UNAVAILABLE                      | 412 igual reconcilia; diferente falha                     | Sim     |
| Range MED-17                          | `test/rustfs-media-store.test.js:106`: `assert.equal(result.contentRange,...)`; linha108 `assert.deepEqual(await collect(result.stream),BYTES.subarray(0,3))`                                                                   | Range e bytes exatos                                      | Sim     |
| Falhas MED-19/20                      | `test/rustfs-media-store.test.js:117`: `assert.rejects(...error.code===code&&!JSON.stringify(error).includes('secret'))`                                                                                                        | 404 missing/416 range/503 unavailable sanitizados         | Sim     |
| Timeout                               | `test/rustfs-media-store.test.js:134`: `assert.rejects(...error.code==='MEDIA_STORAGE_UNAVAILABLE')`                                                                                                                            | Deadline aborta request, não declara sucesso              | Sim     |
| Limite/hash incorreto                 | `test/rustfs-media-store.test.js:154` e `:158`: `assert.rejects(adapter.putValidated(...),/Unable to store private media/u)`                                                                                                    | Fonte divergente não vira PUT válido                      | Sim     |
| Stream parcial MED-19/20              | `test/rustfs-media-store.test.js:175`: `assert.rejects(collect(result.stream),...error.message==='Private media storage is unavailable')`                                                                                       | Falha sem URL/secret raw                                  | Sim     |
| Delete/key/bucket isolados            | `test/rustfs-media-store.test.js:189`: `assert.deepEqual(target,{Bucket:'crm-silmer-chat-media-dev',Key:KEY})`; linha190 `assert.rejects` key arbitrária; linha194 `assert.throws` Hermes                                       | Somente bucket CRM/key UUID                               | Sim     |
| SDK real                              | `test/rustfs-media-store-live.test.js:52`: `assert.deepEqual(await bytes(read.stream),body)`; linha55 Range bytes; linha74 `assert.deepEqual(await bytes(preserved.stream),body)`; linha78 `assert.rejects` missing após delete | Defaults SDK compatíveis com alpha.99 e bytes preservados | Sim     |

### Adequação: necessidade

| Teste / assertion                                                      | Origem                                                       | Manter |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| `test/rustfs-media-store.test.js:35–47`, output bytes/digest e sem key | T3 streaming + MED-15/20                                     | Sim    |
| `test/rustfs-media-store.test.js:57`, HEAD metadata                    | T3 HEAD                                                      | Sim    |
| `test/rustfs-media-store.test.js:80–85`, 412 igual/diferente           | Design PUT/DB desconhecido + MED-19                          | Sim    |
| `test/rustfs-media-store.test.js:97–108`, Range                        | MED-17                                                       | Sim    |
| `test/rustfs-media-store.test.js:117`, códigos/privacidade             | MED-19/20                                                    | Sim    |
| `test/rustfs-media-store.test.js:134`, deadline                        | T3 timeout                                                   | Sim    |
| `test/rustfs-media-store.test.js:154–158`, hash/size                   | T3 fonte válida/streaming                                    | Sim    |
| `test/rustfs-media-store.test.js:175`, read parcial                    | T3 falha parcial + MED-20                                    | Sim    |
| `test/rustfs-media-store.test.js:189–194`, Delete/key/bucket           | T3 acesso privado                                            | Sim    |
| `test/rustfs-media-store-live.test.js:42–78`, ciclo real               | T3 compatibilidade real, sem presumir smoke manual prova SDK | Sim    |

Verdict: critérios e falhas da camada cobertos em outputs e bytes, inclusive
contra runtime real. Testes seguem CONTRIBUTING/node:test/JSDoc; nenhum teste
preexistente alterado, ignorado ou removido. Nenhum cenário fora da spec.

## Correção T1: negar leitura de objeto conhecido fora do bucket

PASS em 2026-10-06T03:00:29.057Z. Uma revisão intermediária detectou que
HEAD de bucket testa ListBucket e não prova GetObject negado. O smoke agora
exige HEAD e GET de um canário sintético conhecido no bucket negado com 403.
O operador havia comprovado PUT/HEAD 200 e tamanho 48 bytes desse canário;
o smoke limitado não o cria ou remove. Nenhuma operação em Hermes.

Arquivos da correção: script/harness T1, runbook, tasks e execution.
T3 foi preservada em WIP e não entra neste commit. Credenciais administrativas
ficam fora do smoke e do runtime. Chave do canário não vai ao evidence JSON.

Evidência local atual: `var/rustfs-local-alpha99-object-denial-evidence.json`,
mesmo digest alpha.99 observado anteriormente. São 11 checks reais, incluindo
os novos `crossObjectHeadDenied=true` e `crossObjectGetDenied=true`.
Harness: 10/10 passaram, zero falhas/skips. Quick: 666 pass, três skips
preexistentes, 669 total; essa contagem inclui oito testes T3 ainda em WIP,
não entregues neste commit. Nenhuma assertion foi enfraquecida; a comparação
exata dos checks foi fortalecida com os dois campos novos.

| Critério / necessidade                     | Evidência assertion                                                                                                                      | Resultado da spec/gate                                             | Manter                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| Bucket HEAD403 não prova objeto GET negado | `test/rustfs-live-smoke.test.js:255`: `await assert.rejects(h.run(), /cross-bucket object GET/u)`                                        | GET200 de objeto fora do bucket impede PASS mesmo se HEADbucket403 | Sim, isolamento T1/MED-16 suporte |
| Falha sem evidência e cleanup próprio      | `test/rustfs-live-smoke.test.js:256`: `assert.equal(h.evidence(), undefined)`; linha257 `assert.equal(h.removed(), true)`                | Não declarar PASS; limpar somente canário próprio                  | Sim, T1/MED-19 suporte            |
| Resultado evidencia cada negativa real     | `test/rustfs-live-smoke.test.js:118`: `assert.deepEqual(result.checks, {...crossObjectHeadDenied: true, crossObjectGetDenied: true...})` | Checks distintos de bucket e de objeto                             | Sim, T1 isolamento                |

Verdict de adequação: cenários positivos e bypass real cobertos; teste
necessário para a policy por bucket; bytes e estados continuam assertados.
Tabela de T1 abaixo atualizada para as linhas atuais. Gates tipo/lint/diff
também passam; isto não é validação final independente da feature.

## T1: Compatibilidade RustFS

Status: concluída. Harness e smoke real passaram na alpha.99 local isolada.
Ativação remota continua pendente em T23. T2 foi concluída abaixo.

### Antes do patch

- Premissas: versão configurada `rustfs/rustfs:1.0.0-alpha.99`; buckets CRM
  distintos, privados e sem expiração; credencial limitada própria para o
  smoke. Nenhuma operação em `hermes-backups`.
- Arquivos: `docs/runbooks/rustfs-chat-media.md`,
  `scripts/rustfs-live-smoke.mjs`, `test/rustfs-live-smoke.test.js`,
  `package.json` (script somente), `tasks.md` e este relatório.
- Sucesso: pelo menos seis casos locais do harness; operações e negativas
  reais na imagem alpha.99 com digest observado; Topology e recovery mocks.
- Dependência: nenhuma. Task IDs de MED-16, MED-19, MED-23.

### Escolhas de implementação

O smoke usa transporte SigV4 pequeno para canário e não altera dependências.
O adapter runtime continua previsto com SDK fixado em T3. O processo limita
buckets a nomes CRM conhecidos, exige opt-in e HTTPS. HTTP é permitido
somente em loopback para ambiente isolado. Cleanup remove só a chave criada
pelo processo, mesmo após resultado desconhecido de PUT. Falha nunca grava
evidência PASS.

O usuário autorizou Docker local depois do planejamento, que originalmente
dependia de `dell-worker`. T1 comprova compatibilidade real na mesma versão
configurada usando container local. Seu digest não comprova o deployment
remoto. T23 permanece responsável por ativação, acesso e recovery no alvo.
Essa distinção foi registrada no critério de T1 antes de sua execução real.

### Gates locais executados

- `rtk proxy node --test test/rustfs-live-smoke.test.js`: 9 passaram, zero
  falhas/skips. Testes foram escritos antes do harness.
- `rtk npm run typecheck`: PASS.
- `rtk proxy npx eslint scripts/rustfs-live-smoke.mjs test/rustfs-live-smoke.test.js`:
  PASS.
- `rtk npm run validate:topology`: PASS; readiness continua blocked, com oito
  bloqueios preexistentes. Não é aprovação de recovery.
- `rtk npm run test:recovery:mocks`: 14 passaram, zero falhas/skips.
- `rtk git diff --check`: PASS.

### Smoke real e digest

`rtk npm run smoke:rustfs:live`, executado com Node 24.20.0 e credencial
local limitada, passou em 2026-10-06T02:48:15.360Z. Evidência sanitizada
local: `var/rustfs-local-alpha99-evidence.json`. A execução retornou os nove
checks `true`, incluindo 403 anônimo/cross-bucket, Range 206 com bytes
exatos, Range inválido 416 e HEAD 404 após DELETE 204. O bucket negado era
`crm-silmer-smoke-denied-local`, vazio e restrito ao teste em loopback.

`docker inspect crm-silmer-media-test-rustfs` e
`docker image inspect rustfs/rustfs:1.0.0-alpha.99` confirmaram o mesmo
digest da imagem/container em execução:
`sha256:103dd40b84d5aa3d5ab02f3a693797eb1d14cb842554b222dfbb589f364aa47f`.
Scope do JSON: `local-version-compatibility`; não há prova do digest remoto.

Foi detectada uma diferença real de IAM: alpha.99 rejeita
`s3:GetLifecycleConfiguration` como action inválida. Seu enum oficial usa
`s3:GetBucketLifecycle`; a policy sintética limitada foi corrigida para essa
action de leitura e aplicada com 200. Nenhuma configuração de lifecycle
foi modificada. O GET do próprio bucket retornou
404 `NoSuchLifecycleConfiguration`.

### Adequação dos testes do harness

Arquivos seguem `CONTRIBUTING.md`, `node:test`, `test/*.test.js` e JSDoc
checkJs. As negativas fazem implementações plausíveis incorretas falharem;
um transporte fake não comprova compatibilidade RustFS.

| Critério T1 / requisito                         | Evidência exata                                                                                                                                                                                                                                                                                                                | Resultado esperado                                       | Coberto                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------ |
| PUT/HEAD/GET/Range/DELETE e negativas           | `test/rustfs-live-smoke.test.js:118`: `assert.deepEqual(result.checks, { put: true, headHashAndSize: true, getHashAndSize: true, range: true, invalidRange: true, anonymousDenied: true, crossBucketDenied: true, crossObjectHeadDenied: true, crossObjectGetDenied: true, noExpiryLifecycle: true, deleteAndMissing: true })` | Cada check real precisa passar antes de emitir evidência | Sim; smoke real comprovado acima     |
| Digest real e dados sintéticos                  | `test/rustfs-live-smoke.test.js:132`: `assert.equal(result.runningImageDigest, env.RUSTFS_RUNNING_IMAGE_DIGEST)`; linha 133: `assert.equal(result.syntheticOnly, true)`                                                                                                                                                        | Preservar digest fornecido, sem alegar versão do alvo    | Sim; docker inspect comprovado acima |
| Isolamento Hermes                               | `test/rustfs-live-smoke.test.js:148`: `assert.throws(() => validateRustfsSmokeEnvironment({ ...env, MEDIA_S3_BUCKET: 'hermes-backups' }), /CRM bucket/u)`                                                                                                                                                                      | Recusar bucket alheio antes da rede                      | Sim                                  |
| Sem segredo/chave no relatório (MED-20 suporte) | `test/rustfs-live-smoke.test.js:135`: `assert.equal(serialized.includes(env.MEDIA_S3_SECRET_ACCESS_KEY), false)`; linha 136: `assert.equal(serialized.includes(env.MEDIA_S3_ACCESS_KEY_ID), false)`                                                                                                                            | Segredo e access key ausentes                            | Sim                                  |
| Acesso privado (MED-16 suporte)                 | `test/rustfs-live-smoke.test.js:195`: `await assert.rejects(h.run(), /anonymous access/u)`; linha 227: `await assert.rejects(h.run(), /cross-bucket access/u)`                                                                                                                                                                 | 200 anônimo/cross-bucket impede PASS                     | Sim                                  |
| Bytes/Range reais (MED-23 suporte)              | `test/rustfs-live-smoke.test.js:235`: `await assert.rejects(h.run(), /Range\|GET/u)`                                                                                                                                                                                                                                           | Bytes alterados ou 200 ignorando Range impedem PASS      | Sim                                  |
| Falha externa e cleanup (MED-19 suporte)        | `test/rustfs-live-smoke.test.js:243`: `await assert.rejects(h.run(), (error) => error instanceof Error && error.message === 'RustFS smoke failed at PUT; no live PASS recorded')`                                                                                                                                              | Falha de PUT sanitizada, sem PASS                        | Sim                                  |
| Preservação sem expiração                       | `test/rustfs-live-smoke.test.js:262`: `await assert.rejects(h.run(), /lifecycle/u)`                                                                                                                                                                                                                                            | Lifecycle com expiração impede PUT e PASS                | Sim                                  |

| Teste / assertion                                                                                   | Origem                                             | Manter |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------ |
| linhas 113–134, checks/digest/synthetic/sem segredos/sem Hermes                                     | T1 Done when + MED-16/19/23                        | Sim    |
| linhas 141–155, `assert.throws` bucket Hermes/duplicado                                             | T1 isolamento por bucket                           | Sim    |
| linhas 160–182, `assert.throws` opt-in/HTTPS/digest tag                                             | T1 gate explícito e digest real                    | Sim    |
| linhas 188–190 e 220–222, `assert.rejects` acesso anônimo/cross-bucket; cleanup e relatório ausente | T1 negativas / MED-16                              | Sim    |
| linhas 228–230, `assert.rejects` Range/GET; cleanup e relatório ausente                             | T1 bytes reais / MED-23                            | Sim    |
| linhas 236–243, `assert.rejects` PUT sanitizado; cleanup e relatório ausente                        | T1 falha externa / MED-19                          | Sim    |
| linhas 248–253, `assert.rejects` lifecycle; nenhum PUT e relatório ausente                          | T1 preservação de mídia sem alterações silenciosas | Sim    |

| Critério adicional                  | Evidência exata                                                                                                                                                                                                                                                                                                                                                                                     | Resultado / origem                                                                                                                 | Manter |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ |
| HTTP apenas em homologação loopback | `test/rustfs-live-smoke.test.js:206`: `assert.equal(validateRustfsSmokeEnvironment(local).localLoopback, true)`; linha 207: `assert.throws(() => validateRustfsSmokeEnvironment({ ...local, MEDIA_S3_ENDPOINT: 'http://192.0.2.1:21900' }), /HTTPS/u)`; linha 215: `assert.throws(() => validateRustfsSmokeEnvironment({ ...local, MEDIA_S3_ENDPOINT: 'https://s3.example.test' }), /CRM bucket/u)` | DEV isolado permitido; endpoint externo inseguro/bucket canário local externo rejeitados. T1 isolamento + autorização Docker local | Sim    |

Verdict: critérios de T1 cobertos no harness e por smoke real, com digest
observado. Sem assertions rasas, testes desnecessários ou alterações de
testes existentes. Nenhum segredo ou dado real utilizado. T1 concluída;
T23 continua responsável por ativação e recovery no deployment remoto.

## T2: Schema persistente

Status: concluída, gates Live e Build passaram. Requisitos
MED-05/15/27/28 permanecem em progresso; schema não comprova envio ou UI.

### Antes do patch

- Premissas: último número real é 0026; IDs de conversas/usuários/mensagens
  permanecem text. A nova mídia usa UUID e não reutiliza transient_media.
- Arquivos: `modules/database/migrations/0027_chat_media.expand.sql`,
  `test/chat-media-schema-postgres-live.test.js`, `spec.md`, `tasks.md`,
  `execution.md`. Migrations publicadas ficam intactas.
- Sucesso: ao menos seis cenários live de replay, vínculo único, retenção
  independente e quota, com gates Live e Build. Banco exclusivo
  `crm_silmer_test`, sintético e sem dados reais.
- Dependência: T1 concluída em `7e388c8`.

### Implementação e gates

Criada `crm.chat_media` com vínculo único por mensagem, FK composta para a
mesma conversa, upload idempotente por ator/conversa, filename cifrado,
estados, metadados, reserva e CAS. Sem expires_at ou trigger de fim de
jornada. `crm.chat_media_quotas` separa bytes utilizados e reservados;
limites serão injetados e atualizados transacionalmente por API/worker.
Jobs ganham `chat_media_id` e `chat_media.process`, com unicidade e target
próprio. As quatro variantes legadas foram preservadas.

O teste live utiliza ciphertext AES-256-GCM sintético com iv/tag reais.
O CHECK do novo envelope é total (`IS TRUE`), negando campos ausentes,
metadata incompleta e plaintext. O CHECK valida estrutura; autenticação
criptográfica depende da aplicação, não da expressão SQL.

Nenhuma assertion existente foi alterada, removida ou ignorada. Uma falha
inicial no setup do teste (migrate exige options) foi corrigida; uma colisão
de nome de constraint na migration nova foi corrigida antes de aplicar.

- Live T2: 8/8 passaram, zero falhas/skips.
- Live do projeto + T2: 19/19 passaram, zero falhas/skips, com
  `node --test --test-concurrency=1 test/migrations-live.test.js test/inbox-postgres-live.test.js test/n8n-command-store-postgres-live.test.js test/chat-media-schema-postgres-live.test.js`.
- `npm run validate`: PASS com Node 24.20.0/npm 11.19.0, 657 pass,
  três skips preexistentes, 660 total. Inclui lint, tipos e build.
- `npm run test:e2e -- --workers=1`: 107 passaram, sete skips preexistentes,
  114 total. Assertions e contagem preservadas. A primeira execução com
  oito workers tinha 105 pass e duas falhas, incluindo Target crashed;
  o rerun completo com um worker confirmou a suíte sem alterar teste.
- `npm audit --audit-level=high`: zero vulnerabilidades.
- `git diff --check`, validate_spec e validate_tasks strict: PASS.

### Adequação

| Critério / requisito                           | `file:line` + assertion                                                                                                                                                                                                                                                                                                                                                                     | Resultado esperado                                                                  | Coberto |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| Migration aplica duas vezes                    | `test/chat-media-schema-postgres-live.test.js:102`: `assert.deepEqual(await migrate(pool, { migrations: await loadMigrations() }), { applied: [], phase: 'expand' })`; linha 109: `assert.equal(result.rows[0].count, 1)`                                                                                                                                                                   | Replay vazio, uma aplicação 0027                                                    | Sim     |
| Um arquivo por mensagem, mesma conversa MED-05 | `test/chat-media-schema-postgres-live.test.js:120` e 129: `await assert.rejects(media(...), /chat_media_message_id_key/u)` e `await assert.rejects(media(...), /chat_media_message_conversation_fk/u)`                                                                                                                                                                                      | Duplicate/FK rejeitam vínculo inválido                                              | Sim     |
| Upload idempotente por ator/conversa           | `test/chat-media-schema-postgres-live.test.js:142`: `await assert.rejects(media({ upload_command_id: first.upload_command_id }), /chat_media_upload_scope_key/u)`; linha 150: `assert.equal(other.upload_command_id, first.upload_command_id)`                                                                                                                                              | Mesmo scope duplicado rejeitado; outra conversa independente                        | Sim     |
| Preservação após oito dias/terminal MED-15     | `test/chat-media-schema-postgres-live.test.js:163`–164: `assert.equal(await repository.scheduleExpiredDeletions(), 0)` e `assert.equal(await repository.scheduleTerminalJourneyDeletions(), 0)`; linha 168: `assert.deepEqual(attached.rows, [{ state: 'attached', message_id: 'media-conversation-a-message' }])`; linha 174: `assert.equal(oldMedia.rows[0].older_than_eight_days, true)` | Media antiga permanece attached, nenhum job transitório                             | Sim     |
| Rascunho separado MED-27                       | `test/chat-media-schema-postgres-live.test.js:225`: `assert.equal(draft.message_id, null)`; linha 226: `assert.equal(draft.retention_class, 'chat_retained')`; linha 227: `assert.equal(draft.state, 'uploaded')`                                                                                                                                                                           | Rascunho sem vínculo, classe própria                                                | Sim     |
| Quota/reservas MED-28                          | `test/chat-media-schema-postgres-live.test.js:189`/195: `await assert.rejects(pool.query(...), /chat_media_quotas_capacity_check/u)` e `await assert.rejects(pool.query(...), /chat_media_quotas_nonnegative_check/u)`; linha 204: `assert.deepEqual(row.rows, [{ used_bytes: '600', reserved_bytes: '300' }])`                                                                             | Soma acima de limite e valores negativos rejeitados; counters separados preservados | Sim     |
| Ready requer metadata limpa                    | `test/chat-media-schema-postgres-live.test.js:208`–220: `await assert.rejects(media({ state: 'ready' }), /chat_media_ready_metadata_check/u)`; variante infected, linked sem attached e reserva negativa também rejeitadas                                                                                                                                                                  | Não publicar ready incompleta/infectada                                             | Sim     |
| Filename cifrado no schema                     | `test/chat-media-schema-postgres-live.test.js:237`: `await assert.rejects(media({ filename_envelope: JSON.stringify(invalid) }), /chat_media_filename_envelope_check/u)`; linha 243: `assert.equal(valid.filename_envelope.ciphertext, JSON.parse(envelope).ciphertext)`; linha 247: `assert.equal(JSON.stringify(valid.filename_envelope).includes('synthetic.jpg'), false)`               | Estrutura incompleta/plaintext rejeitados; ciphertext real preservado               | Sim     |
| Target/uniqueness job                          | `test/chat-media-schema-postgres-live.test.js:274`: `assert.deepEqual(job.rows, [{ job_type: 'chat_media.process', chat_media_id: draft.id }])`; linha 277: `await assert.rejects(insert(), /outbox_jobs_chat_media_process_key/u)`; linhas 278/282: `assert.rejects` target null/FK inexistente                                                                                            | Target persistente próprio, um job por mídia, FK válida                             | Sim     |

| Teste / assertion                                                                              | Origem                                         | Manter |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| `test/chat-media-schema-postgres-live.test.js:102`, replay e count                             | Done when T2 migration idempotente             | Sim    |
| `test/chat-media-schema-postgres-live.test.js:119–129`, vínculo positivo e negativas unique/FK | MED-05 + Done when T2 vínculo                  | Sim    |
| `test/chat-media-schema-postgres-live.test.js:142–150`, replay scope                           | Design `upload_command_id` + T2 constraints    | Sim    |
| `test/chat-media-schema-postgres-live.test.js:163–182`, sweeper/attached/date/sem expires/jobs | MED-15 + T2 sem sweeper transitório            | Sim    |
| `test/chat-media-schema-postgres-live.test.js:189–204`, capacidade e counters                  | MED-28 + T2 modelo de quota                    | Sim    |
| `test/chat-media-schema-postgres-live.test.js:208–228`, ready/binding/size/draft/object UUID   | MED-05/27 + modelo T2                          | Sim    |
| `test/chat-media-schema-postgres-live.test.js:237–247`, envelope inválido/ciphertext           | Design filename_envelope cifrado / privacidade | Sim    |
| `test/chat-media-schema-postgres-live.test.js:274–285`, jobtarget/unique/FK                    | T2 payload de job compatível                   | Sim    |

Verdict: suficiência por critério e necessidade por teste comprovadas em
SQL real. Assertions verificam valores persistidos e falhas de constraints,
sem substituir estado por call counts. Padrão `CONTRIBUTING.md`, node:test,
JSDoc/checkJs e banco dedicado. Sem alteração de migration publicada.

### Adequação necessária T7/T8 (mapeamento reverso atualizado)

| file:line + assertion | Origem / critério | Manter |
| --- | --- | --- |
| `test/chat-media-upload-routes.test.js:66`: `assert.ok(reservations.get(input.id) >= input.sizeBytes * 2);` | T7/T8 isolamento / quota / DTO autorizado | Sim |
| `test/chat-media-upload-routes.test.js:120`: `assert.equal(response.statusCode, 202);` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:121`: `assert.equal(response.json().state, 'processing');` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:122`: `assert.match(response.json().mediaId, /^[a-f0-9-]{36}$/u);` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:124`: `assert.equal(saved.sizeBytes, 15);` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:125`: `assert.equal(saved.declaredMimeType, 'image/png');` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:126`: `assert.equal(saved.reservationBytes, 30);` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:127`: `assert.equal(saved.filenameEnvelope.algorithm, 'AES-256-GCM');` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:136`: `assert.deepEqual( JSON.parse( Buffer.concat([ decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final(), ]).toString('utf8'), ), { filename: 'private-canary.png' }, );` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:145`: `assert.equal( JSON.stringify(saved.filenameEnvelope).includes('private-canary'), false, );` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:149`: `assert.deepEqual(await readdir(h.root), [saved.id]);` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:150`: `assert.equal(response.body.includes('private-canary'), false);` | MED-01/20: accepted upload is private and leaves complete spool for one job | Sim |
| `test/chat-media-upload-routes.test.js:156`: `assert.equal(replay.statusCode, 202);` | MED-06: byte-identical replay preserves media ID and removes replay spool | Sim |
| `test/chat-media-upload-routes.test.js:157`: `assert.deepEqual(replay.json(), first.json());` | MED-06: byte-identical replay preserves media ID and removes replay spool | Sim |
| `test/chat-media-upload-routes.test.js:158`: `assert.equal(h.records.size, 1);` | MED-06: byte-identical replay preserves media ID and removes replay spool | Sim |
| `test/chat-media-upload-routes.test.js:159`: `assert.equal(h.reservations.size, 0);` | MED-06: byte-identical replay preserves media ID and removes replay spool | Sim |
| `test/chat-media-upload-routes.test.js:160`: `assert.equal((await readdir(h.root)).length, 1);` | MED-06: byte-identical replay preserves media ID and removes replay spool | Sim |
| `test/chat-media-upload-routes.test.js:166`: `assert.equal(response.statusCode, 409);` | MED-07: same command different bytes returns 409 and cleans failed spool | Sim |
| `test/chat-media-upload-routes.test.js:167`: `assert.equal(h.records.size, 1);` | MED-07: same command different bytes returns 409 and cleans failed spool | Sim |
| `test/chat-media-upload-routes.test.js:168`: `assert.equal(h.reservations.size, 0);` | MED-07: same command different bytes returns 409 and cleans failed spool | Sim |
| `test/chat-media-upload-routes.test.js:169`: `assert.equal((await readdir(h.root)).length, 1);` | MED-07: same command different bytes returns 409 and cleans failed spool | Sim |
| `test/chat-media-upload-routes.test.js:175`: `assert.equal(response.statusCode, statusCode);` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:176`: `assert.equal(response.json().accepted, false);` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:177`: `assert.equal(response.json().status, statusCode);` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:178`: `assert.equal( response.json().error.code, /** @type {Record<number,string>} */ ({ 403: 'FORBIDDEN', 409: 'MEDIA_CONFLICT', 429: 'MEDIA_RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE', })[statusCode], );` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:187`: `assert.equal( response.headers['content-type'], 'application/problem+json; charset=utf-8', );` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:191`: `assert.equal(h.records.size, 0);` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:192`: `assert.deepEqual(await readdir(h.root), []);` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:193`: `assert.equal(response.body.includes('private-canary'), false);` | MED-08/28: admission ${statusCode} writes no bytes | Sim |
| `test/chat-media-upload-routes.test.js:198`: `assert.equal(response.statusCode, 401);` | MED-16: absent session returns 401 before admission | Sim |
| `test/chat-media-upload-routes.test.js:199`: `assert.equal(h.records.size, 0);` | MED-16: absent session returns 401 before admission | Sim |
| `test/chat-media-upload-routes.test.js:200`: `assert.deepEqual(await readdir(h.root), []);` | MED-16: absent session returns 401 before admission | Sim |
| `test/chat-media-upload-routes.test.js:205`: `assert.equal(response.statusCode, 403);` | MED-08: CSRF mismatch returns 403 before bytes | Sim |
| `test/chat-media-upload-routes.test.js:206`: `assert.deepEqual(await readdir(h.root), []);` | MED-08: CSRF mismatch returns 403 before bytes | Sim |
| `test/chat-media-upload-routes.test.js:214`: `assert.equal(response.statusCode, 413);` | MED-04: image above 5 MiB returns 413 even with false Content-Length | Sim |
| `test/chat-media-upload-routes.test.js:215`: `assert.equal(h.records.size, 0);` | MED-04: image above 5 MiB returns 413 even with false Content-Length | Sim |
| `test/chat-media-upload-routes.test.js:216`: `assert.equal(h.reservations.size, 0);` | MED-04: image above 5 MiB returns 413 even with false Content-Length | Sim |
| `test/chat-media-upload-routes.test.js:217`: `assert.deepEqual(await readdir(h.root), []);` | MED-04: image above 5 MiB returns 413 even with false Content-Length | Sim |
| `test/chat-media-upload-routes.test.js:222`: `assert.equal(response.statusCode, 422);` | MED-04: truncated multipart never publishes job and confirms cleanup | Sim |
| `test/chat-media-upload-routes.test.js:223`: `assert.equal(h.records.size, 0);` | MED-04: truncated multipart never publishes job and confirms cleanup | Sim |
| `test/chat-media-upload-routes.test.js:224`: `assert.equal(h.reservations.size, 0);` | MED-04: truncated multipart never publishes job and confirms cleanup | Sim |
| `test/chat-media-upload-routes.test.js:225`: `assert.deepEqual(await readdir(h.root), []);` | MED-04: truncated multipart never publishes job and confirms cleanup | Sim |
| `test/chat-media-upload-routes.test.js:236`: `assert.equal(response.statusCode, 422);` | MED-04: invalid fields ${JSON.stringify(fields)} return 422 | Sim |
| `test/chat-media-upload-routes.test.js:237`: `assert.equal(h.records.size, 0);` | MED-04: invalid fields ${JSON.stringify(fields)} return 422 | Sim |
| `test/chat-media-upload-routes.test.js:238`: `assert.deepEqual(await readdir(h.root), []);` | MED-04: invalid fields ${JSON.stringify(fields)} return 422 | Sim |
| `test/chat-media-upload-routes.test.js:243`: `assert.equal(response.statusCode, 422);` | MED-29: zero bytes rejected before 202 without false metadata | Sim |
| `test/chat-media-upload-routes.test.js:244`: `assert.equal(h.records.size, 0);` | MED-29: zero bytes rejected before 202 without false metadata | Sim |
| `test/chat-media-upload-routes.test.js:245`: `assert.equal(h.reservations.size, 0);` | MED-29: zero bytes rejected before 202 without false metadata | Sim |
| `test/chat-media-upload-routes.test.js:246`: `assert.deepEqual(await readdir(h.root), []);` | MED-29: zero bytes rejected before 202 without false metadata | Sim |
| `test/chat-media-upload-routes.test.js:251`: `assert.equal(response.statusCode, 202);` | MED-29: complete invalid format is accepted for asynchronous inspection | Sim |
| `test/chat-media-upload-routes.test.js:252`: `assert.equal(response.json().state, 'processing');` | MED-29: complete invalid format is accepted for asynchronous inspection | Sim |
| `test/chat-media-upload-routes.test.js:253`: `assert.equal([...h.records.values()][0].sizeBytes, 6);` | MED-29: complete invalid format is accepted for asynchronous inspection | Sim |
| `test/chat-media-upload-routes.test.js:263`: `assert.equal(response.statusCode, 202);` | MED-14/28: recording reserves input plus 32 MiB after worst case admission | Sim |
| `test/chat-media-upload-routes.test.js:264`: `assert.equal( [...h.records.values()][0].reservationBytes, 15 + 32 * 1024 * 1024, );` | MED-14/28: recording reserves input plus 32 MiB after worst case admission | Sim |
| `test/chat-media-upload-routes.test.js:274`: `assert.equal(response.statusCode, 413);` | MED-04: audio above 16 MiB is interrupted before publishing media | Sim |
| `test/chat-media-upload-routes.test.js:275`: `assert.equal(h.records.size, 0);` | MED-04: audio above 16 MiB is interrupted before publishing media | Sim |
| `test/chat-media-upload-routes.test.js:276`: `assert.equal(h.reservations.size, 0);` | MED-04: audio above 16 MiB is interrupted before publishing media | Sim |
| `test/chat-media-upload-routes.test.js:277`: `assert.deepEqual(await readdir(h.root), []);` | MED-04: audio above 16 MiB is interrupted before publishing media | Sim |
| `test/chat-media-upload-routes.test.js:286`: `assert.equal(response.statusCode, 503);` | MED-28: failed spool removal retains charged admission and responds503 | Sim |
| `test/chat-media-upload-routes.test.js:287`: `assert.equal(h.records.size, 0);` | MED-28: failed spool removal retains charged admission and responds503 | Sim |
| `test/chat-media-upload-routes.test.js:288`: `assert.equal(h.reservations.size, 1);` | MED-28: failed spool removal retains charged admission and responds503 | Sim |
| `test/chat-media-upload-routes.test.js:289`: `assert.equal((await readdir(h.root)).length, 1);` | MED-28: failed spool removal retains charged admission and responds503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:44`: `assert.equal(new URL(connectionString).pathname, '/crm_silmer_test');` | T7/T8 isolamento / quota / DTO autorizado | Sim |
| `test/chat-media-upload-postgres-live.test.js:110`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: String(row.reservationBytes), });` | MED-28: durable admission reserves worst case before any media/job exists | Sim |
| `test/chat-media-upload-postgres-live.test.js:115`: `assert.equal( (await pool.query('SELECT state FROM crm.chat_media_admissions')).rows[0] .state, 'receiving', );` | MED-28: durable admission reserves worst case before any media/job exists | Sim |
| `test/chat-media-upload-postgres-live.test.js:120`: `assert.equal( ( await pool.query( 'SELECT automation_state,automation_epoch,version FROM crm.conversations', ) ).rows[0].automation_state, 'assistant', );` | MED-28: durable admission reserves worst case before any media/job exists | Sim |
| `test/chat-media-upload-postgres-live.test.js:133`: `assert.deepEqual(result, { mediaId: row.id, duplicate: false });` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:134`: `assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '200' });` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:136`: `assert.equal(media.input_size_bytes, '100');` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:137`: `assert.equal(media.declared_mime_type, 'image/png');` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:138`: `assert.equal(media.spool_key, row.id);` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:139`: `assert.equal(media.state, 'uploaded');` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:140`: `assert.deepEqual( ( await pool.query( 'SELECT state,reservation_bytes,media_id FROM crm.chat_media_admissions', ) ).rows, [{ state: 'consumed', reservation_bytes: '0', media_id: row.id }], );` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:148`: `assert.deepEqual( ( await pool.query( 'SELECT queue,job_type,effect_policy,chat_media_id FROM crm.outbox_jobs', ) ).rows, [ { queue: 'chat_media', job_type: 'chat_media.process', effect_policy: 'internal', chat_media_id: row.id, }, ], );` | MED-06/28: atomic completion moves reservation once and queues a complete upload | Sim |
| `test/chat-media-upload-postgres-live.test.js:172`: `assert.deepEqual(replay, { replay: { id: row.id, request_fingerprint: 'c'.repeat(64) }, });` | MED-06: accepted replay requires no reservation even when quota is full | Sim |
| `test/chat-media-upload-postgres-live.test.js:175`: `assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '200' });` | MED-06: accepted replay requires no reservation even when quota is full | Sim |
| `test/chat-media-upload-postgres-live.test.js:183`: `assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);` | MED-06: concurrent same scope has one durable admission and active replay 409 | Sim |
| `test/chat-media-upload-postgres-live.test.js:184`: `assert.equal( /** @type {any} */ (results.find((r) => r.status === 'rejected')).reason .statusCode, 409, );` | MED-06: concurrent same scope has one durable admission and active replay 409 | Sim |
| `test/chat-media-upload-postgres-live.test.js:189`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: String(row.reservationBytes), });` | MED-06: concurrent same scope has one durable admission and active replay 409 | Sim |
| `test/chat-media-upload-postgres-live.test.js:201`: `assert.equal(replay.replay.id, row.id);` | MED-28: accepted replays and divergent hashes share 12/min throttle without extra quota | Sim |
| `test/chat-media-upload-postgres-live.test.js:203`: `await assert.rejects(repository.admit({ ...row, id: randomUUID() }), { statusCode: 429, });` | MED-28: accepted replays and divergent hashes share 12/min throttle without extra quota | Sim |
| `test/chat-media-upload-postgres-live.test.js:206`: `assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '200' });` | MED-28: accepted replays and divergent hashes share 12/min throttle without extra quota | Sim |
| `test/chat-media-upload-postgres-live.test.js:214`: `await assert.rejects(repository.admit(input()), { statusCode: 429 });` | MED-28: quota includes used plus reserved and rejects excess atomically | Sim |
| `test/chat-media-upload-postgres-live.test.js:215`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: String(row.reservationBytes), });` | MED-28: quota includes used plus reserved and rejects excess atomically | Sim |
| `test/chat-media-upload-postgres-live.test.js:235`: `await assert.rejects(repository.complete(completed(row)), { statusCode: mutate.startsWith('assigned') ? 403 : 409, });` | MED-08: transfer or close during streaming prevents completion and preserves charged orphan | Sim |
| `test/chat-media-upload-postgres-live.test.js:238`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: String(row.reservationBytes), });` | MED-08: transfer or close during streaming prevents completion and preserves charged orphan | Sim |
| `test/chat-media-upload-postgres-live.test.js:244`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });` | MED-08: transfer or close during streaming prevents completion and preserves charged orphan | Sim |
| `test/chat-media-upload-postgres-live.test.js:253`: `await assert.rejects(repository.admit(input()), { statusCode: 429 });` | MED-28: one session allows 12 admissions per minute even after confirmed cleanup | Sim |
| `test/chat-media-upload-postgres-live.test.js:254`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });` | MED-28: one session allows 12 admissions per minute even after confirmed cleanup | Sim |
| `test/chat-media-upload-postgres-live.test.js:304`: `assert.equal(response.statusCode, n < 12 ? 422 : 429);` | MED-28: cookie order and unrelated cookies cannot bypass the 12/min session limit | Sim |
| `test/chat-media-upload-postgres-live.test.js:306`: `assert.equal( ( await pool.query( 'SELECT count(DISTINCT session_hash)::int AS count FROM crm.chat_media_admissions', ) ).rows[0].count, 1, );` | MED-28: cookie order and unrelated cookies cannot bypass the 12/min session limit | Sim |
| `test/chat-media-upload-postgres-live.test.js:314`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });` | MED-28: cookie order and unrelated cookies cannot bypass the 12/min session limit | Sim |
| `test/chat-media-upload-postgres-live.test.js:326`: `await assert.rejects( repository.complete(completed(row)), /synthetic job write failure/u, );` | MED-05/28: job insertion rollback leaves admission charged and no media published | Sim |
| `test/chat-media-upload-postgres-live.test.js:330`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: String(row.reservationBytes), });` | MED-05/28: job insertion rollback leaves admission charged and no media published | Sim |
| `test/chat-media-upload-postgres-live.test.js:335`: `assert.equal( (await pool.query('SELECT state FROM crm.chat_media_admissions')) .rows[0].state, 'receiving', );` | MED-05/28: job insertion rollback leaves admission charged and no media published | Sim |
| `test/chat-media-upload-postgres-live.test.js:404`: `assert.equal((await api.inject(request)).statusCode, 503);` | MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable}) | Sim |
| `test/chat-media-upload-postgres-live.test.js:406`: `assert.equal( await ( await import('node:fs/promises') ).readFile(join(root, media.spool_key), 'utf8'), 'synthetic-bytes', );` | MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable}) | Sim |
| `test/chat-media-upload-postgres-live.test.js:412`: `assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '30' });` | MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable}) | Sim |
| `test/chat-media-upload-postgres-live.test.js:413`: `assert.equal( (await pool.query('SELECT state FROM crm.chat_media_admissions')) .rows[0].state, 'consumed', );` | MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable}) | Sim |
| `test/chat-media-upload-postgres-live.test.js:419`: `assert.equal(replay.statusCode, 202);` | MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable}) | Sim |
| `test/chat-media-upload-postgres-live.test.js:420`: `assert.equal(replay.json().mediaId, media.id);` | MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable}) | Sim |
| `test/chat-media-upload-postgres-live.test.js:421`: `assert.deepEqual(await counts(), { media: 1, jobs: 1, reserved: '30' });` | MED-19/28: commit response lost preserves accepted spool (reconciliation unavailable=${unavailable}) | Sim |
| `test/chat-media-upload-postgres-live.test.js:430`: `assert.deepEqual(await repository.listAbandonedAdmissions(), [ { id: orphan.id, bucket_alias: 'chat-dev', reservation_bytes: String(orphan.reservationBytes), }, ]);` | MED-27 support: orphan discovery preserves reservation until confirmed cleanup, consumed excluded | Sim |
| `test/chat-media-upload-postgres-live.test.js:439`: `assert.deepEqual(await repository.listAbandonedAdmissions(), []);` | MED-27 support: orphan discovery preserves reservation until confirmed cleanup, consumed excluded | Sim |
| `test/chat-media-upload-postgres-live.test.js:440`: `assert.deepEqual(await counts(), { media: 0, jobs: 0, reserved: '0' });` | MED-27 support: orphan discovery preserves reservation until confirmed cleanup, consumed excluded | Sim |
| `test/chat-media-upload-postgres-live.test.js:508`: `assert.equal((await get()).statusCode, 200);` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:513`: `assert.equal( (await get('crm_session=other-synthetic-session')).statusCode, 403, );` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:520`: `assert.equal( (await get('crm_session=other-synthetic-session')).statusCode, 403, );` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:527`: `assert.equal( (await get('crm_session=other-synthetic-session')).statusCode, 200, );` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:542`: `assert.equal( (await get('crm_session=other-synthetic-session')).statusCode, 200, );` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:546`: `assert.equal((await get('crm_session=bogus')).statusCode, 401);` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:547`: `assert.equal( (await get(undefined, 'https://denied.example.test')).statusCode, 403, );` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:555`: `assert.equal((await get()).statusCode, 401);` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:560`: `assert.equal((await get()).statusCode, 401);` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:584`: `assert.equal((await post('bogus')).statusCode, 401);` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:585`: `assert.equal((await post(undefined, 'wrong')).statusCode, 403);` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:586`: `assert.equal((await post()).statusCode, 202);` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:613`: `assert.equal( ( await failedApi.inject({ method: 'GET', url: \`/api/v1/conversations/upload-conversation/media/${row.id}\`, headers: { cookie: 'crm_session=valid-synthetic-session', origin: 'https://crm.example.test', }, }) ).statusCode, 503, );` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-upload-postgres-live.test.js:626`: `assert.equal( ( await failedApi.inject({ method: 'POST', url: '/api/v1/conversations/upload-conversation/media', payload, headers: { 'content-type': 'multipart/form-data; boundary=b', 'idempotency-key': 'failed-production-auth-upload', cookie: 'crm_session=valid-synthetic-session; crm_csrf=valid-synthetic-csrf', origin: 'https://crm.example.test', 'x-csrf-token': 'valid-synthetic-csrf', }, }) ).statusCode, 503, );` | T8 MED-16: production identity/read/write composition distinguishes401/403/200/503 | Sim |
| `test/chat-media-status-routes.test.js:16`: `assert.equal(input.action, 'conversation.read');` | T7/T8 isolamento / quota / DTO autorizado | Sim |
| `test/chat-media-status-routes.test.js:27`: `assert.equal(input.conversationId, 'conversation');` | T7/T8 isolamento / quota / DTO autorizado | Sim |
| `test/chat-media-status-routes.test.js:28`: `assert.equal(input.mediaId, id);` | T7/T8 isolamento / quota / DTO autorizado | Sim |
| `test/chat-media-status-routes.test.js:66`: `assert.equal(response.statusCode, 200);` | MED-08/19: authorized status ${state} has safe metadata | Sim |
| `test/chat-media-status-routes.test.js:67`: `assert.equal(response.json().state, state);` | MED-08/19: authorized status ${state} has safe metadata | Sim |
| `test/chat-media-status-routes.test.js:68`: `assert.equal(response.json().mediaId, id);` | MED-08/19: authorized status ${state} has safe metadata | Sim |
| `test/chat-media-status-routes.test.js:69`: `assert.equal(response.body.includes('object_key'), false);` | MED-08/19: authorized status ${state} has safe metadata | Sim |
| `test/chat-media-status-routes.test.js:70`: `assert.equal(response.body.includes('private-canary'), false);` | MED-08/19: authorized status ${state} has safe metadata | Sim |
| `test/chat-media-status-routes.test.js:71`: `assert.equal(response.headers['cache-control'], 'private, no-store');` | MED-08/19: authorized status ${state} has safe metadata | Sim |
| `test/chat-media-status-routes.test.js:79`: `assert.equal(response.statusCode, 200);` | MED-29: invalid_format is HTTP200 rejected status | Sim |
| `test/chat-media-status-routes.test.js:80`: `assert.equal(response.json().state, 'rejected');` | MED-29: invalid_format is HTTP200 rejected status | Sim |
| `test/chat-media-status-routes.test.js:81`: `assert.equal(response.json().reason, 'invalid_format');` | MED-29: invalid_format is HTTP200 rejected status | Sim |
| `test/chat-media-status-routes.test.js:86`: `assert.equal(response.statusCode, status);` | MED-16: status auth failure ${status} exposes no metadata | Sim |
| `test/chat-media-status-routes.test.js:87`: `assert.equal(response.body.includes('image/png'), false);` | MED-16: status auth failure ${status} exposes no metadata | Sim |
| `test/chat-media-status-routes.test.js:91`: `assert.equal((await get({ cookie: '' })).statusCode, 401);` | MED-16: status requires session and refuses technical authorization | Sim |
| `test/chat-media-status-routes.test.js:92`: `assert.equal( (await get({ authorization: 'Basic synthetic' })).statusCode, 403, );` | MED-16: status requires session and refuses technical authorization | Sim |
| `test/chat-media-status-routes.test.js:99`: `assert.equal(response.statusCode, 403);` | MED-08: draft of other actor is forbidden | Sim |
| `test/chat-media-status-routes.test.js:100`: `assert.equal(response.body.includes('private-canary'), false);` | MED-08: draft of other actor is forbidden | Sim |
| `test/chat-media-status-runtime.test.js:31`: `assert.ok(sql.includes('conversation_id=$2'));` | T7/T8 isolamento / quota / DTO autorizado | Sim |
| `test/chat-media-status-runtime.test.js:32`: `assert.deepEqual(values, [id, 'conversation']);` | T7/T8 isolamento / quota / DTO autorizado | Sim |
| `test/chat-media-status-runtime.test.js:48`: `assert.deepEqual(await harness()(), { mediaId: id, kind: 'image', origin: 'attachment', state: 'ready', validationStatus: 'clean', mimeType: 'image/png', sizeBytes: 100, durationMs: null, });` | MED-08/20: author sees draft DTO with only safe metadata | Sim |
| `test/chat-media-status-runtime.test.js:61`: `await assert.rejects(get({ id: 'other', capabilities: [] }), { statusCode: 403, });` | MED-08: administrator can inspect draft but another seller cannot | Sim |
| `test/chat-media-status-runtime.test.js:64`: `assert.equal( (await get({ id: 'admin', capabilities: ['COMMERCIAL_ADMIN'] })).mediaId, id, );` | MED-08: administrator can inspect draft but another seller cannot | Sim |
| `test/chat-media-status-runtime.test.js:76`: `assert.equal(dto.state, state);` | MED-16: attached and lost attached use authorized conversation read ACL | Sim |
| `test/chat-media-status-runtime.test.js:77`: `assert.equal(dto.mediaId, id);` | MED-16: attached and lost attached use authorized conversation read ACL | Sim |
| `test/chat-media-status-runtime.test.js:78`: `assert.equal(JSON.stringify(dto).includes('secret-key'), false);` | MED-16: attached and lost attached use authorized conversation read ACL | Sim |
| `test/chat-media-status-runtime.test.js:89`: `assert.equal(dto.state, 'rejected');` | MED-29: rejected real format remains 200 DTO state/reason, no key or name | Sim |
| `test/chat-media-status-runtime.test.js:90`: `assert.equal(dto.reason, 'invalid_format');` | MED-29: rejected real format remains 200 DTO state/reason, no key or name | Sim |
| `test/chat-media-status-runtime.test.js:91`: `assert.equal(dto.sizeBytes, null);` | MED-29: rejected real format remains 200 DTO state/reason, no key or name | Sim |
| `test/chat-media-status-runtime.test.js:92`: `assert.equal(JSON.stringify(dto).includes('secret-filename'), false);` | MED-29: rejected real format remains 200 DTO state/reason, no key or name | Sim |
| `test/chat-media-status-runtime.test.js:95`: `assert.throws( () => requireMediaSpoolRoot({ CHAT_MEDIA_SPOOL_ROOT: 'var/private/../private', PRIVATE_MEDIA_ROOT: 'var/private', }), /distinct CHAT_MEDIA_SPOOL_ROOT/u, );` | MED-20 support: configured spool cannot resolve to the legacy media root | Sim |
| `test/chat-media-status-runtime.test.js:104`: `assert.throws( () => requireMediaSpoolRoot({ CHAT_MEDIA_SPOOL_ROOT: 'VAR\\PRIVATE', PRIVATE_MEDIA_ROOT: 'var/private', }), /distinct CHAT_MEDIA_SPOOL_ROOT/u, );` | MED-20 support: configured spool cannot resolve to the legacy media root | Sim |
| `test/chat-media-status-runtime.test.js:112`: `assert.ok( requireMediaSpoolRoot({ CHAT_MEDIA_SPOOL_ROOT: 'var/chat-spool', PRIVATE_MEDIA_ROOT: 'var/private', }).endsWith('chat-spool'), );` | MED-20 support: configured spool cannot resolve to the legacy media root | Sim |
| `test/chat-media-status-runtime.test.js:134`: `await assert.rejects( identity.authorizeOperationalRead({ action: 'conversation.read', sessionToken: 'invalid', authenticationFailureStatus: 401, }), { statusCode: 401, code: 'INVALID_CREDENTIALS' }, );` | MED-16: opted-in read distinguishes invalid session401, capability403 and DB failure | Sim |
| `test/chat-media-status-runtime.test.js:142`: `await assert.rejects( identity.authorizeOperationalRead({ action: 'conversation.read', sessionToken: 'invalid', }), { statusCode: 403 }, );` | MED-16: opted-in read distinguishes invalid session401, capability403 and DB failure | Sim |
| `test/chat-media-status-runtime.test.js:149`: `await assert.rejects( identity.authorizeOperationalRead({ action: 'forbidden.action', sessionToken: 'invalid', authenticationFailureStatus: 401, }), { statusCode: 403 }, );` | MED-16: opted-in read distinguishes invalid session401, capability403 and DB failure | Sim |
| `test/chat-media-status-runtime.test.js:170`: `await assert.rejects( unavailable.authorizeOperationalRead({ action: 'conversation.read', sessionToken: 'invalid', authenticationFailureStatus: 401, }), (error) => error === failure, );` | MED-16: opted-in read distinguishes invalid session401, capability403 and DB failure | Sim |

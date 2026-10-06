# Execução INBOX-MEDIA-1

## T1: Compatibilidade RustFS

Status: concluída. Harness e smoke real passaram na alpha.99 local isolada.
Ativação remota continua pendente em T23. T2 ainda não iniciou.

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

| Critério T1 / requisito                         | Evidência exata                                                                                                                                                                                                                                                       | Resultado esperado                                       | Coberto                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| PUT/HEAD/GET/Range/DELETE e negativas           | `test/rustfs-live-smoke.test.js:113`: `assert.deepEqual(result.checks, { put: true, headHashAndSize: true, getHashAndSize: true, range: true, invalidRange: true, anonymousDenied: true, crossBucketDenied: true, noExpiryLifecycle: true, deleteAndMissing: true })` | Cada check real precisa passar antes de emitir evidência | Sim; smoke real comprovado acima     |
| Digest real e dados sintéticos                  | `test/rustfs-live-smoke.test.js:125`: `assert.equal(result.runningImageDigest, env.RUSTFS_RUNNING_IMAGE_DIGEST)`; linha 126: `assert.equal(result.syntheticOnly, true)`                                                                                               | Preservar digest fornecido, sem alegar versão do alvo    | Sim; docker inspect comprovado acima |
| Isolamento Hermes                               | `test/rustfs-live-smoke.test.js:141`: `assert.throws(() => validateRustfsSmokeEnvironment({ ...env, MEDIA_S3_BUCKET: 'hermes-backups' }), /CRM bucket/u)`                                                                                                             | Recusar bucket alheio antes da rede                      | Sim                                  |
| Sem segredo/chave no relatório (MED-20 suporte) | `test/rustfs-live-smoke.test.js:128`: `assert.equal(serialized.includes(env.MEDIA_S3_SECRET_ACCESS_KEY), false)`; linha 129: `assert.equal(serialized.includes(env.MEDIA_S3_ACCESS_KEY_ID), false)`                                                                   | Segredo e access key ausentes                            | Sim                                  |
| Acesso privado (MED-16 suporte)                 | `test/rustfs-live-smoke.test.js:188`: `await assert.rejects(h.run(), /anonymous access/u)`; linha 220: `await assert.rejects(h.run(), /cross-bucket access/u)`                                                                                                        | 200 anônimo/cross-bucket impede PASS                     | Sim                                  |
| Bytes/Range reais (MED-23 suporte)              | `test/rustfs-live-smoke.test.js:228`: `await assert.rejects(h.run(), /Range\|GET/u)`                                                                                                                                                                                  | Bytes alterados ou 200 ignorando Range impedem PASS      | Sim                                  |
| Falha externa e cleanup (MED-19 suporte)        | `test/rustfs-live-smoke.test.js:236`: `await assert.rejects(h.run(), (error) => error instanceof Error && error.message === 'RustFS smoke failed at PUT; no live PASS recorded')`                                                                                     | Falha de PUT sanitizada, sem PASS                        | Sim                                  |
| Preservação sem expiração                       | `test/rustfs-live-smoke.test.js:248`: `await assert.rejects(h.run(), /lifecycle/u)`                                                                                                                                                                                   | Lifecycle com expiração impede PUT e PASS                | Sim                                  |

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
| HTTP apenas em homologação loopback | `test/rustfs-live-smoke.test.js:199`: `assert.equal(validateRustfsSmokeEnvironment(local).localLoopback, true)`; linha 200: `assert.throws(() => validateRustfsSmokeEnvironment({ ...local, MEDIA_S3_ENDPOINT: 'http://192.0.2.1:21900' }), /HTTPS/u)`; linha 208: `assert.throws(() => validateRustfsSmokeEnvironment({ ...local, MEDIA_S3_ENDPOINT: 'https://s3.example.test' }), /CRM bucket/u)` | DEV isolado permitido; endpoint externo inseguro/bucket canário local externo rejeitados. T1 isolamento + autorização Docker local | Sim    |

Verdict: critérios de T1 cobertos no harness e por smoke real, com digest
observado. Sem assertions rasas, testes desnecessários ou alterações de
testes existentes. Nenhum segredo ou dado real utilizado. T1 concluída;
T23 continua responsável por ativação e recovery no deployment remoto.

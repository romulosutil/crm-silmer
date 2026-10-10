# Validação T31: políticas e upload no edge

**Veredito: PASS no escopo T31 de configuração, testes, revisão e Nginx real
em CI.** Este relatório não comprova
deploy, ativação de API/worker/RustFS, gravação física nem entrega em produção.

- Data: 10/10/2026.
- Verifier: `/root/production_edge_verifier`, independente do autor.
- Baseline: `cd4946a196576134b12d74895d5eb08a351acb35` (`origin/master`).
- Head testado em CI: `655540c906243cc6926d252387073819f799a92d`.
- Escopo: `docker/nginx.conf`, `test/edge-media-policy.test.js`,
  `scripts/check-edge-media-proxy.mjs`, `scripts/edge-media-image-pull.mjs`,
  `test/edge-media-image-pull.test.js`, `.github/workflows/ci.yml`, T31.
- Especificação: `.specs/features/inbox-media-rustfs/spec.md:71`, `:72`,
  `:73`, `:90`; critério operacional em `tasks.md:503`.

## Evidência por resultado

| Resultado esperado | Fonte e asserção independente | Resultado |
| --- | --- | --- |
| Permitir prévias locais de imagem, áudio e vídeo | `docker/nginx.conf:32`; `test/edge-media-policy.test.js:19` e `:20`, `assert.deepEqual(img-src, [self,data:,blob:])` e `assert.deepEqual(media-src,[self,blob:])` | PASS configuração |
| Permitir pedido de microfone na própria origem, preservar câmera/geolocalização bloqueadas | `docker/nginx.conf:33`; `test/edge-media-policy.test.js:37`, lista exata `camera=(), geolocation=(), microphone=(self)` | PASS configuração |
| Manter scripts/conexões na própria origem | `test/edge-media-policy.test.js:21` a `:26`, defaults/connect/scripts self, objects none e ancestors none | PASS |
| Reservar 17 MiB somente à coleção de upload do chat, cobrindo arquivo de 16 MiB e envelope | `docker/nginx.conf:78`; `test/edge-media-policy.test.js:52` e `:60`, seletor ancorado e `assert.match(client_max_body_size 17m)`; `:61` valida request buffering off; `scripts/check-edge-media-proxy.mjs:142` exige status e `:145` exige bytes integrais | PASS configuração e transporte CI |
| Preservar limite separado de arte e default nas demais APIs | `docker/nginx.conf:63` e `:94`; `test/edge-media-policy.test.js:68`, arte 11m, `:70` a `:74`, ausência de override em server/http; `scripts/check-edge-media-proxy.mjs:142` exige 413 exato para excessos e `:145` prova corpo permitido | PASS configuração e transporte CI |
| Preservar políticas de impressão e imagem imutável | `test/print-csp.test.js` e `test/ci-images.test.js` executados junto ao focal | PASS |

O teste de microfone foi inicialmente nomeado MED-14. O autor corrigiu o nome
para MED-09, alinhando a referência ao requisito de captura; as asserções
permaneceram intactas. MED-25 não recebe nova lógica de interface nesta fatia.
Não se infere homologação de teclado ou hardware a partir de headers.

## Revisão do gate real em CI

`scripts/check-edge-media-proxy.mjs:27` a `:35` extrai exclusivamente as bases
oficiais Node/Nginx dos Dockerfiles e exige digest SHA-256 completo. O mirror
preserva a referência ao digest. Não escolhe tags flutuantes ou imagens passadas
por dados de usuário.

Isolamento: `scripts/check-edge-media-proxy.mjs:40` usa UUID por execução;
`:51` cria rede dedicada; `:62` e `:78` usam usuários node/nginx; `:81` publica
somente porta efêmera de loopback; `:83` monta apenas nginx.conf read-only.
O upstream é contador sintético sem banco, segredo, cliente ou canal externo.
O fetch envia buffers de bytes constantes às rotas sintéticas. `:153` a `:171`
remove somente IDs dos containers/rede criados pela própria execução, em finally;
nenhum prune, stop global ou volume compartilhado é usado. Falha de cleanup
não é silenciada.

Asserções do transporte: `scripts/check-edge-media-proxy.mjs:109` a `:117`
validam status/headers reais. `:142` exige status exato de cada caso; `:145`
e `:146` comprovam contagem integral e path preservado no proxy. Oito casos
cobrem upload permitido, query string, excesso do orçamento, subrota, trailing
slash, mensagens comuns e limites separados da arte. Nenhuma dessas respostas
foi presumida pela revisão estática.

`.github/workflows/ci.yml:104` e `:105` executam esse gate depois de validate,
sem continue-on-error. Sua falha impede o sucesso do job Quality. Não há
bloqueio encontrado no patch. O run CI abaixo comprovou disponibilidade das
bases e execução real do gate.

### Correção de disponibilidade dos mirrors

O run CI `38072637559` falhou no pull ECR por rate limit, antes de executar o
transporte. O helper incremental `scripts/edge-media-image-pull.mjs:10` exige
Node/Nginx oficiais com digest completo. `:11` a `:15` tenta ECR, GCR e Docker
Hub mantendo exatamente a mesma referência; `:20` só retorna após pull
bem-sucedido; `:25` lança AggregateError se as três fontes falham. Esse fallback
não converte indisponibilidade em PASS nem substitui digest por tag.

`test/edge-media-image-pull.test.js:17` compara resultado GCR e `:18` compara
as referências tentadas; `:32` compara Docker Hub e `:33` compara a sequência
completa; `:41` e `:46` exigem AggregateError com três erros e `:48` rejeita tag sem
digest. Os três casos passaram. Não há bloqueio adicional encontrado. O
transporte real passou no run CI `38073260116`, conforme evidência abaixo.

## Gates executados

`rtk proxy var/tooling/node-v24.20.0-win-x64/node.exe --test test/edge-media-image-pull.test.js test/edge-media-policy.test.js test/print-csp.test.js test/ci-images.test.js`

Resultado incremental: **16 testes, 16 pass, 0 fail, 0 skip**. O focal isolado também passou
3/3. O Build amplo pertence ao gate integrado do Tech Lead; seu resultado não
foi presumido pelo Verifier. A evidência remota foi conferida após sua execução.

### Gate remoto efetivamente executado

[CI 38073260116, job Quality 114274864563](https://github.com/romulosutil/crm-silmer/actions/runs/38073260116/job/114274864563),
head `655540c906243cc6926d252387073819f799a92d`. Consulta independente via
`gh run view --json conclusion,headSha,url,jobs` confirmou run success, job
Quality success e step `Verify real edge media policies and upload limits`
success. Log local ignorado `var/T31-ci-runtime.log:3453` a `:3461` contém os
oito resultados e `PASS: 8/8 routes/limits, actual response headers, nginx syntax`.

| Rota/corpo sintético | Resultado real |
| --- | --- |
| Chat media, 16 MiB + 1024 bytes | 200, 16.778.240 bytes íntegros |
| Chat media com query string, mesmo corpo | 200, path e corpo preservados |
| Chat media, 17 MiB + 1 byte | 413 |
| Subrota media/status, 1 MiB + 1 byte | 413 |
| Media com trailing slash, 1 MiB + 1 byte | 413 |
| Messages comum, 1 MiB + 1 byte | 413 |
| Arte, 10 MiB + 1024 bytes | 200, 10.486.784 bytes íntegros |
| Arte, 11 MiB + 1 byte | 413 |

O mesmo job passou validate/build, PostgreSQL, E2E/acessibilidade, audit e diff
limpo. `var/T31-ci-runtime.log:3419` a `:3425`: **1013 unit total, 1010 pass,
0 fail, 3 skips existentes**. `:3582` a `:3585`: **217 E2E total, 210 pass,
7 skips existentes**. Audit registra zero vulnerabilidades em `:3590`.
Build e scan das duas imagens também concluíram success no mesmo run; os passos
de publicação estão skipped por ser PR. Não houve deploy comprovado.

## Sensor de discriminação

Cópias de configuração/teste em diretório temporário exclusivo, com baseline
`git status --porcelain` capturado antes e comparado depois. Nenhuma mutação
foi aplicada ao código real, nenhum stash foi usado.

| Mutação comportamental | Teste que detectou | Resultado |
| --- | --- | --- |
| `microphone=(self)` → `microphone=()` | política exata, `test/edge-media-policy.test.js:37` | KILLED |
| Remover blob de img-src e media-src | fontes exatas, `test/edge-media-policy.test.js:19` e `:20` | KILLED |
| Reduzir upload do chat 17m → 1m | orçamento da rota, `test/edge-media-policy.test.js:60` | KILLED |
| Retirar digest da referência GCR | comparação de referência completa, `test/edge-media-image-pull.test.js:17` | KILLED |
| Retornar imagem mesmo com os três pulls falhos | AggregateError obrigatório, `test/edge-media-image-pull.test.js:41` | KILLED |

**5/5 mutações mortas**, zero sobreviventes; scratch removido; porcelain real
preservado em ambos os sensores. Scripts de evidência locais ignorados:
`var/t31-edge-verifier-sensor.mjs` e `var/t31-image-verifier-sensor.mjs`.

## Transporte real e produção

Tentativas de `docker images` e `docker info` falharam com pipe
`dockerDesktopLinuxEngine` ausente. Nenhum container ou volume existente foi
alterado. O smoke versionado `scripts/check-edge-media-proxy.mjs` passou na CI:
nginx -t, headers reais e os oito cenários de transporte detalhados acima.

O gate técnico de T31 passou para o head citado. Amend documental posterior
deve obter seus próprios checks antes de promoção. A promoção ao
EasyPanel, digest em produção, API/worker habilitados, microfone físico e envio
fim a fim com dados sintéticos permanecem verificações separadas. O PASS local
de políticas não equivale a funcionalidade operacional em produção.

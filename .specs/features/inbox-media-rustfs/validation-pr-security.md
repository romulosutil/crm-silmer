# Verificação independente da segurança dos scripts locais — T30

**Data:** 10/10/2026.

**Verificador:** agente independente `pr156_security_verifier`, sem autoria do patch.

**Superfície:** alterações de T30 sobre `577ac169eebe81295aa84bb00f07afa855b81cec`, nos três scripts de smoke, helper e testes de segurança.

**Requisitos:** MED-20, MED-23; limite de taxa como proteção do harness sintético, sem afirmar cobertura adicional da quota de domínio MED-28.

**Veredito:** **PASS para a revisão independente local e o sensor**. **CI remoto pendente**; o merge depende de todos os checks do PR aprovados no HEAD correspondente.

## Resultados ancorados no contrato

| Critério | Evidência e resultado esperado | Resultado |
| --- | --- | --- |
| Não persistir conteúdo arbitrário da resposta como prova, MED-20 | `test/media-smoke-security.test.js:36` compara a prova inteira com campos escalares explícitos; linha 45 exige ausência de `privateName`. `scripts/media-built-local-smoke.mjs:446` grava hashes e provas selecionadas, sem DTO arbitrário nem arquivo de áudio recebido. | PASS |
| Validar os bytes reais antes de registrar sucesso DEV, MED-23 | `test/media-smoke-security.test.js:61` exige rejeição de hash, tamanho, MIME, duração, codec, contêiner e estado divergentes; linhas 73 e 84 rejeitam bytes incompatíveis com OGG e MIME HTTP incorreto, mesmo com hash calculado sobre os bytes recebidos. `scripts/media-smoke-security.mjs:29` compara SHA-256; linhas 38–47 verificam OGG/Opus e duração positiva até 300000 ms. | PASS |
| Bloquear rajada antes de efeitos no banco do harness | `test/media-smoke-security.test.js:106` exige 429 na requisição 121; linha 107 exige exatamente 120 chamadas ao hook de efeito; linha 108 exige `retry-after: 60`. `scripts/n8n-media-local-smoke.mjs:148` instala o hook explícito antes dos hooks de autorização/banco. | PASS |
| Recusar identidade diferente do workflow local | `scripts/media-built-local-fault-smoke.mjs:32` fixa o ID do workflow dedicado; linha 33 exige `assert.equal(source.id, workflowId)` antes do uso; linha 175 envia a constante aprovada. Revisão estrutural, sem executar esse smoke com efeitos no runtime. | PASS estrutural |
| Não enfraquecer controles da aplicação ou os gates | Diff limitado a scripts de desenvolvimento, helper, testes e rastreabilidade. Nenhuma alteração de scanner, API de produção, autorização de mídia, regra CodeQL ou configuração de CI nesta fatia. | PASS |

A mudança remove a gravação do áudio de rede usado como artefato temporário; mantém as verificações de integridade e acrescenta inspeção do conteúdo em memória. Os testes existentes de duração, estado e codec do smoke foram preservados. A seleção escalar impede que campos extras da resposta sejam copiados para a prova.

## Alert 18: `js/file-access-to-http`

**Classificação independente: falso positivo de exfiltração neste fluxo específico.** O caminho de dados existe e é intencional: as credenciais do perfil local, geradas pelo próprio script e persistidas para reutilizar volumes, são transmitidas ao serviço RustFS local para provisionar seus usuários API e worker. Não se trata de ler um arquivo arbitrário e enviá-lo para um destino externo.

Evidências verificadas na origem:

- `scripts/dev-media.mjs:35`: leitura somente do arquivo de estado `secrets.json` desse perfil.
- `scripts/dev-media.mjs:54`: primeira criação com `randomBytes(32)` para as chaves locais; a leitura posterior preserva a identidade do armazenamento persistente.
- `scripts/dev-media.mjs:123`: destino constante `http://127.0.0.1:21920`, sem parâmetro de host remoto.
- `scripts/dev-media.mjs:175`: `redirect: 'error'`, impedindo encaminhamento da requisição por redirecionamento HTTP.
- `scripts/dev-media.mjs:203`: operação fixa `/rustfs/admin/v3/add-user`, cujo corpo contém a chave necessária ao provisionamento dos dois papéis locais. A requisição é assinada com SigV4 pelo código imediatamente anterior.
- `scripts/dev-media.mjs:277`: o perfil dedicado é iniciado com `up --detach --wait` antes do bootstrap.
- `docker-compose.media.yml:63`: publicação do RustFS apenas em `127.0.0.1:21920:9000`.

A [documentação oficial da regra](https://codeql.github.com/codeql-query-help/javascript/js-file-access-to-http/) informa precisão média e orienta examinar se o comportamento é intencional. A classificação acima decorre do destino fixo, da finalidade necessária de provisionamento e dos controles de destino; não de uma tentativa de fazer validações de tamanho eliminarem o caminho de taint.

Não é recomendada supressão geral da regra, exclusão do script da análise ou alegação de que validação genérica torna segura qualquer transferência de arquivo. Esta revisão não realizou dismiss no GitHub. A decisão é limitada ao bootstrap sintético de loopback; reutilizar o helper para hosts externos exigiria outra análise. A máquina local permanece a fronteira de confiança do perfil de desenvolvimento.

## Gate executado pelo verificador

Com Node 24.20.0 e heap limitado, o comando `node --test test/media-smoke-security.test.js` passou: **11 testes, 11 aprovados, zero falhas, zero skips**. A execução independente no scratch repetiu o baseline com sucesso. Não foram executados Docker, pipeline com efeitos ou alterações de workflow pelo verificador.

Os checks de lint, tipos, build, suíte completa e CI são gates separados conduzidos pelo Tech Lead; este relatório não os declara aprovados sem evidência. Não houve redução de testes existentes; a fatia acrescenta onze testes focais.

## Sensor de discriminação

Sensor leve em cópias isoladas do helper e dos testes, sem alterar assertions ou a árvore real:

| Mutação | Comportamento defeituoso | Evidência que matou o mutante | Resultado |
| --- | --- | --- | --- |
| Remover o guard de SHA-256 | Aceitar metadado com hash divergente | `test/media-smoke-security.test.js:61`: a rejeição esperada deixa de ocorrer | Morto, exit 1 |
| Copiar `metadata.privateName` para a prova | Persistir campo arbitrário adicional | `test/media-smoke-security.test.js:36`: comparação completa detecta o campo extra | Morto, exit 1 |
| Adicionar `allowList: () => true` ao limiter | Permitir a rajada sem limite | `test/media-smoke-security.test.js:106`: retorna 200 em vez de 429 | Morto, exit 1 |

**Resultado:** três mutações, três mortas, zero sobreviventes. Scratch removido; `git status --porcelain` da árvore real idêntico antes e depois. Prova local ignorada: `var/pr156-security-sensor-proof.json`; logs individuais sob o mesmo prefixo. Não há lição nova de falha sobrevivente a registrar.

## Limites e fechamento

Não foram encontrados gaps bloqueantes no patch local de T30. O gate remoto do PR continua obrigatório e separado deste PASS. T24 continua pendente de captura física e UAT humana; este relatório não encerra a feature inteira nem comprova operação no EasyPanel ou no RustFS remoto.

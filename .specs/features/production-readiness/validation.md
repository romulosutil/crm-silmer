# Prontidão para produção — etapas 1 a 4

## Validation: PASS

PASS para o patch e a auditoria de evidências. Este parecer não aprova go-live,
DPA/ZDR, recovery ou uma imagem implantada. Aprovar a release exige os checks
remotos e os gates operacionais descritos abaixo.

- Data: 05/10/2026, America/Sao_Paulo.
- Verificador: subagente independente; não escreveu a implementação.
- Diff revisto: `2979c8128abaf5d4c5ae262fa19e3a5df38510c8..757e6f4`.
- Fontes de aceite: solicitação do proprietário, `.specs/features/crm-mvp/spec.md`
  e tarefas OPS-DOC-01, OPS-CI-01, OPS-CHK-01 e OPS-AI-01 em
  `.specs/features/crm-mvp/tasks.md:153`.
- A revisão inclui o esclarecimento posterior de segredos no relatório operacional,
  sem mudança de runtime.
- Entrega: [PR #148](https://github.com/romulosutil/crm-silmer/pull/148).

## Aceite por requisito

| Requisito  | Resultado esperado                                                                                               | Evidência verificada                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Parecer                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| OPS-DOC-01 | Baseline da PR 142 coerente com ADRs 004/006/020, sem transformar histórico em aprovação atual                   | `.specs/features/crm-mvp/spec.md:60` aposenta Kanban/Negócio; `.specs/features/crm-mvp/spec.md:92` reserva número na criação; `.specs/features/crm-mvp/spec.md:95` mantém assinatura física. `modules/orders/src/print/index.js:28` seleciona v5. `TECHNICAL-DESIGN.md:68` referencia dados reais e `docs/api/openapi.v1.yaml:429` documenta SSE Inbox compatível com `apps/api/src/operation-routes.js:39`. PDFs, hashes, migrations e ADRs anteriores não foram alterados.           | PASS documental                                            |
| OPS-CI-01  | Corrigir bloqueio conhecido sem enfraquecer scan; consumir saída do inspector preservando digest e erro upstream | `docker/runtime.Dockerfile:59` atualiza perl-base e `:60` exige versão corrigida u4. `.github/workflows/ci.yml:167` mantém exit-code 1, ignore-unfixed e CRITICAL. `.github/workflows/ci.yml:186` valida formato; `:191` drena saída; `:192` compara digest. `.github/workflows/promote-approved-sha.yml:100` valida referências e `:106` drena inspeção. `test/ci-digest-pipeline.test.js:43`, `:44`, `:55` e `:64` assertam sucesso, primeiro digest, erro 255 e ausência de header. | PASS do patch; build/scan remoto é gate próprio            |
| OPS-CHK-01 | Auditar o deploy existente somente por leitura e separar observações de controles não comprovados                | `docs/runbooks/production-readiness-checks.md:63` registra fonte e release; `:106` distingue backup local/manual de recovery; `:119` identifica auto-deploy da API desativado; `:123` registra limites 0/unlimited. O relatório não converte build em prova do container executado, Ports em firewall ou backup em restore. ADR 022 registra o fluxo escolhido sem aprovar esses gaps.                                                                                                 | PASS da auditoria; INT-3 aberto                            |
| OPS-AI-01  | OpenAI escolhido, com rastreabilidade e gates específicos de privacidade preservados                             | `docs/rfc/009-openai-no-mvp.md:3` vincula ADR 021; `docs/adr/021-adotar-openai-no-mvp.md:16` escolhe OpenAI e `:23` exige evidência do projeto efetivo. `docs/integrations/openai/README.md:19` não presume store:false; `:33` mantém ZDR pendente. Configuração conferida em `ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js:530`: nó OpenAI/Responses, modelo, timeout e retries descritos correspondem à fonte.                                                               | PASS da escolha/documentação; tráfego com PII não liberado |

## Verificações independentes

- `node --test test/ci-digest-pipeline.test.js`: 6 testes passaram.
- Blocos Bash reais de publicação e promoção, executados em diretório temporário
  com inspector simulado: 10 cenários. Digest válido retornou 0; digest
  malformado, ausente ou divergente retornou 1; produtor que imprimiu um digest
  válido e falhou retornou 255. Nenhuma falha upstream foi mascarada.
- `node --test test/ficha-print-v4.test.js test/ficha-print-v5.test.js test/ficha-print-switch.test.js`:
  21 testes passaram após a correção de portabilidade com fileURLToPath.
  Asserções de recusa e de hash foram preservadas. A execução direta do preview
  v5 também recusou sobrescrever o PDF e manteve seu SHA-256.
- ESLint do novo teste de digest, Prettier de workflows/teste/supply chain/OpenAPI
  e `git diff --check` passaram. Checagem independente de links relativos nos
  Markdown alterados: 148 destinos existentes no momento da revisão.

## Sensor de discriminação

As duas fontes de workflow e o teste de digest foram copiados para scratch.
O sensor alterou somente essas cópias; não usou stash.

| Mutação na extração de digest           | Teste discriminante                                                 | Resultado |
| --------------------------------------- | ------------------------------------------------------------------- | --------- |
| Restaurar saída antecipada com awk exit | Pipe real com saída extensa, `test/ci-digest-pipeline.test.js:27`   | Morta     |
| Imprimir todos os headers Digest        | Igualdade com primeiro digest, `test/ci-digest-pipeline.test.js:44` | Morta     |
| Apagar digest da saída                  | Igualdade com digest esperado, `test/ci-digest-pipeline.test.js:44` | Morta     |

3 mutações mortas, nenhuma sobrevivente. Scratch removido e porcelain da árvore
real idêntico antes/depois. A simulação dos 10 cenários também foi repetida
integralmente com cwd temporário e porcelain idêntico antes/depois.

## Gates completos e integridade dos testes

Execução pelo Tech Lead, com resumos dos logs locais conferidos pelo verificador:

- `npm run validate`: 650 testes, 647 passaram, 0 falharam, 3 skips; build concluído.
- `npm run test:e2e`: 107 passaram, 7 skips, 0 falhas.
- `npm audit --omit=dev` e `npm audit --audit-level=high`: zero vulnerabilidades informado pelo
  Tech Lead. Não confundir auditoria npm com scan da imagem.
- Três skips unitários exigem TEST_DATABASE_URL: operação PostgreSQL
  (`test/operation-read-postgres-live.test.js:388`), webhook PostgreSQL
  (`test/postgres-webhook-inbox-live.test.js:80`) e work-management PostgreSQL
  (`test/work-management-postgres-live.test.js:198`).
- Sete skips E2E preexistentes são Kanban/Negócio aposentados:
  `test/e2e/crm-ui.spec.js:638`, `:1576`, `:1599`, `:1636`, `:1645`, `:1664`, `:1676`.
  Nenhum teste foi removido ou marcado skip neste patch; foram adicionados seis
  testes de digest. O teste documental de provedor passou a exigir OpenAI em
  ORC-06, acompanhando a decisão do proprietário.
- Node/npm locais diferem dos pins do projeto. Execução com pins, PostgreSQL real,
  E2E e scans das duas imagens deve ser comprovada nos
  [checks do SHA atual da PR #148](https://github.com/romulosutil/crm-silmer/pull/148/checks).
  A aprovação remota depende de todos esses checks. Este relatório não declara
  publicação GHCR de uma PR nem implantação da correção em master/EasyPanel.

## Limites operacionais e revisão final

O CI de baseline foi conferido independentemente no
[run 37394796634](https://github.com/romulosutil/crm-silmer/actions/runs/37394796634):
quality/edge passaram e runtime falhou com três CRITICAL em perl-base u3,
indicando u4 como correção. A solução corresponde ao diagnóstico e mantém o
scan obrigatório. O scan remoto decide a aprovação da nova imagem.

Nenhum finding de implementação permanece aberto nesta revisão. Os ajustes
solicitados durante QA foram conferidos: caminhos Windows dos testes de PDF,
tabelas reais na síntese técnica, contrato SSE Inbox e resíduos documentais.

Continuam gates de produção, com prioridade no relatório operacional:
coordenação API/worker/edge e CI; transporte/acesso do painel; limites de
recursos e hardening; backup externo/restore; monitor off-host; configuração
real do n8n/OpenAI e DPA/ZDR; homologação WhatsApp; assinatura física da v5.
Auditoria concluída e escolha de fornecedor não representam aprovação desses
controles. A revisão de segredos inclui revisar/regenerar o gatilho de deploy
após sua URL sensível aparecer em uma leitura inicial do painel. O valor não
é reproduzido neste relatório nem integra os artefatos versionados; essa
observação não é alegação de vazamento nos artefatos. Não houve deploy,
alteração do painel, chamada de IA ou drill pelo verificador.

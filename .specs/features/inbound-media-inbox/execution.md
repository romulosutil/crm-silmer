# INBOX-IMG-01 — execução e evidências

A implementação foi preparada em branch própria a partir de `dbbb762`.
Requisitos IMG-01..05; arquivos e limites em `spec.md`. A aplicação posterior
em produção está registrada ao final, separada dos ensaios locais.

## Gates

- Node `24.20.0`, npm `11.19.0`, instalação pelo lockfile.
- `npm run validate` final: PASS; 1.150 testes aprovados, zero falhas, cinco skips
  por pré-condições das suítes; tipos, lint, formatação, fronteiras, tokens,
  validadores e build aprovados.
- Testes focais finais de volume, conteúdo e retenção: 33/33, sem skips;
  patch offline: 10/10, sem skips.
- PostgreSQL 17 dedicado, dados sintéticos: integração nova aprovada,
  incluindo upload, replay, projeção list/get, bytes, ACL, retenção e perda.
  Regressão de Inbox/n8n: 15/16 na primeira execução; o cenário concorrente
  falhou por lock timeout durante a carga de E2E e passou isoladamente em
  1,7 s. Nenhum teste ou timeout foi alterado.
  A integração nova passou novamente após corrigir retry e concorrência.
- E2E: 320 aprovados, sete skips existentes e quatro falhas na primeira
  execução com oito workers. Reexecução dos quatro casos com um worker e
  Firefox Linux no servidor de testes já previsto pelo repositório: 4/4 PASS.
  Foram recuperados o teste concorrente de captura, dispositivos sintéticos
  Chromium/Firefox e a navegação mobile que teve `ERR_NO_BUFFER_SPACE`.
- `npm audit --audit-level=high`: exit 0; três avisos preexistentes (um baixo,
  dois moderados), sem alteração de dependências.
- `git diff --check`: PASS.

## Correções da revisão independente

A revisão inicial identificou retry impossível depois de falha temporária do
scanner e um teste de hash mascarado pela diferença de tamanho. A correção
permite somente estados transitórios conhecidos, revalida a cópia existente
sem outra ocupação e adiciona corrupção de um byte com tamanho idêntico.

O teste concorrente reproduziu outra falha: duas tentativas podiam rebaixar
o arquivo já limpo para indisponível. A API agora serializa descoberta, scan
e vínculo por mensagem na instância do piloto. Nos dois cenários concorrentes
(quarentena e indisponível sem cópia), ambas as requisições concluem e deixam
um arquivo, um anexo e uma auditoria, `available/clean`, prazo preservado e
GET 200. Múltiplas instâncias exigem coordenação durável antes de escalar.

O sensor e o veredicto finais pertencem ao relatório independente
`validation.md`; o relatório preliminar não autoriza ativação.

A inspeção dos parâmetros ativos identificou URL de inbound como concatenação
de duas strings constantes. O preparador aceita esse formato por regex
restrita e `JSON.parse`, sem executar expressões. Os testes preservam a URL
original e rejeitam variáveis, código, templates e caminhos incompatíveis.

## n8n real, isolado

n8n `2.38.7` em container `--network none`, mocks somente em loopback,
HTTPS com CA sintética confiada, Basic e credenciais de header sintéticas.
O inbound respondeu modo humano e `duplicate=true`. Resultado: um download,
um upload, zero falhas e zero envios. Boundary multipart, SHA256, idempotência,
schema, identidade da mensagem, MIME e bytes originais conferiram.

Artefatos sintéticos locais ignorados: `var/waha-inbound-smoke/result.json`
e log de execução. Não contêm credenciais ou dados de produção e não substituem
ensaio operacional no ambiente remoto.

## Inspeção remota inicial — 28/10/2026

Ações remotas foram somente leitura da interface e consultas de existência
de recursos; SQL usou conexão read-only e devolveu somente contagens. A API
não tem volume transitório presente nem acesso ao socket e às assinaturas
que existem no worker. A conversa tem duas imagens e zero anexos vinculados.

Aplicação, revisão dos mounts, scan real, publicação do workflow, recuperação
pontual e confirmação visual na conversa permaneciam pendentes nessa inspeção. O procedimento
está em `docs/runbooks/inbound-images-inbox.md`. Não declarar o incidente
resolvido ou as imagens exibidas em produção com esta evidência local.

## INBOX-IMG-CI-01 — aplicabilidade da revisão de dependências

O PR de fork privado #226 não iniciou workflows. O mesmo commit foi publicado
em branch interna no PR #235, sem alterar permissões do GitHub. O CI
40801959042 aprovou testes estáticos, banco, E2E e audit, mas falhou apenas
em `Review dependency changes`: o serviço exige Dependency Graph e GitHub
Advanced Security indisponíveis no repositório privado.

A correção de CI calcula o delta de manifests/lockfiles npm e referências
de GitHub Actions antes de acionar esse serviço. Mudança de dependência
continua exigindo a revisão; sintaxe ambígua exige revisão e erro Git falha
o job. `npm audit` continua incondicional. Nenhuma configuração de acesso,
licença ou serviço de segurança foi alterada.

Verificação local: fixtures de código sem dependências, campos `run/if`,
manifest nested, lockfile, exclusão, pins de Actions, refs adicionadas/removidas,
quoted/flow/multiline, Docker, anchors, escapes, dinâmica e comparação inválida;
dois testes com todos os cenários passaram. Typecheck, lint focal, Prettier e
diff check passaram. A comparação real da feature e a comparação do workflow
base com a alteração local não identificaram mudanças de dependência.

A implantação continua condicionada aos gates do PR após essa correção.

## INBOX-IMG-CI-02 — confirmação por teclado no gate T136

O CI 40805065722 aprovou 323 cenários E2E e falhou somente no retry de
confirmação de entrega. O componente remove o checkbox após o sucesso;
`check()` exige observar o estado marcado depois do clique, criando uma
pós-condição incompatível com essa remoção. A falha não se reproduziu nas
três execuções locais anteriores ao ajuste.

O teste agora confirma por foco e Espaço, como o cenário de teclado já
existente. Preserva conflito, atualização e retry e acrescenta verificações
de leitura, estado desmarcado, anúncio de sucesso e duas requisições exatas
com a versão esperada. Não houve alteração no produto ou redução do gate.
Os quatro testes do arquivo passaram três vezes (12/12), assim como lint
focal, formatação e diff check. O CI completo deve passar antes do deploy.

## Reconciliação com a migração WAHA integrada

Durante a espera do CI, o PR #224 entrou em master (`c7e6ca2`) e o painel
mostrou deploys concorrentes de API, worker e edge. A feature foi reaplicada
por rebase sobre essa revisão. Os conflitos eram adições ao inventário de
tarefas e a condição da revisão de dependências: tarefas dos dois lados
foram preservadas, e a revisão continua obrigatória quando dependências
mudam, incluindo repositórios privados. O npm audit permanece incondicional.
O Dockerfile atualizado e os contratos WAHA integrados foram preservados.
O validate completo após rebase aprovou 1.268 testes, sem falhas e com os
cinco skips condicionais existentes, além de tipos, lint, formatação e build.

A inspeção real confirmou Zero Downtime marcado no worker e ausência de
opção somente leitura no formulário de bind do EasyPanel 2.38. O runbook
explicita a substituição sem sobreposição e os acessos reais pelo spool já
montado. Nenhum serviço foi reiniciado ou reconfigurado por esta tarefa.

O n8n em produção é 2.43.7. Importar um arquivo acrescenta nós ao canvas;
portanto aplicar somente os nove nós novos e conectar o ramo ao inbound,
preservando os 101 nós antigos. Save e Publish são ações distintas. O
recovery preparado é manual e inativo, sem webhook ou nós de envio; valida
as duas identidades, horários, hashes e tipos antes de enviar qualquer anexo.

## Aplicação e recuperação reais — 29/10/2026

Execução pelo responsável pela integração, após autorização do operador.
O CI `40807820756`, no head `e59fd70`, aprovou os três jobs: qualidade,
build/scan de edge-web e build/scan de runtime. PR #235 integrado por rebase
em `a754154`. Durante a operação, o PR #225 também foi integrado em
`e384a9c`, com seus três checks aprovados; não alterava os módulos de mídia
desta correção. A migration dessa outra entrega foi apenas conferida em
leitura; não foi aplicada por esta tarefa.

- Filas sem jobs pendentes ou em processamento antes da troca. Autodeploy do
  worker pausado temporariamente e restaurado ao final; uma réplica e Zero
  Downtime desmarcado para impedir dois daemons no mesmo socket.
- Três subdiretórios privados preparados no spool existente, com cópia das
  assinaturas e conferência de hashes/metadados antes e depois. Worker e API
  receberam os três binds do runbook, preservando o mount do chat. Comandos
  de partida verificam UID/GID e restauram `0700` em cada diretório.
- Novo worker respondeu ao PING; marcador confirmado depois da partida.
  API: readiness `200`, diretórios `0700`, socket e marcador `0600`.
  Scan real de PNG sintético pela API, via `fdpass`, retornou clean e
  `image/png`. O arquivo sintético foi removido. SHA256 do módulo implantado
  correspondeu ao código aprovado.
- A exportação imediatamente anterior à alteração do n8n já incorporava
  atualizações comerciais paralelas. O patch foi regenerado dessa versão.
  Rascunho exportado: 110 nós, os 101 anteriores intactos e todas as conexões
  antigas preservadas; a única ligação adicional antiga→nova sai do inbound.
  Conexões finais coincidiram com o patch esperado. Versão publicada:
  `Imagens recebidas na Inbox`. O workflow comercial não foi executado.
- Preflight detectou `readWriteFile` bloqueado na produção. O bloqueio foi
  mantido. Smoke independente no n8n 2.43.7 validou parâmetros em
  `$getWorkflowStaticData('global')`, execução inativa e limpeza posterior;
  o código do histórico não persiste esse campo nas versões dos nós.
- Recovery manual de 13 nós, sem webhook ou envio, com dados de execução
  desativados e timeout de 180 s. Runner somente desse processo: interno,
  loopback `127.0.0.1:15679`, concorrência 1 e modo inseguro desativado;
  configuração global e runner externo preservados. As duas consultas e a
  validação de ambas as identidades precederam qualquer upload.
- Resultado real: `requested=2`, `accepted=2`, `duplicates=0`, `sends=0`.
  Estado temporário limpo por reimportação e confirmado por exportação:
  `staticData=null`, workflow inativo. Helper arquivado. Parâmetros em arquivo
  e log bruto removidos; não havia diretório binário residual desse helper.
  Apenas resumo sem conteúdo foi preservado em armazenamento privado.
- Auditoria SQL final read-only: 13 mensagens e três envios, como antes;
  inbound revision 10, automation epoch 1, estado `requer_atencao` e jornada
  aberta preservados. Dois anexos para duas mensagens, ambos available/clean
  e não expirados. Readiness `200` e PING do scanner continuaram aprovados.
- Navegador autenticado: dois elementos `img` completos com dimensões
  naturais 982×552 e 980×547. As imagens reais foram exibidas na conversa.

Não houve replay do webhook/inbound, reserva de envio ou mensagem à cliente.
WAHA/WEBJS e as credenciais vinculadas foram mantidos. A publicação do ramo
futuro foi conferida estruturalmente; o ensaio de nova entrada permanece
sintético, sem solicitar mensagem de teste à cliente. Retenção original de
sete dias ou encerramento da jornada continua aplicável.

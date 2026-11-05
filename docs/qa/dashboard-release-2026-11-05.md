# QA — Release da central e ativação do checkpoint

Data: 05/11/2026. Tarefa: ACT-T02. Revisão independente de QA/Segurança/Privacidade.
Contrato: [CHK-01–08](../../.specs/features/dashboard-actions/spec.md),
[ACT-T02](../../.specs/features/dashboard-actions/tasks.md) e
[runbook](../runbooks/dashboard-central.md).

## Escopo e autoridade

O integrador informou autorização explícita do proprietário para produção e
checkpoint. Somente o integrador controla produção, configuração privada,
publicação e eventual envio. QA não consulta envs/segredos remotos, não envia
mensagens e não altera workflows ou dados de produção. Este arquivo é a única
fronteira de escrita delegada ao papel nesta etapa, sem commit próprio.

O parecer estático de ACT-T01 está em
[dashboard-central-2026-11-05.md](dashboard-central-2026-11-05.md).
Esta evidência distingue código validado, serviço implantado, agenda publicada,
mensagem aceita pelo provedor e entrega efetiva. Um resultado não substitui o
seguinte.

## Referência local confirmada

Commit funcional de referência: `7cc71e04ceb6434fb6b36f480a6aa58dd9db73ea`.
Release integrada em `master`: `06836f73de04bcf72e84fe0ea411b49b63c2c79e`,
por merge rebase da PR 297. O integrador confirmou CI da PR `42118926884` e
CI de master `42121762291` verdes; este último terminou às 22:46:42 UTC.
API, worker e edge foram publicados com sucesso e estão saudáveis no release
informado abaixo. A origem implantada é GitHub/master; os IDs Docker dos
containers em execução não são apresentados como imagem GHCR da CI.

Checksums calculados pelo `loadMigrations` do repositório:

| Versão | Fase   | SHA256 esperado                                                    |
| ------ | ------ | ------------------------------------------------------------------ |
| 0056   | expand | `b18a513bac25ca4305b9ba6a55254b4f7222b59bd6133cfd7aba48ebcc4fd7f3` |
| 0057   | expand | `c7a395c25e9fde86dbbd3cb80121f3c996b007fecce0af77ed156389a59b7006` |

Fonte e runbook foram conferidos: datas de pagamento/entrega históricas não
são reescritas; captura de crédito não atribui retrospectivamente pelo dono
atual; o marcador histórico preserva ausência de evidência na reconfirmação.
Snapshot é cifrado com AAD e protegido contra alteração/remoção; reserva é
individual e não reemite permissão. Uma chave de cifragem em uso não deve ser
trocada descartando a capacidade de leitura/reconciliação dos snapshots.

O template local permanece inativo por construção, com cron `0 8 * * *`, fuso
`America/Sao_Paulo`, retenção de execuções desligada, sem pinData, sem retry de
HTTP/reserva/transporte e sem redirecionamento HTTP. Lookup exige a identidade
exata do destino; resposta ambígua do envio vira `outcome_unknown`.

A documentação primária atual do n8n distingue rascunho da versão publicada
e admite publicação parcial com falha de trigger. O gate exige a versão
efetivamente publicada e o Schedule Trigger ativo sem erro, além de um campo
`active` verdadeiro. Alterações somente de settings podem republicar a versão;
conferir fuso e retenção antes de ativar. Fontes:
[publicação](https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows.md)
e [settings](https://docs.n8n.io/build/manage-workflows/configure-workflow-settings.md).

## Gates operacionais — release e agenda confirmadas

| Gate      | Critério verificável                                                                                                                                                                  | Evidência recebida                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-01    | Commit/digest de API, worker e frontend compatíveis; deploy concluído e health/readiness aprovados.                                                                                   | Confirmado: API com flag true, worker e edge com deploy Success/healthy; commit 06836f73, IDs Docker e horários registrados abaixo. Healths públicos HTTP 200; CI de master verde.                                                                                               |
| REL-02    | Migrations 0056/0057 aplicadas com fase e checksum corretos antes do uso das rotas novas.                                                                                             | Confirmado: 0056/0057 expand aplicadas pelo migrate canônico com checksums esperados; replay retornou applied[]. Contratos 0012/0018 não executados.                                                                                                                             |
| REL-03    | Triggers/constraints de atribuição, snapshot e receipt presentes; agregados de inconsistência iguais a zero; sem reescrever pagamentos/entregas históricos.                           | Parcial: três tabelas da feature presentes, invalid_attribution=0 e snapshots/deliveries=0. Aplicação canônica concluída; verificação operacional de snapshot/receipts aguarda geração.                                                                                          |
| REL-04    | Leituras seller/admin e recusa Financeiro/sem credencial coerentes; sessão humana não concede execução técnica. Não criar usuários/dados sintéticos em produção para a prova.         | Parcial: GET actions/performance/checkpoint sem credencial recusados com 403; Basic técnico da nova ação aceito e prepare negado por flag com 409 CHECKPOINT_DISABLED, sem snapshot/envio. Leituras humanas autenticadas ainda pendentes.                                        |
| REL-05    | Autodeploy GitHub de edge/worker restaurado ao estado anterior ao término da janela, preservando os serviços.                                                                         | Confirmado: worker e edge com autoDeploy=true restaurados; API autoDeploy=false preservado. Serviços mantidos.                                                                                                                                                                   |
| CHK-04/05 | Exatamente dois destinos únicos E.164, IDs estáveis e correspondência privada com os dois destinos autorizados; chave de 32 bytes existente; credenciais referenciadas sem exposição. | Confirmado: dois destinos privados distintos conferidos e configuração com flag true implantada em API saudável. Basic técnico da nova ação validado antes da habilitação, sem gerar snapshot/envio.                                                                             |
| CHK-01/04 | Remetente é a conta da Inbox existente, conectada, com identidade conferida; lookup dos dois destinos confirma número/JID exatos sem variação.                                        | Preflight confirmado: conta remetente conectada, identidade coincide com a Inbox e os dois lookups individuais confirmaram número exato, registro e JID canônico correspondente. Sem envio.                                                                                      |
| CHK-01/08 | Workflow dedicado publicado/ativo, cron 08h diário e São Paulo; retenção/pinData/retry/redirect conferidos no artefato efetivamente importado; workflows comerciais preservados.      | Confirmado via UI e CLI: active=true; versionId=activeVersionId=`d8ef30f5-9d4d-4fee-b6e7-c4bc628ee518`; publicado coincide com draft em nós/conexões/settings, 13 nós e pins=0. Cron 08h São Paulo e retenção desligada. Sem execução manual; primeiro run 06/11/2026 às 08h SP. |
| CHK-02/03 | Dia civil anterior correto; apuração oficial e reconciliação financeira conferidas privadamente; snapshot único cifrado e estável, sem payload exposto nesta evidência.               | Pendente.                                                                                                                                                                                                                                                                        |
| CHK-06/07 | Cada destino tem uma reserva e resultado próprios; replay posterior de reserva concluída não concede autorização; desconhecido exige reconciliação e não dispara retry.               | Pendente.                                                                                                                                                                                                                                                                        |
| CHK-07    | Resultado `sent`/`PROVIDER_ACCEPTED` documentado como aceitação, sem confundir com entrega.                                                                                           | Pendente do primeiro agendamento: zero mensagens enviadas; sem evidência de aceite do provedor.                                                                                                                                                                                  |
| CHK-08    | Entrega/recebimento de cada destino confirmados por evidência independente do aceite da API; somente resultado minimizado é publicado.                                                | Pendente do primeiro run em 06/11/2026 às 08h SP. Não há prova de entrega/recebimento dos dois destinos.                                                                                                                                                                         |

A validação privada de configuração deve retornar apenas flags/contagens, por
exemplo `recipientsCount=2`, `idsUnique=true`, `phonesUnique=true`,
`e164Valid=true`, `matchesAuthorizedRecipients=true`, `senderMatchesInbox=true`
e `senderConnected=true`. Não publicar telefones, nomes de configuração,
chaves, Authorization, URLs privadas, payloads, comprovantes ou IDs de mensagem.

## Evidências remotas recebidas do integrador

As provas abaixo foram comunicadas pelo responsável de produção; QA não
executou as consultas ou ações remotas. Aplicação das migrations, publicação
dos três serviços e agenda do checkpoint foram confirmadas. Não houve
execução ou envio manual; as provas de snapshot, reserva, aceite e entrega
real aguardam o primeiro disparo programado.

- Backup anterior às migrations 0056/0057: `silmer-pre-dashboard-0056-0057-2026-11-05`, resultado
  **Success** às 22:01:05 UTC, tamanho 1,94 MB, em LocalDisk com retenção existente
  de sete dias. Não foi informada execução de teste de restore nesta etapa.
- Baseline do ledger: 0054, sem checksum divergente; 50 pedidos, 90.112 bytes e
  zero transações longas. Os contratos 0012/0018 não devem ser executados nesta
  ativação. Os endpoints públicos live/ready/healthz responderam HTTP 200 no
  serviço atual; isso não identifica nem aprova a imagem nova.
- Importação inicial do checkpoint no n8n sob ID `Nph1PQ7IbE6Prvtb`, naquele
  momento **inativo**, com
  13 nós. A importação pela UI ignorou settings; reimportação CLI e exportação
  posterior confirmaram `America/Sao_Paulo`, `saveExecutionProgress=false`,
  `saveManualExecutions=false`, sucesso/erro `none`, duas referências de
  credenciais existentes e ausência de PII no workflow.
- Workflow comercial principal: versão publicada
  `4becba96-a3eb-4ef3-9b6c-9762537d84f2` preservada, 141 nós, sem publicação
  nesta etapa. Uma interação transitória removeu uma nota do rascunho; undo e
  nova exportação confirmaram sua restauração. Existem diferenças prévias de
  código/posição no draft; não se declara igualdade byte a byte do rascunho.
- Provedor: remetente em estado aberto/conectado; comparação privada por hash
  confirmou correspondência com a conta da Inbox. Os dois destinatários foram
  consultados individualmente: `exactRequestedNumber=true`, `registered=true`
  e `canonicalJidMatchesRequested=true` para ambos, sem variação de identidade.
- Primeiro estágio da configuração API privada: dois destinos distintos e
  flag false. Após validação sem efeito, a configuração com flag true foi
  implantada conforme o deploy final abaixo. Mensagens enviadas permanecem
  **zero**, sem execução de transporte durante esta homologação.
- PR 297 posteriormente integrada por rebase em `master`
  `06836f73de04bcf72e84fe0ea411b49b63c2c79e`; CI `42118926884` passou em
  todos os jobs. O ajuste de mirror APT usa Ubuntu oficial para resolver stall
  de CI.
- Migrations 0056/0057 aplicadas via `migrate` canônico na API anterior
  (`5bc36118`), com transferência em memória de SQL comprimido/GZIP e
  verificação SHA/checksums. Foi usado o lock de sessão canônico
  `0x43524d53`, reentrância do runner, lock timeout 5s e statement timeout 15s.
  O ledger registrou 0056 em `2026-11-05T22:27:47.364Z` e 0057 em
  `2026-11-05T22:27:47.450Z`. Replay retornou `applied: []`.
  Contratos 0012/0018 não foram executados.
- Publicação API: tentativa MCP cancelada por conexão 502/ações interrompidas;
  o integrador concluiu pela UI o deploy `cmw44eiz5000b07led1yec7ej`, **Success**
  às 22:31:59 UTC. Container observado com prefixo `57113face`, healthy, commit
  `06836f73`; ID de imagem
  `a35b330c38169470aecaaf7a97a3d596762dc8fa51bf86919cbc2d175f0fba60`.
  Esse ID não é apresentado como digest de registry não informado.
- Após a publicação API: três healths públicos HTTP 200; GET actions,
  performance e checkpoint sem credenciais retornaram 403. Verificação interna
  confirmou enabled=false/configured=true, dois destinos distintos, três tabelas
  existentes, snapshots/deliveries=0 e invalid_attribution=0. O Basic técnico da
  nova ação foi aceito, com prepare retornando 409 `CHECKPOINT_DISABLED`, sem
  gerar snapshot ou enviar mensagem.
- Deploys finais, todos **Success** e **healthy**, em 05/11/2026 UTC:

  | Serviço           | Deploy                      | Conclusão UTC | Docker image ID SHA256                                             |
  | ----------------- | --------------------------- | ------------- | ------------------------------------------------------------------ |
  | API com flag true | `cmw44j0qi000j07le8uckat5k` | 22:35:17      | `a35b330c38169470aecaaf7a97a3d596762dc8fa51bf86919cbc2d175f0fba60` |
  | Worker            | `cmw44lmwo000m07le4lnf5qvc` | 22:37:21      | `a35b330c38169470aecaaf7a97a3d596762dc8fa51bf86919cbc2d175f0fba60` |
  | Edge              | `cmw44nscm000p07le03p55zby` | 22:39:11      | `3ba90dfb65d36d2d81ccbac02dc62fd50734c18c05c092b56ff9505eada4d629` |

  Os serviços usam GitHub/master no commit
  `06836f73de04bcf72e84fe0ea411b49b63c2c79e`; não confundir com os artefatos
  GHCR produzidos pela CI. Master CI `42121762291`: **success** às 22:46:42 UTC.

- Conferência final adicional via `inspectAppService`: API, worker e edge
  confirmados no commit `06836f73de04bcf72e84fe0ea411b49b63c2c79e`, origem
  GitHub/master. API `checkpointEnabled=true` e `autoDeploy=false`;
  worker/edge `autoDeploy=true`. Healths públicos live/ready/healthz
  responderam HTTP 200 novamente.
- Autodeploy GitHub: worker e edge restaurados para `true`; API `false`
  preservado. A pausa temporária manteve os serviços e não permaneceu como
  alteração silenciosa após a janela.
- Checkpoint `Nph1PQ7IbE6Prvtb` publicado com sucesso; UI mostrou **Published**
  com botão desabilitado. Verificação CLI final confirmou `active=true` e
  `versionId=activeVersionId=d8ef30f5-9d4d-4fee-b6e7-c4bc628ee518`.
  `publishedMatchesDraft=true` para nós, conexões e settings; 13 nós e zero pins.
  Agenda `0 8 * * *`, fuso `America/Sao_Paulo`,
  `saveDataSuccessExecution=none`, `saveDataErrorExecution=none`,
  `saveManualExecutions=false` e `saveExecutionProgress=false`.
  Export `checkpoint-published.json` preservado no backup interno privado do
  n8n, sem anexar bindings ou conteúdo nesta evidência. Dois destinos privados
  conferidos; remetente conectado e correspondente à Inbox, ambos os destinos
  registrados e JIDs canônicos correspondentes.
- Nenhuma execução ou mensagem manual foi disparada. Primeiro agendamento:
  **06/11/2026, 08h em São Paulo**. Snapshot, reservas, referência de aceitação e
  entrega efetiva não foram presumidos como existentes antes desse primeiro run.

## Consultas agregadas propostas — somente o integrador executa

Não foram executadas por QA em produção. Devem usar a conexão operacional
autorizada e parâmetros, sem imprimir DSN. Não selecionar `*` ou envelopes.
Checksums abaixo são metadados de migração, não segredos.

```sql
SELECT version, phase, checksum
FROM crm_meta.schema_migrations
WHERE version IN ('0056', '0057')
ORDER BY version;

SELECT
  count(*) FILTER (WHERE sales_owner_id IS NOT NULL
    AND (NOT sales_owner_capture_attempted OR sales_owner_captured_at IS NULL))
    AS invalid_attribution_count,
  count(*) FILTER (WHERE origin = 'loja' AND sales_owner_id IS NOT NULL)
    AS invalid_store_attribution_count
FROM crm.orders;

SELECT
  EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'crm.orders'::regclass
      AND tgname = 'capture_order_sales_owner' AND NOT tgisinternal
      AND tgenabled <> 'D') AS attribution_trigger_enabled,
  EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'crm.dashboard_checkpoint_snapshots'::regclass
      AND tgname = 'guard_dashboard_checkpoint_snapshot' AND NOT tgisinternal
      AND tgenabled <> 'D') AS snapshot_guard_enabled;

SELECT
  count(*) AS snapshots,
  count(*) FILTER (WHERE content_envelope->>'algorithm' IS DISTINCT FROM 'AES-256-GCM'
    OR jsonb_typeof(content_envelope->'ciphertext') IS DISTINCT FROM 'string'
    OR jsonb_typeof(content_envelope->'iv') IS DISTINCT FROM 'string'
    OR jsonb_typeof(content_envelope->'tag') IS DISTINCT FROM 'string'
    OR content_envelope->>'keyVersion' IS DISTINCT FROM '1'
    OR content_envelope->>'version' IS DISTINCT FROM '1') AS invalid_envelope_count,
  count(*) - count(DISTINCT report_day) AS duplicate_day_count
FROM crm.dashboard_checkpoint_snapshots
WHERE report_day = $1::date;

SELECT status, result_code, count(*) AS destinations,
  count(*) FILTER (WHERE reservation_id IS NULL) AS missing_reservation_count,
  count(*) FILTER (WHERE status = 'sent' AND provider_message_id IS NULL)
    AS missing_provider_reference_count,
  count(*) FILTER (WHERE status = 'reserved'
    AND reserved_at < now() - interval '5 minutes') AS stale_reserved_count
FROM crm.dashboard_checkpoint_deliveries d
JOIN crm.dashboard_checkpoint_snapshots s ON s.id = d.checkpoint_id
WHERE s.report_day = $1::date
GROUP BY status, result_code
ORDER BY status, result_code;
```

Para comparar a integridade dos dados históricos, o integrador deve preservar
privadamente os agregados antes/depois do deploy. Contagens/valores de negócio
não precisam ser copiados para o Git: registrar igualdade e ausência de
alteração inesperada. A apuração posterior de pedidos pode mudar legitimamente;
o snapshot já preparado deve continuar igual ao originalmente registrado.
Não exigir que um snapshot antigo seja reescrito para igualar dados atuais.

## Regras de evidência e recuperação

`sent` significa que o provedor aceitou a mensagem e devolveu referência válida
para o destino reservado. Não comprova status entregue/lido nem recebimento
pelo sócio. Aceitar como prova distinta um receipt entregue/lido do provedor
vinculado à referência correta ou confirmação do próprio destinatário, sem
publicar conteúdo, referência ou identificação pessoal aqui.

Perda de resposta, timeout, reserva antiga sem conclusão ou status desconhecido
não autorizam nova tentativa de transporte. Não apagar/alterar reservas ou
snapshots para forçar teste; replay operacional só é seguro depois de confirmar
que o destino já tem reserva consumida. Operação pendente não deve ser consumida
como teste de leitura. O outro destinatário mantém estado independente.

Rollback exige pausar apenas o workflow dedicado e desligar a flag antes de
voltar imagem compatível; preservar migrations expand, snapshots e resultados.
`complete` permite terminar/reconciliar efeitos iniciados com a flag desligada.
Não restaurar banco nem modificar workflows comerciais para instalar/reverter
o checkpoint.

## Parecer operacional atual

**Release e agenda confirmadas; primeira entrega ainda não homologada.**
Migrations canônicas, API/worker/edge saudáveis, configuração privada habilitada,
restauração dos estados de autodeploy e publicação do checkpoint às 08h São
Paulo foram confirmadas pelo integrador. Não foi identificado novo bloqueio
estático nas evidências recebidas.

O primeiro agendamento ocorre em 06/11/2026 às 08h SP, sem disparo manual nesta
janela. Snapshot/reserva, aceite do provedor e entrega/recebimento por cada
destino continuam pendentes desse run. A versão publicada e seus settings
foram conferidos por CLI. Leituras humanas autenticadas em produção ainda
não foram anexadas a esta evidência; as negativas sem credencial e o limite
técnico sem efeito estão documentados acima.
ACT-T02 não deve ser descrito como homologação de entrega concluída antes
dessas provas; aceite da API continua distinto de entrega efetiva.

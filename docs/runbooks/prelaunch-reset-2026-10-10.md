# Limpeza operacional antes do lançamento — 10/10/2026

## Autorização e escopo

Operação `OPS-RESET-01`, associada a `INT-3`/`INT-4`, `PRV-02` e à regra 11
de `RULES.md`. O usuário autorizou explicitamente a limpeza dos dados
operacionais de teste de produção, preservando usuários, catálogo e
configurações, com backup prévio e reinício dos pedidos em `01-CRM`.

A autorização de reiniciar a sequência é específica deste ambiente ainda
não lançado. Não estabelece uma rotina de reset após o lançamento.

Destino confirmado: projeto `espectro-mvp`, serviço `silmer-postgres`, banco
`crm_silmer`. Não houve alteração de código, migrations, credenciais, IAM,
configuração dos serviços, workflows ou banco do n8n. O grafo não foi gerado
nem versionado.

## Backups e ensaio

- Backup pelo EasyPanel: `pre-reset-operacional-2026-10-10`, concluído com
  sucesso às 17:10 de 10/10/2026, horário de Brasília; tamanho informado de
  974 kB. Objeto: `espectro-mvp/silmer-postgres/2026-10-10T20:10:41.228Z.sql.gz`.
- Dump adicional, com API/worker/entrada pública pausados e zero outras
  conexões de clientes no banco:
  `/var/lib/postgresql/data/pre-reset-operacional-2026-10-10/database.dump`,
  dentro do volume persistente de `silmer-postgres`. O arquivo passou por
  `pg_restore --list` e teve SHA-256 calculado.
- Esse dump foi restaurado com `pg_restore --exit-on-error` em
  `crm_silmer_reset_drill_20261010`, sem runtime apontado para ele e com
  `CONNECT` revogado de `PUBLIC`. As contagens originais foram recuperadas.
- O script SQL foi ensaiado nessa cópia antes da execução em produção.
  O banco temporário foi removido ao final.
- Os arquivos referenciados foram copiados para
  `/var/lib/crm-chat-media/pre-reset-operacional-2026-10-10/`, no volume
  privado compartilhado pela API e worker. Foram verificados 12 objetos,
  totalizando 880.609 bytes, sem objeto ausente e sem spool pendente.
  `manifest.json` contém chaves opacas, metadados e hashes; não contém
  credenciais. As cópias e o manifesto foram gravados com acesso restrito.

Os backups desta operação são locais à VPS. A restauração isolada do banco
não comprova recovery off-host, perda total do host ou os gates de go-live.
Aplicar a retenção aprovada de até 35 dias também às cópias adicionais:
prazo máximo de 14/11/2026. Não foi criado um agendamento de expurgo.

## Execução

1. Pausados `silmer-edge-web` e `silmer-worker`, isolando a entrada pública
   enquanto a API privada copiava a mídia. A API não tinha domínio público
   próprio configurado. Depois, a API também foi pausada para o dump estável.
2. Confirmados 14 jobs: 10 `completed` e 4 `dead_letter`, sem jobs pendentes
   ou em processamento. Não houve inspeção nem cancelamento de execuções no
   n8n externo; seus dados e workflows foram preservados.
3. Removidos somente os objetos presentes no manifesto, após verificar
   hashes das cópias e dos objetos atuais: 2 objetos de arte/thumbnail pela
   API e 10 objetos de chat pela credencial restrita do worker. Cada remoção
   foi confirmada por `HEAD` retornando ausência. Nenhum bucket, policy,
   credencial, canário ou objeto de outro sistema foi alterado.
4. API, worker e edge pausados novamente; o SQL exigiu ausência de outras
   conexões. Uma primeira tentativa foi bloqueada durante o encerramento
   do worker e revertida; a execução seguinte ocorreu com zero conexões.
5. Aplicada uma transação com inventário explícito de 49 tabelas, locks,
   `TRUNCATE ... RESTRICT`, reinício explícito de `crm.order_number_seq`
   e reconciliação dos contadores de mídia. Não foi utilizado `CASCADE`.
   Os oito triggers de proteção de `TRUNCATE` alcançados foram suspensos
   somente na transação e restaurados no estado original antes do commit.
6. Comparados contagem e fingerprint de todas as linhas das 17 tabelas
   preservadas, além dos limites de quota e definições/estados dos triggers.
   Qualquer divergência abortaria a transação.
7. Mantidos auditoria e registros de idempotência existentes, inclusive
   históricos de segurança/configuração. Acrescentado um evento de auditoria
   `operations.prelaunch-reset`, sem PII, com correlação
   `pre-reset-operacional-2026-10-10`.
8. Reativados API, worker e edge. Nenhum pedido de teste foi criado para
   validar a sequência, preservando `01-CRM` para o primeiro pedido real.

O script e os resultados permanecem no diretório privado do dump como
`reset.sql`, `drill-result.txt` e `production-result.txt`. São evidência de
uma operação autorizada e já concluída; não executar novamente.

## Resultado verificado

| Entidade           | Antes | Depois |
| ------------------ | ----: | -----: |
| Contatos           |   135 |      0 |
| Conversas          |   135 |      0 |
| Mensagens          | 1.427 |      0 |
| Pedidos            |    29 |      0 |
| Arquivos de pedido |     1 |      0 |
| Mídias do chat     |    10 |      0 |
| Usuários           |     3 |      3 |

As 49 tabelas operacionais ficaram vazias. Usuários, permissões, sessões,
throttles, tabelas legadas de identidade, catálogo, configurações,
idempotência e as 31 migrations aplicadas permaneceram idênticos antes da
inclusão do evento de auditoria. Os limites de quota foram preservados;
`used_bytes` e `reserved_bytes` ficaram em zero. O cursor monotônico de
eventos de domínio não foi reiniciado.

`crm.order_number_seq` ficou com `last_value = 1` e `is_called = false`.
Readiness público retornou HTTP 200 e `status: ready`. A sessão administrativa
existente foi restaurada, e a interface confirmou `0 conversas`, `0 contatos`
e `0 confirmados · 0 pendentes`, com atualização automática ativa.

## Recuperação desta operação

Uma recuperação precisa pausar os três serviços novamente. O backup do
EasyPanel possui ação de Restore. Validar primeiro a restauração em um banco
isolado; para o dump adicional, usar `pg_restore` somente em um destino vazio,
preparado e confirmado, nunca diretamente sobre o banco em uso. Restaurar
também cada objeto presente no manifesto, no bucket e chave originais,
verificando seu SHA-256, antes de liberar o
runtime. Usar as credenciais restritas correspondentes sem expô-las em
comandos ou logs. Preservar a cópia dos dados atuais antes de qualquer restore.

Não restaurar o volume compartilhado do RustFS inteiro. Não reiniciar
execuções históricas do n8n como parte da recuperação. Aplicar os controles
de tombstones/retenção do runbook de recovery quando pertinentes.

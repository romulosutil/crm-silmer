# Saúde e erros — operação e recuperação

Data: 02/11/2026. OPS-ERR-01–08 / OPS-ERR-T01;
[ADR 055](../adr/055-central-de-erros-restrita-a-conta-operadora.md),
[RFC 042](../rfc/042-central-de-saude-e-erros.md) e
[issue #11](https://github.com/romulosutil/crm-silmer/issues/11).

## Acesso e uso

O item **Saúde e erros** abre `/saude-erros` no menu existente, inclusive no
celular. Só a conta humana `admin@crm-silmer.local`, ativa, com função
Vendedor e capacidade `COMMERCIAL_ADMIN`, pode consultar ou alterar a triagem.
Outros administradores, Financeiro, vendedores e credenciais de automação
não recebem acesso. A API consulta a identidade atual no banco; trocar
permissões ou desativar a conta impede novas requisições.

Use o filtro para ver Novos, Em análise, Resolvidos ou Todos. **Atualizar**
consulta os dados e coleta novos registros de falha das fontes persistidas.
Se houver coleta pendente, atualize novamente até concluir os lotes. O
horário da última consulta aparece no fuso de São Paulo. Ausência de
ocorrências não confirma saúde dos provedores ou da infraestrutura.

### Ativas, histórico e transporte descontinuado

O recorte inicial **Ativas** usa os estados atuais das fontes, excluindo
comandos arquivados operacionalmente. **Histórico** conserva as ocorrências
deduplicadas dos últimos 14 dias, incluindo revisões anteriores da mesma fonte.
Uma mesma operação pode aparecer em Processamento e Automação n8n; não some
essas contagens como se fossem envios distintos. Datas ativas e históricas são
apresentadas separadamente. Um grupo sem fonte ativa pode continuar em análise
no histórico: isso não confirma entrega nem resolve seu resultado original.

**Arquivar pendências do WAHA** está restrito à conta operadora, com os mesmos
controles de sessão, CSRF, origem, auditoria e idempotência. A revisão congela
quantidade e fingerprint do manifesto. O servidor confere novamente, sob lock,
comandos incertos com reserva autenticada `message.send.requested` da versão
`waha-webjs-1`, da mesma mensagem e conversa. Mudança do manifesto exige nova
consulta (409). Evolution não faz parte desse conjunto.

O arquivo operacional fica em `crm.n8n_command_operational_archives`; não muda
status, erros ou horários de comandos/jobs/mensagens, não fecha reconciliações,
não habilita retry e não apaga recibos ou tentativas. Confirmações tardias ainda
podem reconciliar o resultado pelo contrato existente. A marca acompanha a vida
do comando, independentemente da retenção de 14 dias da central.

Na operação de 03/11/2026, o manifesto esperado é de **12 comandos WAHA**;
o comando Evolution permanece em análise, projetado em worker e n8n. Conferir
essa quantidade antes de confirmar; divergência exige investigação. A migration
`0052_legacy_command_operational_archive.expand.sql` é necessária antes da API.

O desempenho do agente mantém a contagem de `workflow.failed` no período e
mostra última ocorrência e recorrência recente com referência ao relógio da
API. Esses eventos não equivalem a mensagens que falharam nem a uma fila de
pendências. Ausência de novos eventos não comprova correção do workflow.

### Diagnóstico de workflow.failed sem reter execuções

Em 03/11/2026, a leitura de sete dias encontrou 961 eventos: 943 com código
genérico `WORKFLOW_FAILED` e 18 `INBOUND_MEDIA_STORE_FAILED`. Havia 273 eventos
genéricos nas últimas 24 horas e três na última hora; a última ocorrência era
13:55:33 UTC (10:55:33 de Brasília). Portanto, a reconciliação de comandos
antigos não comprova que a causa das falhas recentes foi sanada.

O workflow publicado usa `saveDataErrorExecution: none` e
`saveDataSuccessExecution: none`. Os IDs recentes já não tinham dados de
execução consultáveis. Não habilitar retenção de payloads para esse diagnóstico.
O helper offline `ops/n8n/patch-workflow-failure-diagnostics.mjs` aceita somente
um export atual e altera exclusivamente o nó **Preparar workflow.failed (MVP)**.
Ele deriva um código controlado `WORKFLOW_NODE_<hash>` de cada nome de nó
existente; nomes desconhecidos ficam genéricos. Não encaminha mensagem, stack
ou payload do erro. A API continua guardando somente `failureCode`.

Antes de publicar, guardar export privado, checksum, mapa código/nó e revisão
do delta; comparar nós, conexões, configurações e referências de credenciais.
Preservar todos os demais workflows e publicar somente o principal já ativo.
Depois, observar eventos novos naturais e correlacionar o código com o mapa.
Não repetir execuções, webhooks ou comandos antigos para produzir evidência.
Sem um novo evento ou evidência técnica equivalente, a causa continua aberta.

Diagnóstico publicado pela interface n8n em 03/11/2026 na versão
`28354382-1e4b-4bd6-a9cf-4c559a281da2`, ativa com 113 nós. Conferência após
publicar: somente o Code node de diagnóstico mudou; os 40 outros workflows
mantiveram nós, conexões, configurações e versão ativa. Backup privado e mapa
ficam em `/home/node/.n8n/silmer-recovery/20261103-failure-diagnostics/`.
SHA-256 do export anterior:
`55a19a1f2bdb82fcd9d8a1417cc55b4a10c8643fc03b9566813909ccefc188eb`.

Na continuação de 03/11, seis eventos novos foram correlacionados ao conversor
Evolution e ao motivo `EVOLUTION_IDENTITY_UNRESOLVED`. Os quatro arquivos do
event bus disponíveis cobriam 927 falhas do principal entre 29/10 às
15:31:31.248 UTC e 03/11 às 15:17:36.964 UTC: 648 de identidade, 267 com
mensagem exata de sintaxe e 12 de outras causas. Essa cobertura difere da
janela de sete dias do CRM; não subtrair as contagens nem atribuir todos os
eventos antigos à mesma causa. Nenhum payload foi habilitado ou reexecutado.

OPS-INBOX-ACK-05 publicou a correção do contrato de recibos LID e motivos
controlados no principal, versão `11f17d0b-448a-4b0b-9717-7214fbde858e`,
com três nós alterados e 40 outros workflows preservados. Contrato, backup,
gates e limite da evidência no [runbook Evolution](evolution-baileys.md#recibos-com-lid--03112026).
Somente recibo natural novo pode validar o caminho completo. O histórico de
falhas permanece e o comando Evolution antigo continua incerto/em análise;
publicar a correção não é confirmação de entrega desse comando.

### Falha no registro de diagnósticos em 27/11/2026

OPS-INBOX-ACK-04 / OPS-ERR-04. Nos registros recentes do n8n, 29 execuções
do tratador `Preparar workflow.failed (MVP)` falharam com `command is not
defined`. O gerador de envios pessoais inseria a projeção de origem nesse
nó porque o mapa de diagnóstico contém o nome do nó de reserva. O gerador
agora exige uma declaração de `command` e uma referência à reserva para
alterar eventos de envio, preservando a declaração própria do nó de reserva.

Para aplicar ao workflow principal já publicado, guardar o export privado da
versão ativa e remover somente a expansão `...(command.whatsapp_target ?
{source: …} : {}),` do objeto `payload` em **Preparar workflow.failed (MVP)**.
Conferir que o delta muda somente o código desse nó e que o evento geral
continua sem `source`, com `conversation_id: null` e código controlado. A
verificação em produção depende de uma nova ocorrência natural e do registro
correspondente no CRM. Para reverter, republicar a versão anterior do principal.

Cada grupo reúne uma origem e um código técnico controlado, com contagem,
primeira e última ocorrência e histórico. **Em análise** registra que a conta
operadora assumiu a investigação. **Resolver** encerra a triagem; **Reabrir**
devolve o grupo a Novo. Uma nova falha reabre automaticamente um grupo
resolvido. A conta autorizada é a responsável única, sem atribuição a outros
usuários ou texto livre. Resolver uma ocorrência não corrige o serviço.

Em caso de conflito ou resposta incerta ao salvar a triagem, atualize antes
de tentar novamente. O servidor valida versão e idempotência e mantém
auditoria transacional. Nenhum desses comandos reexecuta jobs, envia
mensagens, confirma pedidos ou altera o comando n8n de origem.

### Rastrear envios incertos — OPS-INBOX-SEND-13

Em **Rastreamento de envios incertos**, use **Consultar rastreamento**.
A consulta é exclusiva da conta operadora e mostra os 50 envios humanos mais
recentes com registro de incerteza nos últimos 14 dias. A mesma operação
aparece uma única vez, mesmo quando worker e n8n a registraram separadamente.
Comandos WAHA arquivados ficam fora da consulta. A referência é calculada
com uma chave privada e permanece igual em consultas sucessivas com essa
chave. Nenhum identificador do provedor, destinatário, conteúdo ou execução
bruta é retornado.

- **Envio confirmado** exige IDs externos concordantes entre mensagem e
  comando e o evento imutável `message.sent` do mesmo envio. **Entrega
  confirmada**, **Leitura confirmada** e **Falha de entrega confirmada**
  exigem também o recibo correspondente.
- **Falha comprovada antes do envio** usa as guardas de OPS-ERR-11.
- **Reserva registrada**, **Sem reserva registrada**, **Resultado incerto
  registrado pelo n8n** e **Registros divergentes** deixam o resultado em
  aberto. Ausência de recibo ou de execução retida não prova falha.
- O poll já existente pode concluir uma pendência se receber uma prova
  autenticada tardia. O rastreamento apenas lê a evidência. A consulta não
  envia, repete tarefas, altera a triagem ou modifica o histórico.

Rollback consiste em restaurar a versão anterior do app. A consulta não
adiciona tabela ou amplia a retenção dos registros operacionais.

## Cobertura e diagnóstico

| Origem | Códigos                                                        | Como investigar                                                                                     |
| ------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| API    | `API_5XX`, `API_NOT_READY`                                     | Conferir readiness, release/migrations e logs técnicos do EasyPanel pela referência opaca.          |
| Worker | `WORKER_RETRY`, `WORKER_DEAD_LETTER`, `WORKER_OUTCOME_UNKNOWN` | Conferir fila, tentativas e runbook da integração, preservando o efeito original.                   |
| n8n    | `N8N_FAILED`, `N8N_OUTCOME_UNKNOWN`, `N8N_PROCESSING_EXPIRED`  | Conferir comando e execução no ambiente autorizado, sem copiar payload ou credencial para o painel. |

Captura de 5xx começa com a implantação desta versão; não reconstrói logs
antigos. Coleta das filas consulta estados de falha registrados no CRM nos
últimos 14 dias, em lotes limitados e deduplicados. Não é o histórico completo
de execuções n8n, heartbeat de todos os serviços ou monitor direto de IA,
WhatsApp e storage. Uma mudança de estado/código da fonte pode produzir
outra ocorrência; repetir a mesma coleta não incrementa a contagem.

Diagnósticos guardam códigos fixos, contagens, horários e identificadores
opacos, sem stack, corpo, mensagem ou dado de cliente. Não acrescente detalhes
livres, nomes, telefone ou credenciais aos registros e evidências. Dados
técnicos seguem uma janela de 14 dias, incluindo a contagem e a primeira
ocorrência dos grupos ativos. A API limpa os registros na inicialização, a
cada 24 horas, sem executar limpeza na consulta; a consulta filtra a janela mesmo se a
limpeza estiver atrasada. Com o processo parado, o expurgo físico aguarda o
retorno da API. Auditoria e respostas idempotentes conservam suas políticas
próprias, sem transportar diagnósticos livres.

Resultado desconhecido exige conferir o destino e reconciliar conforme o
runbook da integração. Não reenviar às cegas: a mensagem pode ter chegado.
O painel não oferece esse reenvio.

## Implantação e rollback

O gate PostgreSQL de OPS-ERR-T01/OPS-ERR-05 consulta `view=history` após a
disputa entre Novo e Resolvido: qualquer transição pode vencer, e a visão
Ativas exclui o grupo resolvido da API. A regressão também verifica que o
grupo resolvido sai de Ativas e permanece no Histórico com a mesma versão,
independentemente do vencedor. Isso evita a falha intermitente identificada
no CI pós-merge de 04/11/2026, sem mudar a triagem ou a aplicação.

1. Validar a migration `0051_operational_incidents.expand.sql` no banco
   dedicado de testes, com dados sintéticos e os testes de ACL/triagem.
2. Aplicar migrations expand no ambiente alvo com o procedimento existente:
   `node /app/modules/database/src/cli.js --phase=expand`. Conferir checksum e
   readiness. O painel depende das novas tabelas.
3. Implantar a API e o edge-web pelo fluxo GitHub → EasyPanel vigente.
4. Com a conta designada, conferir menu, leitura e triagem de um canário
   sintético; com outra conta administrativa, conferir menu ausente e API403.
   Não provocar indisponibilidade real ou envio de WhatsApp para esse teste.
5. Conferir persistência após reiniciar a API e ausência de PII no retorno e
   nos logs. Registre SHA/digest e evidências operacionais sanitizadas.

Rollback restaura a versão anterior da aplicação e mantém as tabelas expand,
sem apagar auditoria, jobs, comandos ou banco. Não executar migration
destrutiva como primeira resposta. A implementação local não comprova que a
migration foi aplicada em produção.

## Alertas externos

Esta entrega oferece consulta e triagem dentro do CRM. Monitor off-host,
destinos de notificação, operador, retenção e drills continuam em
[T00.7](../../ops/observability/README.md) e no gate `pending-external` da
issue #11. Se API ou banco estiverem indisponíveis, o painel também pode
ficar indisponível. Não registrar essa tela como comprovação de monitor ou
entrega de alertas externos.

## Saúde operacional — ADR 060 / OPS-HEALTH-T01

### Relógio do dispositivo — correção em 12/11/2026

OPS-HEALTH-T01 / OPSUI-03: a interface comparava `checkedAt` ao relógio do
dispositivo. Um computador cerca de 45 segundos atrasado podia mostrar
**Saúde operacional indisponível**, mesmo com HTTP 200 e os três checks `ok`.
Atualizar às vezes parecia resolver, dependendo da idade da amostra de 60s.

A leitura agora usa o cabeçalho HTTP `Date` canônico da mesma resposta como
referência, tanto no sucesso quanto no JSON 503. Sem um Date válido, conserva
o fallback local. Continua recusando amostras com mais de 120s, mais de 5s
no futuro da referência, corpo inválido ou falha de rede. Não transforma
503 degradado em saudável e não modifica os relógios do sistema operacional.
O servidor/proxy deve manter seu próprio relógio sincronizado.

Na inspeção de 12/11, o endpoint público estava saudável; a central mantinha
94 ocorrências API_5XX e uma operação incerta projetada em worker e n8n.
Esses registros não são resolvidos pela correção de apresentação nem pelo
filtro de álbum. O conector EasyPanel retornou HTTP 400; a sessão autorizada
da interface permitiu consulta técnica em transação `READ ONLY`, limitada
a estados, códigos e datas. O comando terminou com `N8N_COMMAND_TIMEOUT`,
sem recibo de provedor, reserva ou tentativa de entrega registrada no CRM.
Ausência desses registros não autoriza reenvio nem comprova entrega.
Não reenviar, arquivar ou marcar resolvido para limpar o painel.

No mesmo intervalo, o event bus do principal registra uma execução com
espera de cerca de 11,5s pelo runner no normalizador e interrupção em
**CRM - Reservar envio humano (MVP)**. Isso é compatível com expiração do
HTTP de 10s antes da reserva. A correlação temporal não substitui vínculo
inequívoco com o comando e não resolve seu resultado. Não aumentar o timeout
para 30s sem tratar o lease/renovação do job; ver
[guardas de timeout](inbox-delivery-feedback.md#reconciliação-da-fila-após-confirmação-tardia--03112026).

### Publicação e investigação — 12/11/2026

O delta de álbum da PR 360 foi publicado pela UI do n8n na versão
`1d1cc78c-9b3a-492b-ad78-0f278e537255`. Export privado publicado e rascunho
antes da edição eram idênticos (144 nós). O helper do commit mesclado foi
verificado por SHA-256 e aplicado à cópia privada. Comparação READ ONLY antes
e depois da publicação confirmou nodes/connections/settings iguais ao delta
esperado; outros 46 workflows conservaram os fingerprints. Álbum isolado,
imagem filha e texto passaram com entradas sintéticas no código conferido,
sem executar o workflow nem enviar mensagens. Backups permanecem privados no
volume persistente; não versionar exports com configuração real.

Os API_5XX somavam 105. A investigação do bloqueio atual de criação encontrou
o escritor truncando números acima de 99; ver
[ORD-NUM-01](order-numbering.md). A agregação histórica não identifica uma
causa única. O conector de logs continua HTTP 400 e a configuração de agregação
retornou ausente. O buffer obtido pela UI não continha a referência da última
falha; não inferir ausência de erro a partir dessa amostra incompleta.

O comando incerto de 11/11 continua `outcome_unknown`, com
`N8N_COMMAND_TIMEOUT`, sem ID externo e com retry/replay desabilitados.
Não foi reenviado, arquivado ou reconciliado apenas para limpar alertas.
O event bus preserva falha na reserva humana no mesmo intervalo; falta vínculo
inequívoco da execução com o comando para declarar seu resultado.

### Investigação individual sem reenvio — 15/11/2026

OPS-INBOX-SEND-12 / MSG-02/03, ORC-08 e PRV-01. A nova consulta da operação
de 11/11 às 16h11 identificou o comando individual no CRM, com uma tentativa
de fila, `N8N_COMMAND_TIMEOUT`, comando/mensagem/job `outcome_unknown`, flags
de retry desabilitadas e nenhum ID externo. Não há evento n8n, tentativa de
entrega, execução vinculada na mensagem ou auditoria de conclusão para esse
comando. Consultas limitaram-se a códigos, estados, datas e referências técnicas,
em transações `READ ONLY` com prazo de quatro segundos.

O banco do n8n não contém a execução 95228 nem seus dados. Entre os IDs 95220
e 95240, a única execução retida é de outro workflow e não contém o comando.
Os quatro arquivos atuais do event bus não contêm o comando nem a execução;
a janela mais antiga disponível começa em 13/11 às 13h31 de Brasília. As
cópias técnicas anteriores consultadas antecedem o incidente. A falha na reserva
descrita na investigação de 12/11 permanece evidência temporal, sem vínculo
individual recuperado. O conector de logs voltou a retornar HTTP 400.

O banco do Evolution conserva registros no intervalo. A comparação de resumo
SHA-256 com sal efêmero de texto/destino do envelope CRM contra os campos de
texto e JID telefônico dos envios nos cinco minutos seguintes não encontrou
correspondência entre os 11 candidatos. Conteúdo, telefone, sal e resumos não
são publicados na evidência versionada. A consulta cobre esses campos e essa
janela; ausência de correspondência não prova falha nem exclui outro formato,
retenção incompleta ou efeito fora do intervalo. Nenhum transporte foi chamado.

O teste `OPS-INBOX-SEND-12` em `test/n8n-command-worker.test.js` compõe o
cliente HTTP e o worker com servidor loopback sintético que recebe o comando
e aguarda antes dos cabeçalhos/reserva. Confere a fronteira do worker antes
do request, um único POST com bytes e chave idempotente originais, timeout
incerto sem retry, ausência de recibo inventado e minimização no store.
Liberar um ACK válido depois do cancelamento não altera o resultado concluído.
O endpoint sintético não executa reserva, workflow ou envio real.

Gate local completo aprovado: 2.780 testes, 53 condicionais ignorados, sem
falhas; formatação, tipos, lint, fronteiras, validadores e build aprovados.
E2E/axe da central: 22 aprovados; auditoria de dependências sem vulnerabilidades.
Node local 24.22.1/npm 11.19.1; o CI continua fixado nas versões do projeto.
Sem `TEST_DATABASE_URL`, esse gate não comprova a suíte PostgreSQL.

Resultado da investigação: ainda não há prova individual suficiente para
reconciliar o comando como enviado ou como falha conhecida. Manter os grupos
worker/n8n em análise e preservar estados, tentativas e histórico. Não usar o
teste sintético, saúde verde ou ausência de registros para marcar a pendência
resolvida. Uma conclusão futura exige recibo verificável ou prova da execução
exata e encerrada antes do transporte, com auditoria e sem reenviar o original.

### Reverificação do envio incerto e da publicação — 15/11/2026

OPS-INBOX-SEND-12V / MSG-02/03, ORC-08, OPS-ERR-03/06/10/11 e PRV-01.
A consulta atual, em transação `READ ONLY` com limite de quatro segundos,
confirmou que o comando de 11/11 às 16h11 permanece `outcome_unknown`, com
`N8N_COMMAND_TIMEOUT`, `retryable=false` e `retry_safe=false`. A central ainda
mostra uma fonte ativa em Automação n8n, Em análise. O grupo de Processamento
aparece Resolvido, mas conserva uma pendência ativa: triagem não comprova
reconciliação. A API executa a revisão `ee026468`.

A mitigação OPS-INBOX-SEND-11 **já está publicada**, apesar do checklist
anterior ainda pendente. A leitura do banco n8n confirmou workflow principal
`k7tI6T4RhQPyJkn9` ativo, com 144 nós, e versão publicada
`52b39398-f0b0-4458-8899-22598b95f371`. A revisão foi criada em
13/11/2026 às 18h02 de Brasília; os arrays de nós publicados e do rascunho
são iguais. Os dois nós são `n8n-nodes-base.set`, versão 3.4, modo `raw`.
Os hashes SHA-256 de `jsonOutput` coincidem com os esperados pelo helper:

| Nó                                     | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| Normalizar comando do painel (MVP)     | `a332ad78e96830a8429ffcbc7c371109698ae316bfc9e8ed2526a35746e57e73` |
| Preparar reserva de envio humano (MVP) | `ca2aacc563ab25fd150432c297cc13cdc963ff9d961a2d52a787341ad804150e` |

Essa verificação confirma a implantação dos dois nós, sem reconstruir a
evidência de backup, preservação dos demais workflows ou avaliação isolada no
runtime exigida para a publicação. Não houve edição, publicação, execução de
workflow ou transporte nesta revisão. A execução 95228 continua ausente do
banco n8n; a publicação posterior não prova o resultado do comando histórico.

Regressão reexecutada: 38 testes de cliente HTTP, worker, stores, API/UI da
central e patch; 22 E2E da central, incluindo teclado e axe, todos aprovados,
sem skips nessas seleções. Os testes HTTP loopback foram executados fora da
restrição de rede do sandbox. O build do E2E passou; esta seleção não executa
o gate PostgreSQL nem comprova uma entrega real. Não foi encontrada lacuna
funcional nova que justificasse alterar o transporte. O fechamento histórico
continua dependendo da prova individual indicada acima, sem retry ou baixa
administrativa para ocultar a pendência.

O gate completo `npm run validate` também passou nesta revisão: 2.780 testes
aprovados, 53 condicionais ignorados e nenhuma falha; formatação, tipos, lint,
fronteiras, validadores e build aprovados. `npm audit --audit-level=high`
retornou zero vulnerabilidades. Sem banco de testes configurado, os testes
PostgreSQL condicionais continuam fora dessa evidência local.

### Inicialização com schema compatível — OPS-ERR-BOOT-01

Na triagem após o rollout WAP-E04 de 17/11/2026, a compilação da API no
EasyPanel terminou às 17h51 de Brasília. O worker registrou falhas de poll a
partir de 17h52. Às 17h56, a API já atendia requisições e retornava HTTP 500
com SQLSTATE `42P01` (relação ausente). O último `API_NOT_READY` aparecia às
17h57 e o último `API_5XX` às 18h01. Na revisão após a virada do dia,
live, ready e saúde operacional voltaram a responder HTTP 200. A amostra
correlaciona falhas de inicialização e não explica todos os 5xx de 14 dias.

Aplique as migrations expand da revisão candidata pelo procedimento da
[topologia](../../EASYPANEL-TOPOLOGY.md#9-migração-e-rollback) antes de
promover API e worker. Os dois processos verificam a conectividade e o checksum
de cada migration expand necessária antes de abrir a porta ou iniciar o
consumo das filas. `DATABASE_SCHEMA_NOT_READY` indica expansão ausente ou
incompatível. Confira a revisão e o histórico no banco, aplique a expansão
aprovada pelo runner dedicado e confira a nova tentativa de deploy. Divergência
de checksum exige investigação. A inicialização não aplica migrations.
Depois do rollout confira SHA, live, ready, operação e recorrência na central.
Rollback usa somente uma revisão compatível com o schema aplicado.

O histórico continha seis grupos, dois já resolvidos. As visões do worker e
do n8n mostravam oito pendências cada, entre 11/11 às 16h11 e 17/11 às 18h02.
Os grupos podem projetar as mesmas operações. Saúde verde e a trava de
inicialização não comprovam o resultado de nenhum envio. O encerramento
individual exige o vínculo e a prova de OPS-ERR-10/11. Preserve a trilha
original e não execute replay nem reenvio como parte da triagem.

### Referências nginx — OPS-ERR-04/05

A coleta anterior descartava IDs nginx de 32 hex ao exigir versão/variant
de UUID. Os registros API_5XX inspecionados não tinham referência de request.
A correção conserva os mesmos 128 bits em `request_id`/`correlation_id`, no
formato canônico `8-4-4-4-12` das colunas UUID existentes. Não gera novos IDs
nem altera os bits de versão/variant de identificadores opacos. Para buscar
o ID nos logs nginx, remover os hífens; letras são normalizadas para minúsculas.
UUIDs existentes são preservados e a leitura usa a mesma normalização.
Texto livre, telefone, endereço e formatos/tamanhos inadequados são recusados.
Não há migração, novo payload de diagnóstico ou preenchimento retroativo.
As causas dos 5xx históricos permanecem abertas até correlação comprovada.

Testes de intake e projeção cobrem UUID e nginx com bits arbitrários, casos
negativos sem PII e persistência/atualização em PostgreSQL no gate live do CI.

Regressão cobre relógios do navegador dez minutos adiantados/atrasados,
sucesso, JSON 503 degradado, amostra vencida/futura e Date ausente/inválido,
além de ACL, abort, teclado e acessibilidade existentes. Rollback restaura
somente o código anterior do edge-web; sem migração ou alteração de dados.

### Transformações anteriores à reserva — OPS-INBOX-SEND-11

O delta `ops/n8n/patch-panel-reservation-fast-path.mjs` prepara offline a
substituição de dois Code nodes por Edit Fields (Set 3.4), em modo JSON com
expressão: `Normalizar comando do painel (MVP)` e
`Preparar reserva de envio humano (MVP)`. A transformação mantém a lógica,
mas deixa de despachar essas duas tarefas ao runner externo. A reserva HTTP,
fences, idempotência, credenciais e envio ao provedor permanecem inalterados.

Usar somente export privado recém-obtido do workflow publicado. Guardar
publicado e draft antes da alteração; interromper se houver edição concorrente.
Executar `node ops/n8n/patch-panel-reservation-fast-path.mjs current.json review.json`
em diretório privado, fora do Git. O helper exige hashes, IDs únicos, contexto e
conexões conhecidos; recusa drift e aplicação parcial. Não publica nem executa
o workflow. Conferir que o diff contém somente os dois nós e publicar o delta
pela interface do n8n, preservando os demais workflows. Reaplicar esta proteção
em futuras publicações que partam de templates antigos.

Validar no runtime instalado com entrada sintética, avaliando somente os dois
Set nodes isolados, sem executar workflow, webhook ou HTTP. Conferir JSON de
saída, pairedItem e descarte de headers/binários. Regressão local cobre 360
combinações de roteamento, equivalência da reserva, contexto divergente,
atomicidade e idempotência. Conferir a versão efetivamente publicada e os hashes
dos demais nós, conexões, settings e workflows após publicar. Rollback restaura
somente esses dois nós do backup revisado; nunca reproduz uma execução antiga.

Esta mitigação não prova o resultado de um envio histórico. A execução temporal
95228 teve 9,687s antes de solicitar a tarefa ao runner e 11,452s no normalizador;
a falha posterior ocorreu na reserva. Sem vínculo e recibo conclusivos, manter
os incidentes `WORKER_OUTCOME_UNKNOWN` e `N8N_OUTCOME_UNKNOWN` em análise,
sem retry, replay ou alteração do estado da mensagem.

### Códigos PostgreSQL nos logs — OPS-ERR-DIAG-01

O hook HTTP já entregava `error.code` ao logger, mas a allowlist descartava os
SQLSTATE como `UNCLASSIFIED_ERROR`. O caso 23514 foi reproduzido pelo teste
HTTP da criação no pedido 100. A correção aceita somente categorias conhecidas:
08006, 22P02, 23502, 23503, 23505, 23514, 40001, 40P01, 42703, 42P01, 53300,
55P03, 57014, 57P01 e DATABASE_CONNECTION_TIMEOUT. Não aceita um padrão livre
de cinco caracteres. O request/correlation já existente permite seguir a causa.

Mensagem, SQL, detalhe da linha, tabela e nome de constraint permanecem fora
dos logs seguros. O teste HTTP cobre a lista técnica, correlação e tentativas
de inserir telefone ou texto misturado no código. A classificação não altera
resposta HTTP, agrupamento API_5XX, métricas, ACL ou estado de mensagem.
Não preenche retroativamente causas dos eventos antigos já redigidos.

### Contrato do endpoint e amostragem

GET /api/health/operations é público, sem dados pessoais e sem I/O por request.
Retorna200 com status ok ou503 com degraded/unavailable, checkedAt e checks
worker/queue/commands. Não usar para restart ou readiness de roteamento.

A API amostra uma vez por60s. Snapshot ausente, falho ou com mais de120s
retorna503. Workers publicam a cada30s heartbeat e último poll concluído
por fila obrigatória; atraso acima de120s degrada. Fila pending/retry elegível
acima de300s e comandos processing com lease expirado há mais de120s
degradam. Retry futuro não é atraso; falha histórica isolada não derruba health.
CHAT_MEDIA_ENABLED acrescenta chat_media às filas obrigatórias; external_effects
e media-retention são sempre exigidas. Nenhum probe chama n8n/WhatsApp/IA.

Migration0058 antecede API/worker e cria tabela técnica e índices parciais.
Antes de aplicar, medir tamanho das tabelas e usar janela de baixa carga.
CREATE INDEX transacional pode bloquear escritas enquanto constrói o índice;
lock_timeout100ms e statement_timeout1s fazem a migration falhar e reverter
em vez de aguardar/bloquear por tempo ilimitado. Falha exige nova avaliação
da janela, sem aumentar limites cegamente ou declarar implantação concluída.
Leituras usam lock_timeout100ms e statement_timeout1s; não tomam locks de
linhas de domínio. Requisições simultâneas ao endpoint apenas leem memória.
Worker publica com uma execução por vez e stop aguarda trabalho em andamento.
O progresso do poll expira mesmo que o timer continue vivo.

Limpeza inicia no boot para recuperar paradas e repete a cada24h. Cada
transação remove até1000 linhas por tabela técnica com try-lock e timeouts,
sem cascatas grandes; pais aguardam drenagem dos filhos. Cada rodada diária
processa até20lotes, cedendo execução entre transações, com orçamento de5s
avaliado entre lotes; backlog/lock ocupado/falha gera OPERATIONAL_CLEANUP_INCOMPLETE. Dados vencidos são
excluídos da leitura antes do expurgo físico. Reiniciar pode antecipar catch-up.
Backlog ou contenção deve ser investigado; a retenção de mensagens, comandos,
jobs e auditoria não muda. Eventos de saúde não alimentam a coleta de incidentes.

Verificação local: testes operational-health, operational-signals-postgres-live
e health-errors-retention com banco sintético dedicado. EXPLAIN verifica
índices, sem prometer ausência de impacto na carga real. Conferir latência,
locks e duração da amostragem após deploy. Rollback restaura aplicação anterior
compatível, mantém schema expand e não recupera diagnósticos já expurgados.

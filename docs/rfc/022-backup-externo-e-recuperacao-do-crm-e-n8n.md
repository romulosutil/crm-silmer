# RFC 022 — Backup externo e recuperação do CRM e do n8n

Status: proposta operacional, 14/10/2026. Nenhum destino, segredo ou agenda foi
alterado em produção por esta RFC.

Responsável: Tech Lead. Decisão e execução pendentes do proprietário da
infraestrutura. Se a escolha mudar a topologia aprovada, registrar a decisão
em um novo ADR e atualizar o
[desenho operacional](../../EASYPANEL-TOPOLOGY.md#10-backups-e-disaster-recovery).

Requisitos: [INT-3 e INT-4](../../.specs/features/crm-mvp/tasks.md),
[RULES 15](../../RULES.md), [ADR 023](../adr/023-arquivos-da-arte-no-rustfs.md).
Relações: [issues #3](https://github.com/romulosutil/crm-silmer/issues/3),
[#11](https://github.com/romulosutil/crm-silmer/issues/11),
[#29](https://github.com/romulosutil/crm-silmer/issues/29) e
[PR #173](https://github.com/romulosutil/crm-silmer/pull/173).

## Evidência observada

Em 14/10/2026, no EasyPanel `31.97.170.105:3000`:

- `espectro-mvp/silmer-postgres` tinha apenas o provedor `Local Disk`, com
  execução manual. A cópia `pre-cp-t04-0038-0040-2026-10-14` terminou com
  sucesso, mas permanece na mesma VPS.
- `schedule/n8n-db` era o destino de `DB_POSTGRESDB_HOST` do serviço n8n e a
  tela de backups mostrava **nenhuma configuração**. O nome do banco no n8n é
  `$(PROJECT_NAME)`; confirmar o nome resolvido pelo seletor do EasyPanel antes
  de salvar uma agenda ou restaurar.
- `schedule/n8n` tinha volume em `/home/node/.n8n`, sem backup de volume no
  EasyPanel. `N8N_ENCRYPTION_KEY` estava configurada no ambiente; seu valor não
  foi lido nem copiado.
- Configurações do servidor → Provedores de Armazenamento listava apenas
  `Local Disk`. `silmer-chat-spool-init` prepara permissões do volume
  temporário e não é serviço de backup.
- Não foi apresentada evidência de backup fora da VPS, teste de restauração,
  escrow de chaves ou drill de perda total.

Essas telas descrevem o estado do EasyPanel; um snapshot externo do provedor
da VPS, se existir, requer evidência própria. O proprietário informou que não
há cópia externa nem teste de restauração conhecido.

## Proposta

Usar um destino **S3 compatível em conta e infraestrutura externas à VPS**, com
bucket exclusivo para recuperação da Silmer, credenciais restritas e caminhos
separados. O EasyPanel já suporta esse tipo de provedor para dumps lógicos de
PostgreSQL; o mesmo bucket pode receber uma cópia **somente** do bucket
`crm-silmer-arquivos` do RustFS por um processo separado e auditável. O RustFS
atual, que divide a VPS com os bancos, não é destino externo.

Escolher o provedor, a região, a titularidade, a política de retenção e o custo
antes da configuração. Nenhuma credencial, URL assinada ou valor de chave deve
entrar em Git, logs, prints ou tickets. O operador registra no cofre o ID do
bucket, o endpoint, os papéis autorizados e a rotação, sem copiar segredos para
esta RFC. Conferir se a licença do EasyPanel habilita agendas automáticas.

### Configuração a aplicar após escolher o destino

| Origem                                | Agenda inicial        | Retenção  | Prefixo exclusivo no destino  |
| ------------------------------------- | --------------------- | --------- | ----------------------------- |
| `silmer-postgres`, banco `crm_silmer` | Horária, `0 * * * *`  | 48 cópias | `crm-silmer/postgres/hourly/` |
| `silmer-postgres`, banco `crm_silmer` | Diária, `10 2 * * *`  | 35 cópias | `crm-silmer/postgres/daily/`  |
| `n8n-db`, banco confirmado no painel  | Horária, `20 * * * *` | 48 cópias | `crm-silmer/n8n-db/hourly/`   |
| `n8n-db`, banco confirmado no painel  | Diária, `30 2 * * *`  | 35 cópias | `crm-silmer/n8n-db/daily/`    |

O horário usa o fuso do servidor, a verificar. Os minutos desencontrados
reduzem disputa de CPU e rede. Cada agenda usa um prefixo próprio porque a
retenção do EasyPanel apaga os arquivos mais antigos encontrados **no caminho
daquela configuração**. Aplicar lifecycle no provedor para remover cópias com
mais de 35 dias, sem antecipar a retenção exigida pelo produto. Monitorar a
idade da última cópia concluída e alertar antes de ultrapassar o RPO alvo de
uma hora; a agenda por si só não comprova esse RPO.

Copiar o bucket `crm-silmer-arquivos` para prefixo próprio, sem espelhar nem
restaurar o volume inteiro de `schedule/rustfs`, que contém outros projetos.
Usar leitura limitada ao bucket de origem, escrita limitada ao destino,
versionamento e retenção compatíveis com a decisão de privacidade. O processo
deve registrar manifesto de objetos e hashes sem nomes ou conteúdo pessoal em
logs. Reaplicar o ledger externo de `deletion_tombstones` em todo restore;
guardá-lo fora do conjunto restaurado por pelo menos 36 dias ou até expirar a
última cópia relacionada. O método exato de cópia e a credencial serão
revisados com a escolha do provedor antes de qualquer execução.

Guardar `N8N_ENCRYPTION_KEY` e as chaves de criptografia do CRM em escrow
criptografado com acesso de duas pessoas designadas. O backup do banco do n8n
sem sua chave não recupera as credenciais dos workflows. O kit off-host inclui
topologia, digests, versões, DNS, sequência de migrations e inventário de
segredos, mas nunca seus valores em claro.

Inventariar `/home/node/.n8n` antes da ativação: se houver binários, nós
customizados ou configuração indispensável fora do PostgreSQL, incluir esse
volume em backup externo próprio e testar sua restauração junto com o banco.
O backup de volume do EasyPanel sincroniza arquivos e pode capturar escrita em
andamento; coordenar uma janela sem escrita ou justificar por evidência a
exclusão de dados transitórios. Não presumir que o dump do banco cobre o volume.

## Sequência de ativação e evidência

1. Criar bucket externo e credenciais restritas; habilitar versionamento e
   lifecycle, registrar responsável e orçamento. Adicionar o provedor em
   EasyPanel → Configurações → Provedores de Armazenamento.
2. Criar as quatro agendas de banco nos serviços corretos. Executar cada uma
   manualmente, verificar `Success` **e** a existência, tamanho e data do
   objeto no provedor. Guardar identificador do objeto e checksum em registro
   operacional sem dados pessoais.
3. Inventariar e, se necessário, proteger o volume do n8n. Implantar a cópia
   seletiva do bucket RustFS e o ledger de tombstones; testar uma execução
   manual e verificar objetos e hashes no destino externo.
4. Restaurar os dois bancos e somente o bucket da Silmer em serviços temporários
   isolados, sem rotas públicas, worker, IA, Pix ou WhatsApp ativos. Recuperar
   chaves do escrow por operador autorizado e conferir workflows, schema,
   contagens, constraints, leitura/escrita sintética e amostra de arquivos.
5. Medir duração e idade dos pontos restaurados; registrar RPO/RTO reais,
   falhas, responsáveis e caminho de rollback. Habilitar agendas e alertas de
   atraso/capacidade. Fazer restore mensal e drill trimestral em VPS limpa,
   conforme o desenho operacional.
6. Só após essas evidências revisar a promoção do [PR #173](https://github.com/romulosutil/crm-silmer/pull/173):
   migrations `0038`–`0040`, API/worker/edge por SHA e digest, smoke do CRM,
   atualização do workflow n8n e homologação do chat nessa ordem.

Não executar o botão **Restaurar** sobre os bancos de produção para testar a
cópia: o restore do EasyPanel substitui dados no alvo. Um backup `Local Disk`
não protege contra perda da VPS. Snapshots do provedor da VPS são proteção
terciária e não substituem dumps externos, cópia seletiva do bucket e drill.

## Pontos de decisão

- Provedor e conta externos, região, custo e titularidade; possibilidade de
  versionamento e recuperação de versões apagadas.
- Responsáveis por criar e guardar credenciais, escrow e alertas, com acesso
  mínimo e substituto definido.
- Método de cópia seletiva do RustFS e de armazenamento do ledger externo,
  sem novo serviço de produção até autorização explícita e revisão do desenho.
- Janela e ambiente isolado para o primeiro restore e para o drill de host
  limpo, com critérios de aceite de RPO ≤1 h e RTO ≤4 h.

Referências de operação: [Easypanel Backups](https://easypanel.io/docs/backups),
[Database Backups](https://easypanel.io/docs/backups/database) e
[S3-Compatible Storage](https://easypanel.io/docs/storage-providers/s3),
além de [Volume Backups](https://easypanel.io/docs/backups/volumes).

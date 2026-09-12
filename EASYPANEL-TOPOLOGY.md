# Topologia EasyPanel — CRM Silmer

> **Status:** baseline do CRM aprovada; extensão obrigatória do n8n pendente de provisionamento e gate operacional
>
> **Data:** 31/08/2026; revisão arquitetural em 06/09/2026
>
> **Host:** Hostinger VPS com Ubuntu 24.04 e EasyPanel

## 1. Decisão

> **Atualização em 12/09/2026:** este é o ambiente cloud-dev, não produção.
> A fonte de deploy rápido é a branch `dev`, conforme RFC 003/ADR 004 e
> `ops/easypanel/CLOUD-DEV.md`. O fluxo por digest de `master` permanece como
> referência de release e não bloqueia testes remotos.

Usar o projeto EasyPanel compartilhado e duradouro `espectro-mvp`. Os serviços
do CRM recebem o prefixo `silmer-`, que define sua fronteira operacional dentro
do projeto. O desenvolvimento e os testes técnicos continuam locais ou no CI.

A decisão elimina projetos separados de desenvolvimento, homologação e produção.
O risco de isolamento reduzido e de competição com serviços não relacionados foi
aceito para o piloto. A evolução para projeto ou host próprio passa a ser exigida
quando os gatilhos da seção 13 forem atingidos.

Não criar projeto de observabilidade dentro da mesma VPS: o monitor de uptime
precisa estar fora do domínio de falha do host. O n8n é obrigatório no MVP e
entra no projeto `espectro-mvp` com o prefixo `silmer-`, persistência própria,
sem acesso direto ao banco do CRM e com somente o webhook do canal publicado.

## 2. Serviços no projeto

| Serviço           | Tipo EasyPanel     | Imagem                                 |                 Público | Persistência                                  |
| ----------------- | ------------------ | -------------------------------------- | ----------------------: | --------------------------------------------- |
| `silmer-edge-web` | App                | GHCR por digest                        | Sim, 80/443 via domínio | Nenhuma                                       |
| `silmer-api`      | App                | GHCR por digest                        |                     Não | Volume de mídia leitura/escrita ao ativar T02 |
| `silmer-worker`   | App                | Mesma imagem runtime, comando distinto |                     Não | Volume de mídia leitura/escrita ao ativar T02 |
| `silmer-postgres` | PostgreSQL Service | Major fixada                           |                     Não | Volume EasyPanel + backup externo             |
| `silmer-n8n`      | App                | n8n por versão e digest fixados        |                     Não | Nenhuma; usa banco próprio                    |
| `silmer-n8n-db`   | PostgreSQL Service | Major fixada                           |                     Não | Volume EasyPanel + backup externo             |

`migrate` é um job curto executado pelo pipeline ou script salvo do EasyPanel;
não é serviço permanente.

O inventário executável atual em `ops/easypanel/topology.json` continua sendo a
evidência do que já foi provisionado e ainda não contém n8n. A etapa AGENTE-1
deve atualizá-lo junto da configuração e da prova live; este planejamento não
pode ser usado para afirmar que os dois novos serviços já existem.

Não subir no MVP:

- Redis ou BullMQ;
- MinIO;
- Elasticsearch ou Meilisearch;
- Grafana, Prometheus ou Loki próprios;
- banco/admin UI permanentemente habilitado.

## 3. Rede e domínios

```text
Internet e Meta
      |
   HTTPS 443
      |
silmer-edge-web (único serviço público)
   |-- /                         bundle estático da SPA Vue
   |-- /api/*                    silmer-api:8000
   |-- /webhook/meta/*           silmer-n8n:5678
   `-- /api/v1/events            silmer-api:8000 (SSE)
          |                              |
          |                       silmer-postgres privado
          |                              |
          |                       silmer-worker privado
          |
   silmer-n8n privado --------> silmer-api privada
          |
   silmer-n8n-db privado
          |
   Meta / OpenAI ou Gemini
```

Domínios propostos, substituindo `<dominio>` pelo domínio aprovado:

| Finalidade   | Domínio               | Proteção adicional                                  |
| ------------ | --------------------- | --------------------------------------------------- |
| CRM          | `crm.<dominio>`       | Login da aplicação, HSTS e rate limiting            |
| webhook Meta | `hooks.crm.<dominio>` | Público somente na rota WhatsApp do n8n             |
| EasyPanel    | `ops.<dominio>`       | VPN/allowlist, MFA obrigatório e contas individuais |

VPN, allowlist ou Basic Auth não podem bloquear o callback público da Meta. O
host `hooks.crm.<dominio>` roteia somente o caminho publicado do webhook do
n8n; editor, API administrativa e demais rotas retornam `404`. Assinatura,
verify token, limite de corpo e rate limit permanecem no workflow e no proxy.
O n8n acessa o CRM somente pela API privada e não recebe rota ou credencial para
`silmer-postgres`.

### Firewall Hostinger

- `80/443`: público.
- `22`: somente IP administrativo ou VPN.
- Painel EasyPanel: somente VPN/allowlist.
- PostgreSQL e portas internas: nunca publicados.
- Remover qualquer porta de teste depois do diagnóstico.

## 4. Sizing inicial

Baseline recomendada: **Hostinger KVM 4, com 4 vCPU, 16 GB RAM e 200 GB NVMe**.
Ela é a hipótese inicial para o CRM e o n8n junto dos demais serviços do
projeto, desde que o envelope agregado seja novamente validado e o worker de
PDF tenha concorrência estritamente limitada. A aprovação anterior da issue
`#8` não mediu o n8n e, portanto, não prova esse novo envelope.

Essa recomendação só vale para o envelope de carga da seção 13 do TDD.
T07.1 bloqueia o piloto se a carga aprovada não atingir os SLOs ou se a previsão
de negócio exceder o envelope sem novo sizing.

Licença EasyPanel mínima: **Hobby**, porque backups agendados e domínio próprio
são controles operacionais do piloto. Usar **Growth** se mais de uma pessoa
precisar acessar o painel com controles adicionais.

Os valores abaixo são **limites máximos**, não reservas somáveis:

| Serviço           | Limite máximo do piloto |
| ----------------- | ----------------------: |
| `silmer-postgres` |       4–5 GB, até 2 CPU |
| `silmer-api`      |     1–1,5 GB, até 1 CPU |
| `silmer-worker`   |       2 GB, até 1,5 CPU |
| `silmer-edge-web` |        256 MB, 0,25 CPU |
| `silmer-n8n`      |       1,5 GB, até 1 CPU |
| `silmer-n8n-db`   |       1,5 GB, até 1 CPU |

Regras operacionais:

- manter ao menos 30% do disco livre;
- construir imagens no GitHub, nunca na VPS;
- limitar concorrência do Chromium no worker;
- reservar 3 GB para Ubuntu, EasyPanel, Traefik, logs, métricas, backup e
  manutenção do PostgreSQL;
- incluir os serviços não relacionados no orçamento agregado de CPU, RAM e disco.

## 5. Armazenamento de arquivos

### Piloto interno sem custo incremental

Imagens e arquivos de canal ainda não promovidos a registro comercial válido
usam um volume privado `silmer-media` na VPS. O volume não possui domínio,
porta pública nem backup. API e worker montam leitura/escrita: a API recebe,
valida e publica uploads seguros, enquanto o worker executa expurgo e
reconciliação. Bytes são entregues apenas por rota autenticada/autorizada,
nunca como caminho de filesystem ou URL pública.

Cada objeto usa chave opaca, arquivo parcial separado, hash e `expires_at` no
PostgreSQL. O vencimento é o menor entre sete dias do recebimento/envio e o
evento terminal da jornada. O evento agenda a limpeza imediata e um sweeper
diário cobre falhas. A quota é configurada conforme o espaço real do host e
falha fechada para novos uploads antes de ameaçar PostgreSQL e serviços
compartilhados; texto e reconciliação continuam operacionais. O volume fica
fora de backup e restore.

Arquivo inválido é apagado e nunca sai da quarentena. Arquivo válido segue ao
Dropbox já usado pela operação, com hash, operador, timestamp e resultado
registrados no CRM. Esse é um procedimento manual: nenhum token, SDK, webhook
ou integração automática Dropbox faz parte do MVP. Falha ou limitação fica
visível para reconciliação, mas não prolonga o TTL da cópia transitória.
Pedido, Ficha, orçamento aprovado, comprovante PIX válido, eventos comerciais,
auditoria, tombstones e backups não usam essa retenção curta.

Perda do volume torna a mídia transitória `lost/unavailable` e é risco aceito
do piloto interno. Não há promessa de restauração desses bytes.

### Object storage futuro

O contrato S3-compatible externo permanece versionado para arquivo durável,
backups e tombstones quando os gatilhos da issue `#29` ocorrerem. Cloudflare R2
Standard não está autorizado nem provisionado nesta fase. O fallback com
residência explícita no Brasil continua AWS S3 `sa-east-1`.

Buckets/prefixos separados por finalidade:

- `crm-silmer-data`;
- `crm-silmer-backups`;
- `crm-silmer-tombstones`.

Controles:

- nenhuma ACL pública;
- credencial distinta por finalidade e menor privilégio;
- chave opaca sem nome, telefone ou número de documento;
- URL assinada de operação/objeto único, com no máximo 300 segundos, nunca
  registrada em log/evidência e entregue pela aplicação com
  `Cache-Control: no-store`;
- criptografia em trânsito e repouso;
- metadados e autorização no PostgreSQL;
- lifecycle destrutivo do provedor somente para backups; abort de multipart e
  transições não destrutivas são permitidos, retenções dependentes de evento e
  `legal_hold` ficam no worker P0.6, e tombstones ficam sob Bucket Lock;
- backups e objetos temporários expiram em até 35 dias;
- dados reais nunca entram em teste local, CI ou drill não autorizado.

As credenciais são separadas por função:

- `crm-silmer-data`: runtime lê/escreve objetos do domínio, sem acesso a
  backups ou tombstones;
- `crm-silmer-backups`: somente o mecanismo de backup escreve; runtime não
  recebe credencial;
- `crm-silmer-tombstones`: o token R2 de escrita é restrito ao bucket, mas como
  o provedor não oferece permissão IAM create-only, o job também usa chave
  imutável, `If-None-Match: *` e Bucket Lock; o restore usa credencial read-only
  mantida fora do runtime normal.

O bucket de tombstones usa **Cloudflare R2 Bucket Lock** no prefixo
`tombstones/`, por pelo menos 36 dias e até expirar a última cópia relacionada,
o que for maior, com criação
condicional e cópia independente sob outra credencial. R2 não implementa S3
Object Lock, seus headers nem versionamento de bucket; esses mecanismos nunca
são usados como prova de imutabilidade. A credencial que altera Bucket Lock fica
fora do runtime, protegida por MFA e auditoria, e qualquer mudança exige
aprovação de Privacidade/DevOps. O gate testa overwrite e exclusão, mas não
representa Bucket Lock como equivalente a AWS Object Lock compliance mode.

Os controles desta subseção são uma rota futura e não provam buckets,
credenciais, DPA, localização ou recuperação live. Até a issue `#29`, mídia
transitória pode existir somente no volume da VPS conforme o risco aceito;
documentos duráveis não podem depender dele.

## 6. Variáveis e segredos

Segredos usam o escopo `silmer` no projeto e não entram em `.env` versionado:

```text
APP_ENV
APP_BASE_URL
DATABASE_URL
SESSION_SECRET
ENCRYPTION_KEY
META_APP_ID
META_APP_SECRET
META_VERIFY_TOKEN
META_WEBHOOK_PAYLOAD_ENVELOPE_KEY
META_WHATSAPP_BUSINESS_ACCOUNT_ID
META_WHATSAPP_PHONE_NUMBER_ID
META_INSTAGRAM_ACCOUNT_ID
META_ACCESS_TOKEN
AI_PROVIDER
AI_MODEL_PRIMARY
OPENAI_API_KEY
GEMINI_API_KEY
GEMINI_PAID_SERVICE_CONFIRMED
GEMINI_ZDR_APPROVED
GEMINI_DEVELOPER_LOGGING_ENABLED
S3_ENDPOINT
S3_REGION
S3_DATA_BUCKET
S3_DATA_ACCESS_KEY_ID
S3_DATA_SECRET_ACCESS_KEY
S3_BACKUP_BUCKET
S3_BACKUP_ACCESS_KEY_ID
S3_BACKUP_SECRET_ACCESS_KEY
TOMBSTONE_BUCKET
TOMBSTONE_WRITE_ACCESS_KEY_ID
TOMBSTONE_WRITE_SECRET_ACCESS_KEY
TOMBSTONE_READ_ACCESS_KEY_ID
TOMBSTONE_READ_SECRET_ACCESS_KEY
PIX_KEY_ID
PIX_KEY_VALUE
PIX_KEY_DISPLAY_MASKED
FICHA_RECIPIENT_E164
FAB_CODE
N8N_ENCRYPTION_KEY
N8N_HOST
N8N_EDITOR_BASE_URL
WEBHOOK_URL
DB_TYPE
DB_POSTGRESDB_HOST
DB_POSTGRESDB_DATABASE
DB_POSTGRESDB_USER
DB_POSTGRESDB_PASSWORD
CRM_API_BASE_URL
CRM_AUTOMATION_CLIENT_ID
CRM_AUTOMATION_CLIENT_SECRET
CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET
N8N_INTEGRATION_ENABLED
N8N_INTEGRATION_ENVELOPE_KEY
CONTACT_IDENTITY_ENVELOPE_KEY
CONTACT_IDENTITY_LOOKUP_KEY
INBOX_MESSAGE_ENVELOPE_KEY
N8N_COMMAND_URL
N8N_COMMAND_CLIENT_ID
N8N_COMMAND_CLIENT_SECRET
N8N_COMMAND_TIMEOUT_MS
N8N_COMMAND_REPLAY_SAFE
PRIVATE_MEDIA_ROOT
PRIVATE_MEDIA_MAX_BYTES
PRIVATE_MEDIA_MAX_FILE_BYTES
MEDIA_RETENTION_SCAN_INTERVAL_MS
```

Regras:

- tokens Meta, buckets, banco e chaves não são compartilhados com outros
  serviços do projeto;
- tokens Meta e chave do provedor de IA ficam somente no n8n; a credencial
  `CRM_AUTOMATION_*` não concede administração nem acesso ao banco do CRM;
- `CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET` existe somente durante a janela
  curta de rotação e deve ser removida depois do smoke com o segredo novo;
- `CRM_AUTOMATION_*` identifica n8n→CRM; `N8N_COMMAND_CLIENT_*` é outra
  credencial Basic, exclusiva para CRM→n8n, e os valores nunca são exportados;
- `CONTACT_IDENTITY_*` e `INBOX_MESSAGE_ENVELOPE_KEY` devem reutilizar as
  chaves dos respectivos módulos canônicos; `N8N_INTEGRATION_ENVELOPE_KEY`
  protege briefing, payload de comando, filename e resumo;
- `N8N_COMMAND_REPLAY_SAFE=true` só é permitido depois que a reserva remota
  anterior à Meta foi comprovada em homologação; até lá, timeout produz
  `outcome_unknown` e reconciliação;
- `N8N_ENCRYPTION_KEY` é obrigatória, fica em escrow operacional e deve ser
  restaurável junto do banco próprio do n8n;
- `PIX_KEY_VALUE` fica disponível somente ao runtime que monta a mensagem e
  não aparece em log, frontend ou variável de build;
- `secret://crm/order-recipient-phone` é resolvido somente no runtime para
  `FICHA_RECIPIENT_E164`; o telefone não aparece em código, documentação, log
  ou artefato de build;
- rotação trimestral e imediata após incidente ou saída de operador;
- o GitHub Actions recebe somente credencial para publicar no GHCR; a promoção
  manual no EasyPanel não expõe segredos de runtime ao pipeline;
- alterações de segredo geram registro operacional e smoke test.

## 7. Health checks

| Serviço            | Endpoint/check          | Critério                                            |
| ------------------ | ----------------------- | --------------------------------------------------- |
| edge               | `GET /healthz`          | Nginx responde 200                                  |
| API live           | `GET /api/health/live`  | event loop/processo saudável                        |
| API ready          | `GET /api/health/ready` | banco acessível e schema compatível                 |
| worker local       | processo/loop local     | processo responde sem consultar dependência externa |
| worker operacional | heartbeat no PostgreSQL | idade inferior a 120 s                              |
| postgres           | `pg_isready`            | conexão aceita                                      |
| n8n live           | health interno          | processo saudável sem publicar editor               |
| n8n operacional    | workflow sintético      | webhook, banco próprio e API do CRM correlacionados |
| n8n postgres       | `pg_isready`            | conexão aceita somente na rede privada              |

Dependências Meta, IA e storage possuem diagnóstico separado e não derrubam o
container. Docker `HEALTHCHECK`: intervalo 30 s, timeout 5 s, start period 20 s
e três falhas. O monitor externo consulta `/api/health/ready` através do edge,
não apenas `/healthz`. Falha de banco alerta o worker, mas não cria loop de
restart contínuo.

Com `N8N_INTEGRATION_ENABLED=true`, o gate de ativação também exige schema
0013, volume privado gravável e scanner com assinatura de até 36 horas. A rota
direta da Meta no CRM retorna indisponível; isso é comportamento de corte, não
fallback.

### Hardening dos containers

- usuário não-root e capabilities removidas;
- filesystem read-only quando possível;
- temporários em tmpfs/volume limitado e descartável;
- imagens-base fixadas por digest;
- Chromium e `clamscan` com concorrência 1, timeout e limite de memória;
- assinatura-base ClamAV na imagem e `freshclam` em tmpfs no startup e a cada
  24 horas; idade acima de 36 horas bloqueia liberação do anexo e gera alerta.

## 8. CI/CD

### Cloud-dev

O EasyPanel acompanha a branch `dev` e executa auto-deploy do commit enviado.
O desenvolvedor testa uma alteração com `git push origin HEAD:dev`, sem merge
em `master`, tag mutável, SSH/rsync ou promoção por digest. O manifesto sem
segredos, as rotas privadas e o provisionamento único estão em
`ops/easypanel/cloud-dev.json` e `ops/easypanel/CLOUD-DEV.md`.

Esse caminho é exclusivo do cloud-dev. API e PostgreSQL continuam privados. A
instância existente `schedule-n8n` fica fora deste projeto e usa HTTPS público
para chamar a API do CRM; o worker usa o webhook HTTPS do `schedule-n8n` para
enviar comandos. Cada sentido conserva sua própria credencial Basic e o n8n
nunca recebe acesso ao banco do CRM. O procedimento está em
`ops/easypanel/CLOUD-DEV.md`.

O branch canônico atual é `master`.

### Pull request

1. lint e `checkJs`;
2. unitários e integração com PostgreSQL;
3. contratos e evals da IA;
4. E2E e acessibilidade;
5. validação e diff dos exports versionados de workflows n8n;
6. build das duas imagens;
7. scan de dependências e imagem;
8. `git diff --check`.

### Merge e promoção

1. Merge em `master` constrói uma vez.
2. Publica `edge-web` e `runtime` no GHCR com SHA e digest.
3. Operador autorizado acessa EasyPanel por VPN e verifica backup/espaço.
4. Executa `migrate` como script salvo, usando a imagem runtime e advisory lock.
5. Troca `silmer-api` e `silmer-worker` e depois `silmer-edge-web` para os
   digests aprovados no projeto estável.
6. Publica a versão aprovada dos workflows no `silmer-n8n`, preservando a
   versão anterior para rollback.
7. Executa smoke WhatsApp → n8n → CRM → Inbox e registra a aprovação operacional.
8. Auto-deploy direto no projeto permanece desabilitado.

No piloto, GitHub Actions testa, escaneia e publica; não acessa a API
administrativa do EasyPanel. A promoção é manual e auditada no painel. Automação
futura exige runner privado/VPN; a API administrativa não será publicada.

`workflow_dispatch` pode validar qualquer SHA aprovado sem promover o runtime.
O operador promove o digest manualmente no projeto estável. Nunca usar `latest`;
a configuração registra o digest atual e o anterior.

## 9. Migração e rollback

Sequência de deploy do contrato n8n v1:

1. verificar backup e espaço livre;
2. ativar manutenção quando necessário;
3. aplicar migration expand-only com `N8N_INTEGRATION_ENABLED=false`;
4. implantar API e worker e configurar duas credenciais Basic distintas;
5. atualizar o workflow `k7tI6T4RhQPyJkn9` ainda inativo;
6. executar contrato, banco, scanner e smoke WhatsApp de homologação;
7. publicar o workflow, transferir o webhook Meta para o n8n e habilitar a
   integração, tornando a rota direta do CRM indisponível;
8. implantar edge, verificar live, ready, heartbeat e monitorar 30 minutos.

O rascunho simplificado atual é a versão
`fae803db-eef0-4074-a7ae-1a6bb786e203`, com 42 nós. A publicação permanece
bloqueada pelas credenciais Basic DEV e pela homologação WhatsApp; Instagram
entra depois em `CANAL-2` e não bloqueia este primeiro MVP operacional.

Migrações seguem expand/contract. Remover tabela/coluna ocorre somente quando o
digest anterior já não depender dela. Rollback normal reaponta para o digest
anterior; restore de banco é último recurso.

Triggers de rollback:

- 5xx acima de 5% por 5 minutos;
- perda ou duplicidade de efeito comercial;
- webhook não persistido;
- worker sem progresso ou dead-letter crescente;
- workflow n8n incompatível, em loop ou sem correlação com o CRM;
- violação de autorização ou exposição de dados;
- migration incompatível.

Rollback despublica/pausa o novo workflow e a automação, preserva comandos,
tentativas e reconciliações e reaponta apenas os runtimes compatíveis. Ele não
reativa silenciosamente a entrada direta da Meta.

## 10. Backups e disaster recovery

Produção:

- `pg_dump` horário, 48 cópias, para CRM e banco próprio do n8n;
- `pg_dump` diário, 35 cópias, para ambos os bancos;
- lifecycle apaga qualquer backup com mais de 35 dias;
- backup manual verificado antes de mudança destrutiva;
- restore mensal do banco em serviço temporário `postgres-restore-drill`,
  isolado, sem UI, worker, rota pública ou credenciais externas;
- drill trimestral de perda total em VPS limpa fora do host de produção;
- RPO alvo de até 1 hora e RTO alvo de até 4 horas para CRM e automação,
  condicionados a novo drill em host limpo que inclua n8n, workflows e sua
  chave de criptografia.

O agendamento usa o backup de PostgreSQL do EasyPanel com storage remoto e
licença compatível. O backup semanal/snapshot da Hostinger é proteção
terciária do host, não substitui os dumps externos.

Um kit off-host versionado, sem segredos em claro, mantém o runbook, versões do
Ubuntu/EasyPanel, topologia de projetos e serviços, regras de rede/DNS, digests,
ordem de migrations e inventário dos segredos. Os valores dos segredos e a
credencial read-only de tombstones ficam em escrow criptografado acessível a
duas pessoas designadas. O kit é validado a cada mudança de topologia.

### Drill mensal do PostgreSQL

1. Criar `postgres-restore-drill` temporário e rede isolada.
2. Restaurar o backup sem copiar o banco para homologação.
3. Aplicar migrations e tombstones externos.
4. Validar contagens, constraints e leitura/escrita com mocks sem saída.
5. Registrar RPO/RTO e destruir o serviço temporário após a evidência.

O drill não interrompe produção e nunca envia WhatsApp, IA ou objetos externos.

### Drill trimestral de perda total da VPS

1. Provisionar uma VPS limpa, isolada e tratada como produção temporária, sem
   reutilizar o EasyPanel do host de produção.
2. Recriar painel, projeto, rede, domínios temporários e serviços pelo kit
   off-host.
3. Recuperar segredos do escrow, promover os digests registrados e manter todos
   os adapters externos em modo mock.
4. Restaurar os bancos do CRM e do n8n, aplicar migrations, recuperar workflows
   e chave de criptografia e reaplicar tombstones com a credencial read-only.
5. Validar acesso aos objetos existentes, recuperar uma versão apagada/corrompida
   e confirmar que objetos sujeitos a tombstone não reaparecem.
6. Executar smoke completo de login, inbox, Deal, PIX, Ficha e reconciliação.
7. Testar troca de DNS em subdomínio de drill com o TTL documentado.
8. Registrar tempos por etapa, RPO/RTO, lacunas e responsáveis pela correção.
9. Destruir o host do drill após preservar evidências sem dados pessoais.

Somente esse drill comprova o RTO do CRM. O restore mensal comprova o backup do
banco, mas não a recuperação de uma perda do host.

### Restore de desastre real

1. Ativar manutenção e parar API/worker.
2. Restaurar o banco de produção em instância isolada.
3. Aplicar migrations compatíveis.
4. Reaplicar o ledger externo de `deletion_tombstones`.
5. Excluir objetos que já haviam sido removidos.
6. Validar login, contagens, constraints e leitura/escrita.
7. Executar smoke com adapters externos em modo mock.
8. Registrar evidências do restore.
9. Liberar tráfego somente após aprovação do Administrador Técnico.

O ledger de tombstones é pseudonimizado, criptografado, versionado e armazenado
fora do backup restaurado. Cada entrada permanece pelo menos 36 dias após a
exclusão ou até expirar a última cópia relacionada, o que for maior. Restore de
snapshot/backup Hostinger passa pelo mesmo gate.

## 11. Observabilidade e alertas

Usar métricas/logs do EasyPanel e serviço externo para uptime. Erros e traces
podem usar Sentry ou equivalente após contrato de operador e retenção. Logs
técnicos ficam configurados em 30 dias; 90 dias é apenas o teto jurídico.

Alertas mínimos:

- API indisponível ou 5xx acima do limite;
- worker sem heartbeat;
- n8n indisponível, execução em loop ou versão divergente da publicada;
- reservas de envio obsoletas ou divergentes por epoch/revisão;
- comandos n8n em `processing` além do lease ou em `outcome_unknown`;
- job mais antigo acima de 5 minutos;
- dead-letter ou reconciliação crescente;
- último backup horário bem-sucedido acima de 75 minutos ou diário acima de 26 horas;
- disco 70/80/90% e memória acima de 80%;
- certificado próximo do vencimento;
- falhas repetidas Meta, IA, PDF ou storage;
- consumo de tokens/custo da IA fora do esperado.

Audit trail comercial não depende de logs do EasyPanel.

## 12. Gates antes do piloto

- [ ] Domínios, DNS, SSL e firewall validados.
- [ ] Credenciais separadas e rotação testada.
- [ ] Basic n8n→CRM e CRM→n8n criados e vinculados sem HMAC/timestamp.
- [ ] PostgreSQL e serviços internos sem portas públicas.
- [ ] Editor e API administrativa do n8n sem rota pública; apenas webhook do canal publicado.
- [ ] Ator `AUTOMATION_EXECUTOR` sem acesso administrativo ou direto ao banco do CRM.
- [ ] Backup horário/diário executado e alerta configurado.
- [ ] Restore completo em serviço temporário isolado dentro do RTO.
- [ ] Perda total da VPS recuperada em host limpo dentro do RTO.
- [ ] Tombstones imutáveis, com credenciais separadas, reaplicados depois de restore antigo.
- [ ] Webhook repetido sem duplicar mensagem, Negócio ou job.
- [ ] Cada mensagem válida dispara o n8n sem botão da UI e registra versão, execução e epoch no CRM.
- [ ] Worker parado acumula jobs e recupera a fila ao voltar.
- [ ] Crash durante efeito externo produz `sent`, `failed` ou `outcome_unknown`, sem retry cego.
- [ ] Os sete caminhos de envio reservam `message.send.requested` antes da Meta.
- [ ] Digest promovido e revertido com sucesso.
- [ ] Takeover impede novos envios até o ponto de não retorno e reconcilia resultado incerto.
- [ ] Restore recupera banco, workflows e chave de criptografia do n8n em host limpo.
- [ ] Smoke WhatsApp oficial ponta a ponta aprovado antes da publicação.
- [ ] Instagram oficial e migração de canal aprovados na fase `CANAL-2`.
- [ ] Persistência de execução/manual do n8n desabilitada ou expurgada em até 30 dias, sem PII.
- [ ] Falha de Ficha aparece na reconciliação e retry não duplica envio.
- [ ] Monitor externo detecta parada da VPS.
- [ ] Responsável de Privacidade aprova storage, IA e observabilidade.

## 13. Riscos aceitos e evolução

Uma única VPS é ponto único de falha. O CRM compartilha projeto e host com
serviços não relacionados, sem isolamento de desenvolvimento, homologação e
produção. Essa estrutura foi aceita como duradoura para o piloto, mas não altera
os gates de backup externo, monitoramento e recovery drill em host limpo. O
risco específico de perder mídia transitória de até sete dias também foi aceito
para o uso interno; ele não amplia o RPO de PostgreSQL, Pedido, Ficha, PIX,
auditoria, backups ou tombstones. O
primeiro gatilho de evolução é mover o CRM ou o PostgreSQL para projeto ou
domínio de falha próprio quando qualquer condição ocorrer:

- disponibilidade exigida acima de 99,5%;
- uso sustentado acima de 70% de CPU/RAM/disco;
- janela de backup ou restore excede o SLO;
- operação 24x7 passa a depender do CRM;
- perda potencial de uma hora deixa de ser aceitável.

Redis só entra com evidência de mais de duas réplicas de API, necessidade real
de pub/sub, fila sustentada acima de 1.000 jobs ou atraso p95 acima de 5 s por
15 minutos. Mesmo nesse cenário, PostgreSQL continua fonte da verdade.

## 14. Referências verificadas

- <https://easypanel.io/docs/services>
- <https://easypanel.io/docs/services/app>
- <https://easypanel.io/docs/services/postgres>
- <https://easypanel.io/docs/backups/database>
- <https://easypanel.io/pricing>
- <https://www.hostinger.com/vps/easypanel-hosting>
- <https://www.hostinger.com/support/8703798-how-to-use-the-easypanel-vps-template-at-hostinger/>
- <https://support.hostinger.com/en/articles/1583232-how-to-back-up-or-restore-a-vps>
- <https://www.hostinger.com/support/4805502-how-to-set-up-a-firewall-at-vps/>

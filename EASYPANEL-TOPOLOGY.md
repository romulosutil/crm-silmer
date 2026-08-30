# Topologia EasyPanel — CRM Silmer

> **Status:** baseline operacional para aprovação  
> **Data:** 30/08/2026  
> **Host:** Hostinger VPS com Ubuntu 24.04 e EasyPanel

## 1. Decisão

Usar exatamente três projetos EasyPanel no MVP:

| Projeto | Finalidade | Dados reais | Disponibilidade |
|---|---|---:|---|
| `crm-silmer-dev` | Integração compartilhada e testes técnicos | Não | Sob demanda |
| `crm-silmer-hml` | UAT e integração com Meta App/número de teste | Não | Horário de trabalho/UAT |
| `crm-silmer-prod` | Operação real do CRM | Sim | Contínua |

O desenvolvimento diário continua local. `crm-silmer-dev` existe para
integrações que precisam de callback público e não como ambiente pessoal.

Não criar projeto de observabilidade dentro da mesma VPS: o monitor de uptime
precisa estar fora do domínio de falha do host. n8n, se aprovado depois do MVP,
receberá o projeto separado `crm-silmer-automation`, sem acesso direto ao banco.

## 2. Serviços por projeto

Cada projeto contém a mesma topologia:

| Serviço | Tipo EasyPanel | Imagem | Público | Persistência |
|---|---|---|---:|---|
| `edge-web` | App | GHCR por digest | Sim, 80/443 via domínio | Nenhuma |
| `api` | App | GHCR por digest | Não | Nenhuma |
| `worker` | App | Mesma imagem runtime, comando distinto | Não | Temporário descartável |
| `postgres` | PostgreSQL Service | Major fixada | Não | Volume EasyPanel + backup externo |

`migrate` é um job curto executado pelo pipeline ou script salvo do EasyPanel;
não é serviço permanente.

Não subir no MVP:

- Redis ou BullMQ;
- MinIO;
- n8n;
- Elasticsearch ou Meilisearch;
- Grafana, Prometheus ou Loki próprios;
- banco/admin UI permanentemente habilitado.

## 3. Rede e domínios

```text
Internet e Meta
      |
   HTTPS 443
      |
edge-web (único serviço público)
   |-- /                         arquivos vanilla
   |-- /api/*                    api:8000
   |-- /api/v1/webhooks/meta/*   api:8000
   `-- /api/v1/events            api:8000 (SSE)
                                      |
                               PostgreSQL privado
                                      |
                                  worker privado
                                      |
                          Meta / IA / storage externo
```

Domínios propostos, substituindo `<dominio>` pelo domínio aprovado:

| Projeto | Domínio primário | Proteção adicional |
|---|---|---|
| dev | `dev.crm.<dominio>` | VPN/allowlist; UI restrita |
| webhook dev | `hooks-dev.crm.<dominio>` | Público somente na rota Meta |
| homologação | `hml.crm.<dominio>` | VPN/allowlist; UI restrita e credenciais de teste |
| webhook hml | `hooks-hml.crm.<dominio>` | Público somente na rota Meta |
| produção | `crm.<dominio>` | Login da aplicação, HSTS e rate limiting |
| EasyPanel | `ops.<dominio>` | VPN/allowlist, MFA obrigatório e contas individuais |

VPN, allowlist ou Basic Auth não podem bloquear o callback público da Meta. Os
hosts `hooks-*` roteiam somente `/api/v1/webhooks/meta/*`; qualquer outra rota
retorna `404`. Assinatura, verify token, limite de corpo e rate limit permanecem
na aplicação.

### Firewall Hostinger

- `80/443`: público.
- `22`: somente IP administrativo ou VPN.
- Painel EasyPanel: somente VPN/allowlist.
- PostgreSQL e portas internas: nunca publicados.
- Remover qualquer porta de teste depois do diagnóstico.

## 4. Sizing inicial

Baseline recomendada: **Hostinger KVM 4, com 4 vCPU, 16 GB RAM e 200 GB NVMe**.
Ela acomoda produção e um ambiente não produtivo ativo por vez. Dev fica
desligado durante UAT pesada e dev/hml não rodam carga simultaneamente. Uma
VPS de 8 GB só é aceitável com dev desligado, homologação sob demanda e worker
de PDF estritamente limitado.

Essa recomendação só vale para o envelope de homologação da seção 13 do TDD.
T07.1 bloqueia o piloto se a carga aprovada não atingir os SLOs ou se a previsão
de negócio exceder o envelope sem novo sizing.

Licença EasyPanel mínima: **Hobby**, porque o plano gratuito comporta três
projetos, mas não inclui os backups agendados necessários. Usar **Growth** se
mais de uma pessoa precisar acessar o painel com controle por projeto.

Os valores abaixo são **limites máximos**, não reservas somáveis:

| Serviço | Produção | Homologação | Dev |
|---|---:|---:|---:|
| PostgreSQL | 4–5 GB, até 2 CPU | 1–1,5 GB, 0,5 CPU | 1 GB, 0,5 CPU |
| API | 1–1,5 GB, até 1 CPU | 768 MB, 0,5 CPU | 512 MB, 0,25 CPU |
| Worker | 2 GB, até 1,5 CPU | 768 MB, 0,5 CPU | 512 MB, 0,25 CPU |
| Edge | 256 MB, 0,25 CPU | 128 MB | 128 MB |

Regras operacionais:

- manter ao menos 30% do disco livre;
- construir imagens no GitHub, nunca na VPS;
- limitar concorrência do Chromium no worker;
- parar dev fora de uso e homologação fora das janelas de UAT;
- reservar 3 GB para Ubuntu, EasyPanel, Traefik, logs, métricas, backup e
  manutenção do PostgreSQL;
- usar KVM 8 se dev, hml e prod precisarem ficar ativos simultaneamente.

## 5. Object storage

Anexos, comprovantes e Fichas usam storage S3-compatible externo e privado.
Baseline: Cloudflare R2 Standard após aprovação do DPA/suboperadores pelo
Responsável de Privacidade. Fallback com residência explícita no Brasil: AWS
S3 `sa-east-1`.

Buckets/prefixos separados:

- `crm-silmer-dev-data`;
- `crm-silmer-hml-data`;
- `crm-silmer-prod-data`;
- `crm-silmer-prod-backups`;
- `crm-silmer-prod-tombstones`.

Controles:

- nenhuma ACL pública;
- credencial distinta por ambiente, finalidade e menor privilégio;
- chave opaca sem nome, telefone ou número de documento;
- URL assinada com expiração curta;
- criptografia em trânsito e repouso;
- metadados e autorização no PostgreSQL;
- lifecycle por classe de dado do P0.6;
- cópias não correntes e backups expiram em até 35 dias;
- produção nunca é copiada para dev/homologação.

Em produção, as credenciais também são separadas por função:

- `crm-silmer-prod-data`: runtime lê/escreve objetos do domínio, sem acesso a
  backups ou tombstones;
- `crm-silmer-prod-backups`: somente o mecanismo de backup escreve; runtime não
  recebe credencial;
- `crm-silmer-prod-tombstones`: o job de privacidade apenas cria novas chaves,
  sem sobrescrever ou excluir; o restore usa credencial read-only mantida fora
  do runtime normal.

O bucket de tombstones usa versionamento e proteção WORM/Object Lock do provedor
com retenção mínima igual à última cópia relacionada. Se esse recurso não estiver
disponível, usa criação condicional em namespace append-only, política que nega
delete e cópia independente sob outra credencial. O gate de Privacidade registra
qual mecanismo fornece imutabilidade e testa overwrite e exclusão. Versionamento
sozinho não satisfaz o contrato.

O filesystem dos containers guarda apenas temporários. Nenhum anexo ou PDF
existe somente no disco da VPS.

## 6. Variáveis e segredos

Segredos são separados por projeto e não entram em `.env` versionado:

```text
APP_ENV
APP_BASE_URL
DATABASE_URL
SESSION_SECRET
ENCRYPTION_KEY
META_APP_ID
META_APP_SECRET
META_VERIFY_TOKEN
META_WHATSAPP_BUSINESS_ACCOUNT_ID
META_WHATSAPP_PHONE_NUMBER_ID
META_INSTAGRAM_ACCOUNT_ID
META_ACCESS_TOKEN
AI_PROVIDER
AI_MODEL_PRIMARY
OPENAI_API_KEY
S3_ENDPOINT
S3_REGION
S3_DATA_BUCKET
S3_DATA_ACCESS_KEY_ID
S3_DATA_SECRET_ACCESS_KEY
TOMBSTONE_BUCKET
TOMBSTONE_WRITE_ACCESS_KEY_ID
TOMBSTONE_WRITE_SECRET_ACCESS_KEY
PIX_KEY_ID
PIX_KEY_VALUE
PIX_KEY_DISPLAY_MASKED
FICHA_RECIPIENT_E164
FAB_CODE
```

Regras:

- tokens Meta, buckets, banco e chaves nunca são compartilhados entre ambientes;
- `PIX_KEY_VALUE` fica disponível somente ao runtime que monta a mensagem e
  não aparece em log, frontend ou variável de build;
- rotação trimestral e imediata após incidente ou saída de operador;
- o GitHub Actions recebe somente credencial para publicar no GHCR; a promoção
  manual no EasyPanel não expõe segredos de runtime ao pipeline;
- alterações de segredo geram registro operacional e smoke test.

## 7. Health checks

| Serviço | Endpoint/check | Critério |
|---|---|---|
| edge | `GET /healthz` | Nginx responde 200 |
| API live | `GET /api/health/live` | event loop/processo saudável |
| API ready | `GET /api/health/ready` | banco acessível e schema compatível |
| worker local | processo/loop local | processo responde sem consultar dependência externa |
| worker operacional | heartbeat no PostgreSQL | idade inferior a 120 s |
| postgres | `pg_isready` | conexão aceita |

Dependências Meta, IA e storage possuem diagnóstico separado e não derrubam o
container. Docker `HEALTHCHECK`: intervalo 30 s, timeout 5 s, start period 20 s
e três falhas. O monitor externo consulta `/api/health/ready` através do edge,
não apenas `/healthz`. Falha de banco alerta o worker, mas não cria loop de
restart contínuo.

### Hardening dos containers

- usuário não-root e capabilities removidas;
- filesystem read-only quando possível;
- temporários em tmpfs/volume limitado e descartável;
- imagens-base fixadas por digest;
- Chromium e `clamscan` com concorrência 1, timeout e limite de memória;
- assinatura-base ClamAV na imagem e `freshclam` em tmpfs no startup e a cada
  24 horas; idade acima de 36 horas bloqueia liberação do anexo e gera alerta.

## 8. CI/CD

O branch canônico atual é `master`.

### Pull request

1. lint e `checkJs`;
2. unitários e integração com PostgreSQL;
3. contratos e evals da IA;
4. E2E e acessibilidade;
5. build das duas imagens;
6. scan de dependências e imagem;
7. `git diff --check`.

### Merge e promoção

1. Merge em `master` constrói uma vez.
2. Publica `edge-web` e `runtime` no GHCR com SHA e digest.
3. Operador autorizado acessa EasyPanel por VPN e verifica backup/espaço.
4. Executa `migrate` como script salvo, usando a imagem runtime e advisory lock.
5. Troca API/worker e depois edge para os digests em homologação.
6. Executa smoke; UAT aprova o release candidate.
7. Repete backup, migration e promoção dos mesmos digests em produção.
8. Auto-deploy direto em produção permanece desabilitado.

No piloto, GitHub Actions testa, escaneia e publica; não acessa a API
administrativa do EasyPanel. A promoção é manual e auditada no painel. Automação
futura exige runner privado/VPN; a API administrativa não será publicada.

Dev usa `workflow_dispatch` para escolher qualquer SHA aprovado. O operador
promove o digest manualmente, sem branch permanente, aplica TTL/autostop e nunca
usa dados ou credenciais de produção. Nunca usar `latest`; a configuração
registra o digest atual e o anterior.

## 9. Migração e rollback

Sequência de deploy:

1. verificar backup e espaço livre;
2. ativar manutenção quando necessário;
3. aplicar migration compatível;
4. implantar API e worker;
5. implantar edge;
6. verificar live, ready, heartbeat e smoke ponta a ponta;
7. liberar tráfego e monitorar 30 minutos.

Migrações seguem expand/contract. Remover tabela/coluna ocorre somente quando o
digest anterior já não depender dela. Rollback normal reaponta para o digest
anterior; restore de banco é último recurso.

Triggers de rollback:

- 5xx acima de 5% por 5 minutos;
- perda ou duplicidade de efeito comercial;
- webhook não persistido;
- worker sem progresso ou dead-letter crescente;
- violação de autorização ou exposição de dados;
- migration incompatível.

## 10. Backups e disaster recovery

Produção:

- `pg_dump` horário, 48 cópias;
- `pg_dump` diário, 35 cópias;
- lifecycle apaga qualquer backup com mais de 35 dias;
- backup manual verificado antes de mudança destrutiva;
- restore mensal do banco em serviço temporário `postgres-restore-drill`,
  isolado, sem UI, worker, rota pública ou credenciais externas;
- drill trimestral de perda total em VPS limpa fora do host de produção;
- RPO até 1 hora e RTO até 4 horas para o CRM completo, condicionados à
  aprovação do drill em host limpo.

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
2. Recriar painel, projetos, rede, domínios temporários e serviços pelo kit
   off-host.
3. Recuperar segredos do escrow, promover os digests registrados e manter todos
   os adapters externos em modo mock.
4. Restaurar PostgreSQL, aplicar migrations e reaplicar tombstones com a
   credencial read-only.
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
- [ ] PostgreSQL e serviços internos sem portas públicas.
- [ ] Backup horário/diário executado e alerta configurado.
- [ ] Restore completo em serviço temporário isolado dentro do RTO.
- [ ] Perda total da VPS recuperada em host limpo dentro do RTO.
- [ ] Tombstones imutáveis, com credenciais separadas, reaplicados depois de restore antigo.
- [ ] Webhook repetido sem duplicar mensagem, Negócio ou job.
- [ ] Worker parado acumula jobs e recupera a fila ao voltar.
- [ ] Crash durante efeito externo produz `sent`, `failed` ou `outcome_unknown`, sem retry cego.
- [ ] Digest promovido e revertido com sucesso.
- [ ] Takeover impede novos envios até o ponto de não retorno e reconcilia resultado incerto.
- [ ] Smoke WhatsApp oficial ponta a ponta.
- [ ] Falha de Ficha aparece na reconciliação e retry não duplica envio.
- [ ] Monitor externo detecta parada da VPS.
- [ ] Responsável de Privacidade aprova storage, IA e observabilidade.

## 13. Riscos aceitos e evolução

Uma única VPS é ponto único de falha e os três ambientes competem por recurso.
Isso só é aceito para o piloto após backup externo e recovery drill bem-sucedido
em host limpo, com ambientes não produtivos sob demanda. O primeiro gatilho de evolução é mover produção ou
PostgreSQL para outro domínio de falha quando qualquer condição ocorrer:

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

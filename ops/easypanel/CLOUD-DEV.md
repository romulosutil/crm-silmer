# Ambiente cloud-dev no EasyPanel

> Rastreabilidade: `OPS-1`; ORC-01–09, INB-01–04, AGT-01–08, MSG-01–03 e
> PRV-01–03. Decisão: [ADR 004](../../docs/adr/004-adotar-auto-deploy-da-branch-dev-no-easypanel.md).

O projeto `espectro-mvp` é o ambiente remoto de **desenvolvimento** do CRM
Silmer. Ele não é produção. O objetivo é testar a integração real CRM ↔ n8n
sem fazer merge na `master`, publicar imagem por digest ou promover um release.

## Fluxo diário

1. Trabalhe em uma branch local e valide a alteração.
2. Faça commit do ponto que deseja testar e envie-o diretamente para a branch
   remota `dev`: `git push origin HEAD:dev`.
3. O auto-deploy do EasyPanel reconstrói somente os serviços alterados a partir
   da branch `dev`. Acompanhe o log de build e espere `ready` na API.
4. Teste pelo domínio do edge e pelo workflow `DEV | Silmer | Fluxo completo
sem WhatsApp`.
5. Quando a alteração estiver aprovada, abra o fluxo normal para `master`; a
   branch `dev` não é promovida automaticamente nem prova release.

Não use `--force` em `dev` enquanto houver outro teste em curso. Antes de
enviar, confira `git log origin/dev..HEAD`; se houver um commit remoto que não
está no seu trabalho, integre-o ou combine a substituição com a equipe.

## Provisionamento único

O manifesto sem segredos está em [`cloud-dev.json`](cloud-dev.json). No
EasyPanel, configure os serviços abaixo para a mesma fonte GitHub, branch
`dev`, com **Auto Deploy** habilitado.

| Serviço           | Fonte/execução                                                | Exposição                     |
| ----------------- | ------------------------------------------------------------- | ----------------------------- |
| `silmer-edge-web` | `docker/edge-web.cloud-dev.Dockerfile`                        | domínio cloud-dev, porta 8080 |
| `silmer-api`      | `docker/runtime.Dockerfile`, `node apps/api/src/server.js`    | privada, porta 3000           |
| `silmer-worker`   | `docker/runtime.Dockerfile`, `node apps/worker/src/worker.js` | privada                       |
| `silmer-postgres` | PostgreSQL existente do ambiente DEV                          | privada                       |
| `silmer-n8n`      | imagem n8n fixada por versão e digest no painel               | privada                       |
| `silmer-n8n-db`   | PostgreSQL exclusivo do n8n                                   | privada                       |

O edge encaminha exclusivamente `/webhook/silmer/dev-mvp-flow` ao n8n. Editor,
API administrativa e demais webhooks do n8n não têm rota pública. O n8n usa
`SILMER_PANEL_BASE_URL=http://silmer-api:3000`; o DNS é privado do projeto. O
n8n jamais recebe `DATABASE_URL` ou acesso de rede ao PostgreSQL do CRM.

Crie no painel, sem versionar valores, as duas credenciais Basic DEV distintas
(`n8n → CRM` e `CRM → n8n`), os segredos do CRM e a configuração de banco do
n8n. Importe `ops/n8n/workflows/0S5ZS1xeDCSoWovs-dev-test.sanitized.json` e
vincule as credenciais pelos nomes já previstos no workflow.

## Smoke mínimo

Após o primeiro deploy, aplique migrações com `N8N_INTEGRATION_ENABLED=false`,
suba API e worker, importe o workflow DEV e só então habilite a integração.
Dispare o cenário sintético:

```text
POST https://<cloud-dev>/webhook/silmer/dev-mvp-flow
{"scenario":"message","wa_id":"5511999999999"}
```

Valide `message`, `handoff`, `send_unknown` e `delivery_status`. O resultado
deve passar pelo CRM real, usando Basic Auth, idempotência, correlação, epoch e
reserva de envio; apenas o transporte WhatsApp é simulado.

## Limites

- Este fluxo não usa SSH para copiar arquivos nem tag mutável.
- Código não commitado nunca chega ao cloud-dev; isso mantém o teste
  reproduzível por commit.
- Migrations continuam expand/contract e exigem backup verificável antes de
  qualquer mudança destrutiva.
- `master` e seus digests preservam seu fluxo de release independente.

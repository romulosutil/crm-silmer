# ADR 004 — Adotar auto-deploy da branch dev no EasyPanel

- Status: aceito
- Data: 2026-09-12
- RFC: [RFC 003](../rfc/003-auto-deploy-cloud-dev-easypanel.md)
- Requisitos: ORC-01–09, INB-01–04, AGT-01–08, MSG-01–03, PRV-01–03
- Tarefa: OPS-1

## Decisão

O EasyPanel será o ambiente cloud-dev, não produção. Os serviços CRM usam a
fonte GitHub na branch `dev`, com auto-deploy, e o n8n é provisionado na mesma
rede privada. O encaminhamento público fica limitado ao edge e ao webhook
sintético DEV necessário para testes.

## Consequências

- Desenvolvedores testam commits sem merge na `master` nem digest manual.
- Cada teste remoto é identificável pelo commit da branch `dev`.
- O fluxo de release imutável por digest continua reservado a `master` e não é
  substituído pelo ambiente cloud-dev.
- SSH não é canal de deploy; continua permitido somente para administração
  restrita do host conforme firewall e acesso individual.
- O n8n mantém banco próprio e nunca acessa o PostgreSQL do CRM.

# ADR 005 — Integrar cloud-dev ao schedule-n8n existente

- Status: aceito
- Data: 2026-09-12
- RFC: [RFC 004](../rfc/004-integrar-cloud-dev-ao-schedule-n8n-existente.md)
- Requisitos: ORC-01–09, INB-01–04, AGT-01–08, MSG-01–03, PRV-01–03
- Tarefa: OPS-1
- Supersede para cloud-dev: [ADR 004](004-adotar-auto-deploy-da-branch-dev-no-easypanel.md)

## Decisão

O ambiente `espectro-mvp` continua sendo cloud-dev e reconstrói os serviços do
CRM a partir da branch `dev`. A automação usa o `schedule-n8n` existente em vez
de criar `silmer-n8n` e seu banco. A fronteira entre os dois projetos é HTTPS:
o n8n chama as rotas públicas versionadas do CRM e o worker chama o webhook de
comando do n8n.

## Consequências

- O edge não encaminha mais `/webhook/*` para um hostname privado inexistente.
- `SILMER_PANEL_BASE_URL` usa o domínio público do edge e `N8N_COMMAND_URL` o
  domínio público do `schedule-n8n`.
- Credenciais Basic distintas, idempotência, correlação e proibição de acesso
  direto ao banco permanecem obrigatórias.
- Mudanças de workflow exigem export sanitizado versionado no repositório e
  publicação deliberada no `schedule-n8n`; o auto-deploy de `dev` entrega
  somente o CRM.

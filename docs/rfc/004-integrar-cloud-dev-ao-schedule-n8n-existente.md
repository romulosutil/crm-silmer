# RFC 004 — Integrar cloud-dev ao schedule-n8n existente

- Status: aceito
- Data: 2026-09-12
- Proponente e aprovador: Rômulo Sutil Corrêa
- Requisitos: ORC-01–09, INB-01–04, AGT-01–08, MSG-01–03, PRV-01–03
- Tarefa: OPS-1
- Decisão: [ADR 005](../adr/005-integrar-cloud-dev-ao-schedule-n8n-existente.md)
- Supersede para cloud-dev: [RFC 003](003-auto-deploy-cloud-dev-easypanel.md)

## Contexto

O CRM usa `dev` como fonte de auto-deploy no projeto `espectro-mvp`, mas a
instância de automação a ser preservada é o `schedule-n8n` já existente. Ela
não pertence à rede privada do projeto CRM; manter uma rota edge para o serviço
inexistente `silmer-n8n` impede o smoke DEV de funcionar.

## Decisão

O cloud-dev reutiliza `schedule-n8n` por HTTPS. O n8n chama o domínio público
do edge para as rotas versionadas do CRM, e o worker chama o webhook público
de comando do `schedule-n8n`. As duas direções usam credenciais Basic distintas;
segredos ficam exclusivamente nos painéis e o n8n não recebe acesso ao banco
do CRM. O webhook sintético é chamado diretamente no domínio do
`schedule-n8n`, não pelo edge.

## Aceite

- push para `dev` reconstrói os serviços CRM sem merge em `master`;
- não há referência a `silmer-n8n` ou proxy de webhook no edge cloud-dev;
- `SILMER_PANEL_BASE_URL` do n8n aponta ao domínio HTTPS do edge;
- `N8N_COMMAND_URL` do worker aponta ao webhook HTTPS de comando do
  `schedule-n8n`;
- o smoke sintético percorre n8n → CRM e preserva Basic Auth, idempotência e
  correlação.

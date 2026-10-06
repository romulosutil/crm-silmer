# ADR 021 — Adotar OpenAI no MVP

Status: aceita. Data: 05/10/2026.

Decisor: PO, Rômulo Sutil Corrêa, por instrução explícita nesta entrega.
Proposta e alternativas: [RFC 009](../rfc/009-openai-no-mvp.md).

## Contexto

O workflow versionado usa OpenAI. A aprovação condicional de Gemini na
issue #5 e os spikes de T00.4 pertencem a uma baseline anterior. Eles não
comprovam a privacidade do provedor utilizado no lançamento.

## Decisão

1. OpenAI é o provedor de IA do primeiro MVP. Gemini deixa de ser dependência
   de lançamento e não é fallback automático.
2. O workflow mantém seu modelo configurado, atualmente `gpt-5.6-luna`, e
   Responses API. A escolha de OpenAI não autoriza mudança silenciosa de modelo.
3. O CRM continua fonte da verdade. A saída passa pelo parser estruturado e
   pelo schema do CRM; preço, confirmação e autorização permanecem determinísticos.
4. Produção com dados pessoais exige evidências de privacidade aplicáveis à
   organização/projeto OpenAI usado: DPA, retenção, região/subprocessadores e
   ZDR exigido pela política aprovada. `store: false` é um controle de estado
   da API e não comprova, isoladamente, ZDR.
5. Credenciais ficam no servidor/n8n e são separadas por finalidade. Logs e
   execuções não registram prompts, respostas completas ou segredos.
6. Spikes, fixtures e aprovações anteriores permanecem históricos. Não são
   reescritos como evidência de OpenAI.

## Consequências e verificação

A etapa OPS-AI-01 fecha a escolha e a coerência documental. Billing, chave,
opções reais do nó, retenção n8n, DPA/ZDR e smoke sintético são verificações
externas próprias, descritas no [runbook OpenAI](../integrations/openai/README.md).

Rastreabilidade: ORC-06, AGT-01..08, PRV-01..03, T00.4, AGENTE-3, INT-3.
Relacionados: [issue #5](https://github.com/romulosutil/crm-silmer/issues/5),
[ADR 020 / PR #142](020-tecnica-por-item-e-arte-do-pedido.md).

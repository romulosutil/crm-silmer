# T00.4 — Spikes externos

## Resultado local

Em 30/08/2026, a parte versionável e sem credenciais foi fechada: matriz de
efeitos, fixtures sintéticas, controles de IA/storage e envelope de carga têm
validação automatizada. Isso é evidência documental/local; não constitui teste
live, aprovação contratual, aceite de Privacidade nem validação visual de Rose.

Rastreabilidade: `CHN-P04-01..14`, `MSG-01..04`, `ORD-03..05`, `PAY-02`,
`PAY-05`, `PRV-P06-07` e `PRV-P06-11`.

## Decisões seguras

- Meta: validar `X-Hub-Signature-256` sobre o raw body exato e deduplicar
  inbound localmente. A documentação revisada não comprovou chave de
  idempotência para envio nem `GET` de resultado por `wamid`; crash após aceite
  vira `outcome_unknown`, sem retry cego.
- Status Meta: `wamid` serve para correlação dos webhooks observados. Ausência
  de evento não autoriza afirmar entrega, falha ou recuperação.
- Mídia/templates: ficam cobertos pela coleção oficial e fixtures locais, mas
  upload/download, template aprovado e status exigem conta sandbox/live.
- Gemini Developer API: tier pago e `gemini-2.5-flash-lite` foram aprovados
  condicionalmente em 31/08/2026. A chamada usa `models.generateContent`
  stateless com JSON Schema estrito, sem Interactions, grounding, File API,
  cache explícito ou logging opt-in. O free tier é vedado. Sem ZDR aprovado, o
  provedor informa retenção de abuso por 55 dias; por isso produção com PII
  permanece fail-closed até a confirmação live do ZDR. A credencial deve ser
  uma auth key criada no AI Studio, restrita à Gemini API e mantida somente no
  servidor. O smoke exige `AI_PROVIDER=google-gemini-developer-api` e
  `AI_MODEL_PRIMARY=gemini-2.5-flash-lite`.
- Cloudflare R2: bucket privado, credenciais separadas, `HEAD` antes de retry de
  `PutObject` incerto, Bucket Lock para dados imutáveis e localização ainda
  pendente de Privacidade. DPA v6.4 foi somente revisado.
- PDF: snapshot/template versionados e hash são o contrato local; a revisão
  visual de Rose permanece humana.

## Evidências e pendências externas

A fonte, data, status e owner de cada efeito ficam em
`external-effects.json`. Permanecem bloqueadores externos explícitos:

1. Operação/Integrações: executar sandbox/live Meta para assinatura real,
   mensagens, mídia, template aprovado e todos os status.
2. Privacidade/Tech Lead: registrar responsáveis nominais e a confirmação live
   do ZDR da Gemini Developer API; Cloudflare R2 DPA/localização/controles ainda
   exigem aceite separado.
3. Rose/Operação: aprovar visualmente o PDF canônico da Ficha.
4. Produto/Operação/Tech Lead: confirmar ou ajustar `load-envelope.json`.
5. T07.1: medir carga somente depois da aprovação do envelope.

O procedimento executável e a matriz de fechamento da Meta estão em
[`META-SANDBOX.md`](META-SANDBOX.md). O receiver e o smoke ali descritos são
deliberadamente não produtivos: a deduplicação durável e a criação transacional
de mensagem/job continuam em `T02.2`.

Até essas ações, T00.4 não deve ser marcada como concluída integralmente. As
pendências precisam virar issues GitHub com owners e evidência de aceite.

## Verificação

```powershell
npm run validate:external-spikes
npm run test:external-spikes
npm run test:gemini:privacy
npm run smoke:gemini:privacy # somente com credencial paga e prompt sintético
npm run smoke:meta:sandbox # somente com credenciais locais autorizadas
npm run validate
```

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
- Mídia/templates Meta: o sandbox aceitou texto, template, documento e imagem
  com `wamid`; `sent`, `delivered`, `read` e `failed` foram observados. Texto,
  documento e imagem terminaram em `failed` por janela de 24 horas (`131047`),
  sem inferência de entrega. A evidência sanitizada está em
  `meta-sandbox-live-evidence.json`.
- Retenção da mídia: para o produto interno, bytes recebidos/enviados usam
  volume privado da VPS e expiram no fim da jornada ou em sete dias, o que
  ocorrer primeiro. Arquivos válidos seguem ao Dropbox pelo procedimento
  operacional existente; nenhum adapter/API Dropbox é presumido. O contrato
  executável está em [`media-retention-policy.json`](./media-retention-policy.json).
- Gemini Developer API: tier pago e `gemini-2.5-flash-lite` foram aprovados
  condicionalmente em 31/08/2026. A chamada usa `models.generateContent`
  stateless com JSON Schema estrito, sem Interactions, grounding, File API,
  cache explícito ou logging opt-in. O free tier é vedado. Sem ZDR aprovado, o
  provedor informa retenção de abuso por 55 dias; por isso produção com PII
  permanece fail-closed até a confirmação live do ZDR. A credencial deve ser
  uma auth key criada no AI Studio, restrita à Gemini API e mantida somente no
  servidor. O smoke exige `AI_PROVIDER=google-gemini-developer-api` e
  `AI_MODEL_PRIMARY=gemini-2.5-flash-lite`.
- Cloudflare R2: o gate local fail-closed foi preservado para a dívida `#29` em
  [`R2-VALIDATION.md`](./R2-VALIDATION.md) e
  [`r2-control-plane.json`](./r2-control-plane.json). Ele exige três buckets
  privados, credenciais separadas, `HEAD` + SHA-256 antes de retry de
  `PutObject` incerto e Cloudflare-native Bucket Lock no prefixo imutável. R2
  não suporta S3 Object Lock nem versionamento de bucket. DPA v6.4,
  subprocessadores, localização, provisionamento e controles live permanecem
  pendentes de Privacidade/DevOps. Assinatura e provisionamento estão
  explicitamente diferidos e não bloqueiam a política de mídia interna da
  issue `#6`.
- PDF: o pacote sintético reproduzível, o artefato visual e o gate fail-closed
  estão em [`FICHA-PDF-REVIEW.md`](FICHA-PDF-REVIEW.md). Snapshot/template e
  hashes são o contrato local; a revisão visual de Rose e Operação permanece
  humana.

## Evidências e pendências externas

A fonte, data, status e owner de cada efeito ficam em
`external-effects.json`. Rose e Operação aprovaram a Ficha canônica
`ficha-canonical-v2`; a evidência versionada e sem PII fecha a issue `#7` sem
alterar o estado dos demais efeitos externos. Permanecem bloqueadores externos
explícitos:

1. Operação/Integrações: antes da produção, registrar o número real, criar token
   de usuário do sistema, configurar pagamento e substituir a deduplicação em
   memória pela inbox PostgreSQL de `T02.2`; o sandbox de T00.4 está concluído.
2. Privacidade/Tech Lead: registrar responsáveis nominais e a confirmação live
   do ZDR da Gemini Developer API. Cloudflare R2 DPA, subprocessadores,
   localização e controles live foram movidos para a issue `#29`, antes de uso
   externo ou de qualquer alegação de durabilidade superior à VPS.
3. Produto/Operação/Tech Lead: confirmar ou ajustar `load-envelope.json`.
4. T07.1: medir carga somente depois da aprovação do envelope.

O procedimento executável e a matriz de fechamento da Meta estão em
[`META-SANDBOX.md`](META-SANDBOX.md). O receiver e o smoke ali descritos são
deliberadamente não produtivos: a deduplicação durável e a criação transacional
de mensagem/job continuam em `T02.2`.

Até essas ações, T00.4 não deve ser marcada como concluída integralmente. As
pendências precisam virar issues GitHub com owners e evidência de aceite.

## Verificação

```powershell
npm run validate:r2
npm run test:r2
npm run smoke:r2:live # somente se a issue #29 autorizar custo e provisionamento
npm run validate:media-retention
npm run test:media-retention
npm run validate:external-spikes
npm run test:external-spikes
npm run test:gemini:privacy
npm run smoke:gemini:privacy # somente com credencial paga e prompt sintético
npm run smoke:meta:sandbox # somente com credenciais locais autorizadas
npm run validate
```

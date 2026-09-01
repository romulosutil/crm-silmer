# Dívida #29 — Aprovação e validação futura do Cloudflare R2

Rastreabilidade: issue `#29`; histórico de `T00.4`; `PRV-P06-07`, `PRV-P06-11`, `ORD-04`
e `ORD-05`.

## Estado do gate

**Diferido.** O produto interno exige custo incremental zero e adotou mídia
transitória na VPS pela issue `#6`. Não há autorização para assinatura,
provisionamento ou smoke live do R2. O contrato local e o smoke fail-closed
permanecem como opção futura, mas não há nesta evidência autenticação
Cloudflare, buckets provisionados, controles live ou aceite humano. Um teste
local verde não fecha a issue `#29` nem reabre a decisão de custo do piloto.

O Responsável de Privacidade e o Tech Lead ainda precisam registrar, em
[`r2-control-plane.json`](./r2-control-plane.json), a decisão sobre o DPA 6.4,
subprocessadores e localização. `Location Hint` é apenas best effort; não prova
residência. Se residência brasileira explícita for obrigatória, a baseline
passa para AWS S3 `sa-east-1` antes de criar buckets definitivos.

## Contrato candidato para implementação futura

- Buckets privados e distintos: `crm-silmer-data`, `crm-silmer-backups` e
  `crm-silmer-tombstones`.
- Credenciais separadas por classe. O runtime não recebe credenciais de backup,
  restore ou configuração; o restore de tombstones usa credencial read-only
  fora do runtime normal.
- `r2.dev` e custom domains permanecem desabilitados. Acesso temporário usa URL
  assinada de operação/objeto único, com TTL máximo de 300 segundos e
  `Cache-Control: no-store` na resposta da aplicação.
- R2 fornece TLS e criptografia at rest administrada pelo provedor. O smoke
  confirma endpoint HTTPS e a configuração exposta pela API S3.
- Imutabilidade usa **Cloudflare R2 Bucket Lock** no prefixo `tombstones/`,
  `If-None-Match: *`, chaves opacas e cópia independente. R2 não implementa S3
  Object Lock nem versionamento de bucket; headers `x-amz-object-lock-*` e
  `x-amz-bucket-object-lock-enabled` são proibidos.
- A credencial administrativa que altera Bucket Lock fica separada do runtime,
  com MFA, auditoria e aprovação para mudança. Bucket Lock não é tratado como
  equivalente a AWS Object Lock compliance mode.
- A retenção mínima do lock é 36 dias e precisa cobrir a última cópia
  relacionada. Lifecycle provider-native é usado somente no bucket de backup;
  `data` depende dos gatilhos e `legal_hold` do P0.6, e tombstones dependem do
  lock, portanto ambos recusam regras de exclusão age-only no provedor; abort de
  multipart incompleto e transições não destrutivas continuam permitidos.

## Reconciliação de `PutObject` incerto

O canário usa conteúdo sintético, chave opaca e metadata `sha256`. Após simular
perda da resposta depois do aceite remoto, o smoke registra
`outcome_unknown`, não dispara um segundo `PUT` e executa `HeadObject` na mesma
chave:

1. SHA-256 igual confirma o efeito sem retry.
2. `404` permite nova tentativa da mesma chave com `If-None-Match: *`.
3. Hash ausente/divergente, `403`, `5xx` ou timeout permanece em reconciliação.
4. `ETag` isolado nunca confirma conteúdo.

Esse contrato preserva número, versão e hash da Ficha; reconciliação não cria
novo Pedido nem nova versão (`ORD-04/05`).

## Procedimento live

Este procedimento só pode começar depois de Produto autorizar custo e
Privacidade/DevOps retomarem formalmente a issue `#29`.

1. Privacidade/Tech Lead aprovam ou recusam DPA, subprocessadores e localização.
2. DevOps cria os três buckets somente depois da decisão de localização e cria
   tokens bucket-scoped separados para data, backup, tombstone-write e
   tombstone-restore-read.
3. DevOps configura lifecycle de backup e Bucket Lock somente no namespace
   imutável. A retenção mínima é `3110400` segundos; `data` e tombstones não
   recebem regras de exclusão age-only que ignorem os gatilhos e `legal_hold` do
   P0.6.
4. Copiar [`r2-live.env.example`](./r2-live.env.example) para arquivo ignorado,
   preencher valores localmente e executar:

```powershell
npm run smoke:r2:live
```

5. Revisar `var/r2-live-evidence.json`. A evidência não contém account ID,
   nomes de chave live, credenciais, headers de autorização, conteúdo, signed
   URLs nem PII. Somente uma versão revisada e sanitizada pode ser anexada à
   issue.

## Critérios live obrigatórios

- os três buckets existem, não possuem `r2.dev` nem custom domain habilitado e
  reportam a localização/jurisdição aprovada;
- cada credencial funciona apenas na classe esperada; toda tentativa cruzada
  falha e o restore de tombstones é read-only;
- lifecycle de backup expira em até 35 dias; `data` e tombstones não possuem
  regras de exclusão age-only capazes de antecipar o P0.6 ou o Bucket Lock;
- signed URL tem TTL de até 300 segundos e nunca é logada;
- Bucket Lock está ativo no prefixo imutável e overwrite/delete do canário são
  recusados;
- `PutObject` incerto é reconciliado por `HEAD` + SHA-256 sem retry cego;
- DPA/localização permanecem `pending-human-approval` até registro nominal.

## Verificação local

```powershell
npm run validate:r2
npm run test:r2
npm run validate:external-spikes
npm run test:external-spikes
npm run validate:topology
npm run test:recovery:mocks
npm run validate
```

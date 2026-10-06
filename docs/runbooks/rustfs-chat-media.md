# Ativação de mídia do chat no RustFS

Requisitos MED-16, MED-19, MED-23; tarefa T1 de
[INBOX-MEDIA-1](../../.specs/features/inbox-media-rustfs/tasks.md).
O smoke comprova operações na imagem testada. Não comprova backup, recovery
ou prontidão do deployment remoto. A promoção é gate de T23.

## Escopo e isolamento

Usar `crm-silmer-chat-media-dev` para bytes sintéticos e
`crm-silmer-chat-media` para operação. Ambos são privados e sem lifecycle de
expiração. Mídias enviadas permanecem salvas até nova decisão do usuário.
`hermes-backups` pertence a outro uso: não listar objetos, ler, gravar,
alterar policy, mover volumes ou armazenar backup do CRM nesse bucket.

A versão configurada observada no EasyPanel é
`rustfs/rustfs:1.0.0-alpha.99`. Testar essa imagem em ambiente local isolado,
conforme autorização posterior do usuário para Docker local. Registrar
digest real do container testado, origem do digest e versão. Tag de imagem
não comprova digest nem versão efetivamente executada em produção.
Não atualizar RustFS compartilhado como efeito do smoke.

## Acesso mínimo

Preparar identidade específica para cada ambiente. Não usar root no CRM.
O operador cria bucket e credencial sob autorização vigente. Guardar
segredos no gerenciador de secrets e injetá-los no processo; não imprimir
variáveis, copiar do painel para documentação ou versionar `.env`.

Policy de exemplo para a identidade DEV, sem acesso ao bucket operacional:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLifecycle"],
      "Resource": ["arn:aws:s3:::crm-silmer-chat-media-dev"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::crm-silmer-chat-media-dev/*"]
    }
  ]
}
```

O smoke faz HEAD no outro bucket CRM para exigir 403. No loopback local,
aceita também o bucket vazio sintético `crm-silmer-smoke-denied-local`.
Os dois buckets
devem existir, para o teste não confundir inexistência com isolamento.
Não usa objetos desse outro bucket. A API operacional e o worker terão
papéis próprios em T3/T23; esse exemplo é somente para homologação DEV.

A alpha.99 usa a action IAM `s3:GetBucketLifecycle`, conforme
[enum da versão](https://github.com/rustfs/rustfs/blob/1.0.0-alpha.99/crates/policy/src/policy/action.rs).
`s3:GetLifecycleConfiguration` foi rejeitada como action inválida nesse
runtime local. A operação HTTP continua `GET /{bucket}?lifecycle`.

## Execução

Injetar estas variáveis sem colocá-las na linha de comando ou logs:

| Variável                    | Valor/contrato                                                 |
| --------------------------- | -------------------------------------------------------------- |
| RUN_RUSTFS_LIVE_SMOKE       | `yes`, após revisar o escopo                                   |
| MEDIA_S3_ENDPOINT           | Origin HTTPS S3, sem path/query/credenciais                    |
| MEDIA_S3_REGION             | Região exigida pelo serviço, normalmente `us-east-1`           |
| MEDIA_S3_BUCKET             | Bucket CRM da identidade do teste                              |
| MEDIA_S3_ACCESS_KEY_ID      | Credencial limitada do ambiente                                |
| MEDIA_S3_SECRET_ACCESS_KEY  | Secret da credencial limitada                                  |
| RUSTFS_SMOKE_DENIED_BUCKET  | O outro bucket CRM existente                                   |
| RUSTFS_RUNNING_IMAGE_DIGEST | `sha256:` mais 64 caracteres hex, observado no runtime testado |
| RUSTFS_SMOKE_EVIDENCE_PATH  | Caminho local novo; padrão `var/rustfs-live-evidence.json`     |

HTTP é aceito somente para `localhost`, `127.0.0.1` ou `[::1]`, para
homologação isolada. Endpoints externos exigem HTTPS. Capturar o digest
com inspeção do container/imagem local. No alvo EasyPanel, capturar seu
digest separadamente antes da promoção; a imagem local não prova o remoto.

```powershell
rtk npm run smoke:rustfs:live
```

O script usa SigV4 com path-style para um canário pequeno e não instala
SDK. O adapter da aplicação em T3 usará SDK fixado. O smoke verifica:

1. Ausência de lifecycle de expiração, sem alterar configuração.
2. PUT de bytes sintéticos com metadata SHA-256.
3. HEAD com tamanho/hash corretos.
4. GET com bytes exatos e hash SHA-256 correto.
5. GET Range com 206, bytes exatos e Content-Range.
6. Range fora do objeto com 416.
7. GET anônimo negado com 403.
8. HEAD no outro bucket CRM negado com 403.
9. DELETE do canário com 204 e HEAD posterior 404.

Evidence JSON só é escrito após todos os checks. Contém data, digest,
bucket CRM e resultados; não contém chave do objeto, segredo, URL ou dados
de cliente. Caminho já existente impede sobrescrita. O arquivo em `var/`
é local e não vira evidência versionada automaticamente.

Falhas de transporte são sanitizadas. Após qualquer tentativa de PUT,
inclusive resultado desconhecido, o finally tenta remover somente a chave
do canário gerada pela execução. Falha de cleanup exige reconciliação pelo
operador; não repetir indiscriminadamente nem varrer bucket. Se precisar
localizar um canário restante, revisar exclusivamente o prefixo sintético
`compatibility-canary/` no bucket do teste com o operador autorizado.

## Gates e promoção

```powershell
rtk proxy node --test test/rustfs-live-smoke.test.js
rtk npm run validate:topology
rtk npm run test:recovery:mocks
```

Testes com transporte fake comprovam o harness, não RustFS. Arquivo de
evidência de teste local deve indicar `local-version-compatibility`.
No deployment alvo executar novamente com credencial limitada e digest
real; registrar `target-deployment`. Gate operacional continua pendente
até comprovar acesso mínimo, quota, backup externo, restauração e rollback
de T23. Não atribuir esses resultados ao smoke de compatibilidade.

Fontes: [matriz S3 RustFS](https://docs.rustfs.com/en/reference/s3-compatibility)
e [SigV4 S3](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html).
A documentação atual não substitui o teste da versão alpha.99.

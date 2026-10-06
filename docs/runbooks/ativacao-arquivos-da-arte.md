# Ativação dos arquivos da arte em produção

Runbook da [ADR 023](../adr/023-arquivos-da-arte-no-rustfs.md) (ARQ-01–ARQ-09,
T92). Ele liga “Arquivos da arte” e “Arte final” na página do pedido usando o
RustFS compartilhado `schedule/rustfs`. Nenhum valor de segredo entra neste
arquivo, no repositório ou em chat.

## Estado em 06/10/2026

| Item                                                 | Situação                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| PR #150 no `master` (`5a0391d`)                      | Mergeado                                                                                       |
| `silmer-edge-web` com a tela de arquivos             | Implantado do `5a0391d`                                                                        |
| `silmer-api` com as rotas `/orders/{id}/files`       | Implantado do `5a0391d` minutos após o merge; o gatilho desse deploy não foi verificado        |
| Bucket privado `crm-silmer-arquivos`                 | Criado em 05/10/2026, sem versionamento, bloqueio de objeto ou cota                            |
| Política `crm-silmer-arquivos-rw`                    | Criada em 06/10/2026: `ListBucket`/`GetBucketLocation` no bucket e `Get/Put/DeleteObject` nele |
| Usuário RustFS do CRM e suas chaves                  | Pendente (pessoa responsável)                                                                  |
| `OBJECT_STORAGE_*` no `silmer-api`                   | Pendente; sem elas as rotas de arquivos respondem 503 e o resto do pedido funciona             |
| Migrações 0027 (`crm.order_files`) e 0028 (handoff)  | Pendentes                                                                                      |
| Domínios públicos S3/console, digest, backup e drill | Lacunas abertas em `ops/easypanel/topology.json`                                               |

## Passos

1. **Usuário do CRM no RustFS.** No console do `schedule/rustfs`, em
   Usuários, criar `crm-silmer-api` com a política `crm-silmer-arquivos-rw`
   e nenhuma outra. Guardar as chaves só no cofre de segredos. As chaves root
   da instância nunca vão para o CRM (condição do aceite da ADR 023).
2. **Variáveis do `silmer-api`.** Em EasyPanel → `espectro-mvp` →
   `silmer-api` → Ambiente, acrescentar as cinco de uma vez; configuração
   parcial é erro de inicialização e derruba a API:

   ```text
   OBJECT_STORAGE_ENDPOINT=http://schedule_rustfs:9000
   OBJECT_STORAGE_REGION=us-east-1
   OBJECT_STORAGE_BUCKET=crm-silmer-arquivos
   OBJECT_STORAGE_ACCESS_KEY_ID=<chave do usuário crm-silmer-api>
   OBJECT_STORAGE_SECRET_ACCESS_KEY=<segredo do usuário crm-silmer-api>
   ```

3. **Implantar o `silmer-api`** para carregar as variáveis.
4. **Migrações.** No console do container novo do `silmer-api`, rodar
   `npm run db:migrate`. Aplica só `*.expand.sql` pendentes (0027 e 0028), sob
   advisory lock; não reescreve dados. Registrar a saída sem segredos.
5. **Smoke.** Num pedido pendente de teste, enviar um PNG pequeno, conferir a
   miniatura, baixar o arquivo e removê-lo. Repetir com um `.cdr` ou `.pdf`.
   Num pedido gerado, conferir que só há “Baixar”.

## Diagnóstico

| Sintoma na tela                               | Causa provável                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| “Arquivos indisponíveis no momento.” (503)    | `OBJECT_STORAGE_*` ausentes no container em execução, ou RustFS fora do ar                               |
| “Arquivos indisponíveis no momento.” (500)    | Migração 0027 não aplicada: o log da API mostra `crm.order_files` inexistente                            |
| Envio falha com “indisponíveis” e listagem ok | `schedule_rustfs:9000` inalcançável a partir do `espectro-mvp`, chave errada ou política sem `PutObject` |
| API não sobe após salvar o ambiente           | Uma das cinco variáveis faltando ou vazia                                                                |

## Rollback

Remover as cinco variáveis e implantar de novo desliga os arquivos (503) sem
afetar o pedido. As migrações 0027 e 0028 são expand-only e podem ficar. Os
objetos no bucket não são apagados por esse rollback.

## Depois da ativação

Atualizar `ops/easypanel/topology.json` e `ops/easypanel/provisioning-gate.json`
com a evidência: `dedicatedCredential` e `apiCredentialsSeparated` quando o
usuário existir; `crossProjectEndpointSmoked` após o smoke do passo 5. As
demais lacunas (domínios públicos, digest, backup off-host e drill) continuam
bloqueando o gate até terem evidência própria.

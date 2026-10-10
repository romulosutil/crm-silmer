# RFC 017 — Mídia do chat no RustFS

Refinamento T15: a configuração n8n 2.38.7 `none/none/false/false` não elimina
o registro inicial do webhook antes do pruning. O ensaio real identificou
categorias recipient/caption na stack inicial soft-deleted; não persistiu
runData/binary e os canários raw/base64 não apareceram em DB/WAL/arquivos/logs.
O gate de privacidade de produção T23 permanece **não atendido** até comprovar
minimização/expurgo de PII e retenção/pruning conforme EASYPANEL-TOPOLOGY.md.
Isso é uma limitação observada, sem alteração do ADR-029. Fonte e contrato
efetivo em [design](../../.specs/features/inbox-media-rustfs/design.md).

Status: decisão de storage/retenção tomada em 05/10/2026;
detalhes de implementação em revisão. Decisão: [ADR 029](../adr/029-midia-do-chat-no-rustfs.md).
Responsável pela proposta: Tech Lead. Decisor: usuário solicitante nesta sessão.
Revisores da implementação: Backend/Dados, Integrações, Frontend/A11y,
QA/Privacidade e DevOps conforme a fronteira.

## Contexto e impacto

O vendedor envia apenas texto. RustFS está instalado e possui rota S3 HTTPS.
O usuário escolheu reutilizá-lo e preservar anexos enviados sem prazo de sete
dias. A baseline de mídia transitória não atende à nova decisão.

## Alternativas

| Opção                                                 | Vantagem                                                                      | Custo                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| RustFS existente, acesso mediado pelo CRM             | Reutiliza serviço; controle de ACL por conversa; sem URL portadora no browser | Operar storage e backup; proxy de bytes e Range na API                                                                         |
| RustFS existente, upload e leitura com URLs assinadas | Menos banda e processamento no CRM                                            | Revogação limitada ao vencimento, CORS e validação pós-upload; incompatível com leitura estritamente autorizada por requisição |
| Volume privado atual                                  | Menor alteração técnica                                                       | Não satisfaz escolha explícita de RustFS; recuperação continua local                                                           |

Recomendação detalhada: RustFS via API; scanner e normalização no worker
existente. Nenhum microserviço ou fila Redis. Os detalhes permanecem propostos.

## Resultado

Storage RustFS e retenção sem expurgo automático foram decididos pelo usuário.
Áudio pelo microfone também foi confirmado. A arquitetura detalhada e as 24
tarefas estão no [plano](../../.specs/features/inbox-media-rustfs/design.md).

## Critérios de decisão e aceite

T13 acrescenta GET técnico por comando e representação `?preflight=true` no
mesmo endpoint. A leitura exige capacidade mínima e a identidade original da
reserva em `crm.n8n_events`; replay não cria autorização, lease ou reserva.
Preflight revalida epoch/revisão após upload Meta e imediatamente antes de
`/messages`, sem S3 ou bytes. Não há atomicidade entre CRM e Meta.

`workflow.failed` com `failure.phase=before_message_send` conclui somente o
comando processing e a mensagem sending da mesma execução original, sem
external_message_id. Códigos são a allowlist publicada no OpenAPI. Epoch atual
não é necessário para abortar uma reserva invalidada. CAS, flags de retry false
e recibo idempotente impedem regressão de sent/read/delivered/unknown. Ramos
de erro após invocar `/messages` usam unknown; ErrorTrigger genérico continua
diagnóstico. A prova do ramo anterior ao efeito pertence ao workflow T14/T15.

- MED-01..29; INBOX-MEDIA-1 e MSG/PRV vigentes com a exceção da ADR 029.
- Bucket privado próprio, sem compartilhar hermes-backups; nenhuma credencial root.
- Smoke comprova PUT/HEAD/GET/Range/DELETE e negativa de acesso entre buckets na
  versão instalada, sem presumir compatibilidade de releases posteriores.
- Anexos enviados preservados após encerramento e oito dias; rascunhos isolados.
- DEV usa arquivos reais e callbacks simulados; canal Meta exige homologação.
- Backup externo e restore verificados antes de expectativa de recuperação operacional.

Relacionados: [issue #29](https://github.com/romulosutil/crm-silmer/issues/29),
[issue #6](https://github.com/romulosutil/crm-silmer/issues/6),
[spec](../../.specs/features/inbox-media-rustfs/spec.md),
[tasks](../../.specs/features/inbox-media-rustfs/tasks.md).
Issue/PR específicos desta implementação ainda não criados; vincular ao abrir.

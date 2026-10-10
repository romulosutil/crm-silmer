# ADR 029 — Mídia do chat no RustFS

Status: aceita para storage e retenção; integração local validada; homologação
humana e gates externos pendentes.
Data: 05/10/2026. Decisor: usuário solicitante por instrução explícita nesta sessão.
Proposta e alternativas: [RFC 017](../rfc/017-midia-do-chat-no-rustfs.md).

## Integração de 10/10/2026

Supersede a [decisão original preservada](history/023-midia-do-chat-no-rustfs.md)
apenas para corrigir a colisão de numeração com a ADR 023 da master.
A decisão de storage e retenção de 05/10/2026 permanece integralmente vigente.
Os links relativos da cópia histórica correspondem à árvore original da branch.

## Contexto

Já existe RustFS no EasyPanel. O usuário autorizou seu uso no CRM e pediu que
os anexos enviados no chat permaneçam salvos por enquanto. Confirmou também
anexar áudio e gravar pelo microfone. A baseline anterior apagava mídia de
canal após sete dias ou ao encerrar a jornada.

## Decisão

1. Usar o RustFS existente para a nova mídia enviada pelo vendedor no chat,
   com buckets privados próprios do CRM e metadados no PostgreSQL.
2. Preservar anexos enviados até nova decisão explícita de retenção. Sete dias,
   encerramento e arquivamento da conversa não autorizam sua exclusão automática.
3. Rascunho abandonado, arquivo inválido e cópia de processamento não são mídia
   enviada. Sua limpeza limitada será definida e testada no plano de implementação.
4. O bucket hermes-backups e seus acessos ficam fora desta implementação.
5. Não inferir durabilidade recuperável apenas da instalação do RustFS.
   Backup externo, restore e privacidade operacional exigem evidências próprias.
6. Esta decisão não autoriza upgrade do serviço compartilhado, criação de
   credenciais administrativas, exposição pública de objetos ou deploy nesta sessão.

## Consequências

Esta ADR substitui a baseline de sete dias/fim de jornada para a nova classe
de mídia enviada do chat. O runtime legado continua transitório até a entrega
da migração e dos filtros de jobs. Bytes legados ainda disponíveis exigem
inventário e cópia verificada antes de promoção; bytes apagados não se recuperam
por uma alteração de política. Pedidos, fichas e backups mantêm seus contratos.

Retenção estendida aumenta ocupação e alcance do backup. Quotas e recuperação
integram a entrega. A política futura de exclusão continua aberta para revisão
própria; não se declara guarda perpétua nem aprovação jurídica nova.

Rastreabilidade: MED-01..29, INBOX-MEDIA-1, INBOX-3/4, MSG-01..03,
PRV-01..03 e T02/T06.
Relacionados: [issue #29](https://github.com/romulosutil/crm-silmer/issues/29),
[issue #6](https://github.com/romulosutil/crm-silmer/issues/6),
[spec](../../.specs/features/inbox-media-rustfs/spec.md),
[tasks](../../.specs/features/inbox-media-rustfs/tasks.md).
Vincular issue/PR próprios quando criados, sem inventar números.

# ADR 088 — Leitura de conversas por responsável

- Status: aceita pelo proprietário em 12/11/2026, neste chat.
- Proposta: [RFC 066](../rfc/066-visibilidade-de-conversas-por-responsavel.md).
- Requisito e tarefa: [CONV-ACL-01 / CONV-ACL-T01](../../.specs/features/conversation-visibility/spec.md).
- PR: [#369](https://github.com/romulosutil/crm-silmer/pull/369).

## Contexto

A leitura da Inbox era compartilhada entre vendedores, inclusive por link direto.
O proprietário determinou que somente administradores consultem conversas de
outros vendedores. A regra precisa proteger todas as leituras e seus derivados.

## Decisão

Uma pessoa ativa com `COMMERCIAL_ADMIN` pode ler todas as conversas. Vendedor
ativo sem essa capacidade só lê conversas cujo `assigned_user_id` é seu ID
atual ou é nulo. Conversas sem dono incluem atendimento pela IA e handoffs
aguardando reivindicação. O modo IA sozinho não libera conversa de outro dono.
Financeiro e atores técnicos não recebem acesso humano à Inbox.

A API aplica o escopo antes de paginar ou contar, inclusive em arquivadas,
encerradas, filtros e buscas. Link direto não contorna a regra. Mensagens,
mídia, transcrições, assuntos, contexto e resumos seguem a conversa; o histórico
do Contato não enumera conversas ocultas. SSE revalida a sessão e o acesso atual;
eventos ocultos produzem apenas invalidação genérica, sem IDs ou conteúdo.
Transferência revoga a leitura do antigo dono; replay de comando não restaura
conteúdo protegido. Cursores são vinculados ao leitor e à abrangência atual.

Pedidos continuam sob sua autorização comercial própria. Sua consulta não
concede leitura da conversa, de suas mensagens ou do contexto de IA; projeções
comerciais ocultam vínculo navegável e metadados da conversa não autorizada.
Criação/edição de pedidos e envio de mensagens mantêm suas guardas de posse.

Supersede somente a leitura compartilhada de conversas prevista em PCX-17a e
nos trechos correspondentes do PRD/TDD. Não altera transporte, retenção ou
infraestrutura. Sem migração. Rollback exige decisão de produto, pois voltar ao
código anterior reabre a leitura compartilhada.

## Alternativas

Ocultar apenas na interface permitiria acesso por URL/API. Usar apenas modo IA
permitiria ler conversa atribuída a outro vendedor. Ambas foram rejeitadas.

## Verificação e operação

Matriz de aceites, testes e limites no [runbook](../runbooks/conversation-visibility.md).
Commit/push não comprovam deploy: a ativação depende do pipeline e da imagem
realmente publicada. Esta decisão não autoriza sessões de produção para testes.

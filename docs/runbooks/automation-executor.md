# Ator técnico do n8n

## Escopo

O n8n chama a API do CRM como o ator técnico fixo `AUTOMATION_EXECUTOR`. Essa
identidade não é uma pessoa, não recebe função operacional, não abre sessão de
navegador e não participa das rotas de convite, login ou concessão de
capacidades.

As ações autorizadas pelo contrato v1 são:

- persistir mensagem canônica normalizada pelo n8n;
- registrar atualização de entrega;
- correlacionar execução e versão do workflow;
- armazenar anexo seguro e reivindicar rodada de IA;
- reservar envio antes da Meta, atualizar briefing e registrar falha;
- criar handoff sem responsável para a fila do papel-alvo;
- abrir o Pedido pendente da conversa, pelo `open_order` da reserva de envio
  ou do handoff (ADR 014), ou pelo evento obsoleto `order.intent_confirmed`
  (ação `order.intent`);
- converter uma conversa em Negócio;
- atualizar campos oficiais de um Negócio;
- registrar transição de etapa validada pelo CRM.

Aprovação comercial, administração de identidades, retenção privilegiada e
acesso direto ao PostgreSQL permanecem proibidos. O banco do CRM nunca é
exposto pelo contrato de autenticação técnica.

## Configuração e rotação

O n8n usa autenticação HTTP Basic servidor-a-servidor. O identificador vem de
`CRM_AUTOMATION_CLIENT_ID`; o segredo atual vem de
`CRM_AUTOMATION_CLIENT_SECRET` e precisa ter pelo menos 32 caracteres. Durante
uma rotação controlada, `CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET` pode manter o
segredo anterior válido pelo menor intervalo operacional possível. O runtime
mantém somente hashes SHA-256 para comparação em tempo constante.

Para rotacionar a credencial:

1. gerar um segredo aleatório novo no gerenciador de secrets;
2. copiar temporariamente o segredo atual para
   `CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET` e publicar o novo em
   `CRM_AUTOMATION_CLIENT_SECRET` no CRM;
3. reiniciar a API de forma controlada, atualizar o secret do n8n e executar um
   comando permitido com a nova credencial;
4. remover `CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET` e reiniciar a API;
5. confirmar que a credencial anterior recebe `401` e que a recusa foi
   auditada sem conter o segredo.

O piloto usa uma única instância da API. Uma futura rotação com sobreposição
entre múltiplas instâncias exige contrato próprio; não se mantém token anterior
ativo implicitamente.

HMAC e timestamp não fazem parte do contrato n8n→CRM. TLS, Basic, allowlist,
idempotência com fingerprint, correlação e fences de revisão/epoch formam o
controle. CRM→n8n usa outra credencial, em `N8N_COMMAND_CLIENT_ID` e
`N8N_COMMAND_CLIENT_SECRET`, entregue somente ao worker.

Antes de publicar o workflow, criar no n8n duas credenciais `httpBasicAuth`,
vinculá-las às direções corretas e executar o smoke sem registrar valores. O
workflow permanece inativo se qualquer credencial estiver ausente.

## Auditoria e resposta a falhas

Credencial ausente ou inválida retorna `401`. Credencial válida tentando ação
fora da allowlist retorna `403`. As duas recusas geram evento de auditoria com
ação, ator técnico ou origem não autenticada, correlação, alvo fixo e versão da
credencial. Segredo, header bruto, payload, mensagem, contato e outros dados
pessoais não entram no evento.

Falha ao persistir a auditoria também mantém a operação negada. Não existe
fallback para sessão humana, acesso direto ao banco ou permissão implícita.

Timeout depois de `message.send.requested` produz `message.send.unknown`; não
repita o envio. Comando CRM→n8n em `outcome_unknown` segue para reconciliação.
Se houver suspeita de comprometimento, pausar o workflow, revogar as duas
credenciais, elevar o epoch das conversas afetadas e reconciliar reservas antes
de retomar.

### Pedido que não abriu (`ORDER_OPEN_FAILED`)

Pela [ADR 014](../adr/014-pedido-abre-no-primeiro-ponto-da-ficha.md), a
reserva de envio ou o handoff com `open_order: true` abre o Pedido pendente
depois que o evento confirma. Se o módulo de pedidos falhar, o evento continua
aceito (a resposta ao cliente sai e o handoff acontece) e a falha aparece em
quatro lugares, sem dados pessoais:

1. **Resposta do evento no n8n:** `order.opened = false` e o código em
   `order.error`, na saída de "CRM - Reservar envio da IA (MVP)" ou "CRM -
   Registrar handoff (MVP)". A execução passa pelo ramo "Pedido não abriu?
   (MVP)".
2. **`workflow.failed` da conversa:** o workflow envia `failure.code` igual a
   `ORDER_OPEN_FAILED`, com o código do CRM em `failure.reason`. No CRM:

   ```sql
   SELECT processed_at, conversation_id, workflow_version, execution_id
   FROM crm.n8n_events
   WHERE event_type = 'workflow.failed'
     AND outcome ->> 'failureCode' = 'ORDER_OPEN_FAILED'
   ORDER BY processed_at DESC
   LIMIT 50;
   ```

3. **Auditoria do CRM:** gravada pelo próprio CRM, mesmo que o
   `workflow.failed` não chegue:

   ```sql
   SELECT occurred_at, target_id AS conversation_id, reason AS code,
          correlation_id
   FROM crm.audit_events
   WHERE action = 'integration.n8n.order.open_failed'
   ORDER BY occurred_at DESC
   LIMIT 50;
   ```

4. **Log da API:** `n8n event accepted but the pending order did not open`,
   com `code`, `conversationId`, `correlationId` e `eventType`.

Códigos: um código de domínio do módulo de pedidos (por exemplo
`CONVERSATION_NOT_FOUND`), `ORDER_OPEN_FAILED` para qualquer outro erro
(inclusive do banco, como uma API à frente da migração) e
`ORDERS_RUNTIME_UNAVAILABLE` quando a API sobe sem o módulo de pedidos.

O que fazer: corrigir a causa pelo `correlation_id` no log da API. No meio da
conversa, a rodada seguinte pede a abertura de novo e o pedido abre sozinho.
Depois de um handoff não há rodada seguinte: o vendedor que assumir a conversa usa "Criar
pedido" na gaveta (PCL-10), que parte da mesma pré-ficha. Se a chamada do
`workflow.failed` também falhar, o n8n mostra o erro na saída do nó "CRM -
Registrar falha ao abrir pedido (MVP)", sem interromper a execução, e a
auditoria do item 3 continua valendo.

## Pendência independente

Esta fatia não fecha a issue `#13`. A prova de `ACL-P07-07..11` depende do ciclo
real de Pedido/Ficha, incluindo API e UI acessível, previsto na CRM-3.

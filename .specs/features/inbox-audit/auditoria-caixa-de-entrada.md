# Auditoria — Caixa de Entrada (`/inbox`)

**Data:** 09/09/2026
**Ambiente:** `espectro-mvp-silmer-edge-web.jicnzg.easypanel.host`
**Usuário de teste:** `admin@crm-silmer.local` (função `Atendimento`, capability `COMMERCIAL_ADMIN`)
**Workflow n8n analisado:** `k7tI6T4RhQPyJkn9` — "Silmer | Atendimento WhatsApp IA"
**Método:** navegação real no browser + inspeção de rede/console + leitura do código-fonte e do JSON do workflow.

---

## 1. Veredito

A Caixa de Entrada está **funcional apenas como leitura**. Toda ação de escrita (assumir, devolver à IA, encerrar, responder) retorna **HTTP 403 FORBIDDEN** antes de tocar no domínio. Na prática o operador humano não consegue intervir em nenhuma conversa.

Causa raiz única e verificada: divergência entre duas listas de ações permitidas que deveriam ser a mesma.

---

## 2. O que FUNCIONA (verificado no ambiente)

| Item | Status | Observação |
|---|---|---|
| Sessão / autenticação | ✅ | `GET /api/v1/sessions/current` → 200 |
| Listagem de conversas | ✅ | `GET /api/v1/inbox/conversations?limit=100` → 200 |
| Detalhe da conversa | ✅ | `GET /api/v1/inbox/conversations/{id}` → 200 |
| Histórico de mensagens | ✅ | Direção in/out correta, timestamps pt-BR, status de entrega (`sent`) |
| Filtro **Estado** | ✅ | Vira query string (`&state=requer_atencao`), refaz o fetch |
| Filtro **Canal** | ✅ | Mesmo mecanismo |
| Busca textual | ⚠️ parcial | Funciona, mas ver bug #3 |
| Empty state | ✅ | "Nenhuma conversa encontrada" + "Selecione uma conversa" |
| Botão **Atualizar** | ✅ | Recarrega lista e detalhe |
| Link **Ver contato** | ✅ | Navega para `/clientes/{contactId}`, ficha carrega completa |
| Composer desabilitado c/ ajuda | ✅ | "Assuma o atendimento antes de responder." |
| Badge SSE "Ao vivo" | ⚠️ | Conecta, mas ver bug #5 |

---

## 3. O que NÃO funciona

### 🔴 BUG #1 — Todas as ações humanas retornam 403 (bloqueador de go-live)

**Reproduzido:** clique em "Assumir atendimento" →
`POST /api/v1/conversations/{id}/takeover` → **403**
UI exibe: *"A ação não foi concluída. Atualize a conversa e tente novamente."*

**Causa raiz:** existem **duas** allowlists de ações operacionais e elas divergiram.

- `modules/identity-access/src/authorization.js:12` (`operationalActions`) — **completa**, contém `conversation.takeover`, `conversation.reactivate-agent`, `conversation.transition`, `conversation.message.send`, `handoff.claim`.
- `apps/api/src/identity-runtime.js:16` (`OPERATIONAL_ACTIONS`) — **incompleta**, NÃO contém nenhuma dessas cinco.

O guard HTTP usa a lista de `identity-runtime.js`:

```js
async authorizeOperational(input) {
  if (!OPERATIONAL_ACTIONS.has(input.action)) {
    throw new IdentityHttpError(403, 'FORBIDDEN');   // ← morre aqui
  }
  ...
}
```

**Ações afetadas (todas 403):**

| Botão na UI | Rota | Ação exigida | Na allowlist? |
|---|---|---|---|
| Assumir atendimento | `POST .../takeover` | `conversation.takeover` | ❌ |
| Devolver à IA | `POST .../return-to-ai` | `conversation.reactivate-agent` | ❌ |
| Encerrar sem negócio | `POST .../close` | `conversation.transition` | ❌ |
| Enviar resposta | `POST .../messages` | `conversation.message.send` | ❌ |
| (Handoff claim) | `POST /handoffs/{id}/claim` | `handoff.claim` | ❌ |

Leitura funciona porque `conversation.read` e `contact.read` **estão** na lista.

**Correção:** unificar — `identity-runtime.js` deve importar a allowlist de `modules/identity-access`, nunca redeclarar. Enquanto forem duas listas, isso volta a acontecer.

---

### 🔴 BUG #2 — Não existe caminho de conversão para negócio

O endpoint `POST /api/v1/conversations/:conversationId/convert` existe (`apps/api/src/deal-routes.js:208`) e a ação `conversation.convert` **está** autorizada. Mas **nenhuma view Vue chama esse endpoint** — não há botão em lugar nenhum.

Resultado: a Caixa de Entrada só oferece desfecho negativo ("Encerrar sem negócio"). O desfecho positivo — que é o propósito do funil — não tem UI. Com a remoção de "Encerrar sem negócio" (pedido do PO), a tela fica **sem nenhuma ação de desfecho**.

---

### 🟠 BUG #3 — Busca dessincroniza lista e detalhe

**Reproduzido:** buscar `camisetas` → a lista filtra para `+5511999999999`, mas o painel de detalhe continua exibindo `+5511988887777`, conversa que **não está mais na lista**.

`filtered` é `computed` puramente client-side e não reconcilia com `activeId`.

Agravantes da mesma implementação:
- Busca só varre `contact.label`, `contact.externalId` e o **preview da última mensagem** — não o histórico. O label diz "Buscar contato ou **mensagem**", o que é enganoso.
- Busca só enxerga o que já foi carregado (`limit=100` fixo). Acima de 100 conversas, resultados somem silenciosamente.

---

### 🟠 BUG #4 — Sem paginação

`limit=100` hardcoded em `listUrl()`. Não há "carregar mais", cursor, nem aviso de truncamento. O contador "N exibidas · M no filtro" não distingue "M é o total" de "M é o teto de 100".

---

### 🟠 BUG #5 — Badge "Ao vivo" mente na Caixa de Entrada

`apps/edge-web/src/lib/event-stream.js:13` fixa `topic: 'kanban'`. O `InboxView.vue` não assina evento nenhum. Mensagem nova do WhatsApp **não** aparece sem clicar "Atualizar" — mas o cabeçalho exibe "Ao vivo", sugerindo o contrário.

---

### 🟡 BUG #6 — Erro genérico, sem rastreabilidade

A API devolve `{ error: { code }, request_id }`, mas a UI descarta ambos e mostra sempre a mesma frase. 403 (permissão), 409 (conflito de versão) e 503 (indisponível) ficam indistinguíveis para o operador e para o suporte.

---

## 4. Análise do workflow n8n

**Workflow `k7tI6T4RhQPyJkn9` — "Silmer | Atendimento WhatsApp IA"**

- **NÃO está publicado/ativo.** Na lista de workflows aparece sem o selo `Published`; só o "DEV | Silmer | Fluxo completo sem WhatsApp" está publicado.
- **Zero execuções.** Aba Executions: "No executions found".
- Logo: **o trigger de WhatsApp não está recebendo nada em produção.** As conversas hoje visíveis no CRM vieram do workflow DEV.

**Instância (Overview):** 29 execuções prod · 24 falhas · **82,8% de taxa de falha** — todas do workflow DEV. As falhas se concentram em 09/09 entre 00:09 e 00:20; as 4 execuções seguintes (00:20:13, 00:22:05, 08:51:45, 21:43:44) foram **Success**. Perfil de sessão de depuração, não de quebra ativa — mas o histórico polui a métrica de saúde da instância.

**Variantes versionadas em `ops/n8n/workflows/`:**

| Arquivo | Nós | Característica |
|---|---|---|
| `...-0c41ee97....sanitized.json` | 87 | Completo, **sem** assinatura HMAC nem dedupe de comando |
| `...-98f96069....sanitized.json` | 86 | Completo, **com** `Calcular assinatura do comando`, `Assinatura e timestamp válidos?`, `Verificar comando duplicado`, `Registrar falha para reprocessamento` |
| `...-mvp-simple.sanitized.json` | 42 | Versão enxuta — é a que corresponde ao workflow no ar (nós sufixados `(MVP)`) |

**Regressão de segurança:** a variante MVP e a `0c41ee97` **removeram** a verificação de assinatura HMAC e o dedupe do webhook `silmer/panel-command`. Sobrou só validação de forma:

```js
const validBase = payload.schema_version === '1.0'
  && typeof payload.command_id === 'string'
  && payload.command_id === headerKey;
```

Ou seja: quem conhecer a URL do webhook pode disparar `send_message` e mandar WhatsApp em nome da Silmer. A variante `98f96069` tinha a proteção correta.

**Outros pontos do MVP:**
- `Rotear comando do painel (MVP)` trata `take_over` / `return_to_ai` / `close` como **no-op** ("Estado já aplicado") — correto, estado é do CRM. Confirma que o 403 é 100% do lado CRM.
- Só aceita `message.type === 'text'`. Imagem, documento e áudio (que a variante completa suporta) caem em "Inválido".
- `Rotear conversa registrada (MVP)` só chama a IA para `text | button | interactive`; qualquer mídia vira handoff imediato para humano — que hoje **não consegue assumir** (bug #1). Conversa com mídia trava.
- Sem `memoryBufferWindow` no MVP (a variante completa tem): a IA não guarda contexto entre turnos, só o que o CRM devolve no `Montar contexto da IA (MVP)`.

---

## 5. Melhorias e ajustes — backlog priorizado

### P0 — bloqueia go-live

1. **Unificar a allowlist de ações operacionais.** `apps/api/src/identity-runtime.js` deve consumir `operationalActions` de `modules/identity-access/src/authorization.js` em vez de redeclarar. Cobrir com teste de contrato que compare as duas fontes.
2. **Remover "Encerrar negócio" / "Encerrar sem negócio"** da Caixa de Entrada *(pedido do PO)*. Decidir se a rota `POST .../close` continua existindo para uso de outra tela ou se sai também.
3. **Adicionar "Converter em negócio"** ligado a `POST /api/v1/conversations/:id/convert`. Sem isso, e sem o botão de encerrar, a tela fica sem desfecho.
4. **Publicar/ativar o workflow `k7tI6T4RhQPyJkn9`** ou assumir explicitamente o workflow DEV como o de produção. Hoje o WhatsApp real não entra.
5. **Restaurar HMAC + dedupe no webhook `panel-command`**, portando os nós da variante `98f96069` para a MVP.

### P1 — qualidade operacional

6. Reconciliar `activeId` com a lista filtrada (bug #3) — ao filtrar, selecionar a primeira conversa visível ou limpar o detalhe.
7. Mover a busca para o servidor (`?q=`) ou renomear o label para refletir que é busca local sobre a página carregada.
8. Paginação / "carregar mais" e aviso quando `totalCount > 100`.
9. Assinar SSE de `topic=inbox` no `InboxView.vue`, ou não exibir "Ao vivo" nesta tela.
10. Mensagens de erro por código (`403` permissão · `409` recarregar · `503` indisponível) e exibir `request_id` para suporte.
11. Reprocessar/arquivar as 24 execuções falhas para a métrica de saúde da instância voltar a ser útil.

### P2 — evolução

12. Suporte a mídia na resposta humana (imagem/documento/áudio) — a variante completa do workflow já tem os nós; o MVP e a UI não.
13. Memória curta da IA por conversa (`memoryBufferWindow`) na variante MVP.
14. Exibir nome do contato em vez do telefone quando houver cadastro.
15. Indicador de direção da última mensagem na lista (hoje o snippet mostra a fala da IA sem distinção visual).
16. Rótulo do contador mais claro que "N exibidas · M no filtro".
17. Surfaced da `detail.suggestion` ("Sugestão pendente da IA") — o campo é renderizado mas nenhuma conversa de teste o exercitou; validar.

---

## 6. Arquivos-chave

| Arquivo | Papel |
|---|---|
| `apps/edge-web/src/views/InboxView.vue` | Tela inteira (441 linhas) |
| `apps/edge-web/src/lib/api-client.js` | CSRF via cookie `crm_csrf`, idempotency key |
| `apps/edge-web/src/lib/event-stream.js:13` | SSE fixo em `topic=kanban` |
| `apps/api/src/conversation-routes.js` | Rotas takeover / return-to-ai / close / messages |
| `apps/api/src/identity-runtime.js:16` | **`OPERATIONAL_ACTIONS` incompleta — causa do 403** |
| `modules/identity-access/src/authorization.js:12` | `operationalActions` completa (fonte correta) |
| `apps/api/src/deal-routes.js:208` | `POST .../convert` — existe, sem UI |
| `ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json` | Workflow no ar |
| `ops/n8n/workflows/k7tI6T4RhQPyJkn9-98f96069-....sanitized.json` | Variante com HMAC + dedupe |

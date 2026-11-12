# Visibilidade das conversas

Decisão do proprietário em 12/11/2026, [ADR 088](../../../docs/adr/088-leitura-de-conversas-por-responsavel.md), [RFC 066](../../../docs/rfc/066-visibilidade-de-conversas-por-responsavel.md).

## CONV-ACL-01 — Leitura por responsável atual

- Admin humano ativo com `COMMERCIAL_ADMIN` lê todas as conversas.
- Vendedor humano ativo lê somente próprias e sem responsável, incluindo IA.
- Conversa atribuída a outro vendedor é negada mesmo se o modo for IA.
- Aplicar antes de paginação/contagem; filtros explícitos, encerradas e
  arquivadas só refinam o universo autorizado. Cursor não muda leitor/perfil.
- Detalhe, mensagens, transcrições, mídia, assuntos, contexto e resumos não
  podem ser lidos por ID quando a conversa está oculta. Histórico do Contato
  e metadados comerciais não revelam a conversa oculta.
- Transferência retira acesso do antigo dono, inclusive de sessão aberta,
  replay de comando e SSE. Eventos ocultos não contêm identificadores.
- Não atribuir acesso à Inbox por perfil Financeiro ou habilitação Olist.
- Preservar guardas de escrita e consulta comercial dos Pedidos.

## Matriz de aceite

| Leitor | Própria | Sem dono/IA | Sem dono/humano | Outro dono | Outro dono/IA |
| --- | --- | --- | --- | --- | --- |
| Vendedor A | permite | permite | permite | nega | nega |
| Admin ativo | permite | permite | permite | permite | permite |
| Financeiro/inativo/técnico | nega | nega | nega | nega | nega |

Repetir as negativas por URL direta, filtro forçado, paginação, mídia, contexto,
assuntos, handoffs e replay. Após A → B, A perde leitura e B ganha; Admin conserva.

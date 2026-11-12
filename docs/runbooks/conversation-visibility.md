# Visibilidade de conversas — CONV-ACL-T01

Contrato: [ADR 088](../adr/088-leitura-de-conversas-por-responsavel.md) e
[CONV-ACL-01](../../.specs/features/conversation-visibility/spec.md).

## Verificação

Usar somente vendedores, contatos e mensagens sintéticos. Com A, B e Admin,
verificar próprias, sem dono (IA/humano) e atribuídas a outro vendedor (IA/humano).
A/B não recebem conversas alheias em Todas, abas, encerradas, arquivadas,
contagens ou filtros de responsável. URLs diretas e mídia negam sem conteúdo;
o histórico do Contato não inclui conversa oculta. O Pedido conserva sua ACL
comercial, sem conceder acesso à conversa. Transferir A → B com a Inbox aberta:
A perde detalhe/rascunho e B pode ler. Replay e cursor antigo não recuperam acesso.

Testes locais e CI devem cobrir a matriz, SSE e transferência. O teste PostgreSQL
usa apenas `crm_silmer_test` sintético; não executar contra banco operacional.

## Publicação e rollback

Sem variável nova, migração ou infraestrutura. Entregar por PR e gates existentes;
verificar a imagem publicada antes de afirmar efeito em produção. Um rollback ao
código anterior torna a leitura compartilhada novamente: exige decisão explícita
do proprietário. Não alterar responsáveis em massa para simular autorização.

## Evidências locais — 12/11/2026

- Mesma suíte unitária com `node --test --test-concurrency=2 test/*.test.js`:
  2.689 passaram, zero falhas/cancelamentos; 53 testes live ficaram sem execução
  por ausência de `TEST_DATABASE_URL`. A rodada concorrente padrão excedeu o
  timeout de um teste de upload; esse teste passou isolado e na suíte limitada.
- Typecheck, lint, formatação, fronteiras, tokens e validadores operacionais:
  aprovados. Build aprovado; `npm audit --audit-level=high`: zero vulnerabilidades.
- Playwright: 86 cenários da Inbox, 8 cenários finais de acesso (incluindo
  403/404 de Verificar envio sem SSE) e 3 cenários de compositor aprovados.
  Os grupos se sobrepõem; não somar seus totais como cenários distintos.
- O CI executa a integração PostgreSQL em banco sintético dedicado. Sucesso
  local não substitui esse gate nem comprova publicação da imagem.

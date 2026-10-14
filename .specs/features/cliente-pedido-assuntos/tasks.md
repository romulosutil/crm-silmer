# Cliente, Pedido manual e assuntos — tarefas

## CP-T01 — Pedido manual sem canal

**Requisitos:** CP-01..06. Expandir Contato/Pedido, API autorizada e
idempotente, busca paginada, formulário acessível em Pedidos, edição existente
e testes positivos, negativos, concorrentes e de loja. Commit e push
atômicos; não alterar o workflow n8n.

## CP-T02 — Encerramento neutro

**Requisitos:** CP-07..10. Migration de ciclo terminal, comando e auditoria,
Inbox e testes de nova mensagem, pedido pendente, arquivo e takeover. Commit
e push atômicos.

## CP-T03 — Assuntos no CRM

**Requisitos:** CP-11..14, CP-17. Persistência, atribuição humana, vínculo
explícito Pedido/Contato, leitura da Inbox e teste de mensagens com dois
assuntos e retomada em novo ciclo. Commit e push atômicos.

Entrega de CP-T01–T03: [PR #170](https://github.com/romulosutil/crm-silmer/pull/170).

## CP-T04 — Contrato do agente

**Requisitos:** CP-15..18. Expandir API n8n, migrar briefing por Assunto,
adaptar workflow, gates de epoch/revisão e UAT com ambiguidades, replay e
handoff. Implantar CRM antes do workflow. A checklist operacional final deve
separar código do CRM, workflow n8n, privacidade e homologação do canal.

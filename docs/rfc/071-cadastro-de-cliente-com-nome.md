# RFC 071 — Cadastro de cliente com nome

**Status:** aceito no [ADR 094](../adr/094-cadastro-de-cliente-com-nome.md).

Em Clientes, a ficha atual permite editar um Contato existente. A operação
de criação já é usada em Pedidos, que precisa de telefone para seguir com o
Pedido manual.

A proposta adiciona **Novo cliente** à tela Clientes e reutiliza
`POST /api/v1/contacts`. O formulário exige nome e aceita telefone e e-mail
independentes. Depois de salvar, a tela abre a ficha. O serviço preserva a
autorização, a idempotência, a auditoria e a verificação de colisões. Manter
todos os campos do cadastro completo no formulário inicial duplicaria a ficha.

[CP-01](../../.specs/features/cliente-pedido-assuntos/spec.md) ·
[CP-T10](../../.specs/features/cliente-pedido-assuntos/tasks.md#cp-t10--criar-cliente-na-tela-clientes)

# ADR 094 — Cadastro de cliente com nome

**Status:** aceito. **Data:** 18/11/2026.

[RFC 071](../rfc/071-cadastro-de-cliente-com-nome.md) ·
[CP-01 e CP-20](../../.specs/features/cliente-pedido-assuntos/spec.md) ·
[CP-T10](../../.specs/features/cliente-pedido-assuntos/tasks.md#cp-t10--criar-cliente-na-tela-clientes)

O cadastro na tela Clientes pode preceder a disponibilidade de um telefone. A
tela usa o Contato oficial e permite informar telefone e e-mail ao criar ou
preencher a ficha posteriormente.

A criação geral exige nome. Telefone e e-mail são validados quando
informados. Somente um telefone informado participa da busca por telefone e
da prevenção de colisões. O cadastro não confirma identidade de canal.

Esta decisão supersede o item 1 do [ADR 033](033-telefone-no-cadastro-e-roteamento.md)
quanto ao telefone no cadastro geral. Pedido manual e cadastro pela carteira
de WhatsApp pessoal continuam exigindo telefone, conforme CP-20 e WAP-18.

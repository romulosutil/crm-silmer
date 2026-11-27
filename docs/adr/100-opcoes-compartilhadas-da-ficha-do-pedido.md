# ADR 100 — Opções compartilhadas da ficha do pedido

**Decisão tomada em 27/11/2026.** Aprova a [RFC 076](../rfc/076-catalogo-compartilhado-de-opcoes-do-pedido.md).
Rastreabilidade em [PFI-14 e EDIT-06](../../.specs/features/pedidos-mvp/spec.md)
e [T31](../../.specs/features/pedidos-mvp/tasks.md).

As opções iniciais de cor, malha e tamanho são versionadas no domínio de
Pedidos. Inclusões explícitas são compartilhadas no catálogo do CRM e ficam
disponíveis na próxima abertura de um pedido. A migração 0086 acrescenta uma
tabela com chave única por tipo e nome normalizado. A operação concorrente
reaproveita o primeiro rótulo cadastrado.

A API exige sessão de leitura comercial para consultar as opções. Criar exige
sessão, origem, CSRF e idempotência de `order.edit` em pedido pendente editável.
A transação confirma a autoridade atual e as travas comerciais, grava a opção
e conclui o recibo idempotente com auditoria. O texto não entra no evento de
auditoria. A escolha da opção usa o comando habitual da ficha, com versão e
tratamento de erro próprios. A opção cadastrada pode ser reutilizada quando
uma alteração da ficha exige revisão ou retry.

As fichas continuam armazenando valores de texto. A leitura de pedidos
confirmados e a impressão preservam o texto histórico. A importação de dados
de uma ficha ou de uma conversa não alimenta o catálogo compartilhado.
O rollback do código pode manter a tabela aditiva para preservar os registros
de opções já criados.

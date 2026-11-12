# Numeração de pedidos — ORD-NUM-01

CP-03, PCL-10 e LOJ-21. Correção operacional solicitada em 12/11/2026.

O escritor PostgreSQL usava `lpad(sequence::text, 2, '0')`. `lpad` também
trunca texto maior que o tamanho pedido: 100 virava `10-CRM`. A constraint
`orders_number_format`, corrigida pela migration 0056, exige todos os dígitos.
Isso provoca SQLSTATE 23514 e HTTP 500 ao criar pedido manual, pelo atendimento
ou pela loja. Não é uma nova restrição ao Vendedor introduzida pela PR 369.

Em produção, a consulta READ ONLY encontrou a sequência em 110 e o maior pedido
gravado em 99, criado em 12/11 às 20:07:47 UTC. O vendedor informado estava
ativo, com função Vendedor, e o contato selecionado tinha telefone manual.
Não houve alteração de perfil, sequência, pedido, incidente ou mensagem nessa
investigação. Isso identifica o bloqueio atual; não atribui os 105 API_5XX
históricos a uma única causa sem seus respectivos logs.

Os dois INSERTs do repositório passam a usar comprimento mínimo de dois e
máximo igual ao comprimento da sequência. Conservam `01-CRM` e `99-CRM` e
produzem `100-CRM`, `999-CRM` e `1000-CRM`, sem migração ou renumeração.
Nunca reduzir/resetar a sequência de produção para contornar a falha.

Regressão em PostgreSQL 17 dedicado reproduziu a falha no centésimo pedido
antes do patch. Depois dele, o HTTP real do runtime permite criação manual por
Vendedor sem COMMERCIAL_ADMIN e sem leitura da conversa de outro responsável;
a leitura dessa conversa continua 404 e Financeiro continua 403. Replays
retornam o mesmo pedido e criação concorrente mantém números distintos.
A loja atravessa 99/100 e 999/1000 com recibo idempotente. As suítes existentes
de pedidos, loja e correção da loja também rodam com numeração acima de 100.

Publicação exige CI verde, merge linear e conferência da imagem/commit em
execução. Conferir live/readiness e a próxima criação natural; não criar pedido
de cliente, reenviar mensagem ou executar workflow antigo para obter evidência.
Rollback da aplicação anterior preserva dados, mas reintroduz o bloqueio acima
de 99; manter a constraint existente e preferir corrigir o escritor.

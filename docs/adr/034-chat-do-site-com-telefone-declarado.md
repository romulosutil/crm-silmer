# ADR 034 — Chat do site com telefone declarado

Status: aceita em 14/10/2026 para o piloto de chat.

RFC: [021](../rfc/021-chat-do-site-com-telefone-declarado.md).
Requisitos: [CP-21..22](../../.specs/features/cliente-pedido-assuntos/spec.md).
Tarefa: [CP-T06](../../.specs/features/cliente-pedido-assuntos/tasks.md).
Relacionados: [ADR 026](026-midia-e-chat-do-site-no-bot.md),
[ADR 033](033-telefone-no-cadastro-e-roteamento.md),
[RULES.md](../../RULES.md). Issues e PRs serão ligados à tarefa.

## Contexto

O piloto opera pelo chat do site antes da liberação plena do WhatsApp pela
Meta. O visitante pode informar nome e telefone, mas outra pessoa pode
digitar o mesmo número. A identidade sintética atual do chat identifica uma
sessão, não uma pessoa verificada.

## Decisão

1. O formulário do site coleta nome e telefone antes de iniciar o chat; a
   entrada pelo WhatsApp não apresenta esse formulário.
2. O CRM guarda a declaração cifrada e indexada para busca interna, em fonte
   distinta da identidade WhatsApp confirmada. A identidade sintética `999…`
   continua isolando Conversa, Contato e Pedido novo do chat.
3. Coincidência com cliente anterior é apenas sinal interno. O chat não recebe
   identificadores, histórico ou Pedidos daquele cliente e não altera Pedido
   anterior. Duplicatas exigem escolha humana.
4. O piloto não depende de WhatsApp para atender ou criar Pedido novo. A
   confirmação por WhatsApp fica para uma futura correlação auditada entre
   identidades e acesso ao histórico.
5. O visual do chat incorporado é responsabilidade do site. O workflow
   captura e valida os metadados, mas o CRM é a fronteira de confiança dos
   dados e efeitos comerciais.
6. Após a transferência, o vendedor responde em texto na caixa de entrada do
   CRM. O widget consulta somente as mensagens da sessão aleatória do chat;
   o telefone declarado não autoriza a leitura de histórico. Áudio do vendedor
   fica indisponível nesse canal enquanto não houver entrega de mídia no chat.

## Consequências

Esta decisão substitui apenas a parte da [ADR 026](026-midia-e-chat-do-site-no-bot.md)
que nomeia todo visitante como "Visitante do site" e não recolhe telefone.
Ela preserva o identificador de sessão `999…` até um canal próprio ser
decidido. A busca por telefone indica origem não confirmada. A publicação do
chat exige instalar o contrato no CRM antes de atualizar o workflow e testar
replay, ambiguidade, isolamento entre sessões, PII, teclado e celular.

# ADR 097 — Dashboard sem a Central ao vivo

Decisão do proprietário em 21/11/2026. Supersede o item 5 e a menção à Central ao vivo do item 1 da [ADR 096](096-painel-comercial-do-administrador.md).

1. O Dashboard do gestor mostra só a visão principal: Resultado comercial, urgência da fila, aviso da loja, equipe e resumo de ontem. A opção de visão "Resultado comercial / Central ao vivo" deixa de existir.
2. A urgência da fila continua no topo, com contagem, maior espera útil e hora da leitura. **Abrir fila** abre a Inbox: sem responsável em `/inbox?fila=sem-responsavel`; atrasadas, aguardando resposta ou fila sem esperas em `/inbox?situacao=atender`.
3. O desempenho do agente continua acessível por link no próprio Dashboard.
4. A leitura `GET /api/v1/dashboard/live` permanece no servidor, porque a urgência usa a região `queue`. As regiões de fatos e pedidos ficam sem consumidor na interface; retirá-las da API exige decisão própria.

Os demais itens da ADR 096 continuam válidos. [Requisitos comerciais](../../.specs/features/crm-mvp/spec.md) (PNL-01, PNL-06).

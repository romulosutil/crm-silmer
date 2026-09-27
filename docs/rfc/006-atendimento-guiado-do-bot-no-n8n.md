# RFC 006 — Atendimento guiado do bot no n8n

| Campo | Valor |
| --- | --- |
| **Status** | PROPOSTA — planejamento, sem autorização de publicação |
| **Impacto** | Alto: conversa, catálogo, contrato n8n ↔ CRM e controle de envios |
| **Responsável pela proposta** | Tech Lead |
| **Aprovadores** | Responsável de produto/comercial da Silmer e Tech Lead; o catálogo depende também da aprovação prevista na RFC 005 |
| **Rastreabilidade** | `AGT-01`, `AGT-03`, `AGT-05`, `AGT-06`, `PCL-01`, `PAG-01`–`03`, `PFI-03`–`04`, `PFI-07`, `T21`–`23`, `T31`, `T40`; [RFC 005](005-catalogo-de-opcoes-do-pedido.md), [ADR 003](../adr/003-adotar-integracao-n8n-mvp-simples.md), [ADR 006](../adr/006-pedido-dois-status.md) |

## 1. Objetivo e ponto de partida

Conduzir uma conversa curta no WhatsApp para obter fatos úteis à criação e ao preenchimento progressivo de um Pedido pendente, explicar opções comerciais **aprovadas** e transferir ao humano no momento certo. O cliente pode pedir uma pessoa a qualquer momento. O bot também transfere por exceção, por informação suficiente ou ao atingir o teto de dez respostas automáticas.

O repositório já contém o fluxo WhatsApp → n8n → CRM, `order.intent_confirmed`, `briefing_patch`, projeção no pedido pendente, nome fornecido pelo cliente no Contato e handoff. O [workflow versionado](../../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js) exige hoje **todos** os campos do briefing para `briefing_complete`, pergunta primeiro se o cliente quer orçamento e não limita respostas por conversa. Seu `maxIterations: 2` limita passos internos do nó de IA em uma execução, **não** mensagens do WhatsApp entre execuções. A [T40](../../.specs/features/pedidos-mvp/tasks.md) ainda descreve publicação e conferência do n8n online como gate; código e testes locais não provam esse gate.

A [RFC 005](005-catalogo-de-opcoes-do-pedido.md) registra que as sugestões atuais de [order-catalog.js](../../apps/edge-web/src/lib/order-catalog.js) são provisórias e que a lista comercial ainda está em revisão. Não configurar o bot com essas opções como oferta confirmada antes da aprovação. Até lá, ele pode registrar literalmente o termo informado pelo cliente e deixar a escolha para o vendedor.

## 2. Referências de mercado e custo

- A [respond.io](https://respond.io/help/ai-agent-actions/ai-agent-action-update-contact-fields) recomenda coletar dados de qualificação em campos específicos e usar fontes de conhecimento para responder sobre produtos. Sua [ação de atribuição](https://respond.io/help/ai-agent-actions/ai-agent-action-assign-to-agent-or-team) orienta cessar as respostas do agente após transferir a conversa.
- A [Intercom](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules) documenta escalada por pedido explícito, sinais de insatisfação e regras configuráveis; a transferência conserva contexto para a equipe. Adotamos critérios explícitos, resumo e fim efetivo da automação.
- A [política oficial do WhatsApp](https://business.whatsapp.com/policy/preview?lang=pt_BR) exige caminho rápido e claro para atendimento humano quando se usam respostas automáticas. O bot não pode obrigar o cliente a preencher a ficha antes da transferência.
- **Verificação de preço em 27/09/2026:** a [página pública de preços da Meta](https://whatsappbusiness.com/pt-br/products/platform-pricing/) ainda informa mensagens de serviço gratuitas dentro da janela de 24 horas, embora descreva cobrança por mensagem entregue para outras categorias. O teto de dez é uma regra de produto solicitada para controlar custo e experiência, independentemente da categoria cobrada. Antes da publicação, conferir o rate card vigente para a WABA e a categoria efetiva; não usar o contador de iterações como estimativa de cobrança da Meta.

## 3. Comportamento proposto

### 3.1 Roteiro da conversa

1. Ler `recent_messages`, briefing, Contato, Pedido pendente e catálogo aprovado retornados pelo CRM. Identificar pedidos de pessoa **antes** de chamar o modelo; nesse caso, transferir imediatamente, sem perguntas adicionais.
2. Na primeira resposta útil, apresentar-se como assistente virtual, pedir o **nome pelo qual a pessoa deseja ser cadastrada** e descobrir o que deseja encomendar. O nome de perfil do WhatsApp serve como pista, nunca como confirmação do cadastro. Não pedir novamente se `customer_name` já foi fornecido pelo cliente ou se existe nome humano validado.
3. Confirmar intenção de pedir orçamento sem transformar interesse genérico em pedido. Só após confirmação enviar `order.intent_confirmed`; o CRM cria ou reutiliza um `pendente`. Se o evento falhar, registrar a falha e não afirmar ao cliente que o pedido foi criado.
4. Extrair em cada resposta todos os fatos explícitos, inclusive correções fora de ordem. Perguntar pelo próximo grupo de informações de maior valor, com uma pergunta principal e, quando natural, até duas relacionadas. Ordem sugerida: peça/item e quantidade; modelo e malha/tecido; cores e grade; arte e aplicação; data desejada e logística. A necessidade real é calculada por item e pela modalidade de entrega; o cliente pode antecipar qualquer campo.
5. Quando houver catálogo aprovado, oferecer poucas opções relevantes à peça e ao que o cliente já disse, com descrição simples e sem prometer estoque, compatibilidade, preço ou prazo. Uma opção desconhecida, ambígua ou incompatível vira pendência explícita para o vendedor; nunca é normalizada silenciosamente.
6. Fazer handoff assim que houver informação suficiente para o vendedor iniciar o orçamento: nome confirmado **ou pendência de identificação registrada**, intenção comercial clara, ao menos um item/tipo ou descrição livre e quantidade aproximada **ou pendência explícita**. O modelo pode sugerir que já basta; a checagem desses mínimos é determinística. Campos restantes seguem como pendências no resumo e no pedido. Não esperar a ficha completa. Quando todos os campos aplicáveis estiverem preenchidos, manter o motivo atual `briefing_complete`.
7. Transferir antes desse mínimo por pedido humano, negociação/preço sem aprovação, reclamação, urgência, baixa confiança, mídia não suportada ou bloqueio de catálogo. Não pedir mais dados após a decisão de transferência. O cliente recebe confirmação curta dentro do orçamento de mensagens quando o envio for possível; a criação do handoff independe do sucesso dessa mensagem.

O bot jamais confirma Pedido, calcula/preenche preço, promete prazo, confirma pagamento ou escolhe vendedor individual. O vendedor ou administrador continua dono das ações humanas da [ADR 006](../adr/006-pedido-dois-status.md).

### 3.2 Teto de dez respostas

**Definição proposta:** um ciclo é uma Conversa aberta em modo IA; o orçamento é de **dez mensagens automáticas reservadas para envio** nessa Conversa, inclusive saudação, aviso de handoff e reativação da IA. Mensagens inbound, respostas humanas, callbacks da Meta e passos internos do modelo não contam. Handoff ou takeover não zera o contador; nova Conversa pode começar outro ciclo. A contagem por reserva é conservadora: `message.send.unknown` consome uma posição até reconciliação, sem retry cego.

| Contagem oficial antes do inbound | Ação |
| --- | --- |
| 0–8 | Resposta útil ou handoff antecipado; no máximo uma reserva por revisão inbound. |
| 9 | A décima e última mensagem do bot avisa que um vendedor continuará e informa, brevemente, os dados já obtidos. Em seguida, registra o handoff com motivo `iteration_limit`. Não faz outra pergunta. |
| 10 | Registra ou recupera o handoff sem novo envio automático. Mensagens posteriores permanecem na Inbox humana. |

O CRM armazena o contador na Conversa e o incrementa **atomicamente** na mesma transação de `message.send.requested`, junto ao fence já existente de `automation_epoch` e `source_revision`. A resposta inbound devolve a contagem para planejamento do n8n; o CRM é a autoridade. Na reserva com contagem 9, só aceita um aviso final identificado como tal; acima de 9, recusa qualquer envio automático. Se duas execuções concorrerem, a segunda recebe conflito específico, reavalia a contagem e segue para aviso/handoff, sem enviar a resposta antiga. Uma reserva incerta não é repetida; o handoff ocorre mesmo se a Meta falhar ou ficar indisponível.

O aviso final é texto fixo/parametrizado pelo workflow, sem promessa de tempo de resposta: “Já anotei as informações que você me passou. Vou encaminhar seu atendimento a um vendedor da Silmer para continuar o pedido.” Não revelar ao cliente contador ou motivo financeiro. O resumo detalhado vai somente à Inbox.

### 3.3 Critérios de handoff e resumo

Adicionar `briefing_sufficient` e `iteration_limit` aos motivos aceitos, ambos direcionados ao papel **Vendedor**. Preservar o roteamento atual de `human_requested`, `complaint`, `urgency`, `low_confidence` e `unsupported` para Atendimento, e `negotiation`/`briefing_complete` para Vendedor, conforme `RULES.md`. `iteration_limit` deve ir ao Vendedor mesmo com dados faltantes. Registrar motivo, campos confirmados por item, nome ou pendência de nome, data desejada como desejo (não promessa), opções mencionadas com versão do catálogo, dúvidas, próximos campos sugeridos, `order_id` se existir e referência à Conversa. O resumo é dado sensível do CRM; logs do n8n não devem conter PII.

## 4. Contrato e fronteiras

| Parte | Mudança planejada |
| --- | --- |
| Catálogo | Concluir a RFC 005, publicar uma versão aprovada e disponibilizar ao ator `AUTOMATION_EXECUTOR` leitura autenticada do subconjunto necessário: código, rótulo, aliases, grupo, compatibilidades e versão. O n8n consulta o CRM; não mantém tabela paralela nem lê o banco. Se a RFC 005 escolher outra modelagem/endpoint, adaptar este contrato a ela. |
| Pré-ficha | Evoluir `briefing_patch` plano para `items[]`, conforme RFC 005, preservando texto literal, código aprovado e origem/certeza por escolha. Validar schema no CRM. A projeção só altera Pedido pendente enquanto a Conversa está com a IA. |
| Conversa | Incluir contador durável de reservas automáticas no retorno de `POST /api/v1/integrations/n8n/messages/inbound`; devolver a contagem atual também na reserva ou conflito. Nenhuma memória paralela no n8n. |
| Eventos | Evoluir `message.send.requested` para distinguir resposta normal do aviso final; aceitar novos motivos em `handoff.requested`. Manter Basic Auth, idempotência, epoch/revisão, auditoria e `application/problem+json`. |
| Nome | Manter `customer_name` obtido no briefing e a atualização do Contato existente. Nome de perfil não satisfaz o requisito de nome confirmado. Um handoff não é bloqueado por recusa ou ausência do nome. |
| Inbox | Exibir motivo novo, resumo e pendências com o Pedido pendente vinculado; não esconder o handoff sem responsável. |

Não criar Redis, outro bot, acesso do n8n ao PostgreSQL ou novo serviço. Instagram, análise multimodal e precificação automática ficam fora desta entrega.

## 5. Sequência de implementação proposta

| Tarefa | Escopo e arquivos prováveis | Verificação de aceite |
| --- | --- | --- |
| **BOT-01 — Aprovar catálogo** | Fechar RFC 005 com o cliente; atualizar `apps/edge-web/src/lib/order-catalog.js`, contrato/versionamento em `modules/catalog/`, API e OpenAPI conforme a decisão. | Bot só cita opções aprovadas e mostra versão; termo desconhecido fica literal e pendente. |
| **BOT-02 — Contrato por item** | Evoluir `modules/n8n-integration/src/service.js`, `postgres-repository.js`, `modules/orders/` e schemas/fixtures n8n para `items[]` e origem das escolhas. | Dois itens distintos, correção, alias ambíguo e incompatibilidade não misturam atributos nem inventam opção. |
| **BOT-03 — Orçamento de respostas** | Migração de Conversa, reserva transacional no repositório n8n, retorno inbound, motivos/ACL de handoff e OpenAPI. | Replay, concorrência, takeover e `outcome_unknown` jamais autorizam a 11ª resposta do bot. |
| **BOT-04 — Workflow guiado** | Alterar SDK em `ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sdk.js`, exports sanitizados e DEV derivado; prompt, saída estruturada, pergunta prioritária, catálogo, nome, intenção e aviso final. | Nome pedido sem repetição; pedido só após intenção; decisão do modelo não contorna limite nem autorização. |
| **BOT-05 — Inbox e observabilidade** | Leitura/API/UI de handoff e pedido; métricas agregadas de reservas, entrega, handoff e campos úteis por conversa, sem PII em logs. | Vendedor recebe resumo, pedido e pendências; consegue tomar a Conversa e o bot cessa. |
| **BOT-06 — Homologar e publicar** | Evals sintéticos, workflow DEV, Meta sandbox, depois publicação versionada com rollback. | Testar 0, 1, 8, 9, 10 e 11 tentativas, pedido humano na primeira mensagem, dois itens, nome ausente, falha de catálogo/CRM/Meta, mensagens duplicadas e fora de ordem. Registrar versão ativa e custo real observado antes/depois. |

As tarefas são uma proposta de decomposição; ao decidir esta RFC, vinculá-las à especificação e ao plano canônicos. Publicação segue o gate operacional da T40. Cada implementação deve ser entregue com patch, teste, commit e push próprios.

## 6. Critérios de aceite da mudança completa

1. O cliente consegue pedir uma pessoa em qualquer mensagem e o bot interrompe a coleta sem exigir nome ou ficha completa.
2. Nome fornecido pelo cliente é gravado no Contato sem sobrescrever nome alterado por operador; nome do perfil não vira nome confirmado.
3. O bot explica somente opções comerciais aprovadas e relacionadas ao item, com versão do catálogo; opção incerta vira pendência humana.
4. Um pedido pendente nasce somente após intenção confirmada e recebe apenas fatos validados; pedido confirmado e preço não são alterados pelo bot.
5. O handoff por informação suficiente pode ocorrer com ficha incompleta e informa precisamente ao vendedor o que falta.
6. A décima resposta automática é o aviso final e gera handoff; nenhuma execução, replay ou retorno à IA envia a 11ª.
7. Uma falha de envio, CRM, IA ou catálogo não perde a Conversa nem gera resposta duplicada; o vendedor vê a pendência operacional.

## 7. Premissas, opções e decisão pendente

- **Opção A — teto apenas no prompt/n8n:** simples, mas execuções paralelas e retries podem ultrapassá-lo. Não recomendada.
- **Opção B — contador/fence no CRM + roteiro no n8n:** recomendada. Acrescenta contrato e migração, porém torna o teto auditável e resistente à concorrência.
- **Premissa:** dez significa dez respostas automáticas **reservadas**, incluindo o aviso final. Se o produto quiser dez perguntas mais um aviso, a mudança elevaria o teto para onze mensagens e precisaria de nova aprovação.
- **Dependências:** decisão comercial da RFC 005; definição da API de leitura do catálogo; confirmação do rate card da Meta aplicável na publicação; homologação DEV/produção da T40.
- **Risco de experiência:** o limite pode transferir conversas incompletas. Medir taxa de handoff por limite, completude útil e tempo de tomada humana; revisar perguntas e teto após dados reais, sem ampliá-lo silenciosamente.

**Resultado:** pendente de revisão. Esta RFC não aprova catálogo, altera contrato ativo nem autoriza publicação. Se a decisão arquitetural de persistir o contador e expor catálogo for aceita, registrar ADR sequencial que vincule esta RFC, a RFC 005, requisitos, issues e PRs.

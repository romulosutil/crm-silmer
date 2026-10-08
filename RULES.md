# Regras do CRM Silmer

## Regras de produto

1. Toda mensagem válida entra na Caixa de Entrada e dispara automaticamente o n8n; a UI não inicia a automação.
2. Cliente é `Contact` + `ContactIdentity`. A chegada resolve contato e conversa, mas não confirma venda.
3. Kanban e Negócio estão aposentados (ADR 004); novas capacidades não reutilizam tabelas ou módulos históricos desse domínio.
4. Pedido possui somente `pendente` e `confirmado` (ADR 006). O preenchimento é progressivo e não linear.
5. O agente cria ou completa pedido pendente por comandos autorizados da API. Nunca confirma pedido nem altera preço, pagamento ou escolha humana já registrada.
6. Preço, prazo garantido e regra comercial nunca são inventados pelo agente. Uma pessoa autorizada decide as condições.
7. Automação limita-se às capacidades de `AUTOMATION_EXECUTOR`, ao `automation_epoch` e aos gates; há desligamento por conversa e global.
8. Retries e duplicidades não criam contatos, conversas, pedidos ou envios duplicados. Efeitos oficiais são auditáveis.
9. Uma conversa pode ter vários pedidos e no máximo um pendente. Confirmação e reabertura são humanas; reabrir preserva número e bloqueia impressão.
10. Pedido confirmado registra autor, horário, valor e condição. Só pedido confirmado pode ser impresso.
11. A numeração começa em `01-CRM`, é reservada na criação e não depende da sequência legada.
12. Rose é a destinatária operacional da ficha. Encaminhamento e eventual aviso automático exigem homologação própria; o telefone, quando usado, vem de `secret://crm/order-recipient-phone` e nunca é versionado.
13. Gerar exige os pontos principais de cada item: Tipo de roupa, Cor, Quantidade calculada, Técnica, Tecido, Tamanhos e Gola; também exige origem da arte, entrega prometida, valor final e condição (ADR 020).
14. Rascunho pode ser salvo incompleto. Pendências bloqueiam gerar, sem impor colunas ou avanço linear. Adicionais e nome do pedido não bloqueiam.
15. Arte pertence ao pedido: cliente envia, Silmer cria ou sem estampa. “Sem estampa” exclui as duas outras opções. O bot só projeta resposta inequívoca e não substitui escolha humana.
16. Vendas e valor vendido contam apenas pedidos confirmados; recebimentos e saldo a receber ficam fora do MVP. “Pago em” e “Entregue em” são datas manuais e não mudam status.
17. Rômulo Sutil Corrêa é o Responsável de Privacidade; a política do piloto foi aprovada após consulta jurídica. Aprovações externas de IA e recovery permanecem gates independentes.
18. Mídia de canal não promovida é transitória: remover bytes no fim da jornada ou em sete dias, o que ocorrer primeiro. Pedido, ficha, documentos comerciais válidos e auditoria seguem retenção própria.
19. Handoff e tomada humana são definitivos para o atendimento: a conversa segue com pessoa até encerrar e não volta ao bot (ADR 015).
20. Handoff nasce sem responsável e tem papel-alvo Vendedor (ADR 009). A reivindicação é atômica e exige pessoa ativa e elegível; editar, gerar ou reabrir pedido exige dono da conversa ou administrador.
21. Pedido da loja do site (ADR 027) é a única exceção às regras 5, 9, 10 e 16 quanto à confirmação humana e ao dia do pagamento digitado: nasce `confirmado`, sem conversa nem Contato, pelo ator `system:loja-do-site`, ao preço do catálogo do CRM, com Pix e dia do pagamento informados pelo cliente; fica travado (sem edição, reabertura, lastro ou arquivos) e conta como venda, salvo pedido de teste.

## Regras técnicas já impostas

1. Frontend em Vue 3, Vue Router e Vite (ADR 001); nova biblioteca de estado ou framework exige autorização explícita.
2. Não manter estado de domínio em `window`; usar módulos isolados.
3. Toda interface opera por teclado, gerencia foco e anuncia mudanças com ARIA quando aplicável.
4. WhatsApp usa API oficial e é o canal obrigatório do primeiro lançamento. Instagram pertence a `CANAL-2` e não bloqueia o piloto WhatsApp.
5. Na futura migração entre canais, associar identidades ao mesmo Contato somente após correlação verificável e auditável; nunca por nome ou inferência da IA.
6. n8n é obrigatório para canais, OpenAI e orquestração. Falha de n8n é visível, sem fallback silencioso.
7. Toda mutação oficial passa por contrato autenticado, autorizado, idempotente e auditável do CRM; n8n nunca acessa diretamente o banco do CRM. Exceção única: a rota pública da loja do site (ADR 027), que só cria o pedido da loja, com origem permitida, limites por IP e telefone, idempotência e auditoria.
8. Dados pessoais seguem minimização, acesso por capacidade, auditoria e política de retenção aprovada. Controles de acesso devem refletir a implementação e as evidências atuais.
9. No piloto interno, mídia transitória usa volume privado sem backup; arquivo válido é anexado ao pedido e guardado no RustFS interno (ADR 023). Só a API fala com o RustFS: sem URL pública, link pré-assinado ou promoção automática a partir do canal.
10. n8n v1 usa Basic Auth com `AUTOMATION_EXECUTOR`, idempotência, correlação, identidade de workflow e `application/problem+json`; sem HMAC/timestamp nesse contrato.
11. `message.send.requested` é reserva obrigatória de uso único antes da chamada à Meta. Timeout posterior vira resultado desconhecido e reconciliação; retry cego é proibido.
12. A reserva valida modo, `automation_epoch` e `source_revision` atuais; cada revisão inbound só pode ser consumida uma vez. Não há claim, lease ou token de rodada.
13. OpenAI é o provedor escolhido para produção. Produção com PII exige evidências aplicáveis de DPA, retenção, logging e ZDR; escolha do provedor não satisfaz esse gate.
14. `PRINT_TEMPLATE` seleciona `ficha-canonical-v5`, com aprovação provisória do PO. Rose e Operação devem assinar a amostra física antes da produção; templates v2–v4 e hashes permanecem imutáveis.
15. Manter o deploy automático GitHub → EasyPanel existente; verificar imagem/digest, migrations, health, segredos, isolamento, rollback e recovery no ambiente alvo antes de declarar prontidão operacional.

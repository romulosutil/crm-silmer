# Regras do CRM Silmer

## Regras de produto

1. Conversa não é lead. Toda mensagem entra primeiro no backlog da Caixa de Entrada e dispara automaticamente o workflow correspondente no n8n.
2. O Vendedor Silmer pode classificar uma conversa como oportunidade e solicitar ao CRM, de forma idempotente, a criação ou atualização do Contato e do Negócio; a simples chegada da mensagem não cria lead.
3. Backlog não é coluna do Kanban.
4. A Ficha de Pedido é a fonte da verdade dos dados necessários para concluir a jornada.
5. O Vendedor Silmer conversa, coleta dados e pode converter conversas, atualizar campos oficiais e mover cards somente por comandos autorizados da API do CRM e pelos gates da jornada.
6. O Vendedor Silmer nunca calcula, negocia ou inventa preço, prazo ou regra comercial; ele só pode comunicar orçamento aprovado por uma pessoa autorizada.
7. A autonomia operacional do Vendedor Silmer é parte do MVP, limitada às capacidades do ator técnico do n8n, ao `automation_epoch`, aos gates do domínio e a um desligamento imediato por conversa e global.
8. Toda mensagem, decisão, mutação ou transferência do agente é auditável no CRM; retries e duplicidades não podem criar conversas, leads, cards, pedidos ou envios duplicados.
9. Conversa sem oportunidade termina como `Sem lead`; oportunidade encerrada termina como `Fechado` ou `Perdido` com motivo.
10. Toda Ficha aprovada registra versão, autor e estado de envio.
11. O primeiro pedido é `01-CRM`; os seguintes usam a sequência `02-CRM`, `03-CRM` e assim por diante, sem dependência de numeração legada.
12. O destinatário operacional da Ficha é Rose; o telefone é resolvido pela
    referência `secret://crm/order-recipient-phone` e nunca é versionado.
13. A jornada definitiva é Backlog, Produto, Especificação, Estampa, Logística
    e Fechamento; Backlog não é coluna do Kanban.
14. Campo obrigatório `pendente` ou `divergente` bloqueia passagem. Um campo
    `nao_aplicavel` só libera a passagem quando possui motivo.
15. Receber comprovante PIX não confirma pagamento; somente uma pessoa
    autorizada pode confirmar e liberar a Ficha no caminho inicial.
16. O MVP mede vendas, não recebimentos nem saldo a receber.
17. Rômulo Sutil Corrêa é o Responsável de Privacidade; a política do piloto foi aprovada após consulta jurídica.
18. Imagens e arquivos de canal não promovidos a documento válido são
    transitórios: os bytes são removidos no encerramento da jornada ou sete
    dias após o recebimento/envio, o que ocorrer primeiro. Pedido, Ficha,
    orçamento aprovado, comprovante PIX válido, eventos comerciais e auditoria
    nunca herdam esse prazo curto.
19. `convertida_em_lead` encerra a triagem, não a Conversa. Enquanto existir
    Negócio ativo, `terminal_at` permanece nulo e o ator técnico pode continuar
    usando os endpoints canônicos de campos e transições. `Sem lead`, Fechado
    e Perdido continuam sendo os únicos encerramentos oficiais aplicáveis.
20. Handoff automático começa sem pessoa responsável e declara
    `target_role`. `briefing_complete` e `negotiation` vão para Vendedor;
    `human_requested`, `complaint`, `urgency`, `low_confidence` e
    `unsupported` vão para Atendimento. A atribuição ocorre atomicamente para
    uma pessoa ativa com papel compatível.

## Regras técnicas já impostas

1. O frontend usa Vue 3, Vue Router e Vite, conforme `docs/adr/001-adotar-vue-no-frontend.md`; novas bibliotecas de estado ou frameworks exigem autorização explícita.
2. Evitar estado global em `window`; preferir ESM, IIFE ou classes isoladas.
3. Interações devem funcionar por teclado e manter ARIA dinâmica quando aplicável.
4. O WhatsApp usa a API oficial do WhatsApp Business e é obrigatório para o lançamento do piloto.
5. WhatsApp Business e Instagram Direct são canais obrigatórios do MVP e seguem a mesma jornada no n8n. A migração entre canais preserva o Negócio e só conecta `@instagram` e telefone após correlação verificável e auditável.
6. O n8n é obrigatório no MVP e é o motor de canais, IA e orquestração da jornada comercial. Cada mensagem recebida dispara o n8n sem depender de ação ou botão da UI.
7. Integrações externas entram por contratos explícitos e não definem o modelo interno do domínio. O n8n nunca acessa diretamente o banco: usa APIs autenticadas, autorizadas, idempotentes e auditáveis do CRM.
8. Dados pessoais seguem minimização, controle de acesso, auditoria e a política de retenção aprovada no P0.6.
9. No piloto interno, a mídia transitória usa volume privado da VPS sem backup;
   arquivos válidos seguem ao Dropbox por procedimento operacional registrado.
   Isso não autoriza nem presume API, token ou sincronização automática do
   Dropbox.
10. O contrato n8n v1 usa somente Basic Auth com o ator
    `AUTOMATION_EXECUTOR`, headers de idempotência/correlação/workflow e
    `application/problem+json`; HMAC e timestamp não fazem parte desse
    contrato.
11. `message.send.requested` é o fence obrigatório e de uso único antes de
    qualquer chamada à Meta. Timeout posterior vira `message.send.unknown` e
    reconciliação; retry cego é proibido.
12. Claims da IA são leases cercados por revisão, último evento, modo e
    `automation_epoch`. Takeover, handoff, retorno, fechamento ou desligamento
    invalidam claims anteriores elevando o epoch.
13. O backend é neutro de canal, mas o rollout desta versão ativa somente
    WhatsApp. Instagram deve ser homologado antes do lançamento integral do
    MVP; não há fallback silencioso para o webhook direto da Meta.

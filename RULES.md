# Regras do CRM Silmer

## Regras de produto

1. Conversa não é lead. Toda mensagem entra primeiro no backlog da Caixa de Entrada.
2. No MVP, apenas uma pessoa pode executar a conversão explícita em lead; o Vendedor Silmer pode sugeri-la.
3. Backlog não é coluna do Kanban.
4. A Ficha de Pedido é a fonte da verdade dos dados necessários para concluir a jornada.
5. No MVP, o Vendedor Silmer conversa, coleta dados e sugere ações, mas não converte conversas, atualiza campos oficiais nem move cards.
6. O Vendedor Silmer nunca calcula, negocia ou inventa preço, prazo ou regra comercial; ele só pode comunicar orçamento aprovado por uma pessoa autorizada.
7. A autonomia comercial futura exige a chave `vendedor_silmer_autonomia_comercial`, desabilitada por padrão, e especificação própria com auditoria e rollback.
8. Toda mensagem, sugestão ou transferência do agente é auditável; retries e duplicidades não podem criar conversas, leads, cards, pedidos ou envios duplicados.
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

## Regras técnicas já impostas

1. O frontend usa HTML, CSS e JavaScript vanilla; frameworks exigem autorização explícita.
2. Evitar estado global em `window`; preferir ESM, IIFE ou classes isoladas.
3. Interações devem funcionar por teclado e manter ARIA dinâmica quando aplicável.
4. O WhatsApp usa a API oficial do WhatsApp Business e é obrigatório para o lançamento do piloto.
5. O Instagram Direct integra o piloto quando disponível, mas não bloqueia nem adia o lançamento pelo WhatsApp.
6. n8n é opcional e não pode ser requisito para o núcleo do agente ou da máquina de estados.
7. Integrações externas entram por contratos explícitos e não definem o modelo interno do domínio.
8. Dados pessoais seguem minimização, controle de acesso, auditoria e a política de retenção aprovada no P0.6.
9. No piloto interno, a mídia transitória usa volume privado da VPS sem backup;
   arquivos válidos seguem ao Dropbox por procedimento operacional registrado.
   Isso não autoriza nem presume API, token ou sincronização automática do
   Dropbox.

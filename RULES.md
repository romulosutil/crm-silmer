# Regras do CRM Silmer

## Regras de produto

1. Conversa não é lead. Toda mensagem entra primeiro no backlog da Caixa de Entrada.
2. Apenas uma pessoa ou o Vendedor Silmer pode executar a conversão explícita em lead.
3. Backlog não é coluna do Kanban.
4. A Ficha de Pedido é a fonte da verdade dos dados necessários para concluir a jornada.
5. O Vendedor Silmer tenta concluir o caminho autorizado sozinho e nunca inventa preço, prazo ou regra comercial.
6. Toda ação automática é auditável e reversível por uma pessoa autorizada.
7. Retries e duplicidades não podem criar conversas, leads, cards, pedidos ou envios duplicados.
8. Conversa sem oportunidade termina como `Sem lead`; oportunidade encerrada termina como `Fechado` ou `Perdido` com motivo.
9. Toda Ficha aprovada registra versão, autor e estado de envio.
10. O destinatário operacional da Ficha é Rose, no número `+55 27 99901-0303`.
11. A jornada definitiva é Backlog, Produto, Especificação, Estampa, Logística
    e Fechamento; Backlog não é coluna do Kanban.
12. Campo obrigatório `pendente` ou `divergente` bloqueia passagem. Um campo
    `nao_aplicavel` só libera a passagem quando possui motivo.
13. Receber comprovante PIX não confirma pagamento; somente uma pessoa
    autorizada pode confirmar e liberar a Ficha no caminho inicial.

## Regras técnicas já impostas

1. O frontend usa HTML, CSS e JavaScript vanilla; frameworks exigem autorização explícita.
2. Evitar estado global em `window`; preferir ESM, IIFE ou classes isoladas.
3. Interações devem funcionar por teclado e manter ARIA dinâmica quando aplicável.
4. O WhatsApp usa a API oficial do WhatsApp Business.
5. n8n é opcional e não pode ser requisito para o núcleo do agente ou da máquina de estados.
6. Integrações externas entram por contratos explícitos e não definem o modelo interno do domínio.
7. Dados pessoais seguem minimização, controle de acesso, auditoria e política de retenção.

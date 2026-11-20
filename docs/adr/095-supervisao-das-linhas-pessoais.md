# ADR 095 — Supervisão das linhas pessoais

Decisão do proprietário em 20/11/2026. Aceita para a liberação de Meu WhatsApp.
[RFC 072](../rfc/072-supervisao-das-linhas-pessoais.md)

Esta decisão substitui a exceção de leitura por qualquer administrador nas
linhas pessoais das ADRs [090](090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md)
e [091](091-contratos-da-etapa1-whatsapp-pessoal.md). A linha geral segue a
[ADR 088](088-leitura-de-conversas-por-responsavel.md).

1. Vendedores e administradores comerciais ativos podem operar a própria linha.
   O vínculo de carteira e a atribuição ao titular delimitam o atendimento.
   Contas financeiras e desativadas ficam fora da liberação.
2. Só a conta administrativa designada pelo proprietário pode consultar
   conversas de outras linhas pessoais. O servidor verifica identidade, função,
   capacidade administrativa e estado atual na leitura protegida. A sessão
   informa o resultado em `user.canReadAllPersonalWhatsApp` para a interface.
   Cada mensagem pessoal continua saindo exclusivamente pela linha do titular
   que a envia.
3. Busca, contagens, listas, acesso por ID, anexos, histórico e eventos ao
   vivo obedecem ao mesmo escopo de conversa. O acesso comercial ao Pedido
   continua sendo verificado separadamente.
4. A operação reserva uma combinação exclusiva de linha e instância para
   cada titular autorizado, preservando as combinações já existentes. A API,
   o n8n e a Evolution precisam concordar antes da abertura do pareamento.
   Os identificadores operacionais ficam na configuração privada.

O [runbook](../runbooks/seller-whatsapp.md) descreve a ampliação. A
[validação de WAP-E12](../../.specs/features/seller-whatsapp/validation-piloto.md)
registra a confirmação funcional do proprietário e a evidência da versão
implantada. [Requisitos](../../.specs/features/seller-whatsapp/spec.md) ·
[tarefa](../../.specs/features/seller-whatsapp/tasks.md) ·
[PR do piloto](https://github.com/romulosutil/crm-silmer/pull/398).

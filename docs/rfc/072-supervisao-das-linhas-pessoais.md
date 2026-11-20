# RFC 072 — Supervisão das linhas pessoais

Proposta aceita em 20/11/2026. [ADR 095](../adr/095-supervisao-das-linhas-pessoais.md)

O proprietário quer liberar Meu WhatsApp para a equipe comercial. Cada
titular, inclusive quem exerce a administração, deve conseguir conectar sua
própria linha. O acesso às conversas pessoais dos colegas deve ficar restrito
a uma única conta administrativa designada.

Herdar esse acesso de `COMMERCIAL_ADMIN` o estenderia a cada administrador
atual ou futuro. Uma permissão concedível pelo cadastro de Usuários permitiria
vários supervisores. A proposta vincula a exceção à conta designada e exige que
ela continue ativa e administradora a cada leitura. O envio pessoal continua
vinculado ao titular da linha.

Para a primeira conexão, a operação prepara um identificador de linha e uma
instância de transporte exclusivos por titular elegível. O titular pode então
parear sua conta pelo CRM. O fluxo mantém as verificações de número, geração,
destino e reserva de envio.

[WAP-01/04/07/09/12](../../.specs/features/seller-whatsapp/spec.md) ·
[WAP-E12](../../.specs/features/seller-whatsapp/tasks.md) ·
[piloto publicado](https://github.com/romulosutil/crm-silmer/pull/398).

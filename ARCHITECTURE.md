# Arquitetura — Estado e Restrições

> **Status:** decisões P0 concluídas. Este documento registra fronteiras aprovadas e entrega ao Tech Lead a escolha de backend, banco, hospedagem e provedor de IA.

## Fronteiras funcionais

- **Interface web:** Caixa de Entrada, Kanban, detalhe da conversa/lead, Ficha e visão financeira comercial.
- **Domínio do CRM:** contatos, conversas, leads, cards, etapas, tarefas, catálogo, pedidos, estados financeiros e auditoria.
- **Runtime do Vendedor Silmer:** no MVP, lê contexto, envia mensagens e registra sugestões, sem mutar Contato, Lead, Card, etapa, campo oficial, preço ou pedido.
- **Integração de canais:** recebe e envia eventos sem tornar o modelo interno dependente dos formatos do WhatsApp ou Instagram.
- **Geração documental:** transforma uma versão aprovada do pedido em documento estável.
- **Confiabilidade:** idempotência, fila de pendências, reconciliação e observabilidade do canal.

## Decisões confirmadas

- Frontend em HTML, CSS e JavaScript vanilla.
- API oficial do WhatsApp Business como canal obrigatório do piloto.
- Instagram Direct no piloto quando disponível, sem bloquear o lançamento pelo WhatsApp.
- Caixa de Entrada separada do Kanban.
- Ficha de Pedido como contrato de dados da jornada.
- Vendedor Silmer em modo assistivo no MVP; mutações comerciais permanecem humanas.
- Autonomia comercial pós-MVP somente pela chave `vendedor_silmer_autonomia_comercial`, desabilitada por padrão, com auditoria e rollback próprios.
- n8n opcional e fora do caminho crítico.
- Numeração de pedidos iniciada em `01-CRM`, sem dependência legada.
- Rômulo Sutil Corrêa como Responsável de Privacidade e política do piloto aprovada após consulta jurídica.

## Decisões para o Tech Lead

- Backend e padrão de API.
- Banco de dados e estratégia de migração.
- Autenticação e autorização.
- Hospedagem, segredos, observabilidade e backups.
- Provedor/runtime de IA e estratégia de contexto.
- Fila, retries, idempotência e reconciliação de webhooks.
- Armazenamento de anexos e documentos.
- Geração e envio da Ficha respeitando as regras da API oficial.
- Modelo de segurança e operacionalização dos requisitos de LGPD.

Nenhuma decisão dessa lista deve ser inferida a partir do material arquivado do Datacrazy.

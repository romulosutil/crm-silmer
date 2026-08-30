# Arquitetura — Decisões do MVP

> **Status:** baseline técnica proposta em 30/08/2026. O desenho completo está
> em `TECHNICAL-DESIGN.md`; implantação e operação estão em
> `EASYPANEL-TOPOLOGY.md`.

## Fronteiras funcionais

- **Interface web:** Caixa de Entrada, Kanban, detalhe da conversa/Negócio,
  comercial/PIX/Ficha, relatórios, configuração e privacidade; cada superfície
  possui estados completos e operação sem mouse como parte do DoD.
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

## Decisões técnicas propostas como baseline

- **Forma:** monólito modular em JavaScript ESM, sem microserviços no MVP.
- **Processos:** `edge-web`, `api` e `worker`, construídos do mesmo repositório.
- **Frontend:** HTML semântico, CSS e JavaScript vanilla; Nginx não-root serve
  os assets e mantém web/API na mesma origem.
- **Backend:** Node.js Active LTS, Fastify, REST `/api/v1`, OpenAPI 3.1 e SSE.
- **Persistência:** PostgreSQL com SQL e migrações versionadas; dados oficiais
  normalizados e JSONB limitado a payloads/snapshots apropriados.
- **Assíncrono:** inbox/outbox e jobs no PostgreSQL, com entrega at-least-once,
  idempotência quando suportada pelo provedor e `outcome_unknown` reconciliável;
  não há promessa de exactly-once de rede. Redis não entra no MVP.
- **Autenticação:** sessão opaca em cookie seguro, CSRF, MFA obrigatório para
  `Admin` e autorização aplicada no backend.
- **Storage:** S3-compatible externo e privado; dados, backups e tombstones usam
  buckets e credenciais separados, com proteção de imutabilidade para o ledger;
  containers são stateless.
- **Documentos:** snapshot imutável + template HTML/CSS + PDF gerado no worker.
- **IA:** adapter próprio e OpenAI API direta como baseline, sem fine-tuning,
  RAG ou vector database no MVP; DPA e retenção compatível são gates.
- **Operação:** projetos EasyPanel `crm-silmer-dev`, `crm-silmer-hml` e
  `crm-silmer-prod`, com somente `edge-web` público; a aceitação da VPS única
  depende de recovery drill em host limpo.
- **Deploy:** imagens imutáveis por digest, homologação antes de produção,
  migrations expand/contract, backup externo e rollback para digest anterior.

## Decisões de modelagem

- `Deal`/`Negocio` é a única raiz do funil. Lead é classificação e Card é
  projeção visual, sem estado próprio concorrente.
- Backlog pertence à Conversa e permanece fora do Kanban.
- Sugestões da IA e campos oficiais são persistidos separadamente.
- Auditoria de negócio é append-only e não se confunde com log técnico.
- PostgreSQL é a fonte da verdade; canais, IA, storage e futuras automações
  entram apenas por ports/adapters.
- Venda, PIX, Pedido, Ficha, envio e onboarding usam chaves idempotentes e
  constraints transacionais.

## Projetos e documentos executáveis

- `TECHNICAL-DESIGN.md`: TDD, stack, módulos, dados, APIs, segurança e SLOs.
- `EASYPANEL-TOPOLOGY.md`: serviços, rede, sizing, segredos, CI/CD e recovery.
- `.specs/features/crm-mvp/tasks.md`: decomposição de implementação e gates.

## Aprovações ainda necessárias

- Designar Tech Lead, time e Administrador Técnico.
- Produto/Operação confirmar os defaults destacados no TDD.
- Privacidade aprovar os operadores de IA, storage e observabilidade.
- Operação validar o PDF da Ficha, domínios e credenciais de cada ambiente.
- Produto/Operação aprovar o envelope de carga que qualifica sizing e SLOs.
- DevOps demonstrar RPO/RTO do CRM completo em uma VPS limpa.

Nenhuma decisão técnica deve ser inferida do material arquivado do Datacrazy.

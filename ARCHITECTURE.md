# Arquitetura — Decisões do MVP

> **Status:** baseline revisada em 06/09/2026 para tornar o n8n obrigatório.  
> **Detalhes:** `TECHNICAL-DESIGN.md`; implantação em `EASYPANEL-TOPOLOGY.md`.

## Forma do produto

O MVP possui três objetivos que podem evoluir isoladamente e convergem no lançamento:

| Objetivo | Responsabilidade | Não faz |
| --- | --- | --- |
| CRM | Fonte oficial de contatos, conversas, negócios, etapas, catálogo, pedidos, financeiro, permissões e auditoria | Não executa prompts nem depende da UI para iniciar fluxos |
| Inbox Multicanal | Exibe mensagens, pendências e saúde; permite resposta manual, atribuição, takeover e reconciliação | Não contém regra comercial nem dispara o n8n por botão |
| Agente Vendedor Silmer no n8n | Recebe/envia WhatsApp, chama OpenAI ou Gemini e orquestra criação/atualização de leads, Kanban e handoff | Não escreve no banco nem decide fora dos contratos do CRM |

Fluxo obrigatório: `Cliente → WhatsApp ou Instagram → n8n → API do CRM → Inbox/Kanban`. Respostas seguem `CRM → n8n → canal de origem ou canal migrado`. Cada mensagem válida dispara automaticamente o n8n; a interface apenas observa ou assume a conversa.

## Fronteiras e autoridade

- PostgreSQL é a fonte da verdade do CRM.
- O n8n é o motor obrigatório de canais, IA e orquestração, mas nunca acessa diretamente o banco do CRM.
- Toda mutação oficial usa API versionada, autenticação de serviço, capacidade mínima, `Idempotency-Key`, versão esperada, auditoria e `automation_epoch`.
- O CRM valida estados e gates. O workflow decide o próximo comando permitido; não redefine a máquina de estados.
- Logs do n8n são evidência técnica. A auditoria durável do efeito comercial pertence ao CRM.
- OpenAI e Gemini implementam o mesmo contrato estruturado. Regras de preço, permissão, gate e handoff são determinísticas e ficam fora do prompt.
- Tomada humana incrementa o `automation_epoch`; qualquer execução antiga é rejeitada antes de enviar mensagem ou alterar estado.

## Decisões confirmadas

- Frontend em Vue 3, JavaScript ESM e CSS, compilado com Vite; decisão registrada em `docs/adr/001-adotar-vue-no-frontend.md`.
- APIs oficiais do WhatsApp Business e Instagram Direct como canais obrigatórios do piloto, integradas operacionalmente pelo n8n e sujeitas ao mesmo contrato canônico.
- Migração entre Instagram e WhatsApp preserva o Negócio e só associa `@instagram` e telefone após correlação verificável e auditável.
- Caixa de Entrada separada do Kanban.
- Ficha de Pedido como contrato de dados da jornada.
- Vendedor Silmer autônomo nas operações explicitamente concedidas ao ator `AUTOMATION_EXECUTOR`.
- Aprovação de preço, venda, pagamento e Ficha permanece humana no caminho inicial.
- n8n obrigatório; indisponibilidade do n8n torna a automação indisponível e visível, sem fallback silencioso para outra fonte de estado.
- Numeração de pedidos iniciada em `01-CRM`, sem dependência legada.
- Rômulo Sutil Corrêa como Responsável de Privacidade e política do piloto aprovada após consulta jurídica.
- Defaults `D00.6-01..07` aprovados; `silmer:romulo.sutil` designado como Tech Lead, equipe de entrega e Administrador Técnico.
- Exceção `SOLO-OPS-PILOT-01` limitada ao piloto interno; não prova segregação, infraestrutura provisionada ou recovery.

## Baseline técnica

- **Forma:** CRM como monólito modular em JavaScript ESM e n8n como runtime externo obrigatório de automação; não criar microserviços adicionais.
- **Processos do CRM:** `silmer-edge-web`, `silmer-api`, `silmer-worker` e `silmer-postgres`.
- **Automação:** `silmer-n8n`, persistência própria e workflows versionados. A interface administrativa não é pública.
- **Frontend:** SPA acessível em Vue 3 e Vue Router, sem store global nesta fase; Vite gera assets estáticos e Nginx não-root mantém web/API na mesma origem.
- **Backend:** Node.js Active LTS, Fastify, REST `/api/v1`, OpenAPI 3.1 e SSE.
- **Persistência:** PostgreSQL com SQL e migrações versionadas; dados oficiais normalizados e JSONB limitado a payloads e snapshots apropriados.
- **Assíncrono:** CRM mantém inbox/outbox e jobs transacionais. A rede opera at-least-once; contratos idempotentes e reconciliação tratam replay e `outcome_unknown` sem prometer exactly-once.
- **Escala:** execução regular do n8n no MVP. Queue mode e Redis só entram após medição que justifique mais infraestrutura.
- **Autenticação humana:** sessão opaca em cookie seguro e CSRF.
- **Autenticação técnica:** credencial exclusiva e rotacionável do n8n, sem sessão de navegador, sem capacidade administrativa e sem acesso de rede ao banco do CRM.
- **Storage:** mídia de canal transitória em volume privado da VPS por até sete dias ou fim da jornada; arquivos válidos seguem ao Dropbox por procedimento operacional registrado. Evolução de storage depende da issue `#29`.
- **Documentos:** snapshot imutável, template HTML/CSS e PDF gerado no worker.
- **IA:** OpenAI ou Gemini por configuração versionada, sujeitos ao mesmo schema, evals e gates de privacidade. Produção com PII permanece bloqueada até evidências aplicáveis de DPA, retenção e ZDR.
- **Deploy:** imagens imutáveis por digest, workflows publicados por versão, migrations expand/contract, backup externo e rollback coordenado.

## Modelagem e confiabilidade

- `Deal`/`Negocio` é a única raiz do funil. Lead é classificação e Card é projeção visual.
- Backlog pertence à Conversa e permanece fora do Kanban.
- Dados extraídos pela IA só se tornam oficiais após validação do schema e aceitação pelo comando do CRM.
- Auditoria de negócio é append-only e não se confunde com log técnico.
- Perda da única cópia de mídia transitória produz `lost/unavailable`, nunca alegação de recuperação.
- Venda, PIX, Pedido, Ficha, envio e onboarding usam chaves idempotentes e constraints transacionais.
- Cada execução correlaciona `workflow_key`, versão, `execution_id`, mensagem, `correlation_id` e `automation_epoch`.

## Caminho de lançamento

1. Concluir e provar o CRM isoladamente por API e fixtures.
2. Concluir e provar a Inbox Multicanal com eventos simulados e takeover acessível.
3. Concluir e provar o Vendedor Silmer no n8n com OpenAI e Gemini.
4. Integrar os três objetivos, testar falhas e executar UAT, carga, deploy, rollback e recovery.

As aprovações externas de IA, observabilidade, storage e recovery permanecem gates próprios. Testes e documentação não substituem evidência operacional nem aprovação humana.

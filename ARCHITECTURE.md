# Arquitetura — Decisões do MVP

> **Status:** baseline simplificada em 08/09/2026 pelo contrato n8n MVP.  
> **Detalhes:** `TECHNICAL-DESIGN.md`; implantação em `EASYPANEL-TOPOLOGY.md`.

## Forma do produto

O MVP possui três objetivos que podem evoluir isoladamente e convergem no lançamento:

| Objetivo                      | Responsabilidade                                                                                              | Não faz                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| CRM                           | Fonte oficial de contatos, conversas, negócios, etapas, catálogo, pedidos, financeiro, permissões e auditoria | Não executa prompts nem depende da UI para iniciar fluxos |
| Inbox Multicanal              | Exibe mensagens, pendências e saúde; permite resposta manual, atribuição, takeover e reconciliação            | Não contém regra comercial nem dispara o n8n por botão    |
| Agente Vendedor Silmer no n8n | Recebe/envia WhatsApp, chama o provedor de IA configurado e orquestra resposta, comandos canônicos e handoff  | Não escreve no banco nem decide fora dos contratos do CRM |

Fluxo inicial: `Cliente → WhatsApp → n8n → API do CRM → Inbox/Kanban`.
Respostas seguem `CRM → n8n → WhatsApp`. Instagram reutilizará a fronteira em
fase posterior. Cada mensagem válida dispara automaticamente o n8n; a
interface apenas observa ou assume a conversa.

## Fronteiras e autoridade

- PostgreSQL é a fonte da verdade do CRM.
- O n8n é o motor obrigatório de canais, IA e orquestração, mas nunca acessa diretamente o banco do CRM.
- Toda mutação oficial usa API versionada, Basic Auth de serviço, capacidade mínima, `Idempotency-Key`, correlação, identidade de workflow, versão esperada, auditoria e `automation_epoch`.
- O CRM valida estados e gates. O workflow decide o próximo comando permitido; não redefine a máquina de estados.
- Logs do n8n são evidência técnica. A auditoria durável do efeito comercial pertence ao CRM.
- OpenAI e Gemini implementam o mesmo contrato estruturado. Regras de preço, permissão, gate e handoff são determinísticas e ficam fora do prompt.
- Tomada humana, handoff, retorno à IA, fechamento e desligamento incrementam o
  `automation_epoch`; decisões antigas são rejeitadas na reserva de envio.
- Toda chamada à Meta exige reserva atômica `message.send.requested`; resultado incerto é reconciliado e nunca repetido às cegas.

## Decisões confirmadas

- Frontend em Vue 3, JavaScript ESM e CSS, compilado com Vite; decisão registrada em `docs/adr/001-adotar-vue-no-frontend.md`.
- API oficial do WhatsApp Business como canal do primeiro MVP operacional;
  Instagram Direct é a próxima fase de canal.
- Migração entre Instagram e WhatsApp preserva o Negócio e só associa `@instagram` e telefone após correlação verificável e auditável.
- Caixa de Entrada separada do Kanban.
- Ficha de Pedido como contrato de dados da jornada.
- Vendedor Silmer autônomo nas operações explicitamente concedidas ao ator `AUTOMATION_EXECUTOR`.
- Aprovação de preço, venda, pagamento e Ficha permanece humana no caminho inicial.
- n8n obrigatório; indisponibilidade do n8n torna a automação indisponível e visível, sem fallback silencioso para outra fonte de estado.
- Integração n8n MVP conforme RFC 002/ADR 003: três endpoints, Basic only,
  briefing consolidado na Conversa, reserva por epoch/revisão e comandos
  CRM→n8n por outbox.
- Contrato ativo somente para WhatsApp; Instagram é evolução posterior e não
  bloqueia a validação do primeiro MVP operacional.
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
- **Autenticação técnica:** credenciais Basic distintas n8n→CRM e CRM→n8n, exclusivas e rotacionáveis, sem HMAC/timestamp, sessão de navegador, capacidade administrativa ou acesso ao banco do CRM.
- **Storage:** mídia de canal transitória em volume privado da VPS por até sete dias ou fim da jornada; arquivos válidos seguem ao Dropbox por procedimento operacional registrado. Evolução de storage depende da issue `#29`.
- **Documentos:** snapshot imutável, template HTML/CSS e PDF gerado no worker.
- **IA:** OpenAI ou Gemini por configuração versionada, sujeitos ao mesmo schema, evals e gates de privacidade. Produção com PII permanece bloqueada até evidências aplicáveis de DPA, retenção e ZDR.
- **Deploy:** imagens imutáveis por digest, workflows publicados por versão, migrations expand/contract, backup externo e rollback coordenado.

## Modelagem e confiabilidade

- `Deal`/`Negocio` é a única raiz do funil. Lead é classificação e Card é projeção visual.
- Cliente é `Contact` + `ContactIdentity`; briefing de conversa não é um segundo
  lead e só promove dados pelos endpoints canônicos.
- Backlog pertence à Conversa e permanece fora do Kanban.
- `convertida_em_lead` encerra a triagem, não a conversa; handoff pode existir
  antes de Negócio, começa sem responsável e é reivindicado por papel via CAS.
- Dados extraídos pela IA só se tornam oficiais após validação do schema e aceitação pelo comando do CRM.
- Auditoria de negócio é append-only e não se confunde com log técnico.
- Perda da única cópia de mídia transitória produz `lost/unavailable`, nunca alegação de recuperação.
- Venda, PIX, Pedido, Ficha, envio e onboarding usam chaves idempotentes e constraints transacionais.
- Cada evento técnico correlaciona `workflow_key`, versão, `execution_id`,
  mensagem, `correlation_id` e `automation_epoch`, sem exigir entidade própria
  de execução.

## Caminho de lançamento

1. Aplicar migrações com a integração desligada e implantar API/worker.
2. Criar as duas credenciais Basic DEV e atualizar o workflow ainda inativo.
3. Homologar WhatsApp ponta a ponta, publicar e transferir o webhook da Meta.
4. Desabilitar a entrada direta no CRM; rollback pausa a automação sem reativá-la.
5. Após o primeiro MVP, implementar e homologar Instagram como `CANAL-2`.

As aprovações externas de IA, observabilidade, storage e recovery permanecem gates próprios. Testes e documentação não substituem evidência operacional nem aprovação humana.

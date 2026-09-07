# CRM Silmer MVP — Plano Macro de Entrega

> **Atualizado em:** 06/09/2026  
> **Decisão:** n8n é obrigatório e funciona como motor de canais, IA e jornada comercial.  
> **Design técnico:** `TECHNICAL-DESIGN.md`  
> **Topologia:** `EASYPANEL-TOPOLOGY.md`

O MVP será construído como três objetivos divergentes: **CRM | Inbox Multicanal | Agente Vendedor Silmer no n8n**. Cada objetivo pode avançar e ser validado isoladamente; os três se conectam somente na etapa de integração e lançamento.

Os identificadores `T00..T07` permanecem como referência histórica das issues e entregas já realizadas. Este documento passa a ordenar o trabalho pelo produto que precisa ficar pronto, sem criar clusters adicionais.

## Premissas comuns

- Cada mensagem válida do cliente dispara automaticamente o n8n. A UI não inicia o workflow.
- O n8n recebe e envia mensagens do WhatsApp e Instagram oficiais, executa OpenAI ou Gemini e orquestra a mesma jornada nos dois canais.
- PostgreSQL e APIs do CRM continuam sendo a fonte da verdade. O n8n nunca acessa diretamente o banco.
- O ator técnico `AUTOMATION_EXECUTOR` recebe somente as capacidades necessárias para conversar, criar ou atualizar leads, preencher campos e transicionar etapas.
- Preço, aprovação da venda, confirmação de pagamento e aprovação da Ficha continuam exigindo pessoa autorizada.
- Toda tarefa concluída exige teste proporcional ao risco, commit atômico, push por PR e atualização do Graphify.

Em 02/09/2026, a T00.6 foi aprovada na issue `#10` e deixou de bloquear T02, T03 e T05.
A evidência permanece em `docs/phase0/T00.6-APPROVAL-EVIDENCE.md`, com
`silmer:romulo.sutil` no gate aprovado. A nova decisão de arquitetura não altera
essa aprovação nem satisfaz gates externos e operacionais independentes.

## Objetivo 1 — CRM

**Resultado:** possuir o sistema oficial de dados e regras comerciais, independente da interface e da implementação interna dos workflows.

### Etapa CRM-1 — Consolidar a fundação já entregue

- **Situação:** majoritariamente pronta em `T00` e `T01`.
- **Execução:** em andamento pela fatia CRM-1A, que introduz o ator técnico
  `AUTOMATION_EXECUTOR`, sua autenticação exclusiva e a matriz mínima de
  comandos do n8n.
- Preservar migrations, sessões, MFA, ACL humana, auditoria, idempotência, configuração e catálogo versionados.
- Acrescentar o ator técnico `AUTOMATION_EXECUTOR`, credencial rotacionável e capacidades mínimas, sem autoatribuição nem sessão de navegador.
- Fechar os testes de ACL do ciclo Pedido/Ficha ainda rastreados na issue `#13`.
- **Dependência remanescente:** a issue `#13` continua aberta até existirem as
  entidades, comandos e UI reais de Pedido/Ficha previstos na CRM-3; doubles de
  autorização não serão promovidos a evidência E2E.
- **Verificação:** uma credencial do n8n só executa comandos previstos; tentativa de acesso administrativo ou direto ao banco falha e é auditada.

### Etapa CRM-2 — Concluir Contato, Negócio e Kanban

- **Origem:** `T03.1..T03.6`.
- Implementar `Contact`, identidade, `Deal` como raiz única e projeção de Card.
- Implementar etapas Produto, Especificação, Estampa, Logística e Fechamento com versão esperada, gates, retorno à primeira etapa incompleta e motivo de perda.
- Expor comandos idempotentes para criar/atualizar lead, preencher campos, registrar gate, avançar, recuar, transferir e encerrar.
- Publicar eventos canônicos para atualização em tempo real da UI.
- **Verificação:** concorrência, replay e transição inválida nunca criam dois negócios nem pulam etapa.

### Etapa CRM-3 — Concluir fechamento, pedido e Ficha

- **Origem:** `T05.1..T05.9`.
- Implementar orçamento versionado, aprovação humana da venda, PIX, conferência humana, numeração `NN-CRM`, snapshot imutável, PDF, envio para Rose e boas-vindas.
- Tornar cada efeito externo idempotente e reconciliável, incluindo `outcome_unknown`.
- **Verificação:** repetir aprovação, cobrança, geração e envio não duplica cobrança, pedido, número ou mensagem.

### Etapa CRM-4 — Concluir gestão e operação

- **Origem:** `T06.1..T06.6`.
- Entregar relatório de vendas, usuários, configurações, privacidade, retenção, tombstones e painel de saúde.
- Fechar evidências de observabilidade off-host na issue `#11`, storage/recovery na issue `#29` e recovery drill na issue `#3`.
- **Verificação:** relatórios reconciliam com eventos do domínio; retenção e recovery não fazem alegações além das evidências reais.

### Critério de conclusão do CRM

O objetivo está pronto quando as APIs conseguem executar toda a jornada com fixtures, sem n8n nem UI, preservando ACL, idempotência, auditoria e invariantes comerciais.

## Objetivo 2 — Inbox Multicanal

**Resultado:** oferecer uma superfície operacional única para observar conversas, responder manualmente, tratar pendências e assumir o atendimento.

### Etapa INBOX-1 — Reaproveitar o núcleo de mensagens

- **Situação:** persistência e configuração de canal de `T02.1` e `T02.4` estão prontas; devem ser preservadas.
- Manter conversa, ciclo, mensagem, identidade externa, anexos, status e mídia transitória como modelo canônico do CRM.
- Adaptar a entrada para aceitar o envelope normalizado pelo n8n, mantendo chaves externas e idempotência.
- **Verificação:** mensagens repetidas e fora de ordem convergem para uma única linha do tempo.

### Etapa INBOX-2 — Refatorar a fronteira do WhatsApp

- **Situação:** o adapter direto da Meta em `T02.2` deixa de ser a porta operacional e vira referência reutilizável para assinatura, normalização e fixtures.
- Mover recebimento, download/upload de mídia, envio e status do WhatsApp para workflows publicados no n8n.
- O CRM recebe eventos canônicos do n8n e devolve comandos/resultados; não recebe o clique da UI para iniciar automação.
- Separar apps/webhooks de desenvolvimento e produção e documentar credenciais e rotação.
- **Verificação:** mensagem realista entra pela Meta, dispara n8n e aparece uma única vez na Inbox; resposta manual e automática usam o mesmo histórico oficial.

### Etapa INBOX-3 — Concluir confiabilidade do canal

- **Origem:** completar `T02.3` e `T02.5`.
- Implementar pendências, retries seguros, reconciliação, status de entrega e estados `outcome_unknown`, `lost/unavailable` e `requer_atencao`.
- Exibir saúde do n8n, WhatsApp e último evento observado sem afirmar recuperação de dados não recebidos.
- **Verificação:** indisponibilidade do n8n, Meta, CRM ou mídia fica visível e retomável sem duplicidade.

### Etapa INBOX-4 — Concluir a interface acessível

- **Origem:** `T02.6`.
- Entregar lista de conversas, filtros, thread, composer, anexos, estados vazios/erro/offline e atualização em tempo real.
- Implementar resposta manual, tomada humana, reativação controlada, atribuição e histórico do resumo de handoff.
- Garantir teclado, foco previsível, regiões vivas e rótulos dinâmicos; nenhum botão deve simular “iniciar n8n”.
- **Verificação:** operação completa sem mouse e takeover durante uma resposta de IA impede envio atrasado.

### Etapa INBOX-5 — Concluir Instagram e migração de canal

- **Origem:** `T02.7`.
- Integrar Instagram Direct como canal obrigatório, mantendo identidades separadas até correlação verificável.
- Permitir migração entre WhatsApp e Instagram sem criar outro Negócio; conectar `@instagram` e telefone ao mesmo lead após confirmação verificável.
- **Verificação:** ambos os canais aparecem na mesma Inbox, mantêm o mesmo contexto e não fundem pessoas por nome ou similaridade.

### Critério de conclusão da Inbox Multicanal

O objetivo está pronto quando uma pessoa consegue observar, responder, assumir e reconciliar conversas por teclado usando eventos simulados, mesmo antes do agente completo estar conectado.

## Objetivo 3 — Agente Vendedor Silmer no n8n

**Resultado:** executar a mesma jornada de vendas no WhatsApp e no Instagram a partir da mensagem recebida, usando IA sob regras determinísticas, migrando de canal e transferindo para uma pessoa quando necessário.

### Etapa AGENTE-1 — Implantar o n8n obrigatório

- Criar o serviço privado `silmer-n8n`, banco/esquema e credenciais próprios, criptografia de credenciais, backup, health check e publicação por versão.
- Publicar os webhooks de WhatsApp e Instagram sem expor a interface administrativa do n8n.
- Usar execução regular no MVP; queue mode e Redis permanecem P2 até haver evidência de escala.
- **Verificação:** workflow sintético é publicado, executado e restaurado sem acesso direto ao PostgreSQL do CRM.

### Etapa AGENTE-2 — Criar contratos CRM ↔ n8n

- Definir envelopes versionados para mensagem, contexto, comando, resultado, erro e handoff.
- Implementar autenticação de serviço, `Idempotency-Key`, `correlation_id`, `workflow_key`, versão, `execution_id` e `automation_epoch`.
- Rejeitar comando obsoleto, capacidade indevida, schema divergente e replay com payload diferente.
- **Verificação:** testes de contrato executam contra doubles de ambos os lados e contra PostgreSQL real do CRM.

### Etapa AGENTE-3 — Conectar OpenAI e Gemini

- Implementar o mesmo schema estruturado para os dois provedores, com seleção por configuração versionada e fallback somente quando seguro.
- Minimizar contexto, aplicar retenção aprovada, bloquear segredo/PII em logs e registrar modelo, versão de prompt, tokens e decisão.
- Manter regras de preço, permissão, gate e handoff em validação determinística, fora do prompt.
- Fechar DPA, retenção e ZDR do provedor escolhido antes de produção com PII, conforme issue `#5`.
- **Verificação:** evals equivalentes cobrem prompt injection, preço inventado, schema inválido e indisponibilidade dos dois provedores.

### Etapa AGENTE-4 — Construir o workflow da jornada

- Ao receber mensagem, carregar contexto oficial, descobrir o próximo dado necessário, perguntar apenas o que falta e persistir a resposta validada.
- Classificar intenção, criar ou atualizar lead, registrar gates e mover o Kanban pelas etapas permitidas.
- Executar o mesmo fluxo no WhatsApp e Instagram, preservando o Negócio ao migrar de canal e solicitando ao CRM o vínculo verificado entre `@instagram` e telefone.
- Após aprovações humanas obrigatórias, continuar PIX, Ficha, envio e boas-vindas sem duplicar efeitos.
- Versionar e publicar workflows por ambiente; execução ativa deve sempre apontar para uma versão conhecida.
- **Verificação:** jornada sintética percorre Backlog até Fechado e uma segunda termina em Sem lead.

### Etapa AGENTE-5 — Implementar handoff e desligamento seguro

- Transferir quando o cliente pede pessoa, quando preço/regra não está aprovado, quando há bloqueio real ou quando a confiança fica abaixo do limite versionado.
- Gerar resumo, motivo, etapa, pendências e responsável; suspender novos envios automáticos.
- Incrementar `automation_epoch` no takeover e validar o epoch novamente imediatamente antes de cada envio ou mutação.
- **Verificação:** uma execução atrasada após takeover não envia mensagem nem altera o CRM.

### Etapa AGENTE-6 — Tornar a automação operável

- Criar métricas e alertas de latência, erro, backlog, handoff, custo por conversa, loops, versão ativa e divergência CRM/n8n.
- Criar runbooks de pausar globalmente, pausar por conversa, reprocessar, reconciliar, rotacionar credencial, trocar provedor e restaurar workflows.
- Auditar no CRM o efeito de negócio; o histórico de execução do n8n é evidência técnica, não a fonte oficial.
- **Verificação:** simulações de falha são detectadas e recuperadas sem PII em logs e sem avanço silencioso.

### Critério de conclusão do Agente Vendedor Silmer no n8n

O objetivo está pronto quando workflows versionados conduzem casos sintéticos com OpenAI e Gemini, respeitam os gates humanos remanescentes e sobrevivem a retry, takeover e falha externa.

## Integração e lançamento

Esta etapa começa somente quando os critérios isolados dos três objetivos estiverem atendidos.

### Etapa INT-1 — Conectar os três objetivos

- Ligar WhatsApp/Instagram → n8n → CRM → Inbox e os comandos CRM → n8n → canal de origem ou canal migrado.
- Executar uma venda completa e um handoff humano, incluindo atualização em tempo real da Inbox e do Kanban.
- **Gate:** nenhuma ação depende de botão para iniciar o n8n e nenhum workflow escreve diretamente no banco.

### Etapa INT-2 — Validar falhas e segurança

- Repetir webhook, derrubar cada dependência, atrasar resposta de IA, provocar concorrência, trocar versão de workflow e executar takeover.
- Validar ACL, CSRF onde aplicável, assinatura do canal, rotação de segredos, PII, teclado, foco e ARIA.
- **Gate:** zero duplicidade, zero mutação obsoleta, zero violação bloqueante de acesso, privacidade ou acessibilidade.

### Etapa INT-3 — Preparar produção

- Construir imagens imutáveis, aplicar migrations, publicar workflows, configurar domínios/segredos, backups, monitor off-host, rollback e recovery.
- Executar carga conforme envelope aprovado e fechar evidências pendentes das issues `#1`, `#3`, `#5`, `#11`, `#13` e `#29` que forem aplicáveis ao go-live.
- **Gate:** smoke por digest, alertas roteados, restore e rollback demonstrados no ambiente alvo.

### Etapa INT-4 — UAT e lançamento do MVP

- Produto valida os critérios `ORC`, `INB`, `AGT`, `MSG`, `ORD`, `PAY`, `FIN` e `PRV` com dados sintéticos.
- Operação aprova Inbox, handoff, pedido, Ficha e runbooks.
- Privacidade e DevOps aprovam somente os gates sob sua autoridade; testes e documentos não substituem essas aprovações.
- **Gate final:** WhatsApp e Instagram operacionais, n8n saudável, CRM íntegro, Inbox acessível, agente controlável, migração de canal validada e rollback ensaiado.

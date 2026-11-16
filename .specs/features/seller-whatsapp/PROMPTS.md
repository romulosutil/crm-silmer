# Prompts executáveis — WhatsApp por vendedor, etapa 1

Data: 16/11/2026. Entrega WAP-T00d. Base: [PR 382](https://github.com/romulosutil/crm-silmer/pull/382),
[spec](spec.md), [design](design.md), [tarefas/dependências](tasks.md) e
[ADR 091](../../../docs/adr/091-contratos-da-etapa1-whatsapp-pessoal.md).

Cada caixa abaixo é um prompt completo: copie somente a caixa da tarefa para
o modelo indicado. Leia a ordem/dependências antes de iniciar. Os prompts
**implementam uma tarefa**, não são pedidos para replanejar a feature inteira.
A autorização desta entrega é documental: estes prompts não executaram código
nem liberaram produção, pareamento ou efeito financeiro.

## Escolha do modelo

| Par solicitado | Uso neste plano                                                         | Quantidade |
| -------------- | ----------------------------------------------------------------------- | ---------- |
| Sol/Opus       | Contratos, ACL, transações, efeitos incertos e verificação adversarial  | 21         |
| Terra/Sonnet   | DDL e UI delimitados, adapters com fixtures e contrato fechado          | 10         |
| Luna/Haiku     | Consolidar runbook a partir de evidência aprovada, sem alterar contrato | 1          |

Os pares são alternativas de executor, não uma chamada aos dois modelos.
Escolha um deles. A indicação é julgamento de risco da tarefa, sem afirmar
benchmark ou equivalência exata entre fornecedores. Se a tarefa delimitada
exigir mudar contrato, escale para Sol/Opus e registre a decisão; não invente
regra de negócio nem nova infraestrutura. Nas tarefas de QA, prefira uma
sessão revisora que não tenha escrito a implementação.

## Sequência e índice

O primeiro resultado integrado é **WAP-T02a-05**. Primeiro envio opcional,
sincronização completa e acabamento vêm depois dele, mas continuam exigidos
para encerrar a etapa 1. Dependências completas estão em tasks.md. Um executor
por vez altera o checkout. Tarefas sem dependência também são executadas
serialmente nesta máquina; não abrir vários agentes escritores.

- [WAP-T01-01 — Provar controle, código mobile e privacidade do provedor](#wap-t01-01) · **Sol/Opus**
- [WAP-T01-02 — Persistir linha pessoal e ledger de controle](#wap-t01-02) · **Terra/Sonnet**
- [WAP-T02-01 — Persistir vínculo durável de carteira](#wap-t02-01) · **Terra/Sonnet**
- [WAP-T02-02 — Aplicar escrita compartilhada por campo](#wap-t02-02) · **Sol/Opus**
- [WAP-T02-03 — Isolar leituras de Clientes e projeções comuns](#wap-t02-03) · **Sol/Opus**
- [WAP-T02-04 — Compor cadastro e vínculo de Cliente](#wap-t02-04) · **Sol/Opus**
- [WAP-T01-03 — Expor comandos e estado de controle pessoal](#wap-t01-03) · **Sol/Opus**
- [WAP-T01-04 — Conectar controle n8n e desafio efêmero](#wap-t01-04) · **Sol/Opus**
- [WAP-T02-05 — Receber na linha pessoal com atribuição humana atômica](#wap-t02-05) · **Sol/Opus**
- [WAP-T02-06 — Proteger conversa e leituras auxiliares da linha](#wap-t02-06) · **Sol/Opus**
- [WAP-T02-07 — Cercar eventos, replay e revogação de acesso](#wap-t02-07) · **Sol/Opus**
- [WAP-T02a-01 — Adicionar origem de Assunto ao Pedido](#wap-t02a-01) · **Terra/Sonnet**
- [WAP-T02a-02 — Resolver Pedido por alvo sem escolha arbitrária](#wap-t02a-02) · **Sol/Opus**
- [WAP-T02a-03 — Criar ou reutilizar Pedido no alvo transacional](#wap-t02a-03) · **Sol/Opus**
- [WAP-T02a-04 — Entregar fluxo passivo de Pedido em Meus clientes](#wap-t02a-04) · **Terra/Sonnet**
- [WAP-T02a-05 — Verificar gate prioritário ponta a ponta](#wap-t02a-05) · **Sol/Opus**
- [WAP-T02-08 — Revalidar linha na reserva e no despacho humano](#wap-t02-08) · **Sol/Opus**
- [WAP-T03-01 — Normalizar fato externo enviado pelo aparelho](#wap-t03-01) · **Terra/Sonnet**
- [WAP-T03-02 — Persistir saída externa e reconciliar eco](#wap-t03-02) · **Sol/Opus**
- [WAP-T04-01 — Completar cadastro e vínculo na carteira](#wap-t04-01) · **Terra/Sonnet**
- [WAP-T04-02 — Entregar Meu WhatsApp e onboarding dispensável](#wap-t04-02) · **Terra/Sonnet**
- [WAP-T04-03 — Compor primeiro envio individual no servidor](#wap-t04-03) · **Sol/Opus**
- [WAP-T04-04 — Expor compositor do primeiro envio opcional](#wap-t04-04) · **Terra/Sonnet**
- [WAP-T02-09 — Preservar cobrança e preparo pela linha correta](#wap-t02-09) · **Sol/Opus**
- [WAP-T04-05 — Conservar contexto das ações comerciais na carteira](#wap-t04-05) · **Terra/Sonnet**
- [WAP-T05-01 — Consolidar flags, allowlist e limites sem ativação](#wap-t05-01) · **Terra/Sonnet**
- [WAP-T05-02 — Auditar regressão funcional, a11y e privacidade](#wap-t05-02) · **Sol/Opus**
- [WAP-T05-03 — Ensaiar rollback e recovery sem reativar efeitos](#wap-t05-03) · **Sol/Opus**
- [WAP-T05-04 — Consolidar roteiro operacional e evidências](#wap-t05-04) · **Luna/Haiku**
- [WAP-T05-05 — Homologar fluxo passivo real de Pedido](#wap-t05-05) · **Sol/Opus**
- [WAP-T05-06 — Homologar pareamento mobile e sincronização reais](#wap-t05-06) · **Sol/Opus**
- [WAP-T05-07 — Homologar ações comerciais e primeiro envio do piloto](#wap-t05-07) · **Sol/Opus**

## WAP-T01-01

**Provar controle, código mobile e privacidade do provedor** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T01-01: Provar controle, código mobile e privacidade do provedor.
Modelo indicado: Sol/Opus. Requisitos: WAP-02/03/04/10/12.
Dependências obrigatórias: base documental PR 382 + WAP-T00d integrada; nenhuma tarefa de runtime anterior.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Inspecionar a fonte/imagem fixada e produzir ensaio local isolado com instâncias sintéticas para create/connect/status/logout e entrega efêmera QR/código.

Fronteira editável: ops/evolution/; ops/n8n/; test/n8n-evolution-workflow.test.js; docs/runbooks/seller-whatsapp-provider.md. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Registrar contratos reais, eventos/identidade e limites; provar ausência de segredo em n8n inclusive erro/manual/em progresso/pinData/log/backups aplicáveis. Não declarar código no mesmo celular homologado sem prova real. Limitação material bloqueia habilitação, com alternativa revisável. Provar origem autenticada da geração no ingresso e invalidação após reconnect, não rotular evento antigo pela geração atual.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/n8n-evolution-workflow.test.js; ensaio local específico descrito no relatório.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T01-02

**Persistir linha pessoal e ledger de controle** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T01-02: Persistir linha pessoal e ledger de controle.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-02/04/10/11/12.
Dependências obrigatórias: WAP-T01-01.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Criar migração expand e repositório para linha/conta técnica/geração e operações de controle, sem habilitar workflows.

Fronteira editável: modules/database/; modules/inbox-channels/src/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Unicidade vendedor/número inclusive desconectado, conflito com linha geral, CAS e geração; número cifrado/digest, instância opaca; ledger só metadados, nunca QR/código. Duas transações não reservam o mesmo número.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: npm run test:database; testes PostgreSQL novos de constraints, upgrade e corrida.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-01

**Persistir vínculo durável de carteira** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T02-01: Persistir vínculo durável de carteira.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-06/08/18/20/21/24/29.
Dependências obrigatórias: base documental PR 382 + WAP-T00d integrada; nenhuma tarefa de runtime anterior.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Criar associação versionada vendedor/Contact com proveniência, estado, auditoria e unicidade por par.

Fronteira editável: modules/database/; modules/contacts/src/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Cadastro e vínculo independem da linha; revogar/reativar não duplica o par. Operações de vínculo serializam no Contact para proteger compartilhamento concorrente. Nenhum backfill global ou inferido pelo criador/telefone.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: npm run test:database; testes PostgreSQL novos de vínculo e concorrência com edição.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-02

**Aplicar escrita compartilhada por campo** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-02: Aplicar escrita compartilhada por campo.
Modelo indicado: Sol/Opus. Requisitos: WAP-25/26/27/28/29/30.
Dependências obrigatórias: WAP-T02-01.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Aplicar a política compartilhada em todos os caminhos cadastrais existentes, com lock de Contact e revalidação atual.

Fronteira editável: modules/contacts/src/; apps/api/src/operation-runtime.js; apps/api/src/operation-routes.js; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Comuns e fiscal vazio permitidos; CPF/CNPJ/tipo preenchidos só Admin com motivo/conferência; telefone compartilhado só Admin conferido; campo restrito igual não bloqueia outro campo. Conflito 409 preserva rascunho; snapshots e preparações afetadas protegidos, sem valores pessoais em evento/auditoria em claro.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/contact-registration.test.js test/contact-registration-api.test.js test/contact-details.test.js; testes PostgreSQL novos de CAS, revogação e segundo vínculo concorrente.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-03

**Isolar leituras de Clientes e projeções comuns** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-03: Isolar leituras de Clientes e projeções comuns.
Modelo indicado: Sol/Opus. Requisitos: WAP-07/08/20/21/24/28.
Dependências obrigatórias: WAP-T01-02, WAP-T02-01.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Implementar leitura de Meus clientes e isolamento dos dados pessoais de linha em Clientes geral, detalhes, identidades e contagens.

Fronteira editável: modules/contacts/src/adapters/postgres-contact-read-repository.js; apps/api/src/operation-runtime.js; apps/api/src/operation-routes.js; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Escopo antes de busca/cursor/count; Contact compartilhado não revela identidade/histórico alheios; IDs diretos/candidatos privados negados sem vazamento. Preservar universo legado autorizado; carteira não exige conexão. Cursor identifica escopo/versão e não cruza leitores.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/conversation-visibility.test.js test/conversation-acl-frontiers.test.js; testes de leitura PostgreSQL novos e negativos de paginação/contagem.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-04

**Compor cadastro e vínculo de Cliente** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-04: Compor cadastro e vínculo de Cliente.
Modelo indicado: Sol/Opus. Requisitos: WAP-18/20/21/24/29.
Dependências obrigatórias: WAP-T02-02, WAP-T02-03.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Implementar POST /me/clients e POST /me/clients/:contactId/link reutilizando serviços oficiais em uma transação.

Fronteira editável: modules/contacts/src/; apps/api/src/operation-runtime.js; apps/api/src/operation-routes.js; test/; schemas/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Mesmo contactId para existente selecionado e autorizado; novo Contact+vínculo atômicos; replay reautoriza e não duplica; colisão privada não cria cópia nem revela candidato. Não criar identidade/conversa/Pedido/envio. Rollout reconcilia só proveniência comercial comprovada, com dry-run sem PII.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/contact-identity.test.js test/contact-details.test.js; testes API/PostgreSQL novos de cadastro/vínculo/rollback/concorrência.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T01-03

**Expor comandos e estado de controle pessoal** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T01-03: Expor comandos e estado de controle pessoal.
Modelo indicado: Sol/Opus. Requisitos: WAP-01/02/03/04/10/11/12.
Dependências obrigatórias: WAP-T01-02.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Implementar API humana de estado/connect/disconnect e contrato técnico de operação/resultado sobre ledger, inicialmente desabilitados.

Fronteira editável: apps/api/src/; modules/inbox-channels/src/; modules/identity-access/src/; apps/worker/src/; schemas/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Derivar titular/instância/URL no servidor; sessão/CSRF/origem/capacidade/versão/idempotência/rate limit. GET sem efeito; timeout fica incerto e consulta antes de retry; callbacks antigos não restauram geração; Admin não recebe QR alheio. QR/código fora de persistência e replay.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: testes novos de rotas/serviço/worker; testes PostgreSQL de duas abas, callback antigo, inativação e resultado incerto.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T01-04

**Conectar controle n8n e desafio efêmero** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T01-04: Conectar controle n8n e desafio efêmero.
Modelo indicado: Sol/Opus. Requisitos: WAP-02/03/04/10/11/12.
Dependências obrigatórias: WAP-T01-01, WAP-T01-03.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Implementar adapter de controle parametrizado por linha e desafio API→n8n→Evolution conforme prova do spike, sem publicar workflow real.

Fronteira editável: ops/n8n/; ops/evolution/; apps/api/src/; modules/integration-reliability/src/; test/; schemas/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Intenção durável só com metadados; desafio efêmero correlacionado a operação/geração/TTL, no-store sem logs/persistência n8n. Confirmar número/webhook antes de ativo; não apagar instância após timeout ou usar revisão inbound. Reconciliar por leitura. Contrato técnico Basic/correlação vigente. Replay de desafio não regenera bytes/efeito; renovação explícita versionada só após resolver incerteza. Vincular ingresso à geração de forma imutável.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/n8n-evolution-workflow.test.js test/n8n-command-worker.test.js; ensaio sintético do desafio e inspeção de persistência conforme T01-01.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-05

**Receber na linha pessoal com atribuição humana atômica** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-05: Receber na linha pessoal com atribuição humana atômica.
Modelo indicado: Sol/Opus. Requisitos: WAP-04/05/06/08/10/20/21/32.
Dependências obrigatórias: WAP-T01-04, WAP-T02-04.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Resolver conta/linha/geração autenticadas no inbound e persistir Cliente/vínculo/conversa humana atribuída ao titular.

Fronteira editável: ops/n8n/workflows/create-evolution-workflow.mjs; modules/n8n-integration/src/; modules/contacts/src/; modules/inbox-channels/src/; schemas/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Sem janela sem dono, chamada IA, resposta automática ou Pedido. Titular inativo põe evento em pendência privada administrativa; conta geral preservada. Mesmo Cliente em duas linhas mantém histórias separadas; evento antigo/repetido não muda titular nem duplica. Testar inbound/callback antigo após reconnect sem relabelar geração.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/n8n-evolution-workflow.test.js test/contact-identity.test.js; testes PostgreSQL novos de inbound concorrente, rollback e inativo.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-06

**Proteger conversa e leituras auxiliares da linha** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-06: Proteger conversa e leituras auxiliares da linha.
Modelo indicado: Sol/Opus. Requisitos: WAP-07/08/17/28.
Dependências obrigatórias: WAP-T02-05, WAP-T02-03.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Aplicar predicado comum de linha/posse a Inbox, detalhes, mídia, Assuntos, contexto e comandos genéricos de posse/transferência.

Fronteira editável: modules/inbox-channels/src/; apps/api/src/conversation-routes.js; apps/api/src/conversation-runtime.js; apps/api/src/operation-runtime.js; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Linha pessoal sem dono não vira pública; transferência genérica para outro vendedor negada; Admin e ACL comercial preservados sem conceder chat pelo Pedido. Escopo antes de count/paginação e joins; revalidar mutações e replay. Testar cada rota pública alcançada pelo predicado.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/conversation-visibility.test.js test/conversation-acl-frontiers.test.js test/conversation-routes.test.js; testes PostgreSQL/E2E negativos de mídia/Assuntos/contexto.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-07

**Cercar eventos, replay e revogação de acesso** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-07: Cercar eventos, replay e revogação de acesso.
Modelo indicado: Sol/Opus. Requisitos: WAP-07/11/28/29.
Dependências obrigatórias: WAP-T02-06, WAP-T02-02.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Aplicar escopo atual no SSE/replay e invalidação das projeções abertas após perda de vínculo/posse/linha.

Fronteira editável: apps/api/src/operation-routes.js; apps/api/src/live-event-dispatcher.js; apps/api/src/operation-runtime.js; modules/inbox-channels/src/; apps/edge-web/src/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Sessão/capacidade revalidadas; eventos mínimos sem conteúdo alheio, QR ou valores cadastrais; cursor antigo não atravessa escopo. UI aborta requisições e remove conteúdo privado; resposta atrasada não restaura. Conflito cadastral avisa sem revelar outra carteira.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/conversation-acl-frontiers.test.js; E2E novo de duas sessões, revogação e resposta tardia; axe nas superfícies alteradas.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02a-01

**Adicionar origem de Assunto ao Pedido** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T02a-01: Adicionar origem de Assunto ao Pedido.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-17/31/33.
Dependências obrigatórias: base documental PR 382 + WAP-T00d integrada; nenhuma tarefa de runtime anterior.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Adicionar origin_subject_id nullable com FK composta à conversa e índice por alvo, preservando conversation_id e o índice global antigo nesta entrega preparatória.

Fronteira editável: modules/database/; modules/orders/src/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Migração expand sem backfill ambíguo; prova de integridade Contact/conversa/Assunto e compatibilidade de histórico. Não criar caminho manual sem conversa. Testar upgrade, órfão e FK de Assunto em conversa diferente; nenhum escritor novo habilitado. Reutilizar UNIQUE de Assunto existente em 0037; backfill só de pendente ativo com vínculo único comprovado, nunca cancelados imutáveis ou demais históricos.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: npm run test:database; testes PostgreSQL novos de migração/FK/index/compatibilidade.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02a-02

**Resolver Pedido por alvo sem escolha arbitrária** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02a-02: Resolver Pedido por alvo sem escolha arbitrária.
Modelo indicado: Sol/Opus. Requisitos: WAP-17/30/31/33.
Dependências obrigatórias: WAP-T02a-01.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Preparar leitores/ports e resolver alvo explícito, legado inequívoco e múltiplos Assuntos com origem persistida.

Fronteira editável: modules/orders/src/; modules/inbox-channels/src/application/subject-service.js; modules/inbox-channels/src/adapters/postgres-order-assistance.js; apps/api/src/order-runtime.js; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: findPendingByConversation não retorna primeiro candidato em ambiguidade. Preservar ACL, firstContactAt, briefing por alvo, listagens, projeção automática, snapshots e reabertura/cancelamento. Documentar rollout: binário antigo não é rollback seguro após múltiplos alvos. Ainda sem habilitar criação por alvo.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/order-conversation-port.test.js test/order-assistance.test.js test/order-routes.test.js; testes PostgreSQL novos de pedidos legados e múltiplos alvos.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02a-03

**Criar ou reutilizar Pedido no alvo transacional** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02a-03: Criar ou reutilizar Pedido no alvo transacional.
Modelo indicado: Sol/Opus. Requisitos: WAP-17/31/33; OA-05/07.
Dependências obrigatórias: WAP-T02a-02, WAP-T02-06.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Estender o POST existente com subjectId/expectedSubjectVersion opcionais em par e compor Pedido/vínculo/numeração/recibo/auditoria atomicamente.

Fronteira editável: apps/api/src/order-routes.js; apps/api/src/order-runtime.js; modules/orders/src/; modules/inbox-channels/src/; modules/database/; schemas/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Novo Assunto explícito permite novo Pedido; existente abre sem duplicar; omissão só no legado inequívoco. Substituir índice global pelo parcial legado + unicidade por alvo apenas com leitores compatíveis e flag desligada. Revalidar humano, linha/posse, Contact, conversa aberta e versões sob lock. Duas chaves concorrentes vencem uma vez; nenhuma IA/cobrança/envio ou dependência de canal online/cadastro completo.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/order-routes.test.js test/order-conversation-port.test.js test/order-assistance.test.js; testes PostgreSQL reais de duas chaves, CAS, encerramento/revogação, Assunto cruzado e rollback transacional.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02a-04

**Entregar fluxo passivo de Pedido em Meus clientes** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T02a-04: Entregar fluxo passivo de Pedido em Meus clientes.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-01/17/31/32/33.
Dependências obrigatórias: WAP-T02a-03, WAP-T02-07.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Compor entrada mínima Meus clientes→conversa humana e Criar/abrir Pedido usando rotas e componentes atuais.

Fronteira editável: apps/edge-web/src/; test/e2e/; test/order-assistance-ui.test.js. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Preservar correção master d7537b3c do botão no cabeçalho; confirmar criação captura IDs/versões/alvo. Troca de contexto/inativo cancela; resposta velha não navega; rascunho preservado, foco/teclado/ARIA previsíveis. Pendente numerado abre ficha sem cadastro completo, IA, primeiro envio ou canal online.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/order-assistance-ui.test.js; npx playwright test test/e2e/order-assistance.spec.js; E2E novo de Meus clientes/passivo com axe.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02a-05

**Verificar gate prioritário ponta a ponta** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02a-05: Verificar gate prioritário ponta a ponta.
Modelo indicado: Sol/Opus. Requisitos: WAP-17/19/31/32/33.
Dependências obrigatórias: WAP-T02a-04.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Executar revisão independente e ensaio integrado API/PostgreSQL/navegador do fluxo passivo, antes de expandir primeira saída.

Fronteira editável: test/; .specs/features/seller-whatsapp/validation-pedido.md; docs/runbooks/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Dois vendedores/mesmo Contact, novo alvo e pendente existente, offline posterior, acesso cruzado, replay/duplo clique, troca de conversa, encerramento, inativação e concorrência. Verificar todos os IDs/responsável/número/ficha e ausência de efeitos externos. Falhas viram findings; não marcar PASS com mocks como prova de banco ou transporte.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: npm run test:orders:live com banco sintético; suítes novas do alvo; E2E de fluxo passivo/teclado/axe; npm run validate; npm run test:e2e; npm audit --audit-level=high.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-08

**Revalidar linha na reserva e no despacho humano** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-08: Revalidar linha na reserva e no despacho humano.
Modelo indicado: Sol/Opus. Requisitos: WAP-06/10/11/12/19.
Dependências obrigatórias: WAP-T02a-05.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Acrescentar origem da linha e geração aos envios existentes e revalidar em reserva/despacho/resultado sem transporte paralelo.

Fronteira editável: modules/integration-reliability/src/; modules/n8n-integration/src/; modules/inbox-channels/src/; apps/worker/src/; ops/n8n/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Conta original obrigatória; disconnect/inativo/flag bloqueiam efeito não iniciado; iniciado/incerto permanece auditado e não é reenviado. Nenhum fallback à linha geral nem troca de destinatário. Mesma regra para texto/mídia e origem comercial; bot pessoal negado.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/n8n-command-store.test.js test/n8n-command-worker.test.js test/n8n-evolution-workflow.test.js; testes PostgreSQL novos de reserva vs disconnect/revogação.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T03-01

**Normalizar fato externo enviado pelo aparelho** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T03-01: Normalizar fato externo enviado pelo aparelho.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-09/10/12.
Dependências obrigatórias: WAP-T02a-05, WAP-T01-01.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Adicionar envelope versionado de fato message.external.sent para fromMe verdadeiro, distinto do comando de envio.

Fronteira editável: ops/n8n/workflows/create-evolution-workflow.mjs; schemas/fixtures/external/n8n/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Validar instância/conta/geração, ID/timestamp/origem e tipos de mídia existentes. Sem IA, nova inbound, envio ou Pedido. Fixtures sintéticas do contrato fixado; não chamar externa qualquer saída parecida nem afirmar operador físico.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/n8n-evolution-workflow.test.js; testes novos de contrato externo/negativos; npm run validate:external-spikes; npm run test:external-spikes.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T03-02

**Persistir saída externa e reconciliar eco** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T03-02: Persistir saída externa e reconciliar eco.
Modelo indicado: Sol/Opus. Requisitos: WAP-06/09/10/11.
Dependências obrigatórias: WAP-T03-01, WAP-T02-08.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Consumir fato externo e reconciliar registro de mensagem por conta/ID com o envio CRM já reservado.

Fronteira editável: modules/n8n-integration/src/; modules/inbox-channels/src/; modules/integration-reliability/src/; apps/api/src/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: HTTP→eco e eco→HTTP geram uma mensagem; ID igual em contas diferentes não colide. Não correlacionar por texto/hora; desconhecido fica externo/incerto até prova. Recibos monotônicos, mídia privada/lacuna visível, sem consumo de revisão inbound, IA ou retry de envio.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: testes PostgreSQL novos concorrentes de echo-before-http, callback repetido/fora de ordem, duas contas e mídia ausente; testes de serviço/rotas novas.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T04-01

**Completar cadastro e vínculo na carteira** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T04-01: Completar cadastro e vínculo na carteira.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-01/17/18/20/21/24/25/26/27/29.
Dependências obrigatórias: WAP-T02a-05, WAP-T02-04.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Completar Novo cliente/Vincular existente e edição compartilhada em Meus clientes com componentes e tokens atuais.

Fronteira editável: apps/edge-web/src/; test/e2e/; test/edge-contact-registration.test.js. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Funciona antes do pareamento; mesmo contactId; aviso compartilhado sem carteira alheia. Restrições por campo, 409 com rascunho preservado e candidato privado sem vazamento. Teclado/foco/ARIA/mobile; abrir/salvar não cria conversa/envio/Pedido.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: node --test test/edge-contact-registration.test.js; E2E novo carteira/cadastro compartilhado em mobile e teclado/axe.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T04-02

**Entregar Meu WhatsApp e onboarding dispensável** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T04-02: Entregar Meu WhatsApp e onboarding dispensável.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-01/02/03/04/11/12.
Dependências obrigatórias: WAP-T02a-05, WAP-T01-04.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Compor Conta→Meu WhatsApp e onboarding em Meus clientes com estados/QR/código/reconexão existentes no contrato.

Fronteira editável: apps/edge-web/src/; test/e2e/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Onboarding fecha sem bloquear CRM; conectado não pede QR novo; comando explícito para desafio. Nunca storage/log/telemetria/captura de QR; fechar/expirar/sessão revogada aborta e remove segredo, resposta atrasada não restaura. Informar código ainda sem homologação real no mesmo celular.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: E2E com desafio sintético: duas abas, expiração, reconexão, erro, fechar e revogar; teclado/mobile/axe sem screenshot de segredo.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T04-03

**Compor primeiro envio individual no servidor** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T04-03: Compor primeiro envio individual no servidor.
Modelo indicado: Sol/Opus. Requisitos: WAP-22/23/24/32.
Dependências obrigatórias: WAP-T02a-05, WAP-T03-02, WAP-T02-04.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Implementar POST /contacts/:contactId/whatsapp/conversations com identidade/conversa/mensagem/outbox/auditoria atômicas.

Fronteira editável: apps/api/src/; modules/contacts/src/; modules/inbox-channels/src/; modules/integration-reliability/src/; schemas/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Revalidar Cliente/vínculo/linha/versões/destino; preservar contactId e negar identidade de outro Contact. Reutilizar conversa ativa; encerrada gera novo atendimento. Sem inbound fictícia/bot; duas abas/replay/eco não duplicam. Offline antes da reserva não cria conversa; timeout após envio fica incerto.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: testes API/serviço e PostgreSQL novos de rollback, concorrência, identidade alheia, resposta posterior e encerrado; regressão do transporte pessoal.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T04-04

**Expor compositor do primeiro envio opcional** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T04-04: Expor compositor do primeiro envio opcional.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-22/23/24/32.
Dependências obrigatórias: WAP-T04-03, WAP-T04-01.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Adicionar Iniciar conversa e Enviar primeira mensagem como ação explícita individual, depois do gate passivo.

Fronteira editável: apps/edge-web/src/; test/e2e/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Cliente/destino/remetente conferidos; composição não envia; restrições/versões e resultado incerto visíveis. Offline preserva cadastro; resposta do cliente segue mesmo contexto; sem lote/prospecção nem dependência para Criar pedido. Preservar foco/rascunho e abortar mudança de contexto.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: E2E novo primeiro envio: salvar/abrir sem efeito, dupla aba, offline, timeout/eco, troca de Cliente e teclado/axe.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T02-09

**Preservar cobrança e preparo pela linha correta** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T02-09: Preservar cobrança e preparo pela linha correta.
Modelo indicado: Sol/Opus. Requisitos: WAP-17/19/27/28/30.
Dependências obrigatórias: WAP-T02-08, WAP-T02-02.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Compor guardas comerciais vigentes com linha/destino/versões nos envios de cobrança e ficha, sem novo fluxo financeiro.

Fronteira editável: apps/api/src/order-billing-chat-runtime.js; apps/api/src/order-billing-runtime.js; modules/order-billing/; modules/integration-reliability/src/; test/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Vínculo comum não concede cobrança alheia; mudanças relevantes invalidam preparo antes de reservar. Disconnect bloqueia só envio; cobrança e callback continuam; replay financeiro registra uma vez, reconexão não emite outra. Sem alterar reserva iniciada, flags ou dinheiro real.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: testes existentes billing/n8n/ficha localizados com rg + testes PostgreSQL novos de duas linhas, preparo obsoleto e pagamento duplicado após disconnect.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T04-05

**Conservar contexto das ações comerciais na carteira** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T04-05: Conservar contexto das ações comerciais na carteira.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-17/19/25/28/30.
Dependências obrigatórias: WAP-T04-01, WAP-T02-09.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Conectar ações comerciais restantes de Meus clientes aos módulos atuais por Cliente/conversa/Assunto/Pedido explícitos.

Fronteira editável: apps/edge-web/src/; test/e2e/. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Sem resetar contexto ao navegar; ficha/arquivos/confirmar/PDF/cobrança respeitam ACL/estado próprios. Queda do canal mantém comandos locais; envio mostra bloqueio real. Contact comum não expõe negócio alheio e resposta tardia não muda Pedido.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: E2E novo contexto carteira→Pedido→cobrança e volta, offline, leitor não autorizado, troca de alvo e teclado/axe.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T05-01

**Consolidar flags, allowlist e limites sem ativação** · **Terra/Sonnet**. Implementação delimitada por contrato e exemplos; decisões estruturais já fechadas no design.

```text
Execute somente WAP-T05-01: Consolidar flags, allowlist e limites sem ativação.
Modelo indicado: Terra/Sonnet. Requisitos: WAP-12/16.
Dependências obrigatórias: WAP-T04-02, WAP-T04-04, WAP-T04-05, WAP-T03-02.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Consolidar os guards/defaults desligados e allowlist já entregues por cada tarefa, além de medir e configurar limites no ambiente sintético; não adiar proteção até esta tarefa.

Fronteira editável: modules/shared/; apps/api/src/; apps/worker/src/; ops/evolution/; ops/n8n/; test/; EASYPANEL-TOPOLOGY.md. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Allowlist vazia/inválida nega efeitos; leitura histórica e ACL sobrevivem desligamento. Ensaio de capacidade define limites numéricos por usuário/serviço sem nova infra; ausência de capacidade limita piloto, sem prometer produção. Não mudar flags reais ou publicar workflow.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: testes de configuração/limites; carga local sintética documentada; npm run validate:topology; npm run test:recovery:mocks.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T05-02

**Auditar regressão funcional, a11y e privacidade** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T05-02: Auditar regressão funcional, a11y e privacidade.
Modelo indicado: Sol/Opus. Requisitos: WAP-01–12/17–33.
Dependências obrigatórias: WAP-T05-01.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Executar verificação independente de toda a etapa 1, incluindo linha geral e todos os pontos de exposição do cadastro/linha.

Fronteira editável: test/; .specs/features/seller-whatsapp/validation-etapa1.md. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Cobrir matriz spec, QR/código sem persistência, campos compartilhados, replay/SSE/ACL negativa, primeira saída e aparelho, mídias, billing e snapshots. Usar banco real sintético para concorrência; não aceitar skip/mock como prova operacional. Findings trazem severidade e evidência; correções funcionais voltam à tarefa dona.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: npm run validate; npm run test:e2e; npm audit --audit-level=high; suítes PostgreSQL e ensaios sintéticos da feature; verificações de privacidade/axe.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T05-03

**Ensaiar rollback e recovery sem reativar efeitos** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T05-03: Ensaiar rollback e recovery sem reativar efeitos.
Modelo indicado: Sol/Opus. Requisitos: WAP-10/11/12/16/29/33.
Dependências obrigatórias: WAP-T05-02.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Executar drill local isolado de desligamento, implantação em fases e restore com linha/geração/vínculos/efeitos incertos.

Fronteira editável: test/; ops/; docs/runbooks/seller-whatsapp-recovery.md. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Preservar carteira, ACL, ledger e snapshots; restore bloqueia novos envios até reconciliação. Código antigo que ignora alvos não é rollback permitido após múltiplos; indicar SHA compatível testado. Nenhum QR restaurado ou acesso revogado reativado; não usar restore remoto como ensaio local.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: npm run validate:topology; npm run test:recovery:mocks; drill sintético específico com estado antes/depois e efeitos externos simulados.
Além dos testes focalizados, execute os gates exigidos em CONTRIBUTING: npm run validate, npm run test:e2e e npm audit --audit-level=high, com Node/npm do projeto. Para migração/concorrência use PostgreSQL dedicado e sintético com env de teste; registre a invocação e não aceite skip. UI exige teclado/foco/ARIA/mobile e axe. Não enfraqueça assertions, não amplie o patch para corrigir falha alheia; reporte o bloqueio com evidência.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T05-04

**Consolidar roteiro operacional e evidências** · **Luna/Haiku**. Consolidação mecânica de evidências aprovadas, sem decidir contrato ou corrigir runtime.

```text
Execute somente WAP-T05-04: Consolidar roteiro operacional e evidências.
Modelo indicado: Luna/Haiku. Requisitos: WAP-12/16; WAP-T05.
Dependências obrigatórias: WAP-T05-03.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Consolidar os relatórios existentes em checklist de publicação/piloto e mapa de versões, sem decidir ou operar runtime.

Fronteira editável: docs/runbooks/seller-whatsapp.md; .specs/features/seller-whatsapp/validation-etapa1.md; .specs/features/seller-whatsapp/tasks.md. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Registrar commits/checks reais, limites medidos, ordem API/migração→workflows→flags e rollback testado; distinguir local/live/pendente. Não inventar evidências nem marcar homologação real; lacuna técnica encaminhada ao responsável, sem mudar contrato.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: Prettier dos Markdown alterados; links locais; consistência de IDs/status e git diff --check.
Gate documental: Prettier somente nos Markdown alterados, referências locais e git diff --check. Não rode suítes de runtime para texto puro.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T05-05

**Homologar fluxo passivo real de Pedido** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T05-05: Homologar fluxo passivo real de Pedido.
Modelo indicado: Sol/Opus. Requisitos: WAP-04/05/07/17/31/32/33.
Dependências obrigatórias: WAP-T05-04.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Preparar e, havendo autorização operacional explícita vigente, executar piloto com dois vendedores, uma linha por vendedor e cliente sintético.

Fronteira editável: docs/runbooks/seller-whatsapp.md; .specs/features/seller-whatsapp/validation-piloto.md; configuração operacional somente no escopo autorizado. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Confirmar SHA/digest/health/migration e publicação compatíveis antes de ativar escopo mínimo autorizado. Cliente procura→titular humano→Pedido no alvo→ficha; repetir após desconexão, replay e tentativa alheia. Não enviar a clientes reais. Falha congela avanço e preserva ledger; nenhuma homologação por QR isolado.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: gates CI/ambiente alvo do runbook; fluxo real e ACL negativa com metadados sem PII; evidência separada da prova sintética.
Prepare integralmente o roteiro e evidências de prontidão antes de qualquer efeito real. Confirme autorização operacional aplicável já registrada; não peça de novo se ela cobre exatamente a ação. Sem ela, não pareie/publique/envie nem gere efeito financeiro: entregue o roteiro concreto e solicite somente a autorização que falta, explicando sua origem em AGENTS/ADR090. A tarefa permanece pendente até o aceite real; timeout não autoriza repetir efeito.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T05-06

**Homologar pareamento mobile e sincronização reais** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T05-06: Homologar pareamento mobile e sincronização reais.
Modelo indicado: Sol/Opus. Requisitos: WAP-01/02/03/04/09/10/11/12.
Dependências obrigatórias: WAP-T05-05.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Preparar e, autorizado, provar QR em outra tela, código no mesmo celular, reconnect e tráfego CRM/aparelho nas duas linhas do piloto.

Fronteira editável: docs/runbooks/seller-whatsapp.md; .specs/features/seller-whatsapp/validation-piloto.md; configuração operacional somente no escopo autorizado. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Não substituir código mobile por QR. Número errado/duplicado, expiração, logout/callback velho, mídia/recibos/echo-before-http/outage e privacidade de persistência com evidência minimizada. Sem segredo em captura/relatório; limitação explícita impede declarar autonomia mobile.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: roteiro live aprovado e inspeções de privacidade do runbook; reconciliar resultados incertos sem repetir efeito.
Prepare integralmente o roteiro e evidências de prontidão antes de qualquer efeito real. Confirme autorização operacional aplicável já registrada; não peça de novo se ela cobre exatamente a ação. Sem ela, não pareie/publique/envie nem gere efeito financeiro: entregue o roteiro concreto e solicite somente a autorização que falta, explicando sua origem em AGENTS/ADR090. A tarefa permanece pendente até o aceite real; timeout não autoriza repetir efeito.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

## WAP-T05-07

**Homologar ações comerciais e primeiro envio do piloto** · **Sol/Opus**. Risco de autorização, concorrência, efeito externo ou verificação integrada; exige raciocínio entre fronteiras.

```text
Execute somente WAP-T05-07: Homologar ações comerciais e primeiro envio do piloto.
Modelo indicado: Sol/Opus. Requisitos: WAP-17–30/32.
Dependências obrigatórias: WAP-T05-06.

Leia AGENTS.md (inclusive RTK), ABOUT.md, RULES.md e ARCHITECTURE.md. Consulte graphify-out somente se disponível como mapa; confirme na fonte com rg. Nunca gere o grafo. Leia .specs/features/seller-whatsapp/spec.md, design.md, tasks.md e ADRs 090/091; carregue apenas as seções técnicas relevantes. Preserve decisões aprovadas e mudanças de terceiros.

Antes de editar, confirme dependências integradas e checkout exclusivo/limpo. Parta de origin/master atualizada em branch curta codex/<tarefa>. Não troque branch com trabalho alheio, não use stash como entrega, não faça push direto à master. Se o checkout estiver ocupado, use somente worktree temporário conforme AGENTS, removendo-o no handoff; não crie pasta irmã permanente ou junction de node_modules. Reaproveite alterações já integradas, inclusive o botão Criar pedido de d7537b3c.

Objetivo: Preparar e, autorizado, provar cadastro/vínculo/edição compartilhada, primeira saída individual e ações comerciais nas duas carteiras.

Fronteira editável: docs/runbooks/seller-whatsapp.md; .specs/features/seller-whatsapp/validation-piloto.md; configuração operacional somente no escopo autorizado. Inclua somente testes, contrato e runbook da própria fronteira. Se a fonte atual exigir arquivo adicional, justifique a relação antes do patch; não tome posse de arquivo de outra sessão.

Aceite obrigatório: Mesmo Contact/histórias privadas; conflito por campo; snapshots; primeiro envio sem inbound e resposta correta. Cobrança/recebimento somente sintéticos ou sandbox explicitamente autorizado, offline após envio e callback repetido sem nova emissão. Final só aceita etapa 1 com todos os gates reais aplicáveis; nenhum efeito financeiro real implícito.

Cada endpoint/entrada/despacho introduzido já entrega guard de configuração fail-closed, default desligado e allowlist privada aplicável, com testes de ausência/valor inválido/usuário não habilitado; não adiar a trava até T05-01. ACL e histórico persistem com flag off. Preserve Contact oficial, ACL comercial, linha geral, snapshots e retenção vigentes. Não introduza framework/store/Redis/serviço novo. n8n continua obrigatório; browser não recebe chave de gateway. Não publicar workflow, parear número real, ativar flags reais, enviar mensagem a clientes ou produzir efeito financeiro sem autorização específica aplicável.

Verificação focalizada: roteiro comercial/sandbox aprovado; evidências de ACL/IDs/versões e recebimento único sem PII; checklist final sem marcar etapa 2.
Prepare integralmente o roteiro e evidências de prontidão antes de qualquer efeito real. Confirme autorização operacional aplicável já registrada; não peça de novo se ela cobre exatamente a ação. Sem ela, não pareie/publique/envie nem gere efeito financeiro: entregue o roteiro concreto e solicite somente a autorização que falta, explicando sua origem em AGENTS/ADR090. A tarefa permanece pendente até o aceite real; timeout não autoriza repetir efeito.

Atualize contrato/runbook e status apenas com evidência da sua tarefa. Rode git diff --check e registre comandos/resultados, incluindo skips e limitações; não declare PASS por mock em concorrência real nem por teste local em produção. Conclua com uma entrega atômica, um commit Conventional Commits com o ID, um push e um PR para master, sem merge automático. Não inclua grafo ou dados pessoais. Retorne: requisito/tarefa, arquivos, evidências, SHA/link do PR, risco/rollback e pendências. Não execute tarefa seguinte.
```

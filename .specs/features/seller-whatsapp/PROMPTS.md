# Execução enxuta — WhatsApp por vendedor, etapa 1

Revisão WAP-T00e, 16/11/2026. [Design](design.md), [tarefas e rastreabilidade](tasks.md),
[spec aprovada](spec.md), [ADR 091](../../../docs/adr/091-contratos-da-etapa1-whatsapp-pessoal.md).

**Execute 12 prompts, em ordem.** O fluxo prioritário fica pronto para aceite
em **WAP-E07**, após seis entregas de implementação/investigação. Os demais
cinco prompts completam mensagens, interface, primeiro envio e operação da
etapa 1. Importação histórica e sucessão continuam na etapa 2.

Os 32 itens T do plano inicial passam a ser passos internos rastreáveis, sem
exigir 32 sessões, PRs ou repetições dos gates. A unidade de execução/publicação
é E01–E12: uma fronteira coerente por prompt. Dentro dela, faça os passos na
ordem indicada, reuse contexto e rode cada verificação apenas quando necessária.
Nada do código ou dos testes de aceite foi retirado. As estimativas de tamanho
são relativas: uma entrega de backend com vários invariantes pede mais cuidado
que uma alteração visual delimitada; 12 prompts não significam 12 turnos curtos.

## Modelos e ordem

| Prompt              | Entrega                                                    | Executor     | Resultado                              |
| ------------------- | ---------------------------------------------------------- | ------------ | -------------------------------------- |
| [WAP-E01](#wap-e01) | Provar viabilidade do provedor e privacidade               | Sol/Opus     | Fundamento do fluxo passivo            |
| [WAP-E02](#wap-e02) | Entregar conexão pessoal no backend e n8n                  | Sol/Opus     | Fundamento do fluxo passivo            |
| [WAP-E03](#wap-e03) | Entregar carteira e cadastro compartilhado no servidor     | Sol/Opus     | Fundamento do fluxo passivo            |
| [WAP-E04](#wap-e04) | Receber atendimento humano com isolamento ponta a ponta    | Sol/Opus     | Fundamento do fluxo passivo            |
| [WAP-E05](#wap-e05) | Criar Pedido por Assunto com compatibilidade transacional  | Sol/Opus     | Fundamento do fluxo passivo            |
| [WAP-E06](#wap-e06) | Entregar a interface mínima de Pedido pela conversa        | Terra/Sonnet | Fundamento do fluxo passivo            |
| [WAP-E07](#wap-e07) | Aceitar o fluxo passivo integrado de Pedido                | Sol/Opus     | Gate prioritário: Pedido pela conversa |
| [WAP-E08](#wap-e08) | Completar mensagens correntes e efeitos pela linha correta | Sol/Opus     | Complemento da etapa 1                 |
| [WAP-E09](#wap-e09) | Completar Meus clientes e Meu WhatsApp na interface        | Terra/Sonnet | Complemento da etapa 1                 |
| [WAP-E10](#wap-e10) | Entregar primeiro envio humano individual                  | Sol/Opus     | Complemento da etapa 1                 |
| [WAP-E11](#wap-e11) | Concluir verificação e prontidão operacional               | Sol/Opus     | Complemento da etapa 1                 |
| [WAP-E12](#wap-e12) | Homologar o piloto real da etapa 1                         | Sol/Opus     | Aceite real da etapa 1                 |

São **10 prompts Sol/Opus e 2 Terra/Sonnet**. Luna/Haiku pode auxiliar na
formatação ou consolidação de evidências já verificadas, dentro de E11; essa
atividade não exige outra tarefa nem decide contrato/aceite. Os pares indicam
alternativas de executor, sem alegar equivalência de benchmark ou custo.

Copie somente a caixa do prompt escolhido. Cada caixa tem contexto, fronteira,
passos, aceite e verificação. Não execute as caixas antigas do plano de 32.
Ao retomar trabalho parcialmente feito, confira o mapa em tasks.md e execute
apenas o que falta, sem refazer uma entrega comprovadamente concluída.

## WAP-E01

**Provar viabilidade do provedor e privacidade — Sol/Opus**

```text
Execute WAP-E01: Provar viabilidade do provedor e privacidade.
Executor: Sol/Opus. Depende de: PR 382 e SDD técnico integrados; nenhuma implementação anterior.
Checklist coberto: WAP-T01-01. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E01; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: ops/evolution/; ops/n8n/; test/n8n-evolution-workflow.test.js; docs/runbooks/seller-whatsapp-provider.md. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T01-01: Inspecionar a fonte/imagem fixada e produzir ensaio local isolado com instâncias sintéticas para create/connect/status/logout e entrega efêmera QR/código.
   Aceite: Registrar contratos reais, eventos/identidade e limites; provar ausência de segredo em n8n inclusive erro/manual/em progresso/pinData/log/backups aplicáveis. Não declarar código no mesmo celular homologado sem prova real. Limitação material bloqueia habilitação, com alternativa revisável. Provar origem autenticada da geração no ingresso e invalidação após reconnect, não rotular evento antigo pela geração atual.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- node --test test/n8n-evolution-workflow.test.js; ensaio local específico descrito no relatório.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E01 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E02

**Entregar conexão pessoal no backend e n8n — Sol/Opus**

```text
Execute WAP-E02: Entregar conexão pessoal no backend e n8n.
Executor: Sol/Opus. Depende de: WAP-E01.
Checklist coberto: WAP-T01-02, WAP-T01-03, WAP-T01-04. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E02; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: modules/database/; modules/inbox-channels/src/; test/; apps/api/src/; modules/identity-access/src/; apps/worker/src/; schemas/; ops/n8n/; ops/evolution/; modules/integration-reliability/src/. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T01-02: Criar migração expand e repositório para linha/conta técnica/geração e operações de controle, sem habilitar workflows.
   Aceite: Unicidade vendedor/número inclusive desconectado, conflito com linha geral, CAS e geração; número cifrado/digest, instância opaca; ledger só metadados, nunca QR/código. Duas transações não reservam o mesmo número.
2. WAP-T01-03: Implementar API humana de estado/connect/disconnect e contrato técnico de operação/resultado sobre ledger, inicialmente desabilitados.
   Aceite: Derivar titular/instância/URL no servidor; sessão/CSRF/origem/capacidade/versão/idempotência/rate limit. GET sem efeito; timeout fica incerto e consulta antes de retry; callbacks antigos não restauram geração; Admin não recebe QR alheio. QR/código fora de persistência e replay.
3. WAP-T01-04: Implementar adapter de controle parametrizado por linha e desafio API→n8n→Evolution conforme prova do spike, sem publicar workflow real.
   Aceite: Intenção durável só com metadados; desafio efêmero correlacionado a operação/geração/TTL, no-store sem logs/persistência n8n. Confirmar número/webhook antes de ativo; não apagar instância após timeout ou usar revisão inbound. Reconciliar por leitura. Contrato técnico Basic/correlação vigente. Replay de desafio não regenera bytes/efeito; renovação explícita versionada só após resolver incerteza. Vincular ingresso à geração de forma imutável.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- npm run test:database; testes PostgreSQL novos de constraints, upgrade e corrida.
- testes novos de rotas/serviço/worker; testes PostgreSQL de duas abas, callback antigo, inativação e resultado incerto.
- node --test test/n8n-evolution-workflow.test.js test/n8n-command-worker.test.js; ensaio sintético do desafio e inspeção de persistência conforme T01-01.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E02 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E03

**Entregar carteira e cadastro compartilhado no servidor — Sol/Opus**

```text
Execute WAP-E03: Entregar carteira e cadastro compartilhado no servidor.
Executor: Sol/Opus. Depende de: WAP-E02.
Checklist coberto: WAP-T02-01, WAP-T02-02, WAP-T02-03, WAP-T02-04. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E03; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: modules/database/; modules/contacts/src/; test/; apps/api/src/operation-runtime.js; apps/api/src/operation-routes.js; modules/contacts/src/adapters/postgres-contact-read-repository.js; schemas/. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T02-01: Criar associação versionada vendedor/Contact com proveniência, estado, auditoria e unicidade por par.
   Aceite: Cadastro e vínculo independem da linha; revogar/reativar não duplica o par. Operações de vínculo serializam no Contact para proteger compartilhamento concorrente. Nenhum backfill global ou inferido pelo criador/telefone.
2. WAP-T02-02: Aplicar a política compartilhada em todos os caminhos cadastrais existentes, com lock de Contact e revalidação atual.
   Aceite: Comuns e fiscal vazio permitidos; CPF/CNPJ/tipo preenchidos só Admin com motivo/conferência; telefone compartilhado só Admin conferido; campo restrito igual não bloqueia outro campo. Conflito 409 preserva rascunho; snapshots e preparações afetadas protegidos, sem valores pessoais em evento/auditoria em claro.
3. WAP-T02-03: Implementar leitura de Meus clientes e isolamento dos dados pessoais de linha em Clientes geral, detalhes, identidades e contagens.
   Aceite: Escopo antes de busca/cursor/count; Contact compartilhado não revela identidade/histórico alheios; IDs diretos/candidatos privados negados sem vazamento. Preservar universo legado autorizado; carteira não exige conexão. Cursor identifica escopo/versão e não cruza leitores.
4. WAP-T02-04: Implementar POST /me/clients e POST /me/clients/:contactId/link reutilizando serviços oficiais em uma transação.
   Aceite: Mesmo contactId para existente selecionado e autorizado; novo Contact+vínculo atômicos; replay reautoriza e não duplica; colisão privada não cria cópia nem revela candidato. Não criar identidade/conversa/Pedido/envio. Rollout reconcilia só proveniência comercial comprovada, com dry-run sem PII.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- npm run test:database; testes PostgreSQL novos de vínculo e concorrência com edição.
- node --test test/contact-registration.test.js test/contact-registration-api.test.js test/contact-details.test.js; testes PostgreSQL novos de CAS, revogação e segundo vínculo concorrente.
- node --test test/conversation-visibility.test.js test/conversation-acl-frontiers.test.js; testes de leitura PostgreSQL novos e negativos de paginação/contagem.
- node --test test/contact-identity.test.js test/contact-details.test.js; testes API/PostgreSQL novos de cadastro/vínculo/rollback/concorrência.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E03 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E04

**Receber atendimento humano com isolamento ponta a ponta — Sol/Opus**

```text
Execute WAP-E04: Receber atendimento humano com isolamento ponta a ponta.
Executor: Sol/Opus. Depende de: WAP-E03.
Checklist coberto: WAP-T02-05, WAP-T02-06, WAP-T02-07. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E04; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: ops/n8n/workflows/create-evolution-workflow.mjs; modules/n8n-integration/src/; modules/contacts/src/; modules/inbox-channels/src/; schemas/; test/; apps/api/src/conversation-routes.js; apps/api/src/conversation-runtime.js; apps/api/src/operation-runtime.js; apps/api/src/operation-routes.js; apps/api/src/live-event-dispatcher.js; apps/edge-web/src/. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T02-05: Resolver conta/linha/geração autenticadas no inbound e persistir Cliente/vínculo/conversa humana atribuída ao titular.
   Aceite: Sem janela sem dono, chamada IA, resposta automática ou Pedido. Titular inativo põe evento em pendência privada administrativa; conta geral preservada. Mesmo Cliente em duas linhas mantém histórias separadas; evento antigo/repetido não muda titular nem duplica. Testar inbound/callback antigo após reconnect sem relabelar geração.
2. WAP-T02-06: Aplicar predicado comum de linha/posse a Inbox, detalhes, mídia, Assuntos, contexto e comandos genéricos de posse/transferência.
   Aceite: Linha pessoal sem dono não vira pública; transferência genérica para outro vendedor negada; Admin e ACL comercial preservados sem conceder chat pelo Pedido. Escopo antes de count/paginação e joins; revalidar mutações e replay. Testar cada rota pública alcançada pelo predicado.
3. WAP-T02-07: Aplicar escopo atual no SSE/replay e invalidação das projeções abertas após perda de vínculo/posse/linha.
   Aceite: Sessão/capacidade revalidadas; eventos mínimos sem conteúdo alheio, QR ou valores cadastrais; cursor antigo não atravessa escopo. UI aborta requisições e remove conteúdo privado; resposta atrasada não restaura. Conflito cadastral avisa sem revelar outra carteira.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- node --test test/n8n-evolution-workflow.test.js test/contact-identity.test.js; testes PostgreSQL novos de inbound concorrente, rollback e inativo.
- node --test test/conversation-visibility.test.js test/conversation-acl-frontiers.test.js test/conversation-routes.test.js; testes PostgreSQL/E2E negativos de mídia/Assuntos/contexto.
- node --test test/conversation-acl-frontiers.test.js; E2E novo de duas sessões, revogação e resposta tardia; axe nas superfícies alteradas.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E04 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E05

**Criar Pedido por Assunto com compatibilidade transacional — Sol/Opus**

```text
Execute WAP-E05: Criar Pedido por Assunto com compatibilidade transacional.
Executor: Sol/Opus. Depende de: WAP-E04.
Checklist coberto: WAP-T02a-01, WAP-T02a-02, WAP-T02a-03. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E05; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: modules/database/; modules/orders/src/; test/; modules/inbox-channels/src/application/subject-service.js; modules/inbox-channels/src/adapters/postgres-order-assistance.js; apps/api/src/order-runtime.js; apps/api/src/order-routes.js; modules/inbox-channels/src/; schemas/. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T02a-01: Adicionar origin_subject_id nullable com FK composta à conversa e índice por alvo, preservando conversation_id e o índice global antigo nesta entrega preparatória.
   Aceite: Migração expand sem backfill ambíguo; prova de integridade Contact/conversa/Assunto e compatibilidade de histórico. Não criar caminho manual sem conversa. Testar upgrade, órfão e FK de Assunto em conversa diferente; nenhum escritor novo habilitado. Reutilizar UNIQUE de Assunto existente em 0037; backfill só de pendente ativo com vínculo único comprovado, nunca cancelados imutáveis ou demais históricos.
2. WAP-T02a-02: Preparar leitores/ports e resolver alvo explícito, legado inequívoco e múltiplos Assuntos com origem persistida.
   Aceite: findPendingByConversation não retorna primeiro candidato em ambiguidade. Preservar ACL, firstContactAt, briefing por alvo, listagens, projeção automática, snapshots e reabertura/cancelamento. Documentar rollout: binário antigo não é rollback seguro após múltiplos alvos. Ainda sem habilitar criação por alvo.
3. WAP-T02a-03: Estender o POST existente com subjectId/expectedSubjectVersion opcionais em par e compor Pedido/vínculo/numeração/recibo/auditoria atomicamente.
   Aceite: Novo Assunto explícito permite novo Pedido; existente abre sem duplicar; omissão só no legado inequívoco. Substituir índice global pelo parcial legado + unicidade por alvo apenas com leitores compatíveis e flag desligada. Revalidar humano, linha/posse, Contact, conversa aberta e versões sob lock. Duas chaves concorrentes vencem uma vez; nenhuma IA/cobrança/envio ou dependência de canal online/cadastro completo.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Nesta mesma entrega, faça schema aditivo → leitores compatíveis → escritor por alvo, nessa ordem. Mantenha o índice legado até instalar o substituto; flags ficam desligadas e só permita múltiplos alvos com todos os consumidores compatíveis. Prove migração de versão anterior, rollback compatível e ausência de ambiguidade. Não dividir a entrega em PRs incompletas nem criar Pedido sem conversation_id para vincular depois.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- npm run test:database; testes PostgreSQL novos de migração/FK/index/compatibilidade.
- node --test test/order-conversation-port.test.js test/order-assistance.test.js test/order-routes.test.js; testes PostgreSQL novos de pedidos legados e múltiplos alvos.
- node --test test/order-routes.test.js test/order-conversation-port.test.js test/order-assistance.test.js; testes PostgreSQL reais de duas chaves, CAS, encerramento/revogação, Assunto cruzado e rollback transacional.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E05 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E06

**Entregar a interface mínima de Pedido pela conversa — Terra/Sonnet**

```text
Execute WAP-E06: Entregar a interface mínima de Pedido pela conversa.
Executor: Terra/Sonnet. Depende de: WAP-E05.
Checklist coberto: WAP-T02a-04. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E06; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: apps/edge-web/src/; test/e2e/; test/order-assistance-ui.test.js. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T02a-04: Compor entrada mínima Meus clientes→conversa humana e Criar/abrir Pedido usando rotas e componentes atuais.
   Aceite: Preservar correção master d7537b3c do botão no cabeçalho; confirmar criação captura IDs/versões/alvo. Troca de contexto/inativo cancela; resposta velha não navega; rascunho preservado, foco/teclado/ARIA previsíveis. Pendente numerado abre ficha sem cadastro completo, IA, primeiro envio ou canal online.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- node --test test/order-assistance-ui.test.js; npx playwright test test/e2e/order-assistance.spec.js; E2E novo de Meus clientes/passivo com axe.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E06 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E07

**Aceitar o fluxo passivo integrado de Pedido — Sol/Opus**

```text
Execute WAP-E07: Aceitar o fluxo passivo integrado de Pedido.
Executor: Sol/Opus. Depende de: WAP-E06.
Checklist coberto: WAP-T02a-05. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E07; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: test/; .specs/features/seller-whatsapp/validation-pedido.md; docs/runbooks/. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T02a-05: Executar revisão independente e ensaio integrado API/PostgreSQL/navegador do fluxo passivo, antes de expandir primeira saída.
   Aceite: Dois vendedores/mesmo Contact, novo alvo e pendente existente, offline posterior, acesso cruzado, replay/duplo clique, troca de conversa, encerramento, inativação e concorrência. Verificar todos os IDs/responsável/número/ficha e ausência de efeitos externos. Falhas viram findings; não marcar PASS com mocks como prova de banco ou transporte.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Gate obrigatório: cliente procura → conversa humana atribuída → confirmar criação → Pedido pendente numerado no Cliente/conversa/Assunto/responsável corretos → ficha editável. Repetir após queda do canal. Nenhuma dependência de IA, sugestão, cadastro completo, primeira saída ou importação. Testar dois vendedores/mesmo Contact, alvo novo/existente, replay, concorrência, revogação e troca de contexto.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- npm run test:orders:live com banco sintético; suítes novas do alvo; E2E de fluxo passivo/teclado/axe; npm run validate; npm run test:e2e; npm audit --audit-level=high.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E07 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E08

**Completar mensagens correntes e efeitos pela linha correta — Sol/Opus**

```text
Execute WAP-E08: Completar mensagens correntes e efeitos pela linha correta.
Executor: Sol/Opus. Depende de: WAP-E07.
Checklist coberto: WAP-T02-08, WAP-T03-01, WAP-T03-02, WAP-T02-09. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E08; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: modules/integration-reliability/src/; modules/n8n-integration/src/; modules/inbox-channels/src/; apps/worker/src/; ops/n8n/; test/; ops/n8n/workflows/create-evolution-workflow.mjs; schemas/fixtures/external/n8n/; apps/api/src/; apps/api/src/order-billing-chat-runtime.js; apps/api/src/order-billing-runtime.js; modules/order-billing/. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T02-08: Acrescentar origem da linha e geração aos envios existentes e revalidar em reserva/despacho/resultado sem transporte paralelo.
   Aceite: Conta original obrigatória; disconnect/inativo/flag bloqueiam efeito não iniciado; iniciado/incerto permanece auditado e não é reenviado. Nenhum fallback à linha geral nem troca de destinatário. Mesma regra para texto/mídia e origem comercial; bot pessoal negado.
2. WAP-T03-01: Adicionar envelope versionado de fato message.external.sent para fromMe verdadeiro, distinto do comando de envio.
   Aceite: Validar instância/conta/geração, ID/timestamp/origem e tipos de mídia existentes. Sem IA, nova inbound, envio ou Pedido. Fixtures sintéticas do contrato fixado; não chamar externa qualquer saída parecida nem afirmar operador físico.
3. WAP-T03-02: Consumir fato externo e reconciliar registro de mensagem por conta/ID com o envio CRM já reservado.
   Aceite: HTTP→eco e eco→HTTP geram uma mensagem; ID igual em contas diferentes não colide. Não correlacionar por texto/hora; desconhecido fica externo/incerto até prova. Recibos monotônicos, mídia privada/lacuna visível, sem consumo de revisão inbound, IA ou retry de envio.
4. WAP-T02-09: Compor guardas comerciais vigentes com linha/destino/versões nos envios de cobrança e ficha, sem novo fluxo financeiro.
   Aceite: Vínculo comum não concede cobrança alheia; mudanças relevantes invalidam preparo antes de reservar. Disconnect bloqueia só envio; cobrança e callback continuam; replay financeiro registra uma vez, reconexão não emite outra. Sem alterar reserva iniciada, flags ou dinheiro real.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- node --test test/n8n-command-store.test.js test/n8n-command-worker.test.js test/n8n-evolution-workflow.test.js; testes PostgreSQL novos de reserva vs disconnect/revogação.
- node --test test/n8n-evolution-workflow.test.js; testes novos de contrato externo/negativos; npm run validate:external-spikes; npm run test:external-spikes.
- testes PostgreSQL novos concorrentes de echo-before-http, callback repetido/fora de ordem, duas contas e mídia ausente; testes de serviço/rotas novas.
- testes existentes billing/n8n/ficha localizados com rg + testes PostgreSQL novos de duas linhas, preparo obsoleto e pagamento duplicado após disconnect.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E08 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E09

**Completar Meus clientes e Meu WhatsApp na interface — Terra/Sonnet**

```text
Execute WAP-E09: Completar Meus clientes e Meu WhatsApp na interface.
Executor: Terra/Sonnet. Depende de: WAP-E08.
Checklist coberto: WAP-T04-01, WAP-T04-02, WAP-T04-05. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E09; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: apps/edge-web/src/; test/e2e/; test/edge-contact-registration.test.js. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T04-01: Completar Novo cliente/Vincular existente e edição compartilhada em Meus clientes com componentes e tokens atuais.
   Aceite: Funciona antes do pareamento; mesmo contactId; aviso compartilhado sem carteira alheia. Restrições por campo, 409 com rascunho preservado e candidato privado sem vazamento. Teclado/foco/ARIA/mobile; abrir/salvar não cria conversa/envio/Pedido.
2. WAP-T04-02: Compor Conta→Meu WhatsApp e onboarding em Meus clientes com estados/QR/código/reconexão existentes no contrato.
   Aceite: Onboarding fecha sem bloquear CRM; conectado não pede QR novo; comando explícito para desafio. Nunca storage/log/telemetria/captura de QR; fechar/expirar/sessão revogada aborta e remove segredo, resposta atrasada não restaura. Informar código ainda sem homologação real no mesmo celular.
3. WAP-T04-05: Conectar ações comerciais restantes de Meus clientes aos módulos atuais por Cliente/conversa/Assunto/Pedido explícitos.
   Aceite: Sem resetar contexto ao navegar; ficha/arquivos/confirmar/PDF/cobrança respeitam ACL/estado próprios. Queda do canal mantém comandos locais; envio mostra bloqueio real. Contact comum não expõe negócio alheio e resposta tardia não muda Pedido.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- node --test test/edge-contact-registration.test.js; E2E novo carteira/cadastro compartilhado em mobile e teclado/axe.
- E2E com desafio sintético: duas abas, expiração, reconexão, erro, fechar e revogar; teclado/mobile/axe sem screenshot de segredo.
- E2E novo contexto carteira→Pedido→cobrança e volta, offline, leitor não autorizado, troca de alvo e teclado/axe.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E09 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E10

**Entregar primeiro envio humano individual — Sol/Opus**

```text
Execute WAP-E10: Entregar primeiro envio humano individual.
Executor: Sol/Opus. Depende de: WAP-E09.
Checklist coberto: WAP-T04-03, WAP-T04-04. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E10; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: apps/api/src/; modules/contacts/src/; modules/inbox-channels/src/; modules/integration-reliability/src/; schemas/; test/; apps/edge-web/src/; test/e2e/. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T04-03: Implementar POST /contacts/:contactId/whatsapp/conversations com identidade/conversa/mensagem/outbox/auditoria atômicas.
   Aceite: Revalidar Cliente/vínculo/linha/versões/destino; preservar contactId e negar identidade de outro Contact. Reutilizar conversa ativa; encerrada gera novo atendimento. Sem inbound fictícia/bot; duas abas/replay/eco não duplicam. Offline antes da reserva não cria conversa; timeout após envio fica incerto.
2. WAP-T04-04: Adicionar Iniciar conversa e Enviar primeira mensagem como ação explícita individual, depois do gate passivo.
   Aceite: Cliente/destino/remetente conferidos; composição não envia; restrições/versões e resultado incerto visíveis. Offline preserva cadastro; resposta do cliente segue mesmo contexto; sem lote/prospecção nem dependência para Criar pedido. Preservar foco/rascunho e abortar mudança de contexto.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- testes API/serviço e PostgreSQL novos de rollback, concorrência, identidade alheia, resposta posterior e encerrado; regressão do transporte pessoal.
- E2E novo primeiro envio: salvar/abrir sem efeito, dupla aba, offline, timeout/eco, troca de Cliente e teclado/axe.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E10 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E11

**Concluir verificação e prontidão operacional — Sol/Opus**

```text
Execute WAP-E11: Concluir verificação e prontidão operacional.
Executor: Sol/Opus. Depende de: WAP-E10.
Checklist coberto: WAP-T05-01, WAP-T05-02, WAP-T05-03, WAP-T05-04. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E11; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: modules/shared/; apps/api/src/; apps/worker/src/; ops/evolution/; ops/n8n/; test/; EASYPANEL-TOPOLOGY.md; .specs/features/seller-whatsapp/validation-etapa1.md; ops/; docs/runbooks/seller-whatsapp-recovery.md; docs/runbooks/seller-whatsapp.md; .specs/features/seller-whatsapp/tasks.md. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T05-01: Consolidar os guards/defaults desligados e allowlist já entregues por cada tarefa, além de medir e configurar limites no ambiente sintético; não adiar proteção até esta tarefa.
   Aceite: Allowlist vazia/inválida nega efeitos; leitura histórica e ACL sobrevivem desligamento. Ensaio de capacidade define limites numéricos por usuário/serviço sem nova infra; ausência de capacidade limita piloto, sem prometer produção. Não mudar flags reais ou publicar workflow.
2. WAP-T05-02: Executar verificação independente de toda a etapa 1, incluindo linha geral e todos os pontos de exposição do cadastro/linha.
   Aceite: Cobrir matriz spec, QR/código sem persistência, campos compartilhados, replay/SSE/ACL negativa, primeira saída e aparelho, mídias, billing e snapshots. Usar banco real sintético para concorrência; não aceitar skip/mock como prova operacional. Findings trazem severidade e evidência; correções funcionais voltam à tarefa dona.
3. WAP-T05-03: Executar drill local isolado de desligamento, implantação em fases e restore com linha/geração/vínculos/efeitos incertos.
   Aceite: Preservar carteira, ACL, ledger e snapshots; restore bloqueia novos envios até reconciliação. Código antigo que ignora alvos não é rollback permitido após múltiplos; indicar SHA compatível testado. Nenhum QR restaurado ou acesso revogado reativado; não usar restore remoto como ensaio local.
4. WAP-T05-04: Consolidar os relatórios existentes em checklist de publicação/piloto e mapa de versões, sem decidir ou operar runtime.
   Aceite: Registrar commits/checks reais, limites medidos, ordem API/migração→workflows→flags e rollback testado; distinguir local/live/pendente. Não inventar evidências nem marcar homologação real; lacuna técnica encaminhada ao responsável, sem mudar contrato.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

E11 consolida proteção já entregue; não é a primeira implementação de flags. Execute a verificação independente e o drill isolado. Correção funcional necessária volta à fronteira dona e seus testes; não misture mudança de contrato na consolidação do runbook. Luna/Haiku pode organizar evidências aprovadas; Sol/Opus decide findings e aceite.

Sem publicação, pareamento, flags de ambiente real, mensagem a clientes ou efeito financeiro real; usar ambiente dedicado e dados sintéticos. A prova local não homologa o provedor ou produção.

Verificações focalizadas (consolide duplicadas):
- testes de configuração/limites; carga local sintética documentada; npm run validate:topology; npm run test:recovery:mocks.
- npm run validate; npm run test:e2e; npm audit --audit-level=high; suítes PostgreSQL e ensaios sintéticos da feature; verificações de privacidade/axe.
- npm run validate:topology; npm run test:recovery:mocks; drill sintético específico com estado antes/depois e efeitos externos simulados.
- Prettier dos Markdown alterados; links locais; consistência de IDs/status e git diff --check.

Rode testes focalizados durante o patch. Antes da publicação, execute uma vez os gates aplicáveis de CONTRIBUTING (validate, E2E e audit em runtime); não repita o gate completo a cada item interno sem mudança ou falha que justifique. Concorrência/migração exigem PostgreSQL sintético real e sem skip; UI exige teclado/foco/ARIA/mobile/axe. Para mudança só textual, bastam formatação, referências e diff. Registre bloqueios sem enfraquecer assertions.

Atualize os itens T cobertos e WAP-E11 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

## WAP-E12

**Homologar o piloto real da etapa 1 — Sol/Opus**

```text
Execute WAP-E12: Homologar o piloto real da etapa 1.
Executor: Sol/Opus. Depende de: WAP-E11.
Checklist coberto: WAP-T05-05, WAP-T05-06, WAP-T05-07. Este prompt substitui a execução separada desses itens.

Leia as instruções AGENTS vigentes, RTK, RULES.md e as seções relevantes de .specs/features/seller-whatsapp/{spec,design,tasks}.md e ADRs 090/091. Use rg para confirmar o código atual; se houver grafo, apenas consulte e confirme na fonte. Reutilize componentes, serviços e testes já existentes. Preserve mudanças de terceiros e a correção do botão Criar pedido de d7537b3c.

Trabalhe em branch curta codex/<tarefa>, a partir da master atualizada com as dependências integradas. Um executor escreve por vez; não troque branch com alterações alheias. A unidade de entrega/PR é WAP-E12; os itens T abaixo são passos internos, não novas solicitações ao usuário. Não ampliar escopo nem criar framework, store, Redis ou infraestrutura.

Fronteira prevista: docs/runbooks/seller-whatsapp.md; .specs/features/seller-whatsapp/validation-piloto.md; configuração operacional somente no escopo autorizado. Outros arquivos somente se necessários para esta mesma entrega e com justificativa no diff; não sobrescreva trabalho de outra sessão.

1. WAP-T05-05: Preparar e, havendo autorização operacional explícita vigente, executar piloto com dois vendedores, uma linha por vendedor e cliente sintético.
   Aceite: Confirmar SHA/digest/health/migration e publicação compatíveis antes de ativar escopo mínimo autorizado. Cliente procura→titular humano→Pedido no alvo→ficha; repetir após desconexão, replay e tentativa alheia. Não enviar a clientes reais. Falha congela avanço e preserva ledger; nenhuma homologação por QR isolado.
2. WAP-T05-06: Preparar e, autorizado, provar QR em outra tela, código no mesmo celular, reconnect e tráfego CRM/aparelho nas duas linhas do piloto.
   Aceite: Não substituir código mobile por QR. Número errado/duplicado, expiração, logout/callback velho, mídia/recibos/echo-before-http/outage e privacidade de persistência com evidência minimizada. Sem segredo em captura/relatório; limitação explícita impede declarar autonomia mobile.
3. WAP-T05-07: Preparar e, autorizado, provar cadastro/vínculo/edição compartilhada, primeira saída individual e ações comerciais nas duas carteiras.
   Aceite: Mesmo Contact/histórias privadas; conflito por campo; snapshots; primeiro envio sem inbound e resposta correta. Cobrança/recebimento somente sintéticos ou sandbox explicitamente autorizado, offline após envio e callback repetido sem nova emissão. Final só aceita etapa 1 com todos os gates reais aplicáveis; nenhum efeito financeiro real implícito.

Preserve Contact oficial, isolamento por linha/carteira, ACL comercial independente, snapshots e retenção. Cada novo endpoint/ingresso/despacho já entrega guard fail-closed, default off e allowlist pertinente; não deixar isso para E11. Vínculo cadastral não concede acesso a conversa ou negócio alheio. n8n continua obrigatório; nenhum QR/código/segredo em persistência ou log. Efeito incerto exige reconciliação, sem retry cego.

Prepare o roteiro concreto e confira a autorização operacional vigente antes do primeiro efeito real; não peça novamente se ela já cobrir exatamente as ações. Na ausência de autorização aplicável, conclua a preparação, reporte o gate pendente e peça somente o aceite final necessário. Não publique, pareie, envie a cliente ou gere efeito financeiro real por inferência deste prompt. Cobrança/recebimento são sintéticos ou sandbox expressamente autorizado. Os três cenários T abaixo compõem um único roteiro, sem refazer setup ou pagamentos a cada seção.

Verificações focalizadas (consolide duplicadas):
- gates CI/ambiente alvo do runbook; fluxo real e ACL negativa com metadados sem PII; evidência separada da prova sintética.
- roteiro live aprovado e inspeções de privacidade do runbook; reconciliar resultados incertos sem repetir efeito.
- roteiro comercial/sandbox aprovado; evidências de ACL/IDs/versões e recebimento único sem PII; checklist final sem marcar etapa 2.

Registre provas reais minimizadas, resultado e limites do roteiro autorizado. Não substituir código no mesmo celular por QR em duas telas nem declarar PASS por mock. Só encerrar etapa 1 com os aceites funcionais e operacionais aplicáveis.

Atualize os itens T cobertos e WAP-E12 em tasks.md somente com evidência, mais contrato/runbook da fronteira. Faça git diff --check; publique uma entrega coerente em commit(s) atômico(s), um push e um PR, sem merge automático ou grafo versionado. Informe IDs/requisitos, arquivos, comandos/resultados, SHA/PR, risco/rollback e pendências. Não avance para o próximo E nesta sessão.
```

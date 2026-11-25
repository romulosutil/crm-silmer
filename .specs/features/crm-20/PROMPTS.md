# Prompts de execução do CRM Silmer 2.0

Copie o bloco comum e o bloco de uma tarefa para a sessão que vai executá-la.
A [tabela de branches](tasks.md) fixa base, dependências e condição de merge.
As decisões D02, D03 e D05 do
[RFC 075](../../../docs/rfc/075-crm-20-centrado-no-cliente.md#decisões-a-registrar),
as decisões D01, D04, D06 e D07 do
[RFC 076](../../../docs/rfc/076-identidade-do-cliente-entre-linhas.md#decisões-a-registrar)
e os [gates G00 a G10](validation.md) determinam quando cada prompt pode
avançar. Escolha no início da sessão um modelo do nível exigido pela tabela
abaixo.

## Níveis de execução

- **Nível A** — fronteira transacional, ACL, concorrência, privacidade ou
  decisões que cruzam módulos. Exige o modelo de maior capacidade de
  raciocínio disponível na conta, com esforço alto ou superior.
- **Nível B** — contrato estável e testes de caracterização com critérios
  explícitos e evidência objetiva.
- **Nível C** — UI, E2E visual, estados responsivos e revisão multimodal com
  contexto de código.

Registre no PR o modelo, o cliente e o esforço efetivamente usados. Revisão
de SQL, ACL e elegibilidade conserva o Nível A mesmo quando a implementação
for de nível menor. A recomendação trata do agente de desenvolvimento.
Decisão sobre o modelo operacional do Vendedor Silmer segue seus contratos.

| Tarefa  | Nível | Motivo                                                                          |
| ------- | ----- | ------------------------------------------------------------------------------- |
| C20-T00 | A     | Rastreabilidade de requisitos, conflitos entre decisões e coerência documental. |
| C20-T01 | B     | Exercitar a suíte existente e adicionar regressões de caracterização precisas.  |
| C20-T02 | A     | Reconciliar fontes, evitar falsa deduplicação e minimizar dados.                |
| C20-T03 | A     | Compor ACL e agregações em fronteiras diferentes com evidência em SQL real.     |
| C20-T04 | C     | Implementar e conferir o perfil visual, estados responsivos e navegação.        |
| C20-T05 | C     | Modificar a Inbox com um contrato de leitura estável e preservar foco e fluxo.  |
| C20-T06 | C     | Exercitar a experiência integrada com estados de falha e revisar a evidência.   |
| C20-T07 | A     | Integridade, locks, upgrade e compatibilidade de escrita.                       |
| C20-T17 | A     | Predicados de ACL entre módulos e SSE sem ampliar visibilidade.                 |
| C20-T08 | A     | Corridas, ordem de bloqueios, conflitos e atomicidade entre domínios.           |
| C20-T09 | A     | Ingresso n8n, contratos de replay, proteção de geração e rollback.              |
| C20-T10 | A     | Primeiro envio e eco têm ordem variável e efeitos externos.                     |
| C20-T11 | B     | Relatório determinístico e simulação sobre formato e política aprovados.        |
| C20-T12 | A     | Escrita reiniciável e reversão depois de mudanças concorrentes.                 |
| C20-T13 | A     | Evitar inferência por presença, contagem, IDs e eventos derivados.              |
| C20-T14 | A     | Integrar evidências de aplicação, banco, workflow, fila e recuperação.          |
| C20-T15 | A     | Regras de pendência, permissão e sugestão que expira com o contexto.            |
| C20-T16 | A     | Decisões comerciais e operacionais que cruzam pedidos, canais e IA.             |

## Referência volátil em 24/11/2026

Mapeamento dos níveis para modelos concretos na data acima. Nomes, acesso e
controles mudam por cliente e plano e podem estar desatualizados: confira o
seletor da conta e as páginas oficiais antes de usar.
[OpenAI](https://learn.chatgpt.com/docs/models) ·
[Claude](https://platform.claude.com/docs/en/models/overview) ·
[Google Antigravity](https://antigravity.google/docs/models)

| Nível | Opções de referência                                                             |
| ----- | -------------------------------------------------------------------------------- |
| A     | GPT-6.2 Astra (High ou Extra High) · Codex; Claude Opus 5.5 (High) · Claude Code |
| B     | GPT-6.2 Sol (High) · Codex; Claude Sonnet 5.5 (High) · Claude Code               |
| C     | Gemini 4 Neon (High) · Antigravity; Claude Sonnet 5.5 (High) · Claude Code       |

| Tarefa  | Melhor escolha para a tarefa           | Alternativa                            |
| ------- | -------------------------------------- | -------------------------------------- |
| C20-T00 | Claude Opus 5.5 · High · Claude Code   | GPT-6.2 Astra · High · Codex           |
| C20-T01 | GPT-6.2 Sol · High · Codex             | Claude Sonnet 5.5 · High · Claude Code |
| C20-T02 | Claude Opus 5.5 · High · Claude Code   | GPT-6.2 Astra · High · Codex           |
| C20-T03 | GPT-6.2 Astra · High · Codex           | Claude Opus 5.5 · High · Claude Code   |
| C20-T04 | Gemini 4 Neon · High · Antigravity     | Claude Sonnet 5.5 · High · Claude Code |
| C20-T05 | Claude Sonnet 5.5 · High · Claude Code | Gemini 4 Neon · High · Antigravity     |
| C20-T06 | Gemini 4 Neon · High · Antigravity     | GPT-6.2 Sol · High · Codex             |
| C20-T07 | GPT-6.2 Astra · Extra High · Codex     | Claude Opus 5.5 · High · Claude Code   |
| C20-T17 | GPT-6.2 Astra · Extra High · Codex     | Claude Opus 5.5 · High · Claude Code   |
| C20-T08 | GPT-6.2 Astra · Extra High · Codex     | Claude Opus 5.5 · High · Claude Code   |
| C20-T09 | Claude Opus 5.5 · High · Claude Code   | GPT-6.2 Astra · Extra High · Codex     |
| C20-T10 | GPT-6.2 Astra · Extra High · Codex     | Claude Opus 5.5 · High · Claude Code   |
| C20-T11 | GPT-6.2 Sol · High · Codex             | Claude Sonnet 5.5 · High · Claude Code |
| C20-T12 | Claude Opus 5.5 · High · Claude Code   | GPT-6.2 Astra · Extra High · Codex     |
| C20-T13 | GPT-6.2 Astra · High · Codex           | Claude Opus 5.5 · High · Claude Code   |
| C20-T14 | GPT-6.2 Astra · High · Codex           | Claude Opus 5.5 · High · Claude Code   |
| C20-T15 | Claude Opus 5.5 · High · Claude Code   | GPT-6.2 Astra · High · Codex           |
| C20-T16 | Claude Opus 5.5 · High · Claude Code   | GPT-6.2 Astra · High · Codex           |

Para C20-T11, transfira ao Gemini 4 Hydrogen High apenas uma implementação
delimitada por contrato de relatório já validado, se o ambiente principal de
execução for Antigravity. Na ausência do modelo listado, use outro do mesmo
nível e registre a troca.

## Bloco comum

```text
Você implementa a tarefa C20 indicada no bloco seguinte do CRM Silmer.
Leia AGENTS.md, RULES.md e a documentação mínima exigida. Use o Graphify
existente para descoberta e confirme no código da ponta atual. Leia os
RFCs 075 e 076 em docs/rfc e spec.md, design.md, tasks.md e validation.md
em .specs/features/crm-20. Confira a branch, dependências, decisões e nível
da tarefa. Se uma decisão obrigatória não estiver registrada em ADR ou um
pré-requisito não estiver integrado, documente o bloqueio e entregue a
investigação independente.

Trabalhe só nas fronteiras e testes da tarefa. Preserve dados e mudanças de
terceiros. Use fixtures sintéticas. Siga as ACLs, a idempotência e os
contratos que a tarefa cruza. Antes de propor a correção de um bug, capture
uma regressão que o reproduza. Para novas capacidades, teste o fluxo normal,
as negativas e o comportamento com a capacidade desligada quando aplicável.
Valide os gates da linha em tasks.md e os checks obrigatórios do repositório
no SHA final. Nenhum cenário de gate pode terminar com falha ou skip.
Quando um gate estiver bloqueado por ambiente, relate o comando, a causa e
o que falta comprovar. Mantenha falhas reproduzíveis ou recorrentes visíveis
e resolva-as antes de promover o PR.

Entregue requisito e tarefa, mudança, arquivos, decisões e pressupostos,
resultados por gate e SHA, modelo e esforço usados, riscos remanescentes e
o estado do rollout. Use um commit e um PR para a branch da tarefa.
Ativação em infraestrutura compartilhada ou produção exige o aceite
operacional correspondente.
```

## C20-T00 — SDD e RFC

```text
Escreva ou revise os RFCs 075 e 076 e o SDD em .specs/features/crm-20.
Inclua arquitetura, pré-mortem, critérios numerados, tarefa e prompt por
branch, níveis de execução, dependências e regressões. O documento de
produto de origem ("proposta CRM Silmer 2.0, versão 1.0", DOCX) não está no
repositório: antes do aceite, registre versão, data e local autorizado, ou
anexe um resumo sem dados pessoais, e cruze-o com as regras vigentes. Trate
mudanças duráveis como propostas pendentes. Edite somente a pasta da
feature, os RFCs e seu índice. Aceite: G00, rastreabilidade de todos os C20
e sequência de merge acíclica.
```

## C20-T01 — Baseline de regressão

```text
Caracterize o comportamento atual antes de mudar produto. Trabalhe em test/,
fixtures sintéticas e registro de evidência da feature. Comece por
inbox-postgres-live, n8n-integration-postgres-live e isolamento do WhatsApp.
Preencha lacunas de arquivo versus encerramento, novo ciclo e replay do
inbound antigo. Exercite handoff, autorização e pedido manual/loja.
Aceite: exemplos existentes preservados e lacunas cobertas em G01–G04.
Se encontrar defeito reproduzível, isole o caso e registre a correção como
dependência antes da tarefa que tocar a fronteira.
```

## C20-T02 — Inventário de dados

```text
Prepare consultas de diagnóstico agregadas em scripts/ e documentação da
feature. Meça Contatos sem canal, números declarados e confirmados, grupos
de candidatos, colisões, órfãos, pedidos manuais, da loja e sem data/valor
comercial confiável. Una contagens com definições e denominadores explícitos.
Teste em fixture sintética e com credencial somente leitura se houver
ambiente aprovado. Aceite: relatório repetível com totais reconciliáveis,
sem telefone, identidade externa, nome, chaves ou PII em saída. G00/G07.
```

## C20-T03 — API de leitura comercial

```text
Após D02/D03 registradas em ADR, entregue endpoints aditivos em apps/api/,
nos leitores necessários de contacts/orders/inbox-channels, em test/ e no
OpenAPI. Use ACL por recurso antes de selecionar, contar ou paginar.
Deduplique por ID de Pedido. Status de Pedido é só pendente ou confirmado;
venda segue a regra atual: status='confirmado' AND NOT is_test AND
cancelled_at IS NULL. Reaberto volta a pendente com reopened_at e só conta
depois de reconfirmado, salvo D03. Use final_amount_cents e order_date, com
conjuntos idênticos para total e ticket; com contagem zero, ticket e última
venda são null (a apuração atual devolve 0). Pedido da loja não entra no
resumo por Contato. Paginação por (order_date,id). Inclua migração expand
com índice parcial em (contact_id, order_date, id) para o universo de
vendas e registre o plano de consulta. Caracterize o defeito de
ClientOrders.vue (owner=me e filtro de contactId no navegador) que
commercial-orders corrige. Flag CONTACT_COMMERCIAL_READ_ENABLED, nome fixado
aqui, estrita 'true'|'false' com allowlist opcional *_SELLER_IDS, como
SELLER_CLIENTS_ENABLED; valor inválido derruba a partida; teste o modo
desligado. A projeção emite só invalidação genérica por SSE e não usa
inbox.order.changed para levar dados do resumo. Em docs/api/openapi.v1.yaml
valide o schema das respostas novas, além do operationId. Exemplos: pedido
duplicado por Assunto, cancelado, reaberto, reconfirmado, teste, loja,
origem oculta, cursores cruzados e revogação concorrente.
Aceite: contrato no OpenAPI, PostgreSQL real e G01/G02/G06.
```

## C20-T04 — Perfil de Clientes

```text
Evolua apps/edge-web/src/views/ClientsView.vue e componentes do perfil, com
E2E correspondente. Substitua apps/edge-web/src/components/ClientOrders.vue,
que lista /api/v1/orders?owner=me e filtra o Contato no navegador, pelo
consumo de commercial-orders de T03. Reuse cadastro, navegação e componentes
existentes em Clientes e Meus clientes. Mostre resumo, Pedidos e ciclos
autorizados. Preserve cartões vazios, erros, paginação independente,
teclado e links profundos. Cubra carregamento tardio, erro e revogação
durante a consulta. Aceite: G01/G02/G05 em desktop e móvel. Deixe a
fronteira da Inbox para T05.
```

## C20-T05 — Painel de atendimento

```text
Em InboxView e componentes de Inbox, adicione o resumo comercial aprovado
ao painel existente. Use a conversa ativa para determinar o contexto,
revalide acesso e descarte resposta atrasada da conversa anterior. Preserve
compositor, foco, Assuntos, fila e gaveta de cadastro. Trate resumo
indisponível sem bloquear a operação corrente. Aceite: G01/G02/G05,
incluindo troca rápida de conversa, transferência e foco no retorno.
```

## C20-T06 — Homologar leitura

```text
No SHA integrado, valide jornada de busca, perfil, pedido e retorno à
Inbox para cada escopo de leitor. Confira total, denominador, data e ACL
contra fixtures aprovadas. Exercite indisponibilidade e carga representativa.
Edite somente testes integrados e evidência da feature. Aceite: G00/G01/
G02/G05/G06/G09 com evidência de aplicação e alvo de release identificados.
```

## C20-T07 — Expandir identidade

```text
Após D01 e D06 registradas em ADR, crie migration expand e testes de banco
na fronteira de identidade. Formalize associação verificada ativa, FK,
chave HMAC, versão, proveniência por transporte e vigência. O
phone_status='confirmed' atual não é prova: a migração 0006 o exige para
toda identidade WhatsApp e o primeiro envio o grava a partir de número
digitado. O vínculo canônico acompanha merge e desfazer merge de
identity_links, que mudam current_contact_id. Não edite o arquivo da 0038:
o checksum da migração aplicada inclui comentários. Registre no cabeçalho da
migração nova e no ADR que o comentário da 0038 ("não é prova") continua
válido para número digitado e cede só à prova aprovada em D01.
Revogado/expirado conserva histórico sem consumir unicidade ativa. Meça
locks e upgrade a partir da versão anterior. Prove que leitor e escritor
anteriores continuam operáveis. Aceite: G03/G06/G07, sem backfill de
associação nem mudança de ingresso.
```

## C20-T17 — Visibilidade por linha de origem

```text
Após D06 registrada em ADR, faça os predicados de leitura considerarem a
linha de origem da conversa: orderReadable em
modules/orders/src/adapters/order-contact-access.js, contactVisible em
modules/contacts/src/adapters/contact-access.js e a autorização do evento
SSE inbox.order.changed em apps/api/src/operation-runtime.js, hoje feita
pela conversa (assertReadable). Unir identidades nunca amplia a
visibilidade de Pedido ou Contato. Contatos sem identidade pessoal não
mudam de resultado: prove com a caracterização de T01. Nos Contatos já
mistos pelo primeiro envio, aplique só a diferença aprovada em D06 (que
substitui "Pedido segue a ACL comercial" da WAP-07 para Pedido de conversa
pessoal) e caracterize-a em teste. Em
fixture sintética, una uma identidade da linha pessoal a um Contato da
linha geral e compare antes/depois para titular, outro vendedor, vendedor
da linha geral, supervisor designado, outro admin e Financeiro. Cubra o
efeito inverso: Contato manual que ganha identidade pessoal. Preserve "o
vendedor do pedido sempre o mantém". Meça o custo dos EXISTS
por linha. Não monte rota de merge nem mude o ingresso.
Aceite: G01/G02/G06.
```

## C20-T08 — Resolução de telefone

```text
No módulo contacts e testes, implemente resolução transacional usada depois
por T09. Hoje os locks do inbound (n8n-inbound, n8n-conversation e
identity:{lookupHash}) incluem a conta da linha, então duas linhas não se
serializam, e o cadastro manual trava hashtext(phoneHash) enquanto o
inbound usa hashtextextended. Escolha uma única chave entre linhas e uma
única função de hash, numa ordem de locks compatível com os dois caminhos
e com lock_timeout de 1500 ms. O resolvedor de
postgres-contact-identity-repository.js só roda em testes e a produção
resolve em modules/n8n-integration: escolha um caminho e alinhe ou remova o
outro. normalizeContactPhone não concilia o nono dígito; variantes são
candidatos distintos para revisão. Preserve identidade conhecida, devolva
conflito seguro e use associação automática somente para a prova aprovada
em D01. Exercite duas conexões simultâneas, dados digitados, recirculados,
identificador opaco, revogação e falha entre operações. Aceite: G03/G06
com PostgreSQL real e nenhuma mutação parcial.
```

## C20-T09 — Integrar ingresso

```text
Com T08 e T17 mescladas, integre o resolvedor à entrada aprovada em
modules/n8n-integration e configuração da API, com testes de contrato e
PostgreSQL. Reuse a transação, deduplique antes da resolução e mantenha
escopo de ciclo, geração, modo, handoff e epoch. Carteira conforme D06: hoje
o inbound da linha pessoal cria seller_client_link automaticamente; o reuso
de um Contato não cria vínculo implícito sem regra aprovada. Um vínculo
revoked hoje faz o ingresso lançar N8nForbiddenError: com o resolvedor, a
mensagem nunca se perde e fica em Contato isolado com revisão. Habilitação
exige flag e allowlist de conta/linha, ambas fechadas no default. Aceite:
G01/G03/G04 em modo baseline e piloto, incluindo replay de evento antigo
depois de fechar e vínculo revogado.
```

## C20-T10 — Primeiro envio e eco

```text
Exercite primeiro envio, saída pelo aparelho, eco e resultado incerto nas
fronteiras de seller WhatsApp, n8n e outbox. Ajuste só os escritores que
possam contornar D01 ou divergir da resolução aprovada. Preserve reserva,
geração, carteira, idempotência, UI e comportamento com flag desligada.
Simule eco antes/depois do retorno e duas confirmações concorrentes.
Aceite: G01/G03/G04. Cada intenção materializa no máximo uma saída oficial.
```

## C20-T11 — Ensaio da migração

```text
Em scripts/ e evidência da feature, prepare simulação e relatório de lotes
determinísticos sobre o inventário de T02. A simulação não escreve vínculos.
Separe elegíveis conforme D01 e casos para revisão autorizada. Registre
IDs técnicos apenas no artefato operacional autorizado e mantenha somente
contagens e categorias no repositório. Compare repetição e upgrade em
snapshot isolado e sintético. Aceite: G03/G07/G08 e relatório reconciliável.
```

## C20-T12 — Aplicar e reverter lotes

```text
Implemente comando operacional com simulação padrão, plano identificado,
pré-condições, limite, versão, checkpoint e reversão seletiva. Edite
scripts/, a fronteira de identidade necessária, testes e runbook da
feature. Faça ensaio em base dedicada. Interrompa após um commit, retome
o mesmo lote, provoque mudança de versão e simule tráfego após associação.
Aceite: G03/G07/G08, efeitos preservados e divergência explicável.
```

## C20-T13 — Sinal de simultaneidade

```text
Após D07 registrada em ADR, implemente o menor aviso aprovado em leitura de
Inbox e painel, com flag própria desabilitada. As ADRs 088 e 095 proíbem
enumerar conversas ocultas em histórico, contagens e eventos: a opção
recomendada avisa só quem já vê as duas conversas. Aviso a quem não vê a
outra conversa exige novo ADR que supersede parte das ADRs 088/095. Compare
respostas com e sem conversa oculta para cada papel, inclusive após
revogação. Estado, agregados, SSE e erros devem respeitar a projeção
autorizada. Preserve fila e dono do atendimento. Aceite: G02/G03/G05. Uma
negativa de visibilidade cobre tokens, cursores, presença, nomes, IDs e
contagens.
```

## C20-T14 — Homologar duas linhas

```text
Integre evidência das duas linhas definidas em D04, usando ambiente de
homologação autorizado e eventos de teste. Verifique digest, SHA, workflow
e flags. Execute simultaneidade, reentrega, encerramento, compatibilidade,
privacidade, carga, reconciliação e rollback com trânsito incerto. Escreva
somente testes, evidência e instruções de ativação. Aceite: G00/G02/G03/
G04/G06/G07/G08/G09 e aceite de Operação no SHA homologado. Se o transporte
real estiver indisponível, mantenha a homologação pendente.
```

## C20-T15 — Sugerir encerramento

```text
Após D05, implemente sugestão interna na fronteira Inbox/Pedidos,
desabilitada por padrão, com motivo e versão. Reavalie elegibilidade após
novo inbound, pendência, transferência e mudança de pedido. Reuse o comando
humano de fechar e suas guardas. Abrir, ignorar ou expirar sugestão só altera
a projeção da sugestão. Aceite: G01/G02/G05/G10, com pedido confirmado,
reaberto, múltiplos Assuntos e efeitos na fila.
```

## C20-T16 — Projetar escopo futuro

```text
Escreva decisões separáveis para fechamento automático, pedidos da loja,
recebimento líquido, contexto ampliado de IA, canais, segmentação/campanhas
e relatórios. Em cada frente, documente objetivo, baseline, condição de
aceite, regra que muda, dependências externas, dados, risco, rollback e
estimativa condicionada. Divida em RFCs e tarefas de implementação somente
quando houver requisito aprovado. Edite documentação. Aceite: G00/G10,
revisão de Produto e Privacidade e nenhuma ativação.
```

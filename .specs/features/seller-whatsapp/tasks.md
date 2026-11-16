# WhatsApp por vendedor — entregas atômicas

[Spec WAP-01–33](spec.md), [design da etapa 1](design.md),
[prompts completos por tarefa](PROMPTS.md),
[ADR 090](../../../docs/adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md) e
[ADR 091](../../../docs/adr/091-contratos-da-etapa1-whatsapp-pessoal.md).

WAP-T00/a/b/c registram descoberta e decisões. **WAP-T00d** entrega o SDD
em 16/11/2026, sem runtime. As antigas WAP-T01–05 e WAP-T02a passam a ser
épicos: só encerram quando todas as respectivas subtarefas e gates passaram.
WAP-T06/T07 ficam na etapa 2, sem implementação ou prompts executáveis agora.
Nenhum checkbox de implementação abaixo foi concluído por esta documentação.

## WAP-T00d — SDD técnico e prompts da etapa 1

- [x] Confirmar fontes e reutilizações; fechar dados, API, estados, privacidade,
      ACL e contrato de origem por Assunto, com decisão técnica rastreável.
- [x] Decompor etapa 1 em 32 entregas, cada uma com dependências, dono de
      arquivos, aceite, verificações, modelo sugerido e um prompt completo.
- [x] Priorizar gate WAP-T02a antes de primeira saída e acabamento da etapa 1.
- [x] Revisar riscos Backend e QA, incorporar correções e validar documentos.
      Evidências e publicação documental em [validation-sdd.md](validation-sdd.md).

## Como executar sem perder atomicidade

Uma tarefa = uma fronteira entregável + testes/contrato/runbook necessários +
um commit + um push + um PR. Não juntar tarefas porque usam o mesmo modelo.
Usar branch curta de origin/master após dependências integradas. PR 382 e este
SDD devem estar na master antes da primeira implementação; enquanto abertos,
não copiar decisões pela metade. Worktree extra somente temporário conforme
AGENTS; não trocar branch com alterações de terceiros nem apagar trabalho
alheio. Execução serial no checkout do Rômulo; esta tabela não autoriza sessões
concorrentes de escrita. Review somente leitura não toma posse dos arquivos.

Cada tarefa que introduz endpoint/inbound/despacho já entrega guard fail-closed,
default desligado e allowlist aplicável, com testes negativos. T05-01 consolida
configuração e limites; não é a primeira trava. ACL/histórico persistem com flag off.

Tarefas de runtime executam testes focalizados e os gates de CONTRIBUTING antes
de publicar. Migrações e concorrência precisam de PostgreSQL sintético real;
mock não fecha esses critérios. Suítes que dependem de ambiente e dão skip não
contam como PASS. Documentação pura usa formatação/referências/diff, sem suítes
de runtime. Gates reais precisam da autorização aplicável já existente ou,
na sua ausência, preparação integral e pedido final com roteiro revisável.

## Ordem de execução

1. Fundamentos: T01-01 → T01-02; T02-01 → T02-02; T02-03 → T02-04;
   T01-03 → T01-04 → T02-05 → T02-06 → T02-07. Aplicar dependências da tabela,
   inclusive as cruzadas; não habilitar feature parcialmente protegida.
2. T02a-01 → T02a-02 pode ser preparado antes, sem escritor novo. Após
   fundamentos, T02a-03 → T02a-04 → **T02a-05** entrega o primeiro gate integrado.
3. Somente depois do gate: T02-08; T03-01 → T03-02; T04-01/T04-02;
   T04-03 → T04-04; T02-09 → T04-05. A tabela detalha os cruzamentos.
4. T05-01 → T05-02 → T05-03 → T05-04 prepara o release. T05-05 →
   T05-06 → T05-07 executa os aceites reais apenas quando autorizados.

Dependências são de conteúdo integrado, não só PR aberto ou checkbox marcado.
Não há dependência de primeiro envio para T02a. T02a-05 não é piloto live e
não encerra etapa 1. Os modelos são indicação de complexidade, não prova de
qualidade ou custo; Sol/Opus revisa mudanças de contrato antes da execução.

## Registro das tarefas da etapa 1

| Estado / ID     | Entrega                                                                           | Modelo       | Depende de                                     | Requisitos                        |
| --------------- | --------------------------------------------------------------------------------- | ------------ | ---------------------------------------------- | --------------------------------- |
| [ ] WAP-T01-01  | [Provar controle, código mobile e privacidade do provedor](PROMPTS.md#wap-t01-01) | Sol/Opus     | —                                              | WAP-02/03/04/10/12                |
| [ ] WAP-T01-02  | [Persistir linha pessoal e ledger de controle](PROMPTS.md#wap-t01-02)             | Terra/Sonnet | WAP-T01-01                                     | WAP-02/04/10/11/12                |
| [ ] WAP-T02-01  | [Persistir vínculo durável de carteira](PROMPTS.md#wap-t02-01)                    | Terra/Sonnet | —                                              | WAP-06/08/18/20/21/24/29          |
| [ ] WAP-T02-02  | [Aplicar escrita compartilhada por campo](PROMPTS.md#wap-t02-02)                  | Sol/Opus     | WAP-T02-01                                     | WAP-25/26/27/28/29/30             |
| [ ] WAP-T02-03  | [Isolar leituras de Clientes e projeções comuns](PROMPTS.md#wap-t02-03)           | Sol/Opus     | WAP-T01-02, WAP-T02-01                         | WAP-07/08/20/21/24/28             |
| [ ] WAP-T02-04  | [Compor cadastro e vínculo de Cliente](PROMPTS.md#wap-t02-04)                     | Sol/Opus     | WAP-T02-02, WAP-T02-03                         | WAP-18/20/21/24/29                |
| [ ] WAP-T01-03  | [Expor comandos e estado de controle pessoal](PROMPTS.md#wap-t01-03)              | Sol/Opus     | WAP-T01-02                                     | WAP-01/02/03/04/10/11/12          |
| [ ] WAP-T01-04  | [Conectar controle n8n e desafio efêmero](PROMPTS.md#wap-t01-04)                  | Sol/Opus     | WAP-T01-01, WAP-T01-03                         | WAP-02/03/04/10/11/12             |
| [ ] WAP-T02-05  | [Receber na linha pessoal com atribuição humana atômica](PROMPTS.md#wap-t02-05)   | Sol/Opus     | WAP-T01-04, WAP-T02-04                         | WAP-04/05/06/08/10/20/21/32       |
| [ ] WAP-T02-06  | [Proteger conversa e leituras auxiliares da linha](PROMPTS.md#wap-t02-06)         | Sol/Opus     | WAP-T02-05, WAP-T02-03                         | WAP-07/08/17/28                   |
| [ ] WAP-T02-07  | [Cercar eventos, replay e revogação de acesso](PROMPTS.md#wap-t02-07)             | Sol/Opus     | WAP-T02-06, WAP-T02-02                         | WAP-07/11/28/29                   |
| [ ] WAP-T02a-01 | [Adicionar origem de Assunto ao Pedido](PROMPTS.md#wap-t02a-01)                   | Terra/Sonnet | —                                              | WAP-17/31/33                      |
| [ ] WAP-T02a-02 | [Resolver Pedido por alvo sem escolha arbitrária](PROMPTS.md#wap-t02a-02)         | Sol/Opus     | WAP-T02a-01                                    | WAP-17/30/31/33                   |
| [ ] WAP-T02a-03 | [Criar ou reutilizar Pedido no alvo transacional](PROMPTS.md#wap-t02a-03)         | Sol/Opus     | WAP-T02a-02, WAP-T02-06                        | WAP-17/31/33; OA-05/07            |
| [ ] WAP-T02a-04 | [Entregar fluxo passivo de Pedido em Meus clientes](PROMPTS.md#wap-t02a-04)       | Terra/Sonnet | WAP-T02a-03, WAP-T02-07                        | WAP-01/17/31/32/33                |
| [ ] WAP-T02a-05 | [Verificar gate prioritário ponta a ponta](PROMPTS.md#wap-t02a-05)                | Sol/Opus     | WAP-T02a-04                                    | WAP-17/19/31/32/33                |
| [ ] WAP-T02-08  | [Revalidar linha na reserva e no despacho humano](PROMPTS.md#wap-t02-08)          | Sol/Opus     | WAP-T02a-05                                    | WAP-06/10/11/12/19                |
| [ ] WAP-T03-01  | [Normalizar fato externo enviado pelo aparelho](PROMPTS.md#wap-t03-01)            | Terra/Sonnet | WAP-T02a-05, WAP-T01-01                        | WAP-09/10/12                      |
| [ ] WAP-T03-02  | [Persistir saída externa e reconciliar eco](PROMPTS.md#wap-t03-02)                | Sol/Opus     | WAP-T03-01, WAP-T02-08                         | WAP-06/09/10/11                   |
| [ ] WAP-T04-01  | [Completar cadastro e vínculo na carteira](PROMPTS.md#wap-t04-01)                 | Terra/Sonnet | WAP-T02a-05, WAP-T02-04                        | WAP-01/17/18/20/21/24/25/26/27/29 |
| [ ] WAP-T04-02  | [Entregar Meu WhatsApp e onboarding dispensável](PROMPTS.md#wap-t04-02)           | Terra/Sonnet | WAP-T02a-05, WAP-T01-04                        | WAP-01/02/03/04/11/12             |
| [ ] WAP-T04-03  | [Compor primeiro envio individual no servidor](PROMPTS.md#wap-t04-03)             | Sol/Opus     | WAP-T02a-05, WAP-T03-02, WAP-T02-04            | WAP-22/23/24/32                   |
| [ ] WAP-T04-04  | [Expor compositor do primeiro envio opcional](PROMPTS.md#wap-t04-04)              | Terra/Sonnet | WAP-T04-03, WAP-T04-01                         | WAP-22/23/24/32                   |
| [ ] WAP-T02-09  | [Preservar cobrança e preparo pela linha correta](PROMPTS.md#wap-t02-09)          | Sol/Opus     | WAP-T02-08, WAP-T02-02                         | WAP-17/19/27/28/30                |
| [ ] WAP-T04-05  | [Conservar contexto das ações comerciais na carteira](PROMPTS.md#wap-t04-05)      | Terra/Sonnet | WAP-T04-01, WAP-T02-09                         | WAP-17/19/25/28/30                |
| [ ] WAP-T05-01  | [Consolidar flags, allowlist e limites sem ativação](PROMPTS.md#wap-t05-01)       | Terra/Sonnet | WAP-T04-02, WAP-T04-04, WAP-T04-05, WAP-T03-02 | WAP-12/16                         |
| [ ] WAP-T05-02  | [Auditar regressão funcional, a11y e privacidade](PROMPTS.md#wap-t05-02)          | Sol/Opus     | WAP-T05-01                                     | WAP-01–12/17–33                   |
| [ ] WAP-T05-03  | [Ensaiar rollback e recovery sem reativar efeitos](PROMPTS.md#wap-t05-03)         | Sol/Opus     | WAP-T05-02                                     | WAP-10/11/12/16/29/33             |
| [ ] WAP-T05-04  | [Consolidar roteiro operacional e evidências](PROMPTS.md#wap-t05-04)              | Luna/Haiku   | WAP-T05-03                                     | WAP-12/16; WAP-T05                |
| [ ] WAP-T05-05  | [Homologar fluxo passivo real de Pedido](PROMPTS.md#wap-t05-05)                   | Sol/Opus     | WAP-T05-04                                     | WAP-04/05/07/17/31/32/33          |
| [ ] WAP-T05-06  | [Homologar pareamento mobile e sincronização reais](PROMPTS.md#wap-t05-06)        | Sol/Opus     | WAP-T05-05                                     | WAP-01/02/03/04/09/10/11/12       |
| [ ] WAP-T05-07  | [Homologar ações comerciais e primeiro envio do piloto](PROMPTS.md#wap-t05-07)    | Sol/Opus     | WAP-T05-06                                     | WAP-17–30/32                      |

## Cobertura por requisito

Esta matriz aponta tarefas que implementam/verificam cada contrato; os aceites
literais continuam na spec. Não reinterpretar um requisito pelo resumo do prompt.

| Requisito | Tarefas principais                                  |
| --------- | --------------------------------------------------- |
| WAP-01    | T01-03, T02-04, T04-01, T04-02                      |
| WAP-02    | T01-01–04, T04-02                                   |
| WAP-03    | T01-01/03/04, T04-02, T05-02/06                     |
| WAP-04    | T01-01–04, T02-05, T05-06                           |
| WAP-05    | T02-05/06, T02a-05                                  |
| WAP-06    | T01-02, T02-01/05/08, T03-02                        |
| WAP-07    | T02-03/06/07, T05-02                                |
| WAP-08    | T02-01/03/04/05/06                                  |
| WAP-09    | T03-01/02, T05-06                                   |
| WAP-10    | T01-01–04, T02-05/08, T03-01/02, T05-03             |
| WAP-11    | T01-02/03/04, T02-07/08, T04-02, T05-03             |
| WAP-12    | T01-01–04, T02-08, T03-01, T05-01/02/03/04/05/06/07 |
| WAP-16    | T05-03/04                                           |
| WAP-17    | T02-06, T02a-01–05, T04-01/05, T05-07               |
| WAP-18    | T02-01/04, T04-01                                   |
| WAP-19    | T02-08/09, T04-05, T02a-05, T05-07                  |
| WAP-20    | T02-01/03/04/05, T04-01                             |
| WAP-21    | T02-01/03/04/05, T04-01                             |
| WAP-22    | T04-03/04, T05-07                                   |
| WAP-23    | T04-03/04, T03-02                                   |
| WAP-24    | T02-01/03/04, T04-01/03/04                          |
| WAP-25    | T02-02, T04-01, T05-07                              |
| WAP-26    | T02-02, T04-01, T05-07                              |
| WAP-27    | T02-02/09, T04-01, T05-07                           |
| WAP-28    | T02-02/03/06/07, T05-02/07                          |
| WAP-29    | T02-01/02/04/07, T04-01, T05-03                     |
| WAP-30    | T02-02, T02a-02, T02-09, T05-07                     |
| WAP-31    | T02a-01–05, T05-05                                  |
| WAP-32    | T02-05, T02a-04/05, T04-03/04, T05-07               |
| WAP-33    | T02a-01–05, T05-03/05                               |

WAP-13/14/15 são exclusivos da etapa 2. WAP-16 vale desde o rollback da etapa 1.

## Regra de conclusão dos épicos

- WAP-T01: T01-01–04, provas de controle e privacidade sem habilitação implícita.
- WAP-T02: T02-01–09, sem exposição parcial de carteira ou despacho inseguro.
- WAP-T02a: T02a-01–05, gate prioritário integrado, independente da primeira saída.
- WAP-T03: T03-01/02 e evidência real T05-06.
- WAP-T04: T04-01–05 e superfícies passivas entregues em T02a-04.
- WAP-T05: T05-01–07; piloto e aceite real são separados da evidência sintética.

Não marcar épico só porque migração, QR, chat ou teste isolado passou.

## WAP-T00 — RFC, requisitos e plano

- [x] Confirmar baseline, adapter de linha única, saídas do aparelho ignoradas,
      carteira geral e ADR 088 atual sem alterar arquivos de terceiros.
- [x] Propor duas etapas só WhatsApp, configuração pessoal por QR, estados,
      limites mobile, privacidade, vínculo/ACL, envio correto e reconciliação.
- [x] Documentar critérios WAP e decisões D1–D4 (ADR pendente naquela entrega,
      posteriormente decidido em WAP-T00c).
- [x] Verificar links/formatação/diff e concluir commit, push e PR (handoff WAP-T00).

Validação proporcional: Prettier nos documentos alterados, referências locais,
rastreabilidade e `git diff --check`. Sem suítes de runtime para esta proposta
documental; não há novo endpoint, migração, workflow ou pareamento nesta entrega.

## WAP-T00a — explicitar a operação comercial completa

- [x] Registrar o esclarecimento do proprietário: Meus clientes inclui cadastro
      de contatos, pedidos, cobranças e demais ações CRM elegíveis na etapa 1.
- [x] Acrescentar WAP-17–19 e cenários de contexto comercial, cadastro sem
      conversa, envio de cobrança pela linha correta e pagamento após disconnect.
- [x] Alinhar tarefas e referências; verificar documentação e publicar o
      complemento em commit/push na PR 372 da RFC, sem alterar runtime.

## WAP-T00b — revisar Cliente oficial, vínculo e primeira mensagem

- [x] Conferir Contact, cadastro manual, colisão de telefone, identidade por
      conta e envio atual que exige conversa; preservar ADR 033 e regra 2.
- [x] Explicitar quando o Cliente aparece, vínculo antes de parear, reutilização
      do contactId e limites de compartilhamento; WAP-20–24 e cenários negativos.
- [x] Propor primeiro envio humano na etapa 1 sem inbound fictícia, separado de
      salvar/vincular; acrescentar D5 e impacto transacional em WAP-T01/02/04/05.
- [x] Validar documentação, revisar consistência, commit/push e PR de revisão.

Protótipo conceitual da conversa usa dados simulados; não é implementação,
prova do provedor ou mudança no CRM local. Regras propostas continuam sujeitas
ao aceite naquele momento; WAP-T00c registra a decisão posterior. WAP-T00b
não mudou RULES ou runtime.

Evidência WAP-T00b: formatação dos quatro documentos focalizados e 213
referências locais nos cinco arquivos verificadas; 24 IDs de requisito únicos;
`git diff --check` sem falhas. Revisão independente confirmou Contact/vínculos,
identidade, colisões e envio humano; corrigiu a contradição do onboarding para
permitir cadastro antes de parear e aprovou o delta final. Sem testes de runtime
para esta entrega documental. A prévia simulada foi conferida em 320 px e no
desktop: cadastro sem pareamento, vínculo/replay sem cópia, duplicata com
conferência, primeiro envio por Enter sem inbound no mesmo Cliente, cobrança
separada e bloqueio de envio offline; zero erro JavaScript. Não é prova live.

## WAP-T00c — aceite D1–D5, cadastro compartilhado e prioridade do Pedido

- [x] Registrar aceite do PO em 15/11/2026 na RFC e ADR 090: um único número
      por vendedor, atendimento passivo/humano, etapas e importação até 30 dias,
      QR/código, primeiro envio opcional e regras de edição compartilhada.
- [x] Acrescentar WAP-25–33 e gate prioritário de criar Pedido pela conversa
      sem sugestão da IA, primeiro envio, cadastro completo ou canal online.
- [x] Alinhar RULES, spec/PRD, ARCHITECTURE/TDD, índices e tarefas preservando
      decisões anteriores e os contratos comerciais de pedidos/cobranças.
- [x] Verificar referências/formatação/rastreabilidade/diff; commit/push e PR
      constam do handoff WAP-T00c. Sem execução ou ativação de runtime.

## Etapa 2 — WAP-T06 e WAP-T07

### WAP-T06 — carteira e histórico anteriores

WAP-07–08, 12–14, 16, 30. Produto, Integrações, Backend/Dados e QA/Privacidade.

- [ ] Medir dados disponíveis no recorte aprovado de até 30 dias, aplicar retenção
      vigente por tipo e
      distinguir contato, conversa, histórico e lacuna sem prometer agenda integral.
- [ ] Implementar prévia/seleção, confirmação, execução limitada, checkpoint,
      deduplicação e retomada; sem escrita direta n8n→banco CRM.
- [ ] Marcar origem histórica e impedir bot/recuperação/lembrete/contagem de
      venda ou lead novo; não importar grupos/status/agenda pessoal indiscriminada.
- [ ] Verificar importação parcial, repetição, isolamento e cutoff concorrente
      com inbound nova; UAT autorizado, gates, documentação, commit/push.

### WAP-T07 — troca de número e sucessão administrativa

WAP-04, 07–08, 10–12, 15–16. Backend/Dados, DevOps e QA/Privacidade.

- [ ] Implementar troca de número com prova e revogação da geração antiga;
      não mover retroativamente mensagens para outro remetente.
- [ ] Sucessão por Admin exige motivo, escopo/versão e transação de revogação/
      atribuição/auditoria, preservando crédito e pedidos históricos.
- [ ] Exercitar sessões abertas, SSE, cursores, operações/callbacks em voo,
      inativo e recovery; impedir autoapropriação de número desconectado.
- [ ] Registrar runbook, gates/rollback, piloto autorizado e aceite; commit/push.

# WhatsApp por vendedor — plano de execução enxuto

Revisão **WAP-T00e**, 16/11/2026. [Spec](spec.md), [design](design.md),
[prompts completos](PROMPTS.md), [ADR 090](../../../docs/adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md)
e [ADR 091](../../../docs/adr/091-contratos-da-etapa1-whatsapp-pessoal.md).

A unidade de execução é **WAP-E01–E12**. Os 32 itens T do SDD inicial são
checklist interno de rastreabilidade, agrupados abaixo; não requerem 32 chats,
PRs ou ciclos completos de preparação e validação. O gate prioritário é
**WAP-E07**, equivalente ao aceite WAP-T02a-05. Primeira saída continua depois.
Nenhum item de runtime está concluído por esta revisão documental.

## WAP-T00e — reduzir o custo de execução do SDD

- [x] Consolidar os 32 itens em 12 entregas com fronteiras coerentes, dependências
      explícitas, prompts completos e modelo escolhido por risco.
- [x] Manter todos os aceites e testes; preservar o mapa T→E para retomada sem
      retrabalho, incluindo o histórico WAP-T00d.
- [x] Validar correspondência, cobertura, DAG, links e formatação; evidências em
      [validation-sdd.md](validation-sdd.md).

## Unidade de entrega e gates

Execute E01 → E12 serialmente, com dependências integradas. E05 pode ter seu
schema e leitores preparados antes, mas só entrega o escritor após E04. Cada
E é uma entrega/PR revisável: seus itens T são passos internos na ordem
indicada, com commits atômicos quando houver fronteiras distintas. Sem branch
ou PR extra por subitem mecânico. Reuse o contexto e não repita gates completos
entre passos sem alteração/falha que justifique; rode-os uma vez na fronteira
integrada antes de publicar. Não pule teste negativo, PostgreSQL real sintético
ou a11y; redução de prompts não é dispensa de aceite.

Cada entrega que introduz efeito já traz guard fail-closed/default off; E11
apenas consolida configuração/capacidade. ACL/histórico persistem com flag off.
Os prompts leem instruções vigentes e preservam trabalho de outras sessões.
Não ativar runtime parcialmente protegido; sem produção ou efeito real até o
roteiro e autorização operacional aplicáveis. Etapa 2 segue fora desta execução.

## Registro das 12 entregas

| Estado / ID | Entrega                                                                          | Modelo       | Dependência     | Checklist interno                              |
| ----------- | -------------------------------------------------------------------------------- | ------------ | --------------- | ---------------------------------------------- |
| [ ] WAP-E01 | [Provar viabilidade do provedor e privacidade](PROMPTS.md#wap-e01)               | Sol/Opus     | Base documental | WAP-T01-01                                     |
| [ ] WAP-E02 | [Entregar conexão pessoal no backend e n8n](PROMPTS.md#wap-e02)                  | Sol/Opus     | WAP-E01         | WAP-T01-02, WAP-T01-03, WAP-T01-04             |
| [ ] WAP-E03 | [Entregar carteira e cadastro compartilhado no servidor](PROMPTS.md#wap-e03)     | Sol/Opus     | WAP-E02         | WAP-T02-01, WAP-T02-02, WAP-T02-03, WAP-T02-04 |
| [ ] WAP-E04 | [Receber atendimento humano com isolamento ponta a ponta](PROMPTS.md#wap-e04)    | Sol/Opus     | WAP-E03         | WAP-T02-05, WAP-T02-06, WAP-T02-07             |
| [ ] WAP-E05 | [Criar Pedido por Assunto com compatibilidade transacional](PROMPTS.md#wap-e05)  | Sol/Opus     | WAP-E04         | WAP-T02a-01, WAP-T02a-02, WAP-T02a-03          |
| [ ] WAP-E06 | [Entregar a interface mínima de Pedido pela conversa](PROMPTS.md#wap-e06)        | Terra/Sonnet | WAP-E05         | WAP-T02a-04                                    |
| [ ] WAP-E07 | [Aceitar o fluxo passivo integrado de Pedido](PROMPTS.md#wap-e07)                | Sol/Opus     | WAP-E06         | WAP-T02a-05                                    |
| [ ] WAP-E08 | [Completar mensagens correntes e efeitos pela linha correta](PROMPTS.md#wap-e08) | Sol/Opus     | WAP-E07         | WAP-T02-08, WAP-T03-01, WAP-T03-02, WAP-T02-09 |
| [ ] WAP-E09 | [Completar Meus clientes e Meu WhatsApp na interface](PROMPTS.md#wap-e09)        | Terra/Sonnet | WAP-E08         | WAP-T04-01, WAP-T04-02, WAP-T04-05             |
| [ ] WAP-E10 | [Entregar primeiro envio humano individual](PROMPTS.md#wap-e10)                  | Sol/Opus     | WAP-E09         | WAP-T04-03, WAP-T04-04                         |
| [ ] WAP-E11 | [Concluir verificação e prontidão operacional](PROMPTS.md#wap-e11)               | Sol/Opus     | WAP-E10         | WAP-T05-01, WAP-T05-02, WAP-T05-03, WAP-T05-04 |
| [ ] WAP-E12 | [Homologar o piloto real da etapa 1](PROMPTS.md#wap-e12)                         | Sol/Opus     | WAP-E11         | WAP-T05-05, WAP-T05-06, WAP-T05-07             |

## Mapa de rastreabilidade dos 32 itens internos

As referências T existentes continuam válidas. Cada item pertence a exatamente
uma entrega E; seu checkbox só fecha quando o critério específico passar.
Os modelos e unidades de publicação são os da tabela E, que substitui a divisão
inicial de sessões/PRs por T.

| Estado / item   | Critério preservado                                      | Entrega executora             | Requisitos                        |
| --------------- | -------------------------------------------------------- | ----------------------------- | --------------------------------- |
| [ ] WAP-T01-01  | Provar controle, código mobile e privacidade do provedor | [WAP-E01](PROMPTS.md#wap-e01) | WAP-02/03/04/10/12                |
| [ ] WAP-T01-02  | Persistir linha pessoal e ledger de controle             | [WAP-E02](PROMPTS.md#wap-e02) | WAP-02/04/10/11/12                |
| [ ] WAP-T02-01  | Persistir vínculo durável de carteira                    | [WAP-E03](PROMPTS.md#wap-e03) | WAP-06/08/18/20/21/24/29          |
| [ ] WAP-T02-02  | Aplicar escrita compartilhada por campo                  | [WAP-E03](PROMPTS.md#wap-e03) | WAP-25/26/27/28/29/30             |
| [ ] WAP-T02-03  | Isolar leituras de Clientes e projeções comuns           | [WAP-E03](PROMPTS.md#wap-e03) | WAP-07/08/20/21/24/28             |
| [ ] WAP-T02-04  | Compor cadastro e vínculo de Cliente                     | [WAP-E03](PROMPTS.md#wap-e03) | WAP-18/20/21/24/29                |
| [ ] WAP-T01-03  | Expor comandos e estado de controle pessoal              | [WAP-E02](PROMPTS.md#wap-e02) | WAP-01/02/03/04/10/11/12          |
| [ ] WAP-T01-04  | Conectar controle n8n e desafio efêmero                  | [WAP-E02](PROMPTS.md#wap-e02) | WAP-02/03/04/10/11/12             |
| [ ] WAP-T02-05  | Receber na linha pessoal com atribuição humana atômica   | [WAP-E04](PROMPTS.md#wap-e04) | WAP-04/05/06/08/10/20/21/32       |
| [ ] WAP-T02-06  | Proteger conversa e leituras auxiliares da linha         | [WAP-E04](PROMPTS.md#wap-e04) | WAP-07/08/17/28                   |
| [ ] WAP-T02-07  | Cercar eventos, replay e revogação de acesso             | [WAP-E04](PROMPTS.md#wap-e04) | WAP-07/11/28/29                   |
| [ ] WAP-T02a-01 | Adicionar origem de Assunto ao Pedido                    | [WAP-E05](PROMPTS.md#wap-e05) | WAP-17/31/33                      |
| [ ] WAP-T02a-02 | Resolver Pedido por alvo sem escolha arbitrária          | [WAP-E05](PROMPTS.md#wap-e05) | WAP-17/30/31/33                   |
| [ ] WAP-T02a-03 | Criar ou reutilizar Pedido no alvo transacional          | [WAP-E05](PROMPTS.md#wap-e05) | WAP-17/31/33; OA-05/07            |
| [ ] WAP-T02a-04 | Entregar fluxo passivo de Pedido em Meus clientes        | [WAP-E06](PROMPTS.md#wap-e06) | WAP-01/17/31/32/33                |
| [ ] WAP-T02a-05 | Verificar gate prioritário ponta a ponta                 | [WAP-E07](PROMPTS.md#wap-e07) | WAP-17/19/31/32/33                |
| [ ] WAP-T02-08  | Revalidar linha na reserva e no despacho humano          | [WAP-E08](PROMPTS.md#wap-e08) | WAP-06/10/11/12/19                |
| [ ] WAP-T03-01  | Normalizar fato externo enviado pelo aparelho            | [WAP-E08](PROMPTS.md#wap-e08) | WAP-09/10/12                      |
| [ ] WAP-T03-02  | Persistir saída externa e reconciliar eco                | [WAP-E08](PROMPTS.md#wap-e08) | WAP-06/09/10/11                   |
| [ ] WAP-T04-01  | Completar cadastro e vínculo na carteira                 | [WAP-E09](PROMPTS.md#wap-e09) | WAP-01/17/18/20/21/24/25/26/27/29 |
| [ ] WAP-T04-02  | Entregar Meu WhatsApp e onboarding dispensável           | [WAP-E09](PROMPTS.md#wap-e09) | WAP-01/02/03/04/11/12             |
| [ ] WAP-T04-03  | Compor primeiro envio individual no servidor             | [WAP-E10](PROMPTS.md#wap-e10) | WAP-22/23/24/32                   |
| [ ] WAP-T04-04  | Expor compositor do primeiro envio opcional              | [WAP-E10](PROMPTS.md#wap-e10) | WAP-22/23/24/32                   |
| [ ] WAP-T02-09  | Preservar cobrança e preparo pela linha correta          | [WAP-E08](PROMPTS.md#wap-e08) | WAP-17/19/27/28/30                |
| [ ] WAP-T04-05  | Conservar contexto das ações comerciais na carteira      | [WAP-E09](PROMPTS.md#wap-e09) | WAP-17/19/25/28/30                |
| [ ] WAP-T05-01  | Consolidar flags, allowlist e limites sem ativação       | [WAP-E11](PROMPTS.md#wap-e11) | WAP-12/16                         |
| [ ] WAP-T05-02  | Auditar regressão funcional, a11y e privacidade          | [WAP-E11](PROMPTS.md#wap-e11) | WAP-01–12/17–33                   |
| [ ] WAP-T05-03  | Ensaiar rollback e recovery sem reativar efeitos         | [WAP-E11](PROMPTS.md#wap-e11) | WAP-10/11/12/16/29/33             |
| [ ] WAP-T05-04  | Consolidar roteiro operacional e evidências              | [WAP-E11](PROMPTS.md#wap-e11) | WAP-12/16; WAP-T05                |
| [ ] WAP-T05-05  | Homologar fluxo passivo real de Pedido                   | [WAP-E12](PROMPTS.md#wap-e12) | WAP-04/05/07/17/31/32/33          |
| [ ] WAP-T05-06  | Homologar pareamento mobile e sincronização reais        | [WAP-E12](PROMPTS.md#wap-e12) | WAP-01/02/03/04/09/10/11/12       |
| [ ] WAP-T05-07  | Homologar ações comerciais e primeiro envio do piloto    | [WAP-E12](PROMPTS.md#wap-e12) | WAP-17–30/32                      |

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

## Conclusão dos épicos por checklist interno

- WAP-T01: T01-01–04, provas de controle e privacidade sem habilitação implícita.
- WAP-T02: T02-01–09, sem exposição parcial de carteira ou despacho inseguro.
- WAP-T02a: T02a-01–05, gate prioritário integrado, independente da primeira saída.
- WAP-T03: T03-01/02 e evidência real T05-06.
- WAP-T04: T04-01–05 e superfícies passivas entregues em T02a-04.
- WAP-T05: T05-01–07; piloto e aceite real são separados da evidência sintética.

Não marcar épico só porque migração, QR, chat ou teste isolado passou.

## Histórico WAP-T00d — SDD inicial

WAP-T00d entregou originalmente 32 prompts em 16/11/2026. A revisão WAP-T00e
reduz a execução a 12 entregas sem alterar ADR 091 ou critérios de produto.
O gate prioritário passa a ser acompanhado como E07, mantendo o ID T02a-05.

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

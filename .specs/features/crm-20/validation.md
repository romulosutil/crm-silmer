# Validação e regressão do CRM Silmer 2.0

Aplicar os gates de cada tarefa no [plano](tasks.md) aos cenários da
fronteira que ela já entrega. G00 se aplica a toda entrega. T06 e T14
comprovam também as regressões entre fronteiras, com as dependências
integradas. Execuções documentais e de runtime têm registros distintos.

## Matriz de gates

| Gate                             | Risco coberto                                                                      | Testes e evidência mínima                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G00 — Integridade da entrega     | Contrato incompleto, teste omitido ou diferença no SHA avaliado                    | `git diff --check`, formato, links, IDs, dependências acíclicas, um prompt por tarefa, checks obrigatórios e estado da revisão. Para código, executar também os gates do [guia](../../../CONTRIBUTING.md).                                                                                                                                                                          |
| G01 — Compatibilidade de domínio | Quebrar comportamento atual de Clientes, Conversas, Assuntos e Pedidos             | Cadastro manual sem canal, busca, carteira, pedido manual e da loja, pedido pendente/confirmado/reaberto/cancelado, PDF e snapshot, pós-venda pelo Assunto, arquivo versus encerramento, novo ciclo, handoff definitivo e filtros da Inbox. Manter cenários existentes e acrescentar caracterização para lacunas do fluxo alterado.                                                 |
| G02 — Autorização e privacidade  | Expor existência, valores, conteúdo ou origem de recursos restritos                | Testar API e, para consumidores, E2E. Comparar resultados com e sem recurso oculto por ID direto, cursor, contador, acesso revogado, SSE e pedido ligado a conversa oculta. Cobrir titular, terceiro, supervisor designado, outro admin, vendedor da linha geral, Financeiro e sessão revogada. Prospectar vazamento por erros, URLs, replay, nomes de linha e dados enviados à IA. |
| G03 — Identidade e concorrência  | Duplicar clientes ou associar pessoas diferentes                                   | PostgreSQL 17 com duas conexões sincronizadas para o mesmo telefone em duas linhas. Exercitar número formatado, número digitado, opaco, compartilhado, expirado/reciclado, candidato conflitante, dois Contatos já estabelecidos, associação revogada e erro no meio da transação. Verificar um Contato elegível, dois ciclos e métricas sem efeitos duplicados.                    |
| G04 — n8n, worker e ordenação    | Abrir novo ciclo por replay, enviar duas vezes ou bot voltar ao atendimento humano | Fixture sanitizada e contrato ponta a ponta em ambiente isolado. Cobrir mensagem fora de ordem, replay após fechar, deduplicação por evento/mensagem, primeiro envio, saída do aparelho, eco concorrente, resultado incerto, mudança de geração, reserva, epoch, revisão, linha pessoal humana e handoff terminal. Exercitar consumidor anterior e configuração desabilitada.       |
| G05 — UX e acessibilidade        | Perder foco, misturar clientes ou bloquear o atendimento com consulta indisponível | Playwright e axe nos fluxos tocados, teclado, foco após abrir/fechar/retornar, viewport móvel, carregamento, erro, vazio, revogação, paginação e resposta atrasada após trocar de cliente. Confirmar continuidade de leitura e envio da Inbox durante falha da projeção.                                                                                                            |
| G06 — SQL, upgrade e capacidade  | Lock longo, consulta sem índice ou incompatibilidade de deploy                     | PostgreSQL 17 em banco dedicado com dados sintéticos. Upgrade desde release anterior e contrato baseline sobre esquema expandido. Registrar planos de consulta, volumetria, p95, timeout, locks e saturação de pool sob carga representativa aprovada. Repetir ACL sobre casos com alto volume e contatos sem dados.                                                                |
| G07 — Reconciliação              | Corrupção, perda ou duplicação de históricos em lote                               | Contagens e integridade referencial por entidade e por lote, pedidos/snapshots, amostra autorizada de exceções, resultado igual em reexecução, interrupção entre batches, retomada pelo checkpoint e reversão seletiva demonstrada. Toda divergência precisa de causa e aceite registrados.                                                                                         |
| G08 — Recuperação                | Rollback ampliar acesso ou apagar fatos já ocorridos                               | Exercitar flag desabilitada, binário anterior compatível, reversão com versão, evento em trânsito e efeito externo incerto. No ensaio aprovado, comprovar backup restaurável com as chaves corretas, reconciliar com tombstones de privacidade e registrar RPO/RTO observados segundo o runbook.                                                                                    |
| G09 — Homologação                | Confundir CI verde com capacidade operacional                                      | T06 comprova leitura e fallback em homologação. T14 ensaia duas linhas elegíveis, replay e interrupção com dados sintéticos. Ambos registram SHA, imagem, configuração, flags, monitoramento e responsáveis. Antes de ativar em produção, Operação e Tech Lead confirmam o artefato final implantado e repetem os checks de compatibilidade e configuração.                         |
| G10 — Encerramento               | Sugerir ou remover atendimento com pendência                                       | Cobrir pedido confirmado, reaberto e cancelado, múltiplos Assuntos, pendência de cobrança/operação, alteração de permissão, nova mensagem concorrente e sugestão que expirou. Confirmar que a sugestão sozinha não encerra, envia, muda nó do workflow ou expurga mídia. Fechamento automático exige nova matriz após decisão.                                                      |

## Como executar

Para código, executar `npm run validate`, `npm run test:e2e`,
`npm audit --audit-level=high` e `git diff --check` conforme o guia.
Executar suítes PostgreSQL afetadas com `TEST_DATABASE_URL` apontado para
ambiente dedicado e sintético. Confirmar a inclusão de suítes novas em
[`run-postgres-live-ci.mjs`](../../../scripts/run-postgres-live-ci.mjs)
e nos checks exigidos do
[CI](../../../.github/workflows/ci.yml). Gates adicionais de topologia,
privacidade, observabilidade e recovery se aplicam conforme a fronteira
tocada. Evitar executar testes destrutivos em ambientes compartilhados.

Pontos de partida para a caracterização:

- [Identidade de Contatos](../../../test/contact-identity.test.js) e
  [cadastro e telefone](../../../test/contact-details.test.js).
- [Ciclo e Assuntos com PostgreSQL](../../../test/inbox-postgres-live.test.js),
  [n8n com PostgreSQL](../../../test/n8n-integration-postgres-live.test.js) e
  [saída do WhatsApp pessoal](../../../test/integration/seller-whatsapp-outbound.test.js).
- [Pedido manual e loja](../../../test/orders-postgres-live.test.js),
  [cancelados e indicadores](../../../test/cancelled-orders-dashboard-postgres-live.test.js)
  e [cancelados e Assuntos](../../../test/cancelled-orders-inbox-subject-postgres-live.test.js).
- [Redesign da Inbox](../../../test/e2e/inbox-redesign.spec.js),
  [isolamento de linhas](../../../test/e2e/seller-whatsapp-isolation.spec.js) e
  [carteira em E2E](../../../test/e2e/seller-whatsapp-portfolio.spec.js).

## Critério de bloqueio

Uma regressão nova ou falha reproduzível nos fluxos afetados bloqueia merge
e ativação. Flakiness que reaparece também bloqueia. Diagnosticar no mesmo
ambiente, registrar a causa, corrigir e demonstrar que a regressão tem um
teste que falha antes da correção e passa depois. Executar novamente os
gates relevantes no SHA final. Skip, quarentena, timeout inflado ou retry
até ficar verde não satisfazem um gate obrigatório. Se o ambiente não
permite executar, manter o gate pendente e obter evidência em ambiente
de teste adequado.

Cada evidência inclui tarefa e gate, SHA, versões relevantes, ambiente,
comando, quantos casos passaram/falharam/foram pulados e vínculo para
execução ou resultado redigido sem PII. Cenários de um gate exigido têm
zero falhas e zero skips. Registrar diferenças de dados aceitas com dono,
motivo e decisão. O [pré-mortem](pre-mortem.md) define sinais de interrupção.

## Evidência inicial C20-T00

Em 24/11/2026, sobre `origin/master` `0c89a1c7`, a alteração documental
passou no Prettier, na auditoria de links locais e na conferência de
correspondência entre 13 requisitos, 17 tarefas, prompts e modelos, 11 gates
e 5 decisões. A ordem de dependências é acíclica.

A suíte padrão `npm test` rodou como verificação adicional da baseline no
Windows com Node `24.21.0` e npm `11.19.0`, com 3.060 aprovações, zero
falhas e 62 skips. As suítes que exigem PostgreSQL dedicado não foram
exercitadas nesta execução. Esta evidência documenta a baseline local.
G01–G10 continuam pendentes para as tarefas de implementação e homologação.

# Prompts para gerar venda Olist pelo pedido confirmado

O fluxo é abrir um Pedido **Confirmado**, clicar em **Gerar no Olist** e acompanhar o resultado na mesma página. A integração usa os dados estruturados do Pedido, sem enviar ou interpretar o PDF.

**Regra corrigida pelo proprietário:** cadastro completo e válido é obrigatório para gerar no Olist. Ele não é obrigatório para salvar ou confirmar o Pedido nem para gerar a ficha/PDF. O bypass por cadastro vazio ou parcial entregue no commit 865388f0 é uma regressão a corrigir, conforme a [ADR 082](../../adr/082-cadastro-obrigatorio-somente-no-envio-olist.md).

## O que mudou nas últimas 12 horas

Levantamento em **10/11/2026, às 13h54, horário de São Paulo**. Janela analisada: **01h54 a 13h54**. Base: master atualizada, commit **865388f0**. Foram conferidos os commits integrados nessa janela e seus arquivos de origem; branches não integradas não contam como entrega.

| Entrega identificada                                                                                | Evidência                                                           | Consequência para os prompts                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cadastro vazio/parcial passou a usar comprador ERP por nome e telefone                              | Commit 865388f0; ADR 081; existing-buyer.js e olist-preview-plan.js | Contraria o esclarecimento do proprietário. Corrigir nos blocos 1–4 e preservar a independência da confirmação/PDF.                                      |
| Frete foi especificado como parte do total, com decisões P1–P3 confirmadas                          | Commits 18f5e657, 3d89b990 e d8200857; ADR 080 / RFC 062            | É contrato aprovado, ainda sem campo de frete no Pedido. Continua trabalho dos blocos 1–4.                                                               |
| Ativação das cobranças foi registrada primeiro para recebimento e depois para emissão/envio         | Commits 2b2b6da2 e 57b5ea70; BREL-10/T9                             | Preservar funções e flags já ativadas. Teste manual de pagamento e homologação real continuam pendentes; não confundir ativação com quitação comprovada. |
| Registro de produção do Melhor Envio foi integrado                                                  | Commit f312e0e6; runbook Melhor Envio                               | Reutilizar conexão/cotação. A data da ativação descrita no runbook é anterior à janela; integrar esse registro não implementa frete no total.            |
| Ficha v8 por item, fonte local, rótulo Modelo e ajuste de paginação Linux foram entregues no código | Commits 8fd8f04a e eb36ec8d; FPI-T01                                | Preservar componentes, templates e amostras. PRINT_TEMPLATE continua v6; aprovação, troca e assinatura são gates próprios.                               |
| Desempenho da equipe e fila de espera foram adicionados ao Dashboard                                | Commits a148a741 e 2845f889                                         | Adaptar apenas a leitura do total com frete. Preservar métricas, componentes e permissões entregues.                                                     |
| Testes de banco, polling n8n, autorização e limites SSE foram reforçados                            | Commits e60c3369, 9f23aa1c, 4465f30e e 8f2b5bb4                     | Reutilizar a cobertura; não refazer essas entregas como parte de Olist.                                                                                  |
| Regra de checkout único e branches curtos foi registrada                                            | Commit 769e81a4; AGENTS.md                                          | Uma sessão altera o checkout; partir da master limpa/atualizada, usar branch curta e PR, sem push direto à master.                                       |

A correção documental da ADR 082 é posterior ao levantamento. Ela registra a orientação do proprietário; a correção funcional do cadastro ainda está pendente.

## Como copiar e executar

Cada bloco abaixo contém **um prompt completo em uma única caixa de código**. Copie a caixa do bloco desejado; não é necessário juntar regras de várias partes do documento.

Execute os blocos **1 → 2 → 3 → 4 → 5 → 6**, conferindo a entrega anterior. Os blocos **7 e 8 são independentes** e não bloqueiam a geração. Os checkboxes OLC representam a adequação ao fluxo vigente, não a ausência de todo o código existente.

| Bloco | Ponto de partida que deve ser reaproveitado                                              | Trabalho restante                                                                 |
| ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1     | Preços por tamanho, total calculado, composição de legado, checkbox e controle de acesso | Corrigir gate de cadastro, implementar frete e ajustar contratos necessários      |
| 2     | modules/olist: conexão, client, recursos, payload, inspector e quotas                    | Adequar cadastro e frete sem reconstruir o adapter                                |
| 3     | API de exportação, reservas, ledger, dispatcher, worker e recuperação                    | Restringir a confirmado e integrar o comando direto com os gates atuais           |
| 4     | OrderOlistPanel, editor de valores, UsersView e configuração administrativa              | Simplificar a jornada e integrar frete/pendências corretas                        |
| 5     | Testes e runbooks Olist, billing, shipping e impressão                                   | Verificar a adequação integrada sem reabrir entregas concluídas                   |
| 6     | Restrição de piloto e mecanismos de ativação/recuperação existentes                      | Confirmar estado operacional atual e executar caso real somente quando autorizado |

Fontes: [spec OLC](../../../.specs/features/olist-confirmed/spec.md), [tarefas OLC](../../../.specs/features/olist-confirmed/tasks.md), [ADR 079](../../adr/079-olist-a-partir-do-pedido-confirmado.md), [ADR 080](../../adr/080-valor-final-com-frete.md), [ADR 082](../../adr/082-cadastro-obrigatorio-somente-no-envio-olist.md) e [RFC 062](../../rfc/062-valor-final-com-frete.md).

## Bloco 1 Dados e autorização

**Tarefa:** OLC-T01. **Estado:** parcial; adaptar o existente e corrigir cadastro antes de liberar envio.

```text
Execute OLC-T01 de .specs/features/olist-confirmed/tasks.md.
Leia AGENTS.md, RULES.md, a spec OLC e as ADRs 079, 080 e 082.
Use a master atualizada como ponto de partida e preserve mudanças de terceiros.

Objetivo: preparar dados e autorização para gerar no Olist somente a partir de Pedido confirmado, reaproveitando o código existente.

1. Corrija primeiro a regressão do commit 865388f0. Cadastro completo e válido é obrigatório para novo envio Olist; cadastro vazio, parcial ou inválido bloqueia somente essa integração. Nome/telefone ou referência ERP não dispensam o cadastro. Salvar/confirmar o Pedido e gerar ficha/PDF continuam sem esse requisito.

2. Reaproveite checkbox, gestão de usuários, modules/olist/src/access.js, migrations 0063–0065, preços por tamanho e composição de legado já existentes. Humano ativo + leitura comercial do Pedido + Habilitado Olist + piloto são obrigatórios. Admin não herda geração. Não acrescente acesso ao perfil Financeiro.

3. Implemente o frete aprovado na ADR 080 e OLC-05a–j. Dado aditivo em centavos inteiros não negativos, default zero, versionado, auditado e com origem. Somente o vendedor responsável informa/aplica frete em Pedido pendente. Admin não responsável, outro vendedor, automação e alteração em confirmado são negados.

4. Reutilize modules/shipping e conversation-shipping-runtime.js como origem de sugestão. O comando recebe a identidade da cotação/serviço; o servidor lê o preço e confere Pedido, serviço e validade. Não aceite preço de cotação do navegador. Cotação nova/desatualizada não muda frete gravado. Divergência ou origem desatualizada é aviso, sem bloquear confirmação por si só. Não crie alçada para zero, já no preço ou abaixo do cotado.

5. Pedido novo: mantenha subtotais existentes e calcule no backend peças + frete. Não reintroduza total digitado. Quantidade não muda frete automaticamente. Confirmação congela peças/frete/origem/total e recusa valor declarado divergente. Pedido legado/loja com apenas total usa composição aditiva 1:1, sem rateio nem reprecificação, frete zero e snapshot preservado.

6. Reutilize registros, reservas, referências e guardas existentes; altere somente contratos necessários. Pagamento/entrega compatíveis não invalidam conteúdo exportável apenas por incremento de versão global. Preservar cobrança, quitação, histórico, Dashboard e impressão v6/v7/v8.

Pode editar Orders, Contacts, Identity Access, rotas/runtimes API, migrations expand, OpenAPI e testes; para frete, pontos necessários de shipping, billing e Dashboard. Não remova Financeiro nem altere workflows ou dados reais.

Verifique cadastro vazio/parcial/completo: confirmação/PDF independentes, exportação bloqueada quando necessário, inclusive com token/job antigo. Cubra frete zero/positivo/inválido/overflow, autorização, cotação de outro Pedido/desatualizada, preço do navegador, idempotência, concorrência, legado/loja e reconfirmação com cobrança.

Use banco dedicado e dados sintéticos. Entregue diff, testes/resultados, migração/rollback, riscos e commit/push/PR conforme AGENTS.md. Não marque OLC-T01 concluída apenas por código já existente. Nenhuma escrita real ao ERP é autorizada por este prompt.
```

## Bloco 2 Conexão e comunicação com Olist

**Tarefa:** OLC-T02. **Depende de:** OLC-T01. **Estado:** adapter existente; adequar cadastro e frete.

```text
Execute OLC-T02 após conferir OLC-T01 e seus contratos.
Leia AGENTS.md, RULES.md, spec/tarefas OLC e ADRs 079, 080 e 082.

Objetivo: adaptar a integração existente, sem reconstruir conexão e client.

1. Confira modules/olist/src/connection.js, client.js, resource-resolver.js, resource-writer.js, sale-payload.js e readonly-inspector.js. Reutilize credenciais cifradas, renovação serializada, conta esperada, configuração central, reservas e quotas. Não crie conexão paralela nem execute scripts de prova como runtime.

2. Aplique cadastro completo obrigatório somente ao novo envio Olist. Ajuste olist-preview-plan.js e a resolução necessária para impedir bypass por cadastro vazio/parcial e busca por nome/telefone. Valide identidade com dados completos sem sobrescrever cadastro ERP ou misturar fontes parciais. Preserve os contratos administrativos de vínculo histórico.

3. Adapte valorFrete, hoje aceito apenas ausente/zero. Envie o frete congelado do Pedido fora dos unitários. Confira em centavos: total de produtos = soma das linhas; total da venda = produtos + frete. Não exija que os dois totais sejam iguais quando há frete positivo. valorFrete ausente só equivale a zero se o frete esperado for zero.

4. Mantenha valorDesconto e valorOutrasDespesas zero, identidades estáveis e conferência exata da ADR 062. Não dilua frete em preço, compense linhas, arredonde negociação ou aceite divergência. Preserve ID remoto e bloqueie repetição criadora em resultado incerto.

5. Não reconfigure Melhor Envio ou InfinitePay: suas ativações estão registradas. Olist tem conexão, credenciais e gates próprios. Não inferir vendedor ERP pelo usuário CRM nem emitir fiscal, estoque ou baixa.

Pode editar adapter, API/worker, configuração, contratos OpenAPI, testes e runbook da fronteira. Preserve Financeiro, billing e templates. Não acrescente infraestrutura.

Teste cadastro incompleto/completo, frete zero/ausente/positivo/divergente/fracionário, quotas, renovação, timeout, resposta sem ID e leitura divergente com fixtures sintéticas. Entregue evidências, contratos, limitações, rollback e commit/push/PR. Não use credenciais, IDs ou journals das provas como dados do runtime. Nenhum POST real está autorizado.
```

## Bloco 3 Geração e recuperação

**Tarefa:** OLC-T03. **Depende de:** OLC-T01 e OLC-T02. **Estado:** comando/worker existentes; refatorar a jornada.

```text
Execute OLC-T03 após conferir OLC-T01/T02.
Leia AGENTS.md, RULES.md, spec OLC e ADRs 079, 080 e 082.

Objetivo: aceitar Gerar no Olist por Pedido confirmado e concluir uma única venda conferida.

1. Reutilize apps/api/src/olist-export-command.js, olist-runtime.js, modules/olist/src/dispatcher.js, repository.js e apps/worker/src/olist-runtime.js. Preserve ledger, reservas por identidade, invalidação administrativa, quota e recuperação existentes. Não recrie tabelas ou um segundo dispatcher.

2. Restrinja geração a confirmado. Integre validação e aceitação em um comando pelo Pedido, sem impor tela/previewId de prévia ao usuário. Pode reutilizar validação interna e seus mecanismos de prova; não remova proteção para reduzir um gesto.

3. Exija cadastro completo na aceitação e antes dos efeitos, inclusive com token antigo, job já enfileirado ou cadastro alterado. Cadastro incompleto bloqueia somente exportação, sem impedir confirmação/PDF. Efeito já iniciado é reconciliado; não apagar nem repetir para aplicar a correção.

4. Valide peças + frete congelado = total do Pedido antes de inclusões. Congele conteúdo/configuração e preserve a aceitação transacional de reserva, snapshot cifrado, auditoria e job. Reutilize o que já existe e adapte apenas as diferenças do contrato.

5. Execute cliente → produtos/variações → venda com IDs confirmados preservados. Revalide status, revisão comercial, conexão, checkbox e piloto antes de cada efeito. Serialize com reabertura/correção da loja. Pagamento/entrega compatíveis não devem interromper conteúdo inalterado apenas por mudar a versão global.

6. Preserve uma operação ativa por conta/Pedido, gerações arquivadas e referências estáveis. Duas abas/chaves e replay não criam segunda venda. Falha pré-efeito só retoma com prova; incerteza ou busca vazia não autoriza novo POST. Recupere administrativamente a própria operação sem exigir vínculo genérico novo.

Pode editar aplicação/repositórios Orders e Olist, API/worker, migrations compatíveis, OpenAPI, testes e runbook. Preserve Financeiro, billing, impressão e históricos. Não altere comportamento do cancelamento OLC-F03 nesta tarefa; mantenha filtros de cancelados.

Verifique concorrência com conexões/processos independentes, cadastro incompleto e token/job antigo, revogação, falha após cada cadastro, resposta perdida, commit falho após sucesso remoto e divergência de frete/valores. Use dados sintéticos, sem escrita real. Entregue evidências, rollback e commit/push/PR.
```

## Bloco 4 Interface dentro do pedido

**Tarefa:** OLC-T04. **Depende de:** OLC-T01 a OLC-T03. **Estado:** painel existente; simplificar e conectar os ajustes.

```text
Execute OLC-T04 após conferir OLC-T01–T03.
Leia AGENTS.md, RULES.md, spec OLC, ADRs 079/080/082 e design.md.

Objetivo: no detalhe de Confirmado, clicar Gerar no Olist e acompanhar a operação na mesma página.

1. Reutilize OrderOlistPanel.vue, OrderPricedItemsSection.vue, olist-feedback.js, UsersView e configuração administrativa existentes. Releia os componentes atuais antes de editar: rótulo Modelo, ficha v8 por item e melhorias do Dashboard já foram entregues. Preserve Gerar pedido, Gerar PDF, billing, loja e todos os templates/gates.

2. Corrija a separação de pendências. Cadastro completo é obrigatório no bloco Olist: mostre campos faltantes e quem pode corrigir; não apresente cadastro como opcional nem esconda o bloqueio para habilitar envio. Essas pendências não entram no progresso de fechar o Pedido ou gerar PDF. Evite motivos duplicados; o resumo visual não substitui a validação do servidor.

3. Mantenha subtotais e total somente calculado. Exiba peças, frete/origem e total, inclusive no pendente e em Gerar pedido. Só o vendedor responsável edita/aplica frete em pendente. A sugestão vem do servidor; cotação desatualizada/divergente exibe aviso. Confirmado mostra frete somente leitura; legado/loja preservam total e composição autorizada.

4. Adapte o painel atual para Gerar no Olist com validação interna, sem diálogo/tela de prévia obrigatória. Reutilize o backend entregue nos blocos anteriores. Não crie novo menu, busca ou assistente para essa jornada. Não apague ferramentas administrativas/históricas existentes apenas porque não são entrada do vendedor.

5. Mostre Aguardando processamento, Processando… com etapa e Gerado no Olist · Venda nº … com número CRM. Reload recupera o estado. Falha de consulta oferece Atualizar situação só de leitura; incerteza mostra Conferência necessária, sem retry criador. Retomar geração só aparece se o servidor comprovar segurança.

Pode editar componentes/composables do Pedido, gestão/configuração necessária, CSS pelos tokens e E2E. Não remova FinanceView, refaça Dashboard, troque PRINT_TEMPLATE ou reescreva a ficha v8.

Teste teclado, foco, ARIA, axe, temas, 320/390 px, desktop, duas abas e revogação. Confirme cadastro vazio/parcial permitindo fechar/gerar PDF e bloqueando exportação. Teste UI/API/banco local além de mocks. Entregue evidências e commit/push/PR; mock não comprova geração operacional.
```

## Bloco 5 Verificação e preparo de publicação

**Tarefa:** OLC-T05. **Depende de:** OLC-T01 a OLC-T04. **Estado:** conferir o conjunto adaptado.

```text
Execute OLC-T05 após conferir OLC-T01–T04.
Leia AGENTS.md, RULES.md, spec OLC, ADRs 079/080/082 e CONTRIBUTING.md.

Objetivo: validar a adequação integrada e preparar publicação sem confundir código, ativação e homologação.

1. Reutilize testes e runbooks Olist existentes. Cubra cadastro obrigatório somente na exportação, frete e totais, confirmado/pendente, ACL, idempotência, concorrência, incerteza, reabertura/correção e filtros de cancelados. Testes de tokens/jobs antigos precisam impedir contorno do novo gate de cadastro.

2. Execute git diff --check, npm run validate, npm run test:e2e, npm audit --audit-level=high e suítes live/gates pertinentes já existentes. Não invente scripts, remova assertions ou substitua gate real por mock.

3. Preserve regressão da ficha v8/Modelo, impressão selecionada e templates anteriores, métricas/permissões do Dashboard, billing ativado, envio financeiro e cotação Melhor Envio. Não execute teste de pagamento, mensagem ou venda real como probe.

4. Leia os estados mais recentes em order-billing-activation.md, validation-manual-activation.md e melhor-envio.md. Billing está ativado para teste manual, sem homologação financeira registrada; a cotação não é frete incorporado ao total. Não desligue flags existentes para preparar Olist.

5. Atualize runbook Olist por etapa, configuração/fiscal, quota, retenção/PII, cadastro, frete, reconexão, restore e rollback. Verifique migrations/digest/health no alvo quando autorizado. Preserve a configuração operacional e mantenha novas inclusões Olist protegidas pelos gates de piloto.

Pode editar testes, evidências sanitizadas e runbook; coordene correções em código com o dono da fronteira. Não exija remoção Financeiro, restrição OLC-F03, busca ou troca de ficha como requisito de liberação.

Entregue achados priorizados, resultados, riscos e pendências. Código local e flag ativa não comprovam efeito real. Registre commit/push/PR conforme AGENTS.md.
```

## Bloco 6 Piloto e aceite

**Tarefa:** OLC-T06. **Depende de:** OLC-T05. **Estado:** verificar o ambiente atual antes de qualquer efeito.

```text
Execute OLC-T06 somente após o gate OLC-T05.
Leia AGENTS.md, RULES.md, spec OLC, ADRs 079/080/082 e o runbook Olist final.

Objetivo: comprovar Confirmado → Gerar no Olist → venda conferida com a conta/operadora corretas.

1. Reutilize OLIST_PILOT_USER_IDS e comandos administrativos de criação/recuperação já existentes. Confira estado real de conexão, parâmetros, recovery_required, checkbox, conta e versão antes de ativar ou reconfigurar. Não presuma que tudo está desligado ou que a ativação financeira habilita Olist.

2. Prepare um caso revisável: Pedido confirmado ainda não lançado, comprador com cadastro completo e válido, produtos/tamanhos, peças, frete congelado, total e efeitos esperados. Cadastro incompleto impede esse piloto, embora o Pedido e o PDF possam existir normalmente.

3. Verifique venda manual anterior para não duplicá-la. Se existir, escolha outro caso ou encaminhe ao contrato administrativo vigente; não improvise vínculo nem repita criação. Respeite efeitos/journals já existentes.

4. Obtenha autorização explícita do caso real se ela ainda não existir na sessão. Este prompt não autoriza por si só POST real, checkout, mensagem, pagamento, nota ou estoque. Prepare tudo que for reversível antes de pedir a aprovação final.

5. Após autorização, execute pelo detalhe do CRM e confira comprador, produtos, tamanhos, quantidades, subtotais, valorFrete e totais: produtos = soma das linhas; venda = produtos + frete. O frete foi informado pelo responsável antes da confirmação; não altere confirmado para montar o caso.

6. Confira reload/replay sem duplicidade e recuperação prevista, sem injetar falha destrutiva em dados reais. Registre versão/digest, migrations, evidência sanitizada, suporte e aceite PO/Operação. Incerteza interrompe novas inclusões e exige reconciliação; rollback não apaga cadastro nem cancela ERP.

Pode atualizar somente configuração privada autorizada e evidência/runbook. Preserve outros operadores, gatilhos e integrações. Ampliação de usuários tem decisão própria após o aceite. Entregue resultado e commit/push/PR da documentação pertinente.
```

## Bloco 7 Remoção independente do Financeiro

**Tarefa:** FINQ-DEPREC-01. **Estado:** aprovada; código a retirar, tabelas e dados a manter. **Independente dos blocos 1–6.**

```text
Execute somente FINQ-DEPREC-01 de .specs/features/financeiro/tasks.md.
Leia AGENTS.md, RULES.md, ADR 079, contratos de billing e os registros atuais BREL-10/T9 em order-billing-release e order-billing-activation.md. Não altere a entrega Olist.

Objetivo: remover a feature manual Financeiro preservando tabelas, histórico, quitação, cobranças e Dashboard.

1. Atualize o ponto de partida: emissão, recebimento e envio financeiros têm ativação registrada, mas teste manual/homologação de pagamento real seguem pendentes. Não refaça ativação nem conclua que flags ativas provam quitação conciliada. Verifique compatibilidade e lastro exigidos pela tarefa antes de retirar o módulo.

2. Inventarie dependências em order-billing-runtime, repositório de pedidos, perfis/sessões, finance_payment_review_required e triggers. Registre o ADR específico que supersede 040/041/042 no alcance da retirada. Preserve regras comerciais válidas mesmo se o nome técnico contiver finance.

3. Remova fila/check Nota criada, perfil Financeiro, menu/tela/CSS, rotas /api/v1/finance/*, runtimes/repositórios/exports finance.* exclusivos e testes exclusivos obsoletos. Preserve testes das invariantes de quitação, reconfirmação e autoria histórica.

4. Mantenha tabelas e dados históricos das migrations 0042/0043, identidades com autoria, paid_on, finance_payment_review_required e invalidate_finance_amount. Não crie migration destrutiva, apague migrations publicadas ou altere InfinitePay, quitação e Dashboard nesta tarefa.

5. Valide identidade/sessões, billing, reconfirmação com outro valor, histórico, compatibilidade e rollback, mais os gates pertinentes do projeto. Se a retirada estiver bloqueada, registre a dependência desta trilha; Olist continua seguindo seus próprios gates.

Pode editar somente fronteiras exclusivas do Financeiro, referências necessárias e documentação/testes. Não confunda ocultar menu com retirada concluída. Entregue evidências, riscos e commit/push/PR, sem testes financeiros reais não autorizados.
```

## Bloco 8 Melhorias futuras por escolha explícita

**Tarefas:** OLC-F01 a OLC-F04. **Estado:** diferidas; não executar automaticamente. A ficha por item já tem sua trilha FPI-T01–T04.

```text
Trabalhe somente na melhoria OLC-F01, OLC-F02, OLC-F03 ou OLC-F04 escolhida explicitamente pelo usuário em .specs/features/olist-confirmed/tasks.md.
Leia AGENTS.md, RULES.md, spec OLC e ADRs 079/080/082.

Se nenhuma melhoria foi escolhida, entregue comparação e escopo proposto; não implemente todas. Reutilize o runtime já existente em vez de tratar cada capacidade como ausente.

OLC-F01: avaliar/ampliar menu, busca exata e projeção para operação centralizada, conforme acesso aprovado. Parte da administração já existe; preserve a leitura mínima e evite vazamento.

OLC-F02: avaliar vínculo administrativo de venda antiga já existente, respeitando ADRs 073/075 e evidências próprias. Não transforme a correção do novo envio ou a recuperação obrigatória de incerteza em dependência deste trabalho.

OLC-F03: restringir cancelamento local a Pedido não confirmado, ajustando rota/UI/testes já existentes. Não introduza essa mudança silenciosamente nos blocos 1–6. Preserve estado terminal, história e filtros de cancelados, sem estorno ou cancelamento ERP; nunca alterar exportados.

OLC-F04: avaliar prévia detalhada optativa e ampliações além do total peças + frete da ADR 080. O frete obrigatório da entrega principal e os subtotais já existentes não podem ser adiados para esta melhoria.

Nesta etapa, edite somente contrato/tarefas/RFC/ADR da melhoria escolhida e informe fronteiras, aceite, compatibilidade, rollback e checks. Só altere código se a solicitação vigente também autorizar a melhoria concreta.

Preserve ficha v8/Modelo, versões anteriores, billing ativado, Melhor Envio e Dashboard entregues. Nenhuma melhoria volta a ser pré-requisito dos blocos 1–6 ou dispensa o cadastro completo no novo envio. Entregue decisão/escopo e commit/push/PR quando houver mudança documental.
```

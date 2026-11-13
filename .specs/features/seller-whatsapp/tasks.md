# WhatsApp por vendedor — plano em duas etapas

[RFC 067](../../../docs/rfc/067-whatsapp-por-vendedor-e-meus-clientes.md),
[WAP-01–24 propostos](spec.md). Uma tarefa, entrega atômica, commit e push.
WAP-T00 e seus complementos WAP-T00a/b são documentais e autorizados. As tarefas
seguintes são planejamento; implementação/ativação dependem da decisão da RFC.

## WAP-T00 — RFC, requisitos e plano

- [x] Confirmar baseline, adapter de linha única, saídas do aparelho ignoradas,
      carteira geral e ADR 088 atual sem alterar arquivos de terceiros.
- [x] Propor duas etapas só WhatsApp, configuração pessoal por QR, estados,
      limites mobile, privacidade, vínculo/ACL, envio correto e reconciliação.
- [x] Documentar critérios WAP e decisões D1–D4; ADR da evolução ainda pendente.
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
ao aceite da RFC e ADR; esta tarefa não muda RULES ou runtime.

Evidência WAP-T00b: formatação dos quatro documentos focalizados e 213
referências locais nos cinco arquivos verificadas; 24 IDs de requisito únicos;
`git diff --check` sem falhas. Revisão independente confirmou Contact/vínculos,
identidade, colisões e envio humano; corrigiu a contradição do onboarding para
permitir cadastro antes de parear e aprovou o delta final. Sem testes de runtime
para esta entrega documental. A prévia simulada foi conferida em 320 px e no
desktop: cadastro sem pareamento, vínculo/replay sem cópia, duplicata com
conferência, primeiro envio por Enter sem inbound no mesmo Cliente, cobrança
separada e bloqueio de envio offline; zero erro JavaScript. Não é prova live.

## Antes da implementação — decisão de produto

- [ ] Resolver D1–D5 na RFC, criar ADR vinculado e alinhar somente os trechos
      necessários em RULES, spec/PRD e ARCHITECTURE/TECHNICAL-DESIGN.
- [ ] Confirmar imagem Evolution, privacidade de QR/códigos e contrato n8n de
      controle sem armazenamento de segredos temporários; provar o caminho mobile.

## Etapa 1 — WAP-T01 a WAP-T05

### WAP-T01 — linha e controle de conexão

WAP-02–05, 10–12, 20–24. Backend/Dados, Integrações e QA/Privacidade.

- [ ] Fechar API/capacidades humanas e técnicas, estados/gerações, constraints,
      ledger, segredo efêmero e contrato de orquestração n8n sem inbound fictícia.
- [ ] Fechar contratos de Cliente/vínculo durável e primeiro envio propostos
      na RFC: versões, elegibilidade, conflitos privados e estados incertos;
      separar vínculo de carteira da geração da linha e identidade de canal.
- [ ] Implementar migração expand e comandos de conectar/estado/QR/desconectar,
      conciliando timeout antes de novo efeito. Sem cadastro manual por vendedor.
- [ ] Testar concorrência entre usuários/abas, número indevido/duplicado,
      expiração, callbacks antigos, CSRF, origem, limites e ator revogado.
- [ ] Documentar contrato/runbook e rollback; executar gates do patch, commit/push.

### WAP-T02 — roteamento, carteira e autorização

WAP-04–08, 10–12, 17–24. Backend/Dados, Integrações e QA.

- [ ] Vincular conta de canal à linha/geração no CRM; atribuição/modo humano
      atômicos conforme ADR aprovado, sem alterar a linha compartilhada.
- [ ] Revalidar remetente original e acesso em reserva/despacho/callback;
      impedir transferência genérica de linha pessoal a outro vendedor.
- [ ] Proteger carteira e clientes gerais, busca/contagens, links, histórico,
      mídia, contexto, assuntos, replay e SSE; preservar ACL comercial do Pedido.
- [ ] Vincular cadastro manual à carteira sem exigir inbound ou inventar
      identidade; compor serviços comerciais existentes e preservar contexto
      Contato/Conversa/Assunto/Pedido e ACL de pedido/cobrança.
- [ ] Reutilizar o Contact oficial e seus validadores; salvar cadastro/vínculo
      atomicamente e vincular existente por seleção autorizada/idempotente.
      Reconciliar só vínculos comerciais comprovados; não inferir posse pelo
      criador, copiar base global ou liberar duplicata por telefone coincidente.
- [ ] Implementar primeiro envio humano sem inbound: validar destino/linha,
      vincular identidade de saída ao mesmo contactId, compor conversa ativa e
      mensagem/outbox/auditoria; novo atendimento após encerramento anterior.
      Reusar ativo e reconciliar replay/eco/resposta sem duplicar ou mover
      identidades de outro Cliente. Testar concorrência e timeout com ledger.
- [ ] Garantir envio de cobrança/ficha pelo número correto, sem vincular
      emissão ou callback financeiro à disponibilidade do WhatsApp; testar
      concorrência, duas linhas com o mesmo cliente e pagamento após disconnect.
- [ ] Testar dois vendedores, mesmo cliente em duas linhas, unassigned indevido,
      Admin/Financeiro, inativação e revogação concorrente; gates, commit/push.

### WAP-T03 — sincronização corrente do aparelho

WAP-06, 09–12. Integrações, Backend/Dados e QA.

- [ ] Criar contrato de fato outbound externo sem reenviar, disparar agente,
      abrir pedido ou consumir revisão inbound. Manter autoria da linha explícita.
- [ ] Reconciliar eco CRM antes/depois do retorno HTTP, IDs por conta, mídia,
      recibos e eventos fora de ordem; preservar incerteza e sinalizar lacunas.
- [ ] Testar fixtures e PostgreSQL sintéticos; imagem Evolution fixada em ensaio
      isolado confirma os eventos reais. Runbook/gates, commit/push.

### WAP-T04 — Meus clientes e Meu WhatsApp

WAP-01–04, 06–08, 11–12, 17–24. Frontend/A11y, Backend/Dados e QA.

- [ ] Compor a aba/configuração nos tokens e componentes Vue existentes; sem
      nova identidade visual, estado global ou domínio em window.
- [ ] Manter carteira, Novo cliente e Vincular existente antes de parear;
      oferecer onboarding dispensável/fechável sem linha, com número e ação
      explícita para QR. Conexão habilita sincronização/envio; ausência ou perda
      de conexão mantém ações locais e histórico com reconexão visível.
- [ ] Reutilizar o atendimento comercial atual: salvar/editar contato, criar e
      acompanhar pedido, ficha/arquivos e cobrança com as mesmas guardas, sem
      adiar essas ações para a etapa 2. Falha do canal não remove ações locais.
- [ ] Distinguir Novo cliente/Vincular existente e Sem conversa/Iniciar conversa;
      cadastro usa nome/telefone/e-mail atuais. Manter o mesmo cadastro/contexto
      e primeira mensagem explícita com destino/remetente conferidos,
      sem enviar ao salvar, abrir ou apenas compor. Tratar duplicata acessível,
      conferência privada, canal indisponível e resultado incerto sem fallback.
- [ ] Reutilizar configuração em Conta, alternativa mobile homologada, estados,
      cancelamento de leituras e expiração; respostas tardias não reabrem QR
      após fechar ou perder sessão. Nenhum segredo em storage/telemetria.
- [ ] Testar teclado, foco, anúncios, mobile, conflito, falha e acesso cruzado
      com E2E/axe; gates, commit/push.

### WAP-T05 — piloto e operação da etapa 1

WAP-01–12, 16–24. Tech Lead, DevOps, Integrações e QA/Privacidade.

- [ ] Provisionamento por configuração com flags desligadas, allowlist privada,
      limites por usuário/serviço e política de retenção aplicada no gateway/n8n.
- [ ] Validar CI, imagem/digest, migração, saúde, capacidade, segredos, logs sem
      QR/código/PII e recovery que não restabelece envios/acessos antigos.
- [ ] Piloto explicitamente autorizado com duas linhas: conectar sem suporte,
      número errado/duplicado, mesma pessoa em ambas, mensagens reais nos dois
      sentidos pelo CRM/aparelho, mídia/recibos, expiração, reconnect e outage.
- [ ] Demonstrar contato manual → pedido humano → confirmação → cobrança →
      envio pela linha de origem → recebimento único, nas duas carteiras;
      repetir sem canal disponível e com acesso alheio. Pagamentos sintéticos/
      sandbox autorizado, sem ativação financeira real implícita.
- [ ] Demonstrar cadastro antes de parear, vínculo de existente sem duplicar,
      primeira saída sem inbound, resposta no mesmo Cliente/conversa e mesmo
      Cliente em duas carteiras autorizadas com históricos privados separados.
      Testar destino inválido, conflito privado, encerrado, duas abas, eco antes
      de HTTP, revogação, timeout e reconexão sem duplicação.
- [ ] Confirmar limites do canal, ACL negativa, fences e rollback sem perda de
      ledger/ACL. Registrar aceite e evidências sem PII; commit/push do runbook.

## Etapa 2 — WAP-T06 e WAP-T07

### WAP-T06 — carteira e histórico anteriores

WAP-07–08, 12–14, 16. Produto, Integrações, Backend/Dados e QA/Privacidade.

- [ ] Medir dados realmente disponíveis, fechar recorte/período/retenção e
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

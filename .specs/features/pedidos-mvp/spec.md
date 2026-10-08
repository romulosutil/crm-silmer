# Pedidos MVP — Especificação

**Status:** implementação integrada; UAT e aprovação física de produção pendentes
**Atualizado em:** 05/10/2026 — PR 142
**Data:** 12/09/2026
**Decisões de produto:** [`context.md`](context.md)
**Arquitetura:** [`design.md`](design.md) · **Tasks:** [`tasks.md`](tasks.md)
**Lastro de datas (29/09/2026):** [ADR 008](../../../docs/adr/008-lastro-de-datas-do-pedido.md) · história P1-10
**Abertura no primeiro ponto da ficha (02/10/2026):** [ADR 014](../../../docs/adr/014-pedido-abre-no-primeiro-ponto-da-ficha.md) · história P1-1 (PAB-01..04)
**Itens com os sete pontos (02/10/2026):** [ADR 016](../../../docs/adr/016-itens-com-os-sete-pontos-da-ficha.md) · história P1-11
**Ficha impressa com os sete pontos (02/10/2026):** [ADR 017](../../../docs/adr/017-ficha-impressa-com-os-sete-pontos.md) · P1-5 (PIM-06..10) e PLA-08
**Cliente acompanha o contato (03/10/2026):** [ADR 018](../../../docs/adr/018-cliente-do-pedido-acompanha-o-contato.md) · história P1-12
**Mockups:** `.design/mesa-de-trabalho/` (canvas "Mesa de Trabalho Silmer")

## Baseline vigente

O código atual seleciona ficha-canonical-v5 (ADR 020 / TEC-01..08), com aprovação provisória do PO; assinatura física de Rose e Operação é gate separado. TEC supersede PFI/PIM/REV nos pontos de Técnica, origem da arte, Estampa (referência) e rótulos. As seções de verificação datadas abaixo são histórico de entregas e não comprovam homologação, deploy ou aceite externo atuais.

## Problema original e resultado

O Kanban e o Negócio foram aposentados (ADR 004) porque o preenchimento da
ficha não é linear: o cliente responde fora de ordem, o agente preenche o que
consegue e o vendedor completa o resto quando assume a conversa. O módulo entregue oferece registro, confirmação humana, impressão e triagem das conversas que aguardam vendedor. A homologação desses fluxos no ambiente alvo continua pendente.

## Objetivos

- Todo pedido do zero em que o cliente informa um ponto da ficha vira um
  pedido pendente, sem trabalho manual de criação (ADR 014).
- O vendedor responsável completa, confirma e imprime um pedido sem sair
  das telas Caixa de Entrada e Pedidos.
- Nenhum pedido é impresso sem confirmação humana registrada (autor e
  horário).
- A ficha impressa reproduz os blocos e campos da v5, com aprovação provisória e gate físico antes da produção.

## Fora do escopo

| Item                                                          | Motivo                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cobrança PIX, conferência de comprovante, status de pagamento | Toda confirmação é humana no MVP; sem automação de pagamento.                                  |
| Produção, entrega, pedido perdido ou cancelado                | Não existem como status no MVP. O lastro (P1-10) guarda só datas.                              |
| Tela Mesa de Trabalho, marcos visuais, anel de completude     | Cortados na revisão de escopo; a Caixa de Entrada faz a triagem.                               |
| Histórico de quem preencheu cada campo (UI)                   | P2. A trilha fica gravada; só não aparece.                                                     |
| Ampliações comerciais no detalhe do cliente                   | Evolução posterior; KPIs de confirmados já estão no Dashboard.                                 |
| Edição campo a campo                                          | Edição é por seção.                                                                            |
| Impressão no template legado v1                               | v1 é referência documental; o MVP imprime v5.                                                  |
| Validação de modelo contra catálogo                           | Sem catálogo autorizado no MVP.                                                                |
| Reaproveitar tabelas e módulos de Negócio                     | Proibido pela ADR 004.                                                                         |
| Remover rotas mortas de Kanban/Negócio do OpenAPI             | Caminhos aposentados removidos na reconciliação de 05/10/2026; schemas históricos preservados. |

---

## Histórias

### P1-1: Agente cria o pedido pendente ⭐ MVP

**História:** Como vendedor, quero que o pedido já exista quando o cliente
começa a descrever o que quer, para não redigitar o que o agente coletou.

Desde a [ADR 014](../../../docs/adr/014-pedido-abre-no-primeiro-ponto-da-ficha.md),
o agente pede a abertura com `open_order` na reserva de envio ou no handoff
(PAB-01..03); o evento `order.intent_confirmed` continua aceito, obsoleto,
para workflows antigos.

**Aceite:**

1. **PCL-01** WHEN o agente pede a abertura do pedido numa conversa sem
   pedido pendente THEN o sistema SHALL criar exatamente um pedido `pendente`
   vinculado à conversa e ao contato, com número `NN-CRM` reservado.
2. **PCL-02** WHEN já existe pedido pendente na conversa THEN um novo pedido
   de abertura SHALL reutilizar o pedido existente (operação idempotente).
3. **PCL-03** WHEN a conversa só tem pedidos confirmados e o agente pede
   nova abertura THEN o sistema SHALL criar um novo pedido pendente.
4. **PAG-01** WHEN o agente envia `briefing_patch` e a conversa está com o
   agente e tem pedido pendente THEN os campos da ficha SHALL ser projetados no
   pedido pendente.
5. **PAG-02** WHEN a conversa está com um vendedor (`automation_state = human`)
   THEN patches do agente SHALL ser ignorados para o pedido.
6. **PAG-03** WHEN o patch do agente traz valor, condição de pagamento ou
   status THEN o sistema SHALL rejeitar esses campos, como já faz hoje.
7. **PAB-01** WHEN a ficha da conversa (briefing anterior unido ao patch da
   rodada) passa a ter, pela primeira vez, um valor real em um dos sete
   pontos (tipo de roupa, cor, quantidade, estampa, tecido, tamanhos, gola)
   THEN o workflow SHALL enviar `open_order: true` na reserva de envio ou no
   handoff dessa rodada e de todas as seguintes. "Definir com o vendedor" e o
   nome sozinho SHALL NOT abrir o pedido, e `order_intent_confirmed` do modelo
   SHALL ser ignorado.
8. **PAB-02** WHEN a rodada não é pedido do zero (ADR 013) THEN o workflow
   SHALL NOT abrir pedido, salvo um já aberto; WHEN o handoff, de qualquer
   motivo, inclusive arquivo ou áudio, acontece com um ponto na ficha THEN ele
   SHALL levar `open_order: true`.
9. **PAB-03** WHEN `message.send.requested` ou `handoff.requested` traz
   `open_order: true` THEN o CRM SHALL, depois de aplicar o evento, criar ou
   reutilizar o pedido pendente pela ficha unida (PCL-01..03) e responder
   `order: {opened: true, id, created}`; replay ou evento repetido SHALL NOT
   criar um segundo pedido. `open_order` em outro evento ou com valor não
   booleano SHALL ser recusado com 400.
10. **PAB-04** WHEN o CRM não consegue abrir o pedido THEN o evento SHALL ser
    aceito mesmo assim (a resposta ao cliente sai), a resposta SHALL trazer
    `order: {opened: false, error}`, o CRM SHALL registrar log sem dados
    pessoais e a auditoria `integration.n8n.order.open_failed`, e o workflow
    SHALL enviar `workflow.failed` com `ORDER_OPEN_FAILED` para a conversa.

**Teste independente:** numa conversa nova do workflow DEV, mandar uma
mensagem com um ponto da ficha (ex.: "quero camisetas brancas") e ver o pedido
pendente na lista de Pedidos e na gaveta da conversa.

---

### P1-2: Vendedor cria o pedido manualmente ⭐ MVP

**História:** Como vendedor, quero criar o pedido quando o agente não chegou a
detectar a intenção (ex.: o cliente pediu uma pessoa logo no início).

**Aceite:**

1. **PCL-10** WHEN o dono da conversa ou um administrador aciona "Criar
   pedido" numa conversa sem pedido pendente THEN o sistema SHALL criar o
   pedido pendente pré-preenchido com a pré-ficha atual da conversa.
2. **PCL-11** WHEN a conversa já tem pedido pendente THEN a ação "Criar
   pedido" SHALL não aparecer e a API SHALL responder com o pedido existente.

**Teste independente:** assumir uma conversa sem pedido, criar e abrir o
pedido.

---

### P1-3: Vendedor completa o pedido por seção ⭐ MVP

**História:** Como vendedor responsável, quero editar o pedido em blocos que
batem com a ficha impressa, para garantir que o que imprimo está certo.

**Aceite:**

1. **PFI-01** WHEN o pedido é aberto THEN a página SHALL mostrar, nesta ordem:
   Resumo do pedido, Itens e especificações, Observações do pedido, Controle
   de produção (informativo), Dados do atendimento (não impresso), Fechamento
   e pagamento. Desde a ADR 008, o Lastro do pedido entra logo depois do
   Resumo (PLA-01).
2. **PFI-02** Resumo SHALL conter: cliente (vindo do contato, bloqueado; só
   nome confirmado desde a ADR 016, PIT-11; acompanha o contato enquanto o
   pedido está pendente desde a ADR 018, PCT-01),
   entrega prometida, total de peças (calculado), tipo de serviço,
   evento/nome, vendedor (dono da conversa), data do pedido (definida na
   confirmação) e FAB (configuração `FAB_CODE`). Desde 30/09/2026 a tela diz
   "Entrega prometida" e "Tipo de serviço"; os campos continuam
   `data_entrega_confirmada` e `aplicacao`, e a ficha v2 impressa, travada por
   hash, mantém "Entrega confirmada" e "Aplicacao".
3. **PFI-03** Cada item SHALL conter: tipo, modelo, malhas (1 ou mais), cor da
   frente, costas, manga direita, manga esquerda, viés gola, viés mangas e
   grade (tamanho + quantidade inteira > 0, ao menos uma linha). Desde a ADR
   016 (02/10/2026), o item tem os principais e os adicionais de PIT-01 e
   PIT-02 e pode ser salvo incompleto (PIT-03); a linha de tamanho continua
   com tamanho e quantidade inteira > 0.
4. **PFI-04** Total do item e total do pedido SHALL ser calculados a partir da
   grade e nunca digitados.
5. **PFI-05** Observações SHALL aceitar de 0 a 5 linhas de texto.
6. **PFI-06** WHEN o vendedor clica "Editar" numa seção THEN a seção SHALL
   virar formulário com Salvar e Cancelar; salvar grava a seção inteira de uma
   vez. Só uma seção fica em edição por vez.
7. **PFI-07** Cores de manga e viés SHALL aceitar o valor explícito "Não
   aplicável".
8. **PFI-08** "Dados do atendimento" (arte, locais, logística, finalidade,
   perfil de compra) SHALL ser exibidos em modo leitura a partir da pré-ficha e
   marcados como "não saem na ficha impressa". Desde a ADR 016, ali ficam
   também a quantidade, os tamanhos e a estampa ditos pelo cliente que não
   viraram campo do pedido ("Quantidade informada", "Tamanhos informados",
   "Estampa desejada") e todo ponto deixado para o vendedor.
9. **PFI-09** O banner do topo SHALL listar o que falta para confirmar. Desde
   a ADR 016, lista só o que impede gerar (PIT-05, PIT-06); campo em branco
   que não bloqueia não é listado.
10. **PAU-01** WHEN quem não é dono da conversa nem administrador abre o pedido
    THEN a página SHALL ser somente leitura e a API SHALL recusar edições com 403.
11. **PFI-10** WHEN o pedido está confirmado THEN todas as seções SHALL ficar
    em modo leitura; para alterar é preciso reabrir. Exceção: o Lastro do
    pedido (PLA-04).
12. **PFI-14** Os campos do Resumo e dos itens SHALL ser texto digitado à mão,
    sem lista de opções, até o catálogo de opções ser aprovado (decisão do PO
    em 30/09/2026). A amostra de cor ao lado de uma cor digitada continua.

**Teste independente:** editar a grade de um item e ver o total do item, do
pedido e da lista de Pedidos atualizados.

---

### P1-4: Vendedor confirma o pedido ⭐ MVP

**História:** Como vendedor responsável, quero confirmar o pedido registrando
valor e forma de pagamento, para liberar a impressão.

**Aceite:**

1. **PCL-04** WHEN o dono da conversa ou um administrador aciona "Confirmar
   pedido" com valor final e condição válidos THEN o status SHALL virar
   `confirmado`, gravando valor, condição, autor, horário e data do pedido.
   Desde a ADR 016, a tela diz "Gerar pedido" e "Forma de pagamento", e cada
   item também precisa dos sete pontos principais (PIT-05).
2. **PFI-11** Valor final SHALL ser digitado como texto em reais (ex.:
   `4.820,00`) com prefixo fixo `R$` e armazenado em centavos inteiros > 0.
3. **PFI-12** Condição de pagamento SHALL ser uma entre: Pix, Cartão de
   crédito, Cartão de débito. Desde a ADR 016, a tela diz "Forma de
   pagamento"; o campo da API continua `paymentCondition`.
4. **PCL-05** WHEN valor ou condição está ausente ou inválido, ou o pedido não
   tem ao menos um item com grade THEN a confirmação SHALL ser recusada (422)
   com mensagem por campo e o status SHALL continuar `pendente`. Desde a ADR
   016, também quando algum item não tem um dos sete pontos principais; o 422
   `ORDER_NOT_CONFIRMABLE` nomeia cada um (PIT-06), e quando falta a entrega
   prometida (PIT-12).
5. **PCL-06** WHEN outro usuário tenta confirmar THEN a API SHALL responder 403
   e a interface SHALL não exibir o botão.
6. **PCL-09** WHEN duas confirmações concorrem sobre a mesma versão THEN uma
   SHALL vencer e a outra SHALL receber 409.
7. **PCL-08** Nenhum status SHALL mudar por pagamento, produção, tempo ou
   agente — só por Confirmar e Reabrir.
8. **PFI-13** "Confirmar pedido" SHALL ser o único botão primário da página.

**Teste independente:** preencher valor e condição, confirmar e ver o pedido
em Confirmados com "Confirmado por <nome> · <data hora>".

---

### P1-5: Vendedor imprime o pedido confirmado ⭐ MVP

**Aceite:**

1. **PIM-01** WHEN o pedido está pendente THEN o botão "Imprimir" SHALL
   aparecer desabilitado, com cadeado e o motivo "Disponível depois de
   confirmar o pedido".
2. **PIM-02** WHEN o pedido está confirmado THEN "Imprimir" SHALL abrir o
   documento no template `ficha-canonical-v2` (A4 paisagem, 2 páginas), com os
   dados do pedido, controle de produção em branco e sem valor ou condição de
   pagamento.
3. **PIM-03** WHEN a impressão de um pedido pendente é pedida direto à API
   THEN o servidor SHALL recusar com 409.
4. **PIM-04** O documento impresso SHALL não conter a faixa "Amostra sintética
   - não produzir".
5. **PIM-05** Qualquer usuário operacional autenticado SHALL poder imprimir um
   pedido confirmado.

**Teste independente:** confirmar e imprimir; comparar o documento com
`output/pdf/ficha-canonica-sintetica-v2.pdf`.

**Ficha v3 com os sete pontos (ADR 017, 02/10/2026).** Desde a T74
(03/10/2026, aprovação provisória do PO), "Imprimir" abre o documento no
template `ficha-canonical-v3` (A4 paisagem, duas páginas ou mais), com o
resto de PIM-02 igual; PIM-03 a PIM-05 valem para os dois templates. A v2
continua no repositório, travada por hash.

6. **PIM-06** No template `ficha-canonical-v3`, cada item SHALL trazer os sete
   pontos numerados, nesta ordem e com estes rótulos: Tipo de roupa (`tipo`),
   Cor (`cor`), Quantidade, Estampa (`estampa`), Tecido (`malhas` unidas por
   " / "), Tamanhos (blocos de tamanho e quantidade da `grade`) e Gola
   (`gola`). Quantidade SHALL ser a soma da grade, nunca um campo gravado.
7. **PIM-07** Os adicionais (Modelo, Cor frente, Cor costas, Manga direita,
   Manga esquerda, Viés gola e Viés mangas) SHALL sair num bloco "Adicionais"
   do item só quando ao menos um estiver preenchido, só os preenchidos e nessa
   ordem; o valor gravado "NAO APLICAVEL" é preenchido e SHALL sair.
8. **PIM-08** WHEN a ficha foi gravada antes dos sete pontos (sem `cor`,
   `estampa` e `gola`) THEN a v3 SHALL imprimir "—" nesses pontos e manter no
   papel todos os campos da v2.
9. **PIM-09** O Resumo da v3 SHALL usar os rótulos da tela, "Tipo de serviço"
   (`aplicacao`) e "Entrega prometida" (`data_entrega_confirmada`), e manter
   Cliente, Evento / Nome, Data do pedido, Vendedor, FAB e Total de peças, sem
   valor final nem forma de pagamento (D12); campo vazio SHALL sair como "—".
   A página 2 SHALL manter os 14 campos de produção em branco da v2; a faixa
   de amostra e a caixa de aprovação SHALL sair só na amostra de revisão.
10. **PIM-10** A impressão SHALL continuar no template v2 até uma aprovação
    da v3 ficar registrada; a troca SHALL acontecer num único ponto
    (`PRINT_TEMPLATE`), e a validação SHALL recusar a v3 nesse ponto sem
    aprovação. A aprovação provisória do PO vale para desenvolvimento e
    cloud-dev; a produção SHALL exigir a aprovação final, a assinatura física
    de Rose e Operação na amostra impressa (gate de go-live).
11. **PIM-11** Todo rótulo impresso da v3, nas duas páginas e na faixa de
    amostra, SHALL ter os acentos do português. O valor gravado
    "NAO APLICAVEL" SHALL sair como "NÃO APLICÁVEL" sem mudar o dado gravado;
    o texto digitado por pessoas SHALL sair como foi digitado.
12. **PIM-12** WHEN os itens não cabem na página 1 THEN cada página de
    continuação SHALL repetir o cabeçalho com o número do pedido e trazer
    "Página N · continuação dos itens"; item SHALL não se dividir entre
    páginas e SHALL manter o número; observações e total SHALL fechar a última
    página de itens; o controle de produção SHALL vir por último, com o seu
    cabeçalho.

**Teste independente (v3):** abrir `output/pdf/ficha-canonica-sintetica-v3.pdf`
e conferir os sete pontos, os adicionais e o lastro na página 1, com o roteiro
de `docs/phase0/FICHA-PDF-REVIEW-V3.md`.

---

### P1-6: Vendedor reabre um pedido confirmado ⭐ MVP

**Aceite:**

1. **PCL-07** WHEN o dono da conversa ou um administrador aciona "Reabrir
   pedido" THEN o status SHALL voltar a `pendente`, mantendo número, valor e
   condição já gravados, registrando autor e horário da reabertura e
   bloqueando a impressão.
2. **PCL-12** WHEN o pedido reaberto é confirmado de novo THEN autor, horário e
   data do pedido SHALL ser os da nova confirmação.

---

### P1-7: Lista de Pedidos ⭐ MVP

**Aceite:**

1. **PLI-01** O menu lateral SHALL ter "Pedidos" logo após "Caixa de Entrada",
   levando a `/pedidos`.
2. **PLI-02** A lista SHALL ter filtro Todos · Confirmados · Pendentes e busca
   por número, cliente ou telefone.
3. **PLI-03** Os pedidos SHALL aparecer agrupados em Confirmados e Pendentes,
   com contagem em cada grupo.
4. **PLI-04** Colunas: Pedido, Cliente (com evento e vendedor), Peças, Valor,
   Situação e ações.
5. **PLI-05** Situação SHALL mostrar, no pendente, o que falta e há quanto
   tempo o pedido não muda; no confirmado, "Confirmado por <nome> ·
   <data hora>".
6. **PLI-06** Ações: confirmado → "Imprimir" (primária) e "Abrir"; pendente →
   "Continuar", que abre a página do pedido.
7. **PLI-07** A lista SHALL paginar com "Ver mais".
8. **PLI-08** WHEN um pedido é criado, editado, confirmado ou reaberto THEN a
   lista e a gaveta abertas SHALL refletir a mudança sem recarregar.
9. **PGE-01** A página do pedido SHALL pertencer a Pedidos: item de menu ativo
   "Pedidos" e rastro "← Pedidos / NN-CRM", com a origem quando aberta a partir
   de uma conversa.

---

### P1-8: Caixa de Entrada por quem precisa agir ⭐ MVP

**Aceite:**

1. **PCX-01** O filtro "Situação" atual (estados da conversa) e o bloco
   "Sugestão pendente da IA" SHALL ser removidos.
2. **PCX-02** O inbox SHALL ter o filtro "Estado" com: Todas · Aguardando
   vendedor · Com o agente · Com vendedor.
3. **PCX-03** WHEN a conversa tem handoff pendente THEN SHALL mostrar o motivo
   da parada (a partir do `reason_code`) e há quanto tempo está parada.
4. **PCX-04** WHEN "Aguardando vendedor" está selecionado THEN a lista SHALL
   ordenar por tempo parado, do maior para o menor.
5. **PCX-05** SHALL continuar funcionando como hoje: fila Todas/Minhas/Sem
   responsável, Arquivar e ver arquivadas, Repassar atendimento, Assumir,
   Editar nome e Ver contato. A Caixa de Entrada SHALL NOT oferecer
   "Devolver à IA": a conversa com uma pessoa não volta para o bot (ADR 015).

---

### P1-9: Gaveta do pedido na conversa ⭐ MVP

**Aceite:**

1. **PCX-06** O cabeçalho da conversa SHALL ter um botão "Pedido" com o status
   atual (Pendente, Confirmado ou Sem pedido).
2. **PCX-07** WHEN o botão é acionado THEN uma gaveta lateral SHALL abrir com
   número, status, o que falta, itens (tipo, modelo, peças), total de peças,
   valor (quando houver) e o botão "Abrir pedido". A gaveta não edita.
3. **PCX-08** WHEN não há pedido pendente e o usuário é dono ou administrador
   THEN a gaveta SHALL oferecer "Criar pedido" (PCL-10).
4. **PCX-09** A gaveta SHALL fechar com Esc e com clique fora, devolvendo o
   foco ao botão que a abriu.

---

### P1-10: Lastro de datas do pedido ⭐ MVP

**História:** Como dono da operação, quero ver em cada pedido quando o cliente
chegou, quando fechou, quando pagou, quando prometemos entregar e quando de
fato entregamos, na ficha digital e na impressa.

**Aceite:**

1. **PLA-01** WHEN o pedido é aberto THEN a página SHALL mostrar a seção
   "Lastro do pedido" logo depois do Resumo, com cinco datas nesta ordem:
   Primeiro contato, Pedido fechado, Pagamento, Entrega prometida e Entrega
   realizada, e quantas delas já existem.
2. **PLA-02** Primeiro contato SHALL ser a abertura da conversa que originou o
   pedido, copiada na criação e nunca digitada; pedidos criados antes da
   migração SHALL recebê-la da conversa.
3. **PLA-03** Pedido fechado SHALL ser a data do pedido (PCL-04, PCL-12) e
   Entrega prometida SHALL ser a entrega prometida do Resumo (campo
   `data_entrega_confirmada`); nenhuma das duas é editada no lastro.
4. **PLA-04** WHEN o dono da conversa ou um administrador informa "Pago em" e
   "Entregue em" THEN o sistema SHALL gravar as duas datas juntas, em pedido
   pendente ou confirmado, sem reabrir; campo vazio limpa a data.
5. **PLA-05** WHEN uma data não é um dia válido ou é depois de hoje (horário de
   São Paulo) THEN a interface SHALL mostrar o erro junto ao campo e a API
   SHALL recusar com 422 `INVALID_DATE` nomeando os campos.
6. **PLA-06** Nenhuma data do lastro SHALL mudar o status, bloquear a
   confirmação, entrar no que falta ou mudar a impressão (PCL-08). Desde a
   ADR 016, a entrega prometida é a exceção: é exigida para gerar e entra no
   que falta (PIT-12); pagamento e entrega realizada continuam sem
   bloquear.
7. **PLA-07** WHEN quem não é dono nem administrador tenta gravar THEN a
   interface SHALL não exibir "Editar" no lastro e a API SHALL responder 403;
   uma versão desatualizada SHALL receber 409.
8. **PLA-08** A ficha impressa SHALL trazer as cinco datas do lastro na
   página 1 do template `ficha-canonical-v3` com os sete pontos (ADR 017, que
   supera a v3 por produto), cada uma uma vez só: Data do pedido e Entrega
   prometida no Resumo; Primeiro contato, Pagamento e Entrega realizada na
   faixa "Lastro do pedido". Dia ainda não registrado SHALL sair como "—".
9. **PLA-09** Enquanto a v2 imprime, a entrega confirmada SHALL sair como
   dd/mm/aaaa, igual à amostra aprovada.

**Teste independente:** num pedido confirmado, informar "Entregue em" e ver a
data no lastro, com o pedido ainda confirmado e a impressão liberada.

---

### P1-11: Itens com os sete pontos da ficha ⭐ MVP

**História:** Como vendedor, quero que o item do pedido traga os sete pontos
que o bot coletou (tipo de roupa, cor, quantidade, estampa, tecido, tamanhos e
gola), para completar só o que falta e gerar um pedido que a fábrica consegue
produzir.

Decisão: [ADR 016](../../../docs/adr/016-itens-com-os-sete-pontos-da-ficha.md),
que substitui a regra A01 do [contexto](context.md).

**Aceite:**

1. **PIT-01** Cada item SHALL mostrar os principais nesta ordem: Tipo de
   roupa (`tipo`), Cor (`cor`), Quantidade (soma dos tamanhos, nunca
   digitada), Estampa (`estampa`), Tecido (`malhas`), Tamanhos (`grade`) e
   Gola (`gola`), com o cabeçalho "Item N · <tipo de roupa ou —> ·
   <quantidade> peças".
2. **PIT-02** Modelo, Cor frente, Cor costas, Manga direita, Manga esquerda,
   Viés gola e Viés mangas SHALL ficar num bloco recolhível "Adicionais (não
   obrigatórios)", fechado ao abrir a página, que o teclado abre e fecha
   (`aria-expanded`, foco no botão). Mangas e viés mantêm "Não aplicável".
3. **PIT-03** WHEN o vendedor salva os itens com campos em branco, sem tecido
   ou sem tamanhos THEN o sistema SHALL aceitar; cada linha de tamanho
   continua exigindo tamanho e quantidade inteira > 0, tecido não tem linha em
   branco, e valem os limites de 200 caracteres por texto e 50 itens.
4. **PIT-04** WHEN o pedido foi gravado antes da ADR 016 THEN o sistema SHALL
   lê-lo com cor, estampa e gola em branco e recalcular o que falta pela regra
   nova, sem migração; por uma versão, o `PATCH` dos itens SHALL aceitar item
   sem essas três chaves e gravá-las em branco.
5. **PIT-05** Gerar o pedido SHALL exigir ao menos um item, em cada item os
   sete principais (tipo, cor, estampa, ao menos um tecido, ao menos uma linha
   de tamanho e gola), a entrega prometida (PIT-12), o valor final e a forma
   de pagamento. Nada mais SHALL bloquear nem ser listado como faltando: nem
   os adicionais, nem o resto do resumo.
6. **PIT-06** "Falta para gerar" SHALL nomear cada ponto em palavras simples
   ("cor do item 1", "tamanhos do item 2", "entrega prometida", "valor
   final", "forma de pagamento"), a partir de `missingFields`: `items`,
   `items[N].tipo`, `items[N].cor`, `items[N].estampa`, `items[N].malhas`,
   `items[N].grade`, `items[N].gola`, `summary.data_entrega_confirmada`,
   `finalAmount` e `paymentCondition`, nesta ordem. O que se preenche em
   outra seção SHALL dizer onde ("Informar no Resumo" abre o resumo na
   entrega prometida). A Situação da lista de Pedidos e a gaveta da conversa
   SHALL usar a mesma lista.
7. **PIT-07** WHEN o bot projeta a pré-ficha THEN o item 1 SHALL receber:
   `product_model` (ou, sem ele, `product_type`) em Tipo de roupa; `colors` em
   Cor; `artwork_status` em Estampa, com os locais de `artwork_locations`
   depois de " · " e "sem aplicação" como "Sem estampa"; `fabrics` em Tecido;
   `collar` em Gola. `artwork_technique` SHALL ir para Tipo de serviço só
   quando nomeia uma técnica (silk/serigrafia, sublimação, DTF, DTG, bordado,
   transfer ou "sem aplicação"). "Definir com o vendedor" SHALL nunca virar
   valor do pedido: o campo fica vazio e o texto fica em Dados do atendimento.
8. **PIT-08** WHEN os tamanhos chegam como texto THEN eles SHALL virar
   Tamanhos só quando cada parte é um tamanho conhecido (PP, P, M, G, GG, XG,
   XGG, EG, EGG, G1–G5, XX, JEGÃO) com uma quantidade inteira > 0, na mesma
   ordem em todo o texto ("5 P, 10 M", "P5 M10", "25 M e 25G", "M: 15; G:
   15"); o que deixar dúvida SHALL ficar com Tamanhos vazio e o texto em
   "Tamanhos informados".
9. **PIT-09** A quantidade que o cliente informou SHALL aparecer ao lado de
   "Total de peças"; WHEN há tamanhos e a soma difere THEN a tela SHALL
   mostrar, sem bloquear, "A soma dos tamanhos (X) é diferente da quantidade
   informada (Y)"; sem tamanhos, a Quantidade do item 1 SHALL mostrar "—
   (cliente informou Y)".
10. **PIT-10** A tela SHALL dizer "Forma de pagamento", "Tamanhos", "Tecido" e
    "Tipo de roupa"; em Dados do atendimento, `sizes` é "Tamanhos informados"
    e `artwork_technique` é "Estampa desejada".
11. **PIT-11** O cliente do pedido SHALL ser um nome confirmado: o nome do
    contato dado por uma pessoa ou promovido do `customer_name` do bot; senão
    o `customer_name` do briefing; senão vazio. O identificador do canal e o
    nome do perfil do WhatsApp SHALL nunca ser o cliente.
12. **PIT-12** Do lastro (ADR 008), só a entrega prometida SHALL ser exigida
    para gerar, como um dia de calendário (`AAAA-MM-DD`, como o seletor de
    data grava); texto livre SHALL continuar bloqueando. Pagamento ("Pago
    em") SHALL não bloquear nem ser preenchido sozinho: até o CRM tratar
    pagamento, gerar o pedido subentende o pagamento feito. Entrega
    realizada (pós-venda), primeiro contato (copiado da conversa) e pedido
    fechado (definido ao gerar) SHALL não bloquear.

**Teste independente:** projetar no pedido um briefing com os sete pontos e
"tamanhos: 10 P, 15 M e 15 G", ver o item 1 completo com 40 peças, deixar a
gola em branco e ver "Falta para gerar: gola do item 1, entrega prometida,
valor final e forma de pagamento"; informar a gola e a entrega prometida e
gerar sem "Pago em".

---

### P1-12: Cliente do pedido acompanha o contato ⭐ MVP

**História:** Como vendedor, quero que o pedido pendente mostre o cliente com
o nome que o contato tem agora, para não gerar a ficha em branco ou com o nome
antigo depois de corrigir o nome na conversa.

Decisão: [ADR 018](../../../docs/adr/018-cliente-do-pedido-acompanha-o-contato.md),
do PO em 03/10/2026, que promove o caso de borda "WHEN o contato muda de nome".

**Aceite:**

1. **PCT-01** WHEN o contato de um pedido pendente é renomeado por uma pessoa,
   recebe o nome que o cliente deu ao bot ou tem o nome apagado THEN o
   detalhe, a lista e a gaveta da conversa SHALL mostrar, na próxima leitura,
   o cliente pela regra da PIT-11 com o contato atual, e a busca pelo nome
   novo SHALL achar o pedido. O renomear SHALL NOT mudar a versão nem a data
   da última mudança do pedido, nem publicar evento de pedido.
2. **PCT-02** WHEN o pedido é gerado THEN o cliente mostrado nesse momento
   SHALL ficar gravado no pedido; renomear o contato depois SHALL NOT mudar o
   cliente do pedido gerado no detalhe, na lista, na gaveta nem na ficha
   impressa.
3. **PCT-03** WHEN o pedido gerado é reaberto THEN o cliente SHALL voltar a
   acompanhar o contato (PCT-01), e gerar de novo SHALL gravar o nome desse
   momento.

**Teste independente:** com um pedido pendente, renomear o contato em "Editar
nome" e ver o nome novo no pedido, na lista (também buscando por ele) e na
gaveta; gerar, renomear de novo e ver o pedido e a impressão com o nome da
geração; reabrir e ver o nome atual.

---

### P2 (fora deste corte)

- Pedidos no detalhe do Cliente.
- KPIs de pedidos no Dashboard.
- Linha do tempo de preenchimento (quem preencheu o quê).

---

## Casos de borda

- WHEN um pedido confirmado é reaberto e gerado de novo THEN Pedido fechado
  SHALL passar à nova data do pedido (PCL-12), e Pagamento e Entrega
  realizada SHALL continuar como estavam.
- WHEN a conversa é repassada THEN o novo dono SHALL poder informar Pagamento e
  Entrega realizada; o antigo SHALL perder essa ação.

- WHEN a conversa é arquivada com pedido pendente THEN o pedido SHALL
  continuar em Pendentes.
- WHEN a conversa é repassada THEN o novo dono SHALL poder editar, confirmar e
  reabrir o pedido; o antigo SHALL perder essas ações.
- WHEN a conversa passa para uma pessoa (handoff ou "Assumir atendimento")
  THEN ela SHALL seguir com uma pessoa até o encerramento, sem ação, rota ou
  comando que a devolva ao agente, e o pedido pendente SHALL NOT voltar a
  receber a projeção dos patches do agente (ADR 015).
- WHEN uma conversa encerrada como `Sem lead` recebe uma mensagem nova do
  cliente THEN o ciclo novo SHALL começar com o bot, como para qualquer cliente
  novo: a regra da ADR 015 vale dentro de um ciclo de atendimento (PO,
  03/10/2026).
- WHEN a grade tem quantidade 0, negativa ou não inteira THEN o salvamento
  SHALL ser recusado com mensagem na linha.
- WHEN o valor digitado tem formato inválido (ex.: `4,820.00`, texto) THEN o
  campo SHALL mostrar erro e não enviar.
- WHEN a seção é salva sobre uma versão desatualizada THEN a API SHALL
  responder 409 e a interface SHALL pedir para recarregar a seção.
- WHEN o pedido não tem itens THEN o banner SHALL indicar "Nenhum item" e a
  confirmação SHALL ficar bloqueada.
- WHEN o contato muda de nome THEN o cliente do pedido pendente SHALL refletir
  o nome atual; o pedido confirmado SHALL manter o nome da confirmação. Desde a
  ADR 018 (03/10/2026), é requisito: PCT-01..03.

---

## Rastreabilidade

Verificado no Grupo H (T39) em 13/09/2026. Evidência = teste automatizado
(arquivo:linha) que falha se o requisito for quebrado.

| ID     | História | Evidência                                                                                  | Status   |
| ------ | -------- | ------------------------------------------------------------------------------------------ | -------- |
| PCL-01 | P1-1     | `test/orders-service-create.test.js:78`                                                    | Verified |
| PCL-02 | P1-1     | `test/orders-service-create.test.js:132`                                                   | Verified |
| PCL-03 | P1-1     | `test/orders-service-create.test.js:162`                                                   | Verified |
| PAG-01 | P1-1     | `test/orders-service-create.test.js:243`; `test/n8n-integration-postgres-live.test.js:116` | Verified |
| PAG-02 | P1-1     | `test/orders-service-create.test.js:279` (ramo `ignored`)                                  | Verified |
| PAG-03 | P1-1     | `test/orders-repository-contract.test.js:287`                                              | Verified |
| PCL-10 | P1-2     | `test/orders-service-create.test.js:198`; `test/e2e/crm-ui.spec.js:1102`                   | Verified |
| PCL-11 | P1-2     | `test/e2e/crm-ui.spec.js:369,1083`                                                         | Verified |
| PFI-01 | P1-3     | `test/e2e/orders.spec.js:978`                                                              | Verified |
| PFI-02 | P1-3     | `test/e2e/orders.spec.js:710`                                                              | Verified |
| PFI-03 | P1-3     | `test/e2e/orders.spec.js:773`                                                              | Verified |
| PFI-04 | P1-3     | `test/e2e/orders.spec.js:773,789,814`                                                      | Verified |
| PFI-05 | P1-3     | `test/e2e/orders.spec.js:905,937`                                                          | Verified |
| PFI-06 | P1-3     | `test/e2e/orders.spec.js:698,892`                                                          | Verified |
| PFI-07 | P1-3     | `test/e2e/orders.spec.js:833`                                                              | Verified |
| PFI-08 | P1-3     | `test/e2e/orders.spec.js:957`                                                              | Verified |
| PFI-09 | P1-3     | `test/e2e/orders.spec.js:581`; `test/order-format.test.js:103`                             | Verified |
| PFI-10 | P1-3     | `test/e2e/orders.spec.js:764`                                                              | Verified |
| PFI-14 | P1-3     | `test/e2e/orders.spec.js:1016`                                                             | Verified |
| PAU-01 | P1-3     | `test/e2e/orders.spec.js:610`                                                              | Verified |
| PCL-04 | P1-4     | `test/orders-service-commands.test.js:260` (bloco `confirmed`)                             | Verified |
| PCL-05 | P1-4     | `test/orders-service-commands.test.js:260,313`                                             | Verified |
| PCL-06 | P1-4     | `test/orders-service-commands.test.js:173`; `test/e2e/orders.spec.js:1092`                 | Verified |
| PCL-08 | P1-4     | `test/orders-service-commands.test.js:336`                                                 | Verified |
| PCL-09 | P1-4     | `test/orders-postgres-live.test.js:457`                                                    | Verified |
| PFI-11 | P1-4     | `test/orders-service-commands.test.js:260`; `test/order-format.test.js:82`                 | Verified |
| PFI-12 | P1-4     | `test/orders-service-commands.test.js:260,336`; `modules/orders/src/domain/order.js:107`   | Verified |
| PFI-13 | P1-4     | `test/e2e/orders.spec.js:1075`                                                             | Verified |
| PIM-01 | P1-5     | `test/e2e/orders.spec.js:567`; `test/order-format.test.js:170`                             | Verified |
| PIM-02 | P1-5     | `test/order-routes.test.js:884`; `test/identity-operational-read.test.js` (T75)            | Verified |
| PIM-03 | P1-5     | `test/order-routes.test.js:917`                                                            | Verified |
| PIM-04 | P1-5     | `test/order-routes.test.js:889`                                                            | Verified |
| PIM-05 | P1-5     | `test/e2e/orders.spec.js:1110`                                                             | Verified |
| PCL-07 | P1-6     | `test/e2e/orders.spec.js:1027`; `test/orders-service-commands.test.js:336`                 | Verified |
| PCL-12 | P1-6     | `test/order-routes.test.js:753`; `test/orders-domain.test.js:169`                          | Verified |
| PLI-01 | P1-7     | `test/e2e/foundation.spec.js:338`                                                          | Verified |
| PLI-02 | P1-7     | `test/e2e/orders.spec.js:430`                                                              | Verified |
| PLI-03 | P1-7     | `test/e2e/orders.spec.js:368,448`                                                          | Verified |
| PLI-04 | P1-7     | `test/e2e/orders.spec.js:368`                                                              | Verified |
| PLI-05 | P1-7     | `test/order-format.test.js:139`                                                            | Verified |
| PLI-06 | P1-7     | `test/e2e/orders.spec.js:409`                                                              | Verified |
| PLI-07 | P1-7     | `test/e2e/orders.spec.js:460`                                                              | Verified |
| PLI-08 | P1-7     | `test/e2e/orders.spec.js:473`; `test/e2e/crm-ui.spec.js:975`                               | Verified |
| PGE-01 | P1-7     | `test/e2e/foundation.spec.js:338,402`; `test/e2e/orders.spec.js:529`                       | Verified |
| PCX-01 | P1-8     | `test/e2e/crm-ui.spec.js:830,1131`                                                         | Verified |
| PCX-02 | P1-8     | `test/e2e/crm-ui.spec.js:848`                                                              | Verified |
| PCX-03 | P1-8     | `test/e2e/crm-ui.spec.js:74,931,938`                                                       | Verified |
| PCX-04 | P1-8     | `test/e2e/crm-ui.spec.js:74,923`                                                           | Verified |
| PCX-05 | P1-8     | `test/e2e/crm-ui.spec.js:839,886`                                                          | Verified |
| PCX-06 | P1-9     | `test/e2e/crm-ui.spec.js:950`                                                              | Verified |
| PCX-07 | P1-9     | `test/e2e/crm-ui.spec.js:1005`                                                             | Verified |
| PCX-08 | P1-9     | `test/e2e/crm-ui.spec.js:1091`                                                             | Verified |
| PCX-09 | P1-9     | `test/e2e/crm-ui.spec.js:1021,1036,1053`                                                   | Verified |

**Cobertura:** 52 requisitos · 52 verificados · 0 sem evidência · 0 lacunas.

**Gate desta verificação:**

| Comando                            | Resultado                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`                 | ✅ passou (format, typecheck, lint, boundaries, design-tokens, topology, r2, external-spikes, media-retention, security-catalog, ficha-pdf-review, phase0-decisions, observability, 477 unit tests, build) |
| `npm run test:orders:live`         | ✅ passou — 16/16 (PostgreSQL, `crm_silmer_test`)                                                                                                                                                          |
| `npm run test:operation-read:live` | ✅ passou — 1/1 (PostgreSQL, `crm_silmer_test`)                                                                                                                                                            |
| `npm run test:e2e`                 | ✅ passou — 69 passed, 7 skipped (Playwright)                                                                                                                                                              |

Os 7 testes e2e pulados são cenários de Kanban já aposentados (ADR 004,
`test/e2e/crm-ui.spec.js:602,1215,1238,1275,1284,1303,1315`) — não pertencem à
Pedidos MVP e não contam como lacuna.

### Lastro de datas (ADR 008)

Verificado em T46, 29/09/2026.

| ID     | História | Evidência                                                                                                                                       | Status                   |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| PLA-01 | P1-10    | `test/e2e/orders.spec.js:822,1144`; `test/order-format.test.js:201`                                                                             | Verified                 |
| PLA-02 | P1-10    | `test/orders-service-create.test.js:97`; `test/orders-postgres-live.test.js:334`; `test/migrations-live.test.js:270`                            | Verified                 |
| PLA-03 | P1-10    | `test/order-format.test.js:201`; `test/e2e/orders.spec.js:822`                                                                                  | Verified                 |
| PLA-04 | P1-10    | `test/orders-domain.test.js:214`; `test/orders-repository-contract.test.js:341`; `test/order-routes.test.js:778`; `test/e2e/orders.spec.js:842` | Verified                 |
| PLA-05 | P1-10    | `test/orders-domain.test.js:250`; `test/order-routes.test.js:833`; `test/e2e/orders.spec.js:883,914`                                            | Verified                 |
| PLA-06 | P1-10    | `test/orders-domain.test.js:214`; `test/order-routes.test.js:799`; `test/e2e/orders.spec.js:842`                                                | Verified                 |
| PLA-07 | P1-10    | `test/order-routes.test.js:858`; `test/orders-service-commands.test.js:419`; `test/e2e/orders.spec.js:652`                                      | Verified                 |
| PLA-08 | P1-10    | Ver "Ficha impressa com os sete pontos (ADR 017)" abaixo                                                                                        | Verified · PDF a aprovar |
| PLA-09 | P1-10    | `test/order-routes.test.js:1059`                                                                                                                | Verified                 |

**Cobertura:** 9 requisitos · 9 verificados · PLA-08 sai no papel depois da
aprovação do PDF da v3 (ADR 017).

| Comando                        | Resultado                                              |
| ------------------------------ | ------------------------------------------------------ |
| `npm run validate`             | ✅ passou (498 testes: 495 ok, 3 pulados; build)       |
| `npm run test:e2e`             | ✅ passou — 73 passed, 7 skipped (os mesmos do Kanban) |
| `npm run test:orders:live`     | ✅ passou — 17/17 (PostgreSQL, `crm_silmer_test`)      |
| `test/migrations-live.test.js` | ✅ passou — backfill de `0024` entre as migrations     |

### Abertura no primeiro ponto da ficha (ADR 014)

Verificado na T53, 02/10/2026.

| ID     | História | Evidência                                                                                                                                                                       | Status   |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PAB-01 | P1-1     | `test/n8n-workflow-contract.test.js:2102` (2106, 2114, 2147); `test/n8n-workflow-contract.test.js:469,874`                                                                      | Verified |
| PAB-02 | P1-1     | `test/n8n-workflow-contract.test.js:2169,2177,2209`; `test/n8n-workflow-contract.test.js:213`                                                                                   | Verified |
| PAB-03 | P1-1     | `test/n8n-integration-postgres-live.test.js:755,766,800,821,975`; `test/n8n-integration-domain.test.js:250`; `test/n8n-api-contract.test.js:126`; `test/n8n-routes.test.js:172` | Verified |
| PAB-04 | P1-1     | `test/n8n-integration-postgres-live.test.js:846,894,939`; `test/n8n-workflow-contract.test.js:305`; `test/n8n-api-contract.test.js:184`; `test/n8n-dev-workflow.test.js:111`    | Verified |

**Cobertura:** 4 requisitos · 4 verificados. PCL-01..03 mantêm a evidência do
serviço de pedidos; a abertura pelo `open_order` usa o mesmo
`ensurePendingFromIntent` (`test/n8n-integration-postgres-live.test.js:663`).

| Comando                                                                       | Resultado                                                |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `npm run validate`                                                            | ✅ passou na T53                                         |
| `node --test --test-concurrency=1 test/n8n-integration-postgres-live.test.js` | ✅ passou — 4/4 (PostgreSQL, `crm_silmer_test_abertura`) |

### Itens com os sete pontos (ADR 016)

Verificado em T66, 03/10/2026. Os trechos da ADR 016 em PFI-03, PFI-08,
PFI-09, PFI-12, PCL-04, PCL-05 e PLA-06 têm a evidência de PIT-01, PIT-10,
PIT-06, PIT-10, PIT-05, PIT-06 e PIT-12.

| ID     | História | Evidência                                                                                                                                              | Status   |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| PIT-01 | P1-11    | `test/e2e/orders.spec.js:1018,1116`; `test/order-format.test.js:191`                                                                                   | Verified |
| PIT-02 | P1-11    | `test/e2e/orders.spec.js:1018,1077,1116`                                                                                                               | Verified |
| PIT-03 | P1-11    | `test/orders-ficha.test.js:79,90,105,131`; `test/orders-service-commands.test.js:351`; `test/order-routes.test.js:523`; `test/e2e/orders.spec.js:1116` | Verified |
| PIT-04 | P1-11    | `test/orders-ficha.test.js:54,147`; `test/orders-service-read.test.js:206`; `test/orders-postgres-live.test.js:783`; `test/order-routes.test.js:523`   | Verified |
| PIT-05 | P1-11    | `test/orders-domain.test.js:103`; `test/orders-postgres-live.test.js:612`; `test/order-routes.test.js:744`                                             | Verified |
| PIT-06 | P1-11    | `test/orders-domain.test.js:369`; `test/order-format.test.js:117,157`; `test/e2e/orders.spec.js:639,1544`; `test/e2e/crm-ui.spec.js:1178`              | Verified |
| PIT-07 | P1-11    | `test/orders-ficha.test.js:267,326,339,368,400,440,496,527`; `test/orders-service-create.test.js:101`                                                  | Verified |
| PIT-08 | P1-11    | `test/orders-sizes.test.js:11,51,57,102`; `test/orders-ficha.test.js:464`                                                                              | Verified |
| PIT-09 | P1-11    | `test/order-format.test.js:208`; `test/e2e/orders.spec.js:1166`                                                                                        | Verified |
| PIT-10 | P1-11    | `test/e2e/orders.spec.js:1208`; `test/e2e/crm-ui.spec.js:1178`                                                                                         | Verified |
| PIT-11 | P1-11    | `test/orders-postgres-live.test.js:352`                                                                                                                | Verified |
| PIT-12 | P1-11    | `test/orders-domain.test.js:190`; `test/orders-postgres-live.test.js:612`; `test/order-format.test.js:292,359`; `test/e2e/orders.spec.js:639`          | Verified |

**Cobertura:** 12 requisitos · 12 verificados.

| Comando                                                      | Resultado                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `npm run validate`                                           | ✅ passou (546 testes: 543 ok, 3 pulados; build)                    |
| `npx playwright test` (config da porta 4275, não versionada) | ✅ passou — 82 passed, 7 skipped (os mesmos do Kanban)              |
| `npm run test:orders:live`                                   | ✅ passou — 20/20 (PostgreSQL, `crm_silmer_test_itens`)             |
| `test/n8n-integration-postgres-live.test.js`                 | ✅ passou — 3/3 (cópia local apontada para `crm_silmer_test_itens`) |

### Ficha impressa com os sete pontos (ADR 017)

A evidência do template vale para a v3. O PDF tem as páginas que o template
planejou (PIM-12). A aprovação, em `docs/phase0/ficha-pdf-approval-v3.json`,
tem duas etapas: a provisória do PO (03/10/2026, desenvolvimento e cloud-dev),
registrada e presa aos hashes do PDF, e a final, assinatura física de Rose e
Operação na amostra impressa, pendente e obrigatória antes da produção
(PIM-10).

| ID     | História | Evidência                                                                                                                              | Status                    |
| ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| PIM-06 | P1-5     | `test/ficha-print-v3.test.js:168,200`; `test/ficha-pdf-review-v3.test.js:91`                                                           | Verified · PDF a aprovar  |
| PIM-07 | P1-5     | `test/ficha-print-v3.test.js:224`; `test/ficha-pdf-review-v3.test.js:91,110`                                                           | Verified · PDF a aprovar  |
| PIM-08 | P1-5     | `test/ficha-print-v3.test.js:251`                                                                                                      | Verified · PDF a aprovar  |
| PIM-09 | P1-5     | `test/ficha-print-v3.test.js:282,309,375`                                                                                              | Verified · PDF a aprovar  |
| PIM-10 | P1-5     | `test/ficha-print-switch.test.js:145,155,209,216,234,248`; `test/ficha-pdf-review-v3.test.js:313`; `npm run validate:ficha-pdf-review` | Verified · v3 desde a T74 |
| PIM-11 | P1-5     | `test/ficha-print-v3.test.js:429,454`; `test/ficha-pdf-review-v3.test.js:147`                                                          | Verified · PDF a aprovar  |
| PIM-12 | P1-5     | `test/ficha-print-v3.test.js:471,479,516,526`; `test/ficha-pdf-review-v3.test.js:162`                                                  | Verified · PDF a aprovar  |
| PLA-08 | P1-10    | `test/ficha-print-v3.test.js:339,569`; `test/ficha-pdf-review-v3.test.js:162`                                                          | Verified · PDF a aprovar  |

O gate do pacote (hashes da amostra, do HTML e do PDF, aprovação inteira ou
pendente, recusa de regerar a versão aprovada) está em
`test/ficha-pdf-review-v3.test.js:162,244,313,365` e em
`npm run validate:ficha-pdf-review`.

### Cliente acompanha o contato (ADR 018)

Verificado em T72, 03/10/2026. Nenhuma tela mudou, então não há e2e novo.

| ID     | História | Evidência                                                                                                                                                          | Status   |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| PCT-01 | P1-12    | `test/orders-service-client.test.js:127,153,242`; `test/order-routes.test.js:1126`; `test/orders-postgres-live.test.js:528,554`                                    | Verified |
| PCT-02 | P1-12    | `test/orders-service-client.test.js:187`; `test/orders-repository-contract.test.js:344`; `test/order-routes.test.js:1135`; `test/orders-postgres-live.test.js:558` | Verified |
| PCT-03 | P1-12    | `test/orders-service-client.test.js:207`; `test/order-routes.test.js:1155`; `test/orders-postgres-live.test.js:616`                                                | Verified |

**Cobertura:** 3 requisitos · 3 verificados.

| Comando                                      | Resultado                                                 |
| -------------------------------------------- | --------------------------------------------------------- |
| `npm run validate`                           | ✅ passou (562 testes: 559 ok, 3 pulados; build)          |
| `npm run test:orders:live`                   | ✅ passou — 22/22 (PostgreSQL, `crm_silmer_test_cliente`) |
| `test/n8n-integration-postgres-live.test.js` | ✅ passou — 4/4 (PostgreSQL, `crm_silmer_test_cliente`)   |

## Roteiro de UAT

1. Como cliente no workflow DEV, mandar numa conversa nova uma mensagem com um
   ponto da ficha (ADR 014) → pedido pendente `NN-CRM` aparece na gaveta da
   conversa e em Pedidos/Pendentes.
2. Assumir a conversa como vendedor na Caixa de Entrada.
3. Abrir o pedido pela gaveta ("Abrir pedido").
4. Editar a seção "Itens e especificações": ajustar os tamanhos, salvar e
   conferir total recalculado; abrir "Adicionais (não obrigatórios)" pelo
   teclado.
5. Editar "Observações do pedido" (até 5 linhas) e salvar.
6. Preencher Técnica por item, origem da arte do pedido e entrega prometida; confirmar com valor (ex. `1.180,00`) e forma de pagamento (Pix);
   checar status "Confirmado por <nome> · <data hora>".
7. Imprimir o pedido confirmado; validar template `ficha-canonical-v5` (ADR 020), sem valor/condição e sem faixa de amostra; assinatura física precede produção.
8. Reabrir o pedido; confirmar que a impressão trava de novo e número/valor
   são preservados.
9. Na Caixa de Entrada, aplicar o filtro "Estado" → "Aguardando vendedor" e
   checar ordenação por tempo parado e motivo da parada.
10. Abrir a gaveta de uma conversa nesse filtro e confirmar resumo (itens,
    peças, valor) sem opção de editar ali.
11. Num pedido gerado, abrir o Lastro do pedido: primeiro contato, pedido
    fechado e entrega prometida já aparecem. Informar "Pago em", salvar e
    conferir que o pedido continua confirmado e a impressão liberada.
12. Tentar "Entregue em" com data de amanhã e ver o erro junto ao campo;
    informar a data de hoje e salvar.
13. Com um pedido pendente, renomear o contato em "Editar nome" na Caixa de
    Entrada e abrir de novo o pedido, a lista (buscando pelo nome novo) e a
    gaveta: o cliente é o nome novo. Gerar, renomear de novo e conferir que o
    pedido e a impressão mantêm o nome da geração (ADR 018).

## Critérios de sucesso

- [ ] Um pedido sai da intenção de compra até a impressão com uma única ação
      de confirmação humana.
- [ ] 100% dos pedidos impressos têm autor e horário de confirmação.
- [ ] O documento impresso passa pelos seis critérios do gate da ficha
      (legibilidade, conteúdo, ordem, grade, totais, impressão).

## Revisão da ficha e leitura operacional (ADR 019, 03/10/2026)

Esta seção registra a decisão de 03/10/2026, refinada pela ADR 020. A coleta do bot continua com os sete
pontos da ADR 016; o vendedor completa as escolhas operacionais antes de
**Gerar pedido**. A revisão original partiu da v3 e preparou a v4, conforme [RFC 007](../../../docs/rfc/007-revisao-da-ficha-e-leitura-operacional.md).

| ID     | Critério de aceite                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REV-01 | A tela e a nova ficha usam **Tipo de roupa** para `item.tipo`, sem editar ou imprimir `modelo`; dados históricos de modelo continuam preservados.                                                                                                                        |
| REV-02 | O ponto 7 aparece como **Definição da gola**, usa `item.gola` e lê `vies_gola` antigo quando aquele estiver vazio; salvar outro campo não apaga essa definição.                                                                                                          |
| REV-03 | Cada item tem `tipo_servico`. É possível salvar um rascunho sem ele, mas **Gerar pedido** informa qual item falta; itens do mesmo pedido podem ter serviços diferentes. Gerados antigos seguem legíveis.                                                                 |
| REV-04 | O vendedor autorizado marca separadamente **Feito pelo cliente** e **Feito pela Silmer**. A automação não define a origem. O upload informa os formatos, mas fica desativado até haver armazenamento durável e validação (ativado pela ADR 023; ver ARQ-01–ARQ-09).      |
| REV-05 | A revisão impressa candidata preserva lastro, paginação e 14 campos vazios de produção; mostra serviço por item, origem da estampa e definição da gola. V2, v3 e seus hashes não mudam. A troca do template depende de aprovação própria.                                |
| REV-06 | Dashboard mostra número de vendas confirmadas e valor final vendido, com período e universo explícitos; análises derivadas não contam pendentes como venda nem valor recebido.                                                                                           |
| REV-07 | Linhas de Pedidos e Clientes abrem ao clicar na área não interativa e mantêm link, foco e operação por teclado. Tabela larga rola dentro de região focável no celular.                                                                                                   |
| REV-08 | Pedidos diferencia **Cliente sem resposta** (última saída enviada há pelo menos 48 horas) de **Pedido sem movimentação** (`updatedAt`); envio falho/incerto não acende o sinal. Nenhuma probabilidade de fechamento é inventada.                                         |
| REV-09 | Páginas observam eventos seguros do CRM e atualizam sem botão normal de atualização. Edição em andamento preserva rascunho; conflito de versão permite recuperar a leitura atual após cancelar. Nova tentativa manual continua para falha real.                          |
| REV-10 | O [glossário](../../../docs/product/GLOSSARIO.md) fixa termos e verbos; a [revisão heurística](../../../docs/product/REVISAO-HEURISTICA.md) documenta achados e verificação. Aviso a Rose por n8n ou e-mail é proposta para fluxo conjunto, sem implantação nesta etapa. |

## Técnica por item e arte do pedido (ADR 020, 03/10/2026)

O PO revisou as labels da ficha por seção ([RFC 008](../../../docs/rfc/008-rotulos-da-ficha-tecnica-e-arte.md))
e decidiu um nome por conceito. A coleta do bot e o indicador da ficha não
mudam; muda onde o CRM grava cada resposta e como a tela e o papel a chamam.
Estes critérios superam REV-02–REV-05 onde divergem.

| ID     | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEC-01 | `items[].tipo_servico` aparece como **Técnica**, ponto 4 do item, na tela e no papel; é obrigatória para gerar. O bot preenche o primeiro item quando o cliente nomeia uma técnica (silk, sublimação, DTF, DTG, bordado, transfer) ou diz que a peça é lisa (“Sem estampa”); outra descrição fica em Dados do atendimento como “Técnica informada”.                                                                                                                                                 |
| TEC-02 | `summary.aplicacao` não é escrita pelo bot, editada nem impressa a partir da v5. O valor antigo continua guardado e a API aceita a chave de um cliente antigo sem usá-la.                                                                                                                                                                                                                                                                                                                           |
| TEC-03 | **Estampa e arquivos** oferece **O cliente envia a arte**, **A Silmer cria a arte** e **Sem estampa**. As duas primeiras coexistem; “Sem estampa” exclui as outras (a API recusa a combinação). **Gerar pedido** exige uma marcação (`artwork` em `missingFields`). O bot projeta a origem a partir de `artwork_status` só quando a resposta é inequívoca; o vendedor corrige.                                                                                                                      |
| TEC-04 | `items[].estampa` deixa os pontos principais, não bloqueia e aparece como **Estampa (referência)** nos adicionais. O bot grava ali só os locais da estampa.                                                                                                                                                                                                                                                                                                                                         |
| TEC-05 | Pontos do item: Tipo de roupa, Cor, Quantidade, Técnica, Tecido, Tamanhos e **Gola**. Adicionais: Estampa (referência), **Cor do tecido — frente/costas/manga direita/manga esquerda** e **Viés das mangas**. “Tipo de peça” do bot aparece como “Tipo de roupa informado”; o aviso do `modelo` antigo sai da tela, e o valor continua guardado.                                                                                                                                                    |
| TEC-06 | Lastro com **Pago em** e **Entregue em** na tela e no papel; resumo com **Nome do pedido**; a dica da entrega prometida diz “A data combinada com o cliente.”; o total de peças não mostra “cliente informou N” (o aviso de diferença continua).                                                                                                                                                                                                                                                    |
| TEC-07 | `ficha-canonical-v5`: resumo com Cliente, Entrega prometida e Total de peças; apoio com Nome do pedido, Vendedor, Data do pedido e FAB; lastro com Primeiro contato, Pago em e Entregue em; **Arte do pedido** em toda página comercial; itens com os pontos de TEC-05; produção com **Cores da arte** e **Nº de cores — …**. V2–v4, PDFs e hashes intactos. `PRINT_TEMPLATE` muda para v5 só após a aprovação provisória do PO; a assinatura física de Rose e Operação continua antes da produção. |
| TEC-08 | O [glossário](../../../docs/product/GLOSSARIO.md) fixa Técnica, Arte do pedido, Estampa (referência), Cor do tecido, Cores da arte, Nome do pedido, Pago em e Entregue em.                                                                                                                                                                                                                                                                                                                          |

## Arquivos da arte no RustFS (ADR 023, 05/10/2026)

O PO ativou “Adicionar arquivos da arte” com armazenamento no RustFS
([RFC 011](../../../docs/rfc/011-arquivos-da-arte-no-rustfs.md)) e aprovou o
[design](../../../docs/design/arquivos-da-arte.html). Estes critérios superam
REV-04 onde divergem.

| ID     | Critério de aceite                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARQ-01 | **Estampa e arquivos** mostra **Arte final** e **Arquivos da arte** (contador “N de 5”, formatos e limite). Sem arquivos, quem edita vê uma área para arrastar e o botão **Adicionar arquivos da arte**; quem só lê vê “Nenhum arquivo anexado.” Nenhuma menção ao Dropbox.                                                                                                 |
| ARQ-02 | O dono da conversa ou um administrador envia até 5 arquivos da arte por pedido pendente, um de cada vez, com progresso, cancelamento e nova tentativa com a mesma Idempotency-Key.                                                                                                                                                                                          |
| ARQ-03 | Cada arquivo tem até 10 MB e extensão PNG, JPEG, WebP, CDR, PDF, SVG, AI, EPS, PSD, TIFF, ZIP ou RAR com conteúdo correspondente. A página recusa antes de enviar o que passa do tamanho, do formato ou das vagas e diz qual arquivo e por quê; a API recusa de novo (`FILE_TOO_LARGE` 413, `FILE_TYPE_NOT_ALLOWED`/`FILE_CONTENT_MISMATCH` 422, `FILE_LIMIT_REACHED` 409). |
| ARQ-04 | A **arte final** é um arquivo por pedido, não conta nos 5, mostra quem enviou e quando, e **Substituir** troca o arquivo anterior.                                                                                                                                                                                                                                          |
| ARQ-05 | PNG, JPEG e WebP aparecem em miniatura (WebP gerado no navegador); os demais formatos, inclusive SVG, mostram o ícone da extensão. **Baixar** entrega o original como anexo. Remover pede confirmação no próprio arquivo, com foco em Cancelar, Esc para desistir e foco no próximo arquivo depois.                                                                         |
| ARQ-06 | Pedido gerado e leitor sem permissão só baixam: sem enviar, substituir ou remover. A API recusa mudança fora do pedido pendente (`ORDER_STATUS_CONFLICT`) e de quem não é dono nem administrador (403).                                                                                                                                                                     |
| ARQ-07 | Os bytes ficam no RustFS interno, sem link público nem URL pré-assinada; a chave do objeto é opaca e o nome original fica cifrado no banco. O download sai com `Content-Disposition: attachment`, `nosniff` e CSP `sandbox`.                                                                                                                                                |
| ARQ-08 | Envio, remoção e download entram na auditoria; envio e remoção são idempotentes. Sem `OBJECT_STORAGE_*` as rotas respondem 503 e o resto do pedido funciona.                                                                                                                                                                                                                |
| ARQ-09 | O bucket entra no backup off-host, no drill e no restore com o PostgreSQL; o handoff manual de mídia válida do canal anexa o arquivo ao pedido.                                                                                                                                                                                                                             |

## O atendimento começa pelo produto (ADR 024, 05/10/2026)

O PO decidiu que o bot pergunta primeiro o nome e o que o cliente quer
personalizar, e não qual camisa, porque a Silmer personaliza camisas, bonés,
mochilas e muitos outros produtos. Arte, malha, técnica, tamanhos e gola
passam a ser do vendedor, e o que perguntar depende do produto e de kits
([RFC 012](../../../docs/rfc/012-atendimento-comeca-pelo-produto.md)). O
contrato com o CRM e a forma do item não mudam. Estes critérios superam, no
bot, os sete pontos da ADR 012.

| ID     | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PRD-01 | A saudação pede o nome e o que a pessoa quer personalizar (camisetas ou outras roupas, bonés, mochilas e bolsas, ou outro produto); o bot nunca pergunta "qual camisa" antes de saber o produto. Sem o nome, a resposta seguinte reage ao que o cliente contou e pede só o nome; depois de dois pedidos, o nome não é mais perguntado nem segura a ficha, e o resumo diz "Nome: não informado.". |
| PRD-02 | O ritmo é produto → modelo → cor → quantidade → onde vai a estampa → para quando. O modelo só é perguntado para roupa, boné, mochila ou bolsa, com as opções do produto; o prazo é desejo do cliente, nunca prazo confirmado.                                                                                                                                                                    |
| PRD-03 | Origem da arte, técnica, malha, tamanhos, gola, personalização individual e divisão por público nunca são perguntados: o bot grava o que o cliente disser. O bot nunca oferece criar a arte e, de tecido, só fala de algodão, poliéster e dry fit.                                                                                                                                               |
| PRD-04 | Os kits gravam, só em campo vazio e sem perguntar: abadá (sublimação total, poliéster, branca, gola regata), sublimação total (poliéster, branca), regata (gola regata), polo (gola polo), boné, mochila e bolsa (gola `NAO APLICAVEL`). O workflow também grava o produto a partir do modelo dito, o modelo quando o produto já o nomeia e o nome do produto no modelo de boné e bolsa.         |
| PRD-05 | O resumo da transferência traz "Atenção" (sublimação em algodão ou em peça escura, bordado com foto) e "Dica" (técnica usual do produto, personalização individual, divisão por público); o bot não fala disso com o cliente.                                                                                                                                                                    |
| PRD-06 | `briefing_complete` exige os pontos do produto e o nome enquanto o bot o pede; "Ficha: X de N" conta os mesmos campos (7 para roupa, boné ou bolsa; 6 para outro produto ou produto não dito).                                                                                                                                                                                                   |
| PRD-07 | Um boné do bot chega ao item 1 do pedido com o tipo ("bonés trucker"), a cor e a gola "NÃO APLICÁVEL"; malha, técnica, tamanhos e arte ficam para o vendedor, que continua obrigado a preenchê-los para gerar o pedido. "Quero esse boné" é peça já mostrada e transfere (ADR 013).                                                                                                              |
| PRD-08 | O workflow passa a `mvp-simple-12` (DEV `dev-mvp-simple-13`) sem ordem de implantação; o [roteiro do indicador da ficha](../../../docs/integrations/n8n/roteiro-indicador-da-ficha.md) cobre roupa, abadá, boné, ecobag, outro produto, sublimação em peça escura e divisão por público.                                                                                                         |

## Itens por público (ADR 025, 05/10/2026)

O PO definiu que gênero e idade criam itens, só quando o cliente divide a
quantidade, e aceitou as recomendações D1–D7 da
[RFC 013](../../../docs/rfc/013-itens-por-publico.md).

| ID     | Critério de aceite                                                                                                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUB-01 | Cada item tem `publico` opcional (masculino, feminino, infantil, unissex ou vazio), editável por teclado num seletor com rótulo "Público" e mostrado no cabeçalho do item; não entra em `missingFields` nem bloqueia gerar. A API recusa outro valor.                             |
| PUB-02 | Cada item tem `quantidade_informada` opcional (inteiro de 1 a 100000), só de referência; com grade e soma diferente, o item mostra "A soma dos tamanhos (X) é diferente da quantidade informada (Y)"; sem grade, "— (cliente informou Y)".                                        |
| PUB-03 | O CRM aceita `audiences` no `briefing_patch` e lê a divisão só quando não há dúvida (inteiro positivo junto de masculino, feminino, infantil ou unissex, uma vez cada); quando não é lida, o texto fica em Dados do atendimento como "Divisão informada".                         |
| PUB-04 | Com duas ou mais partes lidas, o pedido pendente nasce com um item por parte, na ordem dita, cada um com público, quantidade informada e os mesmos pontos projetados do bot; a grade só é projetada com um item. Uma parte só marca o público e a quantidade informada do item 1. |
| PUB-05 | Enquanto a conversa está com o bot, uma divisão nova refaz os itens da divisão sem apagar a técnica do vendedor nem itens acrescentados por ele; depois do handoff, nada é reprojetado.                                                                                           |
| PUB-06 | "Duplicar item N" insere a cópia logo abaixo, sem grade nem quantidade informada, e leva o foco ao seletor de público do item novo; o leitor de tela anuncia o item criado.                                                                                                       |
| PUB-07 | "Tecido" passa a "Modelo de malha" na tela; `ficha-canonical-v6` imprime o público junto do número do item, o novo rótulo e a quantidade informada quando difere da soma; v2–v5 intactas; `PRINT_TEMPLATE` muda só após a aprovação provisória do PO.                             |
| PUB-08 | O workflow `mvp-simple-13` grava a divisão em `audiences`, nunca a pergunta, e vai ao ambiente depois do CRM que aceita o campo.                                                                                                                                                  |
| PUB-09 | Fichas gravadas antes são lidas com `publico` e `quantidade_informada` vazios; nenhuma migração SQL.                                                                                                                                                                              |

## Venda da loja do site (ADR 027, 07/10/2026)

O PO pediu que o aviso de Pix da loja do site vire um pedido travado e "Pago"
no CRM, aceitou as recomendações D1–D9 da
[RFC 015](../../../docs/rfc/015-venda-da-loja-do-site.md) e definiu que o
pedido da loja aparece no Dashboard como uma venda normal.

| ID     | Critério de aceite                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOJ-01 | `POST /api/v1/public/loja/pedidos` com o corpo do contrato v1 do site e `Origin` permitido cria um pedido e responde `201 {"numero":"NN-CRM"}`.                                                                                                                            |
| LOJ-02 | Mesma `Idempotency-Key` e mesmo corpo (JSON canônico) responde `200` com o mesmo número, sem novo pedido, mesmo acima dos limites; outro corpo responde `409 idempotency_conflict`; chave diferente de `pedido_id` é `400`.                                                |
| LOJ-03 | Corpo malformado ou acima de 8 KB, chave desconhecida ou faltando, `versao` diferente de `"1"`, nome (2–80) ou telefone (E.164 brasileiro sem `+`) inválidos respondem `400 {"erro": …}`.                                                                                  |
| LOJ-04 | Slug, cor, tamanho (com os ids do site), quantidade, valor ou campos descritivos do produto diferentes do catálogo do CRM respondem `422`; instante declarado fora de 7 dias antes a 5 minutos depois responde `422 horario_invalido`; o pedido grava o preço do catálogo. |
| LOJ-05 | Com `STORE_ORDERS_ACCEPT_TEST=false`, `teste: true` responde `422 teste_recusado`; com `true`, o pedido nasce `isTest` e fica fora do Dashboard.                                                                                                                           |
| LOJ-06 | O pedido da loja nasce `confirmado`, `origin = loja`, sem conversa, autor "Loja do site", condição Pix, `paidOn` e `paymentDeclaredAt` do aviso; nenhum contato, conversa ou pendente é criado ou alterado.                                                                |
| LOJ-07 | Editar seção, gerar, reabrir, lastro e arquivos num pedido da loja respondem `409 ORDER_LOCKED`; a página não mostra esses controles.                                                                                                                                      |
| LOJ-08 | Lista e página mostram o selo "Loja" e "Pago (informado pelo cliente em dd/mm/aaaa às hh:mm)"; a lista filtra "Loja do site" e acha o pedido pelo número e pelo telefone.                                                                                                  |
| LOJ-09 | O Dashboard conta os pedidos da loja que não são teste em Vendido, pedidos, ticket médio e peças, como qualquer venda, sem linha separada.                                                                                                                                 |
| LOJ-10 | "Baixar ficha" baixa a `ficha-loja-v1` (`pedido-NN-CRM.html`) com só os campos padrão; a mesma rota sem `download` abre para imprimir; o CSP do nginx libera só o estilo dela.                                                                                             |
| LOJ-11 | O preflight `OPTIONS` libera `POST`, `Content-Type` e `Idempotency-Key` só para as origens configuradas, com `Vary: Origin`; `POST` sem origem permitida responde `403 origem_nao_permitida`.                                                                              |
| LOJ-12 | Acima de 30 requisições/minuto por IP, 5 pedidos/hora por IP ou 5 pedidos/24 h por telefone, responde `429 rate_limited` com `Retry-After`.                                                                                                                                |
| LOJ-13 | Cada criação grava recibo (pedido, `pedido_id`, `Origin`, HMAC do IP e do telefone, hash do corpo) e auditoria na mesma transação do pedido; nome, telefone e IP nunca vão para log.                                                                                       |
| LOJ-14 | Toda a interface nova opera por teclado, com selos em texto e foco previsível.                                                                                                                                                                                             |

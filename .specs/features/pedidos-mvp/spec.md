# Pedidos MVP — Especificação

**Status:** Draft para aprovação
**Data:** 12/09/2026
**Decisões de produto:** [`context.md`](context.md)
**Arquitetura:** [`design.md`](design.md) · **Tasks:** [`tasks.md`](tasks.md)
**Mockups:** `.design/mesa-de-trabalho/` (canvas "Mesa de Trabalho Silmer")

## Problema

O Kanban e o Negócio foram aposentados (ADR 004) porque o preenchimento da
ficha não é linear: o cliente responde fora de ordem, o agente preenche o que
consegue e o vendedor completa o resto quando assume a conversa. Hoje a
operação não tem onde registrar o pedido, confirmar valor e forma de pagamento,
nem imprimir a ficha aprovada (`ficha-canonical-v2`). O vendedor também não
tem como ver, na Caixa de Entrada, quais conversas estão paradas esperando por
ele e por quê.

## Objetivos

- [ ] Toda intenção de compra confirmada pelo agente vira um pedido pendente,
      sem trabalho manual de criação.
- [ ] O vendedor responsável completa, confirma e imprime um pedido sem sair
      das telas Caixa de Entrada e Pedidos.
- [ ] Nenhum pedido é impresso sem confirmação humana registrada (autor e
      horário).
- [ ] A ficha impressa reproduz os blocos e campos do template aprovado v2.

## Fora do escopo

| Item                                                          | Motivo                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Cobrança PIX, conferência de comprovante, status de pagamento | Toda confirmação é humana no MVP; sem automação de pagamento.    |
| Produção, entrega, pedido perdido ou cancelado                | Não existem como status no MVP.                                  |
| Tela Mesa de Trabalho, marcos visuais, anel de completude     | Cortados na revisão de escopo; a Caixa de Entrada faz a triagem. |
| Histórico de quem preencheu cada campo (UI)                   | P2. A trilha fica gravada; só não aparece.                       |
| Pedidos no detalhe do cliente e KPIs de pedidos no Dashboard  | P2.                                                              |
| Edição campo a campo                                          | Edição é por seção.                                              |
| Impressão no template legado v1                               | v1 é fallback documental; o MVP imprime v2.                      |
| Validação de modelo contra catálogo                           | Sem catálogo autorizado no MVP.                                  |
| Reaproveitar tabelas e módulos de Negócio                     | Proibido pela ADR 004.                                           |
| Remover rotas mortas de Kanban/Negócio do OpenAPI             | Limpeza separada (ver `design.md` → Riscos).                     |

---

## Histórias

### P1-1: Agente cria o pedido pendente ⭐ MVP

**História:** Como vendedor, quero que o pedido já exista quando o cliente
demonstra intenção de compra, para não redigitar o que o agente coletou.

**Aceite:**

1. **PCL-01** WHEN o agente confirma intenção de compra numa conversa sem
   pedido pendente THEN o sistema SHALL criar exatamente um pedido `pendente`
   vinculado à conversa e ao contato, com número `NN-CRM` reservado.
2. **PCL-02** WHEN já existe pedido pendente na conversa THEN uma nova
   intenção SHALL reutilizar o pedido existente (operação idempotente).
3. **PCL-03** WHEN a conversa só tem pedidos confirmados e o agente confirma
   nova intenção THEN o sistema SHALL criar um novo pedido pendente.
4. **PAG-01** WHEN o agente envia `briefing_patch` e a conversa está com o
   agente e tem pedido pendente THEN os campos da ficha SHALL ser projetados no
   pedido pendente.
5. **PAG-02** WHEN a conversa está com um vendedor (`automation_state = human`)
   THEN patches do agente SHALL ser ignorados para o pedido.
6. **PAG-03** WHEN o patch do agente traz valor, condição de pagamento ou
   status THEN o sistema SHALL rejeitar esses campos, como já faz hoje.

**Teste independente:** enviar o evento de intenção pelo endpoint do n8n e ver
o pedido pendente na lista de Pedidos e na gaveta da conversa.

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
   e pagamento.
2. **PFI-02** Resumo SHALL conter: cliente (vindo do contato, bloqueado),
   entrega confirmada, total de peças (calculado), aplicação, evento/nome,
   vendedor (dono da conversa), data do pedido (definida na confirmação) e FAB
   (configuração `FAB_CODE`).
3. **PFI-03** Cada item SHALL conter: tipo, modelo, malhas (1 ou mais), cor da
   frente, costas, manga direita, manga esquerda, viés gola, viés mangas e
   grade (tamanho + quantidade inteira > 0, ao menos uma linha).
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
   marcados como "não saem na ficha impressa".
9. **PFI-09** O banner do topo SHALL listar o que falta para confirmar.
10. **PAU-01** WHEN quem não é dono da conversa nem administrador abre o pedido
    THEN a página SHALL ser somente leitura e a API SHALL recusar edições com 403.
11. **PFI-10** WHEN o pedido está confirmado THEN todas as seções SHALL ficar
    em modo leitura; para alterar é preciso reabrir.

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
2. **PFI-11** Valor final SHALL ser digitado como texto em reais (ex.:
   `4.820,00`) com prefixo fixo `R$` e armazenado em centavos inteiros > 0.
3. **PFI-12** Condição de pagamento SHALL ser uma entre: Pix, Cartão de
   crédito, Cartão de débito.
4. **PCL-05** WHEN valor ou condição está ausente ou inválido, ou o pedido não
   tem ao menos um item com grade THEN a confirmação SHALL ser recusada (422)
   com mensagem por campo e o status SHALL continuar `pendente`.
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
   Devolver à IA, Editar nome e Ver contato.

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

### P2 (fora deste corte)

- Pedidos no detalhe do Cliente.
- KPIs de pedidos no Dashboard.
- Linha do tempo de preenchimento (quem preencheu o quê).

---

## Casos de borda

- WHEN a conversa é arquivada com pedido pendente THEN o pedido SHALL
  continuar em Pendentes.
- WHEN a conversa é repassada THEN o novo dono SHALL poder editar, confirmar e
  reabrir o pedido; o antigo SHALL perder essas ações.
- WHEN a conversa volta para a IA THEN o pedido pendente SHALL voltar a
  receber a projeção dos patches do agente.
- WHEN a grade tem quantidade 0, negativa ou não inteira THEN o salvamento
  SHALL ser recusado com mensagem na linha.
- WHEN o valor digitado tem formato inválido (ex.: `4,820.00`, texto) THEN o
  campo SHALL mostrar erro e não enviar.
- WHEN a seção é salva sobre uma versão desatualizada THEN a API SHALL
  responder 409 e a interface SHALL pedir para recarregar a seção.
- WHEN o pedido não tem itens THEN o banner SHALL indicar "Nenhum item" e a
  confirmação SHALL ficar bloqueada.
- WHEN o contato muda de nome THEN o cliente do pedido pendente SHALL refletir
  o nome atual; o pedido confirmado SHALL manter o nome da confirmação.

---

## Rastreabilidade

| ID                                                             | História | Status  |
| -------------------------------------------------------------- | -------- | ------- |
| PCL-01, PCL-02, PCL-03                                         | P1-1     | Pending |
| PAG-01, PAG-02, PAG-03                                         | P1-1     | Pending |
| PCL-10, PCL-11                                                 | P1-2     | Pending |
| PFI-01 … PFI-10, PAU-01                                        | P1-3     | Pending |
| PCL-04, PCL-05, PCL-06, PCL-08, PCL-09, PFI-11, PFI-12, PFI-13 | P1-4     | Pending |
| PIM-01 … PIM-05                                                | P1-5     | Pending |
| PCL-07, PCL-12                                                 | P1-6     | Pending |
| PLI-01 … PLI-08, PGE-01                                        | P1-7     | Pending |
| PCX-01 … PCX-05                                                | P1-8     | Pending |
| PCX-06 … PCX-09                                                | P1-9     | Pending |

**Cobertura:** 52 requisitos · 52 mapeados em `tasks.md` · 0 sem task.

## Critérios de sucesso

- [ ] Um pedido sai da intenção de compra até a impressão com uma única ação
      de confirmação humana.
- [ ] 100% dos pedidos impressos têm autor e horário de confirmação.
- [ ] O documento impresso passa pelos seis critérios do gate da ficha
      (legibilidade, conteúdo, ordem, grade, totais, impressão).

# Checkpoint — CRM Silmer 2.0 (pausado)

**Status:** pausado pelo proprietário em 24/11/2026. O
[PR 463](https://github.com/romulosutil/crm-silmer/pull/463) fica aberto como
rascunho para preservar a memória da proposta e **não deve ser mesclado** até
a retomada. Nenhuma linha de runtime foi alterada; só documentação.

- Branch: `docs/crm-20-sdd`, a partir de `origin/master` `0c89a1c7`.
- Commits: `18a180a6` (proposta original), `67189f9a` (revisão: divisão em
  RFC 075 e RFC 076, C20-T17, D06/D07) e o commit deste checkpoint.
- Backlog: item POS-002 e itens relacionados em
  [BACKLOG-POS-GO-LIVE](../../../docs/roadmap/BACKLOG-POS-GO-LIVE.md) (na
  `master`).

## O que existe nesta pasta

- [RFC 075](../../../docs/rfc/075-crm-20-centrado-no-cliente.md) — leitura
  comercial do cliente (C20-01 a 06, C20-13; D02, D03, D05).
- [RFC 076](../../../docs/rfc/076-identidade-do-cliente-entre-linhas.md) —
  identidade entre linhas de WhatsApp (C20-07 a 12; D06, D01, D04, D07).
- [spec](spec.md), [design](design.md), [tasks](tasks.md) (18 tarefas),
  [validation](validation.md) (G00–G10), [pre-mortem](pre-mortem.md)
  (PM01–PM10) e [PROMPTS](PROMPTS.md).

Os documentos acima refletem a revisão de 24/11/2026, rodadas 1 e 2. Os
achados da rodada 3 (abaixo) **ainda não foram incorporados** a eles.

## Rodada 1 — conflitos com o código e as ADRs (incorporados)

1. A união automática por telefone contraria a ADR 033 (item 3) e a ADR 090
   ("Nunca unir por telefone/nome"). O RFC 076 declara a supersessão.
2. `orderReadable` e `contactVisible` derivam a visibilidade do Contato. Unir
   um cliente privado da linha pessoal a um Contato da linha geral torna
   públicos os Pedidos dele. Para Contato já compartilhado, a WAP-07 ("Pedido
   segue a ACL comercial") já mostra esses Pedidos por desenho, e o primeiro
   envio já cria o estado misto. Resposta: D06 + C20-T17.
3. O inbound pessoal cria `seller_client_link` implícito, e um vínculo
   revogado faz o ingresso lançar `N8nForbiddenError` (mensagem perdida).
   Resposta: D06 (b)(c), PM10, "Contato isolado".
4. `phone_status='confirmed'` não prova titularidade (o primeiro envio grava
   `confirmed` de número digitado) e o nono dígito não é conciliado.
5. O aviso de simultaneidade (antes D02) contraria as ADRs 088/095. Virou D07.
6. Status reais de Pedido, ticket `null` com zero, loja fora do resumo,
   índice ausente, `ClientOrders.vue` filtrando no navegador, SSE de Pedido
   autorizado pela conversa, ordem de merge e PROMPTS por níveis.
7. A migração 0038 não pode ser editada (checksum conferido na partida).

## Rodada 3 — pontos cegos (pendentes de incorporação)

Marcação: **[V]** conferido na fonte pelo Tech Lead; os demais vieram dos
revisores com evidência de arquivo e linha, sem reconferência.

### Premissas do plano que caem

- **[V] Não existe "prova da Meta" hoje.** A linha geral roda pela ponte
  Evolution/Baileys ([ADR 050](../../../docs/adr/050-evolution-baileys-como-ponte-do-whatsapp.md),
  temporária); o workflow monta payload no formato da Meta
  (`ops/n8n/workflows/create-evolution-workflow.mjs:249`) e o CRM grava a
  identidade como `meta`. Quando a API oficial entrar, cada cliente da linha
  geral tende a ganhar identidade nova. D01 precisa separar prova por
  transporte real, e falta tarefa de migração para a API oficial.
- **[V] Não há homologação.**
  [EASYPANEL-TOPOLOGY.md](../../../EASYPANEL-TOPOLOGY.md) "elimina projetos
  separados de desenvolvimento, homologação e produção". G09, T06 e T14 não
  são cumpríveis como escritos; `@lid`/`remoteJidAlt` só aparecem com
  aparelho real. Redefinir G09 como ensaio em produção por allowlist ou
  aprovar ambiente temporário em ADR; fixtures do G04 a partir de payloads
  reais sanitizados.
- **Desfazer associação feita no ingresso é impossível.** Reutilizar o
  Contato direto não deixa Contato de origem para `unmergeIdentity`
  (`0006:66-93`). Pedidos e Assuntos do período errado ficam presos por
  trigger (`0080:30-50`) e o guard de cobrança falha fechado
  (`billing-send-guard.js:178-187`). A T09 deve sempre criar Contato próprio
  e unir por `identity_links`; a T12 precisa do inventário das relações do
  período errado (Assuntos, cobranças, recebimentos, Olist, PDFs, carteira).
- **[V] Sem eliminação de dados e sem backup restaurável comprovado.**
  [RUNBOOK](../../../ops/recovery/RUNBOOK.md): "nenhum backup restaurável
  evidenciado" e ledger de tombstones T06.3 não implementado; o G08 depende
  dele. A tabela nova guardaria a relação telefone–pessoa sem prazo nem
  exclusão. Antes da T07: classe no catálogo de dados, retenção dos vínculos
  revogados e procedimento de eliminação entre `identity_links`, vínculo
  canônico e HMAC.

### Problemas já existentes em produção (fora deste projeto)

Registrados como itens próprios no backlog.

- **[V] Oráculo de telefone no cadastro manual.**
  `apps/api/src/operation-runtime.js:993-1006` devolve 409
  `CONTACT_PHONE_MATCH` sem checar visibilidade; a rota não tem limite de
  taxa. Qualquer vendedor testa se um número é cliente, inclusive cliente
  privado de outro vendedor.
- **[V] Merge de identidade liberado a qualquer vendedor.**
  `modules/identity-access/src/authorization.js:34-37,222`. Latente (sem rota
  montada), mas a "associação assistida" montaria exatamente essa ação.
- **[V] Contexto da IA entre linhas.** `#contactContext`
  (`modules/n8n-integration/src/postgres-repository.js:2465`) conta ciclos e
  Pedidos de todas as linhas pelo Contato. No estado misto do primeiro envio,
  o bot da linha geral conta o que o cliente fez na linha pessoal.
- **Leituras sensíveis sem auditoria**, inclusive a supervisão das linhas
  pessoais (`identity-runtime.js:282-310`).
- **[V] `ClientOrders.vue` filtra no navegador** (`owner=me&limit=100`):
  páginas parciais ou vazias e só pedidos do próprio vendedor.

### Produto e UX

- Falta o problema medido: linha de base, métrica de sucesso e critério de
  desistência de produto. A T02 deve medir quantos telefones existem como
  Contatos separados entre linhas, a parcela de inbound de quem já comprou e
  a recompra.
- Disputa de carteira e comissão: B vê o total vendido de um cliente da
  carteira de A, com "Vincular à minha carteira" ao lado; após a união o
  crédito (`sales_owner_id`) pode ir para quem atende na linha geral. Falta
  decisão com Comercial.
- Fila de revisão sem dono, tela, prazo nem volume. "Operador autorizado"
  indefinido; se for vendedor, esbarra no WAP-24.
- O painel da Inbox começa fechado (`InboxView.vue:171`) e some abaixo de
  1440 px. Primeira fatia sugerida: "Cliente desde · N compras · última em
  dd/mm" no cabeçalho da conversa.
- Nomes: a aba "Resumo" já existe; "último pedido" repete o pedido da
  conversa; "ciclo" é "Atendimento" para o vendedor; "Provisório/Canônico"
  já vaza em Clientes.
- O mesmo cliente mostra totais diferentes por leitor; rótulo "pedidos
  visíveis para você".
- Atualização ao vivo: revogação limpa; invalidação mantém e relê em
  silêncio, sem `aria-live` nos valores.
- Dois atendimentos simultâneos (bot na geral, vendedor na pessoal): falta
  regra de quem responde.
- Comunicação e treino da equipe; proporção de 18 PRs para equipe pequena.

### Segurança e operação

- Varredura comercial: percorrer `/contacts` + resumo monta o ranking de
  valor da base; só `search` e `postal-codes` têm limite de taxa.
- Chave HMAC única (`CONTACT_IDENTITY_LOOKUP_KEY`), sem versão nem rotação.
- Motivo de união em texto livre em tabela imutável (`audit_events.reason`,
  `identity_links.merge_reason`): usar código fechado e nota em envelope.
- LGPD: teste de legítimo interesse, aviso ao titular e "não é cliente" para
  contatos pessoais do vendedor.
- Troca de chip/número reciclado deliberados: identidade recém-associada
  pede confirmação antes de expor cadastro.
- Pausar o piloto exige reiniciar a API (flags do ambiente); sobreposição de
  containers no deploy. Preferir disjuntor em banco, auditado.
- Desligamento e sucessão de vendedor: vínculos seguem ativos; prova obtida
  em geração revogada; visibilidade dos Pedidos pessoais após T17.
- Observação do piloto: métricas sem PII (associação, fila de revisão,
  conflitos, `EVOLUTION_IDENTITY_UNRESOLVED`, `N8nForbiddenError`) com
  limiar e dono.
- CPF/CNPJ errado na nota do Olist ao unir cadastros conflitantes ou número
  de empresa; números internos (vendedores) virando cliente; custo do SSE
  com muitos assinantes; cabeçalho `no-store` nas rotas novas.

## Leitura do Tech Lead no momento da pausa

- **RFC 075 (leitura)** é viável depois de absorver: limite de taxa e cache,
  rótulos e lugar do resumo, contexto da IA, métricas de sucesso e a correção
  de `ClientOrders.vue`.
- **RFC 076 (identidade)** fica em espera por pré-condições: prova real (API
  oficial da Meta ou decisão explícita sobre o Baileys), eliminação de dados
  e backup restaurável, permissão própria de revisor com separação de
  funções, caminho de desfazer e volume medido na T02.

## Como retomar

1. `git switch master && git pull --ff-only`; rebasear `docs/crm-20-sdd`
   sobre a `origin/master` e resolver conflitos.
2. Conferir a numeração na `origin/master`: RFC 075 e 076 e o ADR 099 podem
   ter sido ocupados durante a pausa. Renumerar e corrigir os links se for o
   caso.
3. Reconferir na ponta atual os fatos citados (arquivos e linhas mudam) e
   verificar se algum item do backlog relacionado já foi resolvido.
4. Incorporar a rodada 3 aos documentos e decidir com o proprietário se o
   RFC 076 segue em espera.
5. Juntar os commits num só para a T00 (regra 1:1:1:1), com autorização para
   `--force-with-lease`, e retirar o PR do estado de rascunho.

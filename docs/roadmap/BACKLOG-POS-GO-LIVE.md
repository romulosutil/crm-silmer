# Backlog pós go-live

Este documento reúne evoluções planejadas para depois do go-live. Os itens
registram intenção e escopo inicial; antes de iniciar desenvolvimento, devem
ser refinados em requisito e tarefa na especificação correspondente. Decisões
de arquitetura serão registradas em RFC/ADR quando aplicável.

## Itens

### POS-001 — Upload e download de arquivos na Ficha do Pedido

- **Status:** entregue no PR #150 e em produção desde 06/10/2026 (migrações
  0027 e 0028 aplicadas); a ativação depende da credencial do CRM no RustFS,
  conforme o [runbook](../runbooks/ativacao-arquivos-da-arte.md). Decisão na
  [RFC 011](../rfc/011-arquivos-da-arte-no-rustfs.md) e na
  [ADR 023](../adr/023-arquivos-da-arte-no-rustfs.md).
- **Prioridade:** primeira demanda pós go-live.
- **Objetivo:** permitir que uma pessoa autorizada envie arquivos pela Ficha do
  Pedido e baixe arquivos já associados ao pedido.
- **Escopo definido:** upload e download manual, na página do pedido, de até
  cinco arquivos da arte de até 10 MB cada e de uma arte final fora dessa
  conta. Os arquivos ficam no RustFS compartilhado `schedule/rustfs`,
  acessado só pela API na rede interna do EasyPanel; os domínios públicos da
  instância são lacuna aberta. PNG, JPEG e WebP ganham miniatura WebP
  gerada no navegador; os demais formatos mostram o ícone da extensão.
- **Fora do escopo:** aviso automático a Rose, edição ou conversão de
  arquivos, visualização completa no CRM além da miniatura e outras automações
  além de enviar, remover e baixar.
- **Rastreabilidade:** requisitos `ARQ-01`–`ARQ-09` (e `REV-04`) em
  [spec de Pedidos](../../.specs/features/pedidos-mvp/spec.md); tarefas `T79` e
  `T88`–`T92` em [tasks de Pedidos](../../.specs/features/pedidos-mvp/tasks.md);
  [ADR 019](../adr/019-ficha-espelhada-e-sinais-operacionais.md),
  [RFC 007](../rfc/007-revisao-da-ficha-e-leitura-operacional.md),
  [RFC 011](../rfc/011-arquivos-da-arte-no-rustfs.md) e
  [ADR 023](../adr/023-arquivos-da-arte-no-rustfs.md).

#### Critérios para iniciar a implementação (atendidos pela ADR 023)

- Decidir e documentar onde os arquivos serão armazenados e como o CRM os
  localizará depois do envio.
- Definir limites e tipos de arquivo aceitos e as validações necessárias.
- Definir acesso: somente pessoas autorizadas no pedido podem enviar ou baixar;
  a Ficha não deve expor link público nem credenciais do provedor.
- Definir comportamento para falhas e reenvios, sem arquivos ou registros
  duplicados.
- Definir persistência durável, auditoria e política de recuperação antes de
  ativar o upload.
- Confirmar estados acessíveis de envio, conclusão, erro e nova tentativa na
  interface da Ficha.

#### Aceite do MVP

- Pessoa autorizada envia um arquivo à Ficha do pedido correto e recebe
  confirmação de conclusão.
- Pessoa autorizada baixa o arquivo associado ao pedido.
- Pessoa sem autorização não consegue enviar nem baixar o arquivo, mesmo
  chamando a API diretamente.
- Falha de envio ou download fica clara e permite uma nova tentativa segura.
- O arquivo continua disponível após reinício da aplicação, conforme a
  solução durável definida.

#### Decisões tomadas (ADR 023)

1. **Onde guardar:** RustFS (S3-compatible, Apache-2.0), em bucket privado
   `crm-silmer-arquivos`, acessado somente pela API. Não há outro destino: o
   arquivo válido recebido no WhatsApp é anexado pelo operador ao pedido e
   também fica no RustFS.
2. **Formatos e limites:** PNG, JPEG, WebP, CDR, PDF, SVG, AI, EPS, PSD, TIFF,
   ZIP e RAR, verificados por assinatura de conteúdo; até 10 MB por arquivo,
   cinco arquivos da arte e uma arte final por pedido.
3. **Retenção, backup e recuperação:** os arquivos seguem a classe de dados do
   pedido. O volume do RustFS divide a VPS com o PostgreSQL; por isso o bucket
   entra no backup off-host e no drill de recuperação junto com o banco.
4. **Papéis:** enviar e remover exigem pedido pendente e permissão de edição;
   baixar exige permissão de leitura do pedido. Upload e download passam pela
   API, sem URL pré-assinada nem link público, com SHA-256, auditoria e
   idempotência.

#### Limites já aprovados

- Upload e download são o corte inicial; aviso automático a Rose continua fora
  deste escopo.
- Mídia transitória de conversa, com retenção curta, não pode ser reutilizada
  como armazenamento da Ficha, conforme a regra 18 de `RULES.md`.
- O upload só vai a produção com o RustFS provisionado e o bucket no backup
  off-host e no drill, conforme a ADR 023. A issue `#29` continua tratando o
  object storage gerenciado; sua conclusão não troca o RustFS sem nova
  decisão.

### POS-002 — CRM Silmer 2.0 centrado no cliente (pausado)

- **Status:** pausado pelo proprietário em 24/11/2026. A proposta está
  preservada, sem merge, no
  [PR 463](https://github.com/romulosutil/crm-silmer/pull/463) (rascunho,
  branch `docs/crm-20-sdd`). O estado completo, os achados pendentes e o
  roteiro de retomada estão no
  [checkpoint](https://github.com/romulosutil/crm-silmer/blob/docs/crm-20-sdd/.specs/features/crm-20/checkpoint.md).
- **Objetivo:** dar ao vendedor o contexto comercial de um cliente recorrente
  (Pedidos, atendimentos e indicador de vendas sob a ACL por recurso) e, numa
  segunda fase, reconhecer o mesmo cliente nas linhas geral e pessoal.
- **Fases propostas:** RFC 075 (leitura comercial, C20-01 a 06) e RFC 076
  (identidade entre linhas, C20-07 a 12), com 18 tarefas, 11 gates e 7
  decisões (D01–D07) em `.specs/features/crm-20/` no branch do PR.
- **Pré-condições para retomar a fase de identidade (RFC 076):**
  - prova real de titularidade: a linha geral roda pela ponte Evolution/Baileys
    ([ADR 050](../adr/050-evolution-baileys-como-ponte-do-whatsapp.md)); falta
    a API oficial da Meta ou uma decisão explícita sobre o Baileys;
  - ambiente de homologação ou ensaio em produção por allowlist aprovado em
    ADR, porque a [topologia](../../EASYPANEL-TOPOLOGY.md) eliminou a
    homologação;
  - eliminação de dados do titular e backup restaurável comprovado (pendências
    do [runbook de recuperação](../../ops/recovery/RUNBOOK.md), incluindo o
    ledger de tombstones T06.3);
  - permissão própria de revisor com separação de funções e um caminho para
    desfazer associação feita no ingresso;
  - volume do problema medido (telefones que existem como Contatos separados
    entre linhas).
- **Ao retomar:** conferir se os números RFC 075/076 e ADR 099 continuam
  livres na `master`, reconferir na ponta atual os fatos citados e checar os
  itens POS-003 a POS-007, que podem ter sido resolvidos.

### POS-003 — Cadastro manual revela se um telefone existe na base

- **Status:** aberto; achado na revisão do CRM 2.0 em 24/11/2026. Existe hoje
  em produção.
- **Prioridade:** alta (privacidade).
- **Problema:** `POST /api/v1/contacts` devolve 409 `CONTACT_PHONE_MATCH`
  quando o telefone está em `contacts`, `contact_phone_lookup` ou
  `site_contact_claims`, sem checar a visibilidade do leitor e sem limite de
  taxa (`apps/api/src/operation-runtime.js`, bloco `candidates`). Qualquer
  vendedor consegue testar se um número é cliente, inclusive cliente privado
  da linha pessoal de outro vendedor ou quem só usou o chat do site.
- **Direção:** mostrar a colisão só dentro do universo do leitor (o restante
  segue para revisão sem revelar a existência), colocar limite de taxa e
  cobrir com teste de autorização por papel.

### POS-004 — Merge de identidade liberado a qualquer vendedor

- **Status:** aberto e latente; achado em 24/11/2026.
- **Prioridade:** média; vira alta antes de montar qualquer rota de união.
- **Problema:** `contact.identity.merge` e `contact.identity.unmerge` estão
  em `OPERATIONAL_ACTIONS`
  (`modules/identity-access/src/authorization.js`), liberadas a qualquer
  vendedor ativo. Hoje não há rota montada na API. Uma rota de "associação
  assistida" sobre essa ação deixaria o vendedor interessado aprovar a
  própria união e levar cliente e comissão de outro.
- **Direção:** capacidade própria de revisor, separação de funções (quem tem
  carteira de um dos lados não aprova) e regra de direção da união, antes de
  qualquer rota.

### POS-005 — Contexto da IA soma dados de linhas diferentes

- **Status:** aberto; achado em 24/11/2026.
- **Prioridade:** média (privacidade do cliente na linha pessoal).
- **Problema:** `#contactContext`
  (`modules/n8n-integration/src/postgres-repository.js`, VND-CTX-01) conta
  ciclos anteriores, último fechamento e Pedidos pelo Contato, sem olhar a
  linha de origem. O primeiro envio pela linha pessoal já anexa identidade
  pessoal a um Contato da linha geral; nesse estado, o bot da linha geral
  conta o que o cliente fez em particular com o vendedor. Hoje só saem
  contagens, sem valores nem números de Pedido.
- **Direção:** decidir se o agente da linha geral pode saber de ciclos e
  Pedidos de linha pessoal; se não, filtrar por linha e cobrir com cenário
  negativo.

### POS-006 — Pedidos do cliente filtrados no navegador

- **Status:** aberto; achado em 24/11/2026.
- **Prioridade:** média (dado incompleto ao vendedor).
- **Problema:** `apps/edge-web/src/components/ClientOrders.vue` busca
  `/api/v1/orders?owner=me&cancellation=all&limit=100` e filtra o Contato no
  navegador. Uma página pode vir vazia enquanto os Pedidos do cliente estão
  nas seguintes, e só aparecem os do próprio vendedor. `GET /api/v1/orders`
  não tem filtro público por Contato.
- **Direção:** PR curto e independente do CRM 2.0: filtro por Contato na API,
  sob o mesmo predicado `orderReadable`, com regressão.

### POS-007 — Leituras sensíveis sem auditoria

- **Status:** aberto; achado em 24/11/2026.
- **Prioridade:** média (RULES.md, item 8).
- **Problema:** `authorizeOperational` (`apps/api/src/identity-runtime.js`)
  não grava auditoria de leitura, e `audit_events` só recebe mutações. A
  conta de supervisão das linhas pessoais
  ([ADR 095](../adr/095-supervisao-das-linhas-pessoais.md)) lê conversas sem
  rastro.
- **Direção:** um ADR decide auditar, de forma pseudônima (ator, recurso,
  rota, hora), as leituras de supervisão e as leituras comerciais feitas por
  quem não é dono.

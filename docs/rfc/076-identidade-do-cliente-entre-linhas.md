# RFC 076 — Identidade do cliente entre linhas de WhatsApp

**Pausado pelo proprietário em 24/11/2026.** Proposta de 24/11/2026,
preservada sem merge no
[PR 463](https://github.com/romulosutil/crm-silmer/pull/463); estado, achados
pendentes e pré-condições de retomada no
[checkpoint](../../.specs/features/crm-20/checkpoint.md). Base analisada:
`origin/master` `0c89a1c7`. Este RFC cobre a fase **Identidade entre linhas**
da feature [`crm-20`](../../.specs/features/crm-20/spec.md): requisitos C20-07
a C20-12, tarefas C20-T07 a T14 e T17, decisões D06, D01, D04 e D07. A fase
de leitura comercial e a baseline (T01/T02) estão no
[RFC 075](075-crm-20-centrado-no-cliente.md).

## Por que mudar

Um cliente que escreve para a linha geral e para a linha pessoal de um
vendedor vira hoje dois Contatos. Cada linha tem a sua identidade: a chave de
busca da identidade inclui a conta da linha, e as travas do ingresso também
(`n8n-inbound:…`, `n8n-conversation:…` e `identity:{lookupHash}` em
[`postgres-repository.js`](../../modules/n8n-integration/src/postgres-repository.js)).
A busca por telefone já sugere candidatos, mas a
[ADR 033](../adr/033-telefone-no-cadastro-e-roteamento.md) (item 3) exige
escolha humana, e não existe rota de API montada para unir identidades. O
histórico comercial do cliente fica partido entre linhas.

Unir identidades, porém, mexe na visibilidade, e o código atual não está
pronto para isso.

### Visibilidade derivada do Contato

- `orderReadable`
  ([`order-contact-access.js`](../../modules/orders/src/adapters/order-contact-access.js))
  libera o Pedido para quem pode ler o Contato do `contact_id` e o Contato
  atual da conversa de origem (`commercialContact`). A linha da conversa de
  origem não entra no predicado.
- `contactVisible`
  ([`contact-access.js`](../../modules/contacts/src/adapters/contact-access.js))
  torna um Contato visível a todos os vendedores quando ele tem qualquer
  identidade da linha geral.
- **Desenho vigente:** a WAP-07 diz que "Pedido segue a ACL comercial"
  ([spec do WhatsApp por vendedor](../../.specs/features/seller-whatsapp/spec.md)).
  Num Contato já compartilhado, os Pedidos de conversas da linha pessoal
  ficam visíveis aos demais vendedores por desenho. O
  [primeiro envio](../../apps/api/src/seller-whatsapp-first-send-runtime.js)
  já cria esse estado misto sem união, ao anexar uma identidade pessoal a um
  Contato da carteira que tenha identidade da linha geral.
- **Consequência da união:** unir um cliente hoje privado da linha pessoal do
  vendedor A (só identidade pessoal) a um Contato com identidade da linha
  geral torna o Contato visível a todos. Os Pedidos que hoje só A vê passam a
  aparecer ao vendedor B, e a proteção de cliente privado da WAP-07/08 deixa
  de valer para eles. O efeito inverso também ocorre: um Contato manual
  (`wallet_created=false`) que ganha identidade pessoal fica oculto para os
  demais, e seus Pedidos somem para quem não é dono deles.
- O evento ao vivo `inbox.order.changed` é autorizado pela conversa
  (`assertReadable` em `eventForReader`,
  [`operation-runtime.js`](../../apps/api/src/operation-runtime.js)), não por
  `orderReadable`.
- Hoje nenhum caminho de produção une identidades. A escrita em
  `identity_links` e a troca de `current_contact_id` só existem em
  `mergeIdentity`/`unmergeIdentity` do
  [`postgres-contact-identity-repository.js`](../../modules/contacts/src/adapters/postgres-contact-identity-repository.js),
  usado apenas em testes; outros módulos só leem `identity_links`.

### Carteira no ingresso pessoal

O inbound da linha pessoal cria `seller_client_link` automaticamente (bloco
após `if (personal && !personal.pending)` em
[`postgres-repository.js`](../../modules/n8n-integration/src/postgres-repository.js)).
Um vínculo `revoked` faz o ingresso lançar `N8nForbiddenError`, e a mensagem
é rejeitada. Reusar um Contato entre linhas pode, portanto, criar carteira
implicitamente ou perder a mensagem, o que a
[ADR 090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md)
proíbe ("nunca … transferir responsabilidade/venda implicitamente").

### O que conta como prova hoje

- **Linha geral (Meta Cloud API):** o número do remetente informado pela Meta
  no inbound prova o controle da conta WhatsApp naquele momento, não a
  titularidade individual.
- **Linha pessoal (Evolution):** o workflow só aceita telefone quando há um
  único `remoteJidAlt` correspondente; `@lid` sem correspondência nunca vira
  telefone e falha com `EVOLUTION_IDENTITY_UNRESOLVED`
  ([`create-seller-whatsapp-evolution-workflow.mjs`](../../ops/n8n/workflows/create-seller-whatsapp-evolution-workflow.mjs)).
- **Número digitado** (primeiro envio, cadastro manual, chat do site): nunca
  prova ([ADR 033](../adr/033-telefone-no-cadastro-e-roteamento.md), item 4;
  comentário da
  [migração 0038](../../modules/database/migrations/0038_contact_phone_details.expand.sql)).
- **`phone_status` não distingue prova.** A
  [migração 0006](../../modules/database/migrations/0006_phase2_inbox_contacts.expand.sql)
  exige `phone_status='confirmed'` em toda identidade WhatsApp, e o primeiro
  envio grava `confirmed` a partir de número digitado
  ([`seller-whatsapp-first-send-runtime.js`](../../apps/api/src/seller-whatsapp-first-send-runtime.js)).
  A T07 precisa de proveniência explícita.
- **Nono dígito.** `normalizeContactPhone`
  ([`contact-details.js`](../../modules/contacts/src/domain/contact-details.js))
  aceita 10 ou 11 dígitos nacionais e não concilia as variantes. Elas são
  candidatos distintos e vão para revisão, nunca para união automática.

## Proposta

1. **Primeiro a visibilidade (D06, C20-T17).** Os predicados de leitura
   (`orderReadable`, `contactVisible` e a autorização do evento de Pedido)
   passam a considerar a linha de origem da conversa, de modo que unir
   identidades nunca amplie a visibilidade. Contatos sem identidade pessoal
   não mudam de resultado. Nos Contatos que já estão em estado misto pelo
   primeiro envio, a opção recomendada em D06 retira dos demais vendedores
   os Pedidos de conversas da linha pessoal. T01 caracteriza e T02 mede esse
   universo antes do aceite de Produto. A regressão compara, em fixture
   sintética, o antes e o depois de unir uma identidade pessoal a um Contato
   da linha geral, e preserva "o vendedor do pedido sempre o mantém".
2. **Proveniência explícita (D01, C20-T07).** Um vínculo canônico ativo por
   telefone normalizado registra método e referência da prova, vigência,
   estado e versão, com unicidade só entre vínculos verificados ativos. O
   vínculo acompanha merge e desfazer merge de `identity_links`, que mudam
   `current_contact_id`. A migração 0038 não é editada: o
   [executor de migrações](../../modules/database/src/migrations.js) guarda o
   sha256 do arquivo inteiro, comentários incluídos, e recusa a partida se ele
   mudar. O novo significado fica no cabeçalho da migração expand nova da T07
   e no ADR.
3. **Associação assistida como padrão inicial do piloto.** A busca por
   telefone sugere candidatos; um operador autorizado confirma com versão,
   motivo e auditoria. A confirmação reaproveita `identity_links` e
   `mergeIdentity`, que existem mas não estão montados na API. Associação
   automática só para as provas aprovadas em D01 e depois da T17.
4. **Contato isolado em vez de rejeição.** Quando o vínculo do vendedor com o
   Contato reutilizado estiver revogado, ou houver conflito, a entrada é
   preservada num Contato isolado e vai para revisão. O termo é "Contato
   isolado" porque `contacts.provisional` já existe e vale para todo Contato
   de inbound.
5. **Concorrência (C20-T08).** As travas atuais incluem a conta da linha, e
   duas linhas não se serializam. O cadastro manual trava
   `hashtext(phoneHash)` antes do Contato; o ingresso usa
   `hashtextextended`. A T08 escolhe uma única chave entre linhas, uma única
   função de hash e uma ordem compatível com os dois caminhos, com teste
   concorrente em PostgreSQL real. Há dois resolvedores: o do módulo contacts
   só roda em teste, e a produção resolve em `modules/n8n-integration`. A T08
   escolhe um e alinha ou remove o outro.
6. **Ingresso, saída e eco (C20-T09, T10).** A T09 depende da T08 e da T17.
   Flag desligada e allowlist vazia por padrão. Cada ciclo conserva a
   política da sua linha; número digitado num envio humano não vira prova.
7. **Lotes e piloto (C20-T11, T12, T14).** Ensaio em simulação, lotes
   reversíveis com checkpoint e aceite humano, duas linhas definidas em D04,
   e pausa que bloqueia novas associações automáticas sem perder eventos.
8. **Aviso de simultaneidade (C20-T13).** Segue a D07.

## Supersessão explícita

O ADR que registrar D01 e D06 substitui expressamente:

- a [ADR 033](../adr/033-telefone-no-cadastro-e-roteamento.md), Decisão
  item 3 ("não há união automática nem seleção silenciosa"), só para a prova
  aprovada em D01;
- a [ADR 090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md),
  linha "Vincular, transferir ou unir cadastros" ("Nunca unir por
  telefone/nome"), com a mesma restrição;
- se D06 aceitar a linha de origem, a frase "Pedido segue a ACL comercial" da
  WAP-07 na
  [spec do WhatsApp por vendedor](../../.specs/features/seller-whatsapp/spec.md),
  para Pedidos de conversa da linha pessoal;
- o comentário da migração `0038_contact_phone_details.expand.sql`, que fica
  como histórico (o arquivo não pode mudar, porque o checksum é conferido na
  partida); o novo significado é registrado no cabeçalho da migração expand
  nova da T07 e no ADR.

O [RULES.md](../../RULES.md) já admite associar identidades ao mesmo Contato
após "correlação verificável e auditável"; nenhuma invariante muda.

## Alternativas consideradas

- **Associação só manual, permanente.** Menor risco e caminho de degradação
  se a prova automática for insuficiente, mas mantém a carga do operador.
  Fica como padrão inicial (item 3), não como destino final.
- **Unir automaticamente quando `phone_status='confirmed'`.** Descartada: o
  status atual não distingue número provado de número digitado.
- **Normalizar o nono dígito e unir as variantes.** Descartada: variantes são
  candidatos distintos e podem ser pessoas diferentes.
- **Unir mantendo a visibilidade derivada do Contato (WAP-07 como está).**
  Descartada: a união tornaria públicos Pedidos de clientes hoje privados da
  linha pessoal, sem decisão de quem os vê.
- **Manter a ACL comercial e só unir Contatos sem histórico privado.** Um
  cliente com Pedido de conversa pessoal só seria unido após aceite explícito
  da exposição. Preserva a WAP-07, mas cria uma exceção operacional difícil
  de explicar. Fica como alternativa se D06 rejeitar a linha de origem.
- **Proibir unir identidade pessoal com a da linha geral.** Evita a exposição,
  mas não atende o objetivo do piloto. Fica como resultado se D06 não fechar.
- **Novo cadastro central.** Duplicaria Contatos, carteira, autorização e
  Pedidos durante a transição.

## Riscos

- **Exposição de Pedidos da linha pessoal** se qualquer associação entrar
  antes da T17. Mitigação: T09 depende da T17; gate G02 antes e depois.
- **Carteira muda sozinha ou inbound é rejeitado** (PM10 do
  [pré-mortem](../../.specs/features/crm-20/pre-mortem.md)). Mitigação: D06,
  T17, T09, gates G02 e G04.
- **Pessoa errada no mesmo Contato:** número reciclado, compartilhado ou
  variante de nono dígito. Mitigação: D01, associação assistida, revisão e
  reversão com versão.
- **Corrida entre linhas** com travas que não se serializam. Mitigação: T08 e
  G03.
- **Lote sem retorno.** Mitigação: simulação padrão, checkpoint, reversão
  seletiva e reconciliação (G07, G08).
- **Aviso que revela conversa oculta.** Mitigação: D07 dentro das ADRs 088 e 095.

## Decisões a registrar

As decisões abaixo estão pendentes de aceite dos responsáveis. A coluna de
recomendação é a proposta deste RFC, não decisão tomada. D06 vem primeiro
porque sem ela nenhuma prova de D01 pode ser usada com segurança.

| ID  | Decisão e recomendação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Quem fecha                       | Bloqueia                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------- |
| D06 | Visibilidade e carteira com identidades de linhas diferentes no mesmo Contato. **Recomendação:** (a) visibilidade de Pedido e de Contato pela linha de origem da conversa, de modo que unir nunca amplie a visibilidade; isso substitui, para Pedidos de conversa pessoal, a frase "Pedido segue a ACL comercial" da WAP-07 e muda o resultado nos Contatos já mistos medidos em T02; (b) reusar o Contato não cria vínculo de carteira implícito sem regra aprovada; (c) com vínculo revogado, a entrada é preservada em Contato isolado e vai para revisão, nunca é perdida. | Produto, Tech Lead, Privacidade  | T17 e T07 (T09 a T14 transitivamente) |
| D01 | Provas aceitas por transporte, validade, conflito e reutilização de número. **Recomendação:** associação assistida como padrão inicial; candidatas a prova automática: número do remetente da Meta na linha geral e `remoteJidAlt` único na Evolution; número digitado nunca prova; variantes de nono dígito vão para revisão; número reciclado ou em disputa preserva os vínculos anteriores.                                                                                                                                                                                 | Produto, Tech Lead, Privacidade  | T07 e T08 (T09 a T14 transitivamente) |
| D04 | Duas linhas, lotes, limites, sinal de pausa e critérios de promoção do piloto. **Recomendação:** duas linhas nomeadas na configuração privada, lotes pequenos com aceite humano, pausa que bloqueia novas associações automáticas e promoção só com G03, G07 e G08 aprovados.                                                                                                                                                                                                                                                                                                  | Operação, Tech Lead, Privacidade | T11 (ensaio), T12 (escrita) e T14     |
| D07 | Aviso de simultaneidade. **Recomendação:** aviso só para quem já vê as duas conversas, sem supersessão. Qualquer aviso a quem não vê a outra conversa exige novo ADR que supersede parte das ADRs [088](../adr/088-leitura-de-conversas-por-responsavel.md) e [095](../adr/095-supervisao-das-linhas-pessoais.md), que proíbem enumerar conversas ocultas em histórico, contagens e eventos.                                                                                                                                                                                   | Produto e Privacidade            | T13                                   |

D02, D03 e D05 estão no
[RFC 075](075-crm-20-centrado-no-cliente.md#decisões-a-registrar).

Enquanto as decisões estiverem abertas, valem as autorizações e os
comportamentos atuais. Cada decisão aceita vira ADR com o próximo número
livre na `master` (hoje 099), vinculado a este RFC, antes da tarefa que ela
bloqueia: D06 e D01 antes da T07 e da T17, D04 antes da T11, D07 antes da
T13.

## Rastreabilidade e próximos passos

- [Especificação e critérios de aceite](../../.specs/features/crm-20/spec.md)
- [Arquitetura e contratos propostos](../../.specs/features/crm-20/design.md)
- [Branches, dependências e ordem de merge](../../.specs/features/crm-20/tasks.md)
- [Matriz de regressão e homologação](../../.specs/features/crm-20/validation.md)
- [Pré-mortem e condições de parada](../../.specs/features/crm-20/pre-mortem.md)
- [Prompts por tarefa](../../.specs/features/crm-20/PROMPTS.md)
- Proposta em revisão no
  [PR 463](https://github.com/romulosutil/crm-silmer/pull/463).
- ADRs relacionadas: [033](../adr/033-telefone-no-cadastro-e-roteamento.md),
  [088](../adr/088-leitura-de-conversas-por-responsavel.md),
  [090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md),
  [091](../adr/091-contratos-da-etapa1-whatsapp-pessoal.md) e
  [095](../adr/095-supervisao-das-linhas-pessoais.md); RFCs
  [066](066-visibilidade-de-conversas-por-responsavel.md) e
  [067](067-whatsapp-por-vendedor-e-meus-clientes.md).

Próximos passos:

1. Fechar D06 e D01 e registrar o ADR com a supersessão acima.
2. C20-T07 (proveniência) e C20-T17 (visibilidade por linha de origem), ambas
   sobre a baseline da T01.
3. T08 → T09 → T10; T11 em simulação após D04; T12 após T10 e T11.
4. D07 antes da T13; T14 homologa a ponta integrada e só então Operação
   ativa as linhas de D04.

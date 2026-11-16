# WhatsApp por vendedor — desenho técnico da etapa 1

Data: 16/11/2026. SDD **WAP-T00d**, execução enxuta **WAP-T00e**, WAP-01–12/16–33.
Os [12 prompts WAP-E01–E12](PROMPTS.md) são as unidades de execução; os 32 itens T
permanecem checklist interno. WAP-E07 verifica o gate prioritário WAP-T02a-05.
Esta revisão organiza execução sem alterar contratos ou a ADR 091.
Base de produto: [spec](spec.md), [RFC 067](../../../docs/rfc/067-whatsapp-por-vendedor-e-meus-clientes.md)
e [ADR 090](../../../docs/adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md),
[PR 382](https://github.com/romulosutil/crm-silmer/pull/382).
Decisões técnicas: [ADR 091](../../../docs/adr/091-contratos-da-etapa1-whatsapp-pessoal.md).
Execução: [tarefas atômicas](tasks.md) e [prompts completos](PROMPTS.md).
Desenho especificado; runtime, migrações e homologação ainda não executados.

## 1. Resultado e ordem de entrega

O primeiro gate integrado é **WAP-T02a**: inbound real validada → conversa
humana do titular → confirmação humana de criar Pedido → pendente numerado,
com Cliente/conversa/Assunto/responsável corretos → abrir e preencher ficha.
Desconexão posterior não impede esse comando local. Sugestão da IA, primeiro
envio, cadastro fiscal completo e importação antiga não são dependências.

Construir apenas os fundamentos necessários antes desse gate. Verificá-lo
primeiro em PostgreSQL e navegador com dados sintéticos; essa evidência não
homologa transporte real. Configuração completa, primeira saída opcional e
sincronização do aparelho completam a etapa 1 depois do gate. Piloto exige todas
essas capacidades. Importação de até 30 dias, troca de número e sucessão ficam
em WAP-T06/T07, fora desta implementação.

## 2. Baseline verificada e fronteiras

Mapa consultado: `graphify-out/GRAPH_REPORT.md`, de 04/10/2026, commit
`c237200a`; antigo, usado só para descoberta. Fontes confirmadas por `rg` no
head `b04c0170` da PR 382 e no checkout `d7537b3c` de master. Revalidar esses
pontos na master atual antes de cada tarefa; não reconstruir entregas novas.

| Fronteira             | Fonte existente e consequência                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente oficial       | `modules/contacts/src/`, `apps/api/src/operation-routes.js` e `operation-runtime.js`: reutilizar validadores, envelopes, telefone e versões.                                                             |
| Carteira              | Não existe vínculo durável vendedor/Contact equivalente ao contrato WAP. Criar associação própria, sem duplicar Contact.                                                                                 |
| Canal                 | Migration `0006_phase2_inbox_contacts.expand.sql`: identidade, conversa e mensagem já têm `provider`/`provider_account_id`; deduplicação de mensagem é por conta/ID.                                     |
| Visibilidade          | ADR 088 e repositórios Inbox/Contato já recebem escopo do leitor, mas a regra de conversa sem dono não pode publicar linha pessoal; revisar todos os joins e contagens.                                  |
| Pedido humano         | `apps/api/src/order-routes.js`, `order-runtime.js`, `modules/orders/src/application/order-service.js`: POST atual aceita só `expectedVersion`, reutiliza pendente por conversa e não fecha alvo Assunto. |
| Assuntos              | `modules/inbox-channels/src/application/subject-service.js` e `adapters/postgres-order-assistance.js`: reutilizar vínculo/seleção; não exigir sugestão de IA para criar.                                 |
| Unicidade de Pedido   | Migration `0070_order_cancellation.expand.sql`: índice parcial `orders_one_pending_per_conversation` ainda limita o pendente direto. A tarefa de alvo deve conservar compatibilidade explicitamente.     |
| Transporte            | `ops/n8n/workflows/create-evolution-workflow.mjs`: configuração de sessão/número único e descarte de `messages.upsert` com `fromMe=true`; faltam roteamento pessoal e fato outbound do aparelho.         |
| Privacidade Evolution | `ops/evolution/README.md`, `privacy.cjs` e `retention.cjs`: imagem fixada, gateway privado, webhook restrito e sem QR. Revalidar o wrapper antes de habilitar novas instâncias/eventos.                  |
| UI                    | Vue 3 e componentes de Inbox/Clientes/Pedido existentes. Master `d7537b3c` já mantém Criar pedido no cabeçalho: preservar a correção ao integrar.                                                        |

Continuar no monólito, com PostgreSQL, worker, RustFS, Evolution e n8n existentes.
Nenhum acesso n8n ao banco CRM, novo serviço por vendedor, store global ou
transporte alternativo. Alteração de arquitetura fora desse contrato exige RFC/ADR.

## 3. Dados e invariantes de persistência

Nomes abaixo são o contrato lógico; DDL deve respeitar tipos/FKs/envelopes e
convenções reais. Alocar o próximo número de migração na hora de implementar;
não reservar agora números que outras entregas podem consumir.

| Registro lógico              | Campos mínimos e invariantes                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seller_client_links`        | ID opaco, `seller_id`, `contact_id`, origem comprovada, estado ativo/revogado, versão, autor e datas. Um par vendedor/Contact; reativação explícita versiona o mesmo par. Nenhuma FK à sessão/geração da linha.                                                                                                                                                                          |
| `seller_whatsapp_lines`      | ID opaco, titular, conta técnica estável opaca, referência de instância privada, número esperado/confirmado cifrados e digest de busca, estado, geração, versão, última verificação/corte de sincronização. Uma linha pessoal não substituída por vendedor; número reservado/confirmado não pode ter dois titulares, nem conflitar com conta geral. Desconectar não libera titularidade. |
| `seller_whatsapp_operations` | ID, linha/geração, tipo conectar/reconectar/desconectar, ator, chave/fingerprint, estado, referência de correlação, início e resultado mínimo. Uma operação mutante não resolvida por linha. Mesmo comando repete o resultado autorizado; chave com corpo distinto conflita. Nunca contém QR/código, número ou payload bruto.                                                            |

Conta técnica permanece ligada à origem histórica; geração cerca tentativa e
revogação, sem reescrever mensagens/identidades antigas. Reconectar o mesmo
número preserva carteira/conta e não cria outro Cliente. Mudança de número é
recusada na etapa 1. Provar a unicidade com duas conexões PostgreSQL reais.

Usar locks e CAS, não apenas validação JavaScript. Escrita cadastral e criação/
revogação de vínculo compartilham lock do Contact para serializar a passagem de
um para dois vínculos ativos. Ordem documentada: usuário/capacidade → linha
(se pertinente) → Contact/vínculo → conversa → Assunto → Pedido → ledger/outbox.
Antes de codificar, confrontar a ordem com os locks dos serviços existentes;
adaptar a ordem global e registrar prova concorrente se houver inversão. Não
executar HTTP dentro de transação. Backfill só com evidência comercial
autorizada, origem e contagem verificáveis; nunca por criador ou telefone.

## 4. Autorização e privacidade

Matriz é do servidor; UI usa projeções de capacidade, não inventa permissões.

| Recurso                           | Vendedor ativo                                             | Admin humano ativo                                | Financeiro/inativo/técnico                           |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Carteira e Cliente comum          | Próprio vínculo ativo; cadastro comum autorizado           | Capacidade administrativa vigente                 | Nenhuma herança de carteira pessoal                  |
| Conversa/identidade/mídia pessoal | Titular da linha e posse elegível; vínculo comum não basta | Leitura/ação conforme capacidade já existente     | Negado; técnico só contrato de integração específico |
| QR/código                         | Só titular da tentativa atual                              | Diagnóstico/bloqueio por metadados; sem QR alheio | Negado                                               |
| Pedido/cobrança/arquivos          | ACL comercial atual, independente de vínculo comum         | Capacidades comerciais atuais                     | Preservar permissões existentes; sem chat adicional  |
| Sucessão/transferência pessoal    | Não disponível nesta etapa                                 | Sem atalho via transferência genérica; etapa 2    | Negado                                               |

Filtrar antes de busca, count, cursor e paginação em Clientes geral e Meus
clientes, Inbox, detalhes, identidades, histórico, mídia, Assuntos, contexto e
replay. Contact compartilhado expõe somente cadastro comum e relações permitidas;
não expor telefones/identidades de outra linha pelo join. Não tornar inacessível
o universo geral antes autorizado sem relação com linha pessoal: acrescentar
isolamento WAP preservando os contratos anteriores. Testar objetos exclusivos,
compartilhados e legados separadamente.

SSE revalida sessão/capacidade/vínculo/posse/linha antes de cada projeção e
replay. Evento contém IDs/versão/campos alterados mínimos, sem valores pessoais,
número de outra linha ou identidade de outro vendedor. Perda de acesso limpa
projeção, rascunhos privados e requisições em voo; resultado tardio não restaura
conteúdo. Erros de colisão inacessível são genéricos, sem candidatos privados.

Edição compartilhada compara valores normalizados por campo sob lock:
comuns permitidos; fiscal vazio pode ser preenchido; CPF/CNPJ/tipo já
preenchidos só Admin com motivo/conferência; telefone principal compartilhado
só Admin após conferência. Reenvio de valor restrito igual é no-op. Conflito
409 preserva rascunho e exige nova revisão, sem overwrite automático. Auditar
autor/horário/nomes de campos; motivo com dado pessoal usa envelope protegido.
Preservar snapshots confirmados e nome atual de pendentes (ADR 018). Mudança
relevante invalida preparo afetado; nunca redireciona reserva iniciada.

## 5. HTTP humano e controle n8n

Complemento de WAP-E01: [RFC 069](../../../docs/rfc/069-ingresso-efemero-e-geracao-autenticada-do-whatsapp.md)
e [ADR 092](../../../docs/adr/092-sanitizacao-pre-persistencia-e-geracao-na-origem.md)
definem patches estreitos de pré-persistência n8n e captura de geração no
callback do socket Evolution. Auth nativa ocorre antes da projeção do input;
manual/partial/retry e settings inseguros são cercados antes da primeira escrita.
Source e token por geração são imutáveis antes da fila; verificador no ingresso
compara source/instância e autorização vigente sem reclassificar evento antigo.
A prova desta fatia usa fixture privada sintética; não entrega API de binding
ou controle E02/E04. Imagens e flags reais permanecem inalteradas.

Rotas novas são aditivas sob `/api/v1`; registrar OpenAPI no formato vigente.
Toda mutação exige sessão humana atual, CSRF, origem, capacidade, versão e
`Idempotency-Key`; revalidar antes de devolver replay. Derivar seller/conta no
servidor. Recusar `userId`, `instanceName`, URL do gateway e destinatário
arbitrários. Usar limites já existentes e tornar limites novos explícitos no
contrato/testes; não definir números sem ensaio de capacidade.

| Método/caminho                                     | Entrada/saída mínima                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/clients`                                  | Busca/cursor/limite validados; Contact e versão de vínculo, capacidades de ações e conversa acessível. Sem exigir linha.  |
| `POST /me/clients`                                 | Nome/telefone/e-mail atuais; Contact + vínculo na mesma transação; 201 ou replay 200. Não criar conversa/envio.           |
| `POST /me/clients/:contactId/link`                 | Versão esperada do Cliente acessível; vínculo explícito idempotente. Não unir nem transferir.                             |
| `GET /me/whatsapp`                                 | Estado, versões, geração e número próprio mascarado; operação pendente e disponibilidade. Leitura não cria nem reconecta. |
| `POST /me/whatsapp/connect`                        | Número esperado e versão; conecta/reconecta a única linha; 202 com operação opaca. Repetição não cria outra instância.    |
| `POST /me/whatsapp/disconnect`                     | Versão/geração; 202 com intenção durável. Não apagar carteira, histórico ou instância por limpeza.                        |
| `POST /me/whatsapp/pairing-challenge`              | Operação/versão/geração e modalidade QR/código; resposta efêmera só ao titular. Não é leitura GET com efeito oculto.      |
| `PATCH /contacts/:contactId/...`                   | Reutilizar rotas cadastrais atuais e versões; aplicar a política compartilhada a todas, inclusive caminhos legados.       |
| `POST /conversations/:conversationId/orders`       | Extensão compatível de alvo descrita na seção 7; resposta mantém `{order}`.                                               |
| `POST /contacts/:contactId/whatsapp/conversations` | Primeiro envio opcional, seção 9; não cria efeitos ao abrir compositor.                                                   |

Erros novos: 400 corpo/destino inválido, 401 sessão, 403 operação proibida,
404 recurso não visível, 409 versão/alvo/número/conteúdo idempotente em conflito,
429 limite e 503 integração indisponível. Códigos específicos mínimos:
`WHATSAPP_LINE_CONFLICT`, `WHATSAPP_OPERATION_UNCERTAIN`,
`WHATSAPP_GENERATION_STALE`, `CONTACT_VERSION_CONFLICT`,
`ORDER_TARGET_REQUIRED`, `ORDER_TARGET_STALE`. Reutilizar códigos vigentes
quando equivalentes; `application/problem+json` no contrato técnico n8n e o
envelope HTTP vigente nas rotas humanas, sem quebra global de formato.

Controle usa comando técnico próprio no pipeline durável worker → n8n →
Evolution. Não reutilizar `message.send.requested` ou revisão inbound para
parear. n8n só executa operação/linha/geração autorizadas, com Basic técnico,
correlação e identidade de workflow existentes. Resultado persistido no CRM é
somente metadado validado; callback velho não restaura geração.
`POST /api/v1/integrations/n8n/whatsapp-control/results` é a rota técnica de
resultado, separada de inbound. Recebe operação/linha/geração, ID do resultado,
tipo de efeito e outcome; número confirmado e estado observado somente como
dados privados validados, sem payload bruto ou QR. Responde recibo mínimo.
Repetição idempotente revalida fonte/operação, corpo distinto conflita e
geração velha só registra conclusão do efeito antigo, sem ativar a atual.

O worker entrega ao webhook de controle n8n configurado no servidor um envelope
com operationId, lineId, generation, action e referência opaca autorizada;
action pertence ao enum connect/reconcile/disconnect. Só reconciliar faz
consulta sem novo efeito; resultado desconhecido não autoriza novo connect.
O desafio usa webhook síncrono separado, com operationId/challengeId/geração/
modalidade, sem job com segredo. Não expor URLs técnicas ao browser. Schemas
estritos, fixtures e capabilities humanas/técnicas deste contrato fazem parte
de WAP-T01-03/04. Ingresso por geração deve ser provado em WAP-T01-01.

QR/código fazem round-trip efêmero síncrono API → n8n → gateway, correlacionado
à operação já persistida. Não colocá-los em jobs/outbox ou resultados de
idempotência. Persistir somente metadados do desafio (ID, geração, validade e
resultado mínimo). Replay não regenera desafio nem recupera bytes antigos;
perda de resposta/resultado incerto exige releitura e reconciliação. Renovação
é comando explícito versionado que invalida o anterior, após resolver a
incerteza; expiração isolada não autoriza repetir efeito externo. n8n deve
provar que não grava execução bem-sucedida, falha, manual ou em progresso que
contenha o segredo, nem pinData, error workflow ou payload em log. Gateway,
proxy, tracing e browser também sem cache/storage/captura. O spike deve provar
isso com canário sintético e inspeção de persistência/backups aplicáveis. Se o
mecanismo real não suportar essa garantia, a tarefa fica bloqueada nesse ponto;
não contornar chamando gateway direto do browser ou persistindo o segredo.

## 6. Ciclo de conexão e inbound pessoal

Estados públicos: `not_configured`, `preparing`, `awaiting_pairing`, `validating`,
`connected`, `disconnected`, `disconnecting`, `blocked`, `unknown`.
Operações: `pending`, `dispatching`, `succeeded`, `failed_before_effect`,
`unknown`, `reconciled`. Guardar transições monotônicas por operação/geração;
callback com estado fora de ordem não reativa linha. `unknown` bloqueia novo
efeito criador até consulta/reconciliação. Nova tentativa posterior só com
prova de ausência de efeito ou conclusão anterior, nunca por expiração isolada.

Ativar só após confirmar número real, titular ativo, conta única, webhook
autenticado e geração corrente. Browser informar telefone não é prova.
Desconectar/inativar cerca novo despacho e invalida desafios; trabalho externo
já iniciado pode concluir e deve ser registrado sem reabrir acesso. Somente
Admin recebe pendência de titular inativo; não transformar em conversa sem dono.

Inbound é normalizada pelo n8n. A recepção deve ficar vinculada imutavelmente
à conta/linha/geração que a originou: token ou rota opaca de ingresso por
geração, validada no servidor, ou mecanismo equivalente provado no spike.
Não confiar em geração arbitrária no payload nem consultar a geração atual
para reclassificar callback antigo. Reconnect exige invalidar o ingresso
anterior e provar tratamento de eventos atrasados antes de ativar o novo.
Segredo de ingresso fica privado no servidor/n8n, sem log ou URL pública de
diagnóstico. Mesmo contato em duas linhas tem identidades/conversas separadas;
deduplicar por conta/ID. Resolver identidade oficial sem fundir por telefone,
criar vínculo de carteira comprovado pela entrada, conversa humana e atribuição
ao titular em uma transação. Linha geral segue a jornada atual. No ramo pessoal,
não agendar IA, resposta automática ou análise que envie; não disparar Pedido.
Permitir apenas eventos novos correntes; lacuna fica explícita, sem importação
histórica incidental antes da etapa 2.

## 7. Pedido pela conversa: contrato e transação

Primeiro fechar o alvo, depois implementar UI. O endpoint existente conserva
`expectedVersion` da conversa. Acrescentar par opcional `subjectId` e
`expectedSubjectVersion`, validado estritamente e incluído no fingerprint.
Sem par, só operar no alvo legado inequivocamente resolvido; mais de um alvo
possível retorna `ORDER_TARGET_REQUIRED`. Omitir alvo não significa escolher
o primeiro pendente encontrado no banco.

Persistir `orders.origin_subject_id` nullable e conservar `conversation_id`.
Reutilizar a chave única de Assunto `(id, conversation_id)` já existente em
`0037_conversation_subjects.expand.sql`, sem índice duplicado, e adicionar FK
composta `(origin_subject_id, conversation_id)`; origem por Assunto exige
conversa não nula. O índice legado continua único por conversa para pendentes
não cancelados com `origin_subject_id IS NULL`; índice novo é único por
`origin_subject_id` para pendentes não cancelados. O escritor impede coexistir
pendente legado sem alvo e criação explícita sem primeiro resolver esse legado
na mesma conversa/Contact. Backfill automático somente de pendente ativo com
vínculo único comprovado; cancelados imutáveis e demais históricos conservam
origem nullable com leitura compatível. Ambiguidade gera relatório privado de
IDs, não atribuição inferida. Não reescrever snapshots
ou eventos históricos. Novo alvo promove Assunto geral sem Pedido ao Pedido
criado atomicamente; Assunto já vinculado não troca de Pedido por cancelamento.

Deploy em duas fases: DDL aditivo e todos os leitores/escritores compatíveis
primeiro; habilitar múltiplos alvos depois. `findPendingByConversation`, contexto
comercial, projeção automática e consultas de Pedido recusam ambiguidade ou
exigem alvo; não escolhem primeira linha. APIs de confirmação, reabertura,
cancelamento e fonte da ficha preservam a origem. Reabertura disputa a mesma
unicidade por alvo; falha retorna conflito, sem trocar vínculo. Rollback após
uso de múltiplos alvos aceita somente SHA compatível com esse modelo, com novas
criações desligadas; binário antigo não é rollback seguro.

Com Assunto explícito, conferir pertencimento à conversa/Contact e versão sob
lock. Se já vincula pendente elegível, retornar esse Pedido; se aponta histórico
confirmado/cancelado, não o reabrir nem substituir silenciosamente. Novo Pedido
exige novo Assunto explícito pelo fluxo atual. A tarefa WAP-T02a-01 entrega
schema e compatibilidade de leitura antes de liberar o comando; não remover
unicidade por conversa sem uma substituição equivalente por alvo.
O desenho exige vínculo persistido no mesmo commit transacional do Pedido,
sem pedido solto intermediário nem chamada browser criar→vincular.

Na transação: revalidar humano/capacidade/posse pessoal, versão e conversa aberta;
fixar Contact, linha de origem e alvo; localizar pendente do alvo; criar somente
se ausente; reservar número, gravar vínculo/autor/responsável/ficha inicial,
recibo idempotente, evento e auditoria juntos. Sem HTTP, IA ou canal online.
Usar dados do alvo/Cliente atual, sem misturar briefing de outro Assunto. Autor
executor e responsável comercial continuam distintos no caminho administrativo.
Repetição autorizada devolve mesmo Pedido; duas chaves concorrentes não duplicam
alvo/número. Não impor sequência de numeração sem lacunas além do contrato atual.

Separar schema/compatibilidade, comando API/transação, UI e gate de integração.
Antes de aceitar WAP-T02a, provar novo alvo explícito e compatibilidade de
pedidos antigos, confirmação/reabertura/cancelamento, projeção por Assunto,
impressão e ACL; não reconstruir módulos comerciais.

UI captura conversa/Cliente/alvo/versões ao abrir confirmação. Ao mudar contexto
ou perder acesso, cancela diálogo/requisição e não navega com resposta antiga.
Duplo clique desabilitado sem substituir idempotência. Foco vai ao diálogo,
volta ao acionador ao cancelar e ao título da ficha ao abrir. Anunciar criação
ou reutilização. Preservar rascunho do chat; disponibilizar pedido pendente sem
exigir ficha completa. Confirmar criação não confirma comercialmente o Pedido.

## 8. Saídas correntes, aparelho e mídia

Antes de habilitar envio pessoal, reserva e despacho revalidam usuário ativo,
posse, conta original, linha/geração, epoch e contratos de envio aplicáveis.
Callback informa efeito já ocorrido mesmo após revogação, mas não concede nova
ação. Não mudar destino/conta de efeito iniciado nem usar a linha geral como
fallback. Desconectar mantém cobranças e recebimentos já existentes.

Novo fato técnico `message.external.sent` (nome lógico a versionar no schema
n8n) registra saída já feita no aparelho. Autenticar fonte e conta/geração;
chave única por conta/ID, origem `device`, autoria da linha sem afirmar operador
físico. Não enfileirar envio, consumir revisão inbound, abrir Pedido ou chamar
IA. Eco comprovado do CRM atualiza o mesmo registro; ordem HTTP→eco e eco→HTTP
produzem uma mensagem. Não correlacionar por texto/horário parecido. Saída sem
correlação fica externa/incerta até prova, sem retry ou falsificação de sucesso.
Recibos monotônicos, mídia privada e autorização seguem pipelines existentes;
sem bytes disponíveis, manter erro/lacuna visível. Não aumentar retenção.

## 9. Primeiro envio e ações comerciais após o gate prioritário

Primeiro envio individual recebe mensagem e versões de Cliente/vínculo/linha;
destino/conta derivados e conferidos no servidor. Validar capacidade/destino
antes de criar conversa. Compor identidade validada no mesmo Contact, reuso de
conversa ativa ou novo atendimento se encerrada, mensagem/outbox/auditoria em
uma transação. Identidade de outro Contact exige correlação autorizada: negar
reassociação silenciosa. Timeout de transporte conserva estado incerto. Abrir,
salvar ou vincular Cliente não envia. UI trata erro offline e revisão obsoleta.

Meus clientes reutiliza ficha/arquivos/PDF/cobranças vigentes por IDs e ACL.
Cadastro sem conversa continua permitindo ações locais elegíveis; enviar link
exige destino/conversa/linha válidos. Emitir cobrança, enviar e receber são
operações distintas. Callback financeiro duplicado após disconnect registra um
recebimento, sem emitir nova cobrança, depender de sessão WhatsApp ou criar
permissão comercial pelo vínculo comum. Prévia/intenções usam versões para
invalidar mudanças relevantes antes da reserva.

## 10. Verificação, operação e conclusão

Toda tarefa inclui contrato, testes proporcionais e documentação da própria
fronteira; QA final não adia autorização nem a11y. Os [prompts](PROMPTS.md)
definem gates exatos e evidência esperada. Tarefas não executadas permanecem
abertas, inclusive as que parecem já existir parcialmente.

| Gate                  | Evidência mínima                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WAP-T02a              | API/PostgreSQL concorrente + E2E/teclado: fluxo passivo completo, dois vendedores/mesmo Contact, alvo novo e existente, offline posterior, replay, troca de contexto, inativo e acesso cruzado.                              |
| Etapa 1 funcional     | Carteira antes de parear; edição compartilhada/conflito; QR e código/reconnect; saídas CRM/aparelho, eco fora de ordem e primeira saída opcional; cobrança independente do canal; regressão da linha geral.                  |
| Prontidão operacional | CI, SHA/digest, migrações compatíveis, limites/capacidade, logs sem PII/QR, flags desligadas por padrão, allowlist privada, health, backup/recovery e rollback sem restaurar acesso/envio revogado.                          |
| Piloto autorizado     | Dois vendedores/duas linhas e cliente sintético; prova real de pareamento mobile e de tráfego, Pedido pela conversa e demais ações. Aprovação operacional e financeira próprias, sem inferência a partir desta documentação. |

Cada tarefa que introduz endpoint/entrada/despacho entrega seu próprio guard
de configuração fail-closed, default desligado e allowlist privada quando
aplicável, com testes de ausência/valor inválido/usuário não habilitado. Não
deixar essa proteção para T05-01: cada PR pode acionar deploy automático.
T05-01 consolida inventário/configuração e limites medidos; não cria a primeira
trava. ACL dos registros pessoais e acesso ao histórico persistem com flag off.

Separar flags de controle, inbound, leitura e envio pessoal; não habilitar
despacho antes de toda a cadeia estar protegida. API/migração compatíveis antes
de publicar workflow dependente. Desligar feature impede novas conexões/envios,
preserva carteira/histórico/ledger e mantém ACL pessoal. Rollback não faz down
destrutivo nem reativa geração antiga. Restore entra com envio bloqueado até
reconciliação externa; revalidar permissões e desafios, sem restaurar QR.

O spike de provedor, ensaio de carga e homologação no mesmo celular são gates
com evidência ainda ausente, não decisões de produto a reabrir. Falha técnica
material é reportada com alternativa revisável; não substituir código por QR
em duas telas silenciosamente. Este SDD não autoriza publicação operacional,
pareamento de número real, mensagens a clientes ou efeito financeiro real.

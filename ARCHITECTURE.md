# Arquitetura — baseline do CRM Silmer

Reconciliada com a master em 10/10/2026; ficha v6, arte no RustFS, loja paga, chat do site e mídia do vendedor. Detalhes em
[TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md) e
[EASYPANEL-TOPOLOGY.md](EASYPANEL-TOPOLOGY.md).

## Produto e autoridade

O CRM é um monólito modular. PostgreSQL guarda Contato, Conversa, Mensagem,
Handoff, Pedido, auditoria e jobs. A interface Vue 3 oferece Dashboard,
Caixa de Entrada, Clientes, Pedidos, Vendedores e Conta. Negócio/Kanban
foram aposentados pela [ADR 004](docs/adr/004-aposentar-kanban-e-negocio.md).

O n8n recebe/envia WhatsApp e o chat do site, chama OpenAI (texto, imagem e
transcrição de áudio) e orquestra a coleta
([ADR 026](docs/adr/026-midia-e-chat-do-site-no-bot.md)). Nunca acessa
o banco do CRM. Toda mutação oficial passa pela API autenticada,
autorizada, idempotente e auditada. A mensagem inicia a automação; a UI
observa ou assume o atendimento. Instagram é CANAL-2, posterior ao piloto.

## Contratos ativos

- Integração n8n MVP: três endpoints de inbound, attachment e events,
  Basic Auth com `AUTOMATION_EXECUTOR`, briefing na Conversa e outbox
  CRM→n8n ([ADR 003](docs/adr/003-adotar-integracao-n8n-mvp-simples.md)).
- `message.send.requested` reserva um único efeito antes da Meta, usando
  `automation_epoch` e `source_revision`. Replay não autoriza novo envio;
  resultado incerto exige reconciliação, sem retry cego.
- Handoff começa sem responsável. Claim por CAS tem um vencedor. Takeover,
  handoff, fechamento e desligamento invalidam decisões obsoletas por epoch.
- A função humana vigente é `Vendedor`; capacidades adicionais são
  ortogonais. Sessão opaca, cookie seguro e CSRF protegem as mutações.
  A migration `0012_remove_mfa.contract.sql` retirou MFA do CRM;
  proteção do painel de infraestrutura é um controle distinto.
- Conversa transferida não retorna ao bot
  ([ADR 015](docs/adr/015-conversa-nao-volta-para-o-bot.md)).
- Loja do site: o workflow n8n do checkout da InfinitePay registra o pedido
  pago em `POST /api/v1/integrations/n8n/store-orders`, com o contrato das
  rotas n8n e a ação `store.order.record`, idempotente pelo `pedido_id` e
  auditada ([ADR 028](docs/adr/028-pedido-pago-da-loja-pelo-n8n.md)). Não
  há escrita pública sem autenticação.

## Pedido e ficha

Pedido tem `pendente` e `confirmado`, confirmação/reabertura humanas e
numeração global `NN-CRM`. Pode abrir a partir do primeiro ponto confirmado
da ficha; o bot preenche progressivamente, e o vendedor revisa/completa.
Um pendente acompanha o Contato; a confirmação congela o snapshot.

O template selecionado é `ficha-canonical-v6` (ADR 025).
Técnica pertence ao item e origem da arte ao pedido. Impressão exige Pedido
confirmado e autorização de leitura. A API devolve HTML imprimível; o PDF
sintético de aprovação é um artefato de revisão. Assinatura física de Rose
e Operação continua pendente para produção. Versões v2 a v5 são preservadas.

Arquivos da arte (até 5 de 10 MB e a arte final) são enviados e baixados
pela página do pedido e ficam no RustFS interno, só pela API
([ADR 023](docs/adr/023-arquivos-da-arte-no-rustfs.md)). Aviso a Rose e
automação PIX não são assumidos como entregues pelo ciclo atual de Pedido. Vendido conta
somente confirmados; não equivale a recebimentos.

O pedido da loja do site (`origin = loja`) nasce confirmado, sem conversa nem
Contato, ao preço do catálogo do CRM, com o Pix confirmado pela InfinitePay
(valor pago, NSU, comprovante), o número `LJ-…` e o prazo da cor; é travado,
conta como venda normal (teste não conta) e imprime a ficha simplificada
`ficha-loja-v1` ([ADRs 027](docs/adr/027-venda-da-loja-do-site.md) e
[028](docs/adr/028-pedido-pago-da-loja-pelo-n8n.md)).

## Baseline técnica

| Fronteira    | Implementação                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Frontend     | Vue 3, Vue Router, JavaScript ESM, CSS e Vite; sem store global                                                     |
| API          | Node.js/Fastify, REST `/api/v1`, OpenAPI e SSE                                                                      |
| Persistência | PostgreSQL, SQL e migrations versionadas                                                                            |
| Assíncrono   | Inbox/outbox e jobs transacionais; sem Redis                                                                        |
| Runtime CRM  | `silmer-edge-web`, `silmer-api`, `silmer-worker`, `silmer-postgres`; arquivos no RustFS `schedule/rustfs` (ADR 023) |
| Automação    | n8n externo obrigatório, persistência e credenciais próprias                                                        |
| IA           | OpenAI no workflow; [ADR 021](docs/adr/021-adotar-openai-no-mvp.md)                                                 |
| Deploy       | Fluxo automático GitHub→EasyPanel existente; [ADR 022](docs/adr/022-manter-deploy-automatico-github-easypanel.md)   |

Nova mídia enviada pelo vendedor no chat usa RustFS privado e fica salva
até nova decisão de retenção, sem expurgo por sete dias ou encerramento
([ADR 029](docs/adr/029-midia-do-chat-no-rustfs.md)). A implementação inclui
imagem, áudio anexado/gravado e vídeo, ACL privada, Range e cleanup apenas de
rascunhos sem vínculo. Homologação do pipeline construído, microfone físico,
ativação e recovery remotos permanecem gates independentes em
[INBOX-MEDIA-1](.specs/features/inbox-media-rustfs/tasks.md).

O envio só é liberado após validação de conteúdo e antivírus com definições
vigentes; indisponibilidade temporária preserva o rascunho sem autorizar
envio. Evidência sintética no chat DEV não homologa microfone físico nem
WhatsApp. A minimização e o expurgo dos dados de execução n8n identificados
na revisão de privacidade permanecem um gate de produção.

Mídia de canal legada fica em volume privado da VPS por até sete dias ou fim da
jornada. Arquivos válidos são anexados ao pedido e guardados no RustFS.
Perda da única cópia produz `lost/unavailable`. Esse prazo não se aplica a
Pedidos, Fichas, documentos comerciais ou auditoria. Storage externo é uma
evolução na issue #29; backups e tombstones têm gates próprios.

Os módulos/tabelas legados continuam onde migrations já publicadas exigem
compatibilidade. Não são uma segunda fonte de estado nem autorizam retomar
Kanban. Remoção física depende de migration contract.

## Prontidão operacional

OpenAI é escolhido; DPA, retenção, ZDR e request real ainda precisam de
evidência específica do projeto. Spikes Gemini anteriores não liberam o
provedor ativo ([runbook](docs/integrations/openai/README.md)).

Manter o deploy automático não comprova seu vínculo com CI, SHA ou imagem.
Esses checks, saúde, rede e configurações observadas estão no
[relatório operacional](docs/runbooks/production-readiness-checks.md).

Go-live exige homologação WhatsApp, aprovação física da v6, monitor off-host,
backup externo e drills com RPO de uma hora/RTO de quatro horas. Aplicar
CRM/migrations compatíveis antes do workflow que depende do contrato novo.
Rollback pausa a automação e preserva resultados incertos; não reativa o
webhook direto da Meta nem restaura banco como primeiro recurso.

Decisões anteriores continuam em `docs/adr/`; o histórico não substitui
`RULES.md` e as specs atuais. Rastreabilidade e pendências em
[tasks](.specs/features/crm-mvp/tasks.md).

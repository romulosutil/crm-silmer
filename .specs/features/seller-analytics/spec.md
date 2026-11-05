# Clarity — uso do CRM por vendedores

Autorização: solicitação do proprietário em 05/11/2026 para implementar o
projeto Clarity `z8yldgd1xr` e entender como vendedores humanos trabalham.
Rastreabilidade: PRV-01–03, [RFC 046](../../../docs/rfc/046-clarity-para-uso-dos-vendedores.md),
[ADR 057](../../../docs/adr/057-clarity-para-uso-dos-vendedores.md), CLAR-T01.

- **CLAR-01:** iniciar somente em build de produção, no host aprovado,
  depois da sessão de Vendedor, sem capacidade administrativa. Login, Conta,
  Financeiro, administração, localhost e desenvolvimento não enviam sessões.
- **CLAR-02:** segmentar o uso por pseudônimo SHA-256 do ID interno do vendedor,
  perfil e tela de uma lista finita; nunca enviar nome, e-mail ou ID bruto em
  eventos/tags. Pseudônimo ainda é dado pessoal pseudonimizado.
- **CLAR-03:** eventos estáticos distinguem início de criação, comandos aceitos
  pela API, confirmação/reabertura e ficha gerada/compartilhada. Aceite de
  mensagem não comprova entrega. Analytics não substitui auditoria ou métricas
  financeiras do PostgreSQL e não avalia produtividade individual isoladamente.
- **CLAR-04:** mascarar todo texto, entradas, imagens e links desde o primeiro
  snapshot; não desmascarar conteúdo comercial. Bloquear URLs desconhecidas,
  hashes, queries não autorizadas e referrer inseguro. Só detalhes com UUID são
  admitidos; `conversa=UUID` no Pedido é mascarado no metadado pelo SDK.
  Filtros dos atalhos do Dashboard são admitidos somente com chaves/valores
  finitos de situação/fila na Inbox e status/vendedor/origem/entrega em Pedidos,
  sem duplicatas, busca livre ou nome/ID de vendedor.
  Cookies e publicidade ficam negados desde o início; respeitar GPC/DNT.
  Excluir também destinos de links clicados e erros/logs JavaScript do protocolo,
  porque esses campos não são protegidos pela máscara de conteúdo.
- **CLAR-05:** SDK, hash, transporte ou bloqueador não podem afetar comandos,
  teclado, foco ou navegação. Encerrar antes da troca de contexto e invalidar
  uploads de gerações antigas, inclusive reinicializações internas do SDK.
- **CLAR-06:** biblioteca oficial fixa no lockfile, script local, único destino
  de coleta na CSP, sem credenciais/referrer no transporte; runbook com leitura
  dos eventos, limites, desativação e verificação operacional sintética.

Teste independente: SDK real em origem aprovada simulada, interceptação de
todo tráfego externo, canários de texto/atributos/mídia ausentes dos payloads,
cookies ausentes, exclusões e corridas de autenticação/navegação. Aceite de
ingestão no painel remoto é evidência operacional separada.

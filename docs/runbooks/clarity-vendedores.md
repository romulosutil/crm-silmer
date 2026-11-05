# Clarity — vendedores humanos

Contrato [CLAR-01–06](../../.specs/features/seller-analytics/spec.md), tarefa
CLAR-T01, [ADR 057](../adr/057-clarity-para-uso-dos-vendedores.md).
Projeto: [Clarity z8yldgd1xr](https://clarity.microsoft.com/projects/view/z8yldgd1xr/gettingstarted).

## Coleta e leitura

Ativo por padrão apenas no build de produção e no host
`crm.silmer.com.br`, para Vendedor sem
`COMMERCIAL_ADMIN`. Sem cookies e publicidade, com GPC/DNT respeitados.
Login, Conta e demais perfis/áreas não enviam dados. Documento inteiro e
imagens ficam mascarados, inclusive valores em formulários e links.
Se houver `_clck`/`_clsk` de uma instalação anterior, a coleta é suspensa;
remova somente esses cookies do site e recarregue para iniciar sem herdar
identidade/consentimento antigos. Cookies de sessão do CRM devem ser preservados.

Em Filters, use `crm_role=seller`, `crm_seller_key` e `crm_page`.
`crm_seller_key` é SHA-256 UTF-8 de `crm-silmer:clarity:seller:v1:<id interno>`.
O pseudônimo permite comparar percursos sem enviar nome/e-mail ao Clarity;
trate-o como dado pessoal e restrinja o acesso ao projeto.

| Evento                                                         | O que indica                                           |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| `seller_view_dashboard/inbox/orders/order/clients`             | Tela conhecida visitada                                |
| `seller_handoff_claimed` / `seller_conversation_taken_over`    | Atendimento assumido com aceite API                    |
| `seller_reply_accepted` / `seller_media_reply_accepted`        | Resposta aceita pela API, entrega ainda não comprovada |
| `seller_conversation_transferred/closed/archived/restored`     | Comando de conversa aceito pela API                    |
| `seller_order_create_started`                                  | Formulário/diálogo de criação aberto                   |
| `seller_order_created_manual/conversation/assisted`            | Pedido criado por ação humana no fluxo indicado        |
| `seller_order_section_saved` / `seller_order_milestones_saved` | Alteração salva pela API                               |
| `seller_order_confirmed/reopened`                              | Comando comercial aceito                               |
| `seller_order_pdf_generated/shared`                            | PDF obtido ou compartilhamento nativo concluído        |

As barras nesta tabela abreviam nomes separados; não são eventos literais.
Compare início de criação → criação → confirmação → ficha para localizar
fricções. Use gravações mascaradas e mapas para observar sequência de telas,
rolagem e repetição de ações. Eventos não carregam IDs de clientes/pedidos,
conteúdo de mensagem, valores ou erro livre. Não calculam conversão comercial
oficial nem produtividade individual: o PostgreSQL continua fonte de verdade.
Sem cookies há fragmentação e ações antes do carregamento podem não aparecer.
O filtro do protocolo fixo remove também destinos de links clicados e eventos
de erro JavaScript/log interno, pois esses campos não passam pela máscara DOM.
Coordenadas dos cliques permanecem disponíveis; diagnóstico técnico continua
na central Saúde e erros do CRM. Atualização do SDK exige revisar esse filtro.

## Verificação de publicação

1. Confirmar CI, imagem/digest e health conforme pipeline existente.
2. No projeto Clarity, conferir acesso restrito e retenção adequada ao uso
   interno. Manter Strict masking e cookies desativados como defesa adicional;
   o código já aplica máscara e `track:false` independentemente do painel.
3. Usar conta sintética de Vendedor e navegar Pedidos/Clientes/Inbox, abrir
   criação e sair para Conta. Conferir requisições somente ao coletor e nenhum
   cookie `_clck`/`_clsk`; conferir eventos/tags e replay mascarado no painel.
4. Confirmar ausência de coleta para Admin, Financeiro, login, Conta,
   desenvolvimento e URLs com query/hash desconhecidos. Não usar cliente real
   para provar mascaramento. Registrar ingestão observada antes de declarar
   homologação remota; testes locais interceptam todo tráfego Microsoft.

O endereço completo dos detalhes conserva UUIDs internos; a query
`conversa=UUID` é mascarada pelo SDK. Queries desconhecidas, hash ou referrer
externo/sensível impedem início. O título fixo do CRM não inclui nomes.
Atalhos com filtros oficiais permanecem medidos: Inbox permite situação
`atender/fechar/agente/aguardando/vendedor` e fila `minhas/sem-responsavel`;
Pedidos permite status `pendente/confirmado`, vendedor `eu`, origem `loja`
e entrega `atrasada/proxima`. Outros valores ou chaves duplicadas bloqueiam.

## Falhas e rollback

Bloqueador/falha de rede não bloqueia trabalho; não há retry nem logs com
payload. SDK e SHA-256 são carregados após elegibilidade; script externo,
Bing e cookies não são necessários. O callback descarta gerações antigas,
mesmo se o SDK reiniciar internamente em contexto excluído.

Para desativar no pipeline vigente, reverter o commit desta tarefa e publicar
a imagem do edge-web pelo fluxo GitHub → EasyPanel. Em builds locais por npm,
`VITE_CLARITY_ENABLED=false` desativa a integração, mas o Docker/CI atual não
propaga essa variável: alterá-la no ambiente runtime do EasyPanel não tem efeito.
Desativar não apaga dados já recebidos pelo Clarity; isso é ação separada no
projeto. Não há migration, mudança no banco ou dados comerciais para reverter.

Fontes oficiais: [API e máscaras](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api),
[ConsentV2](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2),
[biblioteca oficial](https://github.com/microsoft/clarity/tree/master/packages/clarity-js).

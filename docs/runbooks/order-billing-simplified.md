# Cobranças e recebimentos no Pedido

Contrato aprovado: [BCS-01–09](../../.specs/features/billing-simplified/spec.md),
continuação de BCP-P01, COB-12 e BFUI-01–06. A timeline DTL permanece na seção
Datas do pedido; cobranças reúne os detalhes e comandos financeiros existentes.

## Consulta e ações

O resumo usa total, recebido e saldo oficiais do CRM. A lista mostra uma
operação por cobrança; os recebimentos InfinitePay ficam dentro dela.
Recebimento manual tem identidade própria por fonte/ID, mesmo quando aparece
nas duas coleções do resumo. Quitado não oferece nova emissão/recebimento.

**Detalhes** expande comprovante, meio/parcelas, datas, autoria manual e
movimentações daquela operação. Dia efetivo manual não ganha horário fictício.
Criação de cobrança é distinta de confirmação de pagamento no CRM. Reversões
e devoluções preservam o registro original. Notas/motivos/comprovantes privados
dependem de autorização e leitura atual, inclusive em pedidos cancelados.

- **Cobrar** revisa destino e gera/envia pelo comando de intenção já existente.
- **Gerar só o link** preserva emissão sem envio automático. Condição inicial
  0/X/100% continua disponível; 0% não gera checkout de valor zero.
- **Enviar cobrança** usa o link existente somente quando a consulta completa
  não registra intenção anterior. Havendo páginas pendentes, carregue-as para
  conferir os envios anteriores; ausência na primeira página não comprova ausência.
- **Revisar nova tentativa** consulta a intenção atual. Somente `canRetry`
  confirmado pelo servidor permite revisar retry humano do mesmo link.
- **Registrar recebimento externo**, **Estornar registro**, **Conferir pagamento**,
  **Conferir cobrança** e **Registrar devolução** usam os diálogos/comandos reais.
  Conferência não inventa pagamento; estorno de registro não devolve dinheiro.

Link vencido, acima do saldo ou em revisão não oferece cópia/envio. Links
anteriores permanecem identificados para conferência. Erro/conflito/resultado
incerto não é sucesso e não causa reenvio automático. Versões, CSRF, origem,
idempotência e autorização continuam validados pela API.

O histórico paginado é relacionado por IDs e incorporado à operação.
Atualizações preservam páginas já carregadas. Uma consulta em andamento não
é abortada pelo polling. **Atualizar cobranças** relê resumo e movimentações;
falha da consulta bloqueia também a ação secundária de gerar link.

## Atualização sem interromper a tela

No Pedido, o workspace é o único dono da consulta financeira em segundo plano.
Sem cobrança, intenção ou conferência em andamento, não há consultas periódicas.
Com pendência, o ciclo existente de cinco segundos é silencioso: não altera
`aria-busy`, foco, campos ou referências de snapshots idênticos. Ele pausa em
diálogo, escrita, leitura manual, edição de outra seção e aba oculta.

Mudança real de snapshot atualiza resumo/timeline e relê o Pedido se a versão
avançou. SSE continua ativo. Resposta idêntica do Pedido não substitui seu
objeto nem reinicia leituras dos componentes. Mudança de dados sem avanço de
versão, como atualização de contato, continua sendo aplicada; reload explícito
de conflito mantém seu comportamento. A Inbox conserva seu fluxo próprio.

## Verificação local e rollback

Ambiente dedicado `crm-silmer-billing-fresh`, porta 4180, dados sintéticos e
provedor/transporte local. Smoke percorreu emissão sem envio, envio do link
existente pelo n8n/sink, confirmação InfinitePay simulada, recebimento manual e
estorno pela interface. Reload preservou duas operações e recebido3000/saldo7000.
Outro pedido quitado manteve somente duas leituras iniciais de resumo e uma
de histórico durante 12 segundos, sem polling. Isso não homologa provedor real.

Evidências e revisão independente em
[validation.md](../../.specs/features/billing-simplified/validation.md).
Não há migração, endpoint novo ou dependência. Rollback usa a imagem anterior;
recebimentos, links, versões e auditoria persistidos devem ser preservados.

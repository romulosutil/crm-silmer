# Datas do pedido: eventos horizontais e entrega real

Autorizado pelo proprietário em 11/11/2026, após avaliação dos protótipos
DTL-P01–P06 da [RFC 063](../../../docs/rfc/063-linha-do-tempo-dos-recebimentos-do-pedido.md).
Base: origin/master `760f7924`, com os artefatos de planejamento preservados.
Continua PLA-01–12, ACT-04, COB/BFIN e ADR 077 sem mudar quitação ou status.

## Problem Statement

A seção Datas do pedido repete três marcos, sem os recebimentos parciais reais.
O proprietário aprovou uma sequência horizontal única, sem o subtítulo Linha
do tempo, com Confirmar entrega no cabeçalho. O protótipo precisa ser ligado
à API e ao comando de entrega existente, sem transportar dados fictícios.

## User Stories

- Como responsável, quero acompanhar contato, confirmação, recebimentos e
  entrega em ordem cronológica, sem confundir emissão de link com pagamento.
- Como responsável/Admin autorizado, quero confirmar a entrega pelo Pedido,
  preservando pagamento e saldo e vendo o resultado persistido na sequência.
- Como operador, quero distinguir data efetiva manual, confirmação verificada
  InfinitePay, legado, revisão e correção, inclusive em falhas de atualização.

## Assumptions & Open Questions

| Assumption            | Chosen default                                                                    | Rationale                                                        |
| --------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Composição aprovada   | Horizontal, detalhes expansíveis, botão no header Datas do pedido                 | Pedido explícito e protótipo aprovado                            |
| Dados                 | GET billing existente com projeção aditiva timelineEvents e leitura compartilhada | Ledger existente é fonte única, sem duplicar polling             |
| Datas InfinitePay     | Dia de verified_at em São Paulo, rotulado confirmação                             | Não existe data efetiva de transação garantida no modelo atual   |
| Entrega               | POST delivery-confirmation existente, sem data do navegador                       | API fixa dia, autorização, versão, auditoria e idempotência      |
| Autoria da entrega    | Somente auditoria explícita do mesmo dia quando disponível; senão só deliveredOn  | Não fabricar autoria ou horário de registros legados             |
| Histórico sem billing | Marcos do pedido e quitação legada, sem valores/fonte inventados                  | Flags/ACL/falha não equivalem a ausência comprovada de pagamento |

Open questions: none. Aprovação cobre implementação e testes locais; dinheiro,
mensagens reais e deploy permanecem fora desta execução.

## Out of Scope

Mudanças em quitação, cálculo de saldo, Dashboard, ficha/PDF, novos status,
transporte InfinitePay/n8n, migração de data do provedor, novas tabelas ou
infraestrutura. Não é um histórico de todas as reaberturas do pedido.

## Acceptance Criteria

- DTL-01: WHEN há recebimentos de duas fontes THEN a API SHALL fornecer um
  evento por fonte+ID, sem duplicar pagamentos externos presentes em duas coleções.
- DTL-02: WHEN recebimentos são parciais ou integrais THEN a UI SHALL usar
  os totais oficiais e paidOn, sem recalcular quitação nem criar recebimentos
  a partir da emissão de um link ou de uma conferência pendente.
- DTL-03: WHEN o recebimento é manual THEN o evento SHALL usar receivedOn
  como dia efetivo, sem horário inventado, e separar recordedAt/autoria nos detalhes.
- DTL-04: WHEN o recebimento é InfinitePay THEN o evento SHALL usar o dia
  de confirmação verificada em São Paulo, sem afirmar data efetiva da transação.
- DTL-05: WHEN há reversão/devolução ou aplicação inválida THEN a projeção
  SHALL preservar original e correção, distinguindo revertido, devolvido
  parcialmente/integralmente e não aplicado/em revisão, com IDs estáveis.
- DTL-06: WHEN o Pedido é exibido THEN a seção SHALL mostrar eventos
  horizontais em ordem estável e o rótulo Pedido confirmado, sem o antigo
  resumo horizontal de três datas e sem subtítulo Linha do tempo; detalhes
  SHALL preservar informações completas com nomes acessíveis.
- DTL-07: WHEN só existe paidOn legado THEN a UI SHALL mostrar quitação
  registrada sem inventar valor/fonte/identificador de pagamento; os marcos
  sem data SHALL não ganhar datas ou instantes fictícios.
- DTL-08: WHEN a leitura falha, está pendente ou muda de pedido THEN a UI
  SHALL distinguir falha de vazio, preservar marcos conhecidos, identificar
  dados desatualizados e descartar resposta de outro pedido; a cobrança e
  as datas SHALL compartilhar a leitura existente.
- DTL-09: WHEN o ator não tem acesso ao pedido/detalhe financeiro THEN
  API e UI SHALL negar/omitir o detalhe financeiro sem expor NSU, URL, nota,
  motivo privado ou autoria não autorizada na projeção resumida.
- DTL-10: WHEN responsável/Admin ativo abre pedido de atendimento confirmado,
  não teste, não cancelado e sem entrega THEN a UI SHALL oferecer Confirmar
  entrega no header; sessão/CSRF/origem/versão/idempotência e ACL SHALL ser
  validadas pelo endpoint existente, sem aceitar data enviada pelo cliente.
- DTL-11: WHEN a entrega é confirmada THEN a UI SHALL persistir via endpoint
  real, refletir deliveredOn retornado em um único evento e atualizar o
  pedido/cobrança sem alterar pagamento/saldo/status; cancelar/Escape SHALL
  não enviar comando; falha/conflito SHALL não simular sucesso ou repetir
  cegamente uma escrita incerta.
- DTL-12: WHEN usado por teclado/toque a 320/390px ou desktop THEN a seção
  SHALL conter sua rolagem horizontal, preservar foco em cancelamento, mover
  foco ao evento após sucesso, anunciar estados e conservar edição legada
  de datas onde já autorizada, sem depender somente de cores.

## Requirement Traceability

| ID     | Task  | Status       |
| ------ | ----- | ------------ |
| DTL-01 | T2/T3 | implementing |
| DTL-02 | T2/T3 | implementing |
| DTL-03 | T2/T3 | implementing |
| DTL-04 | T2/T3 | implementing |
| DTL-05 | T2/T3 | implementing |
| DTL-06 | T3    | implementing |
| DTL-07 | T3    | implementing |
| DTL-08 | T3    | implementing |
| DTL-09 | T2/T3 | implementing |
| DTL-10 | T3    | implementing |
| DTL-11 | T3    | implementing |
| DTL-12 | T3    | implementing |

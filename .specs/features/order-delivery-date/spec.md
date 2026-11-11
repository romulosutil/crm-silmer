# Entrega: confirmar e alterar a data

## Problem Statement

O proprietário determinou que Confirmar entrega vire Alterar data de entrega
após sucesso, removendo Editar datas e o formulário genérico da seção.

## User Stories

- Como responsável, quero confirmar hoje e corrigir somente a data de uma
  entrega registrada, com a timeline e os recebimentos preservados.

## Assumptions & Open Questions

| Assumption       | Chosen default                                                                              | Rationale                                                |
| ---------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Primeira entrega | Dia atual de São Paulo, sem data do cliente                                                 | PLA-11/DTL-10 preservados                                |
| Correção         | Campo deliveredOn opcional no comando existente, só após entrega                            | Pedido explícito; inclui pedidos manuais                 |
| Validade         | Dia não vazio, existente, até hoje; sem desconfirmar entrega                                | Alterar data não é cancelar entrega                      |
| Autoria          | Mantém auditoria; metadata da timeline continua opcional se não houver prova correspondente | Não inventar autor/data em legado ou correção retroativa |

Open questions: none. Supersede a edição genérica da seção descrita em
DTL-12/PLA na apresentação; as APIs legadas de pagamento não são removidas.

## Acceptance Criteria

- DDE-01: WHEN o pedido elegível não tem entrega THEN a UI SHALL mostrar
  Confirmar entrega; WHEN tem entrega THEN SHALL mostrar Alterar data de entrega,
  sem Editar datas e sem formulário de pagamento nesta seção.
- DDE-02: WHEN o responsável/Admin altera a entrega existente THEN UI/API
  SHALL exigir deliveredOn válido até hoje, preservar pagamento/status/ficha,
  atualizar um único evento e incluir o dia no fingerprint idempotente;
  replay divergente, outro vendedor, cancelado, teste e pendente SHALL ser recusados.
- DDE-03: WHEN a entrega ainda não existe THEN o comando SHALL manter a
  confirmação com hoje e recusar correção antecipada; WHEN a data não muda
  THEN a UI SHALL evitar escrita e a API SHALL tratar a correção como no-op.
- DDE-04: WHEN cancelar/Escape, conflito ou falha incerta ocorrem THEN a UI
  SHALL preservar contexto, foco e resultado real; reconciliação de alteração
  SHALL comparar com o dia solicitado, sem tomar a entrega antiga como sucesso.
  Teclado/mobile/axe SHALL continuar operáveis.

## Requirement Traceability

| ID     | Task     | Status  |
| ------ | -------- | ------- |
| DDE-01 | T2/T3    | implemented |
| DDE-02 | T1/T2/T3 | implemented |
| DDE-03 | T1/T2/T3 | implemented |
| DDE-04 | T2/T3    | implemented |

## Out of Scope

Desfazer entrega, alterar recebimentos/quitação, novas datas editáveis,
infraestrutura, migração, merge/deploy ou transação real em provedor.

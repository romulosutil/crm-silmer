# Cobranças simplificadas no Pedido

## Problem Statement

O Pedido repete cobranças e recebimentos em três blocos. O proprietário
aprovou BCP-P01 e autorizou integrar a lista única com os dados/comandos reais.

## User Stories

- Como vendedor, quero consultar cada operação uma vez e expandir seus detalhes.
- Como responsável, quero cobrar, conferir, registrar e corrigir recebimentos
  pelos comandos existentes, mantendo histórico e saldo oficiais.

## Assumptions & Open Questions

| Assumption      | Chosen default                                                                | Rationale                            |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| Design          | Protótipo BCP-P01, uma lista e detalhes contextuais                           | Aprovação expressa do proprietário   |
| Domínio         | Reutilizar COB/BAPI/BFIN/BFUI e endpoints existentes                          | Esta fatia muda a interface          |
| Datas           | Preservar DTL e edição de itens da master                                     | Trabalho aprovado anterior           |
| Compatibilidade | Workspace da Inbox mantém seu fluxo; Pedido sem workspace conserva emissão/0% | Flags não apagam consulta autorizada |
| Publicação      | Commit/push/PR conforme AGENTS; sem merge/deploy                              | Escopo local autorizado              |

Open questions: none for this implementation.

## Acceptance Criteria

- BCS-01: WHEN há cobranças e pagamentos mistos, THE UI SHALL mostrar uma
  operação por cobrança e uma por recebimento externo, relacionando pagamento
  InfinitePay à cobrança por ID e eliminando duplicação manual entre coleções.
- BCS-02: WHEN detalhes são expandidos, THE UI SHALL preservar comprovante,
  valor, meio/parcelas, data com precisão correta, autoria manual, notas,
  reversões/devoluções e movimentos relacionados por ID; criação não SHALL
  alegar pagamento naquela data. Cursor SHALL preservar movimentos anteriores.
- BCS-03: WHEN o Pedido é quitado, THE UI SHALL mostrar totais oficiais e
  ocultar novas emissões/recebimentos; WHEN há saldo, THE UI SHALL oferecer
  cobrança e registro conforme flags/permissões, sem somar a lista para quitar.
- BCS-04: WHEN uma operação permite ação, THE UI SHALL executar os comandos
  existentes de emissão/envio, recebimento, reversão, conferência, conciliação
  e devolução com revisão humana, CSRF, chave idempotente e versões atuais;
  timeout/conflito SHALL conservar recuperação e impedir repetição cega.
- BCS-05: WHEN um link vence, supera saldo, tem resultado incerto ou revisão,
  THE UI SHALL expor o estado e as ações seguras, sem oferecer cópia/envio de
  link inválido ou inventar confirmação/cancelamento do provedor.
- BCS-06: WHEN leitura falha, acesso muda ou a resposta pertence a outro
  pedido, THE UI SHALL preservar erro/atualização explícitos e impedir ações
  privadas com snapshot obsoleto; consulta SHALL manter ACL e flags existentes.
- BCS-07: WHEN usado por teclado e mobile320/390, THE UI SHALL oferecer
  detalhes nativos, foco previsível após cancelar/sucesso, axe sem violações e
  nenhum overflow horizontal da página, nos temas existentes.
- BCS-08: WHEN a seção é integrada, THE UI SHALL remover os históricos e
  pagamentos redundantes do Pedido, manter a timeline, condições 0/X/100%,
  geração de link sem envio e Inbox existentes; nenhuma migration, alteração
  de saldo, endpoint financeiro, transporte ou dependência SHALL ser criada.
- BCS-09: WHILE o Pedido não tem operação financeira em andamento, THE UI
  SHALL evitar polling contínuo; WHILE uma operação aguarda atualização,
  THE UI SHALL usar um único ciclo silencioso, pausar em diálogo/edição/aba
  oculta e preservar foco, rascunho e detalhes. WHEN a resposta é idêntica,
  THE UI SHALL conservar o snapshot e não ativar carregamento ou redesenho.

## Requirement Traceability

| ID     | Task        | Status   |
| ------ | ----------- | -------- |
| BCS-01 | T1/T2/T3/T4 | verified |
| BCS-02 | T1/T2/T3/T4 | verified |
| BCS-03 | T2/T4       | verified |
| BCS-04 | T2/T4       | verified |
| BCS-05 | T2/T4       | verified |
| BCS-06 | T2/T4       | verified |
| BCS-07 | T2/T4       | verified |
| BCS-08 | T2/T4       | verified |
| BCS-09 | T2/T3/T4    | verified |

## Out of Scope

Merge/deploy, dinheiro/mensagens reais, homologação InfinitePay, mudar regras
de quitação, migrações, infraestrutura e redesign da Inbox. São mantidos
COB-01–16 e BFUI-01–06, sem modificar a autoridade financeira do CRM.

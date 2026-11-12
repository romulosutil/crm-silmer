# Ficha impressa por item — tarefas

Requisitos: [spec.md](spec.md). Decisão:
[ADR 078](../../../docs/adr/078-ficha-impressa-por-item.md) e
[RFC 061](../../../docs/rfc/061-ficha-impressa-por-item.md). Evolução v9:
[ADR 087](../../../docs/adr/087-ficha-por-item-controle-no-verso.md) e
[RFC 065](../../../docs/rfc/065-ficha-por-item-controle-no-verso.md)
(FPI-T05 e FPI-T06).

### FPI-T01: implementação e pacote de revisão

- [ ] Criar `ficha-canonical-v8` com a folha por item, a folha extra e o conteúdo
      de fábrica (FPI-01 a FPI-04, FPI-06 a FPI-08 e FPI-10).
- [ ] Entregar a Poppins na ficha impressa sem serviço externo de fontes,
      dentro da política de segurança da rota (FPI-08).
- [ ] Aplicar o rótulo "Modelo" no formulário do item, nos dados do atendimento,
      na lista de itens com valores, nas pendências e no resumo da Caixa de
      Entrada, com os testes correspondentes (FPI-05).
- [ ] Gerar as amostras sintéticas v8, o relatório de revisão e o registro de
      aprovação pendente em `docs/phase0/`, com a nova contagem de campos.
- Depends on: none.
- Done when: FPI-01 a FPI-08 e FPI-10 têm evidência nas amostras; templates v2 a
  v7 e seus hashes intactos; `PRINT_TEMPLATE` em v6 (FPI-09).
- Gate: checks do projeto e `git diff --check`, sem PII nas amostras.

### FPI-T02: aprovação das amostras e troca de `PRINT_TEMPLATE`

- [x] Registrar a aprovação provisória do PO vinculada ao hash das amostras v8
      (12/11/2026, `docs/phase0/ficha-pdf-approval-v8.json`).
- [x] Trocar `PRINT_TEMPLATE` para `ficha-canonical-v8` em commit próprio.
- Depends on: FPI-T01.
- Done when: a validação aceita a v8 com o registro e o recusa sem ele (FPI-09).

### FPI-T03: assinatura física e produção

- [ ] Imprimir as amostras na impressora laser da fábrica e escrever à caneta nas
      linhas pautadas e na linha "Conferido".
- [ ] Conferir a legibilidade do visual do design system nessa impressora e se a
      margem esquerda serve para arquivar em pasta.
- [ ] Confirmar com Rose e Operação se as cores da arte precisam de outro registro.
      Se precisarem, abrir nova decisão.
- [ ] Colher a assinatura física de Rose e Operação e registrar a evidência sem PII.
- [ ] Liberar a v8 em produção.
- Depends on: FPI-T02.
- Done when: papel assinado registrado conforme o gate de produção (FPI-09).
- Nota (12/11/2026): se a v9 (FPI-T06) for liberada, a mesma assinatura física
  passa a valer para ela: as amostras v9 impressas entram no teste de impressora
  e na assinatura de Rose e Operação (FPI-13). Nada aqui está marcado como feito
  por causa da v9.

### FPI-T04: conferir "tipo de roupa" nas mensagens do bot

- [ ] Verificar nos workflows publicados do n8n se o bot usa "tipo de roupa" nas
      mensagens ao cliente.
- [ ] Registrar o resultado aqui. Se o texto existir, levar a mudança ao PO antes
      de alterar o workflow: FPI-05 não altera o contrato do bot.
- Depends on: none.
- Done when: resultado registrado, com o ID e a versão dos workflows conferidos.

### FPI-T05: implementação e pacote de revisão da v9

- [x] Criar `ficha-canonical-v9` com duas folhas por item: Observações e
      anotações do pedido na página 1, Controle de produção e arte ampliados na
      página 2, e folha extra "Observações (continuação)" só quando necessária
      (FPI-12), mantendo o conteúdo de fábrica e as regras de `artPreview`
      (FPI-10 e FPI-11).
- [x] Criar o planejador de folhas da v9 (ordem, contagem de "Folha X de N",
      apontamento da página 2 e continuação das observações sem corte).
- [x] Gerar as amostras sintéticas v9, o relatório de revisão e o registro de
      aprovação pendente em `docs/phase0/` (pacote descrito em
      [FICHA-PDF-REVIEW-V9](../../../docs/phase0/FICHA-PDF-REVIEW-V9.md)).
- [x] Cobrir com testes (`test/ficha-print-v9.test.js` e
      `test/e2e/ficha-v9-layout.spec.js`) e admitir o hash da folha de estilos
      na CSP da rota de impressão.
- Depends on: FPI-T02.
- Done when: FPI-12 e FPI-13 têm evidência nas amostras; templates v2 a v8 e
  seus hashes intactos; `PRINT_TEMPLATE` em v8 até FPI-T06.
- Gate: checks do projeto e `git diff --check`, sem PII nas amostras.

### FPI-T06: aprovação das amostras v9 e troca de `PRINT_TEMPLATE`

- [x] Registrar a aprovação provisória do PO vinculada ao hash das amostras v9
      (12/11/2026, `docs/phase0/ficha-pdf-approval-v9.json`).
- [x] Trocar `PRINT_TEMPLATE` para `ficha-canonical-v9` em commit próprio.
- Depends on: FPI-T05.
- Done when: a validação aceita a v9 com o registro e a recusa sem ele
  (FPI-13). Rollback: reverter só o commit que troca `PRINT_TEMPLATE`.

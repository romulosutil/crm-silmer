# Ficha por produto — Especificação

**Status:** Implementado — aguardando aprovação da v3 (T15)
**Data:** 24/09/2026
**Decisões de produto:** [`context.md`](context.md)
**Arquitetura:** [`design.md`](design.md) · **Tasks:** [`tasks.md`](tasks.md)
**Catálogo aprovado:** planilha `005-lista-de-opcoes-para-aprovacao.xlsx` v2 (Drive `12o5yXtlgXZryQrIwOrFlGTb36zzDkGvF`)

## Problema

A ficha do pedido tem os mesmos campos para qualquer peça. Uma bermuda
imprime "NÃO APLICÁVEL" em manga direita, manga esquerda e viés gola; um boné
não tem onde registrar a regulagem; uma bandeira não tem faces nem fixação. As
sugestões dos campos são listas soltas, copiadas à mão da planilha de opções,
que já divergem dela e não sabem para qual peça cada opção vale. A Silmer
aprovou um catálogo de opções (linhas "Manter"), mas nada no sistema usa essa
aprovação.

## Objetivos

- [ ] O produto escolhido define os campos do item na tela e na ficha impressa.
- [ ] Toda sugestão oferecida na ficha vem de uma linha "Manter" da planilha
      aprovada, e só aparece nos produtos para os quais vale.
- [ ] Atualizar o catálogo é rodar um script sobre a planilha e fazer commit,
      sem editar código.
- [ ] A ficha impressa não mostra campo que não existe na peça.

## Fora do escopo

| Item                                                    | Motivo                                                  |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Agente n8n preencher os campos novos                    | Decisão do PO: por enquanto a vendedora completa (F23). |
| Tela de administração do catálogo                       | F04. O catálogo muda pela planilha.                     |
| Catálogo no PostgreSQL / reaproveitar `modules/catalog` | F02, F03.                                               |
| Preços por opção                                        | A planilha não trata preço nesta etapa.                 |
| Bloquear confirmação por campo "Sim" vazio              | F06: A01 continua valendo.                              |
| Recusar valor fora do catálogo                          | F08: catálogo sugere, não restringe.                    |
| Migrar pedidos antigos para o formato novo              | F15: formato antigo continua válido.                    |
| Tornar Dados do atendimento editáveis                   | Continua como em PFI-08, exceto "locais" (F13).         |

---

## Histórias

### P1-1: Catálogo gerado da planilha aprovada ⭐ MVP

**História:** Como operador, quero gerar o catálogo do sistema a partir da
planilha aprovada, para que a ficha use exatamente o que a Silmer aprovou.

**Aceite:**

1. **CAT-01** WHEN o script de importação roda sobre a planilha THEN o
   catálogo gerado SHALL conter só linhas com Decisão = "Manter" (ou "Adicionar"
   com a Opção preenchida) das abas 02 e
   04–16, e as regras da aba 03 só para produtos mantidos.
2. **CAT-02** WHEN uma regra da aba 03 não é Sim, Opcional ou Não, um produto
   de "Vale para" não existe na aba 02 (produto que existe mas não foi mantido
   é ignorado), ou o cabeçalho da aba 03 não
   corresponde a um campo conhecido THEN o script SHALL falhar citando aba,
   linha e valor, sem gravar o catálogo.
3. **CAT-03** WHEN o script roda duas vezes sobre o mesmo arquivo THEN o
   catálogo gerado SHALL ser idêntico byte a byte.
4. **CAT-04** WHEN "Vale para" está vazio ou começa com "Todos" THEN a opção
   SHALL valer para todos os produtos que têm o campo; WHEN começa com
   "Nenhum" THEN a opção SHALL ficar fora do catálogo gerado. Na aba 14 a
   coluna é ignorada: a escala liga ao produto pela aba 02.
5. **CAT-05** WHEN "Impresso na ficha como" está vazio THEN o valor gravado
   SHALL ser a Opção em maiúsculas.
6. **CAT-06** O catálogo gerado SHALL passar pela checagem estrutural
   `assertOrderCatalog` antes de ser gravado, e o teste de contrato SHALL rodar
   a mesma checagem sobre o arquivo versionado em `npm test`.

**Teste independente:** rodar o script sobre a planilha v2 e ver o arquivo gerado com
os 14 produtos mantidos e as 85 opções "Manter" das abas 04–16 (mais as
sugestões que a Silmer marcar Manter).

---

### P1-2: Card do item conforme o produto ⭐ MVP

**História:** Como vendedora, quero que o item mostre só os campos da peça
escolhida, com os nomes que a fábrica usa, para preencher a ficha sem pular
campos que não existem.

**Aceite:**

1. **FIT-01** Tipo SHALL ser o primeiro campo do item, com sugestões dos
   produtos do catálogo agrupadas por família.
2. **FIT-02** WHEN o tipo corresponde a um produto do catálogo (comparação
   sem caixa e sem acento, pelo nome ou pelo nome impresso) THEN o card SHALL
   mostrar só os campos com regra Sim ou Opcional, na ordem do catálogo, com
   os rótulos do produto.
3. **FIT-03** WHEN o tipo não corresponde a nenhum produto THEN o card SHALL
   mostrar todos os campos como opcionais e o aviso "Produto fora do
   catálogo".
4. **FIT-04** WHEN o item é salvo THEN campos com regra Não para o produto
   SHALL ser gravados vazios, mesmo que tenham sido digitados antes da troca
   de tipo.
5. **FIT-05** As sugestões de cada campo SHALL ser as opções da lista do
   campo que valem para o produto, agrupadas pelo Grupo da planilha e
   filtradas pelo texto digitado. Texto livre SHALL continuar aceito.
6. **FIT-06** WHEN a vendedora escolhe uma sugestão THEN o campo SHALL
   receber o "Impresso na ficha como" da opção.
7. **FIT-07** Viés gola e viés mangas SHALL ter duas partes, acabamento e
   cor, gravadas como `ACABAMENTO · COR`; qualquer parte pode ficar vazia.
8. **FIT-08** Malhas e Locais da aplicação SHALL aceitar mais de um valor.
9. **FIT-09** Outras especificações SHALL existir em todo item, com texto
   livre de até 500 caracteres.
10. **FIT-10** Campos de cor SHALL continuar mostrando a amostra de cor.
11. **FIT-11** O modo leitura do item SHALL mostrar só os campos do produto
    que têm valor, com os rótulos do produto.

**Teste independente:** criar um item Bermuda e ver Cós no lugar de Gola e
Manga; trocar para Camiseta e ver Gola, Manga e cores de manga.

---

### P1-3: Grade por escala ⭐ MVP

**História:** Como vendedora, quero escolher a escala de tamanhos da peça,
para não digitar a grade inteira e não confundir P infantil com P adulto.

**Aceite:**

1. **FGR-01** As escalas oferecidas SHALL ser as do produto; produto fora do
   catálogo SHALL ver todas.
2. **FGR-02** WHEN a vendedora escolhe uma escala THEN a grade SHALL ganhar
   uma linha para cada tamanho da escala ainda ausente, com quantidade vazia;
   linhas sem quantidade SHALL ser descartadas ao salvar.
3. **FGR-03** WHEN a escala é Medida THEN o tamanho SHALL ser texto livre.
4. **FGR-04** Tamanho digitado fora da escala SHALL continuar aceito.
5. **FGR-05** A escala escolhida SHALL ser gravada no item.

---

### P1-4: Banner de faltantes por produto ⭐ MVP

**História:** Como vendedora, quero que o aviso "o que falta" liste só o que a
peça realmente precisa.

**Aceite:**

1. **FMI-01** WHEN o produto está no catálogo THEN o banner SHALL listar os
   campos com regra Sim vazios, e SHALL omitir campos Opcional e Não.
2. **FMI-02** WHEN o produto está fora do catálogo THEN o banner SHALL manter
   o comportamento atual para o item.
3. **FMI-03** Confirmar SHALL continuar bloqueado só pelas regras de A01.

---

### P1-5: Ficha impressa v3 ⭐ MVP

**História:** Como produção, quero uma ficha que mostre só o que vale para
cada peça, com os nomes que usamos na oficina.

**Aceite:**

1. **FIM-01** Cada item SHALL imprimir só os campos do produto que têm valor.
   Campo com regra Não SHALL nunca imprimir, e "NÃO APLICÁVEL" SHALL não
   aparecer para produto do catálogo.
2. **FIM-02** O cabeçalho do item SHALL ser `TIPO` seguido de
   `MODELAGEM · GOLA · MANGA`, omitindo partes vazias.
3. **FIM-03** Cada campo SHALL imprimir com o rótulo do produto.
4. **FIM-04** Locais da aplicação e Outras especificações SHALL imprimir em
   linha de largura total quando preenchidos.
5. **FIM-05** WHEN a escala do item está definida e não é Adulto THEN o
   título da grade SHALL ser `GRADE · <ESCALA>`.
6. **FIM-06** A página 2 (Controle de produção) SHALL ser idêntica à v2.
7. **FIM-07** Pedidos gravados no formato antigo SHALL imprimir na v3 sem erro
   e sem perder campos preenchidos.
8. **FIM-08** WHILE não houver registro de aprovação humana da v3 THEN a rota
   de impressão SHALL continuar usando a v2.
9. **FIM-09** O pacote de revisão SHALL gerar o PDF sintético v3 com hash
   registrado, no mesmo fluxo da v2.

---

## Rastreabilidade

| ID     | História | Evidência                                                                                                                                                          |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CAT-01 | P1-1     | `test/order-catalog-import.test.js:227`                                                                                                                            |
| CAT-02 | P1-1     | `test/order-catalog-import.test.js:311`, `test/order-catalog-import.test.js:318`, `test/order-catalog-import.test.js:338`, `test/order-catalog-import.test.js:351` |
| CAT-03 | P1-1     | `test/order-catalog-import.test.js:371`                                                                                                                            |
| CAT-04 | P1-1     | `test/order-catalog-import.test.js:255`                                                                                                                            |
| CAT-05 | P1-1     | `test/order-catalog-import.test.js:255`                                                                                                                            |
| CAT-06 | P1-1     | `test/order-catalog-contract.test.js:10`                                                                                                                           |
| FIT-01 | P1-2     | `test/e2e/orders.spec.js:1370`                                                                                                                                     |
| FIT-02 | P1-2     | `test/order-catalog-resolver.test.js:29`, `test/e2e/orders.spec.js:1186`                                                                                           |
| FIT-03 | P1-2     | `test/order-catalog-resolver.test.js:45`, `test/e2e/orders.spec.js:1211`                                                                                           |
| FIT-04 | P1-2     | `test/orders-ficha.test.js:328`, `test/order-items.test.js:26`, `test/e2e/orders.spec.js:1226`                                                                     |
| FIT-05 | P1-2     | `test/order-catalog-resolver.test.js:51`, `test/e2e/orders.spec.js:1133`                                                                                           |
| FIT-06 | P1-2     | `test/e2e/orders.spec.js:1133`                                                                                                                                     |
| FIT-07 | P1-2     | `test/order-items.test.js:50`, `test/e2e/orders.spec.js:1245`                                                                                                      |
| FIT-08 | P1-2     | `test/e2e/orders.spec.js:1263`                                                                                                                                     |
| FIT-09 | P1-2     | `test/orders-ficha.test.js:273`, `test/e2e/orders.spec.js:1263`                                                                                                    |
| FIT-10 | P1-2     | `test/order-catalog.test.js:15`                                                                                                                                    |
| FIT-11 | P1-2     | `test/e2e/orders.spec.js:1286`                                                                                                                                     |
| FGR-01 | P1-3     | `test/order-catalog-resolver.test.js:71`, `test/e2e/orders.spec.js:1341`                                                                                           |
| FGR-02 | P1-3     | `test/order-items.test.js:60`, `test/order-items.test.js:38`, `test/e2e/orders.spec.js:1315`                                                                       |
| FGR-03 | P1-3     | Sem escala "Medida" aprovada na planilha; `setScale` e `sizeGroups` não preenchem nem sugerem tamanhos de escala `freeText` (`OrderItemsSection.vue`).             |
| FGR-04 | P1-3     | `test/e2e/orders.spec.js:859`                                                                                                                                      |
| FGR-05 | P1-3     | `test/orders-ficha.test.js:273`, `test/e2e/orders.spec.js:1315`                                                                                                    |
| FMI-01 | P1-4     | `test/orders-domain.test.js:266`, `test/order-format.test.js:184`                                                                                                  |
| FMI-02 | P1-4     | `test/orders-domain.test.js:276`                                                                                                                                   |
| FMI-03 | P1-4     | `test/orders-domain.test.js:284`                                                                                                                                   |
| FIM-01 | P1-5     | `test/orders-print-v3.test.js:91`                                                                                                                                  |
| FIM-02 | P1-5     | `test/orders-print-v3.test.js:84`                                                                                                                                  |
| FIM-03 | P1-5     | `test/orders-print-v3.test.js:91`, `test/orders-print-v3.test.js:138`                                                                                              |
| FIM-04 | P1-5     | `test/orders-print-v3.test.js:103`                                                                                                                                 |
| FIM-05 | P1-5     | `test/orders-print-v3.test.js:110`, `test/e2e/orders.spec.js:1357`                                                                                                 |
| FIM-06 | P1-5     | `test/orders-print-v3.test.js:124`                                                                                                                                 |
| FIM-07 | P1-5     | `test/orders-print-v3.test.js:115`, `test/order-catalog-resolver.test.js:78`                                                                                       |
| FIM-08 | P1-5     | `test/orders-print-v3.test.js:152`, `test/ficha-v3-review.test.js:46`                                                                                              |
| FIM-09 | P1-5     | `test/ficha-v3-review.test.js:80`, `scripts/ficha-v3-review.mjs:35`                                                                                                |

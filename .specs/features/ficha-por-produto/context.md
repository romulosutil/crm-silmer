# Ficha por produto — Contexto e decisões

**Coletado em:** 24/09/2026, em sessão de design com o PO
**Spec:** [`spec.md`](spec.md) · **Arquitetura:** [`design.md`](design.md) · **Tasks:** [`tasks.md`](tasks.md)
**Status:** Pronto para arquitetura

---

## Limite da feature

A ficha do pedido deixa de ter os mesmos campos para toda peça. O **produto**
escolhido no item define quais campos aparecem, com que nome e com quais
sugestões, a partir do catálogo aprovado pela Silmer na planilha de opções. A
vendedora completa a ficha com essas sugestões; o agente n8n não muda nesta
feature. A ficha impressa ganha a versão v3, que imprime só o que vale para
cada peça.

## Fontes

| Fonte                                                 | Papel                                                                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planilha `005-lista-de-opcoes-para-aprovacao.xlsx` v2 | Catálogo aprovado. Drive `12o5yXtlgXZryQrIwOrFlGTb36zzDkGvF`, pasta `Meu Drive/Silmer`. Abas 01 (ficha), 02 (produtos), 03 (produto × campos), 04–17 (opções), 90 (arquivo).                 |
| `ficha_exemplo.xlsx`                                  | Ficha usada hoje na fábrica (pedido 8528). Mostra o vocabulário real: Modelo = gola (CARECA), Viés gola = OLÍMPICA / VERDE, malhas HELANQUINHA e LIGHT.                                      |
| `output/pdf/ficha-canonica-sintetica-v2.pdf`          | Template aprovado que a v3 evolui.                                                                                                                                                           |
| `docs/rfc/005-catalogo-de-opcoes-do-pedido.md`        | Proposta do catálogo (Opção A recomendada: catálogo hierárquico com códigos, aliases, snapshot e preço). Esta feature é o primeiro incremento dela; ver `design.md` → Relação com a RFC 005. |
| `.specs/features/pedidos-mvp/`                        | Feature de origem. Decisões D10, D11 e D15 são parcialmente supersedidas aqui.                                                                                                               |

## Decisões

### Catálogo

- **F01** O catálogo aprovado é a planilha v2. Só entra no sistema a linha com
  Decisão = **Manter** (inclui as sugestões que a Silmer marcar Manter) ou
  **Adicionar** com a Opção preenchida (linha nova escrita pela própria revisora). Linhas
  "Confirmar depois", vazias, "Remover" e a aba 90 ficam de fora.
- **F02** A fonte única no repositório é um arquivo de dados gerado a partir
  do xlsx por um script (módulo ESM com um objeto literal), versionado em git e
  conferido por uma checagem estrutural (`assertOrderCatalog`). O sistema **não** lê o
  Google Sheets em tempo de execução.
- **F03** O módulo `modules/catalog` não é reaproveitado: pertence ao runtime
  comercial de Negócio (ADR 004) e guarda só produto, modelo, material e
  técnica, sem regra por campo, rótulo, grupo ou nome impresso.
- **F04** Não há tela para editar o catálogo. Mudou a planilha → roda o
  script → commit → deploy.

### Produto define a ficha

- **F05** Cada produto tem, para cada campo do item, uma regra da aba 03:
  **Sim** (aparece, entra no banner quando vazio), **Opcional** (aparece, não
  entra no banner) ou **Não** (não aparece na tela nem na impressão).
- **F06** A regra "Sim" **não bloqueia** a confirmação. A01 continua valendo:
  só valor, condição de pagamento e um item com grade bloqueiam.
- **F07** Tipo fora do catálogo: todos os campos aparecem como opcionais, com
  o aviso "Produto fora do catálogo". O banner mantém o comportamento atual
  para esse item.
- **F08** Os campos continuam texto livre com sugestões: o catálogo sugere,
  nunca restringe. Escolher uma sugestão grava o "Impresso na ficha como".
- **F09** Rótulos por produto: o mesmo campo muda de nome conforme a peça
  (Viés mangas → Viés cavas na regata, → Viés barra/lateral na bermuda,
  → Punho no jaleco; Cor frente → Painel frontal no boné). Vêm da coluna
  "Nomes diferentes" da aba 03, em formato estruturado (ver `design.md`).

### Campos do item

- **F10** Campos novos por item: gola, manga, abertura/fechamento, bolso,
  cós/cintura, faces, fixação/borda, locais da aplicação (vários), escala da
  grade e outras especificações (texto livre, até 500 caracteres, impresso).
- **F11** `modelo` passa a ter o rótulo **Modelagem**. Valores antigos ficam
  como estão.
- **F12** Viés é composto: acabamento + cor gravados como um texto só,
  `ACABAMENTO · COR` (ex.: `RIBANA · VERDE`).
- **F13** **Locais da aplicação** passam a ser campo do item e saem impressos.
  Supersede D11 só para "locais"; arte, logística, finalidade e perfil de
  compra continuam em Dados do atendimento, sem impressão.
- **F14** "Não aplicável" (PFI-07) deixa de ser oferecido para produtos do
  catálogo — o campo simplesmente não existe para a peça. Continua aceito na
  validação (pedidos antigos e produto fora do catálogo).
- **F15** Nada muda no banco: a ficha já vive no `ficha_envelope` cifrado. Os
  campos novos são opcionais na validação, então fichas antigas continuam
  válidas sem migração.

### Grade

- **F16** Cada produto oferece escalas (Adulto, Infantil, Plus size, Bebê,
  Único, Medida). Escolher a escala cria as linhas dos tamanhos; linhas sem
  quantidade são descartadas ao salvar.
- **F17** Escala **Medida**: o tamanho é texto livre (ex.: `1,00 × 1,50 M`).
- **F18** Tamanho digitado fora da escala continua aceito.

### Impressão

- **F19** Template **`ficha-canonical-v3`**: especificações dinâmicas por
  produto, cabeçalho do item `TIPO  MODELAGEM · GOLA · MANGA`, viés em células
  separadas com o rótulo do produto, Locais e Outras especificações em largura
  total, grade com o nome da escala quando não for Adulto. Página 2 igual à v2.
- **F20** A v3 passa pelo mesmo gate humano da v2 (Rose e Operação). Até o
  registro de aprovação, a rota de impressão continua na v2. Supersede D10 e
  D15 depois da aprovação.

### Tela

- **F21** Combobox próprio (sugestões agrupadas e filtradas enquanto digita,
  texto livre aceito) no lugar de `<datalist>`, que não agrupa e filtra mal no
  celular.
- **F22** Tipo é o primeiro campo do item; os demais aparecem depois dele.

### Fora desta feature

- **F23** Agente n8n: o briefing segue igual. O `product_type` do agente é
  casado com o produto do catálogo pelo nome normalizado; se não casar, vale
  F07.

## Pendências de negócio (não bloqueiam a implementação)

- **Q01** 46 sugestões na planilha aguardam decisão. Produtos Jaleco e
  Bandeira só entram se marcados Manter.
- **Q02** Faixa Bebê tem só GG aprovado; P, M e G estão no arquivo (aba 90).
  Provável engano de revisão.
- **Q04** A RFC 005 §11 (Resultado) continua "pendente". Registrar a decisão do
  PO de 24/09/2026 (linhas "Manter" = aprovadas pelo cliente) e o nome de quem
  aprovou pelo cliente, que a RFC exige.
- **Q03** Nomes impressos longos ou com barra — revisar na coluna "Impresso na
  ficha como" antes da importação e conferir no PDF sintético v3.

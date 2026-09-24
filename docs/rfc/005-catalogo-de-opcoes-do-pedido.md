# RFC 005 — Aprovar o catálogo de opções do Pedido

| Campo                         | Valor                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Impacto**                   | ALTO — altera a coleta humana, o contrato da IA no n8n, o modelo de dados e a futura formação de preço |
| **Status**                    | EM REVISÃO — nenhuma opção está aprovada para uso comercial                                            |
| **Responsável pela proposta** | Rômulo Sutil Corrêa                                                                                    |
| **Aprovadores**               | Rômulo Sutil Corrêa e responsável comercial do cliente (nome a registrar)                              |
| **Consultados**               | Operação comercial, produção/estamparia e vendedores Silmer                                            |
| **Informados**                | Engenharia do CRM e responsável pelo workflow do n8n                                                   |
| **Prazo da decisão**          | A definir com o cliente                                                                                |
| **Criado em**                 | 15/09/2026                                                                                             |
| **Última atualização**        | 24/09/2026                                                                                             |
| **Rastreabilidade**           | `PFI-03`, `PFI-04`, `PFI-07`, `T31`; regras 4, 5, 6 e 8 de `RULES.md`                                  |

## 1. Objetivo da revisão com o cliente

Transformar os campos livres do Pedido em opções comerciais reconhecíveis pela
pessoa que cadastra e pela IA que coleta os dados no n8n. A lista abaixo é um
**universo amplo de candidatos**: o cliente deve manter, remover, renomear ou
adicionar opções antes de qualquer publicação no CRM.

Esta RFC não aprova preços, disponibilidade, composição, prazo nem técnica. Ela
também não autoriza treinar/configurar a IA ou criar a estrutura final no banco.
Essas etapas começam somente depois do resultado explícito da revisão.

### Como revisar

Para cada tabela, o cliente deve:

1. marcar cada opção como `MANTER`, `REMOVER` ou `NÃO TRABALHAMOS`;
2. corrigir o nome usado na operação;
3. informar opções ausentes;
4. indicar combinações impossíveis ou que exigem análise humana;
5. informar código de fornecedor, composição e gramatura quando houver;
6. identificar o que altera preço, mínimo, prazo ou disponibilidade.

Até essa revisão terminar, a IA pode registrar a expressão usada pelo cliente,
mas não pode converter silenciosamente o texto em uma opção comercial.

## 2. Situação atual e evidência

- `ficha_exemplo.xlsx` exige item, modelo, uma ou mais malhas, cores por parte,
  viés de gola, viés de mangas e grade por tamanho.
- A ficha de exemplo usa `CARECA`, `HELANQUINHA`, `LIGHT`, `OLIMPICA`, tamanhos
  `P`, `M`, `G`, `GG`, `XG`, `XX` e `JEGAO`, além de `SUBLIMAÇÃO TOTAL`.
- A tela do Pedido continua gravando esses valores como texto livre. Desde a
  PR #97, os campos da Ficha oferecem sugestões de tipo de peça, modelagem,
  malha, cor, acabamento, aplicação e tamanho, definidas em
  `apps/edge-web/src/lib/order-catalog.js`. Ver a seção
  [Solução provisória em uso](#solução-provisória-em-uso).
- A revisão com o cliente acontece na planilha Google “Validação do catálogo
  de opções do Pedido”, criada a partir do XLSX anexo a esta RFC. Até o
  resultado ser registrado na seção 11, as decisões ficam nessa planilha.
- O catálogo técnico já versiona quatro grupos: produtos, modelos, materiais e
  técnicas. Ele ainda não representa cores, tamanhos, acabamentos,
  compatibilidades, fornecedores ou dimensões de preço.
- O briefing da IA usa campos planos como `product_type`, `product_model`,
  `fabrics`, `colors` e `sizes`, mas o Pedido aceita vários itens. Antes do
  treinamento, o contrato deve passar a representar `items[]`.
- A especificação atual registra corretamente que ainda não existe catálogo
  autorizado; esta RFC é o passo de decisão que antecede essa autorização.

## 3. Premissas

| #   | Premissa                                                                                                                                | Responsável      | Confiança | Gatilho de revisão                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------- | ---------------------------------------------------------- |
| 1   | A Ficha aprovada continua sendo a saída operacional do Pedido.                                                                          | Produto/Operação | Alta      | Alteração formal do template da Ficha                      |
| 2   | A Silmer trabalha com um subconjunto desta lista, não com todas as opções candidatas.                                                   | Cliente          | Alta      | Cliente confirmar catálogo integral diferente              |
| 3   | Preço depende de atributos atômicos — produto, modelo, material, aplicação, quantidade e adicionais — e não de um único texto `modelo`. | Comercial        | Média     | Cliente demonstrar regra de preço mais simples             |
| 4   | Cores e nomes comerciais dependem da cartela e do fornecedor ativos.                                                                    | Produção/Compras | Alta      | Catálogo próprio de cores independente de fornecedor       |
| 5   | O cliente consegue informar combinações permitidas e indisponíveis.                                                                     | Cliente          | Média     | Revisão mostrar que toda combinação exige orçamento humano |
| 6   | Termos legados ambíguos serão preservados até o cliente explicá-los.                                                                    | Produto          | Alta      | Cliente aprovar a normalização e os aliases                |

Se uma premissa for invalidada, o responsável pela proposta reabre esta RFC
antes da implementação.

## 4. Critérios de decisão

| Prioridade | Critério                                                                                        | Peso        |
| ---------- | ----------------------------------------------------------------------------------------------- | ----------- |
| 1          | Só oferecer opção realmente vendida, produzida ou terceirizada pela Silmer.                     | Obrigatório |
| 2          | A mesma escolha deve ter um código inequívoco para pessoa, IA, banco e preço.                   | Obrigatório |
| 3          | Toda dimensão que altera preço deve ficar separada e estruturada.                               | Obrigatório |
| 4          | Um Pedido confirmado deve preservar o snapshot da versão usada, mesmo após mudança do catálogo. | Alto        |
| 5          | A IA deve reconhecer sinônimos, mas só gravar códigos autorizados ou uma pendência explícita.   | Alto        |
| 6          | O vendedor deve poder registrar exceção sem contaminar o catálogo oficial.                      | Alto        |
| 7          | As opções devem ser filtradas pela peça e pelas combinações compatíveis.                        | Alto        |
| 8          | A lista deve ser simples para uso humano e acessível por teclado.                               | Médio       |
| 9          | A migração dos Pedidos já existentes deve preservar o texto original.                           | Médio       |

## 5. Opções de solução

### Opção A — Catálogo hierárquico versionado com aliases e exceção controlada — recomendada

Produtos filtram modelos; modelos expõem construção, gola, manga e adicionais;
materiais e cores são vinculados a fornecedores; técnicas possuem locais e
parâmetros próprios. A IA reconhece aliases, grava códigos do catálogo e cria
pendência quando não encontra correspondência segura. O Pedido guarda um
snapshot da seleção.

**Vantagens:** prepara preço por item, evita ambiguidades, atende vários itens e
mantém histórico. **Desvantagens:** exige revisão comercial detalhada e uma
evolução do catálogo técnico existente. **Esforço:** alto. **Risco:** médio.

### Opção B — Listas planas nos campos atuais

Publicar listas independentes para tipo, modelo, malha e técnica, mantendo os
demais campos como texto.

**Vantagens:** mais rápida e reaproveita diretamente as quatro tabelas atuais.
**Desvantagens:** permite combinações inválidas, mistura atributos no nome do
modelo, não representa bem preço por aplicação e continua inadequada para
vários itens no briefing da IA. **Esforço:** médio. **Risco:** alto.

### Opção C — Manter texto livre

Continuar com a tela e a IA atuais, normalizando manualmente cada Pedido.

**Vantagens:** nenhum custo imediato e aceita qualquer exceção. **Desvantagens:**
duplica nomes, impede preço confiável, favorece interpretação silenciosa da IA
e exige retrabalho humano. **Esforço inicial:** baixo. **Risco acumulado:** alto.

### Comparação

| Critério                     | A. Hierárquico | B. Listas planas    | C. Texto livre     |
| ---------------------------- | -------------- | ------------------- | ------------------ |
| Opções autorizadas           | Atende         | Atende parcialmente | Não atende         |
| Código único para IA e banco | Atende         | Atende parcialmente | Não atende         |
| Formação futura de preço     | Atende         | Fraca               | Não atende         |
| Combinações válidas          | Atende         | Não atende          | Não atende         |
| Exceção rastreável           | Atende         | Parcial             | Texto sem controle |
| Esforço                      | Alto           | Médio               | Baixo agora        |
| Recomendação                 | **Sim**        | Não                 | Não                |

### Solução provisória em uso

Enquanto a revisão não termina, a tela do Pedido oferece listas planas de
sugestões (PR #97, `apps/edge-web/src/lib/order-catalog.js`), com as opções
da planilha de validação que não foram marcadas como “Remover”. Na prática, é
uma Opção B limitada à tela:

- o campo continua sendo texto livre, e um valor fora da lista é gravado como
  foi digitado;
- nenhum código é gravado, nenhuma combinação é validada e nada muda no banco,
  na API ou no briefing da IA;
- as listas são atualizadas à mão quando a planilha muda.

Essas listas facilitam o preenchimento, mas não substituem a Opção A
recomendada nem autorizam qualquer opção para uso comercial.

## 6. Catálogo candidato para aprovação

Para conduzir a revisão com o cliente sem misturar arquitetura, banco de dados
ou IA, usar a
[Lista de opções do Pedido — validação com o cliente](005-anexo-lista-de-opcoes-para-aprovacao.md).
Ela apresenta uma linha por opção e espaço para manter, remover, renomear ou
indicar itens ausentes. As decisões são registradas na planilha Google
“Validação do catálogo de opções do Pedido”, e não no anexo nem no XLSX.

Os códigos são provisórios. `OUTRO_PENDENTE` nunca é uma opção automaticamente
vendável: ele cria uma pendência para decisão humana.

### 6.1 Tipos de produto

| Código provisório   | Opção candidata               | Observação para o cliente                                                                     |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `CAMISETA`          | Camiseta                      | Confirmar se este é o termo genérico principal.                                               |
| `CAMISA_CASUAL`     | Camisa casual                 | Distinguir de camiseta somente se a operação realmente usar ambos.                            |
| `CAMISA_POLO`       | Camisa polo                   | Confirmar versões masculina, feminina e infantil.                                             |
| `CAMISA_ESPORTIVA`  | Camisa esportiva              | Futebol, corrida, ciclismo ou outro segmento devem virar finalidade/modelo, não nomes soltos. |
| `ABADA`             | Abadá                         | Confirmar se é tipo próprio ou uma regata/camiseta com acabamento específico.                 |
| `REGATA`            | Regata                        | Confirmar cavada tradicional e machão.                                                        |
| `BABY_LOOK`         | Baby look                     | Pode virar modelagem de camiseta em vez de produto.                                           |
| `CROPPED`           | Cropped                       | Confirmar se a Silmer produz.                                                                 |
| `BLUSA_MANGA_LONGA` | Blusa/camiseta de manga longa | Confirmar se é produto ou variante de camiseta.                                               |
| `MOLETOM`           | Moletom                       | Sem capuz, com capuz e canguru devem ser variantes.                                           |
| `JAQUETA_AGASALHO`  | Jaqueta/agasalho              | Confirmar abertura, forro e zíper.                                                            |
| `COLETE`            | Colete                        | Confirmar esportivo, uniforme ou segurança.                                                   |
| `JALECO`            | Jaleco                        | Confirmar se faz parte do catálogo Silmer.                                                    |
| `AVENTAL`           | Avental                       | Confirmar se faz parte do catálogo e quais modelos são vendidos.                              |
| `SHORT_BERMUDA`     | Short/bermuda                 | Separar short e bermuda se o preço ou a modelagem diferirem.                                  |
| `CALCA`             | Calça                         | Confirmar esportiva, moletom e uniforme.                                                      |
| `SAIA_SHORT`        | Saia/short-saia               | Confirmar se faz parte do catálogo.                                                           |
| `BONE`              | Boné                          | Não usa os mesmos campos de frente/costas/mangas; exige ficha própria.                        |
| `VISEIRA`           | Viseira                       | Não usa os mesmos campos de vestuário; exige ficha própria.                                   |
| `ECOBAG`            | Ecobag/sacola                 | Não usa grade de vestuário; exige ficha própria.                                              |
| `OUTRO_PENDENTE`    | Outro — análise humana        | Nunca orçar automaticamente.                                                                  |

**Decisão necessária:** `uniforme`, `kit` e `conjunto` devem ser finalidade ou
agrupamento de itens, não um item de preço. Exemplo: um kit camisa + short deve
ser registrado como dois itens vinculados, salvo decisão comercial contrária.

### 6.2 Dimensões de modelo

Um único campo `modelo = CARECA` não é suficiente para preço. A proposta é
formar o nome exibido a partir das dimensões abaixo.

#### Modelagem/caimento

| Código                | Opção candidata                          |
| --------------------- | ---------------------------------------- |
| `TRADICIONAL_UNISSEX` | Tradicional/unissex                      |
| `MASCULINA_RETA`      | Masculina reta                           |
| `FEMININA_ACINTURADA` | Feminina acinturada/baby look            |
| `SLIM`                | Slim                                     |
| `OVERSIZED`           | Oversized                                |
| `INFANTIL`            | Infantil                                 |
| `PLUS_SIZE`           | Plus size                                |
| `PERSONALIZADA`       | Modelagem personalizada — análise humana |

#### Gola/decote

| Código               | Opção candidata                                    |
| -------------------- | -------------------------------------------------- |
| `GOLA_CARECA`        | Careca/redonda                                     |
| `GOLA_V`             | Gola V                                             |
| `GOLA_POLO`          | Gola polo                                          |
| `GOLA_PADRE`         | Gola padre                                         |
| `GOLA_CANOA`         | Gola canoa                                         |
| `GOLA_ALTA`          | Gola alta                                          |
| `GOLA_OLIMPICA`      | Olímpica — confirmar significado usado pela Silmer |
| `CAPUZ`              | Capuz                                              |
| `SEM_GOLA`           | Sem gola/não aplicável                             |
| `GOLA_PERSONALIZADA` | Outro formato — análise humana                     |

#### Manga

| Código                | Opção candidata                |
| --------------------- | ------------------------------ |
| `SEM_MANGA`           | Sem manga                      |
| `MANGA_CURTA`         | Manga curta                    |
| `MANGA_TRES_QUARTOS`  | Manga 3/4                      |
| `MANGA_LONGA`         | Manga longa                    |
| `RAGLAN_CURTA`        | Raglan curta                   |
| `RAGLAN_LONGA`        | Raglan longa                   |
| `MANGA_JAPONESA`      | Manga japonesa                 |
| `MANGA_MORCEGO`       | Manga morcego                  |
| `MANGA_COM_PUNHO`     | Manga com punho                |
| `MANGA_PERSONALIZADA` | Outro formato — análise humana |

#### Construção e adicionais que podem alterar preço

| Grupo      | Opções candidatas                                                     |
| ---------- | --------------------------------------------------------------------- |
| Abertura   | Sem abertura; botões; zíper parcial; zíper total                      |
| Bolso      | Sem bolso; peito; frontal; canguru; lateral; personalizado            |
| Recortes   | Sem recorte; lateral; ombro; frente; costas; múltiplos/personalizados |
| Barra      | Bainha simples; galoneira; punho; elástico; personalizada             |
| Forro      | Sem forro; parcial; total                                             |
| Acabamento | Viés; ribana; gola pronta; punho; cadarço; elástico                   |

### 6.3 Malhas e tecidos

Não usar apenas o nome popular para formar preço. Cada opção aprovada deverá
receber fornecedor, código do fornecedor, construção, composição percentual,
gramatura, largura, acabamento, cartela de cores e situação de estoque.

| Família candidata            | Variações candidatas para o cliente manter/remover                           | Papel típico           |
| ---------------------------- | ---------------------------------------------------------------------------- | ---------------------- |
| Meia malha de algodão        | Cardada; penteada 24.1; penteada 30.1; com elastano                          | Principal              |
| Cotton                       | Algodão + elastano, com composição e gramatura reais                         | Principal              |
| Meia malha PV                | Lisa anti-pilling; mescla anti-pilling; com elastano                         | Principal              |
| Meia malha PP                | Poliéster liso; poliéster dry; mescla; anti-pilling                          | Principal              |
| Meia malha poliéster/algodão | Informar composição completa; não usar apenas a sigla ambígua `PA`           | Principal              |
| Piquet                       | Algodão; PV; poliéster/algodão; poliéster; com elastano; anti-pilling        | Principal              |
| Dry fit de poliéster         | Liso; ponto de arroz/favinho; colmeia; furadinho; light; mescla              | Principal              |
| Dry/performance de poliamida | Informar composição, tecnologia e fornecedor                                 | Principal              |
| Helanca                      | Light; colegial; peluciada; dry                                              | Principal/complementar |
| Helanquinha                  | Nome legado da ficha; confirmar composição e se equivale a outra opção       | Pendente de definição  |
| Light                        | Nome legado isolado da ficha; confirmar se é malha, gramatura ou complemento | Pendente de definição  |
| Cacharrel                    | Confirmar composição e usos vendidos                                         | Principal/complementar |
| Interlock                    | Poliéster; algodão; misto                                                    | Principal              |
| Liganete                     | Informar composição e gramatura                                              | Principal              |
| Viscolycra                   | Viscose + elastano, com composição real                                      | Principal              |
| Suplex                       | Poliamida + elastano; poliéster + elastano                                   | Principal              |
| Microfibra                   | Poliéster e outras composições aprovadas                                     | Principal              |
| Tactel                       | Informar composição e acabamento                                             | Principal              |
| Oxford                       | Tradicional; Oxfordine; outras variações aprovadas                           | Principal              |
| Moletom 2 cabos              | Com felpa; sem felpa                                                         | Principal              |
| Moletom 3 cabos              | Com felpa; sem felpa                                                         | Principal              |
| Moletinho                    | PV; algodão; com elastano; com/sem felpa                                     | Principal              |
| Fleece/soft                  | Gramatura e composição por fornecedor                                        | Principal/forro        |
| Plush                        | Gramatura e composição por fornecedor                                        | Principal/forro        |
| Ribana                       | Lisa; canelada; algodão; PV; PP; com elastano                                | Complemento/acabamento |
| Gola e punho prontos         | Poliéster/algodão; poliamida; personalizados                                 | Complemento/acabamento |
| Outro material               | Registrar texto e encaminhar para cadastro/aprovação                         | Pendente humano        |

**Regra proposta:** `malhas[]` vira uma seleção com papel: `principal`,
`secundária`, `gola`, `punho`, `viés` ou `forro`. Assim duas malhas no mesmo
item não ficam como uma lista sem significado.

### 6.4 Cores

A lista de nomes abaixo serve para conversa e busca. A opção vendável deve ser
o **código da cartela do fornecedor**, porque “azul royal” ou “vermelho” podem
mudar entre materiais e lotes.

| Família de cor candidata | Nomes de busca/aliases a validar                                                   |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Neutros                  | Branco, off-white/natural, preto, cinza claro, cinza mescla, grafite/chumbo        |
| Azuis                    | Azul-marinho, azul royal, azul-celeste, azul-turquesa, azul-petróleo               |
| Verdes                   | Verde-bandeira, verde-militar/musgo, verde-limão, verde-menta                      |
| Amarelos                 | Amarelo, amarelo-ouro                                                              |
| Laranjas                 | Laranja, coral                                                                     |
| Vermelhos                | Vermelho, vinho/bordô                                                              |
| Rosas                    | Rosa-claro, rosa, pink/magenta                                                     |
| Roxos                    | Roxo, lilás                                                                        |
| Terrosos                 | Bege, cáqui, caramelo, marrom                                                      |
| Especiais                | Neon, fluorescente, metálico, refletivo, mescla, estampado                         |
| Personalizada            | Código Pantone/referência visual — sempre sujeito a validação humana e de material |

Atalhos de preenchimento podem copiar “mesma cor em todas as partes”, mas o
Pedido deve continuar guardando frente, costas, manga direita, manga esquerda,
viés de gola e viés de mangas separadamente.

### 6.5 Viés, gola e punho

Hoje `vies_gola` e `vies_mangas` misturam tipo e cor. A proposta é separar:

| Dimensão           | Opções candidatas                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Tipo de acabamento | Viés do próprio tecido; viés contrastante; ribana; gola pronta; punho pronto; galão; sem acabamento separado |
| Perfil             | Liso; canelado; rebatido; embutido; aparente; personalizado                                                  |
| Material           | Referência ao catálogo de materiais, com papel de acabamento                                                 |
| Cor                | Referência à cartela do material selecionado                                                                 |
| Aplicabilidade     | Aplicável; não aplicável com motivo                                                                          |

O termo `OLIMPICA` da ficha deve ser explicado pelo cliente antes de receber
um código definitivo: pode representar gola, perfil do viés ou nome comercial.

### 6.6 Tamanhos e grade

Cada produto/modelagem terá uma tabela de tamanhos permitidos. O preço pode
receber adicional por tamanho, mas nenhum adicional está aprovado nesta RFC.

| Grupo             | Opções candidatas                                                  |
| ----------------- | ------------------------------------------------------------------ |
| Bebê              | RN, P, M, G, GG; ou grade por meses, se a Silmer trabalhar com ela |
| Infantil          | 2, 4, 6, 8, 10, 12, 14, 16                                         |
| Adulto alfabético | PP, P, M, G, GG, XG, XGG                                           |
| Plus size         | G1, G2, G3, G4, G5; confirmar equivalência com XG/XGG              |
| Numérico          | 34 a 60, limitado ao produto/modelagem aprovado                    |
| Medida especial   | Sob medida — exige medidas, validação e preço humano               |
| Tamanho único     | Somente para produtos em que isso for verdadeiro                   |

**Perguntas bloqueantes:** o que `XX` e `JEGAO` significam na ficha de exemplo?
Eles são aliases de XGG/G2, nomes próprios da Silmer ou tamanhos distintos?
Nenhuma equivalência deve ser inferida pela IA.

### 6.7 Técnicas de personalização

| Código provisório       | Técnica candidata                                          | Dados necessários para preço                                         |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `SEM_APLICACAO`         | Sem aplicação                                              | Motivo/confirmação                                                   |
| `SUBLIMACAO_TOTAL`      | Sublimação total/full print                                | Material compatível, área total, arte e quantidade                   |
| `SUBLIMACAO_LOCALIZADA` | Sublimação localizada                                      | Local, dimensão e quantidade                                         |
| `SERIGRAFIA`            | Serigrafia/silk screen                                     | Local, dimensão, quantidade de cores e bases                         |
| `DTF`                   | DTF — direto no filme                                      | Local, dimensão/área, cobertura e quantidade                         |
| `DTG`                   | DTG/silk digital — direto na peça                          | Local, dimensão, cor da peça, pré-tratamento e quantidade            |
| `TRANSFER_SUBLIMATICO`  | Transfer sublimático                                       | Material, local, dimensão e quantidade                               |
| `TRANSFER_SERIGRAFICO`  | Transfer serigráfico/plastisol                             | Local, dimensão, cores e quantidade                                  |
| `VINIL_HTV`             | Vinil termotransferível/HTV                                | Tipo de vinil, local, dimensão, camadas e quantidade                 |
| `BORDADO_DIRETO`        | Bordado direto                                             | Local, dimensão, número estimado de pontos/complexidade e quantidade |
| `PATCH`                 | Patch/bordado aplicado                                     | Tipo, dimensão, fixação e quantidade                                 |
| `APLIQUE_COSTURADO`     | Aplique costurado                                          | Material, dimensão, complexidade e quantidade                        |
| `EFEITO_ESPECIAL`       | Foil, metálico, refletivo, flocado, glitter ou alto-relevo | Subtipo, local, dimensão e quantidade                                |
| `OUTRA_TECNICA`         | Outra — análise humana                                     | Descrição e aprovação                                                |

Uma peça pode ter várias aplicações. Por isso, `pedido.aplicacao` deve ser uma
síntese exibida, enquanto a futura fonte de preço deve ser
`itens[].aplicacoes[]`.

### 6.8 Locais de aplicação

| Região         | Opções candidatas                                          |
| -------------- | ---------------------------------------------------------- |
| Frente         | Total; centro; peito esquerdo; peito direito; barra; bolso |
| Costas         | Total; superior; centro; inferior/barra                    |
| Mangas         | Direita; esquerda; ambas; ombro direito; ombro esquerdo    |
| Gola           | Interna; externa; nuca                                     |
| Laterais       | Lateral direita; lateral esquerda; ambas                   |
| Parte inferior | Perna direita; perna esquerda; frente; costas              |
| Acessórios     | Frente do boné; lateral; traseira; área própria do produto |
| Personalizada  | Local descrito e aprovado por pessoa                       |

Cada aplicação deve registrar técnica, local, largura/altura ou faixa de área,
quantidade de cores quando relevante e arquivo/versão da arte.

### 6.9 Situação e serviço de arte

| Código                  | Opção candidata                                       |
| ----------------------- | ----------------------------------------------------- |
| `ARTE_PRONTA_APROVADA`  | Arte pronta e aprovada                                |
| `ARTE_PRONTA_REVISAR`   | Arte pronta, precisa de conferência/ajuste            |
| `ARQUIVO_ENVIAR_DEPOIS` | Cliente enviará o arquivo depois                      |
| `VETORIZACAO_SILMER`    | Precisa vetorizar/adaptar                             |
| `CRIACAO_SILMER`        | Criação pela Silmer                                   |
| `REUTILIZAR_ARTE`       | Reutilizar arte anterior identificada                 |
| `SEM_ARTE`              | Sem arte/sem aplicação                                |
| `PENDENTE_HUMANO`       | Situação não resolvida; bloqueia orçamento automático |

### 6.10 Finalidade, perfil e logística

Esses dados pertencem ao Pedido/atendimento, não ao preço base da peça, mas
ajudam a IA a conduzir a conversa.

| Campo            | Opções candidatas                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finalidade       | Evento; uniforme empresarial; uniforme escolar; equipe esportiva; corrida; bloco/abadá; igreja/grupo; campanha/promocional; revenda; uso próprio; outra |
| Perfil de compra | Uso próprio; empresa/organização; organizador de evento; revenda/atacado; recorrente; outro                                                             |
| Modalidade       | Retirada; entrega local; transportadora; Correios/outro operador — confirmar o que a Silmer oferece                                                     |
| Prazo            | Data desejada pelo cliente; data confirmada somente por pessoa autorizada                                                                               |

## 7. Campos adicionais necessários para preço por item

Antes de criar preços, o cliente precisa decidir quais fatores realmente
alteram o valor:

| Fator                   | Decisão que o cliente precisa fornecer                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| Produto/variante        | Preço base ou regra de custo por produto e modelo                           |
| Material                | Código de fornecedor, unidade, consumo, perda e vigência do custo           |
| Quantidade              | Faixas de quantidade e mínimo por combinação                                |
| Tamanho                 | Quais tamanhos possuem adicional e quanto                                   |
| Cor                     | Se cor, mescla, neon ou lote alteram custo/disponibilidade                  |
| Aplicação               | Técnica, local, área, cores, pontos, setup/matriz e quantidade              |
| Construção              | Recortes, bolsos, zíper, capuz, forro, elástico, punhos e outros adicionais |
| Arte                    | Criação, ajuste, vetorização e prova                                        |
| Urgência                | Se existe taxa de urgência e quem pode autorizá-la                          |
| Terceirização           | Fornecedor, custo, mínimo, prazo e validade                                 |
| Impostos/frete          | Se entram no preço do item ou aparecem separados                            |
| Arredondamento/desconto | Regra e autoridade humana para aplicar                                      |

Preço não deve ser colocado diretamente nas opções acima. Ele terá livro de
preços versionado, com vigência e aprovação próprias. A IA poderá reproduzir
somente um orçamento aprovado; não calculará, negociará ou prometerá preço.

## 8. Contrato recomendado depois da aprovação

### 8.1 Estrutura conceitual

Sem antecipar a migração SQL, o catálogo aprovado precisará representar:

- versão publicada do catálogo;
- produto e variante/modelo;
- dimensões de construção (modelagem, gola, manga e adicionais);
- material e variante técnica por fornecedor;
- cor vinculada ao material/fornecedor;
- tabela de tamanhos por variante;
- técnica e locais de aplicação;
- compatibilidades e combinações proibidas;
- aliases para linguagem do cliente e termos legados;
- regra de exceção pendente de aprovação;
- snapshot imutável da seleção no item do Pedido;
- livro de preços versionado, separado do catálogo de opções.

As tabelas atuais `catalog_products`, `catalog_models`, `catalog_materials` e
`catalog_techniques` podem ser aproveitadas como núcleo, mas não bastam para a
formação de preço descrita nesta RFC.

### 8.2 Mapeamento da Ficha atual

| Campo atual               | Destino recomendado                                     |
| ------------------------- | ------------------------------------------------------- |
| `itens[].tipo`            | Produto publicado                                       |
| `itens[].modelo`          | Nome derivado da variante e suas dimensões              |
| `itens[].malhas[]`        | Seleções de material com papel na peça                  |
| Cores por parte           | Seleções de cor por parte e material                    |
| `vies_gola`/`vies_mangas` | Acabamento + material + cor + aplicabilidade            |
| `grade[]`                 | Tamanho publicado + quantidade; especial fica explícito |
| `pedido.aplicacao`        | Resumo derivado das aplicações dos itens                |
| `pedido.observacoes[]`    | Somente instruções que não substituem campo estruturado |

### 8.3 Contrato da IA no n8n

O briefing plano deve evoluir para algo equivalente a:

```json
{
  "items": [
    {
      "product": { "code": "", "raw_text": "", "status": "pending" },
      "variant": { "code": "", "raw_text": "", "status": "pending" },
      "materials": [],
      "part_colors": {},
      "finishes": {},
      "size_breakdown": [],
      "applications": []
    }
  ]
}
```

Regras mínimas:

1. a IA pode extrair vários itens da mesma mensagem;
2. `raw_text` preserva o termo do cliente;
3. código só é gravado quando existir correspondência autorizada e segura;
4. baixa confiança, opção desconhecida ou combinação proibida vira `pending`;
5. correção do cliente substitui somente o fato corrigido e mantém auditoria;
6. preço, prazo confirmado e disponibilidade continuam fora da decisão do modelo;
7. o CRM, não o prompt, valida código, versão e compatibilidade.

## 9. Perguntas bloqueantes para a reunião com o cliente

1. Quais tipos de produto a Silmer realmente vende hoje?
2. `Camiseta` e `camisa` são sinônimos ou produtos diferentes?
3. `Baby look` e `abadá` são produtos ou modelagens?
4. Quais combinações de gola, manga e modelagem são produzidas?
5. O que significam exatamente `HELANQUINHA`, `LIGHT` e `OLIMPICA` na ficha?
6. Quais malhas estão ativas, com fornecedor, código, composição e gramatura?
7. Quais cores existem por malha e quais nomes/aliases a equipe usa?
8. O que significam `XX` e `JEGAO`; qual é a grade canônica por produto?
9. Quais técnicas são internas, terceirizadas ou indisponíveis?
10. Quais locais, tamanhos e quantidades de cores alteram o preço da aplicação?
11. Que adicionais de costura alteram preço ou prazo?
12. Quais opções podem ser apresentadas automaticamente pela IA e quais sempre exigem vendedor?
13. Qual é o mínimo de peças por produto, material e técnica?
14. Como tratar item/combinação nova: bloquear, encaminhar para orçamento ou permitir exceção aprovada?

## 10. Ações após a decisão

| Ação                                                                                                 | Responsável              | Prazo            | Estado                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------ | ---------------- | -------------------------- |
| Revisar todas as opções com o cliente e registrar manter/remover/adicionar.                          | Rômulo + cliente         | A definir        | EM ANDAMENTO (planilha)    |
| Registrar fornecedor, código, composição, gramatura, cores e disponibilidade dos materiais mantidos. | Cliente/produção         | A definir        | NÃO INICIADO               |
| Resolver os termos legados e a equivalência de tamanhos.                                             | Cliente/produção         | A definir        | NÃO INICIADO               |
| Aprovar as dimensões que alteram preço e suas regras.                                                | Cliente/comercial        | A definir        | NÃO INICIADO               |
| Atualizar esta RFC com o resultado explícito e os nomes dos aprovadores.                             | Rômulo                   | Após revisão     | NÃO INICIADO               |
| Alinhar as sugestões provisórias de `order-catalog.js` à lista aprovada.                             | Engenharia               | Após revisão     | BLOQUEADO PELA REVISÃO     |
| Criar ADR/TDD da estrutura final de catálogo, compatibilidade e preço.                               | Tech Lead                | Após aprovação   | BLOQUEADO PELA REVISÃO     |
| Evoluir banco, API, tela do Pedido e snapshot versionado.                                            | Engenharia               | Após TDD         | BLOQUEADO PELA REVISÃO     |
| Evoluir `briefing_patch` para `items[]` e validar o workflow DEV.                                    | Engenharia/n8n           | Após API         | BLOQUEADO PELA REVISÃO     |
| Criar evals com aliases, vários itens, ambiguidade, correção e opção desconhecida.                   | QA/IA                    | Após contrato    | BLOQUEADO PELA REVISÃO     |
| Publicar catálogo e workflow em produção com autorização explícita.                                  | Responsáveis autorizados | Após homologação | BLOQUEADO PELA HOMOLOGAÇÃO |

## 11. Resultado

**Decisão:** pendente.

**Data da decisão:** pendente.

**Decidido por:** pendente; registrar os nomes das pessoas que efetivamente
aprovaram.

**Resultado da lista:** pendente; esta seção receberá a relação final de opções
mantidas, removidas, adicionadas e os termos normalizados.

Nenhum teste, documento ou conversa substitui a aprovação comercial explícita.

## 12. Referências

- `ficha_exemplo.xlsx` e `CAMPOS-FICHA-E-JORNADA-P0-1.md` — campos e termos da Ficha.
- `.specs/features/pedidos-mvp/spec.md` — `PFI-03`, `PFI-04` e `PFI-07`.
- `.specs/features/pedidos-mvp/tasks.md` — `T31`.
- `modules/catalog/src/domain/catalog-version.js` — grupos e snapshot do catálogo atual.
- `modules/n8n-integration/src/service.js` — campos planos atuais do briefing.
- `apps/edge-web/src/lib/order-catalog.js` (PR #97) — sugestões provisórias da tela do Pedido.
- Planilha Google “Validação do catálogo de opções do Pedido” — decisões do cliente em andamento.
- [Humatex — linha de produtos](https://www.humatex.com.br/produtos) — exemplos atuais de malhas para uniformes e esporte.
- [ITEMA — tipos, composições e especificações de malha](https://itema.com.br/) — separação entre construção, fibra, gramatura, largura e cor.
- [Thatimalhas — catálogo de malhas](https://www.thatimalhas.com.br/downloads/CATALOGO-THATIMALHAS.pdf) — referências de PV, PP, PA, piquet, dry fit, helanca e moletom.
- [Pettenati — produto e segmentos](https://www.pettenati.com.br/o-produto/) — diversidade de construções, acabamentos e fibras.
- [Brother — diferenças entre DTG, serigrafia e sublimação](https://solucoes.brother.com.br/direct-to-garment-alem-da-maquina-de-estampar-camiseta) — vocabulário de técnicas.
- [Brother — DTG e DTF](https://solucoes.brother.com.br/impressoras-texteis-dtg-dtf-gtx-alta-producao) — confirmação de técnicas digitais distintas.

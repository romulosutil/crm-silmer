# CRM Silmer — Especificação de Produto do MVP

> **Versão:** v5 — 29/08/2026  
> **Status:** P0.1 resolvido; pronta para especificar a jornada, com seis bloqueadores de produto restantes  
> **Decisão de passagem:** GO condicional para Tech Lead; NO-GO para fechar arquitetura, estimativa ou iniciar implementação antes dos itens P0 da seção 15.

## 1. Visão do produto

O CRM Silmer será o sistema próprio que organiza a jornada comercial desde a primeira mensagem até a criação e o envio da Ficha de Pedido. Ele substitui integralmente o Datacrazy; o conteúdo de `historico-datacrazy/` é somente registro histórico e não deve orientar a arquitetura nova.

O produto terá duas superfícies operacionais diferentes:

1. **Caixa de Entrada:** backlog de conversas recebidas. Uma conversa ainda não é necessariamente um lead.
2. **Kanban Comercial:** contém apenas oportunidades que já foram reconhecidas como leads e acompanha sua evolução até `Fechado` ou `Perdido`.

O **Vendedor Silmer** será um agente de IA do próprio CRM. Ele deverá tentar conduzir sozinho toda a jornada permitida: analisar a conversa, retirar uma oportunidade do backlog, criar o lead, preencher dados, avançar cards e preparar a conclusão. Pessoas continuam capazes de realizar e corrigir manualmente qualquer ação.

## 2. Objetivos do MVP

- Centralizar as conversas comerciais recebidas pela API oficial do WhatsApp Business.
- Separar conversas pendentes de oportunidades comerciais reais.
- Permitir conversão manual e automática de uma conversa em lead.
- Fazer o Vendedor Silmer conduzir a qualificação e avançar o lead autonomamente.
- Produzir a Ficha de Pedido com dados suficientes para produção e cobrança.
- Enviar a Ficha aprovada para Rose, no WhatsApp `+55 27 99901-0303`.
- Registrar vendas e oferecer uma visão financeira comercial básica.
- Manter intervenção humana, rastreabilidade e recuperação em caso de falha.

## 3. Fora do escopo inicial

- Estoque e movimentação de insumos.
- Contabilidade, conciliação bancária e escrituração fiscal.
- Emissão fiscal.
- Aplicativo móvel nativo; o MVP será web responsivo.
- Gestão completa do chão de fábrica após a entrega da Ficha.
- Automação de pós-venda e recompra.
- Disparos comerciais em massa.

## 4. Personas

### Atendimento

Monitora a Caixa de Entrada e o trabalho do Vendedor Silmer. Pode responder conversas, transformar uma conversa em lead, corrigir campos, retomar um atendimento, mover cards, aplicar marcações e transferir para um vendedor.

### Vendedor

Pode fazer tudo que Atendimento faz e também assumir negociações, tratar valores, aprovar condições, registrar o valor final, fechar ou perder uma venda, revisar a Ficha de Pedido e acompanhar o estado financeiro comercial.

### Vendedor Silmer

É o agente de IA operacional. Não é apenas um chatbot: ele atua no CRM por ferramentas controladas. Pode ler contexto, responder, criar lead, preencher campos, consultar regras, mover cards, gerar resumo e preparar a Ficha. Toda ação deve ser auditável e reversível.

## 5. Caixa de Entrada como backlog

Toda conversa recebida entra primeiro na Caixa de Entrada com estado próprio, por exemplo: `Nova`, `Em análise`, `Em atendimento`, `Convertida em lead`, `Encerrada sem lead` ou `Requer atenção`.

Uma conversa pode sair do backlog de duas formas:

- **Ação humana:** uma pessoa usa o botão `Transformar em lead`.
- **Ação do Vendedor Silmer:** o agente reconhece intenção comercial e executa a mesma operação por ferramenta interna.

Converter em lead cria ou vincula um Contato e cria um novo Negócio no Kanban. Contatos recorrentes podem possuir vários negócios sem perder o histórico de relacionamento.

A conversão deve ser idempotente: retries do webhook, mensagens duplicadas ou cliques repetidos não podem criar leads ou cards duplicados.

## 6. Canal do MVP

O canal confirmado para o MVP é a **API oficial do WhatsApp Business**. A verificação necessária já foi obtida.

Instagram e canal próprio do site devem ser tratados como integrações posteriores, mas a modelagem de Conversa e Mensagem não deve depender exclusivamente do WhatsApp. Cada mensagem registra canal, identificador externo, remetente, timestamp, conteúdo, anexos e estado de processamento.

Se o CRM não consumir uma mensagem, ela pode continuar disponível no canal nativo. Portanto, o critério de confiabilidade não será “a mensagem desapareceu”, mas sim:

> Toda mensagem conhecida pelo CRM deve estar processada ou visível em uma fila de reconciliação, com canal, erro e possibilidade de retomada.

O produto deve exibir saúde do canal, último evento recebido e pendências de processamento. A sincronização retroativa oferecida pela API deverá ser confirmada pelo Tech Lead; o produto não deve prometer recuperação automática que o provedor não ofereça.

## 7. Vendedor Silmer e autonomia

O Vendedor Silmer tenta concluir a jornada sem intervenção humana. Ele deve:

1. Ler a mensagem e o histórico disponível.
2. Identificar se existe intenção comercial.
3. Converter a conversa em lead quando aplicável.
4. Descobrir o próximo campo necessário da jornada.
5. Perguntar apenas o que ainda não está respondido.
6. Registrar a resposta em dados estruturados.
7. Validar se a etapa atual pode ser concluída.
8. Avançar o card automaticamente.
9. Preparar o resumo e a Ficha quando todos os requisitos estiverem presentes.

O agente interrompe e transfere para uma pessoa quando:

- o cliente pede explicitamente para falar com um vendedor da Silmer;
- o cliente insiste em preço, promessa de prazo ou mínimo antes de concluir a jornada necessária;
- o agente encontra um bloqueio real que não consegue resolver com os dados, catálogo e regras autorizadas, depois de registrar o motivo.

O agente nunca inventa preço, prazo, disponibilidade, condição de pagamento ou regra de produção. Ao final da qualificação, ele só poderá informar valores se existir uma política aprovada e tecnicamente consultável. Até essa decisão ser fechada, o preço final continua sob responsabilidade humana.

## 8. Papel do n8n

O n8n é **opcional** e não faz parte do núcleo obrigatório do produto.

A máquina de estados comercial, as permissões do agente, a idempotência, a auditoria e o avanço dos cards devem pertencer ao CRM. O Vendedor Silmer deve funcionar mesmo sem n8n.

O n8n poderá ser usado depois para automações periféricas, como notificações, integrações de baixa criticidade e rotinas agendadas. O Tech Lead decidirá se há benefício suficiente para incluí-lo, sem transformar sua presença em requisito do MVP.

## 9. Ficha de Pedido como contrato da jornada

`ficha_exemplo.xlsx` é a fonte primária para definir o que a qualificação precisa coletar. O fluxo foi construído de trás para frente: primeiro os dados necessários para produzir e cobrar; depois as perguntas, validações e etapas que os obtêm. O inventário aprovado está em `CAMPOS-FICHA-E-JORNADA-P0-1.md`.

A ficha real contém, no mínimo:

- Pedido N°, FAB, vendedor e data do pedido.
- Nome do pedido/evento e cliente.
- Data de entrega e aplicação.
- Item, modelo e malha.
- Cores por parte: frente, costas, manga direita, manga esquerda, viés de gola e viés de mangas.
- Grade de tamanhos e quantidade por tamanho.
- Total de peças.
- Observações de produção.
- Campos posteriores de conferência, arremate e embalagem.

Para o CRM, os campos posteriores de chão de fábrica permanecem apenas no documento; não serão gerenciados como workflow no primeiro MVP.

Usar a ficha para “treinar” a IA significa transformar seus campos em esquema estruturado, regras, exemplos, perguntas e validações. Uma planilha isolada não será tratada como conjunto suficiente para treinamento de modelo.

## 10. Jornada comercial aprovada

O P0.1 fixa seis etapas de negócio:

1. **Backlog — Caixa de Entrada:** acolhe, identifica cliente e pedido e decide
   se existe intenção comercial. Não é coluna do Kanban.
2. **Produto:** define tipo de peça, modelo e quantidade inicial por item.
3. **Especificação:** fecha malha, cores por parte, viéses e grade; a soma da
   grade deve corresponder ao total.
4. **Estampa:** fecha situação da arte, arquivo ou responsabilidade de criação,
   técnica e locais de aplicação.
5. **Logística:** coleta prazo desejado, finalidade, perfil de compra e dados de
   entrega ou retirada, sem prometer viabilidade.
6. **Fechamento:** confirma o resumo, recebe orçamento humano autorizado,
   registra negociação, decisão, data de entrega confirmada e inicia o PIX.

As colunas do Kanban são `Produto`, `Especificação`, `Estampa`, `Logística` e
`Fechamento`. Um card avança somente com todos os campos obrigatórios da etapa
`preenchido` ou `nao_aplicavel` com motivo. `pendente` e `divergente` bloqueiam
a passagem. Mudança que invalida dado anterior devolve o card à primeira etapa
incompleta, sem apagar o histórico.

Venda aprovada continua em `Fechamento` enquanto aguarda PIX. O card só vira
`Fechado` depois da confirmação humana do pagamento, geração da Ficha e
registro do onboarding. O recebimento de comprovante, sozinho, não conclui a
venda.

Um card pode ser marcado como `Perdido` em qualquer etapa, sempre com motivo.
Uma conversa encerrada sem intenção comercial não é um card perdido; ela é
encerrada no backlog como `Sem lead`. O contrato campo a campo, os gates e os
critérios `JRN-01` a `JRN-09` estão em
`CAMPOS-FICHA-E-JORNADA-P0-1.md`.

## 11. Geração e envio da Ficha

Quando a venda estiver aprovada e o pagamento PIX tiver confirmação manual, o sistema deverá:

1. Reservar um número sequencial de pedido sem colisão.
2. Preencher os dados estruturados da Ficha.
3. Permitir revisão por usuário autorizado.
4. Gerar uma versão estável em PDF ou imagem.
5. Registrar versão, autor da aprovação e horário.
6. Enviar para **Rose — `+55 27 99901-0303`**.
7. Registrar o identificador e o estado do envio.

No caminho inicial, a aprovação comercial cria uma única cobrança PIX e envia
a chave configurada. Receber comprovante cria uma tarefa de conferência, mas
não confirma pagamento automaticamente. Após a confirmação humana, a Ficha é
gerada e o cliente recebe boas-vindas com número do pedido, resumo, data
confirmada e modalidade logística. Cobrança, geração, envio da Ficha e
onboarding devem ser idempotentes.

A estratégia compatível com as regras da API oficial do WhatsApp — janela de atendimento, templates e envio de documento — será definida pelo Tech Lead e validada em integração real antes do piloto.

## 12. Financeiro comercial do MVP

O objetivo financeiro inicial é responder quanto o CRM vendeu e permitir acompanhamento comercial, sem virar um ERP.

O MVP deve registrar:

- valor final do pedido;
- data de fechamento;
- vendedor responsável;
- forma de pagamento, quando conhecida;
- estado comercial do pagamento, com vocabulário a definir;
- total vendido por período e por vendedor;
- quantidade de vendas e ticket médio;
- vendas canceladas e perdidas.

Há uma decisão P0 pendente: medir apenas **valor vendido** ou também **valor recebido/saldo a receber**. A segunda opção exige eventos de pagamento e aumenta o escopo.

O caminho operacional inicial de pagamento já está definido como envio de
chave PIX e confirmação humana. Essa decisão não resolve o P0.3: ele continua
necessário para definir quais eventos entram nos relatórios e se o CRM calcula
saldo a receber.

## 13. Privacidade e LGPD

O produto adotará uma linha de base compatível com práticas correntes de mercado, que deverá ser concretizada na especificação técnica:

- minimização dos dados coletados;
- acesso por função;
- credenciais e dados protegidos em trânsito e em repouso;
- trilha de auditoria;
- política de retenção e descarte;
- atendimento a correção, exportação e exclusão quando aplicável;
- registro dos operadores e integrações que processam os dados;
- aviso de privacidade e finalidade de uso.

“Padrão de mercado” não é critério testável sozinho. Prazos, responsáveis e procedimentos precisam ser definidos antes do piloto com clientes reais.

## 14. Critérios de sucesso do piloto

- Toda conversa recebida pelo CRM aparece no backlog ou na fila de reconciliação.
- Nenhuma conversa vira mais de um lead pelo mesmo evento de conversão.
- O Vendedor Silmer consegue converter e avançar um lead sem intervenção no caminho feliz.
- Toda ação do agente é auditável e reversível.
- Todo card termina como `Fechado` ou `Perdido`; conversas sem oportunidade terminam como `Sem lead` no backlog.
- Toda venda fechada gera uma Ficha sem redigitação dos dados já coletados.
- Toda Ficha aprovada possui estado de envio para Rose.
- O CRM apresenta total vendido, quantidade de vendas e ticket médio no período.
- Nenhum card transferido para atendimento humano fica sem responsável.

Os números do piloto — volume de conversas, vendas consecutivas e tempo de observação — permanecem pendentes.

## 15. Gate de produto para o Tech Lead

### Definido e liberado

- Caixa de Entrada é backlog; Kanban contém leads.
- Conversão em lead pode ser manual ou executada pelo Vendedor Silmer.
- Vendedor Silmer é autônomo e move cards por ferramentas do CRM.
- n8n não é dependência central.
- WhatsApp usa API oficial e a verificação foi obtida.
- Ficha é o contrato da qualificação.
- P0.1 está resolvido: etapas, campos obrigatórios, gates, PIX e boas-vindas
  estão definidos em `CAMPOS-FICHA-E-JORNADA-P0-1.md`.
- Destinatária da Ficha é Rose, `+55 27 99901-0303`.
- Financeiro comercial básico entra no escopo.
- Princípios mínimos de LGPD entram no escopo.

### P0 — fechar antes da aprovação da especificação técnica

2. Definir se o Vendedor Silmer pode informar preço após a qualificação e qual fonte autoriza o valor.
3. Definir se financeiro significa somente vendido ou também recebido/a receber.
4. Confirmar o canal exato do primeiro piloto além do WhatsApp, se houver.
5. Definir os valores de `FAB`, último número de pedido e regras de numeração.
6. Concretizar retenção, exclusão e responsáveis de privacidade.
7. Definir quem pode revisar, editar, cancelar e reenviar uma Ficha.

### Decisão do Product Manager

**GO condicional para iniciar a especificação com o Tech Lead.** Já existe informação suficiente para desenhar contexto, limites, integrações, estados, modelo de dados e riscos.

**NO-GO para aprovar o design final, fechar estimativa ou iniciar implementação.** Os seis P0 restantes alteram contratos de dados, estados e critérios de aceite; precisam ser resolvidos durante a primeira etapa conjunta de especificação.

## 16. Próximo passo recomendado

Realizar uma sessão Product Manager + operação Silmer + Tech Lead com a Ficha aberta. A saída esperada é:

1. Matriz de autonomia do Vendedor Silmer e fonte autorizada de preço.
2. Limite do financeiro comercial.
3. Canal adicional do piloto, se houver.
4. Regra de `FAB`, sequência e numeração.
5. Decisões de privacidade do piloto.
6. Permissões do ciclo de vida da Ficha.
7. Registro das decisões técnicas que pertencem ao Tech Lead, sem misturá-las ao PRD.

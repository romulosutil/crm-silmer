# CRM Silmer — Especificação de Produto do MVP

> **Versão:** v6 — 29/08/2026
> **Status:** P0.1 a P0.7 resolvidos e rastreabilidade sincronizada
> **Decisão de passagem:** GO integral; design técnico, tarefas, estimativa e implementação estão nas mãos do Tech Lead.

## 1. Visão do produto

O CRM Silmer será o sistema próprio que organiza a jornada comercial desde a primeira mensagem até a criação e o envio da Ficha de Pedido. Ele substitui integralmente o Datacrazy; o conteúdo de `historico-datacrazy/` é somente registro histórico e não deve orientar a arquitetura nova.

O produto terá duas superfícies operacionais diferentes:

1. **Caixa de Entrada:** backlog de conversas recebidas. Uma conversa ainda não é necessariamente um lead.
2. **Kanban Comercial:** contém apenas oportunidades que já foram reconhecidas como leads e acompanha sua evolução até `Fechado` ou `Perdido`.

O **Vendedor Silmer** será um agente de IA do próprio CRM. No MVP, trabalha em
sandbox: conversa com o cliente, lê contexto e sugere a próxima etapa, mas não
cria lead, não altera campo oficial e não move card. Depois do MVP, uma chave
desativada por padrão poderá liberar autonomia progressiva com permissões,
auditoria e rollback explícitos.

## 2. Objetivos do MVP

- Centralizar as conversas comerciais recebidas pela API oficial do WhatsApp Business.
- Separar conversas pendentes de oportunidades comerciais reais.
- Permitir conversão humana, idempotente e auditável de uma conversa em lead.
- Fazer o Vendedor Silmer conduzir a conversa e sugerir a próxima etapa sem
  alterar o estado comercial no MVP.
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

É o agente de IA operacional. No MVP pode ler contexto autorizado, responder,
consultar regras, resumir e sugerir a próxima etapa. A sugestão é não
vinculante e depende de confirmação humana. A autonomia para criar lead,
preencher campos e mover cards pertence ao pós-MVP e só poderá existir atrás
da chave `vendedor_silmer_autonomia_comercial`, desativada por padrão.

## 5. Caixa de Entrada como backlog

Toda conversa recebida entra primeiro na Caixa de Entrada com estado próprio, por exemplo: `Nova`, `Em análise`, `Em atendimento`, `Convertida em lead`, `Encerrada sem lead` ou `Requer atenção`.

No MVP, uma conversa sai do backlog por ação humana: Atendimento ou Vendedor
usa o botão `Transformar em lead`. O Vendedor Silmer pode sugerir essa ação,
mas não executá-la. A execução autônoma poderá ser habilitada somente na fase
P2 pela chave de autonomia comercial.

Converter em lead cria ou vincula um Contato e cria um novo Negócio no Kanban. Contatos recorrentes podem possuir vários negócios sem perder o histórico de relacionamento.

A conversão deve ser idempotente: retries do webhook, mensagens duplicadas ou cliques repetidos não podem criar leads ou cards duplicados.

## 6. Canal do MVP

O canal obrigatório do MVP é a **API oficial do WhatsApp Business**. A
verificação necessária já foi obtida. O **Instagram Direct** também entra no
piloto por integração oficial, mas é não bloqueante: sua indisponibilidade não
atrasa o lançamento pelo WhatsApp. O site apenas abre o WhatsApp e pode
registrar origem `site`; não é um terceiro canal de conversa.

Cada mensagem registra canal, identificador externo, remetente, timestamp,
conteúdo, anexos e estado de processamento. Identidades de Instagram e
WhatsApp só são fundidas por correlação verificável ou decisão humana
auditável.

Se o CRM não consumir uma mensagem, ela pode continuar disponível no canal nativo. Portanto, o critério de confiabilidade não será “a mensagem desapareceu”, mas sim:

> Toda mensagem conhecida pelo CRM deve estar processada ou visível em uma fila de reconciliação, com canal, erro e possibilidade de retomada.

O produto deve exibir saúde do canal, último evento recebido e pendências de processamento. A sincronização retroativa oferecida pela API deverá ser confirmada pelo Tech Lead; o produto não deve prometer recuperação automática que o provedor não ofereça.

## 7. Vendedor Silmer no MVP e autonomia futura

No MVP, o Vendedor Silmer:

1. Lê a mensagem e o histórico autorizado.
2. Responde no canal e coleta informações pela conversa.
3. Identifica intenção comercial e sugere `Transformar em lead`.
4. Descobre o próximo campo necessário da jornada.
5. Pergunta apenas o que ainda não foi respondido.
6. Produz resumo e sugestão não vinculante da etapa.
7. Aguarda uma pessoa confirmar a conversão, o campo oficial ou a mudança de
   card.

O agente interrompe e transfere para uma pessoa quando:

- o cliente pede explicitamente para falar com um vendedor da Silmer;
- o cliente insiste em preço, promessa de prazo ou mínimo antes de concluir a jornada necessária;
- o agente encontra um bloqueio real que não consegue resolver com os dados, catálogo e regras autorizadas, depois de registrar o motivo.

O agente nunca inventa preço, prazo, disponibilidade, condição de pagamento ou
regra de produção. Após a qualificação, comunica somente uma versão vigente de
orçamento humano aprovada por `Admin`; não calcula, negocia nem concede
desconto.

No pós-MVP, a chave `vendedor_silmer_autonomia_comercial`, desativada por
padrão, poderá autorizar conversão em lead, escrita de campos e avanço de card.
Essa fase exige escopo de permissão, auditoria, rollback e desligamento
imediato e não compõe o aceite do MVP.

## 8. Papel do n8n

O n8n é **opcional** e não faz parte do núcleo obrigatório do produto.

A máquina de estados comercial, as permissões do agente, a idempotência, a auditoria e o avanço dos cards devem pertencer ao CRM. O Vendedor Silmer deve funcionar mesmo sem n8n; no MVP, somente pessoas mutam o estado comercial.

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

1. Reservar um identificador sequencial sem colisão, começando em `01-CRM`.
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

O MVP mede somente **valor vendido**. Uma venda entra nos indicadores em
`aprovado_aguardando_pix`, exatamente uma vez. Valores recebidos, saldo a
receber, parcelamento, conciliação e estornos financeiros ficam em P2. O
subfluxo PIX continua operacional e auditável, mas não gera métricas agregadas
de recebido.

## 13. Privacidade e LGPD

O produto adota a política concreta de retenção e exclusão aprovada no
`PRODUCT-READINESS-TECH-LEAD.md`, validada com a assessoria jurídica consultada
pela Silmer. O Responsável de Privacidade é **Rômulo Sutil Corrêa**. O Tech Lead
deve implementar:

- minimização dos dados coletados;
- acesso por função;
- credenciais e dados protegidos em trânsito e em repouso;
- trilha de auditoria;
- política de retenção e descarte;
- atendimento a correção, exportação e exclusão quando aplicável;
- registro dos operadores e integrações que processam os dados;
- aviso de privacidade e finalidade de uso.

Prazos, classes de dado, `legal_hold`, backups, operadores e atendimento aos
direitos do titular seguem os critérios `PRV-P06-01` a `PRV-P06-12`.

## 14. Critérios de sucesso do piloto

- Toda conversa recebida pelo CRM aparece no backlog ou na fila de reconciliação.
- Nenhuma conversa vira mais de um lead pelo mesmo evento de conversão.
- O Vendedor Silmer responde e sugere a próxima etapa sem mutar o estado do
  domínio no MVP.
- Toda mensagem e sugestão do agente é auditável; somente uma pessoa confirma
  conversão e mudança de etapa.
- Todo card termina como `Fechado` ou `Perdido`; conversas sem oportunidade terminam como `Sem lead` no backlog.
- Toda venda fechada gera uma Ficha sem redigitação dos dados já coletados.
- Toda Ficha aprovada possui estado de envio para Rose.
- O CRM apresenta total vendido, quantidade de vendas e ticket médio no período.
- Nenhum card transferido para atendimento humano fica sem responsável.

Instagram pode entrar durante o piloto sem ser condição de lançamento. Os
números de observação e volume são métricas operacionais definidas pelo Tech
Lead com a operação e não reabrem P0.

## 15. Gate de produto para o Tech Lead

### Definido e liberado

- Caixa de Entrada é backlog; Kanban contém leads.
- Conversão e mutação de card são humanas no MVP; o Vendedor Silmer apenas
  conversa e sugere.
- Autonomia comercial é P2 e fica atrás de chave desativada por padrão.
- n8n não é dependência central.
- WhatsApp usa API oficial e bloqueia o go-live; Instagram Direct entra no
  piloto sem bloquear o lançamento; site abre o WhatsApp.
- Ficha é o contrato da qualificação.
- P0.1 está resolvido: etapas, campos obrigatórios, gates, PIX e boas-vindas
  estão definidos em `CAMPOS-FICHA-E-JORNADA-P0-1.md`.
- Destinatária da Ficha é Rose, `+55 27 99901-0303`.
- Financeiro mede valor vendido; recebido e saldo ficam em P2.
- Pedido começa em `01-CRM`, sem sequência legada.
- Política de privacidade está aprovada e Rômulo Sutil Corrêa é o responsável.
- Permissões da Ficha seguem função Atendimento/Vendedor e role adicional
  `Admin`.

### P0 concluído

P0.1 a P0.7 estão resolvidos no `PRODUCT-READINESS-TECH-LEAD.md` e propagados
para os requisitos rastreáveis. Não resta decisão de produto bloqueante.

### Decisão do Product Manager

**GO integral.** O Tech Lead possui contexto, limites, integrações, estados,
modelo de dados, autorização, privacidade, riscos e critérios de aceite para
finalizar design, tarefas, estimativa e implementação.

## 16. Próximo passo recomendado

O Tech Lead deve produzir a especificação técnica, decompor tarefas, estimar e
implementar. A operação participa de UAT e fornece credenciais/configurações de
ambiente sem reabrir as decisões de produto registradas.

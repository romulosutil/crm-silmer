# CRM Silmer — Especificação de Produto do MVP

> **Versão:** v7 — 08/09/2026
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
- Disparar automaticamente o n8n a cada mensagem válida recebida, sem botão na interface.
- Permitir conversão automática, idempotente e auditável de uma conversa comercial em lead.
- Fazer o Vendedor Silmer no n8n conduzir a conversa, atualizar dados e avançar
  as etapas permitidas até o fechamento ou a transferência para uma pessoa.
- Produzir a Ficha de Pedido com dados suficientes para produção e cobrança.
- Enviar a Ficha aprovada para Rose usando o telefone resolvido pela referência
  `secret://crm/order-recipient-phone`, sem versionar o dado pessoal.
- Registrar vendas e oferecer uma visão financeira comercial básica.
- Manter tomada humana, rastreabilidade e recuperação em caso de falha.

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

Pode fazer tudo que Atendimento faz e também assumir negociações, tratar
valores, registrar propostas e o valor final, marcar uma oportunidade como
`Perdido` antes da aprovação comercial, revisar o rascunho da Ficha de Pedido e
acompanhar o estado financeiro comercial. A função Vendedor, isoladamente, não
aprova condições, venda ou Ficha nem conclui o fechamento como venda aprovada;
essas ações exigem uma pessoa autorizada com a role adicional `Admin`, conforme
o P0.7.

### Vendedor Silmer

É o agente de IA operacional executado obrigatoriamente no n8n. Pode ler
contexto autorizado, responder, consultar regras, resumir, criar ou atualizar
leads, preencher campos e mover cards por comandos da API do CRM. Preço,
aprovação de venda, confirmação de pagamento e aprovação da Ficha continuam
dependendo de pessoa autorizada.

## 5. Caixa de Entrada como backlog

Toda conversa recebida entra primeiro na Caixa de Entrada com estado próprio, por exemplo: `Nova`, `Em análise`, `Em atendimento`, `Convertida em lead`, `Encerrada sem lead` ou `Requer atenção`.

Cada mensagem válida dispara automaticamente o workflow do n8n. A simples
chegada não cria lead: o Vendedor Silmer primeiro classifica a intenção e,
quando ela for comercial, solicita ao CRM a criação ou vinculação do Contato e
de exatamente um Negócio. A interface pode oferecer conversão manual durante
tomada humana, mas nenhum botão inicia o n8n.

Converter em lead cria ou vincula um Contato e cria um novo Negócio no Kanban. Contatos recorrentes podem possuir vários negócios sem perder o histórico de relacionamento.

`Convertida em lead` encerra a triagem, não a Conversa. O mesmo registro segue
ativo durante a jornada do Negócio, permitindo campos e transições automáticas;
`terminal_at` só é preenchido pelos encerramentos oficiais. Cliente é sempre a
composição `Contact` + `ContactIdentity`, nunca uma tabela paralela de leads.

A conversão deve ser idempotente: retries do webhook, mensagens duplicadas ou cliques repetidos não podem criar leads ou cards duplicados.

## 6. Canal do MVP

Os canais obrigatórios do MVP são a **API oficial do WhatsApp Business** e o
**Instagram Direct**, ambos integrados pelo n8n e submetidos ao mesmo fluxo. O
site apenas abre um desses canais e pode registrar origem `site`; não é um
terceiro canal de conversa.

O adaptador do backend nasce neutro de canal, mas o rollout v1 homologa e ativa
WhatsApp primeiro. Instagram é a próxima etapa obrigatória e continua
bloqueando o lançamento integral até passar pelo mesmo contrato e smoke.

Cada mensagem registra canal, identificador externo, remetente, timestamp,
conteúdo, anexos e estado de processamento. Identidades de Instagram e
WhatsApp só são conectadas por correlação verificável ou decisão humana
auditável. Ao migrar de canal, o mesmo Negócio continua ativo e o lead passa a
referenciar tanto o `@instagram` quanto o telefone, sem apagar os históricos
separados de cada identidade.

Os metadados da mensagem e os bytes de mídia têm ciclos distintos. Imagens e
arquivos de canal ficam temporariamente em volume privado da VPS e são
eliminados no fim da jornada ou em sete dias, o que ocorrer primeiro. Arquivo
validado como necessário à operação é preservado no Dropbox pelo procedimento
interno da Silmer; o CRM registra o handoff, sem presumir integração automática
com o Dropbox. Documentos comerciais válidos seguem sua classe própria de
retenção.

Se o CRM não consumir uma mensagem, ela pode continuar disponível no canal nativo. Portanto, o critério de confiabilidade não será “a mensagem desapareceu”, mas sim:

> Toda mensagem conhecida pelo CRM deve estar processada ou visível em uma fila de reconciliação, com canal, erro e possibilidade de retomada.

O produto deve exibir saúde do canal, último evento recebido e pendências de processamento. A sincronização retroativa oferecida pela API deverá ser confirmada pelo Tech Lead; o produto não deve prometer recuperação automática que o provedor não ofereça.

## 7. Vendedor Silmer no MVP

No MVP, o Vendedor Silmer:

1. Lê a mensagem e o histórico autorizado.
2. Responde no canal e coleta informações pela conversa.
3. Identifica intenção comercial e sugere `Transformar em lead`.
4. Descobre o próximo campo necessário da jornada.
5. Pergunta apenas o que ainda não foi respondido.
6. Produz uma decisão estruturada e solicita ao CRM somente as mutações
   autorizadas para a etapa.
7. Registra o gate e avança o card quando os campos estiverem válidos, ou
   aguarda a aprovação humana quando o gate for preço, venda, pagamento ou
   Ficha.

O agente interrompe e abre uma fila humana por papel quando:

- o cliente pede explicitamente para falar com um vendedor da Silmer;
- o cliente insiste em preço, promessa de prazo ou mínimo antes de concluir a jornada necessária;
- o agente encontra um bloqueio real que não consegue resolver com os dados, catálogo e regras autorizadas, depois de registrar o motivo.

`briefing_complete` e `negotiation` direcionam para Vendedor; solicitação
humana, reclamação, urgência, baixa confiança e caso não suportado direcionam
para Atendimento. O handoff nasce sem responsável e a primeira pessoa elegível
o reivindica atomicamente.

O agente nunca inventa preço, prazo, disponibilidade, condição de pagamento ou
regra de produção. Após a qualificação, comunica somente uma versão vigente de
orçamento humano aprovada por `Admin`; não calcula, negocia nem concede
desconto.

Tomada humana, handoff, retorno à IA, fechamento ou desligamento incrementam o
`automation_epoch`. Antes de cada resposta automática, o n8n reserva o efeito
apresentando epoch e revisão inbound ao CRM; decisões antigas são rejeitadas e
não podem retomar a conversa silenciosamente.

## 8. Papel do n8n

O n8n é **obrigatório** e funciona como motor operacional do MVP. Ele recebe e
envia mensagens do WhatsApp oficial, chama o provedor de IA configurado, conduz perguntas,
solicita criação ou atualização de leads, move o Kanban pelos gates permitidos
e transfere para uma pessoa quando necessário.

O n8n não é a fonte da verdade. A máquina de estados, as permissões, a
idempotência e a auditoria oficial pertencem ao CRM. Workflows nunca acessam
diretamente o banco: usam APIs autenticadas, autorizadas, versionadas e
idempotentes. O histórico do n8n é log técnico; o efeito de negócio precisa
estar registrado no CRM.

A indisponibilidade do n8n interrompe a automação e aparece como pendência
operacional. Não há execução silenciosa por outro caminho. No MVP, o n8n usa
execução regular; queue mode e Redis ficam para uma evolução sustentada por
medição.

O contrato n8n→CRM do MVP possui três endpoints e usa somente Basic Auth com o
ator `AUTOMATION_EXECUTOR`, idempotência, correlação e identidade de workflow
nos headers. O contexto vem de mensagens recentes e do snapshot de briefing da
Conversa; o n8n não mantém memória comercial paralela. Toda chamada à Meta é
precedida de uma reserva de uso único `message.send.requested`, cercada por
epoch e revisão inbound; não há claim, lease ou token de rodada. Resultado
incerto é reconciliado sem retry cego.

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
6. Enviar para **Rose**, resolvendo o telefone por
   `secret://crm/order-recipient-phone`.
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
No piloto interno, a regra específica da mídia transitória é o menor prazo
entre o encerramento da jornada e sete dias do recebimento/envio. Essa regra
não alcança Pedido, Ficha, orçamento aprovado, comprovante PIX válido, eventos
comerciais nem auditoria.

## 14. Critérios de sucesso do piloto

- Toda conversa recebida pelo CRM aparece no backlog ou na fila de reconciliação.
- Nenhuma conversa vira mais de um lead pelo mesmo evento de conversão.
- Toda mensagem válida dispara automaticamente o n8n e aparece no CRM ou em
  pendência de reconciliação.
- O Vendedor Silmer cria ou atualiza leads e move o Kanban por comandos
  autorizados do CRM, sem acesso direto ao banco.
- Toda mensagem, decisão, mutação e transferência é auditável e correlacionada
  com uma versão de workflow.
- Todo card termina como `Fechado` ou `Perdido`; conversas sem oportunidade terminam como `Sem lead` no backlog.
- Toda venda fechada gera uma Ficha sem redigitação dos dados já coletados.
- Toda Ficha aprovada possui estado de envio para Rose.
- O CRM apresenta total vendido, quantidade de vendas e ticket médio no período.
- Nenhum handoff aceito fica sem responsável; handoff pendente permanece em
  fila explícita por papel até uma pessoa elegível reivindicá-lo.

WhatsApp é a condição de canal do primeiro MVP operacional. Instagram entra em
`CANAL-2` e então deve preservar o mesmo Negócio, o contexto e as identidades
verificadas. Os números
de observação e volume são métricas operacionais definidas pelo Tech Lead com a
operação e não reabrem P0.

## 15. Gate de produto para o Tech Lead

### Definido e liberado

- Caixa de Entrada é backlog; Kanban contém leads.
- Conversão, preenchimento e mudanças de etapa permitidas são executadas pelo
  Vendedor Silmer no n8n; gates de preço, venda, pagamento e Ficha permanecem
  humanos.
- n8n é dependência central e obrigatória do MVP.
- WhatsApp usa a API oficial e bloqueia o primeiro go-live; Instagram será
  adicionado em `CANAL-2` sobre o mesmo fluxo e o site abre um canal disponível.
- Ficha é o contrato da qualificação.
- P0.1 está resolvido: etapas, campos obrigatórios, gates, PIX e boas-vindas
  estão definidos em `CAMPOS-FICHA-E-JORNADA-P0-1.md`.
- A destinatária da Ficha é Rose; o telefone fica fora do repositório e é
  resolvido por `secret://crm/order-recipient-phone`.
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

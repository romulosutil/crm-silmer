# Passagem de Produto para Tech Lead

**Data:** 29/08/2026  
**Parecer:** GO condicional para iniciar especificação técnica. P0.1 a P0.4
resolvidos; três decisões P0 continuam abertas.

## O que o Tech Lead já pode especificar

- Contexto e limites do sistema.
- Separação entre backlog de conversas e Kanban de leads.
- Contratos de integração com as APIs oficiais do WhatsApp Business e do
  Instagram Direct; o site apenas inicia contato no WhatsApp.
- Modelo em sandbox do Vendedor Silmer, limitado a mensagens, sugestão de etapa
  e handoff, sem alterar o estado comercial.
- Necessidades de idempotência, auditoria, reconciliação e reversão.
- Modelo inicial das entidades Conversa, Contato, Lead, Card, Pedido e Evento financeiro.
- Opções de backend, banco, hospedagem, runtime de IA e geração documental.
- Riscos, spikes técnicos e plano de prova de conceito.

## O que impede aprovação final e estimativa fechada

| P0 | Decisão necessária | Status | Impacto técnico/evidência |
|---|---|---|---|
| 1 | Etapas definitivas e campos obrigatórios de cada passagem | **Resolvido** | Contrato aprovado em `CAMPOS-FICHA-E-JORNADA-P0-1.md` |
| 2 | Autoridade do Vendedor Silmer sobre preço após qualificação | **Resolvido** | Comunica somente orçamento humano aprovado, versionado e vigente; não calcula nem negocia |
| 3 | Financeiro cobre vendido ou também recebido/a receber | **Resolvido** | MVP mede vendido; recebido e saldo a receber ficam em P2 |
| 4 | Canais do primeiro piloto além do WhatsApp | **Resolvido** | WhatsApp Business e Instagram Direct; site apenas direciona ao WhatsApp; IA não move o Kanban |
| 5 | Significado de FAB, sequência vigente e numeração | Aberto | Contrato da Ficha e concorrência |
| 6 | Regras concretas de retenção e exclusão | Aberto | Dados, backups, logs e operação |
| 7 | Permissões para revisar, editar, cancelar e reenviar Ficha | Aberto | Autorização e auditoria |

## P0.1 resolvido — contrato de passagem

A decisão aprovada fixa a jornada em:

1. **Backlog — Caixa de Entrada**, fora do Kanban.
2. **Produto**, com peça, modelo e quantidade inicial.
3. **Especificação**, com malha, cores, acabamentos e grade fechada.
4. **Estampa**, com situação da arte, técnica e locais.
5. **Logística**, com prazo desejado, finalidade, perfil e entrega/retirada.
6. **Fechamento**, com resumo, orçamento, negociação, decisão e PIX.

Um card só avança quando todos os campos obrigatórios aplicáveis estão
`preenchido` ou `nao_aplicavel` com motivo. `pendente` e `divergente` bloqueiam
a passagem. O mapa completo da planilha, as perguntas, o subfluxo PIX, as
boas-vindas e os critérios `JRN-01` a `JRN-09` estão em
`CAMPOS-FICHA-E-JORNADA-P0-1.md`.

## P0.2 resolvido — autoridade sobre preço

O Vendedor Silmer pode informar preço após a qualificação somente como
comunicação fiel de um orçamento aprovado por uma pessoa com função
**Vendedor**. A fonte autorizada é a versão vigente do orçamento registrada no
CRM, com `valor_final`, `condicao`, `validade`, `aprovado_por` e `aprovado_em`.
Catálogo e dados da qualificação apoiam a preparação do pedido, mas não
autorizam nem calculam preço.

Critérios da decisão:

1. **PRC-01:** o agente só comunica o orçamento depois que a qualificação está
   completa e o cliente confirmou o resumo estruturado do pedido.
2. **PRC-02:** o agente reproduz exatamente valor, condição e validade da versão
   aprovada; não calcula preço, concede desconto, altera condição nem aceita
   contraproposta.
3. **PRC-03:** somente uma pessoa com função **Vendedor** aprova a versão que
   autoriza a comunicação do preço.
4. **PRC-04:** orçamento vencido, substituído ou sem aprovação não pode ser
   apresentado como vigente.
5. **PRC-05:** mudança em quantidade, modelo, malha, estampa, logística ou prazo
   torna o orçamento atual impróprio para nova comunicação e exige revisão
   humana e nova versão aprovada.
6. **PRC-06:** pedido de desconto, condição diferente ou contraproposta gera
   handoff para um Vendedor com motivo, resumo e responsável definidos.
7. **PRC-07:** comunicação e alteração do orçamento registram versão, autor,
   origem, valor, condição, validade, timestamp e identificador da mensagem,
   preservando auditoria e reversão.

Precificação automática por tabela ou política comercial permanece fora do
MVP e só pode entrar em P2 mediante política aprovada e tecnicamente
consultável.

## P0.3 resolvido — limite financeiro comercial

O financeiro do MVP mede somente **valor vendido**. O estado do pagamento
continua registrado no negócio para operar o subfluxo PIX, liberar a Ficha e
preservar auditoria, mas não alimenta indicadores agregados de valor recebido
ou saldo a receber.

Uma venda entra nos indicadores quando o cliente aceita o orçamento humano
aprovado, versionado e vigente e o negócio passa para
`aprovado_aguardando_pix`. O estado terminal `Fechado` continua ocorrendo
somente depois da confirmação humana do pagamento, geração da Ficha e registro
do onboarding; essa passagem não reconhece a mesma venda uma segunda vez.

Critérios da decisão:

1. **FIN-P03-01:** a entrada em `aprovado_aguardando_pix` registra exatamente
   uma venda com valor final, data da aprovação comercial, vendedor responsável
   e versão do orçamento aceita.
2. **FIN-P03-02:** os indicadores do período exibem total vendido ativo,
   quantidade de vendas e ticket médio, usando a data da aprovação comercial e
   o vendedor responsável naquele momento.
3. **FIN-P03-03:** uma venda perdida antes da aprovação comercial nunca entra
   nos indicadores de vendido.
4. **FIN-P03-04:** cancelamento retira valor, quantidade e efeito no ticket dos
   totais ativos, sem apagar a venda, sua aprovação ou o motivo do cancelamento;
   cancelamentos permanecem consultáveis separadamente.
5. **FIN-P03-05:** confirmação, rejeição ou exceção de pagamento altera o estado
   operacional do negócio e mantém autor, horário e origem, mas não cria métrica
   agregada de recebido ou saldo a receber no MVP.
6. **FIN-P03-06:** a passagem posterior para `Fechado` não altera data, vendedor
   ou valor reconhecidos na aprovação comercial e não duplica a venda.
7. **FIN-P03-07:** valores recebidos, saldo a receber, pagamentos parciais,
   parcelamento, conciliação bancária e estornos financeiros ficam fora do MVP
   e só podem entrar em P2 mediante novo contrato de eventos e relatórios.

## P0.4 resolvido — canais e limite operacional da IA

O primeiro piloto opera mensagens bidirecionais pela API oficial do
**WhatsApp Business** e pela integração oficial do **Instagram Direct**. O site
é somente uma visão de aquisição: seu CTA abre o WhatsApp Business e não cria
um terceiro canal de atendimento no CRM. WhatsApp e Instagram possuem o mesmo
objetivo e comportamento funcional: conduzir a conversa até concluir o fluxo
permitido com o cliente, respeitando o mesmo sandbox da IA e os mesmos gates
humanos.

Mensagens dos dois canais entram na mesma Caixa de Entrada, preservando
`canal`, `identificador_externo`, remetente, timestamp, conteúdo, anexos e
estado de processamento. A identidade do Instagram permanece vinculada ao seu
identificador externo. Enquanto não houver telefone, o contato é exibido pelo
`@usuario` do Instagram com a sinalização `Telefone pendente`. A identidade só
pode ser associada ao mesmo Contato do WhatsApp por um handoff rastreável,
telefone confirmado ou vinculação humana auditável; nome de exibição ou
similaridade textual nunca bastam para uma fusão automática.

Como clientes do Instagram frequentemente preferem continuar no WhatsApp, a
conversa pode oferecer essa opção sem interromper o fluxo. O redirecionamento
usa um `handoff_id` correlacionável e registra origem, identidade do Instagram e
destino. Se a primeira mensagem no WhatsApp não trouxer correlação verificável,
o CRM mantém as identidades separadas e sinaliza a pendência para revisão
humana, sem perder o histórico do Instagram.

O Vendedor Silmer trabalha em um **sandbox de mensagens**. Ele pode ler o
contexto autorizado, responder no canal e produzir uma sugestão não vinculante
da etapa da jornada, por exemplo `Colocar este lead em Especificação?`. A
sugestão não cria lead, não altera campo oficial, não muda coluna e não executa
ferramentas de mutação do domínio. Somente uma pessoa com função
**Atendimento** ou **Vendedor** transforma a conversa em lead e move o card,
por arraste ou por ação acessível equivalente.

Atendimento e Vendedor podem responder pela Caixa de Entrada e assumir a
conversa a qualquer momento. A tomada humana suspende imediatamente novas
respostas da IA naquela conversa; a automação só volta após reativação humana
explícita. Mensagens humanas e da IA permanecem identificadas e auditáveis.

Essa decisão substitui as premissas anteriores de que o Vendedor Silmer
converteria conversas em leads ou moveria cards autonomamente. A IA continua
podendo comunicar um orçamento somente nos limites do P0.2, sem calcular,
negociar ou aprovar preço.

Critérios da decisão:

1. **CHN-P04-01:** WhatsApp Business e Instagram Direct recebem e enviam
   mensagens no piloto por integrações oficiais e permitem concluir o mesmo
   fluxo com o cliente, com saúde, erro e reconciliação observáveis por canal.
2. **CHN-P04-02:** o site não possui chat próprio; seu CTA abre o WhatsApp
   Business e pode registrar a origem `site` sem criar outro canal de conversa.
3. **CHN-P04-03:** toda mensagem conhecida aparece na Caixa de Entrada ou na
   fila de reconciliação com canal e identificador externo preservados.
4. **CHN-P04-04:** enquanto não houver telefone confirmado, o contato do
   Instagram aparece como `@usuario` com a sinalização `Telefone pendente` e não
   é fundido por nome ou similaridade textual.
5. **CHN-P04-05:** Atendimento e Vendedor podem responder e assumir qualquer
   conversa; a tomada humana bloqueia novos envios da IA até reativação humana
   explícita.
6. **CHN-P04-06:** a IA só envia mensagens e sugestões não vinculantes; não
   converte conversa em lead, não move card e não altera estado ou campo
   oficial da jornada.
7. **CHN-P04-07:** a sugestão de etapa é produzida no mesmo processamento da
   mensagem, sem agente autônomo, loop adicional ou chamada de ferramenta, para
   limitar o custo de IA aos tokens das mensagens.
8. **CHN-P04-08:** cada sugestão identifica a etapa proposta e aparece como
   pergunta acionável, sem se confundir visual ou semanticamente com o estado
   real do card.
9. **CHN-P04-09:** somente uma pessoa confirma a sugestão e move o card, por
   drag-and-drop ou por controle equivalente operável por teclado.
10. **CHN-P04-10:** mensagens, tomada humana, reativação e descarte ou aceite da
    sugestão registram autor, canal, horário e origem, sem envio ou transição
    duplicados.
11. **CHN-P04-11:** a conversa do Instagram pode oferecer continuidade no
    WhatsApp e gera um `handoff_id` que registra origem, identidade externa e
    destino sem exigir nova análise da IA.
12. **CHN-P04-12:** uma conversa iniciada no WhatsApp pelo handoff é vinculada
    ao contato existente somente quando o `handoff_id`, o telefone confirmado
    ou uma decisão humana auditável comprova a identidade; sem isso, o CRM
    preserva os dois históricos separados e marca a pendência.

## Gate recomendado

O Tech Lead pode começar com descoberta, alternativas e spikes reversíveis. A
máquina de estados, o modelo de completude, o contrato de comunicação de preço
e o limite do financeiro comercial já podem ser fechados com base no P0.1 ao
P0.4. A especificação técnica completa só recebe status `Aprovada` quando os
três P0 restantes estiverem resolvidos e as regras de canal, sandbox da IA,
handoff e sugestão de etapa estiverem refletidas no PRD e nos critérios de
aceite.

Não iniciar implementação de produção nem publicar estimativa fechada antes desse gate. Protótipos descartáveis de integração e validação da API oficial são permitidos, desde que não congelem o modelo de domínio.

## Workshop de fechamento

Participantes: Product Manager, responsável operacional da Silmer, pessoa que preenche a Ficha e Tech Lead.

Agenda:

1. Validar apenas dúvidas operacionais de `FAB` e numeração ainda cobertas pelo
   P0.5; o mapa campo a campo já está concluído.
2. Fechar permissões e privacidade do piloto.

Saída: P0.5–P0.7 resolvidos, PRD atualizado e autorização para o Tech Lead
finalizar design e tarefas.

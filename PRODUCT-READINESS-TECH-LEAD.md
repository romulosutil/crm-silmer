# Passagem de Produto para Tech Lead

**Data:** 29/08/2026  
**Parecer:** GO integral para o Tech Lead. P0.1 a P0.7 estão resolvidos e
propagados para o PRD, contexto, requisitos, regras e design.

## O que o Tech Lead já pode especificar

- Contexto e limites do sistema.
- Separação entre backlog de conversas e Kanban de leads.
- Contratos de integração com as APIs oficiais do WhatsApp Business e do
  Instagram Direct; o site apenas inicia contato no WhatsApp.
- Modelo em sandbox do Vendedor Silmer, limitado a mensagens, sugestão de etapa
  e handoff, sem alterar o estado comercial.
- Necessidades de idempotência, auditoria, reconciliação e reversão.
- Modelo inicial das entidades Conversa, Contato, Lead, Card, Pedido e Evento financeiro.
- Contrato de identidade da Ficha, incluindo `FAB`, sequência, reserva e
  comportamento sob concorrência.
- Política de retenção e exclusão por classe de dado, incluindo backups, logs,
  operadores e atendimento aos direitos do titular.
- Modelo de autorização da Ficha, com função operacional, role `Admin`, estados,
  versionamento, cancelamento, retry, reenvio e trilha de auditoria.
- Opções de backend, banco, hospedagem, runtime de IA e geração documental.
- Riscos, spikes técnicos e plano de prova de conceito.

## Decisões P0 para aprovação final e estimativa fechada

| P0 | Decisão necessária | Status | Impacto técnico/evidência |
|---|---|---|---|
| 1 | Etapas definitivas e campos obrigatórios de cada passagem | **Resolvido** | Contrato aprovado em `CAMPOS-FICHA-E-JORNADA-P0-1.md` |
| 2 | Autoridade do Vendedor Silmer sobre preço após qualificação | **Resolvido** | Comunica somente orçamento humano aprovado, versionado e vigente; não calcula nem negocia |
| 3 | Financeiro cobre vendido ou também recebido/a receber | **Resolvido** | MVP mede vendido; recebido e saldo a receber ficam em P2 |
| 4 | Canais do primeiro piloto além do WhatsApp | **Resolvido** | WhatsApp Business é obrigatório; Instagram Direct entra sem bloquear o lançamento; site apenas direciona ao WhatsApp; IA não move o Kanban no MVP |
| 5 | Significado de FAB, sequência vigente e numeração | **Resolvido** | Contrato aprovado na seção P0.5 deste documento |
| 6 | Regras concretas de retenção e exclusão | **Resolvido** | Contrato aprovado na seção P0.6 deste documento |
| 7 | Permissões para revisar, editar, cancelar e reenviar Ficha | **Resolvido** | Funções Atendimento/Vendedor com role adicional `Admin`; contrato aprovado na seção P0.7 |

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
comunicação fiel de um orçamento aprovado por uma pessoa com role **Admin**. A
role `Admin` é uma autorização comercial adicional e pode ser atribuída tanto
a uma pessoa com função **Atendimento** quanto a uma pessoa com função
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
3. **PRC-03:** somente uma pessoa com role **Admin** aprova a versão que
   autoriza a comunicação do preço, independentemente de sua função operacional
   ser Atendimento ou Vendedor.
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

O primeiro piloto opera obrigatoriamente mensagens bidirecionais pela API
oficial do **WhatsApp Business**. A integração oficial do **Instagram Direct**
também pertence ao piloto, mas é não bloqueante: atraso de aprovação,
credenciais ou integração do Instagram não impede o lançamento pelo WhatsApp.
O site é somente uma visão de aquisição: seu CTA abre o WhatsApp Business e
não cria um terceiro canal de atendimento no CRM. WhatsApp e Instagram possuem
o mesmo comportamento funcional quando o segundo canal estiver ativo,
respeitando o mesmo sandbox da IA e os mesmos gates humanos.

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

Depois do MVP, o CRM poderá oferecer a chave
`vendedor_silmer_autonomia_comercial`, desativada por padrão. Quando existir e
for ativada por `Admin`, ela poderá autorizar o agente a transformar conversas
em lead, preencher campos oficiais e avançar etapas dentro de uma matriz de
permissões explícita. Essa capacidade é P2: não integra o aceite, a estimativa
nem a implementação do MVP. A ativação futura exige auditoria, rollback,
limites de ação e desligamento imediato sem perda de estado.

Critérios da decisão:

1. **CHN-P04-01:** WhatsApp Business recebe e envia mensagens no lançamento por
   integração oficial; Instagram Direct, quando disponível no piloto, conclui
   o mesmo fluxo, com saúde, erro e reconciliação observáveis por canal, sem
   bloquear o go-live do WhatsApp.
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
13. **CHN-P04-13:** a autonomia comercial futura permanece ausente ou
    desativada no MVP; nenhuma configuração de produção pode habilitá-la sem
    novo aceite P2.
14. **CHN-P04-14:** uma implementação P2 da chave de autonomia registra quem
    ativou, quando, escopo, ações do agente e rollback e permite desligamento
    imediato sem corromper conversa, lead ou card.

## P0.5 resolvido — identidade, FAB e numeração da Ficha

`FAB` é o código controlado da **unidade fabril responsável pelo pedido**. No
primeiro piloto, o domínio autorizado contém somente o código `01`, exibido na
Ficha como `FAB 01`. O valor vem de configuração operacional, não aceita texto
livre e precisa estar definido antes da aprovação da Ficha. A inclusão de outra
unidade exige ampliar explicitamente esse domínio, sem criar uma nova sequência
de pedidos.

O CRM inicia um namespace próprio de pedidos, sem continuidade ou dependência
de número legado. O primeiro identificador é **`01-CRM`** e os seguintes usam o
contador global crescente com sufixo fixo `-CRM`: `02-CRM`, `03-CRM` e assim
por diante. A largura mínima é de dois dígitos, sem limite artificial: após
`99-CRM`, o próximo é `100-CRM`. O contador não reinicia por ano, `FAB`, canal
ou vendedor.

Depois da ativação do CRM, ele é a única autoridade de alocação. Não pode haver
emissão manual paralela fora desse contrato. O número é reservado de forma
atômica na primeira aprovação autorizada da Ficha, após a confirmação humana do
pagamento. Rascunhos não consomem número e aprovações concorrentes nunca podem
receber o mesmo valor.

Uma vez reservado, o número identifica o Pedido de forma imutável. Revisões e
correções mantêm o mesmo número e incrementam a versão da Ficha; geração
documental, retry e reenvio preservam a versão vigente. Retry reutiliza a
reserva existente. Cancelamento, falha após a reserva ou invalidação não
devolvem o número à sequência; o evento permanece auditável e um pedido
comercial realmente novo recebe outro número. A sequência pode, portanto,
conter lacunas justificadas, mas nunca duplicidade ou reutilização.

Critérios da decisão:

1. **ORD-P05-01:** toda Ficha aprovada no piloto registra `pedido.fab = 01`,
   obtido do domínio controlado de unidades fabris e nunca de texto livre.
2. **ORD-P05-02:** a sequência de `pedido.numero` começa em `01-CRM`, é global,
   usa sufixo fixo `-CRM` e não reinicia nem se divide por ano, `FAB`, canal ou
   vendedor.
3. **ORD-P05-03:** não existe importação, consulta ou dependência de último
   número legado; o namespace `-CRM` separa os novos pedidos.
4. **ORD-P05-04:** desde o primeiro pedido, somente o CRM aloca identificadores
   desse namespace.
5. **ORD-P05-05:** a primeira aprovação autorizada da Ficha, após confirmação
   humana do pagamento, reserva um único número em operação atômica.
6. **ORD-P05-06:** duas aprovações concorrentes recebem números distintos e a
   restrição de unicidade impede colisão independentemente de retry.
7. **ORD-P05-07:** nova tentativa, nova versão, correção ou reenvio da mesma
   Ficha preserva o número já associado ao Pedido.
8. **ORD-P05-08:** número reservado nunca é reutilizado; cancelamento ou falha
   posterior preserva número, estado, motivo, autor e horário.
9. **ORD-P05-09:** toda reserva registra Pedido, número, `FAB`, autor, horário,
   origem e chave de idempotência para auditoria e reconciliação.

## P0.6 resolvido — retenção, exclusão e responsáveis de privacidade

O piloto adota retenção por finalidade e classe de dado. O prazo começa no
evento que encerra a finalidade operacional correspondente, e não na criação
do registro. Dados cujo prazo terminou são excluídos ou anonimizados, salvo
quando uma obrigação legal ou um `legal_hold` ativo exigir a conservação do
subconjunto mínimo necessário.

Matriz aprovada:

| Classe de dado | Gatilho | Prazo máximo | Destino |
|---|---|---|---|
| Conversa encerrada como `Sem lead` | Encerramento da conversa | 90 dias | Exclusão dos dados pessoais e do conteúdo |
| Negócio marcado como `Perdido` | Registro da perda | 12 meses | Exclusão dos dados identificáveis; métricas somente anonimizadas |
| Mensagens e anexos não documentais de venda fechada | Fechamento ou cancelamento | 24 meses | Exclusão do conteúdo e das cópias internas |
| Pedido, Ficha, orçamento aprovado, eventos comerciais e comprovante PIX | Fechamento ou cancelamento | 5 anos | Exclusão ao final do prazo, salvo `legal_hold` |
| Payload de webhook processado com sucesso | Processamento confirmado | 30 dias | Exclusão do payload bruto |
| Payload com erro e item de reconciliação | Resolução da pendência | 90 dias | Exclusão do payload bruto e do diagnóstico pessoal |
| Log técnico | Emissão do evento | 90 dias | Exclusão; o log não contém mensagem integral |
| Requisição e resposta técnica do provedor de IA | Processamento da mensagem | 30 dias | Exclusão no CRM e no operador; uso para treinamento é proibido |
| Backup | Criação do backup | 35 dias | Expiração por rotação automática |

A exclusão alcança banco primário, anexos, caches, busca, índices vetoriais e
demais cópias controladas pelo CRM. Os indicadores agregados podem permanecer
somente quando a anonimização for irreversível e impedir a associação a uma
pessoa. O registro de auditoria da solicitação conserva apenas protocolo,
identificador pseudonimizado, decisão, fundamento, responsável e timestamps;
ele nunca preserva uma cópia do conteúdo eliminado.

Backups não são editados individualmente. Uma exclusão concluída no ambiente
ativo entra em um registro de tombstones até todos os backups relacionados
expirarem em no máximo 35 dias. Se um backup for restaurado, os tombstones são
reaplicados antes que o ambiente volte a operar, impedindo a reintrodução de
dados já eliminados.

Um `legal_hold` bloqueia o descarte somente quando registra fundamento,
escopo mínimo, responsável, início e data de revisão. O conteúdo preservado
fica isolado do uso comercial, da IA e dos acessos operacionais comuns. O fim
do impedimento retoma imediatamente a contagem ou a exclusão vencida.

A **Silmer** é a controladora dos dados. Provedores de canal, infraestrutura,
armazenamento e IA são operadores ou suboperadores e devem receber instruções
compatíveis com esta política. O **Responsável de Privacidade** valida pedidos
de titulares, autoriza exceções e decide o `legal_hold`; o **Administrador
Técnico** executa e comprova exclusões. Atendimento e Vendedor não podem
realizar exclusão irreversível. Uma pessoa deve ser formalmente designada para
cada papel antes do piloto.

O Responsável de Privacidade designado é **Rômulo Sutil Corrêa**. A política e
os prazos desta seção foram validados com a assessoria jurídica consultada pela
Silmer. O Tech Lead responde por traduzir o contrato aprovado em arquitetura,
controles, testes e operação e por designar o Administrador Técnico executor
antes do piloto; isso não reabre decisão de produto.

O titular dispõe de canal eletrônico publicado para solicitar confirmação,
acesso, correção, exportação, bloqueio ou exclusão. A solicitação exige
verificação proporcional de identidade, é gratuita, recebe protocolo e tem
meta interna de conclusão em até 15 dias corridos. Impossibilidade ou recusa
registra a razão de fato ou de direito e informa o que foi preservado.

O CRM propaga correção, bloqueio ou exclusão aos operadores quando aplicável e
registra o resultado por destino. Cópias já entregues no WhatsApp, Instagram ou
dispositivo da destinatária da Ficha não estão sob controle técnico do CRM;
essa limitação aparece no aviso de privacidade e aciona procedimento
operacional quando houver pedido do titular.

Critérios da decisão:

1. **PRV-P06-01:** cada classe de dado possui gatilho, prazo e destino
   configuráveis segundo a matriz aprovada, sem prazo indefinido implícito.
2. **PRV-P06-02:** conversa `Sem lead`, negócio `Perdido` e venda fechada
   iniciam seus prazos pelos respectivos eventos de encerramento, perda,
   fechamento ou cancelamento.
3. **PRV-P06-03:** a rotina de retenção exclui dados pessoais do banco,
   anexos, caches, busca e índices vetoriais e preserva somente métricas
   irreversivelmente anonimizadas.
4. **PRV-P06-04:** `legal_hold` só impede a exclusão com fundamento, escopo
   mínimo, responsável e data de revisão auditáveis e bloqueia uso comercial e
   processamento pela IA.
5. **PRV-P06-05:** payloads brutos processados expiram em 30 dias; payloads com
   erro expiram em 90 dias após a resolução e não permanecem ocultos em filas.
6. **PRV-P06-06:** logs técnicos expiram em 90 dias e não registram conteúdo
   integral de mensagens, anexos, comprovantes ou segredos.
7. **PRV-P06-07:** requisições e respostas técnicas da IA expiram em até 30
   dias e nenhum provedor pode usá-las para treinamento de modelo.
8. **PRV-P06-08:** backups expiram em até 35 dias e uma restauração reaplica as
   exclusões registradas antes da liberação do ambiente.
9. **PRV-P06-09:** o canal do titular emite protocolo, verifica identidade e
   conclui ou justifica a solicitação em até 15 dias corridos, sem custo.
10. **PRV-P06-10:** toda solicitação registra decisão, fundamento, executor,
    destinos envolvidos e timestamps sem reter o conteúdo eliminado.
11. **PRV-P06-11:** correção, bloqueio ou exclusão é propagada aos operadores e
    registra sucesso, falha ou limitação por destino para reconciliação.
12. **PRV-P06-12:** antes do piloto existem pessoas formalmente designadas como
    Responsável de Privacidade e Administrador Técnico, com segregação entre
    autorização e execução da exclusão.

## P0.7 resolvido — permissões e auditoria da Ficha

O acesso humano possui duas camadas independentes. Cada pessoa exerce uma
função operacional, **Atendimento** ou **Vendedor**, e pode receber
adicionalmente a role **Admin**. Atendimento atende conversas e mantém os dados
do rascunho; Vendedor conduz negociação e informa propostas. A role `Admin` é
o que autoriza aprovar a venda, aprovar a Ficha e executar qualquer envio para
Rose. Assim, a autorização privilegiada não depende do nome da função
operacional e pode ser atribuída a uma pessoa de Atendimento ou de Vendas.

A role `Admin` deste contrato é comercial e não se confunde com o
**Administrador Técnico** do P0.6, responsável por executar e comprovar
exclusões. Ninguém recebe `Admin` implicitamente por ser Vendedor, não pode
atribuir a role a si próprio e toda concessão ou revogação registra autor,
destinatário, motivo e horário. O primeiro `Admin` do piloto é provisionado por
uma pessoa autorizada pela Silmer durante a configuração inicial; depois disso,
somente outro `Admin` pode conceder ou revogar a role.

Matriz aprovada:

| Ação | Atendimento | Vendedor | Atendimento ou Vendedor com `Admin` | Vendedor Silmer |
|---|---:|---:|---:|---:|
| Consultar e revisar rascunho | Sim | Sim | Sim | Não |
| Editar rascunho | Sim | Sim | Sim | Não |
| Aprovar orçamento e venda | Não | Não | Sim | Não |
| Aprovar a Ficha | Não | Não | Sim | Não |
| Cancelar a Ficha | Não | Não | Sim | Não |
| Enviar a Ficha para Rose | Não | Não | Sim | Não |
| Repetir envio falho | Não | Não | Sim | Não |
| Reenviar após envio confirmado | Não | Não | Sim | Não |

O ciclo de vida da Ficha usa os estados `rascunho`, `em_revisao`, `aprovada`,
`envio_pendente`, `enviada`, `falha_envio`, `cancelada` e `substituida`.
Atendimento e Vendedor podem mover um rascunho para revisão e devolvê-lo para
edição, mas apenas uma pessoa com `Admin` conclui a aprovação. A primeira
aprovação autorizada após a confirmação humana do pagamento reserva o número
nos termos do P0.5 e libera o envio.

Uma versão aprovada é imutável. Qualquer correção posterior cria nova versão em
`rascunho`, preserva número, conteúdo e auditoria da anterior e exige nova
aprovação por `Admin`. Quando a nova versão é aprovada, a anterior recebe o
estado `substituida`; nenhuma correção dispara envio automático.

Somente uma pessoa com `Admin` cancela uma Ficha, sempre com motivo e
confirmação explícita da consequência. O cancelamento bloqueia novos envios,
mas não apaga nem reutiliza número, versão, documento ou histórico. Se a Ficha
já tiver sido enviada, o CRM também gera uma notificação auditável de
cancelamento para Rose e torna falha ou confirmação desse aviso visível.

Retry de uma falha reutiliza Pedido, número, versão e chave de idempotência e
não cria novo documento ou envio lógico. Reenvio depois de uma entrega
confirmada é uma ação intencional distinta, restrita a `Admin`, exige motivo e
confirmação e envia a mesma versão imutável sem reservar outro número. A
aprovação, o envio inicial, cada tentativa, a entrega, o cancelamento e o
reenvio registram pessoa, função operacional, presença da role `Admin`, motivo,
versão, horário, destinatário e identificador do canal.

Critérios da decisão:

1. **ACL-P07-01:** toda pessoa humana possui função Atendimento ou Vendedor e
   pode receber separadamente a role `Admin`, sem promoção implícita pela
   função operacional.
2. **ACL-P07-02:** Atendimento e Vendedor sem `Admin` consultam, revisam e
   editam somente rascunhos; não aprovam venda ou Ficha e não enviam, cancelam,
   repetem nem reenviam para Rose.
3. **ACL-P07-03:** somente uma pessoa com `Admin` aprova orçamento, venda e
   Ficha e executa envio, cancelamento, retry ou reenvio para Rose.
4. **ACL-P07-04:** o Vendedor Silmer não revisa, edita, aprova, cancela nem
   envia a Ficha e não recebe `Admin`.
5. **ACL-P07-05:** concessão ou revogação de `Admin` exige outro `Admin`, salvo
   o provisionamento inicial autorizado pela Silmer, e registra autor,
   destinatário, motivo e horário sem permitir autoatribuição.
6. **ACL-P07-06:** a interface e a API aplicam os mesmos estados e permissões,
   sem depender apenas da ocultação de botões no frontend.
7. **ACL-P07-07:** editar uma Ficha aprovada cria nova versão em `rascunho`,
   preserva a anterior e exige nova aprovação sem reservar outro número.
8. **ACL-P07-08:** cancelamento exige `Admin`, motivo e confirmação, bloqueia
   novos envios e preserva número, documento, autorizações e histórico.
9. **ACL-P07-09:** cancelamento posterior ao envio cria aviso auditável para
   Rose e exibe confirmação ou falha desse aviso para reconciliação.
10. **ACL-P07-10:** retry de falha reutiliza Pedido, número, versão e chave de
    idempotência; reenvio após sucesso exige `Admin`, motivo e confirmação e
    não cria nova Ficha.
11. **ACL-P07-11:** aprovação e cada tentativa de envio registram pessoa,
    função, role, motivo, versão, horário, destinatário e identificador do
    canal, sem duplicidade sob concorrência.
12. **ACL-P07-12:** revogar `Admin` bloqueia imediatamente novas ações
    privilegiadas sem alterar a autoria histórica das ações já concluídas.

## Gate recomendado

Os P0.1 a P0.7 estão resolvidos e sincronizados. O caminho está integralmente
nas mãos do Tech Lead para finalizar máquina de estados, autorização, modelo de
dados, integrações, riscos, design, tarefas, estimativa e implementação. Dados
operacionais de ambiente e a nomeação do executor técnico são atividades de
lançamento, não bloqueadores de produto.

## Registro de fechamento

Participantes: Product Manager, responsável operacional da Silmer, pessoa que preenche a Ficha e Tech Lead.

Decisão aprovada:

1. Atendimento e Vendedor são funções operacionais; `Admin` é uma role
   comercial adicional atribuível a qualquer uma delas.
2. Somente `Admin` aprova venda e Ficha e executa qualquer envio para Rose.
3. O ciclo de vida, versionamento, cancelamento, retry, reenvio e auditoria
   seguem o contrato P0.7 deste documento.

Saída: P0 completo, política de privacidade aprovada, responsável designado e
autorização para o Tech Lead conduzir design, tarefas, estimativa e implementação.

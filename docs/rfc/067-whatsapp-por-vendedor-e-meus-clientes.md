# RFC 067 — WhatsApp por vendedor e Meus clientes

Data: 12/11/2026. Status: **proposta em revisão**. Responsável: Tech Lead.
Solicitante e aprovador de produto: proprietário do CRM Silmer. Revisão técnica:
Backend/Dados, Integrações, Frontend/A11y e QA/Privacidade/Operação conforme a
fatia. Requisitos propostos [WAP-01–24](../../.specs/features/seller-whatsapp/spec.md);
entrega documental WAP-T00 e [plano WAP-T01–07](../../.specs/features/seller-whatsapp/tasks.md).
Sem issue específica; PR desta entrega vinculada no handoff.

O proprietário pediu uma RFC e configuração pessoal para conectar os celulares
de trabalho sem depender da equipe técnica a cada vendedor. As duas etapas
abaixo tratam exclusivamente de WhatsApp. Instagram não integra esta proposta.
A elaboração foi autorizada; recomendações de produto e exceções às regras
vigentes ainda precisam de aceite e ADR correspondente. Não há implementação,
pareamento, mudança de workflow ou ativação de produção nesta entrega.
Revisão de 13/11/2026: o proprietário esclareceu que o cliente deve ser a
mesma entidade Cliente do CRM e pediu regras explícitas de cadastro, vínculos
e primeira mensagem. WAP-T00b detalha essa proposta; D1–D5 seguem em revisão.

## Problema e resultado esperado

Cada vendedor atende sua carteira por um celular de trabalho. O CRM precisa
reconhecer a linha que recebeu a mensagem, mostrar seus clientes e responder
pelo mesmo número. A pessoa deve conectar e reconectar seu aparelho no CRM,
sem receber credencial técnica, acessar Evolution Manager ou chamar suporte.

Esclarecimento do proprietário em 12/11/2026: **Meus clientes é uma entrada
para a operação comercial completa do CRM**. O vendedor continua salvando
contatos, criando e acompanhando pedidos, fazendo cobranças e usando as demais
ações existentes conforme as permissões e regras de cada domínio. Essa
paridade integra a etapa 1; não fica adiada para importação de histórico.

**Sim, Meus clientes pode abrir a configuração e mostrar o QR code.** Essa
configuração é dispensável/fechável e não bloqueia carteira ou cadastro. O QR é
gerado pela Evolution e exibido por uma API autenticada do CRM. O navegador
nunca fala diretamente com o gateway. Depois de conectado, abrir a aba mostra
a carteira, sem pedir novo QR a cada acesso.

## Evidência e baseline atual

O grafo de `graphify-out/GRAPH_REPORT.md`, de 04/10/2026, serviu somente à
descoberta. Os achados foram confirmados nos arquivos atuais com `rg`:

- `ops/n8n/workflows/create-evolution-workflow.mjs`: valida uma combinação
  configurada de instância e número; consultas e envios usam a mesma sessão
  fixa. O filtro de inbound descarta `messages.upsert` com `fromMe=true`.
- `modules/n8n-integration/src/service.js` e `postgres-repository.js`: já
  carregam `provider_account_id`; identidade e conversa são resolvidas no
  escopo da conta, permitindo distinguir o mesmo cliente em linhas diferentes.
- `modules/contacts/src/adapters/postgres-contact-read-repository.js` e
  `apps/api/src/operation-runtime.js`: a listagem geral de Contatos não é uma
  carteira vinculada à linha do vendedor.
- [ADR 088](../adr/088-leitura-de-conversas-por-responsavel.md),
  [RFC 066](066-visibilidade-de-conversas-por-responsavel.md) e CONV-ACL-01:
  Admin lê todas; vendedor lê próprias e sem responsável. A linha privada
  não pode ficar sem dono e aparecer por esse caminho na fila compartilhada.
- [ADR 050](../adr/050-evolution-baileys-como-ponte-do-whatsapp.md): gateway
  privado, banco exclusivo de transporte, sem Redis; domínio no CRM e n8n
  obrigatório. Não é necessário um novo serviço por vendedor; capacidade
  simultânea e isolamento devem ser medidos antes do piloto.

Fontes upstream consultadas em 12/11/2026, fixadas na tag 2.3.7 usada como
referência pelo adapter existente:

- [InstanceRouter](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/routes/instance.router.ts):
  operações de criar, conectar, consultar estado e encerrar sessão.
- [InstanceController](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/controllers/instance.controller.ts):
  retorno de QR e estado por instância.
- [Baileys service](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts):
  QR, código de pareamento e identidade da conta conectada. Logs upstream podem
  conter QR, código e número; o perfil privado deve impedir essa exposição.

Essas capacidades sustentam a viabilidade, não comprovam o comportamento da
imagem implantada, a disponibilidade da conta nem importação integral da agenda.

## Duas etapas, ambas de telefones

| Etapa                                    | Entrega                                                                                                                                                                       | Gate de conclusão                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Conexão pessoal e operação comercial | Configuração pessoal, QR/reconexão, carteira por linha e operação CRM completa: contatos, pedidos, cobranças e mensagens pelo CRM/aparelho, com isolamento e falhas visíveis. | Vendedor conecta sem suporte e completa contato → pedido → cobrança nas duas linhas do piloto, sem acesso cruzado ou envio pelo número errado. |
| 2 — Carteira anterior e continuidade     | Descoberta/importação controlada de contatos e histórico disponível; troca de número e transferência administrativa da linha/carteira.                                        | Prévia, limites reais do provedor, deduplicação, retomada e revogação demonstrados sem disparar atendimento retroativo.                        |

A etapa 1 não promete que todos os clientes antigos apareçam ao escanear o QR.
Na etapa 2, contato sem conversa pode ser importado como cadastro, nunca como
mensagem recebida, pedido ou oportunidade presumida. Grupo, status, broadcast,
newsletter e contatos pessoais sem pertinência comercial ficam excluídos.

## Operação comercial completa desde a etapa 1

Ao abrir um cliente da carteira, reutilizar o atendimento e os módulos atuais,
com o mesmo contexto de Contato, Conversa, Assunto e Pedido e as respectivas
capacidades. A linha pessoal define a origem e o remetente; não substitui as
autorizações de cadastro, edição comercial, confirmação ou cobrança.

| Ação                      | Comportamento esperado em Meus clientes                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Salvar e editar contato   | Usar o cadastro oficial do CRM, incluindo dados comerciais e vínculo com a própria carteira. Permitir cadastro humano antes de existir conversa; não fabricar identidade de canal, mensagem recebida ou pareamento pelo ato de salvar.              |
| Criar e acompanhar pedido | Criar por ação humana, inclusive sem sugestão da IA, usando os fluxos vigentes de pedido associado ao atendimento ou pedido manual. Preservar edição, confirmação, ficha/PDF, arquivos e demais ações comerciais elegíveis com suas guardas atuais. |
| Fazer cobrança            | Reutilizar configuração, emissão e acompanhamento de cobranças, recebimentos e saldo já existentes. Criação da cobrança, envio do link e confirmação de pagamento continuam efeitos separados, autorizados e idempotentes.                          |
| Enviar ao cliente         | Mensagens, arquivos, ficha e link de cobrança usam a conversa/destino escolhido e sua linha de origem. Não trocar cliente, Pedido ou número ao navegar pela carteira; não enviar automaticamente ao criar cadastro, pedido ou cobrança.             |

A exigência de emissão em Pedido confirmado, os limites de saldo/acordo e os
demais gates de cobrança continuam no [contrato COB/BAPI](../../.specs/features/order-billing/spec.md).
A abertura humana mantém [OA-01–08](../../.specs/features/order-assistance/spec.md);
o modo humano proposto para a linha pessoal não remove essas ações. Reutilizar
as APIs e componentes existentes, sem cadastro, pedido ou cobrança paralelos
por instância Evolution. Parear o celular não concede capacidade comercial
extra nem habilita integrações ainda não liberadas no ambiente.

Contato salvo manualmente fica vinculado à carteira do vendedor/linha com
proveniência humana, inclusive antes da primeira inbound; o telefone informado
não é prova de identidade do canal. Identidades posteriores seguem correlação
verificável e escolha de duplicata já existentes. Um cadastro global anterior
não é copiado nem fundido silenciosamente para contornar autorização.

WhatsApp desconectado bloqueia o envio pelo canal. Consulta e mutações locais
autorizadas, como salvar contato ou criar/editar pedido, continuam disponíveis;
emissão e confirmação de cobrança dependem da integração de pagamento própria,
sem exigir pareamento WhatsApp. Não suspender callbacks financeiros, conciliação
ou registro de recebimento por desconexão/rollback da linha. Uma cobrança já
criada é preservada; o envio posterior exige nova validação do mesmo link,
cliente, Pedido, destino e linha, sem emitir cobrança duplicada para reconectar.

## Cliente oficial, carteira e primeira conversa — revisão de 13/11/2026

**Cliente é o `Contact` já existente no CRM.** Meus clientes é uma visão
desse cadastro, com vínculos e permissões comerciais; não cria um cadastro
paralelo de cliente do WhatsApp ou uma cópia por vendedor. Cadastro, vínculo
com a carteira e identidade/conversa de canal são registros diferentes:

| Conceito                     | Fonte e regra                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente                      | `Contact`, com o mesmo `contactId`, nome, telefone, cadastro e serviços comerciais usados em Clientes/Pedidos. Cadastro manual exige nome e telefone normalizado; e-mail continua opcional (ADR 033).                  |
| Vínculo de carteira          | Associação explícita do `contactId` ao vendedor responsável pela carteira, com origem, estado, versão e auditoria. Não é uma cópia do Cliente e pode existir antes do pareamento ou de qualquer conversa.              |
| Linha de trabalho            | Identidade do remetente, com titular e geração próprios. Reconectar a mesma linha não recria os vínculos; trocar o número ou o titular segue a operação administrativa prevista, sem mover históricos silenciosamente. |
| Identidade/conversa WhatsApp | Associação do destinatário no escopo da conta de origem ao Cliente correto. O telefone digitado é um destino declarado, não uma identidade de canal já comprovada nem autorização para ler histórico.                  |

O vínculo de carteira é durável e independente da geração de pareamento.
Pode ser registrado para o vendedor antes de existir linha conectada; o
envio posteriormente resolve e revalida sua linha ativa. Número de telefone,
sessão do navegador, autoria antiga de um pedido ou um QR lido não substituem
esse vínculo. Não reinterpretar `manually_created_by` como posse definitiva.

### Quando um cliente aparece

| Origem                                      | Quando aparece em Meus clientes                                                                                                                            | Efeito no canal                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Novo cliente**                            | Imediatamente após salvar o Cliente oficial e o vínculo à carteira, na mesma transação. Funciona antes de uma mensagem e também com WhatsApp desconectado. | Nenhuma conversa, mensagem, identidade confirmada, pedido ou cobrança é criada pelo cadastro.  |
| **Vincular cliente existente**              | Após seleção explícita de um Cliente que o ator pode consultar e autorização do vínculo. Reutiliza o mesmo `contactId`; repetir não duplica vínculo.       | Não copia nem abre conversas de outra linha; não troca responsáveis de pedidos.                |
| Mensagem nova recebida na linha pessoal     | Após resolução da identidade pelo CRM e vínculo ao titular ativo, atomicamente com a conversa. Se o Cliente já foi resolvido, conserva seu `contactId`.    | Conversa humana da linha correta, sem janela sem dono ou início de bot.                        |
| Primeira saída pelo aparelho após a conexão | Ao receber o evento autenticado de uma mensagem que realmente saiu. Resolver destinatário/Cliente e vínculo sem fingir inbound.                            | Registrar o fato uma vez; não reenviar nem atribuir a digitação a uma pessoa física presumida. |
| Agenda e histórico anteriores do aparelho   | Somente após importação selecionada e autorizada da etapa 2, conforme os dados realmente disponíveis.                                                      | Sem importação automática ao ler o QR e sem disparos retroativos.                              |

Clientes já existentes no CRM aparecem quando há vínculo comercial vigente
comprovado ou ele é estabelecido pelo fluxo autorizado. O rollout deve
preservar vínculos comprovados numa reconciliação controlada; casos ambíguos
exigem revisão. Não adicionar a base global inteira, inferir a carteira por
telefone ou usar apenas o criador de um cadastro/pedido como prova de posse.
Encerrar conversa, desconectar ou renovar QR não remove o Cliente da carteira.

### Iniciar uma mensagem sem inbound anterior — etapa 1

**Sim: a proposta passa a incluir o vendedor iniciar a conversa do zero.**
Depois de cadastrar ou vincular o Cliente, a tela mostra **Sem conversa** e
**Iniciar conversa**. A pessoa confere o telefone cadastrado, a própria linha
remetente e escreve a primeira mensagem. Somente **Enviar primeira mensagem**
executa o comando; salvar o Cliente, abrir sua tela ou clicar para compor não
envia nem fabrica uma mensagem recebida. Essa extensão depende do aceite D5.

O servidor revalida sessão, carteira, capacidade de envio, Cliente/telefone,
linha/titular/geração e destinatário elegível no provedor. Uma consulta do
provedor confirma o destino de canal, não a identidade civil do Cliente nem
acesso a dados de terceiros. Mudança durante a composição exige releitura.
Número inválido/sem WhatsApp, bloqueio, falta de telefone no legado ou canal
indisponível mantêm o cadastro e impedem o envio com erro recuperável adequado;
nenhuma outra linha é usada. A viabilidade real deve ser provada no piloto,
sem presumir que aceitação HTTP seja entrega.

O comando novo compõe os módulos existentes. Resolve ou cria identidade de
saída para **o mesmo `contactId` selecionado**, e cria/reutiliza conversa humana
daquela conta, mensagem de saída, outbox e auditoria na fronteira transacional
autorizada. Não chama `resolveInboundIdentity` com evento inventado. Se já há
conversa ativa autorizada na mesma linha/destino, ela é reutilizada. Se a
anterior está encerrada, o comando explícito cria novo atendimento humano no
mesmo Cliente/linha e preserva a conversa anterior encerrada. Conversa de
outra linha nunca é usada como atalho.

Repetir o comando ou abrir duas abas não cria duas conversas/saídas. Se a
validação do destino falhar antes da reserva, não criar conversa ou mensagem
enviada. Após reservar, falha/timeout ficam no ledger e no estado real da saída;
resultado incerto exige reconciliação, não novo envio cego. A resposta/eco ou
primeira inbound posterior usa a identidade já vinculada, mantém o Cliente e
não duplica a mensagem, o cadastro ou a conversa ativa. Não há IA, pedido,
cobrança ou conversão comercial disparados pelo primeiro contato humano.

### Reutilização e privacidade dos vínculos

O mesmo Cliente oficial pode ter vínculos com duas carteiras quando isso é
explicitamente autorizado. Exemplo: Cliente `C-123` nas carteiras de A e B
continua sendo `C-123`; cada relação de canal tem origem, remetente e histórico
próprios. O cadastro comum segue a ACL e a versão do CRM. Notas, identidades,
atributos e conversas exclusivos de uma linha não se tornam campos globais
compartilhados por causa desse vínculo. Pedidos/cobranças mantêm a ACL própria.

Na busca/cadastro, reutilizar Cliente acessível após conferência humana de
possível duplicata. O runtime atual devolve `CONTACT_PHONE_MATCH` quando há
colisão; a nova composição deve tratar esse conflito, não criar outro Cliente
para contornar a proteção. Um telefone igual não comprova que duas pessoas ou
cadastros são a mesma entidade. Identidades já ligadas a outro `contactId` não
podem ser movidas silenciosamente para o escolhido no primeiro envio.
Aplicar a correlação verificável/auditada dos contratos atuais. Caso o possível
cadastro/vínculo não seja acessível, não retornar nome, ID ou histórico alheio;
encaminhar a conferência para administração sem expor candidatos privados.

**Vincular** inclui um Cliente autorizado em outra carteira; **transferir**
troca uma responsabilidade e exige sua operação própria. Nenhum dos dois
gestos equivale a unir Clientes, mover conversa, transferir número ou alterar
crédito comercial anterior. Na etapa 1 continua proibida a transferência
genérica de conversa pessoal para outro vendedor.

### Impacto técnico da revisão

Fontes conferidas: `RULES.md`, regra 2; ADR 033;
`apps/api/src/operation-runtime.js` (`createContact`, normalização, deduplicação,
idempotência e auditoria); `operation-routes.js` (cadastro/busca oficiais);
`modules/contacts/src/application/contact-identity-service.js` e seu repositório
PostgreSQL (identidade por conta e correlação explícita);
`apps/api/src/conversation-routes.js` e
`modules/inbox-channels/src/application/inbox-service.js` (o envio atual exige
uma conversa existente). Não existe hoje o comando de primeira conversa aqui
proposto: ele exige implementação/validação próprias em WAP-T02/T04/T05.

WAP-T01/T02 devem fechar contrato e migração do vínculo durável com constraints
de unicidade por carteira/Cliente, estado/versão e proveniência, separado da
geração do canal. Nomes HTTP são propostos, a fechar em WAP-T01:

| Operação           | Contrato proposto e fronteira                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consultar carteira | `GET /api/v1/me/clients`: projeção dos Clientes oficiais vinculados, estado do vínculo e disponibilidade de iniciar/continuar conversa; escopo antes de busca/contagem/paginação.                                                                       |
| Novo cliente       | `POST /api/v1/me/clients`: nome/telefone/e-mail nos validadores e serviços oficiais de Contato; Cliente mais vínculo atômicos e idempotentes. Não basta fazer duas escritas independentes pelo browser.                                                 |
| Vincular existente | `POST /api/v1/me/clients/links`: `contactId` e versão esperada; servidor deriva a carteira da sessão e valida o acesso ao Cliente, sem aceitar vendedor arbitrário.                                                                                     |
| Primeiro envio     | `POST /api/v1/contacts/:contactId/whatsapp/conversations`: primeira mensagem e versões esperadas de Cliente/vínculo/linha; destino e remetente derivados/revalidados no servidor, chave idempotente e intenção durável antes do despacho n8n existente. |

Rotas definitivas, envelopes e códigos por falha pertencem ao contrato de
implementação. Não criar outro cadastro, API de pedidos/cobranças ou transporte
paralelos. Cadastros e vínculos devem continuar utilizáveis sem WhatsApp;
identidade de canal e primeiro envio só ficam disponíveis com validação atual.

## Jornada pessoal proposta

1. Vendedor ativo abre **Meus clientes** e pode consultar sua carteira,
   **Novo cliente** e **Vincular cliente existente**, inclusive sem parear.
   Sem linha configurada, oferecer **Conectar meu WhatsApp de trabalho**;
   o painel tem explicação/campo do número e pode ser fechado ou ignorado.
2. A pessoa informa/confirma o número de trabalho e aciona **Conectar WhatsApp**.
   Essa ação autenticada cria ou retoma uma única tentativa; navegar/GET não
   cria instância, reinicia sessão ou desconecta outra conta.
3. O CRM mostra o QR e orienta: no WhatsApp do trabalho, abrir **Aparelhos
   conectados → Conectar um aparelho** e ler o código. Expiração oferece
   **Gerar novo QR**; falha mostra orientação e tentativa segura.
4. O servidor confirma conexão e número efetivo pelo provedor. Somente após
   validar identidade, exclusividade e configuração do webhook, a linha fica
   operacional para sincronizar/enviar na carteira já acessível. QR lido ou
   HTTP 200 isolado não bastam; a validação não condiciona o cadastro local.
5. Em **Conta → Meu WhatsApp**, a pessoa consulta número, estado, última
   confirmação e ações **Reconectar** e **Desconectar**. A mesma configuração
   é acessível pela aba; não existem dois cadastros ou duas sessões.
6. Linha conectada abre os clientes diretamente. Desconectada mantém histórico
   legível, informa ausência de sincronização e oferece reconexão; não exibe
   carteira vazia nem promete mensagens atualizadas.

O QR pede outra tela para exibição: o celular não escaneia o próprio visor.
Para uso do CRM no mesmo aparelho, propor **Conectar com código**, suportado
pelo upstream e sujeito a homologação na imagem/aplicativo reais. O gate da
etapa 1 exige um caminho mobile viável ou limitação de duas telas explicitada
e aceita pelo PO; não declarar autonomia mobile só por renderizar o QR.

O modal tem título e descrição, foco inicial previsível, Escape/fechamento e
retorno ao acionador. Estados são anunciados sem repetir o QR a leitores de
tela. Atualização não rouba foco; fechar para de consultar, sem desfazer uma
conexão já concluída. Não usar SMS, código de verificação da conta ou senha
do WhatsApp como se fossem código de pareamento.

## Dados, autorização e carteira

Proposta: registro de linha no PostgreSQL do CRM com ID opaco, usuário titular,
número esperado/confirmado protegido, referência privada da instância, estado,
geração do vínculo, versão, corte de sincronização e trilha de operações.
Uma linha pessoal ativa por vendedor e um titular ativo por número confirmado,
com constraints transacionais. Não usar telefone no nome público da instância,
URL, chave de idempotência ou log; nunca confiar em número enviado pelo browser
como prova do aparelho conectado.

Linha de origem, titular da linha, responsável atual da conversa e crédito
comercial são conceitos separados. O histórico mantém a origem e os snapshots
comerciais. Uma nova geração de vínculo não herda eventos, sessões ou reservas
da anterior. A linha compartilhada já existente conserva seu comportamento.

Para a linha pessoal, propõe-se atribuir a conversa ao titular ativo na mesma
transação da entrada, em modo humano, sem janela pública sem dono. Se o titular
estiver inativo, a linha fica bloqueada para operação e o evento autenticado
fica pendente para revisão administrativa, sem publicação a outros vendedores.
Registro/roteamento pelo n8n continua automático; chamar IA ou responder com bot
não decorre do pareamento. Esse modo humano inicial e a atribuição por linha
são propostas de exceção restrita às regras atuais de jornada/handoff.

Meus clientes lista os Clientes oficiais com vínculo comercial durável à
carteira do vendedor, não apenas conversas atualmente abertas; inclui os
cadastros manuais e vínculos explícitos sem conversa. A linha ativa determina
o remetente, sem ser a identidade do Cliente ou a condição para cadastrá-lo.
Encerrar atendimento ou desconectar não apaga
carteira. Leituras de conversas continuam exigindo posse atual (ADR 088), com
proteção adicional da linha pessoal. Outro vendedor não ganha acesso pela
condição sem responsável, pelo filtro Todas, pela busca geral de clientes ou
por um ID conhecido. Projeções de Contato, histórico e contagens precisam
ocultar vínculos e dados exclusivos de linhas alheias também fora desta aba.
Pedidos preservam sua ACL comercial própria e não liberam chat oculto.

O mesmo `contactId` pode integrar duas carteiras autorizadas, conservando
relacionamentos de canal separados; não criar cópia por vendedor nem fundir
cadastros automaticamente por nome, telefone ou IA. Uma correlação verificável
não pode abrir conversas/atributos privados da outra linha. Permissões precedem
paginação, busca e contagens e alcançam mídia, assuntos, contexto, comandos
repetidos, notificações e SSE. Admin humano ativo conserva visão administrativa;
Financeiro/Olist não recebem conexão pessoal nem acesso à carteira por herança.

Na etapa 1, transferência comum de uma conversa de linha pessoal para outro
vendedor é recusada, inclusive pelo endpoint genérico: mudar dono não muda a
linha remetente nem autoriza outro vendedor a usá-la. A etapa 2 prevê comando
administrativo próprio para sucessão da linha/carteira, com revogação atômica.
Não migrar conversa para outro número nem reatribuir vendas históricas.

## Fronteiras de integração e segurança

Manter Vue 3, monólito, worker, PostgreSQL e Evolution existentes; sem Redis,
novo framework ou gateway público. O CRM reserva as operações; o n8n chama o
gateway privado e registra resultados pela API. Credenciais por integração e
referências de instância ficam no servidor; não criar um workflow manual por
vendedor. O controle de pareamento tem contrato técnico próprio e não fabrica
inbound ou usa o turno de uma conversa como autorização de provisionamento.

Capacidades propostas: gerenciar a própria conexão e administrar sucessão,
distintas de enviar mensagem e gerir usuários. Rotas/nomes definitivos serão
fechados em WAP-T01. Comandos humanos usam sessão atual, CSRF, origem, versão,
idempotência e limite de frequência; o servidor deriva o titular, sem aceitar
userId/instanceName/URL arbitrários. Consulta humana não expõe credencial mestre,
lista de instâncias, resposta bruta do gateway ou configurações de webhook.

QR/código são segredos temporários: acesso somente ao titular da tentativa,
resposta `Cache-Control: no-store`, sem storage do navegador, telemetria,
cache de proxy, log, captura de tela em evidência ou execução n8n persistida.
Usar entrega efêmera com expiração e correlação à geração atual; confirmar no
piloto a forma de entrega no n8n sem vazar em banco/backups. Admin pode bloquear
e diagnosticar por metadados, sem receber o QR de outra pessoa na tela comum.

Estado proposto: não configurado, preparando, aguardando pareamento, validando,
conectado, desconectado, desconectando, bloqueado e resultado desconhecido.
Um ledger durável registra intenção antes do HTTP e resultado após o HTTP;
duplo clique ou duas abas não criam duas instâncias. Timeout em criação/conexão/
logout exige consulta/reconciliação, não nova instância ou exclusão cega.
Validade e geração da tentativa cercam QR, callbacks e atualizações tardias;
um evento antigo não restaura conexão revogada.

Conexão com número diferente do confirmado bloqueia ativação e leitura de
dados do canal; oferece correção da tentativa e encerramento seguro da sessão
indevida. Número já reservado/conectado não é roubado: conflito genérico, sem
revelar quem o usa. Trocá-lo é operação própria da etapa 2, com revogação da
geração anterior. Desconectar suspende envios/sincronização, invalida reservas
ainda não executadas e conserva dados CRM. Não apaga instância/banco/história
como mecanismo de limpeza. Efeito já iniciado pode terminar; a UI não promete
cancelamento retroativo.

## Mensagens e sincronização

Em todo webhook, validar autenticação, instância, número efetivo, linha e
geração. Não rotear por nome do vendedor, destinatário do cliente ou campo
arbitrário de payload. Validar novamente na reserva e no despacho; respostas,
mídia e callbacks devem usar a conta original da conversa, nunca a última linha
conectada nem uma variável global. Conta indisponível não usa a linha geral
como fallback. Preservar reservas únicas, epoch, revisão e resultado incerto.

Entradas novas continuam pelo contrato n8n→CRM. Saídas originadas no aplicativo
precisam de um evento autorizado de **mensagem externa já enviada**, distinto
de uma solicitação de envio: registrar uma vez, sem reenviar, abrir pedido,
reiniciar IA ou consumir/reabrir revisão inbound. Marcar origem aparelho e
autoria humana da linha, sem afirmar qual pessoa física digitou. Reconciliar
eco de envio do CRM por conta + ID do provedor, inclusive se o webhook chegar
antes do resultado HTTP; um único registro e histórico de entrega monotônico.
Uma saída desconhecida não vira automaticamente eco de um envio pendente.

Guardar ordem e timestamps reais, suportar eventos fora de ordem e formatos
de mídia existentes; arquivo indisponível conserva metadados e erro visível,
sem fabricar bytes. Se o provedor não fornecer parte do histórico ou um evento
estiver perdido, mostrar intervalo não verificado; reconectar não comprova
completude. Lacunas/reconciliação são leituras e não repetem envios.

## Etapa 2: carteira anterior e sucessão

Antes de importar, exibir prévia com quantidade, período disponível, critérios
de seleção, duplicatas e limites. Confirmar pertinência comercial e seleção;
não importar toda a agenda automaticamente. A API oficial CRM continua sendo
o destino da escrita; n8n não acessa banco CRM nem usa o banco Evolution como
cadastro oficial. Importação tem execução limitada, checkpoint e deduplicação
por conta/ID; falha parcial retoma sem duplicar. Mensagens históricas têm origem
de importação, não disparam bot, handoff, recuperação ou lembrete, nem entram
como venda/lead novo. Recontagem histórica exige regra aprovada específica.

Troca de número pelo próprio vendedor exige desconectar/revogar o vínculo
anterior e provar o novo, sem mover retrospectivamente remetentes. Sucessão
entre funcionários é administrativa: motivo, escopo, versões, revogação do
antigo acesso e reservas, atribuição e auditoria na mesma fronteira. Não existe
autoapropriação de linha desconectada ou de funcionário inativo.

## Critérios de decisão e alternativas

Recomenda-se autoatendimento no CRM com um registro de linha e roteamento
compartilhado por configuração, pois reduz trabalho manual sem entregar o painel
técnico ao vendedor. Instância por vendedor é sessão de canal, não um novo
microserviço. Alternativas rejeitadas na proposta: painel Evolution direto;
um workflow copiado por vendedor; filtrar só a UI; chavear cliente globalmente
por telefone; importar agenda/histórico como inbound nova.

Pontos de produto ainda em revisão, sem bloquear a entrega desta RFC:

- D1: aceitar modo humano inicial e atribuição atômica ao titular nas linhas
  pessoais, com exceção restrita às regras 1/19/20 e ADR 009, preservando a
  jornada da linha geral. IA pessoal futura exigiria escolha própria.
- D2: aceitar uma linha ativa por vendedor, restrição de transferência na
  etapa 1 e sucessão administrativa na etapa 2.
- D3: aceitar etapa 1 para mensagens novas, com etapa 2 de importação limitada;
  confirmar recorte/período e retenção de dados importados antes de implementá-la.
- D4: homologar código de pareamento para uso no mesmo celular; se indisponível,
  decidir explicitamente sobre o requisito de duas telas antes do piloto.
- D5 (revisão de 13/11/2026): incluir primeiro contato humano pelo CRM sem
  inbound anterior na etapa 1, com Cliente oficial/vínculo preexistentes,
  destinatário validado e composição transacional do primeiro envio. Evoluir
  somente a fronteira necessária dos contratos MSG/ORC e modo humano da linha
  pessoal; não interpretar o envio humano como início de automação por UI.

Aceite durável gera novo ADR ligado a esta RFC, requisitos e PR, atualizando
somente as exceções necessárias em RULES, spec MVP, PRD e sínteses de arquitetura.
Não reescrever ADRs 009/050/088. Reutilizar ORC-01–05/07/08, INB-01, MSG-01–04,
PRV-01–03 e CONV-ACL-01; os WAP novos continuam propostos até essa decisão.

## Gates, operação e resultado da entrega

WAP-T00 entrega esta proposta, requisitos e tarefas. Os critérios negativos
estão na spec e os gates locais/remotos no plano. A etapa 1 exige evidência de
duas linhas, reconexão autônoma, mesmo cliente em ambas, concorrência de número,
QR expirado, aparelho incorreto, saída nativa, eco duplicado, revogação durante
envio, isolamento de Contatos/SSE/mídia e indisponibilidade do n8n/Evolution.
WAP-17–24 exigem ainda cadastro manual sem conversa, vínculo do Cliente
oficial sem duplicação, primeiro envio humano sem inbound e resposta posterior
no mesmo Cliente/conversa, criação/edição/confirmação
humana de Pedido e cobrança com contexto correto, envio do link pela linha de
origem e pagamento conciliado uma vez. Repetir com duas linhas e mesmo cliente,
tentativas alheias e WhatsApp desconectado; pagamento usa ambiente sintético
ou sandbox autorizado, sem presumir liberação de cobrança financeira real.

Flags propostas desligadas por padrão, habilitação/piloto privados, sem mudar
a linha geral. Antes de cada piloto: capacidade do gateway e banco, retenção
de QR/sessões, segredos, backup/restore e bloqueio de envios após recovery
verificados no alvo. Baileys continua ponte com os limites da ADR 050; múltiplas
linhas não significam estabilidade ou imunidade a bloqueio do WhatsApp.

Rollback desliga novas conexões/importações e despachos das linhas pessoais,
preservando cadastro, pedidos, cobranças, recebimentos, histórico, ledger, ACL
e resultados incertos. Confirmação e conciliação financeira seguem operantes
sob seus contratos próprios. Não publica outra
linha como remetente, não reabre acesso compartilhado e não apaga sessões ou
operações para permitir retry. Reativação exige reconciliar o que ficou incerto.

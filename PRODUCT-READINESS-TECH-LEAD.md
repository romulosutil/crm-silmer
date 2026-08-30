# Passagem de Produto para Tech Lead

**Data:** 29/08/2026  
**Parecer:** GO condicional para iniciar especificação técnica. P0.1, P0.2 e
P0.3 resolvidos; quatro decisões P0 continuam abertas.

## O que o Tech Lead já pode especificar

- Contexto e limites do sistema.
- Separação entre backlog de conversas e Kanban de leads.
- Contratos de integração com a API oficial do WhatsApp.
- Modelo de execução por ferramentas do Vendedor Silmer.
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
| 4 | Canais do primeiro piloto além do WhatsApp | Aberto | Integrações e identidade de contato |
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

## Gate recomendado

O Tech Lead pode começar com descoberta, alternativas e spikes reversíveis. A
máquina de estados, o modelo de completude, o contrato de comunicação de preço
e o limite do financeiro comercial já podem ser fechados com base no P0.1, no
P0.2 e no P0.3. A especificação técnica completa só recebe status `Aprovada`
quando os quatro P0 restantes estiverem resolvidos e refletidos nos critérios
de aceite.

Não iniciar implementação de produção nem publicar estimativa fechada antes desse gate. Protótipos descartáveis de integração e validação da API oficial são permitidos, desde que não congelem o modelo de domínio.

## Workshop de fechamento

Participantes: Product Manager, responsável operacional da Silmer, pessoa que preenche a Ficha e Tech Lead.

Agenda:

1. Validar apenas dúvidas operacionais de `FAB` e numeração ainda cobertas pelo
   P0.5; o mapa campo a campo já está concluído.
2. Confirmar se haverá canal adicional no piloto.
3. Fechar permissões e privacidade do piloto.

Saída: P0.4–P0.7 resolvidos, PRD atualizado e autorização para o Tech Lead
finalizar design e tarefas.

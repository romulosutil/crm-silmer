# Passagem de Produto para Tech Lead

**Data:** 29/08/2026  
**Parecer:** GO condicional para iniciar especificação técnica. P0.1 e P0.2
resolvidos; cinco decisões P0 continuam abertas.

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
| 3 | Financeiro cobre vendido ou também recebido/a receber | Aberto | Entidades, eventos e relatórios |
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

## Gate recomendado

O Tech Lead pode começar com descoberta, alternativas e spikes reversíveis. A
máquina de estados, o modelo de completude e o contrato de comunicação de preço
já podem ser fechados com base no P0.1 e no P0.2. A especificação técnica
completa só recebe status `Aprovada` quando os cinco P0 restantes estiverem
resolvidos e refletidos nos critérios de aceite.

Não iniciar implementação de produção nem publicar estimativa fechada antes desse gate. Protótipos descartáveis de integração e validação da API oficial são permitidos, desde que não congelem o modelo de domínio.

## Workshop de fechamento

Participantes: Product Manager, responsável operacional da Silmer, pessoa que preenche a Ficha e Tech Lead.

Agenda:

1. Validar apenas dúvidas operacionais de `FAB` e numeração ainda cobertas pelo
   P0.5; o mapa campo a campo já está concluído.
2. Delimitar financeiro comercial.
3. Confirmar se haverá canal adicional no piloto.
4. Fechar permissões e privacidade do piloto.

Saída: P0.3–P0.7 resolvidos, PRD atualizado e autorização para o Tech Lead
finalizar design e tarefas.

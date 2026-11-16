# ADR 090 — WhatsApp pessoal, carteira e cadastro compartilhado

Data: 15/11/2026. Status: aceita pelo proprietário neste chat.
RFC: [067](../rfc/067-whatsapp-por-vendedor-e-meus-clientes.md).
Requisitos: [WAP-01–33](../../.specs/features/seller-whatsapp/spec.md).
Tarefas: [WAP-T00c, WAP-T01–07 e WAP-T02a](../../.specs/features/seller-whatsapp/tasks.md).
Antecedentes: [PR 372](https://github.com/romulosutil/crm-silmer/pull/372) e
[PR 376](https://github.com/romulosutil/crm-silmer/pull/376). Sem issue específica;
PR desta decisão vinculada no handoff de WAP-T00c.

## Contexto

O proprietário aprovou D1–D5 e a política de cadastro compartilhado, reforçando
que cada vendedor tem **um único número de trabalho**, o atendimento é
predominantemente **passivo** e a prioridade é criar Pedido a partir da conversa.
Meus clientes oferece a operação comercial completa do CRM, incluindo cadastro,
pedidos e cobranças. Cliente permanece o Contact oficial; carteira, identidade
do canal e responsável pelo atendimento são conceitos distintos.

## D1 — Atendimento humano na linha pessoal

Nova entrada validada na linha pessoal abre atendimento humano e atribui o
titular ativo atomicamente, sem janela de exposição como conversa sem dono.
Pareamento, cadastro e mensagens não ligam o bot. O n8n continua recebendo,
normalizando e registrando canal/eventos pela API; modo humano não o dispensa.
Titular desativado bloqueia operação e encaminha pendência à administração,
sem divulgar a conversa aos demais vendedores. A linha geral preserva sua
jornada atual. IA nas linhas pessoais exige decisão futura própria.

## D2 — Um número por vendedor

Cada vendedor possui um único número de trabalho e uma linha pessoal ativa;
cada número confirmado tem apenas um titular ativo. A interface não oferece
alternância entre múltiplos números pessoais. Reconexão conserva carteira e
histórico. Na etapa 1, transferência genérica para outro vendedor é recusada.
Na etapa 2, o titular pode substituir seu único número comprovando a nova
conexão e revogando a geração anterior. Sucessão entre funcionários é
administrativa, auditada e revoga o acesso anterior; não transfere vendas
históricas nem move mensagens antigas para outro remetente.

## D3 — Duas etapas e importação limitada

Etapa 1: configuração pessoal, QR/código e reconexão, carteira, cadastro/vínculo,
novas mensagens nos dois sentidos pelo CRM/aparelho, Pedido pela conversa,
cobranças e demais ações vigentes. Também inclui o primeiro envio humano
opcional de D5. Nenhuma dessas ações comerciais é adiada para importar agenda.

Etapa 2: seleção de clientes anteriores, importação de **até 30 dias de
mensagens disponíveis**, troca de número e sucessão. Trinta dias é janela de
importação, não promessa de disponibilidade nem nova retenção. Aplicar a
política vigente por tipo de dado, inclusive mídia indisponível/expirada;
ampliar a janela exige decisão própria. Prévia, seleção, deduplicação e
retomada são obrigatórias. Não importar a agenda inteira automaticamente nem
usar histórico como inbound nova, bot, lembrete, cobrança ou venda retroativa.

## D4 — Pareamento dentro do CRM

QR é o caminho para quem dispõe de outra tela; código de pareamento é a
alternativa no mesmo celular. Ambos usam API autenticada e gateway privado,
sem credencial técnica ao vendedor e sem guardar QR/código em logs, storage
ou execuções n8n persistidas. Código deve ser homologado no ambiente real
antes de declarar conexão autônoma no mesmo aparelho. Se houver limitação,
informá-la claramente; carteira e operações locais continuam disponíveis.
Não substituir silenciosamente esse requisito por um piloto apenas com QR.

## D5 — Primeiro envio humano opcional

O atendimento normal aguarda o cliente procurar. Não há prospecção automática,
envio em lote ou mensagem inicial disparada ao conectar/cadastrar/vincular.
O vendedor pode iniciar contato individual explicitamente, na etapa 1, após
conferir Cliente, telefone e sua única linha remetente. Usar o mesmo contactId,
validar destinatário/ACL/versões, criar ou reutilizar atendimento humano e
persistir intenção/outbox/auditoria transacionalmente antes do despacho n8n.
Preservar idempotência, reconciliação e resultado incerto, sem inbound fictícia.
Essa capacidade não é pré-requisito para receber ou criar Pedido na conversa.

## Prioridade obrigatória — Criar pedido na conversa

O vendedor titular ativo pode acionar **Criar pedido** diretamente no
atendimento humano de Meus clientes, mediante a confirmação humana já vigente.
Não exigir sugestão/aceite da IA, bot ativo, primeira mensagem iniciada pelo
vendedor, importação antiga, cadastro completo ou WhatsApp online. O cadastro
completo continua gate específico do Olist (ADR 082), não da criação do Pedido.
Preservar os demais requisitos e estados elegíveis do fluxo existente.

Reutilizar `POST /api/v1/conversations/:conversationId/orders`, a autorização
comercial e os módulos de Pedido existentes. O resultado é Pedido pendente,
numerado, no mesmo Cliente/conversa e alvo de Assunto, com responsável e dados
disponíveis corretos; a ficha pode ser preenchida progressivamente. Criar não
confirma, cobra, envia mensagem nem reinicia o bot. Confirmar, gerar ficha e
cobrar continuam comandos próprios e autorizados.

Se já houver pendente no alvo, abrir o existente; outro pedido exige alvo
explícito pelo fluxo de Assuntos vigente. Repetição/duplo clique não duplica
pedido ou número. Troca de conversa/versão, perda de posse, conversa encerrada
ou alvo ambíguo exigem revalidação/recusa. Não criar pedido manual solto como
atalho para simular a criação vinculada. WAP-T02a verifica essa fatia antes de
expandir o primeiro envio; a etapa 1 não fecha só com QR e chat funcionando.

## Cadastro compartilhado entre carteiras

Um Contact oficial pode integrar duas carteiras autorizadas, sem cópia por
vendedor e sem liberar conversas/negócios alheios. Aplicar no servidor:

| Informação/ação                                                                                 | Regra aceita                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nome de exibição, e-mail, endereço padrão e demais dados cadastrais comuns não restritos abaixo | Ambos os vendedores ativos com vínculo autorizado podem preencher/corrigir. A tela avisa que o cadastro é compartilhado; não precisa revelar nomes das outras carteiras. |
| Primeiro preenchimento de dados fiscais                                                         | Qualquer vendedor vinculado pode preencher campos ainda vazios, com os validadores vigentes.                                                                             |
| CPF/CNPJ ou tipo de pessoa já preenchidos                                                       | Alteração ou retirada somente por Admin humano ativo, com motivo e conferência. Incluir o mesmo valor num salvamento não é alteração; aplicar a restrição por campo.     |
| Telefone principal do Cliente compartilhado                                                     | Alteração somente por Admin humano ativo, após conferência. Não troca identidade de canal ou destinatário de conversa/cobrança preparada.                                |
| Notas de negociação e lembretes                                                                 | Permanecem no atendimento/carteira correspondente, sem promoção automática para campos globais.                                                                          |
| Pedidos, preços, cobranças e recebimentos                                                       | Conservam ACL e guardas comerciais próprias. Vínculo de carteira não concede gestão dos negócios de outro vendedor.                                                      |
| Vincular, transferir ou unir cadastros                                                          | Operações explícitas autorizadas, distintas de editar campo. Nunca unir por telefone/nome ou transferir responsabilidade/venda implicitamente.                           |

A edição exige versão atual e revalidação de vínculo/capacidade e estado de
compartilhamento na transação. Edição concorrente retorna conflito revisável,
preservando rascunho; não sobrescrever o trabalho do outro. Avisar os leitores
autorizados de que o cadastro mudou sem revelar atendimento privado. Registrar
autor, horário e campos alterados; valores pessoais ficam protegidos nos
envelopes, nunca em logs, eventos ou auditoria em claro.

Pedidos confirmados conservam seus snapshots. O nome dos pendentes acompanha
o Contato como na ADR 018; não reescrever pedidos/exportações/documentos
históricos ou condições comerciais por edição cadastral. Alteração de telefone
ou dados relevantes torna obsoleta a preparação de envio afetada e exige nova
conferência, sem redirecionar efeito já reservado ou iniciado.

## Precedência e consequências

Decisão restrita às linhas pessoais. Supersede a atribuição inicial sem dono
da ADR 009 e as regras 1/20 de RULES apenas onde incompatíveis com D1; a regra
19 e o handoff humano definitivo permanecem. Complementa ADR 050 (mesmo
transporte privado) e mantém ADR 088, acrescendo isolamento por linha/carteira.
Complementa ADRs 033/047 com a autorização de cadastro compartilhado e preserva
ADRs 018/056/082 e ACL comercial. ADRs anteriores não são reescritos.

Rejeitados: IA automática nas linhas pessoais, múltiplos números por vendedor,
carteira dependente da sessão WhatsApp, cópia de Contact por vendedor,
primeiro envio como condição para Pedido, bloqueio geral do cadastro em queda
do canal e filtro somente na interface. Reutilizar monólito/Vue/worker/n8n/
PostgreSQL/Evolution existentes; nenhuma nova infraestrutura é autorizada.

WAP-T00c registra a decisão e alinha fontes canônicas. Não implementa rotas,
migrações, workflows, pareamento, alterações financeiras ou efeitos reais.
Contratos técnicos, código e gates WAP-T01–07/T02a continuam pendentes; desenho
aceito não comprova o fluxo integrado ou produção. Piloto exige prova de duas
carteiras, cada vendedor com seu único número, criação de Pedido na conversa,
ACL negativa, concorrência, cadastro compartilhado, reconexão e recovery.

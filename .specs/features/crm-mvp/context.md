# CRM Silmer MVP — Contexto de Produto

**Coletado em:** 29/08/2026\
**Atualizado em:** 05/10/2026 — PR 142 integrada e OpenAI escolhido\
**Spec:** [spec.md](spec.md)\
**Status:** implementação de atendimento e Pedidos disponível; homologação e gates de produção pendentes

## Limite da feature

WhatsApp oficial → n8n → CRM → atendimento humano → pedido confirmado e ficha
impressa. O CRM é a fonte da verdade; n8n é o motor obrigatório de canal e IA e
toda mutação oficial usa sua API. A UI não dispara o workflow.

## Decisões vigentes

- Cliente é `Contact` + `ContactIdentity`; Conversa e Mensagem mantêm histórico
  oficial. Kanban e Negócio estão aposentados pela ADR 004.
- O agente coleta dados não linearmente, projeta respostas inequívocas na
  pré-ficha e no pedido pendente, e abre handoff quando precisa de pessoa.
- Pedido tem dois status, `pendente` e `confirmado`; no máximo um pendente por
  conversa. A numeração `NN-CRM` é reservada na criação (ADR 006).
- Gerar e reabrir exigem dono da conversa ou administrador. Só confirmado pode
  ser impresso; reabrir preserva número e bloqueia impressão.
- Preço, condição e entrega prometida são decisões humanas. Datas manuais de
  pagamento e entrega não alteram status (ADR 008).
- Técnica pertence ao item; origem da arte pertence ao pedido. Resposta
  inequívoca do bot só preenche dados ainda vazios, e o vendedor confere
  (ADR 020, requisitos TEC-01..08 e tarefas T83..T87).
- A impressão seleciona v5, aprovada provisoriamente pelo PO para
  desenvolvimento. Assinatura física de Rose e Operação permanece gate de
  produção; v2–v4 e hashes não mudam.
- Handoff nasce sem responsável, para Vendedor; claim é atômico (ADR 009).
  Depois de handoff ou takeover, a conversa não volta à IA (ADR 015).
- WhatsApp é o canal do primeiro lançamento; Instagram é `CANAL-2`, sem
  bloquear esse MVP. Identidades só se correlacionam com evidência auditável.
- OpenAI é o provedor de produção escolhido pelo PO em 05/10/2026. Homologação
  de privacidade, DPA, retenção, logging e ZDR aplicáveis continua pendente.
- Manter o fluxo atual de deploy automático GitHub → EasyPanel, com checagens
  operacionais de ambiente, health, isolamento, segredos e rollback.
- Dashboard mede pedidos confirmados e valor vendido. Recebido e saldo a
  receber não entram; cobrança PIX e boas-vindas automáticas ficam adiadas.
- Arquivos da arte são enviados e baixados pela página do pedido e ficam no
  RustFS interno (ADR 023). Aviso automático a Rose precisa de contrato e
  homologação próprios.
- A política de privacidade do piloto foi aprovada após consulta jurídica.
  Rômulo Sutil Corrêa é o responsável. A exceção de operação solo continua
  limitada ao piloto interno e não prova segregação nem recovery.

## Discrição do Tech Lead

Detalhes de contratos internos, retries, observabilidade e documentação,
preservados requisitos, autorização e idempotência. Troca de provedor,
infraestrutura ou escopo de canal exige decisão registrada.

## Ideias adiadas

Instagram, atendimento próprio do site, cobrança e comprovante estruturados,
boas-vindas automáticas, recebimentos/saldo, estoque, produção completa e
pós-venda. Envio a Rose e o provisionamento do RustFS com backup permanecem pendências
operacionais próprias e não devem ser declarados prontos por testes locais.

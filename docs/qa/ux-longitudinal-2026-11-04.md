# Pedidos recorrentes — ensaio longitudinal de 04/11/2026

Rastreabilidade: **CP-09, CP-11–18, CP-29–31 / CP-T04 e CP-T09**.
Estado: **piloto real concluído; campanha de 190 sessões preparada, não executada**.
Nenhuma regra de produto, workflow principal ou publicação foi alterada.

Continuação: [validação ampliada](ux-order-isolation-validation-2026-11-04.md),
com alteração indevida de um Pedido formal comprovada em novo ciclo real.

## Resultado principal

**P1: duas intenções de compra foram combinadas no briefing antes da criação de Pedido.**
Uma identidade sintética pediu 18 camisetas azuis, algodão, gola redonda,
sem estampa, com 9 M e 9 G. Ainda durante a coleta, escreveu:
“Agora quero outro pedido, separado: 7 polos verdes. Não altere as 18 camisetas azuis.”

A consulta autenticada posterior ao CRM confirmou um único briefing:

| Campo persistido                 | Valor observado                                                       |
| -------------------------------- | --------------------------------------------------------------------- |
| `product_type` / `product_model` | `7 polos` / `camisa polo`                                             |
| `colors` / `quantity`            | `verdes` / `7`                                                        |
| `sizes`                          | `9 M e 9 G` — soma 18, herdada da primeira intenção                   |
| `fabrics` / `collar`             | `algodão` / `gola redonda`, herdados da primeira intenção             |
| `artwork_status`                 | `sem estampa`, herdado da primeira intenção                           |
| `notes`                          | Pedido separado das 18 camisetas azuis; não alterar o primeiro pedido |
| `briefing_status` / `mode`       | `ready_for_handoff` / `handoff_pending`                               |
| `subjects`                       | `[]`                                                                  |

A Inbox indicou pré-ficha completa, 9/9. A observação de separação nas notas
não impediu a combinação dos campos. Não havia Pedido formal nesse caso:
a falha comprovada é de contexto e briefing entre intenções da mesma pessoa.
A criação e a confirmação humanas não foram contornadas.

Hipótese para investigação: o contexto canônico condiciona `newOrderRequest`
à existência de Assuntos. Sem Assunto, a coleta continua no briefing da
Conversa. A reprodução não isola ainda a responsabilidade entre seleção de
contexto, modelo e merge do callback; a correção exige teste dessa fronteira.

## Mesma pessoa acompanhada em três ciclos reais

Um segundo cliente sintético, identificado na UI como **UX Sintético 003**,
preservou o mesmo `contact_id` em três Conversas sequenciais. Foram executados
10 turnos: 4 no primeiro ciclo, 4 no segundo e 2 no terceiro. Dois Pedidos
pendentes foram criados pelo fluxo humano normal, com sentinelas distintas:

- **43-CRM (A):** 18 camisetas comuns azuis, algodão, gola redonda, 9 M e 9 G.
- **44-CRM (B):** 7 polos verdes, piquet, gola polo, 7 M.

| Ciclo e estímulo                                                         | Resultado efetivamente observado                                                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1: completar a coleta; depois solicitar novo pedido e alteração          | Coleta transferida no turno 2; os dois turnos posteriores tiveram `no_action`. Briefing preservado em 18 camisetas.           |
| 2: “No pedido 43-CRM, a quantidade desejada agora é 24 camisetas azuis.” | Alvo A correto. Briefing e quantidade informada passaram a 24; ficha B permaneceu integralmente igual.                        |
| 2: referência a B e depois mensagem ambígua, após o handoff anterior     | Ambos `no_action`; não contam como acerto de associação ativa.                                                                |
| 3: com A/B vinculados e sem seleção, “Mude para 30 peças.”               | Bloqueio seguro: `subject_ambiguous`, `low_confidence`, sem alvo e sem patch. Snapshots completos de A/B permaneceram iguais. |

**Reclassificado: limitação deliberada da política e da rotulagem.** A referência explícita
a A no ciclo 2 gerou `external_context` / `human_requested`, embora o usuário
não tenha pedido atendimento humano. Isso reduziu a autonomia do fluxo e
impediu que os próximos turnos avaliassem seleção ativa entre Pedidos.
A investigação posterior confirmou que a ADR 013 determina esse mapeamento
e reconhece o rótulo genérico na Inbox. Este comportamento não é contado como
defeito confirmado; permitir continuação automática de um Pedido conhecido
exige explicitar a mudança da política vigente.

Em A, a quantidade informada ficou 24 e a grade oficial permaneceu 9 M + 9 G
(total 18). São campos diferentes; o ensaio não interpreta isso como alteração
de outro Pedido. A ficha B, versão 2, não mudou. A passou da versão 2 para 3.

Os três ciclos foram encerrados normalmente ao final do piloto. Os dois
Pedidos sintéticos continuam pendentes no CRM compartilhado, sem pagamentos
ou valores financeiros; a API humana não os marcou como `isTest`. Não foram
apagados. Nenhum dado de cliente real foi alterado.

## Caminho executado e limites

- CRM real, com SHA informado no inventário do serviço:
  `1cfe4e3a393a930636debee01f78e56e988c8893` (não é verificação dinâmica do processo).
- Lógica comercial copiada do export principal com versão
  `b4407864-c649-4b23-b59b-5baf7aa31ac9`; SHA-256 do export:
  `8176d7b30181354ba446d336104f79921ee4b84092799050c8b8f8f08be71757`.
- Cópia QA manual, inativa e sem webhook público; não houve publicação do principal.
- **13 turnos reais do principal copiado:** 10 longitudinais + 3 do caso de mistura;
  9 chegaram ao caminho do modelo e 4 foram bloqueados após handoff.
- WhatsApp/Evolution simulado; modelo, inbound, decisões, callbacks e persistência
  do CRM reais. Não houve envio a telefone real.
- A cópia usa cabeçalhos técnicos DEV. Recepção paralela do canal, armazenamento
  de mídia e observação humana não fazem parte deste executor.
- Política real: `order_opening_policy: human_confirmation`, preservada.
- Um smoke adicional de um turno no DEV antigo foi excluído das conclusões.
- Multimodal, replay, concorrência e as cotas completas de abandono não foram
  exercitados neste piloto. Não há taxa global de mistura calculável.

Relatórios por turno, leituras autenticadas dos briefings, snapshots completos
antes/depois das fichas e comparações foram salvos nos artefatos locais desta
conversa. Não há credenciais nos relatórios, fixtures ou Git.

## Plano ajustado e executor

O plano mantém **100 pessoas sintéticas**, com coortes aninhadas de 100, 50 e
40 nas três ondas. A identidade é estável, mesmo quando o ciclo de conversa
muda. Todos os nomes são Ana, para evitar usar nome como chave de associação.

| Onda | Janelas | Intenções novas | Tentam concluir | Abandonam fluxo novo | Inativas |
| ---- | ------: | --------------: | --------------: | -------------------: | -------: |
| 1    |     100 | Jornada inicial | Conforme perfil |      Conforme perfil |        0 |
| 2    |      50 |              25 |              13 |                   12 |       25 |
| 3    |      40 |              20 |              10 |                   10 |       20 |

A onda 1 tem exatamente 25 clientes por perfil original. Os perfis das ondas
posteriores são mistos. As cotas definem ações do usuário sintético; sucesso
do agente só pode ser registrado pela execução. `observed_result` permanece
nulo no plano. Inatividade não gera inbound nem fechamento automático.

- `scripts/ux-longitudinal-plan.mjs`: gera e valida plano e identidades.
- `scripts/ux-longitudinal-workflow.mjs`: gera cópia manual do fluxo revisado,
  limita HTTP ao contrato n8n do CRM e produz evidência por turno para download.
  Não publica nem executa automaticamente. Export e credenciais ficam privados.
- `scripts/ux-longitudinal-crm.mjs`: prepara fixtures pelo contrato humano,
  vincula A/B sem escolher alvo, registra snapshots e encerra ciclos. Valida
  identidade sintética, contato/conversa e vínculo de cada Pedido antes de agir;
  bloqueia o ambiente compartilhado por padrão e nunca apaga registros.

```sh
node scripts/ux-longitudinal-plan.mjs RUN_ID plano.json
node --test test/ux-longitudinal-plan.test.js test/ux-longitudinal-workflow.test.js test/ux-longitudinal-crm.test.js
```

O CLI REST aceita manifesto, arquivo privado de sessão e ação
`prepare|snapshot|link|close`; a origem e o destino dos relatórios são explícitos.
O manifesto não pode conter credenciais. O executor foi validado também contra
os Pedidos reais sintéticos do piloto, incluindo o DTO sem `contactId`, cuja
posse é conferida pelos Assuntos da Conversa.

## Verificação e continuação

`npm run validate` passou: **1.709 testes aprovados, 10 ignorados e nenhuma
falha** (1.719 no total), além de formatação, tipos, lint, fronteiras, contratos
operacionais e build. Inclui 28 testes novos do plano, workflow e cliente REST.
Os testes live ignorados não são apresentados como evidência operacional.
Há aviso de tamanho do bundle no build; não há mudança de frontend nesta fatia.

A campanha de 190 sessões ainda depende da escolha de ambiente. O AGENTS.md
exige “Use containers e bancos dedicados com dados sintéticos”. Docker não
está instalado nesta máquina, e o CRM disponível é compartilhado. Executar
nesse ambiente criaria aproximadamente 100 clientes e até 200 Pedidos
pendentes persistentes. Foi solicitada uma homologação dedicada ou autorização
explícita para essa carga no CRM atual. O piloto não substitui essa campanha.

Na continuação, registrar separadamente mistura, seleção correta, bloqueio
seguro, transferência e caso não exercitado. Não reativar artificialmente o bot
após handoff para consumir roteiro, nem atribuir sucesso à ausência de ação.

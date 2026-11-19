# Verificação independente da etapa 1 — WAP-E11

WAP-T05-01 a WAP-T05-04, 18/11/2026, branch cumulativo `codex/wap-e05`
(PR única [romulosutil/crm-silmer#398](https://github.com/romulosutil/crm-silmer/pull/398)),
a partir do E10 `d24c78c5`. [Spec](spec.md), [design](design.md),
[tasks](tasks.md), [prontidão](../../../docs/runbooks/seller-whatsapp.md) e
[recovery](../../../docs/runbooks/seller-whatsapp-recovery.md).

A prova é **local e sintética**: Node 24.20.0, npm 11.19.0 e PostgreSQL
17.10 portátil em loopback, sem Docker neste host. Ela não homologa provedor,
n8n real, pareamento, produção ou capacidade de produção. Não houve flag real,
publicação de workflow, mensagem a cliente ou efeito financeiro.

## Método

A revisão adversarial foi somente leitura: um revisor percorreu todos os
pontos de exposição da linha pessoal, da carteira e da linha geral contra a
spec e o design. As suítes foram executadas por outro papel, sem alterar
código. Correções funcionais voltaram à fronteira dona, com teste vermelho
antes. Os findings abaixo foram decididos pelo Tech Lead.

## Matriz de cobertura

| Área (requisitos)                                               | Evidência                                                                                                                                      | Resultado              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Controle, QR e código sem persistência (WAP-02/03/04/10/11)     | `seller-whatsapp-postgres-live` 21, `-control-` 1, rotas/integração de controle; varredura de 788 colunas e 67 logs                            | aprovado               |
| Carteira, vínculo e cadastro compartilhado (WAP-18/20/21/24–29) | `seller-client-links` 8, `seller-clients` 18, `seller-client-identity` 9, `contact-registration` 1                                             | aprovado               |
| Ingresso e atribuição humana (WAP-04–08/32)                     | `seller-whatsapp-inbound` 9, `inbox` 10, `inbound-media` 1, `inbox-buckets` 14                                                                 | aprovado               |
| ACL negativa, IDs diretos, replay e SSE (WAP-07/08/28)          | `seller-conversation-access` 10; SSE com zero ID alheio no ensaio de carga; revisão das rotas                                                  | aprovado               |
| Pedido por Assunto e fluxo passivo (WAP-17/19/31/33)            | `order-subject` 14, `order-assistance` 11, integração E07 1 (Chromium)                                                                         | aprovado após F1       |
| Saídas, eco do aparelho e mídias (WAP-06/09/10/23)              | integração E08 7, `n8n-integration` 10                                                                                                         | aprovado               |
| Primeiro envio (WAP-22/23/24)                                   | integração E10 17 (com 2 novos), rotas 5                                                                                                       | aprovado após F2       |
| Cobrança pela linha correta (WAP-19/27/30)                      | `order-billing-send` 18, `order-billing-chat` 16                                                                                               | aprovado               |
| Snapshots e retenção (WAP-16/33)                                | revisão: origem imutável por trigger, `0080` só em pendente com vínculo único, retenção inalterada; drill D4 com Pedidos e briefings idênticos | aprovado               |
| Flags default off e allowlist (WAP-12)                          | `seller-whatsapp-readiness-config` 14 e suítes por fronteira                                                                                   | aprovado               |
| Desligamento, fases e restore (WAP-10/11/16/29)                 | `seller-whatsapp-recovery-drill` 7, três execuções                                                                                             | aprovado com F3 aberto |
| Linha geral                                                     | revisão das guardas: retorno antecipado sem linha pessoal; suítes gerais acima                                                                 | aprovado após F1       |

Todas as suítes PostgreSQL rodaram com `--test-concurrency=1`, zero falhas e
zero skips. Focais sem banco: 95 em 11 arquivos. `npm run validate:topology`
e `npm run test:recovery:mocks` (18) foram aprovados. O ensaio
`ops/n8n/whatsapp-control-rehearsal.mjs` exige n8n e PostgreSQL em Docker e
não rodou neste host. Segue a evidência registrada no
[runbook de controle](../../../docs/runbooks/seller-whatsapp-control.md#evidência-da-entrega).

Gates únicos de CONTRIBUTING sobre `7cb8ed5a`: `npm run validate`, com 2.889
aprovados, zero falhas e 61 skips live sem URL. `npm run test:e2e --
--workers=2`, com 1.115 aprovados e sete skips existentes. `npm audit
--audit-level=high`, completo e de runtime, sem vulnerabilidades. A cadeia do
job PostgreSQL do CI, reproduzida localmente depois de F5, foi aprovada.
Também foram aprovados o novo passo de integração (saídas 7, drill 7) e as
suítes de Pedido depois de F1 (37 e 47).

## Findings

| ID  | Sev. | Achado                                                                                                                                                                                                            | Estado                                                                                                                                                      |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | P1   | Linha geral, flags off: criar Pedido manual numa conversa com Assunto geral sem Pedido, ou com o único Assunto já confirmado, falhava (`409`). Na master, criava.                                                 | corrigido no E05/E06, `31919110`                                                                                                                            |
| F2  | P2   | Primeiro envio `outcome_unknown` deixava de bloquear depois de encerrar o ciclo: uma nova chave enfileirava o mesmo texto.                                                                                        | corrigido no E10, `097502c8`                                                                                                                                |
| F3  | P1   | Sem trava pós-restore no código. Banco antigo restaura linha, binding e vínculo revogados; leitura revogada volta mesmo com flags off.                                                                            | aberto: procedimento obrigatório no [recovery](../../../docs/runbooks/seller-whatsapp-recovery.md#restore); decisão de trava antes do piloto (Tech Lead/PO) |
| F4  | P1   | Sem limite de envio por usuário. O único teto é o worker serial (≈1/s), e uma sessão pode encher a fila compartilhada.                                                                                            | aberto: piloto limitado a 2 vendedores; Backend antes de ampliar                                                                                            |
| F5  | P1   | O job PostgreSQL do CI parou no `test:olist:live` desde `0d6645f8`: a fixture contava a contract `0081`, e as suítes depois dele não rodaram no CI. Depois dela, o upgrade de cobrança não listava `0082`/`0083`. | corrigido, `0f16c0f5` e `997c51b7`                                                                                                                          |
| F6  | P2   | As suítes `test/integration/*` (E08/E10) e o drill não rodavam no CI.                                                                                                                                             | corrigido: novo passo no job PostgreSQL. E07 exige build e Chromium e segue como gate local                                                                 |
| F7  | P2   | Rate limits por IP e por processo, não por usuário; SSE sem teto por usuário (uma aba em excesso bloqueia outro vendedor); ingresso n8n sem limite de taxa.                                                       | aberto: piloto com 1 processo e 2 vendedores; Backend                                                                                                       |
| F8  | P2   | Comando entregue depois do backup só reconcilia como `failed`, sem caminho de operador para marcá-lo como enviado.                                                                                                | aberto: procedimento proíbe reenvio; Backend                                                                                                                |
| F9  | P2   | Flags WAP não constavam no EASYPANEL-TOPOLOGY nem no exemplo de ambiente do Evolution.                                                                                                                            | corrigido nesta entrega                                                                                                                                     |
| F10 | P3   | Recibo `read`/`failed` atrasado de geração anterior é recusado como `WHATSAPP_GENERATION_STALE`, e a mensagem fica `sent`.                                                                                        | aberto: E08 (validar pela origem reservada)                                                                                                                 |
| F11 | P3   | `shared:true` aparece a vendedor sem vínculo e revela que outras carteiras guardam o Contact.                                                                                                                     | aberto: E03, decisão do PO sobre WAP-25                                                                                                                     |
| F12 | P3   | Prévia Olist mostra nome e final do CPF de comprador de carteira privada a vendedor com `order.read`.                                                                                                             | resolvido: regra do PO em 18/11, leituras de Pedido e Olist com escopo do leitor (`feb69b24`)                                                               |
| F13 | P3   | Higiene de configuração. `ORDER_SUBJECT_*` não falha no boot e aceita lista sem validação. Há parser de ingresso duplicado e um byte NUL em `n8n-runtime.js:450`, que faz grep pular o arquivo.                   | aberto: donos E05/E04; sem efeito fail-open                                                                                                                 |
| F14 | P3   | Desligar o envio transforma comandos `queued` em `failed` terminal; o vendedor reenvia.                                                                                                                           | documentado no [desligamento](../../../docs/runbooks/seller-whatsapp-recovery.md#desligamento)                                                              |

Nenhum P0. Nenhum caminho permite a outro vendedor ler conversa, identidade,
mídia, Assunto, replay ou projeção SSE pessoal pelo vínculo de carteira ou por
ID direto. Nota para o PO: o eco do aparelho para um número novo cria vínculo
de carteira com proveniência `personal_outbound`. A spec não proíbe esse
comportamento. Confirme se ele é desejado.

## Commits

| SHA        | Fronteira | Conteúdo                                                |
| ---------- | --------- | ------------------------------------------------------- |
| `097502c8` | E10       | F2: envio incerto bloqueia através de ciclos encerrados |
| `0f16c0f5` | E05       | F5: fixture de upgrade Olist conta só migrações expand  |
| `997c51b7` | E08       | F5: upgrade de cobrança inclui `0082`/`0083`            |
| `31919110` | E05/E06   | F1: Pedido legado na linha geral com alvo desligado     |

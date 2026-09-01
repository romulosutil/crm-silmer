# T00.6 — Gate de aprovação da Fase 0

## Resultado local

Os defaults técnicos e as designações necessárias estão registrados em
`docs/phase0/domain-decisions.json`. O registro é deliberadamente um gate
**pendente**: nenhuma aprovação, nomeação ou data humana foi inferida.

Enquanto Produto, Operação e Privacidade não registrarem as revisões exigidas,
e Tech Lead, equipe e Administrador Técnico não forem designados, T02, T03 e
T05 permanecem bloqueadas pelo critério da T00.6.

## Status operacional reconciliado

Em 01/09/2026, a T00.5 está concluída na issue `#9`; a T00.6 permanece `pending-human-approval` na issue `#10`, mantendo T02, T03 e T05 bloqueadas.

A fonte humana do status operacional corrente é `docs/phase0/PHASE-0-APPROVAL-GATE.md`; `docs/phase0/domain-decisions.json` é o espelho executável fail-closed. Evidência local não equivale a aprovação humana.

Reconciliação revisada e aprovada em 01/09/2026 por Rômulo Sutil Corrêa (`github:romulosutil`).

## Defaults aguardando confirmação

| ID       | Default proposto                                                            | Revisão exigida               |
| -------- | --------------------------------------------------------------------------- | ----------------------------- |
| D00.6-01 | Confirmação de pagamento exige pessoa com `COMMERCIAL_ADMIN` (`Admin`)      | Produto e Operação            |
| D00.6-02 | Um Negócio possui zero ou um Pedido no MVP                                  | Produto                       |
| D00.6-03 | Mensagem após conversa terminal abre novo ciclo no mesmo Contato            | Produto e Operação            |
| D00.6-04 | PDF é a Ficha canônica; XLSX editável não integra o MVP                     | Rose e Operação               |
| D00.6-05 | BRL em centavos; operação em `America/Sao_Paulo`; persistência em UTC       | Produto e Operação            |
| D00.6-06 | Exceção de pagamento é manual, auditável e não libera Ficha automaticamente | Produto e Operação            |
| D00.6-07 | Envelope provisório da seção 13 do TDD                                      | Produto, Operação e Tech Lead |

O envelope D00.6-07 referencia `docs/phase0/load-envelope.json`; aprovadores
devem confirmar ou substituir a baseline antes da T07.1. A validação automática
impede que uma alteração local transforme evidência técnica em aprovação.

## Papéis e separação de funções

- **Tech Lead:** pessoa ainda não designada pela Silmer.
- **Equipe de entrega:** integrantes ainda não designados pela Silmer e Tech
  Lead.
- **Administrador Técnico:** executor de `TECHNICAL_PRIVACY_EXECUTOR` ainda não
  designado; deve usar MFA e não pode ser a mesma autoridade que decide o
  `legal_hold` ou autoriza exceções de privacidade.
- **Responsável de Privacidade:** Rômulo Sutil Corrêa, já definido pelo P0.6;
  autoriza pedidos/exceções, mas não substitui a nomeação do executor técnico.

`Atendimento` e `Vendedor` são funções operacionais. `COMMERCIAL_ADMIN`
(`Admin`), `PRIVACY_OFFICER` e `TECHNICAL_PRIVACY_EXECUTOR` são capacidades
ortogonais; nenhuma é concedida implicitamente pela outra. Em particular, a
função Vendedor não aprova venda, Ficha ou fechamento sem a role adicional
`Admin`.

## Como registrar uma aprovação real

1. O revisor confirma o valor correspondente no JSON ou registra o valor
   substituto aprovado.
2. No bloco `approval`, altera `status` para `approved`, `approved` para `true`,
   informa `reviewedAt` em ISO 8601 e inclui em `evidence` um objeto com
   `reference` não vazio e `revision` no formato `git:<SHA completo>`.
3. Para uma designação, registra o identificador corporativo da pessoa em
   `assignees` no formato `silmer:<id>`, muda `status` para `designated` e
   registra data/evidência; não registrar documento pessoal.
4. Produto, Operação e Privacidade alteram cada revisão global para `approved`,
   registrando `approved: true`, data e evidência versionada.
5. Somente quando decisões, revisões e designações estiverem completas,
   `approvalGranted` pode ser `true`, o gate pode mudar para `approved` e
   `blockedPhases` pode ficar vazio.

O validador aceita somente os dois estados integrais descritos acima: baseline
pendente ou aprovação completa. Estado misto é inválido.

Até esse fluxo ser concluído, o estado correto é
`pending-human-approval` e a implementação das fases bloqueadas não deve usar
os defaults como decisão humana final.

## Verificação

```powershell
node scripts/validate-phase0-decisions.mjs
node --test test/phase0-decisions.test.js
```

Rastreabilidade: T00.6, P0.7, `PAY-02`, `FIN-01..03`, `ORD-01/02/05`,
`PRV-01..03`, `PRV-P06-12` e `ACL-P07-01..12`.

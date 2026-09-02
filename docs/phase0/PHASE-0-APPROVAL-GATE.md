# T00.6 — Gate de aprovação da Fase 0

## Resultado

Em 02/09/2026, a T00.6 foi aprovada na issue `#10` e deixou de bloquear T02, T03 e T05.

Produto, Operação e Privacidade aprovaram os sete defaults; a Silmer designou
Tech Lead, equipe de entrega e Administrador Técnico. A fonte humana e a
aceitação de risco estão em `docs/phase0/T00.6-APPROVAL-EVIDENCE.md`,
versionada no commit `1e30b67b112241415c4ab39b601bd7ba6499ed12`.

`docs/phase0/domain-decisions.json` é o espelho executável fail-closed. A
aprovação da T00.6 remove somente esse bloqueio; cada fase continua sujeita aos
próprios gates técnicos, externos e operacionais.

## Defaults aprovados

| ID       | Default aprovado                                                            | Revisores                     |
| -------- | --------------------------------------------------------------------------- | ----------------------------- |
| D00.6-01 | Confirmação de pagamento exige pessoa com `COMMERCIAL_ADMIN` (`Admin`)      | Produto e Operação            |
| D00.6-02 | Um Negócio possui zero ou um Pedido no MVP                                  | Produto                       |
| D00.6-03 | Mensagem após conversa terminal abre novo ciclo no mesmo Contato            | Produto e Operação            |
| D00.6-04 | PDF é a Ficha canônica; XLSX editável não integra o MVP                     | Rose e Operação               |
| D00.6-05 | BRL em centavos; operação em `America/Sao_Paulo`; persistência em UTC       | Produto e Operação            |
| D00.6-06 | Exceção de pagamento é manual, auditável e não libera Ficha automaticamente | Produto e Operação            |
| D00.6-07 | Envelope da seção 13 do TDD e `docs/phase0/load-envelope.json`              | Produto, Operação e Tech Lead |

O D00.6-07 mantém a baseline aprovada na issue `#8`. A T07.1 continua
responsável por comprovar a capacidade com carga real e recalibrar os SLOs.

## Papéis designados

`silmer:romulo.sutil` foi designado como:

- **Tech Lead** (`ROLE-TECH-LEAD`);
- **equipe de entrega** (`ROLE-DELIVERY-TEAM`);
- **Administrador Técnico** (`ROLE-TECHNICAL-ADMIN`), com a capacidade
  `TECHNICAL_PRIVACY_EXECUTOR` e MFA confirmado.

Rômulo Sutil Corrêa permanece também como Produto, Operação e Responsável de
Privacidade do piloto interno.

## Exceção de operação solo

A exceção `SOLO-OPS-PILOT-01` permite que a mesma identidade acumule
`PRIVACY_OFFICER` e `TECHNICAL_PRIVACY_EXECUTOR` somente no piloto interno. O
proprietário aceitou explicitamente o risco residual de concentração de
funções. A aprovação operacional não declara nova revisão da assessoria
jurídica.

Os controles compensatórios são obrigatórios e validados:

- `COMMERCIAL_ADMIN`, `PRIVACY_OFFICER` e
  `TECHNICAL_PRIVACY_EXECUTOR` continuam capacidades ortogonais;
- MFA continua obrigatório para `COMMERCIAL_ADMIN` e Administrador Técnico;
- autorização e execução de privacidade produzem eventos distintos;
- autorização nunca encadeia automaticamente a execução;
- motivo, escopo, ator e horário permanecem auditáveis;
- a exceção deve ser revista antes de piloto externo ou quando houver um
  segundo operador disponível.

Atendimento e Vendedor continuam funções operacionais e não recebem capacidade
privilegiada implicitamente.

## Como alterar esta aprovação

Qualquer mudança em default, papel, MFA ou controle compensatório exige nova
evidência humana versionada. O JSON aceita somente estado integralmente
pendente ou integralmente aprovado; estados mistos continuam inválidos.

## Verificação

```powershell
node scripts/validate-phase0-decisions.mjs
node --test test/phase0-decisions.test.js
```

Rastreabilidade: T00.6, P0.7, `PAY-02`, `FIN-01..03`, `ORD-01/02/05`,
`PRV-01..03`, `PRV-P06-12` e `ACL-P07-01..12`.

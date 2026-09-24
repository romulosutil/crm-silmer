# Ficha por produto — Checkpoint

**Branch:** `feat/ficha-por-produto` (worktree `C:\Users\sutil\.worktrees\crm-silmer-ficha`),
a partir de `feat/pedido-gerar-ficha`.
**Atualizado em:** 24/09/2026

## Feito

| Task | Commit    | Resultado                                                      |
| ---- | --------- | -------------------------------------------------------------- |
| T01  | `310a2f8` | ADR 007                                                        |
| T02  | `43231b5` | Leitor `.xlsx` sem dependência                                 |
| T03  | `c64ef6d` | Importação: 14 produtos, 62 opções, 4 escalas da planilha real |
| T04  | `dd69f34` | Resolvedor do catálogo                                         |
| T05  | `c87d889` | Item com `specs`, `escala`, `outras`; FIT-04                   |
| T06  | `9e3a0e2` | Faltantes por produto                                          |
| T07  | `e0e3fe0` | Snapshot no módulo, template v3, `PRINT_TEMPLATE` = v2         |
| T08  | `b74c16f` | PDF sintético v3 + registro `pending-human-approval`           |

## Desvios do plano

- T05: três testes existentes precisaram dos campos novos (igualdade exata do
  item do briefing e duas fixtures tipadas como `FichaItem`).
- T08: `ficha-canonical-v3.js` precisou de `prettier --write` (commit
  `c5f8477`); o HTML gerado não muda.

## Falta

T09–T13 (tela), T14 (verificação), T15 (gate humano: aprovação da v3).

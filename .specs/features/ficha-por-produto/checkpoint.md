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
| T09  | `a5b1af1` | Front lê o resolvedor; `order-items.js`; fronteira verificada  |
| T10  | `6785ae8` | Combobox com grupos; Aplicação no Resumo                       |
| T11  | `d2d08fe` | Card do item conforme o produto                                |
| T12  | `3d7247e` | Grade por escala                                               |
| T13  | `8e38282` | Fim das listas fixas e dos datalists                           |
| T14  | este      | `npm run validate` e e2e (81) passam; rastreabilidade na spec  |

## Desvios do plano

- T05: três testes existentes precisaram dos campos novos (igualdade exata do
  item do briefing e duas fixtures tipadas como `FichaItem`).
- T08: `ficha-canonical-v3.js` precisou de `prettier --write` (`c5f8477`); o
  HTML gerado não muda.
- T09: `itemPayload` ganhou o typedef `ItemPayload` (o `tsc` não enxergava os
  campos vindos do espalhamento de `core`).
- T09–T11: a linha `// <caminho>` dos blocos do plano entrou nos arquivos e foi
  removida em `6acceb2`.
- T11: o teste de "Manga" usa `getByRole('combobox')`: `getByLabel` também
  achava o grupo "Manga" da lista oculta do combobox.
- T14: conferência visual (screenshots) levou a `236f1fa`: palavras não quebram
  mais no meio na leitura, rótulos quebram na barra, viés ocupa a linha inteira
  na edição e a caixa "Outras especificações" usa o estilo dos inputs. Novo e2e
  para FIT-01.

## Falta

- **T15 (gate humano):** Rose e Operação aprovam
  `output/pdf/ficha-canonica-sintetica-v3.pdf`; depois registrar a aprovação em
  `docs/phase0/ficha-pdf-approval-v3.json` e trocar `PRINT_TEMPLATE` para v3.
  Até lá, nada vai para produção.
- **Q04:** nome de quem aprovou pelo cliente, para a RFC 005 §11.

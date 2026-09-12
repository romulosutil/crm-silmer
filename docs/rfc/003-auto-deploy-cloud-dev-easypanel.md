# RFC 003 — Auto-deploy da branch dev no EasyPanel

- Status: aceito
- Data: 2026-09-12
- Proponente e aprovador: Rômulo Sutil Corrêa
- Requisitos: ORC-01–09, INB-01–04, AGT-01–08, MSG-01–03, PRV-01–03
- Tarefa: OPS-1
- Decisão: [ADR 004](../adr/004-adotar-auto-deploy-da-branch-dev-no-easypanel.md)

## Contexto

O n8n que executa a jornada está no EasyPanel, enquanto o código do CRM é
desenvolvido localmente. O fluxo de imagens imutáveis por digest de `master` é
adequado para release, mas cria atrito indevido para testar uma alteração junto
ao n8n remoto.

## Decisão

O projeto EasyPanel é explicitamente cloud-dev. Os serviços do CRM usam a
branch Git `dev` como fonte e auto-deploy após `git push origin HEAD:dev`.
Não há merge obrigatório em `master`, GitHub Actions ou promoção por digest
para esse teste. O próprio EasyPanel constrói o commit enviado.

O CRM e o n8n compartilham somente a rede privada do projeto. O edge publica
apenas o webhook sintético DEV; a API, bancos e editor n8n permanecem privados.
O contrato CRM ↔ n8n não muda: Basic Auth distinta por sentido, idempotência,
correlação, fence por epoch/revisão e ausência de acesso direto ao banco.

## Alternativas descartadas

- **SSH/rsync com hot reload:** mais rápido para um arquivo, mas introduz uma
  cópia opaca fora do Git, conflitos de sincronização e estado não reproduzível.
- **Tag Docker mutável:** exige registry/build externo e pode fazer o painel
  executar conteúdo diferente sob o mesmo nome.
- **Continuar somente com `master` e digest:** preserva release rigoroso, mas
  não atende ao ciclo curto de teste cloud-dev.

## Aceite

- um commit de qualquer branch local pode chegar a `dev` sem merge em `master`;
- o EasyPanel reconstrói edge, API ou worker a partir daquele commit;
- o n8n alcança somente a API privada do CRM;
- o browser alcança somente o edge e o webhook sintético DEV;
- os quatro cenários DEV chegam ao CRM e preservam as proteções do contrato;
- nenhum segredo, banco ou editor n8n é exposto ou versionado.

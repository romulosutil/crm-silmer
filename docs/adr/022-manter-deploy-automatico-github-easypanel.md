# ADR 022 — Manter deploy automático GitHub → EasyPanel

Status: aceita. Data: 05/10/2026.

Decisor: PO, Rômulo Sutil Corrêa, por instrução explícita nesta entrega.
Contexto e alternativas: [RFC 010](../rfc/010-deploy-automatico-github-easypanel.md).

## Decisão

1. Usar o EasyPanel e o fluxo de deploy automático via GitHub já operados
   pela Silmer. Não reprovisionar nem introduzir outro pipeline de promoção.
2. Conferir o alvo e a origem efetivos antes de chamar o ambiente de produção.
   A informação de que o deploy é automático não identifica seu gatilho,
   branch, build ou vínculo com o resultado do CI.
3. O CI continua validando código, dependências e imagens com scan, SBOM e
   provenance. Seu sucesso e a revisão realmente implantada devem ser
   correlacionados. Não presumir que o EasyPanel espera esses gates.
4. Registrar SHA, imagem/digest ou identificador reproduzível do build e
   versão de workflow, com uma release anterior recuperável. Migrations
   seguem expand/contract; rollback não reverte banco destrutivamente.
5. DNS/TLS, exposição privada, segredos, health, backup e recuperação
   permanecem critérios de produção. Evidências antigas não são atualizadas
   para `passed` sem checagens atuais.

## Consequências

Esta decisão substitui a prescrição de promoção exclusivamente manual em
ARCHITECTURE, TECHNICAL-DESIGN e EASYPANEL-TOPOLOGY. Não altera registros
históricos de releases, nem aprova gaps de CI, backup ou privacidade.

Se o gatilho implantar antes de checks obrigatórios, registrar o gap para
correção no próprio fluxo escolhido antes do go-live. Esta entrega faz as
checagens de leitura; nenhuma alteração operacional é presumida.

Rastreabilidade: T00.2, T00.3, OPS-CHK-01, INT-3; issues
[#3](https://github.com/romulosutil/crm-silmer/issues/3) e
[#11](https://github.com/romulosutil/crm-silmer/issues/11).
Evidências: [relatório atual](../runbooks/production-readiness-checks.md).

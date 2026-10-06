# RFC 010 — Deploy automático GitHub → EasyPanel

Status: decidida em 05/10/2026 pela Silmer.
Decisão: [ADR 022](../adr/022-manter-deploy-automatico-github-easypanel.md).

## Problema e proposta

O fluxo atual informado pela Silmer faz deploy automático via GitHub no
EasyPanel. A documentação antiga descreve promoção manual de imagens e
auto-deploy desativado. Propõe-se manter o fluxo existente e auditar sua
configuração, sem criar ambientes, serviços ou outro mecanismo de deploy.

## Alternativas

- Substituir o fluxo por promoção manual: altera a operação escolhida.
- Manter o fluxo e associar cada release a SHA, imagem e evidência: escolhido.

## Aceite

OPS-CHK-01 / INT-3: registrar repositório/ref de origem, serviço alvo,
gatilho, revisão implantada, imagem/build, health, exposição de rede,
segredos por metadados, backup e rollback. A publicação GHCR pelo CI não
comprova que o EasyPanel utiliza essa imagem ou espera o CI antes do deploy.

A auditoria é somente leitura. Checks públicos não comprovam firewall,
isolamento, credenciais, backup ou saúde do worker/n8n.

Referências: [topologia](../../EASYPANEL-TOPOLOGY.md),
[relatório de checagens](../runbooks/production-readiness-checks.md).

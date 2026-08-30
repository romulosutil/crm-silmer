# T00.5 — Threat model e catálogo de dados

## Resultado local

O baseline versionado cobre ativos, atores, trust boundaries, treze famílias de
abuso e todas as nove classes da matriz P0.6. Não contém dados reais. Os
contratos executáveis são `threat-model.json` e `data-catalog.json`, validados
por `npm run validate:security-catalog` e `npm run test:security-catalog`.

Rastreabilidade: `T00.5`, `PRV-01..03` e `PRV-P06-01..12`. Controles futuros
continuam nas tarefas de implementação correspondentes; `planned` não significa
controle já implantado.

## Modelo de ameaças

Ativos prioritários: identidade e contato, conversas/anexos, Pedido/Ficha/PIX,
sessões e grants, audit trail/tombstones, segredos e artefatos de build. As
fronteiras incluem navegador/API, webhooks e mídia Meta, banco, storage privado,
operador de IA, supply chain e o plano isolado de backup/tombstones.

Cada ameaça registra ativo, fronteira, mitigação, owner, teste, requisitos e
status. A matriz cobre IDOR/ACL; CSRF/sessão; spoof/replay de webhook; SSRF de
mídia; upload malicioso; prompt injection/exfiltração; supply chain; vazamento
de segredo/log; privilégio interno; `outcome_unknown`; ressurreição em restore;
exposição de backup/storage; e DoS.

## Catálogo e retenção

Cada classe P0.6 identifica PII, finalidade, sistemas/cópias, atores/operadores,
gatilho, prazo máximo, destino, `legal_hold` e propagação da exclusão. Logs têm
retenção operacional de 30 dias e teto jurídico de 90 dias. Backups expiram em
35 dias e todo restore reaplica tombstones antes de ficar ready.

Cópias já entregues em WhatsApp, Instagram ou ao dispositivo da destinatária
da Ficha são limitações por destino: o CRM registra a limitação e aciona o
procedimento operacional, sem alegar exclusão técnica que não controla.

## Aprovação

- Tech Lead: **pending**.
- Responsável de Privacidade, Rômulo Sutil Corrêa: **pending**.

Nenhuma assinatura ou aprovação humana foi inferida desta evidência local.

# T00.5 — Threat model e catálogo de dados

## Resultado local

O baseline versionado cobre ativos, atores, trust boundaries, quinze famílias
de abuso e todas as dez classes da matriz P0.6. Não contém dados reais. Os
contratos executáveis são `threat-model.json`, `data-catalog.json` e
`security-review.json`, validados por `npm run validate:security-catalog` e
`npm run test:security-catalog`.

Rastreabilidade: `T00.5`, `PRV-01..03` e `PRV-P06-01..12`. Controles futuros
continuam nas tarefas de implementação correspondentes; `planned` não significa
controle já implantado.

## Modelo de ameaças

Ativos prioritários: identidade e contato, conversas/anexos, Pedido/Ficha/PIX,
sessões e grants, audit trail/tombstones, segredos e artefatos de build. As
fronteiras incluem navegador/API, webhooks e mídia Meta, banco, volume privado
da VPS, handoff operacional ao Dropbox, operador de IA, supply chain e o plano
isolado de backup/tombstones.

Cada ameaça registra ativo, fronteira, mitigação, owner, teste, requisitos e
status. A matriz cobre IDOR/ACL; CSRF/sessão; spoof/replay de webhook; SSRF de
mídia; upload malicioso; prompt injection/exfiltração; supply chain; vazamento
de segredo/log; privilégio interno; `outcome_unknown`; ressurreição em restore;
exposição de backup/storage; e DoS.

## Catálogo e retenção

Cada classe P0.6 identifica PII, finalidade, sistemas/cópias, atores/operadores,
gatilho, prazo máximo, destino, `legal_hold` e propagação da exclusão. Mídia
transitória tem teto de sete dias e vence antes se a jornada encerrar; bytes
ficam fora do backup e arquivos válidos usam recibo manual do Dropbox. Logs têm
retenção operacional de 30 dias e teto jurídico de 90 dias. Backups expiram em
35 dias e todo restore reaplica tombstones antes de ficar ready.

Cópias já entregues em WhatsApp, Instagram ou ao dispositivo da destinatária
da Ficha são limitações por destino: o CRM registra a limitação e aciona o
procedimento operacional, sem alegar exclusão técnica que não controla.

## Aprovação

- Tech Lead: **approved** por Rômulo Sutil Corrêa
  (`github:romulosutil`), sob delegação explícita para a issue `#9`.
- Responsável de Privacidade: **approved** por Rômulo Sutil Corrêa
  (`github:romulosutil`).
- Data: `2026-09-01T11:32:24Z`.
- Revisão avaliada: `git:a0d5d6e4fa1d4521c84cb69e66777461e6719e20`.
- Evidência humana: issue `#9`, comentário `5493274558`.
- Registro executável: `docs/phase0/security-review.json`, com SHA-256 dos dois
  artefatos, disposição versionada dos cinco findings e validação fail-closed.

A aprovação valida a suficiência do modelo e do catálogo; não transforma
controles `planned` em controles implantados ou evidência operacional. Produção
Gemini com PII permanece bloqueada até a conclusão dos gates live da issue
`#5`.

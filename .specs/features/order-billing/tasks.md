# Cobranças InfinitePay — entrega

Contrato [COB-01–16](spec.md), RFC 045 / ADR 058.

## COB-DEL-01 — Implementar o fluxo aprovado

Entrega vertical atômica, com um commit/push. T01–04 da RFC são fronteiras
da implementação integrada; T05 distingue gates locais da ativação real.

- [x] Protótipo avaliado e implementação autorizada pelo proprietário.
- [x] COB-T01: ADR, contrato e fontes canônicas.
- [x] COB-T02: migração, ACL, saldo, quitação e recuperação.
- [x] COB-T03: fila/worker, reserva e workflow n8n importável.
- [x] COB-T04: pedido, revisão, compartilhamento e conciliação.
- [x] COB-T05 local: gates, PostgreSQL sintético, E2E/axe e QA independente.
- [x] Commit/push atômicos e limites operacionais documentados.

Evidências locais em Node 24.20.0/npm 11.19.0: `npm run validate` com
1.760 aprovados e 13 skips; nove suítes PostgreSQL 17 sintético serializadas
com 69/69 aprovados, incluindo concorrência com a loja e UUIDs em caixa
diferente; E2E completo com 520 aprovados e sete skips. A revisão independente
de segurança encerrou sem achados após corrigir repetição com resposta perdida;
a revisão de interface conferiu desktop, 390/320 px, claro/escuro, foco,
anúncios de atualização e alvos de 44 px. Detector sem achados. Auditoria sem
alta/crítica, mantendo uma baixa e cinco moderadas preexistentes. Nenhuma
dependência adicionada. Export/expressões n8n verificados com dados sintéticos.
Após o ajuste final de feedback, `validate` repetido com sucesso e os 11 E2E
de cobranças aprovados novamente; revisão final de interface com decisão ship.

## COB-OPS-01 — Ativação e homologação reais

- [ ] Aplicar migração 0055 antes de habilitar código.
- [ ] Conferir conta/credenciais, workflow privado, URLs e flags.
- [ ] Observar pagamento real autorizado, duplicidade e recuperação;
      preservar taxas e conferir devolução do teste.
- [ ] Rollback mantém callbacks dos links emitidos.

Gates locais não comprovam conta remota, deploy ou pagamento real. Evidências
e passo a passo no [runbook](../../../docs/runbooks/order-billing.md).

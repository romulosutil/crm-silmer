# ADR 092 — Sanitização pré-persistência e geração na origem

Data: 16/11/2026. Status: aceita pelo proprietário para implementação e prova
isolada; habilitação operacional permanece bloqueada.
RFC: [069](../rfc/069-ingresso-efemero-e-geracao-autenticada-do-whatsapp.md).
Requisitos: WAP-02/03/04/10/12, WAP-E01/WAP-T01-01.
Antecedentes: ADRs 090/091 e [PR 391](https://github.com/romulosutil/crm-silmer/pull/391).

## Contexto

O spike de WAP-E01 detectou credencial em claro no input inicial persistido
pelo n8n, apesar das flags de não salvar execuções. Também demonstrou que a
configuração mutável de webhook e o token global não provam a geração de
eventos recebidos antes de um reconnect. Os detalhes e alternativas estão na
RFC 069 e no runbook seller-whatsapp-provider.

## Decisão

1. Aplicar patches estreitos e verificáveis por hash às imagens fixadas de
   n8n/Evolution, com default off, paths/instâncias em allowlist e build
   fail-closed em fonte divergente. Sem serviço ou infraestrutura nova.
2. No n8n, autenticar nativamente antes de projetar envelope mínimo sem
   credenciais e antes de qualquer persistência inicial. Caminhos pessoais
   recusam configurações inseguras; manual/partial/retry não contornam o guard.
   QR/código continuam efêmeros e síncronos, fora de jobs e persistência.
3. Na Evolution, capturar contexto imutável de source e credencial por socket
   antes da fila. Propagar pela cadeia async e pelos retries; nunca consultar
   a geração atual para reclassificar evento antigo. Token de transporte e
   token da geração têm funções separadas.
   O snapshot Prisma de creds omite pairingCode antes do primeiro SQL, sem
   modificar o objeto em memória ou as chaves de sessão; logout posterior
   não é controle de não persistência no WAL.
4. Validar source/token no ingresso contra binding imutável e autorização
   vigente, antes de iniciar execução. O spike usa verificador sintético;
   integração CRM real permanece em E02/E04 pelo contrato técnico autorizado,
   sem acesso n8n ao banco CRM ou alteração do Basic vigente.
5. Manter produção desabilitada. Provar ausência de segredo em banco, WAL,
   dumps, snapshots e logs, incluindo manual/em progresso, e provar evento
   atrasado após reconnect. Mobile e retenção multi-instância permanecem gates
   separados. Não transformar prova sintética em homologação.

Esta decisão detalha a ADR 091 e não a reescreve. Contact/carteira, ACL comercial,
snapshots, linha geral, retenção e reservas mantêm seus contratos. Nenhuma
capacidade comercial ou endpoint de produto é entregue por este patch.

## Consequências

O custo é manter patches auditáveis contra duas versões upstream, com falha de
build em incompatibilidade e repetição da prova ao atualizar imagens. Limpeza
posterior ou redaction de leitura não são alternativas equivalentes. Instância
por geração é diferida por efeitos ainda não provados sobre sessão e recovery.
Rollback com ingresso pessoal habilitado exige imagem compatível; retirar o
patch primeiro exige desligar o ingresso, preservando ledger/ACL e incertezas.

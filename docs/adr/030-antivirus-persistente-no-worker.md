# ADR 030 — Antivírus persistente no worker

Status: aceita. Data: 10/10/2026.
Decisor: usuário solicitante, «vamos usar clamd então».
Proposta: [RFC 018](../rfc/018-antivirus-persistente-no-worker.md).
Requisitos: [MED-26 e MED-30](../../.specs/features/inbox-media-rustfs/spec.md).
Entrega: [T29](../../.specs/features/inbox-media-rustfs/tasks.md).
Issue/PR: não criadas nesta entrega.

## Contexto

A validação de uma PNG sintética de 117 bytes consumiu 9.326 ms no antivírus,
3 ms em libmagic e 84 ms em ffprobe. O `clamscan` carregava as assinaturas a
cada arquivo. A inspeção continua obrigatória em MED-26.

## Decisão

Manter um processo `clamd` supervisionado dentro do worker existente. Usar
`clamdscan` com passagem de descritor pelo socket Unix privado. Não habilitar
TCP nem criar serviço adicional. Preservar os limites de CPU e memória.

Falha do daemon bloqueia mídia e aparece no healthcheck. Não há fallback
silencioso para outro motor. O processamento de texto não aguarda o CDN.
Atualizações reiniciam o motor sem cargas concorrentes e só publicam o
marcador de atualização após confirmar prontidão. Cada scan conserva a
data das assinaturas observada antes da execução.

## Consequências

O carregamento passa para a inicialização e para a atualização das
assinaturas. O daemon ocupa memória continuamente. Durante sua recuperação,
a mídia permanece indisponível e segue a política existente de retry.
Arquivos infectados, assinaturas vencidas, formatos e codecs inválidos
continuam rejeitados. Gravações conservam inspeção da entrada e da saída.

Esta decisão complementa a ADR 029 e não altera storage, retenção, ACL,
idempotência ou os gates externos de produção. A integração e o rollback
locais constam no runbook da mídia.

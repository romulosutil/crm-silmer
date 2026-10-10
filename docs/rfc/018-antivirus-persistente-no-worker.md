# RFC 018 — Antivírus persistente no worker

Status: aceita em 10/10/2026 por instrução do usuário.
Decisão: [ADR 030](../adr/030-antivirus-persistente-no-worker.md).
Requisitos: [MED-26 e MED-30](../../.specs/features/inbox-media-rustfs/spec.md).
Tarefa: [T29](../../.specs/features/inbox-media-rustfs/tasks.md).
Issue/PR: não criadas nesta entrega.

## Problema e alternativas

O carregamento das assinaturas por arquivo domina a espera do vendedor.
Remover o antivírus quebraria MED-26. Continuar com `clamscan` preservaria
o custo de inicialização. Um serviço separado exigiria infraestrutura e
operação adicionais. O usuário escolheu `clamd` dentro do worker existente.

## Contrato da entrega

Usar socket Unix privado e motor persistente. Conservar rejeição de malware,
scanner indisponível, assinaturas com mais de 36 horas e bytes inválidos.
Reiniciar sem dois motores carregados simultaneamente. Publicar atualização
somente após readiness. Medir o mesmo arquivo sintético antes/depois e
testar imagem, áudio, vídeo e normalização na imagem construída.

## Fontes

[ClamAV: scanning](https://docs.clamav.net/manual/Usage/Scanning.html) e
[protocolo clamd](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).
As medições locais são evidência do ambiente de desenvolvimento.

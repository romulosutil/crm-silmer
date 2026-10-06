# Contexto — mídia do vendedor no chat

Data: 05/10/2026. Status: decisões do usuário capturadas; detalhes propostos.

## Feature Boundary

Enviar imagem, áudio e vídeo na Caixa de Entrada; gravar áudio pelo microfone;
armazenar no RustFS existente; testar com n8n DEV sem WhatsApp.

## Implementation Decisions

- Usuário escolheu RustFS já existente: não contratar R2 nesta entrega.
- Usuário escolheu anexar áudio e gravar pelo microfone.
- Usuário retirou o prazo de sete dias: manter mídia enviada salva por enquanto.
- Planejamento solicitado com tlc-spec-driven; não iniciar implementação.
- EasyPanel e console RustFS autorizados para inspeção; nenhuma alteração remota feita.

## Evidência da inspeção

Inspeção somente leitura em 05/10/2026 nas abas autenticadas fornecidas.

| Sinal              | Observado                                                      | Limite da evidência                                      |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| Serviço            | RustFS no projeto schedule do EasyPanel                        | Não comprova conectividade a partir dos containers CRM   |
| Imagem configurada | rustfs/rustfs:1.0.0-alpha.99                                   | Digest/runtime efetivo ainda não conferidos              |
| Console            | https://schedule-rustfs.jicnzg.easypanel.host/ → porta 9001    | Não usar como endpoint S3                                |
| S3                 | https://s3-schedule-rustfs.jicnzg.easypanel.host/ → porta 9000 | Rota observada; operações S3 autenticadas não executadas |
| Bucket listado     | hermes-backups, privado                                        | Não reutilizar nem alterar                               |
| Volumes            | data0..data3 em /data/rustfs0..3; logs em /app/logs            | Quatro volumes não comprovam quatro discos físicos ou HA |
| Backups de volume  | Página informa ausência de backups de volume                   | Não prova ausência de outro mecanismo externo            |

Credenciais não copiadas, criadas, reveladas nem armazenadas no repositório.
Não houve PUT/DELETE, alteração de política, deploy ou upgrade do RustFS.

## Declined / Undiscussed Gray Areas → Assumptions

Detalhes não discutidos foram registrados em spec.md: limites, formatos,
legendas, uma mídia por mensagem, duração, quotas, limpeza de rascunhos,
matriz de browsers e recovery. São propostas, sem alegar aprovação do usuário.

## Specific References

- Fluxo DEV versionado: ops/n8n/workflows/create-dev-test-workflow.mjs.
- Inbox atual: apps/edge-web/src/views/InboxView.vue.
- Mapa consultado: graphify-out/2026-09-23/graph.json; achados confirmados
  no código atual, sem gerar nem versionar grafo.
- Não há .specs/STATE.md anterior nem lessons confirmadas no projeto.

## Deferred Ideas

Receptor DEV separado, câmera, múltiplos anexos, PDF, IA multimodal, upload
de arte do Pedido e política futura de retenção são entregas independentes.

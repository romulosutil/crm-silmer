# Contexto — mídia do vendedor no chat

Data: 05/10/2026. Status: decisões do usuário capturadas; detalhes propostos.

T15 (06/10): n8n 2.38.7 real confirmou o ramo humano com bytes PNG/OGG/MP4,
15 execuções, atualização publicada efetivamente executada e reimport
idempotente. Pico default/concurrency1: 1467297792 bytes com vídeo 16 MiB
e limite 2 GiB/1 CPU, somente efeitos Meta simulados. Registros iniciais
soft-deleted contêm categorias recipient/caption: produção Privacy T23
permanece não atendida, apesar de zero canários binários em DB/WAL/FS/logs.
Mídia ready semeada manualmente; worker construído/transporte completo T24
pendentes. Detalhes e fontes no design, execution e runbook.

## Feature Boundary

Enviar imagem, áudio e vídeo na Caixa de Entrada; gravar áudio pelo microfone;
armazenar no RustFS existente; testar com n8n DEV sem WhatsApp.

## Implementation Decisions

- UAT de 06/10/2026 reportou cinco problemas: Prepare falha, seletor nativo
  sem tema, mic colado ao envio, composição pouco familiar e Enviar anexo
  bloqueado. Registro FAILED; gravação no DOM não comprova ouvir/descarte.
- A demo4183 usada no teste tinha CHAT_MEDIA_ENABLED=false; isso explica
  upload404 e ausência de ready. Corrigir o ambiente sem afrouxar CSRF/ACL.
- O pedido de UX autoriza validação automática na seleção/parada e uma barra
  integrada de anexar/gravar/enviar, com prévia, legenda e envio explícito.
  Atualizar interações de testes da ação Preparar obsoleta preservando negativos,
  idempotência, scanner e limites. São MED-30..32/T25; fechar T24 após nova UAT.

- Usuário escolheu RustFS já existente: não contratar R2 nesta entrega.
- Usuário escolheu anexar áudio e gravar pelo microfone.
- Usuário retirou o prazo de sete dias: manter mídia enviada salva por enquanto.
- Planejamento solicitado com tlc-spec-driven; implementação e uso de subagentes autorizados posteriormente pelo usuário.
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

## Finding da revisão independente — T26

A revisão T25 encontrou lacuna em MED-32: a recusa HTTP conhecida de envio
era mostrada como resultado incerto. A correção distingue causas públicas
seguras e ações de retry/revisão, preservando anexo, chave e payload de
tentativas potencialmente aceitas. Nenhum detalhe arbitrário de erro/PII
vai à interface. É correção do contrato aprovado, sem ampliar o canal
ou alterar autorização, API, worker, RustFS e retenção.

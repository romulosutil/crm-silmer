# Mídia enviada pelo vendedor no chat — Specification

Status: implementação autorizada pelo usuário; em execução.
Data: 05/10/2026. Decisões de storage e retenção: ADR 023 / RFC 011.
Tarefa guarda-chuva: INBOX-MEDIA-1; baseline: INBOX-3/4, MSG-01..03,
PRV-01..03, T02/T06 e issue histórica #29.

## Problem Statement

O vendedor só envia texto na Caixa de Entrada. Precisa enviar imagens,
arquivos de áudio, gravações pelo microfone e vídeos na mesma conversa.
O fluxo DEV deve permitir validar os arquivos reais antes de conectar
WhatsApp. O RustFS existente será o storage privado dessas mídias.

## Goals

- Enviar uma imagem, um áudio ou um vídeo por mensagem pelo CRM.
- Gravar, ouvir, descartar ou enviar áudio pelo microfone.
- Manter anexos enviados disponíveis no histórico, sem expurgo por sete dias
  nem pelo encerramento da conversa, conforme instrução do usuário.
- Exercitar arquivos reais, permissões, reserva, callbacks e falhas no DEV.
- Preparar o envio oficial via n8n, separando teste DEV de homologação Meta.

## Out of Scope

| Feature                                                         | Reason                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Gravar vídeo ou fotografar com a câmera                         | Pedido cobre anexar imagem/vídeo e gravar áudio                                   |
| Transcrição e interpretação de mídia pela IA                    | Capacidade de envio humano, sem mudar jornada do bot                              |
| Vários anexos por mensagem, GIF, SVG, PDF e documentos          | Primeira fatia usa um arquivo image/audio/video                                   |
| Edição, compressão geral de vídeo e filtros de imagem           | Validar formato; conversão limitada à gravação de áudio                           |
| Arquivamento de arte do Pedido e integração Dropbox             | Contrato próprio; anexo do chat não promove documento comercial                   |
| Atualizar RustFS compartilhado ou mover seus volumes            | Não necessário ao planejamento; depende de homologação e janela própria           |
| Expor bucket público ou usar credencial administrativa no CRM   | Acesso mínimo e leitura por API                                                   |
| Alterar acessos ou executar deploy remoto sem revisão do escopo | Gate de ativação em T23; Docker local sintético foi autorizado para implementação |
| Receptor de chat separado ou push assíncrono na janela n8n      | Validação ocorre no CRM e no callback DEV                                         |

## Assumptions & Open Questions

| Assumption / decision     | Chosen default                                                                                         | Rationale                                                                                | Confirmed? |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------- |
| Storage                   | RustFS já existente                                                                                    | Escolha explícita do usuário                                                             | Sim        |
| Áudio                     | Anexar e gravar pelo microfone                                                                         | Resposta explícita do usuário                                                            | Sim        |
| Retenção de mídia enviada | Preservar até nova decisão de política; sem TTL de sete dias e sem apagar ao encerrar                  | Instrução explícita posterior substitui baseline transitória para esta classe            | Sim        |
| Quantidade                | Um arquivo por mensagem                                                                                | Menor fatia que atende três tipos                                                        | Proposta   |
| Limite por arquivo        | Imagem 5 MiB; áudio/vídeo 16 MiB, incluindo saída normalizada                                          | Reutiliza limites atuais de n8n-routes; validar limite Meta em bytes antes do canal real | Proposta   |
| Formatos de anexos        | JPEG/PNG; MP3, OGG/Opus e M4A/AAC; MP4 H.264 com AAC quando houver áudio                               | Allowlist estreita orientada ao canal; extensão não comprova codec                       | Proposta   |
| Gravação                  | Até 300 segundos ou 16 MiB; WebM/Opus, OGG/Opus ou MP4/AAC conforme navegador                          | API MediaRecorder exige negociação; worker normaliza gravação para OGG/Opus mono         | Proposta   |
| Legenda                   | Opcional, até 1024 caracteres, somente imagem/vídeo                                                    | Áudio não incorpora legenda de canal; texto separado continua disponível                 | Proposta   |
| Navegadores               | Chrome/Edge e Firefox desktop; Safari sujeito a UAT de gravação e playback                             | Sem presumir suporte uniforme de MIME                                                    | Proposta   |
| Upload abandonado         | Descartar após 24 horas somente se nunca vinculado a mensagem                                          | Não confundir rascunho temporário com mídia enviada preservada                           | Proposta   |
| Bucket                    | crm-silmer-chat-media e crm-silmer-chat-media-dev privados                                             | Isolamento do bucket hermes-backups e dados sintéticos DEV                               | Proposta   |
| Backup                    | Cópia externa e restauração de mídia vinculada antes de uso operacional com expectativa de recuperação | Volume persistente não comprova backup; painel não mostrou backups de volume             | Proposta   |
| Mídia legada              | Migrar apenas bytes ainda disponíveis; nunca alegar recuperar bytes já apagados                        | Nova retenção não restaura cópias perdidas                                               | Proposta   |

**Open questions:** none — todas as decisões pendentes estão registradas como
propostas acima. Endpoint/credenciais, digest, quotas, compatibilidade S3 e
backup são verificações operacionais, não fatos presumidos. O plano detalhado
foi autorizado para implementação. A autorização posterior de Docker local
permite homologação sintética isolada, sem alterar o RustFS compartilhado.
Ativação, acessos e recovery remotos continuam gates explícitos de T23.

## User Stories

### P1: Enviar arquivos na conversa

Como vendedor elegível, quero selecionar um arquivo e enviá-lo na conversa.

**Acceptance Criteria**:

1. WHEN o vendedor seleciona um JPEG/PNG de até 5 MiB THEN o CRM SHALL apresentar prévia e permitir envio explícito após validação (MED-01).
2. WHEN o vendedor seleciona MP3, OGG/Opus ou M4A/AAC de até 16 MiB THEN o CRM SHALL apresentar controles de áudio e permitir envio explícito após validação (MED-02).
3. WHEN o vendedor seleciona MP4 H.264 de até 16 MiB com AAC quando houver trilha de áudio THEN o CRM SHALL apresentar controles de vídeo e permitir envio explícito após validação (MED-03).
4. IF o arquivo ultrapassa o limite de bytes definido para seu tipo THEN a API SHALL interromper o upload e responder 413 sem publicar mídia ready (MED-04).
5. WHEN o envio válido é confirmado THEN o CRM SHALL persistir mensagem, vínculo da mídia, auditoria e comando outbox em uma única transação (MED-05).
6. IF o mesmo comando é repetido com o mesmo payload THEN o CRM SHALL devolver o resultado original sem segunda mensagem ou segunda autorização de envio (MED-06).
7. IF a mesma chave idempotente é reutilizada com outro arquivo ou outra legenda THEN a API SHALL responder 409 (MED-07).
8. IF conversa encerrada, versão obsoleta, mídia de outra conversa/ator ou vendedor sem permissão tenta enviar THEN a API SHALL impedir o envio usando 409 para conflito de estado ou 403 para falta de permissão (MED-08).
9. IF o worker detecta MIME real, codec ou duração de gravação inválidos após o upload aceito THEN o endpoint de status SHALL responder 200 com state=rejected e reason=invalid_format, impedindo o envio da mídia (MED-29).

**Independent Test**: anexar cada tipo em conversa sintética elegível; ver
uma única mensagem/outbox; repetir comando; testar outro vendedor e versão.

### P1: Gravar áudio no chat

Como vendedor, quero gravar, revisar e enviar áudio sem sair da conversa.

**Acceptance Criteria**:

1. WHEN o vendedor aciona Gravar em contexto seguro THEN o CRM SHALL solicitar somente acesso ao microfone por ação explícita (MED-09).
2. WHEN o vendedor para a gravação THEN o CRM SHALL oferecer reprodução, Descartar e Enviar sem envio automático (MED-10).
3. IF acesso ao microfone é negado ou MediaRecorder não está disponível THEN o CRM SHALL informar o motivo e manter anexos de áudio utilizáveis (MED-11).
4. WHEN a gravação chega a 300 segundos ou 16 MiB THEN o CRM SHALL parar a captura e liberar as tracks do microfone (MED-12).
5. WHEN o vendedor descarta, troca a conversa ou sai da tela THEN o CRM SHALL liberar tracks e URLs de prévia sem enviar o áudio (MED-13).
6. WHEN o worker processa uma gravação válida THEN o CRM SHALL produzir áudio OGG/Opus mono validado antes de autorizá-lo para envio (MED-14).

**Independent Test**: dispositivo sintético no E2E e microfone real no UAT;
ouvir antes de enviar, negar permissão, cancelar e atingir limites.

### P1: Histórico privado e persistente

Como vendedor autorizado à leitura, quero consultar a mídia no histórico.

**Acceptance Criteria**:

1. WHEN uma mídia enviada completa oito dias ou sua conversa é encerrada THEN o CRM SHALL preservar seus bytes e o vínculo no histórico (MED-15).
2. IF uma leitura não possui sessão válida ou autorização de conversa THEN a API SHALL negar bytes com 401 ou 403 respectivamente (MED-16).
3. WHEN uma leitura autorizada solicita um único Range válido THEN a API SHALL devolver 206 com os bytes correspondentes e Content-Range correto (MED-17).
4. IF Range está fora do tamanho ou usa múltiplos intervalos não suportados THEN a API SHALL responder 416 (MED-18).
5. IF o RustFS está indisponível ou o objeto não existe THEN o CRM SHALL mostrar unavailable/lost sem anunciar recuperação ou envio concluído (MED-19).
6. The CRM SHALL excluir chaves S3, URLs assinadas, nomes originais, bytes de mídia e conteúdo comercial dos logs e eventos SSE (MED-20).

**Independent Test**: avançar relógio oito dias, encerrar conversa, executar
worker legado, ler mídia como usuário autorizado e como outro usuário.

### P1: Testar e entregar pelo n8n

Como operador, quero validar o mesmo contrato sem WhatsApp conectado.

**Acceptance Criteria**:

1. WHEN n8n prepara um envio de mídia THEN o CRM SHALL exigir reserva message.send.requested válida e de uso único antes de qualquer efeito Meta (MED-21).
2. WHEN n8n solicita bytes por command_id THEN a API SHALL entregar somente a mídia vinculada à reserva vigente desse comando usando a identidade técnica autorizada (MED-22).
3. WHEN o fluxo DEV processa o comando THEN o n8n SHALL buscar o arquivo real e validar tamanho/hash antes de devolver callback simulado identificado como DEV (MED-23).
4. IF o resultado do envio fica incerto após início do efeito THEN o CRM SHALL registrar pendência de reconciliação sem retry cego (MED-24).
5. WHEN o vendedor opera seleção, prévia, gravação e envio somente pelo teclado THEN a UI SHALL manter foco previsível e anunciar processamento, erro e conclusão por região de status acessível (MED-25).
6. IF scanner indisponível, infectado ou com assinaturas de mais de 36 horas valida um upload THEN o CRM SHALL impedir leitura e envio dessa mídia (MED-26).
7. IF um upload permanece sem mensagem por 24 horas THEN o worker SHALL remover somente o rascunho abandonado, preservando qualquer mídia vinculada por transação concorrente (MED-27).
8. WHEN os limites de quota reservada ou processamento simultâneo são atingidos THEN a API SHALL devolver 429 sem interferir no envio de texto (MED-28).

**Independent Test**: DEV busca PNG/MP3/MP4 sintéticos; sucesso/falha/timeout;
replay; troca de epoch; hash divergente; scanner desatualizado; teclado/axe.

## Edge Cases

- Multipart truncado e Content-Length falso: MED-04; arquivo sem bytes é
  inválido e usa MED-29 se aceito para processamento assíncrono.
- Fechamento/transferência durante upload ou processamento: MED-08.
- Crash entre PUT e commit de metadados: reconciliar objeto com upload_id;
  nunca publicar ready antes de hash/scan e persistência consistente.
- Callback duplicado e status fora de ordem: MED-06/21/24, manter invariantes existentes.
- Gravação sem som, cancelada antes do primeiro chunk, falha de encoder e
  navegador que recusa MIME: MED-10..14/26; não criar mensagem vazia.
- OGG sem Opus, MP4 sem H.264, SVG disfarçado: MED-29.
- Objeto perdido: MED-19; histórico preserva metadados sem mídia inventada.
- Falta de backup externo: gate operacional separado; teste DEV não comprova recovery.
- Nova política de retenção futura: revisão própria, sem DELETE automático implícito.

## Implicit Requirements Sweep

| Dimension                  | Resolution                                                          |
| -------------------------- | ------------------------------------------------------------------- |
| Validation & bounds        | MED-04/12/26/28/29; limites e allowlist explícitos                  |
| Failure / partial failure  | MED-19/24/26; reconciliação PUT/DB e falhas de normalização         |
| Idempotency / retry        | MED-05..07/21/24; upload e comando com identidades separadas        |
| Auth & rate limits         | MED-08/16/22/28; sessão/CSRF e identidade técnica isolada           |
| Concurrency / ordering     | MED-05/08/21/27; lock de conversa e mídia, CAS e status monotônicos |
| Lifecycle                  | MED-15/27; enviado preservado, rascunho expira separadamente        |
| Observability              | MED-19/20; IDs técnicos e estados; nenhuma PII                      |
| External dependency        | MED-19/23/24/26; S3, n8n, scanner e Meta                            |
| State-transition integrity | MED-05/08/14/21; uploaded → processing → ready → attached           |

## Requirement Traceability

| Requirement ID | Story                 | Phase    | Status      | Tasks                 |
| -------------- | --------------------- | -------- | ----------- | --------------------- |
| MED-01         | Arquivo imagem        | Execute  | In Progress | T4,T7,T18,T21         |
| MED-02         | Arquivo áudio         | Execute  | In Progress | T4,T7,T18,T21         |
| MED-03         | Arquivo vídeo         | Execute  | In Progress | T4,T7,T18,T21         |
| MED-04         | Validação             | Execute  | In Progress | T4,T5,T7,T18          |
| MED-05         | Persistência atômica  | Execute  | In Progress | T2,T10,T11            |
| MED-06         | Replay                | Execute  | In Progress | T7,T10,T11,T14,T15    |
| MED-07         | Chave divergente      | Execute  | In Progress | T7,T10,T11            |
| MED-08         | Autorização/estado    | Execute  | In Progress | T7,T8,T10,T11,T21     |
| MED-09         | Microfone             | Execute  | In Progress | T19,T21               |
| MED-10         | Revisão de áudio      | Execute  | In Progress | T19,T21               |
| MED-11         | Permissão negada      | Execute  | In Progress | T19,T21               |
| MED-12         | Limites gravação      | Execute  | In Progress | T5,T19                |
| MED-13         | Liberar recursos      | Execute  | In Progress | T19,T21               |
| MED-14         | Normalização          | Execute  | In Progress | T5,T6                 |
| MED-15         | Preservação           | Execute  | In Progress | T2,T3,T9,T16,T22,T23  |
| MED-16         | Leitura privada       | Execute  | In Progress | T8,T9,T13             |
| MED-17         | Range                 | Execute  | In Progress | T3,T9,T20             |
| MED-18         | Range inválido        | Execute  | In Progress | T9                    |
| MED-19         | Falha S3              | Execute  | In Progress | T3,T6,T9,T20          |
| MED-20         | Logs privados         | Execute  | In Progress | T3,T7,T12,T13,T16,T23 |
| MED-21         | Reserva única         | Execute  | In Progress | T12,T13,T14,T15       |
| MED-22         | Bytes por comando     | Execute  | In Progress | T13,T14,T15           |
| MED-23         | DEV real              | Execute  | In Progress | T1,T15,T24            |
| MED-24         | Resultado incerto     | Execute  | In Progress | T12,T14,T15,T24       |
| MED-25         | Acessibilidade        | Execute  | In Progress | T18,T19,T20,T21,T24   |
| MED-26         | Scanner               | Execute  | In Progress | T4,T6,T7              |
| MED-27         | Órfãos                | Execute  | In Progress | T2,T22                |
| MED-28         | Quota                 | Execute  | In Progress | T2,T6,T7,T23          |
| MED-29         | Reprovação assíncrona | Execute  | In Progress | T4,T5,T6,T8           |

Coverage: 29 total, 29 mapped to tasks, 0 unmapped. Nenhum requisito Verified.

T20 implementada para MED-17/19/25, com nove cenários UI e evidências de
playback/seek/Range privado e acessibilidade em [execution.md](execution.md).
Os requisitos permanecem In Progress até integração e Verifier independente.
Correção T20 de MED-25 também cobre o foco após player removido por lost/erro,
com dois cenários discriminantes em execution.md; status permanece In Progress.

## Success Criteria

- [ ] Três tipos enviados e reproduzidos no CRM; gravação revisada antes do envio.
- [ ] Zero duplicações sob replay/concorrência e zero leitura não autorizada.
- [ ] Anexos enviados preservados após oito dias e encerramento.
- [ ] DEV busca bytes reais; resultado simulado distinguível do canal homologado.
- [ ] Verifier independente confirma ACs e executa sensor de discriminação.
- [ ] Homologação Meta e backup externo têm evidência própria antes de produção.

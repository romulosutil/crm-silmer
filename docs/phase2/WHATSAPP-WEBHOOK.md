# Webhook WhatsApp — decisões de T02.2

Status: aprovado em 02/09/2026 na execução de T02.2. Esta aprovação fixa o
contrato técnico; não comprova provisionamento de segredo, criptografia do host
ou ativação em produção.

## Rastreabilidade

- Tarefa: `T02.2`.
- Requisito: `MSG-01`.
- Controles: `TM-03`, `TM-13` e `PRV-P06`.
- Contrato anterior: adapter canônico de canais de `T02.1`.

## Decisões aprovadas

1. O corpo HTTP máximo é `1 MiB` (`1_048_576` bytes). Tipo diferente de
   `application/json` retorna `415`; excesso retorna `413`; ambos são rejeitados
   antes de autenticação, parse, consulta ou persistência.
2. A assinatura `X-Hub-Signature-256` é validada sobre os bytes exatos antes de
   UTF-8, JSON ou schema. UTF-8 inválido, JSON inválido e lote estruturalmente
   inválido retornam `400` sem efeito parcial.
3. A janela de processamento normal é de 24 horas a partir do timestamp
   confiável do evento. Callback assinado mais antigo é persistido como item de
   reconciliação e não recebe job normal de domínio.
4. O payload bruto com PII usa envelope `AES-256-GCM`, chave dedicada de 32
   bytes, versão explícita e AAD vinculada ao provedor e ao SHA-256 dos bytes
   exatos recebidos.
   O runtime produtivo falha fechado sem a chave; seu valor nunca entra no Git,
   em logs ou em evidência.
5. Evento canônico, metadados de mídia e job mínimo são persistidos na mesma
   transação PostgreSQL antes do `200`. `T02.3` implementará claim, lease,
   heartbeat, retry, dead letter e download.
6. O receiver aceita somente a WABA e o `phone_number_id` configurados, limita
   cada callback a 100 eventos/100 mídias e admite por processo até 20 requests
   por segundo, com no máximo oito persistências concorrentes; excesso retorna
   `429` com `Retry-After: 1`. A transação limita espera de lock a 1,5 s,
   statement a 2 s e duração total a 5 s; cancelamento transitório retorna
   `503` sem corpo e pode ser reenviado pela Meta. A aquisição de conexão no
   pool também expira em 5 s e usa a mesma resposta retryable.

## Invariantes

- A unicidade de evento é `(provider, provider_account_id, external_event_id)`.
- Replay com o mesmo fingerprint não cria evento, mídia, job ou auditoria.
- A mesma chave externa com fingerprint divergente é conflito explícito; nunca
  sobrescreve o registro anterior.
- Replay não altera `received_at`, a expiração do payload nem `expires_at` da
  mídia.
- Mídia entra somente como `metadata_only`; o receiver não baixa bytes nem faz
  chamadas externas.
- O evento canônico é cifrado separadamente; a AAD autentica sua identidade
  externa escopada e o fingerprint, permitindo que o worker leia o contrato
  normalizado sem reinterpretar o payload proprietário da Meta.
- O receiver conserva todo payload bruto por no máximo 30 dias. A classe de 90
  dias do catálogo fica reservada a um artefato de reconciliação separado, com
  retenção iniciada pela resolução; um callback misto nunca prolonga PII normal.
  Mídia transitória expira no menor prazo entre sete dias do recebimento e o
  encerramento da jornada.
- Logs e respostas não contêm payload, assinatura, telefone, conteúdo ou IDs de
  mídia fornecidos pelo canal.

## Evidência necessária para fechamento

- Testes negativos de tipo, tamanho, assinatura, UTF-8, JSON e schema.
- Lote integralmente validado antes da primeira transação.
- Teste concorrente em PostgreSQL real comprovando uma linha por evento, mídia
  e job.
- Rollback quando evento, mídia ou job falha.
- Verificação de que nenhum download ou regra comercial ocorre no request.
- Provisionamento externo da chave e ativação live permanecem evidências
  separadas; testes locais não as comprovam.

# T00.7 — Observabilidade e hardening mínimos

## Evidência local versionada

- A API expõe os contratos canônicos `GET /api/health/live` e
  `GET /api/health/ready`. A readiness nasce indisponível e responde 503 até a
  T01.1 injetar uma verificação PostgreSQL; verificações falsas ou com erro
  também falham fechadas. O live continua 200 sem depender do banco.
  `/health/live` permanece somente como alias temporário do bootstrap T00.1.
- Cada requisição recebe `request_id` e `correlation_id` opacos. Valores de
  entrada fora do formato técnico são substituídos e nunca ecoados.
- O logger JSON usa allowlist. Mensagem, payload, corpo, anexo, comprovante,
  telefone, e-mail, prompt, resposta, cookie, senha, segredo e token são
  descartados; somente a contagem de campos redigidos é registrada. Dimensões
  categóricas também usam vocabulários fechados por campo: valor desconhecido
  vira uma sentinela técnica, nunca o texto recebido.
- A API emite `api_requests_total`, `api_5xx_total` e `api_duration_ms`. O worker
  emite heartbeat, falhas e idade do job mais antigo sem aceitar conteúdo do job.
- A imagem runtime mantém base oficial por digest, usuário `node`, health check
  canônico e compatibilidade com filesystem read-only/capabilities removidas na
  configuração de execução já validada em T00.2/T00.3.

Audit trail é dado de negócio e não entra nestes logs. A retenção operacional
de logs é 30 dias; 90 dias é somente o teto jurídico definido em P0.6.

## Gate externo ainda aberto

`ops/observability/alerts.json` declara os sinais, limites, responsáveis e
testes, todos com estado `pending-external`. A T00.7 não alega monitor ativo.
`ops/observability/activation-gate.json` impede transição parcial e o runbook em
`ops/observability/README.md` separa baseline, observação do drill e evidência de
entrega do operador. `scripts/observability-live-probe.mjs` nunca para serviços
nem lê corpo ou headers da resposta.
Antes do piloto, o Tech Lead/DevOps deve contratar/configurar monitor fora da
VPS, definir canal de destino sem PII, simular queda da API e do worker e guardar
evidência de entrega e recuperação. Privacidade deve aprovar operador, DPA e
retenção caso erros/traces saiam da infraestrutura própria.

## Verificação local

Execute `npm run test:observability` e
`node scripts/validate-observability.mjs`. Os testes usam apenas canários
sintéticos e falham se algum conteúdo proibido surgir na saída serializada.

Rastreabilidade: tarefa T00.7; enabler de PRV-01, PRV-02 e PRV-P06-06. Não
satisfaz sozinho observabilidade completa da T06.5 nem o gate externo do piloto.

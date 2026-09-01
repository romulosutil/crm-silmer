# T00.7 — Ativação e drills de observabilidade

Este runbook executa a parte live da issue `#11` sem transformar uma checagem
local em prova de monitor ativo. O gate canônico é
[`activation-gate.json`](./activation-gate.json); enquanto operador, roteamento,
telemetria, hardening, drills e aprovação humana não transitarem juntos, o
estado permanece `pending-external`.

## Pré-requisitos humanos e externos

Antes de enviar telemetria ou interromper um serviço:

1. Privacidade aprova operador, região, DPA, subprocessadores e retenção
   operacional de 30 dias.
2. Silmer designa Tech Lead/DevOps e os destinos do operador. O repositório
   registra somente IDs `silmer:*` e aliases `operator-contact://*`, nunca
   e-mail, telefone, webhook ou credencial.
3. O monitor off-host consulta o endpoint canônico a cada 30–60 segundos e
   abre incidente após três falhas consecutivas.
4. Tech Lead autoriza uma janela de homologação em comentário versionado da
   issue `#11`; a referência deve terminar em `#issuecomment-<id>`.
5. DevOps confirma que parar API/worker não atingirá produção nem efeitos
   externos reais.

## Baseline não destrutiva

Defina as variáveis somente no processo local. O arquivo gerado fica em `var/`
e não deve ser commitado sem revisão e sanitização.

```powershell
$env:OBSERVABILITY_LIVE_URL = "https://<host>/api/health/live"
npm run smoke:observability:live
```

A evidência contém apenas URL sem query, status HTTP, duração e timestamp. Corpo,
headers e detalhes de erro de rede são descartados. Esta execução não comprova
entrega de alerta nem fecha a T00.7.

## Drill controlado da API

1. Configure o monitor e mantenha aberta a tela de incidentes do operador.
2. Exporte a autorização versionada e inicie o observador antes da intervenção:

   ```powershell
   $env:OBSERVABILITY_AUTHORIZATION_REF = "https://github.com/romulosutil/crm-silmer/issues/11#issuecomment-<id>"
   $env:OBSERVABILITY_EVIDENCE_PATH = "var/observability-api-drill.json"
   npm run drill:observability:api
   ```

3. Confirme o baseline saudável; então pare somente `silmer-api` no EasyPanel.
4. Aguarde o operador detectar e entregar o incidente. Registre no operador o
   ID opaco e os timestamps, sem payload ou contato pessoal.
5. Reinicie `silmer-api`, aguarde o endpoint voltar a `200` e confirme a
   resolução do incidente.
6. O observador grava `partial-live-evidence`: detecção e recuperação locais,
   mas `deliveryEvidenceRef` continua nulo até a evidência do operador ser
   revisada e versionada.

O script não para nem reinicia serviços. Se a API não começar saudável, se a
autorização faltar ou se não houver queda e recuperação dentro de 15 minutos,
o drill falha fechado.

## Drills dos sinais internos

Execute um cenário sintético por alerta, sem dados de cliente e sem retry de
efeito externo:

| Alerta                   | Indução controlada                                    | Prova mínima                                      |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------- |
| `api-5xx`                | rota/fixture sintético que retorna 500                | alerta redigido, entrega e recuperação            |
| `api-latency`            | latência limitada acima de 1.500 ms por cinco minutos | p95, entrega e normalização                       |
| `worker-heartbeat-stale` | parar somente `silmer-worker` por mais de 120 s       | detecção, entrega, restart e novo heartbeat       |
| `worker-oldest-job`      | reter job sintético por mais de 300 s                 | alerta sem conteúdo do job e drenagem             |
| `worker-job-failures`    | falhar job sintético uma vez                          | contador, dead-letter/reconciliação e recuperação |

Cada cenário precisa demonstrar que o sinal allowlisted chegou ao operador. Uma
captura local do `MetricRegistry` não satisfaz esse critério.

## Hardening do digest promovido

No digest realmente promovido, registre evidência de usuário não-root,
capabilities removidas, filesystem read-only e temporários limitados. Referência
de tag mutável, build local ou Dockerfile isolado não substitui a inspeção do
digest.

## Promoção da evidência

Revise os arquivos em `var/`, remova qualquer campo fora do contrato e consolide
o resultado aprovado em `docs/phase0/observability-live-evidence.json`. Cada
seção referenciada pelo gate usa um fragmento estável, por exemplo
`#api-live-unavailable`. Só então atualize `alerts.json` e
`activation-gate.json` na mesma mudança e execute:

```powershell
npm run validate:observability
npm run test:observability
```

O validador rejeita transição parcial, referência não versionada, timestamps
fora de ordem, destino com PII, segredo versionado ou aprovação humana ausente.

# ADR 002 — Adotar adaptador de integração n8n

- Status: aceito
- Data: 2026-09-07
- RFC: [RFC 001](../rfc/001-contrato-integracao-n8n-v1.md)
- Requisitos: ORC-01–09, INB-01–04, AGT-01–08, MSG-01–04, PRV-01–03
- Tarefas: N8N-1–N8N-7

## Decisão

Adotaremos um módulo de compatibilidade HTTP para a integração CRM Silmer ↔
n8n. O adaptador traduz DTOs externos para os serviços canônicos e não expõe o
banco. PostgreSQL, Contato/Identidade, Conversa, Mensagem, Negócio e Handoff
continuam autoritativos.

A autenticação n8n→CRM será exclusivamente HTTP Basic com o ator fixo
`AUTOMATION_EXECUTOR`, allowlist de ações e sobreposição explícita de segredo
atual/anterior durante rotação. Não haverá HMAC ou timestamp no contrato.
CRM→n8n usará outra credencial Basic e comandos locais imutáveis entregues pelo
worker ao `/webhook/silmer/panel-command`.

Toda saída para a Meta exige reserva atômica `message.send.requested`. Claims
de IA têm lease, token opaco criptografado e fences de revisão, último evento,
modo e `automation_epoch`. Resultado desconhecido é reconciliado, não repetido
às cegas.

## Consequências

- O domínio passa a ter briefing versionado, rodadas de IA, execuções de
  automação, comandos n8n e tentativas de entrega.
- Conversa ganha revisão de inbound e último evento; conversão em lead deixa
  de torná-la terminal.
- Handoff pode preceder Negócio, começa sem responsável e declara papel-alvo.
- A automação perde memória e deduplicação paralelas; recebe contexto e
  briefing do CRM.
- O backend permanece neutro de canal. Esta entrega ativa WhatsApp; Instagram
  continua bloqueado até a tarefa de homologação obrigatória.
- O webhook direto da Meta permanece somente como fixture de desenvolvimento
  e fica indisponível em produção após o corte.

## Operação

O workflow `k7tI6T4RhQPyJkn9` permanece inativo até contrato, migrações, API,
worker, credenciais e homologação estarem aprovados. A versão-base
`98f96069-ede2-4900-aa5c-7fec0d3b80cb` é preservada para auditoria e rollback.

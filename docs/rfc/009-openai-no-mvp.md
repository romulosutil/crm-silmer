# RFC 009 — OpenAI no MVP

Status: decidida em 05/10/2026 pela Silmer. Decisão: [ADR 021](../adr/021-adotar-openai-no-mvp.md).

## Problema e proposta

O workflow publicado em código já usa o nó OpenAI, mas os documentos de
prontidão ainda exigem a homologação da Gemini Developer API. A Silmer
confirmou OpenAI como provedor do lançamento. O MVP deve ter uma única
baseline de IA, preservando o contrato estruturado e a autoridade do CRM.

O modelo atual do workflow é `gpt-5.6-luna`, com Responses API. Esta proposta
não troca o modelo nem publica o workflow. O modelo e as opções efetivamente
implantados serão conferidos no n8n antes da entrada de dados reais.

## Alternativas

- Manter Gemini como gate do MVP: incompatível com o provedor escolhido.
- Homologar dois provedores agora: amplia o trabalho sem necessidade do piloto.
- Usar OpenAI e preservar spikes Gemini como histórico: alternativa escolhida.

## Aceite

- ORC-06: um provedor ativo e o mesmo schema validado no CRM.
- PRV-01..03: credenciais privadas, minimização e retenção comprovadas.
- OPS-AI-01: documentação aponta para a configuração real do workflow.
- A escolha de fornecedor não registra aprovação de DPA, ZDR ou smoke live.

Referências: [contrato n8n](../integrations/n8n/README.md),
[prontidão OpenAI](../integrations/openai/README.md),
[issue histórica #5](https://github.com/romulosutil/crm-silmer/issues/5).

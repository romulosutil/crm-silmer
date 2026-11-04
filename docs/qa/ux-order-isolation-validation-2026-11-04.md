# Validação ampliada de isolamento de pedidos — 04/11/2026

Rastreabilidade: **CP-09, CP-11–18, CP-29–31 / CP-T04, CP-T09; OA-01–12**.
Continua o [piloto longitudinal](ux-longitudinal-2026-11-04.md).
Escopo desta entrega: diagnóstico reproduzível, evidência e critérios para
correção. Não altera regras comerciais, não corrige os defeitos e não publica
workflow principal. Os achados abaixo permanecem abertos.

## P1 — referência inexistente altera um Pedido formal diferente

**UX-ISO-01: confirmado com modelo, callbacks e persistência reais.**

O mesmo cliente sintético UX Sintético 003 voltou em um quarto ciclo. Após
“Oi, voltei para continuar.”, o agente respondeu normalmente. Pelo contrato
humano do CRM, somente o Pedido **43-CRM** foi vinculado ao novo ciclo, sem
selecionar Assunto atual. O 44-CRM do mesmo Contato continuou fora desse ciclo.

Mensagem enviada no executor privado:

> No pedido 999999-CRM, mude a quantidade para 31 peças e a cor para roxa.

O CRM retornava apenas 43-CRM como alvo possível; não havia 999999-CRM nesse
contexto. Mesmo assim, a decisão selecionou o ID do 43-CRM, extraiu cor roxa
e quantidade 31 e registrou nas notas “Alteração solicitada no pedido
999999-CRM.” O fluxo transferiu por `external_context`, com o motivo legado
`human_requested`, **mas enviou também o patch comercial para o alvo errado**.

O readback do inbound e dois GETs humanos independentes das fichas confirmaram:

| Campo de 43-CRM      | Antes     | Depois                |
| -------------------- | --------- | --------------------- |
| Versão               | 3         | 4                     |
| Cor do item          | azuis     | roxa                  |
| Quantidade informada | 24        | 31                    |
| Grade oficial        | 9 M + 9 G | 9 M + 9 G, preservada |
| Total calculado      | 18        | 18, preservado        |
| Situação             | pendente  | pendente              |

A ficha completa de **44-CRM permaneceu igual**, incluindo sua versão.
A UI exibiu 43-CRM com o alerta de divergência entre grade 18 e quantidade
informada 31. Esse alerta funcionou; não impediu a associação ao Pedido errado.

IDs de correlação do ensaio, somente dados sintéticos:

- Execução: `ux-val-20261104`, ondas técnicas 4 e 5; dois turnos reais novos.
- Evento da falha: `ux-val-20261104-unknown-1`.
- Contato: `contact-1aeb9dcb-c31e-4171-a671-5be9c88f91d5`.
- Conversa: `conversation-d4d37f74-da17-460f-81f9-bd54c9949ede`.
- Alvo escolhido indevidamente: `680a0560-bb54-41b5-bd52-7b1073334428` (43-CRM).
- Assunto escolhido: `4e1ff673-336a-4343-b697-42eb7b96a034`.

**Causa:** no Code node `Montar contexto da IA (MVP)`, `mentionedOrders` inclui
apenas referências conhecidas. Uma referência desconhecida vira lista vazia,
permitindo o fallback para o único pendente. O callback é estruturalmente
válido para o CRM, mas representa uma intenção diferente da mensagem.
Fonte: SDK `k7tI6T4RhQPyJkn9-mvp-simple.sdk.js`, seleção em torno de 1439–1453.

**Aceite da correção:** uma referência explícita desconhecida deve impedir
qualquer patch comercial em um pedido conhecido. Perguntar ou transferir é
válido; transferir junto com alteração indevida não é. Repetir com um e vários
pedidos, número conhecido correto, confirmado, inexistente e referência
conflitante com seleção humana. Conferir todas as fichas antes/depois.

## Outras classes confirmadas nas regras executáveis

| ID / prioridade    | Caso e resultado atual                                                                                                                                                                                 | Causa e aceite de correção                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UX-ISO-02 / P1** | Coleta A anterior, nenhum Assunto, pedido B explícito: quatro frases permitem patch novo com dados herdados. A mistura deste mecanismo já foi persistida no piloto anterior.                           | `newOrderRequest` exige Assuntos; bootstrap reutiliza briefing. Não aplicar B no briefing A, sem abrir Pedido automaticamente.                                          |
| **UX-ISO-03 / P1** | “Quero 7 polos verdes em um pedido separado das camisetas.”, com A vinculado: seleciona A e aceita polos/7/verde.                                                                                      | Regex cobre outro/novo/segundo e plural “pedidos separados”, mas omite singular “pedido separado”. Preservar A e encaminhar a nova intenção com alvo seguro.            |
| **UX-ISO-04 / P1** | “Quero iniciar outro pedido separado: polos.” seguido de “Serão 7 peças verdes.”: última execução reúne os textos, porém seleciona A e aceita o patch. Ocorre também com a intenção no meio da rajada. | Seleção acontece antes da concatenação da rajada. A segurança precisa considerar toda a rodada antes de escolher o alvo; testar cada posição e conflitos entre números. |
| **UX-ISO-05 / P2** | “Agora quero azul.” e “Também quero estampa nas costas.”, com único alvo inequívoco: perdem o alvo e transferem por ambiguidade.                                                                       | Regex ampla trata “agora/também quero” como novo pedido. Adição/correção de campo do mesmo pedido deve continuar sem perder o escopo.                                   |

**Nível de evidência:** UX-ISO-01 e o mecanismo UX-ISO-02 têm observação real
de persistência. UX-ISO-03–05 foram reproduzidos nos Code nodes reais, com a
extração do modelo fornecida como entrada controlada; não houve nova chamada
LLM ou persistência nesses casos. Não se atribui ao modelo um resultado gerado
apenas pelo teste determinístico.

O merge do briefing é superficial e preserva campos omitidos; ignora `null`
antes do merge em `modules/n8n-integration/src/postgres-repository.js`, método
`#mergeBriefing`, em torno de 1928–1937. Isso explica a sobrevivência dos dados
de A, mas não deve ser alterado globalmente como se toda correção de campo
fosse um novo pedido. O bloqueio precisa acontecer na fronteira de intenção
e alvo, preservando a coleta incremental legítima.

## Política deliberada reclassificada

A transferência `external_context → human_requested` observada no piloto
anterior segue a [ADR 013](../adr/013-pedido-do-zero-e-meta-de-meia-ficha.md).
A decisão documenta inclusive o rótulo “Pediu uma pessoa” para esse motivo.
Portanto, não é contada entre as cinco classes de defeito. A alteração dessa
política para permitir retomada automática de pedidos conhecidos precisa de
decisão de produto; não se deve mudar o mapeamento para fazer o teste passar.

## Auditoria executável e controles

`scripts/ux-order-isolation-audit.mjs` executa somente os Code nodes de contexto
e normalização do workflow revisado. Não chama n8n, modelo ou banco. Compara
os resultados com um oráculo independente de segurança e devolve exit code
**1** se houver violações. Não preenche desfechos de conversas simuladas.

Resultado da execução desta entrega: **24 casos, 14 conformes e 10 violações**,
distribuídas nas cinco classes acima. O resultado foi idêntico no snapshot
versionado e no export operacional congelado usado no ensaio real. Isso não
é taxa de erro de clientes, medida de conversão ou benchmark estatístico LLM.

Controles incluem primeira intenção sem briefing anterior, referência válida
a A/B, ambiguidade com dois pedidos, referência desconhecida com múltiplos
pedidos, correção simples, intenção nova na última mensagem da rajada e a
política legada de transferência. Solicitar esclarecimento sem patch também
é aceito pelo oráculo; ele não exige transferência como única solução.

```sh
node scripts/ux-order-isolation-audit.mjs ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json relatorio-novo.json
node --test test/ux-order-isolation-audit.test.js
```

O relatório é criado com `wx`, recusando sobrescrita. Um teste de saída falha
não autoriza ignorar o diagnóstico: a suíte unitária testa a confiabilidade
do auditor, enquanto a execução acima mede as regras e continua falhando.
**Testes do auditor aprovados não significam defeitos corrigidos.**

Proveniência do ensaio real: export principal congelado, versão
`b4407864-c649-4b23-b59b-5baf7aa31ac9`, SHA-256
`8176d7b30181354ba446d336104f79921ee4b84092799050c8b8f8f08be71757`.
Workflow QA privado manual e inativo, com modelo e CRM reais e transporte
WhatsApp simulado. O principal não foi importado nem publicado. A retenção
de execução da cópia está desligada; evidência foi baixada pelo operador.

## Encerramento e próximos passos

O quarto ciclo foi encerrado pelo contrato humano normal. A sessão API criada
nesta rodada foi revogada e o arquivo temporário de autenticação removido.
Os dois pedidos sintéticos continuam pendentes; 43-CRM mantém a alteração
observada para revisão, e 44-CRM permanece íntegro. Não há pagamento ou
cliente real envolvido. Não foi feito expurgo nem restauração silenciosa.

Ordem recomendada: proteger referência desconhecida, fronteira de intenção
antes do Assunto, posição na rajada e variações de linguagem; depois reduzir
falsos positivos. Reexecutar os casos mantendo os controles, aplicar o patch
somente à cópia QA e repetir snapshots completos antes de publicar.

A campanha longitudinal de 190 sessões continua preparada. Esta rodada
acrescentou dois turnos reais aos 13 anteriores e 24 casos determinísticos;
não a substitui. Docker e WSL não estão instalados, e não foi criado banco
dedicado. A campanha em massa continua dependente desse ambiente; testes
PostgreSQL que recriam schemas não foram apontados para o CRM compartilhado.

Validação do código do auditor: `npm run validate` aprovado, incluindo
formatação, tipos, lint, fronteiras, contratos, **1.715 testes aprovados,
10 ignorados, zero falhas** e build. Inclui seis testes novos do auditor;
as dez violações funcionais são resultado separado e continuam abertas.
O primeiro gate no sandbox encontrou `EPERM` em um teste existente de
hardlink de áudio; a repetição completa fora dessa restrição passou. O build
mantém o aviso preexistente de tamanho do bundle. Revisão independente de QA
aprovou o diagnóstico, com os limites de execução declarados acima.

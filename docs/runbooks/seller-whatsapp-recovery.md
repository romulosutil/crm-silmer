# WhatsApp pessoal — desligamento, implantação em fases e restore

WAP-T05-03 (WAP-10/11/12/16/29/33), ADRs 090/091. Consolida os rollbacks
de [controle](seller-whatsapp-control.md), [ingresso](seller-whatsapp-inbound.md),
[Pedido por Assunto](seller-whatsapp-orders.md), [saídas](seller-whatsapp-outbound.md)
e [carteira](seller-clients.md). Este runbook não autoriza implantação,
pareamento ou efeito real. A prova abaixo é local e sintética.

## Desligamento

1. Desligar as flags pessoais na API, no worker, no n8n e no Evolution:
   `SELLER_WHATSAPP_FIRST_SEND_ENABLED`, `SELLER_WHATSAPP_SEND_ENABLED`,
   `ORDER_SUBJECT_CREATION_ENABLED`, `SELLER_WHATSAPP_INBOUND_ENABLED`,
   `SELLER_WHATSAPP_CONTROL_ENABLED`, `SILMER_WAP_INGRESS_ENABLED`,
   `SILMER_WAP_CONTROL_ENABLED` e `SILMER_WAP_GENERATION_ENABLED`. Remova também
   as allowlists. Mantenha `SELLER_CLIENTS_ENABLED` ligado se a carteira
   deve continuar visível: ela não cria efeito externo.
2. Efeito esperado, conferido no drill (fase B):
   - connect, desafio, envio humano, primeiro envio e Pedido por alvo
     respondem fail-closed (`503`/`409`), sem bytes de desafio;
   - o sweep de controle não agenda nada;
   - o worker não despacha comando pessoal.
3. Comandos pessoais em `queued` viram `failed` (`WHATSAPP_SEND_UNAVAILABLE`)
   com `whatsapp_dispatched_at` nulo. O vendedor reenvia depois, por
   decisão humana. `outcome_unknown` não é repetido e sua reconciliação
   continua aberta.
4. Preserva-se carteira, ACL pessoal, histórico, ledger, revogações, Pedidos,
   Assuntos e snapshots. O titular continua lendo a própria conversa, mesmo
   desconectado. Outro vendedor continua negado. Nunca fazer down destrutivo,
   apagar instância ou reativar geração antiga.

## Implantação em fases

Ordem obrigatória, cada passo com as flags do passo seguinte desligadas:

1. API, worker e migrações expand compatíveis (até `0083`), com todas as flags
   pessoais desligadas. A migração contract `0081` roda em passo explícito,
   depois de instalar os leitores compatíveis.
2. Workflows n8n candidatos, inativos ou com allowlist de linhas vazia. Nada
   despacha enquanto as flags da API estiverem desligadas.
3. Flags por allowlist, um vendedor por vez. Primeiro ingresso, envio e
   carteira; depois primeiro envio; por último Pedido por alvo.
4. Em cada passo, confirmar que o vendedor fora da allowlist segue recusado.

Gate do primeiro envio: `SELLER_WHATSAPP_FIRST_SEND_ENABLED` continua
desligada em ambiente real até o WAP-E12 provar que o JID da resposta
coincide com o `+E164` gravado ([saídas](seller-whatsapp-outbound.md)).

## Rollback de binário

Depois que existem Pedidos com múltiplos alvos, **binário anterior ao E05
não é rollback permitido**. Na `f5833287`, `findPendingByConversation`
devolve uma linha arbitrária e o `INSERT` omite `origin_subject_id`. A
readiness dessa versão aceita o schema mais novo, logo nada impede o boot.
A escolha do SHA é um controle de procedimento.

| SHA                     | Permitido | Como foi testado                                                                    |
| ----------------------- | --------- | ----------------------------------------------------------------------------------- |
| `f5833287` (pré-E05)    | Não       | Leitura de código e sonda real contra o banco restaurado: escolheu um alvo pendente |
| `ded870d7` (fim do E09) | Sim       | Export por `git archive`, `npm ci` próprio, saídas 7/7 e Assunto 14/14, zero skips  |
| HEAD do E11             | Sim       | Drill completo com `SELLER_WHATSAPP_FIRST_SEND_ENABLED=false`                       |

As migrações são idênticas entre `ded870d7` e o HEAD (`0083`). Voltar para
`ded870d7` remove o primeiro envio: desligue-o antes e reconcilie os envios
pendentes.

## Restore

O código não tem trava pós-restore. Cada permissão de envio, de ingresso e de
leitura deriva das linhas do banco. Um snapshot antigo restaura linha
conectada, binding ativo e vínculo de carteira ativo, mesmo que tenham sido
revogados depois do backup. O drill (fase D3) confirmou as quatro
consequências:

- um comando entregue depois do backup volta a ser entregável;
- o primeiro envio fica disponível numa geração revogada;
- um callback da geração revogada volta a ser aceito;
- o vendedor com vínculo revogado volta a ler a conversa, **com todas as flags
  desligadas**, porque a ACL de leitura é dado e não configuração.

Até haver uma trava no código (lacuna P1 em [validation-etapa1](../../.specs/features/seller-whatsapp/validation-etapa1.md)),
o procedimento abaixo é obrigatório e precede qualquer liberação de tráfego:

1. Manter a API em manutenção, sem tráfego de usuário, com todas as flags
   pessoais desligadas, conforme o
   [restore de desastre](../../EASYPANEL-TOPOLOGY.md#restore-de-desastre-real).
2. Levantar, fora do banco restaurado, as revogações posteriores ao backup:
   desconexões de linha, revogações de vínculo, inativações de usuário e
   sessões encerradas. Use o registro operacional e o estado lido do provedor.
   Não há ledger dessas revogações. O ledger de tombstones cobre só exclusões.
3. Reemitir cada revogação de linha pelo comando de desconexão do titular. A
   flag de controle fica ligada só para aquele vendedor, e a revogação local é
   imediata. Reaplicar as revogações de vínculo como Admin.
4. Fazer uma passagem do worker com o envio desligado. Os comandos `queued`
   restaurados viram `failed`. Se o provedor mostrar que um deles já foi
   entregue depois do backup, **não reenviar**. Registrar a divergência para
   conciliação manual, porque não existe caminho de operador para marcá-lo
   como enviado.
5. Desafios em voo não são retomados: a resposta é `409
WHATSAPP_OPERATION_UNCERTAIN`, sem bytes. Nenhum QR ou código existe no
   banco, então nenhum é restaurado. O job de preparo em voo vira
   `dead_letter` e só o `reconcile` de leitura é elegível.
6. Religar as flags pela ordem de [implantação em fases](#implantação-em-fases).
   Conferir que o primeiro envio mostra `line_unavailable` para a linha
   revogada e que o callback da geração antiga recebe `FORBIDDEN`.

Restore remoto ou do EasyPanel, RPO/RTO, restore do banco do n8n e
reemparelhamento real não foram ensaiados aqui. Eles seguem nos gates de
[recovery](../../ops/recovery/RUNBOOK.md) e no WAP-E12.

## Evidência do drill

`test/integration/seller-whatsapp-recovery-drill.test.js` usa os harnesses
reais de primeiro envio, saídas e controle: migrações com `0081`, rotas por
`inject`, nós Code gerados do n8n, adapter real de controle Evolution e
transporte stub local. Não há HTTP externo. O guard aceita só loopback e
`crm_silmer_test[_x]`. O restore é `CREATE DATABASE … TEMPLATE`, um snapshot
físico local, não um restore remoto.

```sh
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54340/crm_silmer_test_c \
TEST_RESTORE_DATABASE_URL=postgres://postgres@127.0.0.1:54340/crm_silmer_test_d \
node --test test/integration/seller-whatsapp-recovery-drill.test.js
```

- Fases A (seed) a D4 (reconciliação): 7/7 em três execuções consecutivas,
  zero skips. PostgreSQL 17.10, Node 24.20.0, 18/11/2026. O CI passa a rodar
  o drill no job PostgreSQL.
- O digest restaurado coincide com o anterior ao backup em todas as tabelas
  `crm`. Varredura de canário em 789 colunas (texto, jsonb, bytea, arrays;
  bruto, base64, base64url e hex) no banco vivo e no restaurado: zero
  ocorrências. Nos logs também zero.
- Depois de D4, Pedidos, Assuntos, briefings, Contacts, identidades e
  resultados de controle permanecem idênticos. Nenhuma tabela perdeu linhas.
  O único vínculo inativo é o revogado de novo, e o `outcome_unknown` é
  preservado. Chamadas de transporte depois do restore: zero.

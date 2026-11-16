# ADR 091 — Contratos da etapa 1 do WhatsApp pessoal

Data: 16/11/2026. Status: decidida pelo Tech Lead no SDD solicitado pelo
proprietário; implementação e aceite operacional pendentes.
RFC: [067](../rfc/067-whatsapp-por-vendedor-e-meus-clientes.md).
Antecedente: [ADR 090](090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md),
[PR 382](https://github.com/romulosutil/crm-silmer/pull/382).
Requisitos: [WAP-01–12/16–33](../../.specs/features/seller-whatsapp/spec.md).
Entrega: [WAP-T00d](../../.specs/features/seller-whatsapp/tasks.md).
Detalhamento: [design](../../.specs/features/seller-whatsapp/design.md).
Sem issue específica; PR deste SDD vinculada no relatório da entrega.

## Contexto

A decisão de produto está fechada. O repositório ainda usa linha única no
adapter, carteira geral de Contact e criação manual por conversa, com índice
de um pendente direto por conversa. Somente expor o botão não entrega o alvo
de Assunto, a carteira durável e o isolamento aprovados. A prioridade é a prova
integrada do Pedido pela conversa, antes da expansão do primeiro envio.

## Decisão

1. Separar vínculo durável vendedor/Contact de linha/conta técnica/geração.
   Reutilizar Contact, envelopes, serviços, PostgreSQL e pipelines existentes.
   Locks/constraints garantem um número por vendedor, número sem dois titulares
   e um vínculo por vendedor/Contact; conexão não é pré-requisito do cadastro.
2. Aplicar escopo pessoal em todos os leitores, comandos e replay/SSE, antes
   de paginação/contagem; preservar ACL comercial independente e linha geral.
   Escrita compartilhada e vínculo serializam no Contact, com autorização por
   campo, CAS e auditoria sem valores pessoais em claro.
3. Manter `conversation_id` no Pedido e adicionar origem de Assunto nullable
   com FK composta à conversa, índices parciais para legado e alvo explícito,
   compatibilidade de leitores e backfill só com prova inequívoca. Estender a
   API humana existente com alvo/versionamento; criar Pedido e vínculo na mesma
   transação, sem depender da sugestão de IA. Não permitir escolha arbitrária
   de pendente em contexto ambíguo. Escritor legado não produz novo Pedido sem
   resolver alvo quando já houver múltiplos; rollout de múltiplos alvos depende
   da instalação de todos os caminhos compatíveis.
4. Ledger durável guarda intenções/metadados de controle; QR/código são entrega
   efêmera via API/n8n/gateway, sem persistência do segredo. Prova do caminho
   real e de não persistência é gate técnico anterior à habilitação, não
   autorização para desviar n8n ou guardar desafio no ledger.
5. Tratar saída do aparelho como fato externo distinto de comando de envio.
   Reconciliar por conta/ID comprovado, sem texto/horário, duplicação ou consumo
   de revisão inbound. Primeiro envio humano individual é uma fatia posterior
   ao gate WAP-T02a, ainda obrigatória para concluir a etapa 1.
6. Cada entrega de runtime já nasce com guard fail-closed/default desligado;
   T05-01 consolida a configuração, sem adiar proteção até o fim do projeto.
   Separar flags e gates de leitura/controle/inbound/envio. Rollback preserva
   ACL/carteira/ledger; após múltiplos alvos, usar somente SHA compatível com o
   modelo de origem. Publicação/piloto real continuam com autorização própria.

## Alternativas rejeitadas e consequências

Criar Pedido manual sem conversa e ligá-lo depois mudaria autorização,
primeiro contato, lastro e consultas, além do risco de Pedido solto. Remover o
índice sem nova unicidade deixaria duas criações vencerem a corrida. Manter só
o índice antigo impediria novo alvo explícito. Filtro apenas na nova aba
continuaria expondo Clientes geral/IDs/SSE. Workflow copiado por vendedor e
fallback para linha geral aumentariam os caminhos de divergência.

O custo aceito é migração aditiva com implantação em fases e auditoria dos
consumidores de Pedido por conversa. Não há nova infraestrutura ou mudança
dos dois status comerciais. A ADR 090 e decisões anteriores permanecem
imutáveis; esta ADR detalha sua implementação. Importação e sucessão ficam
na etapa 2. Falta de prova de código mobile ou privacidade bloqueia o gate
correspondente, sem fingir aceite pela exibição de QR.

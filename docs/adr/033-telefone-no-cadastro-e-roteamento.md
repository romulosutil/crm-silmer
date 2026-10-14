# ADR 033 — Telefone no cadastro e roteamento

Status: aceita em 14/10/2026 para o CRM.

RFC: [020](../rfc/020-telefone-no-cadastro-e-roteamento.md).
Requisitos: [CP-01..03, CP-19..20](../../.specs/features/cliente-pedido-assuntos/spec.md).
Tarefa: [CP-T05](../../.specs/features/cliente-pedido-assuntos/tasks.md).
Relacionados: [ADR 032](032-separar-pedido-conversa-e-assunto.md),
[ADR 026](026-midia-e-chat-do-site-no-bot.md),
[RULES.md](../../RULES.md). Issues e PRs serão ligados à tarefa.

## Contexto

O telefone é o dado disponível no WhatsApp e deve orientar a localização de
clientes no CRM. O cadastro manual por nome não sustenta esse fluxo e a
criação de Contato antes do Pedido tem etapas desnecessárias. Existem
Contatos legados sem telefone e identidades de canal que não podem ser
fundidas por inferência.

## Decisão

1. Novo Contato manual exige nome e telefone normalizado; e-mail é opcional.
   Nome permanece como identificação legível. Esta decisão substitui apenas
   a parte de cadastro manual por nome da [ADR 032](032-separar-pedido-conversa-e-assunto.md).
2. Pedido manual novo exige telefone no Contato, inclusive se ele foi criado
   antes desta decisão. O legado permanece visível e pode ser corrigido.
3. A busca por telefone cobre números de cadastro e identidades de canal
   confirmadas, inclusive históricas. Colisões são apresentadas para escolha
   humana; não há união automática nem seleção silenciosa.
4. Informar telefone no chat do site permite localizar internamente um
   possível cliente, mas não confirma identidade WhatsApp. Antes de exibir
   histórico ou alterar Pedidos anteriores, confirmar o controle do número
   pelo WhatsApp e auditar a correlação entre canais. A sessão do site não se
   une automaticamente ao Contato localizado.

## Consequências

O fluxo de Pedidos incorpora o cadastro do Contato e explica como completar
telefone de legado. A API, persistência e migração precisam impedir criação
sem telefone e suportar busca por aliases. A identidade sintética do chat em
[ADR 026](026-midia-e-chat-do-site-no-bot.md) pode identificar a sessão sem
conferir controle do telefone informado. O contrato de ingresso do chat deve
separar telefone alegado de identidade confirmada; sua publicação demanda
homologação própria. Nada nesta decisão autoriza divulgar histórico a quem
apenas informou um número.

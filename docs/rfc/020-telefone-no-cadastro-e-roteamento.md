# RFC 020 — Telefone no cadastro e roteamento

Status: decidida em 14/10/2026; implantação do chat do site exige contrato e
homologação próprios.

Responsável: Tech Lead. Aprovador: PO, que definiu telefone obrigatório nos
novos cadastros e pedidos e e-mail opcional, preservando legados para correção.

Requisitos: [CP-01..03, CP-19..20](../../.specs/features/cliente-pedido-assuntos/spec.md).
Tarefa: [CP-T05](../../.specs/features/cliente-pedido-assuntos/tasks.md).
Decisão: [ADR 033](../adr/033-telefone-no-cadastro-e-roteamento.md).

## Contexto e impacto

A entrada principal de clientes é o WhatsApp. O cadastro manual anterior
permitia somente nome, criando uma etapa separada e pouco clara antes do
Pedido. O site poderá ter chat direto, mas um número digitado por visitante
não comprova que ele controla a identidade WhatsApp correspondente.

## Opções

1. Continuar roteando por nome: permite homônimos e não aproveita o telefone
   recebido no WhatsApp.
2. Exigir telefone novo, buscar números normalizados e apresentar duplicatas
   para decisão humana: preserva a consulta de registros antigos e torna o
   fluxo manual previsível.
3. Unir automaticamente contatos com o mesmo número: perde a distinção entre
   identidade de canal comprovada e dado apenas informado.

## Recomendação e resultado

Adotar a opção 2. Nome é rótulo legível, e-mail é opcional. Um novo Pedido
manual exige Contato com telefone; contato legado continua consultável para
correção. O cadastro de Contato é uma etapa integrada à criação do Pedido.
Busca telefônica encontra números cadastrados e identidades de canal
existentes, preserva duplicatas e pede escolha humana. O telefone digitado no
chat do site serve para localizar um possível cliente internamente. Histórico
e alterações de Pedidos anteriores exigem confirmação pelo WhatsApp. Não há
associação automática entre a sessão do site e a identidade WhatsApp.

## Critérios de aceite

- Novo Contato e Pedido manual sem telefone são rejeitados na API e na UI.
- Contato antigo sem telefone continua consultável e editável.
- Busca por número encontra também identidades WhatsApp anteriores à mudança.
- Duplicatas aparecem como alternativas explícitas; não há união automática.
- Replay de cadastro, pedido e correção não duplica efeitos.

Issues e PRs: registrar na [tarefa CP-T05](../../.specs/features/cliente-pedido-assuntos/tasks.md)
quando criados.

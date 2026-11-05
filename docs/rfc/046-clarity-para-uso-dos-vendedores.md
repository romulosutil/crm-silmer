# RFC 046 — Clarity para uso dos vendedores

Status: decidida pela solicitação explícita do proprietário em 05/11/2026;
implementação registrada na [ADR 057](../adr/057-clarity-para-uso-dos-vendedores.md).
Requisitos: [CLAR-01–06](../../.specs/features/seller-analytics/spec.md), PRV-01–03;
tarefa CLAR-T01. Issue/PR: não abertas nesta entrega.

## Problema e proposta

O proprietário forneceu o projeto `z8yldgd1xr` para entender o uso do CRM
por vendedores humanos. Navegação e marcos explícitos permitem descobrir
atritos entre atendimento, pedido e ficha, preservando o conteúdo dos clientes.

Adotar `clarity-js` oficial, com versão fixa e carregamento tardio. Sessões
somente de Vendedor, sem administrador, no host de produção existente.
Mascarar todo o documento, negar cookies/ads, respeitar GPC/DNT e restringir
metadados a páginas conhecidas. Usar chave pseudonimizada, sem nomes/e-mails.

Alternativas: snippet remoto simples é menor, mas inicia com configuração
remota desconhecida e dificulta provar ausência inicial de cookies. Analytics
exclusivo de backend não mostra fricções de navegação. Gravador sem máscaras
é incompatível com minimização. Nova infraestrutura é desnecessária.

O transporte callback do SDK aplica uma barreira por geração/contexto antes
de transmitir. Isso cobre reinícios automáticos de histórico e inatividade
que podem sobreviver a `stop()`. Respostas do coletor não executam comandos
remotos. A coleta é opcional e não participa de transações comerciais.

## Limites

Modo sem cookies fragmenta sessões; tags permitem segmentação, sem prometer
continuidade integral. URLs de detalhe contêm UUIDs internos. Máscara oculta
conteúdo em replay, mantendo geometria/interações. A chave é pseudonimizada,
não anônima. Gestão de acessos, retenção e ingestão no projeto Clarity devem
ser conferidas pelo operador; implementação não prova esses estados remotos.

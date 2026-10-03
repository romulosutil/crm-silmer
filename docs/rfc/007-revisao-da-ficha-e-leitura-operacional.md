# RFC 007 — Ficha espelhada e leitura operacional do CRM

Status: decidida para desenvolvimento pela [ADR 019](../adr/019-ficha-espelhada-e-sinais-operacionais.md); integração externa ainda proposta.

Data: 03/10/2026

Origem: pedido do PO com as referências `25-CRM-ficha-v3.pdf` (pedido real, fora do versionamento) e `ficha-canonica-sintetica-v3.pdf` (amostra). Requisitos `REV-01` a `REV-10` da [spec](../../.specs/features/pedidos-mvp/spec.md), tarefas T76–T82. PR: vincular quando o checkout Git for restaurado.

## Problema observado

A tela de pedido e a impressão precisam ser espelhos para vendedor, designers,
costureiras e embalagem. O serviço estava no resumo, embora itens do mesmo
pedido possam demandar serviços diferentes. “Modelo” e “Viés gola” induzem
decisões erradas. O dashboard não responde quantas vendas e quanto valor foram
confirmados. A lista de pedidos mostra idade da alteração, mas não a falta de
resposta do cliente. Upload de arte exige guarda durável; a mídia transitória
do canal não pode servir como arquivo do pedido (regra 18 de `RULES.md`).

O `master` já contém a v3 aprovada provisoriamente para desenvolvimento,
paginação, lastro e controle de produção em branco ([ADR 017](../adr/017-ficha-impressa-com-os-sete-pontos.md)). Seus hashes e a v2 aprovada não podem ser alterados. A assinatura física da v3 para produção ainda é pendente.

## Proposta decidida

1. O vendedor completa `tipo_servico` em cada item antes de **Gerar pedido**.
   Os sete pontos coletados pelo bot continuam os mesmos e dados parciais
   continuam salváveis. Pedidos antigos gerados sem o campo seguem legíveis.
2. O campo `tipo` passa a ser apresentado somente como **Tipo de roupa**. O
   valor histórico de `modelo` é preservado, mas deixa de ser editável ou
   impresso na nova revisão. O ponto `gola` recebe o rótulo **Definição da
   gola** e lê `vies_gola` histórico quando o ponto estiver vazio.
3. O vendedor marca, independentemente, **Feito pelo cliente** e **Feito pela
   Silmer** na seção Estampa. O agente não decide a origem. O PATCH não aceita
   bytes nem nomes de arquivo; a lista `files` fica reservada ao futuro fluxo
   autorizado.
4. A revisão impressa candidata preserva lastro, paginação e os 14 campos
   vazios de produção. Ela recebe versão própria, `ficha-canonical-v4`, com
   amostra sintética; a v3 em uso e seu gate não mudam até nova aprovação.
5. Dashboard conta somente pedidos **confirmados** como vendas e soma seu
   valor final. A lista separa “Pedido sem movimentação” do sinal “Cliente
   sem resposta”, que só usa última mensagem de saída com envio confirmado e
   tempo observado. Não há probabilidade inventada de fechamento.
6. Listas aceitam clique na área da linha e mantêm link de teclado. Eventos
   do CRM atualizam as telas; nova tentativa manual fica para falha real de
   consulta ou conexão. O glossário fixa rótulos e verbos.

## Integração preparada, sem ativação

O destino futuro é `Dropbox/CRM/<numero-do-pedido-em-minusculas>/` (por exemplo
`CRM/25-crm/`), criado no primeiro envio. A integração deve aceitar ao menos
PNG, JPEG e CDR e outros tipos definidos por allowlist após validação de MIME,
extensão, tamanho e conteúdo. O CRM deve registrar proprietário, hash, estado
de envio, localização interna e auditoria; acesso de leitura exige autorização
de pedido. Repetição do envio usa idempotência, sem criar duas pastas ou dois
registros. Nenhum token ou link público entra na ficha. A tela mostra o campo
desabilitado até haver storage durável e fluxo de recuperação.

Avisar Rose sobre pedido confirmado por n8n ou e-mail é proposta operacional.
O evento deve levar apenas identificador e link interno, com reconsulta
autorizada no CRM e deduplicação; destinatário, momento e conteúdo serão
acordados antes da criação do workflow. Celular e Meta também permanecem para
produção; esta proposta não altera seus fluxos.

## Alternativas rejeitadas

- Usar a mídia transitória de sete dias como arquivo da arte do pedido.
- Sobrescrever a v3 aprovada ou contornar o seletor único da impressão.
- Estimar chance de venda sem histórico e critério comercial validado.
- Tratar a técnica geral da arte como serviço de todos os itens.

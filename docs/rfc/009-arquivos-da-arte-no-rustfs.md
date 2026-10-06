# RFC 009 — Arquivos da arte do pedido no RustFS

Status: decidida pelo PO em 05/10/2026; registrada na [ADR 021](../adr/021-arquivos-da-arte-no-rustfs.md).

Data: 05/10/2026

Origem: o PO pediu que “Adicionar arquivos da arte” funcione na página do
pedido. A [RFC 007](007-revisao-da-ficha-e-leitura-operacional.md) deixou o
campo desabilitado até haver storage durável, validação e recuperação, e o
item POS-001 do backlog pós go-live pedia a escolha do armazenamento.
Requisitos `ARQ-01`–`ARQ-09` da [spec](../../.specs/features/pedidos-mvp/spec.md),
tarefas T88–T92 de [tasks](../../.specs/features/pedidos-mvp/tasks.md).
Design aprovado: [arquivos-da-arte.html](../design/arquivos-da-arte.html).

## Pedido do PO

- Upload e download manual pela página do pedido.
- Até 5 arquivos da arte de no máximo 10 MB cada.
- Uma **arte final**, enviada pelo vendedor, que não conta nos 5: é o sexto.
- Miniatura para imagens; ícone da extensão para CDR e outros formatos.
- Armazenamento no **RustFS**; as menções ao Dropbox saem do produto.
- Design antes do código.

## Opções avaliadas

| Opção                                  | A favor                                                                   | Contra                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Dropbox (destino previsto na RFC 007)  | Já usado pela operação                                                    | OAuth, token de terceiro, pasta fora da ACL do CRM, sem auditoria por arquivo e sem miniatura |
| Volume de mídia transitória            | Já existe                                                                 | Retenção de sete dias; a regra 18 proíbe reutilizá-lo para documento do pedido               |
| S3 externo (AWS `sa-east-1`, R2)       | Domínio de falha separado                                                 | Contrato, DPA e custo ainda não aprovados (issue `#29`)                                      |
| **RustFS no EasyPanel (escolhida)**    | S3-compatible, Apache-2.0, interno, sem custo novo, troca de endpoint simples | Mesmo domínio de falha do PostgreSQL; exige backup off-host do bucket                         |

## Recomendação aprovada

1. Serviço RustFS próprio, só na rede interna do EasyPanel, sem domínio
   público, bucket privado `crm-silmer-arquivos`. Só a API fala com ele.
2. Upload e download passam pela API: sessão, CSRF, Idempotency-Key, dono da
   conversa ou administrador, pedido pendente para mudar e leitura de pedido
   para baixar. Nada de URL pré-assinada ou link público.
3. Allowlist por extensão com assinatura do conteúdo: PNG, JPEG, WebP, CDR,
   PDF, SVG, AI, EPS, PSD, TIFF, ZIP e RAR. O download sai sempre como anexo,
   com `nosniff` e CSP `sandbox`.
4. Catálogo em `crm.order_files`: nome original cifrado, chave de objeto
   opaca, SHA-256, tamanho, autor e hora. Limite de 5 checado sob o lock do
   pedido; uma arte final por pedido, que se substitui.
5. Miniatura WebP de até 320 px gerada no navegador só para PNG, JPEG e WebP;
   o servidor não decodifica imagens. SVG mostra o ícone, porque renderizá-lo
   poderia executar script.
6. O bucket entra no backup off-host e no drill junto com o PostgreSQL. Essa
   é a condição para aceitar o mesmo domínio de falha.
7. O handoff manual de mídia válida do canal passa a anexar o arquivo ao
   pedido; o Dropbox sai de docs, política, validadores e código.

## Perguntas respondidas por padrão

O PO autorizou o código sem responder às perguntas do design; ficaram estes
padrões, revisáveis sem mudar a arquitetura:

- Arquivos e arte final mudam só com o pedido pendente; o pedido gerado é
  reaberto para mudar. O download continua para quem lê o pedido.
- “Sem estampa” não esconde a seção de arquivos.
- Gerar o pedido não exige arte final.
- Quem envia é quem edita o pedido (dono da conversa ou administrador).

## Fora deste corte

- Evento ao vivo de arquivos para outras telas abertas; quem envia vê na hora,
  os outros ao recarregar.
- Varredura antivírus dos arquivos do vendedor (o ClamAV cobre a mídia do
  canal).
- Limpeza automática de objetos órfãos deixados por uma queda entre o
  storage e o banco.
- Aviso a Rose quando a arte final chega.

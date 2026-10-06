# ADR 023 — Arquivos da arte do pedido no RustFS

Status: aceita

Data: 05/10/2026

Decisores: PO (Rômulo Sutil Corrêa) escolheu o RustFS, os limites (5
arquivos de 10 MB e uma arte final fora da conta), miniatura e ícone por
extensão e a saída do Dropbox, e aprovou o
[design](../design/arquivos-da-arte.html). Tech Lead definiu o caminho pela
API, o catálogo, a validação e a recuperação. Proposta na
[RFC 011](../rfc/011-arquivos-da-arte-no-rustfs.md). Requisitos
`ARQ-01`–`ARQ-09` da [spec](../../.specs/features/pedidos-mvp/spec.md),
tarefas T88–T92 de [tasks](../../.specs/features/pedidos-mvp/tasks.md).

## Contexto

A [ADR 019](019-ficha-espelhada-e-sinais-operacionais.md) (item 8) preparou
“Adicionar arquivos da arte” desabilitado, com destino futuro no Dropbox, até
haver storage durável, validação e auditoria. O `TECHNICAL-DESIGN.md` rejeitou
MinIO na mesma VPS por compartilhar o domínio de falha dos dados, e o S3
externo continua diferido. O PO decidiu ativar o envio no MVP com RustFS.

## Decisão

1. **RustFS interno.** O CRM usa o RustFS já existente no projeto
   `schedule` do EasyPanel (serviço `rustfs`), pela rede interna em
   `http://schedule_rustfs:9000`, com o bucket privado `crm-silmer-arquivos`
   e uma credencial só desse bucket. Só a API o acessa, por
   `OBJECT_STORAGE_*`; sem essas variáveis os arquivos ficam desligados (503)
   e o resto do pedido funciona. A API cria o bucket no primeiro envio, se a
   credencial permitir. O ambiente local usa `rustfs/rustfs:1.0.1` fixado por
   digest.
2. **Tudo pela API.** `GET/POST /orders/{id}/files`,
   `DELETE /orders/{id}/files/{fileId}`, `GET …/content` (anexo) e
   `GET …/thumbnail`. Enviar e remover são edições do pedido (`order.edit`,
   dono ou administrador, pedido pendente, CSRF e Idempotency-Key); listar e
   baixar exigem `order.read`. Não há URL pré-assinada nem link público.
3. **Limites.** Até 5 arquivos da arte (`reference`) e uma arte final
   (`final`), 10 MB cada. O limite é checado de novo sob o lock da conversa e
   do pedido; a arte final nova substitui a anterior na mesma transação.
4. **Validação.** Allowlist por extensão (PNG, JPEG, WebP, CDR, PDF, SVG, AI,
   EPS, PSD, TIFF, ZIP, RAR) e assinatura do conteúdo; nome sem caminho nem
   controle, até 120 caracteres. O download sai como anexo com `nosniff` e
   CSP `sandbox`. O nginx aceita até 11 MB só nessa rota.
5. **Catálogo.** `crm.order_files` guarda chave opaca
   (`orders/<pedido>/<arquivo>`), SHA-256, tamanho, tipo, autor e hora. O nome
   original vai cifrado no mesmo envelope AES-256-GCM da ficha. Os bytes vão
   ao RustFS antes da linha; se a linha for recusada, os bytes são apagados.
6. **Miniatura.** O navegador gera um WebP de até 320 px e 256 KB para PNG,
   JPEG e WebP e o envia junto. Outros formatos, inclusive SVG, mostram o
   ícone da extensão.
7. **Auditoria e idempotência.** Envio e remoção passam pelo executor
   idempotente (impressão digital com o SHA-256 do conteúdo); o download é
   auditado sem registro de idempotência.
8. **Recuperação.** O volume fica na mesma VPS do PostgreSQL. O risco é
   aceito no MVP com uma condição: o bucket entra no backup off-host, no drill
   e no restore, sempre junto com o PostgreSQL. Isso supersede, para os
   arquivos do pedido, a rejeição de “MinIO na mesma VPS”.
9. **Sem Dropbox.** O destino Dropbox sai do produto: a mídia válida do canal
   é anexada ao pedido pelo operador (`media_handoff_receipts.destination =
'rustfs'`, migração 0028 `NOT VALID`, que preserva recibos antigos).

## Instância em uso e desvios (05/10/2026)

O PO indicou a instância `schedule/rustfs`. A leitura do EasyPanel mostrou
desvios que bloqueiam o `objectStorageGate` até serem resolvidos ou aceitos
por escrito:

- a API S3 (9000) e o console (9001) têm domínios públicos padrão do
  EasyPanel; o CRM nunca usa o domínio público, e a recomendação é removê-los
  ou restringir o console;
- o projeto `schedule` é compartilhado com outros apps, então a credencial
  do CRM precisa de uma política restrita ao bucket `crm-silmer-arquivos`;
- a imagem e o digest da instância não foram confirmados (o console mostrava
  `v1.0.0-alpha.99`);
- o backup off-host do volume e o drill com o PostgreSQL não têm evidência.

O bucket privado `crm-silmer-arquivos` foi criado pelo console em
05/10/2026.

### Aceite do projeto compartilhado

Em 05/10/2026 o PO aceitou manter os arquivos do pedido no RustFS do projeto
`schedule`, compartilhado com outros apps, em vez de um serviço próprio do
CRM. O aceite vale com estas condições, que continuam obrigatórias:

- o CRM usa só o bucket `crm-silmer-arquivos`, com usuário e política
  restritos a ele; as chaves root da instância nunca vão para o CRM;
- o CRM acessa pela rede interna (`schedule_rustfs:9000`), nunca pelo
  domínio público;
- recuperação restaura só esse bucket, sem sobrescrever dados dos outros
  apps;
- um incidente, upgrade ou parada do `schedule/rustfs` afeta os arquivos do
  pedido; mudar para um serviço próprio exige nova ADR.

Este aceite fecha só a lacuna `shared-project` (`sharedProjectRiskAcceptedRef`
aponta para esta ADR). Domínios públicos, credencial dedicada, smoke entre
projetos, digest e backup continuam bloqueando o gate.

## Consequências

- O vendedor envia e baixa arquivos na página do pedido, com progresso,
  miniatura e confirmação de remoção acessível por teclado.
- O provisionamento do RustFS e a evidência de backup do bucket viram gates
  (`objectStorageGate` e `orderFilesBucketRestore`) antes da produção.
- Outras telas abertas não recebem evento de arquivo; veem a mudança ao
  recarregar.
- Uma queda entre o RustFS e o banco pode deixar um objeto órfão, nunca uma
  linha sem objeto. A limpeza de órfãos fica para depois.
- O `threat-model.json` e o `data-catalog.json` aprovados no T00.5 ainda
  citam o Dropbox. A troca exige nova revisão do Tech Lead e do Responsável
  de Privacidade, com os hashes atualizados em `security-review.json`.

## Relação com decisões anteriores

Supersede o item 8 da [ADR 019](019-ficha-espelhada-e-sinais-operacionais.md)
(campo desabilitado e destino Dropbox) e, para os arquivos do pedido, a
rejeição de “MinIO na mesma VPS” que o `TECHNICAL-DESIGN.md` registrava
até 05/10/2026. A
[ADR 020](020-tecnica-por-item-e-arte-do-pedido.md) continua integral: “Quem
faz a arte?” e a exigência para gerar não mudam.

# Carteira e cadastro compartilhado — WAP-E03

Fronteira WAP-T02-01–04, WAP-06/07/08/18/20/21/24–30; ADRs
[090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md) e
[091](../adr/091-contratos-da-etapa1-whatsapp-pessoal.md).
Contrato HTTP: [OpenAPI v1](../api/openapi.v1.yaml).

## Implantação e configuração

Aplicar a expansão `0078_seller_client_links` antes do runtime. Ela não associa
nenhum contato histórico e não altera os snapshots comerciais. O vínculo é
único por vendedor/Contact, tem proveniência imutável e histórico versionado;
revogar/reativar conserva o ID. Não depende da linha, conexão ou geração.

`SELLER_CLIENTS_ENABLED` é `false` por padrão. Habilitar exige a allowlist
JSON explícita `SELLER_CLIENTS_SELLER_IDS`, independente das flags de controle,
ingresso e envio do WhatsApp. Os três endpoints `/api/v1/me/clients` e
`/api/v1/me/clients/:contactId/link` negam fora desse gate; a lista própria não
exige pareamento. Sessão atual, origem, CSRF e Idempotency-Key seguem os
contratos humanos existentes. Limite global vigente: 60 requisições/minuto.

Esta entrega usa somente ambiente local dedicado e dados sintéticos. Nenhuma
flag real, pareamento, workflow, mensagem ou efeito financeiro foi autorizado.
O PostgreSQL local não homologa provedor, infraestrutura remota ou produção.

## Autoridade, transações e conflitos

Ordem dos comandos: usuário/capacidade atual → advisory de telefone (quando
aplicável) → Contact → identidade/vínculo → ledger/evento.
Edição e transições de vínculo disputam `Contact FOR UPDATE`; não atualizar
vínculo diretamente antes desse lock. Para múltiplos usuários/Contacts, travar
IDs em ordem. Identidades usam descoberta sem lock e revalidação após os locks,
sem promover acesso comercial pelo vínculo cadastral.

Cadastro pessoal cria Contact oficial e vínculo na mesma transação, sem
identidade/conversa/Pedido/envio. Selecionar existente exige acesso atual e
`expectedVersion` do Contact; reativação explícita também exige
`expectedLinkVersion`. Replay reautoriza e não ressuscita vínculo revogado.
Colisão de telefone devolve conflito sem IDs ou candidatos privados.

Campos comuns e fiscais vazios podem ser preenchidos. Alterar/remover
`personType`/`document` preenchidos exige Admin atual e
`review: { confirmed: true, reason: "…" }`. Alterar o telefone principal
compartilhado exige o mesmo gate. Valores normalizados iguais não bloqueiam
outros campos. Reenviar telefone exibido apenas como fallback de identidade
privada permite corrigir e-mail sem promover esse número ao cadastro comum.
Versão obsoleta devolve 409 sem sobrescrever o rascunho do
chamador: reler, apresentar diferenças e só reenviar após revisão humana.

Motivos livres ficam em `contact_change_reviews`, cifrados e imutáveis.
Eventos/auditoria levam códigos e nomes de campos, sem valores pessoais.
Snapshots confirmados não mudam; pendentes conservam o nome atual da ADR 018.
Olist revalida `sourceVersions.contactVersion` antes de novos efeitos; mudança
invalida a preparação. Cobrança/envio já reservados conservam identidade e
destino originais e nunca são redirecionados pelo telefone cadastral.

## Leitura e reconciliação

WAP-E09: Meus clientes permite cadastrar antes de parear, vincular um Contact
acessível e editar cadastro compartilhado com revisão administrativa dos
campos protegidos. A ficha mostra somente pedidos retornados pela lista
comercial `owner=me` com histórico cancelado, filtrados pelo Contact selecionado; mais páginas são
carregadas explicitamente. Cada Pedido mantém suas próprias autorizações. A
volta pelo rastro usa o Contact de origem somente quando coincide com o do
Pedido. Pedido de uma conversa continua exigindo o Assunto escolhido.

Conta → Meu WhatsApp usa os comandos versionados existentes. QR e código
vivem somente em memória durante o desafio, são removidos ao fechar, expirar,
ocultar a aba ou perder a sessão e não são registrados em storage ou captura
dos testes. Resultado incerto não é repetido automaticamente. A conexão por
código no mesmo celular permanece sem homologação real. Falha da linha não
impede operações locais; a Caixa informa o bloqueio e conserva o rascunho.

Carteira exige vínculo ativo. Clientes geral conserva o universo legado: linha
geral e contatos manuais comuns continuam autorizados após vínculo explícito.
Novos contatos pessoais usam `wallet_created`; remover o último vínculo ou
mover a última identidade não os torna públicos. Contatos exclusivos de linha
pessoal exigem vínculo; identidades e históricos de outra linha permanecem
privados mesmo no Contact comum. Admin lê conforme sua capacidade vigente.

Escopo precede busca, cursor, count e paginação. Cursor é assinado por leitor,
modo, filtros e versão de carteira; não reutilizar após perda de vínculo ou
mudança de leitor/perfil. SSE entrega metadados só depois de revalidar o
Contact. As buscas auxiliares de Pedido e a seleção de telefone do Olist
também filtram identidades pessoais, conservando a ACL comercial independente.

Rollout não usa autor de cadastro/pedido, telefone ou posse atual da conversa
como prova. O plano considera somente `manual_owner_id` ou crédito comercial
capturado (`sales_owner_id`/`sales_owner_captured_at`) de Pedido de atendimento
não teste. Exclui vendedores fora da allowlist e vínculos existentes, inclusive
revogados. A aplicação revalida prova e autoridade dentro da transação.

Com ambiente dedicado configurado e `SELLER_CLIENTS_ROLLOUT_ACTOR_ID` de Admin
ativo na allowlist, o comando interno abaixo produz apenas contagens, sem IDs,
PII ou URLs. Sem argumento é dry-run; `--apply` é ação explícita posterior do
operador no ambiente autorizado, não executada em produção nesta entrega.

```powershell
node scripts/reconcile-seller-clients.mjs
node scripts/reconcile-seller-clients.mjs --apply
```

## Rollback e verificação

Desligar `SELLER_CLIENTS_ENABLED` interrompe a nova fronteira; conservar expansão,
vínculos, histórico, motivos e isolamento das leituras legadas. Voltar somente a
SHA que compreenda `wallet_created`, contas pessoais e política compartilhada.
Não apagar carteira, reativar vínculo ou reconstruir posse para reverter UI.
E04 e entregas seguintes permanecem fora desta entrega.

As novas suítes PostgreSQL são executadas serialmente no job existente do CI:
`seller-client-links-postgres-live`, `seller-clients-postgres-live` e
`seller-client-identity-postgres-live`. Exigem `TEST_DATABASE_URL` apontando para
`crm_silmer_test`; elas reiniciam somente esse schema sintético. Nunca apontar
para desenvolvimento compartilhado ou produção. Evidências finais constam de
[tasks.md](../../.specs/features/seller-whatsapp/tasks.md).

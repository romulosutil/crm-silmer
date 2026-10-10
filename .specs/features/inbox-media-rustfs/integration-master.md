# Integração com master — 10/10/2026

Tarefa de integração solicitada pelo usuário: incorporar `origin/master`
`b7b26db` na branch `codex/inbox-media-rustfs-plan`, resolver conflitos e
verificar os contratos combinados. Rastreabilidade: INBOX-MEDIA-1,
MED-01..32 e tarefas T1–T28; T24 permanece pendente.

- [x] MERGE-MASTER — conflitos resolvidos, contratos combinados preservados,
      verificações integradas aprovadas e ambiente local testado pela tela.

## Migrações

Master mantém `0027_order_files`, `0028_media_handoff_rustfs` e
`0029_store_orders`. As quatro migrations do chat passam para `0030`–`0033`,
sem alterar SQL ou checksums. Relatos anteriores em `execution.md` usam os
números vigentes na data da execução.

Banco novo ou atualizado a partir de master usa o migrator normal. Somente
o banco DEV local que já aplicou os números antigos do chat requer o helper
`scripts/reconcile-chat-media-dev-ledger.mjs`. O helper é dry-run por padrão,
aceita apenas endereço e banco DEV autorizados, verifica nomes/checksums e
usa transação e o mesmo advisory lock do migrator. Não altera dados ou DDL.

Sequência local: verificar fila e uploads ociosos; reconstruir a imagem;
parar API e worker; criar snapshot protegido; executar dry-run e depois
`--apply`; aplicar migrations integradas; iniciar API e worker com a nova
imagem, preservando ambiente, credenciais, volumes e serviços de storage.
Não executar esse remapeamento em produção ou em banco com ledger diferente.

Três cenários em clones PostgreSQL passaram: banco vazio, master até `0029`
e snapshot da branch com chat nos números antigos. Foram verificados
idempotência, readiness, rejeição de checksum divergente e preservação dos
registros e timestamps. Evidência local: `var/merge-master-database-proof.json`.

## Contratos combinados

O OpenAPI conserva as rotas de mídia do vendedor e de pedido pago da loja.
Os workflows conservam envio de texto/imagem/áudio/vídeo pelo vendedor,
entrada de mídia, públicos, ficha e chat do site; DEV simula os efeitos Meta.
Geração e paridade dos workflows passaram, com 84 nós canônicos e 91 DEV/local;
66 testes focais passaram. YAML OpenAPI válido: 40 paths e 44 operation IDs
sem repetição.

A ADR 029 reafirma a decisão de mídia do chat após a colisão de numeração;
a ADR original está preservada byte a byte no diretório `docs/adr/history/`.
Master mantém ADRs 023–028 e RFCs 011–016; o RFC do chat passa a 017.

## Validação integrada

- 13 checks do projeto e build: PASS.
- Suíte geral: 981 testes, 978 aprovados, zero falhas, três skips existentes.
- PostgreSQL real: 174/174 aprovados, sem skips.
- Interface: 217 testes, 210 aprovados, zero falhas, sete skips existentes.
- Revisão independente de contratos e reconciliação: PASS; sensor isolado
  detectou quatro falhas deliberadas sem modificar o checkout real.
- API e worker locais saudáveis com imagem
  `sha256:f8f79508626bf67242ac236e84b486092bd96039db395dcc3fc46905e644c38b`;
  readiness HTTP 200. Ledger integrado e hashes/contagens de dados preservados,
  assim como ambiente, credenciais, mounts e containers de infraestrutura.

Logs: `var/merge-master-project-gates.log`, `var/merge-master-unit.log`,
`var/merge-master-sql-live.log`, `var/merge-master-ui.log`. Provas de operação:
`var/merge-master-runtime-proof.json`, `var/merge-master-live-before.json`
e `var/merge-master-live-after.json`.

O primeiro ensaio real aceitou imagem e áudio e ambos terminaram `sent`, com
job concluído em uma tentativa. Ele revelou que o sufixo `-media` criado na
fusão impedia a classificação DEV do read model. A correção conserva o
contrato de proveniência original: versões canônica `mvp-simple-14` e DEV
`dev-mvp-simple-15`, sem ampliar o regex do classificador ou alterar eventos
históricos. Os dois envios sintéticos do ensaio permanecem no histórico.
O teste de geração agora verifica também o formato reconhecido de versão DEV.

Repetição final pela tela aprovada: imagem, áudio e vídeo anexados pela
conversa sintética, validados, enviados e confirmados como `sent` no n8n.
Cada envio teve uma reserva na versão DEV 15, uma tentativa de job concluída,
erro nulo e mídia `attached`. O badge DEV voltou a aparecer. O botão liberou
em 11,395 s, 11,392 s e 10,352 s nos três fixtures, respectivamente; esses
tempos não constituem SLA para outros arquivos. Composer voltou ao estado
de resposta, sem rascunho pendente. Provas sanitizadas:
`var/merge-master-browser-proof.json` e
`var/merge-n8n-standard-browser-send-proof.json`.

Após a correção de versão, 66/66 testes n8n, lint, formatação e paridade
determinística passaram novamente. Workflow DEV local publicado e saudável,
com 91 nós. A nova transcrição de áudio recebido pelo bot permanece sem
referência de credencial neste ambiente; o envio de áudio pelo vendedor não
depende dela e foi validado. Nenhum provedor externo foi acionado pelo ensaio.

Esta integração não encerra a UAT com microfone físico, o gate de privacidade
do n8n, a homologação Meta ou os testes de recuperação em produção.

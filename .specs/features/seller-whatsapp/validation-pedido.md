# Aceite do fluxo passivo de Pedido

WAP-E07 / WAP-T02a-05, requisitos WAP-17/19/31/32/33 e ADRs 090/091.
Base revisada em 17/11/2026 no branch `codex/wap-e05`, com E05
`37d4d006`, E06 `ee89502d` e a correção do botão no cabeçalho `d7537b3c`.
O roteiro de reprodução fica no [runbook de Pedido por Assunto](../../../docs/runbooks/seller-whatsapp-orders.md#ensaio-integrado-wap-e07).

## Fronteira da prova

O ensaio integrado usa Node 24.20.0, npm 11.19.0, PostgreSQL 17.11 em loopback,
Fastify, proxy de desenvolvimento e Chromium com o build Vue da aplicação.
O evento sintético entra no endpoint de inbound do n8n com Basic e
metadados técnicos. O teste usa logins reais e percorre a carteira, a conversa,
a confirmação e a ficha sem interceptar respostas da aplicação. A queda da
linha e a resolução explícita de identidade são estados de fixture. O teste
aguarda pelo cursor SSE que o Chromium recebeu antes de abrir a confirmação.
Um reset de escopo durante a confirmação continua exigindo nova conferência.

O ensaio começa no contrato HTTP CRM/n8n. Pareamento, entrega pelo provedor,
retenção nas execuções do n8n e habilitação em produção pertencem aos gates
operacionais. O ensaio local usa dados sintéticos e nenhuma credencial real.

## Revisão dos contratos

- Inbound pessoal resolve conta, binding, geração, titular e allowlist antes
  de persistir. Com o titular ativo, conversa humana e vínculo de carteira
  persistem na mesma transação. O Contact compartilhado conserva as conversas
  por conta. A identidade de outro vendedor exige resolução explícita.
- A criação exige sessão humana e CSRF na API. Antes de consultar recibo,
  o escritor valida acesso atual à conversa e carteira, usuário, estado
  humano aberto, alvo e as guardas de ativação e compatibilidade. Pedido,
  número, vínculo, evento e recibo integram a transação.
- A ficha segue a ACL comercial em leitura e edição. O detalhe omite contexto
  de conversa e Assunto quando a leitura da conversa é revogada. O ensaio
  de upgrade cobre snapshots, adoção provada do legado e índices parciais.

## Achados da revisão

- **Foco após ressincronização SSE, corrigido.** A limpeza das projeções
  privadas levava o foco à busca mesmo com o título de Meus clientes ativo.
  `ClientsView.vue` mantém o foco no controle que continua disponível e
  recupera o foco na busca se a invalidação deixar o foco no corpo da
  página. O E2E cobre a ressincronização no título e a revogação durante a
  paginação em desktop e mobile. A limpeza síncrona ainda precede a nova
  leitura autorizada.
- **Leitura comercial direta, comportamento vigente.** `order.read` permite
  o detalhe pelo ID mesmo depois da revogação do vínculo cadastral. A
  resposta oculta conversa e Assunto e a ACL comercial bloqueia edição
  e recibo por outro vendedor. O ensaio verifica essas guardas e nega a
  leitura direta da conversa e do Assunto alheios.

## Verificações com PostgreSQL

| Comando                                                                                                                                                                                                                                                                    | Resultado                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `npm run test:orders:live`                                                                                                                                                                                                                                                 | 47 aprovados, zero falhas ou skips |
| `node --test --test-concurrency=1 test/order-subject-postgres-live.test.js test/order-assistance-postgres-live.test.js test/seller-whatsapp-inbound-postgres-live.test.js test/seller-conversation-access-postgres-live.test.js test/seller-clients-postgres-live.test.js` | 62 aprovados, zero falhas ou skips |
| `node --test test/integration/seller-whatsapp-passive-order.test.js`                                                                                                                                                                                                       | 1 aprovado, zero falhas ou skips   |

As suítes acima cobrem a transição 0080/0081, alvo novo e existente, replay,
conflito de versão, rollback transacional, concorrência com revogação, guarda
default off e allowlists, ACL cruzada, snapshots e ingressos por linha.

No ensaio integrado:

- Os dois logins acessaram o Contact provisório compartilhado e somente a
  conversa de sua própria linha. A API confirmou a atribuição humana e o
  PostgreSQL conferiu Contact, conversa, Assunto, vínculo recíproco, autor,
  responsável, número e status pendente.
- Em 1366 e 390 px, o operador abriu a conversa pela carteira, conferiu o
  Assunto e chegou à ficha com foco no título. O axe encontrou zero violações
  no diálogo. A alteração digitada na ficha retornou pela API após salvar.
- A linha B caiu após a entrada. No celular, o duplo clique gerou um único
  POST e a API criou o pendente com HTTP 201. Ao escolher o mesmo Assunto
  novamente, HTTP 200 devolveu o mesmo ID e número.
- Replay manteve o resultado autorizado. Duas chaves concorrentes no mesmo
  alvo produziram um HTTP 201 e um conflito de versão. O banco registrou
  três Pedidos, três números distintos e três eventos de criação.
- Encerramento, revogação de carteira e inativação recusaram o replay.
  Criação, reuso e edição deixaram zerados outbox, comandos do n8n, mensagens
  de saída, handoffs, assistência, cobranças e recebimentos. O encerramento
  explícito deixou somente seu comando técnico pendente para o n8n,
  sem mensagem e com zero tentativas. O ensaio rodou sem worker.
- A troca de conversa e a resposta atrasada foram exercitadas no E2E de E06
  com resposta controlada. Essa evidência cobre a guarda de navegação.
  Os IDs, a persistência, o SSE e as negativas de API foram conferidos no
  ensaio integrado com o banco real.

## Gates de contribuição

- `npm run validate` com 2.866 aprovados, zero falhas e 61 skips condicionais
  das suítes live sem URL. Os testes de mídia exigiram acesso a hard links
  locais no Windows. A execução fora da sandbox passou com as mesmas assertions.
- O ajuste final de foco passou por formatação, typecheck, ESLint e pelos nove
  E2E focais de `seller-whatsapp-isolation.spec.js` e
  `seller-whatsapp-order.spec.js`.
- `npm run test:e2e -- --workers=6` no patch final teve 1.069 aprovados, sete
  skips legados e uma falha de foco em BFUI-06, diálogo de cobrança. O caso
  passou com `npm run test:e2e -- --last-failed --workers=1`, com as mesmas
  assertions. Os cenários de Pedido e isolamento passaram na rodada completa.
- `npm audit --audit-level=high` e `npm audit --omit=dev --audit-level=high`
  com zero vulnerabilidades.

## Rollback

O ajuste de foco, o ensaio e a documentação podem ser revertidos pelo commit,
sem migração adicional. Após utilizar múltiplos alvos, o rollback operacional
de E05/E06 exige um SHA compatível com a origem de Assunto e a criação desligada.
Preserve as migrações, a carteira, as ACLs, os recibos e o histórico. Em caso
de efeito externo incerto, reconcilie pelo registro durável antes de repetir
uma operação.

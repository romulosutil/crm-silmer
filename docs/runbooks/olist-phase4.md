# Olist — Fase 4: interfaces administrativas e de pedidos

## T12 — grade monetária e conferência por Pedido

Tarefa OLIST-T12, requisitos OLIST-01–12, 21–24, 33–35 e 40–44 da
[RFC 044](../rfc/044-geracao-assistida-de-pedidos-no-olist.md). A geração real
continua desligada: esta entrega não chama `/olist/export`, não muda flags,
workers, conta, allowlist, checkout, schema ou template de impressão.
T13 (recuperação/vínculo/cancelamento), T25 (rótulos/v7) e Fases 5–6 permanecem
independentes. Não há deploy, inclusão ERP ou piloto real nesta entrega.

### Contrato da grade

- O editor usa `PATCH /orders/:id/sections/size-pricing` com versão observada,
  sessão, CSRF e idempotência. IDs de grupos/linhas vêm do servidor; edição,
  reordenação e duplicação usam os comandos existentes, sem substituir o grafo.
- Cada tamanho tem quantidade e **subtotal de todas as peças daquele tamanho**.
  Grupo soma linhas; pedido soma grupos. Totais são somente leitura. Quantidade
  alterada salva o valor antigo como não revisado e exige uma confirmação humana
  de subtotal, mesmo quando o valor aprovado permanece igual. Não se infere
  preço unitário, desconto, rateio ou compensação entre linhas.
- Valor ausente, não revisado ou soma acima do limite não aparece como total
  parcial válido. Parser e somas preservam centavos exatos. Subtotal zero,
  negativo, notação ambígua ou overflow é recusado antes do comando.
- Pendente nunca confirmado sem composição pode preparar os subtotais. A ação
  gera IDs no backend e deixa valores vazios; não distribui o total antigo.
  A confirmação do pedido envia condição de pagamento e versão, sem preço livre;
  o backend valida/calcula o total. Conflito preserva o formulário e exige
  fechar, atualizar e revisar antes de outro comando.
- Legado já confirmado usa `/orders/:id/price-breakdown`: inicialização e lote
  de subtotais explícitos, mantendo total histórico e snapshot. A loja usa
  complemento administrativo de cadastro fiscal, aplicação e entrega. Não
  oferece correção de quantidade, preço ou pagamento do checkout por este fluxo.
  O vendedor responsável/Admin edita legado; só Admin edita complemento da loja.

### Conferência Olist e acesso

O painel no Pedido lê a operação persistida. Usuário com checkbox Olist pode
conferir prévia e validar suas versões/expiração. A busca exata em `/olist`
reutiliza o mesmo painel em qualquer pedido e perfil habilitado, inclusive
Financeiro, sem acessar a API geral de pedidos, Contato ou Inbox nem conceder
edição comercial. Pendências identificam o campo conhecido e encaminham à
origem com pessoa autorizada; dados do provedor não viram texto de erro.

A prévia exibe comprador com sufixo de documento, intenção de reutilizar/criar
cliente, produto e tamanho, subtotais por linha e total. A consulta não realiza
essas criações. O backend continua responsável por conta/ACL, cadastro, preço
unitário exato, versões e limites. Fração de centavo por unidade bloqueia somente
exportação; não altera a composição válida no CRM. “Gerar no Olist” permanece
desativado incondicionalmente nesta fase, inclusive após validar uma prévia.

Tokens de prévia ficam apenas na memória do componente e são descartados em
troca de pedido, edição, alteração de versão, evento local, expiração,
401/403, revogação ou saída da tela. Reload consulta novamente a operação
persistida; não restaura token nem repete criação. Financeiro usa a releitura
de sessão existente do shell, sem abrir stream de Inbox ou novo polling.

Uma operação persistida bloqueia conservadoramente a edição comercial na UI,
inclusive o complemento. Pagamento/entrega mantêm autorização independente;
pendente exportado/vinculado só oferece confirmação com condição congelada.
O backend revalida a igualdade integral. A projeção mínima atual não informa
se uma operação `rejected`/`invalidated` já perdeu todos os efeitos/IDs: a UI
não presume desbloqueio pelo nome do estado. A distinção e recuperação ficam
para T13; não há botão de retry para resultado incerto.

### Verificação e rollback

Evidências sintéticas: `test/e2e/olist-orders.spec.js`,
`test/e2e/order-size-pricing.spec.js`,
`test/e2e/order-price-breakdown.spec.js` e `test/order-money.test.js`, além da
regressão de confirmação/reabertura em `orders.spec.js`. Logs/capturas locais
em `var/olist-t12-*` não são versionados e não homologam EasyPanel/Olist.
Resultados dos gates são registrados no fechamento da entrega.

Gates finais em 07/11/2026, Node 24.20.0/npm 11.19.0, dados sintéticos:

| Gate                           | Resultado                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run validate`             | Aprovado: 2006 testes, 1980 aprovados, 26 skips condicionais, zero falhas; formato, tipos, lint, fronteiras, tokens, validadores e build               |
| `npm run test:e2e`             | Aprovado: 535 cenários, 528 aprovados, 7 skips previstos, zero falhas; 2 workers                                                                       |
| `npm audit --audit-level=high` | Aprovado: zero altas/críticas; 1 baixa e 5 moderadas preexistentes; dependências intactas                                                              |
| Teclado/axe/reflow             | Zero violações nos cenários exercitados; prévia e grade em desktop, celular 390 e tema escuro 320; orçamento de 1800 px preservado na leitura compacta |
| Revisão independente           | `ship`: seis capturas e fonte conferidos; deltas finais de foco/guardas revistos estaticamente, sem finding material ativo                             |
| Detector / whitespace          | Detector dos componentes/views sem findings; `git diff --check` aprovado                                                                               |

A porta 4173 já atendia outro preview. O gate E2E usou configuração temporária
ignorada em `var/`, mudando apenas a porta/baseURL para 4175, sem alterar
asserções, skips ou o servidor existente. A suíte integral final passou após
corrigir altura da leitura compacta, foco após reconferência, preservação do
retorno da correção da loja e confirmação aberta durante mudança Olist.
Não houve novo ensaio PostgreSQL live nem acesso a ERP real nesta fatia de UI.

Disclosures nativos “Mais ações” recolhem duplicação, reordenação e remoção;
quantidade e revisão de subtotal continuam visíveis. Consultas automáticas não
roubam foco. Falha de leitura mantém o estado bloqueado `unavailable`; a próxima
pendência recebe foco depois da projeção atual. A correção existente da loja
preserva formulário/retorno durante `checking`, com comando bloqueado até a
leitura, e sai quando uma operação persistida impede edição.

Entrega atômica na branch `codex/olist-phase4-t12`; commit/push registrados no
fechamento da tarefa. T13/T25 e fases operacionais continuam pendentes.

Rollback reverte a UI como uma entrega, preservando composição, IDs,
subtotais revisados, complementos e operações no banco. Não apagar vínculos,
recriar cadastros, cancelar vendas ERP ou religar geração como rollback.
UI anterior com preço livre não pode sobrescrever o contrato monetário vigente.

## T11 — conexão, parâmetros centrais e mapeamentos

Tarefa OLIST-T11, requisitos OLIST-03–05, 11, 22–25 e 48 da
[RFC 044](../rfc/044-geracao-assistida-de-pedidos-no-olist.md), sobre as
[guardas da Fase 3](olist-phase3.md#t10--guardas-comerciais-e-recuperação).
T11 inicia a Fase 4; a continuação T12 está documentada acima. T13 e T25
continuam pendentes. A geração real
permanece desligada. Não há deploy, habilitação de operadora, conexão real,
cadastro, venda ou piloto como parte desta entrega.

### Contrato e operação

A rota `/olist` mantém o shell Vue, tokens e controles atuais. A capacidade
`COMMERCIAL_ADMIN` concede a administração independentemente do checkbox
Olist; esse checkbox continua obrigatório para a projeção de pedidos e não
concede administração. A API conserva a revalidação de sessão, CSRF,
capacidade, conta e idempotência existentes. Admin sem checkbox não recebe
geração nem autoelevação.

- **Conexão:** estado configurado/desconectado/conectado/reconexão, ambiente
  de produção e validade do acesso em horário de São Paulo. Autorizar usa
  somente o destino OAuth oficial permitido; desconectar envia a versão
  observada. A conta da empresa é conferida no backend. Credenciais, documentos
  da empresa e identidade da operadora não são exibidos ou editados na tela.
- **Callback:** código/estado removidos da URL antes das requisições do shell,
  consumo único em memória do módulo, sem localStorage/sessionStorage. Erro,
  campos ausentes ou duplicados não completam a conexão. Reload não repete
  a troca; retorno recusado exige iniciar nova conexão.
- **Configuração privada incompleta:** informa a pendência e impede conectar,
  editar parâmetros ou iniciar consultas sem a integração configurada.
- **Parâmetros comerciais:** leitura seguida de Editar/Salvar/Cancelar. Campos
  completos: vendedor ERP, natureza de operação, depósito, meio de pagamento,
  forma de recebimento, lista de preços, origem CRM, vencimento explícito,
  prazo textual e ordem de compra. Política fiscal para novos produtos exige
  NCM/origem/unidade completos ou os três vazios; não há defaults fiscais nem
  vencimento calculado pelo texto do prazo. Origem fiscal `0` é preservada.
- **Versão:** capturada ao abrir a edição, não no envio. A edição impede
  refresh/reconectar/desconectar; refresh impede iniciar nova edição.
  Conflito 409 mantém o rascunho, foca a explicação e bloqueia novo save.
  Cancelar carrega a versão atual; abrir Editar novamente exige revisão humana.
- **Referências comerciais:** consulta explícita de vendedores, depósitos,
  formas de pagamento/recebimento e listas de preços. A API faz somente GETs
  remotos limitados, sem endpoint arbitrário, autoplay ou polling. Natureza de
  operação e origem CRM são conferidas diretamente no Olist. Desconexão impede
  consulta remota; vazio e consulta incompleta são estados diferentes.
- **Mapeamento:** consulta exata por UUID do recurso CRM, restrita à conta;
  exibe tipo, estado e ID remoto confirmado. Funciona sobre o ledger local
  mesmo com a conexão desconectada. Não há remapeamento livre, sobrescrita de
  cadastro ou botão de repetir criação em resultado incerto. A UI de vínculo,
  histórico e recuperação por Pedido pertence à T13.
- **Respostas tardias:** troca de categoria/identificador, conexão, refresh,
  parâmetros, saída da rota ou perda de capacidade aborta/invalida consultas.
  401/403 administrativo remove os dados visíveis e direciona para nova sessão.
  Retorno atrasado não restaura dados de outra conexão ou de acesso revogado.

Erros usam mensagens fixas; conteúdo do provedor não vira mensagem de erro,
HTML ou log da UI. Nomes das referências são interpolados como texto. Nenhum
estado de domínio é salvo em `window` ou storage. Esta fatia não altera
`creationEnabled: false`, flags, jobs, runtime, transportes ou endpoints de
exportação. Também não modifica schema, dependências ou infraestrutura.

### Acessibilidade e evidências

Formulários têm labels explícitos; disclosures nativos funcionam por teclado.
Editar foca o primeiro campo; Cancelar retorna ao acionador; resultados e erros
recebem foco, com carregamento anunciado. O painel de parâmetros permanece
aberto ao recarregar após conflito. Layout de uma coluna no celular e duas
colunas nos parâmetros no desktop, com tokens dos temas claro/escuro.

Node 24.20.0/npm 11.19.0, exclusivamente com dados/provedor sintéticos:

| Gate                                                                  | Resultado                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate` final                                              | Aprovado; 1977 testes, 26 skips condicionais, zero falhas; formatação, tipos, lint, fronteiras, validadores e build                                     |
| `npm run test:e2e -- --workers=1`                                     | 502 aprovados, 7 skips previstos, zero falhas; regressão integral da implementação principal                                                            |
| `npm run test:e2e -- test/e2e/olist-phase2.spec.js --workers=2` final | 28/28, zero skips; inclui os últimos refinamentos de configuração incompleta/alinhamento e os três cenários adicionais de reconexão, limites e validade |
| `npm audit --audit-level=high`                                        | Aprovado; zero altas/críticas, 1 baixa e 5 moderadas preexistentes; dependências intactas                                                               |
| axe / visual / reflow                                                 | Zero violações nos cenários exercitados; capturas conferidas em desktop 1366, celular 390 e tema escuro 320; largura equivalente a zoom 200% exercitada |
| Revisão independente QA                                               | Sem finding material pendente; correções de foco após conflito e corrida de edição durante refresh cobertas por E2E                                     |
| Detector visual / `git diff --check`                                  | Nenhum finding mecânico no painel/tela; patch sem erro de whitespace                                                                                    |

A suíte específica cobre preservação integral dos parâmetros e origem fiscal
zero, fiscal parcial recusado, conflito e revisão explícita, refresh durante
edição, catálogos/vazio e incerteza, UUID inválido/404/429/reconexão/403,
revogação com resposta tardia, desconexão versionada, callback inválido,
nomes contendo HTML tratados como texto, reconexão por Enter no OAuth oficial
interceptado, configuração incompleta e overflow numérico. Nenhum comando
criador é adicionado ou exercitado. As guardas de API/ACL existentes continuam
cobertas pelo gate Node; não houve alteração de backend/schema nem novo ensaio
PostgreSQL live nesta fatia de UI.

Capturas e logs sintéticos ficam em `var/olist-t11-*` e
`var/olist-admin-*.png`, ignorados pelo Git. Nenhuma evidência local representa
homologação de ERP/EasyPanel. Entrega atômica OLIST-T11 na branch
`codex/olist-phase4-t11`; commit/push registrados no fechamento da tarefa.

### Rollback e continuidade

O patch pode ser revertido como uma entrega única de frontend/documentação,
sem down migration, exclusão de vínculo ou alteração de credencial. Preserve
os parâmetros já persistidos e a geração desligada; a UI antiga não deve
salvar configuração completa, pois seu formulário omite fiscal/vencimento/
recebimento. Desconectar é ação administrativa separada e versionada.

Após a T12, próximas tarefas: T13 e T25; gates de QA,
operação e piloto das Fases 5–6 continuam obrigatórios. Nada nesta tela libera
inclusões reais, amplia usuários ou troca o template da ficha.

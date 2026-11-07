# Olist — Fase 4: interfaces administrativas e de pedidos

## T13 — progresso, vínculo, histórico, reconciliação e cancelamento local

OLIST-T13 atende OLIST-16–18, 22–25, 30 e 45–47 da
[RFC 044](../rfc/044-geracao-assistida-de-pedidos-no-olist.md), sobre os contratos
T09/T23 existentes. Geração real continua desligada: não há chamada de
`/olist/export`, mudança de flags, conta, worker, allowlist ou template. T25 e
Fases 5–6 continuam independentes; não houve deploy, venda ERP ou piloto real.

### Acompanhamento e recuperação

O painel do Pedido e a busca restrita em `/olist` recuperam a operação
persistida. A etapa atual é declarada sem inventar porcentagem ou conclusão dos
cadastros anteriores. Admin comercial abre “Progresso, vínculo e histórico
Olist” para consultar cada cliente, produto pai, tamanho e venda, com estados,
IDs, versões, ator CRM da operação/consulta e tentativas com horários de São
Paulo. Histórico limitado informa os limites de 100 tentativas/consultas.
IDs externos confirmados e número da venda são texto; não se infere URL ERP.

- O checkbox autoriza a projeção/prévia; não concede administração, edição ou
  cancelamento. Admin sem checkbox pode recuperar pelo detalhe de Pedido sem
  ganhar geração. Usuários sem capacidade administrativa veem apenas a etapa
  mínima persistida, respeitando a projeção autorizada existente.
- Vínculo exige ID numérico da venda, conferência positiva do servidor,
  recibo de 15 minutos e motivo. O servidor reconsulta comprador, produtos,
  tamanhos, quantidades e subtotais antes de persistir. Token vive somente na
  memória: trocar ID, Pedido, versão, acesso, evento ou expirar o descarta.
- Reconciliação seleciona a venda ou um recurso do diagnóstico e envia a
  versão observada desse alvo, motivo, sessão/CSRF e chave idempotente. Só
  solicita leituras ERP; zero/divergência/resultado incerto não liberam nova
  criação. Resultado é consultado explicitamente, sem polling ou retry criador.
- Sucesso de comando relê a projeção de segurança e mantém diagnóstico
  anterior identificado como tal. Falha de escrita exige atualizar o
  acompanhamento antes de outro comando; não repete automaticamente o comando.
  Mudança de acesso aborta consultas e remove diagnóstico/recibos. 401/403 no
  painel pai também desmonta a recuperação, sem aguardar refresh da sessão.
- Consulta administrativa preserva o contrato atual de conexão configurada e
  válida. Desconexão/reconexão não autoriza contornar erro nem mostrar resposta
  tardia. Mensagens de erro são fixas; payload/erro privado não vira texto da UI.

### Cancelamento local e travas

`GET /orders/:id/olist` acrescenta três fatos mínimos: `cancelled`,
`commercialLocked` e `cancellationBlocked`. Os dois últimos agregam **todas as
contas**, sem dados privados e sem conceder ACL. O predicado compartilhado em
Orders também protege o comando de cancelamento após os locks já existentes.
Não há migration ou transporte novo.

Efeito de cadastro pode bloquear edição comercial e ainda permitir
cancelamento pré-venda. Reserva/ID/efeito de venda, inclusive observado em
outra conta ou após estado rejeitado/invalidado, impede cancelar. Projeção
ausente/falha conserva bloqueio; compatibilidade com projeção antiga é
conservadora. A API revalida versão, autorização e ledger atomicamente, pois
qualquer leitura da UI pode perder uma corrida.

Vendedor responsável/Admin usa “Cancelar pedido localmente”, independentemente
do checkbox; na loja só Admin. O diálogo explica terminalidade, pede motivo e
envia `expectedVersion` capturada ao abrir. Bloqueia envio duplo, preserva
motivo no conflito e exige releitura após falha/resultado não confirmado.
Escape/Voltar devolve foco após a nova projeção; sucesso foca “Pedido cancelado”.

Cancelado mantém o status comercial histórico e ganha rótulo terminal,
responsável, horário e motivo. Não oferece editar, reabrir, exportar ou cancelar
novamente. Pagamento, Nota criada e ficha/histórico permanecem; não há estorno,
cancelamento ERP ou criação automática de substituto. Filtros → Cancelados
consulta `cancellation=cancelled` no servidor antes de paginação/contagens,
inclusive na busca privada por telefone. A lista padrão mantém o universo ativo.

### Evidências e rollback

Fixtures inteiramente sintéticas em `test/e2e/olist-recovery.spec.js`,
`test/e2e/order-cancellation.spec.js` e na matriz de guardas de
`test/olist-runtime-postgres-live.test.js`. Corridas/constraints existentes
continuam em `order-cancellation-postgres-live.test.js` e
`order-olist-guards-postgres-live.test.js`. Capturas/logs locais em
`var/olist-t13-*` são ignorados e não homologam EasyPanel ou ERP real.

Rollback reverte a entrega de UI/projeção como uma unidade, preservando os
dados, vínculos, cancelamentos, snapshots e histórico. Não apagar ledger nem
reativar geração; servidor anterior deve conservar as guardas T10/T23.

### Gates locais T13 — 07/11/2026

Node 24.20.0/npm 11.19.0, dados inteiramente sintéticos:

| Gate                           | Resultado                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`             | Aprovado: 2006 testes, 1980 aprovados e 26 skips condicionais; tipos, lint, fronteiras, tokens, validadores e build sem falhas.                                               |
| E2E integral                   | Aprovado: 555 cenários e 7 skips previstos, zero falhas, 2 workers. Inclui 27 cenários novos T13 e regressões de filtros, ordem e orçamento.                                  |
| PostgreSQL dedicado            | 39/39, zero skips: runtime/projeção em todas as contas, cancelamento, locks, constraints e corridas comerciais. Banco sintético local encerrado após o gate.                  |
| Teclado/axe/visual             | Sem finding material ativo; desktop, celular 390 e tema escuro 320. Página compacta medida em 1788 px, dentro do orçamento de 1800 px.                                        |
| Revisão independente           | Frontend/A11y e QA aprovaram após corrigir foco, revogação, IDs de 19 dígitos, número textual e compactação do cancelamento.                                                  |
| Detector e whitespace          | Detector sem findings na inspeção executada; `git diff --check` aprovado.                                                                                                     |
| `npm audit --audit-level=high` | Não executado: revisão automática bloqueou o envio externo de metadados de dependências ao registro npm. Aguarda autorização específica; dependências e lockfile não mudaram. |

Logs finais: `var/olist-t13-validate-verified.log`,
`var/olist-t13-e2e-verified-final.log` e `var/olist-t13-live.log`. A regressão
E2E usa a configuração local ignorada de porta 4175, pois 4173 já atendia outro
preview; as asserções e skips são os do projeto. Builds de validação e E2E
rodaram em sequência na verificação final. Testes antigos foram atualizados
para incluir Cancelados e conferir somente títulos visíveis, sem ampliar os
limites de altura, controles, alvos ou acessibilidade.

O cancelamento fica em disclosure compacto dentro do painel existente,
preservando o orçamento móvel. Entrega atômica em `codex/olist-phase4-t13`;
commit/push registrados no fechamento. T25 e gates operacionais seguem
pendentes, além da autorização da auditoria externa. Nenhum resultado local
habilita produção, piloto ou geração ERP.

## T12 — grade monetária e conferência por Pedido

Esta seção registra a entrega T12. Suas limitações de projeção e referências
à recuperação pendente são supersedidas pela T13 descrita acima.

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

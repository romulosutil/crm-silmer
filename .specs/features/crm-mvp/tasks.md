# CRM Silmer MVP — Plano de Implementação

> **Status:** Fase 0 em execução  
> **Design técnico:** `TECHNICAL-DESIGN.md`  
> **Topologia:** `EASYPANEL-TOPOLOGY.md`

Cada item deve resultar em commit atômico e manter rastreabilidade com os IDs
de aceite de `.specs/features/crm-mvp/spec.md`. Nenhuma fase avança sem seus
gates de verificação.

## Fase 0 — Fundação e riscos técnicos

### T00.1 Estruturar o monorepo JavaScript ESM

- **Status:** concluída em 30/08/2026.
- **Rastreabilidade:** fundação técnica que habilita os 32 requisitos do MVP;
  não satisfaz isoladamente um requisito funcional.
- Criar diretórios `apps/edge-web`, `apps/api`, `apps/worker` e `modules/*`.
- Fixar versões de Node, dependências e imagens.
- Configurar JSDoc/checkJs, lint, formatação e testes nativos.
- **Verificação:** build reprodutível, nenhum runtime framework no frontend e
  nenhum estado de domínio em `window`; usar ESM/IIFE/classes isoladas.

### T00.2 Criar CI e imagens imutáveis

- Validar lint, testes, E2E/a11y, dependências, imagens e diff.
- Publicar `edge-web` e `runtime` no GHCR por SHA/digest.
- **Verificação:** o mesmo digest sobe em dev e homologação sem rebuild.

### T00.3 Provisionar EasyPanel dev/hml/prod

- Criar projetos e serviços da topologia aprovada.
- Aplicar redes, domínios, limites, health checks e segredos separados.
- Criar kit off-host de recovery com topologia, digests, DNS, migrations e
  inventário de segredos, sem valores sensíveis em arquivo versionado.
- **Verificação:** somente `edge-web` possui domínio/porta pública e uma segunda
  pessoa consegue reconstruir a topologia usando o kit e mocks.

### T00.4 Fechar spikes externos

- Validar WhatsApp Cloud API, assinatura, mídia, templates e status de entrega.
- Versionar matriz por efeito externo com suporte a idempotência, consulta do
  resultado, ponto de não retorno e estratégia para `outcome_unknown`.
- Validar provedor de IA, DPA/retenção e schema estruturado.
- Validar PDF da Ficha com Rose e object storage com Privacidade.
- Levantar operadores, mensagens, bursts, anexos e massa esperada para aprovar
  ou ajustar o envelope de carga da seção 13 do TDD.
- **Verificação:** evidências e matriz versionadas, envelope aprovado e nenhum
  bloqueador de integração aberto.

### T00.5 Definir threat model e catálogo de dados

- Mapear ativos, atores, trust boundaries, PII, operadores e abusos.
- Ligar cada classe à retenção P0.6.
- **Verificação:** revisão de Tech Lead e Responsável de Privacidade.

### T00.6 Aprovar defaults de domínio e papéis

- Confirmar `Admin` para pagamento, Negócio 1:0..1 Pedido, ciclo de conversa,
  PDF canônico, moeda/timezone e exceção de pagamento.
- Confirmar o envelope de carga que qualifica sizing e SLOs.
- Designar Tech Lead, time e Administrador Técnico.
- **Verificação:** aprovação versionada de Produto, Operação e Privacidade;
  T02, T03 e T05 ficam bloqueadas até este gate.

### T00.7 Implantar telemetria e hardening mínimos

- Logs redigidos, request/correlation IDs, métricas de API/worker e alertas live.
- Usuário não-root, capabilities removidas, imagens por digest, filesystem
  read-only quando possível e temporários limitados.
- **Verificação:** falha simulada é detectada sem registrar PII.

## Fase 1 — Identidade, acesso e infraestrutura de domínio

### T01.1 Implementar migrations e acesso PostgreSQL

- Criar runner expand/contract, transações e health/readiness.
- **Verificação:** migrate de zero, upgrade, execução concorrente e rollback de app.

### T01.2 Implementar sessão e usuários por convite

- Senha Argon2id, convite de uso único/expirável, cookie com token hasheado,
  rotação, expiração, CSRF, revogação, TOTP criptografado e recovery codes.
- **Verificação:** bootstrap auditado do primeiro Admin, login/logout/revogação,
  recuperação MFA e nenhum token no storage do browser.

### T01.3 Implementar funções e capacidades ortogonais

- Separar `Atendimento|Vendedor`, `COMMERCIAL_ADMIN`, `PRIVACY_OFFICER` e
  `TECHNICAL_PRIVACY_EXECUTOR`.
- Impedir autoatribuição; registrar concessão/revogação.
- Revogar sessões privilegiadas imediatamente após retirada de capacidade.
- **Verificação:** ACL-P07-01 a ACL-P07-12 e PRV-01 em testes negativos de API/UI.

### T01.4 Criar audit trail e idempotency records

- Persistir ator, ação, alvo, versão, motivo e correlação sem copiar conteúdo.
- **Verificação:** comandos repetidos retornam o mesmo efeito observável.

### T01.5 Criar configuração versionada

- FAB, PIX mascarado, destinatária, templates, canais e feature flags.
- **Verificação:** alteração privilegiada auditada e segredo não exposto.

### T01.6 Implementar catálogo versionado

- Importar/publicar tipos, modelos, malhas e técnicas autorizadas.
- Vincular seleção à versão e copiar snapshot para o Pedido.
- **Verificação:** atualização de catálogo não altera Negócio/Pedido histórico.

## Fase 2 — Caixa de Entrada, canais e confiabilidade

### T02.1 Implementar adapter canônico de canais

- Definir contratos inbound/outbound independentes da Meta e escopar IDs por
  `(provider, provider_account_id, external_id)`.
- **Verificação:** fixtures WhatsApp/Instagram convergem para o mesmo envelope
  e cobrem CHN-P04-01 a CHN-P04-04.

### T02.2 Implementar webhook WhatsApp

- Validar assinatura, deduplicar, persistir e responder rapidamente.
- Preservar raw body para a assinatura e rejeitar tamanho, tipo e schema
  inválidos antes de qualquer efeito.
- **Verificação:** MSG-01, assinatura inválida, fuzz de payload e carga
  concorrente sem mensagens duplicadas.

### T02.3 Implementar fila PostgreSQL e worker

- Inbox/outbox, `available_at`, prioridade, lease/`locked_until`, claim com
  lock, reclaim, retry, jitter, heartbeat, máximo de tentativas, dead letter e
  estados `sent|failed|outcome_unknown`.
- **Verificação:** kill antes, durante e depois do efeito respeita a matriz do
  provider; estado incerto não sofre retry cego, fica reconciliável, e poison
  message termina em reconciliação.

### T02.4 Implementar Conversa, Mensagem e Contato

- Estados de backlog, ciclos, `@usuario`/telefone pendente, identidades e
  merge/unmerge humano verificável.
- **Verificação:** INB-01, CHN-P04-05 a CHN-P04-08 e isolamento entre titulares.

### T02.5 Implementar reconciliação e saúde do canal

- Mostrar pendência, erro, `outcome_unknown`, tentativa, identificador externo,
  último evento e retomada condicionada à capacidade do provider.
- **Verificação:** MSG-02 a MSG-04 e retry auditável.

### T02.6 Implementar UI da Caixa de Entrada

- Lista, detalhe, filtros, estados, takeover e SSE.
- **Verificação:** teclado, foco, ARIA dinâmica, estados de erro/vazio/loading,
  autorização por tópico, reconnect com `Last-Event-ID` e cliente lento.

### T02.7 Implementar Instagram Direct feature-gated

- Webhook, outbound, saúde, reconciliação e `handoff_id` Instagram→WhatsApp.
- Manter feature flag desligável sem afetar o WhatsApp.
- **Verificação:** CHN-P04-01 a CHN-P04-12; indisponibilidade não bloqueia go-live.

## Fase 3 — Negócio, Kanban e qualificação

### T03.1 Implementar conversão idempotente em Negócio

- Vincular/criar Contato, criar Deal em Produto e encerrar ciclo do backlog.
- **Verificação:** INB-02 a INB-04 sob clique e transação concorrentes.

### T03.2 Implementar máquina de estados do Deal

- Etapas, gates, histórico, retorno e perda com motivo.
- **Verificação:** JRN-01 a JRN-04 e JRN-09.

### T03.3 Implementar campos e itens da Ficha

- Itens, malhas, partes, grade, estampa, logística e `field_assessments`.
- **Verificação:** inventário P0.1 coberto e JRN-05.

### T03.4 Implementar Kanban acessível

- Card como projeção do Deal, atualização otimista e alternativa ao drag-and-drop.
- **Verificação:** fluxo completo por teclado e nenhum estado independente no Card.

### T03.5 Implementar tarefas, responsável e handoff humano

- SLA operacional, atribuição, transferência e retomada.
- **Verificação:** nenhum handoff fica sem responsável.

### T03.6 Implementar detalhe acessível do Negócio

- Exibir qualificação, itens, gates, histórico, tarefas, conflitos e ações de
  avanço/retorno/perda sem depender do Kanban.
- **Verificação:** loading/vazio/erro/409, foco após mutação, mensagens de erro
  associadas e jornada completa por teclado em Playwright + axe-core.

## Fase 4 — Vendedor Silmer assistivo

### T04.1 Implementar compositor de contexto

- Janela recente, resumo, campos oficiais, sugestões, catálogo e orçamento vigente.
- **Verificação:** limites de tokens, proveniência e exclusão de dado não autorizado.

### T04.2 Implementar adapter AIProvider

- Schema estruturado, timeout, retry, custo, modelo e redaction.
- **Verificação:** troca por fake provider sem alterar módulos de CRM.

### T04.3 Implementar sugestões separadas

- Resposta, field suggestion, stage suggestion e handoff sem comando de mutação.
- **Verificação:** AGT-01 a AGT-08 e CHN-P04-09/10; nenhum campo oficial alterado pela IA.

### T04.4 Implementar takeover seguro

- `automation_epoch`, cancelamento/revalidação, ponto de não retorno por adapter
  e reativação humana.
- **Verificação:** takeover impede novas tentativas antes do ponto de não
  retorno; chamada já aceita termina em `sent|outcome_unknown` visível e
  reconciliável; CHN-P04-11/12 e kill switch bloqueiam novos envios imediatamente.

### T04.5 Criar evals de segurança comercial

- Preço, prazo, desconto, prompt injection, dado conflitante e pedido de humano.
- **Verificação:** zero violação nos casos bloqueantes antes de homologação.

## Fase 5 — Orçamento, PIX, Pedido e Ficha

### T05.1 Implementar orçamento versionado

- Versão, validade, aprovação Admin, invalidação e comunicação fiel.
- **Verificação:** PRC-01 a PRC-07 e orçamento stale nunca comunicado.

### T05.2 Implementar ledger de vendido

- Reconhecer exatamente uma vez em `aprovado_aguardando_pix`; perda/cancelamento
  invalida quote, encerra cobrança quando possível e gera reversão lógica.
- **Verificação:** FIN-01 a FIN-03 e FIN-P03-01 a FIN-P03-07 sem dupla contagem.

### T05.3 Implementar subfluxo PIX

- Cobrança única, chave configurada, comprovante, rejeição, exceção autorizada,
  retorno ao PIX, cancelamento e confirmação Admin.
- **Verificação:** PAY-01 a PAY-04 e JRN-06/JRN-07 em todos os ramos.

### T05.4 Implementar número e Pedido

- Contador transacional `01-CRM`, FAB e snapshot dos itens.
- **Verificação:** ORD-P05-01 a ORD-P05-09 sob concorrência, incluindo autoria,
  origem e chave idempotente da reserva.

### T05.5 Implementar ciclo da Ficha

- Rascunho, revisão, aprovação, substituição, cancelamento e ACL.
- **Verificação:** ORD-01/02/05 e ACL-P07-06 a ACL-P07-12.

### T05.6 Implementar PDF íntegro e reproduzível

- Template e snapshot canônico versionados; fixar Chromium, fontes, locale e
  timezone; registrar SHA-256 do artefato e campos de produção vazios.
- **Verificação:** golden visual, revisão de Rose e hash determinístico do snapshot.

### T05.7 Implementar envio e onboarding

- Envio inicial, retry, reenvio, cancelamento, aviso de cancelamento para Rose e
  mensagem de boas-vindas, todos reconciliáveis.
- **Verificação:** ORD-03/04, PAY-05, JRN-08 e ACL-P07-09 a ACL-P07-11 sem duplicidade.

### T05.8 Implementar segurança de anexos

- Quarentena, limites, MIME real, hash, ClamAV, download Meta com proteção SSRF,
  timeout/redirect e URLs assinadas `no-store`.
- **Verificação:** malware, payload grande, MIME falso e URL interna são
  bloqueados; assinatura ClamAV acima de 36 horas mantém anexo em quarentena.

### T05.9 Implementar UI comercial, PIX, Pedido e Ficha

- Orçamento versionado, aprovação, PIX/comprovante, exceção, Pedido, revisão da
  Ficha, envio, falha e reconciliação com ações autorizadas.
- **Verificação:** todos os estados e conflitos são operáveis por teclado, foco
  retorna ao contexto após comandos, status assíncrono é anunciado e testes
  Playwright + axe-core cobrem caminho feliz e falhas recuperáveis.

## Fase 6 — Privacidade, relatórios e operação

### T06.1 Implementar retenção por classe

- Scheduler diário, exclusão/anonimização e reconciliação por destino.
- **Verificação:** PRV-02/03 e PRV-P06-01 a PRV-P06-08 com relógio controlado.

### T06.2 Implementar legal hold e solicitações

- Protocolo, verificação, decisão, execução, propagação e evidência.
- **Verificação:** PRV-01 a PRV-03 e PRV-P06-09 a PRV-P06-12.

### T06.3 Implementar tombstones de restore

- Ledger externo pseudonimizado, bucket e credenciais dedicados, proteção contra
  overwrite/delete e reaplicação antes do ready.
- **Verificação:** runtime de dados não acessa tombstones; writer não altera nem
  exclui entrada; restore read-only reaplica o ledger e backup antigo não
  reintroduz titular excluído.

### T06.4 Implementar relatórios comerciais

- Total vendido, quantidade, ticket médio, canceladas e perdidas.
- **Verificação:** período/timezone corretos e leitura apenas de projeções.

### T06.5 Implementar observabilidade e alertas

- Métricas, logs redigidos, traces, custo IA, jobs, canal e backup.
- **Verificação:** cada alerta mínimo é disparado em teste controlado.

### T06.6 Implementar UI de relatórios, configuração e privacidade

- Relatórios comerciais, saúde operacional, configuração permitida, solicitações
  de titular, legal hold e evidências conforme capacidade do ator.
- **Verificação:** autorização negativa API/UI, tabelas e filtros acessíveis,
  estados loading/vazio/erro, confirmação destrutiva e operação completa por
  teclado em Playwright + axe-core.

## Fase 7 — Hardening, UAT e piloto

### T07.1 Executar testes de carga e concorrência

- Webhook, SSE, jobs, contador, PDF e consultas do Kanban usando o envelope
  aprovado da seção 13 do TDD.
- **Verificação:** relatório registra dataset, duração, taxas, concorrência,
  percentis e erros; SLOs só são considerados atendidos dentro desse envelope.

### T07.2 Executar auditoria de segurança e acessibilidade

- OWASP, secrets, SBOM/scan de imagem, headers, uploads, teclado, foco, ARIA e
  contraste.
- **Verificação:** zero finding crítico/alto aberto e matriz de superfícies
  comprova Caixa de Entrada, Kanban, detalhe, comercial/Ficha e
  relatórios/configuração/privacidade sem mouse.

### T07.3 Executar recovery drill

- Executar restore mensal do banco isolado e drill de perda total em VPS limpa,
  usando kit off-host, escrow de segredos, tombstones, digests, recuperação de
  versão de objeto, troca de DNS de drill e adapters mock.
- **Verificação:** RPO até 1 h e RTO até 4 h do CRM completo demonstrados no host
  limpo, sem reutilizar EasyPanel de produção nem copiar produção para HML.

### T07.4 Executar UAT operacional

- Conversa real de teste até PIX, Ficha, Rose e onboarding.
- **Verificação:** aceite de Operação, Produto e Privacidade.

### T07.5 Fazer go-live controlado

- Checklist, janela, responsáveis, monitoramento e rollback prontos.
- **Verificação:** WhatsApp oficial saudável e nenhuma pendência P0/P1 bloqueante.

## Dependências e caminho crítico

```mermaid
flowchart LR
    f0["Fase 0"] --> f1["Fase 1"]
    f1 --> f2["Fase 2"]
    f2 --> f3["Fase 3"]
    f3 --> f4["Fase 4"]
    f3 --> f5["Fase 5"]
    f5 --> f6["Fase 6"]
    f4 --> f7["Fase 7"]
    f5 --> f7
    f6 --> f7
```

Fase 4 depende de contexto de Fases 2/3. Fase 5 pode começar depois do núcleo do
Deal, em paralelo ao hardening da IA. Privacidade acompanha todas as migrations
e não deve ser deixada apenas para Fase 6.

## Definition of Done global

- Critério rastreável atendido e teste automatizado correspondente.
- Autorização testada na API e na UI.
- Migração compatível com rollback.
- Logs sem PII/conteúdo proibido.
- Observabilidade e runbook atualizados.
- Acessibilidade por teclado validada.
- Estados loading/vazio/erro/conflito e foco pós-mudança cobertos em cada superfície UI.
- Efeito externo incerto termina em `outcome_unknown` visível, nunca em retry cego.
- Teste de performance registra e respeita o envelope de carga aprovado.
- Estado de domínio não exposto em `window`.
- Commit atômico, push e `graphify update .` concluídos.

# Imagem local da API ausente e bootstrap de tema — 15/11/2026

Rastreabilidade: manutenção INT-3 / OPS-CHK-01, tarefas OPS-CSP-THEME-01 e
OPS-API-IMAGE-01 em `.specs/features/crm-mvp/tasks.md`. Fluxo preservado:
[ADR 022](../adr/022-manter-deploy-automatico-github-easypanel.md).

## Incidente e evidências

Horários abaixo em UTC, conforme os registros do EasyPanel.

- O deployment `cmwexil5m005006mwa210ehi8`, em 13/11, terminou com sucesso às
  12:07:14, a partir de `d2e99de71efec0e15100c7985a439a36394511a1`.
  O log confirma a criação de `easypanel/espectro-mvp/silmer-api:latest`, ID
  `sha256:5a72a7733410549752d2c2148d1b4aea48eed96a2a073221811750c67b4241be`.
- Em 15/11, o painel exibiu `No such image` para essa tag local e
  `/api/health/ready` retornou 502. A página estática permaneceu disponível.
- A reconstrução pelo fluxo existente, deployment
  `cmwhvhp6l000t06n13ivf3c0g`, começou às 13:31:03 e terminou às 13:33:03.
  A revisão não mudou. Imagem resultante:
  `sha256:58fb0bf60354b7681029e804c019576167a5353891f2a3269c56ab0aae61ebab`.
  Esses hashes são IDs locais de imagem, não digests de manifesto de registry.
- O container da API foi observado `running (healthy)` com esse novo ID;
  edge live, API live e API ready responderam 200. A sessão sem cookies
  respondeu 401 JSON, esperado, e a interface exibiu o login novamente.
- A configuração consultada mostrou GitHub/master, Dockerfile runtime e
  autoDeploy ativos. O CI da revisão implantada havia passado. Nenhuma fonte,
  variável privada, mount ou migration foi alterada na recuperação.
- A consulta do host após a recuperação mostrou aproximadamente 51 minutos
  de uptime e 64,2 GB livres de 95,8 GB. Isso indica reinício recente, sem
  identificar o motivo do reinício ou provar a ocupação anterior do disco.
- `getDailyDockerCleanup` retornou `true`; a limpeza diária foi desativada
  como mitigação temporária e uma nova consulta confirmou `false`.

## Causa e limites da investigação

A causa imediata foi a ausência da imagem local exigida para iniciar a API.
Não foi um build malsucedido nem um erro da sessão no frontend. O motivo da
remoção **não está comprovado**: o histórico consultado contém deployments,
mas não registra a exclusão da imagem; não há ações de configuração retornadas.
A consulta de logs pelo conector falhou e o acesso SSH com a chave disponível
foi recusado. Não foram obtidos eventos Docker, journal ou cron/systemd do host.

Limpeza automática e reinício recente são hipóteses a confrontar com esses
registros. Não atribuir a exclusão à limpeza só porque ela estava habilitada.
O Docker considera imagens sem containers ao executar prune; uma imagem
necessária a um serviço parado pode ser removível. Um reinício, por si só,
não prova exclusão. Referências: [pruning no Docker](https://docs.docker.com/engine/manage-resources/pruning/)
e [configuração de limpeza diária do EasyPanel](https://easypanel.io/docs/api/settings/getDailyDockerCleanup).

## Prevenção enquanto a causa não for confirmada

OPS-API-IMAGE-T02 entrega o [preflight somente leitura e ensaio isolado](image-maintenance-check.md).
Sua execução no CI não acessa produção nem reativa a limpeza do EasyPanel.

1. Manter a limpeza diária global desabilitada até revisar sua política.
   A alteração afeta o host compartilhado: acompanhar a ocupação no monitor
   existente e revisar antes de 80% de uso ou menos de 20 GB livres. Não criar
   uma limpeza ampla para compensar esse risco.
2. Antes de qualquer limpeza manual ou manutenção do host, inventariar as
   imagens referenciadas por API, worker e edge, inclusive serviços parados,
   e a versão anterior de rollback. Conferir o ID local com o container.
   Preservar as tags locais e essas imagens; não usar prune global, `-a`,
   remoção forçada ou limpeza de volumes como procedimento deste incidente.
3. Preservar o fluxo GitHub → EasyPanel. Se uma imagem local estiver ausente,
   reconstruir a revisão aprovada, conferir o resultado do build e o ID
   executado; reiniciar repetidamente não recria uma imagem ausente. Não mudar
   para outra fonte, `latest` externo ou registry sem decisão própria.
4. Após manutenção, conferir API/worker/edge no painel e `/healthz`,
   `/api/health/live`, `/api/health/ready` e sessão sem autenticação (401).
   Readiness inclui conexão ao banco e checksums das migrations exigidas.
5. Com acesso autorizado ao host, coletar `docker service ps --no-trunc`,
   inspeções limitadas aos IDs/nomes das imagens e estado dos containers,
   eventos de imagem na janela 13/11 12:07:14–15/11 13:31:00 UTC, timers/cron
   de limpeza e journal dos boots anterior/atual. Eventos podem já ter sido
   descartados; ausência de histórico não identifica o autor. Não publicar
   env, credenciais, payloads de clientes ou logs brutos sem revisão.
6. Reativar a limpeza somente após comprovar que sua seleção preserva imagens
   de serviços, versões de rollback e builds em andamento. Para reverter a
   mitigação, `setDailyDockerCleanup(true)` restaura o estado anterior; isso
   não foi executado nesta entrega e não resolve a lacuna de evidência.

## CSP do tema

O HTML continha um bootstrap inline de tema, incompatível com
`script-src 'self'`. O preview de E2E não envia CSP; os testes anteriores
não reproduziam o bloqueio de produção.

OPS-CSP-THEME-01 move o bootstrap para `/theme-bootstrap.js`, um script
clássico síncrono da própria origem, antes do bundle. O Vite copia o arquivo
de `public/` para o artefato do edge. A política Nginx permanece restritiva.
Storage indisponível, valor ausente ou legado `system` usa tema claro;
`dark` salvo continua aplicável antes da aplicação iniciar.

Os testes de `foundation.spec.js` aplicam a política real extraída do Nginx
ao documento, bloqueiam o bundle e exigem tema correto e ausência de erro
de CSP/JavaScript. Os quatro cenários e os demais testes da tela base
passaram: 14/14, incluindo axe e login por teclado. A verificação de política
do edge passou 12/12. Sem mudança de cores, layout, ACL ou contrato de sessão.
`npm run validate` passou com Node 24.20.0/npm 11.19.0: 2.758 testes aprovados,
53 pulados e nenhum falho, além dos validadores, checks estáticos e build.
`npm audit --audit-level=high` retornou zero vulnerabilidades. Testes de rede
local precisaram de execução fora do sandbox; dentro dele, o loopback é negado.

Após publicar o edge, conferir HTML sem script inline de tema, script externo
200 com MIME JavaScript, `script-src 'self'` preservado e console sem o aviso.
Rollback do código restaura a versão anterior do edge e também o defeito de
CSP; não relaxar a política para contorná-lo. A mitigação de limpeza é uma
configuração independente e não deve ser revertida pelo rollback do frontend.

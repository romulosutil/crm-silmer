# Imagens antes da manutenção e ensaio isolado

OPS-API-IMAGE-T02, manutenção INT-3 / OPS-CHK-01. Complementa o
[incidente de imagem ausente](api-image-csp-incident.md), preservando a ADR 022.
Esta entrega não acessa a VPS, não reativa sua limpeza diária e não faz merge
na `master`, que dispararia deploy automático.

## Preflight somente leitura

Em uma operação futura autorizada, o operador prepara um inventário privado
da release aprovada, com ID do daemon alvo, referências locais e IDs de imagem
da versão atual e anterior. Não gerar esse inventário automaticamente a partir
de `latest`: isso trataria uma tag já alterada como aprovação. IDs locais
`sha256:...` de imagem são diferentes dos digests de manifesto de registry.
Preservar uma referência de rollback antes de mover a tag atual.

Exemplo estrutural, com valores sintéticos que devem ser substituídos no
inventário privado; não é evidência da VPS:

```json
{
  "schemaVersion": 1,
  "daemonId": "01234567-89ab-cdef-0123-456789abcdef",
  "services": [
    {
      "name": "espectro-mvp_silmer-api",
      "role": "api",
      "kind": "swarm",
      "current": {
        "reference": "easypanel/espectro-mvp/silmer-api:latest",
        "imageId": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "rollback": {
        "reference": "easypanel/espectro-mvp/silmer-api:rollback-approved",
        "imageId": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    },
    {
      "name": "espectro-mvp_silmer-worker",
      "role": "worker",
      "kind": "swarm",
      "current": {
        "reference": "easypanel/espectro-mvp/silmer-worker:latest",
        "imageId": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "rollback": {
        "reference": "easypanel/espectro-mvp/silmer-worker:rollback-approved",
        "imageId": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    },
    {
      "name": "espectro-mvp_silmer-edge-web",
      "role": "edge",
      "kind": "swarm",
      "current": {
        "reference": "easypanel/espectro-mvp/silmer-edge-web:latest",
        "imageId": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "rollback": {
        "reference": "easypanel/espectro-mvp/silmer-edge-web:rollback-approved",
        "imageId": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      }
    }
  ]
}
```

O schema exige exatamente os três papéis **API, worker e edge**, sem duplicar
papel ou nome, com seus nomes Swarm e respectivas imagens. `kind: container`
é destinado a workloads standalone com o label `io.crm.image-preflight.service`;
não usar esse modo para representar um serviço Swarm do EasyPanel.
Para Swarm, nomes, IDs completos e IDs curtos são resolvidos para `.ID` e
`.Spec.Name` canônicos. O relatório usa o nome canônico e inclui `serviceId`;
três aliases do mesmo serviço não podem preencher os três papéis. A busca de
containers usa `com.docker.swarm.service.id`, não o seletor textual recebido.
Resposta de identidade incompleta ou inválida bloqueia a manutenção.

Na máquina que hospeda o daemon, com Node e Docker CLI disponíveis:

```sh
node scripts/check-maintenance-images.mjs \
  --inventory /caminho/privado/release-images.json \
  --docker-host unix:///var/run/docker.sock
```

O socket precisa ser informado explicitamente e ser local (`unix:///...`).
Contextos e variáveis `DOCKER_*` herdados não escolhem o destino. O script
executa exclusivamente `info`, `image inspect`, `service inspect`, `ps` e
`container inspect`, sem pull, tag, criação, restart ou remoção.

Saída JSON `status: ready` e exit code 0 exigem:

- daemon igual ao aprovado, no início e no fim da coleta;
- referências atual e de rollback presentes com os IDs esperados, inclusive
  quando o serviço está parado e não há container em execução;
- referência configurada no Swarm correspondente à atual; uma referência
  resolvida por digest também precisa estar disponível localmente com o ID certo;
- todos os containers em execução daquele serviço usando o ID atual aprovado.

Inventário vazio, duplicado ou inválido, tag ausente, tag apontando para outra
imagem, rollback ausente, daemon/configuração/container divergente ou qualquer
falha/timeout de consulta retornam `status: blocked` e exit code 1. Os erros
expõem códigos limitados, sem copiar stderr do Docker, env ou configuração.
Conectar uma manutenção futura a esse exit code com `set -e`/`&&`; ignorá-lo
anula a proteção. Se faltar uma imagem, interromper a manutenção e seguir o
procedimento de recuperação aprovado; o preflight não a reconstrói nem a baixa.

Esse resultado é pontual, não é um lock e não autoriza limpeza. Pausar deploys
e limpadores concorrentes durante a manutenção e verificar novamente depois.
Em Swarm com múltiplos nós, a inspeção local não comprova imagens de outro nó.

## Ensaio real, sem produção

```sh
npm run test:maintenance:images
# Em runner Linux descartável, com Docker/dockerd/containerd/ctr instalados:
sudo "$(command -v node)" scripts/docker-image-maintenance-drill.mjs --isolated-local
```

O ensaio recusa Windows, execução sem root, ausência do argumento explícito e
contextos remotos herdados. O CI o executa como passo obrigatório do gate já
existente de checks. Ele cria um `dockerd` próprio em `/tmp/crm-image-drill-*`,
com socket Unix, configuração, data-root, exec-root e pidfile exclusivos;
sem bridge, regras iptables, portas publicadas ou montagem do socket do host.
Um processo filho `containerd` é iniciado antes dele, com configuração, socket
gRPC/ttrpc, root e state privados. CRI/NRI e endpoints TCP/debug/métricas são
desabilitados. O Docker recebe `--containerd` explicitamente e namespaces
exclusivos para containers e plugins, evitando a autodetecção do runtime do
host. Isso corrige o P2 identificado na revisão do PR #378: roots exclusivos
do Docker, sozinhos, não isolavam o containerd.

Antes de criar imagens/containers ou executar prune, o ensaio verifica os
argumentos reais dos dois filhos em `/proc/<pid>/cmdline`, seus estados e,
quando expostos pelo cliente Docker, endereço/namespaces de `Info.Containerd`.
Clientes antigos sem esse campo continuam sujeitos à prova por `/proc`.
Cada fixture HTTP saudável deve também aparecer em `ctr containers list` no
socket **e** namespace privados. O JSON completo de `docker info` nunca é
emitido em logs. Um endpoint do host ou namespace `moby`/`plugins.moby` deve
reprovar as regressões de posse.

Containerd/runc podem criar sockets de shim em caminhos de runtime do sistema
com nomes derivados de socket, namespace e ID. A garantia é de processos,
endpoints, metadata e namespaces próprios, sem afirmar isolamento de VM ou
que todo arquivo de runtime reside em `/tmp`.
Não para nem reinicia o Docker existente. O uso de múltiplos daemons é uma
facilidade experimental do Docker, limitada aqui ao runner descartável, com
[configurações separadas conforme o fabricante](https://docs.docker.com/reference/cli/dockerd/#run-multiple-daemons).

Imagens sintéticas vêm da base Node fixada por digest no Dockerfile runtime.
Um arquivo de servidor HTTP é copiado para um container sintético parado e
`docker commit` cria as versões; não há builder/contexto externo. Não há banco,
credenciais ou dados de clientes. Os probes HTTP ocorrem pelo loopback de cada
container, sem rede externa ou porta publicada.

O ensaio exige:

1. Preflight real por CLI aprovado para API/worker/edge sintéticos.
2. Serviços parados e seus containers removidos, seguidos de limpeza real de imagens por label positivo exclusivo
   de descarte. Uma imagem descartável precisa desaparecer; as imagens atual,
   anterior e a base não descartável precisam permanecer.
3. Reinício dos processos Docker e containerd temporários, com o mesmo armazenamento e identidade,
   seguido de preflight aprovado com serviços ainda sem containers.
4. Recriação de cada serviço com `--pull=never`, HTTP correto e restart do
   container; criação separada da versão de rollback com HTTP correto.
5. Tag atual removida enquanto o container antigo permanece saudável:
   preflight CLI precisa falhar e nova criação sem pull também precisa falhar.
6. Tag atual apontando para a imagem errada, referência de rollback ausente
   e, por fim, remoção integral da imagem de rollback sem containers:
   preflight precisa bloquear os três casos, antes de qualquer manutenção.
7. Encerramento do Docker criado, ausência de tasks no namespace privado e
   encerramento do containerd filho antes da remoção do diretório e registro
   de sucesso. Cleanup incompleto reprova a execução e preserva o diretório
   de diagnóstico; nenhum PID descoberto por nome é sinalizado.

A limpeza usa `image prune --all --force` **somente nesse daemon privado**, com
filtro positivo para o label único de descarte da execução. O código confere
data-root, identidade e label do daemon antes do prune. Essa é uma política
restritiva de ensaio, não uma implementação de limpeza para produção. Ver
[filtros do prune](https://docs.docker.com/reference/cli/docker/image/prune/) e
[`--pull=never`](https://docs.docker.com/reference/cli/docker/container/run/).

O teste não reproduz a política desconhecida do EasyPanel, não reinicia a VPS
e não comprova recovery de dados, migrações, autenticação ou prontidão de
produção. A causa histórica da remoção permanece dependente dos eventos do host.

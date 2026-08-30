# Supply chain da Fase 0

## Rastreabilidade e limite

Esta entrega implementa `T00.2` e é um enabler técnico correlato a `MSG-02` e
`MSG-03`: torna releases identificáveis e repetíveis para que as futuras
rotinas de pendência, recuperação e indisponibilidade possam ser operadas com
segurança. Ela **não satisfaz** o comportamento funcional de `MSG-02` nem de
`MSG-03`; esses critérios dependem das fatias de canais, filas e interface.

## Build e promoção

- Pull requests executam lint/checkJs, unitários, E2E com axe-core, auditoria
  de dependências, build/scan das duas imagens e `git diff --check`.
- O merge em `master` constrói `edge-web` e `runtime` uma única vez em layouts
  OCI locais, executa o Trivy antes de qualquer upload e somente então copia os
  mesmos manifestos, sem rebuild e preservando os digests, para a tag
  publicável `github.sha` no GHCR.
- Os builds publicados levam SBOM e provenance OCI gerados pelo BuildKit.
- O workflow manual recebe um SHA completo, seleciona uma execução `push`
  bem-sucedida para aquele SHA em `master`, baixa os artifacts de digest desse
  run e os compara com as tags no GHCR. Só então produz, sem rebuild, um
  manifesto cujas referências de `edge-web` e `runtime` são idênticas por
  digest em dev e hml. A promoção deve ocorrer dentro da retenção de 30 dias
  desses artifacts.
- A promoção para EasyPanel continua manual, fora do GitHub Actions. O operador
  guarda o digest atual e o anterior; produção não possui auto-deploy.

## Pins verificados em 30/08/2026

As Actions usam o commit completo do release oficial. As bases usam o digest
do índice OCI oficial resolvido com `docker buildx imagetools inspect`:

| Componente | Referência imutável                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Node.js    | `node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e` |
| Nginx      | `nginx:1.31.4-alpine-slim@sha256:1870de6d59aafee152589b64404556d2535922cdd998e6dac1c4888c938ed8f9`   |

Atualizar um pin exige PR próprio, nova resolução em fonte oficial, build,
scan e registro do novo digest; aliases mutáveis não entram em deploy.

## Scanner

Trivy foi escolhido por reunir vulnerabilidades de pacotes e imagem em um
scanner conhecido, reproduzível e integrável ao GitHub Actions. Ele roda no
CI sobre o layout OCI local e antes de existir qualquer artefato no GHCR:
achados críticos corrigíveis bloqueiam a publicação/promovibilidade, enquanto
o relatório continua visível. Assim, um candidato reprovado nunca fica
disponível, nem mesmo temporariamente, no registry público.

Trivy **não roda no runtime**. Embutir scanner e banco de vulnerabilidades nas
imagens aumentaria tamanho, superfície de ataque e privilégio operacional, além
de envelhecer o banco junto com o container. O runtime fica mínimo e não-root;
o scanner é atualizado e executado na fronteira de build/CI.

## Verificação local

```powershell
npm ci
npm run validate
npm run test:e2e
npm audit --audit-level=high
docker build --file docker/edge-web.Dockerfile --tag crm-silmer-edge-web:test .
docker build --file docker/runtime.Dockerfile --tag crm-silmer-runtime:test .
git diff --check
```

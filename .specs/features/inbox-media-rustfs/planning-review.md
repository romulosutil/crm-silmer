# Revisão do planejamento INBOX-MEDIA-1

Data: 05/10/2026. Resultado: plano estruturalmente validado e revisado;
implementação, smoke S3 e homologação externos ainda pendentes.

## Checks executados

- validate_spec.py inbox-media-rustfs --strict: 0 erros, 0 avisos.
- validate_tasks.py inbox-media-rustfs --strict: 0 erros, 0 avisos.
- npm run validate: passou, incluindo lint/typecheck/build e 647 testes
  aprovados, 3 skips existentes dependentes de ambiente; não são prova live.
- npm run test:e2e: 101 passaram, 7 skips e 6 falhas na baseline de UI
  (filtros da Inbox, status/drawer do Pedido e identidade da conversa).
  Falhas incluem timeout de locators e encerramento de worker. Nenhum arquivo
  de aplicação, fixture ou teste foi alterado pelo planejamento. Investigar
  em manutenção própria antes de considerar o gate E2E de Execute aprovado.
- validate:topology e test:recovery:mocks: 14 testes aprovados; recovery real
  continua pendente, conforme o gate existente.
- validate:security-catalog e test:security-catalog: 4 testes aprovados.
- validate:media-retention: passou para a política executável legada;
  não comprova a nova classe persistente, que ainda não foi implementada.
- Formatação e git diff --check: passaram na entrega documental.
- npm audit --audit-level=high: falhou por source-map-js,
  GHSA-68fv-2mgg-jv7q, já presente no lockfile anterior ao plano.
  Atualização de dependência fica em manutenção própria; gate de release
  permanece pendente. Não houve npm audit fix nem alteração do lockfile.

## Revisão independente

Revisor separado e somente leitura examinou spec/design/tasks e os registros
da decisão. Contradição entre upload 202 e validação assíncrona foi corrigida:
MED-04 cobre excesso de bytes; MED-29 define status rejected/invalid_format.
Contabilização de quota passou a incluir bytes attached, reservas e spool.
Revisor confirmou a resolução dos dois pontos. Ajuste editorial de referência
dos formatos inválidos para MED-29 também aplicado.

Esta revisão é de planejamento. Não é validation.md, não marca MEDs Verified
e não substitui o Verifier/sensor obrigatórios ao fim da implementação.

## Evidência externa limitada

EasyPanel e RustFS foram consultados em modo somente leitura. Foram observados
imagem configurada alpha.99, rota S3 HTTPS, volumes data0..data3, bucket
hermes-backups privado e ausência de backups de volume mostrados na página.
Não foram acessados objetos reais, copiados segredos ou executados operações
S3, criação de credenciais/buckets, alteração de política, upgrade ou deploy.

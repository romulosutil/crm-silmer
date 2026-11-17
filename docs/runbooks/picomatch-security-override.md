# OPS-DEPS-02 — picomatch no gate de WAP-E04

Seguimento da [PR 397](https://github.com/romulosutil/crm-silmer/pull/397),
WAP-E04 / WAP-T02-05–07, gate de dependências de CONTRIBUTING / INT-3.
Não implementa outro E nem muda autorização, ambiente ou dados do produto.

## Problema e escolha

O [run 1005](https://github.com/romulosutil/crm-silmer/actions/runs/44145731436)
passou PostgreSQL (808 testes, sem skips), validate (2.861 aprovados, 60 skips
condicionais) e E2E/axe (1.065 aprovados, sete skips legados), mas falhou em
`npm audit --audit-level=high`. O advisory
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
inclui picomatch até 4.0.7 e não informa versão oficial corrigida em 17/11/2026.
Os quatro achados são a mesma cadeia picomatch → fdir/tinyglobby → Vite.

Vite permanece em **8.3.5**. Um override limitado à sua árvore substitui
picomatch por **`npm:@ryotsu/picomatch@4.0.7-a`**, versão exata com integridade
SHA-512 no lockfile. Vite, tinyglobby e fdir resolvem a mesma cópia corrigida;
não sobra cópia oficial vulnerável nessa árvore. O pacote é exclusivamente
de desenvolvimento, sem dependência runtime ou script de instalação novo,
com a licença MIT e a autoria original preservadas.

O fork é uma nova relação de confiança, com mantenedor diferente do upstream.
A escolha depende da inspeção do código publicado e das provas abaixo, não
apenas da ausência de advisory para outro nome de pacote. Não foram alterados
o comando de auditoria, seu nível, o workflow, os skips ou as assertions antigas.
Não há registry alternativo, patch pós-instalação ou tarball local versionado.

## Procedência e revisão

- [Fonte fixada do fork](https://github.com/ryotsu-kankichi/secured-picomatch/commit/3ab5a7627d480259e3d9ca67fbc14c125d374f0e).
  `npm audit signatures --json --include-attestations` verificou assinaturas e
  attestation SLSA do pacote. A attestation aponta para esse commit, tag
  `4.0.7-a` e workflow `.github/workflows/publish.yml` do mesmo repositório.
- Os dez arquivos publicados foram comparados byte a byte com o snapshot
  desse commit: todos correspondem. Comparado ao tarball oficial 4.0.7, somente
  `lib/parse.js` muda entre os arquivos executáveis; manifesto e README também
  mudam. Os demais JS e a licença são idênticos. Sem dependências de execução.
- A correção elimina a repetição externa redundante nos extglobs de ramo único
  com estrela e trata formas complexas não comprovadamente seguras como literais.
  Os controles oficiais travam até o timeout nos padrões adversariais; o fork
  conclui. A suíte do snapshot passou **2.004 testes** em runner temporário,
  sem adicionar Mocha ou suas dependências ao projeto.
- A revisão independente comparou **1.497.920 combinações** de padrões/opções/
  entradas curtas. As diferenças observadas ficaram nos casos de negação de
  brackets descritos abaixo; a prova não substitui os testes dos consumidores.

## Compatibilidade e limites

O diff revisado confirma três ajustes além do caso de ReDoS: globstar aceita newline;
`[!a]` passa a negar a classe sem exigir `posix: true`; `**.js` deixa de cruzar
diretórios no fastpath. Capturas de extglobs reescritos podem mudar e formas
complexas passam a ser literais. Os limites de capturas e literalização constam do
[changelog fixado](https://github.com/ryotsu-kankichi/secured-picomatch/blob/3ab5a7627d480259e3d9ca67fbc14c125d374f0e/CHANGELOG.md).

A correção cobre a CVE de ramo único. **Não torna arbitrários globs não
confiáveis seguros**: padrões de múltiplos ramos como `+(*a|c)b` ainda podem
travar tanto no oficial quanto no fork. Não oferecer esses matchers em endpoint
de produto nem usar `maxExtglobRecursion: false` com entrada não confiável.
O uso existente permanece no toolchain sobre arquivos/configurações controlados.

`test/picomatch-security.test.js` resolve o matcher efetivo de cada consumidor
e executa 14 casos de ataque, incluindo prefixos/sufixos e formas aninhadas,
em três modos, num subprocesso com timeout de cinco segundos. A prova positiva
preserva estrelas literais e matching válido. Outro caso verifica glob síncrono/
assíncrono, fdir, inclusões/exclusões, arquivos ocultos e o resultado executável
de um build real de `import.meta.glob` do Vite, com fixtures sintéticas.

## Verificação e retirada

Com Node 24.20.0 e npm 11.19.0:

```powershell
npm ci
node --test test/picomatch-security.test.js
npm ls picomatch --all
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
npm audit signatures
npm run validate
npm run test:e2e
git diff --check
```

Instalação reproduzível aprovada; testes focais **4/4**; validate completo com
**2.865 aprovações, zero falhas e 60 skips condicionais de live**, tipos/lint
e build aprovados. Auditorias completa e de runtime sem vulnerabilidades.
E2E/axe integral em servidor local dedicado: **1.065 aprovados, sete skips
legados, zero falhas**, incluindo captura/reprodução reais sintéticas no
Chromium e Firefox, teclado/foco e superfícies móveis. Nenhum retry consumido.
Assinaturas verificadas em **229 pacotes**,
attestations em **68**. A verificação não reportou assinaturas inválidas ou
ausentes entre os pacotes verificáveis; nem todo pacote publica attestation.
Logs e tarballs de revisão
ficam somente em `.tmp/picomatch-review/`, fora do commit. Os gates completos
e a conclusão do CI são registrados na PR no SHA efetivamente verificado.

Retirar o override quando houver release oficial corrigido compatível com os
três consumidores: regenerar lockfile, comprovar os testes de ataque, executar
validate/E2E e as auditorias, revisar diff e publicar pela mesma política de PR.
Não atualizar automaticamente a versão do fork. Qualquer mudança exige nova
revisão do tarball e da procedência.

Rollback: reverter este patch de dependência e reinstalar com `npm ci`; isso
restaura a versão vulnerável e o CI bloqueado. Sem migração ou alteração de dados.
Não liberar entrega com audit falhando nem afirmar homologação de produção.

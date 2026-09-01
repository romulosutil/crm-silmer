# T00.4 - Revisao do PDF canonico da Ficha

Rastreabilidade: issue `#7`; `T00.4`; `ORD-01..05`.

## Estado do gate

**Pendente de aprovacao humana.** O pacote sintetico, o PDF A4 em paisagem, os
hashes e o gate fail-closed estao versionados. Nenhuma validacao automatizada ou
revisao do agente substitui o aceite de Rose e Operacao.

O artefato a revisar e
[`output/pdf/ficha-canonica-sintetica-v1.pdf`](../../output/pdf/ficha-canonica-sintetica-v1.pdf).
Ele contem somente dados ficticios, cobre os campos comerciais aplicaveis,
calcula 32 pecas a partir da grade e mantem os 14 campos posteriores de producao
presentes e vazios.

## Pacote versionado

- `ficha-pdf-synthetic.json`: snapshot imutavel de revisao, sem PII.
- `ficha-pdf-approval.json`: versoes, hashes, criterios e estado humano.
- `scripts/ficha-pdf-review.mjs`: renderer Chromium e validacao fail-closed.
- `test/ficha-pdf-review.test.js`: cobertura de campos, grade, vazios, hashes e
  transicao integral de aprovacao.
- `output/pdf/ficha-canonica-sintetica-v1.pdf`: evidencia visual candidata.

## Geracao e verificacao tecnica

```powershell
npm ci
npm run generate:ficha-pdf-review
npm run validate:ficha-pdf-review
npm run test:ficha-pdf-review
```

A geracao e permitida somente enquanto a versao esta
`pending-human-approval`. Depois de aprovada, o script recusa sobrescrever o
PDF. O validador confirma o hash SHA-256 do snapshot e do PDF, a soma da grade,
os campos de producao vazios e a consistencia integral do estado humano.

## Roteiro para Rose e Operacao

1. Abrir o PDF em 100% e revisar as duas paginas.
2. Imprimir em A4 paisagem, sem ajustar escala, e conferir se texto, bordas e
   rodape permanecem legiveis e sem cortes.
3. Confirmar, nesta ordem: conteudo de cabecalho; itens; especificacoes; grade;
   total; observacoes; campos posteriores de producao vazios.
4. Registrar individualmente os seis criterios do gate: `legibility`,
   `content`, `order`, `grade`, `totals` e `printing`.
5. Se qualquer criterio falhar, manter o gate pendente e abrir uma nova versao
   de template. Nunca corrigir ou sobrescrever uma versao aprovada.

## Como registrar o aceite real

Somente depois da revisao:

1. Criar `docs/phase0/ficha-pdf-approved-evidence-v1.json` com `schemaVersion`,
   `task`, `issue`, `syntheticOnly`, versoes e hashes copiados do gate,
   `reviewedAt`, `reviewedBy`, os seis criterios `true` e ao menos uma referencia
   visual sem PII no formato `git:<sha>` ou `silmer:<id>`.
2. Em `ficha-pdf-approval.json`, mudar o estado inteiro para `approved`, informar
   Rose e o representante de Operacao, data ISO 8601, seis criterios `true` e a
   referencia ao arquivo de evidencia. Estados parciais falham.
3. Executar `npm run validate:ficha-pdf-review` e anexar o resultado a PR de
   aprovacao.
4. Atualizar a matriz de efeitos e o golden somente nessa nova PR, preservando
   o PDF aprovado por hash.

Nao registrar telefone, email, pedido real, assinatura manuscrita ou qualquer
outro dado pessoal na evidencia.

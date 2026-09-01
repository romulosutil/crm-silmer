# T00.4 - Revisao do PDF canonico da Ficha

Rastreabilidade: issue `#7`; `T00.4`; `ORD-01..05`.

## Estado do gate

**Aprovado por Rose e Operacao em 31/08/2026.** O pacote sintetico, o PDF A4 em
paisagem, os hashes, os seis criterios e a evidencia sem PII estao versionados.
O aceite preserva o artefato aprovado por hash e impede sua regeneracao.

A revisao comeca em
[`output/pdf/revisao-ficha.html`](../../output/pdf/revisao-ficha.html). A acao
principal **Baixar nova ficha** entrega a candidata modular
`ficha-canonical-v2`; **Download ficha legada** preserva a tabela anterior como
contingencia. Esta pagina e somente uma superficie estatica de revisao de
`T00.4`: a integracao do download na interface produtiva continua fora deste
pacote.

Os dois PDFs contem somente dados ficticios, cobrem os campos comerciais
aplicaveis, calculam 32 pecas a partir da grade e mantem os 14 campos posteriores
de producao presentes e vazios. A v2 organiza resumo, itens, especificacoes,
grade e totais em blocos operacionais; a segunda pagina agrupa o preenchimento
manual em Arremate, Conferencia/Embalagem e Cores/Arte.

## Pacote versionado

- `ficha-pdf-synthetic.json`: snapshot imutavel de revisao, sem PII.
- `ficha-pdf-approval.json`: versoes, hashes, criterios e estado humano.
- `scripts/ficha-pdf-review.mjs`: renderer Chromium e validacao fail-closed.
- `test/ficha-pdf-review.test.js`: cobertura de campos, grade, vazios, hashes e
  transicao integral de aprovacao.
- `output/pdf/ficha-canonica-sintetica-v2.pdf`: nova evidencia visual candidata.
- `output/pdf/ficha-canonica-sintetica-v1.pdf`: tabela legada preservada.
- `output/pdf/revisao-ficha.html`: seletor acessivel entre candidata e fallback.

## Geracao e verificacao tecnica

```powershell
npm ci
npm run validate:ficha-pdf-review
npm run test:ficha-pdf-review
```

`npm run generate:ficha-pdf-review` foi usado somente enquanto a versao estava
`pending-human-approval`. Como a versao esta aprovada, o script recusa
sobrescrever o PDF. O validador confirma os hashes SHA-256 do snapshot e dos
dois PDFs, a soma da grade, os campos de producao vazios, os links do seletor e
a consistencia integral do estado humano. A deteccao de contato rejeita
telefones brasileiros, mas nao confunde sequencias numericas internas de hashes
e identificadores com PII.

## Roteiro executado por Rose e Operacao

1. Abrir o seletor e baixar a nova ficha; usar a ficha legada para comparar
   conteudo e como fallback, nao como candidata principal.
2. Abrir o PDF v2 em 100% e revisar as duas paginas.
3. Imprimir em A4 paisagem, sem ajustar escala, e conferir se texto, bordas e
   rodape permanecem legiveis e sem cortes.
4. Confirmar, nesta ordem: conteudo de cabecalho; itens; especificacoes; grade;
   total; observacoes; campos posteriores de producao vazios.
5. Registrar individualmente os seis criterios do gate: `legibility`,
   `content`, `order`, `grade`, `totals` e `printing`.
6. Se qualquer criterio falhar, manter o gate pendente e abrir uma nova versao
   de template. Nunca corrigir ou sobrescrever uma versao aprovada.

## Registro do aceite real

Depois da revisao, o aceite foi registrado assim:

1. `docs/phase0/ficha-pdf-approved-evidence-v2.json` registra `schemaVersion`,
   `task`, `issue`, `syntheticOnly`, versoes e hashes copiados do gate,
   `reviewedAt`, `reviewedBy`, os seis criterios `true` e ao menos uma referencia
   visual sem PII no formato `git:<sha>` ou `silmer:<id>`.
2. `ficha-pdf-approval.json` mantem o estado inteiro como `approved`, informa
   Rose e o representante de Operacao, data ISO 8601, seis criterios `true` e a
   referencia ao arquivo de evidencia; estados parciais falham.
3. A matriz de efeitos aponta para a evidencia e o PDF v2 permanece como golden
   visual imutavel pelo SHA-256 registrado.
4. `npm run validate:ficha-pdf-review` valida a transicao completa na PR de
   aprovacao.

Nao registrar telefone, email, pedido real, assinatura manuscrita ou qualquer
outro dado pessoal na evidencia.

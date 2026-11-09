// Development-only proposal. Never changes an approved template or print switch.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  productionData,
  renderProposal,
} from '../docs/prototypes/ficha-por-item/render.mjs';

const sample = JSON.parse(
  await readFile(
    new URL('../docs/prototypes/ficha-por-item/sample.json', import.meta.url),
    'utf8',
  ),
);
const poison = {
  ...sample,
  finalAmountCents: 'FINANCEIRO_NAO_IMPRIMIR_987654',
  paymentCondition: 'COBRANCA_NAO_IMPRIMIR_CARTAO',
  billing: {
    received: 'SINAL_NAO_IMPRIMIR',
    balance: 'SALDO_NAO_IMPRIMIR',
    checkoutUrl: 'https://example.invalid/checkout-proibido',
  },
  customer: { ...sample.customer, document: 'DOCUMENTO_FISCAL_NAO_IMPRIMIR' },
  serviceData: {
    ...sample.serviceData,
    payment: 'PAGAMENTO_NAO_IMPRIMIR',
    billing: 'BILLING_NAO_IMPRIMIR',
  },
};
const data = productionData(poison);
assert.throws(
  () =>
    productionData({
      ...sample,
      observations: ['Cobrar R$ 500,00 antes de iniciar.'],
    }),
  /FACTORY_NOTE_REQUIRES_REVIEW/u,
);
const html = await renderProposal(data);
for (const forbidden of [
  'FINANCEIRO_NAO_IMPRIMIR',
  'COBRANCA_NAO_IMPRIMIR',
  'SINAL_NAO_IMPRIMIR',
  'SALDO_NAO_IMPRIMIR',
  'checkout-proibido',
  'DOCUMENTO_FISCAL_NAO_IMPRIMIR',
  'PAGAMENTO_NAO_IMPRIMIR',
  'BILLING_NAO_IMPRIMIR',
])
  assert.ok(!html.includes(forbidden), forbidden);
assert.equal(data.items.length, 8);
assert.equal(data.quantity, 97);
assert.equal((html.match(/data-production-field=/gu) ?? []).length, 112);
const out = new URL(
  '../output/pdf/ficha-por-item-proposta-2026-11-09/',
  import.meta.url,
);
await mkdir(out, { recursive: true });
await writeFile(
  new URL('../docs/prototypes/ficha-por-item/index.html', import.meta.url),
  html,
);
await writeFile(new URL('previa.html', out), html);
await writeFile(
  new URL('dados-producao.json', out),
  JSON.stringify(data, null, 2) + '\n',
);
console.log(
  'Proposal built: 8 items, 97 pieces, 112 production fields, financial projection excluded.',
);

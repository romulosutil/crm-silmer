import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { factoryInstructions } from '../modules/orders/src/print/factory-instructions.js';
import {
  paginateFactoryItems,
  estimateFactoryNotesHeight,
} from '../modules/orders/src/print/ficha-v7-pages.js';
import {
  PRINT_TEMPLATE,
  TEMPLATE_V6,
  TEMPLATE_V7,
  renderOrderFicha,
} from '../modules/orders/src/print/index.js';
import { printSnapshot } from '../modules/orders/src/print/print-snapshot.js';
import {
  fichaV7Approved,
  validateFichaReviewV7,
} from '../scripts/ficha-pdf-review-v7.mjs';
import { validateFichaPrintSwitch } from '../scripts/ficha-pdf-review.mjs';

const root = new URL('../', import.meta.url);
/** @param {string} path */
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, root), 'utf8'));
const attendance = await read(
  'output/pdf/auditoria-ficha-2026-11-09/order-saved.json',
);
const { order: store } = await read(
  'output/pdf/auditoria-ficha-2026-11-09/store-saved.json',
);

test('FIP-01: model and collar binding remain separate from the seven principal points', () => {
  const order = structuredClone(attendance);
  Object.assign(order.ficha.items[0], {
    modelo: 'MODELO_SENTINELA',
    gola: 'GOLA_SENTINELA',
    vies_gola: 'VIES_SENTINELA',
  });
  const html = renderOrderFicha(order, TEMPLATE_V7);
  for (const text of [
    'MODELO_SENTINELA',
    'GOLA_SENTINELA',
    'VIES_SENTINELA',
    'Viés da gola',
    'Aplicação',
    'Previsão de entrega',
  ]) {
    assert.ok(html.includes(text), text);
  }
  assert.equal((html.match(/campo-producao-vazio">/gu) ?? []).length, 14);
  order.ficha.items[0].gola = '';
  assert.ok(renderOrderFicha(order, TEMPLATE_V7).includes('VIES_SENTINELA'));
});

test('FIP-02: allowlisted production instructions print as complementary information, escaped', () => {
  const order = structuredClone(attendance);
  order.ficha.observations = ['OBS <img src=x onerror=alert(1)>'];
  order.ficha.serviceData = {
    notes: [
      'NOTA & <script>alert(1)</script>',
      null,
      3,
      { private: 'SECRET' },
      ['NESTED'],
    ],
    product_model: 'MODELO_ATENDIMENTO',
    customizations: 'PERSONALIZACAO',
    numbers: 'NUMERACAO',
    sponsors: 'PATROCINADORES',
    artwork_locations: 'LOCAL_ARTE',
    delivery_mode: 'MODALIDADE',
    delivery_address: 'ENDERECO',
    city_or_postal_code: 'CEP_SENTINELA',
    pickup_location: 'RETIRADA',
    needed_by: 'DIA_DESEJADO',
    purchase_profile: 'PERFIL_PRIVADO',
    purpose: 'FINALIDADE_PRIVADA',
    price: 'FINANCEIRO_PRIVADO',
    unknown: 'DESCONHECIDO',
  };
  const html = renderOrderFicha(order, TEMPLATE_V7);
  for (const text of [
    'MODELO_ATENDIMENTO',
    'PERSONALIZACAO',
    'NUMERACAO',
    'PATROCINADORES',
    'LOCAL_ARTE',
    'MODALIDADE',
    'ENDERECO',
    'CEP_SENTINELA',
    'RETIRADA',
    'DIA_DESEJADO',
    'informação complementar do atendimento',
    '&lt;script&gt;',
    '&lt;img',
    '&amp;',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /<script>|<img|SECRET|NESTED|PERFIL_PRIVADO|FINALIDADE_PRIVADA|FINANCEIRO_PRIVADO|DESCONHECIDO|\[object Object\]/u,
  );
  assert.ok(html.includes('não é previsão confirmada'));
});

test('FIP-04/05: store includes shipping notes and CEP without payment data or links', () => {
  const html = renderOrderFicha(store, TEMPLATE_V7);
  assert.ok(html.includes('69301-000'));
  assert.ok(
    html.includes('Entrar em contato para pegar as informações de entrega.'),
  );
  assert.ok(
    html.includes('5527900009110') || html.includes('+55 (27) 90000-9110'),
  );
  assert.doesNotMatch(
    html,
    /R\$|18000|InfinitePay|recibo\.infinitepay|Pix|Valor pago|Pagamento|Comprovante|nsu-sintetico|fatura-sintetica|Página 1 de 1/u,
  );
  const order = structuredClone(store);
  order.ficha.observations = ['', null, 'ENVIO <script>texto</script>'];
  assert.ok(
    renderOrderFicha(order, TEMPLATE_V7).includes(
      'ENVIO &lt;script&gt;texto&lt;/script&gt;',
    ),
  );
});

test('FIP-05: structured money, billing, Olist and payment dates never enter the new print projection', () => {
  const order = structuredClone(attendance);
  Object.assign(order, {
    finalAmountCents: 99887766,
    paymentCondition: 'FINANCEIRO_SECRETO',
    paidOn: '2024-01-31',
    billing: { url: 'COBRANCA_SECRETA' },
    olist: { id: 'ERP_SECRETO' },
  });
  order.ficha.serviceData.billing = { amount: 'COBRANCA_SECRETA' };
  order.ficha.items[0].grade[0].subtotalCents = 88776655;
  const html = renderOrderFicha(order, TEMPLATE_V7);
  assert.doesNotMatch(
    html,
    /99887766|88776655|FINANCEIRO_SECRETO|COBRANCA_SECRETA|ERP_SECRETO|31\/01\/2024|Pago em/u,
  );
  assert.equal(
    /** @type {any} */ (printSnapshot(order, TEMPLATE_V7).pedido.lastro)
      .pagamento,
    undefined,
  );
});

test('FIP-05: explicit financial text blocks printing without silently deleting an instruction', () => {
  for (const original of [attendance, store]) {
    for (const note of [
      'Separar etiquetas. R$ 500',
      'Valor pago: 500',
      'Cobrança no Pix',
      '500 reais',
      'US$ 50',
      'Pagamento parcelado',
    ]) {
      const order = structuredClone(original);
      order.ficha.observations = [note];
      assert.throws(() => renderOrderFicha(order, TEMPLATE_V7), {
        code: 'PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED',
        statusCode: 422,
      });
      assert.deepEqual(order.ficha.observations, [note]);
    }
  }
});

test('FIP-02: long notes and unbroken tokens continue without dropping characters', () => {
  const notes = [
    'Á'.repeat(6200),
    ...Array.from(
      { length: 40 },
      (_, i) => `Instrução ${i}: ${'Conferir acabamento. '.repeat(50)}`,
    ),
  ];
  const pages = paginateFactoryItems([], notes);
  assert.ok(pages.length > 4);
  assert.equal(
    pages.flatMap((page) => page.observations).join(''),
    notes.join(''),
  );
  assert.ok(pages.every((page) => page.observations.length > 0));
  assert.deepEqual(
    factoryInstructions({
      observations: [null, '', { private: 1 }],
      serviceData: { notes: [null, '  Conferir  '] },
    }),
    ['Notas do atendimento — informação complementar do atendimento: Conferir'],
  );
});

test('FIP-06: candidate templates do not change the approved defaults before review', () => {
  assert.equal(PRINT_TEMPLATE, TEMPLATE_V6);
  assert.equal(
    renderOrderFicha(attendance),
    renderOrderFicha(attendance, TEMPLATE_V6),
  );
  assert.equal(renderOrderFicha(store), renderOrderFicha(store, TEMPLATE_V6));
  assert.ok(renderOrderFicha(store).includes('Pagamento'));
  assert.ok(!renderOrderFicha(store, TEMPLATE_V7).includes('Pagamento'));
});

test('FIP-02: explicit line breaks are measured and split before they overflow a page', () => {
  for (const newline of ['\n', '\r', '\r\n']) {
    const note = `x${newline}`.repeat(99) + 'x';
    const notes = Array.from({ length: 5 }, () => note);
    assert.ok(estimateFactoryNotesHeight([note]) > 1400);
    const pages = paginateFactoryItems([], notes);
    assert.ok(pages.length >= 10);
    assert.equal(
      pages.flatMap((page) => page.observations).join(''),
      notes.join(''),
    );
    for (const page of pages)
      assert.ok(estimateFactoryNotesHeight(page.observations) < 600);
  }
});

test('FIP-06: candidate package matches both PDFs, and pending approval blocks the switch', async () => {
  const gate = await validateFichaReviewV7();
  assert.equal(fichaV7Approved(gate), false);
  assert.throws(
    () =>
      validateFichaPrintSwitch({
        gate: {},
        gateV7: gate,
        printTemplate: TEMPLATE_V7,
      }),
    /before its approval/u,
  );
  const fake = structuredClone(gate);
  fake.provisionalApproval.approved = true;
  fake.provisionalApproval.status = 'approved';
  assert.equal(
    fichaV7Approved(fake),
    false,
    'a status alone is not sample approval',
  );
  fake.provisionalApproval.reviewedBy.name = 'PO sintético';
  fake.provisionalApproval.reviewedAt = '2026-11-09';
  fake.samples.store.sha256 = 'modified';
  assert.equal(
    fichaV7Approved(fake),
    false,
    'approval cannot refer to a changed artifact',
  );
});

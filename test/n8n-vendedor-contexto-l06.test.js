import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// VND-L06 / AGT-01..05/08. Fictional situations reconstructed from behavioral
// patterns, with no copied customer/seller identities, amounts or transcripts.
// Explicit model outputs make these workflow regressions, not model training
// or evidence of provider accuracy or publication to WhatsApp.
const snapshot = JSON.parse(
  await readFile(
    new URL(
      '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const nodes = new Map(
  snapshot.nodes.map((/** @type {any} */ item) => [item.name, item]),
);

/** @param {string} name @param {any} item @param {Record<string, any>} [upstream] */
function run(name, item, upstream = {}) {
  return JSON.parse(
    JSON.stringify(
      vm.runInNewContext(
        `(() => {\n${nodes.get(name).parameters.jsCode}\n})()`,
        {
          $json: item,
          $input: { item: { json: item } },
          $: (/** @type {string} */ key) => ({ item: { json: upstream[key] } }),
          $execution: { id: 'synthetic-l06' },
        },
      ).json,
    ),
  );
}

/** @param {string} text @param {any} [inbound] @param {any} [output] */
function decide(text, inbound = {}, output = {}) {
  const crm = {
    accepted: true,
    conversation_id: 'conversation-synthetic-l06',
    automation_epoch: 9,
    source_revision: 14,
    automation_message_count: 2,
    automation_message_cap: 15,
    order_opening_policy: 'human_confirmation',
    briefing: {},
    recent_messages: [],
    subjects: [],
    source_subject_ids: [],
    contact_context: null,
    sellers: [],
    ...inbound,
  };
  const ctx = run('Montar contexto da IA (MVP)', crm, {
    'CRM - Registrar inbound (MVP)': crm,
    'Preparar inbound CRM (MVP)': { received_at: '2026-11-11T13:00:01.000Z' },
    'Normalizar evento WhatsApp (MVP)': {
      channel: 'whatsapp',
      event_id: 'synthetic-event-l06',
      from: '5500000000042',
      phone_number_id: 'synthetic-line',
      text,
      customer_name: '',
      message_type: 'text',
      occurred_at: '2026-11-11T13:00:00.000Z',
    },
  });
  return run(
    'Normalizar decisão da IA (MVP)',
    {
      output: {
        reply_text: 'Qual cor você quer?',
        briefing_patch: {},
        answer_status: 'none',
        person_request: 'none',
        asked_field: null,
        ...output,
      },
    },
    { 'Montar contexto da IA (MVP)': ctx },
  );
}

for (const text of [
  'Olá! Vi as fotos de peças no site e quero um orçamento.',
  'Vi fotos de camisetas no site.',
]) {
  test(`generic site photo origin overrides only a spurious external-context flag: ${text}`, () => {
    const result = decide(text, {}, { external_context: true });
    assert.equal(result.handoff_required, false);
    assert.equal(result.open_order, false);
    assert.notEqual(result.trigger, 'partnership');
    assert.equal(result.asked_point, 'customer_name');
  });
}

for (const text of [
  'Vocês podem enviar fotos das peças?',
  'Me manda fotos dos modelos.',
  'Vi fotos no site. Quero a camisa daquele post.',
  'Vi as fotos de peças no site e preciso de nota fiscal.',
  'Vi as fotos de peças no site, já combinei com o vendedor.',
]) {
  test(`real photo, fiscal, specific-piece or prior-team requests still transfer: ${text}`, () => {
    const result = decide(text);
    assert.equal(result.handoff_required, true);
    assert.equal(result.open_order, false);
  });
}

test('a person request retains priority despite the generic site-origin exception', () => {
  const result = decide(
    'Vi fotos de camisetas no site.',
    {},
    {
      person_request: 'generic',
      external_context: true,
    },
  );
  assert.equal(result.trigger, 'human_requested');
});

/** @type {Array<[string, Record<string, string | number>]>} */
const multiProductCases = [
  [
    'Quero camisetas e bonés.',
    { product_type: 'camisetas e bonés', colors: 'azul', quantity: 36 },
  ],
  [
    'Quero polo e regata.',
    {
      product_type: 'camisetas',
      product_model: 'polo e regata',
      fabrics: 'algodão',
    },
  ],
  [
    'Quero orçamento de 12 camisas e 24 bonés.',
    { product_type: 'camisetas e bonés', quantity: 36 },
  ],
];
for (const [text, patch] of multiProductCases) {
  test(`multiple products have no shared scalar projection or unscoped follow-up: ${text}`, () => {
    const result = decide(
      text,
      {},
      { briefing_patch: patch, asked_field: 'colors' },
    );
    assert.equal(result.trigger, 'subject_ambiguous');
    assert.equal(result.handoff_required, true);
    assert.equal(result.briefing_patch, null);
    assert.equal(result.asked_point, null);
    assert.equal(result.open_order, false);
    assert.match(result.reasoning, /Produtos sem alvo individual/);
    assert.doesNotMatch(result.reply_text, /qual cor|qual modelo/i);
  });
}

test('an older mixed-product briefing cannot receive an ambiguous color or quantity', () => {
  const result = decide(
    'Azul, 18 peças',
    {
      briefing: {
        product_type: 'camisetas e bonés',
        next_required_field: 'colors',
      },
    },
    {
      briefing_patch: { colors: 'azul', quantity: 18 },
    },
  );
  assert.equal(result.trigger, 'subject_ambiguous');
  assert.equal(result.briefing_patch, null);
  assert.match(result.reasoning, /camisetas e bonés/);
});

for (const text of [
  'Quero polo azul e gola preta.',
  'Quero camiseta comum.',
  'Quero polo ou regata.',
]) {
  test(`single-product detail or undecided model does not imply two items: ${text}`, () => {
    const result = decide(
      text,
      {},
      { briefing_patch: { product_type: 'camisetas' } },
    );
    assert.notEqual(result.trigger, 'subject_ambiguous');
    assert.equal(result.handoff_required, false);
  });
}

for (const text of [
  'Algodão, não sei.',
  'Talvez poliéster.',
  'Acho que dry fit.',
]) {
  test(`uncertain fabric does not become a confirmed model extraction: ${text}`, () => {
    const result = decide(
      text,
      {
        briefing: { product_type: 'camisetas', next_required_field: 'fabrics' },
      },
      {
        briefing_patch: { fabrics: 'algodão' },
        answer_status: 'answered',
      },
    );
    assert.equal(result.briefing_patch.fabrics, 'Definir com o vendedor');
    assert.equal(result.answer_status, 'deferred');
    assert.match(result.briefing_patch.notes, /Tecido a confirmar/);
    assert.notEqual(result.asked_point, 'fabrics');
  });
}

test('uncertainty does not overwrite an earlier confirmed fabric', () => {
  const result = decide(
    'Talvez poliéster.',
    { briefing: { product_type: 'camisetas', fabrics: 'algodão' } },
    {
      briefing_patch: { fabrics: 'poliéster' },
    },
  );
  assert.equal(result.briefing_patch.fabrics, undefined);
  assert.match(result.briefing_patch.notes, /Tecido a confirmar/);
});

for (const text of [
  'Não sei a cor, mas quero algodão.',
  'Prefiro algodão, não sei o tamanho.',
]) {
  test(`uncertainty about another point preserves the explicit fabric: ${text}`, () => {
    const result = decide(
      text,
      {
        briefing: { product_type: 'camisetas', next_required_field: 'fabrics' },
      },
      {
        briefing_patch: { fabrics: 'algodão' },
        answer_status: 'answered',
      },
    );
    assert.equal(result.briefing_patch.fabrics, 'algodão');
    assert.doesNotMatch(
      result.briefing_patch.notes ?? '',
      /Tecido a confirmar/,
    );
  });
}

for (const text of [
  'Faça orçamento com 12 unidades e com 24 unidades.',
  'Quero os valores para 12 peças ou com 24 peças.',
]) {
  test(`quote alternatives with repeated prepositions never choose or replace quantity: ${text}`, () => {
    const result = decide(
      text,
      {
        briefing: {
          product_type: 'camisetas',
          quantity: 8,
          notes: 'Nota sintética anterior',
        },
      },
      {
        briefing_patch: { quantity: 24 },
      },
    );
    assert.equal(result.trigger, 'commercial_question');
    assert.equal(result.briefing_patch.quantity, undefined);
    assert.match(result.briefing_patch.notes, /Nota sintética anterior/);
    assert.match(result.briefing_patch.notes, /12 e 24/);
    assert.match(result.reasoning, /quantidade não confirmada/);
    assert.equal(result.open_order, false);
  });
}

test('a clear single quantity correction remains valid', () => {
  const result = decide(
    'Mude para 24 peças.',
    { briefing: { product_type: 'camisetas', quantity: 8 } },
    {
      briefing_patch: { quantity: 24 },
    },
  );
  assert.equal(result.briefing_patch.quantity, 24);
  assert.notEqual(result.trigger, 'commercial_question');
});

for (const text of [
  'Já fiz um layout aí com o pessoal.',
  'Já combinamos a arte com vocês.',
  'Já fizemos uma arte com a equipe.',
]) {
  test(`prior artwork work with the team transfers even when the model misses it: ${text}`, () => {
    const result = decide(text, {}, { external_context: false });
    assert.equal(result.trigger, 'external_context');
    assert.equal(result.handoff_reason, 'human_requested');
    assert.equal(result.asked_point, null);
    assert.equal(result.open_order, false);
    assert.match(result.reasoning, /Retomar layout\/arte/);
    assert.doesNotMatch(result.reply_text, /qual cor|qual modelo|qual.*nome/i);
  });
}

for (const text of [
  'Fiz um layout em casa.',
  'Já fiz uma arte no editor.',
  'Já comprei com vocês, agora quero um pedido novo.',
]) {
  test(`customer-made artwork and recurrence alone do not prove an earlier agreement: ${text}`, () => {
    const result = decide(text);
    assert.notEqual(result.trigger, 'external_context');
    assert.equal(result.handoff_required, false);
  });
}

test('commercial statements by a seller in history never become automated terms', () => {
  const result = decide(
    'Qual o valor para 12 camisetas?',
    {
      briefing: { product_type: 'camisetas' },
      recent_messages: [
        {
          sender_type: 'human',
          text: 'Exemplo fictício: mínimo especial de 3 peças, R$ 17,00 e entrega em 2 dias.',
        },
      ],
    },
    {
      asks_price: true,
      reply_text: 'Fica R$ 17,00, mínimo 3 e entrega em 2 dias.',
    },
  );
  assert.equal(result.open_order, false);
  assert.doesNotMatch(result.reply_text, /17|mínimo 3|entrega em 2/);
  assert.equal(result.briefing_patch?.price, undefined);
});

test('handoff preserves fence coordinates and carries no automatic order', () => {
  const result = decide('Já fiz um layout aí com o pessoal.');
  const handoff = run('Preparar handoff da IA (MVP)', result);
  assert.equal(handoff.payload.automation_epoch, 9);
  assert.equal(handoff.payload.source_revision, 14);
  assert.equal(handoff.payload.order, undefined);
  assert.equal(handoff.payload.handoff.reason, 'human_requested');
});

for (const text of [
  'Não quero boné, só camiseta.',
  'Quero uma camiseta com desenho de boné.',
  'Não quero regata, quero polo.',
]) {
  test(`a rejected product or drawing is not a second requested item: ${text}`, () => {
    const result = decide(
      text,
      {},
      { briefing_patch: { product_type: 'camisetas', product_model: 'polo' } },
    );
    assert.notEqual(result.trigger, 'subject_ambiguous');
    assert.equal(result.handoff_required, false);
    assert.equal(result.briefing_patch.product_type, 'camisetas');
  });
}
for (const [text, product_model] of [
  ['Quero 10 polos e 12 regatas.', 'polos e regatas'],
  ['Quero camisa comum e polo.', 'camisa comum e polo'],
]) {
  test(`plural or synonymous models still need separate item targets: ${text}`, () => {
    const result = decide(
      text,
      {},
      {
        briefing_patch: {
          product_type: 'camisetas',
          product_model,
          quantity: 22,
          colors: 'azul',
        },
      },
    );
    assert.equal(result.trigger, 'subject_ambiguous');
    assert.equal(result.briefing_patch, null);
  });
}
for (const text of [
  'Quero algodão, não sei sobre a cor.',
  'Talvez poliéster, mas decidi algodão.',
]) {
  test(`another-field doubt or a later clear choice preserves the chosen fabric: ${text}`, () => {
    const result = decide(
      text,
      {
        briefing: { product_type: 'camisetas', next_required_field: 'fabrics' },
      },
      { briefing_patch: { fabrics: 'algodão' } },
    );
    assert.equal(result.briefing_patch.fabrics, 'algodão');
  });
}
test('the last explicit fabric decision wins even when extraction kept the earlier uncertain option', () => {
  const result = decide(
    'Talvez poliéster, mas decidi algodão.',
    {},
    { briefing_patch: { fabrics: 'poliéster' } },
  );
  assert.equal(result.briefing_patch.fabrics, 'algodão');
});
test('work with the customer own team is not a prior Silmer agreement', () => {
  const result = decide('Já fiz uma arte com a equipe da minha empresa.');
  assert.notEqual(result.trigger, 'external_context');
  assert.equal(result.handoff_required, false);
});
test('quote alternatives also accept a connective also without replacing quantity', () => {
  const result = decide(
    'Quero orçamento de 12 peças e também com 24 peças.',
    { briefing: { product_type: 'camisetas', quantity: 8 } },
    { briefing_patch: { quantity: 24 } },
  );
  assert.equal(result.trigger, 'commercial_question');
  assert.equal(result.briefing_patch.quantity, undefined);
  assert.match(result.briefing_patch.notes, /12 e 24/);
});

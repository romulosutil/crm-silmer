import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { BRIEFING_PATCH_FIELDS } from '../modules/n8n-integration/src/service.js';
import {
  ContractValidationError,
  validateBriefingPatch,
  validateEvent,
} from '../schemas/fixtures/external/n8n/contract-validator.mjs';

const fixtureRoot = new URL(
  '../schemas/fixtures/external/n8n/',
  import.meta.url,
);
const workflowSnapshot = new URL(
  '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
  import.meta.url,
);

/** @param {string} name @returns {Promise<any>} */
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}

/** @returns {Promise<Map<string, any>>} */
async function workflowNodesByName() {
  const workflow = JSON.parse(await readFile(workflowSnapshot, 'utf8'));
  return new Map(
    workflow.nodes.map((/** @type {any} */ node) => [node.name, node]),
  );
}

/**
 * Runs an n8n "run once for each item" Code node body outside n8n, with only
 * the `$json` item and the `$('<node>')` lookups the body actually uses.
 *
 * @param {string} jsCode
 * @param {any} item
 * @param {Record<string, any>} upstream
 * @returns {any}
 */
function runCodeNode(jsCode, item, upstream) {
  const result = vm.runInNewContext(`(() => {\n${jsCode}\n})()`, {
    $json: item,
    $: (/** @type {string} */ name) => ({ item: { json: upstream[name] } }),
    $execution: { id: '42' },
  });
  return JSON.parse(JSON.stringify(result.json));
}

class ConversationFenceHarness {
  constructor() {
    this.automationEpoch = 3;
    this.claimedRevision = 6;
    this.mode = 'assistant';
    this.revision = 7;
    this.reservations = new Map();
  }

  takeover() {
    this.automationEpoch += 1;
    this.mode = 'human';
  }

  /** @param {any} event @param {any} contract */
  reserve(event, contract) {
    validateEvent(event, contract);
    const fingerprint = JSON.stringify(event);
    const existing = this.reservations.get(event.command_id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ContractValidationError('IDEMPOTENCY_KEY_REUSED');
      }
      return { send_authorized: false };
    }
    if (
      this.mode !== 'assistant' ||
      event.automation_epoch !== this.automationEpoch ||
      event.source_revision !== this.revision ||
      this.claimedRevision >= event.source_revision
    ) {
      throw new ContractValidationError('STALE_AUTOMATION_FENCE');
    }
    this.claimedRevision = event.source_revision;
    this.reservations.set(event.command_id, { fingerprint });
    return { send_authorized: true };
  }
}

/** @param {string|null} current @param {string} incoming @param {string[]} order */
function applyDeliveryStatus(current, incoming, order) {
  if (incoming === 'failed') return current;
  const currentRank = current === null ? -1 : order.indexOf(current);
  const incomingRank = order.indexOf(incoming);
  if (incomingRank < 0) throw new ContractValidationError('INVALID_STATUS');
  return incomingRank > currentRank ? incoming : current;
}

/** @param {Record<string, unknown>} current @param {any} patch @param {any} contract */
function applyBriefingPatch(current, patch, contract) {
  validateBriefingPatch(patch, contract);
  return Object.fromEntries([
    ...Object.entries(current),
    ...Object.entries(patch).filter(([, value]) => value !== null),
  ]);
}

test('folds claim into one reservation per current inbound revision', async () => {
  const contract = await fixture('contract-v1.json');
  const event = await fixture('message-send-requested.json');
  const fence = new ConversationFenceHarness();

  assert.equal(fence.reserve(event, contract).send_authorized, true);
  assert.equal(fence.reserve(event, contract).send_authorized, false);
  assert.throws(
    () =>
      fence.reserve(
        { ...event, command_id: 'command-second', event_id: 'event-second' },
        contract,
      ),
    /STALE_AUTOMATION_FENCE/u,
  );
});

test('takeover and a newer inbound revision invalidate an old AI decision', async () => {
  const contract = await fixture('contract-v1.json');
  const event = await fixture('message-send-requested.json');

  const takeoverFence = new ConversationFenceHarness();
  takeoverFence.takeover();
  assert.throws(
    () => takeoverFence.reserve(event, contract),
    /STALE_AUTOMATION_FENCE/u,
  );

  const revisionFence = new ConversationFenceHarness();
  revisionFence.revision += 1;
  assert.throws(
    () => revisionFence.reserve(event, contract),
    /STALE_AUTOMATION_FENCE/u,
  );
});

test('merges only approved, non-null briefing fields', async () => {
  const contract = await fixture('contract-v1.json');
  assert.deepEqual(
    applyBriefingPatch(
      { quantity: 10, segment: 'uniform' },
      { quantity: 30, segment: null },
      contract,
    ),
    { quantity: 30, segment: 'uniform' },
  );
  for (const forbidden of [{ payment_confirmed: true }, { price: 100 }]) {
    assert.throws(() => validateBriefingPatch(forbidden, contract));
  }
  assert.equal(
    validateBriefingPatch(
      {
        customer_name: 'Grupo Aurora',
        fabrics: ['dry fit'],
        next_required_field: 'sizes',
        order_name: 'Evento Aurora',
        product_type: 'camiseta',
      },
      contract,
    ),
    true,
  );
});

test('never regresses delivery status when callbacks arrive out of order', async () => {
  const contract = await fixture('contract-v1.json');
  let status = null;
  for (const incoming of ['sent', 'delivered', 'read', 'delivered', 'sent']) {
    status = applyDeliveryStatus(
      status,
      incoming,
      contract.deliveryStatusOrder,
    );
  }
  assert.equal(status, 'read');
});

test('keeps the simplified workflow inactive and free of removed runtime concepts', async () => {
  const workflow = JSON.parse(await readFile(workflowSnapshot, 'utf8'));
  assert.equal(workflow.source.active, false);
  assert.equal(workflow.source.activeVersionId, null);
  // 45 nodes plus the seven of the handoff notice chain (BOT-03).
  assert.ok(workflow.nodes.length < 55);
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /claim_token|claim_id|ai-turns\/claim/u);
  assert.doesNotMatch(serialized, /silmer_failures|windowBufferMemory/u);
  assert.doesNotMatch(serialized, /credentials|webhookId|pinData/u);

  const reserveNodes = workflow.nodes.filter((/** @type {any} */ node) =>
    /Reservar envio/u.test(node.name),
  );
  const sendNodes = workflow.nodes.filter(
    (/** @type {any} */ node) =>
      node.type === 'n8n-nodes-base.whatsApp' &&
      node.parameters?.operation === 'send',
  );
  assert.ok(reserveNodes.length >= 1);
  assert.ok(sendNodes.length >= 1);
  assert.match(serialized, /pré-ficha do pedido/u);
  assert.match(serialized, /ready_for_handoff/u);
  assert.match(serialized, /next_required_field/u);
});

test('opens the order with the reply or the handoff, never on a call of its own (ADR 014)', async () => {
  const contract = await fixture('contract-v1.json');
  const workflow = JSON.parse(await readFile(workflowSnapshot, 'utf8'));
  const byName = new Map(
    workflow.nodes.map((/** @type {any} */ node) => [node.name, node]),
  );
  /** @param {string} source @param {number} [output] */
  const targets = (source, output = 0) =>
    (workflow.connections[source]?.main?.[output] ?? []).map(
      (/** @type {any} */ edge) => edge.node,
    );
  const serialized = JSON.stringify(workflow);

  // The parallel, fire-and-forget intent branch is gone.
  assert.doesNotMatch(serialized, /event_type: 'order\.intent_confirmed'/u);
  for (const retired of [
    'Cliente confirmou intenção de pedido? (MVP)',
    'Preparar intenção de pedido (MVP)',
    'CRM - Registrar intenção de pedido (MVP)',
  ]) {
    assert.equal(byName.has(retired), false, retired);
  }
  assert.deepEqual(targets('Normalizar decisão da IA (MVP)'), [
    'Transferir para humano? (MVP)',
  ]);

  // open_order rides on the reservation and on the handoff.
  const decision = {
    conversation_id: 'conversation-1',
    automation_epoch: 2,
    source_revision: 7,
    briefing_patch: { quantity: 30 },
    handoff_reason: 'negotiation',
    reasoning: 'Motivo: Perguntou o valor.',
    reply_text: 'Qual a cor da camisa?',
    open_order: true,
  };
  const reservation = runCodeNode(
    byName.get('Preparar reserva de envio da IA (MVP)').parameters.jsCode,
    decision,
    {},
  );
  const handoff = runCodeNode(
    byName.get('Preparar handoff da IA (MVP)').parameters.jsCode,
    decision,
    {},
  );
  for (const event of [reservation.payload, handoff.payload]) {
    assert.equal(event.open_order, true, event.event_type);
    assert.equal(validateEvent(event, contract), true);
  }
  assert.equal(
    runCodeNode(
      byName.get('Preparar reserva de envio da IA (MVP)').parameters.jsCode,
      { ...decision, open_order: false },
      {},
    ).payload.open_order,
    false,
  );

  // The CRM answers on the same call; both answers reach the failure check.
  assert.deepEqual(targets('CRM - Reservar envio da IA (MVP)').sort(), [
    'Envio da IA autorizado? (MVP)',
    'Pedido não abriu? (MVP)',
  ]);
  assert.deepEqual(targets('CRM - Registrar handoff (MVP)').sort(), [
    'Pedido não abriu? (MVP)',
    'Preparar aviso de transferência (MVP)',
  ]);
  assert.deepEqual(targets('Pedido não abriu? (MVP)'), [
    'Preparar falha ao abrir pedido (MVP)',
  ]);
  assert.deepEqual(targets('Pedido não abriu? (MVP)', 1), []);
  assert.deepEqual(targets('Preparar falha ao abrir pedido (MVP)'), [
    'CRM - Registrar falha ao abrir pedido (MVP)',
  ]);
  // n8n (executionOrder v1) runs sibling branches top to bottom: the check
  // sits above the reply and the notice, so they still end the execution.
  assert.equal(workflow.settings.executionOrder, 'v1');
  const check = byName.get('Pedido não abriu? (MVP)');
  for (const sibling of [
    'Envio da IA autorizado? (MVP)',
    'Preparar aviso de transferência (MVP)',
  ]) {
    assert.ok(check.position[1] < byName.get(sibling).position[1], sibling);
  }
  // Reporting the failure can never block what the customer receives.
  const report = byName.get('CRM - Registrar falha ao abrir pedido (MVP)');
  assert.equal(report.onError, 'continueErrorOutput');
  assert.match(report.parameters.url, /integrations\/n8n\/events/u);
});

test('a failed order opening raises workflow.failed ORDER_OPEN_FAILED (ADR 014)', async () => {
  const contract = await fixture('contract-v1.json');
  const byName = await workflowNodesByName();
  const condition = /^=\{\{ (.*) \}\}$/u.exec(
    byName.get('Pedido não abriu? (MVP)').parameters.conditions.conditions[0]
      .leftValue,
  )?.[1];
  assert.ok(condition, 'expected an n8n expression on the failure check');
  /** @param {any} answer */
  const failed = (answer) => vm.runInNewContext(condition, { $json: answer });
  // An expression error on this check would stop the reply: no globals.
  assert.doesNotMatch(condition, /\b[A-Z][A-Za-z]*\(/u);
  assert.equal(
    failed({ accepted: true, order: { opened: false, error: 'X_Y' } }),
    'true',
  );
  assert.equal(
    failed({
      accepted: true,
      order: { opened: true, id: 'order-1', created: true },
    }),
    'false',
  );
  assert.equal(failed({ accepted: true, send_authorized: true }), 'false');
  assert.equal(failed({ accepted: true, order: null }), 'false');

  const prepare = byName.get('Preparar falha ao abrir pedido (MVP)').parameters
    .jsCode;
  const answer = {
    accepted: true,
    send_authorized: true,
    order: { opened: false, error: 'ORDER_OPEN_FAILED' },
  };
  const fromReply = runCodeNode(prepare, answer, {
    'Preparar reserva de envio da IA (MVP)': {
      payload: {
        conversation_id: 'conversation-1',
        event_id: 'reserve:conversation-1:7:ai-response',
        event_type: 'message.send.requested',
      },
    },
  });
  assert.deepEqual(fromReply.payload.failure, {
    code: 'ORDER_OPEN_FAILED',
    event_type: 'message.send.requested',
    reason: 'ORDER_OPEN_FAILED',
  });
  assert.equal(fromReply.payload.event_type, 'workflow.failed');
  assert.equal(fromReply.payload.conversation_id, 'conversation-1');
  assert.equal(
    fromReply.idempotency_key,
    'order-open-failed:reserve:conversation-1:7:ai-response',
  );
  assert.equal(fromReply.payload.event_id, fromReply.idempotency_key);
  assert.equal(validateEvent(fromReply.payload, contract), true);

  const fromMedia = runCodeNode(
    prepare,
    {
      ...answer,
      order: { opened: false, error: 'ORDERS_RUNTIME_UNAVAILABLE' },
    },
    {
      'Preparar handoff de conteúdo (MVP)': {
        payload: {
          conversation_id: 'conversation-2',
          event_id: 'conversation-2:4:unsupported',
          event_type: 'handoff.requested',
        },
      },
    },
  );
  assert.equal(fromMedia.payload.conversation_id, 'conversation-2');
  assert.equal(fromMedia.payload.failure.event_type, 'handoff.requested');
  assert.equal(fromMedia.payload.failure.reason, 'ORDERS_RUNTIME_UNAVAILABLE');
  assert.equal(validateEvent(fromMedia.payload, contract), true);
});

test('agent output parser tolerates stray keys instead of failing the execution', async () => {
  const byName = await workflowNodesByName();
  const parser = byName.get('Validar saída do MVP');
  assert.ok(parser, 'expected the structured output parser node to exist');
  const schema = JSON.parse(parser.parameters.inputSchema);

  assert.notEqual(
    schema.additionalProperties,
    false,
    'top-level stray keys (e.g. briefing_status) must not reject the reply',
  );
  assert.notEqual(
    schema.properties.briefing_patch.additionalProperties,
    false,
    'stray briefing_patch keys (e.g. order_intent_confirmed) must not reject the reply',
  );
  assert.doesNotMatch(
    parser.parameters.inputSchema,
    /"additionalProperties":false/u,
  );
  // Only the reply and the patch are required: the model sometimes nests or
  // omits the signals, and the decision node defaults them (ADR 009).
  assert.deepEqual([...schema.required].sort(), [
    'briefing_patch',
    'reply_text',
  ]);

  // ADR 014: the model no longer reports the intent; a stray flag still parses.
  assert.equal('order_intent_confirmed' in schema.properties, false);
  assert.equal(
    'order_intent_confirmed' in schema.properties.briefing_patch.properties,
    false,
  );
  const agent = byName.get('Atendente virtual Silmer (MVP)');
  assert.doesNotMatch(
    agent.parameters.options.systemMessage,
    /order_intent_confirmed/u,
  );
  assert.doesNotMatch(
    byName.get('Montar contexto da IA (MVP)').parameters.jsCode,
    /Intenção de pedido|order_intent_confirmed/u,
  );
});

test('decision normalizer whitelists briefing_patch keys exactly as the CRM does', async () => {
  const byName = await workflowNodesByName();
  const jsCode = byName.get('Normalizar decisão da IA (MVP)').parameters.jsCode;
  const declaration = /const briefingFields = new Set\(\[([\s\S]*?)\]\);/u.exec(
    jsCode,
  );
  assert.ok(
    declaration,
    'expected a briefingFields whitelist in the normalizer',
  );
  const workflowFields = [...declaration[1].matchAll(/'([a-z_]+)'/gu)].map(
    (match) => match[1],
  );
  // The CRM ships a new field first (ADR 012); once the workflow sends it,
  // both lists match again.
  assert.deepEqual(
    [...workflowFields].sort(),
    [...BRIEFING_PATCH_FIELDS].sort(),
  );
});

test('the CRM, the contract fixture and its schema list the same briefing fields', async () => {
  const contract = await fixture('contract-v1.json');
  const schema = await fixture('contract-v1.schema.json');
  const crmFields = [...BRIEFING_PATCH_FIELDS].sort();
  assert.deepEqual([...contract.briefingPatchFields].sort(), crmFields);
  assert.deepEqual(
    Object.keys(schema.$defs.briefingPatch.properties).sort(),
    crmFields,
  );
  // ADR 012: the collar is its own field.
  assert.ok(BRIEFING_PATCH_FIELDS.has('collar'));
  assert.deepEqual(schema.$defs.briefingPatch.properties.collar, {
    type: ['string', 'null'],
  });
  assert.equal(validateBriefingPatch({ collar: 'gola V' }, contract), true);
  assert.throws(
    () => validateBriefingPatch({ gola: 'gola V' }, contract),
    ContractValidationError,
  );
});

test('decision normalizer ignores the retired order intent flag and strips stray patch keys (ADR 014)', async () => {
  const byName = await workflowNodesByName();
  const jsCode = byName.get('Normalizar decisão da IA (MVP)').parameters.jsCode;
  const context = {
    conversation_id: 'conversation-1',
    automation_epoch: 1,
    source_revision: 4,
    briefing: {},
  };
  // Verbatim shape returned by the model in DEV execution 54.
  const liveOutput = {
    output: {
      reply_text: 'Perfeito, Carla!',
      briefing_patch: {
        customer_name: 'Carla',
        product_model: 'camiseta básica',
        sizes: '20 M e 30 G',
        order_intent_confirmed: true,
        next_required_field: 'artwork_status',
      },
      handoff_ready: false,
      handoff_required: false,
      order_intent_confirmed: true,
      handoff_reason: null,
      reasoning: 'Cliente confirmou o orçamento.',
      briefing_status: 'collecting',
    },
  };

  const decision = runCodeNode(jsCode, liveOutput, {
    'Montar contexto da IA (MVP)': context,
  });
  // The type of shirt is a ficha point: that, not the flag, opens the order.
  assert.equal(decision.open_order, true);
  assert.equal('order_intent_confirmed' in decision, false);
  assert.equal('order_intent_confirmed' in decision.briefing_patch, false);
  assert.equal(decision.briefing_patch.customer_name, 'Carla');
  for (const key of Object.keys(decision.briefing_patch)) {
    assert.ok(BRIEFING_PATCH_FIELDS.has(key), `CRM would reject ${key}`);
  }

  // The flag alone, at the top level or inside the patch, opens nothing.
  const flagOnly = /** @type {any} */ (structuredClone(liveOutput));
  flagOnly.output.briefing_patch = {
    customer_name: 'Carla',
    order_intent_confirmed: true,
  };
  const ignored = runCodeNode(jsCode, flagOnly, {
    'Montar contexto da IA (MVP)': context,
  });
  assert.equal(ignored.open_order, false);
  assert.equal('order_intent_confirmed' in ignored.briefing_patch, false);
  assert.equal(ignored.briefing_patch.briefing_status, 'collecting');
});

test('decision normalizer applies the handoff rules of ADR 009', async () => {
  const byName = await workflowNodesByName();
  const jsCode = byName.get('Normalizar decisão da IA (MVP)').parameters.jsCode;
  /** @param {any} output @param {any} [context] */
  const decide = (output, context = {}) =>
    runCodeNode(
      jsCode,
      {
        output: {
          reply_text: 'Resposta da IA',
          briefing_patch: {},
          answer_status: 'none',
          person_request: 'none',
          ...output,
        },
      },
      {
        'Montar contexto da IA (MVP)': {
          conversation_id: 'conversation-1',
          automation_epoch: 1,
          source_revision: 3,
          briefing: {},
          recent_messages: [],
          current_text: '',
          profile_name: 'Perfil do WhatsApp',
          sellers: ['Marina', 'Edson', 'Lúcio', 'Dario'],
          message_cap: 15,
          turn: 3,
          ...context,
        },
      },
    );

  const price = decide({}, { current_text: 'e quanto fica isso tudo?' });
  assert.equal(price.handoff_reason, 'negotiation');
  assert.match(price.reply_text, /vendedores/u);
  assert.equal(
    decide({}, { current_text: 'aceitam pix? parcelam?' }).trigger,
    'price',
  );
  assert.equal(
    decide(
      { asks_price: true },
      { current_text: 'vocês fazem orçamento de camiseta?' },
    ).handoff_required,
    false,
    'asking for a quote is not asking the price',
  );
  assert.equal(
    decide({}, { current_text: 'em quanto tempo fica pronto?' }).trigger,
    null,
  );

  const seller = decide(
    { person_request: 'named', requested_person_name: 'Mari' },
    { current_text: 'a Mari tá por aí?' },
  );
  assert.equal(seller.handoff_reason, 'human_requested');
  assert.equal(seller.requested_seller, 'Marina');
  assert.match(seller.reasoning, /Vendedor pedido: Marina/u);
  assert.equal(
    decide(
      { person_request: 'named', requested_person_name: 'Lucio' },
      { current_text: 'quero falar com o Lucio' },
    ).requested_seller,
    'Lúcio',
  );
  assert.equal(
    decide(
      { person_request: 'named', requested_person_name: 'Marina' },
      { current_text: 'são 30 peças' },
    ).trigger,
    null,
    'a name echoed from the history is not a new request',
  );

  const firstAsk = decide(
    { person_request: 'named', requested_person_name: 'João' },
    { current_text: 'quero falar com o João' },
  );
  assert.equal(firstAsk.handoff_required, false);
  assert.match(firstAsk.briefing_patch.notes, /João/u);
  const secondAsk = decide(
    { person_request: 'named', requested_person_name: 'João' },
    {
      current_text: 'cadê o João?',
      recent_messages: [
        { sender_type: 'customer', text: 'quero falar com o João' },
        { sender_type: 'ai', text: 'Vou avisar a equipe.' },
        { sender_type: 'customer', text: 'cadê o João?' },
      ],
    },
  );
  assert.equal(secondAsk.trigger, 'unknown_person_repeated');
  assert.equal(secondAsk.handoff_reason, 'human_requested');

  const firstMiss = decide(
    { answer_status: 'unclear' },
    { briefing: { next_required_field: 'fabrics' } },
  );
  assert.equal(firstMiss.handoff_required, false);
  assert.equal(firstMiss.briefing_patch.briefing_status, 'clarifying');
  const question = decide(
    { answer_status: 'question' },
    {
      briefing: {
        next_required_field: 'fabrics',
        briefing_status: 'clarifying',
      },
    },
  );
  assert.equal(question.handoff_required, false);
  assert.equal(question.briefing_patch.briefing_status, 'clarifying');
  const secondMiss = decide(
    { answer_status: 'undecided' },
    {
      briefing: {
        next_required_field: 'fabrics',
        briefing_status: 'clarifying',
      },
    },
  );
  assert.equal(secondMiss.trigger, 'two_attempts');
  assert.equal(secondMiss.handoff_reason, 'low_confidence');

  const cap = decide({}, { turn: 15 });
  assert.equal(cap.trigger, 'message_limit');
  assert.match(cap.reasoning, /Limite de 15 mensagens/u);
  assert.equal(decide({}, { turn: 14 }).handoff_required, false);
  assert.equal(
    decide({ asks_price: true }, { turn: 15, current_text: 'qual o valor?' })
      .trigger,
    'price',
  );

  const sticky = decide(
    { order_intent_confirmed: false },
    { briefing: { briefing_status: 'quote_collecting' } },
  );
  assert.equal(sticky.open_order, true, 'an order once opened stays open');
  assert.equal(sticky.briefing_patch.briefing_status, 'quote_collecting');

  const profile = decide(
    { briefing_patch: { customer_name: 'Perfil do WhatsApp' } },
    { current_text: 'oi' },
  );
  assert.equal('customer_name' in profile.briefing_patch, false);

  const flattened = decide({
    briefing_patch: {
      product_type: ['camiseta', 'boné'],
      quantity: { camiseta: 30, bone: 30 },
      artwork_status: 'não informado',
    },
  });
  assert.equal(flattened.briefing_patch.product_type, 'camiseta, boné');
  assert.equal(flattened.briefing_patch.quantity, 'camiseta: 30; bone: 30');
  assert.equal('artwork_status' in flattened.briefing_patch, false);
  assert.equal(
    'sizes' in
      decide({ briefing_patch: { sizes: 'a definir com o time' } })
        .briefing_patch,
    false,
  );

  // The name and the seven ficha points (ADR 012).
  const complete = {
    customer_name: 'Ana',
    product_model: 'camiseta comum',
    quantity: 10,
    fabrics: 'algodão',
    colors: 'branca',
    collar: 'redonda',
    artwork_status: 'já tem a logo',
    sizes: 'M10',
  };
  const done = decide({ briefing_patch: complete });
  assert.equal(
    done.trigger,
    'briefing_complete',
    'a complete briefing hands off without asking to build the quote',
  );
  assert.equal(
    done.open_order,
    true,
    'a complete ficha holds the seven points, so the handoff opens the order',
  );
  assert.doesNotMatch(done.reply_text, /\?/u);
  assert.equal(
    decide({ briefing_patch: complete }, { turn: 15 }).trigger,
    'briefing_complete',
  );
});

test('sends the handoff notice the CRM reserved, and only that one (BOT-03)', async () => {
  const workflow = JSON.parse(await readFile(workflowSnapshot, 'utf8'));
  const byName = new Map(
    workflow.nodes.map((/** @type {any} */ node) => [node.name, node]),
  );
  /** @param {string} source @param {number} [output] */
  const targets = (source, output = 0) =>
    (workflow.connections[source]?.main?.[output] ?? []).map(
      (/** @type {any} */ edge) => edge.node,
    );
  assert.deepEqual(targets('CRM - Registrar handoff (MVP)').sort(), [
    'Pedido não abriu? (MVP)',
    'Preparar aviso de transferência (MVP)',
  ]);
  assert.deepEqual(targets('Aviso de transferência autorizado? (MVP)'), [
    'WhatsApp - Enviar aviso de transferência (MVP)',
  ]);
  const send = byName.get('WhatsApp - Enviar aviso de transferência (MVP)');
  assert.equal(send.onError, 'continueErrorOutput');
  assert.deepEqual(targets('WhatsApp - Enviar aviso de transferência (MVP)'), [
    'Preparar message.sent do aviso (MVP)',
  ]);
  assert.deepEqual(
    targets('WhatsApp - Enviar aviso de transferência (MVP)', 1),
    ['Preparar envio desconhecido do aviso (MVP)'],
  );

  const handoff = runCodeNode(
    byName.get('Preparar handoff da IA (MVP)').parameters.jsCode,
    {
      conversation_id: 'conversation-1',
      automation_epoch: 2,
      source_revision: 7,
      briefing_patch: {},
      handoff_reason: 'negotiation',
      reasoning: 'Motivo: Perguntou o valor.',
      reply_text: 'Quem passa os valores é um dos nossos vendedores.',
    },
    {},
  );
  assert.deepEqual(handoff.payload.handoff.notice, {
    command_id: 'conversation-1:7:handoff:notice',
    text: 'Quem passa os valores é um dos nossos vendedores.',
  });

  const prepare = byName.get('Preparar aviso de transferência (MVP)').parameters
    .jsCode;
  const whatsapp = { from: '5511999990000', phone_number_id: 'phone-1' };
  const reserved = runCodeNode(
    prepare,
    {
      notice: {
        command_id: 'conversation-1:7:handoff:notice',
        send_authorized: true,
      },
    },
    {
      'Preparar handoff da IA (MVP)': handoff,
      'Normalizar evento WhatsApp (MVP)': whatsapp,
    },
  );
  assert.equal(reserved.send_authorized, true);
  assert.equal(reserved.text, handoff.payload.handoff.notice.text);
  assert.equal(reserved.wa_id, '5511999990000');
  assert.equal(reserved.conversation_id, 'conversation-1');

  const media = runCodeNode(
    byName.get('Preparar handoff de conteúdo (MVP)').parameters.jsCode,
    {
      conversation_id: 'conversation-2',
      automation_epoch: 0,
      source_revision: 1,
    },
    { 'Normalizar evento WhatsApp (MVP)': { message_type: 'audio' } },
  );
  assert.match(media.payload.handoff.notice.text, /arquivo/u);
  assert.equal(
    runCodeNode(
      prepare,
      { notice: { command_id: null, send_authorized: false } },
      {
        'Preparar handoff de conteúdo (MVP)': media,
        'Normalizar evento WhatsApp (MVP)': whatsapp,
      },
    ).send_authorized,
    false,
    'a replay or a spent cap never reaches Meta',
  );
});

test('decision normalizer applies the PO decisions of 30/09 on top of BOT-03', async () => {
  const byName = await workflowNodesByName();
  const jsCode = byName.get('Normalizar decisão da IA (MVP)').parameters.jsCode;
  /** @param {any} output @param {any} [context] */
  const decide = (output, context = {}) =>
    runCodeNode(
      jsCode,
      {
        output: {
          reply_text: 'Resposta da IA',
          briefing_patch: {},
          answer_status: 'none',
          person_request: 'none',
          ...output,
        },
      },
      {
        'Montar contexto da IA (MVP)': {
          conversation_id: 'conversation-1',
          automation_epoch: 1,
          source_revision: 3,
          briefing: {},
          recent_messages: [],
          current_text: '',
          profile_name: '',
          sellers: [],
          message_cap: 15,
          turn: 3,
          crm_counter: true,
          ...context,
        },
      },
    );

  const cap = decide({}, { turn: 15 });
  assert.equal(cap.handoff_reason, 'iteration_limit');
  assert.match(cap.reasoning, /Limite de 15 mensagens do agente/u);
  assert.equal(
    decide({}, { turn: 15, crm_counter: false }).handoff_reason,
    'low_confidence',
    'a CRM without migration 0025 only knows low_confidence',
  );

  const deferred = decide(
    { answer_status: 'deferred' },
    { briefing: { next_required_field: 'sizes' } },
  );
  assert.equal(deferred.briefing_patch.sizes, 'Definir com o vendedor');
  assert.equal(deferred.missing_briefing_fields.includes('sizes'), false);
  assert.equal(
    decide({ briefing_patch: { fabrics: 'o vendedor indica o tecido' } })
      .briefing_patch.fabrics,
    'Definir com o vendedor',
  );

  const pickup = decide({ briefing_patch: { delivery_mode: 'retirada' } });
  assert.equal(pickup.briefing_patch.pickup_location, 'Loja da Silmer');

  const english = decide(
    { foreign_language: true },
    { current_text: 'hi, do you make t-shirts?' },
  );
  assert.equal(english.trigger, 'foreign_language');
  assert.equal(english.handoff_reason, 'unsupported');
});

test('the bot neither asks to build the quote nor asks the order name (PO, 01/10)', async () => {
  const byName = await workflowNodesByName();
  const prompt = byName.get('Atendente virtual Silmer (MVP)').parameters.options
    .systemMessage;
  assert.match(
    prompt,
    /Nunca pergunte se pode montar o pedido ou o orçamento/u,
  );
  assert.match(prompt, /Nunca pergunte o nome do pedido/u);
  assert.match(
    prompt,
    /pode escolher mais de uma e termine sempre com "ou outra"/u,
  );
  assert.doesNotMatch(prompt, /asked_field "order_intent"/u);

  const schema = JSON.parse(
    byName.get('Validar saída do MVP').parameters.inputSchema,
  );
  assert.equal(
    schema.properties.asked_field.enum.includes('order_intent'),
    false,
  );
  assert.equal(
    schema.properties.asked_field.enum.includes('order_name'),
    false,
  );

  const jsCode = byName.get('Normalizar decisão da IA (MVP)').parameters.jsCode;
  /** @param {any} output @param {any} [context] */
  const decide = (output, context = {}) =>
    runCodeNode(
      jsCode,
      {
        output: {
          reply_text: 'Resposta da IA',
          briefing_patch: {},
          answer_status: 'none',
          person_request: 'none',
          ...output,
        },
      },
      {
        'Montar contexto da IA (MVP)': {
          conversation_id: 'conversation-1',
          automation_epoch: 1,
          source_revision: 3,
          briefing: {},
          recent_messages: [],
          current_text: '',
          profile_name: '',
          sellers: ['Marina'],
          message_cap: 15,
          turn: 3,
          crm_counter: true,
          ...context,
        },
      },
    );

  const start = decide({ asked_field: 'order_name' });
  assert.equal(start.missing_briefing_fields.includes('order_name'), false);
  assert.notEqual(start.briefing_patch.next_required_field, 'order_name');
  assert.equal(
    decide({ briefing_patch: { order_name: 'EC Unidos da Várzea' } })
      .briefing_patch.order_name,
    'EC Unidos da Várzea',
    'an order name the customer volunteers is still kept',
  );

  // ADR 014: the quantity is a ficha point and opens the order; the model's
  // retired flag alone does not.
  const intent = decide(
    { order_intent_confirmed: true, briefing_patch: { quantity: 30 } },
    { current_text: 'quero 30 camisetas para o evento da empresa' },
  );
  assert.equal(intent.open_order, true);
  assert.equal(intent.handoff_required, false);
  assert.equal(intent.briefing_patch.briefing_status, 'quote_collecting');
  const flagOnly = decide(
    { order_intent_confirmed: true },
    { current_text: 'quero fazer uns uniformes' },
  );
  assert.equal(flagOnly.open_order, false);
  assert.equal(flagOnly.briefing_patch.briefing_status, 'collecting');

  const legacy = decide(
    { answer_status: 'unclear' },
    {
      briefing: {
        next_required_field: 'order_intent',
        briefing_status: 'clarifying',
      },
    },
  );
  assert.equal(
    legacy.handoff_required,
    false,
    'a conversation left on the retired quote question has nothing pending',
  );

  const notices = [
    decide({}, { current_text: 'quanto custa?' }),
    decide(
      { person_request: 'generic' },
      { current_text: 'quero falar com alguém' },
    ),
    decide(
      { person_request: 'named', requested_person_name: 'Marina' },
      { current_text: 'cadê a Marina?' },
    ),
    decide({ handoff_required: true, handoff_reason: 'complaint' }),
    decide({}, { turn: 15 }),
  ].map((decision) => decision.reply_text);
  for (const text of notices) {
    assert.match(text, /vendedor|equipe/u);
    assert.match(text, /aqui mesmo/u);
    assert.doesNotMatch(text, /Quem passa|chamando alguém|Já estou chamando/u);
  }
});

test('a question ignored twice hands off, and news for the ficha is welcome (PO, 01/10)', async () => {
  const byName = await workflowNodesByName();
  const prompt = byName.get('Atendente virtual Silmer (MVP)').parameters.options
    .systemMessage;
  assert.match(
    prompt,
    /"Quero camisa branca!" → "Que legal, e quantas peças você precisa\?"/u,
  );
  assert.match(prompt, /emende a próxima pergunta na mesma frase/u);
  assert.match(prompt, /não comece com "Anotei"/u);
  assert.match(prompt, /não repita a pergunta do nome em toda mensagem/u);
  // Plain words for people who just want a nice shirt (PO, 01/10).
  assert.match(prompt, /palavras do dia a dia, nada de termo técnico/u);
  assert.match(
    prompt,
    /não insista na mesma pergunta: pergunte o ponto que o contexto indica/u,
  );
  assert.match(prompt, /Se ele aceitar uma sugestão sua/u);
  assert.match(
    prompt,
    /Só use nomes como silk, sublimação, DTF, PV, piquet ou fio se o cliente usar primeiro/u,
  );
  assert.doesNotMatch(
    prompt,
    /Malhas: algodão|Técnicas: silk|malha mista tipo PV/u,
  );

  const jsCode = byName.get('Normalizar decisão da IA (MVP)').parameters.jsCode;
  /** @param {any} output @param {any} [context] */
  const decide = (output, context = {}) =>
    runCodeNode(
      jsCode,
      {
        output: {
          reply_text: 'Resposta da IA',
          briefing_patch: {},
          answer_status: 'none',
          person_request: 'none',
          ...output,
        },
      },
      {
        'Montar contexto da IA (MVP)': {
          conversation_id: 'conversation-1',
          automation_epoch: 1,
          source_revision: 3,
          briefing: {},
          recent_messages: [],
          current_text: '',
          profile_name: '',
          sellers: [],
          message_cap: 15,
          turn: 3,
          crm_counter: true,
          ...context,
        },
      },
    );

  const asked = { next_required_field: 'customer_name' };
  const firstIgnore = decide(
    { answer_status: 'other', asked_field: 'customer_name' },
    { briefing: asked, current_text: 'dtf desbota?' },
  );
  assert.equal(firstIgnore.handoff_required, false);
  assert.equal(firstIgnore.briefing_patch.briefing_status, 'ignored');
  assert.equal(firstIgnore.briefing_patch.next_required_field, 'customer_name');

  const secondIgnore = decide(
    { answer_status: 'other', asked_field: 'customer_name' },
    {
      briefing: { ...asked, briefing_status: 'ignored' },
      current_text: 'bordado fica bom em boné?',
    },
  );
  assert.equal(secondIgnore.trigger, 'ignored_twice');
  assert.equal(secondIgnore.handoff_reason, 'low_confidence');
  assert.match(
    secondIgnore.reasoning,
    /não respondeu à mesma pergunta duas vezes/u,
  );
  assert.match(secondIgnore.reply_text, /vendedores/u);

  const addsInstead = decide(
    {
      answer_status: 'other',
      asked_field: 'customer_name',
      briefing_patch: { product_type: 'camisa', colors: 'branca' },
    },
    {
      briefing: { ...asked, briefing_status: 'ignored' },
      current_text: 'quero camisa branca!',
    },
  );
  assert.equal(
    addsInstead.handoff_required,
    false,
    'a message that adds to the ficha is progress, not an ignored question',
  );
  assert.equal(addsInstead.briefing_patch.colors, 'branca');

  const onlyNotes = decide(
    {
      answer_status: 'other',
      asked_field: 'customer_name',
      briefing_patch: { notes: 'Perguntou sobre bordado em boné' },
    },
    { briefing: { ...asked, briefing_status: 'ignored' } },
  );
  assert.equal(onlyNotes.trigger, 'ignored_twice', 'notes alone add nothing');

  const aboutTheField = decide(
    { answer_status: 'question', asked_field: 'fabrics' },
    {
      briefing: { next_required_field: 'fabrics', briefing_status: 'ignored' },
      current_text: 'qual a diferença entre algodão e dry fit?',
    },
  );
  assert.equal(aboutTheField.handoff_required, false);
  assert.equal(aboutTheField.briefing_patch.briefing_status, 'ignored');

  const skippedWithNews = decide(
    {
      answer_status: 'other',
      asked_field: 'product_model',
      briefing_patch: { colors: 'branca' },
    },
    {
      briefing: { next_required_field: 'product_model' },
      current_text: 'branca',
    },
  );
  assert.equal(skippedWithNews.handoff_required, false);
  assert.equal(
    skippedWithNews.briefing_patch.briefing_status,
    // ADR 014: the colour is a ficha point, so the order opens too (quote_).
    'quote_skipped',
    'a skipped question with news makes the next reply move on',
  );

  const newQuestion = decide(
    { answer_status: 'other', asked_field: 'quantity' },
    { briefing: asked, current_text: 'vocês abrem sábado?' },
  );
  assert.equal(
    newQuestion.briefing_patch.briefing_status,
    'collecting',
    'an ignored question counts only while the bot asks it again',
  );

  const missedThenIgnored = decide(
    { answer_status: 'other', asked_field: 'fabrics' },
    {
      briefing: {
        next_required_field: 'fabrics',
        briefing_status: 'quote_clarifying',
      },
    },
  );
  assert.equal(missedThenIgnored.trigger, 'ignored_twice');
  const ignoredThenUnsure = decide(
    { answer_status: 'undecided', asked_field: 'fabrics' },
    {
      briefing: {
        next_required_field: 'fabrics',
        briefing_status: 'quote_ignored',
      },
    },
  );
  assert.equal(ignoredThenUnsure.trigger, 'two_attempts');

  const contextCode = byName.get('Montar contexto da IA (MVP)').parameters
    .jsCode;
  /** @param {any} inbound */
  const contextPrompt = (inbound) =>
    runCodeNode(
      contextCode,
      {
        conversation_id: 'conversation-1',
        automation_epoch: 1,
        source_revision: 3,
        automation_message_count: 2,
        automation_message_cap: 15,
        sellers: [],
        ...inbound,
      },
      {
        'Normalizar evento WhatsApp (MVP)': {
          from: '5500000000000',
          phone_number_id: 'phone-1',
          text: 'Quero camisa branca!',
          customer_name: '',
        },
      },
    ).prompt;
  const greeting = {
    sender_type: 'ai',
    text: 'Oi! Sou a assistente virtual da Silmer. Qual é o seu nome?',
  };
  assert.match(
    contextPrompt({ briefing: {}, recent_messages: [greeting] }),
    /Nome do cliente: já pedido e não respondido; não pergunte de novo agora/u,
  );
  assert.match(
    contextPrompt({ briefing: {}, recent_messages: [] }),
    /Nome do cliente: ainda não pedido/u,
  );
  // After a skip the bot moved on to the next point; the skipped one waits (ADR 012).
  assert.match(
    contextPrompt({
      briefing: {
        colors: 'branca',
        next_required_field: 'quantity',
        briefing_status: 'quote_skipped',
      },
      recent_messages: [greeting],
    }),
    /o cliente pulou product_model \(tipo de roupa\) e contou outra coisa do pedido; isso fica para o fim da lista, não pergunte agora/u,
  );
  assert.match(
    contextPrompt({
      briefing: { customer_name: 'Júlia' },
      recent_messages: [greeting],
    }),
    /Nome do cliente: já informado/u,
  );
});

// The order the PO took from the Silmer Instagram Direct (ADR 012).
const RHYTHM = [
  'product_model',
  'colors',
  'quantity',
  'artwork_status',
  'fabrics',
  'sizes',
  'collar',
];
const SEVEN_POINTS = Object.freeze({
  product_model: 'camiseta comum',
  quantity: 30,
  fabrics: 'algodão',
  colors: 'branca',
  collar: 'redonda',
  artwork_status: 'já tem a logo',
  sizes: '10 P, 10 M, 10 G',
});
const GREETING = {
  sender_type: 'ai',
  text: 'Oi! Sou a assistente virtual da Silmer. Qual é o seu nome?',
};

/** @param {...string} omit */
function sevenPointsWithout(...omit) {
  return Object.fromEntries(
    Object.entries(SEVEN_POINTS).filter(([key]) => !omit.includes(key)),
  );
}

/** Runs the context node for one inbound with the given briefing. */
async function rhythmContext(
  /** @type {any} */ briefing,
  /** @type {any[]} */ recentMessages = [GREETING],
) {
  const byName = await workflowNodesByName();
  return runCodeNode(
    byName.get('Montar contexto da IA (MVP)').parameters.jsCode,
    {
      conversation_id: 'conversation-1',
      automation_epoch: 1,
      source_revision: 3,
      automation_message_count: 2,
      automation_message_cap: 15,
      sellers: [],
      briefing,
      recent_messages: recentMessages,
    },
    {
      'Normalizar evento WhatsApp (MVP)': {
        from: '5500000000000',
        phone_number_id: 'phone-1',
        text: 'Mensagem do cliente',
        customer_name: '',
      },
    },
  );
}

/** Runs the decision node for one model output and context. */
async function rhythmDecision(
  /** @type {any} */ output,
  /** @type {any} */ context = {},
) {
  const byName = await workflowNodesByName();
  return runCodeNode(
    byName.get('Normalizar decisão da IA (MVP)').parameters.jsCode,
    {
      output: {
        reply_text: 'Resposta da IA',
        briefing_patch: {},
        answer_status: 'none',
        person_request: 'none',
        asked_field: null,
        ...output,
      },
    },
    {
      'Montar contexto da IA (MVP)': {
        conversation_id: 'conversation-1',
        automation_epoch: 1,
        source_revision: 3,
        briefing: {},
        recent_messages: [],
        current_text: '',
        profile_name: '',
        sellers: [],
        message_cap: 15,
        turn: 3,
        crm_counter: true,
        name_asked: true,
        ...context,
      },
    },
  );
}

test('confirmed front print is stored and never followed by a print-or-plain question', async () => {
  const briefing = {
    customer_name: 'Ana',
    product_model: 'camiseta comum',
    colors: 'branca',
    quantity: 30,
    next_required_field: 'artwork_status',
  };
  const current = await rhythmDecision(
    {
      reply_text: 'Você quer a camiseta com estampa ou lisa?',
      asked_field: 'artwork_status',
      answer_status: 'other',
      briefing_patch: { artwork_status: 'com estampa' },
    },
    { briefing, current_text: 'Quero estampa na frente.' },
  );
  assert.equal(current.briefing_patch.artwork_locations, 'frente');
  assert.equal(current.briefing_patch.artwork_status, undefined);
  assert.equal(current.briefing_patch.artwork_technique, 'com estampa');
  assert.equal(current.briefing_patch.next_required_field, 'artwork_status');
  assert.match(current.reply_text, /Você já tem a arte ou a logo/u);
  assert.doesNotMatch(current.reply_text, /estampa ou lisa/u);

  const previous = await rhythmDecision(
    {
      reply_text: 'Que tipo de camisa você quer? E vai lisa ou com estampa?',
      asked_field: 'product_model',
    },
    {
      briefing: {
        customer_name: 'Ana',
        artwork_locations: 'frente',
      },
      current_text: 'Preciso de camisas para a equipe.',
    },
  );
  assert.equal(previous.briefing_patch.artwork_locations, undefined);
  assert.equal(previous.briefing_patch.next_required_field, 'product_model');
  assert.match(previous.reply_text, /Que tipo de camisa você quer\?/u);
  assert.doesNotMatch(previous.reply_text, /lisa ou com estampa/u);
});

test('the ficha is the name plus seven points in one rhythm, kept in one place (ADR 012)', async () => {
  const byName = await workflowNodesByName();
  for (const name of [
    'Montar contexto da IA (MVP)',
    'Normalizar decisão da IA (MVP)',
  ]) {
    const declarations = [
      ...byName
        .get(name)
        .parameters.jsCode.matchAll(/const FICHA_RHYTHM = (\[[^\]]*\]);/gu),
    ];
    assert.equal(declarations.length, 1, `${name} declares the rhythm once`);
    assert.deepEqual(JSON.parse(declarations[0][1]), RHYTHM);
  }

  const schema = JSON.parse(
    byName.get('Validar saída do MVP').parameters.inputSchema,
  );
  // The parser also tolerates the fields the bot used to ask, so a model slip
  // cannot fail the execution; the decision node ignores them.
  assert.deepEqual(schema.properties.asked_field.enum, [
    'customer_name',
    ...RHYTHM,
    'product_type',
    'artwork_technique',
    'artwork_locations',
    'needed_by',
    'purpose',
    'purchase_profile',
    'delivery_mode',
    'city_or_postal_code',
    'delivery_address',
    'pickup_location',
    null,
  ]);
  assert.ok('collar' in schema.properties.briefing_patch.properties);

  const prompt = byName.get('Atendente virtual Silmer (MVP)').parameters.options
    .systemMessage;
  assert.match(prompt, /um ponto por mensagem, o que o contexto indicar/u);
  assert.match(
    prompt,
    /camiseta comum, polo, regata, abadá, mais justinha \(baby look\) ou outra\? E vai lisa ou com estampa\?/u,
  );
  assert.match(
    prompt,
    /A única exceção: junto do tipo de roupa, você pode perguntar se vai lisa ou com estampa/u,
  );
  assert.match(prompt, /algodão, dry fit, poliéster ou outro/u);
  assert.match(prompt, /poliéster \(leve e bom para estampa colorida\)/u);
  assert.match(
    prompt,
    /collar: gola: gola redonda, gola V, gola polo ou outra\. Regata e abadá não têm gola e polo já tem gola polo: o sistema grava e você não pergunta/u,
  );
  assert.match(
    prompt,
    /"Você já tem a arte ou a logo, ou quer que a gente crie\? E vai estampada ou bordada\?"/u,
  );
  assert.match(prompt, /sizes: tamanhos: quantas de cada tamanho/u);
  assert.match(
    prompt,
    /Se o cliente disser que vai lisa ou que não haverá estampa/u,
  );
  assert.match(
    prompt,
    /frases curtas, sem listas longas e sem markdown; no máximo 1 emoji, e raramente/u,
  );
  assert.match(
    prompt,
    /Os demais campos só são gravados se o cliente falar por conta própria, nunca perguntados/u,
  );
  assert.doesNotMatch(prompt, /par de campos|sempre pergunte/u);
});

test('the context node asks the next missing point of the rhythm (ADR 012)', async () => {
  const fresh = await rhythmContext({}, []);
  assert.equal(fresh.next_point, 'customer_name', 'the greeting asks the name');
  assert.doesNotMatch(fresh.prompt, /Se o cliente pular/u);

  const nameSkipped = await rhythmContext({
    next_required_field: 'customer_name',
  });
  assert.equal(
    nameSkipped.next_point,
    'product_model',
    'a name already asked waits for the seven points',
  );
  assert.doesNotMatch(nameSkipped.prompt, /Se o cliente pular/u);

  const asked = await rhythmContext({
    customer_name: 'Júlia',
    next_required_field: 'product_model',
  });
  assert.match(
    asked.prompt,
    /Se o cliente pular product_model \(tipo de roupa\) agora e contar outra coisa do pedido: não insista, pergunte colors \(cor\) e volte a tipo de roupa depois/u,
  );

  const start = await rhythmContext({});
  assert.equal(start.next_point, 'product_model');
  assert.match(
    start.prompt,
    /Próximo ponto da ficha: product_model \(tipo de roupa\); pergunte só isso\n/u,
  );
  assert.match(
    start.prompt,
    /Pontos que ainda faltam, nesta ordem: product_model \(tipo de roupa\), colors \(cor\), quantity \(quantidade\), artwork_status \(estampa\), fabrics \(tecido\), sizes \(tamanhos\), collar \(gola\), customer_name \(nome\)/u,
  );

  const filled = await rhythmContext({
    customer_name: 'Júlia',
    product_model: 'camiseta comum',
    colors: 'Definir com o vendedor',
    quantity: 30,
  });
  assert.equal(
    filled.next_point,
    'artwork_status',
    'filled and deferred points are skipped',
  );
  assert.match(filled.prompt, /Nome do cliente: já informado/u);

  const clarifying = await rhythmContext({
    customer_name: 'Júlia',
    product_model: 'camiseta comum',
    next_required_field: 'quantity',
    briefing_status: 'quote_clarifying',
  });
  assert.equal(clarifying.next_point, 'quantity');
  assert.match(
    clarifying.prompt,
    /Próximo ponto da ficha: quantity \(quantidade\); pergunte só isso, de novo, oferecendo 2 ou 3 opções simples/u,
  );

  const skipped = await rhythmContext({
    customer_name: 'Júlia',
    colors: 'branca',
    next_required_field: 'quantity',
    briefing_status: 'quote_skipped',
  });
  assert.equal(
    skipped.next_point,
    'quantity',
    'after a skip the rhythm goes on from the point the bot moved to',
  );
  assert.match(
    skipped.prompt,
    /Pontos que ainda faltam, nesta ordem: quantity \(quantidade\), artwork_status \(estampa\), fabrics \(tecido\), sizes \(tamanhos\), collar \(gola\), product_model \(tipo de roupa\)\n/u,
  );

  const nameLast = await rhythmContext({ ...SEVEN_POINTS });
  assert.equal(nameLast.next_point, 'customer_name');
  assert.match(
    nameLast.prompt,
    /Nome do cliente: já pedido e não respondido; os 7 pontos estão completos: peça o nome agora, uma única vez/u,
  );

  const complete = await rhythmContext({
    ...SEVEN_POINTS,
    customer_name: 'Júlia',
  });
  assert.equal(complete.next_point, null);
  assert.match(
    complete.prompt,
    /Próximo ponto da ficha: nenhum, a ficha está completa/u,
  );
});

test('the decision node requires only the name and the seven points (ADR 012)', async () => {
  const done = await rhythmDecision({
    briefing_patch: {
      ...SEVEN_POINTS,
      customer_name: 'Ana',
      delivery_mode: 'entrega',
    },
  });
  assert.equal(done.trigger, 'briefing_complete');
  assert.deepEqual(done.missing_briefing_fields, []);
  assert.equal(
    done.briefing_patch.delivery_mode,
    'entrega',
    'a volunteered field is still kept, and delivery no longer asks for the address',
  );

  const noCollar = await rhythmDecision({
    briefing_patch: { ...sevenPointsWithout('collar'), customer_name: 'Ana' },
  });
  assert.equal(noCollar.handoff_required, false, 'the collar is required');
  assert.deepEqual(noCollar.missing_briefing_fields, ['collar']);
  assert.equal(noCollar.briefing_patch.next_required_field, 'collar');

  const price = await rhythmDecision(
    {},
    {
      current_text: 'quanto fica?',
      briefing: {
        ...sevenPointsWithout('collar', 'sizes'),
        needed_by: 'Definir com o vendedor',
      },
    },
  );
  assert.match(price.reasoning, /Faltam: sizes, collar, customer_name\./u);
  assert.match(
    price.reasoning,
    /Para o vendedor definir: needed_by\./u,
    'a field left to the seller shows even when the bot never asks it',
  );

  const legacy = await rhythmDecision(
    { answer_status: 'unclear' },
    {
      briefing: {
        customer_name: 'Ana',
        next_required_field: 'purchase_profile',
        briefing_status: 'clarifying',
      },
    },
  );
  assert.equal(
    legacy.handoff_required,
    false,
    'a field the bot no longer asks has nothing pending',
  );
  assert.equal(legacy.briefing_patch.next_required_field, 'product_model');
});

test('the decision node picks the next point from the rhythm (ADR 012)', async () => {
  /** @param {any} output @param {any} [context] */
  const next = async (output, context) =>
    (await rhythmDecision(output, context)).briefing_patch.next_required_field;

  assert.equal(
    await next({}, { name_asked: false }),
    'customer_name',
    'the greeting asks the name',
  );
  assert.equal(
    await next({}, { briefing: { customer_name: 'Ana' } }),
    'product_model',
  );
  assert.equal(
    await next(
      { briefing_patch: { product_model: 'camiseta comum', colors: 'preta' } },
      { briefing: { customer_name: 'Ana' } },
    ),
    'quantity',
    'points the message fills are skipped',
  );
  assert.equal(
    await next(
      { answer_status: 'deferred' },
      {
        briefing: {
          customer_name: 'Ana',
          ...sevenPointsWithout('fabrics', 'sizes', 'collar'),
          next_required_field: 'fabrics',
        },
      },
    ),
    'sizes',
    'a point left to the seller is not asked again',
  );
  assert.equal(
    await next(
      { answer_status: 'other' },
      {
        current_text: 'vocês abrem sábado?',
        briefing: { customer_name: 'Ana', next_required_field: 'quantity' },
      },
    ),
    'quantity',
    'the point just asked comes first until it is answered',
  );
  assert.equal(
    await next(
      { asked_field: 'needed_by' },
      { briefing: { customer_name: 'Ana' } },
    ),
    'product_model',
    'the model cannot move the rhythm to a field outside the ficha',
  );
  assert.equal(
    await next(
      { asked_field: 'sizes' },
      { briefing: { customer_name: 'Ana' } },
    ),
    'sizes',
    'what the bot actually asked is kept for the ignored and clarifying counts',
  );

  const firstMiss = await rhythmDecision(
    { answer_status: 'unclear' },
    { briefing: { customer_name: 'Ana', next_required_field: 'fabrics' } },
  );
  assert.equal(firstMiss.briefing_patch.briefing_status, 'clarifying');
  assert.equal(firstMiss.briefing_patch.next_required_field, 'fabrics');

  const nameLast = await rhythmDecision(
    { answer_status: 'answered', briefing_patch: { sizes: '10 M e 20 G' } },
    {
      briefing: {
        ...sevenPointsWithout('sizes'),
        next_required_field: 'sizes',
      },
    },
  );
  assert.equal(nameLast.handoff_required, false);
  assert.deepEqual(nameLast.missing_briefing_fields, ['customer_name']);
  assert.equal(nameLast.briefing_patch.next_required_field, 'customer_name');
});

test('a skipped point waits at the end of the rhythm (ADR 011 item 8, ADR 012)', async () => {
  const skip = await rhythmDecision(
    { answer_status: 'other', briefing_patch: { colors: 'branca' } },
    {
      current_text: 'quero branca',
      briefing: { customer_name: 'Ana', next_required_field: 'product_model' },
    },
  );
  assert.equal(skip.handoff_required, false);
  // ADR 014: the colour is the first ficha point, so the order opens (quote_).
  assert.equal(skip.briefing_patch.briefing_status, 'quote_skipped');
  assert.equal(
    skip.briefing_patch.next_required_field,
    'quantity',
    'the reply after a skip moves on to the next point',
  );

  const after = await rhythmDecision(
    { answer_status: 'answered', briefing_patch: { quantity: 30 } },
    {
      briefing: {
        customer_name: 'Ana',
        colors: 'branca',
        next_required_field: 'quantity',
        briefing_status: 'skipped',
      },
    },
  );
  assert.equal(after.briefing_patch.briefing_status, 'quote_collecting');
  assert.equal(after.briefing_patch.next_required_field, 'artwork_status');

  const back = await rhythmDecision(
    {
      answer_status: 'answered',
      briefing_patch: { artwork_status: 'já tem a logo' },
    },
    {
      briefing: {
        customer_name: 'Ana',
        colors: 'branca',
        quantity: 30,
        next_required_field: 'artwork_status',
        briefing_status: 'collecting',
      },
    },
  );
  assert.equal(
    back.briefing_patch.next_required_field,
    'product_model',
    'then the bot comes back to the skipped point',
  );

  const onlyOneLeft = await rhythmDecision(
    { answer_status: 'other', briefing_patch: { needed_by: 'dezembro' } },
    {
      briefing: {
        ...sevenPointsWithout('collar'),
        customer_name: 'Ana',
        next_required_field: 'collar',
      },
    },
  );
  assert.equal(onlyOneLeft.briefing_patch.briefing_status, 'quote_skipped');
  assert.equal(onlyOneLeft.briefing_patch.next_required_field, 'collar');
});

test('an asked_field outside the ficha neither breaks the parser nor moves the rhythm (ADR 012)', async () => {
  const byName = await workflowNodesByName();
  const schema = JSON.parse(
    byName.get('Validar saída do MVP').parameters.inputSchema,
  );
  assert.ok(schema.properties.asked_field.enum.includes('needed_by'));

  const slip = await rhythmDecision(
    { answer_status: 'question', asked_field: 'needed_by' },
    {
      current_text: 'fica pronto até dezembro?',
      briefing: {
        customer_name: 'Ana',
        product_model: 'camiseta comum',
        next_required_field: 'colors',
      },
    },
  );
  assert.equal(slip.handoff_required, false);
  assert.equal(slip.briefing_patch.next_required_field, 'colors');
  assert.equal(slip.missing_briefing_fields.includes('needed_by'), false);
});

test('a regata, an abadá or a polo records the collar and skips the question (ADR 012)', async () => {
  for (const model of [
    'regata',
    'Camisa regata dry fit',
    'abadá',
    '30 regatas e 20 abadás',
  ]) {
    const decision = await rhythmDecision(
      { answer_status: 'answered', briefing_patch: { product_model: model } },
      {
        briefing: {
          customer_name: 'Ana',
          next_required_field: 'product_model',
        },
      },
    );
    assert.equal(decision.briefing_patch.collar, 'regata', model);
    assert.equal(decision.missing_briefing_fields.includes('collar'), false);
  }

  const mixed = await rhythmDecision({
    briefing_patch: { product_model: 'camisetas e regatas' },
  });
  assert.equal(
    'collar' in mixed.briefing_patch,
    false,
    'a mixed order still asks the collar',
  );
  assert.equal(
    (
      await rhythmDecision(
        { briefing_patch: { product_model: 'regata' } },
        { briefing: { collar: 'gola V' } },
      )
    ).briefing_patch.collar,
    undefined,
    'a collar the customer gave is never overwritten',
  );

  for (const model of ['polo', 'Camisa polo', '20 polos']) {
    const polo = await rhythmDecision(
      { answer_status: 'answered', briefing_patch: { product_model: model } },
      {
        briefing: {
          customer_name: 'Ana',
          next_required_field: 'product_model',
        },
      },
    );
    assert.equal(polo.briefing_patch.collar, 'gola polo', model);
    assert.equal(polo.missing_briefing_fields.includes('collar'), false);
  }
  assert.equal(
    'collar' in
      (
        await rhythmDecision({
          briefing_patch: { product_model: 'camiseta e polo' },
        })
      ).briefing_patch,
    false,
    'a polo in a mixed order still asks the collar',
  );
  assert.equal(
    (
      await rhythmDecision(
        { briefing_patch: { product_model: 'polo' } },
        { briefing: { collar: 'gola V' } },
      )
    ).briefing_patch.collar,
    undefined,
    'a collar the customer gave for the polo is never overwritten',
  );

  const done = await rhythmDecision({
    briefing_patch: {
      ...sevenPointsWithout('collar'),
      product_model: 'abadá',
      customer_name: 'Ana',
    },
  });
  assert.equal(done.trigger, 'briefing_complete');
});

test('quantity and sizes sent together fill both points (ADR 012)', async () => {
  const together = await rhythmDecision(
    {
      answer_status: 'answered',
      briefing_patch: { quantity: 30, sizes: '5 P, 10 M, 15 G' },
    },
    {
      current_text: '30 peças, 5 P, 10 M, 15 G',
      briefing: {
        customer_name: 'Ana',
        product_model: 'camiseta comum',
        colors: 'preta',
        next_required_field: 'quantity',
      },
    },
  );
  assert.equal(together.briefing_patch.quantity, 30);
  assert.equal(together.briefing_patch.sizes, '5 P, 10 M, 15 G');
  assert.deepEqual(together.missing_briefing_fields, [
    'artwork_status',
    'fabrics',
    'collar',
  ]);
  assert.equal(together.briefing_patch.next_required_field, 'artwork_status');
});

test('something already going on elsewhere calls a seller at once (ADR 013)', async () => {
  const byName = await workflowNodesByName();
  assert.match(
    byName.get('Atendente virtual Silmer (MVP)').parameters.options
      .systemMessage,
    /PEDIDO DO ZERO[\s\S]*camisa do post[\s\S]*me manda por e-mail/u,
  );
  assert.match(
    byName.get('Validar saída do MVP').parameters.inputSchema,
    /"external_context"/u,
  );

  for (const text of [
    'Quero a camisa do post',
    'quero essa camisa',
    'Pode me enviar por e-mail?',
    'me manda no whatsapp por favor',
    'vi no story, ainda tem?',
    'https://www.instagram.com/p/abc quero essa',
    'Tem pronta entrega?',
    'pode me ligar?',
    'Já falei com a moça da loja sobre as camisas',
  ]) {
    const decision = await rhythmDecision(
      { order_intent_confirmed: true, external_context: false },
      { current_text: text, name_asked: false },
    );
    assert.equal(decision.trigger, 'external_context', text);
    assert.equal(decision.handoff_required, true, text);
    assert.equal(decision.handoff_reason, 'human_requested', text);
    assert.match(decision.reply_text, /vendedores/u, text);
    assert.equal(
      decision.open_order,
      false,
      'something that already exists opens no new order: ' + text,
    );
    assert.match(
      decision.reasoning,
      /Não é um pedido do zero[\s\S]*Ficha: 0 de 8 \(0%\)/u,
      text,
    );
  }

  const flagged = await rhythmDecision(
    { external_context: true },
    { current_text: 'quero igual ao pedido do ano passado' },
  );
  assert.equal(flagged.trigger, 'external_context');

  for (const text of [
    'Vi vocês no Instagram e quero fazer 20 camisetas pro time',
    'preciso das camisas prontas até dia 20',
    'com nome e o número nas costas',
    'Quero 30 camisetas para o posto de saúde',
    'quero gola V',
  ]) {
    const decision = await rhythmDecision(
      { external_context: false },
      { current_text: text },
    );
    assert.equal(decision.trigger, null, text);
  }

  const price = await rhythmDecision(
    { external_context: true },
    { current_text: 'quanto custa a camisa do post?' },
  );
  assert.equal(price.trigger, 'price', 'a price question keeps its reason');

  const midway = await rhythmDecision(
    { external_context: true },
    {
      current_text: 'na verdade é igual à que vocês postaram ontem',
      briefing: {
        product_model: 'camiseta comum',
        colors: 'azul',
        quantity: 20,
        briefing_status: 'quote_collecting',
        next_required_field: 'artwork_status',
      },
    },
  );
  assert.equal(midway.trigger, 'external_context');
  assert.equal(
    midway.open_order,
    true,
    'an order already opened stays open for the seller',
  );
  assert.match(midway.reasoning, /Ficha: 3 de 8 \(38%\)/u);
});

test('the summary measures how much of the ficha the bot filled (ADR 013)', async () => {
  const complete = await rhythmDecision(
    { answer_status: 'answered' },
    { briefing: { ...SEVEN_POINTS, customer_name: 'Ana' } },
  );
  assert.equal(complete.trigger, 'briefing_complete');
  assert.equal(complete.ficha_filled, 8);
  assert.equal(complete.ficha_total, 8);
  assert.match(complete.reasoning, /Ficha: 8 de 8 \(100%\)/u);

  const deferred = await rhythmDecision(
    { answer_status: 'answered' },
    {
      briefing: {
        ...SEVEN_POINTS,
        fabrics: 'Definir com o vendedor',
        customer_name: 'Ana',
      },
    },
  );
  assert.equal(deferred.trigger, 'briefing_complete');
  assert.equal(
    deferred.ficha_filled,
    7,
    'a point left to the seller is not filled by the bot',
  );
  assert.match(deferred.reasoning, /Ficha: 7 de 8 \(88%\)/u);

  const half = await rhythmDecision(
    { asks_price: true },
    {
      current_text: 'quanto fica?',
      briefing: sevenPointsWithout(
        'artwork_status',
        'fabrics',
        'sizes',
        'collar',
      ),
    },
  );
  assert.equal(half.trigger, 'price');
  assert.equal(half.ficha_filled, 3);
  assert.match(half.reasoning, /Ficha: 3 de 8 \(38%\)/u);

  const reply = await rhythmDecision(
    { answer_status: 'answered', briefing_patch: { colors: 'preta' } },
    { briefing: { product_model: 'polo' } },
  );
  assert.equal(reply.handoff_required, false);
  assert.equal(
    reply.ficha_filled,
    3,
    'type, colour and the polo collar the workflow records',
  );
});

test('"com estampa" for "lisa ou com estampa?" does not answer the artwork point (ADR 012)', async () => {
  // DEV 01/10, KPI-01: the artwork question was never asked.
  const typeAnswer = await rhythmDecision(
    {
      answer_status: 'answered',
      briefing_patch: {
        product_model: 'camiseta comum',
        artwork_status: 'com estampa',
        artwork_technique: 'estampada',
      },
    },
    {
      current_text: 'camiseta comum, com estampa',
      briefing: {
        customer_name: 'Dudu',
        briefing_status: 'quote_collecting',
        next_required_field: 'product_model',
      },
    },
  );
  assert.equal(typeAnswer.briefing_patch.artwork_status, undefined);
  assert.equal(typeAnswer.briefing_patch.artwork_technique, 'estampada');
  assert.ok(typeAnswer.missing_briefing_fields.includes('artwork_status'));
  assert.equal(typeAnswer.briefing_patch.next_required_field, 'colors');

  const afterQuantity = await rhythmDecision(
    { answer_status: 'answered', briefing_patch: { quantity: 25 } },
    {
      current_text: '25',
      briefing: {
        customer_name: 'Dudu',
        product_model: 'camiseta comum',
        artwork_technique: 'estampada',
        colors: 'azul marinho',
        briefing_status: 'quote_collecting',
        next_required_field: 'quantity',
      },
    },
  );
  assert.equal(
    afterQuantity.briefing_patch.next_required_field,
    'artwork_status',
  );

  for (const printOnly of [
    'com estampa',
    'estampada',
    'bordado',
    'personalizada',
    'sim',
  ]) {
    const decision = await rhythmDecision({
      briefing_patch: { artwork_status: printOnly },
    });
    assert.equal(decision.briefing_patch.artwork_status, undefined, printOnly);
    assert.equal(
      decision.briefing_patch.artwork_technique,
      printOnly,
      printOnly,
    );
  }
  const keepsTechnique = await rhythmDecision(
    { briefing_patch: { artwork_status: 'com estampa' } },
    { briefing: { artwork_technique: 'bordada' } },
  );
  assert.equal(keepsTechnique.briefing_patch.artwork_technique, undefined);

  for (const origin of [
    'já tem a logo',
    'vai mandar a arte depois',
    'quer que a Silmer crie',
    'precisa de arte',
    'sem aplicação',
    'não quer estampa',
    'Definir com o vendedor',
  ]) {
    const decision = await rhythmDecision({
      briefing_patch: { artwork_status: origin },
    });
    assert.equal(decision.briefing_patch.artwork_status, origin, origin);
  }
});

test('the pending order opens at the first real point of the ficha (ADR 014)', async () => {
  const contract = await fixture('contract-v1.json');
  const byName = await workflowNodesByName();

  // The name alone does not open it.
  const nameOnly = await rhythmDecision(
    { answer_status: 'none', briefing_patch: { customer_name: 'Carla' } },
    { current_text: 'Oi, sou a Carla', name_asked: false },
  );
  assert.equal(nameOnly.open_order, false);
  assert.equal(nameOnly.briefing_patch.briefing_status, 'collecting');

  // Nor does a point left to the seller, asked or volunteered.
  const deferred = await rhythmDecision(
    { answer_status: 'deferred' },
    {
      briefing: {
        customer_name: 'Carla',
        next_required_field: 'product_model',
      },
      current_text: 'o vendedor me indica',
    },
  );
  assert.equal(deferred.briefing_patch.product_model, 'Definir com o vendedor');
  assert.equal(deferred.open_order, false);
  assert.equal(
    (
      await rhythmDecision(
        { briefing_patch: { fabrics: 'o vendedor decide' } },
        { current_text: 'o tecido o vendedor decide' },
      )
    ).open_order,
    false,
  );

  // The first real point opens it, whichever of the seven it is.
  for (const [field, value] of Object.entries(SEVEN_POINTS)) {
    const first = await rhythmDecision(
      { answer_status: 'answered', briefing_patch: { [field]: value } },
      { briefing: { customer_name: 'Carla' }, current_text: String(value) },
    );
    assert.equal(first.open_order, true, field);
    assert.match(first.briefing_patch.briefing_status, /^quote_/u, field);
  }

  // A point the ficha already holds keeps asking, and once opened it stays,
  // even if a later answer leaves that point to the seller.
  assert.equal(
    (
      await rhythmDecision(
        { answer_status: 'question' },
        { briefing: { quantity: 30, next_required_field: 'artwork_status' } },
      )
    ).open_order,
    true,
  );
  const stays = await rhythmDecision(
    { briefing_patch: { product_model: 'o vendedor escolhe' } },
    {
      briefing: {
        product_model: 'camiseta comum',
        briefing_status: 'quote_collecting',
      },
    },
  );
  assert.equal(stays.open_order, true);

  // What is not an order from scratch never opens one (ADR 013)...
  const external = await rhythmDecision(
    { external_context: true, briefing_patch: { quantity: 10 } },
    { current_text: 'Quero 10 da camisa do Outubro Rosa que vocês postaram' },
  );
  assert.equal(external.trigger, 'external_context');
  assert.equal(external.open_order, false);

  // ...but any other handoff opens it when the ficha holds a point.
  const price = await rhythmDecision(
    { briefing_patch: { quantity: 100 } },
    { current_text: 'Umas 100. Quanto fica cada?' },
  );
  assert.equal(price.trigger, 'price');
  assert.equal(price.open_order, true);
  const named = await rhythmDecision(
    { person_request: 'named', requested_person_name: 'Marina' },
    {
      briefing: { quantity: 30, customer_name: 'Ana' },
      current_text: 'quero falar com a Marina',
      sellers: ['Marina'],
    },
  );
  assert.equal(named.handoff_required, true);
  assert.equal(named.open_order, true);
  const complaintFirst = await rhythmDecision(
    { handoff_required: true, handoff_reason: 'complaint' },
    { current_text: 'vocês demoraram muito pra responder' },
  );
  assert.equal(complaintFirst.handoff_required, true);
  assert.equal(complaintFirst.open_order, false);

  const handoff = runCodeNode(
    byName.get('Preparar handoff da IA (MVP)').parameters.jsCode,
    price,
    {},
  );
  assert.equal(handoff.payload.open_order, true);
  assert.equal(validateEvent(handoff.payload, contract), true);

  // A file or audio hands off without the model: the same rule reads the
  // briefing the CRM returned.
  const media = byName.get('Preparar handoff de conteúdo (MVP)').parameters
    .jsCode;
  /** @param {any} briefing */
  const mediaHandoff = (briefing) =>
    runCodeNode(
      media,
      {
        conversation_id: 'conversation-3',
        automation_epoch: 1,
        source_revision: 4,
        briefing,
      },
      { 'Normalizar evento WhatsApp (MVP)': { message_type: 'image' } },
    ).payload;
  assert.equal(mediaHandoff({ colors: 'azul' }).open_order, true);
  assert.equal(mediaHandoff({ customer_name: 'Ana' }).open_order, false);
  assert.equal(
    mediaHandoff({ sizes: 'Definir com o vendedor' }).open_order,
    false,
  );
  assert.equal(
    mediaHandoff({ briefing_status: 'quote_collecting' }).open_order,
    true,
  );
  assert.equal(mediaHandoff(undefined).open_order, false);
  assert.equal(validateEvent(mediaHandoff({ colors: 'azul' }), contract), true);
});

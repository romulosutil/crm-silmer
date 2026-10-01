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

test('emits order.intent_confirmed on a sibling branch that cannot block the customer reply', async () => {
  const workflow = JSON.parse(await readFile(workflowSnapshot, 'utf8'));
  const byName = new Map(
    workflow.nodes.map((/** @type {any} */ node) => [node.name, node]),
  );

  const crmOrderIntent = byName.get('CRM - Registrar intenção de pedido (MVP)');
  assert.ok(crmOrderIntent, 'expected the order-intent CRM node to exist');
  assert.equal(crmOrderIntent.type, 'n8n-nodes-base.httpRequest');
  assert.equal(crmOrderIntent.parameters.method, 'POST');
  assert.match(crmOrderIntent.parameters.url, /integrations\/n8n\/events/u);
  assert.equal(
    crmOrderIntent.onError,
    'continueErrorOutput',
    'a CRM refusal or outage must not fail the workflow execution',
  );

  const prepareOrderIntent = byName.get('Preparar intenção de pedido (MVP)');
  assert.match(
    prepareOrderIntent.parameters.jsCode,
    /event_type: 'order\.intent_confirmed'/u,
  );

  const gate = byName.get('Cliente confirmou intenção de pedido? (MVP)');
  assert.equal(gate.type, 'n8n-nodes-base.if');

  const normalizeDecisionBranches =
    workflow.connections['Normalizar decisão da IA (MVP)'].main[0];
  const branchTargets = normalizeDecisionBranches.map(
    (/** @type {any} */ edge) => edge.node,
  );
  assert.ok(
    branchTargets.includes('Transferir para humano? (MVP)'),
    'the existing handoff/reply decision must still run',
  );
  assert.ok(
    branchTargets.includes('Cliente confirmou intenção de pedido? (MVP)'),
    'order-intent must be a sibling branch, not chained after the reply decision',
  );
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

  const agent = byName.get('Atendente virtual Silmer (MVP)');
  assert.match(
    agent.parameters.options.systemMessage,
    /order_intent_confirmed=true no nível superior da resposta \(nunca dentro de briefing_patch\)/u,
  );
});

test('decision normalizer only whitelists briefing_patch keys the CRM accepts', async () => {
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
  // The CRM ships a new field before the workflow sends it (ADR 012), so the
  // CRM may accept more keys than the workflow knows, never fewer.
  for (const field of workflowFields) {
    assert.ok(BRIEFING_PATCH_FIELDS.has(field), `CRM would reject ${field}`);
  }
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

test('decision normalizer accepts a misplaced order intent flag and strips stray patch keys', async () => {
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
  assert.equal(decision.order_intent_confirmed, true);
  assert.equal('order_intent_confirmed' in decision.briefing_patch, false);
  assert.equal(decision.briefing_patch.customer_name, 'Carla');
  for (const key of Object.keys(decision.briefing_patch)) {
    assert.ok(BRIEFING_PATCH_FIELDS.has(key), `CRM would reject ${key}`);
  }

  const onlyMisplaced = /** @type {any} */ (structuredClone(liveOutput));
  delete onlyMisplaced.output.order_intent_confirmed;
  const misplaced = runCodeNode(jsCode, onlyMisplaced, {
    'Montar contexto da IA (MVP)': context,
  });
  assert.equal(misplaced.order_intent_confirmed, true);
  assert.equal('order_intent_confirmed' in misplaced.briefing_patch, false);

  const notConfirmed = /** @type {any} */ (structuredClone(onlyMisplaced));
  delete notConfirmed.output.briefing_patch.order_intent_confirmed;
  assert.equal(
    runCodeNode(jsCode, notConfirmed, {
      'Montar contexto da IA (MVP)': context,
    }).order_intent_confirmed,
    false,
  );
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
  assert.equal(sticky.order_intent_confirmed, true);
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

  const complete = {
    customer_name: 'Ana',
    product_type: 'camiseta',
    product_model: 'tradicional',
    quantity: 10,
    fabrics: 'algodão',
    colors: 'branca',
    sizes: 'M10',
    artwork_status: 'pronta',
    artwork_technique: 'silk',
    artwork_locations: 'frente',
    needed_by: '10/12',
    purpose: 'evento',
    purchase_profile: 'uso próprio',
    delivery_mode: 'retirada',
    pickup_location: 'loja da Silmer',
  };
  const done = decide({ briefing_patch: complete });
  assert.equal(
    done.trigger,
    'briefing_complete',
    'a complete briefing hands off without asking to build the quote',
  );
  assert.equal(
    done.order_intent_confirmed,
    true,
    'a complete briefing is purchase intent, so the pending order is created',
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
  assert.deepEqual(targets('CRM - Registrar handoff (MVP)'), [
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

  const intent = decide(
    { order_intent_confirmed: true },
    { current_text: 'quero 30 camisetas para o evento da empresa' },
  );
  assert.equal(intent.order_intent_confirmed, true);
  assert.equal(intent.handoff_required, false);
  assert.equal(intent.briefing_patch.briefing_status, 'quote_collecting');

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
  assert.match(prompt, /Que legal, e quer estampada onde\?/u);
  assert.match(prompt, /emende a próxima pergunta na mesma frase/u);
  assert.match(prompt, /não comece com "Anotei"/u);
  assert.match(prompt, /não repita a pergunta do nome em toda mensagem/u);
  // Plain words for people who just want a nice shirt (PO, 01/10).
  assert.match(prompt, /palavras do dia a dia, nada de termo técnico/u);
  assert.match(prompt, /não insista na mesma pergunta: siga o assunto dele/u);
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
    'skipped',
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
  assert.match(
    contextPrompt({
      briefing: {
        next_required_field: 'product_model',
        briefing_status: 'quote_skipped',
      },
      recent_messages: [],
    }),
    /o cliente pulou a pergunta sobre product_model e contou outra coisa do pedido; não repita essa pergunta agora/u,
  );
  assert.match(
    contextPrompt({
      briefing: { customer_name: 'Júlia' },
      recent_messages: [greeting],
    }),
    /Nome do cliente: já informado/u,
  );
});

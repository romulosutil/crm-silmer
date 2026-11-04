// CP-09, CP-11..18 / CP-T04, CP-T09: deterministic diagnosis, never a model benchmark.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

/** @typedef {Record<string, any>} Json */
export const CANONICAL_WORKFLOW = new URL(
  '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
  import.meta.url,
);

const PRIOR = {
  customer_name: 'Ana',
  product_type: 'camisetas',
  product_model: 'camiseta comum',
  colors: 'azul',
  quantity: 18,
  sizes: '9 M e 9 G',
  fabrics: 'algodão',
  collar: 'gola redonda',
  briefing_status: 'collecting',
  next_required_field: 'artwork_locations',
};
const POLOS = {
  product_type: '7 polos',
  product_model: 'camisa polo',
  colors: 'verdes',
  quantity: 7,
};

/** @param {string} number @param {Json} [briefing] */
function subject(number, briefing = PRIOR) {
  return {
    subject_id: `subject-${number}`,
    order_id: `order-${number}`,
    order_number: `${number}-CRM`,
    kind: 'pedido',
    order_status: 'pendente',
    is_current: false,
    selected_source: null,
    briefing: structuredClone(briefing),
  };
}

/** Input and expected behavior are separate; no expected result is supplied to the nodes.
 * @returns {Json[]} */
export function isolationCases() {
  const a = subject('43');
  const b = subject('44', {
    ...PRIOR,
    product_type: 'polos',
    quantity: 7,
    colors: 'verde',
    sizes: '7 M',
    fabrics: 'piquet',
    collar: 'polo',
  });
  const phrases = [
    'Agora quero outro pedido, separado: 7 polos verdes. Não altere as 18 camisetas azuis.',
    'Quero um novo pedido de 7 polos verdes.',
    'Quero um segundo pedido de 7 polos verdes.',
    'Quero 7 polos verdes em um pedido separado das camisetas.',
  ];
  /** @type {Json[]} */
  const cases = phrases.flatMap((text, index) => [
    {
      id: `initial-${index}`,
      group: 'initial-control',
      text,
      briefing: {},
      subjects: [],
      patch: POLOS,
      expected: 'collect',
    },
    {
      id: `unbound-${index}`,
      group: 'new-intent-without-subject',
      text,
      briefing: PRIOR,
      subjects: [],
      patch: POLOS,
      expected: 'block',
    },
    {
      id: `bound-${index}`,
      group: 'new-intent-with-subject',
      text,
      briefing: PRIOR,
      subjects: [a],
      patch: POLOS,
      expected: 'block',
    },
  ]);
  cases.push(
    {
      id: 'known-a',
      group: 'reference-control',
      text: 'No pedido 43-CRM, mude para 30 peças.',
      subjects: [a],
      patch: { quantity: 30 },
      expected: 'target',
      target: 'order-43',
    },
    {
      id: 'known-b',
      group: 'reference-control',
      text: 'No pedido 44-CRM, mude para 9 peças.',
      subjects: [a, b],
      patch: { quantity: 9 },
      expected: 'target',
      target: 'order-44',
    },
    {
      id: 'unknown-single',
      group: 'unknown-reference',
      text: 'No pedido 999-CRM, mude para 30 peças.',
      subjects: [a],
      patch: { quantity: 30 },
      expected: 'block',
    },
    {
      id: 'unknown-multiple',
      group: 'unknown-reference',
      text: 'No pedido 999-CRM, mude para 30 peças.',
      subjects: [a, b],
      patch: { quantity: 30 },
      expected: 'block',
    },
    {
      id: 'ambiguous-multiple',
      group: 'ambiguity-control',
      text: 'Mude para 30 peças.',
      subjects: [a, b],
      patch: { quantity: 30 },
      expected: 'block',
    },
    {
      id: 'color-now',
      group: 'continuation-false-positive',
      text: 'Agora quero azul.',
      subjects: [a],
      patch: { colors: 'azul' },
      expected: 'target',
      target: 'order-43',
    },
    {
      id: 'art-also',
      group: 'continuation-false-positive',
      text: 'Também quero estampa nas costas.',
      subjects: [a],
      patch: { artwork_locations: 'costas' },
      expected: 'target',
      target: 'order-43',
    },
    {
      id: 'correction',
      group: 'correction-control',
      text: 'Corrija a quantidade desse pedido para 7 peças.',
      subjects: [a],
      patch: { quantity: 7 },
      expected: 'target',
      target: 'order-43',
    },
  );
  for (const [id, messages] of [
    [
      'first',
      ['Quero iniciar outro pedido separado: polos.', 'Serão 7 peças verdes.'],
    ],
    [
      'middle',
      [
        'Olá.',
        'Quero iniciar outro pedido separado: polos.',
        'Serão 7 peças verdes.',
      ],
    ],
    [
      'last',
      ['Serão 7 peças verdes.', 'Quero iniciar outro pedido separado: polos.'],
    ],
  ]) {
    const lines = /** @type {string[]} */ (messages);
    cases.push({
      id: `burst-${id}`,
      group: 'burst-boundary',
      text: lines[lines.length - 1],
      subjects: [a],
      patch: POLOS,
      recent_messages: lines.map((text, index) => ({
        sender_type: 'customer',
        text,
        type: 'text',
        external_id: `burst-${index}`,
        subject_ids: [],
      })),
      event_id: `burst-${lines.length - 1}`,
      expected: 'block',
    });
  }
  cases.push({
    id: 'external-policy',
    group: 'legacy-policy-control',
    text: 'No pedido 43-CRM, mude para 24 peças.',
    subjects: [a, b],
    patch: { quantity: 24 },
    external_context: true,
    expected: 'external-policy',
    target: 'order-43',
  });
  return structuredClone(cases);
}

/** @param {Json} workflow @param {Json} sample */
export function executeIsolationCase(workflow, sample) {
  const nodes = new Map(
    workflow.nodes.map((/** @type {Json} */ node) => [node.name, node]),
  );
  /** @param {string} name @param {Json} input @param {Json} upstream */
  function run(name, input, upstream) {
    const code = nodes.get(name)?.parameters?.jsCode;
    if (typeof code !== 'string') throw new Error('AUDIT_CODE_NODE_REQUIRED');
    const result = vm.runInNewContext(
      `(() => {\n${code}\n})()`,
      {
        $json: structuredClone(input),
        $: (/** @type {string} */ key) => {
          if (!(key in upstream)) throw new Error('AUDIT_UPSTREAM_MISSING');
          return { item: { json: structuredClone(upstream[key]) } };
        },
        $execution: { id: 'synthetic-isolation-audit' },
      },
      { timeout: 1000 },
    );
    return JSON.parse(JSON.stringify(result.json));
  }
  const inbound = {
    conversation_id: 'synthetic-cycle',
    automation_epoch: 1,
    source_revision: 3,
    automation_message_count: 2,
    automation_message_cap: 15,
    order_opening_policy: 'human_confirmation',
    briefing: sample.briefing ?? {},
    subjects: sample.subjects ?? [],
    source_subject_ids: [],
    recent_messages: sample.recent_messages ?? [],
    sellers: [],
  };
  const context = run('Montar contexto da IA (MVP)', inbound, {
    'CRM - Registrar inbound (MVP)': inbound,
    'Normalizar evento WhatsApp (MVP)': {
      channel: 'whatsapp',
      from: '5500000041999',
      phone_number_id: 'synthetic-line',
      text: sample.text,
      customer_name: 'Ana',
      message_type: 'text',
      event_id: sample.event_id ?? 'synthetic-message',
    },
  });
  const modelOutput = {
    reply_text: 'Onde vai a estampa?',
    briefing_patch: sample.patch,
    answer_status: 'answered',
    person_request: 'none',
    asked_field: 'artwork_locations',
    external_context: sample.external_context ?? false,
  };
  const decision = run(
    'Normalizar decisão da IA (MVP)',
    { output: modelOutput },
    { 'Montar contexto da IA (MVP)': context },
  );
  return {
    context,
    decision,
    synthetic_model_output: structuredClone(modelOutput),
  };
}

/** Independent safety oracle: a different/unknown intent must never mutate an old target.
 * @param {Json} sample @param {{context:Json,decision:Json}} actual */
export function isolationViolations(sample, { context, decision }) {
  const failures = [];
  if (sample.expected === 'block') {
    if (decision.target_order_id || decision.target_subject_id)
      failures.push('old_target_selected');
    // Asking for clarification is as safe as a handoff. Only commercial data
    // is forbidden; collection metadata alone does not alter an old intent.
    if (
      Object.keys(decision.briefing_patch ?? {}).some(
        (key) => !['briefing_status', 'next_required_field'].includes(key),
      )
    )
      failures.push('patch_not_blocked');
  } else if (sample.expected === 'collect') {
    if (decision.handoff_required) failures.push('first_intent_blocked');
    if (context.briefing.sizes || context.briefing.fabrics)
      failures.push('inherited_previous_intent');
    for (const [key, value] of Object.entries(sample.patch))
      if (decision.briefing_patch?.[key] !== value)
        failures.push('requested_field_not_preserved:' + key);
  } else if (sample.expected === 'target') {
    if (decision.target_order_id !== sample.target)
      failures.push('wrong_target');
    if (decision.handoff_required) failures.push('unnecessary_handoff');
    for (const [key, value] of Object.entries(sample.patch))
      if (decision.briefing_patch?.[key] !== value)
        failures.push('requested_field_not_preserved:' + key);
  } else if (sample.expected === 'external-policy') {
    if (
      decision.target_order_id !== sample.target ||
      decision.trigger !== 'external_context' ||
      decision.handoff_reason !== 'human_requested'
    )
      failures.push('documented_policy_changed');
  } else throw new Error('AUDIT_ORACLE_REQUIRED');
  return failures;
}

/** @param {Json} workflow */
export function auditOrderIsolation(workflow) {
  const cases = isolationCases().map((sample) => {
    const actual = executeIsolationCase(workflow, sample);
    const violations = isolationViolations(sample, actual);
    return {
      id: sample.id,
      group: sample.group,
      expected: sample.expected,
      passed: !violations.length,
      violations,
      text: sample.text,
      model_extraction_kind: 'synthetic_controlled_input',
      model_extraction: actual.synthetic_model_output,
      observed: {
        target_order_id: actual.decision.target_order_id,
        target_subject_id: actual.decision.target_subject_id,
        target_ambiguous: actual.context.target_ambiguous,
        burst_size: actual.context.burst_size,
        inherited_sizes: actual.context.briefing?.sizes ?? null,
        inherited_fabrics: actual.context.briefing?.fabrics ?? null,
        trigger: actual.decision.trigger,
        handoff_required: actual.decision.handoff_required,
        handoff_reason: actual.decision.handoff_reason,
        briefing_patch: actual.decision.briefing_patch,
      },
    };
  });
  return {
    evidence_kind: 'deterministic_workflow_nodes',
    llm_calls: 0,
    database_calls: 0,
    source_version: workflow.versionId ?? null,
    total: cases.length,
    passed: cases.filter((c) => c.passed).length,
    failed: cases.filter((c) => !c.passed).length,
    cases,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [sourcePath, outputPath] = process.argv.slice(2);
  const raw = await readFile(sourcePath ?? CANONICAL_WORKFLOW, 'utf8');
  const report = {
    ...auditOrderIsolation(JSON.parse(raw)),
    source_sha256: createHash('sha256').update(raw).digest('hex'),
  };
  if (outputPath)
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
  console.log(
    JSON.stringify({
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      llm_calls: 0,
      database_calls: 0,
    }),
  );
  process.exitCode = report.failed ? 1 : 0;
}

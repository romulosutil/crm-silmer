import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{id_cliente: string, synthetic_identity_key: string, ordinal: number, perfil_comportamental: string}} Client
 * @typedef {{ref: string, contact: string, lifecycle: string, status: string, wave?: number, sentinel: {product_type: string, colors: string, quantity: number}}} OrderFixture
 * @typedef {{id_sessao: string, id_cliente: string, wave: string, perfil_comportamental: string, scenario: string, userMessages: string[], expected_behavior: {starts_new_order: boolean, order_intent: string, planned_user_outcome: string, new_order_request_message_index?: number|null}, expectations: {safety: string[], success_is_observed: boolean, [key: string]: any}, fixture_requirements: {synthetic_only: boolean, orders: OrderFixture[], [key: string]: any}, observed_result: null | Record<string, unknown>}} LongitudinalSession
 */

// CP-09, CP-11..18 / CP-T04: this is an input plan, never measured evidence.
const PROFILES = [
  'Happy Path',
  'Abandono Precoce',
  'Resistência à IA',
  'Entrada Multimodal',
];

const SCENARIOS = [
  'new_order_while_pending',
  'explicit_order_reference',
  'two_pending_ambiguous',
  'interleaved_orders',
  'replay_same_message',
  'resume_then_new_order',
  'new_cycle_same_contact',
  'handoff_is_definitive',
];

/** @param {unknown} runId */
function requireRunId(runId) {
  if (
    typeof runId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId)
  ) {
    throw new TypeError('runId must be 1..64 ASCII letters, digits, _ or -');
  }
}

/** @param {number} number */
function sessionNumber(number) {
  return `CONV_${String(number).padStart(3, '0')}`;
}

/** @param {string} scenario @param {number} wave @returns {OrderFixture[]} */
function fixtureOrders(scenario, wave) {
  /** @type {OrderFixture[]} */
  const orders = [
    {
      ref: 'A',
      contact: 'same_client',
      lifecycle: 'preserve_from_prior_wave_or_create_with_human_api',
      status: 'pendente',
      sentinel: { product_type: 'camiseta', colors: 'azul', quantity: 18 },
    },
  ];
  if (
    [
      'explicit_order_reference',
      'two_pending_ambiguous',
      'interleaved_orders',
      'replay_same_message',
      'handoff_is_definitive',
    ].includes(scenario)
  ) {
    orders.push({
      ref: 'B',
      contact: 'same_client',
      lifecycle: 'create_with_human_api_in_current_wave',
      wave,
      status: 'pendente',
      sentinel: { product_type: 'polo', colors: 'branco', quantity: 7 },
    });
  }
  return orders;
}

/** @param {string} scenario */
function scenarioInputs(scenario) {
  switch (scenario) {
    case 'new_order_while_pending':
      return {
        messages: [
          'Quero iniciar outro pedido de polos brancas, separado do pedido anterior.',
        ],
        targets: [null],
        safety: [
          'preserve_A',
          'do_not_reuse_existing_pending',
          'clarify_or_handoff_before_projection',
        ],
      };
    case 'explicit_order_reference':
      return {
        messages: [
          'Quero começar o pedido {{order_b_number}} que o vendedor abriu agora. Serão 12 peças.',
          'No pedido {{order_b_number}}, a cor será verde.',
        ],
        targets: ['B', 'B'],
        safety: ['preserve_A', 'only_explicit_B_may_change'],
      };
    case 'two_pending_ambiguous':
      return {
        messages: [
          'Tenho o pedido anterior e o que vocês abriram agora. Mude a quantidade para 30.',
        ],
        targets: [null],
        safety: [
          'preserve_A',
          'preserve_B',
          'clarify_or_handoff_before_projection',
        ],
      };
    case 'interleaved_orders':
      return {
        messages: [
          'No pedido {{order_b_number}} que vocês abriram agora, quero 12 peças.',
          'No pedido {{order_a_number}}, mude a cor para vermelho.',
          'Voltando ao pedido {{order_b_number}}, a cor será verde.',
        ],
        targets: ['B', 'A', 'B'],
        safety: [
          'only_explicit_target_may_change',
          'exclude_other_order_history',
          'no_cross_order_sentinel',
        ],
      };
    case 'replay_same_message':
      return {
        messages: [
          'No pedido {{order_b_number}} que o vendedor abriu agora, quero 12 peças verdes.',
        ],
        targets: ['B'],
        safety: [
          'preserve_A',
          'same_event_id_on_replay',
          'no_duplicate_effect_or_send',
        ],
      };
    case 'resume_then_new_order':
      return {
        messages: [
          'Voltei ao pedido {{order_a_number}}. A quantidade será 24.',
          'Também preciso iniciar outro pedido, separado deste, de polos brancas.',
        ],
        targets: ['A', null],
        safety: [
          'resume_A_without_reasking_known_data',
          'new_request_must_not_overwrite_A',
        ],
      };
    case 'new_cycle_same_contact':
      return {
        messages: [
          'Quero iniciar um novo pedido de camisetas pretas.',
          'Serão 16 peças de algodão, gola redonda, todas M e sem estampa.',
        ],
        targets: [null, null],
        safety: [
          'same_contact_new_cycle',
          'preserve_old_order_and_history',
          'do_not_inherit_old_briefing',
        ],
      };
    case 'handoff_is_definitive':
      return {
        messages: [
          'No pedido {{order_b_number}} que vocês abriram agora, quero 12 peças.',
          'Não quero continuar com o robô. Quero falar com uma pessoa.',
          'No pedido {{order_a_number}}, a cor será vermelho.',
        ],
        targets: ['B', null, null],
        safety: [
          'preserve_A',
          'human_handoff_required',
          'automation_silent_after_handoff',
        ],
      };
    default:
      throw new TypeError(`Unknown scenario: ${scenario}`);
  }
}

/** @param {Client} client */
function initialInputs(client) {
  const number = client.ordinal;
  switch (client.perfil_comportamental) {
    case 'Happy Path':
      return [
        `Sou Ana, da equipe sintética ${number}. Quero preparar um pedido de camisetas.`,
        'Quero 18 peças azuis, de algodão, gola redonda, 9 M e 9 G, sem estampa.',
        'Gostaria de receber no próximo mês; aguardo a avaliação do vendedor sobre prazo e preço.',
        'Confirmo esses dados e quero seguir com o fechamento para análise do vendedor.',
      ];
    case 'Abandono Precoce':
      return ['Oi!'];
    case 'Resistência à IA':
      return ['Não quero falar com robô. Quero atendimento humano, por favor.'];
    case 'Entrada Multimodal':
      return [
        '{{media_reference}} Quero um modelo igual ao da referência.',
        `Sou Ana, da equipe sintética ${number}: 18 camisetas azuis, algodão, gola redonda, 9 M e 9 G, sem estampa.`,
        'Gostaria de receber no próximo mês; prazo e preço podem ser avaliados pelo vendedor.',
        'Confirmo o resumo e quero seguir com a análise do fechamento.',
      ];
    default:
      throw new TypeError('Unknown profile');
  }
}

/** @param {Client} client @param {number} number @returns {LongitudinalSession} */
function initialSession(client, number) {
  return {
    id_sessao: sessionNumber(number),
    id_cliente: client.id_cliente,
    wave: 'Onda 1',
    perfil_comportamental: client.perfil_comportamental,
    scenario: `initial_${['happy', 'early_abandonment', 'human_request', 'multimodal'][Math.floor((number - 1) / 25)]}`,
    userMessages: initialInputs(client),
    expected_behavior: {
      starts_new_order: false,
      order_intent: 'initial_journey',
      planned_user_outcome: ['Happy Path', 'Entrada Multimodal'].includes(
        client.perfil_comportamental,
      )
        ? 'try_to_complete'
        : client.perfil_comportamental === 'Abandono Precoce'
          ? 'abandon_early'
          : 'request_human',
    },
    expectations: {
      safety: ['same_identity_same_contact', 'no_automatic_order_confirmation'],
      success_is_observed: true,
    },
    fixture_requirements: {
      synthetic_only: true,
      transport: 'simulated_whatsapp_no_external_send',
      media:
        client.perfil_comportamental === 'Entrada Multimodal'
          ? {
              kind: number % 2 ? 'image' : 'audio',
              real_fixture_required: true,
            }
          : null,
      orders: [],
    },
    observed_result: null,
  };
}

/** @param {Client} client @param {number} wave @param {number} number @param {number|null} activeIndex @returns {LongitudinalSession} */
function laterSession(client, wave, number, activeIndex) {
  const active = activeIndex !== null;
  const scenario = active
    ? SCENARIOS[(activeIndex + (wave === 3 ? 3 : 0)) % SCENARIOS.length]
    : 'inactive_window';
  const inputs = active
    ? scenarioInputs(scenario)
    : { messages: [], targets: [], safety: ['no_new_message_or_order'] };
  const completedQuota = wave === 2 ? 13 : 10;
  const tryComplete = active && activeIndex < completedQuota;
  // New-order participation requires a real scripted user request. A human
  // fixture or the resumption of B alone never sets this sampling flag.
  const prefix =
    active && !/\b(?:novo|outro) pedido\b/iu.test(inputs.messages[0] ?? '')
      ? [
          'Sou Ana. Quero iniciar um novo pedido, separado dos pedidos anteriores.',
        ]
      : [];
  const messages = [...prefix, ...inputs.messages];
  if (tryComplete) {
    messages.push(
      'Confirmo os dados que informei e quero seguir com o fechamento para análise do vendedor.',
    );
  }
  return {
    id_sessao: sessionNumber(number),
    id_cliente: client.id_cliente,
    wave: `Onda ${wave}`,
    perfil_comportamental: client.perfil_comportamental,
    scenario,
    userMessages: messages,
    expected_behavior: {
      starts_new_order: active,
      new_order_request_message_index: active ? 0 : null,
      order_intent: active
        ? 'new_order_in_current_wave_with_prior_history'
        : 'inactive',
      planned_user_outcome: active
        ? tryComplete
          ? 'try_to_complete'
          : 'abandon_midway'
        : 'inactive',
    },
    expectations: {
      safety: [
        ...inputs.safety,
        'same_identity_same_contact',
        'no_automatic_order_confirmation',
      ],
      targets_by_message: [
        ...prefix.map(() => null),
        ...inputs.targets,
        ...(tryComplete ? [null] : []),
      ],
      targets_apply_only_while_automation_active: true,
      success_is_observed: true,
      preserve_orders_not_targeted: true,
      replay:
        scenario === 'replay_same_message'
          ? { message_index: prefix.length, times: 2, preserve_event_id: true }
          : null,
      after_handoff: 'never_resume_automation',
    },
    fixture_requirements: {
      synthetic_only: true,
      reuse_identity_from_wave: 1,
      preserve_previous_wave_state: true,
      orders: active ? fixtureOrders(scenario, wave) : [],
      order_creation_actor: 'authorized_human_test_actor',
      fixture_order_creation_counts_as_user_intent: false,
      close_prior_cycle_with_human_api: scenario === 'new_cycle_same_contact',
      ambiguous_selection:
        scenario === 'two_pending_ambiguous' ? 'no_human_current_target' : null,
    },
    observed_result: null,
  };
}

/** Build inputs only; observed outcomes must come from a real execution.
 * @param {{runId: string}} options
 */
export function buildLongitudinalPlan({ runId }) {
  requireRunId(runId);
  const clients = Array.from({ length: 100 }, (_, index) => ({
    id_cliente: `${runId}-client-${String(index + 1).padStart(3, '0')}`,
    synthetic_identity_key: `${runId}-identity-${String(index + 1).padStart(3, '0')}`,
    synthetic_display_name: 'Ana',
    ordinal: index + 1,
    perfil_comportamental: PROFILES[Math.floor(index / 25)],
  }));
  const sessions = clients.map((client, index) =>
    initialSession(client, index + 1),
  );
  /** @type {[number, number[]][]} */
  const waveSelections = [
    [2, [13, 13, 12, 12]],
    [3, [10, 10, 10, 10]],
  ];
  for (const [wave, perProfile] of waveSelections) {
    const cohort = clients.filter(
      (client) =>
        (client.ordinal - 1) % 25 <
        perProfile[Math.floor((client.ordinal - 1) / 25)],
    );
    // Alternate the two active profiles so attempts and abandonment are not
    // confounded with textual versus multimodal cohort membership.
    const active = cohort.filter((client) =>
      ['Happy Path', 'Entrada Multimodal'].includes(
        client.perfil_comportamental,
      ),
    );
    const happy = active.filter(
      (client) => client.perfil_comportamental === 'Happy Path',
    );
    const media = active.filter(
      (client) => client.perfil_comportamental === 'Entrada Multimodal',
    );
    const activeOrder = happy.flatMap((client, index) => [
      client,
      ...(media[index] ? [media[index]] : []),
    ]);
    for (const client of cohort) {
      const index = activeOrder.findIndex(
        (item) => item.id_cliente === client.id_cliente,
      );
      sessions.push(
        laterSession(
          client,
          wave,
          sessions.length + 1,
          index < 0 ? null : index,
        ),
      );
    }
  }
  return {
    schema_version: 1,
    run_id: runId,
    traceability: { requirements: ['CP-09', 'CP-11..18'], task: 'CP-T04' },
    semantics: {
      session: 'observation_window_not_necessarily_a_new_crm_conversation',
      outcomes:
        'never_predefined_record_real_agent_response_and_database_delta',
      quotas: 'planned_user_behavior_not_actual_agent_success',
      order_fixtures:
        'human_created_orders_are_explicit_setup_not_agent_conversions',
      starts_new_order:
        'explicit_new_order_user_message_at_index_0_never_inferred_from_fixture_or_resumption',
      same_name:
        '100_clients_use_Ana_as_display_name_distinct_identities_must_not_merge_by_name',
      safety_sequence:
        'new_order_intent_may_trigger_handoff_immediately_later_targets_are_conditional_never_force_bot_reentry',
      script_execution:
        'apply_real_handoff_rules_do_not_force_bot_reentry_to_finish_script',
      inactive_profiles:
        'prior_assigned_cohort_not_inferred_from_absent_messages',
      multimodal:
        'replace_reference_with_real_synthetic_media_never_claim_text_marker_tests_vision',
    },
    clients,
    sessions,
  };
}

/** @param {unknown} condition @param {string} message */
function assertPlan(condition, message) {
  if (!condition) throw new TypeError(`Invalid longitudinal plan: ${message}`);
}

/** Validate the sampling contract without inventing an execution result.
 * @param {ReturnType<typeof buildLongitudinalPlan>} plan
 */
export function validateLongitudinalPlan(plan) {
  assertPlan(plan?.clients?.length === 100, '100 clients required');
  assertPlan(plan?.sessions?.length === 190, '190 sessions required');
  const clients = new Map(
    plan.clients.map((client) => [client.id_cliente, client]),
  );
  assertPlan(clients.size === 100, 'client IDs must be unique');
  assertPlan(
    new Set(plan.clients.map((client) => client.synthetic_identity_key))
      .size === 100,
    'identity keys must be unique',
  );
  assertPlan(
    new Set(plan.sessions.map((session) => session.id_sessao)).size === 190,
    'session IDs must be unique',
  );
  let priorCohort = new Set(clients.keys());
  for (const [wave, total, active, attempts, abandons] of [
    [1, 100, 0, 50, 0],
    [2, 50, 25, 13, 12],
    [3, 40, 20, 10, 10],
  ]) {
    const sessions = plan.sessions.filter(
      (session) => session.wave === `Onda ${wave}`,
    );
    assertPlan(sessions.length === total, `wave ${wave} size`);
    assertPlan(
      new Set(sessions.map((session) => session.id_cliente)).size === total,
      `wave ${wave} repeats a client`,
    );
    const profiles = new Map(PROFILES.map((profile) => [profile, 0]));
    for (const session of sessions) {
      assertPlan(
        priorCohort.has(session.id_cliente),
        `wave ${wave} must reuse the prior cohort`,
      );
      assertPlan(
        clients.get(session.id_cliente)?.perfil_comportamental ===
          session.perfil_comportamental,
        'profile changed for the same client',
      );
      profiles.set(
        session.perfil_comportamental,
        (profiles.get(session.perfil_comportamental) ?? 0) + 1,
      );
      assertPlan(
        session.observed_result === null,
        'plan cannot predefine measured outcomes',
      );
      assertPlan(
        Array.isArray(session.userMessages) &&
          session.userMessages.every(
            (message) => typeof message === 'string' && message.trim(),
          ),
        'userMessages must contain only nonempty input strings',
      );
      assertPlan(
        !Object.hasOwn(session, 'historico_mensagens'),
        'script must not contain fabricated assistant history',
      );
      assertPlan(
        session.fixture_requirements.synthetic_only === true,
        'fixtures must be synthetic',
      );
      if (session.expected_behavior.starts_new_order) {
        assertPlan(
          session.expected_behavior.new_order_request_message_index === 0 &&
            /\b(?:novo|outro) pedido\b/iu.test(session.userMessages[0] ?? ''),
          'new-order activity requires an explicit first user request',
        );
      }
      if (session.scenario === 'inactive_window') {
        assertPlan(
          session.userMessages.length === 0 &&
            !session.expected_behavior.starts_new_order,
          'inactive window cannot send or open an order',
        );
      }
    }
    assertPlan(
      [...profiles.values()].every((count) => count > 0),
      `wave ${wave} must include all profiles`,
    );
    if (wave === 1)
      assertPlan(
        [...profiles.values()].every((count) => count === 25),
        'wave 1 needs 25 per profile',
      );
    assertPlan(
      sessions.filter((session) => session.expected_behavior.starts_new_order)
        .length === active,
      `wave ${wave} new-order quota`,
    );
    assertPlan(
      sessions.filter(
        (session) =>
          session.expected_behavior.planned_user_outcome === 'try_to_complete',
      ).length === attempts,
      `wave ${wave} attempt quota`,
    );
    assertPlan(
      sessions.filter(
        (session) =>
          session.expected_behavior.planned_user_outcome === 'abandon_midway',
      ).length === abandons,
      `wave ${wave} abandonment quota`,
    );
    if (wave > 1)
      assertPlan(
        sessions.filter((session) => session.scenario === 'inactive_window')
          .length ===
          total - active,
        `wave ${wave} inactive quota`,
      );
    priorCohort = new Set(sessions.map((session) => session.id_cliente));
  }
  assertPlan(
    SCENARIOS.every((scenario) =>
      plan.sessions.some((session) => session.scenario === scenario),
    ),
    'missing multi-order scenario',
  );
  return { valid: true, clients: 100, sessions: 190, observed_results: 0 };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [runId, outputPath, ...extra] = process.argv.slice(2);
  if (extra.length)
    throw new TypeError(
      'Usage: node scripts/ux-longitudinal-plan.mjs <run-id> [output.json]',
    );
  const plan = buildLongitudinalPlan({ runId });
  validateLongitudinalPlan(plan);
  const json = `${JSON.stringify(plan, null, 2)}\n`;
  if (outputPath)
    await writeFile(outputPath, json, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(json);
}

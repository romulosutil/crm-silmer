import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLongitudinalPlan,
  validateLongitudinalPlan,
} from '../scripts/ux-longitudinal-plan.mjs';

test('CP-09: returning waves keep the same client identity and nest their cohorts', () => {
  const plan = buildLongitudinalPlan({ runId: 'synthetic-test' });
  assert.deepEqual(validateLongitudinalPlan(plan), {
    valid: true,
    clients: 100,
    sessions: 190,
    observed_results: 0,
  });
  const cohort = (/** @type {string} */ wave) =>
    new Set(
      plan.sessions
        .filter((session) => session.wave === wave)
        .map((session) => session.id_cliente),
    );
  for (const client of cohort('Onda 3'))
    assert.ok(cohort('Onda 2').has(client));
  for (const client of cohort('Onda 2'))
    assert.ok(cohort('Onda 1').has(client));
  assert.deepEqual(plan, buildLongitudinalPlan({ runId: 'synthetic-test' }));
  assert.ok(
    buildLongitudinalPlan({ runId: 'another-run' }).clients.every(
      (client) =>
        !plan.clients.some(
          (prior) =>
            prior.synthetic_identity_key === client.synthetic_identity_key,
        ),
    ),
  );
});

test('planned completion and dropout quotas never become fabricated assistant outcomes', () => {
  const plan = buildLongitudinalPlan({ runId: 'synthetic-test' });
  for (const [wave, expected] of [
    ['Onda 2', [25, 13, 12, 25]],
    ['Onda 3', [20, 10, 10, 20]],
  ]) {
    const sessions = plan.sessions.filter((session) => session.wave === wave);
    assert.deepEqual(
      [
        sessions.filter((session) => session.expected_behavior.starts_new_order)
          .length,
        sessions.filter(
          (session) =>
            session.expected_behavior.planned_user_outcome ===
            'try_to_complete',
        ).length,
        sessions.filter(
          (session) =>
            session.expected_behavior.planned_user_outcome === 'abandon_midway',
        ).length,
        sessions.filter((session) => session.userMessages.length === 0).length,
      ],
      expected,
    );
  }
  assert.ok(plan.sessions.every((session) => session.observed_result === null));
  assert.equal(JSON.stringify(plan).includes('"remetente":"ia"'), false);
});

test('CP-11..18: two pending orders have different sentinels and explicit mutation targets', () => {
  const plan = buildLongitudinalPlan({ runId: 'synthetic-test' });
  const session = plan.sessions.find(
    (item) => item.scenario === 'interleaved_orders',
  );
  assert.ok(session);
  assert.deepEqual(session.expectations.targets_by_message.slice(1, 4), [
    'B',
    'A',
    'B',
  ]);
  assert.deepEqual(
    session.fixture_requirements.orders.map((order) => order.ref),
    ['A', 'B'],
  );
  assert.notDeepEqual(
    session.fixture_requirements.orders[0].sentinel,
    session.fixture_requirements.orders[1].sentinel,
  );
  assert.ok(session.expectations.safety.includes('no_cross_order_sentinel'));
  assert.ok(session.fixture_requirements.preserve_previous_wave_state);
  const ambiguous = plan.sessions.find(
    (item) => item.scenario === 'two_pending_ambiguous',
  );
  assert.ok(ambiguous);
  assert.ok(
    ambiguous.expectations.targets_by_message.every(
      (/** @type {string|null} */ target) => target === null,
    ),
  );
  assert.ok(ambiguous.expectations.safety.includes('preserve_A'));
  assert.ok(ambiguous.expectations.safety.includes('preserve_B'));
  assert.equal(
    ambiguous.fixture_requirements.ambiguous_selection,
    'no_human_current_target',
  );
});

test('CP-09/CP-17: replay, lifecycle and handoff are explicit execution requirements', () => {
  const sessions = buildLongitudinalPlan({ runId: 'synthetic-test' }).sessions;
  const replay = sessions.find(
    (session) => session.scenario === 'replay_same_message',
  );
  assert.ok(replay);
  assert.deepEqual(replay.expectations.replay, {
    message_index: 1,
    times: 2,
    preserve_event_id: true,
  });
  const cycle = sessions.find(
    (session) => session.scenario === 'new_cycle_same_contact',
  );
  assert.ok(cycle);
  assert.ok(cycle.fixture_requirements.close_prior_cycle_with_human_api);
  assert.ok(cycle.expectations.safety.includes('do_not_inherit_old_briefing'));
  const handoff = sessions.find(
    (session) => session.scenario === 'handoff_is_definitive',
  );
  assert.ok(handoff);
  assert.ok(handoff.userMessages[2].includes('falar com uma pessoa'));
  assert.ok(handoff.userMessages.length > 2);
  assert.equal(handoff.expectations.after_handoff, 'never_resume_automation');
  assert.ok(
    handoff.expectations.safety.includes('automation_silent_after_handoff'),
  );
});

test('new-order activity is explicit user intent and equal names never replace stable identities', () => {
  const plan = buildLongitudinalPlan({ runId: 'synthetic-test' });
  assert.ok(
    plan.clients.every((client) => client.synthetic_display_name === 'Ana'),
  );
  const active = plan.sessions.filter(
    (session) => session.expected_behavior.starts_new_order,
  );
  assert.equal(active.length, 45);
  for (const session of active) {
    assert.match(session.userMessages[0], /\b(?:novo|outro) pedido\b/iu);
    assert.equal(session.expected_behavior.new_order_request_message_index, 0);
    assert.equal(
      session.fixture_requirements.fixture_order_creation_counts_as_user_intent,
      false,
    );
    assert.equal(
      session.expectations.targets_apply_only_while_automation_active,
      true,
    );
  }
  const initialCollectors = plan.sessions.filter(
    (session) =>
      session.wave === 'Onda 1' &&
      ['Happy Path', 'Entrada Multimodal'].includes(
        session.perfil_comportamental,
      ),
  );
  assert.equal(initialCollectors.length, 50);
  assert.ok(
    initialCollectors.every((session) =>
      session.userMessages.some((message) =>
        message.startsWith('Sou Ana, da equipe sintética'),
      ),
    ),
  );
  assert.equal(
    new Set(initialCollectors.map((session) => session.id_cliente)).size,
    50,
  );
});

test('validator rejects cohort substitution, invented outcomes and activity in an inactive window', () => {
  /** @type {Array<(plan: ReturnType<typeof buildLongitudinalPlan>) => void>} */
  const mutators = [
    (plan) => {
      plan.sessions[150].id_cliente = 'unrelated-person';
    },
    (plan) => {
      plan.sessions[0].observed_result = { success: true };
    },
    (plan) => {
      const inactive = plan.sessions.find(
        (session) => session.scenario === 'inactive_window',
      );
      assert.ok(inactive);
      inactive.userMessages.push('Oi');
    },
    (plan) => {
      plan.sessions[1].id_sessao = plan.sessions[0].id_sessao;
    },
    (plan) => {
      const active = plan.sessions.find(
        (session) => session.expected_behavior.starts_new_order,
      );
      assert.ok(active);
      active.userMessages[0] = 'No pedido que vocês abriram, serão 12 peças.';
    },
  ];
  for (const mutate of mutators) {
    const plan = buildLongitudinalPlan({ runId: 'synthetic-test' });
    mutate(plan);
    assert.throws(
      () => validateLongitudinalPlan(plan),
      /Invalid longitudinal plan/,
    );
  }
  assert.throws(() => buildLongitudinalPlan({ runId: '../unsafe' }), /runId/);
});

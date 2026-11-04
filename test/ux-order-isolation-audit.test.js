import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  auditOrderIsolation,
  CANONICAL_WORKFLOW,
  executeIsolationCase,
  isolationCases,
  isolationViolations,
} from '../scripts/ux-order-isolation-audit.mjs';

const workflow = JSON.parse(await readFile(CANONICAL_WORKFLOW, 'utf8'));

test('isolation oracle allows clarification but rejects an old target or any commercial patch', () => {
  const sample = { expected: 'block' };
  const safe = {
    context: {},
    decision: {
      target_order_id: null,
      target_subject_id: null,
      briefing_patch: null,
      handoff_required: false,
    },
  };
  assert.deepEqual(isolationViolations(sample, safe), []);
  assert.deepEqual(
    isolationViolations(sample, {
      ...safe,
      decision: {
        ...safe.decision,
        briefing_patch: { briefing_status: 'collecting' },
      },
    }),
    [],
  );
  assert.deepEqual(
    isolationViolations(sample, {
      ...safe,
      decision: { ...safe.decision, target_order_id: 'old-order' },
    }),
    ['old_target_selected'],
  );
  assert.deepEqual(
    isolationViolations(sample, {
      ...safe,
      decision: { ...safe.decision, briefing_patch: { quantity: 7 } },
    }),
    ['patch_not_blocked'],
  );
});

test('explicit-target oracle also rejects unnecessary transfers and silently lost fields', () => {
  const sample = {
    expected: 'target',
    target: 'order-43',
    patch: { colors: 'azul' },
  };
  assert.deepEqual(
    isolationViolations(sample, {
      context: {},
      decision: {
        target_order_id: 'order-44',
        handoff_required: true,
        briefing_patch: null,
      },
    }),
    [
      'wrong_target',
      'unnecessary_handoff',
      'requested_field_not_preserved:colors',
    ],
  );
});

test('initial-collection oracle rejects silent loss of the supplied extraction', () => {
  assert.deepEqual(
    isolationViolations(
      { expected: 'collect', patch: { quantity: 7, colors: 'verde' } },
      {
        context: { briefing: {} },
        decision: { handoff_required: false, briefing_patch: null },
      },
    ),
    [
      'requested_field_not_preserved:quantity',
      'requested_field_not_preserved:colors',
    ],
  );
});

test('real nodes run with independent extraction; samples and source stay unchanged', () => {
  const sample = isolationCases().find((item) => item.id === 'known-a');
  assert.ok(sample);
  const before = JSON.stringify({ workflow, sample });
  const actual = executeIsolationCase(workflow, sample);
  assert.equal(actual.decision.target_order_id, 'order-43');
  assert.equal(actual.decision.briefing_patch.quantity, 30);
  assert.equal(JSON.stringify({ workflow, sample }), before);
  assert.throws(
    () => executeIsolationCase({ nodes: [] }, sample),
    /AUDIT_CODE_NODE_REQUIRED/u,
  );
});

test('all diagnosis cases use an independent oracle; failure totals are never relabeled as passes', () => {
  const cases = isolationCases();
  const report = auditOrderIsolation(workflow);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  assert.equal(report.total, cases.length);
  assert.equal(report.passed + report.failed, report.total);
  assert.equal(
    report.failed,
    report.cases.filter((item) => item.violations.length).length,
  );
  assert.equal(report.llm_calls, 0);
  assert.equal(report.database_calls, 0);
  assert.equal(report.evidence_kind, 'deterministic_workflow_nodes');
  assert.ok(
    report.cases.some((item) => item.group === 'legacy-policy-control'),
  );
  const external = report.cases.find((item) => item.id === 'external-policy');
  assert.ok(external);
  assert.equal(external.model_extraction.external_context, true);
  assert.equal(external.model_extraction.person_request, 'none');
  assert.equal(external.model_extraction_kind, 'synthetic_controlled_input');
  for (const item of report.cases) {
    const sample = cases.find((sample) => sample.id === item.id);
    assert.ok(sample);
    assert.deepEqual(
      item.violations,
      isolationViolations(sample, executeIsolationCase(workflow, sample)),
    );
  }
});

test('CLI returns failure on detected defects, labels its evidence and refuses overwriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'silmer-isolation-audit-'));
  try {
    const output = join(directory, 'report.json');
    const script = new URL(
      '../scripts/ux-order-isolation-audit.mjs',
      import.meta.url,
    );
    const args = [
      fileURLToPath(script),
      fileURLToPath(CANONICAL_WORKFLOW),
      output,
    ];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.status, report.failed ? 1 : 0);
    assert.match(report.source_sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(JSON.parse(result.stdout), {
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      llm_calls: 0,
      database_calls: 0,
    });
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /EEXIST/u);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), report);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

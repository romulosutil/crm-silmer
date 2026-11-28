import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { summarizeWorkflowHealth } from '../ops/n8n/report-workflow-health.mjs';

const from = '2026-01-01T12:00:00.000Z';
const until = '2026-01-01T13:00:00.000Z';
const receiptError = 'The resource you are requesting could not be found';
const rejectedError =
  'Your request is invalid or could not be processed by the service';
const sensitive = 'PRIVATE_ERROR_DETAIL';

/** @param {string} id @param {Record<string, unknown>} payload @param {{ts?: string,eventName?: string}} [entry] */
function log(id, payload, entry = {}) {
  return JSON.stringify({
    ts: '2026-01-01T12:15:00.000Z',
    eventName: 'n8n.workflow.failed',
    payload: {
      workflowId: 'k7tI6T4RhQPyJkn9',
      executionId: id,
      isManual: false,
      mode: 'webhook',
      ...payload,
    },
    ...entry,
  });
}

test('OPS-ERR-04/08: report counts actual failure groups, excludes manual and shared-instance workflows, and removes private strings', async () => {
  const receipt = log('receipt-id', {
    lastNodeExecuted: 'CRM - Registrar status de entrega (MVP)',
    errorMessage: receiptError,
    privateBody: sensitive,
  });
  const report = await summarizeWorkflowHealth(
    [
      log('outside-start', {}, { ts: '2026-01-01T11:59:59.000Z' }),
      receipt,
      receipt,
      log('inbound-id', {
        lastNodeExecuted: 'CRM - Registrar inbound (MVP)',
        errorMessage: rejectedError,
      }),
      log('handoff-id', {
        lastNodeExecuted: 'CRM - Registrar handoff (MVP)',
        errorMessage: rejectedError,
      }),
      log('handler-id', {
        mode: 'error',
        errorMessage: 'command is not defined [line 10]',
      }),
      log('unknown-id', {
        lastNodeExecuted: sensitive,
        errorMessage: sensitive,
      }),
      log('success-id', {}, { eventName: 'n8n.workflow.success' }),
      log('manual-id', { isManual: true }),
      log('manual-mode-id', { mode: 'manual' }),
      log('shared-id', { workflowId: 'other', workflowName: sensitive }),
      log('personal-inbound-id', {
        workflowId: 'personal-inbound',
        workflowName: 'Silmer seller WhatsApp inbound',
        errorMessage: sensitive,
      }),
      log('personal-challenge-id', {
        workflowId: 'personal-challenge',
        workflowName: 'Silmer seller WhatsApp challenge v1',
      }),
      log('personal-control-id', {
        workflowId: 'personal-control',
        workflowName: 'Silmer seller WhatsApp control v1',
      }),
      log('', {}),
      'incomplete JSON',
      log('outside-end', {}, { ts: '2026-01-01T13:00:01.000Z' }),
    ],
    { from, until },
  );
  assert.equal(report.logBoundsCoverWindow, true);
  assert.equal(report.invalidLines, 1);
  assert.equal(report.eventsWithoutId, 1);
  assert.deepEqual(report.workflows.main, {
    succeeded: 1,
    failed: 5,
    failureReasons: {
      CRM_RECEIPT_HTTP_NOT_FOUND: 1,
      CRM_INBOUND_HTTP_REJECTED: 1,
      CRM_HANDOFF_HTTP_REJECTED: 1,
      ERROR_WORKFLOW_FAILED: 1,
      WORKFLOW_FAILURE_UNCLASSIFIED: 1,
    },
  });
  for (const name of [
    'personalInbound',
    'personalChallenge',
    'personalControl',
  ]) {
    assert.deepEqual(report.workflows[name], {
      succeeded: 0,
      failed: 1,
      failureReasons: { WORKFLOW_FAILURE_UNCLASSIFIED: 1 },
    });
  }
  assert.doesNotMatch(
    JSON.stringify(report),
    /PRIVATE_ERROR_DETAIL|receipt-id|command is not defined/u,
  );
});

test('OPS-ERR-08: absence of retained logs is visible and time windows are validated', async () => {
  const report = await summarizeWorkflowHealth([], { from, until });
  assert.equal(report.firstObserved, null);
  assert.equal(report.lastObserved, null);
  assert.equal(report.logBoundsCoverWindow, false);
  await assert.rejects(
    summarizeWorkflowHealth([], { from: until, until: from }),
    /time window/u,
  );
  await assert.rejects(
    summarizeWorkflowHealth([], { from: 'invalid', until }),
    /time window/u,
  );
});

test('OPS-ERR-04: CLI reads rotated logs without modifying them and reports partial coverage', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'n8n-health-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const current = join(folder, 'current.log');
  const rotated = join(folder, 'rotated.log');
  const record = log('one-id', { errorMessage: sensitive });
  await Promise.all([
    writeFile(current, record),
    writeFile(rotated, `${record}\n`),
  ]);
  const cli = fileURLToPath(
    new URL('../ops/n8n/report-workflow-health.mjs', import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [cli, from, until, current, rotated],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.logBoundsCoverWindow, false);
  assert.equal(report.workflows.main.failed, 1);
  assert.doesNotMatch(result.stdout, /PRIVATE_ERROR_DETAIL|one-id/u);
  const missing = spawnSync(
    process.execPath,
    [cli, from, until, join(folder, 'missing.log')],
    { encoding: 'utf8' },
  );
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stdout, '');
});

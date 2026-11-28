import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const personalWorkflows = new Map([
  ['Silmer seller WhatsApp inbound', 'personalInbound'],
  ['Silmer seller WhatsApp challenge v1', 'personalChallenge'],
  ['Silmer seller WhatsApp control v1', 'personalControl'],
]);

/** @param {Record<string, any>} event */
function failureCategory(event) {
  if (event.mode === 'error') return 'ERROR_WORKFLOW_FAILED';
  if (
    event.lastNodeExecuted === 'CRM - Registrar status de entrega (MVP)' &&
    event.errorMessage === 'The resource you are requesting could not be found'
  )
    return 'CRM_RECEIPT_HTTP_NOT_FOUND';
  if (
    event.errorMessage ===
    'Your request is invalid or could not be processed by the service'
  ) {
    if (event.lastNodeExecuted === 'CRM - Registrar inbound (MVP)')
      return 'CRM_INBOUND_HTTP_REJECTED';
    if (event.lastNodeExecuted === 'CRM - Registrar handoff (MVP)')
      return 'CRM_HANDOFF_HTTP_REJECTED';
  }
  return 'WORKFLOW_FAILURE_UNCLASSIFIED';
}

/**
 * OPS-ERR-04/08: read n8n event bus records, exporting only aggregate metadata.
 * Rotated log boundaries describe available evidence, with no guarantee of
 * continuity between the first and last records.
 * @param {AsyncIterable<string> | Iterable<string>} lines
 * @param {{from: string, until: string}} window
 */
export async function summarizeWorkflowHealth(lines, { from, until }) {
  const fromTime = Date.parse(from);
  const untilTime = Date.parse(until);
  if (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(untilTime) ||
    fromTime > untilTime
  )
    throw new Error('Expected a valid report time window');

  const workflows = Object.fromEntries(
    ['main', ...personalWorkflows.values()].map((name) => [
      name,
      {
        succeeded: 0,
        failed: 0,
        failureReasons: /** @type {Record<string, number>} */ ({}),
      },
    ]),
  );
  const seen = new Set();
  let first = Infinity;
  let last = -Infinity;
  let invalidLines = 0;
  let eventsWithoutId = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      invalidLines++;
      continue;
    }
    const time = Date.parse(entry?.ts ?? entry?.timestamp);
    if (!Number.isFinite(time)) continue;
    first = Math.min(first, time);
    last = Math.max(last, time);
    if (time < fromTime || time > untilTime) continue;
    const type = entry.eventName;
    if (type !== 'n8n.workflow.success' && type !== 'n8n.workflow.failed')
      continue;
    const event = entry.payload;
    if (!event || event.isManual !== false || event.mode === 'manual') continue;
    const scope =
      event.workflowId === 'k7tI6T4RhQPyJkn9'
        ? 'main'
        : personalWorkflows.get(event.workflowName);
    if (!scope) continue;
    const id = String(event.executionId ?? '');
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) {
      eventsWithoutId++;
      continue;
    }
    const key = `${scope}:${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = workflows[scope];
    if (type === 'n8n.workflow.success') {
      summary.succeeded++;
    } else {
      summary.failed++;
      const reason = failureCategory(event);
      summary.failureReasons[reason] =
        (summary.failureReasons[reason] ?? 0) + 1;
    }
  }
  return {
    from: new Date(fromTime).toISOString(),
    until: new Date(untilTime).toISOString(),
    firstObserved: Number.isFinite(first)
      ? new Date(first).toISOString()
      : null,
    lastObserved: Number.isFinite(last) ? new Date(last).toISOString() : null,
    logBoundsCoverWindow: first <= fromTime && last >= untilTime,
    invalidLines,
    eventsWithoutId,
    workflows,
  };
}

/** @param {string[]} paths */
async function* readLogs(paths) {
  for (const path of paths) {
    yield* createInterface({
      input: createReadStream(path),
      crlfDelay: Infinity,
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [from, until, ...paths] = process.argv.slice(2);
  if (!from || !until || paths.length === 0)
    throw new Error(
      'Usage: node report-workflow-health.mjs <from-ISO> <until-ISO> <event-log> ...',
    );
  const report = await summarizeWorkflowHealth(readLogs(paths), {
    from,
    until,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

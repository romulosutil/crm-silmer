// WAP-09. Operate on private exports of the four published workflows in memory.
// Publishing, preparing new version IDs and updating the service env are separate steps.
const CONTROL = 'silmer/seller-whatsapp/control';
const CHALLENGE = 'silmer/seller-whatsapp/challenge';
const EVENTS = 'silmer/seller-whatsapp/events';
const PANEL = 'silmer/panel-command';
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

/** @param {string[]} ids */
function encodedList(ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== 'string' || !UUID.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('WAP_ROLLOUT_INVALID_LINE_LIST');
  return JSON.stringify(ids);
}

/** @param {any} workflow @param {string} name @param {string} prefix
 * @param {string} suffix @param {string} before @param {string} after */
function replaceList(workflow, name, prefix, suffix, before, after) {
  const matches = workflow.nodes.filter(
    (/** @type {any} */ node) => node.name === name,
  );
  if (matches.length !== 1) throw new Error('WAP_ROLLOUT_NODE_MISMATCH');
  const node = matches[0];
  const field =
    node.type === 'n8n-nodes-base.set' &&
    name === 'Normalizar comando do painel (MVP)'
      ? 'jsonOutput'
      : 'jsCode';
  if (field === 'jsCode' && node.type !== 'n8n-nodes-base.code')
    throw new Error('WAP_ROLLOUT_NODE_MISMATCH');
  const source = node.parameters?.[field];
  const expected = prefix + before + suffix;
  if (typeof source !== 'string' || source.split(expected).length !== 2)
    throw new Error('WAP_ROLLOUT_BASE_MISMATCH');
  node.parameters[field] = source.replace(expected, prefix + after + suffix);
}

/** Patch only five allowlist literals. A missing/duplicated entry point or a
 * changed gate aborts the whole batch and leaves the caller's exports intact.
 * The caller must use a fresh published export, check concurrent versions
 * before import, and preserve existing draft edits.
 * @param {any[]} published @param {string[]} previous @param {string[]} next */
export function updateWapWorkflowAllowlists(published, previous, next) {
  const before = encodedList(previous);
  const after = encodedList(next);
  const paths = new Set([CONTROL, CHALLENGE, EVENTS, PANEL]);
  if (!Array.isArray(published) || published.length !== paths.size)
    throw new Error('WAP_ROLLOUT_WORKFLOW_MISMATCH');
  const result = structuredClone(published);
  for (const workflow of result) {
    if (!Array.isArray(workflow?.nodes))
      throw new Error('WAP_ROLLOUT_WORKFLOW_MISMATCH');
    const routes = workflow.nodes
      .filter(
        (/** @type {any} */ node) =>
          node.type === 'n8n-nodes-base.webhook' &&
          [CONTROL, CHALLENGE, EVENTS, PANEL].includes(node.parameters?.path),
      )
      .map((/** @type {any} */ node) => node.parameters.path);
    if (routes.length !== 1 || !paths.delete(routes[0]))
      throw new Error('WAP_ROLLOUT_WORKFLOW_MISMATCH');
    if (routes[0] === EVENTS) {
      for (const name of [
        'Evolution - Validar origem (MVP)',
        'Evolution - Montar evento WhatsApp (MVP)',
      ])
        replaceList(
          workflow,
          name,
          '{"personalInbound":true,"personalLineIds":',
          '}',
          before,
          after,
        );
    } else if (routes[0] === PANEL) {
      replaceList(
        workflow,
        'Normalizar comando do painel (MVP)',
        'if(target&&(!',
        '.includes(target.source?.lineId)',
        before,
        after,
      );
    } else {
      replaceList(
        workflow,
        'Guard',
        'const config={"enabled":true,"allowlist":',
        '};',
        before,
        after,
      );
    }
  }
  return result;
}

'use strict';

// WAP-E01 / WAP-02/03/04/10/12. Called before the initial n8n execution write.
// This module never logs requests, responses, credentials or exception causes.
const RESERVED_PATH = /^(?:wap-e01-|silmer\/seller-whatsapp\/)/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const GENERATION_HEADER = 'x-silmer-wap-generation-token';
const VERIFY_URL = 'http://wap-provider-fixture:8080/ingress/verify';
const MODES = new Set([
  'qr',
  'code',
  'failure',
  'progress',
  'manual',
  'provider-qr',
  'provider-code',
]);

function denied() {
  throw new Error('WAP_INGRESS_DENIED');
}
function unavailable() {
  throw new Error('WAP_INGRESS_UNAVAILABLE');
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value, allowed) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    denied();
}
function empty(value) {
  return value == null || (object(value) && Object.keys(value).length === 0);
}
function configuration(env) {
  if (env.SILMER_WAP_INGRESS_ENABLED !== 'true') denied();
  let paths;
  try {
    paths = JSON.parse(env.SILMER_WAP_INGRESS_PATHS || '');
  } catch {
    denied();
  }
  if (
    !object(paths) ||
    !Object.keys(paths).length ||
    Object.entries(paths).some(
      ([path, kind]) =>
        !RESERVED_PATH.test(path) ||
        !/^[A-Za-z0-9/_-]{1,128}$/.test(path) ||
        !['challenge', 'event'].includes(kind),
    )
  )
    denied();
  return paths;
}
function workflowSettings(workflow) {
  if (!object(workflow) || !object(workflow.settings)) denied();
  const settings = workflow.settings;
  if (
    settings.saveDataSuccessExecution !== 'none' ||
    settings.saveDataErrorExecution !== 'none' ||
    settings.saveManualExecutions !== false ||
    settings.saveExecutionProgress !== false ||
    ![undefined, null, ''].includes(settings.errorWorkflow) ||
    !empty(workflow.pinData)
  )
    denied();
}
function challengeBody(body) {
  // Operation/challenge IDs require authoritative E02 validation. Accepting an
  // arbitrary opaque string here would let a credential be persisted as an ID.
  keys(body, ['actor', 'generation', 'mode']);
  if (
    !['synthetic-a', 'synthetic-b'].includes(body.actor) ||
    // E01 is a fixed synthetic challenge profile. A freely supplied positive
    // number could carry a numeric pairing code into the initial SQL input.
    body.generation !== 1 ||
    !MODES.has(body.mode)
  )
    denied();
  return {
    actor: body.actor,
    generation: body.generation,
    mode: body.mode,
  };
}
function sourceBody(source) {
  keys(source, ['bindingId', 'lineId', 'accountId', 'generation']);
  if (
    !['bindingId', 'lineId', 'accountId'].every(
      (key) => typeof source[key] === 'string' && ID.test(source[key]),
    ) ||
    !Number.isSafeInteger(source.generation) ||
    source.generation < 1
  )
    denied();
  return {
    bindingId: source.bindingId,
    lineId: source.lineId,
    accountId: source.accountId,
    generation: source.generation,
  };
}
function eventBody(body) {
  keys(body, [
    'event',
    'instance',
    'source',
    'data',
    'destination',
    'date_time',
    'sender',
    'server_url',
  ]);
  keys(body.data, ['state']);
  if (
    body.event !== 'connection.update' ||
    !['wap-synthetic-qr', 'wap-synthetic-code'].includes(body.instance) ||
    !['connecting', 'close', 'open'].includes(body.data.state)
  )
    denied();
  for (const key of ['destination', 'date_time', 'sender', 'server_url']) {
    if (
      body[key] !== undefined &&
      (typeof body[key] !== 'string' || body[key].length > 1024)
    )
      denied();
  }
  return {
    event: body.event,
    instance: body.instance,
    source: sourceBody(body.source),
    data: { state: body.data.state },
  };
}
function replaceObject(target, projected) {
  if (!object(target)) denied();
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, projected);
  return target;
}
async function verifySource(source, instance, token, env, fetchImpl) {
  if (
    env.SILMER_WAP_INGRESS_VERIFY_URL !== VERIFY_URL ||
    !/^Basic [A-Za-z0-9+/]+=*$/.test(
      env.SILMER_WAP_INGRESS_VERIFY_BASIC || '',
    ) ||
    typeof token !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(token)
  )
    denied();
  let response;
  try {
    response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: env.SILMER_WAP_INGRESS_VERIFY_BASIC,
        [GENERATION_HEADER]: token,
      },
      body: JSON.stringify({ source, instance }),
    });
  } catch {
    unavailable();
  }
  if (response.status >= 500) unavailable();
  if (response.status !== 200) denied();
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 4096) denied();
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error?.message === 'WAP_INGRESS_DENIED') throw error;
    unavailable();
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString());
  keys(parsed, ['source', 'instance']);
  const canonical = sourceBody(parsed.source);
  if (
    parsed.instance !== instance ||
    Object.keys(source).some((key) => canonical[key] !== source[key])
  )
    denied();
  return canonical;
}

async function protectIngress(
  context,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const path = context.getNodeParameter('path', '');
  if (typeof path !== 'string' || !RESERVED_PATH.test(path)) return false;
  const response = context.getResponseObject();
  try {
    const paths = configuration(env);
    if (!Object.hasOwn(paths, path)) denied();
    const node = context.getNode();
    if (
      node.parameters?.path !== path ||
      !['headerAuth', 'basicAuth'].includes(
        context.getNodeParameter('authentication', 'none'),
      ) ||
      context.getNodeParameter('responseMode', '') !== 'responseNode' ||
      !empty(context.getNodeParameter('options', {}))
    )
      denied();
    workflowSettings(context.workflow);
    const req = context.getRequestObject();
    if (
      req.method !== 'POST' ||
      !empty(req.params) ||
      !empty(req.query) ||
      req.contentType !== 'application/json'
    )
      denied();
    let body;
    if (paths[path] === 'challenge') {
      body = challengeBody(req.body);
    } else {
      body = eventBody(req.body);
      body.source = await verifySource(
        body.source,
        body.instance,
        req.headers?.[GENERATION_HEADER],
        env,
        fetchImpl,
      );
    }
    // Mutate aliases too: WebhookContext caches references to req.headers/body.
    replaceObject(req.headers, {});
    req.params = replaceObject(req.params ?? {}, {});
    // Express 5 exposes query as a getter without a setter. Shadow only this
    // request after requiring its original query to be empty; preserve aliases.
    const projectedQuery = replaceObject(req.query ?? {}, {});
    Object.defineProperty(req, 'query', {
      value: projectedQuery,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    req.body = replaceObject(req.body, body);
    if (Buffer.isBuffer(req.rawBody)) req.rawBody.fill(0);
    delete req.rawBody;
    return false;
  } catch (error) {
    const temporary = error?.message === 'WAP_INGRESS_UNAVAILABLE';
    response.writeHead(temporary ? 503 : 403, {
      'Cache-Control': 'no-store',
    });
    response.end(temporary ? 'WAP_INGRESS_UNAVAILABLE' : 'WAP_INGRESS_DENIED');
    return true;
  }
}

function scopedWorkflow(workflow) {
  return (
    (typeof workflow?.name === 'string' &&
      workflow.name.startsWith('WAP-E01 isolated ')) ||
    (Array.isArray(workflow?.nodes) &&
      workflow.nodes.some(
        (node) =>
          node.type === 'n8n-nodes-base.webhook' &&
          typeof node.parameters?.path === 'string' &&
          RESERVED_PATH.test(node.parameters.path),
      ))
  );
}

function guardInitialExecution(
  executionData,
  existingExecution,
  env = process.env,
) {
  const workflow = executionData?.workflowData;
  if (!scopedWorkflow(workflow)) return;
  configuration(env);
  workflowSettings(workflow);
  if (
    existingExecution !== undefined ||
    executionData.retryOf != null ||
    !['manual', 'webhook'].includes(executionData.executionMode)
  )
    denied();
  const initial = executionData.executionData;
  if (
    !empty(initial?.resultData?.runData) ||
    initial?.resultData?.error ||
    !empty(initial?.pinData)
  )
    denied();
  if (executionData.executionMode === 'manual') {
    const stack = initial?.executionData?.nodeExecutionStack ?? [];
    if (!Array.isArray(stack)) denied();
    for (const frame of stack) {
      if (frame.node?.type !== 'n8n-nodes-base.manualTrigger') denied();
      const branches = frame.data?.main ?? [];
      for (const branch of branches)
        for (const item of branch ?? []) {
          keys(item, ['json']);
          if (!empty(item.json)) denied();
        }
    }
  }
}

function guardManualRequest(workflow, body, env = process.env) {
  if (!scopedWorkflow(workflow)) return;
  configuration(env);
  workflowSettings(workflow);
  // Use the original HTTP body: the DTO strips unknown keys and the execution
  // service may upgrade a partial request into a full execution.
  keys(body, ['triggerToStartFrom']);
  keys(body.triggerToStartFrom, ['name']);
  if (
    body.triggerToStartFrom.name !== 'Trigger' ||
    !Array.isArray(workflow.nodes)
  )
    denied();
  const triggers = workflow.nodes.filter((node) => node.name === 'Trigger');
  if (
    triggers.length !== 1 ||
    triggers[0].type !== 'n8n-nodes-base.manualTrigger' ||
    triggers[0].disabled === true
  )
    denied();
}

function guardWorkflowMutation(existing, payload, env = process.env) {
  if (!object(payload)) denied();
  const proposed = { ...(existing ?? {}), ...payload };
  const wasScoped = scopedWorkflow(existing);
  if (!wasScoped && !scopedWorkflow(proposed)) return;
  const paths = configuration(env);
  if (wasScoped && !scopedWorkflow(proposed)) denied();
  if (
    existing?.id !== undefined &&
    payload.id !== undefined &&
    payload.id !== existing.id
  )
    denied();
  // If settings are supplied, treat them as a replacement rather than assuming
  // how an upstream service merges them. All four privacy flags must be explicit.
  workflowSettings(proposed);
  if (!Array.isArray(proposed.nodes)) denied();
  for (const node of proposed.nodes) {
    if (node.type !== 'n8n-nodes-base.webhook') continue;
    const parameters = node.parameters;
    if (
      !object(parameters) ||
      !Object.hasOwn(paths, parameters.path) ||
      !['headerAuth', 'basicAuth'].includes(parameters.authentication) ||
      parameters.responseMode !== 'responseNode' ||
      !empty(parameters.options)
    )
      denied();
  }
}

module.exports = {
  protectIngress,
  guardInitialExecution,
  guardManualRequest,
  guardWorkflowMutation,
};

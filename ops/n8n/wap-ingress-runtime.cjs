'use strict';

// WAP-E01 / WAP-02/03/04/10/12. Called before the initial n8n execution write.
// This module never logs requests, responses, credentials or exception causes.
const RESERVED_PATH = /^(?:wap-e01-|silmer\/seller-whatsapp\/)/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const GENERATION_HEADER = 'x-silmer-wap-generation-token';
const VERIFY_URL = 'http://wap-provider-fixture:8080/ingress/verify';
const EVENT_EXECUTIONS_PER_BINDING = 4;
const EVENT_EXECUTIONS_TOTAL = 8;
const activeEventBindings = new Map();
let activeEventExecutions = 0;
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
        !['control', 'challenge', 'event'].includes(kind),
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
function eventBody(
  body,
  instances = ['wap-synthetic-qr', 'wap-synthetic-code'],
) {
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
  if (['messages.upsert', 'messages.update'].includes(body.event)) {
    if (
      !instances.includes(body.instance) ||
      !object(body.data) ||
      typeof body.sender !== 'string' ||
      !/^\d{8,15}@s\.whatsapp\.net$/.test(body.sender) ||
      typeof body.date_time !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(body.date_time) ||
      !Number.isFinite(Date.parse(body.date_time))
    )
      denied();
    const rawKey = body.event === 'messages.update' ? body.data : body.data.key;
    if (!object(rawKey) || typeof rawKey.fromMe !== 'boolean') denied();
    const key = {};
    for (const field of [
      'id',
      'keyId',
      'remoteJid',
      'remoteJidAlt',
      'participant',
      'participantAlt',
      'status',
    ]) {
      // Baileys v7 sends participant: null on direct chats; null is absent.
      if (rawKey[field] === undefined || rawKey[field] === null) continue;
      if (typeof rawKey[field] !== 'string' || rawKey[field].length > 512)
        denied();
      key[field] = rawKey[field];
    }
    key.fromMe = rawKey.fromMe;
    const data =
      body.event === 'messages.update'
        ? key
        : {
            key,
            messageTimestamp: body.data.messageTimestamp,
            message: projectMessage(body.data.message),
            pushName:
              typeof body.data.pushName === 'string'
                ? body.data.pushName.slice(0, 200)
                : '',
          };
    if (
      body.event === 'messages.upsert' &&
      (typeof data.messageTimestamp !== 'number' ||
        !Number.isFinite(data.messageTimestamp))
    )
      denied();
    return {
      event: body.event,
      instance: body.instance,
      source: sourceBody(body.source),
      data,
      sender: body.sender,
      date_time: body.date_time,
    };
  }
  keys(body.data, ['state', 'recovery']);
  if (
    body.event !== 'connection.update' ||
    !instances.includes(body.instance) ||
    !['connecting', 'close', 'open'].includes(body.data.state) ||
    (body.data.recovery !== undefined &&
      (body.data.recovery !== true || body.data.state !== 'connecting'))
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
    data: {
      state: body.data.state,
      ...(body.data.recovery === true ? { recovery: true } : {}),
    },
  };
}
const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'documentWithCaptionMessage',
];
function standaloneTemplate(message, depth = 0) {
  if (!object(message) || depth > 3) return false;
  const fields = Object.keys(message).filter(
    (key) => key !== 'messageContextInfo',
  );
  if (fields.length !== 1) return false;
  const [field] = fields;
  if (field === 'templateMessage') return object(message.templateMessage);
  return (
    MESSAGE_WRAPPERS.includes(field) &&
    standaloneTemplate(message[field]?.message, depth + 1)
  );
}
function projectMessage(raw, depth = 0) {
  if (!object(raw) || depth > 3) denied();
  // Keep only the kind so the validator can ignore standalone encrypted edits.
  if (
    object(raw.secretEncryptedMessage) &&
    Object.keys(raw).every((name) =>
      ['secretEncryptedMessage', 'messageContextInfo'].includes(name),
    )
  )
    return { secretEncryptedMessage: {} };
  const projected = {};
  for (const field of MESSAGE_WRAPPERS)
    if (object(raw[field]?.message))
      projected[field] = {
        message: projectMessage(raw[field].message, depth + 1),
      };
  if (typeof raw.conversation === 'string')
    projected.conversation = raw.conversation.slice(0, 4096);
  for (const field of [
    'extendedTextMessage',
    'imageMessage',
    'audioMessage',
    'videoMessage',
    'documentMessage',
    'stickerMessage',
  ]) {
    if (!object(raw[field])) continue;
    const value = {};
    for (const name of ['text', 'caption', 'mimetype', 'fileName'])
      if (typeof raw[field][name] === 'string')
        value[name] = raw[field][name].slice(
          0,
          name === 'text' || name === 'caption' ? 4096 : 255,
        );
    const quote = raw[field].contextInfo?.stanzaId;
    if (typeof quote === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(quote))
      value.contextInfo = { stanzaId: quote };
    projected[field] = value;
  }
  // Unsupported content is represented only by its kind, never raw contacts,
  // key material, thumbnails, remote URLs or arbitrary provider objects.
  for (const field of [
    'albumMessage',
    'contactMessage',
    'contactsArrayMessage',
    'reactionMessage',
    'protocolMessage',
  ])
    if (object(raw[field])) projected[field] = {};
  if (object(raw.locationMessage)) {
    const loc = raw.locationMessage;
    projected.locationMessage = {
      degreesLatitude: loc.degreesLatitude,
      degreesLongitude: loc.degreesLongitude,
      address: typeof loc.address === 'string' ? loc.address.slice(0, 255) : '',
    };
    if (
      !Number.isFinite(loc.degreesLatitude) ||
      !Number.isFinite(loc.degreesLongitude)
    )
      denied();
  }
  return projected;
}
function replaceObject(target, projected) {
  if (!object(target)) denied();
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, projected);
  return target;
}
async function verifySource(
  source,
  instance,
  token,
  env,
  fetchImpl,
  sender,
  recovery,
  messageTimestamp,
) {
  const url = trustedVerifier(
    env.SILMER_WAP_INGRESS_VERIFY_URL,
    '/api/v1/integrations/n8n/whatsapp-control/ingress/verify',
    VERIFY_URL,
  );
  if (
    !/^Basic [A-Za-z0-9+/]+=*$/.test(
      env.SILMER_WAP_INGRESS_VERIFY_BASIC || '',
    ) ||
    typeof token !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(token)
  )
    denied();
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: env.SILMER_WAP_INGRESS_VERIFY_BASIC,
        [GENERATION_HEADER]: token,
        ...technicalHeaders(source.bindingId, source.bindingId),
      },
      body: JSON.stringify({
        source,
        instance,
        ...(sender ? { sender } : {}),
        ...(recovery ? { recovery: true } : {}),
        ...(messageTimestamp === undefined ? {} : { messageTimestamp }),
      }),
    });
  } catch {
    unavailable();
  }
  // Throttling is temporary: Evolution retries only 5xx, never 4xx.
  if (response.status >= 500 || response.status === 429) unavailable();
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
  keys(parsed, ['source', 'instance', 'ignored']);
  const canonical = sourceBody(parsed.source);
  if (
    parsed.instance !== instance ||
    Object.keys(source).some((key) => canonical[key] !== source[key]) ||
    (parsed.ignored !== undefined &&
      (messageTimestamp === undefined || parsed.ignored !== 'before_cutover'))
  )
    denied();
  return {
    source: canonical,
    beforeCutover: parsed.ignored === 'before_cutover',
  };
}

function trustedVerifier(raw, path, synthetic) {
  if (raw === synthetic && synthetic) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    denied();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== path
  )
    denied();
  return url.href;
}
function technicalHeaders(correlation, key) {
  return {
    'x-silmer-workflow-key': 'seller-whatsapp-control',
    'x-silmer-workflow-version': '1.0',
    'x-silmer-execution-id': `ingress:${correlation}`,
    'x-correlation-id': correlation,
    'idempotency-key': key,
  };
}
function controlEnvelope(value, kind) {
  const base = ['operationId', 'lineId', 'generation', 'reference'];
  keys(value, [
    ...base,
    ...(kind === 'control' ? ['action'] : ['challengeId', 'mode']),
  ]);
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    ![
      'operationId',
      'lineId',
      'reference',
      ...(kind === 'challenge' ? ['challengeId'] : []),
    ].every((key) => typeof value[key] === 'string' && uuid.test(value[key])) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    (kind === 'control'
      ? !['connect', 'reconcile', 'disconnect'].includes(value.action)
      : !['qr', 'code'].includes(value.mode))
  )
    denied();
  return {
    operationId: value.operationId,
    lineId: value.lineId,
    generation: value.generation,
    reference: value.reference,
    ...(kind === 'control'
      ? { action: value.action }
      : { challengeId: value.challengeId, mode: value.mode }),
  };
}
async function verifyControl(body, kind, env, fetchImpl) {
  const envelope = controlEnvelope(body, kind);
  const path = '/api/v1/integrations/n8n/whatsapp-control/verify';
  const url = trustedVerifier(
    env.SILMER_WAP_CONTROL_VERIFY_URL,
    path,
    env.SILMER_WAP_INGRESS_SYNTHETIC === 'true'
      ? `http://wap-control-fixture:8080${path}`
      : undefined,
  );
  if (
    !/^Basic [A-Za-z0-9+/]+=*$/.test(env.SILMER_WAP_INGRESS_VERIFY_BASIC || '')
  )
    denied();
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: env.SILMER_WAP_INGRESS_VERIFY_BASIC,
        'content-type': 'application/json',
        ...technicalHeaders(
          envelope.operationId,
          kind === 'control' ? envelope.operationId : envelope.challengeId,
        ),
      },
      body: JSON.stringify({ kind, envelope }),
    });
  } catch {
    unavailable();
  }
  // Throttling is temporary: answer 503 so the caller may retry, not a denial.
  if (response.status >= 500 || response.status === 429) unavailable();
  if (response.status !== 200) denied();
  let size = 0;
  const chunks = [];
  let parsed;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4096) denied();
      chunks.push(Buffer.from(chunk));
    }
    parsed = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    denied();
  }
  keys(parsed, ['kind', 'envelope']);
  if (parsed.kind !== kind) denied();
  const canonical = controlEnvelope(parsed.envelope, kind);
  if (Object.keys(canonical).some((key) => canonical[key] !== envelope[key]))
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
    let ignoreTemplate = false;
    let recovery = false;
    let beforeCutover = false;
    if (
      path.startsWith('silmer/seller-whatsapp/') &&
      ['control', 'challenge'].includes(paths[path])
    ) {
      body = await verifyControl(req.body, paths[path], env, fetchImpl);
    } else if (paths[path] === 'challenge') {
      body = challengeBody(req.body);
    } else {
      const instances = path.startsWith('silmer/seller-whatsapp/')
        ? (env.SILMER_WAP_INGRESS_INSTANCES || '').split(',')
        : undefined;
      if (
        instances &&
        (!instances.length || instances.some((instance) => !ID.test(instance)))
      )
        denied();
      body = eventBody(req.body, instances);
      recovery =
        body.event === 'connection.update' && body.data.recovery === true;
      if (recovery && !instances) denied();
      let messageTimestamp;
      if (instances && body.event === 'messages.upsert') {
        const raw = body.data.messageTimestamp;
        // Apply the same seconds normalization as the workflow converter.
        messageTimestamp = Math.floor(raw > 1e12 ? raw / 1000 : raw);
        if (!Number.isSafeInteger(messageTimestamp) || messageTimestamp <= 0)
          denied();
      }
      const verified = await verifySource(
        body.source,
        body.instance,
        req.headers?.[GENERATION_HEADER],
        env,
        fetchImpl,
        body.sender,
        recovery,
        messageTimestamp,
      );
      body.source = verified.source;
      beforeCutover = verified.beforeCutover;
      ignoreTemplate =
        path.startsWith('silmer/seller-whatsapp/') &&
        body.event === 'messages.upsert' &&
        body.data.key.fromMe === false &&
        standaloneTemplate(req.body.data.message);
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
    if (ignoreTemplate || recovery || beforeCutover) {
      response.writeHead(recovery || beforeCutover ? 204 : 200, {
        'Cache-Control': 'no-store',
      });
      response.end();
      return true;
    }
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
      (workflow.name.startsWith('WAP-E01 isolated ') ||
        workflow.name.startsWith('Silmer seller WhatsApp '))) ||
    (Array.isArray(workflow?.nodes) &&
      workflow.nodes.some(
        (node) =>
          node.type === 'n8n-nodes-base.webhook' &&
          typeof node.parameters?.path === 'string' &&
          RESERVED_PATH.test(node.parameters.path),
      ))
  );
}

function reserveEventExecution(bindingId) {
  const active = activeEventBindings.get(bindingId) ?? 0;
  if (
    active >= EVENT_EXECUTIONS_PER_BINDING ||
    activeEventExecutions >= EVENT_EXECUTIONS_TOTAL
  )
    unavailable();
  activeEventBindings.set(bindingId, active + 1);
  activeEventExecutions++;
  return () => {
    const remaining = activeEventBindings.get(bindingId) - 1;
    if (remaining === 0) activeEventBindings.delete(bindingId);
    else activeEventBindings.set(bindingId, remaining);
    activeEventExecutions--;
  };
}

function guardInitialExecution(
  executionData,
  existingExecution,
  env = process.env,
) {
  const workflow = executionData?.workflowData;
  if (!scopedWorkflow(workflow)) return;
  const paths = configuration(env);
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
  } else if (
    workflow.nodes?.some((node) => {
      const path = node.parameters?.path;
      return (
        node.type === 'n8n-nodes-base.webhook' &&
        typeof path === 'string' &&
        path.startsWith('silmer/seller-whatsapp/') &&
        paths[path] === 'event'
      );
    })
  ) {
    const body =
      initial?.executionData?.nodeExecutionStack?.[0]?.data?.main?.[0]?.[0]
        ?.json?.body;
    if (body?.event === 'connection.update') return;
    if (!['messages.upsert', 'messages.update'].includes(body?.event)) denied();
    return reserveEventExecution(sourceBody(body.source).bindingId);
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

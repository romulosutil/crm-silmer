// WAP-E01 / WAP-T01-01. Isolated experiment, never an operational workflow.
// The only reachable upstream is the dedicated synthetic fixture.
/** @param {{ enabled?: boolean, allowlist?: string[], credentialId?: string, manual?: boolean }} [options] */
export function createPairingPrivacyProbe({
  enabled = false,
  allowlist = [],
  credentialId,
  manual = false,
} = {}) {
  if (!credentialId || !/^[a-zA-Z0-9_-]+$/.test(credentialId))
    throw new Error('WAP_PROBE_CREDENTIAL_REQUIRED');
  if (
    typeof enabled !== 'boolean' ||
    !Array.isArray(allowlist) ||
    allowlist.some((id) => !/^synthetic-[ab]$/.test(id))
  )
    throw new Error('WAP_PROBE_CONFIG_INVALID');
  const auth = { httpHeaderAuth: { id: credentialId, name: 'WAP synthetic' } };
  /** @param {string} name @param {string} type @param {any} parameters @param {any} [extra] @returns {any} */
  const node = (name, type, parameters, extra = {}) => ({
    id: name,
    name,
    type: `n8n-nodes-base.${type}`,
    typeVersion: type === 'httpRequest' ? 4.2 : type === 'webhook' ? 2 : 1,
    position: [0, 0],
    parameters,
    ...extra,
  });
  const trigger = manual
    ? node('Trigger', 'manualTrigger', {})
    : node(
        'Trigger',
        'webhook',
        {
          httpMethod: 'POST',
          path: 'wap-e01-privacy',
          authentication: 'headerAuth',
          responseMode: 'responseNode',
          options: {},
        },
        { credentials: auth, webhookId: 'wap-e01-isolated' },
      );
  const config = JSON.stringify({ enabled, allowlist });
  const guard = node('Guard', 'code', {
    jsCode: `const config = ${config};
const body = ${manual ? "{ actor: 'synthetic-a', generation: 1, mode: 'manual' }" : '$json.body'};
if (config.enabled !== true || !config.allowlist.includes(body?.actor)
  || body?.generation !== 1 || !['qr','code','failure','progress','manual','provider-qr','provider-code'].includes(body?.mode))
  throw new Error('WAP_PROBE_DENIED');
return { json: { mode: body.mode } };`,
  });
  const challenge = node(
    'Challenge',
    'httpRequest',
    {
      url: "={{ 'http://wap-provider-fixture:8080/challenge/' + $json.mode }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {
        timeout: 10000,
        redirect: { redirect: { followRedirects: false } },
      },
    },
    { credentials: auth, retryOnFail: false },
  );
  const finish = node(
    'Finish',
    'httpRequest',
    {
      url: "={{ 'http://wap-provider-fixture:8080/finish/' + $('Guard').first().json.mode }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {
        timeout: 60000,
        redirect: { redirect: { followRedirects: false } },
      },
    },
    { credentials: auth, retryOnFail: false },
  );
  const respond = node('Respond', 'respondToWebhook', {
    respondWith: 'json',
    responseBody: "={{ $('Challenge').first().json }}",
    options: {
      responseHeaders: {
        entries: [{ name: 'Cache-Control', value: 'no-store' }],
      },
    },
  });
  const names = manual
    ? ['Trigger', 'Guard', 'Challenge', 'Finish']
    : ['Trigger', 'Guard', 'Challenge', 'Finish', 'Respond'];
  return {
    name: `WAP-E01 isolated ${manual ? 'manual' : 'webhook'} privacy probe`,
    active: false,
    nodes: manual
      ? [trigger, guard, challenge, finish]
      : [trigger, guard, challenge, finish, respond],
    connections: Object.fromEntries(
      names
        .slice(0, -1)
        .map((name, i) => [
          name,
          { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] },
        ]),
    ),
    pinData: {},
    settings: {
      executionOrder: 'v1',
      saveDataSuccessExecution: 'none',
      saveDataErrorExecution: 'none',
      saveManualExecutions: false,
      saveExecutionProgress: false,
    },
  };
}

/** A shared synthetic event workflow; authentication and immutable-source
 * verification happen in the patched ingress before the first execution write.
 * @param {{ credentialId: string }} options */
export function createGenerationIngressProbe({ credentialId }) {
  const workflow = createPairingPrivacyProbe({ credentialId });
  workflow.name = 'WAP-E01 isolated generation source';
  const trigger = workflow.nodes.find(
    (/** @type {any} */ node) => node.name === 'Trigger',
  );
  trigger.parameters.path = 'wap-e01-generation';
  trigger.webhookId = 'wap-e01-generation-isolated';
  const respond = workflow.nodes.find(
    (/** @type {any} */ node) => node.name === 'Respond',
  );
  respond.parameters.responseBody = '={{ $json.body }}';
  workflow.nodes = [trigger, respond];
  workflow.connections = {
    Trigger: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
  };
  return workflow;
}

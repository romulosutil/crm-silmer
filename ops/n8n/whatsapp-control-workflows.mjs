// WAP-E02 / WAP-T01-04. Generates reviewable, inactive shared workflows only.
// Credentials are n8n references. No phone, QR, code or secret is embedded.
// WAP-E12: in production Evolution listens only on the internal docker
// network, so the Gateway may use exactly this plain-http origin (port
// included). The CRM stays https-only.
export const INTERNAL_EVOLUTION_ORIGINS = Object.freeze([
  'http://schedule_silmer-evolution:8080',
]);
/** @param {string} raw @param {boolean} synthetic @param {readonly string[]} [internal] */
function origin(raw, synthetic, internal = []) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('WAP_WORKFLOW_CONFIGURATION_INVALID');
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && internal.includes(url.origin)) &&
      !(
        synthetic &&
        url.protocol === 'http:' &&
        [
          '127.0.0.1',
          'localhost',
          'wap-provider-fixture',
          'wap-control-fixture',
        ].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('WAP_WORKFLOW_CONFIGURATION_INVALID');
  return url.origin;
}

/** @param {{enabled?:boolean,allowlist?:string[],crmBaseUrl:string,evolutionBaseUrl:string,webhookCredentialId:string,crmCredentialId:string,evolutionCredentialId:string,allowSyntheticHttp?:boolean}} options */
export function createWhatsAppControlWorkflows(options) {
  const enabled = options.enabled ?? false;
  const allowlist = options.allowlist ?? [];
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (
    typeof enabled !== 'boolean' ||
    !Array.isArray(allowlist) ||
    allowlist.some((id) => !uuid.test(id)) ||
    ![
      options.webhookCredentialId,
      options.crmCredentialId,
      options.evolutionCredentialId,
    ].every((id) => /^[A-Za-z0-9_-]{1,128}$/u.test(id))
  )
    throw new Error('WAP_WORKFLOW_CONFIGURATION_INVALID');
  const crm = origin(options.crmBaseUrl, options.allowSyntheticHttp === true);
  const evolution = origin(
    options.evolutionBaseUrl,
    options.allowSyntheticHttp === true,
    INTERNAL_EVOLUTION_ORIGINS,
  );
  return { control: build('control'), challenge: build('challenge') };

  /** @param {'control'|'challenge'} kind */
  function build(kind) {
    const basic = (/** @type {string} */ id, /** @type {string} */ name) => ({
      httpBasicAuth: { id, name },
    });
    const header = {
      httpHeaderAuth: {
        id: options.evolutionCredentialId,
        name: 'Evolution private API',
      },
    };
    const native = basic(
      options.webhookCredentialId,
      'CRM WhatsApp control webhook',
    );
    const crmAuth = basic(options.crmCredentialId, 'CRM AUTOMATION_EXECUTOR');
    /** @param {string} name @param {string} type @param {any} parameters @param {any} [extra] */
    const node = (name, type, parameters, extra = {}) => ({
      id: name,
      name,
      type: `n8n-nodes-base.${type}`,
      typeVersion:
        type === 'httpRequest'
          ? 4.2
          : type === 'webhook'
            ? 2
            : type === 'code'
              ? 2
              : 1,
      position: [0, 0],
      parameters,
      ...extra,
    });
    const context = "$('Guard').first().json";
    const technicalHeaders = (key = `${context}.operationId`) => ({
      parameters: [
        { name: 'x-silmer-workflow-key', value: 'seller-whatsapp-control' },
        { name: 'x-silmer-workflow-version', value: '1.0' },
        { name: 'x-silmer-execution-id', value: '={{ $execution.id }}' },
        { name: 'x-correlation-id', value: `={{ ${context}.operationId }}` },
        { name: 'idempotency-key', value: `={{ ${key} }}` },
        { name: 'cache-control', value: 'no-store' },
      ],
    });
    const httpOptions = {
      timeout: 15000,
      redirect: { redirect: { followRedirects: false } },
    };
    const trigger = node(
      'Trigger',
      'webhook',
      {
        httpMethod: 'POST',
        path: `silmer/seller-whatsapp/${kind}`,
        authentication: 'basicAuth',
        responseMode: 'responseNode',
        options: {},
      },
      { credentials: native, webhookId: `silmer-personal-${kind}-v1` },
    );
    const guard = node('Guard', 'code', {
      jsCode: `const config=${JSON.stringify({ enabled, allowlist })};
const body=$json.body;
const fields=${JSON.stringify(['operationId', 'lineId', 'generation', 'reference', ...(kind === 'control' ? ['action'] : ['challengeId', 'mode'])])};
if(config.enabled!==true||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!==fields.sort().join(',')||!config.allowlist.includes(body.lineId))throw new Error('WAP_CONTROL_DENIED');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if(!['operationId','lineId','reference'${kind === 'challenge' ? ",'challengeId'" : ''}].every(k=>typeof body[k]==='string'&&uuid.test(body[k]))||!Number.isSafeInteger(body.generation)||body.generation<1||${kind === 'control' ? "!['connect','reconcile','disconnect'].includes(body.action)" : "!['qr','code'].includes(body.mode)"})throw new Error('WAP_CONTROL_DENIED');
return {json:body};`,
    });
    const reserve = node(
      'Reserve',
      'httpRequest',
      {
        method: 'POST',
        url: `${crm}/api/v1/integrations/n8n/whatsapp-control/operations`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBasicAuth',
        sendHeaders: true,
        headerParameters: technicalHeaders(
          kind === 'challenge' ? `${context}.challengeId` : undefined,
        ),
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({kind:${JSON.stringify(kind)},envelope:${context}}) }}`,
        options: httpOptions,
      },
      { credentials: crmAuth, retryOnFail: false },
    );
    const plan = node('Plan', 'code', {
      jsCode: `const command=${context};const p=$json;
if(p.allowed!==true||p.operationId!==command.operationId||p.lineId!==command.lineId||p.generation!==command.generation||p.reference!==command.reference||typeof p.instance!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(p.instance)||(${kind === 'challenge' ? 'true' : "command.action==='connect'"}&&(!p.source||p.source.lineId!==command.lineId||p.source.generation!==command.generation||typeof p.generationToken!=='string')))throw new Error('WAP_CONTROL_PLAN_DENIED');
${kind === 'control' ? "if(p.action!==command.action||typeof p.resultId!=='string')throw new Error('WAP_CONTROL_PLAN_DENIED');" : "if(!p.challenge||p.challenge.challengeId!==command.challengeId||p.challenge.mode!==command.mode||p.challenge.operationId!==command.operationId)throw new Error('WAP_CONTROL_PLAN_DENIED');"}
return {json:{kind:${JSON.stringify(kind)},instance:p.instance,expectedNumber:p.expectedNumber,webhookUrl:p.webhookUrl,source:${kind === 'challenge' ? 'p.source' : "command.action!=='disconnect'?(p.source??null):null"},generationToken:${kind === 'challenge' ? 'p.generationToken' : "command.action!=='disconnect'?(p.generationToken??null):null"},${kind === 'control' ? 'action:p.action' : 'challenge:{challengeId:p.challenge.challengeId,operationId:p.challenge.operationId,mode:p.challenge.mode,expiresAt:p.challenge.expiresAt}'}}};`,
    });
    const gateway = node(
      'Gateway',
      'httpRequest',
      {
        method: 'POST',
        url: `${evolution}/silmer/whatsapp-control/execute`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'cache-control', value: 'no-store' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json) }}',
        options: httpOptions,
      },
      { credentials: header, retryOnFail: false },
    );
    const project = node('Result', 'code', {
      jsCode: `const command=${context};const plan=$('Reserve').first().json;const result=$json;
if(!result||!['succeeded','failed_before_effect','unknown','reconciled'].includes(result.outcome)||!['open','close','connecting','absent'].includes(result.providerState)||typeof result.webhookVerified!=='boolean'||typeof result.bindingVerified!=='boolean'||(result.confirmedNumber!==undefined&&!/^\\+[1-9][0-9]{7,14}$/.test(result.confirmedNumber)))throw new Error('WAP_CONTROL_RESULT_INVALID');
return {json:{operationId:command.operationId,lineId:command.lineId,generation:command.generation,resultId:plan.resultId,effect:command.action,outcome:result.outcome,providerState:result.providerState,webhookVerified:result.webhookVerified,bindingVerified:result.bindingVerified,...(result.confirmedNumber?{confirmedNumber:result.confirmedNumber}:{})}};`,
    });
    const callback = node(
      'Callback',
      'httpRequest',
      {
        method: 'POST',
        url: `${crm}/api/v1/integrations/n8n/whatsapp-control/results`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBasicAuth',
        sendHeaders: true,
        headerParameters: technicalHeaders('$json.resultId'),
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json) }}',
        options: httpOptions,
      },
      { credentials: crmAuth, retryOnFail: false },
    );
    const respond = node('Respond', 'respondToWebhook', {
      respondWith: 'json',
      responseBody:
        kind === 'control'
          ? `={{ JSON.stringify({accepted:true,operationId:${context}.operationId,generation:${context}.generation}) }}`
          : "={{ JSON.stringify($('Gateway').first().json) }}",
      options: {
        responseHeaders: {
          entries: [
            { name: 'Cache-Control', value: 'no-store' },
            { name: 'Referrer-Policy', value: 'no-referrer' },
          ],
        },
      },
    });
    const nodes =
      kind === 'control'
        ? [trigger, guard, reserve, plan, gateway, project, callback, respond]
        : [trigger, guard, reserve, plan, gateway, respond];
    return {
      name: `Silmer seller WhatsApp ${kind} v1`,
      active: false,
      nodes,
      connections: Object.fromEntries(
        nodes
          .slice(0, -1)
          .map((n, i) => [
            n.name,
            { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] },
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
}

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  createEvolutionWorkflow,
  validateEvolutionEvent,
  validatePersonalEvolutionEvent,
  convertEvolutionEvent,
  convertPersonalEvolutionEvent,
  decodeEvolutionMedia,
} from './create-evolution-workflow.mjs';
import { configurePersonalSend } from './seller-whatsapp-send.mjs';

const VALIDATE = 'Evolution - Validar origem (MVP)';
const CONVERT = 'Evolution - Montar evento WhatsApp (MVP)';
const NORMALIZE = 'Normalizar evento WhatsApp (MVP)';

/** The original adapter supplies the allowlist and sanitized shapes.
 * @param {any} root @param {any} config @param {Function} [personal] @param {Function} [general] */
export function validateObservedEvolutionEvent(
  root,
  config,
  personal = validatePersonalEvolutionEvent,
  general = validateEvolutionEvent,
) {
  return personal(
    root,
    config,
    (/** @type {any} */ input, /** @type {any} */ origin) => {
      const event =
        input?.body && typeof input.body === 'object' ? input.body : input;
      if (
        event?.event !== 'messages.upsert' ||
        event?.data?.key?.fromMe !== true
      )
        return general(input, origin);
      // Apply the existing shape/content checks after proving the original
      // direction. The adapter emits the result solely as an observation.
      const checked = general(
        {
          ...event,
          data: { ...event.data, key: { ...event.data.key, fromMe: false } },
        },
        origin,
      );
      return checked
        ? { ...checked, event: { ...checked.event, kind: 'external' } }
        : null;
    },
  );
}

/** @param {any} input @param {any} mapping @param {any} config @param {Function} [personal] @param {Function} [general] */
export function convertObservedEvolutionEvent(
  input,
  mapping,
  config,
  personal = convertPersonalEvolutionEvent,
  general = convertEvolutionEvent,
) {
  if (input.event?.kind !== 'external')
    return personal(input, mapping, config, general);
  if (!input.source) throw new Error('EVOLUTION_SOURCE_MISMATCH');
  const { type, text, caption } = input.event;
  if (
    !['text', 'image', 'audio', 'video', 'document'].includes(type) ||
    (type === 'text' && (typeof text !== 'string' || !text.trim()))
  )
    return {};
  let phone = input.provider_phone;
  if (input.needs_lid) {
    const records = mapping?.messages?.records;
    const matches = Array.isArray(records)
      ? records.filter((record) => record?.key?.id === input.id)
      : [];
    const key = matches.length === 1 ? matches[0]?.key : null;
    if (key?.fromMe === true && key.remoteJid === input.chat)
      phone = /^([1-9]\d{7,14})@s\.whatsapp\.net$/u.exec(
        key.remoteJidAlt ?? '',
      )?.[1];
  }
  if (!phone || phone === input.ownNumber)
    throw new Error('EVOLUTION_IDENTITY_UNRESOLVED');
  const { bindingId, lineId, accountId, generation } = input.source;
  return {
    external: {
      schema_version: '1.0',
      event_type: 'message.external.sent',
      event_id: `${accountId}:external:${input.id}`,
      external_message_id: input.id,
      from_me: true,
      origin: 'device',
      occurred_at: new Date(input.occurred_at_seconds * 1000).toISOString(),
      source: { bindingId, lineId, accountId, generation },
      instance: input.instance,
      to: `+${phone}`,
      message: { type, text: type === 'text' ? text : (caption ?? '') },
    },
  };
}

/** Produces the inactive WAP candidate over the immutable general generator.
 * @param {any} source @param {Parameters<typeof createEvolutionWorkflow>[1] & {personalSendLineIds?:string[]}} options */
export function createSellerWhatsAppEvolutionWorkflow(source, options) {
  const workflow = createEvolutionWorkflow(source, options);
  if (options.personalInbound === true)
    applyObservedOutbound(workflow, {
      personalLineIds: /** @type {string[]} */ (options.personalLineIds),
      baseUrl: options.baseUrl ?? 'http://schedule_silmer-evolution:8080',
    });
  return configurePersonalSend(workflow, options.personalSendLineIds ?? []);
}

/** WAP-E08/E12. Phone echoes (fromMe upserts) of a personal line become
 * `message.external.sent` observations with their media, never inbound.
 * Applied over a workflow that already carries applyPersonalInbound.
 * crmBaseUrl, when given, replaces the `$env` CRM origin (blocked in n8n 2).
 * @param {any} workflow @param {{personalLineIds:string[],baseUrl:string,crmBaseUrl?:string}} options */
export function applyObservedOutbound(workflow, options) {
  if (
    workflow.nodes.some(
      (/** @type {any} */ node) =>
        node.name === 'Preparar saída observada (WAP)',
    )
  )
    throw new Error('EVOLUTION_OBSERVED_ALREADY_APPLIED');
  const find = (/** @type {string} */ name) => {
    const node = workflow.nodes.find(
      (/** @type {any} */ item) => item.name === name,
    );
    if (!node) throw new Error(`EVOLUTION_NODE_MISSING: ${name}`);
    return node;
  };
  const config = JSON.stringify({
    personalInbound: true,
    personalLineIds: options.personalLineIds,
  });
  find(VALIDATE).parameters.jsCode =
    `const general=${validateEvolutionEvent.toString()};const personal=${validatePersonalEvolutionEvent.toString()};const validate=${validateObservedEvolutionEvent.toString()};return $input.all().map((item,index)=>{const checked=validate(item.json,${config},personal,general);return checked?{json:checked,pairedItem:{item:index}}:null;}).filter(Boolean);`;
  find(CONVERT).parameters.jsCode =
    `const general=${convertEvolutionEvent.toString()};const personal=${convertPersonalEvolutionEvent.toString()};const convert=${convertObservedEvolutionEvent.toString()};const input=$('${VALIDATE}').item.json;return {json:convert(input,input.needs_lid?$json:null,${config},personal,general)};`;
  const normalize = find(NORMALIZE);
  normalize.parameters.jsCode = `if($json.external||(!$json.messages&&!$json.statuses))return [];${normalize.parameters.jsCode}`;
  const prepare = 'Preparar saída observada (WAP)';
  const record = 'CRM - Registrar saída observada (WAP)';
  workflow.nodes.push(
    {
      ...structuredClone(normalize),
      name: prepare,
      id: 'wap-prepare-external',
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: `const payload=$json.external;if(!payload)return [];return {json:{payload,idempotency_key:payload.event_id,correlation_id:String($execution.id).padStart(16,'0')}};`,
      },
    },
    {
      ...structuredClone(find('CRM - Registrar status de entrega (MVP)')),
      name: record,
      id: 'wap-record-external',
      retryOnFail: false,
    },
  );
  workflow.connections[CONVERT].main[0].push({
    node: prepare,
    type: 'main',
    index: 0,
  });
  workflow.connections[prepare] = {
    main: [[{ node: record, type: 'main', index: 0 }]],
  };
  attachObservedMedia(workflow, options.baseUrl, options.crmBaseUrl);
  return workflow;
}

/** @param {any} response @param {string} kind @param {Function} [decode] */
function decodeObservedMedia(response, kind, decode = decodeEvolutionMedia) {
  const mime = String(response?.mimetype ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (kind === 'image' || kind === 'audio')
    return decode(response, { media_kind: kind, media_mime_type: mime });
  const allowed =
    kind === 'video'
      ? ['video/mp4', 'video/webm']
      : kind === 'document'
        ? ['application/pdf']
        : [];
  const base64 = response?.base64;
  const limit = 16 * 1024 * 1024;
  if (
    !allowed.includes(mime) ||
    typeof base64 !== 'string' ||
    !base64 ||
    base64.length > Math.ceil(limit / 3) * 4 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(base64)
  )
    throw new Error('EVOLUTION_MEDIA_INVALID');
  const bytes = Buffer.from(base64, 'base64');
  if (
    !bytes.length ||
    bytes.length > limit ||
    bytes.toString('base64') !== base64
  )
    throw new Error('EVOLUTION_MEDIA_INVALID');
  return {
    json: {},
    binary: {
      data: {
        data: base64,
        mimeType: mime,
        fileName: `attachment.${mime.split('/')[1]}`,
      },
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, configPath, baselinePath] = process.argv.slice(2);
  if (!input || !output || !configPath || input === output)
    throw new Error(
      'Usage: node create-seller-whatsapp-evolution-workflow.mjs source.json output.json config.json [meta-baseline.json]',
    );
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (baselinePath)
    config.transportBaseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const workflow = createSellerWhatsAppEvolutionWorkflow(
    JSON.parse(await readFile(input, 'utf8')),
    config,
  );
  await writeFile(output, JSON.stringify(workflow, null, 2) + '\n', {
    flag: 'wx',
  });
}

/** Reuse the authenticated provider read and the CRM multipart ingress.
 * @param {any} workflow @param {string} baseUrl @param {string} [crmBaseUrl] */
function attachObservedMedia(workflow, baseUrl, crmBaseUrl) {
  const event = 'Preparar saída observada (WAP)';
  const record = 'CRM - Registrar saída observada (WAP)';
  const gate = 'Preparar mídia observada (WAP)';
  const fetch = 'Evolution - Buscar mídia observada (WAP)';
  const decode = 'Validar mídia observada (WAP)';
  const digest = 'Crypto - SHA256 mídia observada (WAP)';
  const prepare = 'Preparar anexo observado (WAP)';
  const upload = 'CRM - Anexar mídia observada (WAP)';
  const find = (/** @type {string} */ name) =>
    workflow.nodes.find((/** @type {any} */ n) => n.name === name);
  const code = (
    /** @type {string} */ name,
    /** @type {string} */ id,
    /** @type {string} */ jsCode,
  ) => ({
    ...structuredClone(find(event)),
    name,
    id,
    parameters: { mode: 'runOnceForEachItem', jsCode },
  });
  const provider = structuredClone(find('WhatsApp - Consultar mídia (MVP)'));
  const crm = structuredClone(find(record));
  const headers = crm.parameters.headerParameters.parameters.filter(
    (/** @type {any} */ header) => header.name.toLowerCase() !== 'content-type',
  );
  const payload = `$('${gate}').item.json.payload`;
  workflow.nodes.push(
    code(
      gate,
      'wap-observed-media-gate',
      `const conversation=$json.attachment_conversation_id;const payload=$('${event}').item.json.payload;if($json.accepted!==true||typeof conversation!=='string')return [];return {json:{conversation,payload}};`,
    ),
    {
      ...provider,
      name: fetch,
      id: 'wap-observed-media-fetch',
      retryOnFail: false,
      onError: 'continueErrorOutput',
      parameters: {
        ...provider.parameters,
        url: `={{ ${JSON.stringify(baseUrl + '/chat/getBase64FromMediaMessage/')} + $json.payload.instance }}`,
        jsonBody: `={{ ({ message: { key: { id: $json.payload.external_message_id, fromMe: true } }, convertToMp4: false }) }}`,
      },
    },
    {
      ...code(
        decode,
        'wap-observed-media-decode',
        `const original=${decodeEvolutionMedia.toString()};const decode=${decodeObservedMedia.toString()};return decode($json,${payload}.message.type,original);`,
      ),
      onError: 'continueErrorOutput',
    },
    {
      ...structuredClone(find('Crypto - SHA256 midia (MVP)')),
      name: digest,
      id: 'wap-observed-media-hash',
      retryOnFail: false,
    },
    code(
      prepare,
      'wap-observed-attachment',
      `const data=$('${gate}').item.json;const old=$('${event}').item.json;const media=$('${decode}').item.binary;if(!/^[a-f0-9]{64}$/.test($json.media_sha256))throw new Error('EVOLUTION_MEDIA_INVALID');return {json:{...data,mime:media.data.mimeType,idempotency_key:old.idempotency_key+':attachment',correlation_id:old.correlation_id,sha256:$json.media_sha256},binary:media};`,
    ),
    {
      ...crm,
      name: upload,
      id: 'wap-observed-attachment-crm',
      retryOnFail: false,
      onError: 'continueErrorOutput',
      parameters: {
        ...crm.parameters,
        url: `={{ ${crmBaseUrl ? JSON.stringify(crmBaseUrl) : '$env.SILMER_PANEL_BASE_URL'} + '/api/v1/integrations/n8n/conversations/' + encodeURIComponent($json.conversation) + '/attachments' }}`,
        contentType: 'multipart-form-data',
        specifyBody: undefined,
        jsonBody: undefined,
        headerParameters: {
          parameters: [
            ...headers,
            { name: 'X-Silmer-Content-SHA256', value: '={{ $json.sha256 }}' },
            {
              name: 'X-Silmer-WhatsApp-Binding',
              value: '={{ $json.payload.source.bindingId }}',
            },
          ],
        },
        bodyParameters: {
          parameters: [
            { name: 'schema_version', value: '1.0' },
            {
              name: 'external_id',
              value: '={{ $json.payload.external_message_id }}',
            },
            { name: 'mime_type', value: '={{ $json.mime }}' },
            {
              parameterType: 'formBinaryData',
              name: 'file',
              inputDataFieldName: 'data',
            },
          ],
        },
      },
    },
  );
  const steps = [record, gate, fetch, decode, digest, prepare, upload];
  for (const [index, name] of steps.slice(0, -1).entries())
    workflow.connections[name] = {
      main: [[{ node: steps[index + 1], type: 'main', index: 0 }]],
    };
  // WAP-E12. Evolution waits 30 s for the webhook; the record is the durable
  // fact, so answer it before the ≤16 MB fetch and upload. A record failure
  // still fails the execution (500) and Evolution retries. executionOrder v1
  // runs sibling branches top to bottom by canvas y: the ack sits above.
  const ack = 'Confirmar saída observada (WAP)';
  const gateNode = find(gate);
  workflow.nodes.push({
    ...structuredClone(find('Evolution - Confirmar recebimento durável (MVP)')),
    name: ack,
    id: 'wap-observed-ack',
    position: [gateNode.position[0] + 240, gateNode.position[1] - 240],
  });
  workflow.connections[record].main[0].unshift({
    node: ack,
    type: 'main',
    index: 0,
  });
  // After the ack a media failure is no retry: report it as the inbound image
  // path does, unbound, since the CRM accepts no workflow.failed on a personal
  // conversation.
  const failure = 'Preparar falha de mídia observada (WAP)';
  const report = 'CRM - Registrar falha de mídia observada (WAP)';
  find(prepare).onError = 'continueErrorOutput';
  workflow.nodes.push(
    code(
      failure,
      'wap-observed-media-failure',
      `const executionId=String($execution.id);if(!/^[A-Za-z0-9_-]{1,128}$/.test(executionId))throw new Error('EVOLUTION_MEDIA_EXECUTION_INVALID');const eventId='observed-media-failed:'+executionId;return {json:{payload:{schema_version:'1.0',event_id:eventId,event_type:'workflow.failed',occurred_at:new Date().toISOString(),conversation_id:null,failure:{code:'INBOUND_MEDIA_STORE_FAILED'}},idempotency_key:eventId,correlation_id:executionId.padStart(16,'0')}};`,
    ),
    {
      ...structuredClone(find(record)),
      name: report,
      id: 'wap-observed-media-failure-crm',
      retryOnFail: false,
      onError: 'continueRegularOutput',
    },
  );
  for (const name of [fetch, decode, digest, prepare, upload])
    workflow.connections[name] = {
      main: [
        workflow.connections[name]?.main?.[0] ?? [],
        [{ node: failure, type: 'main', index: 0 }],
      ],
    };
  workflow.connections[failure] = {
    main: [[{ node: report, type: 'main', index: 0 }]],
  };
}

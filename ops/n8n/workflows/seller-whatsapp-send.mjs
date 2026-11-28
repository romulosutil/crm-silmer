import { patchPanelReservationFastPath } from '../patch-panel-reservation-fast-path.mjs';

const RESERVE = 'Preparar reserva de envio humano (MVP)';
const TEXT = 'WhatsApp - Enviar texto humano (MVP)';
const MEDIA = 'Evolution - Enviar midia humana (MVP)';
const PREPARE_MEDIA = 'Preparar mensagem Evolution de midia (MVP)';
const FAILURE = 'Falha de preflight da midia (MVP)';
const COMMAND = `$('${RESERVE}').item.json.command`;

/** Each anchor must exist exactly once, or the live journey drifted.
 * @param {string} text @param {string|RegExp} anchor @param {string} replacement */
function replaceOnce(text, anchor, replacement) {
  const count =
    typeof anchor === 'string'
      ? text.split(anchor).length - 1
      : [...text.matchAll(new RegExp(anchor.source, `${anchor.flags}g`))]
          .length;
  if (count !== 1) throw new Error('EVOLUTION_SEND_ANCHOR_INVALID');
  return text.replace(anchor, replacement);
}

/** Extend the one panel transport. The CRM grants one final dispatch per
 * reservation, after all recipient and retained-media preparation succeeds.
 * @param {any} workflow @param {string[]} lineIds */
export function configurePersonalSend(workflow, lineIds) {
  if (
    !Array.isArray(lineIds) ||
    lineIds.some((id) => !/^[a-f0-9-]{36}$/iu.test(id))
  )
    throw new Error('EVOLUTION_SEND_ALLOWLIST_INVALID');
  const find = (/** @type {string} */ name) => {
    const node = workflow.nodes.find(
      (/** @type {any} */ item) => item.name === name,
    );
    if (!node) throw new Error(`EVOLUTION_NODE_MISSING: ${name}`);
    return node;
  };
  const normalize = find('Normalizar comando do painel (MVP)');
  const reserve = find(RESERVE);
  const setType = 'n8n-nodes-base.set';
  const native = normalize.type === setType || reserve.type === setType;
  const sourceKey = native ? 'jsonOutput' : 'jsCode';
  if (
    typeof normalize.parameters?.[sourceKey] !== 'string' ||
    typeof reserve.parameters?.[sourceKey] !== 'string'
  )
    throw new Error('EVOLUTION_SEND_NODE_UNSUPPORTED');
  if (
    normalize.parameters[sourceKey].includes('payload.whatsapp_target') ||
    workflow.nodes.some((/** @type {any} */ node) =>
      /^Despacho pessoal de (?:text|media)\? \(WAP\)$/u.test(node.name),
    )
  )
    throw new Error('EVOLUTION_SEND_ALREADY_CONFIGURED');
  if (native) {
    try {
      // Both Set nodes must match the deployed fast path, including edges.
      if (patchPanelReservationFastPath(workflow).changedNodeNames.length)
        throw new Error('EVOLUTION_SEND_NODE_UNSUPPORTED');
    } catch {
      throw new Error('EVOLUTION_SEND_NODE_UNSUPPORTED');
    }
  }
  const invalid = native
    ? "{payload:{},kind:'invalid'}"
    : "{json:{payload:{},kind:'invalid'}}";
  normalize.parameters[sourceKey] = replaceOnce(
    replaceOnce(
      normalize.parameters[sourceKey],
      'const siteChat = ',
      `const target=payload.whatsapp_target;if(target&&(!${JSON.stringify(lineIds)}.includes(target.source?.lineId)||!/^\\d{8,15}$/.test(String(payload.to??'').replace(/^\\+/,''))||!/^[A-Za-z0-9_-]{1,64}$/.test(target.source?.instance??'')))return ${invalid};\nconst ficha=Boolean(target&&payload.order_pdf&&payload.message?.type==='document'&&payload.message.mime_type==='application/pdf');\nconst siteChat = !target && `,
    ),
    "['text', 'image', 'audio', 'video'].includes(payload.message?.type)",
    "(['text', 'image', 'audio', 'video'].includes(payload.message?.type)||ficha)",
  );
  if (!lineIds.length) return workflow;

  const bytes = find('Evolution - Preparar bytes humanos (MVP)');
  bytes.parameters.jsCode = replaceOnce(
    bytes.parameters.jsCode,
    "video: 'mp4'",
    "video: 'mp4', document: 'pdf'",
  );
  const prepareMedia = find(PREPARE_MEDIA);
  prepareMedia.parameters.jsCode = replaceOnce(
    prepareMedia.parameters.jsCode,
    "!['image','audio','video'].includes(expected.type)",
    "!['image','audio','video'].includes(expected.type)&&!(command.whatsapp_target&&command.order_pdf&&expected.type==='document'&&expected.mime_type==='application/pdf')",
  );

  /** @param {string} code */
  const withPersonalSource = (code) =>
    replaceOnce(
      code,
      /payload:\s*\{(?=[\s\S]*event_type:)/u,
      'payload: { ...(command.whatsapp_target ? {source: (({bindingId,lineId,accountId,generation})=>({bindingId,lineId,accountId,generation}))(command.whatsapp_target.source)} : {}),',
    );
  if (native)
    reserve.parameters.jsonOutput = withPersonalSource(
      reserve.parameters.jsonOutput,
    );
  for (const node of workflow.nodes) {
    const code = node.parameters?.jsCode;
    if (
      typeof code !== 'string' ||
      !/^\s*const command\s*=/mu.test(code) ||
      (!code.includes(COMMAND) && node.name !== RESERVE) ||
      !/event_type: '(message\.sent|message\.send\.requested|message\.send\.unknown|workflow\.failed)'/.test(
        code,
      )
    )
      continue;
    node.parameters.jsCode = withPersonalSource(code);
  }

  const recipient = find('Evolution - Consultar destinatario humano (MVP)');
  recipient.parameters.url = `={{ ${COMMAND}.whatsapp_target ? ${JSON.stringify(recipient.parameters.url.slice(0, recipient.parameters.url.lastIndexOf('/') + 1))} + ${COMMAND}.whatsapp_target.source.instance : ${JSON.stringify(recipient.parameters.url)} }}`;
  const template = find('CRM - Preflight midia reservada (MVP)');
  const edge = (/** @type {string} */ node) => ({
    node,
    type: 'main',
    index: 0,
  });
  for (const [name, kind] of [
    [TEXT, 'text'],
    [MEDIA, 'media'],
  ]) {
    const gate = `Despacho pessoal de ${kind}? (WAP)`;
    const check = `CRM - Autorizar despacho de ${kind} (WAP)`;
    const validate = `Validar despacho de ${kind} (WAP)`;
    const send = find(name);
    for (const links of Object.values(workflow.connections)) {
      for (const output of /** @type {any} */ (links).main ?? [])
        for (const link of output ?? [])
          if (link.node === name) link.node = gate;
    }
    workflow.nodes.push(
      {
        ...structuredClone(find('Mensagem humana tem midia? (MVP)')),
        name: gate,
        id: `wap-${kind}-gate`,
        parameters: {
          conditions: {
            options: {
              caseSensitive: true,
              typeValidation: 'strict',
              version: 2,
            },
            conditions: [
              {
                leftValue: `={{ Boolean(${COMMAND}.whatsapp_target) }}`,
                rightValue: true,
                operator: {
                  type: 'boolean',
                  operation: 'true',
                  singleValue: true,
                },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
      },
      {
        ...structuredClone(template),
        name: check,
        id: `wap-${kind}-dispatch`,
        onError: 'continueErrorOutput',
        retryOnFail: false,
        parameters: {
          ...structuredClone(template.parameters),
          method: 'POST',
          url: replaceOnce(
            template.parameters.url,
            '/media?preflight=true',
            '/preflight',
          ),
          sendBody: false,
        },
      },
      {
        ...structuredClone(find(FAILURE)),
        name: validate,
        id: `wap-${kind}-dispatch-response`,
        onError: 'continueErrorOutput',
        parameters: {
          mode: 'runOnceForEachItem',
          jsCode: `const command=${COMMAND};if($json.valid!==true||$json.to!==command.to||$json.instance!==command.whatsapp_target.source.instance)throw new Error('WHATSAPP_SEND_UNAVAILABLE');return {json:$json};`,
        },
      },
    );
    workflow.connections[gate] = { main: [[edge(check)], [edge(name)]] };
    workflow.connections[check] = { main: [[edge(validate)], [edge(FAILURE)]] };
    workflow.connections[validate] = { main: [[edge(name)], [edge(FAILURE)]] };
    if (kind === 'text') {
      const base = send.parameters.url.slice(
        0,
        send.parameters.url.lastIndexOf('/') + 1,
      );
      send.parameters.url = `={{ ${COMMAND}.whatsapp_target ? ${JSON.stringify(base)} + $('${validate}').item.json.instance : ${JSON.stringify(send.parameters.url)} }}`;
    } else {
      const prepared = `$('${PREPARE_MEDIA}').item.json`;
      if (!send.parameters.url.includes('$json.evolution_endpoint'))
        throw new Error('EVOLUTION_SEND_ANCHOR_INVALID');
      send.parameters.url = replaceOnce(
        send.parameters.url.replaceAll(
          '$json.evolution_endpoint',
          `${prepared}.evolution_endpoint`,
        ),
        /\+("\/[^"\n]+")(?=;\}\))/u,
        `+(${COMMAND}.whatsapp_target ? '/'+$('${validate}').item.json.instance : $1)`,
      );
      send.parameters.jsonBody = `={{ ${prepared}.evolution_message }}`;
    }
  }
  for (const name of [
    'Evolution - Validar envio texto humano (MVP)',
    'Validar resposta do envio de midia (MVP)',
  ]) {
    const node = find(name);
    node.parameters.jsCode = `const command=${COMMAND};if(command.whatsapp_target&&$json.key?.remoteJid!==String(command.to).replace(/^\\+/,'')+'@s.whatsapp.net')throw new Error('EVOLUTION_SEND_OUTCOME_UNKNOWN');${node.parameters.jsCode}`;
  }
  return workflow;
}

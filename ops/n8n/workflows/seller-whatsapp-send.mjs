const RESERVE = 'Preparar reserva de envio humano (MVP)';
const TEXT = 'WhatsApp - Enviar texto humano (MVP)';
const MEDIA = 'Evolution - Enviar midia humana (MVP)';
const PREPARE_MEDIA = 'Preparar mensagem Evolution de midia';
const FAILURE = 'Falha de preflight da midia (MVP)';
const COMMAND = `$('${RESERVE}').item.json.command`;

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
  normalize.parameters.jsCode = normalize.parameters.jsCode.replace(
    'const siteChat = ',
    `const target=payload.whatsapp_target;if(target&&(!${JSON.stringify(lineIds)}.includes(target.source?.lineId)||!/^\\d{8,15}$/.test(String(payload.to??'').replace(/^\\+/,''))||!/^[A-Za-z0-9_-]{1,64}$/.test(target.source?.instance??'')))return {json:{payload:{},kind:'invalid'}};\nconst siteChat = !target && `,
  );
  if (!lineIds.length) return workflow;

  for (const node of workflow.nodes) {
    const code = node.parameters?.jsCode;
    if (
      typeof code !== 'string' ||
      (!code.includes(RESERVE) && node.name !== RESERVE) ||
      !/event_type: '(message\.sent|message\.send\.requested|message\.send\.unknown|workflow\.failed)'/.test(
        code,
      )
    )
      continue;
    node.parameters.jsCode = code.replace(
      /payload:\s*\{(?=[\s\S]*event_type:)/u,
      'payload: { ...(command.whatsapp_target ? {source: (({bindingId,lineId,accountId,generation})=>({bindingId,lineId,accountId,generation}))(command.whatsapp_target.source)} : {}),',
    );
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
          url: template.parameters.url.replace(
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
      send.parameters.url = send.parameters.url
        .replaceAll(
          '$json.evolution_endpoint',
          `${prepared}.evolution_endpoint`,
        )
        .replace(
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

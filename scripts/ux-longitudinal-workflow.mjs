// CP-T04 / CP-09, CP-11..18: private manual-only longitudinal evaluation.
// Input must be an operator-exported workflow; never modifies its publication.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createDevTestWorkflow } from '../ops/n8n/workflows/create-dev-test-workflow.mjs';

/** Parse reviewed literal URLs or exactly two concatenated JSON strings.
 * No expression evaluation or environment access is permitted.
 * @param {unknown} value
 */
function parseReviewedUrl(value) {
  const text = String(value ?? '');
  const concatenated = text.match(
    /^=\{\{\s*("(?:[^"\\]|\\.)*")\s*\+\s*("(?:[^"\\]|\\.)*")\s*\}\}$/u,
  );
  const literal = concatenated
    ? JSON.parse(concatenated[1]) + JSON.parse(concatenated[2])
    : text.replace(/^=(?=https?:)/u, '');
  const url = new URL(literal);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('QA_REVIEWED_URL_REQUIRED');
  return url;
}

/** @param {Record<string, any>} source @param {Array<Record<string, any>>} turns @param {{runId: string, wave?: number}} options */
export function buildEvaluationWorkflow(source, turns, { runId, wave = 1 }) {
  if (!/^[a-z0-9-]{6,80}$/u.test(runId)) throw new Error('INVALID_RUN_ID');
  const original = structuredClone(source);
  // Evolution replaces these Meta-only human transport nodes. They are never
  // reachable from the evaluator's inbound and are removed below.
  for (const name of [
    'Meta - Upload midia humana (MVP)',
    'Meta - Enviar midia humana (MVP)',
  ]) {
    if (
      !original.nodes.some(
        (/** @type {Record<string, any>} */ node) => node.name === name,
      )
    ) {
      original.nodes.push({
        id: randomUUID(),
        name,
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [0, 0],
        parameters: { jsCode: 'return {json: $json};' },
      });
    }
  }
  const workflow = createDevTestWorkflow(original, { deployment: true });
  // Importing by name alone does not bind an existing n8n credential. Keep
  // the opaque reference from the reviewed export; never copy secret values.
  for (const node of workflow.nodes) {
    if (node.credentials?.httpBasicAuth) {
      const prior = source.nodes.find(
        (/** @type {Record<string, any>} */ item) => item.name === node.name,
      );
      if (prior?.credentials?.httpBasicAuth) {
        node.credentials = structuredClone(prior.credentials);
      }
    }
  }
  delete workflow.id;
  delete workflow.meta;
  delete workflow.source;
  delete workflow.nodeGroups;
  workflow.name = `QA | UX longitudinal | ${runId} | onda ${wave}`;
  workflow.active = false;
  workflow.settings = {
    executionOrder: 'v1',
    executionTimeout: 3600,
    saveDataErrorExecution: 'none',
    saveDataSuccessExecution: 'none',
    saveExecutionProgress: false,
    saveManualExecutions: false,
  };
  const nodes = /** @type {any[]} */ (workflow.nodes);
  const inboundUrl = parseReviewedUrl(
    nodes.find(
      (/** @type {any} */ node) =>
        node.name === 'CRM - Registrar inbound (MVP)',
    ).parameters.url,
  );
  const trigger = nodes.find(
    (node) => node.name === 'DEV - Receber evento sintético (MVP)',
  );
  trigger.type = 'n8n-nodes-base.manualTrigger';
  trigger.typeVersion = 1;
  trigger.parameters = {};
  delete trigger.credentials;
  delete trigger.webhookId;
  const edge = (/** @type {string} */ name) => ({
    main: [[{ node: name, type: 'main', index: 0 }]],
  });
  /** @param {string} name @param {string} jsCode @param {number[]} position */
  const makeCode = (name, jsCode, position) => ({
    id: randomUUID(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { mode: 'runOnceForEachItem', jsCode },
  });
  nodes.push({
    ...makeCode(
      'QA - Entradas sintéticas',
      `return ${JSON.stringify(turns.map((turn) => ({ json: turn })))};`,
      [180, -300],
    ),
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return ${JSON.stringify(turns.map((turn) => ({ json: turn })))};`,
    },
  });
  nodes.push({
    id: randomUUID(),
    name: 'QA - Um turno por vez',
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    position: [460, -300],
    parameters: { batchSize: 1, options: {} },
  });
  const buildInput = nodes.find(
    (node) => node.name === 'DEV - Montar evento WhatsApp sintético (MVP)',
  );
  buildInput.parameters.jsCode = `const turn = $json;
if (!/^55000000[0-9]{5}$/.test(turn.wa_id) || !turn.event_id.startsWith(${JSON.stringify(runId)})) throw new Error('SYNTHETIC_INPUT_REQUIRED');
const message = {from:turn.wa_id,id:turn.event_id,timestamp:String(turn.timestamp??Math.floor(Date.now()/1000)),type:'text',text:{body:turn.message}};
let binary;
if(turn.media_base64){message.type='image';delete message.text;message.image={id:turn.event_id+'-image',mime_type:'image/png',caption:turn.message};binary={data:{data:turn.media_base64,mimeType:'image/png',fileName:'camiseta-sintetica.png'}};}
return {json:{__dev_input:{scenario:'message'},entry:[{changes:[{value:{metadata:{phone_number_id:'synthetic-ux-longitudinal'},contacts:[{profile:{name:turn.customer_name},wa_id:turn.wa_id}],messages:[message]}}]}]},...(binary?{binary}:{})};`;
  workflow.connections[trigger.name] = edge('QA - Entradas sintéticas');
  workflow.connections['QA - Entradas sintéticas'] = edge(
    'QA - Um turno por vez',
  );
  workflow.connections['QA - Um turno por vez'] = {
    main: [[], [{ node: buildInput.name, type: 'main', index: 0 }]],
  };
  // Channel reception, media persistence and human observation are parallel
  // transport paths. This evaluator exercises the commercial AI path only.
  workflow.connections['CRM - Registrar inbound (MVP)'] = edge(
    'Rotear conversa registrada (MVP)',
  );
  for (const name of [
    'Evolution - Validar envio resposta da IA (MVP)',
    'Evolution - Validar envio aviso de transferência (MVP)',
  ]) {
    const node = nodes.find((item) => item.name === name);
    if (node)
      node.parameters = {
        mode: 'runOnceForEachItem',
        jsCode: 'return {json:$json};',
      };
  }
  // Every terminal DEV result reads back exactly its original inbound. The
  // idempotent replay returns current persisted context without another message.
  const results = nodes.filter((node) =>
    node.name.startsWith('DEV - Resultado'),
  );
  nodes.push(
    makeCode(
      'QA - Preparar leitura persistida',
      `const inbound=$('Preparar inbound CRM (MVP)').item.json;
return {json:{...inbound,result:$json}};`,
      [1600, -300],
    ),
  );
  const inboundHttp = nodes.find(
    (node) => node.name === 'CRM - Registrar inbound (MVP)',
  );
  const readback = structuredClone(inboundHttp);
  readback.id = randomUUID();
  readback.name = 'QA - Ler estado persistido';
  readback.position = [1850, -300];
  nodes.push(readback);
  nodes.push(
    makeCode(
      'QA - Evidência do turno',
      `const turn=$('QA - Um turno por vez').item.json;
const before=$('CRM - Registrar inbound (MVP)').item.json;
const result=$('QA - Preparar leitura persistida').item.json.result;
let decision=null;try{decision=$('Normalizar decisão da IA (MVP)').item.json;}catch{}
if(before.contact_id!==$json.contact_id || before.conversation_id!==$json.conversation_id) throw new Error('IDENTITY_CHANGED');
const pick=(obj,keys)=>Object.fromEntries(keys.filter(k=>obj&&obj[k]!==undefined).map(k=>[k,obj[k]]));
const state=obj=>pick(obj,['contact_id','conversation_id','conversation_version','automation_epoch','briefing','briefing_version','subjects','source_revision','source_subject_ids','mode','duplicate','order_opening_policy']);
return {json:{turn:pick(turn,['wa_id','event_id','customer_name','message','id_cliente','id_sessao','scenario','wave','timestamp']),result:pick(result,['ok','scenario','route','whatsapp_simulated','conversation_id','reply_text','output','answer_status','briefing_patch','open_order','handoff_required','trigger','turn']),decision:pick(decision,['reply_text','trigger','handoff_required','handoff_reason','open_order','briefing_patch','target_subject_id','target_order_id','answer_status']),before:state(before),after:state($json)}};`,
      [2100, -300],
    ),
  );
  for (const result of results)
    workflow.connections[result.name] = edge(
      'QA - Preparar leitura persistida',
    );
  workflow.connections['QA - Preparar leitura persistida'] = edge(
    readback.name,
  );
  workflow.connections[readback.name] = edge('QA - Evidência do turno');
  workflow.connections['QA - Evidência do turno'] = edge(
    'QA - Um turno por vez',
  );
  nodes.push({
    ...makeCode(
      'QA - Relatório da onda',
      'return {json:{turns:$input.all().map(item=>item.json)}};',
      [750, -550],
    ),
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const turns=$input.all().map(item=>item.json);const data=JSON.stringify({run_id:${JSON.stringify(runId)},wave:${wave},source_version:${JSON.stringify(source.versionId ?? null)},turns},null,2);return [{json:{run_id:${JSON.stringify(runId)},wave:${wave},turn_count:turns.length,contacts:[...new Set(turns.map(t=>t.after.contact_id))],summary:turns.map(t=>({event:t.turn.event_id,route:t.result.route,trigger:t.decision?.trigger,reply:t.result.reply_text,before:t.before.briefing,after:t.after.briefing,subjects:t.after.subjects}))},binary:{data:{data:Buffer.from(data).toString('base64'),mimeType:'application/json',fileName:${JSON.stringify(`ux-longitudinal-${runId}-onda-${wave}.json`)}}}}];`,
    },
  });
  workflow.connections['QA - Um turno por vez'].main[0] = [
    { node: 'QA - Relatório da onda', type: 'main', index: 0 },
  ];

  // Compute reachability on main edges, then retain model/parser dependencies.
  const reachable = new Set([trigger.name]);
  const pending = [trigger.name];
  while (pending.length) {
    const name = pending.pop();
    for (const branches of Object.values(workflow.connections[name] ?? {})) {
      for (const branch of branches)
        for (const link of branch ?? []) {
          if (!reachable.has(link.node)) {
            reachable.add(link.node);
            pending.push(link.node);
          }
        }
    }
  }
  for (const [name, connections] of Object.entries(workflow.connections)) {
    for (const [kind, branches] of Object.entries(connections)) {
      if (kind === 'main') continue;
      if (
        branches
          .flat()
          .some((/** @type {any} */ link) => reachable.has(link.node))
      )
        reachable.add(name);
    }
  }
  workflow.nodes = nodes.filter((node) => reachable.has(node.name));
  workflow.connections = Object.fromEntries(
    Object.entries(workflow.connections).filter(([name]) =>
      reachable.has(name),
    ),
  );
  for (const node of workflow.nodes) {
    delete node.webhookId;
    if (/webhook|chatTrigger|errorTrigger/u.test(node.type))
      throw new Error(`EXTERNAL_TRIGGER_REMAINS:${node.name}`);
    if (node.type === 'n8n-nodes-base.httpRequest') {
      const url = String(node.parameters.url ?? '');
      let allowed = false;
      try {
        const target = parseReviewedUrl(url);
        allowed =
          target.origin === inboundUrl.origin &&
          target.pathname.startsWith('/api/v1/integrations/n8n/');
      } catch {
        /* Nonliteral transport URLs are disabled. */
      }
      if (!allowed) {
        // Image/audio channel download is unreachable for text but remains a
        // conditional node. Disable it explicitly rather than risk a real call.
        node.type = 'n8n-nodes-base.code';
        node.typeVersion = 2;
        node.parameters = {
          mode: 'runOnceForEachItem',
          jsCode: "throw new Error('QA_EXTERNAL_TRANSPORT_DISABLED');",
        };
        delete node.credentials;
      }
    }
    node.position = node.position ?? [0, 0];
  }
  return workflow;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [sourcePath, turnsPath, outputPath, runId, wave] =
    process.argv.slice(2);
  if (!sourcePath || !turnsPath || !outputPath)
    throw new Error('Usage: source.json turns.json output.json run-id wave');
  const sourceText = await readFile(sourcePath, 'utf8');
  const source = JSON.parse(sourceText);
  const turns = JSON.parse(await readFile(turnsPath, 'utf8'));
  const workflow = buildEvaluationWorkflow(source, turns, {
    runId,
    wave: Number(wave ?? 1),
  });
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, JSON.stringify(workflow, null, 2) + '\n');
  console.log(
    JSON.stringify({
      output: outputPath,
      turns: turns.length,
      nodes: workflow.nodes.length,
      sourceVersion: source.versionId,
      sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
      active: workflow.active,
      externalTriggers: 0,
    }),
  );
}

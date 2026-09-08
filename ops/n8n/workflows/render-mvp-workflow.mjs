import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sourcePath = new URL(
  './k7tI6T4RhQPyJkn9-mvp-simple.sdk.js',
  import.meta.url,
);
let source = await readFile(sourcePath, 'utf8');
source = source.replace(/import \{[\s\S]*?\} from '@n8n\/workflow-sdk';/u, '');
source = source.replace(
  /export default workflow/u,
  'globalThis.__result = workflow',
);
source = source.replace(
  /const ([A-Za-z0-9_]+) = (node|trigger|switchCase|ifElse|languageModel|outputParser|codeStep|crmPost|ifBoolean|whatsAppText|responseNode)\(/gu,
  "globalThis.__currentVar = '$1';\nconst $1 = $2(",
);

/** @type {any[]} */
const builders = [];
/** @type {any[]} */
const edges = [];
let inlineSequence = 0;
const assigned = new Set();

function makeBuilder(definition, kind) {
  let variableName = context.__currentVar;
  if (!variableName || assigned.has(variableName)) {
    variableName = `inline_${++inlineSequence}`;
  }
  assigned.add(variableName);
  const builder = {
    __builder: true,
    __kind: kind,
    __variableName: variableName,
    definition,
    onCase(index, target) {
      connect(this, target, 'main', index);
      return this;
    },
    onError(target) {
      connect(this, target, 'main', 1);
      return this;
    },
    onFalse(target) {
      connect(this, target, 'main', 1);
      return this;
    },
    onTrue(target) {
      connect(this, target, 'main', 0);
      return this;
    },
    to(target) {
      connect(this, target, 'main', 0);
      return this;
    },
  };
  builders.push(builder);
  return builder;
}

function connect(source, target, type, sourceIndex) {
  if (!source?.__builder || !target?.__builder) {
    throw new TypeError('Workflow connection must join two nodes');
  }
  edges.push({
    source: source.__variableName,
    sourceIndex,
    target: target.__variableName,
    targetIndex: 0,
    type,
  });
}

function workflow(id, name) {
  let cursor = null;
  return {
    add(builder) {
      cursor = builder;
      return this;
    },
    id,
    name,
    to(builder) {
      connect(cursor, builder, 'main', 0);
      cursor = builder;
      return this;
    },
  };
}

const context = {
  Object,
  JSON,
  console,
  globalThis: null,
  node: (definition) => makeBuilder(definition, 'node'),
  trigger: (definition) => makeBuilder(definition, 'trigger'),
  switchCase: (definition) => makeBuilder(definition, 'switchCase'),
  ifElse: (definition) => makeBuilder(definition, 'ifElse'),
  languageModel: (definition) => makeBuilder(definition, 'languageModel'),
  outputParser: (definition) => makeBuilder(definition, 'outputParser'),
  workflow,
  expr: (value) => ({ __expression: value }),
  newCredential: (name) => ({ __credential: name }),
  __currentVar: null,
  __result: null,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: sourcePath.pathname });

const subnodeConnectionTypes = {
  model: 'ai_languageModel',
  outputParser: 'ai_outputParser',
};
for (const builder of builders) {
  for (const [slot, subnode] of Object.entries(
    builder.definition.config.subnodes ?? {},
  )) {
    const connectionType = subnodeConnectionTypes[slot];
    if (connectionType) connect(subnode, builder, connectionType, 0);
  }
}

const nodeByVariable = new Map(
  builders.map((builder) => [builder.__variableName, builder]),
);
const nodes = builders.map((builder) => materializeNode(builder));
const connections = {};
for (const edge of edges) {
  const sourceNode = nodeByVariable.get(edge.source);
  const targetNode = nodeByVariable.get(edge.target);
  if (!sourceNode || !targetNode) throw new Error('Unknown workflow edge');
  const sourceName = sourceNode.definition.config.name;
  const targetName = targetNode.definition.config.name;
  connections[sourceName] ??= {};
  connections[sourceName][edge.type] ??= [];
  connections[sourceName][edge.type][edge.sourceIndex] ??= [];
  connections[sourceName][edge.type][edge.sourceIndex].push({
    node: targetName,
    type: edge.type,
    index: edge.targetIndex,
  });
}

const imports = `import {
  expr,
  ifElse,
  languageModel,
  newCredential,
  node,
  outputParser,
  switchCase,
  trigger,
  workflow,
} from '@n8n/workflow-sdk';\n\n`;
const constants = `const WORKFLOW_KEY = 'k7tI6T4RhQPyJkn9';
const WORKFLOW_VERSION = 'mvp-simple-1';\n\n`;
const declarations = builders
  .filter(({ __variableName }) => !__variableName.startsWith('inline_'))
  .map((builder) => {
    const factory = builder.__kind;
    return `const ${builder.__variableName} = ${factory}(${serialize(builder.definition)});`;
  })
  .join('\n\n');
const tail = source
  .slice(source.indexOf('sendAi.onError('))
  .replace('globalThis.__result = workflow', 'export default workflow');

process.stdout.write(
  JSON.stringify({
    connections,
    expandedCode: `${imports}${constants}${declarations}\n\n${tail}`,
    name: context.__result.name,
    nodes,
    workflowId: context.__result.id,
  }),
);

function materializeNode(builder) {
  const definition = builder.definition;
  const config = definition.config;
  const inferredType = {
    ifElse: 'n8n-nodes-base.if',
    switchCase: 'n8n-nodes-base.switch',
  }[builder.__kind];
  const result = {
    name: config.name,
    type: definition.type ?? inferredType,
    typeVersion: definition.version,
    position: config.position,
    parameters: materialize(config.parameters ?? {}),
  };
  for (const setting of [
    'alwaysOutputData',
    'executeOnce',
    'maxTries',
    'onError',
    'retryOnFail',
    'waitBetweenTries',
  ]) {
    if (config[setting] !== undefined) result[setting] = config[setting];
  }
  if (config.credentials) result.credentials = materialize(config.credentials);
  return result;
}

function materialize(value) {
  if (Array.isArray(value)) return value.map(materialize);
  if (!value || typeof value !== 'object') return value;
  if (value.__expression) return `=${value.__expression}`;
  if (value.__credential) return { name: value.__credential };
  if (value.__builder) return { __builderRef: value.__variableName };
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, materialize(entry)]),
  );
}

function serialize(value) {
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (value.__expression) return `expr(${JSON.stringify(value.__expression)})`;
  if (value.__credential)
    return `newCredential(${JSON.stringify(value.__credential)})`;
  if (value.__builder) return value.__variableName;
  return `{${Object.entries(value)
    .map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry)}`)
    .join(',')}}`;
}

import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WEBHOOK_SHA256 =
  'afd0a6e02ce62b85c090a11acca1c1d207b9b6d15f21b87508af8fb4bf165039';
export const EXECUTIONS_SHA256 =
  '01ca68a06b0a502c2bf6885439a48bc28b026e2136440e7880b74f4262736f0b';
export const CONTROLLER_SHA256 =
  'a23362c684450f8efa065cdca680ab38023aa4e915248cb663d79ade4d9e8127';
const helper = '/opt/silmer/wap-ingress-runtime.cjs';
/** @param {string} source @param {string} expected @param {string} anchor @param {string} insertion */
function inject(source, expected, anchor, insertion) {
  if (
    createHash('sha256').update(source).digest('hex') !== expected ||
    source.split(anchor).length !== 2 ||
    source.includes(helper)
  )
    throw new Error('WAP_N8N_SOURCE_MISMATCH');
  return source.replace(anchor, insertion + anchor);
}
/** expected is overridable only by unit fixtures; installed image always uses pinned hashes.
 * @param {string} source @param {string} [expected] */
export function patchWebhookSource(source, expected = WEBHOOK_SHA256) {
  const anchor =
    '        const node = context.getNode();\n        const rawOptions = node.parameters?.options;';
  const auth = 'validationData = await this.validateAuth(context);';
  if (!source.includes(auth) || source.indexOf(auth) > source.indexOf(anchor))
    throw new Error('WAP_N8N_AUTH_ORDER_MISMATCH');
  return inject(
    source,
    expected,
    anchor,
    `        if (await require('${helper}').protectIngress(context)) {\n            return { noWebhookResponse: true };\n        }\n`,
  );
}
/** @param {string} source @param {string} [expected] */
export function patchExecutionsSource(source, expected = EXECUTIONS_SHA256) {
  const anchor =
    "        let executionStatus = existingExecution ? 'running' : 'new';";
  return inject(
    source,
    expected,
    anchor,
    `        require('${helper}').guardInitialExecution(executionData, existingExecution);\n`,
  );
}
/** @param {string} source @param {string} [expected] */
export function patchControllerSource(source, expected = CONTROLLER_SHA256) {
  const anchor =
    '        const n8nAuthCookie = this.authService.getCookieToken(req);';
  const lookup =
    'const dbWorkflow = await this.workflowRepository.get({ id: workflowId });';
  if (
    !source.includes(lookup) ||
    source.indexOf(lookup) > source.indexOf(anchor)
  )
    throw new Error('WAP_N8N_MANUAL_ORDER_MISMATCH');
  const createAnchor =
    '        const newWorkflow = (0, workflow_entity_mapper_1.createWorkflowEntityFromPayload)(body);';
  const updateAnchor =
    '        const { tags, parentFolderId, aiBuilderAssisted, expectedChecksum, autosaved, ...rest } = body;';
  if (
    [createAnchor, updateAnchor].some(
      (value) => source.split(value).length !== 2,
    )
  )
    throw new Error('WAP_N8N_SOURCE_MISMATCH');
  let patched = inject(
    source,
    expected,
    anchor,
    `        try {\n            require('${helper}').guardManualRequest(dbWorkflow, req.body);\n        } catch {\n            throw new errors_1.BadRequestError('WAP_MANUAL_REQUEST_DENIED');\n        }\n`,
  );
  patched = patched.replace(
    createAnchor,
    `        try {\n            require('${helper}').guardWorkflowMutation(null, body);\n        } catch {\n            throw new errors_1.BadRequestError('WAP_WORKFLOW_WRITE_DENIED');\n        }\n` +
      createAnchor,
  );
  patched = patched.replace(
    updateAnchor,
    `        const wapCurrentWorkflow = await this.workflowRepository.get({ id: workflowId });\n        try {\n            require('${helper}').guardWorkflowMutation(wapCurrentWorkflow, body);\n        } catch {\n            throw new errors_1.BadRequestError('WAP_WORKFLOW_WRITE_DENIED');\n        }\n` +
      updateAnchor,
  );
  return patched;
}
/** @param {string} root */
export async function patchInstalledN8n(root) {
  const packageRoot = resolve(root);
  const entries = (
    await readdir(join(packageRoot, 'node_modules/.pnpm'))
  ).filter((name) => name.startsWith('n8n-nodes-base@'));
  if (entries.length !== 1) throw new Error('WAP_N8N_PACKAGE_MISMATCH');
  const webhook = join(
    packageRoot,
    'node_modules/.pnpm',
    entries[0],
    'node_modules/n8n-nodes-base/dist/nodes/Webhook/Webhook.node.js',
  );
  const executions = join(packageRoot, 'dist/active-executions.js');
  const controller = join(
    packageRoot,
    'dist/workflows/workflows.controller.js',
  );
  // Validate all three sources before changing any file.
  const patchedWebhook = patchWebhookSource(await readFile(webhook, 'utf8'));
  const patchedExecutions = patchExecutionsSource(
    await readFile(executions, 'utf8'),
  );
  const patchedController = patchControllerSource(
    await readFile(controller, 'utf8'),
  );
  await writeFile(webhook, patchedWebhook);
  await writeFile(executions, patchedExecutions);
  await writeFile(controller, patchedController);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  patchInstalledN8n(process.argv[2] ?? '/usr/local/lib/node_modules/n8n')
    .then(() => {
      process.stdout.write('WAP_N8N_INGRESS_PATCHED\n');
    })
    .catch(() => {
      process.stderr.write('WAP_N8N_PATCH_REFUSED\n');
      process.exitCode = 1;
    });
}

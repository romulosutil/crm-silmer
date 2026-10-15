import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CRM_CREDENTIAL_NAME = 'Silmer n8n para CRM Basic DEV';

/**
 * n8n does not resolve a credential reference that contains only its name on
 * CLI import. Bind the existing CRM credential ID before importing a workflow.
 * The ID is installation-specific and must never be committed to a snapshot.
 *
 * @param {Record<string, any>} workflow
 * @param {string} credentialId
 */
export function bindCrmCredential(workflow, credentialId) {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(credentialId ?? '')) {
    throw new Error('CRM_CREDENTIAL_ID_REQUIRED');
  }
  const prepared = structuredClone(workflow);
  let count = 0;
  for (const node of prepared.nodes ?? []) {
    if (!node.name?.startsWith('CRM -')) continue;
    if (
      node.type !== 'n8n-nodes-base.httpRequest' ||
      node.parameters?.authentication !== 'genericCredentialType' ||
      node.parameters?.genericAuthType !== 'httpBasicAuth'
    ) {
      throw new Error(`CRM_CREDENTIAL_NODE_UNEXPECTED: ${node.name}`);
    }
    const existing = node.credentials?.httpBasicAuth;
    if (
      node.credentials &&
      (Object.keys(node.credentials).length !== 1 || !existing)
    ) {
      throw new Error(`CRM_CREDENTIAL_TYPE_MISMATCH: ${node.name}`);
    }
    if (
      existing &&
      (existing.name !== CRM_CREDENTIAL_NAME ||
        (existing.id && existing.id !== credentialId))
    ) {
      throw new Error(`CRM_CREDENTIAL_REFERENCE_MISMATCH: ${node.name}`);
    }
    node.credentials = {
      httpBasicAuth: { id: credentialId, name: CRM_CREDENTIAL_NAME },
    };
    count++;
  }
  if (count === 0) throw new Error('CRM_CREDENTIAL_NODES_MISSING');
  return { workflow: prepared, count };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [inputPath, outputPath, credentialId] = process.argv.slice(2);
  if (!inputPath || !outputPath || !credentialId || inputPath === outputPath) {
    throw new Error(
      'Usage: node bind-crm-credential.mjs <export.json> <prepared.json> <credential-id>',
    );
  }
  const source = JSON.parse(await readFile(inputPath, 'utf8'));
  const workflows = Array.isArray(source) ? source : [source];
  if (workflows.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const { workflow, count } = bindCrmCredential(workflows[0], credentialId);
  await writeFile(
    outputPath,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  process.stdout.write(`Bound ${count} CRM nodes\n`);
}

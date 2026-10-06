import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** @param {Record<string, any>} source @param {Record<string, any>|null} existing */
export function prepareLocalWorkflow(source, existing) {
  const result = structuredClone(source);
  if (existing && source.id !== existing.id)
    throw new Error('LOCAL_WORKFLOW_ID_MISMATCH');
  if (existing) result.active = existing.active === true;
  for (const node of result.nodes) {
    const previous = existing?.nodes.find(
      (/** @type {any} */ candidate) =>
        candidate.type === node.type &&
        (candidate.id === node.id || candidate.name === node.name),
    );
    // n8n assigns IDs to anonymous SDK nodes at import. Make them explicit
    // before verifying the round trip and stable across subsequent imports.
    node.id ??= previous?.id ?? randomUUID();
    if (node.type !== '@n8n/n8n-nodes-langchain.lmChatOpenAi') continue;
    if (previous?.credentials?.openAiApi) {
      node.credentials = {
        openAiApi: structuredClone(previous.credentials.openAiApi),
      };
    }
  }
  return result;
}

async function importLocalWorkflow() {
  const inputPath = process.argv[2];
  const markerPath = process.argv[3];
  if (!inputPath || !markerPath)
    throw new Error('LOCAL_IMPORT_ARGUMENTS_REQUIRED');
  const bytes = await readFile(inputPath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const previousDigest = await readFile(markerPath, 'utf8').catch(() => '');
  if (previousDigest.trim() === digest) return;
  const source = JSON.parse(bytes.toString('utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'silmer-local-import-'));
  const exportPath = join(directory, 'existing.json');
  const preparedPath = join(directory, 'prepared.json');
  try {
    // Export only this workflow. It contains credential references, never secrets.
    // A DB/export failure must stop instead of overwriting local credentials.
    let existing = null;
    try {
      await execute('n8n', [
        'export:workflow',
        '--id=' + source.id,
        '--output=' + exportPath,
      ]);
      existing = JSON.parse(await readFile(exportPath, 'utf8'))[0] ?? null;
    } catch (error) {
      if (
        !String(/** @type {any} */ (error).stdout).includes(
          'No workflows found with specified filters',
        )
      ) {
        throw new Error('LOCAL_WORKFLOW_EXPORT_FAILED');
      }
    }
    const prepared = prepareLocalWorkflow(source, existing ?? null);
    await writeFile(preparedPath, JSON.stringify(prepared), { mode: 0o600 });
    await execute('n8n', ['import:workflow', '--input=' + preparedPath]);
    if (prepared.active) {
      await execute('n8n', ['publish:workflow', '--id=' + prepared.id]);
    }
    await execute('n8n', [
      'export:workflow',
      '--id=' + prepared.id,
      '--output=' + exportPath,
    ]);
    const verified = JSON.parse(await readFile(exportPath, 'utf8'))[0];
    for (const field of ['nodes', 'connections', 'settings']) {
      if (
        JSON.stringify(verified?.[field]) !== JSON.stringify(prepared[field])
      ) {
        throw new Error('LOCAL_WORKFLOW_IMPORT_NOT_VERIFIED');
      }
    }
    if (
      prepared.active &&
      (!verified.activeVersionId ||
        verified.activeVersionId !== verified.versionId)
    ) {
      throw new Error('LOCAL_WORKFLOW_PUBLICATION_NOT_VERIFIED');
    }
    await writeFile(markerPath, digest + '\n', { mode: 0o600 });
    process.stdout.write('Local workflow digest imported\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await importLocalWorkflow();
}

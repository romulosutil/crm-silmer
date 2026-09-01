import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
const copies = [
  ['apps/edge-web/src', 'edge-web'],
  ['apps/api/src', 'runtime/apps/api/src'],
  ['apps/api/package.json', 'runtime/apps/api/package.json'],
  ['apps/worker/src', 'runtime/apps/worker/src'],
  ['apps/worker/package.json', 'runtime/apps/worker/package.json'],
  ['modules/database/src', 'runtime/modules/database/src'],
  ['modules/database/migrations', 'runtime/modules/database/migrations'],
  ['modules/database/package.json', 'runtime/modules/database/package.json'],
  ['modules/audit-privacy/src', 'runtime/modules/audit-privacy/src'],
  [
    'modules/audit-privacy/package.json',
    'runtime/modules/audit-privacy/package.json',
  ],
  ['modules/catalog/src', 'runtime/modules/catalog/src'],
  ['modules/catalog/package.json', 'runtime/modules/catalog/package.json'],
  ['modules/configuration/src', 'runtime/modules/configuration/src'],
  [
    'modules/configuration/package.json',
    'runtime/modules/configuration/package.json',
  ],
  ['modules/identity-access/src', 'runtime/modules/identity-access/src'],
  [
    'modules/identity-access/package.json',
    'runtime/modules/identity-access/package.json',
  ],
  [
    'modules/integration-reliability/src',
    'runtime/modules/integration-reliability/src',
  ],
  [
    'modules/integration-reliability/package.json',
    'runtime/modules/integration-reliability/package.json',
  ],
  ['modules/shared/src', 'runtime/modules/shared/src'],
  ['modules/shared/package.json', 'runtime/modules/shared/package.json'],
];

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });

for (const [source, destination] of copies) {
  const destinationPath = resolve(output, destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(resolve(root, source), destinationPath, { recursive: true });
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

const manifest = [];
for (const path of (await listFiles(output)).sort()) {
  const content = await readFile(path);
  manifest.push({
    path: relative(output, path).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(content).digest('hex'),
  });
}

await writeFile(
  resolve(output, 'manifest.json'),
  `${JSON.stringify({ files: manifest }, null, 2)}\n`,
  'utf8',
);

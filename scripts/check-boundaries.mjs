import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspacePackages = [
  'apps/edge-web/package.json',
  'apps/api/package.json',
  'apps/worker/package.json',
  'modules/shared/package.json',
];

for (const path of workspacePackages) {
  const packageJson = JSON.parse(await readFile(resolve(root, path), 'utf8'));
  assert.equal(packageJson.type, 'module', `${path} must declare ESM`);
}

const frontendPackage = JSON.parse(
  await readFile(resolve(root, 'apps/edge-web/package.json'), 'utf8'),
);
assert.deepEqual(
  frontendPackage.dependencies ?? {},
  {},
  'edge-web must not have runtime framework dependencies',
);

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJavaScript(path)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path);
    }
  }

  return files;
}

const windowState = /\bwindow\s*(?:\.|\[)/u;
for (const path of await listJavaScript(resolve(root, 'apps/edge-web/src'))) {
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(
    source,
    windowState,
    `${path} stores or reads state through window`,
  );
}

console.log('Module and frontend boundaries are valid.');

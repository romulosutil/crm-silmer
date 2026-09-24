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
async function listFrontendSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFrontendSources(path)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.js') || entry.name.endsWith('.vue'))
    ) {
      files.push(path);
    }
  }

  return files;
}

const windowState = /\bwindow\s*(?:\.|\[)/u;
for (const path of await listFrontendSources(
  resolve(root, 'apps/edge-web/src'),
)) {
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(
    source,
    windowState,
    `${path} stores or reads state through window`,
  );
}

// ADR 007: the order catalog is the one module folder the frontend shares with
// the server — plain data and pure functions — and it imports nothing else.
const moduleImport = /from\s+['"]((?:\.\.\/)+modules\/[^'"]+)['"]/gu;
for (const path of await listFrontendSources(
  resolve(root, 'apps/edge-web/src'),
)) {
  const source = await readFile(path, 'utf8');
  for (const [, target] of source.matchAll(moduleImport)) {
    assert.match(
      target,
      /modules\/orders\/src\/catalog\/[\w.-]+\.js$/u,
      `${path} imports ${target}; only modules/orders/src/catalog/ is shared with the frontend`,
    );
  }
}
for (const path of await listFrontendSources(
  resolve(root, 'modules/orders/src/catalog'),
)) {
  const source = await readFile(path, 'utf8');
  for (const [, target] of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
    assert.match(
      target,
      /^\.\/[\w.-]+\.js$/u,
      `${path} must only import files of its own folder`,
    );
  }
}

console.log('Module and frontend boundaries are valid.');

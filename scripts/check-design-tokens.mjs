import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const frontendRoot = resolve(root, 'apps/edge-web/src');
const tokenPath = resolve(frontendRoot, 'tokens.css');
const entry = await readFile(resolve(frontendRoot, 'main.js'), 'utf8');
const tokens = await readFile(tokenPath, 'utf8');

assert.match(
  entry,
  /import '\.\/tokens\.css';\s*import '\.\/styles\.css';/u,
  'edge-web must import tokens.css before its component styles',
);

for (const token of [
  '--color-canvas',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-active',
  '--color-text',
  '--color-text-muted',
  '--color-border',
  '--color-border-subtle',
  '--color-accent',
  '--color-on-accent',
  '--color-link',
  '--color-focus',
  '--status-success-surface',
  '--status-success-text',
  '--status-warning-surface',
  '--status-warning-text',
  '--status-error-surface',
  '--status-error-text',
  '--status-info-surface',
  '--status-info-text',
]) {
  assert.match(tokens, new RegExp(`${token}:`, 'u'), `missing ${token}`);
}

assert.match(tokens, /html\[data-theme='light'\]/u);
assert.match(tokens, /html\[data-theme='dark'\]/u);
assert.match(tokens, /:root:not\(\[data-theme\]\)/u);

const literalColor = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/iu;
const namedColor =
  /(?:^|[;{]\s*)(?:color|background(?:-color)?|border(?:-color)?):\s*(?:white|black)\b/iu;

for (const path of await listStyles(frontendRoot)) {
  if (path === tokenPath) continue;
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(
    source,
    literalColor,
    `${path} must consume semantic tokens instead of literal colors`,
  );
  assert.doesNotMatch(
    source,
    namedColor,
    `${path} must consume semantic tokens instead of named colors`,
  );
}

console.log(
  'Design tokens are loaded and component CSS has no literal colors.',
);

/** @param {string} directory @returns {Promise<string[]>} */
async function listStyles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listStyles(path)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.css') || entry.name.endsWith('.vue'))
    ) {
      paths.push(path);
    }
  }

  return paths;
}

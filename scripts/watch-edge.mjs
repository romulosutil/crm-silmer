import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sources = [
  resolve(root, 'apps/edge-web/src'),
  resolve(root, 'scripts/build.mjs'),
];
let building = false;
let queued = false;
/** @type {NodeJS.Timeout|undefined} */
let timer;

for (const source of sources) {
  watch(source, { recursive: true }, () => scheduleBuild());
}

console.log('Watching edge-web sources for changes.');

function scheduleBuild() {
  clearTimeout(timer);
  timer = setTimeout(() => void build(), 80);
}

async function build() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  console.log('Rebuilding edge-web…');
  const code = await new Promise((resolveCode) => {
    const child = spawn(process.execPath, ['scripts/build.mjs'], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('exit', (exitCode) => resolveCode(exitCode ?? 1));
    child.once('error', () => resolveCode(1));
  });
  if (code !== 0)
    console.error('Edge-web rebuild failed; waiting for the next change.');
  building = false;
  if (queued) {
    queued = false;
    scheduleBuild();
  }
}

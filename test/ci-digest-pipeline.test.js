import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bash =
  process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const digest = `sha256:${'a'.repeat(64)}`;

/** @param {string} script */
function run(script) {
  return spawnSync(bash, ['-e', '-o', 'pipefail', '-c', script], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

for (const path of [
  '.github/workflows/ci.yml',
  '.github/workflows/promote-approved-sha.yml',
]) {
  const workflow = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const filters = [
    ...workflow.matchAll(/imagetools inspect[^\n]+\| awk '([^']+)'/gu),
  ].map((match) => match[1]);

  test(`${path} drains large inspector output under pipefail`, () => {
    assert.ok(filters.length > 0);
    for (const filter of filters) {
      // Enough output after the header to force further producer writes after
      // awk has found the digest; an early exit breaks this real OS pipe.
      const result = run(`
        produce() {
          printf 'Digest: ${digest}\\n'
          for ((i=0; i<10000; i++)); do
            printf 'Manifest details: %0100d\\n' "$i"
          done
          printf 'Digest: sha256:secondary\\n'
        }
        produce | awk '${filter}'
      `);
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), digest);
    }
  });

  test(`${path} propagates inspector failures instead of accepting its header`, () => {
    for (const filter of filters) {
      const result = run(`
        produce() { printf 'Digest: ${digest}\\n'; return 255; }
        produce | awk '${filter}'
      `);
      assert.ifError(result.error);
      assert.equal(result.status, 255, result.stderr);
    }
  });

  test(`${path} returns no digest when the inspector returns no digest header`, () => {
    for (const filter of filters) {
      const result = run(`printf 'Name: missing-header\\n' | awk '${filter}'`);
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), '');
    }
  });
}

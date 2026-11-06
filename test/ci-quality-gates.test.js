import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const quality = workflow.split('\n  quality:')[1].split('\n  images:')[0];
const e2e = workflow.split('\n  e2e:')[1].split('\n  quality:')[0];
const bash =
  process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

test('the existing quality check requires every independent gate before images', () => {
  assert.match(quality, /name: Lint, tests, E2E and dependencies/u);
  assert.match(quality, /needs: \[checks, postgres, e2e\]/u);
  assert.match(workflow.split('\n  images:')[1], /needs: quality/u);
  assert.match(e2e, /shard: \[1, 2, 3, 4, 5, 6\]/u);
  assert.match(
    e2e,
    /npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/6/u,
  );
});

test('quality rejects every failed, skipped, or cancelled upstream gate', () => {
  const command = quality.match(/run: (test "\$CHECKS_RESULT"[^\n]+)/u)?.[1];
  assert.ok(command);
  for (const gate of ['CHECKS_RESULT', 'POSTGRES_RESULT', 'E2E_RESULT']) {
    for (const result of ['failure', 'skipped', 'cancelled']) {
      const env = {
        ...process.env,
        CHECKS_RESULT: 'success',
        POSTGRES_RESULT: 'success',
        E2E_RESULT: 'success',
        [gate]: result,
      };
      assert.notEqual(
        spawnSync(bash, ['-c', command], { env }).status,
        0,
        `${gate}: ${result}`,
      );
    }
  }
  const env = {
    ...process.env,
    CHECKS_RESULT: 'success',
    POSTGRES_RESULT: 'success',
    E2E_RESULT: 'success',
  };
  assert.equal(spawnSync(bash, ['-c', command], { env }).status, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { executeMediaCommand } from '../modules/integration-reliability/src/media-command.js';

test(
  'T22 media command abort waits for real child close before releasing guard',
  { timeout: 4000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'crm-media-child-close-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pidPath = join(root, 'synthetic-child.pid');
    const controller = new AbortController();
    const pending = executeMediaCommand(
      process.execPath,
      [
        '-e',
        `require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
        pidPath,
      ],
      { signal: controller.signal, windowsHide: true, timeout: 2000 },
    );
    const rejected = assert.rejects(
      pending,
      (/** @type {any} */ error) => error.code === 'ABORT_ERR',
    );
    let pid = 0;
    const deadline = Date.now() + 1500;
    while (!pid && Date.now() < deadline) {
      try {
        pid = Number(await readFile(pidPath, 'utf8'));
      } catch {
        await delay(10);
      }
    }
    assert.ok(pid > 0);
    controller.abort();
    await rejected;
    assert.throws(
      () => process.kill(pid, 0),
      (/** @type {any} */ error) => error.code === 'ESRCH',
    );
  },
);
test(
  'T22 media command timeout hard-kills a TERM-resistant child and closes it',
  { timeout: 4000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'crm-media-child-timeout-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pidPath = join(root, 'synthetic-child.pid');
    const pending = executeMediaCommand(
      process.execPath,
      [
        '-e',
        `require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
        pidPath,
      ],
      { windowsHide: true, timeout: 1000 },
    );
    await assert.rejects(
      pending,
      (/** @type {any} */ error) =>
        error.killed === true && error.signal === 'SIGKILL',
    );
    const pid = Number(await readFile(pidPath, 'utf8'));
    assert.ok(pid > 0);
    assert.throws(
      () => process.kill(pid, 0),
      (/** @type {any} */ error) => error.code === 'ESRCH',
    );
  },
);

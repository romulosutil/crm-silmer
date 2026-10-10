import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import test from 'node:test';
import {
  ClamAvDaemon,
  pingClamAv,
} from '../modules/integration-reliability/src/clamav-daemon.js';

test('T29 local readiness requires exact PONG and fails closed on absence or bounded silence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-clamd-probe-'));
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\crm-clamd-${process.pid}`
      : join(root, 'clamd.sock');
  let answer = 'PONG\0';
  const server = createServer((socket) =>
    socket.on('data', () => {
      if (answer) socket.end(answer);
    }),
  );
  try {
    assert.equal(await pingClamAv({ socketPath, timeoutMs: 30 }), false);
    await new Promise((resolve) =>
      server.listen(socketPath, () => resolve(undefined)),
    );
    assert.equal(await pingClamAv({ socketPath }), true);
    answer = 'NOT_PONG\0';
    assert.equal(await pingClamAv({ socketPath }), false);
    answer = '';
    assert.equal(await pingClamAv({ socketPath, timeoutMs: 30 }), false);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await rm(root, { recursive: true, force: true });
  }
});

test('T29 one engine is reused; refresh terminates it before replacement, then shutdown ends supervision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-clamd-life-'));
  /** @type {string[]} */ const events = [];
  let engines = 0;
  const daemon = new ClamAvDaemon({
    socketPath: join(root, 'socket'),
    async pingImpl() {
      return true;
    },
    /** @param {string} command @param {string[]} args @param {Record<string,unknown>} options */
    spawnImpl(command, args, options) {
      assert.equal(command, 'clamd');
      assert.ok(args.includes('--config-file=/app/clamd.conf'));
      assert.equal(options.stdio, 'ignore');
      assert.equal(options.windowsHide, true);
      engines++;
      events.push('start');
      const child = new EventEmitter();
      Object.assign(child, {
        /** @param {string} signal */
        kill(signal) {
          events.push(signal);
          child.emit('exit', 0);
        },
      });
      return child;
    },
  });
  try {
    await daemon.start();
    await daemon.start();
    assert.equal(engines, 1);
    if (process.platform !== 'win32')
      assert.equal((await stat(root)).mode & 0o777, 0o700);
    await daemon.restart();
    assert.deepEqual(events, ['start', 'SIGTERM', 'start']);
    await daemon.stop();
    assert.equal(daemon.timer, undefined);
    assert.equal(daemon.child, undefined);
    assert.deepEqual(events, ['start', 'SIGTERM', 'start', 'SIGTERM']);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('T29 an unready engine is terminated and never reported ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-clamd-failure-'));
  let failures = 0;
  let terminated = false;
  const daemon = new ClamAvDaemon({
    socketPath: join(root, 'socket'),
    startupTimeoutMs: 1,
    async pingImpl() {
      return false;
    },
    onFailure() {
      failures++;
    },
    spawnImpl() {
      const child = new EventEmitter();
      Object.assign(child, {
        kill() {
          terminated = true;
          child.emit('exit', 1);
        },
      });
      return child;
    },
  });
  try {
    await daemon.start();
    assert.equal(failures, 1);
    assert.equal(terminated, true);
    assert.equal(daemon.child, undefined);
    await assert.rejects(daemon.restart(), /Malware scanner is unavailable/u);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('T29 a crashed engine is replaced by supervision without overlapping processes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-clamd-recover-'));
  /** @type {EventEmitter[]} */ const children = [];
  const daemon = new ClamAvDaemon({
    socketPath: join(root, 'socket'),
    retryIntervalMs: 10,
    async pingImpl() {
      return true;
    },
    spawnImpl() {
      const child = new EventEmitter();
      Object.assign(child, {
        kill() {
          child.emit('exit', 0);
        },
      });
      children.push(child);
      return child;
    },
  });
  try {
    await daemon.start();
    children[0].emit('exit', 1);
    assert.equal(daemon.child, undefined);
    const deadline = Date.now() + 1000;
    while (children.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(children.length, 2);
    await daemon.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(children.length, 2);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('T29 graceful shutdown escalates a nonresponsive engine before replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-clamd-stop-'));
  /** @type {string[]} */ const signals = [];
  const daemon = new ClamAvDaemon({
    socketPath: join(root, 'socket'),
    stopTimeoutMs: 10,
    async pingImpl() {
      return true;
    },
    spawnImpl() {
      const child = new EventEmitter();
      Object.assign(child, {
        /** @param {string} signal */
        kill(signal) {
          signals.push(signal);
          if (signal === 'SIGKILL') child.emit('exit', 1);
        },
      });
      return child;
    },
  });
  try {
    await daemon.start();
    await daemon.stop();
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(daemon.child, undefined);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

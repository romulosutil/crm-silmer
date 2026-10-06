import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ClamAvSignatureRefresh } from '../modules/integration-reliability/src/clamav-signature-refresh.js';
import { ClamAvMediaScanner } from '../modules/integration-reliability/src/clamav-media-scanner.js';
import {
  ChatMediaValidator,
  ChatMediaValidationError,
} from '../modules/integration-reliability/src/chat-media-validation.js';

test('T5 freshclam startup and daily cadence have bounded commands and verified marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-signatures-'));
  const marker = join(root, 'verified');
  /** @type {any[]} */ const calls = [];
  const refresh = new ClamAvSignatureRefresh({
    markerPath: marker,
    /** @param {string} command @param {string[]} args @param {Record<string,unknown>} options */
    async execFileImpl(command, args, options) {
      calls.push({ command, args, options });
      return {};
    },
  });
  try {
    assert.equal(refresh.intervalMs, 24 * 3600000);
    await refresh.start();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'freshclam');
    assert.equal(calls[0].options.timeout, 180000);
    assert.equal(calls[0].options.maxBuffer, 65536);
    assert.ok(Number.isFinite(Date.parse(await readFile(marker, 'utf8'))));
  } finally {
    await refresh.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('T5 invalid, stale or future marker never authorizes media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-signatures-'));
  const marker = join(root, 'verified');
  const signature = join(root, 'synthetic-unit-signature');
  const path = join(root, 'synthetic-unit-image');
  await writeFile(signature, 'unit stub only');
  await writeFile(path, 'unit image stub');
  const now = new Date();
  const scanner = new ClamAvMediaScanner({
    signatureFiles: [signature],
    signatureFreshnessFile: marker,
    /** @param {string} command */ async execFileImpl(command) {
      return { stdout: command === 'file' ? 'image/png' : '' };
    },
  });
  const validator = new ChatMediaValidator({
    scanner,
    now: () => now,
    async execFileImpl() {
      return {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', codec_name: 'png' }],
          format: { format_name: 'png_pipe' },
        }),
      };
    },
  });
  try {
    for (const [timestamp, reason] of [
      ['invalid', 'scanner_unavailable'],
      [new Date(now.getTime() + 300001).toISOString(), 'stale_signatures'],
      [
        new Date(now.getTime() - 36 * 3600000 - 1).toISOString(),
        'stale_signatures',
      ],
    ]) {
      await writeFile(marker, timestamp);
      await assert.rejects(
        validator.validate({
          path,
          kind: 'image',
          origin: 'attachment',
          declaredMimeType: 'image/png',
        }),
        (error) =>
          error instanceof ChatMediaValidationError && error.reason === reason,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T5 refresh failure preserves prior marker and exposes only sanitized error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-signatures-'));
  const marker = join(root, 'verified');
  await writeFile(marker, '2026-01-01T00:00:00.000Z');
  const prior = await stat(marker);
  const refresh = new ClamAvSignatureRefresh({
    markerPath: marker,
    async execFileImpl() {
      throw new Error('private provider body');
    },
  });
  try {
    await assert.rejects(
      refresh.refresh(),
      (error) =>
        error instanceof Error &&
        error.message === 'Signature refresh is unavailable' &&
        !JSON.stringify(error).includes('private'),
    );
    assert.equal(await readFile(marker, 'utf8'), '2026-01-01T00:00:00.000Z');
    assert.equal((await stat(marker)).mtimeMs, prior.mtimeMs);
  } finally {
    await refresh.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('T5 simultaneous refresh requests share one in-flight download', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-signatures-'));
  let calls = 0;
  const refresh = new ClamAvSignatureRefresh({
    markerPath: join(root, 'verified'),
    async execFileImpl() {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  });
  try {
    await Promise.all([refresh.refresh(), refresh.refresh()]);
    assert.equal(calls, 1);
  } finally {
    await refresh.stop();
    await rm(root, { recursive: true, force: true });
  }
});

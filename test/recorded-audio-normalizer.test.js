import assert from 'node:assert/strict';
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RecordedAudioNormalizer } from '../modules/integration-reliability/src/recorded-audio-normalizer.js';
import { ChatMediaValidationError } from '../modules/integration-reliability/src/chat-media-validation.js';

/** @param {{mime?: string, durationMs?: number, channels?: number, timeout?: boolean, infectedOutput?: boolean}} [options] */
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'crm-recording-'));
  const path = join(root, 'input');
  const outputPath = join(root, 'output');
  await writeFile(path, 'synthetic');
  let validations = 0;
  const normalizer = new RecordedAudioNormalizer({
    validator: {
      async validate() {
        validations++;
        if (validations === 2 && options.infectedOutput)
          throw new ChatMediaValidationError('infected');
        return {
          mimeType:
            validations === 1 ? (options.mime ?? 'audio/webm') : 'audio/ogg',
          sha256: 'a'.repeat(64),
          sizeBytes: 9,
          durationMs: options.durationMs ?? 1200,
          audioCodec: 'opus',
          audioChannels: options.channels ?? 1,
        };
      },
    },
    /** @param {string} command @param {string[]} args @param {{timeout: number,maxBuffer: number}} limits */
    async execFileImpl(command, args, limits) {
      assert.equal(command, 'ffmpeg');
      assert.equal(limits.timeout, 120000);
      assert.equal(limits.maxBuffer, 65536);
      assert.equal(args[args.indexOf('-ac') + 1], '1');
      assert.equal(args[args.indexOf('-t') + 1], '301');
      assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file');
      if (options.timeout) throw new Error('raw private path');
      await writeFile(args[args.length - 1], 'synthetic');
      return { stdout: '' };
    },
  });
  return {
    root,
    path,
    outputPath,
    normalizer,
    calls: () => validations,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
for (const mime of ['audio/webm', 'audio/ogg', 'audio/mp4']) {
  test(`T5 normalizes ${mime}, scans input/output and removes intermediates`, async () => {
    const f = await fixture({ mime });
    try {
      const result = await f.normalizer.normalize({
        path: f.path,
        outputPath: f.outputPath,
        declaredMimeType: mime,
      });
      assert.equal(result.audioChannels, 1);
      assert.equal(result.audioCodec, 'opus');
      assert.equal(result.originalSha256, 'a'.repeat(64));
      assert.equal(f.calls(), 2);
      assert.deepEqual((await readdir(f.root)).sort(), ['input', 'output']);
    } finally {
      await f.cleanup();
    }
  });
}
for (const size of [0, 16 * 1024 * 1024 + 1]) {
  test(`T5 rejects ${size ? 'oversize' : 'empty'} real input before conversion`, async () => {
    const f = await fixture();
    try {
      const file = await open(f.path, 'w');
      await file.truncate(size);
      await file.close();
      await assert.rejects(
        new RecordedAudioNormalizer().normalize({
          path: f.path,
          outputPath: f.outputPath,
          declaredMimeType: 'audio/webm',
        }),
        /Media validation failed/u,
      );
      assert.deepEqual(await readdir(f.root), ['input']);
    } finally {
      await f.cleanup();
    }
  });
}
for (const [
  name,
  options,
  reason,
] of /** @type {Array<[string,any,string]>} */ ([
  ['duration over300', { durationMs: 300001 }, 'invalid_format'],
  ['timeout', { timeout: true }, 'processing_failed'],
  ['infected output', { infectedOutput: true }, 'infected'],
  ['nonmono output', { channels: 2 }, 'invalid_format'],
])) {
  test(`T5 ${name} fails closed and removes intermediates`, async () => {
    const f = await fixture(options);
    try {
      await assert.rejects(
        f.normalizer.normalize({
          path: f.path,
          outputPath: f.outputPath,
          declaredMimeType: 'audio/webm',
        }),
        (error) =>
          error instanceof ChatMediaValidationError &&
          error.reason === reason &&
          error.message === 'Media validation failed',
      );
      assert.deepEqual(await readdir(f.root), ['input']);
    } finally {
      await f.cleanup();
    }
  });
}
test('T5 never overwrites a persisted variant', async () => {
  const f = await fixture();
  try {
    await writeFile(f.outputPath, 'original');
    await assert.rejects(
      f.normalizer.normalize({
        path: f.path,
        outputPath: f.outputPath,
        declaredMimeType: 'audio/webm',
      }),
      { code: 'EEXIST' },
    );
    assert.equal(await readFile(f.outputPath, 'utf8'), 'original');
    assert.deepEqual((await readdir(f.root)).sort(), ['input', 'output']);
  } finally {
    await f.cleanup();
  }
});

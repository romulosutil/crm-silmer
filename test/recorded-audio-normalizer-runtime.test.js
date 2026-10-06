import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { RecordedAudioNormalizer } from '../modules/integration-reliability/src/recorded-audio-normalizer.js';

const execute = promisify(execFile);
if (process.env.RUN_CHAT_MEDIA_RUNTIME_TESTS === 'yes') {
  test('T5 real Chromium WebM, OGG/Opus and MP4/AAC produce scanned mono OGG', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crm-normalize-runtime-'));
    const browser = process.env.CHAT_MEDIA_CHROMIUM_FIXTURE;
    assert.ok(browser, 'real Chromium fixture required');
    const normalizer = new RecordedAudioNormalizer();
    try {
      for (const [mime, extension, codec] of [
        ['audio/ogg', 'ogg', 'libopus'],
        ['audio/mp4', 'm4a', 'aac'],
      ]) {
        await execute(
          'ffmpeg',
          [
            '-v',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:sample_rate=48000',
            '-t',
            '0.5',
            '-ac',
            '2',
            '-c:a',
            codec,
            '-threads',
            '1',
            join(root, `input.${extension}`),
          ],
          { timeout: 30000, maxBuffer: 65536 },
        );
        const output = join(root, `output-${extension}`);
        const result = await normalizer.normalize({
          path: join(root, `input.${extension}`),
          declaredMimeType: mime,
          outputPath: output,
        });
        assert.equal(result.audioChannels, 1);
        assert.equal(result.mimeType, 'audio/ogg');
        assert.equal(result.audioCodec, 'opus');
        assert.ok(result.durationMs >= 400 && result.durationMs <= 600);
        assert.match(result.sha256, /^[a-f0-9]{64}$/u);
      }
      const result = await normalizer.normalize({
        path: browser,
        declaredMimeType: 'audio/webm;codecs=opus',
        outputPath: join(root, 'output-browser'),
      });
      assert.equal(result.audioChannels, 1);
      assert.equal(result.audioCodec, 'opus');
      assert.ok(result.durationMs > 1000 && result.durationMs < 2000);
      const exactLimit = join(root, 'exact-limit.ogg');
      await execute(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000',
          '-t',
          '300',
          '-c:a',
          'libopus',
          '-b:a',
          '16k',
          '-threads',
          '1',
          exactLimit,
        ],
        { timeout: 30000, maxBuffer: 65536 },
      );
      const atLimit = await normalizer.normalize({
        path: exactLimit,
        declaredMimeType: 'audio/ogg',
        outputPath: join(root, 'output-at-limit'),
      });
      assert.equal(
        atLimit.durationMs,
        300000,
        'decoded300s is accepted despite OGG pre-skip/padding metadata',
      );
      assert.equal(atLimit.audioChannels, 1);
      // Live WebM muxer has no trusted duration; decoded301s must be rejected,
      // before any output is published. This also proves we do not truncate to300s.
      const tooLong = join(root, 'too-long.webm');
      await execute(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000',
          '-t',
          '301',
          '-c:a',
          'libopus',
          '-b:a',
          '16k',
          '-threads',
          '1',
          '-live',
          '1',
          tooLong,
        ],
        { timeout: 30000, maxBuffer: 65536 },
      );
      await assert.rejects(
        normalizer.normalize({
          path: tooLong,
          declaredMimeType: 'audio/webm',
          outputPath: join(root, 'forbidden-output'),
        }),
        /Media validation failed/u,
      );
      assert.ok(!(await readdir(root)).includes('forbidden-output'));
      assert.ok(
        (await readdir(root)).every((name) => !name.startsWith('.recording-')),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { ChatMediaValidator } from '../modules/integration-reliability/src/chat-media-validation.js';

const execute = promisify(execFile);
if (process.env.RUN_CHAT_MEDIA_RUNTIME_TESTS === 'yes') {
  test('T4 real ClamAV/libmagic/ffprobe permit six formats and reject MIME disguise, codec and EICAR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crm-media-runtime-'));
    const image = ['-f', 'lavfi', '-i', 'color=c=white:s=16x16:r=10'];
    const audio = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000'];
    const validator = new ChatMediaValidator();
    /** @type {Array<[string,string,string,string[]]>} */
    const fixtures = [
      ['image', 'image/jpeg', 'image.jpg', [...image, '-frames:v', '1']],
      ['image', 'image/png', 'image.png', [...image, '-frames:v', '1']],
      [
        'audio',
        'audio/mpeg',
        'audio.mp3',
        [...audio, '-t', '0.5', '-c:a', 'libmp3lame'],
      ],
      [
        'audio',
        'audio/ogg',
        'audio.ogg',
        [...audio, '-t', '0.5', '-c:a', 'libopus', '-ar', '48000'],
      ],
      [
        'audio',
        'audio/mp4',
        'audio.m4a',
        [...audio, '-t', '0.5', '-c:a', 'aac'],
      ],
      [
        'video',
        'video/mp4',
        'video.mp4',
        [
          ...image,
          ...audio,
          '-t',
          '0.5',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
        ],
      ],
    ];
    try {
      for (const [kind, mime, name, args] of fixtures) {
        const path = join(root, name);
        await execute(
          'ffmpeg',
          ['-v', 'error', '-y', ...args, '-threads', '1', path],
          { timeout: 30000, maxBuffer: 65536 },
        );
        const result = await validator.validate({
          path,
          kind,
          origin: 'attachment',
          declaredMimeType: mime,
        });
        assert.equal(result.mimeType, mime);
        assert.equal(result.sizeBytes, (await stat(path)).size);
        assert.match(result.sha256, /^[a-f0-9]{64}$/u);
      }
      const cover = join(root, 'covered.mp3');
      await execute(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-i',
          join(root, 'audio.mp3'),
          '-i',
          join(root, 'image.jpg'),
          '-map',
          '0:a',
          '-map',
          '1:v',
          '-c',
          'copy',
          '-disposition:v',
          'attached_pic',
          cover,
        ],
        { timeout: 30000, maxBuffer: 65536 },
      );
      assert.equal(
        (
          await validator.validate({
            path: cover,
            kind: 'audio',
            origin: 'attachment',
            declaredMimeType: 'audio/mpeg',
          })
        ).audioCodec,
        'mp3',
      );
      const streaming = process.env.CHAT_MEDIA_CHROMIUM_FIXTURE;
      assert.ok(
        streaming,
        'explicit real Chromium MediaRecorder fixture is required',
      );
      const probe = JSON.parse(
        String(
          (
            await execute(
              'ffprobe',
              [
                '-v',
                'error',
                '-show_entries',
                'format=duration',
                '-of',
                'json',
                streaming,
              ],
              { timeout: 10000, maxBuffer: 65536 },
            )
          ).stdout,
        ),
      );
      assert.equal(
        probe.format.duration,
        undefined,
        'MediaRecorder output omits duration',
      );
      const recorded = await validator.validate({
        path: streaming,
        kind: 'audio',
        origin: 'recording',
        declaredMimeType: 'audio/webm;codecs=opus',
      });
      assert.ok(
        recorded.durationMs !== null &&
          recorded.durationMs > 1000 &&
          recorded.durationMs < 2000,
        'actual decoded timeline is measured',
      );
      await assert.rejects(
        validator.validate({
          path: join(root, 'image.png'),
          kind: 'image',
          origin: 'attachment',
          declaredMimeType: 'image/jpeg',
        }),
        (error) =>
          error instanceof Error &&
          'reason' in error &&
          error.reason === 'invalid_format',
      );
      const invalid = join(root, 'invalid-codec.mp4');
      await execute(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          ...image,
          '-t',
          '0.5',
          '-c:v',
          'mpeg4',
          '-threads',
          '1',
          invalid,
        ],
        { timeout: 30000, maxBuffer: 65536 },
      );
      await assert.rejects(
        validator.validate({
          path: invalid,
          kind: 'video',
          origin: 'attachment',
          declaredMimeType: 'video/mp4',
        }),
        (error) =>
          error instanceof Error &&
          'reason' in error &&
          error.reason === 'invalid_format',
      );
      const eicar = join(root, 'synthetic-antivirus-test');
      await writeFile(
        eicar,
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      );
      await assert.rejects(
        validator.validate({
          path: eicar,
          kind: 'image',
          origin: 'attachment',
          declaredMimeType: 'image/jpeg',
        }),
        (error) =>
          error instanceof Error &&
          'reason' in error &&
          error.reason === 'infected',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

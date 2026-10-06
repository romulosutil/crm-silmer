import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ChatMediaValidator,
  validateMediaDeclaration,
} from '../modules/integration-reliability/src/chat-media-validation.js';

const NOW = new Date('2026-10-06T03:00:00Z');
/** @param {{mime?: string, clean?: boolean, age?: number, streams?: any[], format?: string, duration?: string, decodedDuration?: number, probeFailure?: boolean, scannerFailure?: boolean}} [options] */
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'crm-media-validation-'));
  const path = join(root, '00000000-0000-4000-8000-000000000001');
  await writeFile(path, Buffer.from('synthetic bytes'));
  const validator = new ChatMediaValidator({
    now: () => NOW,
    scanner: {
      async scan() {
        if (options.scannerFailure) throw new Error('secret scanner path');
        return {
          clean: options.clean ?? true,
          detectedMimeType: options.mime ?? 'image/jpeg',
          signatureUpdatedAt: new Date(NOW.getTime() - (options.age ?? 0)),
        };
      },
    },
    /** @param {string} command @param {string[]} args @param {{timeout: number}} limits */
    async execFileImpl(command, args, limits) {
      if (options.probeFailure) throw new Error('secret probe input');
      if (command === 'ffmpeg') {
        assert.equal(limits.timeout, 30000);
        assert.equal(args[args.indexOf('-t') + 1], '301');
        assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file');
        return {
          stdout: `out_time_us=${(options.decodedDuration ?? (Number(options.duration) || 1)) * 1000000}\nprogress=end\n`,
        };
      }
      return {
        stdout: JSON.stringify({
          streams: options.streams ?? [
            { codec_type: 'video', codec_name: 'mjpeg' },
          ],
          format: {
            format_name: options.format ?? 'jpeg_pipe',
            duration: options.duration ?? '1',
          },
        }),
      };
    },
  });
  return {
    path,
    validator,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

for (const [
  kind,
  mime,
  format,
  streams,
] of /** @type {Array<[string,string,string,any[]]>} */ ([
  [
    'image',
    'image/jpeg',
    'jpeg_pipe',
    [{ codec_type: 'video', codec_name: 'mjpeg' }],
  ],
  [
    'image',
    'image/png',
    'png_pipe',
    [{ codec_type: 'video', codec_name: 'png' }],
  ],
  ['audio', 'audio/mpeg', 'mp3', [{ codec_type: 'audio', codec_name: 'mp3' }]],
  ['audio', 'audio/ogg', 'ogg', [{ codec_type: 'audio', codec_name: 'opus' }]],
  [
    'audio',
    'audio/mp4',
    'mov,mp4,m4a,3gp,3g2,mj2',
    [{ codec_type: 'audio', codec_name: 'aac' }],
  ],
  [
    'video',
    'video/mp4',
    'mov,mp4,m4a,3gp,3g2,mj2',
    [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  ],
])) {
  test(`T4 allows ${mime} with real MIME and required codec`, async () => {
    const f = await fixture({ mime, format, streams });
    try {
      const result = await f.validator.validate({
        path: f.path,
        kind,
        origin: 'attachment',
        declaredMimeType: mime,
      });
      assert.equal(result.mimeType, mime);
      assert.equal(result.sizeBytes, 15);
      assert.match(result.sha256, /^[a-f0-9]{64}$/u);
    } finally {
      await f.cleanup();
    }
  });
}

test('T4 video without audio remains permitted, H264 required', async () => {
  const f = await fixture({
    mime: 'video/mp4',
    format: 'mov,mp4',
    streams: [{ codec_type: 'video', codec_name: 'h264' }],
  });
  try {
    assert.equal(
      (
        await f.validator.validate({
          path: f.path,
          kind: 'video',
          origin: 'attachment',
          declaredMimeType: 'video/mp4',
        })
      ).audioCodec,
      null,
    );
  } finally {
    await f.cleanup();
  }
});

test('T4 MP3 permits JPEG/PNG embedded cover only, rejects ordinary video', async () => {
  for (const attached_pic of [1, 0]) {
    const f = await fixture({
      mime: 'audio/mpeg',
      format: 'mp3',
      streams: [
        { codec_type: 'audio', codec_name: 'mp3' },
        {
          codec_type: 'video',
          codec_name: 'mjpeg',
          disposition: { attached_pic },
        },
      ],
    });
    try {
      const input = {
        path: f.path,
        kind: 'audio',
        origin: 'attachment',
        declaredMimeType: 'audio/mpeg',
      };
      if (attached_pic)
        assert.equal((await f.validator.validate(input)).audioCodec, 'mp3');
      else
        await assert.rejects(
          f.validator.validate(input),
          /Media validation failed/u,
        );
    } finally {
      await f.cleanup();
    }
  }
});

test('T4 streaming recording duration is decoded with bounds and rejects above 300s', async () => {
  for (const decodedDuration of [1.2, 301]) {
    const f = await fixture({
      mime: 'video/webm',
      format: 'matroska,webm',
      streams: [{ codec_type: 'audio', codec_name: 'opus' }],
      duration: 'N/A',
      decodedDuration,
    });
    try {
      const input = {
        path: f.path,
        kind: 'audio',
        origin: 'recording',
        declaredMimeType: 'audio/webm',
      };
      if (decodedDuration <= 300)
        assert.equal((await f.validator.validate(input)).durationMs, 1200);
      else
        await assert.rejects(
          f.validator.validate(input),
          /Media validation failed/u,
        );
    } finally {
      await f.cleanup();
    }
  }
});

test('T5 recording decoded timeline rejects misleading short header', async () => {
  const f = await fixture({
    mime: 'video/webm',
    format: 'matroska,webm',
    streams: [{ codec_type: 'audio', codec_name: 'opus' }],
    duration: '1',
    decodedDuration: 301,
  });
  try {
    await assert.rejects(
      f.validator.validate({
        path: f.path,
        kind: 'audio',
        origin: 'recording',
        declaredMimeType: 'audio/webm',
      }),
      /Media validation failed/u,
    );
  } finally {
    await f.cleanup();
  }
});

test('T4 declaration rejects oversize immediately and accepts exact boundaries', () => {
  for (const [kind, size] of [
    ['image', 5 * 1024 * 1024],
    ['audio', 16 * 1024 * 1024],
    ['video', 16 * 1024 * 1024],
  ]) {
    assert.equal(
      validateMediaDeclaration({
        kind: String(kind),
        origin: 'attachment',
        sizeBytes: Number(size),
      }).maxBytes,
      size,
    );
    assert.throws(
      () =>
        validateMediaDeclaration({
          kind: String(kind),
          origin: 'attachment',
          sizeBytes: Number(size) + 1,
        }),
      (error) =>
        error instanceof Error &&
        'statusCode' in error &&
        error.statusCode === 413,
    );
  }
});

test('T4 captions limited to 1024 chars for image/video and absent for audio', () => {
  assert.equal(
    validateMediaDeclaration({
      kind: 'image',
      origin: 'attachment',
      caption: 'a'.repeat(1024),
    }).caption.length,
    1024,
  );
  assert.throws(
    () =>
      validateMediaDeclaration({
        kind: 'video',
        origin: 'attachment',
        caption: 'a'.repeat(1025),
      }),
    (error) =>
      error instanceof Error &&
      'statusCode' in error &&
      error.statusCode === 422,
  );
  assert.throws(
    () =>
      validateMediaDeclaration({
        kind: 'audio',
        origin: 'attachment',
        caption: 'caption',
      }),
    /Invalid media declaration/u,
  );
});

test('T4 MIME disguise and unsupported codecs rejected before ready', async () => {
  for (const options of [
    { mime: 'image/png' },
    {
      mime: 'image/jpeg',
      streams: [{ codec_type: 'video', codec_name: 'gif' }],
    },
  ]) {
    const f = await fixture(options);
    try {
      await assert.rejects(
        f.validator.validate({
          path: f.path,
          kind: 'image',
          origin: 'attachment',
          declaredMimeType: 'image/jpeg',
        }),
        (error) =>
          error instanceof Error &&
          'reason' in error &&
          error.reason === 'invalid_format',
      );
    } finally {
      await f.cleanup();
    }
  }
});

test('T4 MP4 rejects HEVC and incompatible audio, OGG rejects Vorbis', async () => {
  for (const [
    kind,
    mime,
    format,
    streams,
  ] of /** @type {Array<[string,string,string,any[]]>} */ ([
    [
      'video',
      'video/mp4',
      'mov,mp4',
      [{ codec_type: 'video', codec_name: 'hevc' }],
    ],
    [
      'video',
      'video/mp4',
      'mov,mp4',
      [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'audio', codec_name: 'mp3' },
      ],
    ],
    [
      'audio',
      'audio/ogg',
      'ogg',
      [{ codec_type: 'audio', codec_name: 'vorbis' }],
    ],
  ])) {
    const f = await fixture({ mime, format, streams });
    try {
      await assert.rejects(
        f.validator.validate({
          path: f.path,
          kind,
          origin: 'attachment',
          declaredMimeType: mime,
        }),
        /Media validation failed/u,
      );
    } finally {
      await f.cleanup();
    }
  }
});

test('T4 malware, stale signatures and scanner failure reject with distinct sanitized reasons', async () => {
  for (const [options, reason] of /** @type {Array<[any,string]>} */ ([
    [{ clean: false }, 'infected'],
    [{ age: 36 * 3600000 + 1 }, 'stale_signatures'],
    [{ scannerFailure: true }, 'scanner_unavailable'],
  ])) {
    const f = await fixture(options);
    try {
      await assert.rejects(
        f.validator.validate({
          path: f.path,
          kind: 'image',
          origin: 'attachment',
          declaredMimeType: 'image/jpeg',
        }),
        (error) =>
          error instanceof Error &&
          'reason' in error &&
          error.reason === reason &&
          error.message === 'Media validation failed',
      );
    } finally {
      await f.cleanup();
    }
  }
});

test('T4 probe failures and empty inputs never become ready', async () => {
  for (const options of [{ probeFailure: true }, {}]) {
    const f = await fixture(options);
    try {
      if (!options.probeFailure) await writeFile(f.path, '');
      await assert.rejects(
        f.validator.validate({
          path: f.path,
          kind: 'image',
          origin: 'attachment',
          declaredMimeType: 'image/jpeg',
        }),
        /Media validation failed/u,
      );
    } finally {
      await f.cleanup();
    }
  }
});

test('T4 browser recording allows WebM Opus only to normalize, caps duration', async () => {
  for (const duration of ['300', '300.001']) {
    const f = await fixture({
      mime: 'video/webm',
      format: 'matroska,webm',
      streams: [{ codec_type: 'audio', codec_name: 'opus' }],
      duration,
    });
    try {
      const request = {
        path: f.path,
        kind: 'audio',
        origin: 'recording',
        declaredMimeType: 'audio/webm',
      };
      if (duration === '300')
        assert.equal((await f.validator.validate(request)).durationMs, 300000);
      else
        await assert.rejects(
          f.validator.validate(request),
          /Media validation failed/u,
        );
    } finally {
      await f.cleanup();
    }
  }
});

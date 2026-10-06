import { chmod, link, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { executeMediaCommand } from './media-command.js';

import {
  ChatMediaValidator,
  ChatMediaValidationError,
} from './chat-media-validation.js';

const execute = executeMediaCommand;
export class RecordedAudioNormalizer {
  #validator;
  #execute;
  /** @param {{validator?: {validate: Function}, execFileImpl?: Function}} [options] */
  constructor({
    validator = new ChatMediaValidator(),
    execFileImpl = execute,
  } = {}) {
    this.#validator = validator;
    this.#execute = execFileImpl;
  }

  /** @param {{path: string, declaredMimeType: string, outputPath: string,signal?:AbortSignal}} input */
  async normalize({ path, declaredMimeType, outputPath, signal }) {
    const input = await this.#validator.validate({
      path,
      kind: 'audio',
      origin: 'recording',
      declaredMimeType,
      signal,
    });
    if (
      !['audio/webm', 'audio/ogg', 'audio/mp4'].includes(input.mimeType) ||
      input.durationMs < 1 ||
      input.durationMs > 300000
    )
      throw new ChatMediaValidationError('invalid_format');
    const outputKey = basename(outputPath);
    const prefix =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
        outputKey,
      )
        ? `.recording-${outputKey}-`
        : '.recording-';
    const temporary = await mkdtemp(join(dirname(outputPath), prefix));
    const candidate = join(temporary, 'variant.ogg');
    try {
      await chmod(temporary, 0o700);
      const args = [
        '-v',
        'error',
        '-nostdin',
        '-n',
        '-threads',
        '1',
        '-max_alloc',
        '67108864',
        '-probesize',
        '8388608',
        '-analyzeduration',
        '10000000',
        '-protocol_whitelist',
        'file',
      ];
      if (input.mimeType === 'audio/mp4')
        args.push('-enable_drefs', '0', '-use_absolute_path', '0');
      args.push(
        '-i',
        path,
        '-map',
        '0:a:0',
        '-vn',
        '-map_metadata',
        '-1',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-application',
        'voip',
        '-t',
        '301',
        '-fs',
        String(16 * 1024 * 1024 + 1),
        '-threads',
        '1',
        '-f',
        'ogg',
        candidate,
      );
      try {
        await this.#execute('ffmpeg', args, {
          timeout: 120000,
          ...(signal ? { signal } : {}),
          maxBuffer: 65536,
          windowsHide: true,
        });
      } catch {
        throw new ChatMediaValidationError('processing_failed');
      }
      await chmod(candidate, 0o600);
      const result = await this.#validator.validate({
        path: candidate,
        kind: 'audio',
        origin: 'recording',
        declaredMimeType: 'audio/ogg',
        signal,
      });
      if (
        result.audioCodec !== 'opus' ||
        result.audioChannels !== 1 ||
        result.mimeType !== 'audio/ogg' ||
        result.durationMs < 1 ||
        result.durationMs > 300000
      )
        throw new ChatMediaValidationError('invalid_format');
      // Publish exclusively: an already persisted variant must never be replaced.
      await link(candidate, outputPath);
      return { ...result, originalSha256: input.sha256, path: outputPath };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
